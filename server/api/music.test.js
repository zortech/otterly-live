'use strict';

jest.mock('../db/knex');
jest.mock('../music/spotify-client');
jest.mock('../music/song-queue');
jest.mock('../music/music-manager');
jest.mock('../index', () => ({ getIo: jest.fn().mockReturnValue(null) }));

const request      = require('supertest');
const express      = require('express');
const db           = require('../db/knex');
const spotify      = require('../music/spotify-client');
const songQueue    = require('../music/song-queue');
const musicManager = require('../music/music-manager');

const app = express();
app.use(express.json());
app.use('/api', require('./music'));
app.use('/', require('./music')); // auth/spotify lives at root

function makeChain(opts = {}) {
  return {
    where:      jest.fn().mockReturnThis(),
    orderBy:    jest.fn().mockReturnThis(),
    insert:     jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge:      jest.fn().mockResolvedValue(1),
    first:      jest.fn().mockResolvedValue(opts.first),
    delete:     jest.fn().mockResolvedValue(opts.delete ?? 1),
  };
}

const QUEUE_ITEM = {
  id: 1,
  track_name: 'Test Song',
  artist_name: 'Test Artist',
  status: 'queued',
  position: 1,
};

const SPOTIFY_TRACK = {
  id: 'spotify:track:abc',
  name: 'Test Song',
  artists: [{ name: 'Test Artist' }],
  album: { name: 'Test Album', images: [{ url: 'https://example.com/art.jpg' }] },
  duration_ms: 200000,
  uri: 'spotify:track:abc',
};

beforeEach(() => {
  db.mockReset();
  spotify.isConnected.mockResolvedValue(true);
  spotify.getCurrentlyPlaying.mockResolvedValue(null);
  spotify.buildAuthUrl.mockResolvedValue('https://accounts.spotify.com/authorize?...');
  spotify.handleCallback.mockResolvedValue({ display_name: 'testuser', id: 'uid123' });
  spotify.disconnect.mockResolvedValue(undefined);
  spotify.search.mockResolvedValue([SPOTIFY_TRACK]);
  spotify.getPlaylists.mockResolvedValue([]);
  spotify.pausePlayback.mockResolvedValue(undefined);
  spotify.resumePlayback.mockResolvedValue(undefined);
  spotify.skipToNext.mockResolvedValue(undefined);
  songQueue.getQueue.mockResolvedValue([]);
  songQueue.add.mockResolvedValue(QUEUE_ITEM);
  songQueue.remove.mockResolvedValue(QUEUE_ITEM);
  songQueue.bump.mockResolvedValue(true);
  musicManager.onSpotifyConnected.mockResolvedValue(undefined);
  musicManager.onSpotifyDisconnected.mockResolvedValue(undefined);
  musicManager.emitQueueUpdate.mockResolvedValue(undefined);
  musicManager.onSongAdded.mockReturnValue(Promise.resolve());
  musicManager.refundItem.mockResolvedValue(undefined);
  musicManager.skipCurrent.mockResolvedValue(undefined);
});

// ── GET /auth/spotify ──────────────────────────────────────────────────────────

describe('GET /auth/spotify', () => {
  it('returns the auth URL', async () => {
    const res = await request(app).get('/auth/spotify');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('spotify.com');
  });

  it('returns 400 when buildAuthUrl throws', async () => {
    spotify.buildAuthUrl.mockRejectedValue(new Error('not configured'));
    const res = await request(app).get('/auth/spotify');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('not configured');
  });
});

// ── GET /auth/spotify/callback ─────────────────────────────────────────────────

describe('GET /auth/spotify/callback', () => {
  it('returns profile on success', async () => {
    const res = await request(app).get('/auth/spotify/callback?code=abc&state=xyz');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, displayName: 'testuser', id: 'uid123' });
    expect(musicManager.onSpotifyConnected).toHaveBeenCalled();
  });

  it('returns 400 when handleCallback throws', async () => {
    spotify.handleCallback.mockRejectedValue(new Error('invalid code'));
    const res = await request(app).get('/auth/spotify/callback');
    expect(res.status).toBe(400);
  });
});

// ── DELETE /auth/spotify ───────────────────────────────────────────────────────

describe('DELETE /auth/spotify', () => {
  it('disconnects Spotify and returns ok', async () => {
    const res = await request(app).delete('/auth/spotify');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(spotify.disconnect).toHaveBeenCalled();
    expect(musicManager.onSpotifyDisconnected).toHaveBeenCalled();
  });
});

// ── GET /api/music/status ──────────────────────────────────────────────────────

describe('GET /api/music/status', () => {
  it('returns connected: false when Spotify is not connected', async () => {
    spotify.isConnected.mockResolvedValue(false);
    const res = await request(app).get('/api/music/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false, nowPlaying: null });
  });

  it('returns connected: true with null nowPlaying when nothing is playing', async () => {
    spotify.getCurrentlyPlaying.mockResolvedValue(null);
    const res = await request(app).get('/api/music/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, nowPlaying: null });
  });

  it('returns track info when something is playing', async () => {
    spotify.getCurrentlyPlaying.mockResolvedValue({
      item: SPOTIFY_TRACK,
      progress_ms: 12000,
      is_playing: true,
    });
    const res = await request(app).get('/api/music/status');
    expect(res.status).toBe(200);
    expect(res.body.nowPlaying).toMatchObject({
      trackName: 'Test Song',
      artistName: 'Test Artist',
      durationMs: 200000,
      isPlaying: true,
    });
  });
});

// ── GET /api/music/queue ───────────────────────────────────────────────────────

describe('GET /api/music/queue', () => {
  it('returns empty array when queue is empty', async () => {
    const res = await request(app).get('/api/music/queue');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns queue items', async () => {
    songQueue.getQueue.mockResolvedValue([QUEUE_ITEM]);
    const res = await request(app).get('/api/music/queue');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(1);
  });
});

// ── POST /api/music/queue ──────────────────────────────────────────────────────

describe('POST /api/music/queue', () => {
  const VALID_BODY = {
    trackId: 'spotify:track:abc',
    trackName: 'Test Song',
    artistName: 'Test Artist',
    albumName: 'Test Album',
    albumArtUrl: 'https://example.com/art.jpg',
    durationMs: 200000,
  };

  it('adds song and returns the queue item', async () => {
    const res = await request(app).post('/api/music/queue').send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(songQueue.add).toHaveBeenCalledWith(expect.objectContaining({
      trackId: 'spotify:track:abc',
      source: 'streamer',
    }));
  });

  it('returns 400 when trackId is missing', async () => {
    const res = await request(app).post('/api/music/queue').send({ trackName: 'x', artistName: 'y' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when trackName is missing', async () => {
    const res = await request(app).post('/api/music/queue').send({ trackId: 'x', artistName: 'y' });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/music/queue/:id ────────────────────────────────────────────────

describe('DELETE /api/music/queue/:id', () => {
  it('removes item and returns ok', async () => {
    const res = await request(app).delete('/api/music/queue/1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.removed.id).toBe(1);
    expect(musicManager.refundItem).toHaveBeenCalledWith(QUEUE_ITEM);
  });

  it('returns 404 when item not found or not removable', async () => {
    songQueue.remove.mockResolvedValue(null);
    const res = await request(app).delete('/api/music/queue/99');
    expect(res.status).toBe(404);
  });
});

// ── POST /api/music/queue/:id/bump ─────────────────────────────────────────────

describe('POST /api/music/queue/:id/bump', () => {
  it('bumps item up and returns ok', async () => {
    const res = await request(app).post('/api/music/queue/1/bump').send({ direction: 'up' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(songQueue.bump).toHaveBeenCalledWith(1, 'up');
  });

  it('bumps item down', async () => {
    const res = await request(app).post('/api/music/queue/1/bump').send({ direction: 'down' });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid direction', async () => {
    const res = await request(app).post('/api/music/queue/1/bump').send({ direction: 'sideways' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when bump returns false (already at boundary)', async () => {
    songQueue.bump.mockResolvedValue(false);
    const res = await request(app).post('/api/music/queue/1/bump').send({ direction: 'up' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/music/skip ───────────────────────────────────────────────────────

describe('POST /api/music/skip', () => {
  it('skips current track and returns ok', async () => {
    const res = await request(app).post('/api/music/skip');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(musicManager.skipCurrent).toHaveBeenCalled();
  });
});

// ── PUT /api/music/playback ────────────────────────────────────────────────────

describe('PUT /api/music/playback', () => {
  it('pauses playback', async () => {
    const res = await request(app).put('/api/music/playback').send({ action: 'pause' });
    expect(res.status).toBe(200);
    expect(spotify.pausePlayback).toHaveBeenCalled();
  });

  it('resumes playback', async () => {
    const res = await request(app).put('/api/music/playback').send({ action: 'play' });
    expect(res.status).toBe(200);
    expect(spotify.resumePlayback).toHaveBeenCalled();
  });

  it('returns 400 for unknown action', async () => {
    const res = await request(app).put('/api/music/playback').send({ action: 'shuffle' });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/music/playlists ───────────────────────────────────────────────────

describe('GET /api/music/playlists', () => {
  it('returns empty array when no playlists', async () => {
    const res = await request(app).get('/api/music/playlists');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns formatted playlist list', async () => {
    spotify.getPlaylists.mockResolvedValue([
      { id: 'pl1', name: 'Chill Mix', tracks: { total: 20 }, images: [{ url: 'https://example.com/img.jpg' }] },
    ]);
    const res = await request(app).get('/api/music/playlists');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: 'pl1', name: 'Chill Mix', trackCount: 20 });
  });
});

// ── GET /api/music/search ──────────────────────────────────────────────────────

describe('GET /api/music/search', () => {
  it('returns 400 when q is missing', async () => {
    const res = await request(app).get('/api/music/search');
    expect(res.status).toBe(400);
  });

  it('returns formatted track results', async () => {
    const res = await request(app).get('/api/music/search?q=test+song');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      name: 'Test Song',
      artistName: 'Test Artist',
      durationMs: 200000,
    });
  });
});

// ── GET /api/music/admins ──────────────────────────────────────────────────────

describe('GET /api/music/admins', () => {
  it('returns list of admins', async () => {
    const ADMIN = { id: 1, platform: 'twitch', username: 'moduser' };
    const chain = makeChain();
    chain.orderBy.mockResolvedValue([ADMIN]);
    db.mockReturnValue(chain);

    const res = await request(app).get('/api/music/admins');
    expect(res.status).toBe(200);
    expect(res.body[0].username).toBe('moduser');
  });
});

// ── POST /api/music/admins ─────────────────────────────────────────────────────

describe('POST /api/music/admins', () => {
  const VALID_BODY = { platform: 'twitch', platformUserId: 'uid1', username: 'moduser' };

  it('creates admin and returns row', async () => {
    const ADMIN_ROW = { id: 1, platform: 'twitch', platform_user_id: 'uid1', username: 'moduser' };
    const chain = makeChain({ first: ADMIN_ROW });
    db.mockReturnValue(chain);

    const res = await request(app).post('/api/music/admins').send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('moduser');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/music/admins').send({ platform: 'twitch' });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/music/admins/:id ───────────────────────────────────────────────

describe('DELETE /api/music/admins/:id', () => {
  it('deletes admin and returns ok', async () => {
    db.mockReturnValue(makeChain({ delete: 1 }));
    const res = await request(app).delete('/api/music/admins/1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 404 when admin not found', async () => {
    db.mockReturnValue(makeChain({ delete: 0 }));
    const res = await request(app).delete('/api/music/admins/99');
    expect(res.status).toBe(404);
  });
});
