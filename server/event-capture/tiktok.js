'use strict';

const { WebcastPushConnection } = require('tiktok-live-connector');
const BaseCapture = require('./base-capture');
const StreamService = require('../models/stream-service');
const logger = require('../lib/logger');
const giftCache = require('./tiktok-gift-cache');

class TikTokCapture extends BaseCapture {
  // TikTok capture needs a live room to connect. When the user starts streaming, the
  // video takes a few seconds to propagate (relay → TikTok ingest → live), so an
  // immediate connect attempt hits "not live"/MissingRoomIdError. Wait ~5s on the
  // first attempt so the room is up before we try. Reconnects are not delayed.
  static initialConnectDelayMs = 5000;

  constructor(svc, manager) {
    super(svc, manager);
    this._connection = null;
    this._intentionalDisconnect = false;
  }

  async connect() {
    // Reload fresh credentials in case of race between instantiation and connect
    try {
      this.svc = await StreamService.getWithCredentials(this.svc.id);
    } catch (err) {
      this.emit('error', new Error(`Failed to load credentials: ${err.message}`));
      return;
    }

    if (!this.svc.username) {
      this.emit('error', Object.assign(new Error('No username set — enter your TikTok @username'), { code: 'NO_USERNAME' }));
      return;
    }

    // TikTok handles are always lowercase; the webcast API does a case-sensitive
    // exact-match lookup on the uniqueId, so a stored handle like "Sushii_Otter"
    // makes the API room-id source miss (InvalidResponseError) and leaves only the
    // flakier HTML/Euler fallbacks. Normalize to lowercase, sans leading '@'.
    const handle = this.svc.username.replace(/^@/, '').toLowerCase();
    const username = `@${handle}`;

    this._intentionalDisconnect = false;

    logger.info(`[tiktok-capture:${this.svc.id}] connecting as ${username}`);
    this._connection = new WebcastPushConnection(username, { enableExtendedGiftInfo: true });

    // Wire ALL event handlers before calling connect()
    this._connection.on('connected', (state) => {
      this._connected = true;
      this.emit('connected');
      logger.info(`[tiktok-capture:${this.svc.id}] connected (roomId=${state?.roomId ?? 'unknown'})`);
      const gifts = state?.availableGifts ?? this._connection?.availableGifts;
      if (Array.isArray(gifts) && gifts.length > 0) {
        giftCache.setAvailableGifts(gifts);
        logger.info(`[tiktok-capture:${this.svc.id}] cached ${gifts.length} gift definitions`);
      }
    });

    this._connection.on('disconnected', () => {
      this._connected = false;
      if (!this._intentionalDisconnect) {
        logger.info(`[tiktok-capture:${this.svc.id}] disconnected by platform`);
        this.emit('disconnected', { reason: 'ws_close' });
      }
    });

    // Note: do NOT emit error here — the error event fires AND connect() throws,
    // so we'd double-count failures. Let the catch block below handle it instead.
    this._connection.on('error', (err) => {
      const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      logger.error(`[tiktok-capture:${this.svc.id}] connection error: ${msg}`);
    });

    this._connection.on('chat', (d) => {
      // tiktok-live-connector provides emotes as [{ emoteId, emoteImageUrl, placeInComment }]
      const emotes = Array.isArray(d.emotes)
        ? d.emotes.map((e) => ({ id: String(e.emoteId ?? ''), imageUrl: e.emoteImageUrl ?? null, position: e.placeInComment ?? 0 }))
        : [];
      this.emit('event', this.buildEvent('chat.message', this._actor(d), { message: d.comment ?? '', emotes }));
    });

    this._connection.on('gift', (d) => {
      // TikTok streams intermediate gift events as user holds the button — only emit when done
      if (d.repeatEnd !== true) return;
      const cached = giftCache.get(d.giftId);
      this.emit('event', this.buildEvent('tip', this._actor(d), {
        giftName: d.giftName ?? cached?.name ?? '',
        amount: (d.diamondCount ?? cached?.diamondCount ?? 0) * (d.repeatCount ?? 1),
        giftId: d.giftId ?? null,
        giftIconUrl: cached?.iconUrl ?? null,
        repeatCount: d.repeatCount ?? 1,
      }));
    });

    this._connection.on('like', (d) => {
      this.emit('event', this.buildEvent('like', this._actor(d), { count: d.likeCount ?? 1 }));
    });

    this._connection.on('follow', (d) => {
      this.emit('event', this.buildEvent('follow', this._actor(d), {}));
    });

    this._connection.on('share', (d) => {
      this.emit('event', this.buildEvent('share', this._actor(d), {}));
    });

    this._connection.on('roomUser', (d) => {
      this.emit('event', this.buildEvent('viewer_count', null, { count: d.viewerCount ?? 0 }));
    });

    this._connection.on('subscribe', (d) => {
      this.emit('event', this.buildEvent('subscribe', this._actor(d), {}));
    });

    try {
      await this._connection.connect();
    } catch (err) {
      // Treat as "offline" (clean retry, no failure count) ONLY when the streamer
      // simply isn't live yet. tiktok-live-connector v2 surfaces that as a not-live
      // signal — UserOfflineError, or a FetchIsLiveError with an EMPTY message — so
      // message text alone isn't enough and we also match those class names. This
      // lets capture wait patiently for the stream to start.
      //
      // NOTE: MissingRoomIdError is deliberately NOT treated as offline. It means the
      // room id couldn't be resolved from ANY source (API/HTML/Euler) — i.e. a hard
      // failure such as an invalid/expired EulerStream signing key or all sources
      // exhausted, not "not live yet". A genuinely offline streamer throws
      // UserOfflineError. Routing MissingRoomIdError through the error path (below)
      // lets the manager back off and, after MAX_FAILURES, surface capture.error to
      // the UI — instead of silently retrying a broken config forever.
      const msg = err?.message ?? '';
      const errName = err?.constructor?.name ?? '';
      const OFFLINE_ERROR_CLASSES = ['UserOfflineError', 'FetchIsLiveError'];
      const isOffline = errName.includes('Offline')
        || OFFLINE_ERROR_CLASSES.includes(errName)
        || msg.toLowerCase().includes('offline')
        || msg.toLowerCase().includes('not online');

      if (isOffline) {
        logger.info(`[tiktok-capture:${this.svc.id}] streamer is not live — will retry when live`);
        this.emit('disconnected', { reason: 'user_offline' });
      } else {
        const wrapped = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
        this.emit('error', wrapped);
      }
    }
  }

  async disconnect() {
    this._intentionalDisconnect = true;
    this._connected = false;
    if (this._connection) {
      const conn = this._connection;
      this._connection = null;
      try { await conn.disconnect(); } catch {}
    }
    this.emit('disconnected', { reason: 'intentional' });
  }

  _actor(d) {
    return {
      platformId: String(d.userId ?? ''),
      username: d.uniqueId ?? '',
      displayName: d.nickname ?? '',
    };
  }
}

module.exports = TikTokCapture;
