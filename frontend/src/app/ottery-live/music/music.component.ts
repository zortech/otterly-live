import {
  Component, inject, signal, computed, OnInit, OnDestroy
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subject } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MusicService, QueueItem, SpotifyTrack, SpotifyAdmin } from './music.service';

declare const window: Window & {
  otteryElectron?: { serverPort?: number; openExternal?: (url: string) => void };
};

// ─── Search & Add Song Dialog ─────────────────────────────────────────────────

@Component({
  selector: 'app-music-search-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatDialogModule],
  styles: [`
    .dlg { padding: 24px; min-width: 480px; max-width: 560px; background: var(--bg-card); color: var(--text-1); }
    .dlg-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
    .search-row { display: flex; gap: 8px; margin-bottom: 16px; }
    .search-input {
      flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-1); font-size: 13px; font-family: inherit;
    }
    .search-input:focus { outline: none; border-color: var(--accent); }
    .btn-search {
      padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: none; background: var(--accent); color: #000; font-family: inherit;
    }
    .btn-search:disabled { opacity: 0.4; cursor: default; }
    .results { max-height: 340px; overflow-y: auto; }
    .result-row {
      display: flex; align-items: center; gap: 10px; padding: 8px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.04); cursor: pointer;
      border-radius: 6px; transition: background 0.1s;
    }
    .result-row:last-child { border-bottom: none; }
    .result-row:hover { background: var(--bg-raised); }
    .result-art {
      width: 40px; height: 40px; border-radius: 4px; object-fit: cover;
      background: var(--bg-raised); flex-shrink: 0;
    }
    .result-art-placeholder {
      width: 40px; height: 40px; border-radius: 4px; background: var(--bg-raised);
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    }
    .result-art-placeholder mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--text-3); }
    .result-info { flex: 1; min-width: 0; }
    .result-name { font-weight: 600; font-size: 13px; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result-artist { font-size: 11px; color: var(--text-2); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .result-duration { font-size: 11px; color: var(--text-3); font-family: 'JetBrains Mono', monospace; flex-shrink: 0; }
    .btn-add {
      padding: 4px 12px; border-radius: 5px; font-size: 11px; font-weight: 600;
      cursor: pointer; border: 1px solid var(--accent-border);
      background: var(--accent-dim); color: var(--accent); font-family: inherit; flex-shrink: 0;
    }
    .empty-state { color: var(--text-2); text-align: center; padding: 32px 0; font-size: 13px; }
    .dlg-footer { display: flex; justify-content: flex-end; margin-top: 16px; }
  `],
  template: `
    <div class="dlg">
      <div class="dlg-title">Add Song to Queue</div>
      <div class="search-row">
        <input class="search-input" type="text" placeholder="Search for a song or artist…"
               [(ngModel)]="query" (keydown.enter)="doSearch()" />
        <button class="btn-search" [disabled]="!query.trim() || searching()" (click)="doSearch()">
          {{ searching() ? 'Searching…' : 'Search' }}
        </button>
      </div>
      <div class="results">
        @if (results().length === 0 && searched()) {
          <div class="empty-state">No results found.</div>
        }
        @for (track of results(); track track.id) {
          <div class="result-row">
            @if (track.albumArtUrl) {
              <img class="result-art" [src]="track.albumArtUrl" [alt]="track.name" />
            } @else {
              <div class="result-art-placeholder"><mat-icon>music_note</mat-icon></div>
            }
            <div class="result-info">
              <div class="result-name">{{ track.name }}</div>
              <div class="result-artist">{{ track.artistName }}</div>
            </div>
            <span class="result-duration">{{ fmtMs(track.durationMs) }}</span>
            <button class="btn-add" [disabled]="adding()[track.id]" (click)="addTrack(track)">
              {{ adding()[track.id] ? '…' : 'Add' }}
            </button>
          </div>
        }
      </div>
      <div class="dlg-footer">
        <button mat-button (click)="ref.close()">Close</button>
      </div>
    </div>
  `,
})
export class MusicSearchDialogComponent {
  protected readonly ref = inject(MatDialogRef<MusicSearchDialogComponent>);
  private readonly musicSvc = inject(MusicService);
  private readonly snackBar = inject(MatSnackBar);

  protected query = '';
  protected readonly searching = signal(false);
  protected readonly searched = signal(false);
  protected readonly results = signal<SpotifyTrack[]>([]);
  protected readonly adding = signal<Record<string, boolean>>({});

  async doSearch(): Promise<void> {
    if (!this.query.trim()) return;
    this.searching.set(true);
    this.searched.set(false);
    try {
      const tracks = await this.musicSvc.search(this.query.trim());
      this.results.set(tracks);
      this.searched.set(true);
    } catch {
      this.snackBar.open('Search failed', 'Dismiss', { duration: 3000 });
    } finally {
      this.searching.set(false);
    }
  }

  async addTrack(track: SpotifyTrack): Promise<void> {
    this.adding.update((a) => ({ ...a, [track.id]: true }));
    try {
      await this.musicSvc.addToQueue(track);
      this.snackBar.open(`"${track.name}" added to queue`, undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Failed to add song', 'Dismiss', { duration: 3000 });
    } finally {
      this.adding.update((a) => ({ ...a, [track.id]: false }));
    }
  }

  fmtMs(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }
}

// ─── Add Admin Dialog ─────────────────────────────────────────────────────────

@Component({
  selector: 'app-music-add-admin-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule],
  styles: [`
    .dlg { padding: 24px; min-width: 360px; background: var(--bg-card); color: var(--text-1); }
    .dlg-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .dlg-sub { font-size: 12px; color: var(--text-2); margin-bottom: 20px; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-2); margin-bottom: 5px; }
    .field-input, .field-select {
      width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-1); font-size: 13px; font-family: inherit;
      box-sizing: border-box;
    }
    .field-input:focus, .field-select:focus { outline: none; border-color: var(--accent); }
    .dlg-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
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
      <div class="dlg-title">Grant Spotify Admin</div>
      <div class="dlg-sub">Spotify Admins can skip songs and remove any queue item.</div>

      <div class="field">
        <label>Platform</label>
        <select class="field-select" [(ngModel)]="platform">
          <option value="twitch">Twitch</option>
          <option value="youtube">YouTube</option>
          <option value="kick">Kick</option>
          <option value="tiktok">TikTok</option>
          <option value="x">X</option>
          <option value="joystick">Joystick.tv</option>
        </select>
      </div>
      <div class="field">
        <label>Username</label>
        <input class="field-input" type="text" [(ngModel)]="username" placeholder="e.g. coolfan123" />
      </div>
      <div class="field">
        <label>Platform User ID</label>
        <input class="field-input" type="text" [(ngModel)]="platformUserId"
               placeholder="Platform-specific user ID" />
      </div>

      <div class="dlg-actions">
        <button class="btn-cancel" (click)="ref.close(null)">Cancel</button>
        <button class="btn-save" [disabled]="!isValid()" (click)="save()">Grant Admin</button>
      </div>
    </div>
  `,
})
export class MusicAddAdminDialogComponent {
  protected readonly ref = inject(MatDialogRef<MusicAddAdminDialogComponent>);

  protected platform = 'twitch';
  protected username = '';
  protected platformUserId = '';

  protected isValid(): boolean {
    return !!this.username.trim() && !!this.platformUserId.trim();
  }

  save(): void {
    if (!this.isValid()) return;
    this.ref.close({
      platform: this.platform,
      platformUserId: this.platformUserId.trim(),
      username: this.username.trim(),
    });
  }
}

// ─── Main Music Component ─────────────────────────────────────────────────────

interface MusicSettingsDraft {
  enabled: boolean;
  spotifyClientId: string;
  playbackMode: 'requests_only' | 'fallback' | 'interleave';
  streamPlaylistId: string;
  streamPlaylistShuffle: boolean;
  interleaveRatio: number;
  srEnabled: boolean;
  srCreditCost: number;
  srMaxQueuePerViewer: number;
  srDuplicateMode: string;
  srBlockExplicit: boolean;
  srCommandReply: boolean;
  srShowRejectionInChat: boolean;
  srShowAddedInHighlights: boolean;
  srShowRejectedInHighlights: boolean;
}

@Component({
  selector: 'app-music',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatDialogModule],
  styles: [`
    .page-header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;
    }
    .page-title { font-size: 22px; font-weight: 700; color: var(--text-1); letter-spacing: -0.5px; }

    /* ── Connect panel ─────────────────────────────────────────── */
    .connect-panel {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px;
      padding: 32px; max-width: 520px; margin: 0 auto;
    }
    .connect-icon {
      width: 48px; height: 48px; border-radius: 50%;
      background: rgba(29,185,84,0.12); border: 1px solid rgba(29,185,84,0.25);
      display: flex; align-items: center; justify-content: center; margin-bottom: 16px;
    }
    .connect-icon mat-icon { color: #1db954; font-size: 26px; width: 26px; height: 26px; }
    .connect-title { font-size: 18px; font-weight: 700; color: var(--text-1); margin-bottom: 6px; }
    .connect-sub { font-size: 13px; color: var(--text-2); line-height: 1.5; margin-bottom: 24px; }
    .connect-steps {
      background: var(--bg-raised); border: 1px solid var(--border-2); border-radius: 10px;
      padding: 16px 18px; margin-bottom: 20px;
    }
    .connect-steps-title {
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;
      color: var(--text-3); margin-bottom: 12px;
    }
    .connect-step { display: flex; gap: 10px; font-size: 13px; color: var(--text-2); margin-bottom: 8px; line-height: 1.4; }
    .connect-step:last-child { margin-bottom: 0; }
    .step-num {
      width: 20px; height: 20px; border-radius: 50%; background: var(--accent-dim);
      border: 1px solid var(--accent-border); display: flex; align-items: center;
      justify-content: center; flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--accent);
    }
    .connect-step strong { color: var(--text-1); }
    .connect-step code {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 3px; padding: 1px 5px; color: var(--accent);
    }
    .client-id-row { display: flex; gap: 8px; margin-bottom: 16px; }
    .client-id-input {
      flex: 1; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-1); font-size: 13px; font-family: inherit;
      font-family: 'JetBrains Mono', monospace;
    }
    .client-id-input:focus { outline: none; border-color: #1db954; }
    .client-id-input::placeholder { color: var(--text-3); font-family: inherit; }
    .btn-save-id {
      padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: 1px solid var(--border); background: var(--bg-raised);
      color: var(--text-2); font-family: inherit; transition: all 0.12s;
    }
    .btn-save-id:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-1); }
    .btn-save-id:disabled { opacity: 0.4; cursor: default; }
    .btn-connect-spotify {
      width: 100%; padding: 11px; border-radius: 10px; font-size: 14px; font-weight: 700;
      cursor: pointer; border: none; background: #1db954; color: #000; font-family: inherit;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      transition: opacity 0.15s;
    }
    .btn-connect-spotify:hover:not(:disabled) { opacity: 0.88; }
    .btn-connect-spotify:disabled { opacity: 0.4; cursor: default; }
    .connect-hint { font-size: 11px; color: var(--text-3); text-align: center; margin-top: 10px; }

    /* ── Spotify status bar ────────────────────────────────────── */
    .spotify-bar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px; border-radius: 10px; margin-bottom: 20px;
      background: rgba(29,185,84,0.06); border: 1px solid rgba(29,185,84,0.2); font-size: 13px;
    }
    .spotify-dot { width: 8px; height: 8px; border-radius: 50%; background: #1db954; flex-shrink: 0; }
    .spotify-label { font-weight: 600; color: #1db954; }
    .spotify-bar .spacer { flex: 1; }
    .btn-disconnect {
      padding: 4px 12px; border-radius: 5px; font-size: 12px; font-weight: 600;
      cursor: pointer; border: 1px solid rgba(255,51,85,0.3);
      background: rgba(255,51,85,0.08); color: var(--live-red); font-family: inherit; transition: all 0.12s;
    }
    .btn-disconnect:hover { background: rgba(255,51,85,0.16); }

    /* ── Main grid ─────────────────────────────────────────────── */
    .main-grid {
      display: grid; grid-template-columns: 1fr 320px; gap: 20px; align-items: start;
    }

    /* ── Now Playing card ──────────────────────────────────────── */
    .now-playing-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      padding: 16px; display: flex; gap: 16px; align-items: center; margin-bottom: 20px;
      position: relative; overflow: hidden;
    }
    .np-art-wrap { position: relative; flex-shrink: 0; }
    .np-art {
      width: 80px; height: 80px; border-radius: 8px; object-fit: cover;
      background: var(--bg-raised);
    }
    .np-art-placeholder {
      width: 80px; height: 80px; border-radius: 8px; background: var(--bg-raised);
      border: 1px solid var(--border); display: flex; align-items: center; justify-content: center;
    }
    .np-art-placeholder mat-icon { font-size: 36px; width: 36px; height: 36px; color: var(--text-3); }
    .np-info { flex: 1; min-width: 0; }
    .np-track { font-size: 16px; font-weight: 700; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .np-artist { font-size: 13px; color: var(--text-2); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .np-progress-wrap { margin-top: 10px; }
    .np-progress-bar {
      height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; margin-bottom: 5px;
    }
    .np-progress-fill { height: 100%; background: #1db954; border-radius: 2px; transition: width 0.9s linear; }
    .np-times { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-3); font-family: 'JetBrains Mono', monospace; }
    .np-controls { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
    .np-btn {
      width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center;
      justify-content: center; cursor: pointer; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-2); transition: all 0.12s;
    }
    .np-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-1); }
    .np-btn:disabled { opacity: 0.3; cursor: default; }
    .np-btn mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .np-btn.skip { border-color: rgba(29,185,84,0.3); background: rgba(29,185,84,0.08); color: #1db954; }
    .np-btn.skip:hover:not(:disabled) { background: rgba(29,185,84,0.16); }
    .np-idle {
      display: flex; align-items: center; gap: 10px; color: var(--text-2); font-size: 13px;
    }
    .np-idle mat-icon { color: var(--text-3); }

    /* ── Queue card ────────────────────────────────────────────── */
    .queue-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
    }
    .queue-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid var(--border);
    }
    .queue-title-row { display: flex; align-items: center; gap: 8px; }
    .queue-title { font-size: 13px; font-weight: 700; color: var(--text-1); }
    .queue-badge {
      font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 10px;
      background: var(--accent-dim); border: 1px solid var(--accent-border); color: var(--accent);
    }
    .btn-add-song {
      padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;
      cursor: pointer; border: 1px solid var(--accent-border);
      background: var(--accent-dim); color: var(--accent); font-family: inherit; transition: all 0.12s;
      display: flex; align-items: center; gap: 4px;
    }
    .btn-add-song:hover { opacity: 0.85; }
    .btn-add-song mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .queue-list { max-height: 360px; overflow-y: auto; }
    .queue-row {
      display: flex; align-items: center; gap: 10px; padding: 9px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.1s;
    }
    .queue-row:last-child { border-bottom: none; }
    .queue-row:hover { background: var(--bg-raised); }
    .q-pos {
      width: 22px; flex-shrink: 0; font-size: 11px; font-weight: 600;
      color: var(--text-3); text-align: center; font-family: 'JetBrains Mono', monospace;
    }
    .q-art {
      width: 36px; height: 36px; border-radius: 4px; object-fit: cover;
      background: var(--bg-raised); flex-shrink: 0;
    }
    .q-art-placeholder {
      width: 36px; height: 36px; border-radius: 4px; background: var(--bg-raised);
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    }
    .q-art-placeholder mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--text-3); }
    .q-info { flex: 1; min-width: 0; }
    .q-track { font-size: 12px; font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .q-artist { font-size: 11px; color: var(--text-2); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .q-requester {
      font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px;
      flex-shrink: 0;
    }
    .q-actions { display: flex; gap: 3px; flex-shrink: 0; }
    .q-btn {
      width: 26px; height: 26px; border-radius: 4px; display: flex; align-items: center;
      justify-content: center; cursor: pointer; border: 1px solid var(--border);
      background: transparent; color: var(--text-3); transition: all 0.12s;
    }
    .q-btn:hover:not(:disabled) { background: var(--bg-raised); color: var(--text-1); }
    .q-btn:disabled { opacity: 0.25; cursor: default; }
    .q-btn.remove:hover:not(:disabled) { background: rgba(255,51,85,0.1); color: var(--live-red); border-color: rgba(255,51,85,0.3); }
    .q-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .queue-empty { padding: 32px; text-align: center; color: var(--text-2); font-size: 13px; }

    /* ── Recently played ───────────────────────────────────────── */
    .recent-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      overflow: hidden; margin-top: 12px;
    }
    .recent-header {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 16px; border-bottom: 1px solid var(--border);
    }
    .recent-title {
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.8px; color: var(--text-2);
    }
    .recent-title mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--text-3); vertical-align: middle; margin-right: 4px; }
    .recent-row {
      display: flex; align-items: center; gap: 10px; padding: 8px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.04); opacity: 0.7;
    }
    .recent-row:last-child { border-bottom: none; }
    .recent-art {
      width: 30px; height: 30px; border-radius: 3px; object-fit: cover;
      background: var(--bg-raised); flex-shrink: 0;
    }
    .recent-art-placeholder {
      width: 30px; height: 30px; border-radius: 3px; background: var(--bg-raised);
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    }
    .recent-art-placeholder mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--text-3); }
    .recent-info { flex: 1; min-width: 0; }
    .recent-track { font-size: 12px; font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .recent-artist { font-size: 11px; color: var(--text-2); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .recent-requester {
      font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
    }

    /* ── Right column cards ────────────────────────────────────── */
    .side-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      overflow: hidden; margin-bottom: 16px;
    }
    .side-card:last-child { margin-bottom: 0; }
    .side-card-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; cursor: pointer;
    }
    .side-card-title {
      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
      color: var(--text-2); display: flex; align-items: center; gap: 6px;
    }
    .side-card-title mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--accent); }
    .side-card-chevron { color: var(--text-3); font-size: 18px; width: 18px; height: 18px; }
    .side-card-body { padding: 0 16px 16px; border-top: 1px solid var(--border); }

    /* Settings form */
    .settings-section { margin-top: 14px; }
    .settings-section-label {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
      color: var(--text-3); margin-bottom: 8px;
    }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 11px; font-weight: 600; color: var(--text-2); margin-bottom: 4px; }
    .field-input, .field-select {
      width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-1); font-size: 12px; font-family: inherit;
      box-sizing: border-box;
    }
    .field-input:focus, .field-select:focus { outline: none; border-color: var(--accent); }
    .toggle-row {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 12px; color: var(--text-2); margin-bottom: 10px;
    }
    .toggle-row:last-child { margin-bottom: 0; }
    .toggle {
      position: relative; display: inline-block; width: 32px; height: 18px; cursor: pointer;
    }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-slider {
      position: absolute; inset: 0; border-radius: 18px; background: var(--border);
      transition: background 0.2s;
    }
    .toggle-slider::before {
      content: ''; position: absolute; width: 12px; height: 12px; border-radius: 50%;
      background: white; top: 3px; left: 3px; transition: transform 0.2s;
    }
    input:checked + .toggle-slider { background: var(--accent); }
    input:checked + .toggle-slider::before { transform: translateX(14px); }
    .btn-save-settings {
      width: 100%; padding: 8px; border-radius: 7px; font-size: 12px; font-weight: 700;
      cursor: pointer; border: none; background: var(--accent); color: #000;
      font-family: inherit; margin-top: 14px;
    }
    .btn-save-settings:disabled { opacity: 0.4; cursor: default; }

    /* Admins */
    .admin-row {
      display: flex; align-items: center; gap: 10px; padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px;
    }
    .admin-row:last-child { border-bottom: none; }
    .admin-platform {
      font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
    }
    .admin-name { flex: 1; font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-revoke {
      padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      cursor: pointer; border: 1px solid rgba(255,51,85,0.3);
      background: rgba(255,51,85,0.08); color: var(--live-red); font-family: inherit; flex-shrink: 0;
    }
    .btn-revoke:hover { background: rgba(255,51,85,0.16); }
    .btn-add-admin {
      width: 100%; padding: 7px; border-radius: 7px; font-size: 12px; font-weight: 600;
      cursor: pointer; border: 1px solid var(--accent-border);
      background: var(--accent-dim); color: var(--accent); font-family: inherit; margin-top: 12px;
    }
    .admins-empty { font-size: 12px; color: var(--text-3); text-align: center; padding: 16px 0 4px; }

    /* ── Refreshing playlist ────────────────────────────────────── */
    .playlist-row { display: flex; gap: 6px; }
    .playlist-row .field-select { flex: 1; }
    .btn-refresh-pl {
      padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg-raised); color: var(--text-2); cursor: pointer; flex-shrink: 0;
      transition: color 0.12s;
    }
    .btn-refresh-pl:hover { color: var(--text-1); }
    .btn-refresh-pl:disabled { opacity: 0.4; cursor: default; }
    .btn-refresh-pl mat-icon { font-size: 16px; width: 16px; height: 16px; display: block; }
  `],
  template: `
    <div class="page-header">
      <h1 class="page-title">Music</h1>
    </div>

    <!-- ── Not connected: setup panel ─────────────────────────── -->
    @if (!musicSvc.spotifyConnected()) {
      <div class="connect-panel">
        <div class="connect-icon"><mat-icon>queue_music</mat-icon></div>
        <div class="connect-title">Connect Spotify</div>
        <div class="connect-sub">
          Song requests, Now Playing, and queue management require your Spotify account.
          You'll need a free Spotify developer app — it takes about 5 minutes.
        </div>

        <div class="connect-steps">
          <div class="connect-steps-title">One-time setup</div>
          <div class="connect-step">
            <div class="step-num">1</div>
            <span>Go to <strong>developer.spotify.com</strong> → Create App</span>
          </div>
          <div class="connect-step">
            <div class="step-num">2</div>
            <span>Set the redirect URI to <code>http://127.0.0.1:{{ serverPort() }}/auth/spotify/callback</code></span>
          </div>
          <div class="connect-step">
            <div class="step-num">3</div>
            <span>Copy the <strong>Client ID</strong> (no secret needed) and paste it below</span>
          </div>
          <div class="connect-step">
            <div class="step-num">4</div>
            <span>Click <strong>Connect Spotify</strong> — your browser will open for sign-in</span>
          </div>
        </div>

        <div class="client-id-row">
          <input class="client-id-input" type="text" placeholder="Spotify Client ID"
                 [(ngModel)]="draftClientId" />
          <button class="btn-save-id" [disabled]="!draftClientId.trim() || savingClientId()"
                  (click)="saveClientId()">
            {{ savingClientId() ? 'Saving…' : 'Save' }}
          </button>
        </div>

        <button class="btn-connect-spotify"
                [disabled]="!settingsSaved() || connecting()"
                (click)="connectSpotify()">
          <mat-icon>music_note</mat-icon>
          {{ connecting() ? 'Opening browser…' : 'Connect Spotify' }}
        </button>
        <div class="connect-hint">Your browser will open for Spotify sign-in.</div>
      </div>
    }

    <!-- ── Connected state ──────────────────────────────────────── -->
    @if (musicSvc.spotifyConnected()) {
      <div class="spotify-bar">
        <div class="spotify-dot"></div>
        <span class="spotify-label">Spotify Connected</span>
        <span class="spacer"></span>
        <button class="btn-disconnect" (click)="disconnectSpotify()">Disconnect</button>
      </div>

      <div class="main-grid">
        <!-- ── Left: Now Playing + Queue ──────────────────────── -->
        <div>
          <!-- Now Playing -->
          <div class="now-playing-card">
            @if (musicSvc.nowPlaying()) {
              @if (musicSvc.nowPlaying()!.albumArtUrl) {
                <img class="np-art" [src]="musicSvc.nowPlaying()!.albumArtUrl!" [alt]="musicSvc.nowPlaying()!.trackName" />
              } @else {
                <div class="np-art-placeholder"><mat-icon>music_note</mat-icon></div>
              }
              <div class="np-info">
                <div class="np-track">{{ musicSvc.nowPlaying()!.trackName }}</div>
                <div class="np-artist">{{ musicSvc.nowPlaying()!.artistName }}</div>
                <div class="np-progress-wrap">
                  <div class="np-progress-bar">
                    <div class="np-progress-fill" [style.width.%]="progressPct()"></div>
                  </div>
                  <div class="np-times">
                    <span>{{ fmtMs(musicSvc.nowPlaying()!.progressMs) }}</span>
                    <span>{{ fmtMs(musicSvc.nowPlaying()!.durationMs) }}</span>
                  </div>
                </div>
              </div>
              <div class="np-controls">
                <button class="np-btn" (click)="togglePlayback()" [disabled]="playbackBusy()">
                  <mat-icon>{{ musicSvc.nowPlaying()!.isPlaying ? 'pause' : 'play_arrow' }}</mat-icon>
                </button>
                <button class="np-btn skip" (click)="skip()" [disabled]="skipBusy()">
                  <mat-icon>skip_next</mat-icon>
                </button>
              </div>
            } @else {
              <div class="np-art-placeholder"><mat-icon>headphones</mat-icon></div>
              <div class="np-idle">
                <mat-icon>music_off</mat-icon>
                Nothing playing
              </div>
            }
          </div>

          <!-- Queue -->
          <div class="queue-card">
            <div class="queue-header">
              <div class="queue-title-row">
                <span class="queue-title">Song Queue</span>
                @if (musicSvc.queue().length > 0) {
                  <span class="queue-badge">{{ musicSvc.queue().length }}</span>
                }
              </div>
              <button class="btn-add-song" (click)="openSearch()">
                <mat-icon>add</mat-icon> Add Song
              </button>
            </div>
            <div class="queue-list">
              @if (musicSvc.queue().length === 0) {
                <div class="queue-empty">Queue is empty. Viewers can use <strong>!play</strong> to request songs.</div>
              } @else {
                @for (item of musicSvc.queue(); track item.id; let i = $index) {
                  <div class="queue-row">
                    <span class="q-pos">{{ i + 1 }}</span>
                    @if (item.album_art_url) {
                      <img class="q-art" [src]="item.album_art_url" [alt]="item.track_name" />
                    } @else {
                      <div class="q-art-placeholder"><mat-icon>music_note</mat-icon></div>
                    }
                    <div class="q-info">
                      <div class="q-track">{{ item.track_name }}</div>
                      <div class="q-artist">{{ item.artist_name }}</div>
                    </div>
                    @if (item.requester_display_name) {
                      <span class="q-requester"
                            [style.color]="platformColor(item.requester_platform ?? '')"
                            [style.background]="platformColor(item.requester_platform ?? '') + '18'"
                            [style.border]="'1px solid ' + platformColor(item.requester_platform ?? '') + '33'">
                        {{ item.requester_display_name }}
                      </span>
                    } @else if (item.source === 'streamer') {
                      <span class="q-requester" style="color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent-border)">
                        You
                      </span>
                    }
                    <div class="q-actions">
                      <button class="q-btn" [disabled]="i === 0 || queueBusy()[item.id]"
                              (click)="bumpItem(item.id, 'up')" title="Move up">
                        <mat-icon>arrow_upward</mat-icon>
                      </button>
                      <button class="q-btn" [disabled]="i === musicSvc.queue().length - 1 || queueBusy()[item.id]"
                              (click)="bumpItem(item.id, 'down')" title="Move down">
                        <mat-icon>arrow_downward</mat-icon>
                      </button>
                      <button class="q-btn remove" [disabled]="queueBusy()[item.id]"
                              (click)="removeItem(item)" title="Remove">
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                  </div>
                }
              }
            </div>
          </div>

          <!-- Recently Played -->
          @if (musicSvc.recentPlays().length > 0) {
            <div class="recent-card">
              <div class="recent-header">
                <mat-icon>history</mat-icon>
                <span class="recent-title">Recently Played</span>
              </div>
              @for (item of musicSvc.recentPlays(); track item.id) {
                <div class="recent-row">
                  @if (item.album_art_url) {
                    <img class="recent-art" [src]="item.album_art_url" [alt]="item.track_name" />
                  } @else {
                    <div class="recent-art-placeholder"><mat-icon>music_note</mat-icon></div>
                  }
                  <div class="recent-info">
                    <div class="recent-track">{{ item.track_name }}</div>
                    <div class="recent-artist">{{ item.artist_name }}</div>
                  </div>
                  @if (item.requester_display_name) {
                    <span class="recent-requester"
                          [style.color]="platformColor(item.requester_platform ?? '')"
                          [style.background]="platformColor(item.requester_platform ?? '') + '18'"
                          [style.border]="'1px solid ' + platformColor(item.requester_platform ?? '') + '33'">
                      {{ item.requester_display_name }}
                    </span>
                  }
                </div>
              }
            </div>
          }
        </div>

        <!-- ── Right: Settings + Admins ─────────────────────── -->
        <div>
          <!-- Settings card -->
          <div class="side-card">
            <div class="side-card-header" (click)="settingsOpen.set(!settingsOpen())">
              <span class="side-card-title">
                <mat-icon>tune</mat-icon> Settings
              </span>
              <mat-icon class="side-card-chevron">{{ settingsOpen() ? 'expand_less' : 'expand_more' }}</mat-icon>
            </div>
            @if (settingsOpen() && draft()) {
              <div class="side-card-body">
                <div class="settings-section">
                  <div class="toggle-row">
                    <span>Music enabled</span>
                    <label class="toggle">
                      <input type="checkbox" [(ngModel)]="draft()!.enabled" />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                <div class="settings-section">
                  <div class="settings-section-label">Playback</div>
                  <div class="field">
                    <label>Mode</label>
                    <select class="field-select" [(ngModel)]="draft()!.playbackMode">
                      <option value="requests_only">Requests only</option>
                      <option value="fallback">Fallback playlist</option>
                      <option value="interleave">Interleave</option>
                    </select>
                  </div>
                  @if (draft()!.playbackMode !== 'requests_only') {
                    <div class="field">
                      <label>Stream playlist</label>
                      <div class="playlist-row">
                        <select class="field-select" [(ngModel)]="draft()!.streamPlaylistId">
                          <option value="">— None —</option>
                          @for (pl of musicSvc.playlists(); track pl.id) {
                            <option [value]="pl.id">{{ pl.name }}{{ pl.trackCount != null ? ' (' + pl.trackCount + ')' : '' }}</option>
                          }
                        </select>
                        <button class="btn-refresh-pl" [disabled]="loadingPlaylists()"
                                (click)="refreshPlaylists()" title="Refresh playlists">
                          <mat-icon>refresh</mat-icon>
                        </button>
                      </div>
                    </div>
                    <div class="toggle-row">
                      <span>Shuffle playlist</span>
                      <label class="toggle">
                        <input type="checkbox" [(ngModel)]="draft()!.streamPlaylistShuffle" />
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                  }
                  @if (draft()!.playbackMode === 'interleave') {
                    <div class="field">
                      <label>Requests per playlist song</label>
                      <input class="field-input" type="number" min="1" max="20" step="1"
                             [(ngModel)]="draft()!.interleaveRatio" />
                    </div>
                  }
                </div>

                <div class="settings-section">
                  <div class="settings-section-label">Song Requests (!play)</div>
                  <div class="toggle-row">
                    <span>!play command enabled</span>
                    <label class="toggle">
                      <input type="checkbox" [(ngModel)]="draft()!.srEnabled" />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div class="field">
                    <label>Credit cost per request</label>
                    <input class="field-input" type="number" min="0" step="1"
                           [(ngModel)]="draft()!.srCreditCost" />
                  </div>
                  <div class="field">
                    <label>Max queued per viewer</label>
                    <input class="field-input" type="number" min="1" max="20" step="1"
                           [(ngModel)]="draft()!.srMaxQueuePerViewer" />
                  </div>
                  <div class="field">
                    <label>Duplicate track blocking</label>
                    <select class="field-input" [(ngModel)]="draft()!.srDuplicateMode">
                      <option value="off">Off</option>
                      <option value="playing_only">Currently playing only</option>
                      <option value="session">This session</option>
                      <option value="queue">Active queue</option>
                    </select>
                  </div>
                  <div class="toggle-row">
                    <span>Block explicit tracks</span>
                    <label class="toggle">
                      <input type="checkbox" [(ngModel)]="draft()!.srBlockExplicit" />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div class="toggle-row">
                    <span>Reply in chat on request</span>
                    <label class="toggle">
                      <input type="checkbox" [(ngModel)]="draft()!.srCommandReply" />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div class="toggle-row">
                    <span>Show rejections in chat</span>
                    <label class="toggle">
                      <input type="checkbox" [(ngModel)]="draft()!.srShowRejectionInChat" />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div class="toggle-row">
                    <span>Show song requests in chat highlights</span>
                    <label class="toggle">
                      <input type="checkbox" [(ngModel)]="draft()!.srShowAddedInHighlights" />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div class="toggle-row">
                    <span>Show rejections in chat highlights</span>
                    <label class="toggle">
                      <input type="checkbox" [(ngModel)]="draft()!.srShowRejectedInHighlights" />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>

                <button class="btn-save-settings" [disabled]="savingSettings()" (click)="saveSettings()">
                  {{ savingSettings() ? 'Saving…' : 'Save Settings' }}
                </button>
              </div>
            }
          </div>

          <!-- Admins card -->
          <div class="side-card">
            <div class="side-card-header" (click)="adminsOpen.set(!adminsOpen())">
              <span class="side-card-title">
                <mat-icon>admin_panel_settings</mat-icon> Spotify Admins
              </span>
              <mat-icon class="side-card-chevron">{{ adminsOpen() ? 'expand_less' : 'expand_more' }}</mat-icon>
            </div>
            @if (adminsOpen()) {
              <div class="side-card-body" style="padding-top:12px">
                @if (musicSvc.admins().length === 0) {
                  <div class="admins-empty">No admins yet. Admins can skip songs and manage the queue.</div>
                } @else {
                  @for (admin of musicSvc.admins(); track admin.id) {
                    <div class="admin-row">
                      <span class="admin-platform"
                            [style.color]="platformColor(admin.platform)"
                            [style.background]="platformColor(admin.platform) + '18'"
                            [style.border]="'1px solid ' + platformColor(admin.platform) + '33'">
                        {{ admin.platform }}
                      </span>
                      <span class="admin-name">{{ admin.username }}</span>
                      <button class="btn-revoke" (click)="revokeAdmin(admin)">Revoke</button>
                    </div>
                  }
                }
                <button class="btn-add-admin" (click)="openAddAdmin()">+ Grant Admin</button>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class MusicComponent implements OnInit, OnDestroy {
  protected readonly musicSvc = inject(MusicService);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly destroy$ = new Subject<void>();

  protected draftClientId = '';
  protected readonly savingClientId = signal(false);
  protected readonly settingsSaved = signal(false);
  protected readonly connecting = signal(false);

  protected readonly settingsOpen = signal(true);
  protected readonly adminsOpen = signal(true);
  protected readonly savingSettings = signal(false);
  protected readonly loadingPlaylists = signal(false);

  protected readonly playbackBusy = signal(false);
  protected readonly skipBusy = signal(false);
  protected readonly queueBusy = signal<Record<number, boolean>>({});

  protected readonly draft = signal<MusicSettingsDraft | null>(null);

  protected readonly progressPct = computed(() => {
    const np = this.musicSvc.nowPlaying();
    if (!np || !np.durationMs) return 0;
    return Math.min((np.progressMs / np.durationMs) * 100, 100);
  });

  serverPort(): number {
    return window.otteryElectron?.serverPort ?? 3737;
  }

  async ngOnInit(): Promise<void> {
    this.musicSvc.init();

    await Promise.all([
      this.musicSvc.loadStatus(),
      this.musicSvc.loadQueue(),
      this.musicSvc.loadRecentPlays(),
      this.musicSvc.loadAdmins(),
      this._loadSettings(),
    ]);

    if (this.musicSvc.spotifyConnected()) {
      await this.musicSvc.loadPlaylists();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async _loadSettings(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<Record<string, unknown>>('/api/settings'));
      const clientId = (s['music.spotifyClientId'] as string) ?? '';
      this.draftClientId = clientId;
      this.settingsSaved.set(!!clientId);
      this.draft.set({
        enabled:               (s['music.enabled'] as boolean) ?? false,
        spotifyClientId:       clientId,
        playbackMode:          (s['music.playbackMode'] as MusicSettingsDraft['playbackMode']) ?? 'fallback',
        streamPlaylistId:      (s['music.streamPlaylistId'] as string) ?? '',
        streamPlaylistShuffle: (s['music.streamPlaylistShuffle'] as boolean) ?? true,
        interleaveRatio:       (s['music.interleaveRatio'] as number) ?? 3,
        srEnabled:             (s['music.srEnabled'] as boolean) ?? true,
        srCreditCost:          (s['music.srCreditCost'] as number) ?? 50,
        srMaxQueuePerViewer:   (s['music.srMaxQueuePerViewer'] as number) ?? 3,
        srDuplicateMode:       (s['music.srDuplicateMode'] as string) ?? 'queue',
        srBlockExplicit:       (s['music.srBlockExplicit'] as boolean) ?? true,
        srCommandReply:           (s['music.srCommandReply'] as boolean) ?? true,
        srShowRejectionInChat:    (s['music.srShowRejectionInChat'] as boolean) ?? false,
        srShowAddedInHighlights:  (s['music.srShowAddedInHighlights'] as boolean) ?? true,
        srShowRejectedInHighlights: (s['music.srShowRejectedInHighlights'] as boolean) ?? true,
      });
    } catch {
      this.snackBar.open('Failed to load settings', 'Dismiss', { duration: 3000 });
    }
  }

  async saveClientId(): Promise<void> {
    const id = this.draftClientId.trim();
    if (!id) return;
    this.savingClientId.set(true);
    try {
      await firstValueFrom(this.http.put('/api/settings', { key: 'music.spotifyClientId', value: id }));
      this.settingsSaved.set(true);
      if (this.draft()) this.draft.update((d) => d ? { ...d, spotifyClientId: id } : d);
      this.snackBar.open('Client ID saved', undefined, { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to save Client ID', 'Dismiss', { duration: 3000 });
    } finally {
      this.savingClientId.set(false);
    }
  }

  async connectSpotify(): Promise<void> {
    this.connecting.set(true);
    try {
      const { url } = await firstValueFrom(this.http.get<{ url: string }>('/auth/spotify'));
      window.otteryElectron?.openExternal?.(url);
    } catch {
      this.snackBar.open('Failed to start Spotify auth', 'Dismiss', { duration: 3000 });
      this.connecting.set(false);
      return;
    }
    // Reset connecting state after a brief moment — the actual confirmation comes via socket
    setTimeout(() => this.connecting.set(false), 3000);
  }

  async disconnectSpotify(): Promise<void> {
    try {
      await firstValueFrom(this.http.delete('/auth/spotify'));
    } catch {
      this.snackBar.open('Failed to disconnect', 'Dismiss', { duration: 3000 });
    }
  }

  async togglePlayback(): Promise<void> {
    const np = this.musicSvc.nowPlaying();
    if (!np) return;
    this.playbackBusy.set(true);
    try {
      await this.musicSvc.setPlayback(np.isPlaying ? 'pause' : 'play');
    } catch {
      this.snackBar.open('Playback control failed', 'Dismiss', { duration: 3000 });
    } finally {
      this.playbackBusy.set(false);
    }
  }

  async skip(): Promise<void> {
    this.skipBusy.set(true);
    try {
      await this.musicSvc.skip();
    } catch {
      this.snackBar.open('Skip failed', 'Dismiss', { duration: 3000 });
    } finally {
      this.skipBusy.set(false);
    }
  }

  async removeItem(item: QueueItem): Promise<void> {
    this.queueBusy.update((b) => ({ ...b, [item.id]: true }));
    try {
      await this.musicSvc.removeQueueItem(item.id);
    } catch {
      this.snackBar.open('Failed to remove song', 'Dismiss', { duration: 3000 });
    } finally {
      this.queueBusy.update((b) => ({ ...b, [item.id]: false }));
    }
  }

  async bumpItem(id: number, direction: 'up' | 'down'): Promise<void> {
    this.queueBusy.update((b) => ({ ...b, [id]: true }));
    try {
      await this.musicSvc.bumpQueueItem(id, direction);
    } catch {
      this.snackBar.open('Failed to reorder', 'Dismiss', { duration: 3000 });
    } finally {
      this.queueBusy.update((b) => ({ ...b, [id]: false }));
    }
  }

  async saveSettings(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    this.savingSettings.set(true);
    try {
      const keys: Array<[string, unknown]> = [
        ['music.enabled', d.enabled],
        ['music.playbackMode', d.playbackMode],
        ['music.streamPlaylistId', d.streamPlaylistId],
        ['music.streamPlaylistShuffle', d.streamPlaylistShuffle],
        ['music.interleaveRatio', d.interleaveRatio],
        ['music.srEnabled', d.srEnabled],
        ['music.srCreditCost', d.srCreditCost],
        ['music.srMaxQueuePerViewer', d.srMaxQueuePerViewer],
        ['music.srDuplicateMode', d.srDuplicateMode],
        ['music.srBlockExplicit', d.srBlockExplicit],
        ['music.srCommandReply', d.srCommandReply],
        ['music.srShowRejectionInChat', d.srShowRejectionInChat],
        ['music.srShowAddedInHighlights', d.srShowAddedInHighlights],
        ['music.srShowRejectedInHighlights', d.srShowRejectedInHighlights],
      ];
      await Promise.all(
        keys.map(([key, value]) => firstValueFrom(this.http.put('/api/settings', { key, value })))
      );
      this.snackBar.open('Settings saved', undefined, { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 4000 });
    } finally {
      this.savingSettings.set(false);
    }
  }

  async refreshPlaylists(): Promise<void> {
    this.loadingPlaylists.set(true);
    try {
      await this.musicSvc.loadPlaylists();
    } finally {
      this.loadingPlaylists.set(false);
    }
  }

  openSearch(): void {
    this.dialog.open(MusicSearchDialogComponent, { width: '560px' });
  }

  async openAddAdmin(): Promise<void> {
    const ref = this.dialog.open(MusicAddAdminDialogComponent, { width: '400px' });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;
    try {
      await this.musicSvc.addAdmin(result);
      this.snackBar.open(`${result.username} granted Spotify Admin`, undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Failed to grant admin', 'Dismiss', { duration: 3000 });
    }
  }

  async revokeAdmin(admin: SpotifyAdmin): Promise<void> {
    try {
      await this.musicSvc.removeAdmin(admin.id);
      this.snackBar.open(`${admin.username} revoked`, undefined, { duration: 2000 });
    } catch {
      this.snackBar.open('Failed to revoke admin', 'Dismiss', { duration: 3000 });
    }
  }

  platformColor(platform: string): string {
    const map: Record<string, string> = {
      twitch: '#9146ff', youtube: '#ff0000', kick: '#53fc18',
      tiktok: '#fe2c55', x: '#c9cdd1', joystick: '#8b5cf6',
    };
    return map[platform] ?? '#7c8aa0';
  }

  fmtMs(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }
}
