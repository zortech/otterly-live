'use strict';

const bcrypt = require('bcryptjs');

// Mock the DB module before requiring cli.js
// The CLI requires './db/knex' at load time (for process.env.RELAY_DB_PATH),
// so we intercept it here.
jest.mock('./db/knex', () => {
  const rows = [];
  const mockDb = jest.fn((table) => ({
    where:     jest.fn().mockReturnThis(),
    first:     jest.fn(async () => rows.find((r) => r._table === table) ?? null),
    select:    jest.fn().mockReturnThis(),
    orderBy:   jest.fn().mockReturnThis(),
    update:    jest.fn(async () => 1),
    insert:    jest.fn(async () => [1]),
  }));
  mockDb.migrate = { latest: jest.fn(async () => {}) };
  mockDb.destroy = jest.fn(async () => {});
  mockDb._rows   = rows;
  return mockDb;
});

const db                                 = require('./db/knex');
const { addUser, listUsers, removeUser, rotateToken } = require('./cli');

// Helpers to set up fake DB state
function stubUsers(users) {
  db.mockImplementation((table) => {
    const tableRows = users.filter((r) => r._table === table);
    const query = {
      where:   jest.fn().mockReturnThis(),
      first:   jest.fn(async () => tableRows[0] ?? null),
      select:  jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      update:  jest.fn(async () => 1),
      insert:  jest.fn(async () => [1]),
    };
    // store reference so tests can read it
    db._lastQuery = query;
    return query;
  });
}

beforeEach(() => {
  db.migrate.latest.mockClear();
});

// ---------------------------------------------------------------------------
// addUser
// ---------------------------------------------------------------------------

describe('addUser', () => {
  it('generates a 64-char hex token and inserts a bcrypt hash', async () => {
    let insertedHash = null;
    db.mockImplementation((table) => ({
      where:  jest.fn().mockReturnThis(),
      first:  jest.fn(async () => null), // user does not exist
      insert: jest.fn(async (row) => {
        insertedHash = row.api_token_hash;
        return [1];
      }),
    }));

    const token = await addUser('alice');

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(insertedHash).not.toBeNull();
    expect(await bcrypt.compare(token, insertedHash)).toBe(true);
  });

  it('returns null and does not insert when username already exists', async () => {
    db.mockImplementation(() => ({
      where:  jest.fn().mockReturnThis(),
      first:  jest.fn(async () => ({ id: 1, username: 'alice' })), // already exists
      insert: jest.fn(),
    }));

    const token = await addUser('alice');

    expect(token).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listUsers
// ---------------------------------------------------------------------------

describe('listUsers', () => {
  it('queries id, username, active, created_at ordered by id', async () => {
    const selectMock  = jest.fn().mockReturnThis();
    const orderByMock = jest.fn(async () => []);
    db.mockImplementation(() => ({ select: selectMock, orderBy: orderByMock }));

    await listUsers();

    expect(selectMock).toHaveBeenCalledWith('id', 'username', 'active', 'created_at');
    expect(orderByMock).toHaveBeenCalledWith('id');
  });
});

// ---------------------------------------------------------------------------
// removeUser
// ---------------------------------------------------------------------------

describe('removeUser', () => {
  it('sets active=false and does NOT delete the row', async () => {
    const updateMock = jest.fn(async () => 1);
    const deleteMock = jest.fn();
    db.mockImplementation(() => ({
      where:  jest.fn().mockReturnThis(),
      first:  jest.fn(async () => ({ id: 1, username: 'bob' })),
      update: updateMock,
      delete: deleteMock,
    }));

    const result = await removeUser('bob');

    expect(result).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ active: false });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('returns false when user not found', async () => {
    db.mockImplementation(() => ({
      where: jest.fn().mockReturnThis(),
      first: jest.fn(async () => null),
    }));

    const result = await removeUser('nobody');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rotateToken
// ---------------------------------------------------------------------------

describe('rotateToken', () => {
  it('generates a new 64-char hex token and updates the hash', async () => {
    let updatedHash = null;
    db.mockImplementation(() => ({
      where:  jest.fn().mockReturnThis(),
      first:  jest.fn(async () => ({ id: 1, username: 'carol' })),
      update: jest.fn(async (row) => { updatedHash = row.api_token_hash; return 1; }),
    }));

    const newToken = await rotateToken('carol');

    expect(newToken).toMatch(/^[0-9a-f]{64}$/);
    expect(updatedHash).not.toBeNull();
    expect(await bcrypt.compare(newToken, updatedHash)).toBe(true);
  });

  it('returns null when user not found', async () => {
    db.mockImplementation(() => ({
      where: jest.fn().mockReturnThis(),
      first: jest.fn(async () => null),
    }));

    const result = await rotateToken('nobody');

    expect(result).toBeNull();
  });
});
