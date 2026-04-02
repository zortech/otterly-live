'use strict';

const { io } = require('socket.io-client');
const settings = require('../settings');
const eventBus = require('../events/event-bus');
const logger   = require('../lib/logger');

class RelayClient {
  constructor() {
    this._socket    = null;
    this._sessionId = null;
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

    if (!relayUrl.startsWith('https://')) {
      throw new Error('relay URL must use HTTPS — plain HTTP is not allowed');
    }

    const resp = await fetch(`${relayUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ platforms }),
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
   * Gracefully end the session on the relay.
   */
  async endSession() {
    if (!this._sessionId) return;

    const [relayUrl, apiToken] = await Promise.all([
      settings.get('relay.url'),
      settings.get('relay.apiToken'),
    ]);

    try {
      await fetch(`${relayUrl}/api/sessions/${this._sessionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${apiToken}` },
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
    this._socket = io(relayUrl, { transports: ['websocket'] });

    this._socket.on('connect', () => {
      logger.info('[relay-client] socket connected');
      this._socket.emit('join', { sessionId, ingestToken });
    });

    this._socket.on('disconnect', (reason) => {
      logger.warn('[relay-client] socket disconnected:', reason);
    });

    // Bridge relay events to local eventBus — Angular sees them identically to local events
    this._socket.on('restream.started', (d) => eventBus.emit('restream.started', d));
    this._socket.on('restream.stopped', (d) => eventBus.emit('restream.stopped', d));
    this._socket.on('restream.error',   (d) => eventBus.emit('restream.error',   d));

    this._socket.on('relay.streamReceived', (d) => eventBus.emit('relay.streamReceived', d));

    // If the relay ends the session unexpectedly (e.g. relay restart), trigger local fallback
    this._socket.on('session.ended', () => {
      logger.warn('[relay-client] relay ended session unexpectedly');
      eventBus.emit('relay.fallback', { reason: 'relay session ended unexpectedly' });
    });
  }

  disconnectStatusSocket() {
    this._socket?.disconnect();
    this._socket = null;
  }
}

module.exports = new RelayClient();
