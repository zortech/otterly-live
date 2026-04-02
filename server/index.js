const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db/knex');
const settings = require('./settings');
const logger = require('./lib/logger');
const eventBus = require('./events/event-bus');
const { attachSocketBridge } = require('./events/socket-bridge');
const rtmpManager = require('./rtmp/rtmp-manager');
const restreamManager = require('./restream/restream-manager');
const tokenManager = require('./auth/token-manager');
const eventCaptureManager = require('./event-capture/manager');
const creditEngine = require('./credits/credit-engine');
const musicManager = require('./music/music-manager');
const otteryNotifications = require('./ottery-notifications/notification-handler');
const warudoRelay = require('./warudo/warudo-relay');
const streamTap = require('./streamtap/streamtap-server');

const isDev = process.env.OTTERY_DEV === 'true';

let httpServer;
let io;

// In-memory session stats — reset on session.started, flushed every 30s + on session.ended
let sessionStats = { follows: 0, subs: 0, giftSubs: 0, cheers: 0, tips: 0, peakViewers: 0, raids: 0, chatMessages: 0 };
let liveViewerCounts = {}; // { [platform]: currentCount } — latest viewer_count per platform
let statsFlushTimer = null;

async function _flushStats(explicitSessionId) {
  const sessionId = explicitSessionId ?? rtmpManager.getActiveSessionId();
  if (!sessionId) return;
  try {
    await db('stream_sessions').where({ id: sessionId }).update({
      stats: JSON.stringify(sessionStats),
    });
  } catch (err) {
    logger.error('[stats] failed to flush session stats', err);
  }
}

function applyLogLevel(level) {
  logger.transports.file.level = level;
  logger.transports.console.level = level;
}

// Only these key prefixes may be written via PUT /api/settings.
// Credentials (credits.apiKey etc.) have dedicated endpoints with their own validation.
const ALLOWED_SETTING_PREFIXES = ['app.', 'warudo.', 'overlay.', 'rtmp.', 'music.', 'streamtap.', 'relay.'];
function isAllowedSettingKey(key) {
  return ALLOWED_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

async function startServer() {
  await db.migrate.latest();
  logger.info('Database migrations complete');

  // Apply the user's log level before anything else writes to the log
  const logLevel = await settings.get('app.logLevel');
  applyLogLevel(logLevel ?? 'info');
  logger.info(`Log level set to '${logLevel ?? 'info'}'`);

  // Start token manager before RTMP — ensures tokens are fresh before capture workers connect
  await tokenManager.start();
  logger.info('Token manager started');

  const port = await settings.get('server.port');

  const app = express();

  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self' ws://localhost:* wss://localhost:*; " +
      "img-src 'self' data: https:; " +
      "font-src 'self' data:;"
    );
    next();
  });

  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true, version: '0.1.0' }));

  const streamServicesRouter = require('./api/stream-services');
  app.use('/api/stream-services', streamServicesRouter);
  app.use('/api/event-capture', require('./api/event-capture'));
  app.use('/api/stream-sessions', require('./api/stream-sessions'));
  app.use('/api/credits', require('./api/credits'));
  app.use('/api', require('./api/music'));

  // Kick PKCE OAuth callback — must be before the SPA wildcard catch-all
  // IMPORTANT: redirect_uri registered with Kick MUST use 'localhost' not '127.0.0.1'
  app.get('/auth/kick/callback', streamServicesRouter.kickOAuthCallback);

  // Joystick.tv OAuth callback — uses 127.0.0.1 loopback (standard auth code flow)
  app.get('/auth/joystick/callback', streamServicesRouter.joystickOAuthCallback);

  // YouTube OAuth callback — Google requires http://localhost:{port} loopback redirect
  // (custom URI schemes are NOT accepted by Google OAuth for installed apps)
  app.get('/auth/youtube/callback', streamServicesRouter.youtubeOAuthCallback);

  // Spotify OAuth routes (auth/spotify, auth/spotify/callback live at root, not /api)
  app.use('/', require('./api/music'));

  app.get('/api/stream/status', (req, res) => {
    res.json({
      session: rtmpManager.getSessionState(),
      platforms: restreamManager.getStatus(),
      capture: eventCaptureManager.status(),
    });
  });

  app.post('/api/stream/start-all', async (req, res) => {
    if (rtmpManager.getSessionState() !== 'live') {
      return res.status(422).json({ error: 'No active stream session' });
    }
    try {
      const rows = await db('stream_services').where({ active: true, restream_enabled: true });
      const started = [];
      await Promise.all(
        rows.map(async (row) => {
          try {
            await restreamManager.toggle(row.id, true);
            started.push(row.id);
          } catch (err) {
            logger.warn(`[start-all] failed to start service ${row.id}: ${err.message}`);
          }
        })
      );
      res.json({ ok: true, started });
    } catch (err) {
      logger.error('POST /api/stream/start-all error', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/stream/stop-all', (req, res) => {
    try {
      restreamManager.stopAll();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/stream/stop-all error', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/stream/toggle', async (req, res) => {
    const { serviceId, enabled } = req.body;
    if (typeof serviceId !== 'number' || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'serviceId (number) and enabled (boolean) required' });
    }
    if (rtmpManager.getSessionState() !== 'live') {
      return res.status(422).json({ error: 'No active stream session' });
    }
    try {
      await restreamManager.toggle(serviceId, enabled);
      res.json({ ok: true, serviceId, status: restreamManager.getStatusForService(serviceId) });
    } catch (err) {
      logger.error('POST /api/stream/toggle error', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.get('/api/settings', async (req, res) => {
    try {
      res.json(await settings.getPublic());
    } catch (err) {
      logger.error('GET /api/settings error', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value required' });
    }
    if (!isAllowedSettingKey(key)) {
      return res.status(400).json({ error: `Setting key '${key}' cannot be modified via this endpoint` });
    }
    try {
      await settings.set(key, value);
      // Apply log level change immediately without requiring a restart
      if (key === 'app.logLevel') applyLogLevel(value);
      // Toggle Warudo relay immediately without restart
      if (key === 'warudo.enabled') {
        if (value) await warudoRelay.start();
        else warudoRelay.stop();
      }
      // Toggle StreamTap immediately; restart it when port or mDNS setting changes while enabled
      if (key === 'streamtap.enabled') {
        if (value) await streamTap.start();
        else streamTap.stop();
      }
      if ((key === 'streamtap.port' || key === 'streamtap.mdns') && await settings.get('streamtap.enabled')) {
        await streamTap.restart();
      }
      // Push overlay settings to all connected overlay clients
      if (key.startsWith('overlay.') && io) {
        const all = await settings.getAll();
        const overlaySettings = Object.fromEntries(
          Object.entries(all).filter(([k]) => k.startsWith('overlay.'))
        );
        io.emit('ottery:overlay-settings', overlaySettings);
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('PUT /api/settings error', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/settings/status', async (req, res) => {
    try {
      const [rtmpKey, streamtapToken, relayToken] = await Promise.all([
        settings.get('rtmp.incomingKey'),
        settings.get('streamtap.authToken'),
        settings.get('relay.apiToken'),
      ]);
      res.json({
        rtmpKeyConfigured:        Boolean(rtmpKey && rtmpKey !== ''),
        streamtapTokenConfigured: Boolean(streamtapToken && streamtapToken !== ''),
        relayTokenConfigured:     Boolean(relayToken && relayToken !== ''),
      });
    } catch (err) {
      logger.error('GET /api/settings/status error', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/relay/verify', async (req, res) => {
    try {
      const [relayUrl, apiToken] = await Promise.all([
        settings.get('relay.url'),
        settings.get('relay.apiToken'),
      ]);
      if (!relayUrl || !apiToken)
        return res.status(400).json({ error: 'relay.url and relay.apiToken must be configured' });
      const resp = await fetch(`${relayUrl}/api/me`,
        { headers: { Authorization: `Bearer ${apiToken}` } });
      if (!resp.ok)
        return res.status(resp.status).json({ error: 'Relay rejected the token' });
      const data = await resp.json();
      res.json({ ok: true, username: data.username });
    } catch (err) {
      logger.error('POST /api/relay/verify', err.message);
      res.status(500).json({ error: err.message ?? 'Could not reach relay server' });
    }
  });

  const overlaysDist = path.join(__dirname, '../dist/overlays');
  app.use('/overlays', express.static(overlaysDist));
  app.get('/overlays/*', (_req, res) => {
    res.sendFile(path.join(overlaysDist, 'index.html'));
  });

  const frontendDist = path.join(__dirname, '../dist/frontend');
  app.use(express.static(frontendDist));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  httpServer = http.createServer(app);

  io = new Server(httpServer, {
    cors: isDev
      ? { origin: 'http://localhost:4200', methods: ['GET', 'POST'] }
      : false,
  });

  io.on('connection', (socket) => {
    logger.info(`Socket.io client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      logger.info(`Socket.io client disconnected: ${socket.id}`);
    });
  });

  attachSocketBridge(io, eventBus,
    () => rtmpManager.getSessionState(),
    () => restreamManager.getStatus(),
    () => eventCaptureManager.status(),
    () => sessionStats,
    () => liveViewerCounts
  );

  // Persist events to SQLite (fire-and-forget, non-fatal)
  eventBus.on('event', async (e) => {
    try {
      await db('stream_events').insert({
        session_id:  e.sessionId ?? null,
        platform:    e.platform,
        event_type:  e.type,
        actor_json:  JSON.stringify(e.actor),
        data_json:   JSON.stringify(e.data),
        occurred_at: e.timestamp,
      });
    } catch (err) {
      logger.error('[events] failed to persist event', err);
    }
  });

  // Session stat aggregation — in-memory, flushed every 30s
  eventBus.on('session.started', () => {
    sessionStats = { follows: 0, subs: 0, giftSubs: 0, cheers: 0, tips: 0, peakViewers: 0, raids: 0, chatMessages: 0 };
    liveViewerCounts = {};
    if (statsFlushTimer) clearInterval(statsFlushTimer);
    statsFlushTimer = setInterval(() => _flushStats().catch(() => {}), 30 * 1000);
  });

  eventBus.on('session.ended', async ({ sessionId } = {}) => {
    if (statsFlushTimer) {
      clearInterval(statsFlushTimer);
      statsFlushTimer = null;
    }
    await _flushStats(sessionId).catch(() => {});
    sessionStats = { follows: 0, subs: 0, giftSubs: 0, cheers: 0, tips: 0, peakViewers: 0, raids: 0, chatMessages: 0 };
    liveViewerCounts = {};
  });

  eventBus.on('event', (e) => {
    let changed = false;
    if (e.type === 'follow')         { sessionStats.follows++;                                                           changed = true; }
    if (e.type === 'subscribe')      { sessionStats.subs++;                                                              changed = true; }
    if (e.type === 'subscribe.gift') { sessionStats.giftSubs += (e.data.count ?? 1);                                    changed = true; }
    if (e.type === 'cheer')          { sessionStats.cheers   += (e.data.bits ?? 0);                                     changed = true; }
    if (e.type === 'tip')            { sessionStats.tips     += (e.data.amount ?? 0);                                   changed = true; }
    if (e.type === 'raid')           { sessionStats.raids++;                                                             changed = true; }
    if (e.type === 'chat.message')   { sessionStats.chatMessages++;                                                      changed = true; }
    if (e.type === 'viewer_count') {
      liveViewerCounts[e.platform] = e.data.count ?? 0;
      const totalViewers = Object.values(liveViewerCounts).reduce((s, n) => s + n, 0);
      sessionStats.peakViewers = Math.max(sessionStats.peakViewers, totalViewers);
      if (io) io.emit('ottery:viewers', { ...liveViewerCounts });
      changed = true;
    }
    if (changed && io) io.emit('ottery:stats', { ...sessionStats });
  });

  await new Promise((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', (err) => {
      if (err) reject(err);
      else {
        logger.info(`Server listening on http://127.0.0.1:${port}`);
        resolve();
      }
    });
  });

  await rtmpManager.start();
  await creditEngine.start();
  await musicManager.start();
  otteryNotifications.start();

  if (await settings.get('warudo.enabled')) {
    await warudoRelay.start();
  }

  if (await settings.get('streamtap.enabled')) {
    await streamTap.start();
  }

  return { app, io, httpServer };
}

async function stopServer() {
  streamTap.stop();
  warudoRelay.stop();
  tokenManager.stop();
  otteryNotifications.stop();
  await creditEngine.stop();
  await eventCaptureManager.stopAll();
  await rtmpManager.stop();
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
    httpServer = null;
    io = null;
  }
}

function getIo() {
  return io;
}

module.exports = { startServer, stopServer, getIo };

// Self-start when run directly (npm run server / nodemon)
if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
