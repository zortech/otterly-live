'use strict';

const https          = require('https');
const { Agent, fetch: undiciFetch } = require('undici');
const { io }         = require('socket.io-client');
const settings       = require('../settings');
const eventBus       = require('../events/event-bus');
const logger         = require('../lib/logger');

// All relay HTTP calls get a hard timeout so an unreachable or hung relay
// can't block stream start/stop indefinitely (fetch has no default timeout).
const REQUEST_TIMEOUT_MS = 15_000;

class RelayClient {
  constructor() {
    this._socket      = null;
    this._sessionId   = null;
    // TLS agents are built lazily from settings so we can verify by default
    // and only relax/pin for self-signed relays when the user opts in.
    this._undiciAgent = null;
    this._httpsAgent  = null;
  }

  get sessionId() { return this._sessionId; }

  /**
   * Build (and cache) the TLS agents used for relay HTTP + socket connections.
   *
   * Default behaviour is full TLS verification against the system trust store.
   * For self-signed relays the user can either:
   *   - relay.caCert: pin the relay's certificate (PEM) — verification still
   *     happens, just against this CA. Strongly preferred.
   *   - relay.allowSelfSigned: an explicit, logged escape hatch that disables
   *     verification entirely (vulnerable to MITM — last resort only).
   */
  async _ensureAgents() {
    if (this._undiciAgent && this._httpsAgent) return;

    const [caCert, allowSelfSigned] = await Promise.all([
      settings.get('relay.caCert'),
      settings.get('relay.allowSelfSigned'),
    ]);

    const tls = {};
    if (caCert) tls.ca = caCert;
    if (allowSelfSigned) {
      tls.rejectUnauthorized = false;
      logger.warn('[relay-client] TLS verification DISABLED (relay.allowSelfSigned) — connection is vulnerable to MITM; prefer relay.caCert');
    }

    this._undiciAgent = new Agent({ connect: tls });
    this._httpsAgent  = new https.Agent(tls);
  }

  /** Drop cached agents so a settings change is picked up on the next session. */
  _resetAgents() {
    this._undiciAgent = null;
    this._httpsAgent  = null;
  }

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

    if (!relayUrl || !relayUrl.startsWith('https://')) {
      throw new Error('relay URL must be configured and use HTTPS — plain HTTP is not allowed');
    }

    // Fresh session: rebuild agents so any TLS-setting change takes effect.
    this._resetAgents();
    await this._ensureAgents();

    const resp = await undiciFetch(`${relayUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ platforms }),
      dispatcher: this._undiciAgent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

    await this._ensureAgents();
    const resp = await undiciFetch(`${relayUrl}/api/sessions/${this._sessionId}/platforms`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body:       JSON.stringify(platform),
      dispatcher: this._undiciAgent,
      signal:     AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      await this._ensureAgents();
      await undiciFetch(`${relayUrl}/api/sessions/${this._sessionId}/platforms/${serviceId}`, {
        method:     'DELETE',
        headers:    { 'Authorization': `Bearer ${apiToken}` },
        dispatcher: this._undiciAgent,
        signal:     AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      await this._ensureAgents();
      await undiciFetch(`${relayUrl}/api/sessions/${this._sessionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${apiToken}` },
        dispatcher: this._undiciAgent,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      logger.warn('[relay-client] endSession fetch failed:', err.message);
    }

    this.disconnectStatusSocket();
    this._resetAgents();
    this._sessionId = null;
  }

  /**
   * Connect to the relay's Socket.io and bridge status events onto the local eventBus.
   * The local Angular UI receives these via the existing socket-bridge without changes.
   */
  connectStatusSocket(sessionId, ingestToken, relayUrl, _rtmpsPort) {
    // Drop any prior socket so reopening a session can't leave a second
    // socket alive double-bridging every relay event onto the local bus.
    this.disconnectStatusSocket();
    this._socket = io(relayUrl, { transports: ['websocket'], agent: this._httpsAgent });

    this._socket.on('connect', () => {
      logger.info('[relay-client] socket connected');
      this._socket.emit('join', { sessionId, ingestToken });
    });

    this._socket.on('disconnect', (reason) => {
      logger.warn('[relay-client] socket disconnected:', reason);
    });

    // Bridge relay events to local eventBus — Angular sees them identically to local events
    this._socket.on('restream.started',      (d) => eventBus.emit('restream.started',      d));
    this._socket.on('restream.stopped',      (d) => eventBus.emit('restream.stopped',      d));
    this._socket.on('restream.error',        (d) => eventBus.emit('restream.error',        d));
    this._socket.on('restream.reconnecting', (d) => eventBus.emit('restream.reconnecting', d));
    this._socket.on('restream.progress',     (d) => eventBus.emit('restream.progress',     d));
    this._socket.on('restream.warning',      (d) => eventBus.emit('restream.warning',      d));

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
