import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-interfaces',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Interfaces</h1>
    <p class="page-tagline">Browser-source overlays you drop directly into OBS — no streaming experience required.</p>

    <div class="callout">
      <mat-icon>open_in_browser</mat-icon>
      <span>Each interface is a local web page served by Ottery Live. In OBS, add a
        <strong>Browser Source</strong>, paste in the URL shown on the card, and the overlay
        appears on your stream. Settings changes take effect immediately — no refresh needed.</span>
    </div>

    <h2><mat-icon>chat</mat-icon>Chat overlay</h2>
    <p>Displays chat messages and event notifications from all your active platforms in a single
      scrolling feed. This is the overlay your viewers see on stream — it's separate from the
      Chat page in the sidebar, which is the read-only panel for you.</p>

    <h3>Colors tab</h3>
    <p>Assign a highlight color to each platform. Messages from Twitch might show in purple,
      YouTube in red, Kick in green — all configurable. Click <em>Reset to defaults</em> to
      restore the original platform brand colors.</p>

    <h3>Display tab</h3>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Message fade</td>
          <td>How long a message stays fully visible before fading out.
            Set to <em>Never</em> to keep all messages visible until the max messages limit is hit.
            A fade of 30–60 seconds keeps the overlay clean during busy streams.</td>
        </tr>
        <tr>
          <td>Font size</td>
          <td>Text size in pixels. Default is 14px. Bump it up for better readability
            on lower-resolution streams or if your overlay area is large.</td>
        </tr>
        <tr>
          <td>Max messages</td>
          <td>Once this many messages are visible, the oldest are removed.
            Prevents the overlay from accumulating hundreds of messages during a long stream.
            30–50 is usually a good range.</td>
        </tr>
      </tbody>
    </table>

    <h3>Platforms tab</h3>
    <p>Controls two things at once: which platforms are <strong>visible</strong> in the overlay,
      and which <strong>event types</strong> trigger a notification card per platform.</p>
    <ul>
      <li>Click a <strong>platform name</strong> to toggle whether its messages appear in the overlay.
        Hidden platforms are dimmed in the list and their events are filtered out.</li>
      <li>The checkboxes in each row control per-platform notification types: Follow, Sub, Gift Sub,
        Bits, Tip, and Redeem. Uncheck any you don't want to show.</li>
      <li>The <strong>OtteryLive notifications</strong> section at the bottom controls Ottery-specific
        event cards (credit redeems, credit balance checks, and now-playing songs).</li>
    </ul>

    <h2><mat-icon>music_note</mat-icon>Now Playing</h2>
    <p>Displays the currently playing Spotify track — track name, artist, album art, and a live
      progress bar. Designed to sit in a corner of the screen without taking up much space.</p>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Album art</td>
          <td>Shows the cover art large above the track name. Disable for a compact text-only bar
            that takes less screen real estate.</td>
        </tr>
        <tr>
          <td>Artist name</td>
          <td>Shows the artist's name below the track title. Disable to show only the track name.</td>
        </tr>
        <tr>
          <td>Progress bar</td>
          <td>An animated bar that fills as the song plays. Shows roughly how far you are through
            the current track.</td>
        </tr>
        <tr>
          <td>Submitter</td>
          <td>When a viewer requested the song, their name appears below the track info.
            Only shows up when the track was viewer-requested — your personal queue plays
            without attribution.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>queue_music</mat-icon>Music Queue</h2>
    <p>Shows what's coming up next in the song queue so viewers can see their requests in line.</p>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Songs to show</td>
          <td>How many upcoming tracks to display at once (1–10). Shows the next N songs in line
            after the current one.</td>
        </tr>
        <tr>
          <td>Show Now Playing</td>
          <td>Pins the currently-playing song at the top of the list so viewers can see what's
            playing and what's coming next in one place.</td>
        </tr>
        <tr>
          <td>Album art</td>
          <td>Small thumbnail cover art next to each song in the queue list.</td>
        </tr>
        <tr>
          <td>Requesters</td>
          <td>Shows the username of the viewer who added each song to the queue.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>flag</mat-icon>Goal: Single</h2>
    <p>One animated progress bar counting towards a single goal — e.g. "50 new followers
      tonight." The bar fills in real time as events arrive during your stream.</p>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td>Theme</td>
          <td>Visual style of the goal bar (colour, shape, animation style).</td>
        </tr>
        <tr>
          <td>Platform</td>
          <td>Which platform's events to count. Choose <em>All</em> to aggregate across
            every platform simultaneously.</td>
        </tr>
        <tr>
          <td>Metric</td>
          <td>What to count: follows, subscribers, gift subs, bits/cheers, or monetary tips.</td>
        </tr>
        <tr>
          <td>Target</td>
          <td>The goal number. The bar is full when this count is reached.</td>
        </tr>
        <tr>
          <td>Label</td>
          <td>Custom heading text above the bar — e.g. "Follower Goal!" or "Road to 1K Subs".
            Leave blank to auto-label based on the metric.</td>
        </tr>
      </tbody>
    </table>

    <div class="callout">
      <mat-icon>info</mat-icon>
      <span>Goal counts start from zero when the overlay loads — they count events from the
        current session, not your all-time totals.</span>
    </div>

    <h2><mat-icon>stacked_bar_chart</mat-icon>Goal: Multi</h2>
    <p>Up to four goal bars shown side by side — great for tracking multiple metrics or
      platforms simultaneously (e.g. Twitch subs, YouTube members, and total follows).</p>
    <p>Enable or disable each row with its checkbox. Each row has the same Platform / Metric /
      Target / Label options as the Single Goal. Disabled rows are hidden from the overlay.</p>
  `,
})
export class InterfacesHelpComponent {}
