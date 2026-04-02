import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SocketService } from '../socket.service';
import {
  GoalTheme, GoalConfig, GoalMetric,
  METRIC_EVENT_MAP, METRIC_LABELS, PLATFORM_COLORS,
  DEFAULT_GOAL_CONFIG,
} from './goal-types';

const KEY_THEME = 'overlay.goalMulti.theme';
const KEY_GOALS = 'overlay.goalMulti.goals';
const POLL_MS   = 30_000;

interface ActiveGoal extends GoalConfig { idx: number; }

@Component({
  selector: 'overlay-goal-multi',
  standalone: true,
  animations: [
    trigger('widgetEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(12px)' }),
        animate('320ms cubic-bezier(0.2, 0, 0, 1)', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
    trigger('rowEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(-8px)' }),
        animate('260ms cubic-bezier(0.2, 0, 0, 1)', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
    trigger('countUp', [
      transition(':increment', [
        style({ transform: 'translateY(-6px)', opacity: 0 }),
        animate('200ms cubic-bezier(0.2, 0, 0, 1)', style({ transform: 'none', opacity: 1 })),
      ]),
      transition(':decrement', [
        style({ transform: 'translateY(4px)', opacity: 0 }),
        animate('180ms ease-out', style({ transform: 'none', opacity: 1 })),
      ]),
    ]),
    trigger('barPulse', [
      transition(':increment', [
        style({ filter: 'brightness(1)' }),
        animate('75ms', style({ filter: 'brightness(2.5)' })),
        animate('480ms ease-out', style({ filter: 'brightness(1)' })),
      ]),
    ]),
  ],
  styles: [`
    :host {
      display: block;
      position: fixed;
      top: 16px;
      left: 16px;
      width: 420px;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* ── Base widget ────────────────────────────────────────────── */
    .widget {
      position: relative;
      border-radius: 12px;
      padding: 12px 14px;
    }

    /* ── Goal row structure ──────────────────────────────────────── */
    .goal-item {
      display: grid;
      grid-template-columns: 8px 1fr auto;
      grid-template-rows: auto auto;
      column-gap: 9px;
      row-gap: 3px;
      padding: 8px 0;
    }
    .goal-item + .goal-item { border-top: 1px solid rgba(255,255,255,0.07); }

    .platform-dot {
      grid-column: 1;
      grid-row: 1 / span 2;
      align-self: center;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .goal-label {
      grid-column: 2;
      grid-row: 1;
      font-size: 12px;
      font-weight: 600;
      color: rgba(255,255,255,0.88);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .goal-count {
      grid-column: 3;
      grid-row: 1;
      font-size: 11px;
      font-weight: 600;
      color: rgba(255,255,255,0.55);
      white-space: nowrap;
      text-align: right;
    }

    .count-cur {
      display: inline-block;
      font-size: 13px;
      font-weight: 700;
      color: rgba(255,255,255,0.9);
    }

    .bar-wrap {
      grid-column: 2 / span 2;
      grid-row: 2;
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .bar-track {
      flex: 1;
      height: 5px;
      background: rgba(255,255,255,0.10);
      border-radius: 3px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      border-radius: 3px;
      background: #4fc3f7;
      transition: width 0.65s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .bar-pct {
      font-size: 10px;
      color: rgba(255,255,255,0.35);
      white-space: nowrap;
      min-width: 30px;
      text-align: right;
    }

    .goal-item.completed .goal-label { color: rgba(255,255,255,0.97); }
    .goal-item.completed .bar-fill   { box-shadow: 0 0 6px currentColor; }

    /* ════════════════════════════════════════════════════════════
       SIMPLE
       ════════════════════════════════════════════════════════════ */
    .widget.theme-simple {
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-left: 3px solid #4fc3f7;
    }
    .widget.theme-simple .bar-fill   { background: #4fc3f7; }
    .widget.theme-simple .bar-pct    { color: rgba(79,195,247,0.5); }
    .widget.theme-simple .count-cur  { color: rgba(255,255,255,0.92); }
    .widget.theme-simple .goal-item.completed .bar-fill { background: #81efb8; }

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
    .widget.theme-fun .goal-item + .goal-item { border-top-color: rgba(255,255,255,0.06); }
    .widget.theme-fun .bar-track {
      height: 8px;
      border-radius: 100px;
      background: rgba(255,255,255,0.08);
    }
    .widget.theme-fun .bar-fill {
      border-radius: 100px;
      background: var(--row-bar-color, #ff6b9d);
      box-shadow: 0 0 7px var(--row-bar-color, #ff6b9d);
      animation: fun-shimmer-multi 2.6s ease-in-out infinite;
    }
    @keyframes fun-shimmer-multi {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.82; }
    }
    .widget.theme-fun .count-cur  { color: var(--row-bar-color, #ff6b9d); }
    .widget.theme-fun .bar-pct    { color: rgba(255,255,255,0.3); }
    .widget.theme-fun .goal-label { font-weight: 700; }
    .widget.theme-fun .goal-item.completed .bar-fill {
      animation: fun-rainbow-multi 0.9s linear infinite;
    }
    @keyframes fun-rainbow-multi {
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

    .future-header {
      display: flex;
      align-items: center;
      padding: 6px 0 8px;
      border-bottom: 1px solid rgba(0,229,255,0.2);
      margin-bottom: 4px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 1.8px;
      color: rgba(0,229,255,0.6);
      text-transform: uppercase;
    }

    .widget.theme-future .goal-item + .goal-item {
      border-top-color: rgba(0,229,255,0.12);
    }
    .widget.theme-future .goal-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: rgba(255,255,255,0.82);
    }
    .widget.theme-future .bar-track {
      height: 8px;
      background: rgba(0,229,255,0.06);
      border: 1px solid rgba(0,229,255,0.15);
      border-radius: 1px;
      overflow: hidden;
    }
    .widget.theme-future .bar-fill {
      border-radius: 1px;
      background: linear-gradient(90deg, #00e5ff 0%, #7b2ff7 100%);
      mask: repeating-linear-gradient(
        90deg, #000 0px, #000 8px, transparent 8px, transparent 10px
      );
      -webkit-mask: repeating-linear-gradient(
        90deg, #000 0px, #000 8px, transparent 8px, transparent 10px
      );
      box-shadow: 0 0 5px rgba(0,229,255,0.4);
    }
    .widget.theme-future .count-cur  { color: #00e5ff; text-shadow: 0 0 8px rgba(0,229,255,0.5); }
    .widget.theme-future .goal-count { color: rgba(0,229,255,0.35); }
    .widget.theme-future .bar-pct    { color: rgba(0,229,255,0.4); }
    .widget.theme-future .platform-dot {
      border-radius: 1px;
      width: 6px;
      height: 6px;
    }
    .widget.theme-future .goal-item.completed .bar-fill {
      background: linear-gradient(90deg, #00ff88 0%, #00e5ff 100%);
      box-shadow: 0 0 8px rgba(0,255,136,0.5);
    }
    .widget.theme-future .goal-item.completed .count-cur { color: #00ff88; text-shadow: 0 0 8px rgba(0,255,136,0.5); }

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
    .widget.theme-otter .goal-item + .goal-item {
      border-top-color: rgba(245,158,11,0.12);
    }
    .widget.theme-otter .goal-label  { color: rgba(255,228,170,0.9); font-weight: 700; }
    .widget.theme-otter .goal-count  { color: rgba(245,158,11,0.45); }
    .widget.theme-otter .count-cur   { color: #fbbf24; }
    .widget.theme-otter .bar-track {
      height: 8px;
      border-radius: 100px;
      background: rgba(245,158,11,0.13);
      border: 1px solid rgba(245,158,11,0.18);
    }
    .widget.theme-otter .bar-fill {
      border-radius: 100px;
      background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 55%, #fde68a 100%);
      box-shadow: 0 0 8px rgba(245,158,11,0.45);
    }
    .widget.theme-otter .bar-pct { color: rgba(245,158,11,0.4); }
    .widget.theme-otter .goal-item.completed .bar-fill {
      box-shadow: 0 0 14px rgba(245,158,11,0.65);
    }
  `],
  template: `
    @if (loaded()) {
      <div class="widget"
           [class]="'theme-' + theme()"
           [@widgetEnter]>

        @if (theme() === 'future') {
          <div class="future-header">◈ OBJECTIVES ◈</div>
        }

        @for (goal of activeGoals(); track goal.idx) {
          <div class="goal-item" [class.completed]="rowCompleted(goal.idx)" [@rowEnter]>

            <div class="platform-dot"
                 [style.background]="platformColor(goal.platform)">
            </div>

            <div class="goal-label">
              {{ goal.label || metricLabel(goal.metric) }}
              @if (theme() === 'fun') {
                <span> &bull; {{ platformName(goal.platform) }}</span>
              }
            </div>

            <div class="goal-count">
              <span class="count-cur" [@countUp]="rowCurrent(goal.idx)">{{ rowCurrent(goal.idx) }}</span>
              <span> / {{ goal.target }}</span>
            </div>

            <div class="bar-wrap">
              <div class="bar-track">
                <div class="bar-fill"
                     [style.width.%]="rowPct(goal.idx)"
                     [style.--row-bar-color]="platformColor(goal.platform)"
                     [@barPulse]="rowCurrent(goal.idx)">
                </div>
              </div>
              <span class="bar-pct">{{ rowPctDisplay(goal.idx) }}%</span>
            </div>

          </div>
        }

      </div>
    }
  `,
})
export class GoalMultiOverlayComponent implements OnInit, OnDestroy {
  private readonly socket = inject(SocketService);
  private readonly http   = inject(HttpClient);

  readonly loaded   = signal(false);
  readonly theme    = signal<GoalTheme>('simple');
  readonly goals    = signal<GoalConfig[]>([]);
  readonly currents = signal<number[]>([0, 0, 0, 0]);

  readonly activeGoals = computed<ActiveGoal[]>(() =>
    this.goals()
      .map((g, idx) => ({ ...g, idx }))
      .filter(g => g.enabled && g.target > 0)
      .slice(0, 4)
  );

  private _poll: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this._fetchSettings();
    this._poll = setInterval(() => this._fetchSettings(), POLL_MS);

    this.socket.socket.on('ottery:overlay-settings', (s: Record<string, unknown>) => {
      this._applySettings(s);
    });

    this.socket.socket.on('ottery:event', (e: { platform: string; type: string; data: Record<string, unknown> }) => {
      const gs = this.goals();
      this.currents.update(prev => {
        const next = [...prev];
        gs.forEach((g, idx) => {
          if (!g.enabled) return;
          if (g.platform !== 'all' && e.platform !== g.platform) return;
          const eventTypes = METRIC_EVENT_MAP[g.metric];
          if (!eventTypes.includes(e.type)) return;

          let inc = 1;
          if (e.type === 'cheer' && typeof e.data?.['bits']   === 'number') inc = e.data['bits']   as number;
          if (e.type === 'tip'   && typeof e.data?.['amount'] === 'number') inc = e.data['amount'] as number;
          next[idx] = (next[idx] ?? 0) + inc;
        });
        return next;
      });
    });

    this.socket.socket.on('ottery:session', (d: { state: string }) => {
      if (d.state === 'idle') this.currents.set([0, 0, 0, 0]);
    });
  }

  ngOnDestroy(): void {
    if (this._poll !== null) clearInterval(this._poll);
  }

  rowCurrent(idx: number): number { return this.currents()[idx] ?? 0; }

  rowPct(idx: number): number {
    const g = this.goals()[idx];
    if (!g || g.target <= 0) return 0;
    return Math.min((this.rowCurrent(idx) / g.target) * 100, 100);
  }

  rowPctDisplay(idx: number): number { return Math.round(this.rowPct(idx)); }
  rowCompleted(idx: number): boolean {
    const g = this.goals()[idx];
    return !!g && g.target > 0 && this.rowCurrent(idx) >= g.target;
  }

  metricLabel(metric: GoalMetric): string { return METRIC_LABELS[metric]; }
  platformColor(platform: string): string { return PLATFORM_COLORS[platform] ?? '#7c8aa0'; }
  platformName(platform: string): string {
    const names: Record<string, string> = {
      all: 'All', twitch: 'Twitch', youtube: 'YouTube',
      kick: 'Kick', tiktok: 'TikTok', joystick: 'Joystick',
    };
    return names[platform] ?? platform;
  }

  private async _fetchSettings(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<Record<string, unknown>>('/api/settings'));
      this._applySettings(s);
      this.loaded.set(true);
    } catch { this.loaded.set(true); }
  }

  private _applySettings(s: Record<string, unknown>): void {
    if (s[KEY_THEME] != null) this.theme.set((s[KEY_THEME] as GoalTheme) || 'simple');
    if (s[KEY_GOALS] != null) {
      const raw = s[KEY_GOALS] as GoalConfig[];
      const normalized = Array.from({ length: 4 }, (_, i) => raw[i] ?? { ...DEFAULT_GOAL_CONFIG, enabled: false });
      this.goals.set(normalized);
    }
  }
}
