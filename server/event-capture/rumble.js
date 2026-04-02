'use strict';

const BaseCapture = require('./base-capture');
const StreamService = require('../models/stream-service');
const logger = require('../lib/logger');

// How often to poll the Rumble Live API (ms)
const POLL_INTERVAL_MS = 3000;

// How many seen IDs to retain before trimming (prevents unbounded memory growth)
const MAX_SEEN_IDS = 500;
const TRIM_TO = 250;

class RumbleCapture extends BaseCapture {
  constructor(svc, manager) {
    super(svc, manager);
    this._pollTimer = null;
    this._stopping = false;
    this._primed = false;      // true after first poll — prevents re-emitting existing events
    this._seenChatIds = new Set();
    this._seenRantIds = new Set();
    this._seenFollowers = new Set();
  }

  async connect() {
    try {
      this.svc = await StreamService.getWithCredentials(this.svc.id);
    } catch (err) {
      this.emit('error', new Error(`Failed to load credentials: ${err.message}`));
      return;
    }

    // api_access_token holds the Rumble Live API URL (it is a secret endpoint URL)
    const apiUrl = this.svc.api_access_token;
    if (!apiUrl) {
      this.emit('error', Object.assign(
        new Error('No Rumble Live API URL configured — paste your API URL as the access token'),
        { code: 'NO_API_URL', permanent: true }
      ));
      return;
    }

    this._stopping = false;
    this._primed = false;
    this._seenChatIds = new Set();
    this._seenRantIds = new Set();
    this._seenFollowers = new Set();

    // Prime the seen-ID sets on the first poll (silently) so we don't re-emit
    // chat/followers that predate this connect.
    await this._poll(/* silent = */ true);

    if (this._stopping) return;

    this._connected = true;
    this.emit('connected');
    logger.info(`[rumble-capture:${this.svc.id}] connected — polling every ${POLL_INTERVAL_MS}ms`);

    this._schedulePoll();
  }

  async disconnect() {
    this._stopping = true;
    this._connected = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    this.emit('disconnected', { reason: 'intentional' });
  }

  _schedulePoll() {
    if (this._stopping) return;
    this._pollTimer = setTimeout(() => {
      this._poll(false).catch((err) => this.emit('error', err));
    }, POLL_INTERVAL_MS);
  }

  async _poll(silent = false) {
    if (this._stopping) return;

    const apiUrl = this.svc.api_access_token;
    let data;

    try {
      const res = await fetch(apiUrl);
      if (!res.ok) {
        if (!silent) this.emit('error', new Error(`Rumble API returned HTTP ${res.status}`));
        this._schedulePoll();
        return;
      }
      data = await res.json();
    } catch (err) {
      if (!silent) this.emit('error', err);
      this._schedulePoll();
      return;
    }

    this._processData(data, silent);
    this._schedulePoll();
  }

  _processData(data, silent) {
    const stream = data?.livestreams?.[0];

    if (stream) {
      this._processChatMessages(stream.chat ?? [], silent);
      this._processRants(stream.rants ?? [], silent);
    }

    this._processFollowers(data?.followers?.recent_followers ?? [], silent);
  }

  _processChatMessages(messages, silent) {
    for (const msg of messages) {
      const id = String(msg.id ?? msg.time ?? '');
      if (!id || this._seenChatIds.has(id)) continue;

      this._seenChatIds.add(id);
      this._trimSet(this._seenChatIds);

      if (silent) continue;

      this.emit('event', this.buildEvent(
        'chat.message',
        {
          platformId: String(msg.user_id ?? ''),
          username:    msg.username ?? '',
          displayName: msg.username ?? '',
        },
        { message: msg.text ?? msg.message ?? '' }
      ));
    }
  }

  _processRants(rants, silent) {
    for (const rant of rants) {
      const id = String(rant.id ?? '');
      if (!id || this._seenRantIds.has(id)) continue;

      this._seenRantIds.add(id);
      this._trimSet(this._seenRantIds);

      if (silent) continue;

      this.emit('event', this.buildEvent(
        'tip',
        {
          platformId: String(rant.user_id ?? ''),
          username:    rant.username ?? '',
          displayName: rant.username ?? '',
        },
        {
          amount:   rant.price_cents != null ? rant.price_cents / 100 : null,
          currency: 'USD',
          message:  rant.text ?? rant.message ?? '',
        }
      ));
    }
  }

  _processFollowers(followers, silent) {
    for (const follower of followers) {
      const username = follower?.username ?? follower;
      if (!username || this._seenFollowers.has(username)) continue;

      this._seenFollowers.add(username);
      this._trimSet(this._seenFollowers);

      if (silent) continue;

      this.emit('event', this.buildEvent(
        'follow',
        { platformId: '', username, displayName: username },
        {}
      ));
    }
  }

  _trimSet(set) {
    if (set.size > MAX_SEEN_IDS) {
      const arr = [...set];
      set.clear();
      for (const item of arr.slice(-TRIM_TO)) set.add(item);
    }
  }
}

module.exports = RumbleCapture;
