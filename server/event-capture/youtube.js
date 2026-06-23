'use strict';

const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const BaseCapture = require('./base-capture');
const StreamService = require('../models/stream-service');
const tokenManager = require('../auth/token-manager');
const logger = require('../lib/logger');

const YOUTUBE_BROADCASTS_API = 'https://www.googleapis.com/youtube/v3/liveBroadcasts';
const YOUTUBE_CHAT_API = 'https://www.googleapis.com/youtube/v3/liveChat/messages';
const GRPC_ENDPOINT = 'youtubei.googleapis.com:443';
const PROTO_PATH = path.join(__dirname, '../proto/stream_list.proto');

// How often to poll liveBroadcasts.list while waiting for stream start (quota: ~1 unit/call)
const BROADCAST_POLL_INTERVAL_MS = 30 * 1000;

// Fallback REST poll default interval — overridden by pollingIntervalMillis from API
const REST_POLL_DEFAULT_MS = 5000;

class YouTubeCapture extends BaseCapture {
  constructor(svc, manager) {
    super(svc, manager);
    this._liveChatId = null;
    this._broadcastPollTimer = null;
    this._grpcClient = null;
    this._grpcCall = null;
    this._restPollTimer = null;
    this._intentionalDisconnect = false;
    this._usingGrpcFallback = false;
    this._packageDef = null;
    this._pageToken = null; // for REST fallback pagination
  }

  async connect() {
    this._intentionalDisconnect = false;

    // Reload fresh credentials (tokens may have been refreshed since instantiation)
    try {
      this.svc = await StreamService.getWithCredentials(this.svc.id);
    } catch (err) {
      this.emit('error', new Error(`Failed to load credentials: ${err.message}`));
      return;
    }

    if (!this.svc.api_access_token) {
      this.emit('error', Object.assign(
        new Error('No access token — connect your YouTube account first'),
        { code: 'NO_TOKEN' }
      ));
      return;
    }

    const chatId = await this._fetchLiveChatId();
    if (this._intentionalDisconnect) return;

    if (!chatId) {
      // No active broadcast yet — start polling until one appears
      logger.info(`[youtube-capture:${this.svc.id}] no active broadcast — polling every 30s`);
      this._startBroadcastPolling();
    } else {
      this._liveChatId = chatId;
      await this._connectGrpc();
    }
  }

  async disconnect() {
    this._intentionalDisconnect = true;
    this._connected = false;
    this._stopBroadcastPolling();
    this._stopRestPoll();
    this._closeGrpc();
    this.emit('disconnected', { reason: 'intentional' });
  }

  // ── Private: broadcast polling ────────────────────────────────────────────

  _startBroadcastPolling() {
    this._broadcastPollTimer = setInterval(async () => {
      if (this._intentionalDisconnect) {
        this._stopBroadcastPolling();
        return;
      }
      try {
        const chatId = await this._fetchLiveChatId();
        if (chatId) {
          this._stopBroadcastPolling();
          this._liveChatId = chatId;
          await this._connectGrpc();
        }
      } catch (err) {
        logger.warn(`[youtube-capture:${this.svc.id}] broadcast poll error: ${err.message}`);
      }
    }, BROADCAST_POLL_INTERVAL_MS);
  }

  _stopBroadcastPolling() {
    if (this._broadcastPollTimer) {
      clearInterval(this._broadcastPollTimer);
      this._broadcastPollTimer = null;
    }
  }

  // ── Private: live chat ID resolution ─────────────────────────────────────

  /**
   * Fetch the liveChatId for the currently active broadcast.
   * Handles 401 by refreshing the token and retrying once.
   * Returns liveChatId string or null if no active broadcast.
   */
  async _fetchLiveChatId() {
    // NOTE: broadcastStatus, mine, and id are mutually exclusive filters in the
    // liveBroadcasts.list API — sending more than one yields HTTP 400
    // "Incompatible parameters specified". broadcastStatus=active already scopes
    // results to the authenticated user's broadcasts, so we must NOT also pass mine=true.
    const doFetch = async (token) =>
      fetch(`${YOUTUBE_BROADCASTS_API}?part=snippet&broadcastStatus=active&broadcastType=all`, {
        headers: { Authorization: `Bearer ${token}` },
      });

    let res = await doFetch(this.svc.api_access_token);

    if (res.status === 401) {
      logger.info(`[youtube-capture:${this.svc.id}] access token expired — refreshing`);
      try {
        await tokenManager.refreshNow(this.svc.id);
        this.svc = await StreamService.getWithCredentials(this.svc.id);
        res = await doFetch(this.svc.api_access_token);
      } catch (refreshErr) {
        logger.error(`[youtube-capture:${this.svc.id}] token refresh failed: ${refreshErr.message}`);
        throw refreshErr;
      }
    }

    if (res.ok) {
      const data = await res.json();
      return data?.items?.[0]?.snippet?.liveChatId ?? null;
    }

    // Token still rejected after a refresh — genuine auth problem; surface it so the
    // user is prompted to reconnect their account.
    if (res.status === 401) {
      throw Object.assign(
        new Error('YouTube rejected the access token — reconnect your YouTube account'),
        { code: 'NO_TOKEN' }
      );
    }

    // Any other non-OK response (400 bad request, 403 quota/forbidden, 5xx) is treated
    // as non-fatal: log it and report "no active broadcast" so the worker keeps polling
    // instead of burning its failure budget and permanently giving up on chat capture.
    const body = await res.text().catch(() => '');
    logger.warn(
      `[youtube-capture:${this.svc.id}] liveBroadcasts.list HTTP ${res.status}: ` +
      `${body.slice(0, 200)} — will keep polling`
    );
    return null;
  }

  // ── Private: gRPC connection ──────────────────────────────────────────────

  async _connectGrpc() {
    if (this._intentionalDisconnect) return;

    try {
      // Load proto once and cache
      if (!this._packageDef) {
        const loaded = protoLoader.loadSync(PROTO_PATH, {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
        });
        this._packageDef = grpc.loadPackageDefinition(loaded);
      }

      const ServiceStub = this._packageDef?.google?.youtube?.v3?.V3DataLiveChatMessageService;
      if (!ServiceStub) {
        throw new Error('Proto definition missing V3DataLiveChatMessageService — check stream_list.proto');
      }

      this._grpcClient = new ServiceStub(GRPC_ENDPOINT, grpc.credentials.createSsl());

      const meta = new grpc.Metadata();
      meta.add('authorization', `Bearer ${this.svc.api_access_token}`);

      // StreamList is a server-streaming RPC; call() returns a readable stream
      this._grpcCall = this._grpcClient.StreamList(
        { live_chat_id: this._liveChatId, profile_image_size: 0 },
        meta
      );

      this._grpcCall.on('data', (msg) => this._onGrpcData(msg));
      this._grpcCall.on('end',  ()    => this._onGrpcEnd());
      this._grpcCall.on('error',(err) => this._onGrpcError(err));

      // Emit connected immediately — we don't wait for the first message
      this._connected = true;
      this.emit('connected');
      logger.info(`[youtube-capture:${this.svc.id}] gRPC StreamList connected (liveChatId=${this._liveChatId})`);

    } catch (err) {
      logger.error(`[youtube-capture:${this.svc.id}] gRPC setup failed: ${err.message}`);
      logger.info(`[youtube-capture:${this.svc.id}] falling back to REST polling`);
      this._startRestFallback();
    }
  }

  _closeGrpc() {
    if (this._grpcCall) {
      try { this._grpcCall.cancel(); } catch { /* ignore */ }
      this._grpcCall = null;
    }
    if (this._grpcClient) {
      try { this._grpcClient.close(); } catch { /* ignore */ }
      this._grpcClient = null;
    }
  }

  _onGrpcData(msg) {
    if (this._intentionalDisconnect) return;
    // Log raw message at debug level on first receipt to help diagnose proto field name issues
    logger.debug(`[youtube-capture:${this.svc.id}] gRPC data: type=${msg?.snippet?.type}`);

    const normalized = this._normalizeEvent(msg?.snippet, msg?.author_details);
    if (normalized) {
      this.emit('event', this.buildEvent(normalized.type, normalized.actor, normalized.data));
    }
  }

  _onGrpcEnd() {
    if (this._intentionalDisconnect) return;
    this._connected = false;
    logger.info(`[youtube-capture:${this.svc.id}] gRPC stream ended — probing broadcast status`);
    this._probeAndDecideReconnect();
  }

  _onGrpcError(err) {
    if (this._intentionalDisconnect) return;
    this._connected = false;
    // gRPC disconnect error codes are ambiguous (known YouTube API issue) — always probe
    logger.warn(`[youtube-capture:${this.svc.id}] gRPC error (code=${err?.code}): ${err.message}`);
    this._probeAndDecideReconnect();
  }

  /**
   * After a gRPC disconnect (clean end or error), check whether the broadcast is
   * still active to decide whether to reconnect or treat as stream ended.
   *
   * Both outcomes emit 'disconnected' — the capture manager will call connect() again.
   * If the broadcast is over, connect() will start broadcast polling until the next stream.
   */
  async _probeAndDecideReconnect() {
    if (this._intentionalDisconnect) return;
    this._closeGrpc();

    try {
      const chatId = await this._fetchLiveChatId();
      if (chatId) {
        // Broadcast still active — reconnect to gRPC (manager will do this via 'disconnected' + retry)
        logger.info(`[youtube-capture:${this.svc.id}] broadcast still active — signaling reconnect`);
        this.emit('disconnected', { reason: 'grpc_disconnect' });
      } else {
        // No active broadcast — stream ended; reconnect will restart broadcast polling
        logger.info(`[youtube-capture:${this.svc.id}] broadcast ended`);
        this._liveChatId = null;
        this.emit('disconnected', { reason: 'stream_ended' });
      }
    } catch (probeErr) {
      // Probe itself failed (likely expired token) — emit error so manager does backoff retry
      logger.warn(`[youtube-capture:${this.svc.id}] broadcast probe failed: ${probeErr.message}`);
      this.emit('error', probeErr);
    }
  }

  // ── Private: REST polling fallback ────────────────────────────────────────

  /**
   * Fallback to REST liveChatMessages.list when gRPC is unavailable.
   * Uses pollingIntervalMillis from the API response to self-throttle.
   * Quota cost: 5 units/call — use only when gRPC fails.
   */
  _startRestFallback() {
    if (this._intentionalDisconnect) return;
    this._usingGrpcFallback = true;
    this._pageToken = null;
    this._connected = true;
    this.emit('connected');
    logger.info(`[youtube-capture:${this.svc.id}] starting REST polling fallback`);
    this._scheduleRestPoll(0);
  }

  _scheduleRestPoll(delayMs) {
    this._restPollTimer = setTimeout(() => this._restPoll(), delayMs);
  }

  _stopRestPoll() {
    if (this._restPollTimer) {
      clearTimeout(this._restPollTimer);
      this._restPollTimer = null;
    }
  }

  async _restPoll() {
    if (this._intentionalDisconnect || !this._liveChatId) return;

    const params = new URLSearchParams({
      liveChatId: this._liveChatId,
      part: 'snippet,authorDetails',
      maxResults: '200',
    });
    if (this._pageToken) params.set('pageToken', this._pageToken);

    try {
      const res = await fetch(`${YOUTUBE_CHAT_API}?${params}`, {
        headers: { Authorization: `Bearer ${this.svc.api_access_token}` },
      });

      if (res.status === 401) {
        await tokenManager.refreshNow(this.svc.id);
        this.svc = await StreamService.getWithCredentials(this.svc.id);
        this._scheduleRestPoll(1000);
        return;
      }

      if (res.status === 403) {
        // Chat disabled or forbidden — treat as stream ended
        logger.info(`[youtube-capture:${this.svc.id}] REST poll got 403 — chat may be disabled`);
        this._connected = false;
        this._liveChatId = null;
        this.emit('disconnected', { reason: 'chat_disabled' });
        return;
      }

      if (!res.ok) {
        throw new Error(`liveChat/messages failed (HTTP ${res.status})`);
      }

      const data = await res.json();
      this._pageToken = data.nextPageToken ?? null;
      const nextPollMs = data.pollingIntervalMillis ?? REST_POLL_DEFAULT_MS;

      for (const item of (data.items ?? [])) {
        const normalized = this._normalizeEvent(item.snippet, item.authorDetails);
        if (normalized) {
          this.emit('event', this.buildEvent(normalized.type, normalized.actor, normalized.data));
        }
      }

      this._scheduleRestPoll(nextPollMs);

    } catch (err) {
      logger.warn(`[youtube-capture:${this.svc.id}] REST poll error: ${err.message}`);
      this.emit('error', err);
    }
  }

  // ── Private: event normalization ──────────────────────────────────────────

  /**
   * Normalize a YouTube live chat event snippet + authorDetails into an OtteryEvent.
   * Works for both gRPC message objects (snake_case) and REST API items (also snake_case
   * when using keepCase:true in proto loader, but REST returns camelCase).
   *
   * The snippet.type values come from the YouTube Data API:
   *   https://developers.google.com/youtube/v3/live/docs/liveChatMessages
   */
  _normalizeEvent(snippet, authorDetails) {
    if (!snippet?.type) return null;

    // Build actor object (same structure for all event types)
    const actor = authorDetails ? {
      platformId: authorDetails.channel_id || authorDetails.channelId || '',
      username: authorDetails.display_name || authorDetails.displayName || '',
      displayName: authorDetails.display_name || authorDetails.displayName || '',
      isSubscriber: authorDetails.is_chat_sponsor ?? authorDetails.isChatSponsor ?? false,
      isModerator: authorDetails.is_chat_moderator ?? authorDetails.isChatModerator ?? false,
    } : null;

    // Handle both snake_case (gRPC/proto) and camelCase (REST API) field names
    const type = snippet.type;

    switch (type) {
      case 'textMessageEvent': {
        const msg = snippet.display_message || snippet.displayMessage || '';
        return { type: 'chat.message', actor, data: { message: msg } };
      }

      case 'superChatEvent': {
        const sc = snippet.super_chat_details || snippet.superChatDetails || {};
        return {
          type: 'tip',
          actor,
          data: {
            amount: sc.amount_micros != null
              ? Number(sc.amount_micros) / 1_000_000
              : null,
            currency: sc.currency || null,
            amount_display: sc.amount_display_string || sc.amountDisplayString || null,
            tier: sc.tier || null,
            message: sc.user_comment || sc.userComment || null,
          },
        };
      }

      case 'superStickerEvent': {
        const ss = snippet.super_sticker_details || snippet.superStickerDetails || {};
        return {
          type: 'tip',
          actor,
          data: {
            sticker_id: ss.sticker_id || ss.stickerId || null,
            amount: ss.amount_micros != null
              ? Number(ss.amount_micros) / 1_000_000
              : null,
            currency: ss.currency || null,
            amount_display: ss.amount_display_string || ss.amountDisplayString || null,
            tier: ss.tier || null,
          },
        };
      }

      case 'newSponsorEvent':
        return {
          type: 'subscribe',
          actor,
          data: { months: 1, is_new: true },
        };

      case 'memberMilestoneChatEvent': {
        const mm = snippet.member_milestone_chat_details || snippet.memberMilestoneChatDetails || {};
        return {
          type: 'subscribe',
          actor,
          data: {
            months: mm.member_month || mm.memberMonth || null,
            level: mm.member_level_name || mm.memberLevelName || null,
            message: mm.user_comment || mm.userComment || null,
            is_new: false,
          },
        };
      }

      case 'membershipGiftingEvent': {
        const mg = snippet.membership_gifting_details || snippet.membershipGiftingDetails || {};
        return {
          type: 'subscribe.gift',
          actor,
          data: {
            count: mg.gift_memberships_count || mg.giftMembershipsCount || 1,
            level: mg.gift_memberships_level_name || mg.giftMembershipsLevelName || null,
          },
        };
      }

      case 'giftMembershipReceivedEvent': {
        const gmr = snippet.gift_membership_received_details || snippet.giftMembershipReceivedDetails || {};
        return {
          type: 'subscribe.gift',
          actor,
          data: {
            count: 1,
            level: gmr.gift_memberships_level_name || gmr.giftMembershipsLevelName || null,
            gifted: true,
          },
        };
      }

      // Silently discard moderation and system events
      case 'messageDeletedEvent':
      case 'messageRetractedEvent':
      case 'userBannedEvent':
      case 'pollEvent':
      case 'tombstone':
        return null;

      default:
        logger.debug(`[youtube-capture:${this.svc.id}] unhandled snippet type: ${type}`);
        return null;
    }
  }
}

module.exports = YouTubeCapture;
