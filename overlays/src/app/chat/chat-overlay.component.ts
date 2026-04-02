import {
  Component, inject, signal, effect, OnInit, OnDestroy,
} from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { SocketService, OtteryEvent } from '../socket.service';
import { OverlaySettingsService } from '../overlay-settings.service';

interface ChatEntry {
  id: string;
  kind: 'chat' | 'notification';
  platform: string;
  displayName: string;
  // chat
  message?: string;
  // notification
  icon?: string;
  notifText?: string;
  timestamp: string;
}

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
        animate('260ms cubic-bezier(0.2, 0, 0, 1)', style({ transform: 'none', opacity: 1 })),
      ]),
      transition(':leave', [
        animate('380ms ease-in', style({ opacity: 0, transform: 'translateX(-16px)' })),
      ]),
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
      flex-direction: column;
      gap: 5px;
      overflow: hidden;
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
  `],
  template: `
    <div class="chat-feed" [style.font-size.px]="settings.fontSize()">
      @for (entry of messages(); track entry.id) {
        @if (entry.kind === 'chat') {
          <div class="chat-msg" @msg>
            <div class="msg-platform-bar" [style.background]="settings.platformColor(entry.platform)"></div>
            <div class="msg-body">
              <span class="msg-username" [style.color]="settings.platformColor(entry.platform)">
                {{ entry.displayName }}
              </span>
              <span class="msg-text">{{ entry.message }}</span>
            </div>
          </div>
        } @else {
          <div class="notif-msg" @msg
            [style.background]="'rgba(0,0,0,0.72)'"
            [style.border-left-color]="settings.platformColor(entry.platform)">
            <em class="notif-icon">{{ entry.icon }}</em>
            <span class="notif-text" [style.color]="settings.platformColor(entry.platform)">
              {{ entry.notifText }}
            </span>
          </div>
        }
      }
    </div>
  `,
})
export class ChatOverlayComponent implements OnInit, OnDestroy {
  protected readonly settings = inject(OverlaySettingsService);
  private readonly socket = inject(SocketService);

  readonly messages = signal<ChatEntry[]>([]);

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
        const updated = [...msgs, finalEntry];
        return updated.length > max ? updated.slice(-max) : updated;
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

  ngOnDestroy(): void {
    this.socket.socket.off('ottery:event');
    for (const timer of this._timers.values()) clearTimeout(timer);
    this._timers.clear();
  }
}
