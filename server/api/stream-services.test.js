'use strict';

jest.mock('../db/knex');
jest.mock('../models/stream-service');
jest.mock('../lib/platform-registry');
jest.mock('../index', () => ({ getIo: jest.fn().mockReturnValue(null) }));

const request  = require('supertest');
const express  = require('express');
const db       = require('../db/knex');
const StreamService = require('../models/stream-service');
const { getDefaults, getAllPlatforms } = require('../lib/platform-registry');

// Build the app once — mocks are stable across tests
const app = express();
app.use(express.json());
app.use('/api/stream-services', require('./stream-services'));

// Chainable knex mock helper
function makeChain(opts = {}) {
  return {
    where:    jest.fn().mockReturnThis(),
    whereNull: jest.fn().mockReturnThis(),
    orderBy:  jest.fn().mockReturnThis(),
    first:    jest.fn().mockResolvedValue(opts.first),
    insert:   jest.fn().mockResolvedValue(opts.insert ?? [1]),
    update:   jest.fn().mockResolvedValue(opts.update ?? 1),
    delete:   jest.fn().mockResolvedValue(opts.delete ?? 1),
  };
}

const BASE_ROW = {
  id: 1,
  platform: 'twitch',
  display_name: 'My Twitch',
  rtmp_url: 'rtmp://live.twitch.tv/app',
  active: true,
  restream_enabled: true,
  event_capture_enabled: true,
  auto_start: true,
  metadata: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const SERIALIZED = {
  ...BASE_ROW,
  stream_key_configured: true,
  oauth_connected: false,
  api_client_configured: false,
};

beforeEach(() => {
  db.mockReset();
  StreamService.serialize = jest.fn().mockResolvedValue(SERIALIZED);
  StreamService.setCredential = jest.fn().mockResolvedValue(undefined);
  StreamService.deleteCredentials = jest.fn().mockResolvedValue(undefined);
  getDefaults.mockReturnValue({ rtmp_url: 'rtmp://live.twitch.tv/app', event_capture_supported: true });
  getAllPlatforms.mockReturnValue([]);
});

// ── GET /api/stream-services ───────────────────────────────────────────────────

describe('GET /api/stream-services', () => {
  it('returns 200 with list of services', async () => {
    db.mockReturnValue({ orderBy: jest.fn().mockResolvedValue([BASE_ROW]) });

    const res = await request(app).get('/api/stream-services');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].display_name).toBe('My Twitch');
  });

  it('returns 200 with empty array when no services exist', async () => {
    db.mockReturnValue({ orderBy: jest.fn().mockResolvedValue([]) });

    const res = await request(app).get('/api/stream-services');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── GET /api/stream-services/:id ───────────────────────────────────────────────

describe('GET /api/stream-services/:id', () => {
  it('returns 200 with the service', async () => {
    db.mockReturnValue(makeChain({ first: BASE_ROW }));

    const res = await request(app).get('/api/stream-services/1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it('returns 404 when service does not exist', async () => {
    db.mockReturnValue(makeChain({ first: undefined }));

    const res = await request(app).get('/api/stream-services/999');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});

// ── POST /api/stream-services ──────────────────────────────────────────────────

describe('POST /api/stream-services', () => {
  it('returns 201 with created service', async () => {
    db.mockReturnValueOnce(makeChain({ insert: [1] }))
      .mockReturnValueOnce(makeChain({ first: BASE_ROW }));

    const res = await request(app)
      .post('/api/stream-services')
      .send({ platform: 'twitch', display_name: 'My Twitch', stream_key: 'key123' });

    expect(res.status).toBe(201);
    expect(StreamService.setCredential).toHaveBeenCalledWith(1, 'stream_key', 'key123');
  });

  it('returns 422 for an invalid platform', async () => {
    const res = await request(app)
      .post('/api/stream-services')
      .send({ platform: 'unknown_platform', display_name: 'Bad' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Invalid platform/);
  });

  it('returns 422 when display_name is missing', async () => {
    const res = await request(app)
      .post('/api/stream-services')
      .send({ platform: 'twitch' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/display_name/);
  });

  it('returns 422 for an invalid RTMP URL', async () => {
    getDefaults.mockReturnValue({});
    const res = await request(app)
      .post('/api/stream-services')
      .send({ platform: 'twitch', display_name: 'Test', rtmp_url: 'http://not-rtmp.com/stream' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/RTMP/);
  });

  it('accepts all newly-unlocked platforms (rumble, facebook, bilibili)', async () => {
    for (const platform of ['rumble', 'facebook', 'bilibili']) {
      getDefaults.mockReturnValue({ rtmp_url: '', event_capture_supported: true });
      db.mockReturnValueOnce(makeChain({ insert: [1] }))
        .mockReturnValueOnce(makeChain({ first: { ...BASE_ROW, platform } }));
      StreamService.serialize.mockResolvedValueOnce({ ...SERIALIZED, platform });

      const res = await request(app)
        .post('/api/stream-services')
        .send({ platform, display_name: `My ${platform}` });

      expect(res.status).not.toBe(422);
    }
  });
});

// ── PUT /api/stream-services/:id ───────────────────────────────────────────────

describe('PUT /api/stream-services/:id', () => {
  it('returns 200 with updated service', async () => {
    db.mockReturnValueOnce(makeChain({ first: BASE_ROW }))  // existence check
      .mockReturnValueOnce(makeChain({ update: 1 }))         // update
      .mockReturnValueOnce(makeChain({ first: BASE_ROW }));  // fetch updated

    const res = await request(app)
      .put('/api/stream-services/1')
      .send({ display_name: 'Renamed Twitch' });

    expect(res.status).toBe(200);
  });

  it('returns 404 when service does not exist', async () => {
    db.mockReturnValue(makeChain({ first: undefined }));

    const res = await request(app)
      .put('/api/stream-services/999')
      .send({ display_name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('returns 422 for invalid RTMP URL on update', async () => {
    db.mockReturnValue(makeChain({ first: BASE_ROW }));

    const res = await request(app)
      .put('/api/stream-services/1')
      .send({ rtmp_url: 'ftp://bad-protocol.com' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/RTMP/);
  });

  it('updates keychain credential when stream_key is provided', async () => {
    db.mockReturnValueOnce(makeChain({ first: BASE_ROW }))
      .mockReturnValueOnce(makeChain({ update: 1 }))
      .mockReturnValueOnce(makeChain({ first: BASE_ROW }));

    await request(app)
      .put('/api/stream-services/1')
      .send({ stream_key: 'newkey456' });

    expect(StreamService.setCredential).toHaveBeenCalledWith(1, 'stream_key', 'newkey456');
  });
});

// ── DELETE /api/stream-services/:id ───────────────────────────────────────────

describe('DELETE /api/stream-services/:id', () => {
  it('returns 200 with { ok: true } after deletion', async () => {
    db.mockReturnValueOnce(makeChain({ first: BASE_ROW }))    // existence check
      .mockReturnValueOnce(makeChain({ first: undefined }))   // no active session
      .mockReturnValueOnce(makeChain({ delete: 1 }));         // delete

    const res = await request(app).delete('/api/stream-services/1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(StreamService.deleteCredentials).toHaveBeenCalledWith(1);
  });

  it('returns 404 when service does not exist', async () => {
    db.mockReturnValue(makeChain({ first: undefined }));

    const res = await request(app).delete('/api/stream-services/999');

    expect(res.status).toBe(404);
  });

  it('returns 422 when a stream session is active', async () => {
    db.mockReturnValueOnce(makeChain({ first: BASE_ROW }))
      .mockReturnValueOnce(makeChain({ first: { id: 1, started_at: '2025-01-01T00:00:00Z' } }));

    const res = await request(app).delete('/api/stream-services/1');

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/active/);
  });
});

// ── GET /api/stream-services/platforms ────────────────────────────────────────

describe('GET /api/stream-services/platforms', () => {
  it('returns the list of available platforms', async () => {
    getAllPlatforms.mockReturnValue([
      { platform: 'twitch', display_name: 'Twitch' },
      { platform: 'kick',   display_name: 'Kick' },
    ]);

    const res = await request(app).get('/api/stream-services/platforms');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].platform).toBe('twitch');
  });
});
