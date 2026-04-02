const { Router } = require('express');
const db = require('../db/knex');
const StreamService = require('../models/stream-service');
const { getDefaults, getAllPlatforms } = require('../lib/platform-registry');
const logger = require('../lib/logger');

// In-memory store for pending PKCE flows: state → { serviceId, codeVerifier, clientId, timer }
const _kickPendingFlows = new Map();

// In-memory store for pending Joystick OAuth flows: state → { serviceId, clientId, clientSecret, serverPort, timer }
const _joystickPendingFlows = new Map();

// In-memory store for pending YouTube PKCE flows: state → { serviceId, codeVerifier, clientId, clientSecret, serverPort, timer }
const _youtubePendingFlows = new Map();

const router = Router();

const VALID_PLATFORMS = new Set(['twitch', 'youtube', 'kick', 'tiktok', 'x', 'joystick', 'rumble', 'facebook', 'bilibili']);

const CREDENTIAL_FIELDS = [
  'stream_key',
  'api_client_id',
  'api_client_secret',
  'api_access_token',
  'api_refresh_token',
];

function validateRtmpUrl(url) {
  if (!url || url === '') return true; // empty valid for X/Joystick
  try {
    const parsed = new URL(url);
    if (!['rtmp:', 'rtmps:'].includes(parsed.protocol)) return false;
    if (!parsed.hostname) return false;
    return true;
  } catch {
    return false;
  }
}

// GET /api/stream-services/platforms — list available platform types
router.get('/platforms', (req, res) => {
  res.json(getAllPlatforms());
});

// GET /api/stream-services
router.get('/', async (req, res) => {
  try {
    const rows = await db('stream_services').orderBy('created_at', 'asc');
    const services = await Promise.all(rows.map((r) => StreamService.serialize(r)));
    res.json(services);
  } catch (err) {
    logger.error('GET /api/stream-services error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/stream-services
router.post('/', async (req, res) => {
  try {
    const { platform, display_name, rtmp_url, username, restream_enabled,
            event_capture_enabled, auto_start, active, metadata,
            stream_key, api_client_id, api_client_secret } = req.body;

    if (!platform || !VALID_PLATFORMS.has(platform)) {
      return res.status(422).json({ error: 'Invalid platform' });
    }
    if (!display_name || !display_name.trim()) {
      return res.status(422).json({ error: 'display_name is required' });
    }

    const defaults = getDefaults(platform);
    const finalRtmpUrl = rtmp_url ?? defaults?.rtmp_url ?? '';

    if (!validateRtmpUrl(finalRtmpUrl)) {
      return res.status(422).json({ error: 'Invalid RTMP URL — must use rtmp:// or rtmps://' });
    }

    const [id] = await db('stream_services').insert({
      platform,
      display_name: display_name.trim(),
      rtmp_url: finalRtmpUrl,
      username: username || null,
      restream_enabled: restream_enabled ?? true,
      event_capture_enabled: event_capture_enabled ?? (defaults?.event_capture_supported ?? true),
      auto_start: auto_start ?? true,
      active: active ?? true,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    // Store credentials in keychain
    if (stream_key) await StreamService.setCredential(id, 'stream_key', stream_key);
    if (api_client_id) await StreamService.setCredential(id, 'api_client_id', api_client_id);
    if (api_client_secret) await StreamService.setCredential(id, 'api_client_secret', api_client_secret);

    const svc = await db('stream_services').where({ id }).first();
    const serialized = await StreamService.serialize(svc);

    // Notify frontend
    const { getIo } = require('../index');
    getIo()?.emit('stream-services:updated', { action: 'created', service: serialized });

    res.status(201).json(serialized);
  } catch (err) {
    logger.error('POST /api/stream-services error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stream-services/:id
router.get('/:id', async (req, res) => {
  try {
    const svc = await db('stream_services').where({ id: req.params.id }).first();
    if (!svc) return res.status(404).json({ error: 'Not found' });
    res.json(await StreamService.serialize(svc));
  } catch (err) {
    logger.error('GET /api/stream-services/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/stream-services/:id
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('stream_services').where({ id }).first();
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { display_name, rtmp_url, username, restream_enabled,
            event_capture_enabled, auto_start, active, metadata,
            stream_key, api_client_id, api_client_secret } = req.body;

    if (rtmp_url !== undefined && !validateRtmpUrl(rtmp_url)) {
      return res.status(422).json({ error: 'Invalid RTMP URL — must use rtmp:// or rtmps://' });
    }

    const update = {};
    if (display_name !== undefined) update.display_name = display_name.trim();
    if (rtmp_url !== undefined) update.rtmp_url = rtmp_url;
    if (username !== undefined) update.username = username || null;
    if (restream_enabled !== undefined) update.restream_enabled = restream_enabled;
    if (event_capture_enabled !== undefined) update.event_capture_enabled = event_capture_enabled;
    if (auto_start !== undefined) update.auto_start = auto_start;
    if (active !== undefined) update.active = active;
    if (metadata !== undefined) update.metadata = metadata ? JSON.stringify(metadata) : null;

    // TikTok: stamp stream_key_last_updated_at server-side when stream key is saved
    if (req.body.stream_key !== undefined && req.body.stream_key !== '' && existing.platform === 'tiktok') {
      const baseMeta = update.metadata
        ? JSON.parse(update.metadata)
        : (existing.metadata ? JSON.parse(existing.metadata) : {});
      update.metadata = JSON.stringify({ ...baseMeta, stream_key_last_updated_at: new Date().toISOString() });
    }

    if (Object.keys(update).length > 0) {
      update.updated_at = new Date().toISOString();
      await db('stream_services').where({ id }).update(update);
    }

    // Update credentials if provided (empty string = clear)
    for (const field of ['stream_key', 'api_client_id', 'api_client_secret']) {
      if (req.body[field] !== undefined) {
        await StreamService.setCredential(id, field, req.body[field]);
      }
    }

    const svc = await db('stream_services').where({ id }).first();
    const serialized = await StreamService.serialize(svc);

    const { getIo } = require('../index');
    getIo()?.emit('stream-services:updated', { action: 'updated', service: serialized });

    res.json(serialized);
  } catch (err) {
    logger.error('PUT /api/stream-services/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/stream-services/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db('stream_services').where({ id }).first();
    if (!existing) return res.status(404).json({ error: 'Not found' });

    // Block delete during active session
    const activeSession = await db('stream_sessions')
      .whereNull('ended_at')
      .first();
    if (activeSession) {
      return res.status(422).json({ error: 'Cannot delete a platform while a stream session is active' });
    }

    await StreamService.deleteCredentials(id);
    await db('stream_services').where({ id }).delete();

    const { getIo } = require('../index');
    getIo()?.emit('stream-services:updated', { action: 'deleted', serviceId: id });

    res.json({ ok: true });
  } catch (err) {
    logger.error('DELETE /api/stream-services/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/stream-services/:id/test-rtmp — stub for Phase 5
router.post('/:id/test-rtmp', async (req, res) => {
  res.status(501).json({ error: 'RTMP test not yet implemented (Phase 5)' });
});

// POST /api/stream-services/:id/test-capture
router.post('/:id/test-capture', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const svc = await StreamService.getWithCredentials(id);
    if (!svc) return res.status(404).json({ error: 'Not found' });
    if (!svc.event_capture_enabled) {
      return res.status(422).json({ error: 'Event capture not enabled for this service' });
    }
    if (svc.platform !== 'twitch' && svc.platform !== 'joystick') {
      return res.status(501).json({ error: 'Capture test not yet implemented for this platform' });
    }

    const CaptureClass = svc.platform === 'joystick'
      ? require('../event-capture/joystick')
      : require('../event-capture/twitch');

    // Temporary manager shim — not tracked by EventCaptureManager
    const tempManager = {
      buildEvent: (platform, type, actor, data) => ({
        id: 'test', sessionId: null, platform, type, actor, data,
        timestamp: new Date().toISOString(),
      }),
      activeSessionId: null,
    };
    const capture = new CaptureClass(svc, tempManager);

    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        capture.disconnect();
        resolve({ connected: false, reason: 'timeout' });
      }, 10000);

      capture.on('connected', () => {
        clearTimeout(timeout);
        capture.disconnect();
        resolve({ connected: true });
      });
      capture.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ connected: false, reason: err.message || err.code });
      });

      capture.connect().catch((err) => {
        clearTimeout(timeout);
        resolve({ connected: false, reason: err.message });
      });
    });

    res.json(result);
  } catch (err) {
    logger.error('POST /api/stream-services/:id/test-capture error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/stream-services/:id/oauth/start
router.post('/:id/oauth/start', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const svc = await StreamService.getWithCredentials(id);
    if (!svc) return res.status(404).json({ error: 'Not found' });

    if (svc.platform !== 'twitch') {
      return res.status(501).json({ error: 'OAuth not yet implemented for this platform' });
    }

    const clientId = svc.api_client_id;
    if (!clientId) {
      return res.status(422).json({ error: 'Client ID not configured. Save a Twitch Client ID first.' });
    }

    const { startOAuthFlow } = require('../auth/platforms/twitch-token');
    const dcfData = await startOAuthFlow({ api_client_id: clientId });

    // Start background polling — notify frontend via Socket.io when done
    _pollTwitchOAuth(id, dcfData, clientId).catch((err) => {
      logger.error(`[oauth] Twitch DCF polling failed for service ${id}: ${err.message}`);
      const { getIo } = require('../index');
      getIo()?.emit('ottery:oauth', { event: 'oauth.failed', serviceId: id, reason: err.message });
    });

    res.json({
      mechanism: 'device_code',
      user_code: dcfData.user_code,
      verification_uri: dcfData.verification_uri,
      expires_in: dcfData.expires_in,
    });
  } catch (err) {
    logger.error('POST /api/stream-services/:id/oauth/start error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/stream-services/:id/oauth/kick/start
router.post('/:id/oauth/kick/start', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const svc = await StreamService.getWithCredentials(id);
    if (!svc) return res.status(404).json({ error: 'Not found' });

    if (svc.platform !== 'kick') {
      return res.status(422).json({ error: 'This endpoint is for Kick only' });
    }

    const clientId = svc.api_client_id;
    if (!clientId) {
      return res.status(422).json({ error: 'Client ID not configured. Add your Kick app Client ID first.' });
    }

    const settings = require('../settings');
    const serverPort = await settings.get('server.port');

    const { startPkceFlow } = require('../auth/platforms/kick-token');
    const { authUrl, codeVerifier, state } = startPkceFlow({ clientId, serverPort });

    // Store the pending flow with a 10-minute cleanup timer
    const timer = setTimeout(() => {
      _kickPendingFlows.delete(state);
      logger.debug(`[kick-oauth] pending flow expired for serviceId=${id}`);
    }, 10 * 60 * 1000);

    _kickPendingFlows.set(state, { serviceId: id, codeVerifier, clientId, serverPort, timer });

    res.json({ mechanism: 'pkce', auth_url: authUrl, state });
  } catch (err) {
    logger.error('POST /api/stream-services/:id/oauth/kick/start error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/stream-services/:id/oauth/joystick/start
router.post('/:id/oauth/joystick/start', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const svc = await StreamService.getWithCredentials(id);
    if (!svc) return res.status(404).json({ error: 'Not found' });

    if (svc.platform !== 'joystick') {
      return res.status(422).json({ error: 'This endpoint is for Joystick.tv only' });
    }

    const clientId = svc.api_client_id;
    if (!clientId) {
      return res.status(422).json({ error: 'Client ID not configured. Add your Joystick.tv Client ID first.' });
    }

    const clientSecret = svc.api_client_secret;
    if (!clientSecret) {
      return res.status(422).json({ error: 'Client Secret not configured. Add your Joystick.tv Client Secret first.' });
    }

    const settings = require('../settings');
    const serverPort = await settings.get('server.port');

    const { startAuthFlow } = require('../auth/platforms/joystick-token');
    const { authUrl, state } = startAuthFlow({ clientId, serverPort });

    // Store the pending flow with a 10-minute cleanup timer
    const timer = setTimeout(() => {
      _joystickPendingFlows.delete(state);
      logger.debug(`[joystick-oauth] pending flow expired for serviceId=${id}`);
    }, 10 * 60 * 1000);

    _joystickPendingFlows.set(state, { serviceId: id, clientId, clientSecret, serverPort, timer });

    res.json({ mechanism: 'loopback', auth_url: authUrl, state });
  } catch (err) {
    logger.error('POST /api/stream-services/:id/oauth/joystick/start error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

async function _completeJoystickOAuth(serviceId, code, clientId, clientSecret, serverPort) {
  const { exchangeCode } = require('../auth/platforms/joystick-token');
  const tokenManager = require('../auth/token-manager');

  const tokens = await exchangeCode({ code, clientId, clientSecret, serverPort });

  await StreamService.setCredential(serviceId, 'api_access_token', tokens.access_token);
  if (tokens.refresh_token) {
    await StreamService.setCredential(serviceId, 'api_refresh_token', tokens.refresh_token);
  }

  await db('stream_services').where({ id: serviceId }).update({
    api_token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    needs_reauth: false,
    updated_at: new Date().toISOString(),
  });

  const updatedRow = await db('stream_services').where({ id: serviceId }).first();
  await tokenManager.scheduleRefresh(updatedRow);

  const serialized = await StreamService.serialize(updatedRow);
  const { getIo } = require('../index');
  getIo()?.emit('stream-services:updated', { action: 'updated', service: serialized });
  getIo()?.emit('ottery:oauth', { event: 'oauth.complete', serviceId, platform: 'joystick' });
}

// Callback handler for GET /auth/joystick/callback — registered in server/index.js
async function joystickOAuthCallback(req, res) {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.warn(`[joystick-oauth] authorization denied: ${error} — ${error_description}`);
    const pending = _joystickPendingFlows.get(state);
    if (pending) {
      clearTimeout(pending.timer);
      _joystickPendingFlows.delete(state);
      const { getIo } = require('../index');
      getIo()?.emit('ottery:oauth', {
        event: 'oauth.failed',
        serviceId: pending.serviceId,
        platform: 'joystick',
        reason: error_description || error || 'Authorization denied',
      });
    }
    return res.send('<html><body><p>Authorization denied. You can close this tab.</p></body></html>');
  }

  if (!code || !state) {
    return res.status(400).send('<html><body><p>Missing code or state parameter.</p></body></html>');
  }

  const pending = _joystickPendingFlows.get(state);
  if (!pending) {
    return res.status(400).send('<html><body><p>Unknown or expired authorization session. Please try again.</p></body></html>');
  }

  clearTimeout(pending.timer);
  _joystickPendingFlows.delete(state);

  const { serviceId, clientId, clientSecret, serverPort } = pending;

  // Respond immediately — complete OAuth in background
  res.send('<html><body><p>Authorization complete! You can close this tab and return to Ottery Live.</p></body></html>');

  _completeJoystickOAuth(serviceId, code, clientId, clientSecret, serverPort).catch((err) => {
    logger.error(`[joystick-oauth] completion failed for serviceId=${serviceId}: ${err.message}`);
    const { getIo } = require('../index');
    getIo()?.emit('ottery:oauth', {
      event: 'oauth.failed',
      serviceId,
      platform: 'joystick',
      reason: err.message || 'Failed to complete authorization',
    });
  });
}

async function _completeKickOAuth(serviceId, code, codeVerifier, clientId, serverPort) {
  const {
    exchangeCode,
    fetchChannelInfo,
    fetchStreamKey,
  } = require('../auth/platforms/kick-token');
  const tokenManager = require('../auth/token-manager');
  const settings = require('../settings');

  const tokens = await exchangeCode({ code, codeVerifier, clientId, serverPort });

  await StreamService.setCredential(serviceId, 'api_access_token', tokens.access_token);
  if (tokens.refresh_token) {
    await StreamService.setCredential(serviceId, 'api_refresh_token', tokens.refresh_token);
  }
  await StreamService.setCredential(serviceId, 'api_client_id', clientId);

  // Fetch username from existing DB row for channel info lookup
  const svcRow = await db('stream_services').where({ id: serviceId }).first();
  const username = svcRow.username;

  let chatroomId = null;
  if (username) {
    const channelInfo = await fetchChannelInfo(tokens.access_token, username);
    if (channelInfo) chatroomId = channelInfo.chatroomId;
  }

  const streamKey = await fetchStreamKey(tokens.access_token);
  if (streamKey) {
    await StreamService.setCredential(serviceId, 'stream_key', streamKey);
  }

  const existingMeta = svcRow.metadata ? JSON.parse(svcRow.metadata) : {};
  const metaUpdate = chatroomId
    ? { ...existingMeta, chatroom_id: chatroomId }
    : existingMeta;

  await db('stream_services').where({ id: serviceId }).update({
    api_token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    needs_reauth: false,
    metadata: JSON.stringify(metaUpdate),
    updated_at: new Date().toISOString(),
  });

  const updatedRow = await db('stream_services').where({ id: serviceId }).first();
  await tokenManager.scheduleRefresh(updatedRow);

  const serialized = await StreamService.serialize(updatedRow);
  const { getIo } = require('../index');
  getIo()?.emit('stream-services:updated', { action: 'updated', service: serialized });
  getIo()?.emit('ottery:oauth', { event: 'oauth.complete', serviceId, platform: 'kick' });
}

// Callback handler for GET /auth/kick/callback — registered in server/index.js
async function kickOAuthCallback(req, res) {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.warn(`[kick-oauth] authorization denied: ${error} — ${error_description}`);
    const pending = _kickPendingFlows.get(state);
    if (pending) {
      clearTimeout(pending.timer);
      _kickPendingFlows.delete(state);
      const { getIo } = require('../index');
      getIo()?.emit('ottery:oauth', {
        event: 'oauth.failed',
        serviceId: pending.serviceId,
        platform: 'kick',
        reason: error_description || error || 'Authorization denied',
      });
    }
    return res.send('<html><body><p>Authorization denied. You can close this tab.</p></body></html>');
  }

  if (!code || !state) {
    return res.status(400).send('<html><body><p>Missing code or state parameter.</p></body></html>');
  }

  const pending = _kickPendingFlows.get(state);
  if (!pending) {
    return res.status(400).send('<html><body><p>Unknown or expired authorization session. Please try again.</p></body></html>');
  }

  clearTimeout(pending.timer);
  _kickPendingFlows.delete(state);

  const { serviceId, codeVerifier, clientId, serverPort } = pending;

  // Respond immediately — complete OAuth in background
  res.send('<html><body><p>Authorization complete! You can close this tab and return to Ottery Live.</p></body></html>');

  _completeKickOAuth(serviceId, code, codeVerifier, clientId, serverPort).catch((err) => {
    logger.error(`[kick-oauth] completion failed for serviceId=${serviceId}: ${err.message}`);
    const { getIo } = require('../index');
    getIo()?.emit('ottery:oauth', {
      event: 'oauth.failed',
      serviceId,
      platform: 'kick',
      reason: err.message || 'Failed to complete authorization',
    });
  });
}

async function _pollTwitchOAuth(serviceId, dcfData, clientId) {
  const { pollOAuthToken, fetchChannelId } = require('../auth/platforms/twitch-token');
  const tokenManager = require('../auth/token-manager');

  const tokens = await pollOAuthToken(dcfData.device_code, clientId, dcfData.interval);

  await StreamService.setCredential(serviceId, 'api_access_token', tokens.access_token);
  await StreamService.setCredential(serviceId, 'api_refresh_token', tokens.refresh_token);

  const channelInfo = await fetchChannelId(tokens.access_token, clientId);

  const svcRow = await db('stream_services').where({ id: serviceId }).first();
  const existingMeta = svcRow.metadata ? JSON.parse(svcRow.metadata) : {};
  await db('stream_services').where({ id: serviceId }).update({
    username: channelInfo.login,
    api_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    needs_reauth: false,
    metadata: JSON.stringify({ ...existingMeta, channel_id: channelInfo.id }),
    updated_at: new Date().toISOString(),
  });

  // Schedule proactive token refresh
  const updatedRow = await db('stream_services').where({ id: serviceId }).first();
  await tokenManager.scheduleRefresh(updatedRow);

  const serialized = await StreamService.serialize(updatedRow);
  const { getIo } = require('../index');
  getIo()?.emit('stream-services:updated', { action: 'updated', service: serialized });
  getIo()?.emit('ottery:oauth', { event: 'oauth.complete', serviceId, platform: 'twitch' });
}

// POST /api/stream-services/:id/oauth/youtube/start
router.post('/:id/oauth/youtube/start', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const svc = await StreamService.getWithCredentials(id);
    if (!svc) return res.status(404).json({ error: 'Not found' });

    if (svc.platform !== 'youtube') {
      return res.status(422).json({ error: 'This endpoint is for YouTube only' });
    }

    const clientId = svc.api_client_id;
    if (!clientId) {
      return res.status(422).json({ error: 'Client ID not configured. Add your Google Cloud OAuth Client ID first.' });
    }

    const clientSecret = svc.api_client_secret;
    if (!clientSecret) {
      return res.status(422).json({ error: 'Client Secret not configured. Add your Google Cloud OAuth Client Secret first.' });
    }

    const settings = require('../settings');
    const serverPort = await settings.get('server.port');

    const { startPkceFlow } = require('../auth/platforms/youtube-token');
    const { authUrl, codeVerifier, state } = startPkceFlow({ clientId, serverPort });

    // Store the pending flow with a 10-minute cleanup timer
    const timer = setTimeout(() => {
      _youtubePendingFlows.delete(state);
      logger.debug(`[youtube-oauth] pending flow expired for serviceId=${id}`);
    }, 10 * 60 * 1000);

    _youtubePendingFlows.set(state, { serviceId: id, codeVerifier, clientId, clientSecret, serverPort, timer });

    res.json({ mechanism: 'pkce', auth_url: authUrl, state });
  } catch (err) {
    logger.error('POST /api/stream-services/:id/oauth/youtube/start error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

async function _completeYouTubeOAuth(serviceId, code, codeVerifier, clientId, clientSecret, serverPort) {
  const { exchangeCode, fetchChannelId } = require('../auth/platforms/youtube-token');
  const tokenManager = require('../auth/token-manager');

  const tokens = await exchangeCode({ code, codeVerifier, clientId, clientSecret, serverPort });

  await StreamService.setCredential(serviceId, 'api_access_token', tokens.access_token);
  // Only store refresh_token if present — Google only returns it on first auth / when prompt=consent
  if (tokens.refresh_token) {
    await StreamService.setCredential(serviceId, 'api_refresh_token', tokens.refresh_token);
  }
  // Always (re-)store client credentials in case they were updated
  await StreamService.setCredential(serviceId, 'api_client_id', clientId);
  await StreamService.setCredential(serviceId, 'api_client_secret', clientSecret);

  // Auto-fetch channel ID and title
  const channelInfo = await fetchChannelId(tokens.access_token);

  const svcRow = await db('stream_services').where({ id: serviceId }).first();
  const existingMeta = svcRow.metadata ? JSON.parse(svcRow.metadata) : {};

  const update = {
    api_token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    needs_reauth: false,
    updated_at: new Date().toISOString(),
  };

  if (channelInfo) {
    update.username = channelInfo.title || svcRow.username;
    update.metadata = JSON.stringify({ ...existingMeta, channel_id: channelInfo.channelId });
  }

  // Guard: if no refresh_token was returned and none is stored, flag for re-auth
  if (!tokens.refresh_token) {
    const stored = await StreamService.getCredential(serviceId, 'api_refresh_token');
    if (!stored) {
      logger.warn(`[youtube-oauth] no refresh token for service ${serviceId} — user must re-authorize`);
      update.needs_reauth = true;
    }
  }

  await db('stream_services').where({ id: serviceId }).update(update);

  const updatedRow = await db('stream_services').where({ id: serviceId }).first();
  await tokenManager.scheduleRefresh(updatedRow);

  const serialized = await StreamService.serialize(updatedRow);
  const { getIo } = require('../index');
  getIo()?.emit('stream-services:updated', { action: 'updated', service: serialized });
  getIo()?.emit('ottery:oauth', { event: 'oauth.complete', serviceId, platform: 'youtube' });
}

// Callback handler for GET /auth/youtube/callback — registered in server/index.js
// Google redirects here after user authorizes; uses the already-running Express server
// (no ephemeral server needed — Google accepts http://localhost:{serverPort} loopback).
async function youtubeOAuthCallback(req, res) {
  const { code, state, error, error_description } = req.query;

  if (error) {
    logger.warn(`[youtube-oauth] authorization denied: ${error} — ${error_description}`);
    const pending = _youtubePendingFlows.get(state);
    if (pending) {
      clearTimeout(pending.timer);
      _youtubePendingFlows.delete(state);
      const { getIo } = require('../index');
      getIo()?.emit('ottery:oauth', {
        event: 'oauth.failed',
        serviceId: pending.serviceId,
        platform: 'youtube',
        reason: error_description || error || 'Authorization denied',
      });
    }
    return res.send('<html><body><p>Authorization denied. You can close this tab.</p></body></html>');
  }

  if (!code || !state) {
    return res.status(400).send('<html><body><p>Missing code or state parameter.</p></body></html>');
  }

  const pending = _youtubePendingFlows.get(state);
  if (!pending) {
    return res.status(400).send('<html><body><p>Unknown or expired authorization session. Please try again.</p></body></html>');
  }

  clearTimeout(pending.timer);
  _youtubePendingFlows.delete(state);

  const { serviceId, codeVerifier, clientId, clientSecret, serverPort } = pending;

  // Respond immediately — complete OAuth in background
  res.send('<html><body><p>Authorization complete! You can close this tab and return to Ottery Live.</p></body></html>');

  _completeYouTubeOAuth(serviceId, code, codeVerifier, clientId, clientSecret, serverPort).catch((err) => {
    logger.error(`[youtube-oauth] completion failed for serviceId=${serviceId}: ${err.message}`);
    const { getIo } = require('../index');
    getIo()?.emit('ottery:oauth', {
      event: 'oauth.failed',
      serviceId,
      platform: 'youtube',
      reason: err.message || 'Failed to complete authorization',
    });
  });
}

module.exports = router;
module.exports.kickOAuthCallback = kickOAuthCallback;
module.exports.joystickOAuthCallback = joystickOAuthCallback;
module.exports.youtubeOAuthCallback = youtubeOAuthCallback;
