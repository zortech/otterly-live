import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, firstValueFrom } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingsService } from './settings.service';
import { SecretKeyFieldComponent } from './secret-key-field.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    SecretKeyFieldComponent,
  ],
  styles: [`
    .page-title { font-size: 22px; font-weight: 700; color: var(--text-1); letter-spacing: -0.5px; margin-bottom: 24px; }

    .loading-bar-wrap { margin-bottom: 16px; border-radius: 4px; overflow: hidden; }

    .restart-banner {
      display: flex; align-items: flex-start; gap: 10px;
      background: rgba(255,183,77,0.08); border: 1px solid rgba(255,183,77,0.25);
      border-radius: 10px; padding: 14px 18px; margin-bottom: 20px;
    }
    .restart-banner mat-icon { color: var(--warn-color); margin-top: 1px; flex-shrink: 0; }
    .restart-banner-text strong { color: var(--warn-color); font-size: 13px; font-weight: 600; display: block; margin-bottom: 2px; }
    .restart-banner-text span { color: var(--text-2); font-size: 13px; }

    /* Section cards */
    .section {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
      padding: 20px 24px; margin-bottom: 16px;
    }
    .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
    .section-icon {
      width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0;
      background: var(--accent-dim); border: 1px solid var(--accent-border);
      display: flex; align-items: center; justify-content: center;
    }
    .section-icon mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--accent); }
    .section-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
    .section-desc { font-size: 12px; color: var(--text-2); margin-top: 1px; }

    mat-form-field { max-width: 320px; display: block; }

    .field-group { display: flex; flex-direction: column; gap: 16px; }

    /* OBS callout */
    .obs-callout {
      background: var(--bg-raised); border: 1px solid var(--border-2); border-radius: 10px;
      padding: 16px 20px; margin-bottom: 16px;
    }
    .obs-callout-title {
      font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px;
      color: var(--accent); margin-bottom: 12px;
      display: flex; align-items: center; gap: 6px;
    }
    .obs-callout-title mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .obs-step { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 9px; font-size: 13px; color: var(--text-2); }
    .obs-step:last-child { margin-bottom: 0; }
    .step-num {
      width: 19px; height: 19px; border-radius: 50%;
      background: var(--accent-dim); border: 1px solid var(--accent-border);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      font-size: 10px; font-weight: 700; color: var(--accent); margin-top: 1px;
    }
    .obs-step strong { color: var(--text-1); }
    code {
      font-family: 'JetBrains Mono', monospace; font-size: 12px;
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 4px; padding: 1px 6px; color: var(--accent);
    }

    /* Hint boxes */
    .hint-box {
      display: flex; align-items: flex-start; gap: 10px;
      background: rgba(0,201,167,0.05); border: 1px solid var(--accent-border);
      border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px; color: var(--text-2);
    }
    .hint-box mat-icon { color: var(--accent); font-size: 16px; width: 16px; height: 16px; margin-top: 1px; flex-shrink: 0; }
    .hint-box a { color: var(--accent); }

    /* Toggles */
    .toggle-row {
      display: flex; flex-direction: column; gap: 4px;
      padding: 12px 0; border-bottom: 1px solid var(--border);
    }
    .toggle-row:last-child { border-bottom: none; padding-bottom: 0; }
    .toggle-label { font-size: 14px; color: var(--text-1); font-weight: 500; }
    .toggle-desc { font-size: 12px; color: var(--text-2); }
    .toggle-control { display: flex; align-items: center; justify-content: space-between; }

    /* Action row */
    .action-row { margin-top: 16px; }

    /* Relay mode */
    .radio-group   { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .radio-option  { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; color: var(--text-1); }
    .relay-config  { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
    .verify-row    { display: flex; align-items: center; gap: 12px; }
    .verify-ok     { font-size: 13px; color: var(--live); }
    .verify-error  { font-size: 13px; color: var(--error-color); }
  `],
  template: `
    <h1 class="page-title">Settings</h1>

    @if (portChanged()) {
      <div class="restart-banner" role="alert">
        <mat-icon>restart_alt</mat-icon>
        <div class="restart-banner-text">
          <strong>Restart required</strong>
          <span>Port changes take effect after restarting Ottery Live. OBS must be updated to use the new RTMP port.</span>
        </div>
      </div>
    }

    @if (svc.loading()) {
      <div class="loading-bar-wrap"><mat-progress-bar mode="indeterminate" /></div>
    } @else {

      <!-- OBS Connection -->
      <div class="section">
        <div class="section-header">
          <div class="section-icon"><mat-icon>cast_connected</mat-icon></div>
          <div>
            <div class="section-title">OBS Connection</div>
            <div class="section-desc">Configure how OBS sends its stream to Ottery Live</div>
          </div>
        </div>

        <div class="obs-callout">
          <div class="obs-callout-title">
            <mat-icon>info</mat-icon>
            How to connect OBS
          </div>
          <div class="obs-step">
            <div class="step-num">1</div>
            <span>In OBS: <strong>Settings → Stream</strong> — set Service to <strong>Custom</strong></span>
          </div>
          <div class="obs-step">
            <div class="step-num">2</div>
            <span>Server: <code>rtmp://localhost:{{ svc.settings()?.['rtmp.port'] ?? 1935 }}/live</code></span>
          </div>
          <div class="obs-step">
            <div class="step-num">3</div>
            <span>Stream Key: <code>{{ svc.status()?.rtmpKey || 'ottery' }}</code> (the Incoming stream key set below)</span>
          </div>
          <div class="obs-step">
            <div class="step-num">4</div>
            <span>Click <strong>Start Streaming</strong> in OBS — Ottery Live will detect the stream automatically</span>
          </div>
        </div>

        <div class="field-group">
          <app-secret-key-field
            label="Incoming stream key"
            settingsKey="rtmp.incomingKey"
            [configured]="svc.status()?.rtmpKeyConfigured ?? false"
            matTooltip="OBS must put this exact value in its Stream Key field. Think of it as a password — only streams using this key are accepted."
            matTooltipPosition="right"
            (saved)="onSecretSaved()" />

          <mat-form-field appearance="outline" subscriptSizing="dynamic"
            matTooltip="The port Ottery Live listens on for incoming OBS streams. Default is 1935 (standard RTMP). Only change if port 1935 is already in use on your machine. Requires a restart."
            matTooltipPosition="right">
            <mat-label>RTMP port</mat-label>
            <input matInput type="number" [formControl]="rtmpPortControl" />
            <mat-hint>Default: 1935 — requires restart</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic"
            matTooltip="The port the internal web server runs on. The Angular UI connects to this. Default is 3737. Only change if there's a conflict. Requires a restart."
            matTooltipPosition="right">
            <mat-label>Server port</mat-label>
            <input matInput type="number" [formControl]="serverPortControl" />
            <mat-hint>Default: 3737 — requires restart</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic"
            matTooltip="Which network interface the web server listens on. 'This computer only' (127.0.0.1) blocks all access from other machines and is safest. 'All interfaces' (0.0.0.0) lets other devices on your LAN reach overlays — useful for apps like TikTok Live Studio running on another PC. Requires a restart."
            matTooltipPosition="right">
            <mat-label>Listen on</mat-label>
            <mat-select
              [value]="svc.settings()?.['server.bindAddress'] ?? '127.0.0.1'"
              (selectionChange)="save('server.bindAddress', $event.value)">
              <mat-option value="127.0.0.1">This computer only (127.0.0.1)</mat-option>
              <mat-option value="0.0.0.0">All network interfaces (0.0.0.0)</mat-option>
            </mat-select>
            <mat-hint>Default: this computer only — requires restart</mat-hint>
          </mat-form-field>

          @if (svc.settings()?.['server.bindAddress'] === '0.0.0.0') {
            <div class="hint-box" style="border-color: rgba(255,183,77,0.35); background: rgba(255,183,77,0.06);">
              <mat-icon style="color: var(--warn-color);">warning</mat-icon>
              <span>
                Overlays and the dashboard have no authentication. Anyone on your local network can open them.
                Only use this on a trusted network.
              </span>
            </div>
          }
        </div>
      </div>

      <!-- Behaviour -->
      <div class="section">
        <div class="section-header">
          <div class="section-icon"><mat-icon>tune</mat-icon></div>
          <div>
            <div class="section-title">Behaviour</div>
            <div class="section-desc">Control how Ottery Live responds to stream events</div>
          </div>
        </div>

        <div class="toggle-row">
          <div class="toggle-control">
            <div>
              <div class="toggle-label"
                matTooltip="When on, the moment OBS starts sending video Ottery Live automatically begins restreaming to all enabled platforms — no manual clicks needed. Turn off if you want to control each platform individually from the Dashboard."
                matTooltipPosition="right" matTooltipShowDelay="400">
                Auto-start platforms on OBS connect
              </div>
              <div class="toggle-desc">When OBS starts streaming, automatically begin restreaming to all active platforms</div>
            </div>
            <mat-slide-toggle
              [checked]="svc.settings()?.['stream.autoStartOnOBSConnect'] ?? true"
              (change)="save('stream.autoStartOnOBSConnect', $event.checked)" />
          </div>
        </div>

        <div class="toggle-row">
          <div class="toggle-control">
            <div>
              <div class="toggle-label"
                matTooltip="When on, chat and events keep flowing even after OBS stops streaming — handy for reading chat after the stream ends. When off, event capture stops as soon as OBS disconnects."
                matTooltipPosition="right" matTooltipShowDelay="400">
                Keep event capture running after stream ends
              </div>
              <div class="toggle-desc">Continue capturing chat and events even after OBS stops streaming</div>
            </div>
            <mat-slide-toggle
              [checked]="!(svc.settings()?.['stream.stopCaptureOnStreamEnd'] ?? false)"
              (change)="save('stream.stopCaptureOnStreamEnd', !$event.checked)" />
          </div>
        </div>

        <div class="toggle-row">
          <div class="toggle-control">
            <div>
              <div class="toggle-label"
                matTooltip="When on, clicking the ✕ button hides the window but keeps the app running so active streams aren't interrupted. Click the tray icon to restore it. When off, closing the window quits the app entirely."
                matTooltipPosition="right" matTooltipShowDelay="400">
                Minimize to tray on close
              </div>
              <div class="toggle-desc">Keep Ottery Live running in the background when the window is closed</div>
            </div>
            <mat-slide-toggle
              [checked]="svc.settings()?.['app.minimizeToTray'] ?? true"
              (change)="save('app.minimizeToTray', $event.checked)" />
          </div>
        </div>
      </div>

      <!-- App -->
      <div class="section">
        <div class="section-header">
          <div class="section-icon"><mat-icon>info</mat-icon></div>
          <div>
            <div class="section-title">App</div>
            <div class="section-desc">Updates and logging</div>
          </div>
        </div>

        <div class="toggle-row">
          <div class="toggle-control">
            <div>
              <div class="toggle-label"
                matTooltip="Ottery Live checks for new versions silently in the background. A banner appears in the sidebar when an update is ready — nothing interrupts your stream. Disable on air-gapped machines or if you prefer manual updates."
                matTooltipPosition="right" matTooltipShowDelay="400">
                Check for updates automatically
              </div>
              <div class="toggle-desc">Notify you when a new version of Ottery Live is available</div>
            </div>
            <mat-slide-toggle
              [checked]="svc.settings()?.['app.checkForUpdates'] ?? true"
              (change)="save('app.checkForUpdates', $event.checked)" />
          </div>
        </div>

        <div style="margin-top:16px;display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" style="min-width:160px"
            matTooltip="Controls how much detail is written to the log files. Use 'info' day-to-day. Switch to 'debug' when diagnosing a problem, then switch back — debug logs fill up fast."
            matTooltipPosition="right">
            <mat-label>Log level</mat-label>
            <mat-select
              [value]="svc.settings()?.['app.logLevel'] ?? 'info'"
              (selectionChange)="save('app.logLevel', $event.value)">
              <mat-option value="error">error</mat-option>
              <mat-option value="warn">warn</mat-option>
              <mat-option value="info">info</mat-option>
              <mat-option value="debug">debug</mat-option>
            </mat-select>
            <mat-hint>info is recommended; debug is verbose</mat-hint>
          </mat-form-field>

          <div class="action-row">
            <button mat-stroked-button (click)="openLogFolder()"
              matTooltip="Opens the folder where Ottery Live writes its log files. Grab the latest .log file when reporting a bug.">
              <mat-icon>folder_open</mat-icon>
              Open log folder
            </button>
          </div>
        </div>
      </div>

      <!-- StreamTap -->
      <div class="section">
        <div class="section-header">
          <div class="section-icon"><mat-icon>hub</mat-icon></div>
          <div>
            <div class="section-title">StreamTap</div>
            <div class="section-desc">Broadcast live events over WebSocket to overlays, bots, and local tools</div>
          </div>
        </div>

        <div class="toggle-row">
          <div class="toggle-control">
            <div>
              <div class="toggle-label"
                matTooltip="Opens a local WebSocket server that broadcasts every stream event in real time. Connect overlays, bots, or custom scripts to this feed. Leave disabled if you don't use any local overlay tools."
                matTooltipPosition="right" matTooltipShowDelay="400">
                Enable StreamTap
              </div>
              <div class="toggle-desc">Open a plain WebSocket server that broadcasts all stream events</div>
            </div>
            <mat-slide-toggle
              [checked]="svc.settings()?.['streamtap.enabled'] ?? false"
              (change)="save('streamtap.enabled', $event.checked)" />
          </div>
        </div>

        @if (svc.settings()?.['streamtap.enabled']) {
          <div class="hint-box" style="margin-top:16px">
            <mat-icon>cable</mat-icon>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span>Connect to:</span>
              <code>ws://localhost:{{ svc.settings()?.['streamtap.port'] ?? 4747 }}</code>
              <button mat-icon-button style="width:28px;height:28px;line-height:28px"
                (click)="copyStreamTapUrl()">
                <mat-icon style="font-size:16px;width:16px;height:16px">content_copy</mat-icon>
              </button>
            </div>
          </div>
        }

        <div class="toggle-row" style="margin-top:8px">
          <div class="toggle-control">
            <div>
              <div class="toggle-label"
                matTooltip="Broadcasts StreamTap's presence on your local network as _streamtap._tcp so compatible tools find it automatically — no manual IP/port entry needed. Disable if you don't need auto-discovery."
                matTooltipPosition="right" matTooltipShowDelay="400">
                Advertise via mDNS
              </div>
              <div class="toggle-desc">Announce StreamTap as <code>_streamtap._tcp</code> so local tools can discover it automatically</div>
            </div>
            <mat-slide-toggle
              [checked]="svc.settings()?.['streamtap.mdns'] ?? true"
              (change)="save('streamtap.mdns', $event.checked)" />
          </div>
        </div>

        <div class="field-group" style="margin-top:16px">
          <mat-form-field appearance="outline" subscriptSizing="dynamic"
            matTooltip="The WebSocket port StreamTap listens on. Default is 4747. The server restarts automatically when changed — no app restart needed."
            matTooltipPosition="right">
            <mat-label>StreamTap port</mat-label>
            <input matInput type="number" [formControl]="streamtapPortControl" />
            <mat-hint>Default: 4747 — restarts StreamTap automatically</mat-hint>
          </mat-form-field>

          <app-secret-key-field
            label="Auth token"
            settingsKey="streamtap.authToken"
            [configured]="svc.status()?.streamtapTokenConfigured ?? false"
            matTooltip="Optional secret clients must send as their first message when connecting. Leave blank for no authentication. Set one if you want to prevent unauthorised local connections."
            matTooltipPosition="right"
            (saved)="onSecretSaved()" />
        </div>
      </div>

      <!-- Restream Mode -->
      <div class="section">
        <div class="section-header">
          <div class="section-icon"><mat-icon>cell_tower</mat-icon></div>
          <div>
            <div class="section-title">Restream Mode</div>
            <div class="section-desc">Save upstream bandwidth by routing streams through a relay server</div>
          </div>
        </div>

        <div class="radio-group">
          <label class="radio-option">
            <input type="radio" name="relayMode" value="local"
              [checked]="(svc.settings()?.['relay.mode'] ?? 'local') === 'local'"
              (change)="save('relay.mode', 'local')" />
            <span>Local — this machine pushes to all platforms directly</span>
          </label>
          <label class="radio-option">
            <input type="radio" name="relayMode" value="remote"
              [checked]="svc.settings()?.['relay.mode'] === 'remote'"
              (change)="save('relay.mode', 'remote')" />
            <span>Remote — push once to relay; relay fans out to platforms</span>
          </label>
        </div>

        @if (svc.settings()?.['relay.mode'] === 'remote') {
          <div class="relay-config">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Relay server URL</mat-label>
              <input matInput type="url" [formControl]="relayUrlControl"
                     placeholder="https://relay.example.com" />
              <mat-hint>Must be HTTPS</mat-hint>
            </mat-form-field>

            <app-secret-key-field
              label="API token"
              settingsKey="relay.apiToken"
              [configured]="svc.status()?.relayTokenConfigured ?? false"
              (saved)="onSecretSaved()" />

            <div class="verify-row">
              <button mat-stroked-button [disabled]="verifyingRelay()"
                      (click)="verifyRelay()">
                {{ verifyingRelay() ? 'Verifying…' : 'Verify connection' }}
              </button>
              @if (relayVerifyResult(); as r) {
                @if (r.ok) {
                  <span class="verify-ok">✓ Connected as {{ r.username }}</span>
                } @else {
                  <span class="verify-error">✗ {{ r.error }}</span>
                }
              }
            </div>
          </div>
        }
      </div>

      <!-- Warudo Relay -->
      <div class="section">
        <div class="section-header">
          <div class="section-icon"><mat-icon>sensors</mat-icon></div>
          <div>
            <div class="section-title">Warudo Relay</div>
            <div class="section-desc">Forward stream events to Warudo for avatar reactions and blueprint triggers</div>
          </div>
        </div>

        <div class="hint-box" style="margin-bottom:16px">
          <mat-icon>info</mat-icon>
          <span>Ottery Live connects outbound to Warudo's built-in WebSocket server. No plugin required.
            Changing host or port takes effect after toggling the relay off and on.</span>
        </div>

        <div class="toggle-row">
          <div class="toggle-control">
            <div>
              <div class="toggle-label"
                matTooltip="Opens an outbound connection from Ottery Live to Warudo's built-in WebSocket server and forwards every stream event. No Warudo plugin needed — just enable this and build blueprints in Warudo."
                matTooltipPosition="right" matTooltipShowDelay="400">
                Enable Warudo relay
              </div>
              <div class="toggle-desc">Connect to Warudo and forward live events in real time</div>
            </div>
            <mat-slide-toggle
              [checked]="svc.settings()?.['warudo.enabled'] ?? false"
              (change)="save('warudo.enabled', $event.checked)" />
          </div>
        </div>

        <div class="field-group" style="margin-top:16px">
          <mat-form-field appearance="outline" subscriptSizing="dynamic"
            matTooltip="Where Warudo is running. Leave as 'localhost' if Warudo is on this same computer. Change to the machine's local IP if Warudo runs on a different PC on your network."
            matTooltipPosition="right">
            <mat-label>Warudo host</mat-label>
            <input matInput type="text" [formControl]="warudoHostControl" />
            <mat-hint>Default: localhost</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic"
            matTooltip="The port Warudo's WebSocket server listens on. Warudo's default is 19190. Only change this if you've changed it in Warudo's own settings. Toggle the relay off and on after changing."
            matTooltipPosition="right">
            <mat-label>Warudo port</mat-label>
            <input matInput type="number" [formControl]="warudoPortControl" />
            <mat-hint>Default: 19190</mat-hint>
          </mat-form-field>
        </div>
      </div>

    }
  `,
})
export class SettingsComponent implements OnInit, OnDestroy {
  protected readonly svc = inject(SettingsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly http = inject(HttpClient);
  private readonly destroy$ = new Subject<void>();

  private readonly originalPorts = signal<{ rtmp: number; server: number; bindAddress: string } | null>(null);

  readonly verifyingRelay    = signal(false);
  readonly relayVerifyResult = signal<{ ok: boolean; username?: string; error?: string } | null>(null);
  readonly relayUrlControl   = new FormControl<string>('', [Validators.required]);

  readonly rtmpPortControl = new FormControl<number>(1935, [
    Validators.required,
    Validators.min(1024),
    Validators.max(65535),
  ]);
  readonly serverPortControl = new FormControl<number>(3737, [
    Validators.required,
    Validators.min(1024),
    Validators.max(65535),
  ]);
  readonly warudoHostControl = new FormControl<string>('localhost', [Validators.required]);
  readonly warudoPortControl = new FormControl<number>(19190, [
    Validators.required,
    Validators.min(1),
    Validators.max(65535),
  ]);
  readonly streamtapPortControl = new FormControl<number>(4747, [
    Validators.required,
    Validators.min(1024),
    Validators.max(65535),
  ]);

  readonly portChanged = computed(() => {
    const s = this.svc.settings();
    const orig = this.originalPorts();
    if (!s || !orig) return false;
    return s['rtmp.port'] !== orig.rtmp
      || s['server.port'] !== orig.server
      || s['server.bindAddress'] !== orig.bindAddress;
  });

  async ngOnInit(): Promise<void> {
    await this.svc.load();
    const s = this.svc.settings();
    if (s) {
      this.rtmpPortControl.setValue(s['rtmp.port'], { emitEvent: false });
      this.serverPortControl.setValue(s['server.port'], { emitEvent: false });
      this.originalPorts.set({
        rtmp: s['rtmp.port'],
        server: s['server.port'],
        bindAddress: s['server.bindAddress'] ?? '127.0.0.1',
      });
      this.warudoHostControl.setValue(s['warudo.host'] ?? 'localhost', { emitEvent: false });
      this.warudoPortControl.setValue(s['warudo.port'] ?? 19190, { emitEvent: false });
      this.streamtapPortControl.setValue(s['streamtap.port'] ?? 4747, { emitEvent: false });
      this.relayUrlControl.setValue(s['relay.url'] ?? '', { emitEvent: false });
    }

    this.rtmpPortControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((v) => {
      if (this.rtmpPortControl.valid && v !== null) this.save('rtmp.port', v);
    });

    this.serverPortControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((v) => {
      if (this.serverPortControl.valid && v !== null) this.save('server.port', v);
    });

    this.warudoHostControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((v) => {
      if (this.warudoHostControl.valid && v !== null) this.save('warudo.host', v);
    });

    this.warudoPortControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((v) => {
      if (this.warudoPortControl.valid && v !== null) this.save('warudo.port', v);
    });

    this.streamtapPortControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((v) => {
      if (this.streamtapPortControl.valid && v !== null) this.save('streamtap.port', v);
    });

    this.relayUrlControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe((v) => {
      if (v !== null) this.save('relay.url', v);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async save(key: string, value: unknown): Promise<void> {
    try {
      await this.svc.set(key, value);
    } catch {
      this.snackBar.open('Failed to save setting', 'Dismiss', { duration: 4000 });
    }
  }

  async onSecretSaved(): Promise<void> {
    await this.svc.refreshStatus();
  }

  openLogFolder(): void {
    window.otteryElectron?.openLogFolder();
  }

  async verifyRelay(): Promise<void> {
    this.verifyingRelay.set(true);
    this.relayVerifyResult.set(null);
    try {
      const r = await firstValueFrom(
        this.http.post<{ ok: boolean; username: string }>('/api/relay/verify', {})
      );
      this.relayVerifyResult.set({ ok: true, username: r.username });
    } catch (e: unknown) {
      const err = e as { error?: { error?: string } };
      this.relayVerifyResult.set({ ok: false, error: err.error?.error ?? 'Connection failed' });
    } finally {
      this.verifyingRelay.set(false);
    }
  }

  copyStreamTapUrl(): void {
    const port = this.svc.settings()?.['streamtap.port'] ?? 4747;
    navigator.clipboard.writeText(`ws://localhost:${port}`).then(() => {
      this.snackBar.open('Copied!', undefined, { duration: 1500 });
    });
  }
}
