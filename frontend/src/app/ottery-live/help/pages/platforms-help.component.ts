import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-platforms',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Platforms</h1>
    <p class="page-tagline">Configure every destination you want to stream to.</p>

    <h2><mat-icon>add_circle</mat-icon>Adding a platform</h2>
    <p>Click <strong>Add Platform</strong>, pick a service from the list, and fill in the form.
      Fields vary slightly by platform but the core ones are always the same:</p>
    <table class="ref-table">
      <thead><tr><th>Field</th><th>What to put here</th></tr></thead>
      <tbody>
        <tr>
          <td>Name</td>
          <td>A friendly label you choose — "My Twitch", "YouTube Gaming", etc. This is just for you; it appears on the Dashboard card.</td>
        </tr>
        <tr>
          <td>Stream key</td>
          <td>The secret key from your streaming platform's dashboard. Never share this.
            It's encrypted and stored in your OS keychain — not in any readable file.</td>
        </tr>
        <tr>
          <td>RTMP URL</td>
          <td>The ingest server address. Most platforms have a fixed URL and Ottery Live fills it in automatically.
            For X (Twitter), Joystick.tv, and Bilibili you need to paste the URL from their dashboard.</td>
        </tr>
        <tr>
          <td>Enabled</td>
          <td>Whether this platform is included when you start streaming. Disable it to skip a platform
            without deleting its config — handy if you occasionally skip a destination.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>vpn_key</mat-icon>Where to find your stream key</h2>
    <table class="ref-table">
      <thead><tr><th>Platform</th><th>Where to find it</th></tr></thead>
      <tbody>
        <tr><td>Twitch</td><td>Twitch Dashboard → Settings → Stream → Primary Stream Key</td></tr>
        <tr><td>YouTube</td><td>YouTube Studio → Go Live → Stream Settings → Stream Key</td></tr>
        <tr><td>Kick</td><td>Kick Dashboard → Channel → Stream Key</td></tr>
        <tr><td>TikTok</td><td>TikTok LIVE Studio → Settings → Stream Key <em>(changes every session)</em></td></tr>
        <tr><td>Facebook</td><td>Facebook → Live Producer → Use Stream Key</td></tr>
        <tr><td>Rumble</td><td>Rumble → Go Live → Stream Settings → copy from the ingest page</td></tr>
        <tr><td>Bilibili</td><td>Bilibili → Live Center → Start Live → Room Address + Stream Key <em>(session-specific)</em></td></tr>
        <tr><td>X (Twitter)</td><td>X Media Studio → Producer → copy the Server URL and Key separately</td></tr>
        <tr><td>Joystick.tv</td><td>Joystick.tv → Stream Settings → copy RTMP URL and Key</td></tr>
      </tbody>
    </table>

    <div class="callout warn">
      <mat-icon>warning</mat-icon>
      <span><strong>TikTok and Bilibili generate a new stream key every session.</strong>
        Remember to update the key in Ottery Live before each stream on those platforms —
        using an old key will cause the restream to fail silently.</span>
    </div>

    <h2><mat-icon>info</mat-icon>Platform notes</h2>
    <table class="ref-table">
      <thead><tr><th>Platform</th><th>Things to know</th></tr></thead>
      <tbody>
        <tr>
          <td>Twitch</td>
          <td>Full support — static stream key, EventSub WebSocket for events (follows, subs, raids, etc.).</td>
        </tr>
        <tr>
          <td>YouTube</td>
          <td>Full support — static key. Live chat and superchats via the YouTube Data API (requires OAuth).</td>
        </tr>
        <tr>
          <td>Kick</td>
          <td>Full support via RTMPS. Events via Kick's Pusher WebSocket.</td>
        </tr>
        <tr>
          <td>TikTok</td>
          <td>Stream key changes each session — must be updated before going live. Events via unofficial API.</td>
        </tr>
        <tr>
          <td>Facebook</td>
          <td>Static RTMPS ingest. Comments via SSE. Requires Facebook Login — a browser will open for OAuth.</td>
        </tr>
        <tr>
          <td>X (Twitter)</td>
          <td>RTMP URL is per-account (not static) — paste it from X Media Studio. No live event API exists.</td>
        </tr>
        <tr>
          <td>Rumble</td>
          <td>RTMP URL is per-account. Events via polling the Rumble Live API — no OAuth needed.</td>
        </tr>
        <tr>
          <td>Joystick.tv</td>
          <td>Uses AWS IVS — URL is per-account. Events via Action Cable with OAuth.</td>
        </tr>
        <tr>
          <td>Bilibili</td>
          <td>Both the room address and stream key are session-specific. Chat via Danmaku WebSocket.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>edit</mat-icon>Editing and deleting</h2>
    <p>Click the <strong>edit icon</strong> on any platform card to update the stream key,
      RTMP URL, or name. Click the <strong>delete icon</strong> and confirm to permanently
      remove the platform and erase its stream key from the OS keychain.</p>
    <p>You can re-order platforms by dragging the cards — they appear in the same order on the Dashboard.</p>
  `,
})
export class PlatformsHelpComponent {}
