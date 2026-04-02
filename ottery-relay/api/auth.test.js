'use strict';

const bcrypt  = require('bcryptjs');
const express = require('express');
const request = require('supertest');

// Mock DB and logger before requiring the middleware/router
jest.mock('../db/knex');
jest.mock('../lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const db         = require('../db/knex');
const authRouter = require('./auth');

// ---- App setup -----------------------------------------------------------

async function buildApp(users = []) {
  const app = express();
  app.use(express.json());

  // Stub requireAuth's DB calls
  db.mockImplementation((table) => {
    if (table === 'users') {
      return {
        where:  jest.fn().mockReturnThis(),
        first:  jest.fn(async () => null), // not used by requireAuth directly
        update: jest.fn(async () => 1),
        // requireAuth calls db('users').where({ active: true }) which returns a list
        // This mock needs to handle both call patterns
      };
    }
    return { where: jest.fn().mockReturnThis(), update: jest.fn(async () => 1) };
  });

  // Override for requireAuth: db('users').where({ active: true }) → users array
  db.mockImplementation((table) => ({
    where: jest.fn((cond) => ({
      // requireAuth calls .where({active:true}) then awaits the result as an array
      then: (res) => Promise.resolve(users.filter((u) => {
        if (cond?.active === true) return u.active;
        return true;
      })).then(res),
      first:  jest.fn(async () => users.find((u) => u.id === cond?.id) ?? null),
      update: jest.fn(async (row) => {
        const idx = users.findIndex((u) => u.id === cond?.id);
        if (idx >= 0) Object.assign(users[idx], row);
        return 1;
      }),
    })),
    update: jest.fn(async () => 1),
  }));

  app.use('/api/auth', authRouter);
  return app;
}

// ---- Tests ---------------------------------------------------------------

describe('POST /api/auth/rotate-token', () => {
  it('returns 401 when no Authorization header', async () => {
    const app = await buildApp([]);
    const res = await request(app).post('/api/auth/rotate-token').send({});
    expect(res.status).toBe(401);
  });

  it('returns 401 when token does not match any active user', async () => {
    const hash = await bcrypt.hash('validtoken1234567890123456789012', 12);
    const users = [{ id: 1, username: 'alice', api_token_hash: hash, active: true }];
    const app = await buildApp(users);

    const res = await request(app)
      .post('/api/auth/rotate-token')
      .set('Authorization', 'Bearer wrongtoken')
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 401 for deactivated user even with correct token', async () => {
    const plainToken = 'a'.repeat(64);
    const hash = await bcrypt.hash(plainToken, 12);
    const users = [{ id: 1, username: 'alice', api_token_hash: hash, active: false }];
    const app = await buildApp(users);

    const res = await request(app)
      .post('/api/auth/rotate-token')
      .set('Authorization', `Bearer ${plainToken}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 200 with new token for authenticated user', async () => {
    const plainToken = 'b'.repeat(64);
    const hash = await bcrypt.hash(plainToken, 12);
    const users = [{ id: 1, username: 'alice', api_token_hash: hash, active: true }];
    const app = await buildApp(users);

    const res = await request(app)
      .post('/api/auth/rotate-token')
      .set('Authorization', `Bearer ${plainToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });
});
