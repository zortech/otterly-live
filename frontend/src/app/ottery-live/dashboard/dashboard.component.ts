import { Component, inject, signal, computed, effect, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { OtteryLiveService, PlatformStatus, OtteryEvent } from '../ottery-live.service';
import { StreamServicesService } from '../stream-services.service';
import { SettingsService } from '../settings/settings.service';
import { StopAllConfirmDialogComponent } from './stop-all-confirm-dialog.component';
import { TikTokKeyReminderDialogComponent } from './tiktok-key-reminder-dialog.component';
import { Router } from '@angular/router';
import { StreamService } from '../stream-services.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [ScrollingModule, MatIconModule, MatButtonModule, MatDialogModule, DatePipe, DecimalPipe, TitleCasePipe, RouterLink],
  styles: [`
    .page-header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;
    }
    .page-title { font-size: 22px; font-weight: 700; color: var(--text-1); letter-spacing: -0.5px; }

    /* ── Status bar ───────────────────────────────────────────── */
    .status-bar {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 20px; border-radius: 12px; margin-bottom: 20px;
      border: 1px solid var(--border); font-size: 14px; transition: all 0.3s ease;
    }
    .status-bar.idle  { background: var(--bg-card); color: var(--text-2); }
    .status-bar.live  { background: rgba(0,230,118,0.05); border-color: rgba(0,230,118,0.2); }
    .status-bar.ended { background: var(--bg-card); color: var(--text-2); }

    .status-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.idle  { background: var(--text-3); }
    .status-dot.ended { background: var(--text-3); }
    .status-dot.live  {
      background: var(--live);
      animation: live-pulse 2s ease-in-out infinite;
    }
    @keyframes live-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(0,230,118,0.5); }
      50%       { box-shadow: 0 0 0 6px rgba(0,230,118,0); }
    }

    .status-label { font-weight: 700; font-size: 14px; color: var(--text-1); }
    .status-label.live { color: var(--live); }
    .sep { color: var(--text-3); }
    .duration {
      font-family: 'JetBrains Mono', monospace; font-size: 13px;
      color: var(--live); font-variant-numeric: tabular-nums;
    }
    .rtmp-hint {
      font-family: 'JetBrains Mono', monospace; font-size: 11px;
      color: var(--text-2); background: var(--bg-raised);
      padding: 3px 8px; border-radius: 4px;
      border: 1px solid var(--border);
    }
    .spacer { flex: 1; }
    .status-actions { display: flex; gap: 8px; }

    .btn-live-action {
      padding: 6px 16px; border-radius: 6px; font-size: 13px; font-weight: 600;
      cursor: pointer; font-family: inherit; border: none; transition: all 0.15s;
    }
    .btn-start {
      background: var(--accent); color: #000;
    }
    .btn-start:hover:not(:disabled) { opacity: 0.88; }
    .btn-start:disabled { opacity: 0.4; cursor: default; }
    .btn-stop {
      background: rgba(255,51,85,0.12); color: var(--live-red);
      border: 1px solid rgba(255,51,85,0.25);
    }
    .btn-stop:hover:not(:disabled) { background: rgba(255,51,85,0.2); }
    .btn-stop:disabled { opacity: 0.4; cursor: default; }

    /* ── Auth banners ─────────────────────────────────────────── */
    .auth-banner {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; margin-bottom: 8px; border-radius: 8px;
      background: rgba(255,71,87,0.07); border: 1px solid rgba(255,71,87,0.2);
      color: var(--text-1); font-size: 13px;
    }
    .auth-banner span { flex: 1; }
    .auth-banner mat-icon { color: var(--error-color); font-size: 18px; width: 18px; height: 18px; }

    /* ── Two-column main grid ─────────────────────────────────── */
    .main-grid {
      display: grid;
      grid-template-columns: minmax(260px, 340px) 1fr;
      gap: 20px; align-items: start;
    }

    /* ── Platform cards ───────────────────────────────────────── */
    .section-label {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 1px; color: var(--text-3); margin-bottom: 10px;
    }
    .platform-cards { display: flex; flex-direction: column; gap: 7px; margin-bottom: 20px; }
    .platform-card {
      background: var(--bg-card); border: 1px solid var(--border);
      border-left: 3px solid var(--brand, var(--text-3));
      border-radius: 10px; padding: 11px 14px;
      display: flex; align-items: center; gap: 12px;
      transition: border-color 0.2s, background 0.2s;
    }
    .platform-card.live {
      background: rgba(0,230,118,0.04); border-color: rgba(0,230,118,0.15);
      border-left-color: var(--live);
    }
    .platform-card.error {
      background: rgba(255,71,87,0.04); border-color: rgba(255,71,87,0.15);
      border-left-color: var(--error-color);
    }
    .pc-info { flex: 1; min-width: 0; }
    .pc-name { font-weight: 600; font-size: 13px; color: var(--text-1); }
    .pc-status { font-size: 11px; color: var(--text-2); margin-top: 2px; }
    .pc-status.live       { color: var(--live); }
    .pc-status.error      { color: var(--error-color); }
    .pc-status.connecting { color: var(--warn-color); }
    .pc-capture { font-size: 10px; color: var(--text-3); margin-top: 1px; }
    .pc-capture.live       { color: var(--text-2); }
    .pc-capture.error      { color: var(--error-color); }
    .pc-capture.connecting { color: var(--warn-color); }

    .pc-metrics {
      display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;
    }
    .pc-metric {
      font-size: 10px; font-weight: 500; padding: 2px 6px; border-radius: 4px;
      background: rgba(255,255,255,0.04); color: var(--text-2);
      letter-spacing: 0.2px;
    }
    .pc-metric.uptime { color: var(--text-2); }
    .pc-metric.drops { color: var(--text-2); }
    .pc-metric.drops.active {
      background: rgba(255,71,87,0.12); color: var(--error-color);
    }
    .pc-metric.warn-chip {
      background: rgba(255,193,7,0.10); color: var(--warn-color, #ffb300);
      border: none; cursor: pointer; font-family: inherit;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .pc-metric.warn-chip:hover { background: rgba(255,193,7,0.18); }
    .warn-chevron { font-size: 9px; opacity: 0.7; }

    .pc-warning-log {
      margin-top: 6px; padding: 6px 8px;
      background: rgba(0,0,0,0.15); border-radius: 5px;
      max-height: 140px; overflow-y: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px; line-height: 1.4;
    }
    .pc-warning-row { display: flex; gap: 8px; padding: 1px 0; }
    .pc-warning-time { color: var(--text-3); flex-shrink: 0; }
    .pc-warning-msg { color: var(--text-2); word-break: break-word; }

    .pc-toggle {
      padding: 4px 12px; border-radius: 5px; font-size: 12px; font-weight: 600;
      cursor: pointer; font-family: inherit; transition: all 0.12s; border: none;
    }
    .pc-toggle.start  { background: var(--accent-dim); color: var(--accent); border: 1px solid var(--accent-border); }
    .pc-toggle.stop   { background: rgba(255,51,85,0.1); color: var(--live-red); border: 1px solid rgba(255,51,85,0.2); }
    .pc-toggle:disabled { opacity: 0.4; cursor: default; }

    /* ── Session stats ─────────────────────────────────────────── */
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat-tile {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;
    }
    .stat-value {
      font-size: 22px; font-weight: 700; color: var(--text-1);
      font-family: 'JetBrains Mono', monospace; line-height: 1;
    }
    .stat-label { font-size: 11px; color: var(--text-2); margin-top: 3px; }

    /* ── Event feed ────────────────────────────────────────────── */
    .event-feed {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      padding: 16px; display: flex; flex-direction: column; height: 560px;
    }
    .feed-top {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;
    }
    .filter-bar { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
    .filter-chip {
      padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 500;
      cursor: pointer; border: 1px solid var(--border); background: transparent;
      color: var(--text-2); font-family: inherit; transition: all 0.12s;
    }
    .filter-chip:hover { background: var(--bg-hover); color: var(--text-1); }
    .filter-chip.active {
      background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent);
    }

    .event-scroll { flex: 1; overflow-y: auto; font-size: 12px; }
    .event-row {
      display: grid; grid-template-columns: 54px 68px 100px 1fr;
      gap: 8px; padding: 5px 2px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      align-items: center;
    }
    .event-row:last-child { border-bottom: none; }
    .event-time {
      font-family: 'JetBrains Mono', monospace; color: var(--text-3); font-size: 11px;
    }
    .event-platform {
      font-weight: 600; font-size: 11px; text-transform: capitalize;
    }
    .event-actor {
      color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .event-data {
      color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .event-data img.chat-emote {
      height: 1.2em; vertical-align: middle; display: inline; margin: 0 1px;
    }
    .no-events {
      color: var(--text-2); font-style: italic; text-align: center;
      padding: 40px 0; font-size: 13px;
    }
    .scroll-top-btn {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600;
      cursor: pointer; border: 1px solid var(--accent-border);
      background: var(--accent-dim); color: var(--accent); font-family: inherit;
      transition: opacity 0.12s;
    }
    .scroll-top-btn:hover { opacity: 0.8; }

    /* ── Idle / empty state ────────────────────────────────────── */
    .idle-panel {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 32px;
    }
    .idle-title { font-size: 18px; font-weight: 700; color: var(--text-1); margin-bottom: 6px; }
    .idle-sub { color: var(--text-2); font-size: 14px; margin-bottom: 24px; }

    .obs-callout {
      background: var(--bg-raised); border: 1px solid var(--border-2); border-radius: 10px;
      padding: 18px 20px; margin-bottom: 16px;
    }
    .obs-callout-title {
      font-size: 13px; font-weight: 600; color: var(--accent);
      display: flex; align-items: center; gap: 6px; margin-bottom: 14px;
    }
    .obs-callout-title mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .obs-step { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 9px; font-size: 13px; color: var(--text-2); }
    .step-num {
      width: 20px; height: 20px; border-radius: 50%;
      background: var(--accent-dim); border: 1px solid var(--accent-border);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--accent);
    }
    .obs-step strong { color: var(--text-1); }
    code {
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 4px; padding: 1px 6px; color: var(--accent);
    }

    .no-platforms-hint {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px; border-radius: 8px;
      background: rgba(0,201,167,0.06); border: 1px solid var(--accent-border);
      color: var(--text-2); font-size: 13px;
    }
    .no-platforms-hint mat-icon { color: var(--accent); font-size: 18px; width: 18px; height: 18px; }

    /* ── Relay failure banner (persistent, unmissable) ─────────── */
    .relay-failure-banner {
      display: flex; align-items: center; gap: 14px;
      padding: 16px 20px; border-radius: 12px; margin-bottom: 20px;
      background: rgba(255,59,48,0.10);
      border: 1px solid rgba(255,59,48,0.55);
      box-shadow: 0 0 0 1px rgba(255,59,48,0.15);
      animation: relay-fail-pulse 1.6s ease-in-out infinite;
    }
    @keyframes relay-fail-pulse {
      0%, 100% { border-color: rgba(255,59,48,0.55); }
      50%      { border-color: rgba(255,59,48,0.95); }
    }
    .relay-failure-banner > mat-icon {
      color: #ff3b30; flex-shrink: 0;
      font-size: 28px; width: 28px; height: 28px;
    }
    .relay-failure-text { flex: 1; }
    .relay-failure-title {
      font-weight: 800; font-size: 14px; letter-spacing: 0.4px;
      color: #ff6b61; margin-bottom: 3px;
    }
    .relay-failure-sub { font-size: 12.5px; color: var(--text-2); line-height: 1.45; }
    .relay-failure-reason {
      display: block; margin-top: 4px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-3);
    }
    .relay-failure-dismiss {
      flex-shrink: 0; background: transparent; border: none; cursor: pointer;
      color: var(--text-3); padding: 4px; border-radius: 6px; line-height: 0;
    }
    .relay-failure-dismiss:hover { color: var(--text-1); background: rgba(255,255,255,0.06); }
    .relay-failure-dismiss mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .relay-badge {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; padding: 1px 5px; margin-left: 6px;
      border-radius: 3px;
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
      color: var(--accent);
    }
  `],
  template: `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
    </div>

    <!-- Persistent relay-failure banner: remote mode never falls back to a
         direct push, so a failed relay means NOTHING is going out. -->
    @if (relayFailure(); as reason) {
      <div class="relay-failure-banner" role="alert">
        <mat-icon>error</mat-icon>
        <div class="relay-failure-text">
          <div class="relay-failure-title">RELAY DOWN — YOU ARE NOT LIVE</div>
          <div class="relay-failure-sub">
            Nothing is being sent to any platform. Remote mode will not fall back to a
            direct push (it would overload your upload). Fix the relay and start again.
            <span class="relay-failure-reason">{{ reason }}</span>
          </div>
        </div>
        <button class="relay-failure-dismiss" (click)="relayFailure.set(null)" aria-label="Dismiss">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }

    <!-- Session status bar -->
    <div class="status-bar" [class]="service.sessionState() ?? 'idle'">
      <div class="status-dot" [class]="service.sessionState() ?? 'idle'"></div>

      @switch (service.sessionState()) {
        @case ('idle') {
          <span class="status-label">Waiting for OBS</span>
          @if (rtmpPort()) {
            <span class="sep">·</span>
            <span class="rtmp-hint">rtmp://localhost:{{ rtmpPort() }}/live</span>
          }
        }
        @case ('live') {
          <span class="status-label live">LIVE</span>
          <span class="sep">·</span>
          <span class="duration">{{ duration() }}</span>
          @if (rtmpPort()) {
            <span class="sep">·</span>
            <span class="rtmp-hint">rtmp://localhost:{{ rtmpPort() }}/live</span>
          }
          <span class="spacer"></span>
          <div class="status-actions">
            <button class="btn-live-action btn-start"
                    [disabled]="startingAll()"
                    (click)="startAll()">
              {{ startingAll() ? 'Starting...' : 'Start All' }}
            </button>
            <button class="btn-live-action btn-stop"
                    [disabled]="stoppingAll()"
                    (click)="stopAll()">
              {{ stoppingAll() ? 'Stopping...' : 'Stop All' }}
            </button>
          </div>
        }
        @case ('ended') {
          <mat-icon style="font-size:18px;width:18px;height:18px;color:var(--text-3)">stop_circle</mat-icon>
          <span class="status-label">Stream ended</span>
          @if (service.activeSessionId()) {
            <span class="sep">·</span>
            <span style="color:var(--text-2)">Session #{{ service.activeSessionId() }}</span>
          }
          <span class="sep">·</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-2)">{{ duration() }}</span>
        }
      }
    </div>

    <!-- Auth-required banners -->
    @for (item of authRequiredList(); track item.serviceId) {
      <div class="auth-banner">
        <mat-icon>warning</mat-icon>
        <span>{{ item.platform | titlecase }}: {{ item.message || 'Re-authentication required.' }}</span>
        <button mat-button style="color:var(--error-color)" (click)="reconnect(item.serviceId)">Reconnect</button>
        <button mat-icon-button (click)="service.clearAuthRequired(item.serviceId)">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }

    @if (platformCards().length > 0) {
      <div class="main-grid">
        <!-- Left column: platform cards + session stats -->
        <div>
          <div class="section-label">Platforms</div>
          <div class="platform-cards">
            @for (card of platformCards(); track card.service.id) {
              <div class="platform-card"
                [class.live]="card.isLive"
                [class.error]="card.isError"
                [style.--brand]="platformColor(card.service.platform)">
                <div class="pc-info">
                  <div class="pc-name">
                    {{ card.service.display_name }}
                    @if (card.captureOnly) {
                      <span style="font-size:10px;font-weight:500;color:var(--text-2);margin-left:6px;text-transform:uppercase;letter-spacing:.5px">Capture only</span>
                    }
                    @if (card.isRelayMode && card.isLive) {
                      <span class="relay-badge">via relay</span>
                    }
                  </div>
                  <div class="pc-status" [class]="card.status?.status ?? ''">{{ card.statusLabel }}</div>
                  @if (card.showCaptureChip) {
                    <div class="pc-capture" [class]="card.captureState"
                      title="Event capture (chat, alerts) — independent of the restream above">{{ card.captureStatusLabel }}</div>
                  }
                  @if (card.isLive && (card.uptimeLabel || card.showDrops || card.warningCount > 0)) {
                    <div class="pc-metrics">
                      @if (card.uptimeLabel) {
                        <span class="pc-metric uptime" title="Time since this fan-out started">↑ {{ card.uptimeLabel }}</span>
                      }
                      @if (card.showDrops) {
                        <span class="pc-metric drops"
                          [class.active]="card.dropRate > 0"
                          title="Cumulative dropped frames on the relay→platform leg">
                          ↓ {{ card.dropped | number }} dropped@if (card.dropRate > 0) { ({{ formatDropRate(card.dropRate) }}/s) }
                        </span>
                      }
                      @if (card.warningCount > 0) {
                        <button class="pc-metric warn-chip"
                          (click)="toggleWarningLog(card.service.id)"
                          [title]="card.latestWarning?.message ?? ''">
                          ⚠ {{ card.warningCount }} {{ card.warningCount === 1 ? 'warning' : 'warnings' }}
                          <span class="warn-chevron">{{ isWarningExpanded(card.service.id) ? '▾' : '▸' }}</span>
                        </button>
                      }
                    </div>
                  }
                  @if (card.warningCount > 0 && isWarningExpanded(card.service.id)) {
                    <div class="pc-warning-log">
                      @for (w of card.warnings; track w.at) {
                        <div class="pc-warning-row">
                          <span class="pc-warning-time">{{ w.at | date:'HH:mm:ss' }}</span>
                          <span class="pc-warning-msg">{{ w.message }}</span>
                        </div>
                      }
                    </div>
                  }
                </div>
                @if (card.captureOnly) {
                  <button class="pc-toggle"
                    [class.start]="!card.isLive"
                    [class.stop]="card.isLive"
                    [disabled]="toggling()[card.service.id]"
                    (click)="toggleCapture(card.service.id, card.isLive)">
                    {{ toggling()[card.service.id] ? '…' : (card.isLive ? 'Stop' : 'Connect') }}
                  </button>
                } @else if (service.sessionState() === 'live') {
                  <button class="pc-toggle"
                    [class.start]="!card.isLive"
                    [class.stop]="card.isLive"
                    [disabled]="toggling()[card.service.id]"
                    (click)="toggle(card.service.id, card.isLive)">
                    {{ toggling()[card.service.id] ? '…' : (card.isLive ? 'Stop' : 'Start') }}
                  </button>
                }
              </div>
            }
          </div>

          @if (service.sessionState() !== 'idle') {
            <div class="section-label">Session Stats</div>
            <div class="stats-grid">
              <div class="stat-tile">
                <div class="stat-value">{{ sessionStats().follows }}</div>
                <div class="stat-label">Follows</div>
              </div>
              <div class="stat-tile">
                <div class="stat-value">{{ sessionStats().subs }}</div>
                <div class="stat-label">Subscriptions</div>
              </div>
              <div class="stat-tile">
                <div class="stat-value">{{ sessionStats().giftSubs }}</div>
                <div class="stat-label">Gift Subs</div>
              </div>
              <div class="stat-tile">
                <div class="stat-value">{{ sessionStats().cheers }}</div>
                <div class="stat-label">Bits / Cheers</div>
              </div>
              <div class="stat-tile">
                <div class="stat-value">{{ sessionStats().raids }}</div>
                <div class="stat-label">Raids</div>
              </div>
              <div class="stat-tile">
                <div class="stat-value">{{ sessionStats().tips | number:'1.2-2' }}</div>
                <div class="stat-label">Tips</div>
              </div>
              <div class="stat-tile" style="grid-column: span 2">
                <div class="stat-value">{{ sessionStats().chatMessages | number }}</div>
                <div class="stat-label">Chat Messages</div>
              </div>

              @if (service.sessionState() === 'live') {
                <div class="stat-tile" style="grid-column: span 2">
                  <div style="display:flex;align-items:baseline;gap:6px">
                    <div class="stat-value">{{ totalViewers() | number }}</div>
                    @if (viewerEntries().length > 1) {
                      <span style="font-size:11px;color:var(--text-3)">total</span>
                    }
                  </div>
                  <div class="stat-label">Live Viewers</div>
                  @if (viewerEntries().length > 1) {
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                      @for (entry of viewerEntries(); track entry[0]) {
                        <span style="font-size:11px;color:var(--text-2)">
                          <span [style.color]="platformColor(entry[0])">{{ entry[0] }}</span>
                          {{ entry[1] | number }}
                        </span>
                      }
                    </div>
                  }
                </div>
              }

              <div class="stat-tile" style="grid-column: span 2">
                <div class="stat-value">{{ sessionStats().peakViewers | number }}</div>
                <div class="stat-label">Peak Viewers</div>
              </div>
            </div>
          }
        </div>

        <!-- Right column: event feed -->
        <div class="event-feed">
          <div class="feed-top">
            <span class="section-label" style="margin:0">Live Events</span>
            <div style="display:flex;align-items:center;gap:8px">
              @if (!autoScroll() && filteredEvents().length > 0) {
                <button class="scroll-top-btn" (click)="scrollToTop()">
                  <mat-icon style="font-size:14px;width:14px;height:14px;vertical-align:middle">arrow_upward</mat-icon>
                  Live
                </button>
              }
              <a mat-button routerLink="/ottery-live/events"
                 style="font-size:12px;color:var(--text-2)">View History →</a>
            </div>
          </div>
          <div class="filter-bar">
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
          </div>
          @if (filteredEvents().length === 0) {
            <p class="no-events">
              {{ service.sessionState() === 'idle' ? 'Waiting for stream to start…' : 'No events yet.' }}
            </p>
          } @else {
            <cdk-virtual-scroll-viewport itemSize="26" class="event-scroll"
              (scrolledIndexChange)="onScrolledIndexChange($event)">
              <div *cdkVirtualFor="let event of filteredEvents(); trackBy: trackEvent" class="event-row">
                <span class="event-time">{{ event.timestamp | date:'HH:mm:ss' }}</span>
                <span class="event-platform" [style.color]="platformColor(event.platform)">{{ event.platform }}</span>
                <span class="event-actor">{{ event.actor?.displayName ?? event.actor?.username ?? '' }}</span>
                @if (event.type === 'chat.message') {
                  <span class="event-data" [innerHTML]="chatHtml(event)"></span>
                } @else {
                  <span class="event-data">{{ eventSummary(event) }}</span>
                }
              </div>
            </cdk-virtual-scroll-viewport>
          }
        </div>
      </div>

    } @else {
      <!-- Idle / no platforms state -->
      <div class="idle-panel">
        @if (service.sessionState() === 'ended') {
          <div class="idle-title">Stream ended</div>
          <div class="idle-sub">Start OBS again to begin a new session.</div>
        } @else {
          <div class="idle-title">Ready to stream</div>
          <div class="idle-sub">Point OBS at the RTMP server below, then hit Go Live.</div>

          <div class="obs-callout">
            <div class="obs-callout-title">
              <mat-icon>cast_connected</mat-icon>
              How to connect OBS
            </div>
            <div class="obs-step">
              <div class="step-num">1</div>
              <span>In OBS: <strong>Settings → Stream</strong> → set Service to <strong>Custom</strong></span>
            </div>
            <div class="obs-step">
              <div class="step-num">2</div>
              <span>
                Server: <code>rtmp://localhost:{{ rtmpPort() ?? 1935 }}/live</code>
              </span>
            </div>
            <div class="obs-step">
              <div class="step-num">3</div>
              <span>
                Stream Key: <code>ottery</code>
                (or whatever you set in Settings → OBS Connection)
              </span>
            </div>
            <div class="obs-step">
              <div class="step-num">4</div>
              <span>Click <strong>Start Streaming</strong> in OBS — Ottery Live will detect the stream automatically</span>
            </div>
          </div>

          @if (streamSvc.services().length === 0) {
            <div class="no-platforms-hint">
              <mat-icon>info</mat-icon>
              No platforms configured yet. Go to <strong style="color:var(--text-1);margin:0 4px">Platforms</strong>
              to add Twitch, YouTube, Kick and more.
            </div>
          }
        }
      </div>
    }
  `,
})
export class DashboardComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(CdkVirtualScrollViewport) private scrollViewport?: CdkVirtualScrollViewport;

  protected readonly service = inject(OtteryLiveService);
  private readonly http = inject(HttpClient);
  protected readonly streamSvc = inject(StreamServicesService);
  protected readonly settingsSvc = inject(SettingsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroy$ = new Subject<void>();

  readonly rtmpPort = signal<number | null>(null);
  readonly autoScroll = signal(true);
  readonly duration = signal('0s');
  readonly toggling = signal<Record<number, boolean>>({});
  readonly platformFilter = signal<string>('all');
  readonly startingAll = signal(false);
  readonly stoppingAll = signal(false);
  /** Set when the relay errors; drives the persistent failure banner. Cleared on relay reconnect. */
  readonly relayFailure = signal<string | null>(null);

  private sessionStartTime: number | null = null;
  private durationInterval: ReturnType<typeof setInterval> | null = null;
  // Keyed by `${kind}:${serviceId}` so restream and capture errors are de-duped
  // independently (an error toast for one subsystem shouldn't suppress the other's).
  private readonly _prevStatuses = new Map<string, string>();

  // Wall-clock signal that ticks every second while a session is live. Read
  // inside computeds that depend on elapsed time (platform uptime), so they
  // re-evaluate without per-card setInterval bookkeeping.
  readonly now = signal(Date.now());
  private nowInterval: ReturnType<typeof setInterval> | null = null;
  // serviceIds whose warning log is expanded in the UI.
  readonly expandedWarnings = signal<Set<number>>(new Set());

  readonly authRequiredList = computed(() => Object.values(this.service.authRequired()));

  constructor() {
    effect(() => {
      const state = this.service.sessionState();
      if (state === 'live') {
        this.sessionStartTime = this.service.sessionStartedAt() ?? Date.now();
        this._startTimer();
        this._startNowTicker();
      } else if (state === 'ended') {
        this._stopTimer();
        this._stopNowTicker();
      } else {
        this._stopTimer();
        this._stopNowTicker();
        this.duration.set('0s');
        this.sessionStartTime = null;
      }
    });

    effect(() => {
      this.filteredEvents(); // track length changes
      if (this.autoScroll()) {
        // defer so the virtual scroll has rendered the new item
        queueMicrotask(() => this.scrollViewport?.scrollToIndex(0));
      }
    });

    effect(() => {
      const status = this.service.relayStatus();
      if (status?.event === 'reconnecting') {
        const secs = Math.round((status.delayMs ?? 0) / 1000);
        this.snackBar.open(
          `Relay disconnected — reconnecting (attempt ${status.attempt}, retry in ${secs}s)…`,
          'Dismiss',
          { duration: Math.max(status.delayMs ?? 5000, 5000), panelClass: 'snackbar-warn' }
        );
      } else if (status?.event === 'connected') {
        this.relayFailure.set(null);
        this.snackBar.open(`Relay connected`, 'Dismiss', { duration: 3000 });
      } else if (status?.event === 'error') {
        // Persist the failure as an unmissable banner — a transient toast is not
        // enough when the consequence is "you think you're live but nothing is
        // going out." Remote mode never falls back to a direct push, so the user
        // MUST know the relay is down. Cleared only when the relay reconnects.
        this.relayFailure.set(status.reason || 'Relay connection failed');
        this.snackBar.open(
          `Relay failure — restream STOPPED` +
            (status.reason ? ': ' + status.reason : ''),
          'Dismiss',
          { duration: 12000, panelClass: 'snackbar-error' }
        );
      }
    });

    effect(() => {
      const restream = this.service.restreamStatuses();
      const capture = this.service.captureStatuses();
      const services = this.streamSvc.services();

      // Raise a toast on a *new* terminal error, separately per subsystem, so the
      // message tells the user exactly what failed — and so a capture failure (chat
      // /alerts down) is never reported as if the stream itself had stopped.
      const checkError = (status: PlatformStatus, kind: 'restream' | 'capture', failReason: string) => {
        const key = `${kind}:${status.serviceId}`;
        const prev = this._prevStatuses.get(key);
        if (status.status === 'error' && status.reason === failReason && prev !== 'error') {
          const svc = services.find((s) => s.id === status.serviceId);
          const label = svc?.display_name ?? `Service ${status.serviceId}`;
          const msg = kind === 'restream'
            ? `${label}: restream stopped — max retries exceeded; check stream key and platform status`
            : `${label}: event capture failed — max retries exceeded; chat/alerts won't update (your stream is unaffected)`;
          this.snackBar.open(msg, 'Dismiss', { duration: 10000 });
        }
        this._prevStatuses.set(key, status.status);
      };

      for (const status of Object.values(restream)) checkError(status, 'restream', 'max_restarts');
      for (const status of Object.values(capture)) checkError(status, 'capture', 'max_failures');
    });
  }

  readonly platformCards = computed(() => {
    const services = this.streamSvc.services();
    const restreamStatuses = this.service.restreamStatuses();
    const captureStatuses = this.service.captureStatuses();
    const progress = this.service.platformProgress();
    const progressPrev = this.service.platformProgressPrev();
    const warnings = this.service.platformWarnings();
    const session = this.service.sessionState();
    const isRelay = this.settingsSvc.settings()?.['relay.mode'] === 'remote';
    const now = this.now();
    return services
      .filter((s) => s.active && (s.restream_enabled || s.event_capture_enabled))
      .map((s) => {
        const captureOnly = !s.restream_enabled && s.event_capture_enabled;
        const cst = captureStatuses[s.id] ?? null;
        // Primary status line = the restream (the stream itself), unless this is a
        // capture-only platform, in which case capture *is* the primary thing.
        const st = (captureOnly ? cst : restreamStatuses[s.id]) ?? null;
        const isLive = st?.status === 'live';
        const startedAt = st?.startedAt ?? null;
        const uptimeLabel = isLive && startedAt
          ? this._fmt(Math.max(0, Math.floor((now - startedAt) / 1000)))
          : null;
        const prog = progress[s.id] ?? null;
        const prev = progressPrev[s.id] ?? null;
        const dropped = prog?.dropped ?? 0;
        // drop rate: delta drops / delta seconds between the two most recent samples
        let dropRate = 0;
        if (prog && prev && prog.receivedAt > prev.receivedAt) {
          const dt = (prog.receivedAt - prev.receivedAt) / 1000;
          dropRate = dt > 0 ? Math.max(0, (prog.dropped - prev.dropped) / dt) : 0;
        }
        const platformWarnings = warnings[s.id] ?? [];
        return {
          service: s,
          status: st,
          captureOnly,
          isLive,
          isError: st?.status === 'error',
          isRelayMode: isRelay && s.restream_enabled,
          statusLabel: this._statusLabel(st, session, captureOnly),
          // Secondary capture indicator, shown only when this card's primary line is
          // the restream but capture also runs (i.e. a platform doing both). This is
          // what lets the user tell a capture problem apart from a restream problem.
          showCaptureChip: s.event_capture_enabled && !captureOnly,
          captureState: cst?.status ?? 'stopped',
          captureStatusLabel: this._captureStatusLabel(cst),
          uptimeLabel,
          dropped,
          dropRate,
          // Show the drops badge once any drops have occurred, even if rate=0,
          // so users see the cumulative damage after a transient spike.
          showDrops: dropped > 0,
          warningCount: platformWarnings.length,
          latestWarning: platformWarnings[0] ?? null,
          warnings: platformWarnings,
        };
      });
  });

  readonly sessionStats = this.service.sessionStats;
  readonly liveViewers = this.service.liveViewers;

  readonly totalViewers = computed(() =>
    Object.values(this.service.liveViewers()).reduce((s, n) => s + n, 0)
  );

  readonly viewerEntries = computed(() =>
    Object.entries(this.service.liveViewers())
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
  );

  readonly filteredEvents = computed(() => {
    const evts = this.service.events();
    if (this.platformFilter() !== 'all') return evts.filter((e) => e.platform === this.platformFilter());
    return evts;
  });

  ngAfterViewInit(): void {
    // scroll to top on init if there are already events
    if (this.filteredEvents().length > 0) {
      this.scrollViewport?.scrollToIndex(0);
    }
  }

  onScrolledIndexChange(firstIndex: number): void {
    this.autoScroll.set(firstIndex === 0);
  }

  scrollToTop(): void {
    this.autoScroll.set(true);
    this.scrollViewport?.scrollToIndex(0);
  }

  ngOnInit(): void {
    this.http.get<Record<string, unknown>>('/api/settings')
      .pipe(takeUntil(this.destroy$))
      .subscribe((s) => this.rtmpPort.set((s['rtmp.port'] as number) ?? 1935));

    if (!this.settingsSvc.settings()) {
      this.settingsSvc.load().catch(() => {});
    }

    this.http.get<{ session: string; platforms: Record<number, PlatformStatus> }>('/api/stream/status')
      .pipe(takeUntil(this.destroy$))
      .subscribe((snapshot) => this.service.hydrateStatuses(snapshot.platforms));

    this.streamSvc.loadAll().catch(() => {});

  }

  ngOnDestroy(): void {
    this._stopTimer();
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

  async toggleCapture(serviceId: number, currentlyActive: boolean): Promise<void> {
    this.toggling.update((t) => ({ ...t, [serviceId]: true }));
    try {
      const endpoint = currentlyActive ? '/api/event-capture/stop' : '/api/event-capture/start';
      await firstValueFrom(this.http.post(endpoint, { serviceId }));
    } catch (err) {
      console.error('Capture toggle failed', err);
    } finally {
      this.toggling.update((t) => ({ ...t, [serviceId]: false }));
    }
  }

  async toggle(serviceId: number, currentlyLive: boolean): Promise<void> {
    if (!currentlyLive) {
      const svc = this.streamSvc.getById(serviceId);
      if (svc && this._shouldWarnTikTokKey(svc)) {
        const choice = await this._showTikTokKeyReminder(svc);
        if (choice === 'update') {
          this.router.navigate(['/ottery-live/platforms']);
          return;
        }
      }
    }
    this.toggling.update((t) => ({ ...t, [serviceId]: true }));
    try {
      await firstValueFrom(
        this.http.post('/api/stream/toggle', { serviceId, enabled: !currentlyLive })
      );
    } catch (err) {
      console.error('Toggle failed', err);
    } finally {
      this.toggling.update((t) => ({ ...t, [serviceId]: false }));
    }
  }

  async startAll(): Promise<void> {
    const tiktokServices = this.streamSvc.services().filter(
      (s) => s.active && s.restream_enabled && s.platform === 'tiktok'
    );
    for (const svc of tiktokServices) {
      if (this._shouldWarnTikTokKey(svc)) {
        const choice = await this._showTikTokKeyReminder(svc);
        if (choice === 'update') {
          this.router.navigate(['/ottery-live/platforms']);
          return;
        }
        break;
      }
    }
    this.startingAll.set(true);
    try {
      await firstValueFrom(this.http.post('/api/stream/start-all', {}));
    } catch (err) {
      console.error('Start all failed', err);
    } finally {
      this.startingAll.set(false);
    }
  }

  async stopAll(): Promise<void> {
    const ref = this.dialog.open(StopAllConfirmDialogComponent);
    const confirmed = await firstValueFrom(ref.afterClosed());
    if (!confirmed) return;
    this.stoppingAll.set(true);
    try {
      await firstValueFrom(this.http.post('/api/stream/stop-all', {}));
    } catch (err) {
      console.error('Stop all failed', err);
    } finally {
      this.stoppingAll.set(false);
    }
  }

  async reconnect(serviceId: number): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.http.post<{
          mechanism: string;
          user_code?: string;
          verification_uri?: string;
          expires_in?: number;
        }>(`/api/stream-services/${serviceId}/oauth/start`, {})
      );
      if (result.mechanism === 'device_code' && result.user_code) {
        this.snackBar.open(
          `Go to ${result.verification_uri} and enter code: ${result.user_code}`,
          'OK',
          { duration: 60000 }
        );
      }
      this.service.clearAuthRequired(serviceId);

      const captureStatus = this.service.captureStatuses()[serviceId];
      if (captureStatus?.status === 'error') {
        this.http.post(`/api/event-capture/${serviceId}/start`, {}).subscribe({
          error: (err) => console.warn('Failed to restart event capture after reconnect', err),
        });
      }
    } catch (err) {
      console.error('Reconnect failed', err);
    }
  }

  trackEvent(_index: number, e: OtteryEvent): string {
    return e.id;
  }

  chatHtml(e: OtteryEvent): SafeHtml {
    if (e.platform === 'twitch') {
      type Fragment = { type: string; text: string; emoteId?: string | null };
      const fragments = e.data['fragments'] as Fragment[] | null | undefined;
      if (fragments?.length) {
        const html = fragments.map((f) => {
          if (f.type === 'emote' && f.emoteId) {
            const name = this._esc(f.text);
            const src = `https://static-cdn.jtvnw.net/emoticons/v2/${f.emoteId}/default/dark/1.0`;
            return `<img class="chat-emote" src="${src}" alt="${name}" title="${name}">`;
          }
          return this._esc(f.text);
        }).join('');
        return this.sanitizer.bypassSecurityTrustHtml(html);
      }
    }

    if (e.platform === 'tiktok') {
      type TikTokEmote = { id: string; imageUrl: string | null; position: number };
      const emotes = e.data['emotes'] as TikTokEmote[] | null | undefined;
      const message = String(e.data['message'] ?? '');
      if (emotes?.length) {
        // Replace each emote placeholder character in the comment with an img tag.
        // Work right-to-left so earlier positions stay valid after replacements.
        const sorted = [...emotes].sort((a, b) => b.position - a.position);
        let chars = [...message]; // spread to handle multi-byte safely
        for (const emote of sorted) {
          if (emote.imageUrl) {
            const name = this._esc(emote.id);
            const img = `<img class="chat-emote" src="${this._esc(emote.imageUrl)}" alt="${name}" title="${name}">`;
            chars.splice(emote.position, 1, img);
          }
        }
        return this.sanitizer.bypassSecurityTrustHtml(chars.map((c) => c.length === 1 ? this._esc(c) : c).join(''));
      }
    }

    return this.sanitizer.bypassSecurityTrustHtml(this._esc(String(e.data['message'] ?? '')));
  }

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  eventSummary(e: OtteryEvent): string {
    switch (e.type) {
      case 'chat.message':   return String(e.data['message'] ?? '');
      case 'follow':         return 'followed';
      case 'subscribe':      return `Tier ${e.data['tier'] ?? '1000'} sub`;
      case 'subscribe.gift': return `gifted ${e.data['count'] ?? 1} subs`;
      case 'cheer':          return `${e.data['bits'] ?? 0} bits`;
      case 'raid':           return `raided with ${e.data['viewers'] ?? 0} viewers`;
      case 'redeem':         return `redeemed ${String(e.data['rewardTitle'] ?? 'reward')}${e.data['input'] ? `: ${String(e.data['input'])}` : ''}`;
      case 'tip':            return `${String(e.data['giftName'] ?? 'gift')} (${String(e.data['amount'] ?? 0)} diamonds)`;
      case 'like':           return `liked × ${String(e.data['count'] ?? 1)}`;
      case 'share':          return 'shared the stream';
      case 'viewer_count':   return `${String(e.data['count'] ?? 0)} viewers`;
      case 'stream.start':   return 'stream online on platform';
      case 'stream.end':     return 'stream offline on platform';
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
      default:               return '';
    }
  }

  private _shouldWarnTikTokKey(svc: StreamService): boolean {
    if (svc.platform !== 'tiktok' || !svc.restream_enabled) return false;
    const meta = svc.metadata as Record<string, unknown> | null;
    const lastUpdated = meta?.['stream_key_last_updated_at'] as string | undefined;
    if (!lastUpdated) return true;
    return Date.now() - new Date(lastUpdated).getTime() > 4 * 60 * 60 * 1000;
  }

  private async _showTikTokKeyReminder(svc: StreamService): Promise<'update' | 'continue'> {
    const meta = svc.metadata as Record<string, unknown> | null;
    const lastUpdated = (meta?.['stream_key_last_updated_at'] as string) ?? null;
    const ref = this.dialog.open(TikTokKeyReminderDialogComponent, {
      data: { lastUpdated },
      width: '400px',
    });
    const result = await firstValueFrom(ref.afterClosed());
    return result ?? 'continue';
  }

  private _statusLabel(status: PlatformStatus | null, session: string, captureOnly = false): string {
    if (captureOnly) {
      if (!status) return 'Not connected';
      switch (status.status) {
        case 'live':       return 'Capture active';
        case 'stopped':    return 'Capture stopped';
        case 'connecting': return 'Connecting...';
        case 'error':      return status.reason === 'max_failures' ? 'Failed (max retries)' : 'Error';
        default:           return 'Not connected';
      }
    }
    if (session === 'idle') return 'Waiting';
    if (!status) return session === 'live' ? 'Starting...' : 'Stopped';
    switch (status.status) {
      case 'live':        return 'Live';
      case 'stopped':     return 'Stopped';
      case 'connecting':  return 'Connecting...';
      case 'error':       return status.reason === 'max_restarts' ? 'Failed (max retries)' : 'Error';
      default:            return 'Unknown';
    }
  }

  // Label for the secondary event-capture chip on a restreaming platform card.
  private _captureStatusLabel(status: PlatformStatus | null): string {
    switch (status?.status) {
      case 'live':       return 'Events: active';
      case 'connecting': return 'Events: connecting…';
      case 'error':      return status.reason === 'max_failures' ? 'Events: failed' : 'Events: error';
      case 'stopped':    return 'Events: stopped';
      default:           return 'Events: off';
    }
  }

  protected toggleWarningLog(serviceId: number): void {
    this.expandedWarnings.update((s) => {
      const next = new Set(s);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }

  protected isWarningExpanded(serviceId: number): boolean {
    return this.expandedWarnings().has(serviceId);
  }

  protected formatDropRate(rate: number): string {
    if (rate < 1) return rate.toFixed(2);
    if (rate < 10) return rate.toFixed(1);
    return Math.round(rate).toString();
  }

  private _startNowTicker(): void {
    this._stopNowTicker();
    this.now.set(Date.now());
    this.nowInterval = setInterval(() => this.now.set(Date.now()), 1000);
  }

  private _stopNowTicker(): void {
    if (this.nowInterval !== null) {
      clearInterval(this.nowInterval);
      this.nowInterval = null;
    }
  }

  private _startTimer(): void {
    this._stopTimer();
    const tick = () => {
      if (this.sessionStartTime === null) return;
      const secs = Math.floor((Date.now() - this.sessionStartTime) / 1000);
      this.duration.set(this._fmt(secs));
    };
    tick(); // update immediately so tab-switch doesn't flash 0s
    this.durationInterval = setInterval(tick, 1000);
  }

  private _stopTimer(): void {
    if (this.durationInterval !== null) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
  }

  private _fmt(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
}
