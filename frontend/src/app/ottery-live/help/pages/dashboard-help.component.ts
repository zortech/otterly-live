import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-dashboard',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Dashboard</h1>
    <p class="page-tagline">Your mission control while you're live.</p>

    <h2><mat-icon>sensors</mat-icon>Status bar</h2>
    <p>The bar at the very top tells you at a glance whether Ottery Live is receiving a stream
      from OBS.</p>
    <table class="ref-table">
      <tbody>
        <tr>
          <td>Pulsing green dot</td>
          <td>OBS is actively sending video — Ottery Live is live and restreaming to your platforms.</td>
        </tr>
        <tr>
          <td>Grey dot</td>
          <td>OBS is not connected (hasn't started streaming yet, or has stopped).</td>
        </tr>
        <tr>
          <td>Timer</td>
          <td>Counts up from the moment your current stream started. Resets when OBS disconnects.</td>
        </tr>
        <tr>
          <td>RTMP address</td>
          <td>The address shown (<code>rtmp://localhost:1935/live</code>) is a reminder of what to put in OBS's Server field.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>stream</mat-icon>Platform cards</h2>
    <p>Each card represents one of your configured platforms. At a glance you can see which
      platforms are live and which aren't.</p>
    <table class="ref-table">
      <thead><tr><th>Element</th><th>What it means</th></tr></thead>
      <tbody>
        <tr>
          <td>Green dot / "Live"</td>
          <td>Ottery Live is actively restreaming to this platform right now.</td>
        </tr>
        <tr>
          <td>Grey dot / "Idle"</td>
          <td>This platform is configured but not currently receiving the stream.</td>
        </tr>
        <tr>
          <td>Red / error state</td>
          <td>Restreaming to this platform failed — usually a bad stream key or the platform's
            ingest server refused the connection. Check the key in Platforms.</td>
        </tr>
        <tr>
          <td>Viewer count</td>
          <td>Current live viewers pulled from the platform's API. Not all platforms expose this.</td>
        </tr>
        <tr>
          <td>Stop button</td>
          <td>Stops restreaming to <em>this platform only</em>. All other platforms keep running.</td>
        </tr>
        <tr>
          <td>Start button</td>
          <td>Manually kicks off restreaming to this platform (only visible when OBS is connected and the platform is idle).</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>bolt</mat-icon>Event feed</h2>
    <p>The scrolling panel shows every live event from all platforms in real time: follows,
      subscriptions, superchats, gift subs, cheers, bits, tips, redeems, and chat messages.
      Each event shows the platform it came from, the viewer's name, and any relevant details
      (amount, message text, tier, etc.).</p>
    <p>The feed is live-only — it only shows events from the current session.
      For historical data see <strong>Event Log</strong>.</p>

    <h2><mat-icon>stop_circle</mat-icon>Stop All</h2>
    <p>Stops restreaming to every active platform simultaneously. Ottery Live asks you to
      confirm before stopping — mid-stream this ends your broadcast on all destinations at once.</p>

    <div class="callout">
      <mat-icon>info</mat-icon>
      <span>Stopping platforms from the Dashboard doesn't disconnect OBS. OBS continues sending
        video to Ottery Live; you're just choosing not to forward it anywhere. You can restart
        individual platforms from their cards without restarting OBS.</span>
    </div>

    <h2><mat-icon>add_circle</mat-icon>Platforms shortcut</h2>
    <p>If you haven't set up any platforms yet, the Dashboard shows a prompt to add one.
      Click it to jump straight to the Platform Management page.</p>
  `,
})
export class DashboardHelpComponent {}
