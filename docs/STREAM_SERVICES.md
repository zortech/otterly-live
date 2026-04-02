# Component 0: Stream Services

A **StreamService** is the definition of a single streaming platform destination.
It holds everything needed to push a stream and optionally capture events from that platform.

## Storage

Stream service configuration is stored in SQLite via **Knex**.
Credentials (stream key, API tokens) are stored in the **OS keychain** via `keytar` —
never in the database file.

```
Credential lookup key pattern: ottery-live / {field}_{serviceId}
Examples:
  ottery-live / stream_key_3
  ottery-live / api_access_token_3
  ottery-live / api_refresh_token_3
```

## Database Schema (Knex Migration)

```js
// server/db/migrations/001_create_stream_services.js
exports.up = (knex) =>
  knex.schema.createTable('stream_services', (t) => {
    t.increments('id').primary();
    t.string('platform').notNullable();       // twitch | youtube | kick | tiktok | x | joystick | rumble | facebook | bilibili
    t.string('display_name').notNullable();   // user-facing label
    t.string('rtmp_url').notNullable();        // e.g. rtmp://live.twitch.tv/app
    t.string('username');                      // platform username (for API calls)
    t.boolean('restream_enabled').defaultTo(true);
    t.boolean('event_capture_enabled').defaultTo(true);
    t.boolean('auto_start').defaultTo(true);  // start with OBS connect
    t.boolean('active').defaultTo(true);       // soft disable
    t.string('api_token_expires_at');          // ISO string; token expiry
    t.boolean('needs_reauth').defaultTo(false); // true = refresh token expired; user must re-auth
    t.json('metadata');                        // platform-specific extra config
    t.timestamps(true, true);
  });
```

## StreamService Model

```js
// server/models/stream-service.js
const keytar = require('keytar');
const SERVICE = 'ottery-live';

class StreamService {
  // Read a credential from OS keychain
  static async getCredential(serviceId, field) {
    return keytar.getPassword(SERVICE, `${field}_${serviceId}`);
  }

  // Write a credential to OS keychain
  static async setCredential(serviceId, field, value) {
    return keytar.setPassword(SERVICE, `${field}_${serviceId}`, value);
  }

  // Delete all credentials for a service (call on delete)
  static async deleteCredentials(serviceId) {
    const fields = ['stream_key', 'api_client_id', 'api_client_secret',
                    'api_access_token', 'api_refresh_token'];
    await Promise.all(fields.map(f =>
      keytar.deletePassword(SERVICE, `${f}_${serviceId}`)
    ));
  }

  // Fetch full config for stream engine use (credentials included)
  static async getWithCredentials(id) {
    const svc = await db('stream_services').where({ id }).first();
    if (!svc) return null;
    return {
      ...svc,
      stream_key:        await this.getCredential(id, 'stream_key'),
      api_access_token:  await this.getCredential(id, 'api_access_token'),
      api_refresh_token: await this.getCredential(id, 'api_refresh_token'),
      api_client_id:     await this.getCredential(id, 'api_client_id'),
      api_client_secret: await this.getCredential(id, 'api_client_secret'),
    };
  }
}
```

## Platform RTMP Endpoints

| Platform      | RTMP URL / Notes                                                                        |
|---------------|-----------------------------------------------------------------------------------------|
| Twitch        | `rtmp://live.twitch.tv/app`                                                             |
| YouTube       | `rtmp://a.rtmp.youtube.com/live2` (primary) / `rtmp://b.rtmp.youtube.com/live2?backup=1` (backup) — stream key is static (`isReusable: true`) |
| Kick          | `rtmps://fa723fc1b171.global-contribute.live-video.net/app` — RTMPS (TLS), port 443 optional; `/app` suffix required |
| TikTok        | `rtmp://global-push.tiktok.com/live` — stream key is **session-specific**, generated fresh each session from livecenter.tiktok.com. Key may include query params (e.g. `stream-XXXX?sign=...`) — treat as opaque, append as path segment. |
| X (Twitter)   | **Dynamic per-account** — user must copy from X Media Studio Producer (Sources tab → Create Source → RTMP); requires X Premium subscription. No static URL. `rtmp://ingest.pscp.tv` (Periscope) is dead since 2021 — do not use. |
| Joystick.tv   | **Dynamic per-account** (AWS IVS) — URL format: `rtmps://{account-id}.global-contribute.live-video.net/app`. **RTMPS (TLS)**, not plain RTMP. User copies URL from Joystick.tv dashboard → Stream Settings. Stream key is static per-channel (not session-specific). |
| Rumble        | **Dynamic per-account** — user must copy from Rumble dashboard → Live → Stream Settings. Rumble offers a static RTMP URL and static stream key per account. No programmatic way to fetch it — user pastes it in. |
| Facebook Live | `rtmps://live-api-s.facebook.com:443/rtmp` (static base, RTMPS only). Stream key is **dynamic per live video** — generated via `POST /me/live_videos` (Graph API) or from Facebook Live Producer UI. |
| Bilibili Live | **Session-specific** — obtained via `POST https://api.live.bilibili.com/room/v1/Room/startLive` (requires session cookies). Full push URL = `addr` + `code` from API response. User can also copy from Bilibili Live dashboard. |

> X and Joystick.tv have no static RTMP URL. Store `rtmp_url` as empty/null initially;
> the Platform Management UI guides the user to copy their URL from the platform dashboard.
> The RTMP URL field remains editable so users can paste it in.

RTMP URLs are stored per-service in the DB so they can be updated without releases.

## Platform Defaults

When a user adds a platform, pre-fill these defaults:

```js
// server/lib/platform-registry.js
const PLATFORM_DEFAULTS = {
  twitch: {
    rtmp_url: 'rtmp://live.twitch.tv/app',
    event_capture_supported: true,
    oauth_flow: 'device_code',  // NOT pkce — Twitch doesn't support PKCE
  },
  youtube: {
    rtmp_url: 'rtmp://a.rtmp.youtube.com/live2',
    rtmp_url_backup: 'rtmp://b.rtmp.youtube.com/live2?backup=1',
    stream_key_static: true,          // key persists across streams (isReusable: true)
    event_capture_supported: true,
    oauth_flow: 'pkce',               // installed app / PKCE flow; use http://localhost:{port}
    oauth_server: 'accounts.google.com',
    developer_portal: 'console.cloud.google.com',
    scope: 'youtube.readonly',        // sensitive scope — Google review required for public apps
    google_review_required: true,     // 100 test users allowed during development
    quota_risk: true,                 // 10k units/day shared across all users; use gRPC streamList
    event_capture_method: 'grpc',     // liveChatMessages.streamList (not REST polling)
  },
  kick: {
    rtmp_url: 'rtmps://fa723fc1b171.global-contribute.live-video.net/app',  // RTMPS (TLS)
    event_capture_supported: true,
    unofficial_capture: true,         // uses reverse-engineered Pusher WS for real-time events
    oauth_flow: 'pkce',               // Authorization Code + PKCE; no client_secret needed
    oauth_server: 'id.kick.com',
    developer_portal: 'dev.kick.com', // self-service, instant credentials, 2FA required
    stream_key_auto_fetch: true,      // streamkey:read scope lets us fetch key after OAuth
    redirect_uri_use_localhost: true, // NextJS bug: use localhost NOT 127.0.0.1
  },
  tiktok: {
    rtmp_url: 'rtmp://global-push.tiktok.com/live',  // fixed; only stream key changes per session
    stream_key_hint: 'Copy stream key from livecenter.tiktok.com/producer before each stream',
    stream_key_session_specific: true,               // key changes every session; URL does not
    event_capture_supported: true,
    unofficial_capture: true,
    // EulerStream API key is an app-wide setting (APP_SETTINGS.md), not per-service
    // It is used for event capture ONLY — not for RTMP streaming
    requires_euler_stream_for_capture: true,
    // Access gating: requires Creator Network/Agency membership for RTMP
    // See RESEARCH_FINDINGS.md — free agencies: FTTV, Doves4Love, Talenture
    rtmp_access_gated: true,
  },
  x: {
    rtmp_url: '',               // dynamic per-account from X Media Studio Producer
    rtmp_url_hint: 'Copy from studio.twitter.com → Sources → Create Source → RTMP',
    event_capture_supported: false,  // no live event API exists at any API tier
    requires_premium: true,
  },
  joystick: {
    // Joystick.tv uses AWS IVS — each account has a unique ingest URL of the form:
    //   rtmps://{account-id}.global-contribute.live-video.net/app
    // This is RTMPS (TLS), not plain RTMP. There is no shared static ingest host.
    // User must copy their full URL from Joystick.tv dashboard → Stream Settings.
    rtmp_url: '',
    rtmp_url_hint: 'Copy from Joystick.tv dashboard → Stream Settings (AWS IVS URL)',
    rtmp_url_pattern: 'rtmps://{id}.global-contribute.live-video.net/app',  // informational
    stream_key_session_specific: false,  // AWS IVS keys are static per-channel (not per-session)
    event_capture_supported: true,  // WebSocket chat via wss://joystick.tv/cable (Action Cable)
    requires_oauth_request: true,   // credentials must be requested from Joystick.tv directly
  },
  rumble: {
    rtmp_url: '',
    rtmp_url_hint: 'Copy from Rumble dashboard → Live → Stream Settings (static RTMP URL)',
    stream_key_session_specific: false,  // static stream key per account
    event_capture_supported: true,       // polling-based via Rumble Live Stream API
    // api_access_token holds the Rumble Live API URL (secret endpoint from rumble.com/account/livestream-api)
    // This URL contains the user's ID and secret key embedded in the path — treat as a credential.
  },
  facebook: {
    rtmp_url: 'rtmps://live-api-s.facebook.com:443/rtmp',
    // Stream key is dynamic per live video (from Graph API POST /me/live_videos or Live Producer UI)
    stream_key_hint: 'Create a live video in Facebook Live Producer or via the Graph API to get a stream key',
    event_capture_supported: true,
    oauth_flow: 'device_code',        // Facebook Login for Devices
    oauth_server: 'graph.facebook.com',
    developer_portal: 'developers.facebook.com',
    // Enable "Login from Devices" in App Dashboard → Products → Facebook Login → Settings
    scope: 'pages_manage_posts,pages_read_engagement,pages_read_user_content,publish_video',
    app_review_required: true,        // publish_video + page perms require Meta App Review
    // Optional: metadata.page_id = Facebook Page ID (for page-based streams)
  },
  bilibili: {
    rtmp_url: '',
    rtmp_url_hint: 'Obtained via startLive API (see EVENT_CAPTURE.md) or from Bilibili Live dashboard',
    stream_key_session_specific: true,  // changes every session
    event_capture_supported: true,      // public Danmaku WebSocket (bilibili-live-ws)
    // metadata.room_id = live room number (from bilibili.com/live/{room_id})
    // metadata.uid     = Bilibili UID (optional; 0 = anonymous)
    // No OAuth — Bilibili uses cookie-based session auth (SESSDATA, bili_jct)
    // Event capture for public rooms requires no authentication.
  },
};
```

## Platform Event Type Support Matrix

| Event Type         | Twitch | YouTube | Kick | TikTok | X   | Joystick | Rumble | Facebook | Bilibili |
|--------------------|:------:|:-------:|:----:|:------:|:---:|:--------:|:------:|:--------:|:--------:|
| `chat.message`     | ✅     | ✅      | ✅   | ✅     | ✅  | 🔲       | ✅     | ✅       | ✅       |
| `follow`           | ✅     | ❌      | ✅   | ✅     | ❌  | 🔲       | ✅     | ❌       | ✅       |
| `subscribe`        | ✅     | ✅      | ✅   | ❌     | ❌  | 🔲       | ❌     | ❌       | ✅       |
| `gift_sub`         | ✅     | ✅      | ✅   | ❌     | ❌  | 🔲       | ❌     | ❌       | ❌       |
| `cheer` / `bits`   | ✅     | ❌      | ❌   | ❌     | ❌  | 🔲       | ❌     | ❌       | ❌       |
| `raid`             | ✅     | ❌      | ❌   | ❌     | ❌  | 🔲       | ❌     | ❌       | ❌       |
| `tip` / `donation` | ❌     | ✅      | ✅   | ✅     | ❌  | 🔲       | ✅     | ❌       | ✅       |
| `like`             | ❌     | ❌      | ❌   | ✅     | ❌  | 🔲       | ❌     | ❌       | ❌       |
| `share`            | ❌     | ❌      | ❌   | ✅     | ❌  | 🔲       | ❌     | ❌       | ❌       |
| `viewer_count`     | ✅     | ❌      | ✅   | ✅     | ⚠️  | 🔲       | ❌     | ✅       | ✅       |
| `stream.start`     | ✅     | ⚠️      | ✅   | ✅     | ⚠️  | 🔲       | ❌     | ❌       | ✅       |
| `stream.end`       | ✅     | ⚠️      | ✅   | ✅     | ⚠️  | 🔲       | ❌     | ✅       | ✅       |

> YouTube `subscribe` = new channel membership; `gift_sub` = gifted memberships; `tip` = Super Chat / Super Sticker.
> YouTube `stream.start` / `stream.end` detected via polling `liveBroadcasts.list?broadcastStatus=active` (no push event).
> Rumble `tip` = rants (superchats); no viewer count in the Live API.
> Facebook `stream.end` detected via `live_views` polling (status field); no push for stream start.
> Bilibili `subscribe` = Guard purchase (舰长/提督/总督 tiers); `tip` = Super Chat + paid gifts.

## Platform-Specific Metadata (`metadata` JSON)

### Twitch
```json
{ "channel_id": "12345678", "subscribed_events": ["channel.follow", "channel.subscribe"] }
```

### YouTube
```json
{ "channel_id": "UCxxxxxx", "live_chat_id": "Cg0KCxxxxxx" }
```
`live_chat_id` is fetched at stream start via `liveBroadcasts.list?broadcastStatus=active&mine=true`.
It changes each broadcast — always re-fetch, never cache across sessions.

### Kick
```json
{ "channel_slug": "myusername", "pusher_channel": "channel.12345" }
```

### TikTok
```json
{ "room_id": "...", "use_unofficial_client": true }
```

## API Serialization

Credentials are **never** returned by the API. The Express handler sanitizes the
response before sending:

```js
function serializeStreamService(svc) {
  const { stream_key, api_client_id, api_client_secret,
          api_access_token, api_refresh_token, ...safe } = svc;
  return safe;
}
```

## API Endpoints

```
GET    /api/stream-services          list all
POST   /api/stream-services          create (body includes credentials; stored to keychain)
GET    /api/stream-services/:id      show (no credentials)
PUT    /api/stream-services/:id      update (credential fields → keychain if provided)
DELETE /api/stream-services/:id      delete (blocked if session active; clears keychain)
```

## Input Validation

`rtmp_url` must be validated before being stored (to prevent FFmpeg argument injection
if `spawn()` is ever inadvertently called with `shell: true`):

```js
function validateRtmpUrl(url) {
  if (!url) return true;  // empty is valid for X/Joystick (user fills in later)
  try {
    const parsed = new URL(url);
    if (!['rtmp:', 'rtmps:'].includes(parsed.protocol)) return false;
    if (!parsed.hostname) return false;
    return true;
  } catch {
    return false;
  }
}
```

Return HTTP 422 if `rtmp_url` fails validation on POST/PUT.

## Implementation Notes

- `keytar` requires native binaries — included in Electron build via `electron-rebuild`
- On Linux, `keytar` depends on `libsecret` (`sudo apt install libsecret-1-dev`)
- When deleting a service, always call `StreamService.deleteCredentials(id)` first
- The `getWithCredentials` method is only called by internal server code (restream/capture managers)
  — never by the API route handlers
