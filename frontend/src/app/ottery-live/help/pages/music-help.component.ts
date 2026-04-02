import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-music',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Music</h1>
    <p class="page-tagline">Viewer-requested songs from Spotify, with a live queue your audience can see.</p>

    <h2><mat-icon>queue_music</mat-icon>How it works</h2>
    <p>Ottery Live integrates with Spotify so your viewers can request songs directly from chat.
      Requests are added to a queue that you (and your viewers through the Music Queue overlay)
      can see. Ottery Live controls Spotify playback — skipping, queuing, and auto-advancing
      tracks.</p>
    <p>The integration uses <strong>Bring Your Own Credentials (BYOC)</strong> — you create a
      free Spotify developer app and plug in its Client ID and Secret. This means there's no
      shared API quota, no third-party middleman, and your music data stays entirely under your
      control.</p>

    <h2><mat-icon>key</mat-icon>Connecting Spotify</h2>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Create a Spotify app</strong>
          <p>Go to <strong>developer.spotify.com → Dashboard → Create App</strong>.
            Name it anything (e.g. "My Stream Music"). Set the <strong>Redirect URI</strong>
            to exactly: <code>http://localhost:8888/callback</code></p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Copy your credentials</strong>
          <p>On your Spotify app's settings page, copy the <strong>Client ID</strong> and
            <strong>Client Secret</strong>. Paste them into the fields on the Music page.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <strong>Authorize</strong>
          <p>Click <strong>Connect Spotify</strong>. Your browser opens to Spotify's authorization
            page. Log in with the Spotify account you stream from, approve the permissions, and
            you're redirected back. Ottery Live handles token refresh from this point on — you
            only need to authorize once.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-body">
          <strong>Play something in Spotify</strong>
          <p>Spotify's API requires an active playback session. Open Spotify on any device and
            start playing something — then Ottery Live can control it.</p>
        </div>
      </div>
    </div>

    <h2><mat-icon>chat</mat-icon>Viewer commands</h2>
    <table class="ref-table">
      <thead><tr><th>Command</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td><code>!sr [song or URL]</code></td>
          <td>Request a song. Search by title, artist, or paste a Spotify track URL directly.
            Ottery Live confirms the request in chat and adds it to the queue.</td>
        </tr>
        <tr>
          <td><code>!queue</code></td>
          <td>Shows the current song queue in chat — the next few upcoming tracks.</td>
        </tr>
        <tr>
          <td><code>!song</code></td>
          <td>Shows what's currently playing, who requested it (if anyone), and the track time.</td>
        </tr>
        <tr>
          <td><code>!skip</code></td>
          <td>Casts a vote to skip the current song. When enough viewers vote, the track skips.</td>
        </tr>
      </tbody>
    </table>

    <h2><mat-icon>admin_panel_settings</mat-icon>Moderator &amp; streamer commands</h2>
    <table class="ref-table">
      <thead><tr><th>Command</th><th>What it does</th></tr></thead>
      <tbody>
        <tr><td><code>!skip force</code></td><td>Immediately skips the current track without waiting for a vote.</td></tr>
        <tr><td><code>!remove [n]</code></td><td>Removes the song at position <em>n</em> from the queue.</td></tr>
        <tr><td><code>!ban [username]</code></td><td>Prevents a viewer from making song requests.</td></tr>
        <tr><td><code>!unban [username]</code></td><td>Re-allows a previously banned viewer to request songs.</td></tr>
        <tr><td><code>!volume [0–100]</code></td><td>Sets the Spotify playback volume.</td></tr>
      </tbody>
    </table>

    <h2><mat-icon>tune</mat-icon>Queue settings</h2>
    <table class="ref-table">
      <thead><tr><th>Setting</th><th>What it does</th></tr></thead>
      <tbody>
        <tr><td>Max requests per viewer</td><td>How many songs a single viewer can have in the queue at once. Prevents one viewer from flooding the queue.</td></tr>
        <tr><td>Allow explicit content</td><td>Whether requests for tracks flagged explicit by Spotify are allowed.</td></tr>
        <tr><td>Skip vote threshold</td><td>How many <code>!skip</code> votes are needed to force-skip a track.</td></tr>
        <tr><td>Auto-advance</td><td>When the queue runs out of requests, Ottery Live lets Spotify play normally from wherever it left off.</td></tr>
      </tbody>
    </table>

    <h2><mat-icon>widgets</mat-icon>Overlays</h2>
    <p>The <strong>Now Playing</strong> and <strong>Music Queue</strong> overlays in the
      Interfaces page connect directly to the Music feature. Add them as browser sources
      in OBS so your viewers can see what's playing and what's coming up next.</p>
  `,
})
export class MusicHelpComponent {}
