'use strict';

// Mock socket.io-client before requiring relay-client
const mockSocketOn   = jest.fn();
const mockSocketEmit = jest.fn();
const mockSocketDisconnect = jest.fn();
const mockSocket = {
  on:         mockSocketOn,
  emit:       mockSocketEmit,
  disconnect: mockSocketDisconnect,
};
const mockIoConnect = jest.fn(() => mockSocket);

// relay-client uses undici's fetch directly (not global fetch), so we mock
// the undici module. Agent is a passthrough — its only role in prod is to
// allow self-signed certs against the relay.
const mockUndiciFetch = jest.fn();
jest.mock('undici', () => ({
  fetch: mockUndiciFetch,
  Agent: jest.fn(),
}));

jest.mock('socket.io-client', () => ({ io: mockIoConnect }), { virtual: true });
jest.mock('../settings', () => ({ get: jest.fn() }));
jest.mock('../lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const settings  = require('../settings');
const eventBus  = require('../events/event-bus');

// Require after mocks are set up; relay-client exports a singleton so we
// must reset state between tests manually.
const relayClient = require('./relay-client');

// Helper: stub settings.get('relay.url') and settings.get('relay.apiToken')
function stubSettings(url = 'https://relay.example.com', apiToken = 'testtoken') {
  settings.get.mockImplementation(async (key) => {
    if (key === 'relay.url')      return url;
    if (key === 'relay.apiToken') return apiToken;
    return null;
  });
}

// Helper: stub the undici fetch mock
function stubFetch(status = 200, body = {}) {
  mockUndiciFetch.mockImplementation(async () => ({
    ok:   status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
  }));
}

beforeEach(() => {
  // Reset singleton state between tests
  relayClient._socket      = null;
  relayClient._sessionId   = null;
  relayClient._undiciAgent = null;
  relayClient._httpsAgent  = null;
  mockSocketOn.mockReset();
  mockSocketEmit.mockReset();
  mockSocketDisconnect.mockReset();
  mockIoConnect.mockClear();
  mockUndiciFetch.mockReset();
  eventBus.removeAllListeners();
});

// ---------------------------------------------------------------------------
// HTTPS enforcement
// ---------------------------------------------------------------------------

describe('startSession — HTTPS enforcement', () => {
  it('throws if relay URL uses http://', async () => {
    stubSettings('http://relay.example.com');
    stubFetch(200, {});  // set up a mock fetch so we can assert it wasn't called
    await expect(relayClient.startSession([])).rejects.toThrow(/HTTPS/i);
    expect(mockUndiciFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// startSession — happy path
// ---------------------------------------------------------------------------

describe('startSession — success', () => {
  it('POSTs to /api/sessions with Authorization: Bearer header', async () => {
    stubSettings('https://relay.example.com', 'mytoken123');
    stubFetch(200, { sessionId: 'sess-1', ingestToken: 'tok-1', rtmpsPort: 1936 });

    // Suppress connectStatusSocket socket setup (mockSocketOn doesn't run real code)
    await relayClient.startSession([{ serviceId: 1, platform: 'twitch', rtmpUrl: 'rtmp://x/y', streamKey: 'k' }]);

    expect(mockUndiciFetch).toHaveBeenCalledWith(
      'https://relay.example.com/api/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer mytoken123',
        }),
      })
    );
  });

  it('stores _sessionId and returns data', async () => {
    stubSettings('https://relay.example.com', 'mytoken');
    stubFetch(200, { sessionId: 'sess-abc', ingestToken: 'tok-xyz', rtmpsPort: 1936 });

    const result = await relayClient.startSession([]);

    expect(relayClient._sessionId).toBe('sess-abc');
    expect(result.sessionId).toBe('sess-abc');
    expect(result.ingestToken).toBe('tok-xyz');
  });
});

// ---------------------------------------------------------------------------
// startSession — TLS agent configuration
// ---------------------------------------------------------------------------

describe('startSession — TLS verification', () => {
  const { Agent } = require('undici');

  function stubTls({ caCert = null, allowSelfSigned = null } = {}) {
    settings.get.mockImplementation(async (key) => {
      if (key === 'relay.url')             return 'https://relay.example.com';
      if (key === 'relay.apiToken')        return 'tok';
      if (key === 'relay.caCert')          return caCert;
      if (key === 'relay.allowSelfSigned') return allowSelfSigned;
      return null;
    });
  }

  it('verifies against the system trust store by default (no ca, no override)', async () => {
    stubTls();
    stubFetch(200, { sessionId: 's', ingestToken: 't', rtmpsPort: 1936 });
    Agent.mockClear();

    await relayClient.startSession([]);

    expect(Agent).toHaveBeenCalledWith({ connect: {} });
  });

  it('pins the relay CA cert when relay.caCert is set', async () => {
    stubTls({ caCert: 'PEM-DATA' });
    stubFetch(200, { sessionId: 's' });
    Agent.mockClear();

    await relayClient.startSession([]);

    expect(Agent).toHaveBeenCalledWith({ connect: { ca: 'PEM-DATA' } });
  });

  it('disables verification only when relay.allowSelfSigned is true', async () => {
    stubTls({ allowSelfSigned: true });
    stubFetch(200, { sessionId: 's' });
    Agent.mockClear();

    await relayClient.startSession([]);

    expect(Agent).toHaveBeenCalledWith({ connect: { rejectUnauthorized: false } });
  });
});

// ---------------------------------------------------------------------------
// startSession — relay returns error
// ---------------------------------------------------------------------------

describe('startSession — relay error', () => {
  it('throws when relay returns non-2xx', async () => {
    stubSettings('https://relay.example.com', 'tok');
    stubFetch(401, { error: 'invalid_token' });

    await expect(relayClient.startSession([])).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// endSession
// ---------------------------------------------------------------------------

describe('endSession', () => {
  it('DELETEs /api/sessions/:id', async () => {
    stubSettings('https://relay.example.com', 'mytoken');
    stubFetch(204, {});
    relayClient._sessionId = 'sess-del';

    await relayClient.endSession();

    expect(mockUndiciFetch).toHaveBeenCalledWith(
      'https://relay.example.com/api/sessions/sess-del',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(relayClient._sessionId).toBeNull();
  });

  it('is a no-op when _sessionId is null', async () => {
    relayClient._sessionId = null;
    stubFetch(204, {});

    await relayClient.endSession();

    expect(mockUndiciFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// connectStatusSocket — event bridging
// ---------------------------------------------------------------------------

describe('connectStatusSocket — event bridging', () => {
  it('bridges restream.started relay event to local eventBus', () => {
    const received = [];
    eventBus.on('restream.started', (d) => received.push(d));

    relayClient.connectStatusSocket('sess-1', 'tok-1', 'https://relay.example.com', 1936);

    // Find the 'restream.started' handler that was registered
    const call = mockSocketOn.mock.calls.find(([event]) => event === 'restream.started');
    expect(call).toBeDefined();
    call[1]({ serviceId: 1, platform: 'twitch', status: 'live' });

    expect(received).toHaveLength(1);
    expect(received[0].serviceId).toBe(1);
  });

  it('bridges session.ended relay event to relay.error on local eventBus', () => {
    // Remote mode never silently falls back to local — see relay-client.js
    // session.ended handler. The relay ending the session unexpectedly is a
    // hard error surfaced via 'relay.error'.
    const errors = [];
    eventBus.on('relay.error', (d) => errors.push(d));

    relayClient.connectStatusSocket('sess-2', 'tok-2', 'https://relay.example.com', 1936);

    const call = mockSocketOn.mock.calls.find(([event]) => event === 'session.ended');
    expect(call).toBeDefined();
    call[1]();

    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/unexpected/i);
  });

  it('emits join with sessionId and ingestToken on connect', () => {
    relayClient.connectStatusSocket('sess-3', 'tok-3', 'https://relay.example.com', 1936);

    const connectCall = mockSocketOn.mock.calls.find(([event]) => event === 'connect');
    expect(connectCall).toBeDefined();
    connectCall[1](); // simulate socket 'connect' event

    expect(mockSocketEmit).toHaveBeenCalledWith('join', { sessionId: 'sess-3', ingestToken: 'tok-3' });
  });
});
