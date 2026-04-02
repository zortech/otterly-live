'use strict';

const bcrypt  = require('bcryptjs');
const express = require('express');
const request = require('supertest');

jest.mock('../db/knex');
jest.mock('../lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../restream/relay-restream-manager', () => {
  const activeSessions = new Map();
  return {
    activeSessions,
    stopSession: jest.fn(),
    getStatus:   jest.fn(() => ({})),
  };
});

const db  = require('../db/knex');
const mgr = require('../restream/relay-restream-manager');

const VALID_PLATFORM = {
  serviceId: 1,
  platform:  'twitch',
  rtmpUrl:   'rtmp://live.twitch.tv/app',
  streamKey: 'validkey123',
};

// ---- App builder ---------------------------------------------------------

async function buildApp(token) {
  const hash  = await bcrypt.hash(token, 12);
  const user  = { id: 1, username: 'owner', api_token_hash: hash, active: true };
  const dbSessions = [];

  db.mockImplementation((table) => {
    if (table === 'users') {
      return {
        where: jest.fn((cond) => ({
          then: (res) => {
            const list = cond?.active === true ? [user] : [];
            return Promise.resolve(list).then(res);
          },
          first: jest.fn(async () => null),
        })),
      };
    }
    if (table === 'sessions') {
      return {
        where:  jest.fn((cond) => ({
          first:  jest.fn(async () => dbSessions.find(
            (r) => (cond?.session_id ? r.session_id === cond.session_id : true)
          ) ?? null),
          update: jest.fn(async () => 1),
        })),
        insert: jest.fn(async (row) => { dbSessions.push({ ...row, state: 'pending' }); return [1]; }),
      };
    }
    return { where: jest.fn().mockReturnThis(), insert: jest.fn(async () => [1]) };
  });

  const sessionsRouter = require('./sessions');
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', sessionsRouter);
  return { app, user, dbSessions };
}

// ---- Tests ---------------------------------------------------------------

describe('POST /api/sessions', () => {
  let app, token;

  beforeEach(async () => {
    token = 'c'.repeat(64);
    ({ app } = await buildApp(token));
    mgr.activeSessions.clear();
    jest.clearAllMocks();
    // Re-apply db mock after clearAllMocks
    const hash = await bcrypt.hash(token, 12);
    const user = { id: 1, username: 'owner', api_token_hash: hash, active: true };
    db.mockImplementation((table) => {
      if (table === 'users') {
        return { where: jest.fn(() => ({ then: (res) => Promise.resolve([user]).then(res) })) };
      }
      return { where: jest.fn().mockReturnThis(), insert: jest.fn(async () => [1]) };
    });
  });

  it('returns 401 with no auth', async () => {
    const res = await request(app).post('/api/sessions').send({ platforms: [VALID_PLATFORM] });
    expect(res.status).toBe(401);
  });

  it('returns 400 when platforms array is missing', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid rtmpUrl protocol (http)', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ platforms: [{ ...VALID_PLATFORM, rtmpUrl: 'http://example.com/live' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rtmpUrl/i);
  });

  it('returns 400 for empty streamKey', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ platforms: [{ ...VALID_PLATFORM, streamKey: '' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/streamKey/i);
  });

  it('returns 201 with sessionId, ingestToken, rtmpsPort for valid request', async () => {
    db.mockImplementation((table) => {
      const hash  = '$2a$12$placeholder'; // not compared in this path
      const user  = { id: 1, username: 'owner', api_token_hash: hash, active: true };
      if (table === 'users') {
        return {
          where: jest.fn(() => ({
            then: (res) => {
              // For require-auth, we short-circuit by injecting req.user directly
              return Promise.resolve([]).then(res);
            },
          })),
        };
      }
      return { where: jest.fn().mockReturnThis(), insert: jest.fn(async () => [1]) };
    });

    // To avoid bcrypt in test, use a pre-hashed token approach:
    // Build a fresh app with a known token that we actually hash
    const freshToken = 'd'.repeat(64);
    const freshHash  = await bcrypt.hash(freshToken, 12);
    const freshUser  = { id: 1, username: 'owner', api_token_hash: freshHash, active: true };
    db.mockImplementation((table) => {
      if (table === 'users') {
        return { where: jest.fn(() => ({ then: (res) => Promise.resolve([freshUser]).then(res) })) };
      }
      return { where: jest.fn().mockReturnThis(), insert: jest.fn(async () => [1]) };
    });
    const sessionsRouter = require('./sessions');
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use('/api/sessions', sessionsRouter);

    const res = await request(freshApp)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ platforms: [VALID_PLATFORM] });

    expect(res.status).toBe(201);
    expect(typeof res.body.sessionId).toBe('string');
    expect(typeof res.body.ingestToken).toBe('string');
    expect(typeof res.body.rtmpsPort).toBe('number');
    // Stream keys must not appear in the response body
    expect(JSON.stringify(res.body)).not.toContain(VALID_PLATFORM.streamKey);
  });
});

describe('DELETE /api/sessions/:id', () => {
  it('returns 404 when session does not exist', async () => {
    const token = 'e'.repeat(64);
    const hash  = await bcrypt.hash(token, 12);
    const user  = { id: 1, username: 'owner', api_token_hash: hash, active: true };

    db.mockImplementation((table) => {
      if (table === 'users') {
        return { where: jest.fn(() => ({ then: (res) => Promise.resolve([user]).then(res) })) };
      }
      if (table === 'sessions') {
        return { where: jest.fn(() => ({ first: jest.fn(async () => null), update: jest.fn() })) };
      }
      return { where: jest.fn().mockReturnThis() };
    });

    const sessionsRouter = require('./sessions');
    const app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    const res = await request(app)
      .delete('/api/sessions/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 when session belongs to different user', async () => {
    const token = 'f'.repeat(64);
    const hash  = await bcrypt.hash(token, 12);
    const user  = { id: 1, username: 'owner', api_token_hash: hash, active: true };

    db.mockImplementation((table) => {
      if (table === 'users') {
        return { where: jest.fn(() => ({ then: (res) => Promise.resolve([user]).then(res) })) };
      }
      if (table === 'sessions') {
        return { where: jest.fn(() => ({
          first:  jest.fn(async () => ({ session_id: 'sess-123', user_id: 999 })), // different owner
          update: jest.fn(),
        })) };
      }
      return { where: jest.fn().mockReturnThis() };
    });

    const sessionsRouter = require('./sessions');
    const app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    const res = await request(app)
      .delete('/api/sessions/sess-123')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 204, calls stopSession, and deletes from activeSessions on success', async () => {
    const token = 'g'.repeat(64);
    const hash  = await bcrypt.hash(token, 12);
    const user  = { id: 1, username: 'owner', api_token_hash: hash, active: true };
    const sessionId = 'sess-abc';

    mgr.activeSessions.set(sessionId, { userId: 1, platforms: [] });
    mgr.stopSession.mockClear();

    db.mockImplementation((table) => {
      if (table === 'users') {
        return { where: jest.fn(() => ({ then: (res) => Promise.resolve([user]).then(res) })) };
      }
      if (table === 'sessions') {
        return { where: jest.fn(() => ({
          first:  jest.fn(async () => ({ session_id: sessionId, user_id: 1 })),
          update: jest.fn(async () => 1),
        })) };
      }
      return { where: jest.fn().mockReturnThis() };
    });

    const sessionsRouter = require('./sessions');
    const app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    const res = await request(app)
      .delete(`/api/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(mgr.stopSession).toHaveBeenCalledWith(sessionId);
    expect(mgr.activeSessions.has(sessionId)).toBe(false);
  });
});
