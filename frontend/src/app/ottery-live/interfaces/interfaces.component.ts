import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SettingsService } from '../settings/settings.service';

const PLATFORMS = ['twitch', 'youtube', 'kick', 'tiktok', 'x', 'joystick'] as const;

// Notification event types shown per-platform in the overlay (excluding chat.message)
const NOTIF_TYPES = [
  { key: 'follow',         label: 'Follow'   },
  { key: 'subscribe',      label: 'Sub'      },
  { key: 'subscribe.gift', label: 'Gift Sub' },
  { key: 'cheer',          label: 'Bits'     },
  { key: 'tip',            label: 'Tip'      },
  { key: 'redeem',         label: 'Redeem'   },
] as const;

const OTTERLY_NOTIF_TYPES = [
  { key: 'otterly.redeem',       label: 'Credit Redeem',  hint: 'When a viewer spends credits'          },
  { key: 'otterly.credit_count', label: 'Credit Balance', hint: 'When a viewer types !credits in chat'  },
  { key: 'otterly.playing',      label: 'Now Playing',    hint: 'Currently playing song (Spotify — TBD)'},
] as const;

const DEFAULT_COLORS: Record<string, string> = {
  twitch:   '#9146ff',
  youtube:  '#ff0000',
  kick:     '#53fc18',
  tiktok:   '#fe2c55',
  x:        '#c9cdd1',
  joystick: '#8b5cf6',
};

const KEY_COLORS               = 'overlay.chat.platformColors';
const KEY_FADE_TIMEOUT         = 'overlay.chat.fadeTimeout';
const KEY_HIDDEN               = 'overlay.chat.hiddenPlatforms';
const KEY_FONT_SIZE            = 'overlay.chat.fontSize';
const KEY_MAX_MESSAGES         = 'overlay.chat.maxMessages';
const KEY_NOTIFICATION_FILTERS = 'overlay.chat.notificationFilters';
const KEY_TEST_PATTERN         = 'overlay.chat.testPattern';

const KEY_EXIT_ANIMATION       = 'overlay.chat.exitAnimation';

const KEY_MQ_MAX_ITEMS        = 'overlay.musicQueue.maxItems';
const KEY_MQ_SHOW_NOW_PLAYING = 'overlay.musicQueue.showNowPlaying';
const KEY_MQ_SHOW_REQUESTERS  = 'overlay.musicQueue.showRequesters';
const KEY_MQ_SHOW_ART         = 'overlay.musicQueue.showArt';

const KEY_NP_SHOW_ART       = 'overlay.nowPlaying.showArt';
const KEY_NP_SHOW_ARTIST    = 'overlay.nowPlaying.showArtist';
const KEY_NP_SHOW_PROGRESS  = 'overlay.nowPlaying.showProgress';
const KEY_NP_SHOW_REQUESTER = 'overlay.nowPlaying.showRequester';

const KEY_GS_THEME    = 'overlay.goalSingle.theme';
const KEY_GS_PLATFORM = 'overlay.goalSingle.platform';
const KEY_GS_METRIC   = 'overlay.goalSingle.metric';
const KEY_GS_TARGET   = 'overlay.goalSingle.target';
const KEY_GS_LABEL    = 'overlay.goalSingle.label';
const KEY_GS_CURRENT  = 'overlay.goalSingle.current';

const KEY_GM_THEME = 'overlay.goalMulti.theme';
const KEY_GM_GOALS = 'overlay.goalMulti.goals';

interface GoalEntry {
  enabled:  boolean;
  label:    string;
  platform: string;
  metric:   string;
  target:   number;
}

const DEFAULT_MULTI_GOALS: GoalEntry[] = [
  { enabled: true,  label: '', platform: 'all', metric: 'follow', target: 100 },
  { enabled: false, label: '', platform: 'all', metric: 'follow', target: 100 },
  { enabled: false, label: '', platform: 'all', metric: 'follow', target: 100 },
  { enabled: false, label: '', platform: 'all', metric: 'follow', target: 100 },
];

type SettingsTab = 'colors' | 'display' | 'platforms';

@Component({
  selector: 'app-interfaces',
  standalone: true,
  imports: [MatIconModule, FormsModule],
  styles: [`
    .page-title {
      font-size: 22px; font-weight: 700; color: var(--text-1);
      letter-spacing: -0.5px; margin-bottom: 24px;
    }

    .overlay-grid { display: flex; flex-direction: column; gap: 16px; }

    .overlay-card {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 12px; overflow: hidden;
    }

    /* Header */
    .card-header { display: flex; align-items: center; gap: 12px; padding: 16px 20px; }
    .card-icon {
      width: 36px; height: 36px; border-radius: 9px; flex-shrink: 0;
      background: var(--accent-dim); border: 1px solid var(--accent-border);
      display: flex; align-items: center; justify-content: center;
    }
    .card-icon mat-icon { font-size: 19px; width: 19px; height: 19px; color: var(--accent); }
    .card-titles { flex: 1; min-width: 0; }
    .card-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
    .card-desc { font-size: 12px; color: var(--text-2); margin-top: 1px; }

    /* URL row */
    .card-url { display: flex; align-items: center; gap: 8px; padding: 0 20px 16px; }
    .url-display {
      flex: 1; min-width: 0;
      background: var(--bg-raised); border: 1px solid var(--border-2); border-radius: 7px;
      padding: 7px 11px; font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px; color: var(--accent);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .copy-btn {
      display: flex; align-items: center; gap: 5px;
      padding: 7px 12px; border-radius: 7px; flex-shrink: 0;
      font-size: 12px; font-weight: 500; font-family: inherit;
      cursor: pointer; border: 1px solid var(--border-2);
      background: var(--bg-raised); color: var(--text-1);
      transition: background 0.12s, border-color 0.12s;
    }
    .copy-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .copy-btn:hover { background: var(--bg-hover); border-color: var(--accent-border); }
    .copy-btn.copied { color: var(--accent); border-color: var(--accent-border); }

    /* Settings toggle */
    .settings-toggle {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 20px; border-top: 1px solid var(--border);
      cursor: pointer; user-select: none;
      background: none; border-bottom: none; border-left: none; border-right: none;
      width: 100%; font-family: inherit; transition: background 0.1s;
    }
    .settings-toggle:hover { background: var(--bg-hover); }
    .settings-toggle-label {
      display: flex; align-items: center; gap: 7px;
      font-size: 12.5px; font-weight: 500; color: var(--text-2);
    }
    .settings-toggle-label mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .settings-toggle-chevron {
      font-size: 18px; width: 18px; height: 18px; color: var(--text-3);
      transition: transform 0.18s ease;
    }
    .settings-toggle-chevron.open { transform: rotate(180deg); }

    .settings-panel { border-top: 1px solid var(--border); }

    /* Inner tab bar */
    .settings-tabs { display: flex; border-bottom: 1px solid var(--border); }
    .settings-tab {
      flex: 1; padding: 9px 8px; text-align: center;
      font-size: 12px; font-weight: 500; color: var(--text-2);
      cursor: pointer; border: none; background: none; font-family: inherit;
      border-bottom: 2px solid transparent; margin-bottom: -1px;
      transition: color 0.12s, background 0.12s;
    }
    .settings-tab:hover { color: var(--text-1); background: var(--bg-hover); }
    .settings-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

    .tab-content { padding: 16px 20px; }

    /* Colors tab */
    .color-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px;
    }
    .color-row { display: flex; align-items: center; gap: 8px; }
    .color-swatch {
      width: 28px; height: 28px; border-radius: 6px; border: 2px solid var(--border-2);
      cursor: pointer; flex-shrink: 0; overflow: hidden; padding: 0; background: none;
    }
    .color-swatch input[type="color"] {
      width: 140%; height: 140%; border: none; padding: 0;
      cursor: pointer; background: transparent; transform: translate(-14%, -14%);
    }
    .color-name { font-size: 12.5px; font-weight: 500; text-transform: capitalize; }
    .reset-link {
      display: block; margin-top: 12px; font-size: 12px; color: var(--text-3);
      background: none; border: none; cursor: pointer; font-family: inherit;
      padding: 0; transition: color 0.12s; text-align: right;
    }
    .reset-link:hover { color: var(--text-1); }

    /* Display tab */
    .field-group { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
    .field-group:last-child { margin-bottom: 0; }
    .field-label {
      font-size: 11.5px; font-weight: 600; color: var(--text-2);
      text-transform: uppercase; letter-spacing: 0.7px;
    }
    .field-hint { font-size: 11px; color: var(--text-3); margin-top: 2px; }
    .field-input {
      background: var(--bg-raised); border: 1px solid var(--border-2); border-radius: 7px;
      padding: 7px 11px; font-size: 13px; color: var(--text-1); font-family: inherit;
      outline: none; transition: border-color 0.12s;
    }
    .field-input:focus { border-color: var(--accent); }
    select.field-input { cursor: pointer; width: 100%; }
    input.field-input { width: 100%; }

    /* ── Goal single compact grid ──────────────────────────────────── */
    .gs-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px 10px;
    }
    .gs-grid .field-group { margin-bottom: 0; }
    .gs-span2 { grid-column: span 2; }

    /* ── Goal single / multi settings ─────────────────────────────── */
    .goals-table {
      border-collapse: collapse; width: 100%;
    }
    .goals-thead th {
      font-size: 10px; font-weight: 600; color: var(--text-3);
      text-transform: uppercase; letter-spacing: 0.6px;
      padding: 0 4px 7px; text-align: left;
    }
    .goals-tbody tr { border-top: 1px solid var(--border); }
    .goals-tbody td { padding: 5px 4px; vertical-align: middle; }
    .goal-num {
      font-size: 11px; font-weight: 600; color: var(--text-3);
      text-align: center; width: 20px;
    }
    .goal-toggle-cell { width: 28px; text-align: center; }
    .goal-label-input { width: 100%; min-width: 60px; }
    .goal-target-input { width: 56px; }
    select.compact { font-size: 11.5px; padding: 5px 6px; }
    input.compact   { font-size: 11.5px; padding: 5px 6px; }

    /* ── Platforms tab (combined visibility + notifications) ────────── */

    /* Per-platform grid */
    .platform-grid {
      width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 20px;
    }
    .platform-grid th {
      font-size: 10.5px; font-weight: 600; color: var(--text-3);
      text-transform: uppercase; letter-spacing: 0.6px;
      padding: 0 6px 8px; text-align: center;
    }
    .platform-grid th:first-child { text-align: left; padding-left: 0; min-width: 90px; }
    .platform-grid tbody tr { transition: opacity 0.15s; }
    .platform-grid tbody tr.hidden-platform { opacity: 0.38; }
    .platform-grid td { padding: 5px 6px; text-align: center; border-top: 1px solid var(--border); }
    .platform-grid td:first-child { text-align: left; padding-left: 0; }

    /* Platform name / visibility toggle */
    .platform-vis-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: none; border: none; cursor: pointer; font-family: inherit;
      padding: 2px 0; border-radius: 4px;
      transition: opacity 0.12s;
    }
    .platform-vis-btn:hover { opacity: 0.75; }
    .platform-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .platform-vis-name {
      font-size: 12px; font-weight: 600; text-transform: capitalize; color: var(--text-1);
    }
    .platform-vis-icon {
      font-size: 14px; width: 14px; height: 14px; color: var(--text-3);
      margin-left: 2px;
    }

    /* Notification toggle cell */
    .notif-toggle {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 5px;
      cursor: pointer; border: 1px solid var(--border-2);
      background: var(--bg-raised); transition: background 0.12s, border-color 0.12s;
      font-size: 12px; line-height: 1; color: var(--text-3);
    }
    .notif-toggle.on {
      background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent);
    }
    /* When the row is hidden, toggles are still interactive — clicking them preserves state */
    .platform-grid tbody tr.hidden-platform .notif-toggle { pointer-events: none; }

    /* Section label */
    .section-label {
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
      color: var(--text-3); margin: 0 0 10px;
    }

    /* OtteryLive notifications */
    .otterly-list { border-top: 1px solid var(--border); }
    .otterly-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0; border-bottom: 1px solid var(--border);
    }
    .otterly-info { flex: 1; min-width: 0; }
    .otterly-label { font-size: 13px; font-weight: 600; color: var(--text-1); }
    .otterly-hint { font-size: 11px; color: var(--text-3); margin-top: 1px; }
    .otterly-toggle {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 5px; flex-shrink: 0;
      cursor: pointer; border: 1px solid var(--border-2);
      background: var(--bg-raised); transition: background 0.12s, border-color 0.12s;
      font-size: 12px; line-height: 1; color: var(--text-3);
    }
    .otterly-toggle.on {
      background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent);
    }
  `],
  template: `
    <h1 class="page-title">Interfaces</h1>

    <div class="overlay-grid">

      <!-- ── Chat overlay card ──────────────────────────────────────── -->
      <div class="overlay-card">

        <div class="card-header">
          <div class="card-icon"><mat-icon>chat</mat-icon></div>
          <div class="card-titles">
            <div class="card-title">Chat</div>
            <div class="card-desc">Live chat and notifications from all active platforms</div>
          </div>
        </div>

        <div class="card-url">
          <div class="url-display" [title]="chatUrl()">{{ chatUrl() }}</div>
          <button class="copy-btn" [class.copied]="copied()" (click)="copy(chatUrl())">
            <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
            {{ copied() ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <button class="settings-toggle" (click)="chatSettingsOpen.update(v => !v)">
          <span class="settings-toggle-label">
            <mat-icon>tune</mat-icon>
            Settings
          </span>
          <mat-icon class="settings-toggle-chevron" [class.open]="chatSettingsOpen()">
            expand_more
          </mat-icon>
        </button>

        @if (chatSettingsOpen()) {
          <div class="settings-panel">

            <div class="settings-tabs">
              <button class="settings-tab" [class.active]="chatTab() === 'colors'"    (click)="chatTab.set('colors')">Colors</button>
              <button class="settings-tab" [class.active]="chatTab() === 'display'"   (click)="chatTab.set('display')">Display</button>
              <button class="settings-tab" [class.active]="chatTab() === 'platforms'" (click)="chatTab.set('platforms')">Platforms</button>
            </div>

            <!-- Colors -->
            @if (chatTab() === 'colors') {
              <div class="tab-content">
                <div class="color-grid">
                  @for (p of platforms; track p) {
                    <div class="color-row">
                      <button class="color-swatch" [style.border-color]="platformColor(p)">
                        <input type="color" [value]="platformColor(p)"
                          (input)="setColor(p, $any($event.target).value)" />
                      </button>
                      <span class="color-name" [style.color]="platformColor(p)">{{ p }}</span>
                    </div>
                  }
                </div>
                <button class="reset-link" (click)="resetColors()">Reset to defaults</button>
              </div>
            }

            <!-- Display -->
            @if (chatTab() === 'display') {
              <div class="tab-content">
                <div class="field-group">
                  <span class="field-label">Message fade</span>
                  <select class="field-input" [ngModel]="fadeTimeout()" (ngModelChange)="setFadeTimeout($event)">
                    <option [value]="0">Never fade</option>
                    <option [value]="15">15 seconds</option>
                    <option [value]="30">30 seconds</option>
                    <option [value]="60">1 minute</option>
                    <option [value]="120">2 minutes</option>
                    <option [value]="300">5 minutes</option>
                  </select>
                  <span class="field-hint">How long before old messages fade out</span>
                </div>
                <div class="field-group">
                  <span class="field-label">Exit animation</span>
                  <select class="field-input" [ngModel]="exitAnimation()" (ngModelChange)="setExitAnimation($event)">
                    <option value="slide-left">Slide left</option>
                    <option value="slide-right">Slide right</option>
                    <option value="slide-up">Slide up</option>
                    <option value="dissolve">Dissolve (fade only)</option>
                    <option value="shrink">Shrink</option>
                    <option value="flip">Flip away</option>
                    <option value="blur-out">Blur out</option>
                  </select>
                  <span class="field-hint">How messages disappear when they fade out or are pushed off screen</span>
                </div>
                <div class="field-group">
                  <span class="field-label">Font size</span>
                  <input class="field-input" type="number" min="10" max="32" step="1"
                    [ngModel]="fontSize()" (ngModelChange)="setFontSize($event)" />
                  <span class="field-hint">px — default 14</span>
                </div>
                <div class="field-group">
                  <span class="field-label">Max messages</span>
                  <input class="field-input" type="number" min="5" max="100" step="5"
                    [ngModel]="maxMessages()" (ngModelChange)="setMaxMessages($event)" />
                  <span class="field-hint">Oldest messages are removed when limit is reached</span>
                </div>
                <div class="field-group">
                  <span class="field-label">Test pattern</span>
                  <select class="field-input"
                    [ngModel]="testPattern()"
                    (ngModelChange)="setTestPattern($event === 'true' || $event === true)">
                    <option [value]="true">Show when not live</option>
                    <option [value]="false">Always blank</option>
                  </select>
                  <span class="field-hint">Displays sample messages for positioning in OBS when you're not streaming</span>
                </div>
              </div>
            }

            <!-- Platforms (combined visibility + notifications) -->
            @if (chatTab() === 'platforms') {
              <div class="tab-content">

                <p class="section-label">Platform visibility &amp; notifications</p>

                <table class="platform-grid">
                  <thead>
                    <tr>
                      <th></th>
                      @for (t of notifTypes; track t.key) {
                        <th>{{ t.label }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of platforms; track p) {
                      <tr [class.hidden-platform]="hiddenPlatforms().has(p)">

                        <!-- Platform name = visibility toggle -->
                        <td>
                          <button class="platform-vis-btn" (click)="togglePlatform(p)"
                            [title]="(hiddenPlatforms().has(p) ? 'Show' : 'Hide') + ' ' + p">
                            <span class="platform-dot" [style.background]="platformColor(p)"></span>
                            <span class="platform-vis-name">{{ p }}</span>
                            <mat-icon class="platform-vis-icon">
                              {{ hiddenPlatforms().has(p) ? 'visibility_off' : 'visibility' }}
                            </mat-icon>
                          </button>
                        </td>

                        <!-- Notification type toggles -->
                        @for (t of notifTypes; track t.key) {
                          <td>
                            <button
                              class="notif-toggle"
                              [class.on]="isNotifEnabled(p, t.key)"
                              (click)="toggleNotif(p, t.key)"
                              [title]="(isNotifEnabled(p, t.key) ? 'Disable' : 'Enable') + ' ' + t.label + ' on ' + p">
                              {{ isNotifEnabled(p, t.key) ? '✓' : '' }}
                            </button>
                          </td>
                        }

                      </tr>
                    }
                  </tbody>
                </table>

                <!-- OtteryLive notifications -->
                <p class="section-label">OtteryLive notifications</p>
                <div class="otterly-list">
                  @for (t of otterlyNotifTypes; track t.key) {
                    <div class="otterly-row">
                      <div class="otterly-info">
                        <div class="otterly-label">{{ t.label }}</div>
                        <div class="otterly-hint">{{ t.hint }}</div>
                      </div>
                      <button
                        class="otterly-toggle"
                        [class.on]="isNotifEnabled('otterly', t.key)"
                        (click)="toggleNotif('otterly', t.key)">
                        {{ isNotifEnabled('otterly', t.key) ? '✓' : '' }}
                      </button>
                    </div>
                  }
                </div>

              </div>
            }

          </div>
        }

      </div>

      <!-- ── Now Playing overlay card ─────────────────────────────── -->
      <div class="overlay-card">

        <div class="card-header">
          <div class="card-icon"><mat-icon>music_note</mat-icon></div>
          <div class="card-titles">
            <div class="card-title">Now Playing</div>
            <div class="card-desc">Current track with large cover art and progress bar</div>
          </div>
        </div>

        <div class="card-url">
          <div class="url-display" [title]="nowPlayingUrl()">{{ nowPlayingUrl() }}</div>
          <button class="copy-btn" [class.copied]="npCopied()" (click)="copyNp()">
            <mat-icon>{{ npCopied() ? 'check' : 'content_copy' }}</mat-icon>
            {{ npCopied() ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <button class="settings-toggle" (click)="npSettingsOpen.update(v => !v)">
          <span class="settings-toggle-label">
            <mat-icon>tune</mat-icon>
            Settings
          </span>
          <mat-icon class="settings-toggle-chevron" [class.open]="npSettingsOpen()">
            expand_more
          </mat-icon>
        </button>

        @if (npSettingsOpen()) {
          <div class="settings-panel">
            <div class="tab-content">
              <div class="field-group">
                <span class="field-label">Album art</span>
                <select class="field-input"
                  [ngModel]="npShowArt()"
                  (ngModelChange)="setNpShowArt($event === 'true' || $event === true)">
                  <option [value]="true">Large cover art</option>
                  <option [value]="false">Text only (compact bar)</option>
                </select>
                <span class="field-hint">Large art shows the cover full-width above the track name</span>
              </div>
              <div class="field-group">
                <span class="field-label">Artist name</span>
                <select class="field-input"
                  [ngModel]="npShowArtist()"
                  (ngModelChange)="setNpShowArtist($event === 'true' || $event === true)">
                  <option [value]="true">Show artist</option>
                  <option [value]="false">Track name only</option>
                </select>
              </div>
              <div class="field-group">
                <span class="field-label">Progress bar</span>
                <select class="field-input"
                  [ngModel]="npShowProgress()"
                  (ngModelChange)="setNpShowProgress($event === 'true' || $event === true)">
                  <option [value]="true">Show progress bar</option>
                  <option [value]="false">Hide progress bar</option>
                </select>
              </div>
              <div class="field-group">
                <span class="field-label">Submitter</span>
                <select class="field-input"
                  [ngModel]="npShowRequester()"
                  (ngModelChange)="setNpShowRequester($event === 'true' || $event === true)">
                  <option [value]="true">Show who requested it</option>
                  <option [value]="false">Hide submitter</option>
                </select>
                <span class="field-hint">Only shown when the track was requested by a viewer</span>
              </div>
            </div>
          </div>
        }

      </div>

      <!-- ── Music Queue overlay card ──────────────────────────── -->
      <div class="overlay-card">

        <div class="card-header">
          <div class="card-icon"><mat-icon>queue_music</mat-icon></div>
          <div class="card-titles">
            <div class="card-title">Music Queue</div>
            <div class="card-desc">Upcoming song queue with cover art and viewer requests</div>
          </div>
        </div>

        <div class="card-url">
          <div class="url-display" [title]="musicQueueUrl()">{{ musicQueueUrl() }}</div>
          <button class="copy-btn" [class.copied]="mqCopied()" (click)="copyMq()">
            <mat-icon>{{ mqCopied() ? 'check' : 'content_copy' }}</mat-icon>
            {{ mqCopied() ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <button class="settings-toggle" (click)="mqSettingsOpen.update(v => !v)">
          <span class="settings-toggle-label">
            <mat-icon>tune</mat-icon>
            Settings
          </span>
          <mat-icon class="settings-toggle-chevron" [class.open]="mqSettingsOpen()">
            expand_more
          </mat-icon>
        </button>

        @if (mqSettingsOpen()) {
          <div class="settings-panel">
            <div class="tab-content">
              <div class="field-group">
                <span class="field-label">Songs to show</span>
                <input class="field-input" type="number" min="1" max="10" step="1"
                  [ngModel]="mqMaxItems()" (ngModelChange)="setMqMaxItems(+$event)" />
                <span class="field-hint">How many upcoming songs to display (1–10)</span>
              </div>
              <div class="field-group">
                <span class="field-label">Show Now Playing</span>
                <select class="field-input"
                  [ngModel]="mqShowNowPlaying()"
                  (ngModelChange)="setMqShowNowPlaying($event === 'true' || $event === true)">
                  <option [value]="true">Yes — show current track at top</option>
                  <option [value]="false">No — queue only</option>
                </select>
              </div>
              <div class="field-group">
                <span class="field-label">Album art</span>
                <select class="field-input"
                  [ngModel]="mqShowArt()"
                  (ngModelChange)="setMqShowArt($event === 'true' || $event === true)">
                  <option [value]="true">Show cover art</option>
                  <option [value]="false">Text only</option>
                </select>
              </div>
              <div class="field-group">
                <span class="field-label">Requesters</span>
                <select class="field-input"
                  [ngModel]="mqShowRequesters()"
                  (ngModelChange)="setMqShowRequesters($event === 'true' || $event === true)">
                  <option [value]="true">Show requester name</option>
                  <option [value]="false">Hide requesters</option>
                </select>
              </div>
            </div>
          </div>
        }

      </div>

      <!-- ── Goal: Single overlay card ────────────────────────── -->
      <div class="overlay-card">

        <div class="card-header">
          <div class="card-icon"><mat-icon>flag</mat-icon></div>
          <div class="card-titles">
            <div class="card-title">Goal: Single</div>
            <div class="card-desc">One animated goal bar — followers, subs, gifts, bits, or tips</div>
          </div>
        </div>

        <div class="card-url">
          <div class="url-display" [title]="goalSingleUrl()">{{ goalSingleUrl() }}</div>
          <button class="copy-btn" [class.copied]="goalSingleCopied()" (click)="copyGoalSingle()">
            <mat-icon>{{ goalSingleCopied() ? 'check' : 'content_copy' }}</mat-icon>
            {{ goalSingleCopied() ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <button class="settings-toggle" (click)="goalSingleOpen.update(v => !v)">
          <span class="settings-toggle-label"><mat-icon>tune</mat-icon> Settings</span>
          <mat-icon class="settings-toggle-chevron" [class.open]="goalSingleOpen()">expand_more</mat-icon>
        </button>

        @if (goalSingleOpen()) {
          <div class="settings-panel">
            <div class="tab-content">
              <div class="gs-grid">

                <div class="field-group">
                  <span class="field-label">Theme</span>
                  <select class="field-input" [ngModel]="gsTheme()" (ngModelChange)="setGsTheme($event)">
                    <option value="simple">Simple</option>
                    <option value="fun">Fun</option>
                    <option value="future">Future</option>
                    <option value="otter">Otter</option>
                  </select>
                </div>

                <div class="field-group">
                  <span class="field-label">Platform</span>
                  <select class="field-input" [ngModel]="gsPlatform()" (ngModelChange)="setGsPlatform($event)">
                    <option value="all">All platforms</option>
                    <option value="twitch">Twitch</option>
                    <option value="youtube">YouTube</option>
                    <option value="kick">Kick</option>
                    <option value="tiktok">TikTok</option>
                    <option value="joystick">Joystick.tv</option>
                  </select>
                </div>

                <div class="field-group">
                  <span class="field-label">Metric</span>
                  <select class="field-input" [ngModel]="gsMetric()" (ngModelChange)="setGsMetric($event)">
                    <option value="follow">Follows</option>
                    <option value="subscribe">Subscriptions</option>
                    <option value="gift_sub">Gifted Subs</option>
                    <option value="cheer">Bits (accumulated)</option>
                    <option value="tip">Tips (accumulated $)</option>
                    <option value="like">Likes</option>
                  </select>
                </div>

                <div class="field-group">
                  <span class="field-label">Target</span>
                  <input class="field-input" type="number" min="1"
                    [ngModel]="gsTarget()" (ngModelChange)="setGsTarget(+$event)" />
                </div>

                <div class="field-group gs-span2">
                  <span class="field-label">Label</span>
                  <input class="field-input" type="text" placeholder="Leave blank to use metric name"
                    [ngModel]="gsLabel()" (ngModelChange)="setGsLabel($event)" />
                </div>

              </div>

              <div style="display:flex; align-items:center; gap:10px; margin-top:14px; padding-top:12px; border-top:1px solid var(--border);">
                <span style="font-size:12px; color:var(--text-2); white-space:nowrap;">Current count</span>
                <input class="field-input" type="number" min="0" style="width:80px; padding:5px 8px; font-size:13px;"
                  [ngModel]="gsCurrentCount()" (ngModelChange)="setGsCurrent(+$event)" />
                <button class="copy-btn" (click)="resetGsCount()" style="color:var(--warn,#ef4444); border-color:var(--warn-border,rgba(239,68,68,0.35)); margin-left:auto;">
                  <mat-icon style="font-size:14px;width:14px;height:14px;">restart_alt</mat-icon>
                  Reset
                </button>
              </div>

            </div>
          </div>
        }

      </div>

      <!-- ── Goal: Multi overlay card ──────────────────────────── -->
      <div class="overlay-card">

        <div class="card-header">
          <div class="card-icon"><mat-icon>stacked_bar_chart</mat-icon></div>
          <div class="card-titles">
            <div class="card-title">Goal: Multi</div>
            <div class="card-desc">Up to 4 simultaneous goals in a stacked bar layout</div>
          </div>
        </div>

        <div class="card-url">
          <div class="url-display" [title]="goalMultiUrl()">{{ goalMultiUrl() }}</div>
          <button class="copy-btn" [class.copied]="goalMultiCopied()" (click)="copyGoalMulti()">
            <mat-icon>{{ goalMultiCopied() ? 'check' : 'content_copy' }}</mat-icon>
            {{ goalMultiCopied() ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <button class="settings-toggle" (click)="goalMultiOpen.update(v => !v)">
          <span class="settings-toggle-label"><mat-icon>tune</mat-icon> Settings</span>
          <mat-icon class="settings-toggle-chevron" [class.open]="goalMultiOpen()">expand_more</mat-icon>
        </button>

        @if (goalMultiOpen()) {
          <div class="settings-panel">
            <div class="tab-content">

              <div class="field-group" style="margin-bottom: 16px;">
                <span class="field-label">Theme</span>
                <select class="field-input" [ngModel]="gmTheme()" (ngModelChange)="setGmTheme($event)">
                  <option value="simple">Simple</option>
                  <option value="fun">Fun</option>
                  <option value="future">Future</option>
                  <option value="otter">Otter</option>
                </select>
              </div>

              <table class="goals-table">
                <thead>
                  <tr class="goals-thead">
                    <th class="goal-num">#</th>
                    <th class="goal-toggle-cell">On</th>
                    <th>Label</th>
                    <th>Platform</th>
                    <th>Metric</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody class="goals-tbody">
                  @for (goal of multiGoals(); track $index) {
                    <tr>
                      <td class="goal-num">{{ $index + 1 }}</td>
                      <td class="goal-toggle-cell">
                        <button class="notif-toggle" [class.on]="goal.enabled"
                          (click)="toggleMultiGoal($index)">{{ goal.enabled ? '✓' : '' }}</button>
                      </td>
                      <td>
                        <input class="field-input compact goal-label-input" type="text" placeholder="Label"
                          [value]="goal.label"
                          (change)="setMultiGoalField($index, 'label', $any($event.target).value)" />
                      </td>
                      <td>
                        <select class="field-input compact" [value]="goal.platform"
                          (change)="setMultiGoalField($index, 'platform', $any($event.target).value)">
                          <option value="all">All</option>
                          <option value="twitch">Twitch</option>
                          <option value="youtube">YouTube</option>
                          <option value="kick">Kick</option>
                          <option value="tiktok">TikTok</option>
                          <option value="joystick">Joystick</option>
                        </select>
                      </td>
                      <td>
                        <select class="field-input compact" [value]="goal.metric"
                          (change)="setMultiGoalField($index, 'metric', $any($event.target).value)">
                          <option value="follow">Follows</option>
                          <option value="subscribe">Subs</option>
                          <option value="gift_sub">Gift Subs</option>
                          <option value="cheer">Bits</option>
                          <option value="tip">Tips</option>
                          <option value="like">Likes</option>
                        </select>
                      </td>
                      <td>
                        <input class="field-input compact goal-target-input" type="number" min="1"
                          [value]="goal.target"
                          (change)="setMultiGoalField($index, 'target', +$any($event.target).value)" />
                      </td>
                    </tr>
                  }
                </tbody>
              </table>

            </div>
          </div>
        }

      </div>

    </div>
  `,
})
export class InterfacesComponent implements OnInit {
  private readonly settingsSvc = inject(SettingsService);
  private readonly snackBar    = inject(MatSnackBar);

  readonly platforms         = PLATFORMS;
  readonly notifTypes        = NOTIF_TYPES;
  readonly otterlyNotifTypes = OTTERLY_NOTIF_TYPES;
  readonly copied            = signal(false);

  readonly chatSettingsOpen = signal(false);
  readonly chatTab          = signal<SettingsTab>('colors');
  readonly chatUrl          = signal('http://localhost:3737/overlays/chat');

  readonly platformColors      = signal<Record<string, string>>({ ...DEFAULT_COLORS });
  readonly fadeTimeout         = signal<number>(0);
  readonly fontSize            = signal<number>(14);
  readonly maxMessages         = signal<number>(30);
  readonly hiddenPlatforms     = signal<Set<string>>(new Set<string>());
  readonly notificationFilters = signal<Record<string, Set<string>>>({});
  readonly testPattern         = signal<boolean>(true);
  readonly exitAnimation       = signal<string>('slide-left');

  // Music Queue overlay
  readonly musicQueueUrl  = signal('http://localhost:3737/overlays/music-queue');
  readonly mqSettingsOpen = signal(false);
  readonly mqCopied       = signal(false);
  readonly mqMaxItems        = signal<number>(5);
  readonly mqShowNowPlaying  = signal<boolean>(true);
  readonly mqShowRequesters  = signal<boolean>(true);
  readonly mqShowArt         = signal<boolean>(true);

  // Now Playing overlay
  readonly nowPlayingUrl  = signal('http://localhost:3737/overlays/now-playing');
  readonly npSettingsOpen = signal(false);
  readonly npCopied       = signal(false);
  readonly npShowArt       = signal<boolean>(true);
  readonly npShowArtist    = signal<boolean>(true);
  readonly npShowProgress  = signal<boolean>(true);
  readonly npShowRequester = signal<boolean>(true);

  // Goal Single overlay
  readonly goalSingleUrl      = signal('http://localhost:3737/overlays/goal-single');
  readonly goalSingleCopied   = signal(false);
  readonly goalSingleOpen     = signal(false);
  readonly gsTheme            = signal<string>('simple');
  readonly gsPlatform         = signal<string>('all');
  readonly gsMetric           = signal<string>('follow');
  readonly gsTarget           = signal<number>(100);
  readonly gsLabel            = signal<string>('');
  readonly gsCurrentCount     = signal<number>(0);

  // Goal Multi overlay
  readonly goalMultiUrl       = signal('http://localhost:3737/overlays/goal-multi');
  readonly goalMultiCopied    = signal(false);
  readonly goalMultiOpen      = signal(false);
  readonly gmTheme            = signal<string>('simple');
  readonly multiGoals         = signal<GoalEntry[]>(DEFAULT_MULTI_GOALS.map(g => ({ ...g })));

  async ngOnInit(): Promise<void> {
    await this.settingsSvc.load();
    const s = this.settingsSvc.settings() as Record<string, unknown> | null;
    const port = (s?.['server.port'] as number | undefined) ?? 3737;
    this.chatUrl.set(`http://localhost:${port}/overlays/chat`);
    this.musicQueueUrl.set(`http://localhost:${port}/overlays/music-queue`);
    this.nowPlayingUrl.set(`http://localhost:${port}/overlays/now-playing`);

    this.goalSingleUrl.set(`http://localhost:${port}/overlays/goal-single`);
    this.goalMultiUrl.set(`http://localhost:${port}/overlays/goal-multi`);

    if (s) {
      if (s[KEY_COLORS] != null)
        this.platformColors.set({ ...DEFAULT_COLORS, ...(s[KEY_COLORS] as Record<string, string>) });
      if (s[KEY_FADE_TIMEOUT] != null)
        this.fadeTimeout.set(Number(s[KEY_FADE_TIMEOUT]));
      if (s[KEY_FONT_SIZE] != null)
        this.fontSize.set(Number(s[KEY_FONT_SIZE]));
      if (s[KEY_MAX_MESSAGES] != null)
        this.maxMessages.set(Number(s[KEY_MAX_MESSAGES]));
      if (s[KEY_HIDDEN] != null)
        this.hiddenPlatforms.set(new Set(s[KEY_HIDDEN] as string[]));
      if (s[KEY_NOTIFICATION_FILTERS] != null) {
        const raw = s[KEY_NOTIFICATION_FILTERS] as Record<string, string[]>;
        const filters: Record<string, Set<string>> = {};
        for (const [platform, types] of Object.entries(raw)) {
          filters[platform] = new Set(types);
        }
        this.notificationFilters.set(filters);
      }
      if (s[KEY_TEST_PATTERN] != null)
        this.testPattern.set(Boolean(s[KEY_TEST_PATTERN]));
      if (s[KEY_EXIT_ANIMATION] != null)
        this.exitAnimation.set(String(s[KEY_EXIT_ANIMATION]));
      if (s[KEY_MQ_MAX_ITEMS] != null)        this.mqMaxItems.set(Number(s[KEY_MQ_MAX_ITEMS]));
      if (s[KEY_MQ_SHOW_NOW_PLAYING] != null) this.mqShowNowPlaying.set(Boolean(s[KEY_MQ_SHOW_NOW_PLAYING]));
      if (s[KEY_MQ_SHOW_REQUESTERS] != null)  this.mqShowRequesters.set(Boolean(s[KEY_MQ_SHOW_REQUESTERS]));
      if (s[KEY_MQ_SHOW_ART] != null)         this.mqShowArt.set(Boolean(s[KEY_MQ_SHOW_ART]));
      if (s[KEY_NP_SHOW_ART] != null)       this.npShowArt.set(Boolean(s[KEY_NP_SHOW_ART]));
      if (s[KEY_NP_SHOW_ARTIST] != null)    this.npShowArtist.set(Boolean(s[KEY_NP_SHOW_ARTIST]));
      if (s[KEY_NP_SHOW_PROGRESS] != null)  this.npShowProgress.set(Boolean(s[KEY_NP_SHOW_PROGRESS]));
      if (s[KEY_NP_SHOW_REQUESTER] != null) this.npShowRequester.set(Boolean(s[KEY_NP_SHOW_REQUESTER]));
      if (s[KEY_GS_THEME]    != null) this.gsTheme.set(String(s[KEY_GS_THEME]));
      if (s[KEY_GS_PLATFORM] != null) this.gsPlatform.set(String(s[KEY_GS_PLATFORM]));
      if (s[KEY_GS_METRIC]   != null) this.gsMetric.set(String(s[KEY_GS_METRIC]));
      if (s[KEY_GS_TARGET]   != null) this.gsTarget.set(Number(s[KEY_GS_TARGET]) || 100);
      if (s[KEY_GS_LABEL]    != null) this.gsLabel.set(String(s[KEY_GS_LABEL] ?? ''));
      if (s[KEY_GS_CURRENT]  != null) this.gsCurrentCount.set(Number(s[KEY_GS_CURRENT]) || 0);
      if (s[KEY_GM_THEME]    != null) this.gmTheme.set(String(s[KEY_GM_THEME]));
      if (s[KEY_GM_GOALS]    != null) {
        const raw = s[KEY_GM_GOALS] as GoalEntry[];
        this.multiGoals.set(
          Array.from({ length: 4 }, (_, i) => raw[i] ?? { ...DEFAULT_MULTI_GOALS[i] })
        );
      }
    }
  }

  platformColor(platform: string): string {
    return this.platformColors()[platform] ?? '#7c8aa0';
  }

  setColor(platform: string, color: string): void {
    const updated = { ...this.platformColors(), [platform]: color };
    this.platformColors.set(updated);
    this.settingsSvc.set(KEY_COLORS, updated);
  }

  resetColors(): void {
    this.platformColors.set({ ...DEFAULT_COLORS });
    this.settingsSvc.set(KEY_COLORS, { ...DEFAULT_COLORS });
  }

  setFadeTimeout(value: number): void {
    this.fadeTimeout.set(Number(value));
    this.settingsSvc.set(KEY_FADE_TIMEOUT, Number(value));
  }

  setFontSize(value: number): void {
    const v = Math.max(10, Math.min(32, Number(value)));
    this.fontSize.set(v);
    this.settingsSvc.set(KEY_FONT_SIZE, v);
  }

  setMaxMessages(value: number): void {
    const v = Math.max(5, Math.min(100, Number(value)));
    this.maxMessages.set(v);
    this.settingsSvc.set(KEY_MAX_MESSAGES, v);
  }

  setTestPattern(value: boolean): void {
    this.testPattern.set(value);
    this.settingsSvc.set(KEY_TEST_PATTERN, value);
  }

  setExitAnimation(value: string): void {
    this.exitAnimation.set(value);
    this.settingsSvc.set(KEY_EXIT_ANIMATION, value);
  }

  togglePlatform(platform: string): void {
    const hidden = new Set(this.hiddenPlatforms());
    if (hidden.has(platform)) hidden.delete(platform);
    else hidden.add(platform);
    this.hiddenPlatforms.set(hidden);
    this.settingsSvc.set(KEY_HIDDEN, [...hidden]);
  }

  isNotifEnabled(platform: string, eventType: string): boolean {
    const disabled = this.notificationFilters()[platform];
    return !disabled?.has(eventType);
  }

  toggleNotif(platform: string, eventType: string): void {
    const filters  = { ...this.notificationFilters() };
    const disabled = new Set(filters[platform] ?? []);
    if (disabled.has(eventType)) disabled.delete(eventType);
    else disabled.add(eventType);
    filters[platform] = disabled;
    this.notificationFilters.set(filters);

    const serializable: Record<string, string[]> = {};
    for (const [p, types] of Object.entries(filters)) {
      if (types.size > 0) serializable[p] = [...types];
    }
    this.settingsSvc.set(KEY_NOTIFICATION_FILTERS, serializable);
  }

  async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.snackBar.open('Could not copy to clipboard', 'Dismiss', { duration: 3000 });
    }
  }

  async copyMq(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.musicQueueUrl());
      this.mqCopied.set(true);
      setTimeout(() => this.mqCopied.set(false), 2000);
    } catch {
      this.snackBar.open('Could not copy to clipboard', 'Dismiss', { duration: 3000 });
    }
  }

  setMqMaxItems(value: number): void {
    const v = Math.max(1, Math.min(10, value));
    this.mqMaxItems.set(v);
    this.settingsSvc.set(KEY_MQ_MAX_ITEMS, v);
  }

  setMqShowNowPlaying(value: boolean): void {
    this.mqShowNowPlaying.set(value);
    this.settingsSvc.set(KEY_MQ_SHOW_NOW_PLAYING, value);
  }

  setMqShowArt(value: boolean): void {
    this.mqShowArt.set(value);
    this.settingsSvc.set(KEY_MQ_SHOW_ART, value);
  }

  setMqShowRequesters(value: boolean): void {
    this.mqShowRequesters.set(value);
    this.settingsSvc.set(KEY_MQ_SHOW_REQUESTERS, value);
  }

  async copyNp(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.nowPlayingUrl());
      this.npCopied.set(true);
      setTimeout(() => this.npCopied.set(false), 2000);
    } catch {
      this.snackBar.open('Could not copy to clipboard', 'Dismiss', { duration: 3000 });
    }
  }

  setNpShowArt(value: boolean): void {
    this.npShowArt.set(value);
    this.settingsSvc.set(KEY_NP_SHOW_ART, value);
  }

  setNpShowArtist(value: boolean): void {
    this.npShowArtist.set(value);
    this.settingsSvc.set(KEY_NP_SHOW_ARTIST, value);
  }

  setNpShowProgress(value: boolean): void {
    this.npShowProgress.set(value);
    this.settingsSvc.set(KEY_NP_SHOW_PROGRESS, value);
  }

  setNpShowRequester(value: boolean): void {
    this.npShowRequester.set(value);
    this.settingsSvc.set(KEY_NP_SHOW_REQUESTER, value);
  }

  // ── Goal Single ────────────────────────────────────────────────────────

  async copyGoalSingle(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.goalSingleUrl());
      this.goalSingleCopied.set(true);
      setTimeout(() => this.goalSingleCopied.set(false), 2000);
    } catch { this.snackBar.open('Could not copy to clipboard', 'Dismiss', { duration: 3000 }); }
  }

  setGsTheme(v: string):    void { this.gsTheme.set(v);         this.settingsSvc.set(KEY_GS_THEME, v); }
  setGsPlatform(v: string): void { this.gsPlatform.set(v);      this.settingsSvc.set(KEY_GS_PLATFORM, v); }
  setGsMetric(v: string):   void { this.gsMetric.set(v);        this.settingsSvc.set(KEY_GS_METRIC, v); }
  setGsLabel(v: string):    void { this.gsLabel.set(v);         this.settingsSvc.set(KEY_GS_LABEL, v); }
  setGsTarget(v: number):   void {
    const n = Math.max(1, Number(v) || 100);
    this.gsTarget.set(n);
    this.settingsSvc.set(KEY_GS_TARGET, n);
  }
  setGsCurrent(v: number): void {
    const n = Math.max(0, Number(v) || 0);
    this.gsCurrentCount.set(n);
    this.settingsSvc.set(KEY_GS_CURRENT, n);
  }

  resetGsCount(): void {
    this.setGsCurrent(0);
  }

  // ── Goal Multi ─────────────────────────────────────────────────────────

  async copyGoalMulti(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.goalMultiUrl());
      this.goalMultiCopied.set(true);
      setTimeout(() => this.goalMultiCopied.set(false), 2000);
    } catch { this.snackBar.open('Could not copy to clipboard', 'Dismiss', { duration: 3000 }); }
  }

  setGmTheme(v: string): void { this.gmTheme.set(v); this.settingsSvc.set(KEY_GM_THEME, v); }

  setMultiGoalField(idx: number, field: keyof GoalEntry, value: unknown): void {
    const updated = this.multiGoals().map((g, i) =>
      i === idx ? { ...g, [field]: field === 'target' ? Number(value) || 100 : value } : g
    );
    this.multiGoals.set(updated);
    this.settingsSvc.set(KEY_GM_GOALS, updated);
  }

  toggleMultiGoal(idx: number): void {
    this.setMultiGoalField(idx, 'enabled', !this.multiGoals()[idx]?.enabled);
  }
}
