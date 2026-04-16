import { TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { EventEmitter } from 'events';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { OtteryLiveService } from '../ottery-live.service';
import { MusicService, QueueItem, SpotifyAdmin, SpotifyPlaylist, SpotifyTrack } from './music.service';

// ---------------------------------------------------------------------------
// socket.io-client mock — must be set up before Angular loads the service
// ---------------------------------------------------------------------------

class MockSocket extends EventEmitter {
  override on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    super.on(event, cb);
    return this;
  });
  override off = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    super.off(event, cb);
    return this;
  });
  override emit = vi.fn((...args: unknown[]) => super.emit(args[0] as string, ...args.slice(1)));
  override removeAllListeners = vi.fn((event?: string) => {
    super.removeAllListeners(event);
    return this;
  });
}

const mockSocket = new MockSocket();

vi.mock('socket.io-client', () => ({ io: vi.fn(() => mockSocket) }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUEUE_ITEM: QueueItem = {
  id: 1,
  spotify_track_id: 'spotify:track:abc',
  track_name: 'Test Song',
  artist_name: 'Test Artist',
  album_name: 'Test Album',
  album_art_url: null,
  duration_ms: 200000,
  requester_username: 'testuser',
  requester_display_name: 'TestUser',
  requester_platform: 'twitch',
  source: 'request',
  position: 1,
  status: 'queued',
};

const ADMIN: SpotifyAdmin = {
  id: 1,
  platform: 'twitch',
  platform_user_id: 'uid1',
  username: 'moduser',
  granted_by: null,
  created_at: '2025-01-01T00:00:00Z',
};

const PLAYLIST: SpotifyPlaylist = {
  id: 'pl1',
  name: 'Chill Mix',
  trackCount: 20,
  imageUrl: null,
};

const TRACK: SpotifyTrack = {
  id: 'spotify:track:abc',
  name: 'Test Song',
  artistName: 'Test Artist',
  albumName: 'Test Album',
  albumArtUrl: null,
  durationMs: 200000,
};

// ---------------------------------------------------------------------------

describe('MusicService', () => {
  let service: MusicService;
  let http: HttpTestingController;

  beforeEach(() => {
    mockSocket.removeAllListeners();
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(MusicService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    service.destroy();
  });

  // ── loadStatus ──────────────────────────────────────────────────────────────

  describe('loadStatus()', () => {
    it('sets spotifyConnected and nowPlaying from the API response', async () => {
      const p = service.loadStatus();
      const req = http.expectOne('/api/music/status');
      req.flush({ connected: true, nowPlaying: null });
      await p;

      expect(service.spotifyConnected()).toBe(true);
      expect(service.nowPlaying()).toBeNull();
    });

    it('sets nowPlaying when a track is active', async () => {
      const nowPlaying = {
        trackId: 'abc', trackName: 'Test Song', artistName: 'Artist',
        albumArtUrl: null, durationMs: 200000, progressMs: 5000, isPlaying: true,
      };
      const p = service.loadStatus();
      http.expectOne('/api/music/status').flush({ connected: true, nowPlaying });
      await p;

      expect(service.nowPlaying()?.trackName).toBe('Test Song');
    });

    it('silently ignores HTTP errors', async () => {
      const p = service.loadStatus();
      http.expectOne('/api/music/status').error(new ErrorEvent('network'));
      await expect(p).resolves.toBeUndefined();
    });
  });

  // ── loadQueue ───────────────────────────────────────────────────────────────

  describe('loadQueue()', () => {
    it('updates the queue signal', async () => {
      const p = service.loadQueue();
      http.expectOne('/api/music/queue').flush([QUEUE_ITEM]);
      await p;

      expect(service.queue()).toHaveLength(1);
      expect(service.queue()[0].track_name).toBe('Test Song');
    });

    it('sets queue to empty array on empty response', async () => {
      const p = service.loadQueue();
      http.expectOne('/api/music/queue').flush([]);
      await p;

      expect(service.queue()).toEqual([]);
    });
  });

  // ── loadAdmins ──────────────────────────────────────────────────────────────

  describe('loadAdmins()', () => {
    it('updates the admins signal', async () => {
      const p = service.loadAdmins();
      http.expectOne('/api/music/admins').flush([ADMIN]);
      await p;

      expect(service.admins()).toHaveLength(1);
      expect(service.admins()[0].username).toBe('moduser');
    });
  });

  // ── loadPlaylists ────────────────────────────────────────────────────────────

  describe('loadPlaylists()', () => {
    it('updates the playlists signal', async () => {
      const p = service.loadPlaylists();
      http.expectOne('/api/music/playlists').flush([PLAYLIST]);
      await p;

      expect(service.playlists()).toHaveLength(1);
      expect(service.playlists()[0].name).toBe('Chill Mix');
    });
  });

  // ── skip ─────────────────────────────────────────────────────────────────────

  describe('skip()', () => {
    it('POSTs to /api/music/skip', async () => {
      const p = service.skip();
      http.expectOne('/api/music/skip').flush({ ok: true });
      await p;
    });
  });

  // ── setPlayback ──────────────────────────────────────────────────────────────

  describe('setPlayback()', () => {
    beforeEach(async () => {
      // Seed nowPlaying so setPlayback has something to update
      const p = service.loadStatus();
      http.expectOne('/api/music/status').flush({
        connected: true,
        nowPlaying: {
          trackId: 'abc', trackName: 'T', artistName: 'A',
          albumArtUrl: null, durationMs: 200000, progressMs: 0, isPlaying: false,
        },
      });
      await p;
    });

    it('sets isPlaying=false on pause', async () => {
      const p = service.setPlayback('pause');
      http.expectOne('/api/music/playback').flush({ ok: true });
      await p;

      expect(service.nowPlaying()?.isPlaying).toBe(false);
    });

    it('sets isPlaying=true on play', async () => {
      const p = service.setPlayback('play');
      http.expectOne('/api/music/playback').flush({ ok: true });
      await p;

      expect(service.nowPlaying()?.isPlaying).toBe(true);
    });
  });

  // ── addAdmin ─────────────────────────────────────────────────────────────────

  describe('addAdmin()', () => {
    it('POSTs and appends to admins signal', async () => {
      const p = service.addAdmin({ platform: 'twitch', platformUserId: 'uid1', username: 'moduser' });
      http.expectOne('/api/music/admins').flush(ADMIN);
      const result = await p;

      expect(result).toEqual(ADMIN);
      expect(service.admins()).toContainEqual(ADMIN);
    });

    it('updates existing admin in list instead of duplicating', async () => {
      // Seed list first
      const seedP = service.loadAdmins();
      http.expectOne('/api/music/admins').flush([ADMIN]);
      await seedP;

      // Update the same admin
      const updatedAdmin = { ...ADMIN, username: 'newname' };
      const p = service.addAdmin({ platform: 'twitch', platformUserId: 'uid1', username: 'newname' });
      http.expectOne('/api/music/admins').flush(updatedAdmin);
      await p;

      expect(service.admins()).toHaveLength(1);
      expect(service.admins()[0].username).toBe('newname');
    });
  });

  // ── removeAdmin ──────────────────────────────────────────────────────────────

  describe('removeAdmin()', () => {
    it('DELETEs and removes from admins signal', async () => {
      const seedP = service.loadAdmins();
      http.expectOne('/api/music/admins').flush([ADMIN]);
      await seedP;

      const p = service.removeAdmin(1);
      http.expectOne('/api/music/admins/1').flush({ ok: true });
      await p;

      expect(service.admins()).toHaveLength(0);
    });
  });

  // ── search ───────────────────────────────────────────────────────────────────

  describe('search()', () => {
    it('returns track list from API', async () => {
      const p = service.search('test song');
      http.expectOne((r) => r.url.includes('/api/music/search')).flush([TRACK]);
      const result = await p;

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Song');
    });

    it('encodes the search query in the URL', async () => {
      const p = service.search('hello world');
      const req = http.expectOne((r) => r.url.includes('hello'));
      expect(req.request.url).toContain('hello%20world');
      req.flush([]);
      await p;
    });
  });

  // ── addToQueue ───────────────────────────────────────────────────────────────

  describe('addToQueue()', () => {
    it('POSTs the correct payload', async () => {
      const p = service.addToQueue(TRACK);
      const req = http.expectOne('/api/music/queue');
      expect(req.request.body).toMatchObject({
        trackId: TRACK.id,
        trackName: TRACK.name,
        artistName: TRACK.artistName,
      });
      req.flush(QUEUE_ITEM);
      await p;
    });
  });

  // ── socket events ────────────────────────────────────────────────────────────

  describe('socket events via init()', () => {
    beforeEach(() => {
      service.init();
    });

    it('music.connected: sets spotifyConnected=true and reloads status and queue', async () => {
      mockSocket.emit('music.connected');
      await Promise.resolve(); // flush microtasks so async handlers start

      http.expectOne('/api/music/status').flush({ connected: true, nowPlaying: null });
      http.expectOne('/api/music/queue').flush([]);
      http.expectOne('/api/music/queue/history').flush([]);

      expect(service.spotifyConnected()).toBe(true);
    });

    it('music.disconnected: clears connected, nowPlaying, and queue', () => {
      service.spotifyConnected.set(true);
      service.nowPlaying.set({
        trackId: 'x', trackName: 'T', artistName: 'A',
        albumArtUrl: null, durationMs: 100, progressMs: 10, isPlaying: true,
      });
      service.queue.set([QUEUE_ITEM]);

      mockSocket.emit('music.disconnected');

      expect(service.spotifyConnected()).toBe(false);
      expect(service.nowPlaying()).toBeNull();
      expect(service.queue()).toEqual([]);
    });

    it('music.track_changed: sets nowPlaying with new track info', () => {
      mockSocket.emit('music.track_changed', {
        trackId: 'new-track', trackName: 'New Song', artistName: 'New Artist',
        albumArtUrl: 'https://example.com/art.jpg', durationMs: 180000,
      });

      expect(service.nowPlaying()?.trackName).toBe('New Song');
      expect(service.nowPlaying()?.progressMs).toBe(0);
      expect(service.nowPlaying()?.isPlaying).toBe(true);
    });

    it('music.playback_state: updates isPlaying and progress on existing nowPlaying', () => {
      service.nowPlaying.set({
        trackId: 'x', trackName: 'T', artistName: 'A',
        albumArtUrl: null, durationMs: 200000, progressMs: 0, isPlaying: true,
      });

      mockSocket.emit('music.playback_state', { isPlaying: false, progressMs: 45000, durationMs: 200000 });

      expect(service.nowPlaying()?.isPlaying).toBe(false);
      expect(service.nowPlaying()?.progressMs).toBe(45000);
    });

    it('music.queue_updated: replaces queue signal with new data', () => {
      mockSocket.emit('music.queue_updated', { queue: [QUEUE_ITEM, { ...QUEUE_ITEM, id: 2, position: 2 }] });
      expect(service.queue()).toHaveLength(2);
    });

    it('init() is a no-op on subsequent calls', () => {
      service.init(); // second call
      const connectedCalls = (mockSocket.on as MockInstance).mock.calls.filter((args) => args[0] === 'music.connected');
      expect(connectedCalls).toHaveLength(1);
    });
  });

  // ── progress timer ────────────────────────────────────────────────────────────

  describe('progress timer', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('increments progressMs by 1000ms each second while isPlaying', async () => {
      vi.useFakeTimers();
      const p = service.loadStatus();
      http.expectOne('/api/music/status').flush({
        connected: true,
        nowPlaying: {
          trackId: 'x', trackName: 'T', artistName: 'A',
          albumArtUrl: null, durationMs: 200000, progressMs: 0, isPlaying: true,
        },
      });
      await p;

      vi.advanceTimersByTime(3000);
      expect(service.nowPlaying()?.progressMs).toBe(3000);
    });

    it('caps progressMs at durationMs', async () => {
      vi.useFakeTimers();
      const p = service.loadStatus();
      http.expectOne('/api/music/status').flush({
        connected: true,
        nowPlaying: {
          trackId: 'x', trackName: 'T', artistName: 'A',
          albumArtUrl: null, durationMs: 5000, progressMs: 4500, isPlaying: true,
        },
      });
      await p;

      vi.advanceTimersByTime(2000); // would go to 6500 without cap
      expect(service.nowPlaying()?.progressMs).toBe(5000);
    });
  });
});
