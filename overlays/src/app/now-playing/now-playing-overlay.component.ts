import {
  Component, inject, signal, computed, OnInit, OnDestroy
} from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SocketService } from '../socket.service';
import { OverlaySettingsService } from '../overlay-settings.service';

const KEY_SHOW_ART       = 'overlay.nowPlaying.showArt';
const KEY_SHOW_ARTIST    = 'overlay.nowPlaying.showArtist';
const KEY_SHOW_PROGRESS  = 'overlay.nowPlaying.showProgress';
const KEY_SHOW_REQUESTER = 'overlay.nowPlaying.showRequester';
const POLL_INTERVAL_MS   = 30_000;

interface NowPlaying {
  trackId: string;
  trackName: string;
  artistName: string;
  albumArtUrl: string | null;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
}

interface Requester {
  displayName: string;
  platform: string;
}

interface QueueItem {
  status: string;
  requester_display_name: string | null;
  requester_platform: string | null;
}

@Component({
  selector: 'overlay-now-playing',
  standalone: true,
  animations: [
    trigger('widget', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(10px)' }),
        animate('300ms cubic-bezier(0.2, 0, 0, 1)', style({ opacity: 1, transform: 'none' })),
      ]),
      transition(':leave', [
        animate('240ms ease-in', style({ opacity: 0, transform: 'translateY(6px)' })),
      ]),
    ]),
    trigger('art', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.94)' }),
        animate('280ms cubic-bezier(0.2, 0, 0, 1)', style({ opacity: 1, transform: 'none' })),
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

    .widget {
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      overflow: hidden;
      border-left: 3px solid #1db954;
    }

    /* ── Art banner (full width, shown when showArt=true) ── */
    .art-banner {
      width: 100%;
      aspect-ratio: 1 / 1;
      object-fit: cover;
      display: block;
    }

    .art-placeholder {
      width: 100%;
      aspect-ratio: 1 / 1;
      background: rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 64px;
    }

    /* ── Info row ── */
    .info {
      padding: 12px 14px 10px;
    }

    /* ── Inline layout (no art): art thumb + text side by side ── */
    .widget.inline .info {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
    }

    .art-thumb {
      width: 52px;
      height: 52px;
      border-radius: 7px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .art-thumb-placeholder {
      width: 52px;
      height: 52px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.08);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }

    .text {
      flex: 1;
      min-width: 0;
    }

    .np-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.4px;
      color: #1db954;
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .np-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #1db954;
      animation: pulse 1.8s ease-in-out infinite;
      flex-shrink: 0;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.35; }
    }

    .track-name {
      font-size: 15px;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.97);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.2;
    }

    .artist-name {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.55);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 3px;
    }

    /* ── Progress bar ── */
    .progress-wrap {
      padding: 0 14px 12px;
    }

    .widget.inline .progress-wrap {
      padding: 0 12px 10px;
    }

    .progress-bar {
      height: 3px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 4px;
    }

    .progress-fill {
      height: 100%;
      background: #1db954;
      border-radius: 2px;
      transition: width 0.9s linear;
    }

    .progress-times {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.3);
      font-family: 'JetBrains Mono', monospace;
    }

    .requester-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 5px;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 8px;
    }

    .requester-label {
      font-weight: 400;
      opacity: 0.7;
      margin-right: 1px;
    }
  `],
  template: `
    @if (nowPlaying()) {
      <div class="widget" [class.inline]="!showArt()" @widget>

        @if (showArt()) {
          @if (nowPlaying()!.albumArtUrl) {
            <img class="art-banner" @art [src]="nowPlaying()!.albumArtUrl!" [alt]="nowPlaying()!.trackName" />
          } @else {
            <div class="art-placeholder">🎵</div>
          }
          <div class="info">
            <div class="np-label"><div class="np-dot"></div> Now Playing</div>
            <div class="text">
              <div class="track-name">{{ nowPlaying()!.trackName }}</div>
              @if (showArtist()) {
                <div class="artist-name">{{ nowPlaying()!.artistName }}</div>
              }
              @if (showRequester() && currentRequester()) {
                <div class="requester-badge"
                     [style.color]="platformColor(currentRequester()!.platform)"
                     [style.background]="platformColor(currentRequester()!.platform) + '22'"
                     [style.border]="'1px solid ' + platformColor(currentRequester()!.platform) + '44'">
                  <span class="requester-label">req.</span>{{ currentRequester()!.displayName }}
                </div>
              }
            </div>
          </div>
        } @else {
          <!-- Inline: thumb + text side by side -->
          <div class="info">
            @if (nowPlaying()!.albumArtUrl) {
              <img class="art-thumb" @art [src]="nowPlaying()!.albumArtUrl!" [alt]="nowPlaying()!.trackName" />
            } @else {
              <div class="art-thumb-placeholder">🎵</div>
            }
            <div class="text">
              <div class="np-label"><div class="np-dot"></div> Now Playing</div>
              <div class="track-name">{{ nowPlaying()!.trackName }}</div>
              @if (showArtist()) {
                <div class="artist-name">{{ nowPlaying()!.artistName }}</div>
              }
              @if (showRequester() && currentRequester()) {
                <div class="requester-badge"
                     [style.color]="platformColor(currentRequester()!.platform)"
                     [style.background]="platformColor(currentRequester()!.platform) + '22'"
                     [style.border]="'1px solid ' + platformColor(currentRequester()!.platform) + '44'">
                  <span class="requester-label">req.</span>{{ currentRequester()!.displayName }}
                </div>
              }
            </div>
          </div>
        }

        @if (showProgress()) {
          <div class="progress-wrap">
            <div class="progress-bar">
              <div class="progress-fill" [style.width.%]="progressPct()"></div>
            </div>
            <div class="progress-times">
              <span>{{ fmtMs(nowPlaying()!.progressMs) }}</span>
              <span>{{ fmtMs(nowPlaying()!.durationMs) }}</span>
            </div>
          </div>
        }

      </div>
    }
  `,
})
export class NowPlayingOverlayComponent implements OnInit, OnDestroy {
  private readonly socket   = inject(SocketService);
  private readonly http     = inject(HttpClient);
  private readonly settings = inject(OverlaySettingsService);

  readonly nowPlaying       = signal<NowPlaying | null>(null);
  readonly currentRequester = signal<Requester | null>(null);
  readonly showArt          = signal<boolean>(true);
  readonly showArtist       = signal<boolean>(true);
  readonly showProgress     = signal<boolean>(true);
  readonly showRequester    = signal<boolean>(true);

  private _progressInterval: ReturnType<typeof setInterval> | null = null;
  private _settingsPollInterval: ReturnType<typeof setInterval> | null = null;

  readonly progressPct = computed(() => {
    const np = this.nowPlaying();
    if (!np || !np.durationMs) return 0;
    return Math.min((np.progressMs / np.durationMs) * 100, 100);
  });

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
      this.currentRequester.set(null); // will be set by queue_updated
      this._startProgressTimer();
    });

    this.socket.socket.on('music.queue_updated', (data: { queue: QueueItem[] }) => {
      const playing = data.queue.find((i) => i.status === 'playing');
      this.currentRequester.set(
        playing?.requester_display_name
          ? { displayName: playing.requester_display_name, platform: playing.requester_platform ?? '' }
          : null
      );
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

    this.socket.socket.on('music.disconnected', () => {
      this.nowPlaying.set(null);
      this._stopProgressTimer();
    });
  }

  ngOnDestroy(): void {
    this._stopProgressTimer();
    if (this._settingsPollInterval !== null) clearInterval(this._settingsPollInterval);
  }

  fmtMs(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }

  platformColor(platform: string): string {
    return this.settings.platformColor(platform);
  }

  private async _fetchAll(): Promise<void> {
    try {
      const [settingsData, statusData, queueData] = await Promise.all([
        firstValueFrom(this.http.get<Record<string, unknown>>('/api/settings')),
        firstValueFrom(this.http.get<{ connected: boolean; nowPlaying: NowPlaying | null }>('/api/music/status')).catch(() => null),
        firstValueFrom(this.http.get<QueueItem[]>('/api/music/queue')).catch(() => [] as QueueItem[]),
      ]);
      this._applySettings(settingsData);
      if (statusData?.nowPlaying) {
        this.nowPlaying.set(statusData.nowPlaying);
        if (statusData.nowPlaying.isPlaying) this._startProgressTimer();
      }
      const playing = queueData.find((i) => i.status === 'playing');
      this.currentRequester.set(
        playing?.requester_display_name
          ? { displayName: playing.requester_display_name, platform: playing.requester_platform ?? '' }
          : null
      );
    } catch { /* keep defaults */ }
  }

  private async _fetchSettings(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<Record<string, unknown>>('/api/settings'));
      this._applySettings(s);
    } catch { /* keep current */ }
  }

  private _applySettings(s: Record<string, unknown>): void {
    if (s[KEY_SHOW_ART] != null)       this.showArt.set(Boolean(s[KEY_SHOW_ART]));
    if (s[KEY_SHOW_ARTIST] != null)    this.showArtist.set(Boolean(s[KEY_SHOW_ARTIST]));
    if (s[KEY_SHOW_PROGRESS] != null)  this.showProgress.set(Boolean(s[KEY_SHOW_PROGRESS]));
    if (s[KEY_SHOW_REQUESTER] != null) this.showRequester.set(Boolean(s[KEY_SHOW_REQUESTER]));
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
