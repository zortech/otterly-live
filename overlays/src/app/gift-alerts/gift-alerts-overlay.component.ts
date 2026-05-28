import {
  Component, ElementRef, inject, signal, ViewChild, OnInit, OnDestroy, AfterViewInit, ChangeDetectionStrategy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import lottie, { AnimationItem } from 'lottie-web';
import { SocketService, OtteryEvent } from '../socket.service';

type FallbackMode = 'tiktok-assets' | 'safe';

interface GiftAnimation {
  id: number;
  label: string;
  platform: string;
  eventType: string;
  triggerKey: string | null;
  minAmount: number | null;
  animationPath: string;
  durationMs: number;
  soundPath: string | null;
  position: 'center' | 'top' | 'bottom' | 'left' | 'right';
  enabled: boolean;
  priority: number;
}

interface QueueItem {
  event: OtteryEvent;
  mapping: GiftAnimation | null;   // null → fallback render
  iconUrl: string | null;          // for fallback render of unmapped TikTok gifts
}

const MATCH_EVENT_TYPES = new Set(['subscribe', 'subscribe.gift', 'cheer', 'tip', 'redeem']);

@Component({
  selector: 'overlay-gift-alerts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #fff;
      text-shadow: 0 2px 8px rgba(0,0,0,0.85);
    }

    .stage {
      position: absolute;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      animation: pop-in 320ms cubic-bezier(0.2, 1.4, 0.4, 1) both;
    }
    .stage.exit { animation: fade-out 320ms ease forwards; }

    .stage.center { top: 50%; left: 50%; transform: translate(-50%, -50%); }
    .stage.top    { top: 8%;  left: 50%; transform: translateX(-50%); }
    .stage.bottom { bottom: 8%; left: 50%; transform: translateX(-50%); }
    .stage.left   { top: 50%; left: 6%;  transform: translateY(-50%); }
    .stage.right  { top: 50%; right: 6%; transform: translateY(-50%); }

    .lottie, .visual {
      width: 380px;
      height: 380px;
      max-width: 60vmin;
      max-height: 60vmin;
    }
    .visual { object-fit: contain; }

    .icon-fallback {
      width: 220px;
      height: 220px;
      max-width: 40vmin;
      max-height: 40vmin;
      object-fit: contain;
      filter: drop-shadow(0 6px 18px rgba(0,0,0,0.6));
    }

    .caption {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.3px;
      text-align: center;
      padding: 6px 18px;
      border-radius: 999px;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(8px);
    }
    .caption .actor   { color: #ffd968; }
    .caption .what    { color: #fff; }
    .caption .amount  { color: #7dffba; font-variant-numeric: tabular-nums; }

    .platform-badge {
      font-size: 11px; font-weight: 700; letter-spacing: 1.2px;
      text-transform: uppercase; padding: 3px 10px; border-radius: 999px;
      background: var(--badge-bg, rgba(255,255,255,0.15));
      color: var(--badge-fg, #fff);
    }

    @keyframes pop-in {
      from { opacity: 0; transform: translate(var(--tx, -50%), var(--ty, -50%)) scale(0.7); }
      to   { opacity: 1; transform: translate(var(--tx, -50%), var(--ty, -50%)) scale(1); }
    }
    @keyframes fade-out {
      to { opacity: 0; transform: translate(var(--tx, -50%), var(--ty, -50%)) scale(0.92); }
    }
  `],
  template: `
    @if (current(); as item) {
      <div class="stage" [class.exit]="exiting()" [class]="'stage ' + (item.mapping?.position ?? 'center')">

        @if (item.mapping) {
          @if (isLottiePath(item.mapping.animationPath)) {
            <div #lottieHost class="lottie"></div>
          } @else if (isVideoPath(item.mapping.animationPath)) {
            <video class="visual" [src]="assetUrl(item.mapping.animationPath)"
              autoplay muted playsinline></video>
          } @else {
            <img class="visual" [src]="assetUrl(item.mapping.animationPath)" alt="" />
          }
        } @else if (item.iconUrl) {
          <img class="icon-fallback" [src]="item.iconUrl" alt="" />
        }

        <div class="caption">
          <span class="platform-badge" [style.--badge-bg]="platformColor(item.event.platform)">
            {{ item.event.platform }}
          </span>
          <span class="actor">{{ item.event.actor?.displayName || item.event.actor?.username || 'Someone' }}</span>
          <span class="what">{{ captionVerb(item.event) }}</span>
          @if (captionAmount(item.event); as amt) {
            <span class="amount">{{ amt }}</span>
          }
        </div>
      </div>
    }
  `,
})
export class GiftAlertsOverlayComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly socket = inject(SocketService);
  private readonly http   = inject(HttpClient);

  @ViewChild('lottieHost') private lottieHost?: ElementRef<HTMLDivElement>;

  readonly current = signal<QueueItem | null>(null);
  readonly exiting = signal(false);

  private mappings: GiftAnimation[] = [];
  private fallbackMode: FallbackMode = 'safe';
  private queue: QueueItem[] = [];
  private animatingUntil = 0;
  private lottieInstance: AnimationItem | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private currentAudio: HTMLAudioElement | null = null;

  async ngOnInit(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const f = params.get('fallback');
    this.fallbackMode = f === 'tiktok-assets' ? 'tiktok-assets' : 'safe';

    await this.loadMappings();
    this.socket.socket.on('ottery:event', this.onEvent);
    this.socket.socket.on('giftAnimations:changed', () => this.loadMappings());
  }

  ngAfterViewInit(): void {
    // Lottie host appears only when an item is rendered; mounting handled in renderItem.
  }

  ngOnDestroy(): void {
    this.socket.socket.off('ottery:event', this.onEvent);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.destroyLottie();
    this.stopAudio();
  }

  private async loadMappings(): Promise<void> {
    try {
      this.mappings = await firstValueFrom(this.http.get<GiftAnimation[]>('/api/gift-animations'));
    } catch {
      this.mappings = [];
    }
  }

  private onEvent = (event: OtteryEvent): void => {
    if (!MATCH_EVENT_TYPES.has(event.type)) return;

    const mapping = this.matchMapping(event);

    if (mapping) {
      this.enqueue({ event, mapping, iconUrl: null });
      return;
    }

    // No mapping — fallback behavior depends on mode + platform.
    if (event.platform === 'tiktok' && event.type === 'tip') {
      if (this.fallbackMode === 'tiktok-assets') {
        const iconUrl = (event.data?.['giftIconUrl'] as string | null | undefined) ?? null;
        this.enqueue({ event, mapping: null, iconUrl });
      }
      // 'safe' mode: drop unmapped TikTok gifts silently.
      return;
    }

    // Non-TikTok unmapped events get no alert by default (avoid spam).
    // Future enhancement: settings toggle for "generic" fallback.
  };

  private matchMapping(event: OtteryEvent): GiftAnimation | null {
    const candidates = this.mappings.filter((m) =>
      m.enabled && m.platform === event.platform && m.eventType === event.type
    );
    if (candidates.length === 0) return null;

    const triggerKey = this.extractTriggerKey(event);
    const amount     = this.extractAmount(event);

    // Sort by specificity: exact triggerKey > minAmount match > generic. priority breaks ties.
    const scored = candidates
      .map((m) => ({ m, score: this.scoreMatch(m, triggerKey, amount) }))
      .filter((s) => s.score >= 0)
      .sort((a, b) => (b.score - a.score) || (b.m.priority - a.m.priority));

    if (scored.length === 0) return null;

    // Pick randomly among all mappings tied for the top (score, priority).
    // This is how variant rotation works — create N mappings with the same trigger and
    // priority, each pointing at a different animation, and the overlay cycles through them.
    const top = scored[0];
    const tied = scored.filter((s) => s.score === top.score && s.m.priority === top.m.priority);
    const pick = tied[Math.floor(Math.random() * tied.length)];
    return pick.m;
  }

  private scoreMatch(m: GiftAnimation, triggerKey: string | null, amount: number | null): number {
    if (m.triggerKey != null && triggerKey != null && String(m.triggerKey) === String(triggerKey)) return 100;
    if (m.triggerKey != null && triggerKey != null && String(m.triggerKey) !== String(triggerKey)) return -1;
    if (m.minAmount != null && amount != null) return amount >= m.minAmount ? 50 + Math.min(m.minAmount, 50) : -1;
    if (m.minAmount != null) return -1;
    return 1; // generic match (no triggerKey, no minAmount)
  }

  private extractTriggerKey(event: OtteryEvent): string | null {
    const d = event.data ?? {};
    if (event.type === 'tip' && event.platform === 'tiktok') return d['giftId'] != null ? String(d['giftId']) : null;
    if (event.type === 'redeem')                              return d['rewardId'] != null ? String(d['rewardId']) : null;
    if (event.type === 'subscribe' || event.type === 'subscribe.gift') return d['tier'] != null ? String(d['tier']) : null;
    return null;
  }

  private extractAmount(event: OtteryEvent): number | null {
    const d = event.data ?? {};
    if (event.type === 'cheer')                            return typeof d['bits']   === 'number' ? d['bits']   as number : null;
    if (event.type === 'tip')                              return typeof d['amount'] === 'number' ? d['amount'] as number : null;
    if (event.type === 'subscribe.gift')                   return typeof d['count']  === 'number' ? d['count']  as number : null;
    if (event.type === 'redeem')                           return typeof d['rewardCost'] === 'number' ? d['rewardCost'] as number : null;
    return null;
  }

  private enqueue(item: QueueItem): void {
    this.queue.push(item);
    this.tick();
  }

  private tick(): void {
    if (Date.now() < this.animatingUntil) return;
    const next = this.queue.shift();
    if (!next) {
      this.current.set(null);
      return;
    }
    this.renderItem(next);
  }

  private renderItem(item: QueueItem): void {
    this.destroyLottie();
    this.stopAudio();
    this.exiting.set(false);
    this.current.set(item);

    const durationMs = item.mapping?.durationMs ?? 3500;
    this.animatingUntil = Date.now() + durationMs;

    // Lottie has to wait for the @if to render the host element
    if (item.mapping && this.isLottiePath(item.mapping.animationPath)) {
      queueMicrotask(() => this.mountLottie(item.mapping!.animationPath));
    }

    if (item.mapping?.soundPath) {
      try {
        const audio = new Audio(this.assetUrl(item.mapping.soundPath));
        audio.volume = 0.8;
        audio.play().catch(() => {}); // browser autoplay restrictions in OBS browser source are off
        this.currentAudio = audio;
      } catch {}
    }

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.exiting.set(true);
      setTimeout(() => {
        this.current.set(null);
        this.tick();
      }, 320);
    }, durationMs - 320);
  }

  private mountLottie(animationPath: string): void {
    if (!this.lottieHost) return;
    this.lottieInstance = lottie.loadAnimation({
      container: this.lottieHost.nativeElement,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      path: this.assetUrl(animationPath),
    });
  }

  private destroyLottie(): void {
    if (this.lottieInstance) {
      this.lottieInstance.destroy();
      this.lottieInstance = null;
    }
  }

  private stopAudio(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
  }

  // ─── Template helpers ──────────────────────────────────────────────

  isLottiePath(p: string): boolean { return /\.(json|lottie)$/i.test(p); }
  isVideoPath(p: string):  boolean { return /\.(mp4|webm)$/i.test(p); }

  assetUrl(p: string): string {
    if (/^https?:\/\//i.test(p)) return p;
    if (p.startsWith('builtin:')) return `/overlays/builtin-animations/${p.slice('builtin:'.length)}`;
    return `/api/gift-animations/assets/files/${encodeURIComponent(p)}`;
  }

  platformColor(platform: string): string {
    const map: Record<string, string> = {
      twitch: 'rgba(145, 70, 255, 0.85)',
      youtube: 'rgba(255, 0, 0, 0.85)',
      kick: 'rgba(83, 252, 24, 0.85)',
      tiktok: 'rgba(254, 44, 85, 0.85)',
      facebook: 'rgba(24, 119, 242, 0.85)',
      bilibili: 'rgba(0, 174, 236, 0.85)',
    };
    return map[platform] ?? 'rgba(255,255,255,0.15)';
  }

  captionVerb(event: OtteryEvent): string {
    const d = event.data ?? {};
    switch (event.type) {
      case 'tip':
        if (event.platform === 'tiktok') {
          const name = d['giftName'] as string | undefined;
          const repeat = (d['repeatCount'] as number | undefined) ?? 1;
          return name ? `sent ${name}` + (repeat > 1 ? ' ×' : '') : 'sent a gift';
        }
        return 'tipped';
      case 'cheer':           return 'cheered';
      case 'subscribe':       return 'subscribed!';
      case 'subscribe.gift':  return 'gifted subs!';
      case 'redeem':          return `redeemed ${d['rewardTitle'] ?? 'a reward'}`;
      default:                return '';
    }
  }

  captionAmount(event: OtteryEvent): string | null {
    const d = event.data ?? {};
    if (event.type === 'tip' && event.platform === 'tiktok') {
      const repeat = (d['repeatCount'] as number | undefined) ?? 1;
      return repeat > 1 ? String(repeat) : null;
    }
    if (event.type === 'cheer')          return `${d['bits'] ?? 0} bits`;
    if (event.type === 'tip')            return `$${(d['amount'] as number | undefined)?.toFixed(2) ?? '?'}`;
    if (event.type === 'subscribe.gift') return `×${d['count'] ?? 1}`;
    return null;
  }
}
