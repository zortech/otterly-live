# Component 4: Platform Management

Platform Management is where operators configure each streaming platform:
RTMP endpoints, stream keys, API credentials, and per-platform feature toggles.

## Route

```
/ottery-live/platforms            → Platform list
/ottery-live/platforms/new        → Add new platform
/ottery-live/platforms/:id        → Edit platform settings
```

## Platform List View

```
┌──────────────────────────────────────────────────────────────────────┐
│  Platform Management                              [+ Add Platform]    │
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  ● Twitch          @myusername                                 │  │
│  │    Restream: ON   Event Capture: ON   [Edit] [Test] [Disable]  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  ⚠ TikTok          @myusername                                 │  │
│  │    Restream: ON   Event Capture: ON (unofficial)               │  │
│  │    [Edit] [Test] [Disable]                                     │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  ○ Joystick.tv     (not configured)                            │  │
│  │    [Configure]                                                 │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## Platform Edit Form Sections

### 1. Basic Settings

| Field         | Description                                     |
|---------------|-------------------------------------------------|
| Display Name  | User-facing label (e.g., "My Twitch Channel")  |
| Platform      | Read-only after creation; shapes the rest of the form |
| Username      | Platform handle (used for event capture API)   |
| Active        | Soft-disable without deleting                   |

### 2. RTMP Settings

| Field       | Description                                               |
|-------------|-----------------------------------------------------------|
| RTMP URL    | Pre-filled per platform; editable for custom ingest URLs  |
| Stream Key  | Masked input — written to OS keychain, never returned     |
| [Test RTMP] | Sends a 5-second color-bar test stream to the endpoint    |

Stream key is **write-only**: once saved it shows `••••••••` and cannot be read back.
To update, type a new key and save.

### 3. Event Capture Settings

| Field                   | Description                               |
|-------------------------|-------------------------------------------|
| Event Capture Enabled   | Toggle on/off for this platform           |
| API Client ID           | Write-only; stored in OS keychain         |
| API Client Secret       | Write-only; stored in OS keychain         |
| [Connect Account]       | Opens OAuth flow in system browser        |
| Token Status            | "Valid until [date]", "Expired", or "Not connected" |
| [Test Connection]       | Runs capture worker for 10 seconds        |

### 4. Platform-Specific Settings

**Twitch:** EventSub subscription list (checklist of event types to enable), channel ID (auto-fetched after auth)

**YouTube:**
> ⚠️ `youtube.readonly` is a **sensitive OAuth scope** — Google requires a verified consent
> screen + demo video before real users can authorize. During development, add up to 100 test
> users in Google Cloud Console. Budget several weeks for Google's review before public release.

YouTube setup flow:
1. User creates a Google Cloud Console project and OAuth client (type: Desktop App)
2. [Connect YouTube Account] — opens OAuth in system browser (`http://localhost:{port}` redirect)
3. After authorization: channel ID auto-fetched from `GET https://www.googleapis.com/youtube/v3/channels?part=id&mine=true`
4. Stream key: static (`isReusable: true`) — entered once, no session-specific rotation needed

The YouTube platform form shows:
- [Connect YouTube Account] → OAuth flow
- Token status ("Valid until..." / "Expired") — refresh tokens are indefinitely valid
- Channel ID (read-only, auto-fetched after auth)
- Stream key field (write-only, entered once)
- RTMP URL: `rtmp://a.rtmp.youtube.com/live2` (pre-filled, locked)

> **Quota warning panel** (shown if user has not created their own GCP project):
> "YouTube enforces a quota of 10,000 API units/day per Google Cloud project. To avoid
> sharing quota with other users, create your own GCP project. [How to set up ↗]"

**Kick:** Developer registration at [dev.kick.com](https://dev.kick.com) — self-service, instant,
requires 2FA. After OAuth (`streamkey:read` scope), stream key and RTMP URL are **auto-fetched**
from the official API — no manual copy-paste required. Channel slug and Pusher chatroom ID
are also auto-fetched from `GET https://kick.com/api/v2/channels/{username}`.

The Kick platform form shows only:
- [Connect Kick Account] — opens OAuth in system browser
- Token status ("Valid until..." / "Expired")
- Stream key status: "Auto-configured ✓" or "Not connected"

No manual stream key entry needed for Kick.

**TikTok:**
> ⚠️ TikTok event capture uses an unofficial client library. Stability is not guaranteed.
> API may break without notice.

Room ID (optional override; usually auto-detected from username)

#### TikTok RTMP Access Requirements

Before the stream key section is shown, display an access check:

> **Do you have TikTok LIVE OBS access?**
> RTMP streaming requires joining a free TikTok Creator Network.
> [Learn how to get access ↗] (opens toktutorials.com/list-of-agencies)

Once the user confirms they have access, the stream key section appears below.

#### TikTok Session Stream Key

TikTok generates a **new stream key per session** — it cannot be pre-configured and
reused. The user must copy a fresh key from [livecenter.tiktok.com/producer](https://livecenter.tiktok.com/producer)
before every stream.

**UX flow:**

The TikTok platform form has a dedicated "Session Stream Key" section that is separate
from the main RTMP settings:

```
┌─ TikTok Stream Key ──────────────────────────────────────────────┐
│  Get a fresh key from TikTok Live Center before each stream.     │
│                                                                   │
│  Stream key  [ ________________________ ]  [Paste & Save]        │
│              Last updated: never                                  │
│                                                                   │
│  [Open TikTok Live Center ↗]                                     │
└───────────────────────────────────────────────────────────────────┘
```

- **[Open TikTok Live Center ↗]** calls `shell.openExternal('https://livecenter.tiktok.com/producer')`
- **Last updated** timestamp shows when the key was last saved, so the user knows if it's stale
- The key field accepts paste; [Paste & Save] saves in one click
- The RTMP URL (`rtmp://global-push.tiktok.com/live`) is fixed for all TikTok accounts — only
  the stream key changes. The URL field is pre-filled and locked for TikTok.

**Pre-stream reminder:** If the TikTok stream key was last updated more than 4 hours ago
and the user clicks **Start All** or the TikTok-specific start button, show a confirmation:

> "Your TikTok stream key may be expired. TikTok generates a new key for each session.
> [Update Key] [Start Anyway]"

**Error handling:** If FFmpeg exits quickly after starting the TikTok stream (within 30s),
surface a specific error:

> "TikTok stream failed to connect. Your stream key may have expired.
> [Update Key]"

**X:**
> ⚠️ X requires **X Premium or Premium+** to stream. Event capture is not available
> at any API tier. Restream only.

X has no static RTMP URL — each source has a unique URL generated per-account in
X Media Studio. The form guides the user to retrieve it:

```
┌─ X Stream Setup ──────────────────────────────────────────────────┐
│  X generates a unique RTMP URL per source. You only need to       │
│  do this once per source.                                         │
│                                                                   │
│  1. [Open X Media Studio ↗]                                       │
│  2. Sources → Create Source → RTMP → choose region               │
│  3. Copy the RTMP URL and Stream Key below                        │
│                                                                   │
│  RTMP URL    [ ________________________________ ]                  │
│  Stream Key  [ ________________________ ]  [Save]                 │
└───────────────────────────────────────────────────────────────────┘
```

- **[Open X Media Studio ↗]** calls `shell.openExternal('https://studio.twitter.com')`
- Unlike TikTok, the X source URL is **persistent** — copy it once and it doesn't change

**Joystick.tv:**
Joystick.tv event capture works as a **bot integration** using their official Action Cable
WebSocket (`wss://joystick.tv/cable`). OAuth credentials must be requested from Joystick.tv
directly — there is no self-service developer portal.

| Field | Description |
|---|---|
| Bot Username | Your bot or account username on Joystick.tv |
| [Connect Account] | OAuth flow (loopback redirect — `http://127.0.0.1:{port}/auth`) |
| Token Status | Valid / Expired |
| [Test Connection] | Connects to GatewayChannel for 10 seconds to confirm events arrive |

> To obtain OAuth credentials, contact Joystick.tv support or their developer Discord.
> Once credentials are issued, setup is the same OAuth flow as other platforms.

### 5. Restream Toggles

| Toggle                    | Meaning                                              |
|---------------------------|------------------------------------------------------|
| Include in "Start All"    | This platform starts when "Start All" is pressed     |
| Start with OBS connect    | Auto-start restream when OBS begins publishing       |
| Start event capture with restream | Auto-start capture on OBS connect          |

## OAuth Flow (Electron)

Two OAuth redirect mechanisms are used depending on the platform. The server-side
`POST /api/stream-services/:id/oauth/start` returns which mechanism to use.

### Mechanism A — Custom URI Scheme (Twitch, Kick, Joystick)

Platforms that accept a custom URI scheme as redirect URI:

```
ottery-live://oauth/callback?code=...&state=...
```

The OS intercepts the redirect URL and hands it back to the Electron app.

```js
// electron/main.js
if (process.defaultApp) {
  app.setAsDefaultProtocolClient('ottery-live', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('ottery-live');
}

// macOS: catch URL from open-url event
app.on('open-url', (event, url) => handleOAuthCallback(url));

// Windows/Linux: catch URL from second-instance event
app.on('second-instance', (_event, argv) => {
  const url = argv.find(arg => arg.startsWith('ottery-live://'));
  if (url) handleOAuthCallback(url);
});
```

**Flow:**
```
1. User clicks [Connect Account]
2. Frontend calls POST /api/stream-services/:id/oauth/start
3. Server returns { authUrl: "https://id.twitch.tv/oauth2/authorize?...", mechanism: "uri_scheme" }
   where redirect_uri = "ottery-live://oauth/callback"
4. Server opens URL in system browser via shell.openExternal(authUrl)
5. User approves in browser
6. Platform redirects to: ottery-live://oauth/callback?code=...&state=serviceId
7. Electron catches it via open-url / second-instance
8. Electron sends URL to server: POST /api/oauth/callback { url }
9. Server exchanges code for tokens; saves to keychain
10. Frontend is notified via Socket.io: { event: 'oauth.complete', serviceId }
```

### Mechanism B — Localhost Loopback (YouTube)

Google OAuth does **not** accept custom URI schemes — it requires a registered
`http://localhost:{port}` redirect URI. The server spins up a temporary HTTP listener
to catch the callback, then shuts it down.

```js
// server/auth/oauth-loopback.js
async function startLoopbackListener(port, state) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.searchParams.get('state') === state) {
        res.end('<html><body>Authorization complete. You can close this tab.</body></html>');
        server.close();
        resolve(url.searchParams.get('code'));
      }
    });
    server.listen(port);
  });
}
```

**Flow:**
```
1. User clicks [Connect YouTube Account]
2. Frontend calls POST /api/stream-services/:id/oauth/start
3. Server picks an available local port (e.g. 7878), starts loopback listener
4. Server returns { authUrl: "https://accounts.google.com/o/oauth2/auth?...", mechanism: "loopback" }
   where redirect_uri = "http://localhost:7878"
5. Server opens URL in system browser
6. User approves — Google redirects to http://localhost:7878?code=...&state=...
7. Loopback server receives request, resolves promise with code
8. Server exchanges code for tokens; saves to keychain
9. Frontend is notified via Socket.io: { event: 'oauth.complete', serviceId }
```

The loopback port does not need to match the Express server port.
Pick any available ephemeral port.

### Platform → Mechanism Map

| Platform | Mechanism | Redirect URI registered with platform |
|---|---|---|
| Twitch | URI Scheme (DCF — no redirect URI needed) | N/A — Device Code Grant has no redirect |
| YouTube | Loopback | `http://localhost:{port}` in GCP Console |
| Kick | URI Scheme | `http://localhost:{port}/callback` (NextJS bug — use localhost not 127.0.0.1) |
| Joystick | URI Scheme | `http://127.0.0.1:{port}/auth` (loopback) |
| TikTok | No OAuth | Username only; no OAuth flow |
| X | No OAuth | RTMP URL + stream key entered manually |

> **Kick note:** Kick's redirect must be registered as `http://localhost:{port}/callback`.
> Despite the `localhost` form, the server still receives it — Kick's NextJS auth UI
> rewrites `127.0.0.1` to `localhost`, so using `localhost` in the registered URI avoids mismatch.

### State Parameter

`state` encodes `serviceId` (and a CSRF nonce) so the callback knows which
StreamService to update:

```js
const state = Buffer.from(JSON.stringify({ serviceId, nonce: crypto.randomUUID() })).toString('base64');
```

Nonces are stored in-memory (Map) and expire after 10 minutes. Single-use.

## RTMP Test Flow

1. User clicks **[Test RTMP]**
2. Frontend calls `POST /api/stream-services/:id/test-rtmp`
3. Server fetches credentials from keychain
4. Spawns FFmpeg with a synthetic test source for 5 seconds:
   ```bash
   ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30 \
          -f lavfi -i sine=frequency=440 \
          -t 5 -c:v libx264 -preset ultrafast -c:aac -f flv \
          rtmp://{url}/{key}
   ```
5. Server returns `{ success: true }` or `{ success: false, error: "..." }`
6. Frontend shows result in a dialog

## Event Capture Test Flow

1. User clicks **[Test Connection]**
2. Frontend calls `POST /api/stream-services/:id/test-capture`
3. Server starts the capture worker; waits up to 10 seconds for a `connected` event
4. Returns `{ connected: true }` or `{ connected: false, reason: "..." }`
5. Worker is stopped after test

## Angular Components

```
frontend/src/app/ottery-live/platform-management/
├── platform-list.component.ts
├── platform-form.component.ts            # Tabs: Basic / RTMP / Events / Toggles
├── sections/
│   ├── rtmp-settings.component.ts
│   ├── event-capture-settings.component.ts
│   └── platform-specific/
│       ├── twitch-settings.component.ts
│       ├── youtube-settings.component.ts
│       ├── kick-settings.component.ts
│       ├── tiktok-settings.component.ts
│       ├── x-settings.component.ts
│       └── joystick-settings.component.ts
└── platform-test-dialog.component.ts
```

## API Endpoints

```
GET    /api/stream-services
POST   /api/stream-services
GET    /api/stream-services/:id
PUT    /api/stream-services/:id
DELETE /api/stream-services/:id         (blocked if stream session active)

POST   /api/stream-services/:id/test-rtmp
POST   /api/stream-services/:id/test-capture
POST   /api/stream-services/:id/oauth/start
POST   /api/oauth/callback              (from Electron main, after URI scheme catch)
```

## Security Notes

- All secrets (stream key, API tokens) written to OS keychain — never to SQLite
- Credential fields are not returned by any API endpoint
- OAuth state nonces are in-memory only, single-use, 10-minute TTL
- Deleting a platform during an active session returns HTTP 422
