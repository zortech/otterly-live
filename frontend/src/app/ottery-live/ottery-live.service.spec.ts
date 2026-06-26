import { TestBed } from '@angular/core/testing';
import { EventEmitter } from 'events';
import { OtteryLiveService } from './ottery-live.service';

// ---------------------------------------------------------------------------
// socket.io-client mock — must be set up before the service is constructed
// ---------------------------------------------------------------------------

class MockSocket extends EventEmitter {
  override on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    super.on(event, cb);
    return this;
  });
  override emit = vi.fn((...args: unknown[]) => super.emit(args[0] as string, ...args.slice(1)));
  override off = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    super.off(event, cb);
    return this;
  });
  override removeAllListeners = vi.fn((event?: string) => {
    super.removeAllListeners(event);
    return this;
  });
}

const mockSocket = new MockSocket();

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

// ---------------------------------------------------------------------------

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    sessionId: 42,
    platform: 'twitch',
    type: 'follow',
    timestamp: new Date().toISOString(),
    actor: null,
    data: {},
    ...overrides,
  };
}

describe('OtteryLiveService', () => {
  let service: OtteryLiveService;

  beforeEach(() => {
    mockSocket.removeAllListeners();
    vi.clearAllMocks();

    TestBed.configureTestingModule({});
    service = TestBed.inject(OtteryLiveService);
  });

  // -------------------------------------------------------------------------
  // socket events → signal updates
  // -------------------------------------------------------------------------

  it('sets connected=true on socket connect and false on disconnect', () => {
    mockSocket.emit('connect');
    expect(service.connected()).toBe(true);

    mockSocket.emit('disconnect');
    expect(service.connected()).toBe(false);
  });

  it('prepends events and caps at 500 on ottery:event', () => {
    // Fill with 500 events first
    for (let i = 0; i < 500; i++) {
      mockSocket.emit('ottery:event', makeEvent({ id: `old-${i}` }));
    }
    expect(service.events().length).toBe(500);

    // One more should drop the oldest
    mockSocket.emit('ottery:event', makeEvent({ id: 'new-1' }));
    expect(service.events().length).toBe(500);
    expect(service.events()[0].id).toBe('new-1');
  });

  it('routes restream vs capture statuses to separate maps on ottery:status', () => {
    mockSocket.emit('ottery:status', { serviceId: 1, platform: 'twitch', status: 'live', type: 'restream' });
    mockSocket.emit('ottery:status', { serviceId: 2, platform: 'kick', status: 'stopped' });
    mockSocket.emit('ottery:status', { serviceId: 1, platform: 'twitch', status: 'error', type: 'capture' });

    // Restream map holds restream (and untyped) statuses
    expect(service.restreamStatuses()[1]).toMatchObject({ serviceId: 1, status: 'live' });
    expect(service.restreamStatuses()[2]).toMatchObject({ serviceId: 2, status: 'stopped' });
    // Capture status for the same service is tracked independently — does not clobber restream
    expect(service.captureStatuses()[1]).toMatchObject({ serviceId: 1, status: 'error' });
    expect(service.restreamStatuses()[1].status).toBe('live');
  });

  it('sets sessionState on ottery:session', () => {
    mockSocket.emit('ottery:session', { state: 'live', sessionId: 5 });
    expect(service.sessionState()).toBe('live');
    expect(service.activeSessionId()).toBe(5);
  });

  it('clears events and statuses when session goes idle', () => {
    mockSocket.emit('ottery:event', makeEvent());
    mockSocket.emit('ottery:status', { serviceId: 1, platform: 'twitch', status: 'live' });

    mockSocket.emit('ottery:session', { state: 'idle' });

    expect(service.events()).toEqual([]);
    expect(service.restreamStatuses()).toEqual({});
    expect(service.captureStatuses()).toEqual({});
  });

  it('adds auth.required entry on ottery:auth', () => {
    mockSocket.emit('ottery:auth', { serviceId: 3, platform: 'youtube' });
    expect(service.authRequired()[3]).toMatchObject({ serviceId: 3, platform: 'youtube' });
  });

  // -------------------------------------------------------------------------
  // hydrateStatuses
  // -------------------------------------------------------------------------

  it('hydrateStatuses merges restream statuses without replacing existing entries', () => {
    mockSocket.emit('ottery:status', { serviceId: 1, platform: 'twitch', status: 'live' });

    service.hydrateStatuses({ 2: { serviceId: 2, platform: 'kick', status: 'stopped' } });

    expect(service.restreamStatuses()[1]).toBeDefined();
    expect(service.restreamStatuses()[2]).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // clearAuthRequired
  // -------------------------------------------------------------------------

  it('clearAuthRequired removes the specified entry', () => {
    mockSocket.emit('ottery:auth', { serviceId: 1, platform: 'twitch' });
    mockSocket.emit('ottery:auth', { serviceId: 2, platform: 'kick' });

    service.clearAuthRequired(1);

    expect(service.authRequired()[1]).toBeUndefined();
    expect(service.authRequired()[2]).toBeDefined();
  });
});
