import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-streamtap',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">StreamTap</h1>
    <p class="page-tagline">A live WebSocket feed of every stream event — for overlays, bots, and custom tools.</p>

    <h2><mat-icon>hub</mat-icon>What it does</h2>
    <p>StreamTap is an optional WebSocket server that Ottery Live runs locally on your computer.
      Every event that happens during your stream — chat messages, follows, subscriptions,
      donations, bits, gift subs, redeems — is broadcast to every client connected to it.</p>
    <p>Think of it as a live event pipe. Any tool that can connect to a WebSocket can
      consume it: browser-based OBS overlays, Node.js scripts, chatbots, Resonite worlds,
      or anything you build yourself.</p>

    <h2><mat-icon>cable</mat-icon>Connecting to StreamTap</h2>
    <p>Enable StreamTap in <strong>Settings</strong>. Once it's running, the connection URL
      is shown right there:</p>
    <p><code>ws://localhost:4747</code></p>
    <p>Paste that into whatever tool you're using. If you set an auth token, the client must
      send that token as the very first message after connecting — the connection will be
      closed if it doesn't.</p>

    <div class="callout">
      <mat-icon>info</mat-icon>
      <span>StreamTap only broadcasts — it doesn't accept commands. Clients receive events
        but cannot send instructions back to Ottery Live through this channel.</span>
    </div>

    <h2><mat-icon>code</mat-icon>Event format</h2>
    <p>Each event is a JSON object sent as a text frame. Core fields:</p>
    <table class="ref-table">
      <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td>type</td><td>string</td><td>Event type — e.g. <code>follow</code>, <code>subscribe</code>, <code>chat.message</code>, <code>cheer</code>, <code>tip</code>, <code>subscribe.gift</code>, <code>redeem</code></td></tr>
        <tr><td>platform</td><td>string</td><td>Source platform — <code>twitch</code>, <code>youtube</code>, <code>kick</code>, <code>tiktok</code>, <code>facebook</code>, <code>rumble</code>, <code>bilibili</code></td></tr>
        <tr><td>username</td><td>string</td><td>The viewer's display name</td></tr>
        <tr><td>data</td><td>object</td><td>Event-specific payload (message text, sub tier, amount, currency, etc.)</td></tr>
        <tr><td>ts</td><td>string</td><td>ISO 8601 timestamp</td></tr>
      </tbody>
    </table>

    <h3>Example — follow event</h3>
    <pre style="background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-1);overflow-x:auto;margin:0 0 16px">{{ followExample }}</pre>

    <h3>Example — chat message</h3>
    <pre style="background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-1);overflow-x:auto;margin:0 0 16px">{{ chatExample }}</pre>

    <h2><mat-icon>network_ping</mat-icon>mDNS discovery</h2>
    <p>With <strong>Advertise via mDNS</strong> enabled, StreamTap announces itself on your
      local network using the service type <code>_streamtap._tcp</code>. Tools that support
      mDNS service discovery (like some overlay frameworks or Resonite) will find the server
      automatically — no need to hard-code a port or IP.</p>
    <p>Disable mDNS if you don't need auto-discovery or if you want to keep the server
      completely private to the machine it's running on.</p>

    <h2><mat-icon>security</mat-icon>Auth token</h2>
    <p>The auth token is optional. If you set one, connecting clients must send that exact
      string as their first WebSocket message. This prevents other apps on your local
      machine (or local network) from accidentally or intentionally subscribing to your
      event stream.</p>
    <p>For most home setups, leaving the token blank is fine. Set one if you're running
      Ottery Live on a shared machine or want additional control.</p>
  `,
})
export class StreamTapHelpComponent {
  readonly followExample = JSON.stringify(
    { type: 'follow', platform: 'twitch', username: 'CoolViewer', data: {}, ts: '2025-06-01T20:15:00.000Z' },
    null, 2,
  );
  readonly chatExample = JSON.stringify(
    { type: 'chat.message', platform: 'youtube', username: 'SomeViewer42', data: { message: 'Hello stream!' }, ts: '2025-06-01T20:15:12.000Z' },
    null, 2,
  );
}
