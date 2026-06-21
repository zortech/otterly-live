# App Settings

App-wide settings that don't belong to a specific StreamService.
Stored in SQLite (`settings` table). Sensitive values stored in OS keychain via `keytar`.

## Settings Schema

```js
// server/db/migrations/004_create_settings.js
exports.up = (knex) =>
  knex.schema.createTable('settings', (t) => {
    t.string('key').primary();
    t.text('value');           // JSON-serialized; strings, numbers, booleans
    t.timestamps(true, true);
  });
```

## Canonical Settings List

| Key | Type | Default | Storage | Description |
|-----|------|---------|---------|-------------|
| `rtmp.incomingKey` | string | `"ottery"` | keychain | The stream key OBS must use to push to Ottery Live |
| `rtmp.port` | number | `1935` | SQLite | RTMP server listen port. Windows may block 1935 — user can change to e.g. 19350 |
| `server.port` | number | `3737` | SQLite | Express/Socket.io listen port |
| `stream.autoStartOnOBSConnect` | boolean | `true` | SQLite | Start all auto-start platforms when OBS connects |
| `stream.stopCaptureOnStreamEnd` | boolean | `false` | SQLite | Stop event capture when OBS disconnects (default: keep running) |
| `app.minimizeToTray` | boolean | `true` | SQLite | Close button minimizes to tray instead of quitting |
| `app.checkForUpdates` | boolean | `true` | SQLite | Auto-check for updates on startup |
| `app.logLevel` | string | `"info"` | SQLite | Log verbosity: `error`, `warn`, `info`, `debug` |
| `streamtap.enabled` | boolean | `false` | SQLite | Enable/disable the StreamTap WebSocket server |
| `streamtap.port` | number | `4747` | SQLite | Port StreamTap listens on. Requires restart to change. |
| `streamtap.authToken` | string | `""` | keychain | Optional auth token for external clients. Empty = open access. |
| `warudo.enabled` | boolean | `false` | SQLite | Enable/disable the Warudo relay (connects to Warudo's WebSocket) |
| `warudo.host` | string | `"localhost"` | SQLite | Warudo WebSocket host |
| `warudo.port` | number | `19190` | SQLite | Warudo WebSocket port |
| `overlay.chat.platformColors` | object | platform defaults | SQLite | Per-platform hex color map `{ twitch: "#9146ff", ... }` |
| `overlay.chat.fadeTimeout` | number | `0` | SQLite | Seconds before a chat message fades out. `0` = never fade. |
| `overlay.chat.hiddenPlatforms` | string[] | `[]` | SQLite | Platforms whose chat messages are hidden from the overlay |
| `overlay.chat.fontSize` | number | `14` | SQLite | Chat overlay font size in px |
| `overlay.chat.maxMessages` | number | `30` | SQLite | Maximum visible chat messages before oldest are removed |
| `music.songQueueRetentionDays` | number | `180` | SQLite | Days to keep played/removed song queue entries before cleanup |
| `credits.transactionRetentionDays` | number | `90` | SQLite | Days to keep credit transaction history before cleanup |
| `relay.mode` | string | `"local"` | SQLite | Restream mode: `"local"` (FFmpeg on this machine) or `"remote"` (relay server fan-out) |
| `relay.url` | string | `""` | SQLite | Base URL of the relay server, e.g. `https://relay.example.com` |
| `relay.apiToken` | string | `""` | **keychain** | API token for authenticating with the relay server (256-bit random hex) |
| `relay.caCert` | string | `""` | SQLite | PEM cert to pin a self-signed relay (TLS still verified against it). Preferred over disabling verification |
| `relay.allowSelfSigned` | boolean | `false` | SQLite | Escape hatch: disable TLS verification for the relay connection. **MITM-unsafe** — use `relay.caCert` instead unless impossible |

> TLS: by default the relay connection is verified against the system trust
> store. For a self-signed relay, set `relay.caCert` to pin its certificate.
> `relay.allowSelfSigned` is a last resort and is logged loudly when active.

## Overlay Settings Pattern

Overlay apps (e.g. `/overlays/chat`) run in OBS browser sources or separate browser
tabs — completely isolated browser contexts with their **own** `localStorage`. Settings
written to the dashboard's `localStorage` are never visible to the overlay, and
`storage` events do not cross context boundaries.

**Rule: overlay settings must be stored server-side (SQLite via `PUT /api/settings`).**

### How it works

1. **Dashboard saves** a setting via `PUT /api/settings` with an `overlay.*` key.
2. **Server persists** it to SQLite and emits `ottery:overlay-settings` via Socket.io
   with the full set of current `overlay.*` settings as a flat object.
3. **Overlay receives** the socket event and updates its Angular signals immediately.
4. **Overlay also polls** `GET /api/settings` every 30 seconds as a fallback (handles
   browser-source reloads and the initial load before any change is made in the dashboard).

```
Dashboard (PUT /api/settings)
  → server saves to SQLite
  → io.emit('ottery:overlay-settings', { 'overlay.chat.fontSize': 18, ... })
  → Overlay SocketService receives it → OverlaySettingsService updates signals
```

### Adding a new overlay setting

1. Add the key + default to the `Canonical Settings List` table in this doc.
2. In `overlays/src/app/overlay-settings.service.ts`, add a `signal()` and handle the
   key in `applySettings()`.
3. In `frontend/.../interfaces.component.ts`, add a `signal()`, read it in `ngOnInit`
   from `settingsSvc.settings()`, and call `settingsSvc.set(key, value)` on change.
4. Do **not** use `localStorage` in either the overlay or the dashboard for overlay
   settings — it will not work cross-context.

## Settings Module

```js
// server/settings.js
const keytar = require('keytar');
const db = require('./db/knex');

const KEYCHAIN_SERVICE = 'ottery-live-settings';

// Fields stored in OS keychain rather than SQLite plaintext
const KEYCHAIN_KEYS = new Set(['rtmp.incomingKey', 'streamtap.authToken', 'relay.apiToken']);

const DEFAULTS = {
  'rtmp.port': 1935,
  'server.port': 3737,
  'stream.autoStartOnOBSConnect': true,
  'stream.stopCaptureOnStreamEnd': false,
  'app.minimizeToTray': true,
  'app.checkForUpdates': true,
  'app.logLevel': 'info',
  'rtmp.incomingKey': 'ottery',
  'streamtap.enabled': false,
  'streamtap.port': 4747,
  'streamtap.authToken': '',
  'relay.mode': 'local',
  'relay.url': '',
  'relay.apiToken': '',
  'relay.caCert': '',
  'relay.allowSelfSigned': false,
};

const settings = {
  async get(key) {
    if (KEYCHAIN_KEYS.has(key)) {
      return (await keytar.getPassword(KEYCHAIN_SERVICE, key)) ?? DEFAULTS[key] ?? null;
    }
    const row = await db('settings').where({ key }).first();
    if (!row) return DEFAULTS[key] ?? null;
    return JSON.parse(row.value);
  },

  async set(key, value) {
    if (KEYCHAIN_KEYS.has(key)) {
      await keytar.setPassword(KEYCHAIN_SERVICE, key, String(value));
      return;
    }
    await db('settings')
      .insert({ key, value: JSON.stringify(value) })
      .onConflict('key').merge();
  },

  async getAll() {
    const rows = await db('settings');
    const result = { ...DEFAULTS };
    for (const row of rows) {
      if (!KEYCHAIN_KEYS.has(row.key)) result[row.key] = JSON.parse(row.value);
    }
    // Keychain values fetched separately — never returned in bulk for security
    return result;
  },

  // Returns settings safe to send to the frontend (no secrets)
  async getPublic() {
    const all = await this.getAll();
    return Object.fromEntries(
      Object.entries(all).filter(([k]) => !KEYCHAIN_KEYS.has(k))
    );
  },
};

module.exports = settings;
```

## API Endpoints

```
GET  /api/settings         Returns public settings (no keychain values)
PUT  /api/settings         Update one or more settings { key, value }

GET  /api/settings/status  Returns whether sensitive settings are configured:
                           { rtmpKeyConfigured: true }
```

Keychain-backed settings are **write-only** from the API — the frontend never receives them.
Status endpoint lets the UI show "Configured ✓" or "Not set" without exposing values.

## Settings UI

Route: `/ottery-live/settings`

Sections:

### OBS Connection
| Setting | UI | Note |
|---|---|---|
| Incoming stream key | Masked input (write-only) | Key OBS must use; default "ottery" |
| RTMP port | Number input | Default 1935; requires restart |
| Server port | Number input | Default 3737; requires restart |

### Behaviour
| Setting | UI | Note |
|---|---|---|
| Auto-start platforms on OBS connect | Toggle | |
| Keep event capture running after stream ends | Toggle | |
| Minimize to tray on close | Toggle | |

### StreamTap
| Setting | UI | Note |
|---|---|---|
| Enable StreamTap | Toggle | Starts/stops server immediately; no restart needed |
| Port | Number input | Default 4747; requires app restart to change |
| Auth token | Masked input + [Clear] button | Write-only; empty = open access |

### Warudo
| Setting | UI | Note |
|---|---|---|
| Enable Warudo relay | Toggle | Connects/disconnects immediately; no restart needed |
| Host | Text input | Default `localhost` |
| Port | Number input | Default `19190`; reconnects automatically on change after re-toggle |

See [WARUDO_RELAY.md](WARUDO_RELAY.md) for full details.

When enabled, show a read-only connection info box:
> **Connect to:** `ws://localhost:4747`
> Events are broadcast as newline-delimited JSON.

See [STREAMTAP.md](STREAMTAP.md) for full details.

### Restream Mode
| Setting | UI | Note |
|---|---|---|
| Restream mode | Radio: Local / Remote | Default Local; switching while streaming is deferred to next stream start |
| Relay server URL | Text input | Only shown when Remote selected; e.g. `https://relay.example.com` |
| API token | Masked input (write-only) + [Verify] button | Only shown when Remote selected; stored in OS keychain |

The **[Verify]** button calls `GET /api/me` on the relay and shows inline:
- `✓ Connected — plan: free · 0 active sessions`
- `✗ Invalid token`
- `✗ Cannot reach relay (check URL)`

See [REMOTE_RELAY.md](REMOTE_RELAY.md) for full relay server details.

### App
| Setting | UI | Note |
|---|---|---|
| Check for updates automatically | Toggle | |
| Log level | Dropdown | error / warn / info / debug |
| [Open log folder] | Button | Opens userData/logs in file explorer |

## Port Change Restart Warning

When RTMP or server port is changed, show a banner:

> "Port changes take effect after restarting Ottery Live. OBS must be updated to use the new RTMP port."

Angular connects to Socket.io using a port stored in `window.otteryElectron.serverPort`
(injected by the preload script from the settings at launch), so the frontend always knows
the correct port even if it was changed.

```js
// electron/preload.js
const { ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('otteryElectron', {
  serverPort: process.env.OTTERY_SERVER_PORT || 3737,  // set by main before preload runs
  // ...other bridge methods
});
```

## Initialization on Startup

Settings are loaded once at startup and cached in memory for hot reads.
The cache is invalidated when `settings.set()` is called.

```js
// server/index.js
const settings = require('./settings');

async function startServer() {
  const port = await settings.get('server.port');
  const rtmpPort = await settings.get('rtmp.port');
  // ... start express on port, nms on rtmpPort
}
```
