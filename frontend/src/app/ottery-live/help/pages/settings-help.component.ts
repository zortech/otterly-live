import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-settings',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Settings</h1>
    <p class="page-tagline">Every setting explained — what it does and when to change it.</p>

    <h2><mat-icon>cast_connected</mat-icon>OBS Connection</h2>
    <p>This section controls how OBS talks to Ottery Live. You'll only ever need to change
      these if port 1935 is already in use on your machine, or if you want extra security
      on your home network.</p>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Incoming stream key</td>
          <td>OBS must put this exact value in its <em>Stream Key</em> field.
            Think of it as a password — streams with any other key are rejected.
            Default is <code>ottery</code>. Change it if you want an extra layer of
            protection against other apps on your network accidentally connecting.</td>
        </tr>
        <tr>
          <td>RTMP port</td>
          <td>The port Ottery Live listens on for OBS streams. Default is 1935 (the
            standard RTMP port). Only change this if something else on your machine
            is already using port 1935. <strong>Restart required after changing.</strong></td>
        </tr>
        <tr>
          <td>Server port</td>
          <td>The internal web server port that the Angular UI connects to. Default is 3737.
            Only change if there's a conflict. <strong>Restart required after changing.</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="callout warn">
      <mat-icon>restart_alt</mat-icon>
      <span>Port changes don't take effect until you restart Ottery Live. A banner will
        remind you. After restarting, update OBS's Server field if you changed the RTMP port.</span>
    </div>

    <h2><mat-icon>tune</mat-icon>Behaviour</h2>
    <p>These three toggles control what Ottery Live does automatically. The defaults work
      well for most streamers — read on if you want to customise the flow.</p>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Auto-start platforms on OBS connect</td>
          <td><strong>On (default):</strong> The moment OBS starts sending video, Ottery Live
            automatically begins restreaming to all enabled platforms — zero clicks required.<br><br>
            <strong>Off:</strong> Ottery Live waits for you to manually start each platform
            from the Dashboard. Useful if you want a "hold" period before going live on
            all destinations simultaneously.</td>
        </tr>
        <tr>
          <td>Keep event capture running after stream ends</td>
          <td><strong>On (default):</strong> Chat and events keep flowing even after OBS stops
            streaming. You can keep reading chat, seeing donations, etc. after the stream ends.<br><br>
            <strong>Off:</strong> Event capture stops the moment the stream ends. Saves a tiny
            bit of network activity if you don't need post-stream chat access.</td>
        </tr>
        <tr>
          <td>Minimize to tray on close</td>
          <td><strong>On (default):</strong> Clicking the ✕ button hides the window — Ottery Live
            keeps running in the background so an active stream isn't interrupted. Click the
            tray icon to bring the window back.<br><br>
            <strong>Off:</strong> Closing the window quits the application. Only use this if
            you're sure you don't want background operation.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>update</mat-icon>App</h2>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Check for updates automatically</td>
          <td>Ottery Live silently checks for new versions in the background. When a new version
            is downloaded and ready, a banner appears in the sidebar — no pop-up interrupts
            your stream. Disable this if you're on an air-gapped machine or prefer to update
            manually.</td>
        </tr>
        <tr>
          <td>Log level</td>
          <td>Controls how much detail appears in the log files:<br>
            <code>error</code> — only outright failures<br>
            <code>warn</code> — failures and things that might go wrong<br>
            <code>info</code> — normal events, recommended for day-to-day use<br>
            <code>debug</code> — extremely verbose; use when diagnosing a problem, then switch back</td>
        </tr>
        <tr>
          <td>Open log folder</td>
          <td>Opens the folder where Ottery Live writes its <code>.log</code> files.
            When reporting a bug, grab the latest log file from here — it's the most
            useful thing you can include in a bug report.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>hub</mat-icon>StreamTap</h2>
    <p>StreamTap is an optional local WebSocket server that broadcasts every stream event to
      any tool that connects to it — overlays, chatbots, custom scripts. If you don't use any
      local overlay tools, leave this disabled.</p>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Enable StreamTap</td>
          <td>Opens a WebSocket server so external tools can subscribe to your stream events.
            When enabled, the connection URL is shown — paste it into your overlay or tool.</td>
        </tr>
        <tr>
          <td>Advertise via mDNS</td>
          <td>Announces StreamTap on your local network as <code>_streamtap._tcp</code>.
            Tools that support mDNS discovery will find it automatically — no manual IP/port needed.
            Disable if you don't want network-level advertisement.</td>
        </tr>
        <tr>
          <td>StreamTap port</td>
          <td>The port the WebSocket server listens on. Default is 4747. Change it if something
            else is already using that port. The server restarts automatically — no app restart needed.</td>
        </tr>
        <tr>
          <td>Auth token</td>
          <td>An optional shared secret. If set, connecting clients must send this token in their
            first WebSocket message or the connection is closed. Leave blank if you don't need
            this level of security.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>sensors</mat-icon>Warudo Relay</h2>
    <p>Forwards every stream event to Warudo so your avatar can react to follows, subs,
      donations, and more. Warudo must be running on the same (or network-accessible) machine.</p>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Enable Warudo relay</td>
          <td>Opens an outbound connection from Ottery Live to Warudo's WebSocket server.
            Warudo doesn't need any extra plugin — it accepts the connection natively.</td>
        </tr>
        <tr>
          <td>Warudo host</td>
          <td>Where Warudo is running. Leave as <code>localhost</code> if Warudo is on the
            same computer. Change to the machine's IP address if Warudo is on a different
            PC on your local network.</td>
        </tr>
        <tr>
          <td>Warudo port</td>
          <td>The port Warudo's WebSocket server listens on. Default is 19190 — this matches
            Warudo's default. Only change if you've updated it in Warudo's own settings.</td>
        </tr>
      </tbody>
    </table>

    <div class="callout warn">
      <mat-icon>warning</mat-icon>
      <span>After changing the Warudo host or port, <strong>toggle the relay off and back on</strong>
        to force a reconnect. The live connection doesn't update mid-session.</span>
    </div>

    <h2><mat-icon>cell_tower</mat-icon>Restream Mode</h2>
    <p>Controls whether Ottery Live pushes streams to platforms directly (<em>Local</em>)
      or offloads that work to a relay server (<em>Remote</em>). Local mode requires no
      extra setup. Remote mode reduces upload usage to a single stream regardless of how
      many platforms you stream to.</p>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Local</td>
          <td>Default. Ottery Live spawns one FFmpeg process per platform — all uploads
            leave from your computer. No extra server needed.</td>
        </tr>
        <tr>
          <td>Remote</td>
          <td>Ottery Live pushes one stream to the relay server; the relay fans it out to
            all platforms. Your computer only uploads once, regardless of destination count.</td>
        </tr>
        <tr>
          <td>Relay server URL</td>
          <td>HTTPS URL of your relay server, e.g. <code>https://relay.example.com</code>.
            Plain HTTP is rejected to protect your API token in transit.</td>
        </tr>
        <tr>
          <td>API token</td>
          <td>The token you received when your account was created on the relay server
            (or last rotated). Stored in the OS keychain — never written to disk in plaintext.</td>
        </tr>
        <tr>
          <td>Verify connection</td>
          <td>Tests that the relay URL and token are correct. Shows "✓ Connected as &lt;username&gt;"
            on success, or an error message if the server is unreachable or the token is wrong.</td>
        </tr>
      </tbody>
    </table>
    <p>For full relay server setup instructions — including Docker, user management, and
      sharing the server with friends — see the
      <strong>Remote Relay</strong> section in the Help Guide.</p>
  `,
})
export class SettingsHelpComponent {}
