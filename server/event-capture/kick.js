'use strict';

const WebSocket = require('ws');
const BaseCapture = require('./base-capture');
const StreamService = require('../models/stream-service');
const tokenManager = require('../auth/token-manager');
const logger = require('../lib/logger');

// Kick's Pusher app key (public — not a secret)
const PUSHER_APP_KEY = '32cbd69e4b950bf97679';
const PUSHER_WS_URL = `wss://ws-us2.pusher.com/app/${PUSHER_APP_KEY}?protocol=7&client=js&version=8.4.0-rc2&flash=false`;

const KICK_CHANNEL_API = 'https://api.kick.com/public/v1/channels';
const KICK_CHANNEL_FALLBACK = 'https://kick.com/api/v2/channels';

// Pusher sends a ping every ~30s; close if we don't hear anything for 90s
const PING_TIMEOUT_MS = 90 * 1000;

class KickCapture extends BaseCapture {
  constructor(svc, manager) {
    super(svc, manager);
    this._ws = null;
    this._intentionalDisconnect = false;
    this._pingTimer = null;
    this._chatroomChannel = null;
  }

  async connect() {
    // Reload fresh credentials in case tokens were refreshed since instantiation
    try {
      this.svc = await StreamService.getWithCredentials(this.svc.id);
    } catch (err) {
      this.emit('error', new Error(`Failed to load credentials: ${err.message}`));
      return;
    }

    if (!this.svc.username) {
      this.emit('error', Object.assign(new Error('No username set — configure your Kick channel username'), { code: 'NO_USERNAME' }));
      return;
    }

    // Resolve chatroom ID (stored in metadata after OAuth, or fetched on first connect)
    let chatroomId = this.svc.metadata?.chatroom_id;
    if (!chatroomId) {
      chatroomId = await this._fetchAndStoreChatroomId();
    }
    if (!chatroomId) {
      this.emit('error', Object.assign(new Error('Could not resolve Kick chatroom ID'), { code: 'NO_CHATROOM_ID' }));
      return;
    }

    this._chatroomChannel = `chatrooms.${chatroomId}.v2`;
    this._intentionalDisconnect = false;

    this._ws = new WebSocket(PUSHER_WS_URL);
    this._ws.on('open',    ()    => this._onOpen());
    this._ws.on('message', (raw) => this._onMessage(raw));
    this._ws.on('close',   (code, reason) => this._onClose(code, reason));
    this._ws.on('error',   (err) => this._onError(err));
  }

  async disconnect() {
    this._intentionalDisconnect = true;
    this._connected = false;
    this._clearPingTimer();
    if (this._ws) {
      const ws = this._ws;
      this._ws = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'intentional disconnect');
      }
    }
    this.emit('disconnected', { reason: 'intentional' });
  }

  _onOpen() {
    logger.debug(`[kick-capture:${this.svc.id}] WebSocket opened — waiting for connection_established`);
    this._resetPingTimer();
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      logger.warn(`[kick-capture:${this.svc.id}] received non-JSON message`);
      return;
    }

    this._resetPingTimer();

    const { event, data } = msg;

    switch (event) {
      case 'pusher:connection_established':
        this._onConnected();
        break;
      case 'pusher:ping':
        this._ws?.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        break;
      case 'pusher_internal:subscription_succeeded':
        logger.info(`[kick-capture:${this.svc.id}] subscribed to ${this._chatroomChannel}`);
        break;
      case 'pusher:error': {
        const errData = typeof data === 'string' ? JSON.parse(data) : data;
        logger.error(`[kick-capture:${this.svc.id}] Pusher error: ${errData?.message || JSON.stringify(errData)}`);
        this.emit('error', new Error(`Pusher error: ${errData?.message || 'unknown'}`));
        break;
      }
      default:
        this._handlePlatformEvent(event, data);
    }
  }

  _onConnected() {
    // Subscribe to the chatroom channel
    this._ws?.send(JSON.stringify({
      event: 'pusher:subscribe',
      data: { channel: this._chatroomChannel },
    }));

    this._connected = true;
    this.emit('connected');
    logger.info(`[kick-capture:${this.svc.id}] connected — subscribing to ${this._chatroomChannel}`);
  }

  _handlePlatformEvent(eventName, rawData) {
    let data;
    try {
      data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      logger.warn(`[kick-capture:${this.svc.id}] failed to parse event data for ${eventName}`);
      return;
    }

    const normalized = this._normalizeEvent(eventName, data);
    if (normalized) {
      this.emit('event', this.buildEvent(normalized.type, normalized.actor, normalized.data));
    }
  }

  _normalizeEvent(eventName, data) {
    switch (eventName) {
      case 'ChatMessage':
        return {
          type: 'chat.message',
          actor: {
            platformId: String(data.sender?.id ?? ''),
            username: data.sender?.slug ?? '',
            displayName: data.sender?.username ?? '',
            isSubscriber: data.sender?.identity?.badges?.some((b) => b.type === 'subscriber') ?? false,
            isModerator: data.sender?.identity?.badges?.some((b) => b.type === 'moderator') ?? false,
          },
          data: {
            message: data.content ?? '',
            color: data.sender?.identity?.color || null,
            badges: data.sender?.identity?.badges ?? [],
          },
        };

      case 'Subscription':
        return {
          type: 'subscribe',
          actor: { platformId: '', username: data.username ?? '', displayName: data.username ?? '' },
          data: { months: data.months ?? 1 },
        };

      case 'GiftedSubscriptions':
        return {
          type: 'subscribe.gift',
          actor: data.gifter_username
            ? { platformId: '', username: data.gifter_username, displayName: data.gifter_username }
            : null,
          data: {
            count: data.gifted_usernames?.length ?? 1,
            totalGifted: data.gifter_total ?? null,
          },
        };

      case 'StreamerIsLive':
        return {
          type: 'stream.start',
          actor: null,
          data: { title: data.livestream?.session_title ?? null },
        };

      case 'StreamEnd':
        return { type: 'stream.end', actor: null, data: {} };

      case 'ViewerCount':
        return {
          type: 'viewer_count',
          actor: null,
          data: { count: data.viewers ?? 0 },
        };

      // Silently discard noise events
      case 'MessageDeleted':
      case 'UserBanned':
      case 'UserUnBanned':
      case 'PollUpdate':
      case 'PollDelete':
      case 'LuckyUsersWhoGotGiftSubscriptions':
      case 'GiftsLeaderboardUpdated':
      case 'PinnedMessageCreated':
      case 'PinnedMessageDeleted':
      case 'ChatroomClear':
      case 'StreamHost':
      case 'ChatMoveToSupportedChannel':
        return null;

      default:
        logger.debug(`[kick-capture:${this.svc.id}] unhandled event: ${eventName}`);
        return null;
    }
  }

  _onClose(code, reason) {
    this._connected = false;
    this._clearPingTimer();
    if (!this._intentionalDisconnect) {
      const reasonStr = reason?.toString() || `ws_close_${code}`;
      logger.info(`[kick-capture:${this.svc.id}] WebSocket closed (code=${code}) — will reconnect`);
      this.emit('disconnected', { reason: reasonStr });
    }
  }

  _onError(err) {
    logger.error(`[kick-capture:${this.svc.id}] WebSocket error: ${err.message}`);
    this.emit('error', err);
  }

  _resetPingTimer() {
    this._clearPingTimer();
    this._pingTimer = setTimeout(() => {
      logger.warn(`[kick-capture:${this.svc.id}] ping timeout — closing connection`);
      this._ws?.close(1001, 'ping timeout');
    }, PING_TIMEOUT_MS);
  }

  _clearPingTimer() {
    if (this._pingTimer) {
      clearTimeout(this._pingTimer);
      this._pingTimer = null;
    }
  }

  /**
   * Fetch the chatroom ID from Kick's API and persist it to metadata.
   * Tries the official API first (needs OAuth token), falls back to unofficial.
   */
  async _fetchAndStoreChatroomId() {
    const username = this.svc.username;
    const token = this.svc.api_access_token;
    const slug = encodeURIComponent(username);

    // Official API (channel:read scope)
    if (token) {
      try {
        const res = await fetch(`${KICK_CHANNEL_API}?slug=${slug}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          const chatroomId = json?.data?.[0]?.chatroom?.id;
          if (chatroomId) {
            await this._persistChatroomId(chatroomId);
            return chatroomId;
          }
        } else if (res.status === 401 && token) {
          // Refresh and retry once
          try {
            await tokenManager.refreshNow(this.svc.id);
            this.svc = await StreamService.getWithCredentials(this.svc.id);
            const retry = await fetch(`${KICK_CHANNEL_API}?slug=${slug}`, {
              headers: { Authorization: `Bearer ${this.svc.api_access_token}` },
            });
            if (retry.ok) {
              const json = await retry.json();
              const chatroomId = json?.data?.[0]?.chatroom?.id;
              if (chatroomId) {
                await this._persistChatroomId(chatroomId);
                return chatroomId;
              }
            }
          } catch (refreshErr) {
            logger.warn(`[kick-capture:${this.svc.id}] token refresh during chatroom fetch failed: ${refreshErr.message}`);
          }
        }
      } catch (err) {
        logger.warn(`[kick-capture:${this.svc.id}] official chatroom API failed: ${err.message}`);
      }
    }

    // Fallback: unofficial API (no auth required)
    try {
      const res = await fetch(`${KICK_CHANNEL_FALLBACK}/${slug}`);
      if (res.ok) {
        const json = await res.json();
        const chatroomId = json?.chatroom?.id;
        if (chatroomId) {
          await this._persistChatroomId(chatroomId);
          return chatroomId;
        }
      }
    } catch (err) {
      logger.warn(`[kick-capture:${this.svc.id}] fallback chatroom API failed: ${err.message}`);
    }

    return null;
  }

  async _persistChatroomId(chatroomId) {
    try {
      const db = require('../db/knex');
      const row = await db('stream_services').where({ id: this.svc.id }).first();
      const meta = row.metadata ? JSON.parse(row.metadata) : {};
      await db('stream_services').where({ id: this.svc.id }).update({
        metadata: JSON.stringify({ ...meta, chatroom_id: chatroomId }),
        updated_at: new Date().toISOString(),
      });
      this.svc.metadata = { ...this.svc.metadata, chatroom_id: chatroomId };
      logger.debug(`[kick-capture:${this.svc.id}] chatroom ID ${chatroomId} stored to metadata`);
    } catch (err) {
      logger.warn(`[kick-capture:${this.svc.id}] failed to persist chatroom ID: ${err.message}`);
    }
  }
}

module.exports = KickCapture;
