import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SocketService } from '../socket.service';
import {
  GoalTheme, GoalMetric, GoalPlatform,
  METRIC_EVENT_MAP, METRIC_LABELS, PLATFORM_COLORS,
} from './goal-types';

const KEY_THEME    = 'overlay.goalSingle.theme';
const KEY_PLATFORM = 'overlay.goalSingle.platform';
const KEY_METRIC   = 'overlay.goalSingle.metric';
const KEY_TARGET   = 'overlay.goalSingle.target';
const KEY_LABEL    = 'overlay.goalSingle.label';
const POLL_MS      = 30_000;

@Component({
  selector: 'overlay-goal-single',
  standalone: true,
  animations: [
    trigger('widgetEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(12px)' }),
        animate('320ms cubic-bezier(0.2, 0, 0, 1)', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
    trigger('countUp', [
      transition(':increment', [
        style({ transform: 'translateY(-8px)', opacity: 0 }),
        animate('220ms cubic-bezier(0.2, 0, 0, 1)', style({ transform: 'none', opacity: 1 })),
      ]),
      transition(':decrement', [
        style({ transform: 'translateY(6px)', opacity: 0 }),
        animate('200ms ease-out', style({ transform: 'none', opacity: 1 })),
      ]),
    ]),
    trigger('barPulse', [
      transition(':increment', [
        style({ filter: 'brightness(1)' }),
        animate('80ms ease-out', style({ filter: 'brightness(2.4)' })),
        animate('500ms ease-out', style({ filter: 'brightness(1)' })),
      ]),
    ]),
    trigger('celebIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.4) rotate(-20deg)' }),
        animate('380ms cubic-bezier(0.2, 0, 0.2, 1.6)', style({ opacity: 1, transform: 'scale(1) rotate(0)' })),
      ]),
    ]),
    trigger('completedRow', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-4px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
  styles: [`
    :host {
      display: block;
      position: fixed;
      top: 16px;
      left: 16px;
      width: 360px;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* ── Base widget ────────────────────────────────────────────── */
    .widget {
      position: relative;
      border-radius: 12px;
      padding: 14px 16px 12px;
    }

    .goal-row {
      display: flex;
      align-items: center;
      gap: 7px;
      min-height: 22px;
    }

    .theme-icon { font-size: 17px; flex-shrink: 0; line-height: 1; }

    .goal-label {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      font-weight: 600;
      color: rgba(255,255,255,0.94);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bar-area {
      margin: 10px 0 4px;
      position: relative;
    }

    .bar-track {
      height: 6px;
      background: rgba(255,255,255,0.12);
      border-radius: 3px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      border-radius: 3px;
      background: #4fc3f7;
      transition: width 0.65s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .meta-row {
      display: flex;
      align-items: baseline;
      gap: 3px;
      margin-top: 6px;
      font-size: 11px;
      color: rgba(255,255,255,0.45);
    }

    .count-current {
      display: inline-block;
      font-size: 18px;
      font-weight: 700;
      color: rgba(255,255,255,0.95);
      line-height: 1;
    }

    .count-sep  { opacity: 0.35; font-size: 13px; }
    .count-target { font-size: 13px; color: rgba(255,255,255,0.45); }
    .pct-badge  { margin-left: auto; font-size: 12px; font-weight: 700; color: #4fc3f7; }

    /* ════════════════════════════════════════════════════════════
       SIMPLE
       ════════════════════════════════════════════════════════════ */
    .widget.theme-simple {
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-left: 3px solid #4fc3f7;
    }

    .widget.theme-simple.completed {
      border-left-color: #81efb8;
      animation: simple-complete-flash 0.7s ease-out;
    }
    @keyframes simple-complete-flash {
      0%, 100% { border-left-color: #4fc3f7; }
      25%       { border-left-color: #fff; }
      60%       { border-left-color: #81efb8; }
    }
    .widget.theme-simple.completed .bar-fill {
      background: #81efb8;
      box-shadow: 0 0 8px rgba(129,239,184,0.5);
    }
    .widget.theme-simple.completed .pct-badge { color: #81efb8; }

    /* ════════════════════════════════════════════════════════════
       FUN
       ════════════════════════════════════════════════════════════ */
    .widget.theme-fun {
      background: rgba(15,8,35,0.91);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow: 0 4px 30px rgba(0,0,0,0.4);
    }

    .widget.theme-fun .goal-label { font-size: 14px; font-weight: 700; }

    .widget.theme-fun .bar-track {
      height: 12px;
      border-radius: 100px;
      background: rgba(255,255,255,0.10);
      overflow: hidden;
    }
    .widget.theme-fun .bar-fill {
      border-radius: 100px;
      background: linear-gradient(
        90deg,
        var(--bar-color, #ff6b9d) 0%,
        color-mix(in srgb, var(--bar-color, #ff6b9d) 55%, white) 100%
      );
      background-size: 200% 100%;
      animation: fun-shimmer 2.6s ease-in-out infinite;
      box-shadow: 0 0 10px var(--bar-color, #ff6b9d);
    }
    @keyframes fun-shimmer {
      0%   { background-position: 100% 50%; }
      100% { background-position:   0% 50%; }
    }

    .widget.theme-fun .count-current {
      font-size: 20px;
      color: var(--bar-color, #ff6b9d);
      text-shadow: 0 0 14px var(--bar-color, #ff6b9d);
    }
    .widget.theme-fun .pct-badge { color: var(--bar-color, #ff6b9d); }

    .widget.theme-fun.completed { animation: fun-bounce 0.5s cubic-bezier(0.2, 0, 0.2, 1.7); }
    @keyframes fun-bounce {
      0% { transform: scale(1); }
      40% { transform: scale(1.06); }
      100% { transform: scale(1); }
    }
    .widget.theme-fun.completed .bar-fill {
      animation: fun-rainbow 0.9s linear infinite;
    }
    @keyframes fun-rainbow {
      0%   { filter: hue-rotate(0deg); }
      100% { filter: hue-rotate(360deg); }
    }

    /* ════════════════════════════════════════════════════════════
       FUTURE
       ════════════════════════════════════════════════════════════ */
    .widget.theme-future {
      background: rgba(0,4,12,0.95);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(0,229,255,0.45);
      border-radius: 4px;
      box-shadow:
        0 0 20px rgba(0,229,255,0.08),
        0 0 60px rgba(0,229,255,0.04),
        inset 0 0 20px rgba(0,229,255,0.02);
      font-family: 'JetBrains Mono', 'Courier New', monospace;
      padding-top: 0;
    }
    .widget.theme-future::before {
      content: '';
      position: absolute;
      inset: 0;
      background: repeating-linear-gradient(
        0deg,
        transparent 0px, transparent 3px,
        rgba(0,229,255,0.013) 3px, rgba(0,229,255,0.013) 4px
      );
      pointer-events: none;
      border-radius: inherit;
      z-index: 0;
    }
    .widget.theme-future > * { position: relative; z-index: 1; }

    .future-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 0 8px;
      border-bottom: 1px solid rgba(0,229,255,0.2);
      margin-bottom: 10px;
    }
    .future-tag {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 1.8px;
      color: rgba(0,229,255,0.65);
      text-transform: uppercase;
    }
    .future-achieved {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 1.5px;
      color: #00ff88;
      animation: future-blink 1s ease-in-out infinite;
    }
    @keyframes future-blink {
      0%, 75%, 100% { opacity: 1; }
      40%            { opacity: 0.35; }
    }

    .widget.theme-future .goal-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: rgba(255,255,255,0.88);
    }
    .widget.theme-future .bar-track {
      height: 14px;
      background: rgba(0,229,255,0.06);
      border-radius: 2px;
      border: 1px solid rgba(0,229,255,0.2);
      overflow: hidden;
    }
    .widget.theme-future .bar-fill {
      border-radius: 1px;
      background: linear-gradient(90deg, #00e5ff 0%, #7b2ff7 100%);
      mask: repeating-linear-gradient(
        90deg, #000 0px, #000 11px, transparent 11px, transparent 13px
      );
      -webkit-mask: repeating-linear-gradient(
        90deg, #000 0px, #000 11px, transparent 11px, transparent 13px
      );
      box-shadow: 0 0 8px rgba(0,229,255,0.4);
    }

    .tick-row {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 8px;
      color: rgba(0,229,255,0.3);
      letter-spacing: 0.5px;
    }

    .widget.theme-future .count-current {
      font-size: 20px;
      color: #00e5ff;
      text-shadow: 0 0 10px rgba(0,229,255,0.5);
    }
    .widget.theme-future .count-sep    { color: rgba(0,229,255,0.3); }
    .widget.theme-future .count-target { color: rgba(0,229,255,0.4); }
    .widget.theme-future .pct-badge    { color: rgba(0,229,255,0.65); font-size: 11px; }
    .widget.theme-future .meta-row     { margin-top: 10px; }

    .future-complete-row {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(0,255,136,0.3);
      font-size: 9px;
      letter-spacing: 1.4px;
      color: #00ff88;
      text-transform: uppercase;
      animation: future-blink 1.3s ease-in-out infinite;
    }

    .widget.theme-future.completed {
      border-color: rgba(0,255,136,0.5);
      box-shadow:
        0 0 25px rgba(0,255,136,0.15),
        0 0 60px rgba(0,255,136,0.06),
        inset 0 0 20px rgba(0,255,136,0.04);
    }
    .widget.theme-future.completed .bar-fill {
      background: linear-gradient(90deg, #00ff88 0%, #00e5ff 100%);
      box-shadow: 0 0 14px rgba(0,255,136,0.55);
    }
    .widget.theme-future.completed .future-tag { color: rgba(0,255,136,0.6); }

    /* ════════════════════════════════════════════════════════════
       OTTER
       ════════════════════════════════════════════════════════════ */
    .widget.theme-otter {
      background: rgba(28,14,2,0.89);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 2px solid rgba(245,158,11,0.4);
      border-radius: 20px;
      box-shadow: 0 4px 25px rgba(0,0,0,0.4);
    }

    .widget.theme-otter .goal-label {
      font-size: 14px;
      font-weight: 700;
      color: rgba(255,228,170,0.97);
    }
    .widget.theme-otter .bar-area { padding: 10px 0 6px; }
    .widget.theme-otter .bar-track {
      height: 12px;
      border-radius: 100px;
      background: rgba(245,158,11,0.14);
      border: 1px solid rgba(245,158,11,0.2);
      overflow: visible;
    }
    .widget.theme-otter .bar-fill {
      border-radius: 100px;
      background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 55%, #fde68a 100%);
      box-shadow: 0 0 12px rgba(245,158,11,0.5);
    }

    .otter-rider {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: 18px;
      line-height: 1;
      transition: left 0.65s cubic-bezier(0.4, 0, 0.2, 1);
      animation: otter-bob 2.2s ease-in-out infinite;
      filter: drop-shadow(0 1px 4px rgba(245,158,11,0.6));
    }
    @keyframes otter-bob {
      0%, 100% { transform: translate(-50%, -50%) rotate(-6deg); }
      50%       { transform: translate(-50%, calc(-50% - 3px)) rotate(6deg); }
    }

    .widget.theme-otter .count-current { font-size: 18px; color: #fbbf24; }
    .widget.theme-otter .meta-row      { color: rgba(245,158,11,0.45); }
    .widget.theme-otter .count-sep     { color: rgba(245,158,11,0.3); }
    .widget.theme-otter .count-target  { color: rgba(245,158,11,0.45); }
    .widget.theme-otter .pct-badge     { color: #fbbf24; }

    .widget.theme-otter.completed {
      border-color: rgba(251,191,36,0.7);
      box-shadow: 0 0 28px rgba(245,158,11,0.3), 0 4px 25px rgba(0,0,0,0.4);
      animation: otter-complete 0.7s cubic-bezier(0.2, 0, 0.2, 1.5);
    }
    @keyframes otter-complete {
      0%   { transform: scale(1) rotate(0); }
      35%  { transform: scale(1.05) rotate(1.5deg); }
      65%  { transform: scale(1.02) rotate(-0.5deg); }
      100% { transform: scale(1) rotate(0); }
    }
  `],
  template: `
    @if (loaded()) {
      <div class="widget"
           [class]="'theme-' + theme()"
           [class.completed]="completed()"
           [@widgetEnter]>

        @if (theme() === 'future') {
          <div class="future-hdr">
            <span class="future-tag">◈ OBJECTIVE</span>
            @if (completed()) {
              <span class="future-achieved" [@completedRow]>◈ ACHIEVED</span>
            }
          </div>
        }

        <div class="goal-row">
          @if (theme() === 'fun')   { <span class="theme-icon">🎯</span> }
          @if (theme() === 'otter') { <span class="theme-icon">🦦</span> }
          <div class="goal-label">{{ label() || metricLabel() }}</div>
          @if (completed() && theme() === 'fun')   { <span class="theme-icon" [@celebIn]>🎉</span> }
          @if (completed() && theme() === 'otter') { <span class="theme-icon" [@celebIn]>✨</span> }
        </div>

        <div class="bar-area">
          <div class="bar-track">
            <div class="bar-fill"
                 [style.width.%]="pct()"
                 [style.--bar-color]="barColor()"
                 [@barPulse]="current()">
            </div>
          </div>

          @if (theme() === 'future') {
            <div class="tick-row">
              <span>0</span><span>25%</span><span>50%</span><span>75%</span><span>100</span>
            </div>
          }

          @if (theme() === 'otter') {
            <div class="otter-rider" [style.left.%]="otterLeft()">🦦</div>
          }
        </div>

        <div class="meta-row">
          <span class="count-current" [@countUp]="current()">{{ current() }}</span>
          <span class="count-sep">/</span>
          <span class="count-target">{{ target() }}</span>
          <span class="pct-badge">{{ pctDisplay() }}%</span>
        </div>

        @if (completed() && theme() === 'future') {
          <div class="future-complete-row" [@completedRow]>▶ TARGET ACQUIRED — STANDING BY</div>
        }

      </div>
    }
  `,
})
export class GoalSingleOverlayComponent implements OnInit, OnDestroy {
  private readonly socket = inject(SocketService);
  private readonly http   = inject(HttpClient);

  readonly loaded   = signal(false);
  readonly theme    = signal<GoalTheme>('simple');
  readonly platform = signal<GoalPlatform>('all');
  readonly metric   = signal<GoalMetric>('follow');
  readonly target   = signal<number>(100);
  readonly label    = signal<string>('');
  readonly current  = signal<number>(0);

  readonly pct         = computed(() => {
    const t = this.target();
    return t > 0 ? Math.min((this.current() / t) * 100, 100) : 0;
  });
  readonly pctDisplay  = computed(() => Math.round(this.pct()));
  readonly completed   = computed(() => this.target() > 0 && this.current() >= this.target());
  readonly metricLabel = computed(() => METRIC_LABELS[this.metric()]);
  readonly barColor    = computed(() => PLATFORM_COLORS[this.platform()] ?? '#4fc3f7');
  readonly otterLeft   = computed(() => Math.max(3, Math.min(97, this.pct())));

  private _poll: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this._fetchSettings();
    this._poll = setInterval(() => this._fetchSettings(), POLL_MS);

    this.socket.socket.on('ottery:overlay-settings', (s: Record<string, unknown>) => {
      this._applySettings(s);
    });

    this.socket.socket.on('ottery:event', (e: { platform: string; type: string; data: Record<string, unknown> }) => {
      if (this.platform() !== 'all' && e.platform !== this.platform()) return;
      const eventTypes = METRIC_EVENT_MAP[this.metric()];
      if (!eventTypes.includes(e.type)) return;

      let inc = 1;
      if (e.type === 'cheer' && typeof e.data?.['bits']   === 'number') inc = e.data['bits']   as number;
      if (e.type === 'tip'   && typeof e.data?.['amount'] === 'number') inc = e.data['amount'] as number;
      this.current.update(v => v + inc);
    });

    this.socket.socket.on('ottery:session', (d: { state: string }) => {
      if (d.state === 'idle') this.current.set(0);
    });
  }

  ngOnDestroy(): void {
    if (this._poll !== null) clearInterval(this._poll);
  }

  private async _fetchSettings(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<Record<string, unknown>>('/api/settings'));
      this._applySettings(s);
      this.loaded.set(true);
    } catch { this.loaded.set(true); }
  }

  private _applySettings(s: Record<string, unknown>): void {
    if (s[KEY_THEME]    != null) this.theme.set((s[KEY_THEME]    as GoalTheme)    || 'simple');
    if (s[KEY_PLATFORM] != null) this.platform.set((s[KEY_PLATFORM] as GoalPlatform) || 'all');
    if (s[KEY_METRIC]   != null) this.metric.set((s[KEY_METRIC]   as GoalMetric)   || 'follow');
    if (s[KEY_TARGET]   != null) this.target.set(Number(s[KEY_TARGET]) || 100);
    if (s[KEY_LABEL]    != null) this.label.set(String(s[KEY_LABEL] ?? ''));
  }
}
