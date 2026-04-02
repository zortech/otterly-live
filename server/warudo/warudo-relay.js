const WebSocket = require('ws');
const settings = require('../settings');
const eventBus = require('../events/event-bus');
const logger = require('../lib/logger');

// Event types forwarded to Warudo; viewer_count, stream.*, and system.* are filtered out
const RELAY_TYPES = new Set([
  'chat.message',
  'follow',
  'subscribe',
  'subscribe.gift',
  'cheer',
  'tip',
  'like',
  'share',
  'raid',
]);

/**
 * Transform an OtteryEvent into the flat JSON object sent to Warudo.
 * Returns null for event types that aren't meaningful in Warudo blueprints.
 */
function transform(event) {
  if (!RELAY_TYPES.has(event.type)) return null;

  const msg = {
    type:        event.type,
    platform:    event.platform,
    timestamp:   event.timestamp,
    username:    event.actor?.username    ?? null,
    displayName: event.actor?.displayName ?? null,
    isSubscriber: event.actor?.isSubscriber ?? null,
    isModerator:  event.actor?.isModerator  ?? null,
  };

  switch (event.type) {
    case 'chat.message':
      msg.message = event.data.message ?? null;
      msg.color   = event.data.color   ?? null;
      break;
    case 'subscribe':
      msg.tier    = event.data.tier           ?? null;
      msg.months  = event.data.durationMonths ?? null;
      msg.message = event.data.message        ?? null;
      break;
    case 'subscribe.gift':
      msg.count = event.data.count ?? null;
      msg.tier  = event.data.tier  ?? null;
      break;
    case 'cheer':
      msg.bits    = event.data.bits    ?? null;
      msg.message = event.data.message ?? null;
      break;
    case 'tip':
      msg.amount   = event.data.amount   ?? null;
      msg.currency = event.data.currency ?? null;
      msg.message  = event.data.message  ?? null;
      break;
    case 'raid':
      msg.viewerCount = event.data.viewerCount ?? null;
      break;
    // 'follow', 'like', 'share' — actor fields are sufficient
  }

  return msg;
}

class WarudoRelay {
  constructor() {
    this._ws             = null;
    this._reconnectTimer = null;
    this._enabled        = false;
    this._host           = 'localhost';
    this._port           = 19190;
    this._eventListener  = null;
  }

  async start() {
    this._enabled = true;
    this._host    = (await settings.get('warudo.host')) ?? 'localhost';
    this._port    = (await settings.get('warudo.port')) ?? 19190;

    this._eventListener = (event) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
      const msg = transform(event);
      if (msg) this._ws.send(JSON.stringify(msg));
    };
    eventBus.on('event', this._eventListener);

    this._connect();
    logger.info(`[warudo] relay starting — targeting ws://${this._host}:${this._port}`);
  }

  stop() {
    this._enabled = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._eventListener) {
      eventBus.off('event', this._eventListener);
      this._eventListener = null;
    }
    if (this._ws) {
      this._ws.terminate();
      this._ws = null;
    }

    logger.info('[warudo] relay stopped');
  }

  _connect() {
    if (!this._enabled) return;

    const url = `ws://${this._host}:${this._port}`;

    try {
      this._ws = new WebSocket(url);

      this._ws.on('open', () => {
        logger.info(`[warudo] connected to ${url}`);
      });

      this._ws.on('close', () => {
        if (!this._enabled) return;
        logger.debug('[warudo] disconnected — reconnecting in 5s');
        this._ws = null;
        this._reconnectTimer = setTimeout(() => this._connect(), 5_000);
      });

      this._ws.on('error', (err) => {
        // ECONNREFUSED is expected when Warudo isn't open yet; suppress the noise
        if (err.code !== 'ECONNREFUSED') {
          logger.warn('[warudo] WebSocket error:', err.message);
        }
      });
    } catch (err) {
      logger.warn('[warudo] failed to create WebSocket:', err.message);
      this._reconnectTimer = setTimeout(() => this._connect(), 5_000);
    }
  }

  get connected() {
    return this._ws?.readyState === WebSocket.OPEN;
  }
}

module.exports = new WarudoRelay();
