import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HELP_STYLES } from '../help-styles';

@Component({
  selector: 'app-help-relay',
  standalone: true,
  imports: [MatIconModule],
  styles: [HELP_STYLES],
  template: `
    <h1 class="page-title">Remote Relay</h1>
    <p class="page-tagline">Push your stream once and let a server fan it out — ideal when your upload can't handle all platforms at once.</p>

    <h2><mat-icon>cell_tower</mat-icon>The problem it solves</h2>
    <p>Restreaming to four platforms simultaneously means pushing four separate video streams
      from your computer. At 8 Mb/s per platform that's 32 Mb/s of upload — more than most
      home connections can sustain.</p>
    <p>In <strong>Remote</strong> mode your computer pushes <em>one</em> stream to a relay server.
      The relay then fans it out to every platform. Your upload usage drops to a single stream
      regardless of how many destinations you have.</p>

    <div class="callout">
      <mat-icon>info</mat-icon>
      <span>OBS never needs to be reconfigured. It still points at <code>rtmp://localhost:1935/live</code>
        — switching between Local and Remote is a one-click toggle in Settings.</span>
    </div>

    <hr>

    <h2><mat-icon>dns</mat-icon>Setting up the relay server</h2>
    <p>The relay is a small standalone server (separate from the Ottery Live desktop app)
      that you run on a cloud VM — any provider works. A 2 vCPU / 2 GB RAM VM with a
      good uplink is enough for several simultaneous streams.</p>

    <h3>Requirements</h3>
    <ul>
      <li>Docker and Docker Compose (recommended) — or Node 22 + FFmpeg + openssl on the host</li>
      <li>Ports <code>3800</code> (API / Socket.io) and <code>1936</code> (RTMPS ingest) open in the firewall</li>
      <li>A public IP or hostname so Ottery Live can reach it over HTTPS</li>
    </ul>

    <h3>Step-by-step</h3>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Copy the relay files to your server</strong>
          <p>The <code>ottery-relay/</code> folder lives inside the Ottery Live source tree.
            Copy it to your VM (or clone the repo there) and enter the directory:</p>
          <pre class="code-block">cd ottery-relay
npm install --omit=dev</pre>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Configure environment variables</strong>
          <p>Create a <code>.env</code> file (or set these in your Docker Compose file):</p>
          <pre class="code-block">RELAY_PORT=3800
RELAY_RTMPS_PORT=1936
RELAY_DB_PATH=/app/data/relay.db
RELAY_RTMPS_KEY_PATH=/app/certs/server.key
RELAY_RTMPS_CERT_PATH=/app/certs/server.crt
RELAY_LOG_LEVEL=info</pre>
          <p>If the cert files don't exist yet, the server generates a self-signed certificate
            automatically on first boot. For a production server with a real domain, replace
            them with your own cert (e.g. from Let's Encrypt).</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <strong>Start the server (Docker Compose — recommended)</strong>
          <pre class="code-block">docker compose up -d</pre>
          <p>Or without Docker:</p>
          <pre class="code-block">node server.js</pre>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-body">
          <strong>Note your token from the first-boot output</strong>
          <p>On the very first start, the server prints your owner API token to the console
            and writes it to <code>data/initial-token.txt</code>. Copy it now —
            it is shown <strong>once only</strong>.</p>
          <pre class="code-block">docker compose logs relay | head -30</pre>
        </div>
      </div>
    </div>

    <div class="callout warn">
      <mat-icon>warning</mat-icon>
      <span>The relay server must be reachable over <strong>HTTPS</strong>. Ottery Live refuses to
        connect to a plain HTTP relay to protect your API token and stream keys in transit.</span>
    </div>

    <hr>

    <h2><mat-icon>manage_accounts</mat-icon>Adding users (sharing the server)</h2>
    <p>The relay uses CLI-based user management — there's no web signup. Each user gets their own
      API token that authenticates their Ottery Live instance to the server.</p>
    <p>Run these commands on the server (or inside the Docker container):</p>

    <table class="ref-table">
      <thead><tr><th>Command</th><th>What it does</th></tr></thead>
      <tbody>
        <tr>
          <td><code>node cli.js add-user &lt;name&gt;</code></td>
          <td>Creates a new user and prints their API token once. Share the token
            privately with that person (Signal, Discord DM, etc.) — not over public
            channels. The token is never recoverable after this point.</td>
        </tr>
        <tr>
          <td><code>node cli.js list-users</code></td>
          <td>Shows all users, their active/inactive status, and when they were created.</td>
        </tr>
        <tr>
          <td><code>node cli.js rotate-token &lt;name&gt;</code></td>
          <td>Generates a new token for the user. The old token stops working immediately.
            Use this if a token is compromised or a user loses theirs.</td>
        </tr>
        <tr>
          <td><code>node cli.js remove-user &lt;name&gt;</code></td>
          <td>Deactivates the user — their token is rejected from that moment on.
            Does not delete their row, so you have an audit trail.</td>
        </tr>
      </tbody>
    </table>

    <p>With Docker Compose, prefix the commands with <code>docker compose exec relay</code>:</p>
    <pre class="code-block">docker compose exec relay node cli.js add-user alice
docker compose exec relay node cli.js list-users</pre>

    <hr>

    <h2><mat-icon>settings_input_component</mat-icon>Connecting Ottery Live to the relay</h2>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Open Settings → Restream Mode</strong>
          <p>Switch the radio button from <em>Local</em> to <em>Remote</em>.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Enter the relay URL</strong>
          <p>This must be an HTTPS URL pointing at your server, e.g.
            <code>https://relay.yourserver.com</code>.
            Port 3800 is used by default — if your reverse proxy maps a standard 443
            endpoint you don't need to include the port.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <strong>Paste your API token</strong>
          <p>Click the <em>API token</em> field, paste the token you received when the
            user was created (or rotated), and press Save. The field is write-only —
            the token is stored in the OS keychain, never on disk in plaintext.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-body">
          <strong>Verify the connection</strong>
          <p>Click <em>Verify connection</em>. If everything is working you'll see
            <em>✓ Connected as &lt;username&gt;</em>. If it fails, check the URL, token,
            and that ports 3800 and 1936 are open in your firewall.</p>
        </div>
      </div>
    </div>

    <hr>

    <h2><mat-icon>live_tv</mat-icon>How it works during a stream</h2>
    <p>Once remote mode is active, your next stream works like this:</p>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>OBS connects to localhost:1935 as normal</strong>
          <p>Nothing changes in OBS — it has no idea a relay is involved.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Ottery Live sends your platform configs to the relay</strong>
          <p>Stream keys are sent over the encrypted HTTPS connection and held only in
            the relay's memory — they are never written to the relay's database or logs.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <strong>One FFmpeg process forwards your stream to the relay</strong>
          <p>Your computer pushes a single stream. The relay receives it over RTMPS
            and spins up one FFmpeg process per platform, pushing out to each destination.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-body">
          <strong>The Dashboard shows live status as normal</strong>
          <p>Platform cards show <em>via relay</em> badges when a platform is live
            through the relay. Viewer counts, events, and stats all work identically
            to local mode.</p>
        </div>
      </div>
    </div>

    <h2><mat-icon>swap_horiz</mat-icon>Automatic fallback</h2>
    <p>If the relay can't be reached at the start of a stream (network blip, server down),
      Ottery Live automatically falls back to local restreaming — the same FFmpeg-per-platform
      approach used in Local mode. A snackbar at the bottom of the Dashboard will tell you
      when this happens so you're not left wondering.</p>
    <p>Switching back to relay mode takes effect on the <em>next</em> stream start — it
      won't interrupt a stream in progress.</p>

    <hr>

    <h2><mat-icon>security</mat-icon>Security notes</h2>
    <ul>
      <li>The relay URL <strong>must be HTTPS</strong>. Plain HTTP is rejected to prevent
        your API token and stream keys from travelling unencrypted.</li>
      <li>Stream keys are held in memory only on the relay — they are never written to
        the database, log files, or any response body.</li>
      <li>The self-signed certificate the relay generates is fine for private use between
        you and a friend. For a server with a public domain, replace it with a
        certificate from a trusted CA (Let's Encrypt's <code>certbot</code> is free).</li>
      <li>Each user has their own token. Rotate a compromised token immediately with
        <code>node cli.js rotate-token &lt;name&gt;</code>.</li>
      <li>The relay has no open registration — only someone with server access can create accounts.</li>
    </ul>
  `,
})
export class RelayHelpComponent {}
