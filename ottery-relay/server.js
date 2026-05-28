'use strict';

require('dotenv').config();

const http   = require('http');
const https  = require('https');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const express    = require('express');
const helmet     = require('helmet');
const { Server } = require('socket.io');

const db              = require('./db/knex');
const logger          = require('./lib/logger');
const authRouter      = require('./api/auth');
const sessionsRouter  = require('./api/sessions');
const requireAuth     = require('./api/middleware/require-auth');
const rateLimiter     = require('./api/middleware/rate-limiter');
const rtmpManager     = require('./rtmp/rtmp-manager');
const { activeSessions } = require('./restream/relay-restream-manager');

let _io = null;
function getIo() { return _io; }

// ---- First-boot owner creation -----------------------------------------

async function maybeCreateOwner() {
  const { c } = await db('users').count('id as c').first();
  if (Number(c) > 0) return;

  const token = crypto.randomBytes(32).toString('hex');
  const hash  = await bcrypt.hash(token, 12);
  await db('users').insert({ username: 'owner', api_token_hash: hash, active: true });

  const dbPath  = path.resolve(process.env.RELAY_DB_PATH ?? './data/relay.db');
  const outPath = path.join(path.dirname(dbPath), 'initial-token.txt');
  try {
    fs.writeFileSync(outPath, token, 'utf8');
  } catch (err) {
    logger.warn('[boot] could not write initial-token.txt:', err.message);
  }

  const bar = '='.repeat(64);
  console.log([
    bar,
    '  FIRST BOOT — YOUR RELAY TOKEN',
    bar,
    '  Username : owner',
    '  Token    : ' + token,
    '',
    '  This token is shown ONCE. Copy it now.',
    '  Also saved to: ' + outPath,
    bar,
  ].join('\n'));
}

// ---- Self-signed cert generation ---------------------------------------
// Returns { key, cert } buffers if TLS is available, null otherwise.

function maybeGenerateCerts() {
  const keyPath  = process.env.RELAY_RTMPS_KEY_PATH;
  const certPath = process.env.RELAY_RTMPS_CERT_PATH;

  if (!keyPath || !certPath) return null;

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    logger.info('[certs] generating self-signed TLS certificate…');

    fs.mkdirSync(path.dirname(path.resolve(keyPath)),  { recursive: true });
    fs.mkdirSync(path.dirname(path.resolve(certPath)), { recursive: true });

    // spawnSync with an args array — no shell, no injection risk.
    // openssl is available on Alpine (apk add openssl), Debian, and macOS.
    const { spawnSync } = require('child_process');
    const result = spawnSync('openssl', [
      'req', '-x509',
      '-newkey', 'rsa:2048',
      '-keyout', keyPath,
      '-out',    certPath,
      '-days',   '3650',
      '-nodes',
      '-subj',   '/CN=ottery-relay',
    ], { stdio: 'pipe' });

    if (result.status !== 0) {
      const msg = (result.stderr?.toString() ?? '').trim() || 'openssl not found';
      logger.error(`[certs] cert generation failed — falling back to plain HTTP: ${msg}`);
      return null;
    }

    try { fs.chmodSync(keyPath, 0o600); } catch {}
    logger.info(`[certs] self-signed cert written → ${certPath}`);
  }

  return {
    key:  fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

// ---- Server bootstrap --------------------------------------------------

async function startServer() {
  await db.migrate.latest();
  logger.info('[server] migrations complete');

  await maybeCreateOwner();

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json());
  app.use(rateLimiter);

  // Routes
  app.use('/api/auth',     authRouter);
  app.use('/api/sessions', sessionsRouter);

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ username: req.user.username });
  });

  // Health check — no auth, for uptime monitors / docker healthcheck
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // 404 for unknown routes
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  const tls = maybeGenerateCerts();
  const httpServer = tls
    ? https.createServer({ key: tls.key, cert: tls.cert }, app)
    : http.createServer(app);

  if (tls) {
    logger.info('[server] TLS enabled — serving HTTPS');
  } else {
    logger.warn('[server] No TLS cert configured — serving plain HTTP (set RELAY_RTMPS_KEY_PATH and RELAY_RTMPS_CERT_PATH to enable HTTPS)');
  }

  _io = new Server(httpServer, { cors: false });

  _io.on('connection', (socket) => {
    // Client sends { sessionId, ingestToken } to join its session room
    socket.on('join', ({ sessionId, ingestToken } = {}) => {
      if (!sessionId || !ingestToken) return;
      const session = activeSessions.get(sessionId);
      if (!session || session.ingestToken !== ingestToken) {
        logger.warn('[ws] join rejected — invalid sessionId or ingestToken');
        return;
      }
      socket.join(sessionId);
      logger.info('[ws] client joined session', { sessionId });
    });
  });

  const port = parseInt(process.env.RELAY_PORT ?? '3800', 10);
  await new Promise((resolve) => httpServer.listen(port, resolve));
  logger.info(`[server] listening on port ${port}`);

  rtmpManager.start();

  return httpServer;
}

// ---- Graceful shutdown -------------------------------------------------

function shutdown(server) {
  logger.info('[server] shutting down');
  // Stop all active relay sessions cleanly
  const mgr = require('./restream/relay-restream-manager');
  for (const sessionId of activeSessions.keys()) {
    mgr.stopSession(sessionId);
  }
  rtmpManager.stop();
  server.close(() => {
    db.destroy().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000);
}

if (require.main === module) {
  startServer().then((server) => {
    process.on('SIGTERM', () => shutdown(server));
    process.on('SIGINT',  () => shutdown(server));
  }).catch((err) => {
    console.error('Failed to start relay server:', err);
    process.exit(1);
  });
}

module.exports = { startServer, getIo };
