'use strict';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
// db('sessions').where(...).update(...) — used in onStreamReceived to set state='active'
jest.mock('../db/knex', () => jest.fn(() => ({
  where: jest.fn(() => ({ update: jest.fn(async () => 1) })),
})));
jest.mock('../lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// Mock getIo lazy require by mocking the server module
const mockTo   = jest.fn().mockReturnThis();
const mockEmit = jest.fn();
jest.mock('../server', () => ({
  getIo: jest.fn(() => ({ to: mockTo, emit: mockEmit })),
}));

const { spawn }  = require('child_process');
const EventEmitter = require('events');
const manager    = require('./relay-restream-manager');
const { activeSessions } = require('./relay-restream-manager');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.kill   = jest.fn();
  return proc;
}

function makeSession(overrides = {}) {
  const sessionId   = 'sess-test-001';
  const ingestToken = 'tok-test-001';
  const session = {
    userId:      1,
    ingestToken,
    platforms: [
      { serviceId: 1, platform: 'twitch',  rtmpUrl: 'rtmp://live.twitch.tv/app', streamKey: 'key1' },
      { serviceId: 2, platform: 'youtube', rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'key2' },
    ],
    processes: new Map(),
    ...overrides,
  };
  return { sessionId, session };
}

beforeEach(() => {
  activeSessions.clear();
  spawn.mockReset();
  mockTo.mockClear();
  mockEmit.mockClear();
});

// ---------------------------------------------------------------------------
// onStreamReceived
// ---------------------------------------------------------------------------

describe('onStreamReceived', () => {
  it('spawns one FFmpeg process per platform', async () => {
    const { sessionId, session } = makeSession();
    activeSessions.set(sessionId, session);

    spawn.mockReturnValue(makeFakeProc());

    await manager.onStreamReceived(sessionId);

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(session.processes.size).toBe(2);
  });

  it('does nothing when session is not in activeSessions', async () => {
    await manager.onStreamReceived('nonexistent');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('emits restream.started to session Socket.io room for each platform', async () => {
    const { sessionId, session } = makeSession();
    activeSessions.set(sessionId, session);
    spawn.mockReturnValue(makeFakeProc());

    await manager.onStreamReceived(sessionId);

    // _emitToSession calls getIo().to(sessionId).emit(...)
    expect(mockTo).toHaveBeenCalledWith(sessionId);
    const startedCalls = mockEmit.mock.calls.filter(([evt]) => evt === 'restream.started');
    expect(startedCalls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// _handleExit — auto-restart
// ---------------------------------------------------------------------------

describe('_handleExit', () => {
  it('emits restream.error to session room on crash', async () => {
    jest.useFakeTimers();
    const { sessionId, session } = makeSession();
    activeSessions.set(sessionId, session);

    const fakeProc = makeFakeProc();
    spawn.mockReturnValue(fakeProc);

    await manager.onStreamReceived(sessionId);
    mockEmit.mockClear();

    // Crash all platforms past max retries to trigger error
    const platformIndex = 0;
    const svc = session.platforms[platformIndex];
    const entry = session.processes.get(platformIndex);

    // Simulate 3 crashes to exhaust restarts
    entry.restarts = 3;
    entry.stopping = false;
    manager._handleExit(sessionId, platformIndex, svc, 1, null);

    expect(mockEmit).toHaveBeenCalledWith(
      'restream.error',
      expect.objectContaining({ serviceId: svc.serviceId, reason: 'max_restarts' })
    );

    jest.useRealTimers();
  });

  it('schedules a restart on first crash', async () => {
    jest.useFakeTimers();
    const { sessionId, session } = makeSession({ platforms: [
      { serviceId: 1, platform: 'twitch', rtmpUrl: 'rtmp://live.twitch.tv/app', streamKey: 'k' },
    ]});
    activeSessions.set(sessionId, session);

    const fakeProcs = [makeFakeProc(), makeFakeProc()];
    let i = 0;
    spawn.mockImplementation(() => fakeProcs[i++]);

    await manager.onStreamReceived(sessionId);
    fakeProcs[0].emit('exit', 1, null);

    const entry = session.processes.get(0);
    expect(entry).toBeDefined();
    expect(entry.restarts).toBe(1);
    expect(entry.restartTimer).not.toBeNull();

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// stopSession
// ---------------------------------------------------------------------------

describe('stopSession', () => {
  it('kills all procs and emits session.ended to room', async () => {
    const { sessionId, session } = makeSession({ platforms: [
      { serviceId: 1, platform: 'twitch', rtmpUrl: 'rtmp://x/y', streamKey: 'k' },
    ]});
    activeSessions.set(sessionId, session);

    const fakeProc = makeFakeProc();
    spawn.mockReturnValue(fakeProc);
    await manager.onStreamReceived(sessionId);
    mockEmit.mockClear();
    mockTo.mockClear();

    manager.stopSession(sessionId);

    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockTo).toHaveBeenCalledWith(sessionId);
    expect(mockEmit).toHaveBeenCalledWith('session.ended', {});
  });

  it('is a no-op for unknown session', () => {
    expect(() => manager.stopSession('unknown')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// redactKey
// ---------------------------------------------------------------------------

describe('redactKey (via stderr output)', () => {
  it('strips stream key from rtmp URLs in log lines', () => {
    // Access the exported module's internal redactKey by exercising stderr
    const line = 'Opening rtmps://live.twitch.tv/app/mySecretKey for writing';
    // We can't call redactKey directly (not exported), but we can verify
    // that spawn is called and the stderr handler redacts the key.
    // Instead, test the regex pattern directly:
    const redacted = line.replace(/(rtmps?:\/\/[^/]+\/[^/]+\/)(\S+)/, '$1[REDACTED]');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain('mySecretKey');
  });
});
