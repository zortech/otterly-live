import { Component, inject, signal, computed, effect, OnInit, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { OtteryLiveService, OtteryEvent, EventType } from '../ottery-live.service';
import { StreamServicesService } from '../stream-services.service';

const HIGHLIGHT_TYPES: EventType[] = [
  'follow', 'subscribe', 'subscribe.gift', 'cheer', 'tip', 'raid', 'like', 'share', 'redeem',
  'music.sr_added', 'music.sr_rejected',
];

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [MatIconModule, DatePipe],
  styles: [`
    .page-header { display: flex; align-items: center; margin-bottom: 24px; }
    .page-title { font-size: 22px; font-weight: 700; color: var(--text-1); letter-spacing: -0.5px; }

    /* ── Layout ────────────────────────────────────────────────── */
    .chat-layout {
      display: grid;
      grid-template-columns: 1fr 280px;
      gap: 16px;
      height: calc(100vh - 140px);
    }

    /* ── Chat panel ────────────────────────────────────────────── */
    .chat-panel {
      display: flex; flex-direction: column;
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 12px; padding: 14px; overflow: hidden;
    }

    .filter-row {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .filter-chip {
      padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 500;
      cursor: pointer; border: 1px solid var(--border); background: transparent;
      color: var(--text-2); font-family: inherit; transition: all 0.12s;
    }
    .filter-chip:hover { background: var(--bg-hover); color: var(--text-1); }
    .filter-chip.active {
      background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent);
    }
    .spacer { flex: 1; }
    .autoscroll-btn {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
      cursor: pointer; font-family: inherit; transition: all 0.12s;
      border: 1px solid var(--border); background: transparent; color: var(--text-2);
    }
    .autoscroll-btn.on {
      border-color: var(--accent-border); background: var(--accent-dim); color: var(--accent);
    }
    .autoscroll-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }

    .chat-scroll {
      flex: 1; overflow-y: auto;
      display: flex; flex-direction: column;
      scroll-behavior: smooth;
    }
    .empty-msg {
      color: var(--text-3); font-style: italic; text-align: center;
      padding: 40px 0; font-size: 13px; margin: auto;
    }

    /* ── Chat rows ─────────────────────────────────────────────── */
    .chat-row {
      display: flex; align-items: baseline; gap: 5px;
      padding: 3px 4px; border-radius: 4px;
      font-size: 13px; line-height: 1.5;
      transition: background 0.1s;
    }
    .chat-row:hover { background: rgba(255,255,255,0.03); }

    .chat-time {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: var(--text-3); flex-shrink: 0; line-height: 1.8;
    }
    .chat-badges { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px; border-radius: 3px;
      font-size: 9px; font-weight: 800; letter-spacing: 0; line-height: 1;
    }
    .badge.mod { background: rgba(0,230,118,0.15); color: var(--live); }
    .badge.sub { background: rgba(145,70,255,0.15); color: #9146ff; }

    .chat-actor {
      font-weight: 700; font-size: 13px; flex-shrink: 0;
      white-space: nowrap;
    }
    .chat-colon { color: var(--text-3); flex-shrink: 0; }
    .chat-msg {
      color: var(--text-1); word-break: break-word; min-width: 0;
    }
    .chat-msg ::ng-deep img.chat-emote {
      height: 1.3em; vertical-align: middle; display: inline; margin: 0 1px;
    }

    /* ── Highlights sidebar ────────────────────────────────────── */
    .highlights-panel {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 12px; padding: 14px;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .section-label {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 1px; color: var(--text-3); margin-bottom: 10px; flex-shrink: 0;
    }
    .highlights-scroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    .empty-highlights {
      color: var(--text-3); font-style: italic; font-size: 12px;
      text-align: center; padding: 24px 8px;
    }

    .highlight-card {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: 8px;
      background: var(--bg-raised); border: 1px solid var(--border);
      font-size: 12px;
    }
    .hl-icon {
      width: 30px; height: 30px; border-radius: 7px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .hl-icon mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .hl-body { flex: 1; min-width: 0; }
    .hl-actor {
      font-weight: 600; color: var(--text-1);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hl-summary { color: var(--text-2); font-size: 11px; margin-top: 1px; }
    .hl-time {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: var(--text-3); flex-shrink: 0; align-self: flex-start;
    }
  `],
  template: `
    <div class="page-header">
      <h1 class="page-title">Chat</h1>
    </div>

    <div class="chat-layout">
      <!-- Main chat feed -->
      <div class="chat-panel">
        <div class="filter-row">
          <button class="filter-chip" [class.active]="platformFilter() === 'all'"
                  (click)="platformFilter.set('all')">All</button>
          @for (svc of streamSvc.services(); track svc.id) {
            <button class="filter-chip"
              [class.active]="platformFilter() === svc.platform"
              [style.color]="platformFilter() === svc.platform ? platformColor(svc.platform) : ''"
              [style.border-color]="platformFilter() === svc.platform ? platformColor(svc.platform) + '44' : ''"
              [style.background]="platformFilter() === svc.platform ? platformColor(svc.platform) + '14' : ''"
              (click)="platformFilter.set(svc.platform)">
              {{ svc.display_name }}
            </button>
          }
          <span class="spacer"></span>
          <button class="autoscroll-btn" [class.on]="autoScroll()" (click)="toggleAutoScroll()">
            <mat-icon>{{ autoScroll() ? 'vertical_align_bottom' : 'pause' }}</mat-icon>
            {{ autoScroll() ? 'Live' : 'Paused' }}
          </button>
        </div>

        <div class="chat-scroll" #chatScroll (scroll)="onChatScroll($event)">
          @if (chatEvents().length === 0) {
            <p class="empty-msg">No chat messages yet.</p>
          } @else {
            @for (e of chatEvents(); track e.id) {
              <div class="chat-row">
                <span class="chat-time">{{ e.timestamp | date:'HH:mm' }}</span>
                <div class="chat-badges">
                  @if (e.actor?.isModerator) { <span class="badge mod" title="Moderator">M</span> }
                  @if (e.actor?.isSubscriber) { <span class="badge sub" title="Subscriber">S</span> }
                </div>
                <span class="chat-actor" [style.color]="platformColor(e.platform)">
                  {{ e.actor?.displayName || e.actor?.username || '?' }}
                </span>
                <span class="chat-colon">:</span>
                <span class="chat-msg" [innerHTML]="chatHtml(e)"></span>
              </div>
            }
          }
        </div>
      </div>

      <!-- Highlights sidebar: subs, gifts, cheers, follows, etc. -->
      <div class="highlights-panel">
        <div class="section-label">Recent Highlights</div>
        <div class="highlights-scroll">
          @if (highlightEvents().length === 0) {
            <p class="empty-highlights">Subs, gift subs, cheers, raids, and follows will appear here.</p>
          } @else {
            @for (e of highlightEvents(); track e.id) {
              <div class="highlight-card">
                <div class="hl-icon"
                  [style.background]="platformColor(e.platform) + '20'"
                  [style.color]="platformColor(e.platform)">
                  <mat-icon>{{ highlightIcon(e.type) }}</mat-icon>
                </div>
                <div class="hl-body">
                  <div class="hl-actor">{{ e.actor?.displayName || e.actor?.username || 'Anonymous' }}</div>
                  <div class="hl-summary">{{ highlightSummary(e) }}</div>
                </div>
                <span class="hl-time">{{ e.timestamp | date:'HH:mm' }}</span>
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class ChatComponent implements OnInit, AfterViewInit {
  @ViewChild('chatScroll') private chatScrollRef?: ElementRef<HTMLElement>;

  protected readonly service = inject(OtteryLiveService);
  protected readonly streamSvc = inject(StreamServicesService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly http = inject(HttpClient);

  readonly platformFilter = signal<string>('all');
  readonly autoScroll = signal(true);
  readonly showAddedInHighlights = signal(true);
  readonly showRejectedInHighlights = signal(true);

  readonly chatEvents = computed(() => {
    const all = this.service.events();
    const msgs = all.filter((e) => e.type === 'chat.message');
    const filtered =
      this.platformFilter() === 'all'
        ? msgs
        : msgs.filter((e) => e.platform === this.platformFilter());
    // Reverse so newest is at the bottom (chat convention)
    return [...filtered].reverse();
  });

  readonly highlightEvents = computed(() => {
    const showAdded    = this.showAddedInHighlights();
    const showRejected = this.showRejectedInHighlights();
    return this.service.events()
      .filter((e) => {
        if (e.type === 'music.sr_added')    return showAdded;
        if (e.type === 'music.sr_rejected') return showRejected;
        return HIGHLIGHT_TYPES.includes(e.type);
      })
      .slice(0, 30);
  });

  constructor() {
    effect(() => {
      this.chatEvents(); // track changes
      if (this.autoScroll()) {
        queueMicrotask(() => {
          const el = this.chatScrollRef?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    });

    this.streamSvc.loadAll().catch(() => {});
  }

  ngAfterViewInit(): void {
    const el = this.chatScrollRef?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  async ngOnInit(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<Record<string, unknown>>('/api/settings'));
      this.showAddedInHighlights.set((s['music.srShowAddedInHighlights'] as boolean) ?? true);
      this.showRejectedInHighlights.set((s['music.srShowRejectedInHighlights'] as boolean) ?? true);
    } catch {
      // settings unavailable — keep defaults
    }
  }

  onChatScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    this.autoScroll.set(atBottom);
  }

  toggleAutoScroll(): void {
    const next = !this.autoScroll();
    this.autoScroll.set(next);
    if (next) {
      const el = this.chatScrollRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  platformColor(platform: string): string {
    const map: Record<string, string> = {
      twitch: '#9146ff', youtube: '#ff0000', kick: '#53fc18',
      tiktok: '#fe2c55', x: '#c9cdd1', joystick: '#8b5cf6',
    };
    return map[platform] ?? '#7c8aa0';
  }

  highlightIcon(type: string): string {
    const icons: Record<string, string> = {
      follow: 'person_add',
      subscribe: 'star',
      'subscribe.gift': 'card_giftcard',
      cheer: 'bolt',
      tip: 'volunteer_activism',
      raid: 'groups',
      like: 'favorite',
      share: 'share',
      redeem: 'redeem',
      'music.sr_added':    'queue_music',
      'music.sr_rejected': 'music_off',
    };
    return icons[type] ?? 'notifications';
  }

  highlightSummary(e: OtteryEvent): string {
    switch (e.type) {
      case 'follow':         return 'followed';
      case 'subscribe':      return `Tier ${e.data['tier'] ?? '1000'} sub`;
      case 'subscribe.gift': {
        const count = Number(e.data['count'] ?? 1);
        return `gifted ${count} sub${count !== 1 ? 's' : ''}`;
      }
      case 'cheer':          return `${e.data['bits'] ?? 0} bits`;
      case 'tip':            return `${String(e.data['giftName'] ?? 'gift')} · ${String(e.data['amount'] ?? 0)} diamonds`;
      case 'raid':           return `raided with ${e.data['viewers'] ?? 0} viewers`;
      case 'like':           return `liked × ${String(e.data['count'] ?? 1)}`;
      case 'share':          return 'shared the stream';
      case 'redeem':         return `redeemed ${String(e.data['rewardTitle'] ?? 'reward')}`;
      case 'music.sr_added': return `queued "${String(e.data['trackName'] ?? '')}" by ${String(e.data['artistName'] ?? '')}`;
      case 'music.sr_rejected': {
        const reason = String(e.data['reason'] ?? '');
        const reasonMap: Record<string, string> = {
          no_credits:  `not enough credits (need ${String(e.data['creditCost'] ?? 0)}, have ${String(e.data['creditBalance'] ?? 0)})`,
          queue_limit: `queue limit reached`,
          explicit:    `"${String(e.data['trackName'] ?? '')}" rejected — explicit`,
          duplicate:   `"${String(e.data['trackName'] ?? '')}" already in queue`,
          not_found:   `no results for "${String(e.data['query'] ?? '')}"`,
        };
        return reasonMap[reason] ?? reason;
      }
      default:               return '';
    }
  }

  chatHtml(e: OtteryEvent): SafeHtml {
    if (e.platform === 'twitch') {
      type Fragment = { type: string; text: string; emoteId?: string | null };
      const fragments = e.data['fragments'] as Fragment[] | null | undefined;
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

    if (e.platform === 'tiktok') {
      type TikTokEmote = { id: string; imageUrl: string | null; position: number };
      const emotes = e.data['emotes'] as TikTokEmote[] | null | undefined;
      const message = String(e.data['message'] ?? '');
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

    return this.sanitizer.bypassSecurityTrustHtml(this._esc(String(e.data['message'] ?? '')));
  }

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
