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
  addPlatform:            jest.fn(),
  removePlatform:         jest.fn(),
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
// status reporting during restart backoff
// ---------------------------------------------------------------------------

describe('status during restart backoff', () => {
  it("reports 'reconnecting' (not 'live') while a crashed platform awaits restart", async () => {
    jest.useFakeTimers();
    const fakeProc = makeFakeProc();
    spawn.mockReturnValue(fakeProc);

    await manager.startPlatform(makeService({ id: 40 }));
    expect(manager.getStatusForService(40)).toBe('live');

    fakeProc.emit('exit', 1, null); // crash → restart-backoff slot, proc = null

    expect(manager.getStatusForService(40)).toBe('reconnecting');
    expect(manager.getStatus()[40].status).toBe('reconnecting');

    jest.useRealTimers();
  });

  it('emits restream.reconnecting with the attempt number on crash', async () => {
    jest.useFakeTimers();
    const fakeProc = makeFakeProc();
    spawn.mockReturnValue(fakeProc);

    const events = [];
    eventBus.on('restream.reconnecting', (d) => events.push(d));

    await manager.startPlatform(makeService({ id: 41 }));
    fakeProc.emit('exit', 1, null);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ serviceId: 41, platform: 'twitch', attempt: 1, status: 'reconnecting' });

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

  it('does not throw and removes the entry when stopped during restart backoff (proc is null)', async () => {
    jest.useFakeTimers();
    const fakeProc = makeFakeProc();
    spawn.mockReturnValue(fakeProc);

    await manager.startPlatform(makeService({ id: 30 }));
    fakeProc.emit('exit', 1, null); // schedules restart, sets entry.proc = null

    expect(manager.processes.get(30).proc).toBeNull();
    expect(() => manager.stopPlatform(30)).not.toThrow();
    expect(manager.processes.has(30)).toBe(false);

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// restart timer hygiene
// ---------------------------------------------------------------------------

describe('startPlatform during restart backoff', () => {
  it('cancels the pending restart timer when manually restarted, leaving exactly one live proc', async () => {
    jest.useFakeTimers();
    const first  = makeFakeProc();
    const second = makeFakeProc();
    const procs = [first, second];
    let idx = 0;
    spawn.mockImplementation(() => procs[idx++]);

    await manager.startPlatform(makeService({ id: 31 }));
    first.emit('exit', 1, null);              // schedules a restart timer
    await manager.startPlatform(makeService({ id: 31 })); // manual restart during backoff

    expect(spawn).toHaveBeenCalledTimes(2);   // initial + manual restart
    jest.runAllTimers();                      // the orphaned timer must NOT spawn a third
    expect(spawn).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
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

  it('relay.mode=remote emits relay.error and does NOT fall back when relayClient.startSession rejects', async () => {
    // No silent fallback to local: the user picked remote because their
    // uplink can't sustain N platforms, and silently restarting locally
    // would saturate the link and corrupt every destination. See the
    // comment in _startRemoteSession (restream-manager.js).
    stubRemoteMode();
    relayClient.startSession.mockRejectedValue(new Error('relay unreachable'));

    const errors = [];
    eventBus.on('relay.error', (d) => errors.push(d));

    await manager._startRemoteSession();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].reason).toMatch(/relay unreachable/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('toggle(enabled) in remote mode with NO active relay session refuses and does NOT start a direct push', async () => {
    // The catastrophic-fallback guard: if the relay passthrough isn't running,
    // a manual toggle must not silently spawn a direct local FFmpeg — that would
    // saturate a relay user's uplink and corrupt every destination.
    stubRemoteMode();
    const StreamService = require('../models/stream-service');
    StreamService.getWithCredentials.mockResolvedValue({
      id: 1, platform: 'twitch', restream_enabled: true,
      rtmp_url: 'rtmp://x', stream_key: 'k',
    });
    manager.processes.delete('__relay__'); // no active relay session

    const errors = [];
    eventBus.on('relay.error', (d) => errors.push(d));

    await expect(manager.toggle(1, true)).rejects.toThrow(/relay/i);
    expect(spawn).not.toHaveBeenCalled();
    expect(relayClient.addPlatform).not.toHaveBeenCalled();
    expect(errors.length).toBeGreaterThan(0);
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

  it('onStreamEnd tears down a running passthrough even if relay.mode now reads local', async () => {
    // The user may flip relay.mode mid-stream; onStreamEnd must clean up what
    // is actually running, not what the setting currently says.
    settings.get.mockResolvedValue('local');
    relayClient.endSession.mockResolvedValue();

    const relayProc = makeFakeProc();
    manager.processes.set('__relay__', { proc: relayProc, svc: null, restarts: 0, stopping: false, restartTimer: null, startedAt: Date.now() });

    await manager.onStreamEnd();

    expect(relayProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(relayClient.endSession).toHaveBeenCalledTimes(1);
    expect(manager.processes.has('__relay__')).toBe(false);
  });

  it('_handleFatalRelayError stops the passthrough so FFmpeg cannot reconnect-loop a dead session', () => {
    relayClient.endSession.mockResolvedValue();

    const relayProc = makeFakeProc();
    manager.processes.set('__relay__', { proc: relayProc, svc: null, restarts: 2, stopping: false, restartTimer: null, startedAt: Date.now() });

    manager._handleFatalRelayError();

    expect(relayProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.processes.has('__relay__')).toBe(false);
  });

  it('_handleFatalRelayError is a no-op when no passthrough is running', () => {
    expect(() => manager._handleFatalRelayError()).not.toThrow();
    expect(relayClient.endSession).not.toHaveBeenCalled();
  });

  it('_spawnRelayFFmpeg inherits the restart counter from a dead slot so backoff is not silently reset', async () => {
    stubRemoteMode();
    spawn.mockReturnValue(makeFakeProc());
    // Dead slot left by _handleRelayExit after several reconnect attempts.
    manager.processes.set('__relay__', { proc: null, svc: null, restarts: 3, stopping: false, restartTimer: null, startedAt: Date.now() });

    await manager._spawnRelayFFmpeg({ ingestToken: 'tok', rtmpsPort: 1936 });

    expect(manager.processes.get('__relay__').restarts).toBe(3);
    manager.processes.delete('__relay__');
  });
});
