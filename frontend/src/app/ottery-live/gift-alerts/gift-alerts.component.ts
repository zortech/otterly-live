import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import {
  GiftAlertsService, GiftAnimation, GiftAnimationInput, GiftEventType, Platform, Position,
} from './gift-alerts.service';

const PLATFORMS: Platform[] = [
  'twitch', 'youtube', 'kick', 'tiktok', 'facebook', 'bilibili', 'joystick', 'rumble', 'x',
];

const EVENT_TYPES: { key: GiftEventType; label: string }[] = [
  { key: 'tip',             label: 'Tip / Gift'   },
  { key: 'cheer',           label: 'Cheer (bits)' },
  { key: 'subscribe',       label: 'Subscribe'    },
  { key: 'subscribe.gift',  label: 'Gift Sub'     },
  { key: 'redeem',          label: 'Channel Point Redeem' },
];

const POSITIONS: Position[] = ['center', 'top', 'bottom', 'left', 'right'];

const PLATFORM_COLOR: Record<string, string> = {
  twitch:   '#9146ff',
  youtube:  '#ff0000',
  kick:     '#53fc18',
  tiktok:   '#fe2c55',
  facebook: '#1877f2',
  bilibili: '#00aeec',
  joystick: '#8b5cf6',
  rumble:   '#85c742',
  x:        '#c9cdd1',
};

function emptyDraft(): GiftAnimationInput {
  return {
    label: '',
    platform: 'tiktok',
    eventType: 'tip',
    triggerKey: null,
    minAmount: null,
    animationPath: '',
    durationMs: 4000,
    soundPath: null,
    position: 'center',
    enabled: true,
    priority: 0,
  };
}

@Component({
  selector: 'app-gift-alerts',
  standalone: true,
  imports: [FormsModule, MatIconModule, RouterLink],
  styles: [`
    .page-title { font-size: 22px; font-weight: 700; color: var(--text-1); letter-spacing: -0.5px; margin-bottom: 6px; }
    .page-sub { font-size: 13px; color: var(--text-2); margin-bottom: 20px; }

    .toolbar {
      display: flex; gap: 10px; align-items: center; margin-bottom: 16px;
    }
    .toolbar .spacer { flex: 1; }

    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 14px; border-radius: 7px; font-size: 13px; font-weight: 600;
      border: 1px solid var(--border-2); background: var(--bg-raised); color: var(--text-1);
      cursor: pointer; font-family: inherit; transition: background 0.12s, border-color 0.12s;
    }
    .btn:hover  { background: var(--bg-hover); border-color: var(--accent-border); }
    .btn.primary { background: var(--accent); color: #000; border-color: var(--accent); }
    .btn.primary:hover { filter: brightness(1.05); }
    .btn.danger  { color: #ff5577; border-color: rgba(255,85,119,0.35); }
    .btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .grid {
      display: grid; grid-template-columns: 1fr 380px; gap: 20px; align-items: flex-start;
    }
    @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }

    /* ── Mapping list ───────────────────────────────────── */
    .list {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
    }
    .list-empty {
      padding: 40px 20px; text-align: center; color: var(--text-3); font-size: 13px;
    }
    .row {
      display: grid;
      grid-template-columns: 28px 1fr 100px 110px 90px 80px;
      align-items: center; gap: 12px;
      padding: 10px 14px; border-bottom: 1px solid var(--border);
      cursor: pointer; transition: background 0.1s;
    }
    .row:hover { background: var(--bg-hover); }
    .row.active { background: var(--accent-dim); }
    .row:last-child { border-bottom: none; }

    .row-dot { width: 10px; height: 10px; border-radius: 50%; }
    .row-main { min-width: 0; }
    .row-label { font-size: 13.5px; font-weight: 600; color: var(--text-1); }
    .row-meta  { font-size: 11.5px; color: var(--text-3); margin-top: 2px;
                 white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row-chip {
      display: inline-block; padding: 1px 7px; border-radius: 999px;
      font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px;
      background: var(--bg-raised); color: var(--text-2);
    }
    .variant-chip {
      display: inline-flex; align-items: center; gap: 3px;
      margin-left: 6px; padding: 1px 7px; border-radius: 999px;
      font-size: 10.5px; font-weight: 600;
      background: rgba(125, 255, 186, 0.12); color: #7dffba;
      border: 1px solid rgba(125, 255, 186, 0.25);
    }
    .variant-chip mat-icon { font-size: 11px; width: 11px; height: 11px; }
    .row-enabled {
      width: 22px; height: 22px; border-radius: 5px; cursor: pointer;
      background: var(--bg-raised); border: 1px solid var(--border-2); color: var(--text-3);
      display: inline-flex; align-items: center; justify-content: center; font-size: 12px;
    }
    .row-enabled.on { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent); }

    /* ── Editor panel ───────────────────────────────────── */
    .editor {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      padding: 18px; position: sticky; top: 12px;
    }
    .editor-title { font-size: 14px; font-weight: 700; color: var(--text-1); margin-bottom: 16px; }

    .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
    .field-label {
      font-size: 11px; font-weight: 600; color: var(--text-2);
      text-transform: uppercase; letter-spacing: 0.7px;
    }
    .field-hint { font-size: 11px; color: var(--text-3); }
    .field-input, .field-select {
      background: var(--bg-raised); border: 1px solid var(--border-2); border-radius: 6px;
      padding: 6px 10px; font-size: 13px; color: var(--text-1); font-family: inherit;
      outline: none; transition: border-color 0.1s;
    }
    .field-input:focus, .field-select:focus { border-color: var(--accent); }
    select.field-input, select.field-select { cursor: pointer; width: 100%; }
    input.field-input { width: 100%; box-sizing: border-box; }

    .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .row-2 .field { margin-bottom: 0; }

    .ed-actions {
      display: flex; gap: 8px; margin-top: 12px;
      padding-top: 14px; border-top: 1px solid var(--border);
    }
    .ed-actions .spacer { flex: 1; }

    .legal-note {
      margin-top: 16px; padding: 10px 12px;
      background: rgba(254, 44, 85, 0.07); border: 1px solid rgba(254, 44, 85, 0.18);
      border-radius: 8px; font-size: 11.5px; color: var(--text-2); line-height: 1.5;
    }
    .legal-note strong { color: var(--text-1); }
  `],
  template: `
    <h1 class="page-title">Gift Alerts</h1>
    <p class="page-sub">
      Custom animations for tips, gifts, subscriptions, bits, and channel-point redeems.
      Configure each mapping here, then drag the overlay URL from
      <a routerLink="/ottery-live/interfaces" style="color:var(--accent);">Interfaces</a>
      into OBS.
    </p>

    <div class="toolbar">
      <button class="btn primary" (click)="startCreate()">
        <mat-icon>add</mat-icon> New mapping
      </button>
      <button class="btn" (click)="refresh()">
        <mat-icon>refresh</mat-icon> Refresh
      </button>
      <span class="spacer"></span>
      <span style="font-size:12px;color:var(--text-3);">
        TikTok gifts cached: {{ tiktokGifts().length }}
      </span>
    </div>

    <div class="grid">
      <!-- List -->
      <div class="list">
        @if (mappings().length === 0) {
          <div class="list-empty">
            No animations yet. Click <strong>New mapping</strong> above to set one up.
          </div>
        }
        @for (m of mappings(); track m.id) {
          <div class="row" [class.active]="draft()?.id === m.id" (click)="startEdit(m)">
            <span class="row-dot" [style.background]="platformColor(m.platform)"></span>
            <div class="row-main">
              <div class="row-label">
                {{ m.label || '(unnamed)' }}
                @if (variantBadge(m); as badge) {
                  <span class="variant-chip" title="One of {{ badge.split('/')[1] }} random variants for this trigger">
                    <mat-icon>shuffle</mat-icon>{{ badge }}
                  </span>
                }
              </div>
              <div class="row-meta">
                {{ m.platform }} · {{ eventLabel(m.eventType) }}
                @if (m.triggerKey) { · key: {{ triggerKeyLabel(m) }} }
                @if (m.minAmount != null) { · ≥ {{ m.minAmount }} }
              </div>
            </div>
            <span class="row-chip">{{ m.position }}</span>
            <span class="row-meta">{{ shortPath(m.animationPath) }}</span>
            <span class="row-meta">{{ m.durationMs }}ms</span>
            <button class="row-enabled" [class.on]="m.enabled"
              (click)="toggleEnabled(m, $event)"
              [title]="m.enabled ? 'Enabled' : 'Disabled'">
              {{ m.enabled ? '✓' : '' }}
            </button>
          </div>
        }
      </div>

      <!-- Editor -->
      @if (draft(); as d) {
        <div class="editor">
          <div class="editor-title">
            {{ d.id ? 'Edit mapping' : 'New mapping' }}
          </div>

          <div class="field">
            <span class="field-label">Label</span>
            <input class="field-input" type="text" [(ngModel)]="d.label" placeholder="e.g. Rose burst" />
          </div>

          <div class="row-2">
            <div class="field">
              <span class="field-label">Platform</span>
              <select class="field-select" [(ngModel)]="d.platform" (ngModelChange)="onPlatformChange()">
                @for (p of platforms; track p) { <option [value]="p">{{ p }}</option> }
              </select>
            </div>
            <div class="field">
              <span class="field-label">Event</span>
              <select class="field-select" [(ngModel)]="d.eventType" (ngModelChange)="onEventChange()">
                @for (e of eventTypes; track e.key) { <option [value]="e.key">{{ e.label }}</option> }
              </select>
            </div>
          </div>

          <!-- Trigger key — semantics depend on platform/event -->
          <div class="field">
            <span class="field-label">{{ triggerKeyLabelText() }}</span>
            @if (d.platform === 'tiktok' && d.eventType === 'tip' && tiktokGifts().length > 0) {
              <select class="field-select" [ngModel]="d.triggerKey ?? ''"
                (ngModelChange)="d.triggerKey = $event || null">
                <option value="">Any TikTok gift</option>
                @for (g of tiktokGifts(); track g.id) {
                  <option [value]="g.id">{{ g.name }} ({{ g.diamondCount }}💎)</option>
                }
              </select>
            } @else {
              <input class="field-input" type="text" [ngModel]="d.triggerKey ?? ''"
                (ngModelChange)="d.triggerKey = $event || null"
                [placeholder]="triggerKeyPlaceholder()" />
            }
            <span class="field-hint">{{ triggerKeyHint() }}</span>
          </div>

          @if (d.eventType === 'cheer' || d.eventType === 'tip' || d.eventType === 'subscribe.gift') {
            <div class="field">
              <span class="field-label">Minimum amount</span>
              <input class="field-input" type="number" min="0" [ngModel]="d.minAmount ?? ''"
                (ngModelChange)="d.minAmount = $event === '' || $event == null ? null : +$event"
                placeholder="Any amount" />
              <span class="field-hint">{{ minAmountHint() }}</span>
            </div>
          }

          <div class="field">
            <span class="field-label">Animation file</span>
            @if (assets().length > 0) {
              <select class="field-select" [(ngModel)]="d.animationPath">
                <option value="">— select an asset —</option>
                @for (a of assets(); track a) { <option [value]="a">{{ a }}</option> }
              </select>
            } @else {
              <input class="field-input" type="text" [(ngModel)]="d.animationPath"
                placeholder="filename.json / .webp / .mp4 / .gif" />
            }
            <span class="field-hint">
              Drop files into your overlay-assets folder. Supports Lottie .json, .webp, .gif, .png, .mp4, .webm.
            </span>
          </div>

          <div class="row-2">
            <div class="field">
              <span class="field-label">Duration (ms)</span>
              <input class="field-input" type="number" min="500" max="20000" step="100"
                [(ngModel)]="d.durationMs" />
            </div>
            <div class="field">
              <span class="field-label">Position</span>
              <select class="field-select" [(ngModel)]="d.position">
                @for (p of positions; track p) { <option [value]="p">{{ p }}</option> }
              </select>
            </div>
          </div>

          <div class="field">
            <span class="field-label">Sound (optional)</span>
            <input class="field-input" type="text" [ngModel]="d.soundPath ?? ''"
              (ngModelChange)="d.soundPath = $event || null"
              placeholder="ding.mp3" />
          </div>

          <div class="row-2">
            <div class="field">
              <span class="field-label">Priority</span>
              <input class="field-input" type="number" [(ngModel)]="d.priority" />
            </div>
            <div class="field">
              <span class="field-label">Enabled</span>
              <select class="field-select" [ngModel]="d.enabled"
                (ngModelChange)="d.enabled = $event === 'true' || $event === true">
                <option [ngValue]="true">Yes</option>
                <option [ngValue]="false">No</option>
              </select>
            </div>
          </div>

          <div class="ed-actions">
            @if (d.id) {
              <button class="btn danger" (click)="remove()">
                <mat-icon>delete</mat-icon> Delete
              </button>
              <button class="btn" (click)="duplicateAsVariant()"
                title="Save a copy with the same trigger so the overlay randomizes between them">
                <mat-icon>shuffle</mat-icon> Add variant
              </button>
            }
            <span class="spacer"></span>
            <button class="btn" (click)="testFire()">
              <mat-icon>play_arrow</mat-icon> Test
            </button>
            <button class="btn" (click)="cancel()">Cancel</button>
            <button class="btn primary" (click)="save()" [disabled]="!isValid()">
              <mat-icon>save</mat-icon> Save
            </button>
          </div>

          @if (d.platform === 'tiktok') {
            <div class="legal-note">
              <strong>TikTok gift assets.</strong> Animations you author here are your own work
              and play on any scene. To show TikTok's built-in gift artwork as a fallback for
              <em>unmapped</em> gifts, use the "Gift Alerts (with TikTok assets)" overlay URL —
              never the "safe" one — and only on a TikTok-led broadcast scene.
            </div>
          }
        </div>
      } @else {
        <div class="editor" style="text-align:center; color: var(--text-3); font-size: 13px;">
          Select a mapping from the list or click <strong>New mapping</strong>.
        </div>
      }
    </div>
  `,
})
export class GiftAlertsComponent implements OnInit {
  private readonly svc = inject(GiftAlertsService);
  private readonly snack = inject(MatSnackBar);

  readonly platforms   = PLATFORMS;
  readonly eventTypes  = EVENT_TYPES;
  readonly positions   = POSITIONS;

  readonly mappings    = this.svc.mappings;
  readonly tiktokGifts = this.svc.tiktokGifts;
  readonly assets      = this.svc.assets;

  // Each enabled mapping gets a (variantIndex, variantCount) within its variant group.
  // Two mappings are in the same variant group if they share (platform, eventType, triggerKey, minAmount, priority)
  // — which is exactly the set the overlay randomizes among.
  readonly variantInfo = computed(() => {
    const groups = new Map<string, GiftAnimation[]>();
    for (const m of this.mappings()) {
      if (!m.enabled) continue;
      const key = [m.platform, m.eventType, m.triggerKey ?? '', m.minAmount ?? '', m.priority].join('|');
      const list = groups.get(key);
      if (list) list.push(m); else groups.set(key, [m]);
    }
    const info = new Map<number, { index: number; count: number }>();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.id - b.id);
      list.forEach((m, i) => info.set(m.id, { index: i + 1, count: list.length }));
    }
    return info;
  });

  // Draft includes id when editing an existing row
  readonly draft = signal<(GiftAnimationInput & { id?: number }) | null>(null);

  async ngOnInit(): Promise<void> {
    await Promise.all([this.svc.load(), this.svc.loadTikTokGifts(), this.svc.loadAssets()]);
  }

  async refresh(): Promise<void> {
    await Promise.all([this.svc.load(), this.svc.loadTikTokGifts(), this.svc.loadAssets()]);
  }

  startCreate(): void {
    this.draft.set(emptyDraft());
  }

  startEdit(m: GiftAnimation): void {
    const { id, createdAt, updatedAt, ...rest } = m;
    this.draft.set({ ...rest, id });
  }

  cancel(): void {
    this.draft.set(null);
  }

  isValid(): boolean {
    const d = this.draft();
    return !!d && !!d.label.trim() && !!d.animationPath.trim() && d.durationMs > 0;
  }

  async save(): Promise<void> {
    const d = this.draft();
    if (!d || !this.isValid()) return;
    try {
      const { id, ...input } = d;
      if (id) await this.svc.update(id, input);
      else    await this.svc.create(input);
      this.snack.open('Saved', 'OK', { duration: 1800 });
      this.draft.set(null);
    } catch (err: unknown) {
      this.snack.open('Save failed: ' + (err instanceof Error ? err.message : 'unknown'), 'Dismiss', { duration: 4000 });
    }
  }

  async remove(): Promise<void> {
    const d = this.draft();
    if (!d?.id) return;
    if (!confirm(`Delete "${d.label}"?`)) return;
    try {
      await this.svc.remove(d.id);
      this.draft.set(null);
      this.snack.open('Deleted', 'OK', { duration: 1500 });
    } catch (err: unknown) {
      this.snack.open('Delete failed', 'Dismiss', { duration: 3000 });
    }
  }

  async toggleEnabled(m: GiftAnimation, ev: MouseEvent): Promise<void> {
    ev.stopPropagation();
    try {
      await this.svc.update(m.id, { enabled: !m.enabled });
    } catch {
      this.snack.open('Could not toggle', 'Dismiss', { duration: 2500 });
    }
  }

  duplicateAsVariant(): void {
    const d = this.draft();
    if (!d) return;
    // Drop the id, clear animation/sound paths (variants should differ), bump label.
    const { id, ...rest } = d;
    this.draft.set({
      ...rest,
      label: rest.label ? `${rest.label.replace(/\s+v\d+$/, '')} v${this.nextVariantIndex(rest)}` : '',
      animationPath: '',
      soundPath: null,
    });
  }

  private nextVariantIndex(d: GiftAnimationInput): number {
    const matching = this.mappings().filter((m) =>
      m.platform === d.platform &&
      m.eventType === d.eventType &&
      (m.triggerKey ?? null) === (d.triggerKey ?? null) &&
      (m.minAmount ?? null) === (d.minAmount ?? null) &&
      m.priority === d.priority
    );
    return matching.length + 1;
  }

  async testFire(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    try {
      await this.svc.test({
        platform: d.platform,
        eventType: d.eventType,
        triggerKey: d.triggerKey ?? undefined,
        amount: d.minAmount ?? undefined,
        giftName: d.label,
      });
      this.snack.open('Test event fired — check your overlay', 'OK', { duration: 2200 });
    } catch {
      this.snack.open('Test failed', 'Dismiss', { duration: 3000 });
    }
  }

  onPlatformChange(): void {
    const d = this.draft();
    if (!d) return;
    // Reset triggerKey when switching platforms because its semantics change
    d.triggerKey = null;
  }

  onEventChange(): void {
    const d = this.draft();
    if (!d) return;
    d.triggerKey = null;
    d.minAmount = null;
  }

  triggerKeyLabelText(): string {
    const d = this.draft();
    if (!d) return 'Trigger key';
    if (d.platform === 'tiktok' && d.eventType === 'tip') return 'TikTok gift (or leave empty for any)';
    if (d.eventType === 'redeem')                          return 'Twitch reward ID (optional)';
    if (d.eventType === 'subscribe' || d.eventType === 'subscribe.gift') return 'Sub tier (1000/2000/3000)';
    return 'Trigger key (optional)';
  }

  triggerKeyPlaceholder(): string {
    const d = this.draft();
    if (!d) return '';
    if (d.eventType === 'redeem') return 'reward UUID — leave blank to match all';
    if (d.eventType === 'subscribe' || d.eventType === 'subscribe.gift') return '1000';
    return '';
  }

  triggerKeyHint(): string {
    const d = this.draft();
    if (!d) return '';
    if (d.platform === 'tiktok' && d.eventType === 'tip') {
      return this.tiktokGifts().length === 0
        ? 'Connect your TikTok stream once so we can cache gift definitions, then pick from the dropdown.'
        : 'Pick a specific gift to override its animation, or "Any" to catch all TikTok gifts.';
    }
    if (d.eventType === 'redeem') return 'Match a specific Twitch channel-point reward, or leave blank for any.';
    return 'Optional — leave blank to match all events of this type.';
  }

  minAmountHint(): string {
    const d = this.draft();
    if (!d) return '';
    if (d.eventType === 'cheer')          return 'Minimum bits to trigger this animation.';
    if (d.eventType === 'tip')            return 'Minimum tip amount (in the platform\'s units).';
    if (d.eventType === 'subscribe.gift') return 'Minimum gift count to trigger.';
    return '';
  }

  variantBadge(m: GiftAnimation): string | null {
    const info = this.variantInfo().get(m.id);
    return info ? `${info.index}/${info.count}` : null;
  }

  triggerKeyLabel(m: GiftAnimation): string {
    if (!m.triggerKey) return '—';
    if (m.platform === 'tiktok' && m.eventType === 'tip') {
      const g = this.tiktokGifts().find((x) => x.id === m.triggerKey);
      return g ? g.name : m.triggerKey;
    }
    return m.triggerKey;
  }

  eventLabel(t: GiftEventType): string {
    return EVENT_TYPES.find((e) => e.key === t)?.label ?? t;
  }

  platformColor(p: string): string {
    return PLATFORM_COLOR[p] ?? '#7c8aa0';
  }

  shortPath(p: string): string {
    if (!p) return '—';
    if (p.length <= 22) return p;
    return p.slice(0, 19) + '…';
  }
}
