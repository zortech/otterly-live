'use strict';

const { WebcastPushConnection } = require('tiktok-live-connector');
const BaseCapture = require('./base-capture');
const StreamService = require('../models/stream-service');
const logger = require('../lib/logger');

class TikTokCapture extends BaseCapture {
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

    const username = this.svc.username.startsWith('@')
      ? this.svc.username
      : `@${this.svc.username}`;

    this._intentionalDisconnect = false;

    logger.info(`[tiktok-capture:${this.svc.id}] connecting as ${username}`);
    this._connection = new WebcastPushConnection(username);

    // Wire ALL event handlers before calling connect()
    this._connection.on('connected', (state) => {
      this._connected = true;
      this.emit('connected');
      logger.info(`[tiktok-capture:${this.svc.id}] connected (roomId=${state?.roomId ?? 'unknown'})`);
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
      this.emit('event', this.buildEvent('tip', this._actor(d), {
        giftName: d.giftName ?? '',
        amount: (d.diamondCount ?? 0) * (d.repeatCount ?? 1),
        giftId: d.giftId ?? null,
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
      // Treat as "offline" (clean retry, no failure count) when:
      //   - error class name includes 'Offline'
      //   - message says offline/not online
      const msg = err?.message ?? '';
      const isOffline = err?.constructor?.name?.includes('Offline')
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
