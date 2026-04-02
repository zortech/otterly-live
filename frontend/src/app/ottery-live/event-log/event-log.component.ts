import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { OtteryEvent } from '../ottery-live.service';

interface SessionSummary {
  id: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  state: 'live' | 'ended';
  total_events: number;
}

interface EventsResponse {
  events: OtteryEvent[];
  total: number;
  page: number;
  limit: number;
}

const PLATFORMS = ['twitch', 'youtube', 'kick', 'tiktok', 'x', 'joystick'];

const EVENT_TYPES = [
  'chat.message', 'follow', 'subscribe', 'subscribe.gift',
  'cheer', 'tip', 'like', 'share', 'raid',
  'stream.start', 'stream.end', 'viewer_count',
];

@Component({
  selector: 'app-event-log',
  standalone: true,
  imports: [
    MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressBarModule, DatePipe, TitleCasePipe, FormsModule,
  ],
  styles: [`
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    .page-title { font-size: 22px; font-weight: 700; color: var(--text-1); letter-spacing: -0.5px; }

    /* Filter card */
    .filter-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      padding: 18px 20px; margin-bottom: 16px;
    }
    .filter-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
    .filter-row mat-form-field { min-width: 150px; flex: 1; }
    .filter-actions { display: flex; gap: 8px; padding-bottom: 4px; }

    /* Results card */
    .results-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      padding: 18px 20px;
    }
    .results-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px;
    }
    .results-count { font-size: 12px; color: var(--text-2); }
    .pagination { display: flex; align-items: center; gap: 6px; }
    .pagination span { font-size: 12px; color: var(--text-2); }
    .page-btn {
      width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-2); cursor: pointer; font-family: inherit;
      display: flex; align-items: center; justify-content: center; transition: all 0.12s;
    }
    .page-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-1); border-color: var(--border-2); }
    .page-btn:disabled { opacity: 0.3; cursor: default; }
    .page-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .loading-bar { margin-bottom: 10px; border-radius: 4px; overflow: hidden; }

    /* Event table */
    .event-header {
      display: grid; grid-template-columns: 170px 50px 70px 120px 1fr;
      gap: 8px; padding: 0 4px 8px; border-bottom: 1px solid var(--border-2);
      margin-bottom: 4px;
    }
    .event-col-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-3); }

    .event-row {
      display: grid; grid-template-columns: 170px 50px 70px 120px 1fr;
      gap: 8px; padding: 6px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.035); align-items: center;
      transition: background 0.1s;
    }
    .event-row:last-child { border-bottom: none; }
    .event-row:hover { background: var(--bg-hover); border-radius: 5px; }

    .event-time { font-family: 'JetBrains Mono', monospace; color: var(--text-3); font-size: 11px; }
    .event-session { font-size: 11px; color: var(--text-3); font-family: 'JetBrains Mono', monospace; }
    .event-platform { font-weight: 600; font-size: 11px; text-transform: capitalize; }
    .event-actor { color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .event-data { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }

    .no-events {
      text-align: center; padding: 48px 0; color: var(--text-2); font-size: 14px;
    }
    .no-events mat-icon { font-size: 36px; width: 36px; height: 36px; color: var(--text-3); display: block; margin: 0 auto 10px; }
  `],
  template: `
    <div class="page-header">
      <h1 class="page-title">Event Log</h1>
    </div>

    <!-- Filters -->
    <div class="filter-card">
      <div class="filter-row">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Session</mat-label>
          <mat-select [value]="sessionId()" (selectionChange)="applyFilter('sessionId', $event.value)">
            <mat-option [value]="null">All sessions</mat-option>
            @for (s of sessions(); track s.id) {
              <mat-option [value]="s.id">
                #{{ s.id }} — {{ s.started_at | date:'yyyy-MM-dd HH:mm' }}
                ({{ s.total_events }} events)
              </mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Platform</mat-label>
          <mat-select multiple [value]="platforms()" (selectionChange)="applyFilter('platform', $event.value.join(','))">
            @for (p of availablePlatforms; track p) {
              <mat-option [value]="p">{{ p | titlecase }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Event Type</mat-label>
          <mat-select multiple [value]="types()" (selectionChange)="applyFilter('type', $event.value.join(','))">
            @for (t of availableTypes; track t) {
              <mat-option [value]="t">{{ t }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>From</mat-label>
          <input matInput type="date" [value]="from()" (change)="applyFilter('from', $any($event.target).value)">
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>To</mat-label>
          <input matInput type="date" [value]="to()" (change)="applyFilter('to', $any($event.target).value)">
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Search actor</mat-label>
          <input matInput [value]="search()" (keyup.enter)="applyFilter('search', $any($event.target).value)">
          <mat-hint>Press Enter to search</mat-hint>
        </mat-form-field>

        <div class="filter-actions">
          <button mat-stroked-button (click)="resetFilters()">
            <mat-icon>clear</mat-icon>
            Reset
          </button>
        </div>
      </div>
    </div>

    <!-- Results -->
    <div class="results-card">
      @if (loading()) {
        <div class="loading-bar"><mat-progress-bar mode="indeterminate" /></div>
      }

      <div class="results-header">
        <span class="results-count">
          {{ total() }} event{{ total() === 1 ? '' : 's' }} found
        </span>
        @if (totalPages() > 1) {
          <div class="pagination">
            <button class="page-btn" [disabled]="page() <= 1" (click)="prevPage()">
              <mat-icon>chevron_left</mat-icon>
            </button>
            <span>{{ page() }} / {{ totalPages() }}</span>
            <button class="page-btn" [disabled]="page() >= totalPages()" (click)="nextPage()">
              <mat-icon>chevron_right</mat-icon>
            </button>
          </div>
        }
      </div>

      @if (events().length === 0 && !loading()) {
        <div class="no-events">
          <mat-icon>event_busy</mat-icon>
          No events found. Try adjusting your filters or stream to generate events.
        </div>
      } @else if (events().length > 0) {
        <div class="event-header">
          <span class="event-col-label">Time</span>
          <span class="event-col-label">Sess.</span>
          <span class="event-col-label">Platform</span>
          <span class="event-col-label">Actor</span>
          <span class="event-col-label">Event</span>
        </div>
        @for (event of events(); track event.id) {
          <div class="event-row">
            <span class="event-time">{{ event.timestamp | date:'yyyy-MM-dd HH:mm:ss' }}</span>
            <span class="event-session">#{{ event.sessionId }}</span>
            <span class="event-platform" [style.color]="platformColor(event.platform)">{{ event.platform }}</span>
            <span class="event-actor">{{ event.actor?.displayName ?? event.actor?.username ?? '' }}</span>
            <span class="event-data">{{ eventSummary(event) }}</span>
          </div>
        }
      }

      @if (totalPages() > 1) {
        <div class="results-header" style="margin-top:14px;margin-bottom:0">
          <span></span>
          <div class="pagination">
            <button class="page-btn" [disabled]="page() <= 1" (click)="prevPage()">
              <mat-icon>chevron_left</mat-icon>
            </button>
            <span>{{ page() }} / {{ totalPages() }}</span>
            <button class="page-btn" [disabled]="page() >= totalPages()" (click)="nextPage()">
              <mat-icon>chevron_right</mat-icon>
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class EventLogComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy$ = new Subject<void>();

  readonly availablePlatforms = PLATFORMS;
  readonly availableTypes = EVENT_TYPES;

  readonly sessionId = signal<number | null>(null);
  readonly platforms = signal<string[]>([]);
  readonly types = signal<string[]>([]);
  readonly from = signal<string>('');
  readonly to = signal<string>('');
  readonly search = signal<string>('');
  readonly page = signal<number>(1);
  readonly limit = 50;

  readonly events = signal<OtteryEvent[]>([]);
  readonly total = signal<number>(0);
  readonly loading = signal<boolean>(false);
  readonly sessions = signal<SessionSummary[]>([]);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));

  ngOnInit(): void {
    this.http.get<SessionSummary[]>('/api/stream-sessions')
      .pipe(takeUntil(this.destroy$))
      .subscribe((s) => this.sessions.set(s));

    const params = this.route.snapshot.queryParams;
    if (params['sessionId']) this.sessionId.set(+params['sessionId']);
    if (params['platform']) this.platforms.set(params['platform'].split(',').filter(Boolean));
    if (params['type']) this.types.set(params['type'].split(',').filter(Boolean));
    if (params['from']) this.from.set(params['from']);
    if (params['to']) this.to.set(params['to']);
    if (params['search']) this.search.set(params['search']);
    if (params['page']) this.page.set(+params['page']);

    this._loadEvents();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  platformColor(platform: string): string {
    const map: Record<string, string> = {
      twitch: '#9146ff', youtube: '#ff0000', kick: '#53fc18',
      tiktok: '#fe2c55', x: '#c9cdd1', joystick: '#8b5cf6',
    };
    return map[platform] ?? '#7c8aa0';
  }

  applyFilter(key: string, value: string | number | null): void {
    const current: Record<string, string> = {};
    const params = this.route.snapshot.queryParams;
    for (const k of Object.keys(params)) current[k] = params[k];

    if (value !== null && value !== '' && value !== undefined) {
      current[key] = String(value);
    } else {
      delete current[key];
    }
    delete current['page'];

    this.router.navigate([], { queryParams: current, queryParamsHandling: 'replace' });

    this._applyParamToSignal(key, value);
    this.page.set(1);
    this._loadEvents();
  }

  private _applyParamToSignal(key: string, value: string | number | null): void {
    const v = value !== null && value !== '' ? String(value) : '';
    switch (key) {
      case 'sessionId': this.sessionId.set(v ? +v : null); break;
      case 'platform':  this.platforms.set(v ? v.split(',').filter(Boolean) : []); break;
      case 'type':      this.types.set(v ? v.split(',').filter(Boolean) : []); break;
      case 'from':      this.from.set(v); break;
      case 'to':        this.to.set(v); break;
      case 'search':    this.search.set(v); break;
    }
  }

  resetFilters(): void {
    this.sessionId.set(null);
    this.platforms.set([]);
    this.types.set([]);
    this.from.set('');
    this.to.set('');
    this.search.set('');
    this.page.set(1);
    this.router.navigate([], { queryParams: {}, queryParamsHandling: 'replace' });
    this._loadEvents();
  }

  prevPage(): void {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this._updatePageParam();
    this._loadEvents();
  }

  nextPage(): void {
    if (this.page() >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this._updatePageParam();
    this._loadEvents();
  }

  private _updatePageParam(): void {
    const current: Record<string, string> = { ...this.route.snapshot.queryParams };
    if (this.page() > 1) current['page'] = String(this.page());
    else delete current['page'];
    this.router.navigate([], { queryParams: current, queryParamsHandling: 'replace' });
  }

  private _loadEvents(): void {
    this.loading.set(true);
    let params = new HttpParams()
      .set('page', String(this.page()))
      .set('limit', String(this.limit));

    if (this.sessionId() != null) params = params.set('sessionId', String(this.sessionId()));
    if (this.platforms().length) params = params.set('platform', this.platforms().join(','));
    if (this.types().length) params = params.set('type', this.types().join(','));
    if (this.from()) params = params.set('from', this.from());
    if (this.to()) params = params.set('to', this.to());
    if (this.search()) params = params.set('search', this.search());

    this.http.get<EventsResponse>('/api/stream-sessions/events', { params })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (r) => {
          this.events.set(r.events);
          this.total.set(r.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  eventSummary(e: OtteryEvent): string {
    switch (e.type) {
      case 'chat.message':   return String(e.data['message'] ?? '');
      case 'follow':         return 'followed';
      case 'subscribe':      return `Tier ${e.data['tier'] ?? '1000'} sub`;
      case 'subscribe.gift': return `gifted ${e.data['count'] ?? 1} subs`;
      case 'cheer':          return `${e.data['bits'] ?? 0} bits`;
      case 'tip':            return `$${e.data['amount'] ?? 0} tip`;
      case 'raid':           return `raided with ${e.data['viewers'] ?? 0} viewers`;
      case 'like':           return 'liked';
      case 'share':          return 'shared';
      case 'stream.start':   return 'stream online';
      case 'stream.end':     return 'stream offline';
      case 'viewer_count':   return `${e.data['count'] ?? 0} viewers`;
      case 'music.sr_added': return `🎵 queued "${String(e.data['trackName'] ?? '')}" by ${String(e.data['artistName'] ?? '')}`;
      case 'music.sr_rejected': {
        const reason = String(e.data['reason'] ?? '');
        const track = e.data['trackName'] ? `"${String(e.data['trackName'])}" ` : '';
        const reasonMap: Record<string, string> = {
          no_credits:  `not enough credits (need ${String(e.data['creditCost'] ?? 0)}, have ${String(e.data['creditBalance'] ?? 0)})`,
          queue_limit: `queue limit reached (${String(e.data['inQueue'] ?? 0)}/${String(e.data['maxQueue'] ?? 0)})`,
          explicit:    `${track}rejected — explicit`,
          duplicate:   `${track}rejected — already in queue`,
          not_found:   `no results for "${String(e.data['query'] ?? '')}"`,
        };
        return `🚫 song request ${reasonMap[reason] ?? reason}`;
      }
      default:               return e.type;
    }
  }
}
