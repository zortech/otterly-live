import { Injectable, signal, inject, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { OtteryLiveService } from '../ottery-live.service';

export interface NowPlaying {
  trackId: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
}

export interface QueueItem {
  id: number;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string | null;
  album_art_url: string | null;
  duration_ms: number;
  requester_username: string | null;
  requester_display_name: string | null;
  requester_platform: string | null;
  source: 'request' | 'playlist' | 'streamer';
  position: number;
  status: 'queued' | 'playing' | 'played' | 'removed';
}

export interface SpotifyAdmin {
  id: number;
  platform: string;
  platform_user_id: string;
  username: string;
  granted_by: string | null;
  created_at: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  trackCount: number | null;
  imageUrl: string | null;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artistName: string;
  albumName: string | null;
  albumArtUrl: string | null;
  durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class MusicService {
  private readonly http = inject(HttpClient);
  private readonly otterly = inject(OtteryLiveService);
  private readonly zone = inject(NgZone);

  readonly spotifyConnected = signal(false);
  readonly nowPlaying = signal<NowPlaying | null>(null);
  readonly queue = signal<QueueItem[]>([]);
  readonly recentPlays = signal<QueueItem[]>([]);
  readonly admins = signal<SpotifyAdmin[]>([]);
  readonly playlists = signal<SpotifyPlaylist[]>([]);

  private _progressInterval: ReturnType<typeof setInterval> | null = null;
  private _initialized = false;

  init(): void {
    if (this._initialized) return;
    this._initialized = true;

    const socket = this.otterly.socket;

    socket.on('music.connected', () => this.zone.run(() => {
      this.spotifyConnected.set(true);
      this.loadStatus();
      this.loadQueue();
      this.loadRecentPlays();
    }));

    socket.on('music.disconnected', () => this.zone.run(() => {
      this.spotifyConnected.set(false);
      this.nowPlaying.set(null);
      this.queue.set([]);
      this._stopProgressTimer();
    }));

    socket.on('music.track_changed', (data: {
      trackId: string; trackName: string; artistName: string;
      albumArtUrl: string; durationMs: number;
    }) => this.zone.run(() => {
      this.nowPlaying.set({
        trackId: data.trackId,
        trackName: data.trackName,
        artistName: data.artistName,
        albumArtUrl: data.albumArtUrl ?? null,
        durationMs: data.durationMs,
        progressMs: 0,
        isPlaying: true,
      });
      this._startProgressTimer();
    }));

    socket.on('music.playback_state', (data: { isPlaying: boolean; progressMs: number; durationMs: number }) => this.zone.run(() => {
      this.nowPlaying.update((prev) =>
        prev ? { ...prev, isPlaying: data.isPlaying, progressMs: data.progressMs, durationMs: data.durationMs } : prev
      );
      if (data.isPlaying) this._startProgressTimer();
      else this._stopProgressTimer();
    }));

    socket.on('music.queue_updated', (data: { queue: QueueItem[]; history?: QueueItem[] }) => this.zone.run(() => {
      this.queue.set(data.queue);
      if (data.history) this.recentPlays.set(data.history);
    }));
  }

  async loadStatus(): Promise<void> {
    try {
      const data = await firstValueFrom(
        this.http.get<{ connected: boolean; nowPlaying: NowPlaying | null }>('/api/music/status')
      );
      this.spotifyConnected.set(data.connected);
      this.nowPlaying.set(data.nowPlaying);
      if (data.nowPlaying?.isPlaying) this._startProgressTimer();
    } catch { /* silent */ }
  }

  async loadQueue(): Promise<void> {
    try {
      const q = await firstValueFrom(this.http.get<QueueItem[]>('/api/music/queue'));
      this.queue.set(q);
    } catch { /* silent */ }
  }

  async loadRecentPlays(): Promise<void> {
    try {
      const h = await firstValueFrom(this.http.get<QueueItem[]>('/api/music/queue/history'));
      this.recentPlays.set(h);
    } catch { /* silent */ }
  }

  async loadAdmins(): Promise<void> {
    try {
      const a = await firstValueFrom(this.http.get<SpotifyAdmin[]>('/api/music/admins'));
      this.admins.set(a);
    } catch { /* silent */ }
  }

  async loadPlaylists(): Promise<void> {
    try {
      const p = await firstValueFrom(this.http.get<SpotifyPlaylist[]>('/api/music/playlists'));
      this.playlists.set(p);
    } catch { /* silent */ }
  }

  async skip(): Promise<void> {
    await firstValueFrom(this.http.post('/api/music/skip', {}));
  }

  async setPlayback(action: 'play' | 'pause'): Promise<void> {
    await firstValueFrom(this.http.put('/api/music/playback', { action }));
    this.nowPlaying.update((prev) =>
      prev ? { ...prev, isPlaying: action === 'play' } : prev
    );
    if (action === 'play') this._startProgressTimer();
    else this._stopProgressTimer();
  }

  async removeQueueItem(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/music/queue/${id}`));
  }

  async bumpQueueItem(id: number, direction: 'up' | 'down'): Promise<void> {
    await firstValueFrom(this.http.post(`/api/music/queue/${id}/bump`, { direction }));
  }

  async addToQueue(track: SpotifyTrack): Promise<void> {
    await firstValueFrom(this.http.post('/api/music/queue', {
      trackId: track.id,
      trackName: track.name,
      artistName: track.artistName,
      albumName: track.albumName,
      albumArtUrl: track.albumArtUrl,
      durationMs: track.durationMs,
    }));
  }

  async search(q: string): Promise<SpotifyTrack[]> {
    return firstValueFrom(
      this.http.get<SpotifyTrack[]>(`/api/music/search?q=${encodeURIComponent(q)}`)
    );
  }

  async addAdmin(data: { platform: string; platformUserId: string; username: string }): Promise<SpotifyAdmin> {
    const result = await firstValueFrom(
      this.http.post<SpotifyAdmin>('/api/music/admins', {
        platform: data.platform,
        platformUserId: data.platformUserId,
        username: data.username,
      })
    );
    this.admins.update((list) => {
      const idx = list.findIndex((a) => a.id === result.id);
      if (idx >= 0) {
        const updated = [...list];
        updated[idx] = result;
        return updated;
      }
      return [...list, result];
    });
    return result;
  }

  async removeAdmin(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/music/admins/${id}`));
    this.admins.update((list) => list.filter((a) => a.id !== id));
  }

  private _startProgressTimer(): void {
    this._stopProgressTimer();
    this._progressInterval = setInterval(() => {
      this.nowPlaying.update((prev) => {
        if (!prev || !prev.isPlaying) return prev;
        return { ...prev, progressMs: Math.min(prev.progressMs + 1000, prev.durationMs) };
      });
    }, 1000);
  }

  private _stopProgressTimer(): void {
    if (this._progressInterval !== null) {
      clearInterval(this._progressInterval);
      this._progressInterval = null;
    }
  }

  destroy(): void {
    this._stopProgressTimer();
  }
}
