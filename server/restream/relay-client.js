'use strict';

const https          = require('https');
const { Agent, fetch: undiciFetch } = require('undici');
const { io }         = require('socket.io-client');
const settings       = require('../settings');
const eventBus       = require('../events/event-bus');
const logger         = require('../lib/logger');

// Accept self-signed certs from the relay server.
// undici Agent is used for built-in fetch; https.Agent is used for socket.io.
const undiciAgent    = new Agent({ connect: { rejectUnauthorized: false } });
const httpsAgent     = new https.Agent({ rejectUnauthorized: false });

class RelayClient {
  constructor() {
    this._socket    = null;
    this._sessionId = null;
  }

  get sessionId() { return this._sessionId; }

  /**
   * Push platform configs to the relay and open a status socket.
   * Returns { sessionId, ingestToken, rtmpsPort }.
   * Throws if the relay is unreachable, rejects the token, or the URL is not HTTPS.
   */
  async startSession(platforms) {
    const [relayUrl, apiToken] = await Promise.all([
      settings.get('relay.url'),
      settings.get('relay.apiToken'),
    ]);

    if (!relayUrl.startsWith('https://')) {
      throw new Error('relay URL must use HTTPS — plain HTTP is not allowed');
    }

    const resp = await undiciFetch(`${relayUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ platforms }),
      dispatcher: undiciAgent,
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error ?? `relay returned ${resp.status}`);
    }

    const data = await resp.json();
    this._sessionId = data.sessionId;

    this.connectStatusSocket(data.sessionId, data.ingestToken, relayUrl, data.rtmpsPort);

    return data;
  }

  /**
   * Add a single platform to the active relay session.
   * No-op if no session is open.
   */
  async addPlatform(platform) {
    if (!this._sessionId) throw new Error('no active relay session');
    const [relayUrl, apiToken] = await Promise.all([
      settings.get('relay.url'),
      settings.get('relay.apiToken'),
    ]);

    const resp = await undiciFetch(`${relayUrl}/api/sessions/${this._sessionId}/platforms`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body:       JSON.stringify(platform),
      dispatcher: undiciAgent,
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error ?? `relay returned ${resp.status}`);
    }
  }

  /**
   * Remove a platform from the active relay session. Silent on transport
   * errors — caller has already decided the platform is stopped.
   */
  async removePlatform(serviceId) {
    if (!this._sessionId) return;
    const [relayUrl, apiToken] = await Promise.all([
      settings.get('relay.url'),
      settings.get('relay.apiToken'),
    ]);

    try {
      await undiciFetch(`${relayUrl}/api/sessions/${this._sessionId}/platforms/${serviceId}`, {
        method:     'DELETE',
        headers:    { 'Authorization': `Bearer ${apiToken}` },
        dispatcher: undiciAgent,
      });
    } catch (err) {
      logger.warn('[relay-client] removePlatform fetch failed:', err.message);
    }
  }

  /**
   * Gracefully end the session on the relay.
   */
  async endSession() {
    if (!this._sessionId) return;

    const [relayUrl, apiToken] = await Promise.all([
      settings.get('relay.url'),
      settings.get('relay.apiToken'),
    ]);

    try {
      await undiciFetch(`${relayUrl}/api/sessions/${this._sessionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${apiToken}` },
        dispatcher: undiciAgent,
      });
    } catch (err) {
      logger.warn('[relay-client] endSession fetch failed:', err.message);
    }

    this.disconnectStatusSocket();
    this._sessionId = null;
  }

  /**
   * Connect to the relay's Socket.io and bridge status events onto the local eventBus.
   * The local Angular UI receives these via the existing socket-bridge without changes.
   */
  connectStatusSocket(sessionId, ingestToken, relayUrl, _rtmpsPort) {
    this._socket = io(relayUrl, { transports: ['websocket'], agent: httpsAgent });

    this._socket.on('connect', () => {
      logger.info('[relay-client] socket connected');
      this._socket.emit('join', { sessionId, ingestToken });
    });

    this._socket.on('disconnect', (reason) => {
      logger.warn('[relay-client] socket disconnected:', reason);
    });

    // Bridge relay events to local eventBus — Angular sees them identically to local events
    this._socket.on('restream.started',  (d) => eventBus.emit('restream.started',  d));
    this._socket.on('restream.stopped',  (d) => eventBus.emit('restream.stopped',  d));
    this._socket.on('restream.error',    (d) => eventBus.emit('restream.error',    d));
    this._socket.on('restream.progress', (d) => eventBus.emit('restream.progress', d));
    this._socket.on('restream.warning',  (d) => eventBus.emit('restream.warning',  d));

    this._socket.on('relay.streamReceived', (d) => eventBus.emit('relay.streamReceived', d));

    // If the relay ends the session unexpectedly (e.g. relay restart), surface
    // a hard error. We never silently switch to local — see comment on
    // _teardownRelaySession in restream-manager.js.
    this._socket.on('session.ended', () => {
      logger.warn('[relay-client] relay ended session unexpectedly');
      eventBus.emit('relay.error', { reason: 'relay session ended unexpectedly' });
    });
  }

  disconnectStatusSocket() {
    this._socket?.disconnect();
    this._socket = null;
  }
}

module.exports = new RelayClient();
