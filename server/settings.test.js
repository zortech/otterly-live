'use strict';

jest.mock('./db/knex');

let keytarMock = require('../__mocks__/keytar');
let db = require('./db/knex');

let settings;

beforeEach(() => {
  jest.resetModules();

  // Re-mock db with a fresh chain builder after resetModules
  jest.mock('./db/knex');
  settings = require('./settings');
  // Re-acquire the fresh mocks that settings.js is now using
  db = require('./db/knex');
  keytarMock = require('../__mocks__/keytar');
  keytarMock._clear();

  // Default: DB returns nothing (key not found)
  const chain = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockResolvedValue(1),
  };
  db.mockReturnValue(chain);
});

function makeDbChain(overrides = {}) {
  return {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockResolvedValue(1),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// get — DB-backed keys
// ---------------------------------------------------------------------------

describe('get (DB-backed)', () => {
  it('returns the default value when the key is not in the DB', async () => {
    db.mockReturnValue(makeDbChain());
    const value = await settings.get('server.port');
    expect(value).toBe(3737);
  });

  it('returns the parsed value from the DB row', async () => {
    const chain = makeDbChain({ first: jest.fn().mockResolvedValue({ key: 'server.port', value: '9090' }) });
    db.mockReturnValue(chain);

    const value = await settings.get('server.port');
    expect(value).toBe(9090);
  });

  it('returns the cached value on a second call without hitting the DB', async () => {
    const chain = makeDbChain({ first: jest.fn().mockResolvedValue({ key: 'server.port', value: '9090' }) });
    db.mockReturnValue(chain);

    await settings.get('server.port');
    await settings.get('server.port');

    expect(chain.first).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// set — DB-backed keys
// ---------------------------------------------------------------------------

describe('set (DB-backed)', () => {
  it('upserts to the DB and invalidates the cache', async () => {
    const chain = makeDbChain();
    db.mockReturnValue(chain);

    await settings.set('server.port', 8080);

    expect(chain.insert).toHaveBeenCalledWith({ key: 'server.port', value: JSON.stringify(8080) });
    expect(chain.merge).toHaveBeenCalled();

    // Cache should be cleared — next get must hit DB
    const chain2 = makeDbChain({ first: jest.fn().mockResolvedValue({ key: 'server.port', value: '8080' }) });
    db.mockReturnValue(chain2);
    await settings.get('server.port');
    expect(chain2.first).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// keychain-backed keys
// ---------------------------------------------------------------------------

describe('keychain-backed keys', () => {
  it('reads rtmp.incomingKey from keytar, not DB', async () => {
    await keytarMock.setPassword('ottery-live-settings', 'rtmp.incomingKey', 'mysecretkey');

    const value = await settings.get('rtmp.incomingKey');

    expect(value).toBe('mysecretkey');
    // DB should NOT have been called for this key
    expect(db).not.toHaveBeenCalled();
  });

  it('writes rtmp.incomingKey to keytar, not DB', async () => {
    const chain = makeDbChain();
    db.mockReturnValue(chain);

    await settings.set('rtmp.incomingKey', 'newkey');

    expect(chain.insert).not.toHaveBeenCalled();
    const stored = await keytarMock.getPassword('ottery-live-settings', 'rtmp.incomingKey');
    expect(stored).toBe('newkey');
  });

  it('returns the default (empty string) when keychain has no entry', async () => {
    const value = await settings.get('rtmp.incomingKey');
    expect(value).toBe('ottery');
  });
});

// ---------------------------------------------------------------------------
// getPublic — excludes keychain keys
// ---------------------------------------------------------------------------

describe('getPublic', () => {
  it('excludes KEYCHAIN_KEYS from the result', async () => {
    const chain = makeDbChain({ first: jest.fn().mockResolvedValue(undefined) });
    // getAll calls db() directly (not via .where), so mock a plain call
    db.mockReturnValue([]);

    const pub = await settings.getPublic();

    expect(pub).not.toHaveProperty('rtmp.incomingKey');
  });

  it('includes non-keychain keys in the result', async () => {
    db.mockReturnValue([]);

    const pub = await settings.getPublic();

    expect(pub).toHaveProperty(['server.port']);
    expect(pub).toHaveProperty(['app.logLevel']);
  });
});
