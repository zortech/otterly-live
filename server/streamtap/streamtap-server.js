const { WebSocketServer } = require('ws');
const settings = require('../settings');
const eventBus = require('../events/event-bus');
const logger = require('../lib/logger');

class StreamTapServer {
  constructor() {
    this.wss = null;
    this.pingInterval = null;
    this._eventListener = null;
    this._bonjour = null;
    this._mdnsService = null;
  }

  async start() {
    const port = await settings.get('streamtap.port');
    const token = await settings.get('streamtap.authToken');
    const mdns = await settings.get('streamtap.mdns');

    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => this._handleConnection(ws, token));

    this._eventListener = (event) => this._broadcast(JSON.stringify(event) + '\n');
    eventBus.on('event', this._eventListener);

    this.pingInterval = setInterval(() => {
      this._broadcast(JSON.stringify({ type: 'streamtap.ping' }) + '\n');
    }, 30_000);

    logger.info(`[streamtap] listening on ws://localhost:${port}`);

    if (mdns) this._startMdns(port);
  }

  stop() {
    this._stopMdns();
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this._eventListener) { eventBus.off('event', this._eventListener); this._eventListener = null; }
    if (this.wss) { this.wss.close(); this.wss = null; }
    logger.info('[streamtap] stopped');
  }

  async restart() {
    this.stop();
    await this.start();
  }

  _handleConnection(ws, requiredToken) {
    ws.isAuthenticated = !requiredToken;

    if (ws.isAuthenticated) {
      this._sendHello(ws);
    } else {
      ws._authTimer = setTimeout(() => {
        if (!ws.isAuthenticated) ws.close(4401, 'auth timeout');
      }, 5_000);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'streamtap.auth' && msg.token === requiredToken) {
            clearTimeout(ws._authTimer);
            ws.isAuthenticated = true;
            this._sendHello(ws);
          } else {
            ws.close(4401, 'invalid token');
          }
        } catch {
          ws.close(4400, 'bad message');
        }
      });
    }

    ws.on('error', (err) => logger.warn('[streamtap] client error:', err.message));
  }

  _sendHello(ws) {
    ws.send(JSON.stringify({ type: 'streamtap.hello', version: 1, authenticated: true }) + '\n');
  }

  _broadcast(data) {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.isAuthenticated && client.readyState === 1 /* OPEN */) {
        client.send(data);
      }
    }
  }

  _startMdns(port) {
    let Bonjour;
    try {
      Bonjour = require('bonjour-service').Bonjour;
    } catch {
      logger.warn('[streamtap] bonjour-service not available; mDNS advertisement disabled');
      return;
    }

    this._bonjour = new Bonjour();
    this._mdnsService = this._bonjour.publish({
      name: 'Ottery Live',
      type: 'streamtap',
      protocol: 'tcp',
      port,
    });

    logger.info(`[streamtap] advertised via mDNS as _streamtap._tcp on port ${port}`);
  }

  _stopMdns() {
    if (this._mdnsService) { try { this._mdnsService.stop(); } catch {} this._mdnsService = null; }
    if (this._bonjour) { try { this._bonjour.destroy(); } catch {} this._bonjour = null; }
  }
}

module.exports = new StreamTapServer();
