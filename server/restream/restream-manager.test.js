'use strict';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../models/stream-service');
jest.mock('../db/knex', () => {
  // Used by _startLocalSession and _startRemoteSession.
  // Returns empty service list so no platforms auto-start in tests.
  const mockDb = jest.fn(() => ({
    where: jest.fn(async () => []),
  }));
  return mockDb;
});
jest.mock('../settings', () => ({ get: jest.fn() }));
jest.mock('./relay-client', () => ({
  startSession:           jest.fn(),
  endSession:             jest.fn(),
  connectStatusSocket:    jest.fn(),
  disconnectStatusSocket: jest.fn(),
}));

const { spawn } = require('child_process');
const EventEmitter = require('events');
const eventBus = require('../events/event-bus');
const manager = require('./restream-manager');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
}

function makeService(overrides = {}) {
  return {
    id: 1,
    platform: 'twitch',
    rtmp_url: 'rtmp://live.twitch.tv/app',
    stream_key: 'key123',
    ...overrides,
  };
}

beforeEach(() => {
  manager.processes.clear();
  manager.rtmpPort = 1935;
  manager.incomingKey = 'ottery';
  spawn.mockReset();
  eventBus.removeAllListeners();
});

// ---------------------------------------------------------------------------
// startPlatform — guard conditions
// ---------------------------------------------------------------------------

describe('startPlatform', () => {
  it('does not spawn and emits restream.error when stream_key is missing', async () => {
    const emitted = [];
    eventBus.on('restream.error', (d) => emitted.push(d));

    await manager.startPlatform(makeService({ id: 1, stream_key: null }));

    expect(spawn).not.toHaveBeenCalled();
    expect(emitted).toEqual([{ serviceId: 1, platform: 'twitch', reason: 'no_stream_key', status: 'error' }]);
  });

  it('does not spawn and emits restream.error when rtmp_url is missing', async () => {
    const emitted = [];
    eventBus.on('restream.error', (d) => emitted.push(d));

    await manager.startPlatform(makeService({ id: 2, rtmp_url: null }));

    expect(spawn).not.toHaveBeenCalled();
    expect(emitted).toEqual([{ serviceId: 2, platform: 'twitch', reason: 'no_rtmp_url', status: 'error' }]);
  });

  it('spawns FFmpeg and emits restream.started on success', async () => {
    spawn.mockReturnValue(makeFakeProc());
    const started = [];
    eventBus.on('restream.started', (d) => started.push(d));

    await manager.startPlatform(makeService({ id: 3 }));

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(manager.processes.has(3)).toBe(true);
    expect(started).toEqual([{ serviceId: 3, platform: 'twitch', status: 'live' }]);
  });

  it('does not spawn a second time if already running', async () => {
    spawn.mockReturnValue(makeFakeProc());
    const svc = makeService({ id: 4 });

    await manager.startPlatform(svc);
    await manager.startPlatform(svc);

    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// _handleExit
// ---------------------------------------------------------------------------

describe('_handleExit', () => {
  it('emits restream.stopped and removes entry on clean exit (code 0)', async () => {
    const fakeProc = makeFakeProc();
    spawn.mockReturnValue(fakeProc);

    const stopped = [];
    eventBus.on('restream.stopped', (d) => stopped.push(d));

    await manager.startPlatform(makeService({ id: 5 }));
    fakeProc.emit('exit', 0, null);

    expect(manager.processes.has(5)).toBe(false);
    expect(stopped).toEqual([{ serviceId: 5, status: 'stopped' }]);
  });

  it('schedules restart and increments restarts counter on non-zero exit', async () => {
    jest.useFakeTimers();
    const fakeProc = makeFakeProc();
    spawn.mockReturnValue(fakeProc);

    await manager.startPlatform(makeService({ id: 6 }));
    fakeProc.emit('exit', 1, null);

    const entry = manager.processes.get(6);
    expect(entry).toBeDefined();
    expect(entry.restarts).toBe(1);
    expect(entry.restartTimer).not.toBeNull();

    jest.useRealTimers();
  });

  it('emits restream.error with reason max_restarts after 3 crashes', async () => {
    jest.useFakeTimers();

    // 4 procs: initial + 3 restart attempts
    const procs = [makeFakeProc(), makeFakeProc(), makeFakeProc(), makeFakeProc()];
    let idx = 0;
    spawn.mockImplementation(() => procs[idx++]);

    const errors = [];
    eventBus.on('restream.error', (d) => errors.push(d));

    await manager.startPlatform(makeService({ id: 7 }));

    for (let i = 0; i < 3; i++) {
      procs[i].emit('exit', 1, null);
      jest.runAllTimers();
      await Promise.resolve(); // flush async startPlatform
    }
    procs[3].emit('exit', 1, null);

    expect(errors.some((e) => e.reason === 'max_restarts')).toBe(true);
    expect(manager.processes.has(7)).toBe(false);

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// stopPlatform
// ---------------------------------------------------------------------------

describe('stopPlatform', () => {
  it('kills process, cancels timer, removes entry, emits restream.stopped', async () => {
    const fakeProc = makeFakeProc();
    spawn.mockReturnValue(fakeProc);

    const stopped = [];
    eventBus.on('restream.stopped', (d) => stopped.push(d));

    await manager.startPlatform(makeService({ id: 8 }));
    manager.stopPlatform(8);

    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.processes.has(8)).toBe(false);
    expect(stopped).toEqual([{ serviceId: 8, status: 'stopped' }]);
  });

  it('is a no-op when the service is not running', () => {
    expect(() => manager.stopPlatform(9999)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// stopAll
// ---------------------------------------------------------------------------

describe('stopAll', () => {
  it('stops every running process', async () => {
    const procsArr = [makeFakeProc(), makeFakeProc()];
    let i = 0;
    spawn.mockImplementation(() => procsArr[i++]);

    await manager.startPlatform(makeService({ id: 10, platform: 'twitch' }));
    await manager.startPlatform(makeService({ id: 11, platform: 'kick', rtmp_url: 'rtmps://x' }));
    expect(manager.processes.size).toBe(2);

    manager.stopAll();

    expect(manager.processes.size).toBe(0);
    expect(procsArr[0].kill).toHaveBeenCalled();
    expect(procsArr[1].kill).toHaveBeenCalled();
  });

  it('does not stop the __relay__ process', async () => {
    const relayProc    = makeFakeProc();
    const platformProc = makeFakeProc();
    // platform spawn returns platformProc
    spawn.mockReturnValue(platformProc);

    // Manually insert relay entry using relayProc
    manager.processes.set('__relay__', { proc: relayProc, svc: null, restarts: 0, stopping: false, restartTimer: null });
    await manager.startPlatform(makeService({ id: 20 }));

    manager.stopAll();

    expect(relayProc.kill).not.toHaveBeenCalled();
    expect(platformProc.kill).toHaveBeenCalled();
    expect(manager.processes.has('__relay__')).toBe(true);
    manager.processes.delete('__relay__'); // cleanup
  });
});

// ---------------------------------------------------------------------------
// Remote mode
// ---------------------------------------------------------------------------

describe('remote mode', () => {
  const settings    = require('../settings');
  const relayClient = require('./relay-client');

  function stubRemoteMode() {
    settings.get.mockImplementation(async (key) => {
      if (key === 'relay.mode') return 'remote';
      if (key === 'relay.url')  return 'https://relay.example.com';
      return null;
    });
  }

  beforeEach(() => {
    relayClient.startSession.mockReset();
    relayClient.endSession.mockReset();
    settings.get.mockReset();
    spawn.mockReset();
    manager.processes.clear();
    manager.rtmpPort    = 1935;
    manager.incomingKey = 'ottery';
  });

  it('relay.mode=local does not call relayClient.startSession', async () => {
    settings.get.mockResolvedValue('local');
    // _startLocalSession calls db (mocked as {}) — that throws, which is caught internally
    await manager.onStreamStart(1935, 'ottery');
    expect(relayClient.startSession).not.toHaveBeenCalled();
  });

  it('relay.mode=remote calls relayClient.startSession and spawns relay FFmpeg on success', async () => {
    stubRemoteMode();

    relayClient.startSession.mockResolvedValue({
      sessionId:   'sess-relay',
      ingestToken: 'tok-relay',
      rtmpsPort:   1936,
    });

    const relayProc = makeFakeProc();
    spawn.mockReturnValue(relayProc);

    await manager._startRemoteSession();

    expect(relayClient.startSession).toHaveBeenCalledTimes(1);
    expect(manager.processes.has('__relay__')).toBe(true);
    manager.processes.delete('__relay__');
  });

  it('relay.mode=remote emits relay.fallback and falls back when relayClient.startSession rejects', async () => {
    stubRemoteMode();
    relayClient.startSession.mockRejectedValue(new Error('relay unreachable'));

    const fallbacks = [];
    eventBus.on('relay.fallback', (d) => fallbacks.push(d));

    await manager._startRemoteSession();

    expect(fallbacks.length).toBeGreaterThan(0);
    expect(fallbacks[0].reason).toMatch(/relay unreachable/);
    // Falls back to _startLocalSession — db throws (mocked as {}), caught internally
    expect(spawn).not.toHaveBeenCalled();
  });

  it('onStreamEnd in remote mode calls relayClient.endSession and kills relay proc', async () => {
    stubRemoteMode();

    const relayProc = makeFakeProc();
    manager.processes.set('__relay__', { proc: relayProc, svc: null, restarts: 0, stopping: false, restartTimer: null });
    relayClient.endSession.mockResolvedValue();

    await manager.onStreamEnd();

    expect(relayClient.endSession).toHaveBeenCalledTimes(1);
    expect(relayProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.processes.has('__relay__')).toBe(false);
  });
});
