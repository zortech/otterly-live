import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';

export type Platform = 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'x' | 'joystick' | 'otterly';

export type EventType =
  | 'chat.message' | 'follow' | 'subscribe' | 'subscribe.gift'
  | 'cheer' | 'tip' | 'like' | 'share' | 'raid' | 'redeem'
  | 'stream.start' | 'stream.end' | 'viewer_count'
  | 'system.capture_connected' | 'system.capture_disconnected' | 'system.capture_error'
  | 'otterly.redeem' | 'otterly.credit_count' | 'otterly.playing'
  | 'music.sr_added' | 'music.sr_rejected';

export interface EventActor {
  platformId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  isSubscriber?: boolean;
  isModerator?: boolean;
}

export interface OtteryEvent {
  id: string;
  sessionId: number | null;
  platform: Platform;
  type: EventType;
  timestamp: string;
  actor: EventActor | null;
  data: Record<string, unknown>;
}

export interface SessionStats {
  follows: number;
  subs: number;
  giftSubs: number;
  cheers: number;
  tips: number;
  peakViewers: number;
  raids: number;
  chatMessages: number;
}

export interface PlatformStatus {
  serviceId: number;
  platform?: string;
  status: 'live' | 'stopped' | 'error' | 'connecting';
  reason?: string;
  type?: 'capture' | 'restream';
  startedAt?: number;
}

export interface PlatformProgress {
  serviceId: number;
  platform?: string;
  frames: number;
  dropped: number;
  // Receive time on the client — used together with previous sample to compute drop rate.
  receivedAt: number;
}

export interface PlatformWarning {
  serviceId: number;
  platform?: string;
  message: string;
  at: number;
}

export interface AuthRequired {
  serviceId: number;
  platform: string;
  message?: string;
}

export interface RelaySocketEvent {
  event:   'streamReceived' | 'connected' | 'reconnecting' | 'error';
  reason?: string;
  attempt?: number;
  delayMs?: number;
}

@Injectable({ providedIn: 'root' })
export class OtteryLiveService {
  readonly sessionState = signal<'idle' | 'live' | 'ended'>('idle');
  readonly activeSessionId = signal<number | null>(null);
  readonly sessionStartedAt = signal<number | null>(null);
  readonly platformStatuses = signal<Record<number, PlatformStatus>>({});
  readonly events = signal<OtteryEvent[]>([]);
  readonly connected = signal(false);
  readonly authRequired = signal<Record<number, AuthRequired>>({});
  readonly sessionStats = signal<SessionStats>({ follows: 0, subs: 0, giftSubs: 0, cheers: 0, tips: 0, peakViewers: 0, raids: 0, chatMessages: 0 });
  readonly liveViewers = signal<Record<string, number>>({});
  readonly relayStatus = signal<RelaySocketEvent | null>(null);
  // Latest progress sample per serviceId. Previous sample lives in _prevProgress
  // so drop *rate* can be derived; readers see only the latest signal value.
  readonly platformProgress = signal<Record<number, PlatformProgress>>({});
  readonly platformProgressPrev = signal<Record<number, PlatformProgress>>({});
  // Per-serviceId warning history (newest first, capped). Cleared when the
  // session ends so a fresh stream starts clean.
  readonly platformWarnings = signal<Record<number, PlatformWarning[]>>({});

  readonly socket: Socket;

  constructor() {
    const port = window.otteryElectron?.serverPort ?? 3737;
    this.socket = io(`http://localhost:${port}`, {
      transports: ['websocket'],
    });

    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));

    this.socket.on('ottery:event', (e: OtteryEvent) =>
      this.events.update((prev) => [e, ...prev].slice(0, 500))
    );

    this.socket.on(
      'ottery:status',
      (d: PlatformStatus) =>
        this.platformStatuses.update((s) => ({ ...s, [d.serviceId]: d }))
    );

    this.socket.on(
      'ottery:session',
      (d: { state: 'idle' | 'live' | 'ended'; sessionId?: number | null }) => {
        this.sessionState.set(d.state);
        if (d.state === 'live') {
          if (d.sessionId != null) this.activeSessionId.set(d.sessionId);
          if (!this.sessionStartedAt()) this.sessionStartedAt.set(Date.now());
        } else {
          this.sessionStartedAt.set(null);
        }
        if (d.state === 'idle') {
          this.events.set([]);
          this.platformStatuses.set({});
          this.sessionStats.set({ follows: 0, subs: 0, giftSubs: 0, cheers: 0, tips: 0, peakViewers: 0, raids: 0, chatMessages: 0 });
          this.liveViewers.set({});
          this.platformProgress.set({});
          this.platformProgressPrev.set({});
          this.platformWarnings.set({});
        }
      }
    );

    this.socket.on('ottery:stats', (d: SessionStats) => this.sessionStats.set(d));
    this.socket.on('ottery:viewers', (d: Record<string, number>) => this.liveViewers.set(d));
    this.socket.on('ottery:relay', (d: RelaySocketEvent) => this.relayStatus.set(d));

    this.socket.on(
      'ottery:progress',
      (d: { serviceId: number; platform?: string; frames: number; dropped: number }) => {
        const sample: PlatformProgress = { ...d, receivedAt: Date.now() };
        // Move the current latest sample into "prev" so rate is computed against it.
        const prev = this.platformProgress()[d.serviceId];
        if (prev) {
          this.platformProgressPrev.update((s) => ({ ...s, [d.serviceId]: prev }));
        }
        this.platformProgress.update((s) => ({ ...s, [d.serviceId]: sample }));
      }
    );

    this.socket.on(
      'ottery:warning',
      (d: { serviceId: number; platform?: string; message: string; at: number }) => {
        this.platformWarnings.update((s) => {
          const prev = s[d.serviceId] ?? [];
          // Cap per-platform warning history at 50 entries to bound memory.
          const next = [{ ...d }, ...prev].slice(0, 50);
          return { ...s, [d.serviceId]: next };
        });
      }
    );

    this.socket.on('ottery:auth', (d: AuthRequired) => {
      if (d.serviceId) {
        this.authRequired.update((s) => ({ ...s, [d.serviceId]: d }));
      }
    });
  }

  hydrateStatuses(data: Record<number, PlatformStatus>): void {
    this.platformStatuses.update((s) => ({ ...s, ...data }));
  }

  clearAuthRequired(serviceId: number): void {
    this.authRequired.update((s) => {
      const next = { ...s };
      delete next[serviceId];
      return next;
    });
  }
}
