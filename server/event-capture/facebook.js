'use strict';

const BaseCapture = require('./base-capture');
const StreamService = require('../models/stream-service');
const logger = require('../lib/logger');

const GRAPH_API = 'https://graph.facebook.com/v19.0';
const STREAMING_GRAPH = 'https://streaming-graph.facebook.com';

// How often to poll for live video when none is active (ms)
const FIND_STREAM_INTERVAL_MS = 30_000;
// How often to poll for viewer count while streaming (ms)
const VIEWER_POLL_INTERVAL_MS = 30_000;

class FacebookCapture extends BaseCapture {
  constructor(svc, manager) {
    super(svc, manager);
    this._stopping = false;
    this._liveVideoId = null;
    this._pageToken = null;      // page access token (derived from user token at connect time)
    this._findStreamTimer = null;
    this._viewerPollTimer = null;
    this._sseAbortController = null;
  }

  async connect() {
    try {
      this.svc = await StreamService.getWithCredentials(this.svc.id);
    } catch (err) {
      this.emit('error', new Error(`Failed to load credentials: ${err.message}`));
      return;
    }

    if (!this.svc.api_access_token) {
      this.emit('error', Object.assign(
        new Error('No Facebook access token — complete the Facebook Login for Devices flow'),
        { code: 'NO_TOKEN', permanent: true }
      ));
      return;
    }

    this._stopping = false;
    this._liveVideoId = null;
    this._pageToken = null;

    // Resolve page access token if a page_id is configured
    if (this.svc.metadata?.page_id) {
      try {
        this._pageToken = await this._fetchPageToken(
          this.svc.api_access_token,
          this.svc.metadata.page_id
        );
      } catch (err) {
        logger.warn(`[facebook-capture:${this.svc.id}] could not fetch page token: ${err.message} — falling back to user token`);
      }
    }

    await this._findAndConnect();
  }

  async disconnect() {
    this._stopping = true;
    this._connected = false;
    this._liveVideoId = null;

    if (this._findStreamTimer) {
      clearTimeout(this._findStreamTimer);
      this._findStreamTimer = null;
    }
    if (this._viewerPollTimer) {
      clearTimeout(this._viewerPollTimer);
      this._viewerPollTimer = null;
    }
    if (this._sseAbortController) {
      this._sseAbortController.abort();
      this._sseAbortController = null;
    }

    this.emit('disconnected', { reason: 'intentional' });
  }

  // ─── Internal: find active live video ────────────────────────────────────

  async _findAndConnect() {
    if (this._stopping) return;

    let videoId;
    try {
      videoId = await this._findActiveLiveVideo();
    } catch (err) {
      this.emit('error', err);
      return;
    }

    if (!videoId) {
      logger.debug(`[facebook-capture:${this.svc.id}] no active live video — retrying in ${FIND_STREAM_INTERVAL_MS}ms`);
      this._findStreamTimer = setTimeout(() => this._findAndConnect(), FIND_STREAM_INTERVAL_MS);
      return;
    }

    this._liveVideoId = videoId;
    this._connected = true;
    this.emit('connected');
    logger.info(`[facebook-capture:${this.svc.id}] connected to live video ${videoId}`);

    this._startCommentStream();
    this._scheduleViewerPoll();
  }

  async _findActiveLiveVideo() {
    const userToken = this.svc.api_access_token;

    // Try user-scoped live videos first
    const userRes = await fetch(
      `${GRAPH_API}/me/live_videos?status=LIVE&fields=id,status&access_token=${userToken}`
    );
    if (userRes.ok) {
      const json = await userRes.json();
      if (json.data?.length > 0) return json.data[0].id;
    } else if (userRes.status === 401) {
      throw Object.assign(new Error('Facebook access token expired — re-authenticate'), { code: 'TOKEN_EXPIRED', permanent: true });
    }

    // Try page-scoped live videos if configured
    const pageId = this.svc.metadata?.page_id;
    const pageToken = this._pageToken ?? userToken;
    if (pageId) {
      const pageRes = await fetch(
        `${GRAPH_API}/${pageId}/live_videos?status=LIVE&fields=id,status&access_token=${pageToken}`
      );
      if (pageRes.ok) {
        const json = await pageRes.json();
        if (json.data?.length > 0) return json.data[0].id;
      }
    }

    return null;
  }

  async _fetchPageToken(userToken, pageId) {
    const res = await fetch(`${GRAPH_API}/me/accounts?access_token=${userToken}`);
    if (!res.ok) throw new Error(`/me/accounts returned HTTP ${res.status}`);
    const json = await res.json();
    const page = (json.data ?? []).find((p) => String(p.id) === String(pageId));
    if (!page?.access_token) throw new Error(`Page ${pageId} not found in user's accounts`);
    return page.access_token;
  }

  // ─── SSE comment stream ───────────────────────────────────────────────────

  _startCommentStream() {
    const token = this._pageToken ?? this.svc.api_access_token;
    const url = `${STREAMING_GRAPH}/${this._liveVideoId}/live_comments`
      + `?access_token=${token}`
      + `&comment_rate=one_per_two_seconds`
      + `&fields=id,message,from{id,name,pic}`;

    this._sseAbortController = new AbortController();

    // Run SSE in background; errors feed back through emit('error')
    this._runSseStream(url, this._sseAbortController.signal).catch((err) => {
      if (!this._stopping) {
        logger.warn(`[facebook-capture:${this.svc.id}] SSE stream ended: ${err.message}`);
        // SSE ended unexpectedly — let viewer count poll detect stream end;
        // if stream is still live, we'll emit an error to trigger reconnect
        this.emit('error', err);
      }
    });
  }

  async _runSseStream(url, signal) {
    const res = await fetch(url, { signal });

    if (!res.ok) {
      if (res.status === 401) {
        throw Object.assign(new Error('Facebook token rejected by streaming-graph'), { code: 'TOKEN_EXPIRED', permanent: true });
      }
      throw new Error(`SSE stream returned HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!this._stopping) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep the incomplete trailing line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;
        try {
          const data = JSON.parse(jsonStr);
          this._handleComment(data);
        } catch {
          // Ignore malformed SSE messages
        }
      }
    }
  }

  _handleComment(data) {
    if (!data?.message) return;
    this.emit('event', this.buildEvent(
      'chat.message',
      {
        platformId: data.from?.id   ?? '',
        username:   data.from?.name ?? '',
        displayName: data.from?.name ?? '',
        avatarUrl:  data.from?.pic  ?? null,
      },
      { message: data.message }
    ));
  }

  // ─── Viewer count polling ─────────────────────────────────────────────────

  _scheduleViewerPoll() {
    if (this._stopping) return;
    this._viewerPollTimer = setTimeout(() => this._pollViewerCount(), VIEWER_POLL_INTERVAL_MS);
  }

  async _pollViewerCount() {
    if (this._stopping || !this._liveVideoId) return;

    const token = this._pageToken ?? this.svc.api_access_token;

    try {
      const res = await fetch(
        `${GRAPH_API}/${this._liveVideoId}?fields=live_views,status&access_token=${token}`
      );
      if (res.ok) {
        const data = await res.json();

        if (data.live_views != null) {
          this.emit('event', this.buildEvent('viewer_count', null, { count: data.live_views }));
        }

        // Detect stream end
        if (data.status === 'LIVE_STOPPED' || data.status === 'VOD' || data.status === 'PROCESSING') {
          logger.info(`[facebook-capture:${this.svc.id}] live video ${this._liveVideoId} ended (status=${data.status})`);
          this.emit('event', this.buildEvent('stream.end', null, {}));
          this._onStreamEnded();
          return;
        }
      } else if (res.status === 404) {
        // Video was deleted or ended
        this._onStreamEnded();
        return;
      }
    } catch (err) {
      logger.warn(`[facebook-capture:${this.svc.id}] viewer count poll error: ${err.message}`);
    }

    this._scheduleViewerPoll();
  }

  _onStreamEnded() {
    // Abort the SSE stream, clear state, and trigger reconnect via 'disconnected'
    if (this._sseAbortController) {
      this._sseAbortController.abort();
      this._sseAbortController = null;
    }
    this._liveVideoId = null;
    this._connected = false;

    if (!this._stopping) {
      // Emit disconnected — the manager will schedule a reconnect,
      // which will start polling for the next live video
      this.emit('disconnected', { reason: 'stream_ended' });
    }
  }
}

module.exports = FacebookCapture;
