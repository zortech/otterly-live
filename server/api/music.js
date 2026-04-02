'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const logger = require('../lib/logger');
const spotify = require('../music/spotify-client');
const songQueue = require('../music/song-queue');
const musicManager = require('../music/music-manager');

// ─── Spotify OAuth ────────────────────────────────────────────────────────────

// GET /auth/spotify — start PKCE flow (opens in system browser via Electron)
router.get('/auth/spotify', async (req, res) => {
  try {
    const url = await spotify.buildAuthUrl();
    res.json({ url });
  } catch (err) {
    logger.error('[api/music] auth start error', err);
    res.status(400).json({ error: err.message });
  }
});

// GET /auth/spotify/callback — handle redirect from Spotify
router.get('/auth/spotify/callback', async (req, res) => {
  try {
    // Build callback URL from known localhost — do not trust the Host header
    const callbackUrl = `http://127.0.0.1${req.originalUrl}`;
    const profile = await spotify.handleCallback(callbackUrl);
    await musicManager.onSpotifyConnected();
    res.json({ ok: true, displayName: profile.display_name, id: profile.id });
  } catch (err) {
    logger.error('[api/music] OAuth callback error', err);
    res.status(400).json({ error: err.message });
  }
});

// DELETE /auth/spotify — disconnect
router.delete('/auth/spotify', async (req, res) => {
  try {
    await spotify.disconnect();
    await musicManager.onSpotifyDisconnected();
    res.json({ ok: true });
  } catch (err) {
    logger.error('[api/music] disconnect error', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Status / Now Playing ─────────────────────────────────────────────────────

router.get('/music/status', async (req, res) => {
  try {
    const connected = await spotify.isConnected();
    if (!connected) return res.json({ connected: false, nowPlaying: null });

    const state = await spotify.getCurrentlyPlaying();
    const nowPlaying = state?.item
      ? {
          trackId: state.item.id,
          trackName: state.item.name,
          artistName: state.item.artists?.map((a) => a.name).join(', '),
          albumArtUrl: state.item.album?.images?.[0]?.url,
          durationMs: state.item.duration_ms,
          progressMs: state.progress_ms,
          isPlaying: state.is_playing,
        }
      : null;

    res.json({ connected: true, nowPlaying });
  } catch (err) {
    logger.error('[api/music] status error', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Queue ────────────────────────────────────────────────────────────────────

router.get('/music/queue', async (req, res) => {
  try {
    const q = await songQueue.getQueue();
    res.json(q);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/music/queue/history — last 5 played songs
router.get('/music/queue/history', async (req, res) => {
  try {
    const items = await songQueue.getRecentlyPlayed(5);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/music/queue — streamer manually adds a song
router.post('/music/queue', async (req, res) => {
  const { trackId, trackName, artistName, albumName, albumArtUrl, durationMs } = req.body;
  if (!trackId || !trackName || !artistName) {
    return res.status(400).json({ error: 'trackId, trackName, artistName required' });
  }
  try {
    const item = await songQueue.add({
      trackId, trackName, artistName, albumName, albumArtUrl, durationMs,
      source: 'streamer',
    });
    await musicManager.emitQueueUpdate();
    musicManager.onSongAdded().catch(() => {});
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/music/queue/:id — remove a queue item
router.delete('/music/queue/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const removed = await songQueue.remove(id);
    if (!removed) return res.status(404).json({ error: 'Item not found or already playing/played' });
    await musicManager.refundItem(removed);
    await musicManager.emitQueueUpdate();
    res.json({ ok: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/music/queue/:id/bump — reorder queue
router.post('/music/queue/:id/bump', async (req, res) => {
  const { direction } = req.body; // 'up' | 'down'
  if (!['up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }
  try {
    const id = parseInt(req.params.id, 10);
    const ok = await songQueue.bump(id, direction);
    if (!ok) return res.status(400).json({ error: 'Cannot bump item' });
    await musicManager.emitQueueUpdate();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Playback controls ────────────────────────────────────────────────────────

router.post('/music/skip', async (req, res) => {
  try {
    await musicManager.skipCurrent();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/music/playback', async (req, res) => {
  const { action } = req.body; // 'play' | 'pause'
  try {
    if (action === 'pause') await spotify.pausePlayback();
    else if (action === 'play') await spotify.resumePlayback();
    else return res.status(400).json({ error: 'action must be "play" or "pause"' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Playlists ────────────────────────────────────────────────────────────────

router.get('/music/playlists', async (req, res) => {
  try {
    const playlists = await spotify.getPlaylists();
    res.json(playlists.map((p) => ({ id: p.id, name: p.name, trackCount: p.tracks?.total, imageUrl: p.images?.[0]?.url })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Spotify Admins ───────────────────────────────────────────────────────────

router.get('/music/admins', async (req, res) => {
  try {
    const admins = await db('spotify_admins').orderBy('created_at', 'asc');
    res.json(admins);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/music/admins', async (req, res) => {
  const { platform, platformUserId, username, grantedBy } = req.body;
  if (!platform || !platformUserId || !username) {
    return res.status(400).json({ error: 'platform, platformUserId, username required' });
  }
  try {
    const ts = new Date().toISOString();
    await db('spotify_admins')
      .insert({ platform, platform_user_id: platformUserId, username, granted_by: grantedBy ?? null, created_at: ts })
      .onConflict(['platform', 'platform_user_id'])
      .merge({ username, granted_by: grantedBy ?? null });
    const row = await db('spotify_admins').where({ platform, platform_user_id: platformUserId }).first();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/music/admins/:id', async (req, res) => {
  try {
    const deleted = await db('spotify_admins').where({ id: req.params.id }).delete();
    if (!deleted) return res.status(404).json({ error: 'Admin not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Search (for manual queue adds via dashboard) ─────────────────────────────

router.get('/music/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const tracks = await spotify.search(q);
    res.json(tracks.map((t) => ({
      id: t.id,
      name: t.name,
      artistName: t.artists?.map((a) => a.name).join(', '),
      albumName: t.album?.name,
      albumArtUrl: t.album?.images?.[0]?.url,
      durationMs: t.duration_ms,
      uri: t.uri,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
