import {
  Component, inject, signal, computed, OnInit, OnDestroy
} from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SocketService } from '../socket.service';
import { OverlaySettingsService } from '../overlay-settings.service';

const KEY_MAX_ITEMS        = 'overlay.musicQueue.maxItems';
const KEY_SHOW_NOW_PLAYING = 'overlay.musicQueue.showNowPlaying';
const KEY_SHOW_REQUESTERS  = 'overlay.musicQueue.showRequesters';
const KEY_SHOW_ART         = 'overlay.musicQueue.showArt';
const POLL_INTERVAL_MS     = 30_000;

interface NowPlaying {
  trackId: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
}

interface QueueItem {
  id: number;
  track_name: string;
  artist_name: string;
  album_art_url: string | null;
  requester_display_name: string | null;
  requester_platform: string | null;
  source: 'request' | 'playlist' | 'streamer';
}

@Component({
  selector: 'overlay-music-queue',
  standalone: true,
  animations: [
    trigger('item', [
      transition(':enter', [
        style({ transform: 'translateY(-8px)', opacity: 0 }),
        animate('220ms cubic-bezier(0.2, 0, 0, 1)', style({ transform: 'none', opacity: 1 })),
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ opacity: 0, transform: 'translateY(-6px)' })),
      ]),
    ]),
  ],
  styles: [`
    :host {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      padding: 16px;
      box-sizing: border-box;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* ── Now Playing ────────────────────────────────── */
    .np-card {
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(8px);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 6px;
      border-left: 3px solid #1db954;
    }

    .np-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #1db954;
      margin-bottom: 7px;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .np-label-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #1db954;
      animation: pulse 1.8s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }

    .np-row {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .np-art {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .np-art-placeholder {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .np-info {
      flex: 1;
      min-width: 0;
    }

    .np-track {
      font-size: 13px;
      font-weight: 700;
      color: rgba(255,255,255,0.97);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }

    .np-artist {
      font-size: 11px;
      color: rgba(255,255,255,0.6);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 2px;
    }

    .np-progress {
      margin-top: 7px;
      height: 2px;
      background: rgba(255,255,255,0.12);
      border-radius: 2px;
      overflow: hidden;
    }

    .np-progress-fill {
      height: 100%;
      background: #1db954;
      border-radius: 2px;
      transition: width 0.9s linear;
    }

    /* ── Up next header ─────────────────────────────── */
    .upcoming-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: rgba(255,255,255,0.4);
      padding: 0 2px;
      margin-bottom: 4px;
    }

    /* ── Queue items ────────────────────────────────── */
    .queue-item {
      background: rgba(0, 0, 0, 0.60);
      backdrop-filter: blur(6px);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .q-art {
      width: 34px;
      height: 34px;
      border-radius: 5px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .q-art-placeholder {
      width: 34px;
      height: 34px;
      border-radius: 5px;
      background: rgba(255,255,255,0.08);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
    }

    .q-info {
      flex: 1;
      min-width: 0;
    }

    .q-track {
      font-size: 12px;
      font-weight: 600;
      color: rgba(255,255,255,0.92);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }

    .q-artist {
      font-size: 10px;
      color: rgba(255,255,255,0.5);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 1px;
    }

    .q-requester {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 8px;
      flex-shrink: 0;
      max-width: 80px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `],
  template: `
    @if (showNowPlaying() && nowPlaying()) {
      <div class="np-card" @item>
        <div class="np-label">
          <div class="np-label-dot"></div>
          Now Playing
        </div>
        <div class="np-row">
          @if (showArt()) {
            @if (nowPlaying()!.albumArtUrl) {
              <img class="np-art" [src]="nowPlaying()!.albumArtUrl!" [alt]="nowPlaying()!.trackName" />
            } @else {
              <div class="np-art-placeholder">🎵</div>
            }
          }
          <div class="np-info">
            <div class="np-track">{{ nowPlaying()!.trackName }}</div>
            <div class="np-artist">{{ nowPlaying()!.artistName }}</div>
          </div>
        </div>
        <div class="np-progress">
          <div class="np-progress-fill" [style.width.%]="progressPct()"></div>
        </div>
      </div>
    }

    @if (visibleQueue().length > 0) {
      <div class="upcoming-label">Up Next</div>
      @for (item of visibleQueue(); track item.id) {
        <div class="queue-item" @item>
          @if (showArt()) {
            @if (item.album_art_url) {
              <img class="q-art" [src]="item.album_art_url" [alt]="item.track_name" />
            } @else {
              <div class="q-art-placeholder">🎵</div>
            }
          }
          <div class="q-info">
            <div class="q-track">{{ item.track_name }}</div>
            <div class="q-artist">{{ item.artist_name }}</div>
          </div>
          @if (showRequesters() && item.requester_display_name) {
            <span class="q-requester"
                  [style.color]="platformColor(item.requester_platform ?? '')"
                  [style.background]="platformColor(item.requester_platform ?? '') + '22'"
                  [style.border]="'1px solid ' + platformColor(item.requester_platform ?? '') + '44'">
              {{ item.requester_display_name }}
            </span>
          }
        </div>
      }
    }
  `,
})
export class MusicQueueOverlayComponent implements OnInit, OnDestroy {
  private readonly socket  = inject(SocketService);
  private readonly settings = inject(OverlaySettingsService);
  private readonly http    = inject(HttpClient);

  readonly nowPlaying      = signal<NowPlaying | null>(null);
  readonly queue           = signal<QueueItem[]>([]);
  readonly maxItems        = signal<number>(5);
  readonly showNowPlaying  = signal<boolean>(true);
  readonly showRequesters  = signal<boolean>(true);
  readonly showArt         = signal<boolean>(true);

  private _progressInterval: ReturnType<typeof setInterval> | null = null;
  private _settingsPollInterval: ReturnType<typeof setInterval> | null = null;

  readonly progressPct = computed(() => {
    const np = this.nowPlaying();
    if (!np || !np.durationMs) return 0;
    return Math.min((np.progressMs / np.durationMs) * 100, 100);
  });

  readonly visibleQueue = computed(() =>
    this.queue().slice(0, this.maxItems())
  );

  ngOnInit(): void {
    this._fetchAll();
    this._settingsPollInterval = setInterval(() => this._fetchSettings(), POLL_INTERVAL_MS);

    this.socket.socket.on('ottery:overlay-settings', (s: Record<string, unknown>) => {
      this._applySettings(s);
    });

    this.socket.socket.on('music.track_changed', (data: {
      trackId: string; trackName: string; artistName: string;
      albumArtUrl: string; durationMs: number;
    }) => {
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
    });

    this.socket.socket.on('music.playback_state', (data: {
      isPlaying: boolean; progressMs: number; durationMs: number;
    }) => {
      this.nowPlaying.update((prev) =>
        prev ? { ...prev, isPlaying: data.isPlaying, progressMs: data.progressMs, durationMs: data.durationMs } : prev
      );
      if (data.isPlaying) this._startProgressTimer();
      else this._stopProgressTimer();
    });

    this.socket.socket.on('music.queue_updated', (data: { queue: QueueItem[] }) => {
      this.queue.set(data.queue);
    });

    this.socket.socket.on('music.disconnected', () => {
      this.nowPlaying.set(null);
      this.queue.set([]);
      this._stopProgressTimer();
    });
  }

  ngOnDestroy(): void {
    this._stopProgressTimer();
    if (this._settingsPollInterval !== null) clearInterval(this._settingsPollInterval);
  }

  platformColor(platform: string): string {
    return this.settings.platformColor(platform);
  }

  private async _fetchAll(): Promise<void> {
    try {
      const [settingsData, statusData, queueData] = await Promise.all([
        firstValueFrom(this.http.get<Record<string, unknown>>('/api/settings')),
        firstValueFrom(this.http.get<{ connected: boolean; nowPlaying: NowPlaying | null }>('/api/music/status')).catch(() => null),
        firstValueFrom(this.http.get<QueueItem[]>('/api/music/queue')).catch(() => []),
      ]);
      this._applySettings(settingsData);
      if (statusData?.nowPlaying) {
        this.nowPlaying.set(statusData.nowPlaying);
        if (statusData.nowPlaying.isPlaying) this._startProgressTimer();
      }
      this.queue.set(queueData ?? []);
    } catch { /* keep defaults */ }
  }

  private async _fetchSettings(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<Record<string, unknown>>('/api/settings'));
      this._applySettings(s);
    } catch { /* keep current */ }
  }

  private _applySettings(s: Record<string, unknown>): void {
    if (s[KEY_MAX_ITEMS] != null)        this.maxItems.set(Number(s[KEY_MAX_ITEMS]));
    if (s[KEY_SHOW_NOW_PLAYING] != null) this.showNowPlaying.set(Boolean(s[KEY_SHOW_NOW_PLAYING]));
    if (s[KEY_SHOW_REQUESTERS] != null)  this.showRequesters.set(Boolean(s[KEY_SHOW_REQUESTERS]));
    if (s[KEY_SHOW_ART] != null)         this.showArt.set(Boolean(s[KEY_SHOW_ART]));
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
}
