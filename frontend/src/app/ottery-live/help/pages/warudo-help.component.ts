import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-warudo',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Warudo Relay</h1>
    <p class="page-tagline">Make your VTuber avatar react to follows, subs, donations, and more — automatically.</p>

    <h2><mat-icon>sensors</mat-icon>What it does</h2>
    <p>Warudo is VTuber avatar software with a built-in WebSocket server. Ottery Live can
      connect outbound to that server and forward every stream event in real time.</p>
    <p>This means you can build Warudo blueprints that trigger avatar animations, particle
      effects, sound effects, or scene changes whenever your viewers follow, subscribe, donate,
      send bits, redeem channel points, and more — with data from every platform you stream to,
      all unified.</p>
    <p><strong>No Warudo plugin is required.</strong> Ottery Live connects to Warudo's native
      WebSocket server. You just need Warudo running and the relay enabled.</p>

    <h2><mat-icon>settings</mat-icon>Setup</h2>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Enable Warudo's WebSocket server</strong>
          <p>In Warudo: <strong>Settings → Scripting &amp; SDK</strong>. Make sure the
            WebSocket server is toggled on. The default port is 19190.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Enable the relay in Ottery Live</strong>
          <p>Go to <strong>Settings → Warudo Relay</strong> and toggle <em>Enable Warudo relay</em> on.
            Leave host as <code>localhost</code> and port as <code>19190</code> unless you've
            changed Warudo's defaults or are running Warudo on a different PC.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <strong>Build blueprints in Warudo</strong>
          <p>Use Warudo's Blueprint system. Add an <em>On WebSocket Message Received</em> node,
            then wire it to whatever avatar reaction you want. Parse the JSON payload to get the
            event type, platform, username, and data.</p>
        </div>
      </div>
    </div>

    <h2><mat-icon>code</mat-icon>Event payload format</h2>
    <p>Ottery Live sends the same event JSON as StreamTap. Each event is a text WebSocket frame:</p>
    <table class="ref-table">
      <thead><tr><th>Field</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td>type</td><td>Event type: <code>follow</code>, <code>subscribe</code>, <code>subscribe.gift</code>, <code>cheer</code>, <code>tip</code>, <code>redeem</code>, <code>chat.message</code></td></tr>
        <tr><td>platform</td><td>Where it came from: <code>twitch</code>, <code>youtube</code>, <code>kick</code>, etc.</td></tr>
        <tr><td>username</td><td>The viewer's display name</td></tr>
        <tr><td>data</td><td>Extra details — sub tier, amount, message text, currency, redeem name, etc.</td></tr>
        <tr><td>ts</td><td>ISO 8601 timestamp</td></tr>
      </tbody>
    </table>

    <h2><mat-icon>wifi_off</mat-icon>Reconnection</h2>
    <p>If Warudo is not running when the relay is enabled, Ottery Live will keep retrying
      in the background. Once Warudo opens and its WebSocket server is ready, the relay
      connects automatically — you don't have to toggle it off and back on.</p>

    <div class="callout warn">
      <mat-icon>warning</mat-icon>
      <span>If you change the <strong>host or port</strong> in Settings, toggle the relay off
        and back on to apply the change. A live WebSocket connection doesn't update mid-session.</span>
    </div>

    <h2><mat-icon>devices</mat-icon>Warudo on a different PC</h2>
    <p>If Warudo runs on a separate machine on your local network, change the <strong>Warudo host</strong>
      setting from <code>localhost</code> to that machine's local IP address
      (e.g. <code>192.168.1.20</code>). The port stays 19190 unless you've changed it.</p>
    <p>Make sure your firewall on the Warudo machine allows inbound connections on port 19190.</p>
  `,
})
export class WarudoHelpComponent {}
