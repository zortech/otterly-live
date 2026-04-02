import {
  Component, inject, signal, computed, OnInit, OnDestroy
} from '@angular/core';
import pluralize from 'pluralize';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { CreditsService, Viewer, CreditSettings, CreditTransaction } from './credits.service';

// ─── Edit Dialog ───────────────────────────────────────────────────────────────

interface EditDialogData { viewer: Viewer }

@Component({
  selector: 'app-credits-edit-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatDialogModule, DecimalPipe],
  styles: [`
    .dlg { padding: 24px; min-width: 340px; background: var(--bg-card); color: var(--text-1); }
    .dlg-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .dlg-sub { font-size: 12px; color: var(--text-2); margin-bottom: 20px; }
    .current-balance {
      display: flex; align-items: center; gap: 8px; margin-bottom: 18px;
      padding: 10px 14px; background: var(--bg-raised); border-radius: 8px;
      border: 1px solid var(--border);
    }
    .balance-num { font-size: 22px; font-weight: 700; font-family: 'JetBrains Mono',monospace; color: var(--accent); }
    .balance-label { font-size: 12px; color: var(--text-2); }
    .mode-tabs { display: flex; gap: 0; margin-bottom: 16px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); }
    .mode-tab {
      flex: 1; padding: 7px; font-size: 12px; font-weight: 600; cursor: pointer;
      border: none; font-family: inherit; background: transparent; color: var(--text-2);
      transition: all 0.12s;
    }
    .mode-tab.active { background: var(--accent-dim); color: var(--accent); }
    .field-label { font-size: 12px; font-weight: 600; color: var(--text-2); margin-bottom: 6px; }
    .field-input {
      width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-1); font-size: 14px; font-family: inherit;
      box-sizing: border-box;
    }
    .field-input:focus { outline: none; border-color: var(--accent); }
    .adjust-row { display: flex; gap: 8px; margin-bottom: 14px; }
    .sign-btn {
      padding: 8px 14px; border-radius: 6px; font-size: 16px; font-weight: 700;
      cursor: pointer; border: 1px solid var(--border); background: var(--bg-raised);
      color: var(--text-2); font-family: inherit; transition: all 0.12s;
    }
    .sign-btn.active-add { background: rgba(0,230,118,0.1); border-color: rgba(0,230,118,0.3); color: var(--live); }
    .sign-btn.active-sub { background: rgba(255,51,85,0.1); border-color: rgba(255,51,85,0.3); color: var(--live-red); }
    .note-row { margin-bottom: 20px; }
    .dlg-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .btn-cancel {
      padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;
      border: 1px solid var(--border); background: transparent; color: var(--text-2); font-family: inherit;
    }
    .btn-save {
      padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;
      border: none; background: var(--accent); color: #000; font-family: inherit;
    }
    .btn-save:disabled { opacity: 0.4; cursor: default; }
  `],
  template: `
    <div class="dlg">
      <div class="dlg-title">Edit Credits</div>
      <div class="dlg-sub">{{ data.viewer.display_name }} · {{ data.viewer.platform }}</div>

      <div class="current-balance">
        <div>
          <div class="balance-num">{{ data.viewer.credits | number }}</div>
          <div class="balance-label">current balance</div>
        </div>
      </div>

      <div class="mode-tabs">
        <button class="mode-tab" [class.active]="mode() === 'set'" (click)="mode.set('set')">Set balance</button>
        <button class="mode-tab" [class.active]="mode() === 'adjust'" (click)="mode.set('adjust')">Adjust</button>
      </div>

      @if (mode() === 'set') {
        <div class="field-label">New balance</div>
        <input class="field-input" style="margin-bottom:14px" type="number" min="0" step="1"
               [(ngModel)]="setAmount" placeholder="0" />
      } @else {
        <div class="adjust-row">
          <button class="sign-btn" [class.active-add]="sign() === 1" (click)="sign.set(1)">+</button>
          <button class="sign-btn" [class.active-sub]="sign() === -1" (click)="sign.set(-1)">−</button>
          <input class="field-input" type="number" min="1" step="1"
                 [(ngModel)]="adjustAmount" placeholder="Amount" />
        </div>
      }

      <div class="note-row">
        <div class="field-label">Note <span style="font-weight:400;color:var(--text-3)">(optional)</span></div>
        <input class="field-input" type="text" [(ngModel)]="note" placeholder="Reason for adjustment" />
      </div>

      <div class="dlg-actions">
        <button class="btn-cancel" (click)="ref.close(null)">Cancel</button>
        <button class="btn-save" [disabled]="!isValid()" (click)="save()">Save</button>
      </div>
    </div>
  `,
})
export class CreditsEditDialogComponent {
  protected readonly data: EditDialogData = inject(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<CreditsEditDialogComponent>);

  protected readonly mode = signal<'set' | 'adjust'>('adjust');
  protected readonly sign = signal<1 | -1>(1);
  protected setAmount = 0;
  protected adjustAmount = 1;
  protected note = '';

  protected readonly isValid = computed(() => {
    if (this.mode() === 'set') return this.setAmount >= 0 && Number.isInteger(this.setAmount);
    return this.adjustAmount > 0 && Number.isInteger(this.adjustAmount);
  });

  save(): void {
    if (!this.isValid()) return;
    if (this.mode() === 'set') {
      this.ref.close({ mode: 'set', amount: Math.floor(this.setAmount), note: this.note || undefined });
    } else {
      this.ref.close({ mode: 'adjust', delta: this.sign() * Math.floor(this.adjustAmount), note: this.note || undefined });
    }
  }
}

// ─── History Dialog ────────────────────────────────────────────────────────────

interface HistoryDialogData { viewer: Viewer }

@Component({
  selector: 'app-credits-history-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, MatIconModule, DatePipe, DecimalPipe],
  styles: [`
    .dlg { padding: 24px; min-width: 420px; max-width: 560px; background: var(--bg-card); color: var(--text-1); }
    .dlg-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .dlg-sub { font-size: 12px; color: var(--text-2); margin-bottom: 16px; }
    .tx-list { max-height: 360px; overflow-y: auto; }
    .tx-row {
      display: grid; grid-template-columns: 80px 60px 1fr 80px;
      gap: 8px; padding: 6px 4px; font-size: 12px; align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .tx-row:last-child { border-bottom: none; }
    .tx-delta.pos { color: var(--live); }
    .tx-delta.neg { color: var(--live-red); }
    .tx-reason { font-size: 11px; padding: 2px 6px; border-radius: 10px; background: var(--bg-raised); color: var(--text-2); text-align: center; }
    .tx-note { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tx-time { font-family: 'JetBrains Mono',monospace; color: var(--text-3); font-size: 11px; }
    .empty { color: var(--text-2); text-align: center; padding: 32px 0; font-size: 13px; }
    .dlg-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
  `],
  template: `
    <div class="dlg">
      <div class="dlg-title">Credit History</div>
      <div class="dlg-sub">{{ data.viewer.display_name }} · {{ data.viewer.platform }}</div>

      <div class="tx-list">
        @if (transactions().length === 0) {
          <div class="empty">No transactions yet.</div>
        } @else {
          @for (tx of transactions(); track tx.id) {
            <div class="tx-row">
              <span class="tx-time">{{ tx.created_at | date:'MM/dd HH:mm' }}</span>
              <span class="tx-delta" [class.pos]="tx.delta > 0" [class.neg]="tx.delta < 0">
                {{ tx.delta > 0 ? '+' : '' }}{{ tx.delta | number }}
              </span>
              <span class="tx-note">{{ tx.note ?? '' }}</span>
              <span class="tx-reason">{{ tx.reason }}</span>
            </div>
          }
        }
      </div>

      <div class="dlg-actions">
        <button mat-button (click)="ref.close()">Close</button>
      </div>
    </div>
  `,
})
export class CreditsHistoryDialogComponent implements OnInit {
  protected readonly data: HistoryDialogData = inject(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<CreditsHistoryDialogComponent>);
  private readonly creditsSvc = inject(CreditsService);

  protected readonly transactions = signal<CreditTransaction[]>([]);

  async ngOnInit(): Promise<void> {
    const result = await this.creditsSvc.getHistory(this.data.viewer.id);
    this.transactions.set(result.transactions);
  }
}

// ─── Main Credits Component ────────────────────────────────────────────────────

@Component({
  selector: 'app-credits',
  standalone: true,
  imports: [
    FormsModule, MatIconModule, MatButtonModule, MatDialogModule, DatePipe, DecimalPipe,
  ],
  styles: [`
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    .page-title { font-size: 22px; font-weight: 700; color: var(--text-1); letter-spacing: -0.5px; }

    /* Settings panel */
    .settings-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      padding: 18px 20px; margin-bottom: 20px;
    }
    .settings-header {
      display: flex; align-items: center; justify-content: space-between; cursor: pointer;
    }
    .settings-title {
      font-size: 13px; font-weight: 600; color: var(--text-2); display: flex; align-items: center; gap: 6px;
    }
    .settings-title mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--accent); }
    .settings-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; margin-top: 16px;
    }
    .setting-field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-2); margin-bottom: 5px; }
    .setting-input {
      width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-1); font-size: 13px; font-family: inherit;
      box-sizing: border-box;
    }
    .setting-input:focus { outline: none; border-color: var(--accent); }
    .settings-actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
    .toggle-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); }
    .toggle {
      position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer;
    }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-slider {
      position: absolute; inset: 0; border-radius: 20px; background: var(--border);
      transition: background 0.2s;
    }
    .toggle-slider::before {
      content: ''; position: absolute; width: 14px; height: 14px; border-radius: 50%;
      background: white; top: 3px; left: 3px; transition: transform 0.2s;
    }
    input:checked + .toggle-slider { background: var(--accent); }
    input:checked + .toggle-slider::before { transform: translateX(16px); }
    .btn-save-settings {
      padding: 6px 16px; border-radius: 6px; font-size: 12px; font-weight: 600;
      cursor: pointer; border: none; background: var(--accent); color: #000; font-family: inherit;
    }
    .btn-save-settings:disabled { opacity: 0.4; cursor: default; }

    /* Toolbar */
    .toolbar {
      display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap;
    }
    .search-input {
      flex: 1; min-width: 180px; max-width: 280px;
      padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg-card); color: var(--text-1); font-size: 13px; font-family: inherit;
    }
    .search-input:focus { outline: none; border-color: var(--accent); }
    .filter-select {
      padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg-card); color: var(--text-2); font-size: 13px; font-family: inherit; cursor: pointer;
    }
    .total-label { margin-left: auto; font-size: 12px; color: var(--text-2); }

    /* Table */
    .table-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
    }
    .table-header {
      display: grid; grid-template-columns: 90px 180px 1fr 110px 80px 100px;
      gap: 8px; padding: 10px 16px;
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px;
      color: var(--text-3); border-bottom: 1px solid var(--border);
    }
    .sort-btn {
      background: none; border: none; padding: 0; cursor: pointer; color: inherit;
      font: inherit; text-transform: inherit; letter-spacing: inherit;
      display: flex; align-items: center; gap: 3px;
    }
    .sort-btn.active { color: var(--accent); }
    .sort-btn mat-icon { font-size: 12px; width: 12px; height: 12px; }

    .viewer-row {
      display: grid; grid-template-columns: 90px 180px 1fr 110px 80px 100px;
      gap: 8px; padding: 9px 16px; align-items: center; font-size: 13px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      transition: background 0.1s;
    }
    .viewer-row:last-child { border-bottom: none; }
    .viewer-row:hover { background: var(--bg-raised); }

    .platform-badge {
      font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
      display: inline-block;
    }
    .viewer-name { font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .viewer-username { font-size: 11px; color: var(--text-2); }
    .credits-val {
      font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700; color: var(--accent);
    }
    .last-seen { font-size: 11px; color: var(--text-3); }

    .row-actions { display: flex; gap: 4px; justify-content: flex-end; }
    .action-btn {
      padding: 3px 8px; border-radius: 5px; font-size: 11px; font-weight: 600;
      cursor: pointer; border: 1px solid var(--border); background: transparent;
      color: var(--text-2); font-family: inherit; transition: all 0.12s;
    }
    .action-btn:hover { background: var(--bg-raised); color: var(--text-1); }

    /* Pagination */
    .pagination {
      display: flex; align-items: center; justify-content: center; gap: 12px;
      padding: 12px; border-top: 1px solid var(--border); font-size: 13px; color: var(--text-2);
    }
    .page-btn {
      padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;
      cursor: pointer; border: 1px solid var(--border); background: transparent;
      color: var(--text-2); font-family: inherit; transition: all 0.12s;
    }
    .page-btn:hover:not(:disabled) { background: var(--bg-raised); color: var(--text-1); }
    .page-btn:disabled { opacity: 0.4; cursor: default; }

    /* Empty state */
    .empty-state { padding: 48px; text-align: center; color: var(--text-2); font-size: 14px; }
    .loading-state { padding: 48px; text-align: center; color: var(--text-3); font-size: 13px; }
  `],
  template: `
    <div class="page-header">
      <h1 class="page-title">Credits</h1>
    </div>

    <!-- Settings panel -->
    <div class="settings-card">
      <div class="settings-header" (click)="settingsOpen.set(!settingsOpen())">
        <span class="settings-title">
          <mat-icon>settings</mat-icon>
          Credit Settings
        </span>
        <mat-icon style="color:var(--text-3);font-size:18px;width:18px;height:18px">
          {{ settingsOpen() ? 'expand_less' : 'expand_more' }}
        </mat-icon>
      </div>

      @if (settingsOpen() && draftSettings()) {
        <div class="settings-grid">
          <div class="setting-field">
            <label>Credit name</label>
            <input class="setting-input" type="text"
                   [(ngModel)]="draftSettings()!.nameSingular"
                   placeholder="credit" />
          </div>
          <div class="setting-field">
            <label>{{ creditLabel(draftSettings()!.perChatMinute) }} per chat minute</label>
            <input class="setting-input" type="number" min="1" step="1"
                   [(ngModel)]="draftSettings()!.perChatMinute" />
          </div>
          <div class="setting-field">
            <label>{{ creditLabel(draftSettings()!.perLikeMinute) }} per like minute</label>
            <input class="setting-input" type="number" min="1" step="1"
                   [(ngModel)]="draftSettings()!.perLikeMinute" />
          </div>
          <div class="setting-field">
            <label>Gift multiplier</label>
            <input class="setting-input" type="number" min="0" step="0.1"
                   [(ngModel)]="draftSettings()!.giftMultiplier" />
          </div>
          <div class="setting-field">
            <label>Transaction retention (days)</label>
            <input class="setting-input" type="number" min="1" step="1"
                   [(ngModel)]="draftSettings()!.transactionRetentionDays" />
            <div style="font-size:11px;color:var(--text-3);margin-top:4px;line-height:1.4">
              High-volume chats can generate millions of rows. Lower this if your database grows large.
            </div>
          </div>
          <div class="setting-field">
            <label>Overlay API key</label>
            <input class="setting-input" type="text"
                   [(ngModel)]="draftSettings()!.apiKey"
                   placeholder="Leave empty for no auth" />
          </div>
        </div>
        <div class="settings-actions">
          <label class="toggle-row">
            <label class="toggle">
              <input type="checkbox" [(ngModel)]="draftSettings()!.enabled" />
              <span class="toggle-slider"></span>
            </label>
            Credits enabled
          </label>
          <button class="btn-save-settings" [disabled]="savingSettings()" (click)="saveSettings()">
            {{ savingSettings() ? 'Saving…' : 'Save Settings' }}
          </button>
        </div>
      }
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <input class="search-input" type="text" placeholder="Search viewers…"
             [(ngModel)]="searchTerm"
             (ngModelChange)="onSearchChange($event)" />
      <select class="filter-select" [(ngModel)]="platformFilter" (ngModelChange)="reload()">
        <option value="">All platforms</option>
        <option value="twitch">Twitch</option>
        <option value="youtube">YouTube</option>
        <option value="kick">Kick</option>
        <option value="tiktok">TikTok</option>
        <option value="x">X</option>
        <option value="joystick">Joystick.tv</option>
      </select>
      <span class="total-label">{{ creditsSvc.total() | number }} viewers · {{ creditName() }}</span>
    </div>

    <!-- Table -->
    <div class="table-card">
      <div class="table-header">
        <span>Platform</span>
        <span>Viewer</span>
        <span></span>
        <button class="sort-btn" [class.active]="sortField() === 'credits'" (click)="setSort('credits')">
          {{ creditName() }}
          @if (sortField() === 'credits') {
            <mat-icon>{{ sortOrder() === 'desc' ? 'arrow_downward' : 'arrow_upward' }}</mat-icon>
          }
        </button>
        <button class="sort-btn" [class.active]="sortField() === 'last_seen_at'" (click)="setSort('last_seen_at')">
          Last seen
          @if (sortField() === 'last_seen_at') {
            <mat-icon>{{ sortOrder() === 'desc' ? 'arrow_downward' : 'arrow_upward' }}</mat-icon>
          }
        </button>
        <span></span>
      </div>

      @if (creditsSvc.loading()) {
        <div class="loading-state">Loading…</div>
      } @else if (creditsSvc.viewers().length === 0) {
        <div class="empty-state">
          No viewers yet. Credits are awarded automatically as viewers chat and send gifts.
        </div>
      } @else {
        @for (viewer of creditsSvc.viewers(); track viewer.id) {
          <div class="viewer-row">
            <span class="platform-badge"
                  [style.color]="platformColor(viewer.platform)"
                  [style.background]="platformColor(viewer.platform) + '18'"
                  [style.border]="'1px solid ' + platformColor(viewer.platform) + '33'">
              {{ viewer.platform }}
            </span>
            <div>
              <div class="viewer-name">{{ viewer.display_name }}</div>
              <div class="viewer-username">{{ viewer.username }}</div>
            </div>
            <span></span>
            <span class="credits-val">{{ viewer.credits | number }}</span>
            <span class="last-seen">{{ relativeTime(viewer.last_seen_at) }}</span>
            <div class="row-actions">
              <button class="action-btn" (click)="openEdit(viewer)">Edit</button>
              <button class="action-btn" (click)="openHistory(viewer)">History</button>
            </div>
          </div>
        }
      }

      @if (totalPages() > 1) {
        <div class="pagination">
          <button class="page-btn" [disabled]="page() === 1" (click)="goPage(page() - 1)">← Prev</button>
          <span>Page {{ page() }} of {{ totalPages() }}</span>
          <button class="page-btn" [disabled]="page() === totalPages()" (click)="goPage(page() + 1)">Next →</button>
        </div>
      }
    </div>
  `,
})
export class CreditsComponent implements OnInit, OnDestroy {
  protected readonly creditsSvc = inject(CreditsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroy$ = new Subject<void>();
  private readonly searchChange$ = new Subject<string>();

  protected readonly settingsOpen = signal(true);
  protected readonly savingSettings = signal(false);
  protected readonly draftSettings = signal<CreditSettings | null>(null);

  protected readonly sortField = signal<'credits' | 'last_seen_at' | 'username'>('credits');
  protected readonly sortOrder = signal<'asc' | 'desc'>('desc');
  protected readonly page = signal(1);
  protected readonly limit = 50;

  protected searchTerm = '';
  protected platformFilter = '';

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.creditsSvc.total() / this.limit))
  );

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.creditsSvc.loadViewers({ sort: 'credits', order: 'desc', limit: this.limit }),
      this.creditsSvc.loadSettings(),
    ]);
    // Clone settings into a draft for editing
    const s = this.creditsSvc.settings();
    if (s) this.draftSettings.set({ ...s });

    this.searchChange$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.page.set(1);
      this.reload();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  reload(): void {
    this.creditsSvc.loadViewers({
      page:     this.page(),
      limit:    this.limit,
      sort:     this.sortField(),
      order:    this.sortOrder(),
      search:   this.searchTerm || undefined,
      platform: this.platformFilter || undefined,
    }).catch(() => {});
  }

  onSearchChange(val: string): void {
    this.searchTerm = val;
    this.searchChange$.next(val);
  }

  setSort(field: 'credits' | 'last_seen_at' | 'username'): void {
    if (this.sortField() === field) {
      this.sortOrder.set(this.sortOrder() === 'desc' ? 'asc' : 'desc');
    } else {
      this.sortField.set(field);
      this.sortOrder.set('desc');
    }
    this.page.set(1);
    this.reload();
  }

  goPage(p: number): void {
    this.page.set(p);
    this.reload();
  }

  async saveSettings(): Promise<void> {
    const draft = this.draftSettings();
    if (!draft) return;
    this.savingSettings.set(true);
    try {
      await this.creditsSvc.saveSettings(draft);
      this.snackBar.open('Settings saved', undefined, { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 4000 });
    } finally {
      this.savingSettings.set(false);
    }
  }

  async openEdit(viewer: Viewer): Promise<void> {
    const ref = this.dialog.open(CreditsEditDialogComponent, {
      data: { viewer } satisfies { viewer: Viewer },
    });
    const result = await ref.afterClosed().toPromise();
    if (!result) return;

    try {
      let newCredits: number;
      if (result.mode === 'set') {
        newCredits = await this.creditsSvc.setCredits(viewer.id, result.amount, result.note);
      } else {
        newCredits = await this.creditsSvc.adjustCredits(viewer.id, result.delta, result.note);
      }
      // Update viewer inline — socket event will also arrive but this is faster
      this.creditsSvc.viewers.update((list) =>
        list.map((v) => v.id === viewer.id ? { ...v, credits: newCredits } : v)
      );
      const name = this.creditLabel(newCredits);
      this.snackBar.open(`${newCredits.toLocaleString()} ${name}`, undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Failed to update credits', 'Dismiss', { duration: 4000 });
    }
  }

  openHistory(viewer: Viewer): void {
    this.dialog.open(CreditsHistoryDialogComponent, { data: { viewer } satisfies { viewer: Viewer } });
  }

  creditName(): string {
    const name = this.creditsSvc.settings()?.nameSingular ?? 'credit';
    return pluralize(name);
  }

  creditLabel(amount: number): string {
    const name = this.creditsSvc.settings()?.nameSingular ?? 'credit';
    return pluralize(name, amount);
  }

  platformColor(platform: string): string {
    const map: Record<string, string> = {
      twitch: '#9146ff', youtube: '#ff0000', kick: '#53fc18',
      tiktok: '#fe2c55', x: '#c9cdd1', joystick: '#8b5cf6',
    };
    return map[platform] ?? '#7c8aa0';
  }

  relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
}
