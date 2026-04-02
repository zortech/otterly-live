import { Component, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { StreamService, StreamServicesService } from '../stream-services.service';
import { OtteryLiveService } from '../ottery-live.service';

export interface PlatformFormDialogData {
  service: StreamService | null;
}

@Component({
  selector: 'app-platform-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    DatePipe,
  ],
  styles: [`
    /* ── Dialog shell ───────────────────────────────────────────────── */
    mat-dialog-content {
      min-width: 600px;
      max-width: 660px;
      padding: 0 24px 16px !important;
      max-height: 70vh !important;
      overflow-y: auto;
      overflow-x: hidden;
    }

    /* ── Header ─────────────────────────────────────────────────────── */
    .dlg-header {
      padding: 0 !important;
      margin-bottom: 0 !important;
      font-size: inherit !important;
      font-weight: inherit !important;
      letter-spacing: inherit !important;
      line-height: inherit !important;
    }

    .dlg-strip {
      height: 3px;
      background: var(--brand, var(--accent));
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      transition: background 0.3s ease;
    }

    .dlg-header-body {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px 20px;
      background: color-mix(in srgb, var(--brand, var(--accent)) 5%, var(--bg-card));
      border-bottom: 1px solid var(--border);
      transition: background 0.3s ease;
    }

    .dlg-mark {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      border: 1.5px solid var(--brand, var(--accent));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 800;
      color: var(--brand, var(--accent));
      flex-shrink: 0;
      letter-spacing: -0.5px;
      transition: border-color 0.3s, color 0.3s;
    }

    .dlg-mark.neutral {
      border-color: var(--border-2);
      color: var(--text-2);
      font-size: 20px;
      font-weight: 400;
    }

    .dlg-header-text { flex: 1; min-width: 0; }

    .dlg-header-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-1);
      letter-spacing: -0.3px;
      line-height: 1.2;
    }

    .dlg-header-sub {
      font-size: 11.5px;
      color: var(--text-2);
      margin-top: 2px;
      text-transform: capitalize;
    }

    .dlg-close-btn {
      color: var(--text-3) !important;
      flex-shrink: 0;
      transition: color 0.12s !important;
    }
    .dlg-close-btn:hover { color: var(--text-1) !important; }

    /* ── Error box ──────────────────────────────────────────────────── */
    .error-box {
      background: rgba(255,71,87,0.08);
      border: 1px solid rgba(255,71,87,0.25);
      border-left: 3px solid var(--error-color);
      border-radius: 7px;
      padding: 10px 14px;
      font-size: 13px;
      color: var(--error-color);
      margin-bottom: 16px;
      margin-top: 16px;
    }

    /* ── Platform picker ────────────────────────────────────────────── */
    .picker-wrap {
      padding-top: 20px;
    }

    .picker-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.3px;
      color: var(--text-3);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .picker-label::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    .platform-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }

    .platform-card {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 18px 12px 14px;
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: 10px;
      cursor: pointer;
      font-family: inherit;
      transition: border-color 0.15s, background 0.15s, transform 0.1s;
      overflow: hidden;
    }

    .platform-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: var(--brand);
      transition: opacity 0.15s;
      opacity: 0;
    }

    .platform-card:hover {
      border-color: var(--brand);
      background: color-mix(in srgb, var(--brand) 7%, var(--bg-raised));
      transform: translateY(-1px);
    }
    .platform-card:hover::before { opacity: 1; }

    .platform-card.card-selected {
      border-color: var(--brand);
      background: color-mix(in srgb, var(--brand) 10%, var(--bg-raised));
      box-shadow: 0 0 0 1px var(--brand);
    }
    .platform-card.card-selected::before { opacity: 1; }

    .card-mark {
      font-size: 22px;
      font-weight: 800;
      color: var(--brand);
      letter-spacing: -1px;
      line-height: 1;
    }

    .card-name {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-1);
      text-transform: capitalize;
    }

    .loading-platforms {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: var(--text-2);
      padding: 24px 0;
      justify-content: center;
    }

    /* ── Back link ──────────────────────────────────────────────────── */
    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--text-3);
      background: none;
      border: none;
      cursor: pointer;
      font-family: inherit;
      padding: 0;
      margin-top: 16px;
      margin-bottom: 4px;
      transition: color 0.12s;
    }
    .back-link:hover { color: var(--text-2); }
    .back-link mat-icon { font-size: 14px; width: 14px; height: 14px; }

    /* ── Hint box ───────────────────────────────────────────────────── */
    .hint-box {
      background: var(--bg-raised);
      border: 1px solid var(--border-2);
      border-left: 3px solid var(--brand, var(--accent));
      border-radius: 8px;
      padding: 13px 16px;
      margin-bottom: 4px;
      transition: border-color 0.3s;
    }

    .hint-box-title {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--brand, var(--accent));
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: color 0.3s;
    }
    .hint-box-title mat-icon { font-size: 13px; width: 13px; height: 13px; }

    .hint-list { list-style: none; padding: 0; margin: 0; }
    .hint-list li {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12.5px;
      color: var(--text-2);
      margin-bottom: 5px;
      line-height: 1.45;
    }
    .hint-list li:last-child { margin-bottom: 0; }
    .hint-bullet {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--brand, var(--accent));
      flex-shrink: 0;
      margin-top: 5px;
      transition: background 0.3s;
    }
    .hint-link { color: var(--accent); text-decoration: none; }
    .hint-link:hover { text-decoration: underline; }

    /* ── Form sections ──────────────────────────────────────────────── */
    .form-section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--text-3);
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 22px 0 14px;
    }
    .form-section-label::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }
    .form-section-label:first-of-type { margin-top: 20px; }

    mat-form-field { width: 100%; }

    .field-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    /* ── Key badge ──────────────────────────────────────────────────── */
    .key-badge {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: rgba(0, 230, 118, 0.05);
      border: 1px solid rgba(0, 230, 118, 0.15);
      border-radius: 8px;
      margin-bottom: 4px;
    }
    .key-badge-status {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      font-weight: 600;
      color: var(--live);
    }
    .key-badge-status mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .key-badge-label { font-size: 12px; color: var(--text-2); flex: 1; }

    /* ── Toggles ────────────────────────────────────────────────────── */
    .toggles-block {
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 13px 16px;
      border-bottom: 1px solid var(--border);
      gap: 16px;
    }
    .toggle-row:last-child { border-bottom: none; }

    .toggle-info { flex: 1; min-width: 0; }
    .toggle-label { font-size: 13.5px; font-weight: 500; color: var(--text-1); display: block; }
    .toggle-desc { font-size: 11.5px; color: var(--text-3); margin-top: 1px; display: block; }

    /* ── OAuth sections ─────────────────────────────────────────────── */
    .oauth-section { margin-top: 4px; }
    .oauth-section h4 {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-1);
      margin: 0 0 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .oauth-connected {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 10px 14px;
      background: rgba(0, 230, 118, 0.05);
      border: 1px solid rgba(0, 230, 118, 0.15);
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .oauth-connected-status {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--live);
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .oauth-connected-status mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .token-expiry { font-size: 11px; color: var(--text-2); flex: 1; }

    .oauth-hint { font-size: 13px; color: var(--text-2); margin: 0 0 10px; line-height: 1.5; }

    .dcf-box {
      margin-top: 8px;
      padding: 16px;
      background: var(--bg-raised);
      border: 1px solid var(--border-2);
      border-radius: 8px;
    }
    .dcf-box p { margin: 0 0 6px; font-size: 13px; color: var(--text-2); }
    .dcf-box p strong { color: var(--text-1); }
    .dcf-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 4px;
      padding: 8px 14px;
      background: var(--bg-card);
      border: 1px solid var(--border-2);
      border-radius: 6px;
      color: var(--accent);
      display: inline-block;
      margin: 6px 0;
    }
    .dcf-waiting {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      font-size: 13px;
      color: var(--text-2);
    }
    .oauth-success {
      color: var(--live);
      font-size: 13px;
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .oauth-success mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .oauth-error { color: var(--error-color); font-size: 13px; margin-top: 8px; margin-bottom: 8px; }

    /* ── TikTok / X special sections ────────────────────────────────── */
    .tiktok-key-banner {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      background: rgba(254, 44, 85, 0.07);
      border: 1px solid rgba(254, 44, 85, 0.2);
      border-radius: 8px;
      margin-bottom: 12px;
      font-size: 12.5px;
      color: var(--text-2);
      line-height: 1.5;
    }
    .tiktok-key-banner mat-icon {
      color: #fe2c55;
      font-size: 16px;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .tiktok-key-banner strong { color: #fe2c55; }

    .x-warning {
      padding: 12px 14px;
      background: rgba(255, 71, 87, 0.07);
      border: 1px solid rgba(255, 71, 87, 0.2);
      border-radius: 8px;
      font-size: 13px;
      color: var(--text-2);
      margin-bottom: 12px;
      line-height: 1.5;
    }
    .x-warning strong { color: var(--error-color); }

    .tiktok-key-row {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .tiktok-key-row mat-form-field { flex: 1; margin: 0; }

    .key-updated-at { font-size: 11px; color: var(--text-3); margin-top: 4px; }

    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      background: var(--bg-raised);
      border: 1px solid var(--border-2);
      border-radius: 4px;
      padding: 1px 6px;
      color: var(--accent);
    }

    /* ── Dialog actions ─────────────────────────────────────────────── */
    mat-dialog-actions {
      padding: 12px 20px !important;
      border-top: 1px solid var(--border) !important;
      gap: 8px;
    }

    /* ── GCP hint ───────────────────────────────────────────────────── */
    .gcp-hint {
      background: var(--bg-raised);
      border: 1px solid var(--border-2);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 12px;
    }
    .gcp-hint-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--accent);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .gcp-hint-title mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .gcp-hint p { font-size: 12.5px; color: var(--text-2); margin: 0 0 10px; line-height: 1.5; }
  `],
  template: `
    <!-- ── Header ── -->
    <div mat-dialog-title class="dlg-header" [style.--brand]="platformBrandColor()">
      <div class="dlg-strip"></div>
      <div class="dlg-header-body">
        @if (isEdit()) {
          <div class="dlg-mark" [style.--brand]="platformBrandColor()">
            {{ platformMark(data.service!.platform) }}
          </div>
        } @else if (form.controls.platform.value) {
          <div class="dlg-mark" [style.--brand]="platformBrandColor()">
            {{ platformMark(form.controls.platform.value) }}
          </div>
        } @else {
          <div class="dlg-mark neutral">+</div>
        }
        <div class="dlg-header-text">
          <div class="dlg-header-title">
            @if (isEdit()) {
              Edit {{ data.service!.display_name }}
            } @else if (selectedPlatformMeta()) {
              {{ selectedPlatformMeta()!.display_name }}
            } @else {
              Add Platform
            }
          </div>
          <div class="dlg-header-sub">
            @if (isEdit()) {
              {{ data.service!.platform }} · stream service
            } @else if (selectedPlatformMeta()) {
              {{ selectedPlatformMeta()!.id }} · stream service
            } @else {
              Select a platform to continue
            }
          </div>
        </div>
        <button mat-icon-button mat-dialog-close class="dlg-close-btn">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    </div>

    <mat-dialog-content>
      @if (errorMessage()) {
        <div class="error-box">{{ errorMessage() }}</div>
      }

      <!-- ── Platform picker (add mode, no selection) ── -->
      @if (!isEdit() && !form.controls.platform.value) {
        <div class="picker-wrap">
          @if (svc.loading()) {
            <div class="loading-platforms">
              <mat-spinner diameter="18" />
              <span>Loading platforms…</span>
            </div>
          } @else if (svc.platforms().length === 0) {
            <div class="error-box" style="margin-top:20px">
              Could not load platform list. Please close this dialog and try again.
            </div>
          } @else {
            <div class="picker-label">Choose a platform</div>
            <div class="platform-grid">
              @for (p of svc.platforms(); track p.id) {
                <button
                  class="platform-card"
                  [class.card-selected]="form.controls.platform.value === p.id"
                  [style.--brand]="platformBrandColor(p.id)"
                  (click)="selectPlatform(p.id)">
                  <div class="card-mark">{{ platformMark(p.id) }}</div>
                  <div class="card-name">{{ p.display_name }}</div>
                </button>
              }
            </div>
          }
        </div>
      }

      <!-- ── Form (platform selected or edit mode) ── -->
      @if (isEdit() || form.controls.platform.value) {
        <form [formGroup]="form">

          <!-- Back to picker (add mode only) -->
          @if (!isEdit()) {
            <button type="button" class="back-link" (click)="clearPlatform()">
              <mat-icon>arrow_back</mat-icon>
              Change platform
            </button>
          }

          <!-- What you need hint -->
          @if (!isEdit() && selectedPlatformMeta()) {
            <div class="hint-box" [style.--brand]="platformBrandColor()">
              <div class="hint-box-title">
                <mat-icon>checklist</mat-icon>
                What you need for {{ selectedPlatformMeta()!.display_name }}
              </div>
              <ul class="hint-list">
                @for (item of platformRequirements(selectedPlatformMeta()!.id); track $index) {
                  <li>
                    <div class="hint-bullet"></div>
                    <span [innerHTML]="item"></span>
                  </li>
                }
              </ul>
            </div>
          }

          <!-- ── CONFIGURATION ── -->
          <div class="form-section-label">Configuration</div>

          <div class="field-row">
            <mat-form-field appearance="outline">
              <mat-label>Display Name</mat-label>
              <input matInput formControlName="display_name" />
              <mat-hint>Label shown in the dashboard</mat-hint>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Username</mat-label>
              <input matInput formControlName="username" placeholder="Your platform handle" />
              <mat-hint>Used for display and event capture</mat-hint>
            </mat-form-field>
          </div>

          @if (!isEdit() || (isEdit() && data.service?.platform !== 'tiktok' && data.service?.platform !== 'youtube')) {
            <mat-form-field appearance="outline">
              <mat-label>RTMP URL</mat-label>
              <input matInput formControlName="rtmp_url" />
              @if (selectedPlatformMeta()?.rtmp_url_hint) {
                <mat-hint>{{ selectedPlatformMeta()!.rtmp_url_hint }}</mat-hint>
              }
            </mat-form-field>
          }

          @if (isEdit() && data.service!.stream_key_configured && !showStreamKeyField()) {
            <div class="key-badge">
              <span class="key-badge-status">
                <mat-icon>lock</mat-icon>
                Stream key configured
              </span>
              <span class="key-badge-label">Stored securely in OS keychain</span>
              <button mat-stroked-button type="button" (click)="showStreamKeyField.set(true)">Update</button>
            </div>
          } @else if (!isEdit() || showStreamKeyField()) {
            <mat-form-field appearance="outline">
              <mat-label>Stream Key</mat-label>
              <input matInput type="password" formControlName="stream_key"
                     autocomplete="new-password"
                     [placeholder]="isEdit() ? 'Leave blank to keep current' : 'Enter stream key'" />
              <mat-hint>Write-only — stored securely in OS keychain</mat-hint>
            </mat-form-field>
          }

          <!-- Twitch Client ID -->
          @if (isEdit() && data.service?.platform === 'twitch') {
            @if (data.service?.api_client_configured && !showClientIdField()) {
              <div class="key-badge">
                <span class="key-badge-status"><mat-icon>lock</mat-icon> Client ID configured</span>
                <span class="key-badge-label">Twitch app credentials saved</span>
                <button mat-stroked-button type="button" (click)="showClientIdField.set(true)">Update</button>
              </div>
            } @else {
              <mat-form-field appearance="outline">
                <mat-label>Client ID</mat-label>
                <input matInput formControlName="api_client_id" placeholder="Your Twitch app client ID" />
                <mat-hint>Create a Twitch app at dev.twitch.tv — required for event capture</mat-hint>
              </mat-form-field>
            }
          }

          <!-- ── FEATURES ── -->
          <div class="form-section-label">Features</div>

          <div class="toggles-block">
            <div class="toggle-row">
              <div class="toggle-info">
                <span class="toggle-label">Restreaming</span>
                <span class="toggle-desc">Forward your OBS stream to this platform</span>
              </div>
              <mat-slide-toggle formControlName="restream_enabled" />
            </div>
            @if (selectedPlatformMeta()?.event_capture_supported !== false) {
              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Event capture</span>
                  <span class="toggle-desc">Receive chat, follows, subs, and other live events</span>
                </div>
                <mat-slide-toggle formControlName="event_capture_enabled" />
              </div>
            }
            <div class="toggle-row">
              <div class="toggle-info">
                <span class="toggle-label">Auto-start with OBS</span>
                <span class="toggle-desc">Begin restreaming when OBS connects automatically</span>
              </div>
              <mat-slide-toggle formControlName="auto_start" />
            </div>
            @if (isEdit()) {
              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">Active</span>
                  <span class="toggle-desc">Include this platform in the dashboard and stream sessions</span>
                </div>
                <mat-slide-toggle formControlName="active" />
              </div>
            }
          </div>

          <!-- ── YouTube credentials ── -->
          @if (isEdit() && data.service?.platform === 'youtube') {
            <div class="form-section-label">Google Cloud</div>
            @if (data.service?.api_client_configured && !showClientIdField()) {
              <div class="key-badge">
                <span class="key-badge-status"><mat-icon>lock</mat-icon> GCP credentials configured</span>
                <span class="key-badge-label">Google Cloud OAuth client saved</span>
                <button mat-stroked-button type="button" (click)="showClientIdField.set(true)">Update</button>
              </div>
            } @else {
              <div class="gcp-hint">
                <div class="gcp-hint-title"><mat-icon>info</mat-icon> Google Cloud Project Required</div>
                <p>YouTube enforces 10,000 API units/day per GCP project. Create your own to avoid shared quota limits.</p>
                <button mat-stroked-button type="button" (click)="openYouTubeGcpGuide()">Open Google Cloud Console ↗</button>
              </div>
              <mat-form-field appearance="outline">
                <mat-label>Client ID</mat-label>
                <input matInput formControlName="api_client_id" />
                <mat-hint>APIs &amp; Services → Credentials → OAuth 2.0 Client IDs (Desktop App)</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Client Secret</mat-label>
                <input matInput type="password" autocomplete="new-password" formControlName="api_client_secret" />
                <mat-hint>Write-only — stored securely in OS keychain</mat-hint>
              </mat-form-field>
            }
          }

          <!-- ── Kick Client ID ── -->
          @if (isEdit() && data.service?.platform === 'kick') {
            <div class="form-section-label">Kick App</div>
            @if (data.service?.api_client_configured && !showClientIdField()) {
              <div class="key-badge">
                <span class="key-badge-status"><mat-icon>lock</mat-icon> Client ID configured</span>
                <span class="key-badge-label">Kick app credentials saved</span>
                <button mat-stroked-button type="button" (click)="showClientIdField.set(true)">Update</button>
              </div>
            } @else {
              <mat-form-field appearance="outline">
                <mat-label>Client ID</mat-label>
                <input matInput formControlName="api_client_id" />
                <mat-hint>Create a Kick app at dev.kick.com — instant, self-service</mat-hint>
              </mat-form-field>
            }
          }

          <!-- ── Joystick.tv credentials ── -->
          @if (isEdit() && data.service?.platform === 'joystick') {
            <div class="form-section-label">Joystick.tv App</div>
            @if (data.service?.api_client_configured && !showClientIdField()) {
              <div class="key-badge">
                <span class="key-badge-status"><mat-icon>lock</mat-icon> Client credentials configured</span>
                <span class="key-badge-label">Joystick.tv OAuth credentials saved</span>
                <button mat-stroked-button type="button" (click)="showClientIdField.set(true)">Update</button>
              </div>
            } @else {
              <mat-form-field appearance="outline">
                <mat-label>Client ID</mat-label>
                <input matInput formControlName="api_client_id" />
                <mat-hint>Request from Joystick.tv support or developer Discord</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Client Secret</mat-label>
                <input matInput type="password" autocomplete="new-password" formControlName="api_client_secret" />
                <mat-hint>Write-only — stored securely in OS keychain</mat-hint>
              </mat-form-field>
            }
          }

          <!-- ── Twitch target channel ── -->
          @if (isEdit() && data.service?.platform === 'twitch') {
            <div class="form-section-label">Event Capture Channel</div>
            <mat-form-field appearance="outline">
              <mat-label>Target Channel (optional)</mat-label>
              <input matInput formControlName="target_channel" placeholder="e.g. friendsusername" />
              <mat-hint>Leave blank to capture your own channel. Enter another streamer's username to watch their chat/events instead.</mat-hint>
            </mat-form-field>
          }

          <!-- ── Twitch OAuth ── -->
          @if (isEdit() && data.service?.platform === 'twitch') {
            <div class="form-section-label">Twitch Account</div>
            <div class="oauth-section">
              @if (data.service?.oauth_connected && oauthStep() === 'idle') {
                <div class="oauth-connected">
                  <span class="oauth-connected-status"><mat-icon>check_circle</mat-icon> Connected</span>
                  @if (data.service?.api_token_expires_at) {
                    <span class="token-expiry">Valid until {{ data.service?.api_token_expires_at | date:'mediumDate' }}</span>
                  }
                  <button mat-stroked-button type="button" (click)="startTwitchOAuth()">Reconnect</button>
                </div>
              } @else if (oauthStep() === 'idle') {
                <p class="oauth-hint">Connect your Twitch account to enable event capture (follows, subs, chat).</p>
                <button mat-raised-button color="primary" type="button" (click)="startTwitchOAuth()">
                  Connect Twitch Account
                </button>
              }
              @if (oauthStep() === 'polling') {
                @if (oauthCode()) {
                  <div class="dcf-box">
                    <p>1. Go to <strong>{{ oauthVerifyUrl() }}</strong> in your browser</p>
                    <p>2. Enter code: <span class="dcf-code">{{ oauthCode() }}</span></p>
                    <div class="dcf-waiting"><mat-spinner diameter="16" /><span>Waiting for authorization…</span></div>
                  </div>
                } @else {
                  <div class="dcf-waiting"><mat-spinner diameter="16" /><span>Starting authorization…</span></div>
                }
              }
              @if (oauthStep() === 'complete') {
                <p class="oauth-success"><mat-icon>check_circle</mat-icon> Twitch account connected!</p>
              }
              @if (oauthStep() === 'error') {
                @if (oauthCode()) {
                  <div class="dcf-box">
                    <p>1. Go to <strong>{{ oauthVerifyUrl() }}</strong> in your browser</p>
                    <p>2. Enter code: <span class="dcf-code">{{ oauthCode() }}</span></p>
                  </div>
                }
                @if (oauthError()) {
                  <p class="oauth-error">{{ oauthError() }}</p>
                }
                <button mat-raised-button color="primary" type="button" (click)="startTwitchOAuth()">Try Again</button>
              }
            </div>
          }

          <!-- ── Kick OAuth ── -->
          @if (isEdit() && data.service?.platform === 'kick') {
            <div class="form-section-label">Kick Account</div>
            <div class="oauth-section">
              @if (data.service?.oauth_connected && kickOAuthStep() === 'idle') {
                <div class="oauth-connected">
                  <span class="oauth-connected-status"><mat-icon>check_circle</mat-icon> Connected</span>
                  @if (data.service?.stream_key_configured) {
                    <span style="font-size:12px;color:var(--live)">Stream key auto-configured ✓</span>
                  }
                  <button mat-stroked-button type="button" (click)="startKickOAuth()">Reconnect</button>
                </div>
              } @else if (kickOAuthStep() === 'idle') {
                <p class="oauth-hint">Connect your Kick account to enable event capture and auto-configure your stream key. Username must be set above.</p>
                <button mat-raised-button color="primary" type="button" (click)="startKickOAuth()">Connect Kick Account</button>
              }
              @if (kickOAuthStep() === 'waiting') {
                <div class="dcf-waiting"><mat-spinner diameter="16" /><span>Authorize Ottery Live in your browser, then return here…</span></div>
              }
              @if (kickOAuthStep() === 'complete') {
                <p class="oauth-success"><mat-icon>check_circle</mat-icon> Kick connected — stream key auto-configured!</p>
              }
              @if (kickOAuthStep() === 'error' && kickOAuthError()) {
                <p class="oauth-error">{{ kickOAuthError() }}</p>
                <button mat-stroked-button type="button" (click)="startKickOAuth()">Try Again</button>
              }
            </div>
          }

          <!-- ── YouTube OAuth ── -->
          @if (isEdit() && data.service?.platform === 'youtube') {
            <div class="form-section-label">YouTube Account</div>
            <div class="oauth-section">
              @if (data.service?.oauth_connected && youtubeOAuthStep() === 'idle') {
                <div class="oauth-connected">
                  <span class="oauth-connected-status"><mat-icon>check_circle</mat-icon> Connected</span>
                  @if (data.service?.username) {
                    <span class="token-expiry">Channel: {{ data.service?.username }}</span>
                  }
                  <button mat-stroked-button type="button" (click)="startYouTubeOAuth()">Reconnect</button>
                </div>
              } @else if (youtubeOAuthStep() === 'idle') {
                <p class="oauth-hint">Connect your YouTube account to enable event capture (chat, Super Chats, memberships). Client ID and Secret must be saved first.</p>
                <button mat-raised-button color="primary" type="button" (click)="startYouTubeOAuth()">Connect YouTube Account</button>
              }
              @if (youtubeOAuthStep() === 'waiting') {
                <div class="dcf-waiting"><mat-spinner diameter="16" /><span>Authorize in browser, then return here…</span></div>
              }
              @if (youtubeOAuthStep() === 'complete') {
                <p class="oauth-success"><mat-icon>check_circle</mat-icon> YouTube account connected!</p>
              }
              @if (youtubeOAuthStep() === 'error' && youtubeOAuthError()) {
                <p class="oauth-error">{{ youtubeOAuthError() }}</p>
                <button mat-stroked-button type="button" (click)="startYouTubeOAuth()">Try Again</button>
              }
            </div>
            <div class="form-section-label">Stream Settings</div>
            <p class="oauth-hint">
              RTMP URL: <code>rtmp://a.rtmp.youtube.com/live2</code> (pre-filled).<br>
              Get your static stream key from <strong>YouTube Studio → Go Live → Stream</strong>.
            </p>
          }

          <!-- ── Joystick.tv OAuth ── -->
          @if (isEdit() && data.service?.platform === 'joystick') {
            <div class="form-section-label">Joystick.tv Account</div>
            <div class="oauth-section">
              @if (data.service?.oauth_connected && joystickOAuthStep() === 'idle') {
                <div class="oauth-connected">
                  <span class="oauth-connected-status"><mat-icon>check_circle</mat-icon> Connected</span>
                  @if (data.service?.api_token_expires_at) {
                    <span class="token-expiry">Valid until {{ data.service?.api_token_expires_at | date:'mediumDate' }}</span>
                  }
                  <button mat-stroked-button type="button" (click)="startJoystickOAuth()">Reconnect</button>
                </div>
              } @else if (joystickOAuthStep() === 'idle') {
                <p class="oauth-hint">Connect your Joystick.tv account to enable chat event capture. Client ID and Secret must be saved first.</p>
                <button mat-raised-button color="primary" type="button" (click)="startJoystickOAuth()">Connect Joystick.tv Account</button>
              }
              @if (joystickOAuthStep() === 'waiting') {
                <div class="dcf-waiting"><mat-spinner diameter="16" /><span>Authorize in browser, then return here…</span></div>
              }
              @if (joystickOAuthStep() === 'complete') {
                <p class="oauth-success"><mat-icon>check_circle</mat-icon> Joystick.tv connected!</p>
              }
              @if (joystickOAuthStep() === 'error' && joystickOAuthError()) {
                <p class="oauth-error">{{ joystickOAuthError() }}</p>
                <button mat-stroked-button type="button" (click)="startJoystickOAuth()">Try Again</button>
              }
            </div>
            <div class="form-section-label">Stream Settings</div>
            <p class="oauth-hint">RTMP URL is unique per account — copy from <strong>Joystick.tv Dashboard → Stream Settings</strong> (AWS IVS URL).</p>
          }

          <!-- ── TikTok ── -->
          @if (isEdit() && data.service?.platform === 'tiktok') {
            <div class="form-section-label">TikTok LIVE Access</div>
            <div class="oauth-section">
              <p class="oauth-hint">
                RTMP streaming requires joining the TikTok LIVE Creator Network.
                <a class="hint-link" href="#" (click)="openTikTokCreatorNetworkInfo($event)">How to get access ↗</a>
              </p>
              <mat-slide-toggle
                [checked]="tiktokAccessConfirmed()"
                (change)="tiktokAccessConfirmed.set($event.checked)">
                I have TikTok LIVE OBS access
              </mat-slide-toggle>

              @if (tiktokAccessConfirmed() || data.service?.stream_key_configured) {
                <div class="form-section-label" style="margin-top:18px">Session Stream Key</div>
                <div class="tiktok-key-banner">
                  <mat-icon>timer</mat-icon>
                  <span><strong>Keys expire each session.</strong> Get a fresh key from TikTok Live Center before every stream.</span>
                </div>
                <div class="tiktok-key-row">
                  <mat-form-field appearance="outline" style="flex:1;margin:0">
                    <mat-label>Stream Key</mat-label>
                    <input matInput type="password" autocomplete="new-password"
                           [value]="tiktokStreamKeyValue()"
                           (input)="tiktokStreamKeyValue.set($any($event.target).value)"
                           placeholder="Paste from TikTok Live Center" />
                  </mat-form-field>
                  <button mat-raised-button color="primary" type="button"
                          style="margin-top:4px;flex-shrink:0"
                          [disabled]="tiktokStreamKeySaving() || !tiktokStreamKeyValue().trim()"
                          (click)="saveTikTokStreamKey()">
                    {{ tiktokStreamKeySaving() ? 'Saving…' : 'Save Key' }}
                  </button>
                </div>
                @if (tiktokKeyLastUpdated()) {
                  <p class="key-updated-at">Last updated: {{ tiktokKeyLastUpdated() | date:'medium' }}</p>
                } @else {
                  <p class="key-updated-at">Last updated: never</p>
                }
                <button mat-stroked-button type="button" style="margin-top:10px" (click)="openTikTokLiveCenter()">
                  Open TikTok Live Center ↗
                </button>
              }
            </div>
          }

          <!-- ── X (Twitter) ── -->
          @if (isEdit() && data.service?.platform === 'x') {
            <div class="form-section-label">X Stream Setup</div>
            <div class="oauth-section">
              <div class="x-warning">
                <strong>⚠ Requires X Premium or Premium+.</strong> Live event capture is not available for X.
              </div>
              <p class="oauth-hint">X generates a unique RTMP URL and stream key per source in X Media Studio. Copy both from there into the fields above.</p>
              <ol style="margin:0 0 12px;padding-left:20px;font-size:13px;color:var(--text-2);line-height:2">
                <li>Open <strong style="color:var(--text-1)">X Media Studio</strong> (studio.twitter.com)</li>
                <li>Go to <strong style="color:var(--text-1)">Sources → Create Source → RTMP</strong></li>
                <li>Choose your region and copy the RTMP URL and Stream Key</li>
              </ol>
              <button mat-stroked-button type="button" (click)="openXMediaStudio()">Open X Media Studio ↗</button>
            </div>
          }

        </form>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary"
              [disabled]="saving() || form.invalid || (!isEdit() && !form.controls.platform.value)"
              (click)="submit()">
        @if (saving()) { Saving… }
        @else if (isEdit()) { Save Changes }
        @else { Add Platform }
      </button>
    </mat-dialog-actions>
  `,
})
export class PlatformFormDialogComponent {
  readonly data = inject<PlatformFormDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PlatformFormDialogComponent>);
  protected readonly svc = inject(StreamServicesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly http = inject(HttpClient);
  private readonly liveService = inject(OtteryLiveService);

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly showStreamKeyField = signal(false);
  readonly showClientIdField = signal(false);

  readonly oauthStep = signal<'idle' | 'polling' | 'complete' | 'error'>('idle');
  readonly oauthCode = signal<string | null>(null);
  readonly oauthVerifyUrl = signal<string | null>(null);
  readonly oauthError = signal<string | null>(null);

  readonly kickOAuthStep = signal<'idle' | 'waiting' | 'complete' | 'error'>('idle');
  readonly kickOAuthError = signal<string | null>(null);

  readonly joystickOAuthStep = signal<'idle' | 'waiting' | 'complete' | 'error'>('idle');
  readonly joystickOAuthError = signal<string | null>(null);

  readonly youtubeOAuthStep = signal<'idle' | 'waiting' | 'complete' | 'error'>('idle');
  readonly youtubeOAuthError = signal<string | null>(null);

  readonly tiktokAccessConfirmed = signal(false);
  readonly tiktokStreamKeySaving = signal(false);
  readonly tiktokStreamKeyValue = signal('');
  readonly tiktokKeyLastUpdated = computed(() => {
    const meta = this.data.service?.metadata as Record<string, unknown> | null;
    return (meta?.['stream_key_last_updated_at'] as string) ?? null;
  });

  readonly isEdit = computed(() => this.data.service !== null);
  readonly selectedPlatformMeta = computed(() =>
    this.svc.getPlatformMeta(this.form.controls.platform.value ?? '')
  );

  readonly form = new FormGroup({
    platform: new FormControl('', Validators.required),
    display_name: new FormControl('', Validators.required),
    rtmp_url: new FormControl(''),
    username: new FormControl(''),
    stream_key: new FormControl(''),
    api_client_id: new FormControl(''),
    api_client_secret: new FormControl(''),
    target_channel: new FormControl(''),
    restream_enabled: new FormControl(true),
    event_capture_enabled: new FormControl(true),
    auto_start: new FormControl(true),
    active: new FormControl(true),
  });

  constructor() {
    // Ensure platforms are loaded — guard against dialog opening before parent's loadAll finishes
    if (this.svc.platforms().length === 0 && !this.svc.loading()) {
      this.svc.loadAll().catch(() => {});
    }

    if (this.data.service) {
      const s = this.data.service;
      const meta = s.metadata as Record<string, unknown> | null;
      this.form.patchValue({
        platform: s.platform,
        display_name: s.display_name,
        rtmp_url: s.rtmp_url,
        username: s.username ?? '',
        target_channel: (meta?.['target_channel'] as string) ?? '',
        restream_enabled: s.restream_enabled,
        event_capture_enabled: s.event_capture_enabled,
        auto_start: s.auto_start,
        active: s.active,
      });
      this.form.controls.platform.disable();
      if (s.platform === 'tiktok') {
        this.form.controls.rtmp_url.disable();
        if (s.stream_key_configured) this.tiktokAccessConfirmed.set(true);
      }
      if (s.platform === 'youtube') {
        this.form.controls.rtmp_url.disable();
      }
    }
  }

  platformBrandColor(platformId?: string): string {
    const id = platformId ?? (this.isEdit() ? (this.data.service?.platform ?? '') : (this.form.controls.platform.value ?? ''));
    const map: Record<string, string> = {
      twitch: '#9146ff', youtube: '#ff0000', kick: '#53fc18',
      tiktok: '#fe2c55', x: '#c9cdd1', joystick: '#8b5cf6',
    };
    return map[id] ?? 'var(--accent)';
  }

  platformMark(platformId: string): string {
    const map: Record<string, string> = {
      twitch: 'Tw', youtube: 'Yt', kick: 'Ki',
      tiktok: 'Tk', x: 'X', joystick: 'Jo',
    };
    return map[platformId] ?? platformId.slice(0, 2).toUpperCase();
  }

  selectPlatform(platformId: string): void {
    this.form.controls.platform.setValue(platformId);
    this.onPlatformChange(platformId);
  }

  clearPlatform(): void {
    this.form.controls.platform.setValue('');
    this.form.controls.display_name.setValue('');
    this.form.controls.rtmp_url.setValue('');
  }

  platformRequirements(platformId: string): string[] {
    const map: Record<string, string[]> = {
      twitch: [
        'A <strong>stream key</strong> from Twitch Dashboard → Settings → Stream',
        'A <strong>Twitch Developer App</strong> (dev.twitch.tv) with Client ID — required for event capture (follows, subs, chat)',
        'Connect your Twitch account via OAuth after saving to enable event capture',
      ],
      youtube: [
        'A <strong>static stream key</strong> from YouTube Studio → Go Live → Stream',
        'A <strong>Google Cloud Project</strong> with YouTube Data API v3 enabled — required for event capture',
        'An <strong>OAuth 2.0 Desktop App client</strong> from GCP Console (Client ID + Secret)',
        'Note: YouTube API quota is 10,000 units/day — use your own GCP project',
      ],
      kick: [
        'A <strong>Kick Developer App</strong> (dev.kick.com) with Client ID — instant self-service',
        'Your Kick <strong>username</strong> — needed for event capture channel lookup',
        'Connect your Kick account via OAuth after saving — this also auto-fetches your stream key',
      ],
      tiktok: [
        'Access to <strong>TikTok LIVE OBS streaming</strong> via the TikTok Creator Network',
        'A <strong>session stream key</strong> from TikTok Live Center — keys expire, get a fresh one before each stream',
        'An <strong>EulerStream API key</strong> (configured in Settings) for event capture',
        'Note: TikTok RTMP access is gated — you must apply through an agency network',
      ],
      x: [
        '<strong>X Premium or Premium+</strong> subscription — required for live streaming',
        'An RTMP URL and stream key from <strong>X Media Studio → Sources → Create Source → RTMP</strong>',
        'Note: These values are dynamic per-source — copy them each time you create a new source',
        'Event capture is <strong>not available</strong> for X (no public live events API)',
      ],
      joystick: [
        'Your <strong>RTMP URL</strong> from Joystick.tv Dashboard → Stream Settings (AWS IVS URL)',
        'A <strong>stream key</strong> from the same Stream Settings page',
        'A <strong>Joystick.tv Developer App</strong> (Client ID + Secret) — request from Joystick.tv support',
        'Connect your Joystick.tv account via OAuth after saving to enable chat event capture',
      ],
    };
    return map[platformId] ?? ['Enter your stream key to get started.'];
  }

  onPlatformChange(platformId: string): void {
    const meta = this.svc.getPlatformMeta(platformId);
    if (!meta) return;
    this.form.controls.rtmp_url.setValue(meta.rtmp_url ?? '');
    if (!this.form.controls.display_name.value) {
      this.form.controls.display_name.setValue(meta.display_name);
    }
    if (platformId === 'tiktok' || platformId === 'youtube') {
      this.form.controls.rtmp_url.disable();
    } else {
      this.form.controls.rtmp_url.enable();
    }
  }

  async startTwitchOAuth(): Promise<void> {
    this.oauthStep.set('polling');
    this.oauthCode.set(null);
    this.oauthError.set(null);
    const serviceId = this.data.service!.id;

    try {
      const result = await firstValueFrom(
        this.http.post<{
          mechanism: string;
          user_code: string;
          verification_uri: string;
          expires_in: number;
        }>(`/api/stream-services/${serviceId}/oauth/start`, {})
      );

      this.oauthCode.set(result.user_code);
      this.oauthVerifyUrl.set(result.verification_uri);

      const electronApi = (window as Window & { otteryElectron?: { openExternal?: (url: string) => void } }).otteryElectron;
      electronApi?.openExternal?.(result.verification_uri);

      const onOAuthEvent = (msg: { event: string; serviceId: number; reason?: string }) => {
        if (msg.serviceId !== serviceId) return;
        this.liveService.socket.off('ottery:oauth', onOAuthEvent);
        if (msg.event === 'oauth.complete') {
          this.oauthStep.set('complete');
          this.snackBar.open('Twitch account connected!', 'OK', { duration: 4000 });
        } else if (msg.event === 'oauth.failed') {
          this.oauthStep.set('error');
          this.oauthError.set(msg.reason ?? 'Authorization failed');
        }
      };
      this.liveService.socket.on('ottery:oauth', onOAuthEvent);

      this.dialogRef.afterClosed().subscribe(() => {
        this.liveService.socket.off('ottery:oauth', onOAuthEvent);
      });
    } catch (err: unknown) {
      this.oauthStep.set('error');
      const msg = err instanceof Error ? err.message : 'Failed to start OAuth flow';
      this.oauthError.set(msg);
    }
  }

  async startKickOAuth(): Promise<void> {
    this.kickOAuthStep.set('waiting');
    this.kickOAuthError.set(null);
    const serviceId = this.data.service!.id;

    try {
      const result = await firstValueFrom(
        this.http.post<{ mechanism: string; auth_url: string; state: string }>(
          `/api/stream-services/${serviceId}/oauth/kick/start`, {}
        )
      );

      const electronApi = (window as Window & { otteryElectron?: { openExternal?: (url: string) => void } }).otteryElectron;
      electronApi?.openExternal?.(result.auth_url);

      const onOAuthEvent = (msg: { event: string; serviceId: number; reason?: string }) => {
        if (msg.serviceId !== serviceId) return;
        this.liveService.socket.off('ottery:oauth', onOAuthEvent);
        if (msg.event === 'oauth.complete') {
          this.kickOAuthStep.set('complete');
          this.snackBar.open('Kick account connected!', 'OK', { duration: 4000 });
        } else if (msg.event === 'oauth.failed') {
          this.kickOAuthStep.set('error');
          this.kickOAuthError.set(msg.reason ?? 'Authorization failed');
        }
      };
      this.liveService.socket.on('ottery:oauth', onOAuthEvent);

      this.dialogRef.afterClosed().subscribe(() => {
        this.liveService.socket.off('ottery:oauth', onOAuthEvent);
      });
    } catch (err: unknown) {
      this.kickOAuthStep.set('error');
      const msg = err instanceof Error ? err.message : 'Failed to start Kick OAuth';
      this.kickOAuthError.set(msg);
    }
  }

  async startJoystickOAuth(): Promise<void> {
    this.joystickOAuthStep.set('waiting');
    this.joystickOAuthError.set(null);
    const serviceId = this.data.service!.id;

    try {
      const result = await firstValueFrom(
        this.http.post<{ mechanism: string; auth_url: string; state: string }>(
          `/api/stream-services/${serviceId}/oauth/joystick/start`, {}
        )
      );

      const electronApi = (window as Window & { otteryElectron?: { openExternal?: (url: string) => void } }).otteryElectron;
      electronApi?.openExternal?.(result.auth_url);

      const onOAuthEvent = (msg: { event: string; serviceId: number; reason?: string }) => {
        if (msg.serviceId !== serviceId) return;
        this.liveService.socket.off('ottery:oauth', onOAuthEvent);
        if (msg.event === 'oauth.complete') {
          this.joystickOAuthStep.set('complete');
          this.snackBar.open('Joystick.tv account connected!', 'OK', { duration: 4000 });
        } else if (msg.event === 'oauth.failed') {
          this.joystickOAuthStep.set('error');
          this.joystickOAuthError.set(msg.reason ?? 'Authorization failed');
        }
      };
      this.liveService.socket.on('ottery:oauth', onOAuthEvent);

      this.dialogRef.afterClosed().subscribe(() => {
        this.liveService.socket.off('ottery:oauth', onOAuthEvent);
      });
    } catch (err: unknown) {
      this.joystickOAuthStep.set('error');
      const msg = err instanceof Error ? err.message : 'Failed to start Joystick.tv OAuth';
      this.joystickOAuthError.set(msg);
    }
  }

  async startYouTubeOAuth(): Promise<void> {
    this.youtubeOAuthStep.set('waiting');
    this.youtubeOAuthError.set(null);
    const serviceId = this.data.service!.id;

    try {
      const result = await firstValueFrom(
        this.http.post<{ mechanism: string; auth_url: string; state: string }>(
          `/api/stream-services/${serviceId}/oauth/youtube/start`, {}
        )
      );

      const electronApi = (window as Window & { otteryElectron?: { openExternal?: (url: string) => void } }).otteryElectron;
      electronApi?.openExternal?.(result.auth_url);

      const onOAuthEvent = (msg: { event: string; serviceId: number; reason?: string }) => {
        if (msg.serviceId !== serviceId) return;
        this.liveService.socket.off('ottery:oauth', onOAuthEvent);
        if (msg.event === 'oauth.complete') {
          this.youtubeOAuthStep.set('complete');
          this.snackBar.open('YouTube account connected!', 'OK', { duration: 4000 });
        } else if (msg.event === 'oauth.failed') {
          this.youtubeOAuthStep.set('error');
          this.youtubeOAuthError.set(msg.reason ?? 'Authorization failed');
        }
      };
      this.liveService.socket.on('ottery:oauth', onOAuthEvent);

      this.dialogRef.afterClosed().subscribe(() => {
        this.liveService.socket.off('ottery:oauth', onOAuthEvent);
      });
    } catch (err: unknown) {
      this.youtubeOAuthStep.set('error');
      const msg = err instanceof Error ? err.message : 'Failed to start YouTube OAuth';
      this.youtubeOAuthError.set(msg);
    }
  }

  openYouTubeGcpGuide(): void {
    const w = window as Window & { otteryElectron?: { openExternal?: (url: string) => void } };
    w.otteryElectron?.openExternal?.('https://console.cloud.google.com/');
  }

  async saveTikTokStreamKey(): Promise<void> {
    const key = this.tiktokStreamKeyValue().trim();
    if (!key) return;
    this.tiktokStreamKeySaving.set(true);
    try {
      await this.svc.update(this.data.service!.id, { stream_key: key });
      this.tiktokStreamKeyValue.set('');
      this.snackBar.open('Stream key saved!', 'OK', { duration: 3000 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save stream key';
      this.snackBar.open(msg, 'Dismiss', { duration: 5000 });
    } finally {
      this.tiktokStreamKeySaving.set(false);
    }
  }

  openTikTokLiveCenter(): void {
    const w = window as Window & { otteryElectron?: { openExternal?: (url: string) => void } };
    w.otteryElectron?.openExternal?.('https://livecenter.tiktok.com/producer');
  }

  openXMediaStudio(): void {
    const w = window as Window & { otteryElectron?: { openExternal?: (url: string) => void } };
    w.otteryElectron?.openExternal?.('https://studio.twitter.com');
  }

  openTikTokCreatorNetworkInfo(event: Event): void {
    event.preventDefault();
    const w = window as Window & { otteryElectron?: { openExternal?: (url: string) => void } };
    w.otteryElectron?.openExternal?.('https://www.toktutorials.com/list-of-agencies');
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.errorMessage.set(null);

    try {
      const v = this.form.getRawValue();

      if (this.isEdit()) {
        const payload: Record<string, unknown> = {
          display_name: v.display_name,
          rtmp_url: v.rtmp_url,
          username: v.username || null,
          restream_enabled: v.restream_enabled,
          event_capture_enabled: v.event_capture_enabled,
          auto_start: v.auto_start,
          active: v.active,
        };
        if (v.stream_key) payload['stream_key'] = v.stream_key;
        if (v.api_client_id) payload['api_client_id'] = v.api_client_id;
        if (v.api_client_secret) payload['api_client_secret'] = v.api_client_secret;
        if (this.data.service?.platform === 'twitch') {
          payload['metadata'] = { target_channel: v.target_channel?.trim() || null };
        }
        await this.svc.update(this.data.service!.id, payload);
      } else {
        const payload: Record<string, unknown> = {
          platform: v.platform,
          display_name: v.display_name!,
          rtmp_url: v.rtmp_url ?? '',
          username: v.username || undefined,
          restream_enabled: v.restream_enabled ?? true,
          event_capture_enabled: v.event_capture_enabled ?? true,
          auto_start: v.auto_start ?? true,
        };
        if (v.stream_key) payload['stream_key'] = v.stream_key;
        if (v.api_client_id) payload['api_client_id'] = v.api_client_id;
        if (v.api_client_secret) payload['api_client_secret'] = v.api_client_secret;
        await this.svc.create(payload as never);
      }

      this.dialogRef.close('saved');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save platform';
      this.errorMessage.set(msg);
      this.saving.set(false);
    }
  }
}
