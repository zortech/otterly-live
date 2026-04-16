import {
  Component, inject, signal, computed, effect, OnInit, OnDestroy,
  ViewChild, ElementRef, AfterViewChecked, NgZone,
} from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SocketService, OtteryEvent } from '../socket.service';
import { OverlaySettingsService, ExitAnimation } from '../overlay-settings.service';

interface ChatEntry {
  id: string;
  kind: 'chat' | 'notification';
  platform: string;
  displayName: string;
  // chat
  message?: string;
  rawData?: Record<string, unknown>;
  // notification
  icon?: string;
  notifText?: string;
  timestamp: string;
}

// Static test pattern entries shown when not live
const TEST_ENTRIES: ChatEntry[] = [
  { id: 'test-1', kind: 'chat',         platform: 'twitch',  displayName: 'StreamFan99',   message: 'Hey everyone, PogChamp this stream is great!',  rawData: {}, timestamp: '' },
  { id: 'test-2', kind: 'notification', platform: 'twitch',  displayName: 'TwitchUser',    icon: '♥',  notifText: 'TwitchUser followed!',                timestamp: '' },
  { id: 'test-3', kind: 'chat',         platform: 'youtube', displayName: 'YouTubeViewer', message: 'Hello from YouTube! 👋',                          rawData: {}, timestamp: '' },
  { id: 'test-4', kind: 'chat',         platform: 'kick',    displayName: 'KickWatcher',   message: 'Kick chat checking in',                           rawData: {}, timestamp: '' },
  { id: 'test-5', kind: 'notification', platform: 'twitch',  displayName: 'SubGifter',     icon: '🎁', notifText: 'SubGifter gifted 5 subs!',             timestamp: '' },
  { id: 'test-6', kind: 'chat',         platform: 'tiktok',  displayName: 'TikTokFan',     message: 'Watching from TikTok 🔥',                         rawData: {}, timestamp: '' },
  { id: 'test-7', kind: 'chat',         platform: 'twitch',  displayName: 'AnotherViewer', message: 'This is a placement preview — go live to see real chat', rawData: {}, timestamp: '' },
];

// Emoji icons per notification type
const NOTIF_ICONS: Record<string, string> = {
  'follow':              '♥',
  'subscribe':           '⭐',
  'subscribe.gift':      '🎁',
  'cheer':               '💜',
  'tip':                 '💰',
  'redeem':              '🏆',
  'otterly.redeem':      '⭐',
  'otterly.credit_count': '💳',
  'otterly.playing':     '🎵',
};

function formatNotification(event: OtteryEvent): string {
  const name = event.actor?.displayName ?? event.actor?.username ?? 'Someone';
  const d = event.data;

  switch (event.type) {
    case 'follow':
      return `${name} followed!`;
    case 'subscribe': {
      const tier = d['tier'] ? ` (Tier ${d['tier']})` : '';
      return `${name} subscribed${tier}!`;
    }
    case 'subscribe.gift': {
      const count = Number(d['count'] ?? 1);
      return count === 1
        ? `${name} gifted a sub!`
        : `${name} gifted ${count} subs!`;
    }
    case 'cheer': {
      const bits = Number(d['bits'] ?? 0);
      return `${name} cheered ${bits.toLocaleString()} bits!`;
    }
    case 'tip': {
      const giftName = d['giftName'] ? String(d['giftName']) : null;
      if (giftName) {
        const count = Number(d['repeatCount'] ?? 1);
        return count > 1
          ? `${name} sent ${count}x ${giftName}!`
          : `${name} sent ${giftName}!`;
      }
      const amount = Number(d['amount'] ?? 0);
      const currency = String(d['currency'] ?? 'USD');
      return `${name} tipped ${amount.toFixed(2)} ${currency}!`;
    }
    case 'redeem': {
      const reward = String(d['rewardTitle'] ?? d['reward'] ?? 'reward');
      return `${name} redeemed: ${reward}`;
    }
    case 'otterly.redeem': {
      const item = String(d['item'] ?? 'item');
      const cost = Number(d['cost'] ?? 0);
      return `${name} redeemed ${item} (${cost} credits)`;
    }
    case 'otterly.credit_count': {
      const credits = Number(d['credits'] ?? 0);
      return `${name} has ${credits.toLocaleString()} credits`;
    }
    case 'otterly.playing': {
      const title  = String(d['title'] ?? 'Unknown');
      const artist = String(d['artist'] ?? '');
      return artist ? `Now playing: ${title} — ${artist}` : `Now playing: ${title}`;
    }
    default:
      return `${name}: ${event.type}`;
  }
}

interface AnimParams {
  duration: number;
  easing: string;
  transform: string;
  filter: string;
}

const EXIT_ANIMATION_PARAMS: Record<ExitAnimation, AnimParams> = {
  'slide-left':  { duration: 380, easing: 'ease-in',  transform: 'translateX(-20px)',        filter: 'blur(0)' },
  'slide-right': { duration: 380, easing: 'ease-in',  transform: 'translateX(20px)',         filter: 'blur(0)' },
  'slide-up':    { duration: 300, easing: 'ease-in',  transform: 'translateY(-16px)',        filter: 'blur(0)' },
  'dissolve':    { duration: 500, easing: 'ease-in',  transform: 'translateX(0)',            filter: 'blur(0)' },
  'shrink':      { duration: 320, easing: 'ease-in',  transform: 'scale(0.75)',              filter: 'blur(0)' },
  'flip':        { duration: 350, easing: 'ease-in',  transform: 'rotateX(90deg)',           filter: 'blur(0)' },
  'blur-out':    { duration: 420, easing: 'ease-out', transform: 'scale(1.04)',              filter: 'blur(7px)' },
};

const NOTIFICATION_TYPES = new Set([
  'follow', 'subscribe', 'subscribe.gift', 'cheer', 'tip',
  'redeem', 'otterly.redeem', 'otterly.credit_count', 'otterly.playing',
]);

@Component({
  selector: 'overlay-chat',
  standalone: true,
  animations: [
    trigger('msg', [
      transition(':enter', [
        style({ transform: 'translateY(14px)', opacity: 0 }),
        animate('260ms cubic-bezier(0.2, 0, 0, 1)', style({ transform: 'translateY(0)', opacity: 1 })),
      ]),
      transition(':leave', [
        animate('{{ duration }}ms {{ easing }}',
          style({ opacity: 0, transform: '{{ transform }}', filter: '{{ filter }}' })),
      ], { params: { duration: 380, easing: 'ease-in', transform: 'translateX(-20px)', filter: 'blur(0)' } }),
    ]),
  ],
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      position: fixed;
      inset: 0;
      padding: 16px;
      pointer-events: none;
    }

    .chat-feed {
      display: flex;
      flex-direction: column-reverse;
      gap: 5px;
      overflow: hidden;
      max-height: 100%;
      perspective: 600px;
    }

    /* ── Chat message ── */
    .chat-msg {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: rgba(0, 0, 0, 0.6);
      border-radius: 6px;
      padding: 7px 10px 7px 0;
      backdrop-filter: blur(4px);
      line-height: 1.45;
      width: 100%;
      min-width: 0;
    }

    .msg-platform-bar {
      width: 3px;
      align-self: stretch;
      border-radius: 0 2px 2px 0;
      flex-shrink: 0;
    }

    .msg-body {
      flex: 1;
      min-width: 0;
      padding-right: 8px;
    }

    .msg-username {
      font-weight: 700;
      margin-right: 5px;
    }

    .msg-text {
      color: rgba(255, 255, 255, 0.92);
      word-break: break-word;
    }
    .msg-text ::ng-deep img.chat-emote {
      height: 1.3em; vertical-align: middle; display: inline; margin: 0 1px;
    }

    /* ── Notification card ── */
    .notif-msg {
      display: flex;
      align-items: center;
      gap: 9px;
      border-radius: 7px;
      padding: 8px 12px;
      backdrop-filter: blur(6px);
      line-height: 1.4;
      width: 100%;
      min-width: 0;
      border-left: 3px solid transparent;
    }

    .notif-icon {
      font-style: normal;
      flex-shrink: 0;
      font-size: 1.1em;
    }

    .notif-text {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.97);
      word-break: break-word;
    }

    /* ── Test pattern badge ── */
    .test-badge {
      align-self: flex-start;
      background: rgba(255, 180, 0, 0.18);
      border: 1px solid rgba(255, 180, 0, 0.5);
      color: rgba(255, 200, 60, 0.9);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
  `],
  template: `
    <div #feedEl class="chat-feed" [style.font-size.px]="settings.fontSize()">
      @if (!isLive() && settings.testPattern()) {
        <div class="test-badge">TEST PATTERN — Not Live</div>
        @for (entry of testEntries; track entry.id) {
          @if (entry.kind === 'chat') {
            <div class="chat-msg">
              <div class="msg-platform-bar" [style.background]="settings.platformColor(entry.platform)"></div>
              <div class="msg-body">
                <span class="msg-username" [style.color]="settings.platformColor(entry.platform)">
                  {{ entry.displayName }}
                </span>
                <span class="msg-text" [innerHTML]="chatHtml(entry)"></span>
              </div>
            </div>
          } @else {
            <div class="notif-msg"
              [style.background]="'rgba(0,0,0,0.72)'"
              [style.border-left-color]="settings.platformColor(entry.platform)">
              <em class="notif-icon">{{ entry.icon }}</em>
              <span class="notif-text" [style.color]="settings.platformColor(entry.platform)">
                {{ entry.notifText }}
              </span>
            </div>
          }
        }
      } @else {
        @for (entry of messages(); track entry.id) {
          @if (entry.kind === 'chat') {
            <div class="chat-msg" [@msg]="msgAnimState()">
              <div class="msg-platform-bar" [style.background]="settings.platformColor(entry.platform)"></div>
              <div class="msg-body">
                <span class="msg-username" [style.color]="settings.platformColor(entry.platform)">
                  {{ entry.displayName }}
                </span>
                <span class="msg-text" [innerHTML]="chatHtml(entry)"></span>
              </div>
            </div>
          } @else {
            <div class="notif-msg" [@msg]="msgAnimState()"
              [style.background]="'rgba(0,0,0,0.72)'"
              [style.border-left-color]="settings.platformColor(entry.platform)">
              <em class="notif-icon">{{ entry.icon }}</em>
              <span class="notif-text" [style.color]="settings.platformColor(entry.platform)">
                {{ entry.notifText }}
              </span>
            </div>
          }
        }
      }
    </div>
  `,
})
export class ChatOverlayComponent implements OnInit, OnDestroy, AfterViewChecked {
  protected readonly settings = inject(OverlaySettingsService);
  private readonly socket = inject(SocketService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly zone = inject(NgZone);

  @ViewChild('feedEl') private feedEl!: ElementRef<HTMLElement>;

  readonly testEntries = TEST_ENTRIES;
  readonly messages    = signal<ChatEntry[]>([]);
  readonly isLive      = signal(false);

  readonly msgAnimState = computed(() => {
    const params = EXIT_ANIMATION_PARAMS[this.settings.exitAnimation()];
    return { value: 'active', params };
  });

  private _sessionLive = false;
  private readonly _activeCaptures = new Set<string>();

  private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    // Re-evaluate timers whenever fadeTimeout changes
    effect(() => {
      const timeout = this.settings.fadeTimeout();
      if (timeout === 0) {
        for (const timer of this._timers.values()) clearTimeout(timer);
        this._timers.clear();
      } else {
        for (const msg of this.messages()) {
          if (!this._timers.has(msg.id)) {
            const timer = setTimeout(() => {
              this._timers.delete(msg.id);
              this.messages.update((msgs) => msgs.filter((m) => m.id !== msg.id));
            }, timeout * 1000);
            this._timers.set(msg.id, timer);
          }
        }
      }
    });
  }

  ngOnInit(): void {
    this.socket.socket.on('ottery:session', (data: { state: string }) => {
      this._sessionLive = data.state === 'live';
      this._updateIsLive();
    });

    this.socket.socket.on('ottery:status', (data: { type?: string; serviceId?: string; status?: string }) => {
      if (data.type !== 'capture' || !data.serviceId) return;
      if (data.status === 'live') {
        this._activeCaptures.add(data.serviceId);
      } else {
        this._activeCaptures.delete(data.serviceId);
      }
      this._updateIsLive();
    });

    this.socket.socket.on('ottery:event', (event: OtteryEvent) => {
      if (this.settings.hiddenPlatforms().has(event.platform)) return;

      let entry: ChatEntry | null = null;

      if (event.type === 'chat.message') {
        entry = {
          id:          event.id,
          kind:        'chat',
          platform:    event.platform,
          displayName: event.actor?.displayName ?? event.actor?.username ?? 'Anonymous',
          message:     String(event.data['message'] ?? ''),
          rawData:     event.data,
          timestamp:   event.timestamp,
        };
      } else if (NOTIFICATION_TYPES.has(event.type)) {
        if (!this.settings.isNotificationEnabled(event.platform, event.type)) return;

        entry = {
          id:          event.id,
          kind:        'notification',
          platform:    event.platform,
          displayName: event.actor?.displayName ?? event.actor?.username ?? '',
          icon:        NOTIF_ICONS[event.type] ?? '📢',
          notifText:   formatNotification(event),
          timestamp:   event.timestamp,
        };
      }

      if (!entry) return;

      const finalEntry = entry;
      this.messages.update((msgs) => {
        const max = this.settings.maxMessages();
        const updated = [finalEntry, ...msgs];
        return updated.length > max ? updated.slice(0, max) : updated;
      });

      const timeout = this.settings.fadeTimeout();
      if (timeout > 0) {
        const timer = setTimeout(() => {
          this._timers.delete(finalEntry.id);
          this.messages.update((msgs) => msgs.filter((m) => m.id !== finalEntry.id));
        }, timeout * 1000);
        this._timers.set(finalEntry.id, timer);
      }
    });
  }

  private _trimPending = false;

  ngAfterViewChecked(): void {
    const el = this.feedEl?.nativeElement;
    if (!el || el.scrollHeight <= el.clientHeight || this._trimPending) return;

    // Defer the trim to avoid mutating signals during change detection
    this._trimPending = true;
    setTimeout(() => {
      this.zone.run(() => {
        this._trimPending = false;
        const feedEl = this.feedEl?.nativeElement;
        if (!feedEl || feedEl.scrollHeight <= feedEl.clientHeight) return;
        this.messages.update((msgs) => msgs.length > 0 ? msgs.slice(0, msgs.length - 1) : msgs);
      });
    }, 0);
  }

  private _updateIsLive(): void {
    this.isLive.set(this._sessionLive || this._activeCaptures.size > 0);
  }

  ngOnDestroy(): void {
    this.socket.socket.off('ottery:session');
    this.socket.socket.off('ottery:status');
    this.socket.socket.off('ottery:event');
    for (const timer of this._timers.values()) clearTimeout(timer);
    this._timers.clear();
  }

  chatHtml(entry: ChatEntry): SafeHtml {
    const data = entry.rawData ?? {};

    if (entry.platform === 'twitch') {
      type Fragment = { type: string; text: string; emoteId?: string | null };
      const fragments = data['fragments'] as Fragment[] | null | undefined;
      if (fragments?.length) {
        const html = fragments
          .map((f) => {
            if (f.type === 'emote' && f.emoteId) {
              const name = this._esc(f.text);
              const src = `https://static-cdn.jtvnw.net/emoticons/v2/${f.emoteId}/default/dark/1.0`;
              return `<img class="chat-emote" src="${src}" alt="${name}" title="${name}">`;
            }
            return this._esc(f.text);
          })
          .join('');
        return this.sanitizer.bypassSecurityTrustHtml(html);
      }
    }

    if (entry.platform === 'tiktok') {
      type TikTokEmote = { id: string; imageUrl: string | null; position: number };
      const emotes = data['emotes'] as TikTokEmote[] | null | undefined;
      const message = entry.message ?? '';
      if (emotes?.length) {
        const sorted = [...emotes].sort((a, b) => b.position - a.position);
        const chars = [...message];
        for (const emote of sorted) {
          if (emote.imageUrl) {
            const name = this._esc(emote.id);
            const img = `<img class="chat-emote" src="${this._esc(emote.imageUrl)}" alt="${name}" title="${name}">`;
            chars.splice(emote.position, 1, img);
          }
        }
        return this.sanitizer.bypassSecurityTrustHtml(
          chars.map((c) => (c.length === 1 ? this._esc(c) : c)).join('')
        );
      }
    }

    return this.sanitizer.bypassSecurityTrustHtml(this._esc(entry.message ?? ''));
  }

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
