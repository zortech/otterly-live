import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { OtteryLiveService, OtteryEvent } from '../ottery-live.service';
import { StreamServicesService, StreamService } from '../stream-services.service';
import { DashboardComponent } from './dashboard.component';

// ---------------------------------------------------------------------------
// socket.io-client mock (same as service spec)
// ---------------------------------------------------------------------------

class MockSocket {
  on = jest.fn().mockReturnThis();
  off = jest.fn().mockReturnThis();
  emit = jest.fn();
}
const mockSocket = new MockSocket();

jest.mock('socket.io-client', () => ({ io: jest.fn(() => mockSocket) }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStreamService(overrides: Partial<StreamService> = {}): StreamService {
  return {
    id: 1,
    platform: 'twitch',
    display_name: 'Twitch',
    rtmp_url: 'rtmp://live.twitch.tv/app',
    username: null,
    restream_enabled: true,
    event_capture_enabled: true,
    auto_start: true,
    active: true,
    api_token_expires_at: null,
    needs_reauth: false,
    metadata: null,
    stream_key_configured: true,
    oauth_connected: true,
    api_client_configured: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<OtteryEvent> = {}): OtteryEvent {
  return {
    id: 'evt-1',
    sessionId: 1,
    platform: 'twitch',
    type: 'follow',
    timestamp: new Date().toISOString(),
    actor: { platformId: 'u1', username: 'user1', displayName: 'User 1' },
    data: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardComponent computed signals', () => {
  let component: DashboardComponent;
  let otteryService: OtteryLiveService;
  let streamSvc: StreamServicesService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    otteryService = TestBed.inject(OtteryLiveService);
    streamSvc = TestBed.inject(StreamServicesService);

    const fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
  });

  // -------------------------------------------------------------------------
  // platformCards
  // -------------------------------------------------------------------------

  describe('platformCards()', () => {
    it('includes services that are active and restream_enabled', () => {
      streamSvc.services.set([makeStreamService({ id: 1 })]);
      expect(component.platformCards().length).toBe(1);
    });

    it('excludes services where active is false', () => {
      streamSvc.services.set([makeStreamService({ id: 1, active: false })]);
      expect(component.platformCards().length).toBe(0);
    });

    it('excludes services where restream_enabled is false', () => {
      streamSvc.services.set([makeStreamService({ id: 1, restream_enabled: false })]);
      expect(component.platformCards().length).toBe(0);
    });

    it('marks isLive when platform status is live', () => {
      streamSvc.services.set([makeStreamService({ id: 1 })]);
      otteryService.platformStatuses.set({ 1: { serviceId: 1, platform: 'twitch', status: 'live' } });
      const cards = component.platformCards();
      expect(cards[0].isLive).toBe(true);
      expect(cards[0].isError).toBe(false);
    });

    it('marks isError when platform status is error', () => {
      streamSvc.services.set([makeStreamService({ id: 1 })]);
      otteryService.platformStatuses.set({ 1: { serviceId: 1, platform: 'twitch', status: 'error', reason: 'max_restarts' } });
      const cards = component.platformCards();
      expect(cards[0].isError).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // sessionStats
  // -------------------------------------------------------------------------

  describe('sessionStats()', () => {
    it('counts follows correctly', () => {
      otteryService.events.set([
        makeEvent({ type: 'follow' }),
        makeEvent({ type: 'follow' }),
        makeEvent({ type: 'follow' }),
      ]);
      expect(component.sessionStats().follows).toBe(3);
    });

    it('counts subscribes correctly', () => {
      otteryService.events.set([makeEvent({ type: 'subscribe' })]);
      expect(component.sessionStats().subs).toBe(1);
    });

    it('sums gift subs using data.count', () => {
      otteryService.events.set([
        makeEvent({ type: 'subscribe.gift', data: { count: 5 } }),
        makeEvent({ type: 'subscribe.gift', data: { count: 3 } }),
      ]);
      expect(component.sessionStats().giftSubs).toBe(8);
    });

    it('defaults gift sub count to 1 when data.count is missing', () => {
      otteryService.events.set([makeEvent({ type: 'subscribe.gift', data: {} })]);
      expect(component.sessionStats().giftSubs).toBe(1);
    });

    it('sums cheers using data.bits', () => {
      otteryService.events.set([
        makeEvent({ type: 'cheer', data: { bits: 100 } }),
        makeEvent({ type: 'cheer', data: { bits: 200 } }),
      ]);
      expect(component.sessionStats().cheers).toBe(300);
    });

    it('tracks peak viewers correctly', () => {
      otteryService.events.set([
        makeEvent({ type: 'viewer_count', data: { count: 50 } }),
        makeEvent({ type: 'viewer_count', data: { count: 200 } }),
        makeEvent({ type: 'viewer_count', data: { count: 100 } }),
      ]);
      expect(component.sessionStats().peakViewers).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // filteredEvents
  // -------------------------------------------------------------------------

  describe('filteredEvents()', () => {
    it('returns all events when filter is "all"', () => {
      component.platformFilter.set('all');
      otteryService.events.set([
        makeEvent({ platform: 'twitch' }),
        makeEvent({ platform: 'kick' }),
      ]);
      expect(component.filteredEvents().length).toBe(2);
    });

    it('filters by platform when filter is set', () => {
      component.platformFilter.set('kick');
      otteryService.events.set([
        makeEvent({ id: 'a', platform: 'twitch' }),
        makeEvent({ id: 'b', platform: 'kick' }),
        makeEvent({ id: 'c', platform: 'kick' }),
      ]);
      const filtered = component.filteredEvents();
      expect(filtered.length).toBe(2);
      expect(filtered.every((e) => e.platform === 'kick')).toBe(true);
    });

    it('caps results at 100 events', () => {
      component.platformFilter.set('all');
      otteryService.events.set(Array.from({ length: 200 }, (_, i) => makeEvent({ id: `e${i}` })));
      expect(component.filteredEvents().length).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // eventSummary
  // -------------------------------------------------------------------------

  describe('eventSummary()', () => {
    it('returns message for chat.message', () => {
      expect(component.eventSummary(makeEvent({ type: 'chat.message', data: { message: 'hello' } }))).toBe('hello');
    });

    it('returns "followed" for follow', () => {
      expect(component.eventSummary(makeEvent({ type: 'follow' }))).toBe('followed');
    });

    it('returns tier for subscribe', () => {
      expect(component.eventSummary(makeEvent({ type: 'subscribe', data: { tier: '3000' } }))).toBe('Tier 3000 sub');
    });

    it('returns gifted count for subscribe.gift', () => {
      expect(component.eventSummary(makeEvent({ type: 'subscribe.gift', data: { count: 10 } }))).toBe('gifted 10 subs');
    });

    it('returns bits for cheer', () => {
      expect(component.eventSummary(makeEvent({ type: 'cheer', data: { bits: 500 } }))).toBe('500 bits');
    });

    it('returns viewer count for viewer_count', () => {
      expect(component.eventSummary(makeEvent({ type: 'viewer_count', data: { count: 123 } }))).toBe('123 viewers');
    });

    it('returns raid viewer count for raid', () => {
      expect(component.eventSummary(makeEvent({ type: 'raid', data: { viewers: 300 } }))).toBe('raided with 300 viewers');
    });
  });
});
