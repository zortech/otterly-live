'use strict';

const WebSocket = require('ws');
const BaseCapture = require('./base-capture');
const StreamService = require('../models/stream-service');
const logger = require('../lib/logger');

const JOYSTICK_WS_URL = 'wss://joystick.tv/cable';
const GATEWAY_CHANNEL = JSON.stringify({ channel: 'GatewayChannel' });

// Action Cable pings every ~3s; close if silent for 15s
const PING_TIMEOUT_MS = 15 * 1000;

class JoystickCapture extends BaseCapture {
  constructor(svc, manager) {
    super(svc, manager);
    this._ws = null;
    this._intentionalDisconnect = false;
    this._pingTimer = null;
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
      this.emit('error', Object.assign(
        new Error('No access token — connect your Joystick.tv account first'),
        { code: 'NO_TOKEN' }
      ));
      return;
    }

    this._intentionalDisconnect = false;

    const url = `${JOYSTICK_WS_URL}?token=${encodeURIComponent(this.svc.api_access_token)}`;
    this._ws = new WebSocket(url);
    this._ws.on('open',    ()           => this._onOpen());
    this._ws.on('message', (raw)        => this._onMessage(raw));
    this._ws.on('close',   (code, buf)  => this._onClose(code, buf));
    this._ws.on('error',   (err)        => this._onError(err));
  }

  async disconnect() {
    this._intentionalDisconnect = true;
    this._connected = false;
    this._clearPingTimer();

    if (this._ws) {
      const ws = this._ws;
      this._ws = null;
      if (ws.readyState === WebSocket.OPEN) {
        // Send unsubscribe before closing
        try {
          ws.send(JSON.stringify({ command: 'unsubscribe', identifier: GATEWAY_CHANNEL }));
        } catch { /* ignore — we're closing anyway */ }
        ws.close(1000, 'intentional disconnect');
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'intentional disconnect');
      }
    }

    this.emit('disconnected', { reason: 'intentional' });
  }

  _onOpen() {
    logger.debug(`[joystick-capture:${this.svc.id}] WebSocket opened — waiting for welcome`);
    this._resetPingTimer();
    // Do NOT subscribe yet — wait for Action Cable 'welcome' first
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      logger.warn(`[joystick-capture:${this.svc.id}] received non-JSON message`);
      return;
    }

    this._resetPingTimer();

    // Action Cable protocol messages have a 'type' field
    if (msg.type) {
      switch (msg.type) {
        case 'welcome':
          this._onWelcome();
          break;
        case 'ping':
          // keepalive — msg.message is a unix timestamp, not channel data
          break;
        case 'confirm_subscription':
          this._onSubscribed();
          break;
        case 'reject_subscription':
          logger.warn(`[joystick-capture:${this.svc.id}] subscription rejected — token may be invalid`);
          this.emit('error', Object.assign(
            new Error('GatewayChannel subscription rejected — check OAuth token'),
            { code: 'SUBSCRIPTION_REJECTED' }
          ));
          break;
        case 'disconnect':
          logger.info(`[joystick-capture:${this.svc.id}] server requested disconnect`);
          this.emit('disconnected', { reason: 'server_disconnect' });
          break;
        default:
          logger.debug(`[joystick-capture:${this.svc.id}] unhandled protocol message type: ${msg.type}`);
      }
      return;
    }

    // Channel data messages have no 'type' at the top level — payload is in msg.message
    if (msg.message) {
      this._handleChannelMessage(msg.message);
    }
  }

  _onWelcome() {
    logger.debug(`[joystick-capture:${this.svc.id}] received welcome — subscribing to GatewayChannel`);
    this._ws?.send(JSON.stringify({
      command: 'subscribe',
      identifier: GATEWAY_CHANNEL,
    }));
  }

  _onSubscribed() {
    this._connected = true;
    this.emit('connected');
    logger.info(`[joystick-capture:${this.svc.id}] connected — subscribed to GatewayChannel`);
  }

  _handleChannelMessage(payload) {
    if (!payload || !payload.type) return;

    switch (payload.type) {
      case 'new_message': {
        const normalized = this._normalizeNewMessage(payload);
        if (normalized) {
          this.emit('event', this.buildEvent(normalized.type, normalized.actor, normalized.data));
        }
        break;
      }
      default:
        // Log unknown types at debug level for future discovery
        logger.debug(
          `[joystick-capture:${this.svc.id}] unknown event type: ${payload.type}`,
          JSON.stringify(payload)
        );
    }
  }

  _normalizeNewMessage(payload) {
    // Payload shape is not fully confirmed — use defensive fallbacks
    const user = payload.user ?? payload.sender ?? {};
    return {
      type: 'chat.message',
      actor: {
        platformId: String(user.id ?? user.user_id ?? ''),
        username:    user.username ?? user.slug ?? '',
        displayName: user.display_name ?? user.displayName ?? user.username ?? '',
      },
      data: {
        message: payload.message ?? payload.body ?? payload.content ?? '',
      },
    };
  }

  _onClose(code, buf) {
    this._connected = false;
    this._clearPingTimer();
    if (!this._intentionalDisconnect) {
      const reason = buf?.toString() || `ws_close_${code}`;
      if (code === 4001 || code === 4003) {
        logger.warn(`[joystick-capture:${this.svc.id}] auth failure (code=${code}) — needs re-auth`);
      } else {
        logger.info(`[joystick-capture:${this.svc.id}] WebSocket closed (code=${code}) — will reconnect`);
      }
      this.emit('disconnected', { reason });
    }
  }

  _onError(err) {
    logger.error(`[joystick-capture:${this.svc.id}] WebSocket error: ${err.message}`);
    this.emit('error', err);
  }

  _resetPingTimer() {
    this._clearPingTimer();
    this._pingTimer = setTimeout(() => {
      logger.warn(`[joystick-capture:${this.svc.id}] ping timeout — closing connection`);
      this._ws?.close(1001, 'ping timeout');
    }, PING_TIMEOUT_MS);
  }

  _clearPingTimer() {
    if (this._pingTimer) {
      clearTimeout(this._pingTimer);
      this._pingTimer = null;
    }
  }
}

module.exports = JoystickCapture;
