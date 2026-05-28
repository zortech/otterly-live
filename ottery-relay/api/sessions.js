'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const db          = require('../db/knex');
const requireAuth = require('./middleware/require-auth');
const logger      = require('../lib/logger');

const router = Router();
router.use(requireAuth);

// Lazily required to avoid circular dep at load time
function getRelayRestreamManager() {
  return require('../restream/relay-restream-manager');
}

// ---- Validation helpers ------------------------------------------------

const VALID_PLATFORMS = [
  'twitch', 'youtube', 'kick', 'tiktok', 'x', 'joystick',
  'rumble', 'facebook', 'bilibili',
];

function validateRtmpUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['rtmp:', 'rtmps:'].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function validatePlatformConfig(p, index) {
  if (typeof p.serviceId !== 'number') return `platforms[${index}].serviceId must be a number`;
  if (!VALID_PLATFORMS.includes(p.platform)) return `platforms[${index}].platform is invalid`;
  if (!validateRtmpUrl(p.rtmpUrl)) return `platforms[${index}].rtmpUrl is not a valid RTMP/RTMPS URL`;
  // Printable ASCII only, 1–512 chars — stream keys must not contain whitespace
  if (!p.streamKey || !/^[\x21-\x7E]{1,512}$/.test(p.streamKey))
    return `platforms[${index}].streamKey is invalid`;
  return null;
}

// ---- Routes ------------------------------------------------------------

// POST /api/sessions
//
// Opens a relay session. `platforms` may be empty — that is allowed so the
// caller can open an ingest channel up-front and add platforms later via
// POST /api/sessions/:id/platforms. Empty sessions still occupy an ingest
// token and a slot in activeSessions, so users can't create unbounded
// stale sessions (one per user is normal during a stream).
router.post('/', async (req, res) => {
  const { platforms = [] } = req.body;

  if (!Array.isArray(platforms))
    return res.status(400).json({ error: 'platforms must be an array' });
  if (platforms.length > 10)
    return res.status(400).json({ error: 'too many platforms (max 10)' });

  for (let i = 0; i < platforms.length; i++) {
    const err = validatePlatformConfig(platforms[i], i);
    if (err) return res.status(400).json({ error: err });
  }

  try {
    const sessionId    = uuidv4();
    const ingestToken  = uuidv4();
    const rtmpsPort    = parseInt(process.env.RELAY_RTMPS_PORT ?? '1936', 10);

    await db('sessions').insert({
      session_id:   sessionId,
      ingest_token: ingestToken,
      user_id:      req.user.id,
      state:        'pending',
    });

    // Store platform configs (including stream keys) in memory ONLY — never in DB
    const { activeSessions } = getRelayRestreamManager();
    activeSessions.set(sessionId, {
      userId:       req.user.id,
      ingestToken,
      platforms,    // contains streamKey — lives here until endSession()
      processes:    new Map(),
      streamActive: false,
    });

    logger.info('[sessions] started', { userId: req.user.id, sessionId, platformCount: platforms.length });

    res.status(201).json({ sessionId, ingestToken, rtmpsPort });
  } catch (err) {
    logger.error('[sessions] POST error', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/sessions/:id/platforms — add one platform to an existing session
router.post('/:id/platforms', async (req, res) => {
  const { id } = req.params;
  const platform = req.body;
  const validationErr = validatePlatformConfig(platform, 0);
  if (validationErr) return res.status(400).json({ error: validationErr });

  try {
    const row = await db('sessions').where({ session_id: id }).first();
    if (!row) return res.status(404).json({ error: 'session_not_found' });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });

    const mgr = getRelayRestreamManager();
    try {
      mgr.addPlatform(id, platform);
    } catch (err) {
      if (err.message === 'platform_already_in_session') return res.status(409).json({ error: err.message });
      if (err.message === 'session_not_found') return res.status(404).json({ error: err.message });
      throw err;
    }

    logger.info('[sessions] platform added', { userId: req.user.id, sessionId: id, serviceId: platform.serviceId, platform: platform.platform });
    res.status(201).json({ added: true });
  } catch (err) {
    logger.error('[sessions] add platform error', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /api/sessions/:id/platforms/:serviceId
router.delete('/:id/platforms/:serviceId', async (req, res) => {
  const { id, serviceId } = req.params;
  const sid = parseInt(serviceId, 10);
  if (!Number.isFinite(sid)) return res.status(400).json({ error: 'invalid_serviceId' });

  try {
    const row = await db('sessions').where({ session_id: id }).first();
    if (!row) return res.status(404).json({ error: 'session_not_found' });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });

    const mgr = getRelayRestreamManager();
    try {
      mgr.removePlatform(id, sid);
    } catch (err) {
      if (err.message === 'platform_not_in_session') return res.status(404).json({ error: err.message });
      if (err.message === 'session_not_found') return res.status(404).json({ error: err.message });
      throw err;
    }

    logger.info('[sessions] platform removed', { userId: req.user.id, sessionId: id, serviceId: sid });
    res.status(204).end();
  } catch (err) {
    logger.error('[sessions] remove platform error', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /api/sessions/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await db('sessions').where({ session_id: id }).first();
    if (!row) return res.status(404).json({ error: 'session_not_found' });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });

    const mgr = getRelayRestreamManager();
    mgr.stopSession(id);
    mgr.activeSessions.delete(id);

    await db('sessions').where({ session_id: id })
      .update({ state: 'ended', ended_at: new Date().toISOString() });

    logger.info('[sessions] ended', { userId: req.user.id, sessionId: id });
    res.status(204).end();
  } catch (err) {
    logger.error('[sessions] DELETE error', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/sessions/:id/status
router.get('/:id/status', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await db('sessions').where({ session_id: id }).first();
    if (!row) return res.status(404).json({ error: 'session_not_found' });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });

    const mgr      = getRelayRestreamManager();
    const statuses = mgr.getStatus(id);
    res.json({ state: row.state, platforms: statuses });
  } catch (err) {
    logger.error('[sessions] GET status error', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
