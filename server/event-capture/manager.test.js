'use strict';

jest.mock('../models/stream-service');
jest.mock('../db/knex', () => ({}));

const StreamService = require('../models/stream-service');
const eventBus = require('../events/event-bus');

const manager = require('./manager');

// Replace loadWorker by mocking the worker files.
// Each factory must be a self-contained inline function (Jest babel restriction).
jest.mock('./twitch',   () => { const E = require('events'); return class extends E { constructor() { super(); this.connect = jest.fn().mockResolvedValue(undefined); this.disconnect = jest.fn().mockResolvedValue(undefined); } }; }, { virtual: true });
jest.mock('./kick',     () => { const E = require('events'); return class extends E { constructor() { super(); this.connect = jest.fn().mockResolvedValue(undefined); this.disconnect = jest.fn().mockResolvedValue(undefined); } }; }, { virtual: true });
jest.mock('./youtube',  () => { const E = require('events'); return class extends E { constructor() { super(); this.connect = jest.fn().mockResolvedValue(undefined); this.disconnect = jest.fn().mockResolvedValue(undefined); } }; }, { virtual: true });
jest.mock('./tiktok',   () => { const E = require('events'); return class extends E { constructor() { super(); this.connect = jest.fn().mockResolvedValue(undefined); this.disconnect = jest.fn().mockResolvedValue(undefined); } }; }, { virtual: true });
jest.mock('./joystick', () => { const E = require('events'); return class extends E { constructor() { super(); this.connect = jest.fn().mockResolvedValue(undefined); this.disconnect = jest.fn().mockResolvedValue(undefined); } }; }, { virtual: true });
jest.mock('./x',        () => { const E = require('events'); return class extends E { constructor() { super(); this.connect = jest.fn().mockResolvedValue(undefined); this.disconnect = jest.fn().mockResolvedValue(undefined); } }; }, { virtual: true });

function makeSvc(overrides = {}) {
  return {
    id: 1,
    platform: 'twitch',
    active: true,
    event_capture_enabled: true,
    auto_start: true,
    ...overrides,
  };
}

beforeEach(() => {
  manager.workers.clear();
  manager.activeSessionId = null;

  StreamService.getWithCredentials = jest.fn();
  eventBus.removeAllListeners();
});

// ---------------------------------------------------------------------------
// start — eligibility guards
// ---------------------------------------------------------------------------

describe('start', () => {
  it('skips and does not create a worker when service is not active', async () => {
    const svc = makeSvc({ active: false });
    StreamService.getWithCredentials.mockResolvedValue(svc);
    await manager.start(1);
    expect(manager.workers.size).toBe(0);
  });

  it('skips when event_capture_enabled is false', async () => {
    const svc = makeSvc({ event_capture_enabled: false });
    StreamService.getWithCredentials.mockResolvedValue(svc);
    await manager.start(1);
    expect(manager.workers.size).toBe(0);
  });

  it('skips for an unknown platform', async () => {
    const svc = makeSvc({ platform: 'unknown_platform' });
    StreamService.getWithCredentials.mockResolvedValue(svc);
    await manager.start(1);
    expect(manager.workers.size).toBe(0);
  });

  it('creates a worker entry and calls connect for a valid service', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    expect(manager.workers.has(1)).toBe(true);
    const entry = manager.workers.get(1);
    expect(entry.worker.connect).toHaveBeenCalled();
  });

  it('is a no-op if the worker is already running', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    await manager.start(1); // second call
    expect(StreamService.getWithCredentials).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// worker event: connected
// ---------------------------------------------------------------------------

describe('worker connected event', () => {
  it('sets state to connected and resets failure count', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const entry = manager.workers.get(1);
    entry.failures = 3; // simulate prior failures

    entry.worker.emit('connected');

    expect(entry.state).toBe('connected');
    expect(entry.failures).toBe(0);
  });

  it('emits capture.started on eventBus', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const entry = manager.workers.get(1);

    const events = [];
    eventBus.on('capture.started', (d) => events.push(d));
    entry.worker.emit('connected');

    expect(events).toEqual([{ serviceId: 1, platform: 'twitch', status: 'live' }]);
  });
});

// ---------------------------------------------------------------------------
// worker event: error
// ---------------------------------------------------------------------------

describe('worker error event', () => {
  it('increments failure count and schedules a retry', async () => {
    jest.useFakeTimers();
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const entry = manager.workers.get(1);

    entry.worker.emit('error', new Error('connection refused'));

    expect(entry.failures).toBe(1);
    expect(entry.retryTimer).not.toBeNull();
    jest.useRealTimers();
  });

  it('removes entry and emits capture.error with max_failures after MAX_FAILURES errors', async () => {
    jest.useFakeTimers();
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const entry = manager.workers.get(1);

    const errors = [];
    eventBus.on('capture.error', (d) => errors.push(d));

    // The manager's MAX_FAILURES is 5; simulate 5 errors
    for (let i = 0; i < 5; i++) {
      if (!manager.workers.has(1)) break;
      manager.workers.get(1).worker.emit('error', new Error('boom'));
      jest.runAllTimers();
      await Promise.resolve();
    }

    expect(manager.workers.has(1)).toBe(false);
    expect(errors.some((e) => e.reason === 'max_failures')).toBe(true);
    jest.useRealTimers();
  });

  it('removes entry immediately and emits capture.error for permanent errors', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const entry = manager.workers.get(1);

    const errors = [];
    eventBus.on('capture.error', (d) => errors.push(d));

    const permanentErr = Object.assign(new Error('not supported'), { permanent: true, code: 'NOT_SUPPORTED' });
    entry.worker.emit('error', permanentErr);

    expect(manager.workers.has(1)).toBe(false);
    expect(errors).toEqual([{ serviceId: 1, platform: 'twitch', reason: 'NOT_SUPPORTED', status: 'error' }]);
  });
});

// ---------------------------------------------------------------------------
// worker event: disconnected
// ---------------------------------------------------------------------------

describe('worker disconnected event', () => {
  it('sets state to disconnected and emits capture.stopped', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const entry = manager.workers.get(1);

    const stopped = [];
    eventBus.on('capture.stopped', (d) => stopped.push(d));

    entry.worker.emit('disconnected', { reason: 'server closed' });

    expect(entry.state).toBe('disconnected');
    expect(stopped).toEqual([{ serviceId: 1, platform: 'twitch', status: 'stopped' }]);
  });

  it('schedules a clean reconnect when not stopping', async () => {
    jest.useFakeTimers();
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const entry = manager.workers.get(1);

    entry.worker.emit('disconnected', { reason: 'network' });

    expect(entry.retryTimer).not.toBeNull();
    jest.useRealTimers();
  });

  it('does not schedule reconnect when stopping flag is set', async () => {
    jest.useFakeTimers();
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const entry = manager.workers.get(1);
    entry.stopping = true;

    entry.worker.emit('disconnected', { reason: 'intentional' });

    expect(entry.retryTimer).toBeNull();
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

describe('stop', () => {
  it('sets stopping, cancels timers, calls disconnect, removes entry, emits capture.stopped', async () => {
    jest.useFakeTimers();
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const entry = manager.workers.get(1);
    // Simulate a pending retry timer
    entry.retryTimer = setTimeout(() => {}, 60000);

    const stopped = [];
    eventBus.on('capture.stopped', (d) => stopped.push(d));

    await manager.stop(1);

    expect(entry.stopping).toBe(true);
    expect(entry.worker.disconnect).toHaveBeenCalled();
    expect(manager.workers.has(1)).toBe(false);
    expect(stopped.some((e) => e.serviceId === 1)).toBe(true);

    jest.useRealTimers();
  });

  it('is a no-op for an unknown serviceId', async () => {
    await expect(manager.stop(9999)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// _reconnect — reloads fresh credentials
// ---------------------------------------------------------------------------

describe('_reconnect', () => {
  it('reloads credentials from StreamService before creating new worker', async () => {
    jest.useFakeTimers();
    const svc = makeSvc();
    StreamService.getWithCredentials.mockResolvedValue(svc);
    await manager.start(1);

    const freshSvc = makeSvc({ api_access_token: 'new-token' });
    StreamService.getWithCredentials.mockResolvedValue(freshSvc);

    await manager._reconnect(1);

    // getWithCredentials called: once on start, once on reconnect
    expect(StreamService.getWithCredentials).toHaveBeenCalledTimes(2);
    expect(manager.workers.get(1).svc).toEqual(freshSvc);

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// restart — recovery after OAuth completes (e.g. previous NO_CHANNEL_ID error)
// ---------------------------------------------------------------------------

describe('restart', () => {
  it('starts capture when no worker is currently registered (recovery from permanent error)', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());

    await manager.restart(1);

    expect(manager.workers.has(1)).toBe(true);
  });

  it('stops and re-starts an existing worker, picking up fresh credentials', async () => {
    StreamService.getWithCredentials.mockResolvedValue(makeSvc());
    await manager.start(1);
    const firstWorker = manager.workers.get(1).worker;

    const freshSvc = makeSvc({ api_access_token: 'fresh-after-oauth' });
    StreamService.getWithCredentials.mockResolvedValue(freshSvc);

    await manager.restart(1);

    expect(firstWorker.disconnect).toHaveBeenCalled();
    expect(manager.workers.has(1)).toBe(true);
    expect(manager.workers.get(1).worker).not.toBe(firstWorker);
    expect(manager.workers.get(1).svc).toEqual(freshSvc);
  });
});
