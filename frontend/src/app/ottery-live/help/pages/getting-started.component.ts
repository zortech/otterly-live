import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-getting-started',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Getting Started</h1>
    <p class="page-tagline">From zero to streaming on every platform in about five minutes.</p>

    <h2><mat-icon>inventory_2</mat-icon>What you need</h2>
    <ul>
      <li><strong>OBS Studio</strong> (or any software that can push an RTMP stream)</li>
      <li><strong>Stream keys</strong> — one per platform you want to go live on</li>
      <li>Ottery Live open and running — everything else is built in, no extra installs</li>
    </ul>

    <h2><mat-icon>rocket_launch</mat-icon>First-time setup</h2>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Add your platforms</strong>
          <p>Head to <strong>Platforms</strong> in the sidebar. Click <strong>Add Platform</strong>,
            choose a service (Twitch, YouTube, Kick, etc.), paste in your stream key, and give the
            entry a name. Repeat for each destination you want to send your stream to.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Point OBS at Ottery Live</strong>
          <p>In OBS: <strong>Settings → Stream → Service: Custom RTMP</strong>.<br>
            Set <strong>Server</strong> to <code>rtmp://localhost:1935/live</code><br>
            Set <strong>Stream Key</strong> to <code>ottery</code>
            (or the custom key you configured in Settings).</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <strong>Go live</strong>
          <p>Click <strong>Start Streaming</strong> in OBS. Ottery Live detects the incoming
            stream and immediately starts restreaming to every enabled platform.
            No extra button to click — it just works.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-body">
          <strong>Monitor from the Dashboard</strong>
          <p>The Dashboard shows each platform's live status, viewer counts, and lets you stop
            individual destinations at any time. The event feed at the bottom shows chat,
            follows, subs, and donations from all platforms in real time.</p>
        </div>
      </div>
    </div>

    <div class="callout">
      <mat-icon>lock</mat-icon>
      <span>Ottery Live runs entirely on your computer — no cloud service, no account required.
        Stream keys are stored in your OS keychain (Windows Credential Store, macOS Keychain,
        Linux libsecret) — never in a plain text file.</span>
    </div>

    <h2><mat-icon>help_outline</mat-icon>What's what</h2>
    <table class="ref-table">
      <thead><tr><th>Feature</th><th>What it does</th></tr></thead>
      <tbody>
        <tr><td>Dashboard</td><td>Live controls — start/stop platforms, watch the event feed</td></tr>
        <tr><td>Platforms</td><td>Add, edit, and manage your streaming destinations and their credentials</td></tr>
        <tr><td>Settings</td><td>OBS connection, ports, behaviour toggles, StreamTap, and Warudo</td></tr>
        <tr><td>Interfaces</td><td>Browser-source overlays to add into OBS (chat, now playing, goals)</td></tr>
        <tr><td>Credits</td><td>Loyalty point system for viewers — earn and spend across all platforms</td></tr>
        <tr><td>Music</td><td>Spotify song request queue with viewer commands</td></tr>
        <tr><td>Chat</td><td>Unified read-only chat panel from all platforms</td></tr>
        <tr><td>Event Log</td><td>Searchable history of everything that happened during your streams</td></tr>
      </tbody>
    </table>

    <h2><mat-icon>forum</mat-icon>Typical stream flow</h2>
    <ol style="padding-left:18px;margin:0 0 12px">
      <li style="font-size:13.5px;color:var(--text-2);line-height:1.6;margin-bottom:6px">Open Ottery Live — it starts its local server automatically</li>
      <li style="font-size:13.5px;color:var(--text-2);line-height:1.6;margin-bottom:6px">Open OBS and click <strong>Start Streaming</strong></li>
      <li style="font-size:13.5px;color:var(--text-2);line-height:1.6;margin-bottom:6px">Ottery Live detects the stream and fires up restreaming to all active platforms</li>
      <li style="font-size:13.5px;color:var(--text-2);line-height:1.6;margin-bottom:6px">Monitor the Dashboard; watch chat roll in from every platform at once</li>
      <li style="font-size:13.5px;color:var(--text-2);line-height:1.6;margin-bottom:6px">Click <strong>Stop Streaming</strong> in OBS when you're done — Ottery Live stops restreaming automatically</li>
    </ol>
  `,
})
export class GettingStartedHelpComponent {}
