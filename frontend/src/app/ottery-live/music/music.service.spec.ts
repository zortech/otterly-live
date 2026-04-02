import { TestBed, fakeAsync, tick } from '@angular/core/testing';
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
  on = jest.fn((event: string, cb: (...args: unknown[]) => void) => {
    super.on(event, cb);
    return this;
  });
  off = jest.fn((event: string, cb: (...args: unknown[]) => void) => {
    super.off(event, cb);
    return this;
  });
  emit = jest.fn((...args: unknown[]) => super.emit(args[0] as string, ...args.slice(1)));
}

const mockSocket = new MockSocket();

jest.mock('socket.io-client', () => ({ io: jest.fn(() => mockSocket) }));

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
    jest.clearAllMocks();

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
    it('sets spotifyConnected and nowPlaying from the API response', fakeAsync(async () => {
      const p = service.loadStatus();
      const req = http.expectOne('/api/music/status');
      req.flush({ connected: true, nowPlaying: null });
      await p;

      expect(service.spotifyConnected()).toBe(true);
      expect(service.nowPlaying()).toBeNull();
    }));

    it('sets nowPlaying when a track is active', fakeAsync(async () => {
      const nowPlaying = {
        trackId: 'abc', trackName: 'Test Song', artistName: 'Artist',
        albumArtUrl: null, durationMs: 200000, progressMs: 5000, isPlaying: true,
      };
      const p = service.loadStatus();
      http.expectOne('/api/music/status').flush({ connected: true, nowPlaying });
      await p;

      expect(service.nowPlaying()?.trackName).toBe('Test Song');
    }));

    it('silently ignores HTTP errors', fakeAsync(async () => {
      const p = service.loadStatus();
      http.expectOne('/api/music/status').error(new ErrorEvent('network'));
      await expect(p).resolves.toBeUndefined();
    }));
  });

  // ── loadQueue ───────────────────────────────────────────────────────────────

  describe('loadQueue()', () => {
    it('updates the queue signal', fakeAsync(async () => {
      const p = service.loadQueue();
      http.expectOne('/api/music/queue').flush([QUEUE_ITEM]);
      await p;

      expect(service.queue()).toHaveLength(1);
      expect(service.queue()[0].track_name).toBe('Test Song');
    }));

    it('sets queue to empty array on empty response', fakeAsync(async () => {
      const p = service.loadQueue();
      http.expectOne('/api/music/queue').flush([]);
      await p;

      expect(service.queue()).toEqual([]);
    }));
  });

  // ── loadAdmins ──────────────────────────────────────────────────────────────

  describe('loadAdmins()', () => {
    it('updates the admins signal', fakeAsync(async () => {
      const p = service.loadAdmins();
      http.expectOne('/api/music/admins').flush([ADMIN]);
      await p;

      expect(service.admins()).toHaveLength(1);
      expect(service.admins()[0].username).toBe('moduser');
    }));
  });

  // ── loadPlaylists ────────────────────────────────────────────────────────────

  describe('loadPlaylists()', () => {
    it('updates the playlists signal', fakeAsync(async () => {
      const p = service.loadPlaylists();
      http.expectOne('/api/music/playlists').flush([PLAYLIST]);
      await p;

      expect(service.playlists()).toHaveLength(1);
      expect(service.playlists()[0].name).toBe('Chill Mix');
    }));
  });

  // ── skip ─────────────────────────────────────────────────────────────────────

  describe('skip()', () => {
    it('POSTs to /api/music/skip', fakeAsync(async () => {
      const p = service.skip();
      http.expectOne('/api/music/skip').flush({ ok: true });
      await p;
    }));
  });

  // ── setPlayback ──────────────────────────────────────────────────────────────

  describe('setPlayback()', () => {
    beforeEach(fakeAsync(async () => {
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
    }));

    it('sets isPlaying=false on pause', fakeAsync(async () => {
      const p = service.setPlayback('pause');
      http.expectOne('/api/music/playback').flush({ ok: true });
      await p;

      expect(service.nowPlaying()?.isPlaying).toBe(false);
    }));

    it('sets isPlaying=true on play', fakeAsync(async () => {
      const p = service.setPlayback('play');
      http.expectOne('/api/music/playback').flush({ ok: true });
      await p;

      expect(service.nowPlaying()?.isPlaying).toBe(true);
    }));
  });

  // ── addAdmin ─────────────────────────────────────────────────────────────────

  describe('addAdmin()', () => {
    it('POSTs and appends to admins signal', fakeAsync(async () => {
      const p = service.addAdmin({ platform: 'twitch', platformUserId: 'uid1', username: 'moduser' });
      http.expectOne('/api/music/admins').flush(ADMIN);
      const result = await p;

      expect(result).toEqual(ADMIN);
      expect(service.admins()).toContainEqual(ADMIN);
    }));

    it('updates existing admin in list instead of duplicating', fakeAsync(async () => {
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
    }));
  });

  // ── removeAdmin ──────────────────────────────────────────────────────────────

  describe('removeAdmin()', () => {
    it('DELETEs and removes from admins signal', fakeAsync(async () => {
      const seedP = service.loadAdmins();
      http.expectOne('/api/music/admins').flush([ADMIN]);
      await seedP;

      const p = service.removeAdmin(1);
      http.expectOne('/api/music/admins/1').flush({ ok: true });
      await p;

      expect(service.admins()).toHaveLength(0);
    }));
  });

  // ── search ───────────────────────────────────────────────────────────────────

  describe('search()', () => {
    it('returns track list from API', fakeAsync(async () => {
      const p = service.search('test song');
      http.expectOne((r) => r.url.includes('/api/music/search')).flush([TRACK]);
      const result = await p;

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Song');
    }));

    it('encodes the search query in the URL', fakeAsync(async () => {
      const p = service.search('hello world');
      const req = http.expectOne((r) => r.url.includes('hello'));
      expect(req.request.url).toContain('hello%20world');
      req.flush([]);
      await p;
    }));
  });

  // ── addToQueue ───────────────────────────────────────────────────────────────

  describe('addToQueue()', () => {
    it('POSTs the correct payload', fakeAsync(async () => {
      const p = service.addToQueue(TRACK);
      const req = http.expectOne('/api/music/queue');
      expect(req.request.body).toMatchObject({
        trackId: TRACK.id,
        trackName: TRACK.name,
        artistName: TRACK.artistName,
      });
      req.flush(QUEUE_ITEM);
      await p;
    }));
  });

  // ── socket events ────────────────────────────────────────────────────────────

  describe('socket events via init()', () => {
    beforeEach(() => {
      service.init();
    });

    it('music.connected: sets spotifyConnected=true and reloads status and queue', fakeAsync(async () => {
      mockSocket.emit('music.connected');
      tick();

      // init() triggers loadStatus and loadQueue on music.connected
      http.expectOne('/api/music/status').flush({ connected: true, nowPlaying: null });
      http.expectOne('/api/music/queue').flush([]);

      expect(service.spotifyConnected()).toBe(true);
    }));

    it('music.disconnected: clears connected, nowPlaying, and queue', fakeAsync(() => {
      // Seed some state first
      service.spotifyConnected.set(true);
      service.nowPlaying.set({
        trackId: 'x', trackName: 'T', artistName: 'A',
        albumArtUrl: null, durationMs: 100, progressMs: 10, isPlaying: true,
      });
      service.queue.set([QUEUE_ITEM]);

      mockSocket.emit('music.disconnected');
      tick();

      expect(service.spotifyConnected()).toBe(false);
      expect(service.nowPlaying()).toBeNull();
      expect(service.queue()).toEqual([]);
    }));

    it('music.track_changed: sets nowPlaying with new track info', fakeAsync(() => {
      const payload = {
        trackId: 'new-track',
        trackName: 'New Song',
        artistName: 'New Artist',
        albumArtUrl: 'https://example.com/art.jpg',
        durationMs: 180000,
      };
      mockSocket.emit('music.track_changed', payload);
      tick();

      expect(service.nowPlaying()?.trackName).toBe('New Song');
      expect(service.nowPlaying()?.progressMs).toBe(0);
      expect(service.nowPlaying()?.isPlaying).toBe(true);
    }));

    it('music.playback_state: updates isPlaying and progress on existing nowPlaying', fakeAsync(() => {
      service.nowPlaying.set({
        trackId: 'x', trackName: 'T', artistName: 'A',
        albumArtUrl: null, durationMs: 200000, progressMs: 0, isPlaying: true,
      });

      mockSocket.emit('music.playback_state', { isPlaying: false, progressMs: 45000, durationMs: 200000 });
      tick();

      expect(service.nowPlaying()?.isPlaying).toBe(false);
      expect(service.nowPlaying()?.progressMs).toBe(45000);
    }));

    it('music.queue_updated: replaces queue signal with new data', fakeAsync(() => {
      const newQueue = [QUEUE_ITEM, { ...QUEUE_ITEM, id: 2, position: 2 }];
      mockSocket.emit('music.queue_updated', { queue: newQueue });
      tick();

      expect(service.queue()).toHaveLength(2);
    }));

    it('init() is a no-op on subsequent calls', fakeAsync(() => {
      service.init(); // second call
      // mockSocket.on should still only have been called once per event type
      const connectedCalls = (mockSocket.on as jest.Mock).mock.calls.filter(([e]) => e === 'music.connected');
      expect(connectedCalls).toHaveLength(1);
    }));
  });

  // ── progress timer ────────────────────────────────────────────────────────────

  describe('progress timer', () => {
    it('increments progressMs by 1000ms each second while isPlaying', fakeAsync(async () => {
      const p = service.loadStatus();
      http.expectOne('/api/music/status').flush({
        connected: true,
        nowPlaying: {
          trackId: 'x', trackName: 'T', artistName: 'A',
          albumArtUrl: null, durationMs: 200000, progressMs: 0, isPlaying: true,
        },
      });
      await p;

      tick(3000);
      expect(service.nowPlaying()?.progressMs).toBe(3000);
    }));

    it('caps progressMs at durationMs', fakeAsync(async () => {
      const p = service.loadStatus();
      http.expectOne('/api/music/status').flush({
        connected: true,
        nowPlaying: {
          trackId: 'x', trackName: 'T', artistName: 'A',
          albumArtUrl: null, durationMs: 5000, progressMs: 4500, isPlaying: true,
        },
      });
      await p;

      tick(2000); // would go to 6500 without cap
      expect(service.nowPlaying()?.progressMs).toBe(5000);
    }));
  });
});
