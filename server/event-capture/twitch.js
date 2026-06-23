'use strict';

const WebSocket = require('ws');
const BaseCapture = require('./base-capture');
const StreamService = require('../models/stream-service');
const tokenManager = require('../auth/token-manager');
const logger = require('../lib/logger');

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
const SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';
const SUBSCRIBE_WINDOW_MS = 9000; // 10s limit with 1s safety margin
const KEEPALIVE_TIMEOUT_MS = 40 * 1000; // 30s keepalive + 10s buffer

class TwitchCapture extends BaseCapture {
  constructor(svc, manager) {
    super(svc, manager);
    this._ws = null;
    this._sessionId = null;
    this._reconnecting = false;
    this._intentionalDisconnect = false;
    this._keepaliveTimer = null;
    this._subscribeTimer = null;
    this._targetChannelId = null;
  }

  async connect() {
    // Reload fresh credentials in case tokens were refreshed since instantiation
    try {
      this.svc = await StreamService.getWithCredentials(this.svc.id);
    } catch (err) {
      this.emit('error', new Error(`Failed to load credentials: ${err.message}`));
      return;
    }

    if (!this.svc.api_access_token) {
      this.emit('error', Object.assign(new Error('No access token'), { code: 'NO_TOKEN', permanent: true }));
      return;
    }
    if (!this.svc.api_client_id) {
      this.emit('error', Object.assign(new Error('No client ID'), { code: 'NO_CLIENT_ID', permanent: true }));
      return;
    }

    const channelId = this.svc.metadata?.channel_id;
    if (!channelId) {
      this.emit('error', Object.assign(new Error('No channel ID — complete OAuth flow first'), { code: 'NO_CHANNEL_ID', permanent: true }));
      return;
    }

    // Resolve target broadcaster: use configured target_channel if set, otherwise own channel
    const targetUsername = this.svc.metadata?.target_channel;
    if (targetUsername) {
      try {
        const res = await fetch(
          `https://api.twitch.tv/helix/users?login=${encodeURIComponent(targetUsername)}`,
          {
            headers: {
              'Authorization': `Bearer ${this.svc.api_access_token}`,
              'Client-Id': this.svc.api_client_id,
            },
          }
        );
        const data = await res.json();
        this._targetChannelId = data?.data?.[0]?.id ?? null;
        if (!this._targetChannelId) {
          this.emit('error', Object.assign(new Error(`Target channel '${targetUsername}' not found`), { code: 'TARGET_NOT_FOUND', permanent: true }));
          return;
        }
        logger.info(`[twitch-capture:${this.svc.id}] targeting channel ${targetUsername} (${this._targetChannelId})`);
      } catch (err) {
        this.emit('error', new Error(`Failed to resolve target channel: ${err.message}`));
        return;
      }
    } else {
      this._targetChannelId = channelId;
    }

    this._intentionalDisconnect = false;
    this._ws = new WebSocket(EVENTSUB_URL);
    this._ws.on('open',    ()        => this._onOpen());
    this._ws.on('message', (raw)     => this._onMessage(raw));
    this._ws.on('close',   (code, r) => this._onClose(code, r));
    this._ws.on('error',   (err)     => this._onError(err));
  }

  async disconnect() {
    this._intentionalDisconnect = true;
    this._connected = false;
    clearTimeout(this._keepaliveTimer);
    clearTimeout(this._subscribeTimer);
    this._keepaliveTimer = null;
    this._subscribeTimer = null;

    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      this._ws.close(1000, 'intentional disconnect');
    }
    this._ws = null;
    this.emit('disconnected', { reason: 'intentional' });
  }

  _onOpen() {
    logger.debug(`[twitch-capture:${this.svc.id}] WebSocket connected — waiting for session_welcome`);
    // Do NOT send any messages — EventSub will disconnect us if we do
  }

  async _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      logger.warn(`[twitch-capture:${this.svc.id}] received non-JSON message`);
      return;
    }

    const msgType = msg.metadata?.message_type;

    switch (msgType) {
      case 'session_welcome':
        await this._handleWelcome(msg).catch((err) => {
          logger.error(`[twitch-capture:${this.svc.id}] welcome handler error: ${err.message}`);
          this.emit('error', err);
        });
        break;
      case 'session_reconnect':
        await this._handleReconnect(msg).catch((err) => {
          logger.error(`[twitch-capture:${this.svc.id}] reconnect handler error: ${err.message}`);
        });
        break;
      case 'notification':
        this._handleNotification(msg);
        this._resetKeepalive();
        break;
      case 'session_keepalive':
        this._resetKeepalive();
        break;
      case 'revocation':
        await this._handleRevocation(msg).catch((err) =>
          logger.error(`[twitch-capture:${this.svc.id}] revocation handler error: ${err.message}`)
        );
        break;
      default:
        logger.debug(`[twitch-capture:${this.svc.id}] unhandled message type: ${msgType}`);
    }
  }

  async _handleWelcome(msg) {
    this._sessionId = msg.payload.session.id;

    // Set a 9-second safety timer — if subscriptions don't complete in time, emit error
    this._subscribeTimer = setTimeout(() => {
      logger.error(`[twitch-capture:${this.svc.id}] subscription window expired`);
      this.emit('error', new Error('EventSub subscription window expired'));
    }, SUBSCRIBE_WINDOW_MS);

    try {
      await this._registerSubscriptions(this._sessionId);
      clearTimeout(this._subscribeTimer);
      this._subscribeTimer = null;
      logger.info(`[twitch-capture:${this.svc.id}] subscriptions registered for session ${this._sessionId}`);
    } catch (err) {
      clearTimeout(this._subscribeTimer);
      this._subscribeTimer = null;
      throw err;
    }

    // Only report "connected" once the chat subscription is actually active. Emitting
    // it earlier (on session_welcome) made the dashboard show a live capture even when
    // the chat.message subscription was later rejected (e.g. missing OAuth scope),
    // leaving the unified event feed silently empty.
    this._connected = true;
    this.emit('connected');

    this._resetKeepalive();
  }

  async _registerSubscriptions(sessionId) {
    const ownChannelId = this.svc.metadata.channel_id;
    const broadcasterId = this._targetChannelId ?? ownChannelId;
    const watchingOwnChannel = broadcasterId === ownChannelId;

    const headers = {
      'Authorization': `Bearer ${this.svc.api_access_token}`,
      'Client-Id': this.svc.api_client_id,
      'Content-Type': 'application/json',
    };

    // chat.message always uses own user_id as the reader; broadcaster_user_id is the target channel
    const SUBSCRIPTIONS = [
      {
        type: 'channel.chat.message', version: '1',
        condition: { broadcaster_user_id: broadcasterId, user_id: ownChannelId },
      },
      // Events below only make sense on your own channel
      ...(watchingOwnChannel ? [
        {
          type: 'channel.follow', version: '2',
          condition: { broadcaster_user_id: broadcasterId, moderator_user_id: ownChannelId },
        },
        {
          type: 'channel.subscribe', version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        },
        {
          type: 'channel.subscription.gift', version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        },
        {
          type: 'channel.cheer', version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        },
        {
          type: 'channel.raid', version: '1',
          condition: { to_broadcaster_user_id: broadcasterId },
        },
        {
          type: 'channel.channel_points_custom_reward_redemption.add', version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        },
        {
          type: 'stream.online', version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        },
        {
          type: 'stream.offline', version: '1',
          condition: { broadcaster_user_id: broadcasterId },
        },
      ] : []),
    ];

    for (const sub of SUBSCRIPTIONS) {
      const body = JSON.stringify({
        type: sub.type,
        version: sub.version,
        condition: sub.condition,
        transport: { method: 'websocket', session_id: sessionId },
      });

      let res = await fetch(SUBSCRIPTIONS_URL, { method: 'POST', headers, body });

      if (res.status === 401) {
        // Token expired — refresh and retry once
        logger.info(`[twitch-capture:${this.svc.id}] 401 on subscription — refreshing token`);
        await tokenManager.refreshNow(this.svc.id);
        this.svc = await StreamService.getWithCredentials(this.svc.id);
        headers['Authorization'] = `Bearer ${this.svc.api_access_token}`;
        res = await fetch(SUBSCRIPTIONS_URL, { method: 'POST', headers, body });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data.message || res.status;
        const isAuthError =
          res.status === 401 ||
          res.status === 403 ||
          (data.message && data.message.toLowerCase().includes('authorization'));
        if (isAuthError) {
          // The saved token is missing a scope this subscription needs (commonly
          // user:read:chat, granted only on a fresh authorization). Flag it for
          // re-auth so the dashboard shows an actionable "reconnect" prompt rather
          // than a silent, eventless "connected" capture.
          throw Object.assign(
            new Error(
              `Twitch rejected the '${sub.type}' subscription (${detail}) — your saved ` +
              `login is missing a required permission. Reconnect your Twitch account to grant chat access.`
            ),
            { permanent: true, requiresReauth: true, code: 'MISSING_SCOPE' }
          );
        }
        throw new Error(`Failed to subscribe to ${sub.type}: ${detail}`);
      }
    }
  }

  _handleNotification(msg) {
    const subscriptionType = msg.metadata?.subscription_type;
    const event = msg.payload?.event;
    if (!subscriptionType || !event) return;

    const normalized = this._normalizeEvent(subscriptionType, event);
    if (normalized) {
      this.emit('event', this.buildEvent(normalized.type, normalized.actor, normalized.data));
    }
  }

  _normalizeEvent(subscriptionType, event) {
    switch (subscriptionType) {
      case 'channel.chat.message':
        return {
          type: 'chat.message',
          actor: {
            platformId: event.chatter_user_id,
            username: event.chatter_user_login,
            displayName: event.chatter_user_name,
            isSubscriber: event.badges?.some((b) => b.set_id === 'subscriber') ?? false,
            isModerator: event.badges?.some((b) => b.set_id === 'moderator') ?? false,
          },
          data: {
            message: event.message?.text ?? '',
            color: event.color || null,
            badges: event.badges ?? [],
            // Structured fragments preserve emote positions; type is 'text' | 'emote' | 'mention' | 'cheermote'
            fragments: event.message?.fragments?.map((f) => {
              if (f.type === 'emote') return { type: 'emote', text: f.text, emoteId: f.emote?.id ?? null };
              return { type: f.type ?? 'text', text: f.text };
            }) ?? null,
          },
        };

      case 'channel.follow':
        return {
          type: 'follow',
          actor: { platformId: event.user_id, username: event.user_login, displayName: event.user_name },
          data: {},
        };

      case 'channel.subscribe':
        return {
          type: 'subscribe',
          actor: { platformId: event.user_id, username: event.user_login, displayName: event.user_name },
          data: { tier: event.tier, isGift: event.is_gift },
        };

      case 'channel.subscription.gift':
        return {
          type: 'subscribe.gift',
          actor: event.is_anonymous
            ? null
            : { platformId: event.user_id, username: event.user_login, displayName: event.user_name },
          data: { count: event.total, tier: event.tier, totalGifted: event.cumulative_total ?? null },
        };

      case 'channel.cheer':
        return {
          type: 'cheer',
          actor: event.is_anonymous
            ? null
            : { platformId: event.user_id, username: event.user_login, displayName: event.user_name },
          data: { bits: event.bits, message: event.message || null },
        };

      case 'channel.raid':
        return {
          type: 'raid',
          actor: {
            platformId: event.from_broadcaster_user_id,
            username: event.from_broadcaster_user_login,
            displayName: event.from_broadcaster_user_name,
          },
          data: { viewers: event.viewers },
        };

      case 'channel.channel_points_custom_reward_redemption.add':
        return {
          type: 'redeem',
          actor: { platformId: event.user_id, username: event.user_login, displayName: event.user_name },
          data: {
            rewardTitle: event.reward?.title ?? 'Unknown reward',
            rewardCost: event.reward?.cost ?? 0,
            input: event.user_input || null,
          },
        };

      case 'stream.online':
        return { type: 'stream.start', actor: null, data: { title: event.title ?? null } };

      case 'stream.offline':
        return { type: 'stream.end', actor: null, data: {} };

      default:
        logger.debug(`[twitch-capture:${this.svc.id}] unhandled subscription type: ${subscriptionType}`);
        return null;
    }
  }

  async _handleReconnect(msg) {
    const reconnectUrl = msg.payload?.session?.reconnect_url;
    if (!reconnectUrl) return;

    logger.info(`[twitch-capture:${this.svc.id}] session_reconnect received — connecting to new URL`);
    this._reconnecting = true;
    const oldWs = this._ws;

    const newWs = new WebSocket(reconnectUrl);

    // Attach close/error handlers immediately so failures before the welcome are handled correctly
    newWs.on('close', (c, r) => {
      this._reconnecting = false;
      this._onClose(c, r);
    });
    newWs.on('error', (err) => {
      logger.error(`[twitch-capture:${this.svc.id}] reconnect WS error: ${err.message}`);
      this._reconnecting = false;
      // close event will follow the error and emit 'disconnected' to trigger manager reconnect
    });

    // Use once() so the welcome handler doesn't double-fire on subsequent messages
    newWs.once('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }

      if (m.metadata?.message_type === 'session_welcome') {
        this._sessionId = m.payload.session.id;
        try {
          await this._registerSubscriptions(this._sessionId);
        } catch (err) {
          logger.error(`[twitch-capture:${this.svc.id}] re-subscribe failed during reconnect: ${err.message}`);
        }
        this._ws = newWs;
        oldWs.close(1000, 'reconnect complete');
        this._reconnecting = false;
        newWs.on('message', (r) => this._onMessage(r));
        this._resetKeepalive();
        logger.info(`[twitch-capture:${this.svc.id}] reconnect complete`);
      }
    });
  }

  async _handleRevocation(msg) {
    const sub = msg.payload?.subscription;
    const status = sub?.status;
    logger.warn(`[twitch-capture:${this.svc.id}] subscription revoked: ${sub?.type} — ${status}`);

    if (status === 'authorization_revoked' || status === 'user_removed') {
      try {
        const db = require('../db/knex');
        await db('stream_services').where({ id: this.svc.id }).update({
          needs_reauth: true,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        logger.error(`[twitch-capture:${this.svc.id}] failed to set needs_reauth`, err);
      }
      const eventBus = require('../events/event-bus');
      eventBus.emit('auth.required', { serviceId: this.svc.id, platform: 'twitch' });
      await this.disconnect();
    }
  }

  _onClose(code, reason) {
    this._connected = false;
    clearTimeout(this._keepaliveTimer);
    this._keepaliveTimer = null;

    if (!this._reconnecting && !this._intentionalDisconnect) {
      const reasonStr = reason?.toString() || `ws_close_${code}`;
      logger.info(`[twitch-capture:${this.svc.id}] WebSocket closed (code=${code}) — will reconnect`);
      this.emit('disconnected', { reason: reasonStr });
    }
  }

  _onError(err) {
    logger.error(`[twitch-capture:${this.svc.id}] WebSocket error: ${err.message}`);
    this.emit('error', err);
  }

  _resetKeepalive() {
    clearTimeout(this._keepaliveTimer);
    this._keepaliveTimer = setTimeout(() => {
      logger.warn(`[twitch-capture:${this.svc.id}] keepalive timeout — closing connection`);
      this._ws?.close(1001, 'keepalive timeout');
      // _onClose will fire and emit 'disconnected', triggering manager reconnect
    }, KEEPALIVE_TIMEOUT_MS);
  }
}

module.exports = TwitchCapture;
