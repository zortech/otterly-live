import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SocketService } from './socket.service';

const DEFAULT_COLORS: Record<string, string> = {
  twitch:   '#9146ff',
  youtube:  '#ff0000',
  kick:     '#53fc18',
  tiktok:   '#fe2c55',
  x:        '#c9cdd1',
  joystick: '#8b5cf6',
  otterly:  '#f59e0b',
};

const KEY_COLORS               = 'overlay.chat.platformColors';
const KEY_FADE_TIMEOUT         = 'overlay.chat.fadeTimeout';
const KEY_HIDDEN               = 'overlay.chat.hiddenPlatforms';
const KEY_FONT_SIZE            = 'overlay.chat.fontSize';
const KEY_MAX_MESSAGES         = 'overlay.chat.maxMessages';
const KEY_NOTIFICATION_FILTERS = 'overlay.chat.notificationFilters';

const POLL_INTERVAL_MS = 30_000;

// All notification event types (not chat.message)
// Key → human label mapping used by the overlay to format messages
export const NOTIFICATION_TYPES = [
  'follow', 'subscribe', 'subscribe.gift', 'cheer', 'tip',
  'redeem', 'otterly.redeem', 'otterly.credit_count', 'otterly.playing',
] as const;

export type NotificationType = typeof NOTIFICATION_TYPES[number];

@Injectable({ providedIn: 'root' })
export class OverlaySettingsService {
  private readonly http   = inject(HttpClient);
  private readonly socket = inject(SocketService);

  readonly platformColors  = signal<Record<string, string>>({ ...DEFAULT_COLORS });
  readonly fadeTimeout     = signal<number>(0);
  readonly hiddenPlatforms = signal<Set<string>>(new Set());
  readonly fontSize        = signal<number>(14);
  readonly maxMessages     = signal<number>(30);

  // platform → Set of DISABLED notification event types (empty Set = all enabled)
  readonly notificationFilters = signal<Record<string, Set<string>>>({});

  constructor() {
    this.fetchAndApply();
    setInterval(() => this.fetchAndApply(), POLL_INTERVAL_MS);

    this.socket.socket.on('ottery:overlay-settings', (s: Record<string, unknown>) => {
      this.applySettings(s);
    });
  }

  private async fetchAndApply(): Promise<void> {
    try {
      const s = await firstValueFrom(
        this.http.get<Record<string, unknown>>('/api/settings')
      );
      this.applySettings(s);
    } catch { /* network error — keep current values */ }
  }

  private applySettings(s: Record<string, unknown>): void {
    if (s[KEY_COLORS] != null)
      this.platformColors.set({ ...DEFAULT_COLORS, ...(s[KEY_COLORS] as Record<string, string>) });
    if (s[KEY_FADE_TIMEOUT] != null)
      this.fadeTimeout.set(Number(s[KEY_FADE_TIMEOUT]));
    if (s[KEY_HIDDEN] != null)
      this.hiddenPlatforms.set(new Set(s[KEY_HIDDEN] as string[]));
    if (s[KEY_FONT_SIZE] != null)
      this.fontSize.set(Number(s[KEY_FONT_SIZE]));
    if (s[KEY_MAX_MESSAGES] != null)
      this.maxMessages.set(Number(s[KEY_MAX_MESSAGES]));
    if (s[KEY_NOTIFICATION_FILTERS] != null) {
      const raw = s[KEY_NOTIFICATION_FILTERS] as Record<string, string[]>;
      const filters: Record<string, Set<string>> = {};
      for (const [platform, types] of Object.entries(raw)) {
        filters[platform] = new Set(types);
      }
      this.notificationFilters.set(filters);
    }
  }

  platformColor(platform: string): string {
    return this.platformColors()[platform] ?? '#7c8aa0';
  }

  /** Returns true if the notification type should be shown for the given platform. */
  isNotificationEnabled(platform: string, eventType: string): boolean {
    const disabled = this.notificationFilters()[platform];
    if (!disabled) return true;
    return !disabled.has(eventType);
  }
}
