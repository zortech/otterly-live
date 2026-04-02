# Implementation Order

A recommended build sequence that lets you test each layer before building on it.
Each phase produces something runnable and verifiable.

## Guiding Principles

- Build the data layer first — everything depends on it
- Get one platform working end-to-end before adding more
- Never build UI before the API it depends on exists
- Twitch first — best-documented platform with stable official APIs

---

## Phase 1 — Project Skeleton

**Goal:** Electron app opens, shows a blank page, server starts cleanly.

1. `package.json` with all dependencies listed
2. `electron/main.js` — BrowserWindow, startup sequence, URI scheme registration
3. `electron/preload.js` — context bridge stubs
4. `server/index.js` — Express + Socket.io skeleton, port from settings
5. Knex setup + migrations 001–004 (stream_services, stream_sessions, stream_events, settings)
6. `server/settings.js` — settings module with keychain integration
7. Angular app shell — blank routes for dashboard, platforms, settings

**Verification:** `npm run dev` opens a window with no errors. DB file created in userData.

---

## Phase 2 — Platform Management UI (no streaming yet)

**Goal:** Add, edit, and delete StreamService records through the UI.

1. `GET/POST/PUT/DELETE /api/stream-services` — Express routes
2. Platform form (Angular) — basic fields only (display name, platform, RTMP URL, stream key)
3. Keychain write on save; no credentials returned on read
4. Platform list view

**Verification:** Add a Twitch platform, see it in the list, edit it, delete it. Check SQLite.

---

## Phase 3 — Settings UI

**Goal:** Settings page functional; EulerStream key and RTMP incoming key configurable.

1. `GET/PUT /api/settings` + `/api/settings/status` — Express routes
2. Settings page (Angular) — all sections from APP_SETTINGS.md
3. Port change restart warning banner
4. EulerStream [Test] button (call EulerStream health endpoint)

**Verification:** Change RTMP incoming key, restart app, confirm setting persists.

---

## Phase 4 — RTMP Ingestion (OBS → Ottery Live)

**Goal:** OBS can push a stream to Ottery Live and the app detects it.

1. `node-media-server` startup in `server/index.js`
2. Port conflict detection (check 1935 and server port before starting)
3. `onStreamStart` / `onStreamEnd` handlers → emit `session.started` / `session.ended` on event bus
4. Stream session creation in SQLite on `onStreamStart`
5. OBS connection status emitted to Socket.io → Angular OBS status banner

**Verification:** Push a stream from OBS, see "OBS Connected" banner in dashboard.

---

## Phase 5 — Restream to One Platform (Twitch)

**Goal:** OBS stream forwarded to Twitch via FFmpeg.

1. `ffmpeg-static` path resolution (with ASAR fix)
2. `RestreamManager` — `startPlatform`, `stopPlatform`, `stopAll`
3. FFmpeg spawn for Twitch only
4. Auto-restart logic (3 attempts, exponential backoff)
5. Per-platform status emitted to Socket.io
6. Dashboard: platform status cards with Start/Stop buttons
7. `POST /api/stream/toggle` — Express route

**Verification:** Stream appears on Twitch. Stop button kills FFmpeg. Verify auto-restart on simulated crash.

---

## Phase 6 — Twitch Event Capture

**Goal:** Follow/sub/chat events from Twitch appear in the event feed.

1. `TokenManager` — startup, Twitch hourly validation, proactive refresh
2. Device Code Grant OAuth flow for Twitch (UI in Platform Management)
3. `TwitchCapture` worker — EventSub WebSocket, 10-second subscribe window
4. EventSub subscription registration (REST) for all event types
5. Event normalization → event bus → Socket.io → Angular event feed
6. Dashboard event feed component (unfiltered, all events)
7. Session stat aggregation (follow/sub/cheer counters)

**Verification:** Go live on Twitch. Follow the channel from another account. See `follow` event in dashboard. Check SQLite `stream_events` table.

---

## Phase 7 — Dashboard Polish

**Goal:** Dashboard is fully usable for a Twitch-only streamer.

1. Platform filter chips (filter event feed by platform)
2. Session stats panel (duration, peak viewers, totals)
3. `Start All` / `Stop All` buttons
4. Event capture independent start/stop (`POST /api/event-capture/start`)
5. `needs_reauth` banner (from TOKEN_MANAGEMENT.md)
6. Historical event log route (`/ottery-live/events`)

**Verification:** Full Twitch streaming session end-to-end. Stats correct at session end.

---

## Phase 8 — Kick

**Goal:** Add Kick restream + event capture.

1. RTMPS support in FFmpeg spawn (protocol difference from Twitch)
2. Kick OAuth flow (if needed for official API; Pusher WS needs no auth)
3. `KickCapture` worker — Pusher WS via `LOX-X/Kick-Live-Connector`
4. Event normalization for Kick event types
5. Platform-specific settings in Platform Management form (Kick tab)

**Verification:** Stream to Kick. Chat event appears in dashboard alongside Twitch events.

---

## Phase 9 — TikTok

**Goal:** TikTok restream + event capture.

1. TikTok platform settings UI:
   - Session stream key update flow (see PLATFORM_MANAGEMENT.md — TikTok session key section)
   - Username field only (no OAuth)
2. EulerStream API key validation (from Phase 3 settings)
3. `TikTokCapture` worker — `tiktok-live-connector` with EulerStream signing
4. Event normalization for TikTok event types (chat, gift, like, follow, share, viewer_count)
5. Stream key pre-stream reminder flow

**Verification:** Capture TikTok chat events while streaming. Confirm EulerStream signing works.

---

## Phase 10 — Joystick.tv

**Goal:** Joystick.tv restream + bot event capture.

1. Joystick.tv OAuth flow (loopback redirect)
2. `JoystickCapture` worker — Action Cable WebSocket, GatewayChannel
3. Event normalization for `new_message`; log unknown event types for discovery
4. Joystick platform settings in Platform Management form

**Verification:** Chat events appear from Joystick.tv during a live stream.

---

## Phase 11 — YouTube

**Goal:** YouTube restream + event capture via official Data API v3.

1. Google Cloud Console project setup guide (documented in-app; each user uses their own project)
2. YouTube OAuth flow (installed app PKCE; `http://localhost:{port}` redirect)
3. Channel ID auto-fetch after OAuth (`channels?part=id&mine=true`)
4. YouTube platform settings UI:
   - [Connect YouTube Account] OAuth button
   - Stream key field (static — entered once)
   - RTMP URL pre-filled + locked
   - Quota warning panel (prompt for own GCP project)
5. `YouTubeCapture` worker:
   - `liveBroadcasts.list` polling to detect stream start and fetch `liveChatId`
   - gRPC `streamList` connection via `@grpc/grpc-js`
   - Event normalization: chat, super chat/sticker (→ `tip`), membership (→ `subscribe`), gifted membership (→ `gift_sub`)
   - Fallback to REST polling if gRPC fails
   - Reconnect logic on broadcast end/disable ambiguity

> **Note:** Submit for Google OAuth consent screen verification early — the review takes
> weeks/months. You can develop and test with up to 100 test users before approval.

**Verification:** Stream to YouTube. Chat message in YouTube live chat appears in dashboard event feed. Super Chat shows as `tip` event. Membership shows as `subscribe`.

---

## Phase 12 — X (Twitter)

**Goal:** X restream with dynamic URL setup.

1. X platform settings UI:
   - RTMP URL field with helper text and link to Media Studio
   - Stream key field (write-only keychain)
   - Warning banners (requires Premium, no event capture)
2. X stub capture worker (immediately returns `not_supported`)

**Verification:** Stream appears on X after pasting Media Studio URL.

---

## Phase 13 — Electron Packaging

**Goal:** Installable app for Windows, macOS, Linux.

1. `electron-builder` config with `asarUnpack` for ffmpeg-static
2. macOS: FFmpeg binary signing with Hardened Runtime entitlements
3. NSIS installer (Windows), DMG (macOS), AppImage + deb (Linux)
4. Auto-update setup (`electron-updater`)
5. System tray (minimize to tray on close)

**Verification:** Install from `.exe`/`.dmg`/`.AppImage`. Full session end-to-end without dev tools.

---

## Phase 14 — Test Infrastructure

**Goal:** Server and frontend unit tests passing.

1. `jest.config.js` — Jest config; `testMatch: ['**/server/**/*.test.js']`
2. `__mocks__/` — keytar, electron-log, electron, ffmpeg-static stubs
3. `server/restream/restream-manager.test.js` — FFmpeg spawn, auto-restart, multi-platform
4. `server/event-capture/manager.test.js` — worker lifecycle, start/stop, event passthrough
5. `server/auth/token-manager.test.js` — refresh scheduling, Twitch hourly validation
6. `server/settings.test.js` — getter/setter, defaults, type coercion
7. `frontend/vitest.config.ts` + `ottery-live.service.spec.ts` + `dashboard.component.spec.ts`
8. `playwright.config.ts` + `e2e/smoke.spec.ts` — routing smoke tests

**Verification:** `npm run test:server` green; `npm run test:frontend` green.

---

## Phase 15 — Platform Unlock + Music Frontend + Test Expansion

**Goal:** Rumble/Facebook/Bilibili enabled; music panel complete; test coverage expanded.

1. Add `'rumble'`, `'facebook'`, `'bilibili'` to `VALID_PLATFORMS` in `server/api/stream-services.js`
2. Confirm music Angular panel complete (Now Playing, queue, playback controls, settings, Spotify Admin)
3. Confirm proactive stream-failure toast already in `dashboard.component.ts` effect
4. Confirm session history at `/ottery-live/events` fully implemented
5. `server/music/song-queue.test.js` — queue CRUD (add, remove, countByUser, isDuplicate, bump)
6. `server/music/music-manager.test.js` — chat command dispatch, permission checks, !play/!remove/!skip/!song/!queue
7. `server/event-capture/twitch.test.js` — connect guards, event normalization for all subscription types
8. `server/event-capture/kick.test.js` — connect guards, _normalizeEvent for all Pusher events
9. `server/api/stream-services.test.js` — CRUD endpoints, platform whitelist validation

**Verification:** `npm run test:server` includes 9 new test files and all pass.

---

## Phase 16 — Remote Relay

**Goal:** Users with limited upstream bandwidth can offload multi-platform
restreaming to a relay server. Local machine pushes one stream; relay fans out.

See [docs/REMOTE_RELAY.md](REMOTE_RELAY.md) for full architecture and security model.

### 16a — Relay Server (`ottery-relay/`)

1. `ottery-relay/package.json` — dependencies: express, socket.io, knex, better-sqlite3,
   node-media-server, ffmpeg-static, bcryptjs, uuid, helmet, express-rate-limit, cors
2. `ottery-relay/db/` — Knex setup + migrations: `001_users.js`, `002_sessions.js`
3. `ottery-relay/cli.js` — `add-user <name>`, `list-users`, `remove-user <name>`, `rotate-token <name>`;
   bcrypt(cost=12) token hashing; 256-bit random token via `crypto.randomBytes(32)`;
   token printed once to stdout and never stored in plaintext
5. `ottery-relay/api/sessions.js` — `POST /api/sessions` (validate + push platform configs into
   in-memory session Map; return ingestToken), `DELETE /api/sessions/:sessionId`, `GET /api/me`
6. `ottery-relay/rtmp/rtmp-manager.js` — node-media-server with RTMPS config; `prePublish` hook
   validates ingest token; `postPublish` calls relayRestreamManager; `donePublish` ends session
7. `ottery-relay/restream/relay-restream-manager.js` — per-user FFmpeg management; same
   spawn/auto-restart/event-emit pattern as local RestreamManager; status pushed via Socket.io
8. `ottery-relay/server.js` — Express + Socket.io; auth middleware; helmet + CORS; rate limit
   (30 req/min per IP); WSS events: `restream.started`, `restream.stopped`, `restream.error`,
   `relay.streamReceived`; no public endpoints — `requireAuth` on every route
9. Security: stream keys redacted from all FFmpeg logs; no keys in any response body or logs;
   `activeSessions` Map cleared on `DELETE /api/sessions/:id` and process exit

**Verification:** Run `node cli.js add-user alice` — prints token. POST /api/sessions with
that token and mock platform configs. Confirm `GET /api/sessions/:id/status` returns pending.
Push an RTMP stream to the relay's ingest path. Confirm relay spawns FFmpeg per platform and
WebSocket emits `restream.started`. Run `node cli.js remove-user alice` — confirm subsequent
API calls return 401.

### 16b — Local App Integration

1. Add `relay.mode`, `relay.url`, `relay.apiToken` to settings module (KEYCHAIN_KEYS for token)
2. `server/restream/relay-client.js` — `startSession(platforms)`, `endSession(sessionId)`,
   `connectStatusSocket(sessionId)`, `disconnectStatusSocket()`; HTTPS-only enforcement
   (reject non-https relay URLs); all requests include `Authorization: Bearer {token}`
3. `RestreamManager.onStreamStart()` — check `relay.mode`; branch to `_startRemoteSession()`
   or existing `_startLocalSession()`. Mode is captured at session start and fixed for the session.
4. `RestreamManager._startRemoteSession()` — collect active services with credentials; call
   `relayClient.startSession(platforms)`; spawn single relay FFmpeg process (`-c copy` passthrough);
   connect status socket; emit `relay.connected` on event bus
5. `RestreamManager.onStreamEnd()` — if remote session: kill relay FFmpeg, call
   `relayClient.endSession()`, `relayClient.disconnectStatusSocket()`
6. Fallback: if `relayClient.startSession()` throws, log warning and fall back to local mode;
   emit `relay.fallback` on event bus so Angular can show a toast
7. Settings UI — Restream Mode section: Local/Remote radio, URL input, masked API token input,
   [Verify] button calling `GET /api/me`; mode-change-while-streaming banner
8. Dashboard — mode badge on platform cards when remote mode is active:
   `[TWITCH ● LIVE via relay]`

**Verification:** Set relay.mode=remote in settings. Point at a running relay server with valid
token. Start OBS. Confirm dashboard shows platform cards with "via relay" badge. Confirm only
one FFmpeg process on local machine (the relay passthrough). Confirm platform streams appear live.
Switch relay.mode=local without streaming — next stream start uses local FFmpeg.

### 16c — Tests

1. `ottery-relay/cli.test.js` — add-user (token generated, bcrypt stored), list-users, remove-user
   (active=false), rotate-token (new hash stored, old hash gone)
2. `ottery-relay/api/auth.test.js` — rotate-token; 401 on missing/invalid token; deactivated user rejected
3. `ottery-relay/api/sessions.test.js` — POST validation (RTMP URL format, stream key format,
   platform whitelist), DELETE, in-memory cleanup, plan limit enforcement
3. `ottery-relay/restream/relay-restream-manager.test.js` — FFmpeg spawn, auto-restart, max retries,
   WebSocket event emission
4. `server/restream/relay-client.test.js` — startSession HTTP call, endSession, token injection,
   HTTPS enforcement (rejects http:// relay URL), fallback-to-local on relay error
5. `server/restream/restream-manager.test.js` additions — remote mode branch, relay fallback path,
   session-mode-fixed-at-start behaviour

**Verification:** `npm run test:server` and `npm run test:relay` all pass.

---

## Parallel Work Opportunities

These can be done in parallel with the phases above:

| Work | Can start after |
|---|---|
| Angular component tests | Phase 2 (any component) |
| Server unit tests (Jest) | Phase 1 |
| Token manager tests (mocked platform APIs) | Phase 3 |
| Additional platform forms (UI only) | Phase 2 |
| Event feed virtual scroll + filtering | Phase 6 |
| Logging infrastructure | Phase 1 |

---

## Key Dependencies Graph

```
Settings (Phase 3)
  └── TokenManager (Phase 6)
        └── Platform capture workers (Phase 6–10)

RTMP Server (Phase 4)
  └── RestreamManager (Phase 5)
        └── All platform restreams

SQLite schema (Phase 1)
  └── Everything

Angular shell (Phase 1)
  └── Platform Management UI (Phase 2)
  └── Settings UI (Phase 3)
  └── Dashboard (Phase 5+)
```

---

## Phase 1 — Required `package.json` Dependencies

A complete dependency reference for the initial `package.json`.

### Production dependencies (`dependencies`)

| Package | Purpose |
|---|---|
| `electron-updater` | Auto-update (runtime — must be in `dependencies`, not `devDependencies`) |
| `express` | HTTP server + REST API |
| `socket.io` | WebSocket bridge to Angular |
| `knex` | SQL query builder / migration runner |
| `better-sqlite3` | SQLite driver for Knex (use `client: 'better-sqlite3'` in knex config) |
| `keytar` | OS keychain (native addon — requires `electron-rebuild`) |
| `node-media-server` | RTMP ingestion (v4.x — breaking from v2) |
| `ffmpeg-static` | Bundled FFmpeg binary |
| `socket.io-client` | Socket.io client (Angular — also available via npm in frontend) |
| `@grpc/grpc-js` | gRPC client for YouTube chat streaming |
| `@grpc/proto-loader` | Load `.proto` files for gRPC |
| `tiktok-live-connector` | TikTok LIVE WebSocket event capture (unofficial) |

> **`LOX-X/Kick-Live-Connector`** — install from GitHub: `npm install LOX-X/kick-live-connector`
> or pin a release tag once the project stabilizes.

### Development dependencies (`devDependencies`)

| Package | Purpose |
|---|---|
| `electron` | Electron runtime |
| `electron-builder` | Packaging — **pin to `23.6.0`** (see DESKTOP_APP.md) |
| `@electron/rebuild` | Rebuild native modules (`keytar`, `better-sqlite3`) for Electron's Node |
| `@angular/cli` | Angular toolchain |
| `concurrently` | Run multiple processes for `npm run dev` |
| `nodemon` | Server hot-reload in development |
| `jest` | Server unit tests |
| `@playwright/test` | End-to-end tests |

### Angular frontend (`frontend/package.json`)

| Package | Purpose |
|---|---|
| `@angular/core` etc. | Angular 21 (standalone components, Signals, zoneless) |
| `socket.io-client` | Real-time events from server |

### Knex configuration

```js
// server/db/knex.js
const knex = require('knex')({
  client: 'better-sqlite3',
  connection: { filename: dbPath },   // resolved from app.getPath('userData') in main.js
  useNullAsDefault: true,
  migrations: { directory: path.join(__dirname, 'migrations') },
});
module.exports = knex;
```

---

## Logging Infrastructure (Phase 1 Parallel)

Use **`electron-log`** — it writes to `{userData}/logs/` automatically on all platforms,
handles both main process and renderer, and integrates with `console.*` calls.

```bash
npm install electron-log
```

```js
// server/lib/logger.js
const log = require('electron-log/main');  // or 'electron-log/node' outside Electron

log.transports.file.resolvePathFn = () =>
  path.join(app.getPath('userData'), 'logs', 'ottery-live.log');
log.transports.file.maxSize = 10 * 1024 * 1024;  // 10 MB per file
log.transports.file.archiveLog = (oldPath) => oldPath + '.old';  // keep 1 archive

module.exports = log;
```

**Log levels** map to the `app.logLevel` setting: `error` | `warn` | `info` | `debug`.

**Child process logs** (node-media-server, FFmpeg stderr) are piped to the parent and
logged at `debug` level with a platform prefix:

```js
ffmpegProc.stderr.on('data', (d) => log.debug(`[ffmpeg:${svc.platform}]`, d.toString().trim()));
rtmpProc.stdout.on('data', (d) => log.debug('[rtmp]', d.toString().trim()));
```

---

## Angular Architecture (Phase 1 Parallel)

Use **Angular 21 best practices** throughout:

| Decision | Choice | Reason |
|---|---|---|
| Components | Standalone only — no NgModules | Angular 21 default; less boilerplate |
| Reactivity | Signals (`signal`, `computed`, `effect`) | Angular 17+ recommended over RxJS for local state |
| Zone.js | Keep zone.js for now | Zoneless requires Angular 18+ and all libs to support it; not worth the risk |
| UI library | Angular Material 21 | Consistent with Angular release cadence |
| State management | Services with signals — no NgRx | App is simple enough; NgRx is overkill |
| HTTP client | `HttpClient` for REST; Socket.io for real-time | Already in stack |
| Global state | `OtteryLiveService` (singleton) holds stream state, platform statuses, event feed | Injected via `inject()` |

```typescript
// frontend/src/app/ottery-live/ottery-live.service.ts
@Injectable({ providedIn: 'root' })
export class OtteryLiveService {
  readonly sessionState = signal<'idle' | 'live' | 'ended'>('idle');
  readonly platformStatuses = signal<Record<number, PlatformStatus>>({});
  readonly events = signal<OtteryEvent[]>([]);

  private socket = io(`http://localhost:${window.otteryElectron?.serverPort ?? 3737}`);

  constructor() {
    this.socket.on('ottery:event',   (e) => this.events.update(prev => [e, ...prev].slice(0, 500)));
    this.socket.on('ottery:status',  (d) => this.platformStatuses.update(s => ({ ...s, [d.serviceId]: d })));
    this.socket.on('ottery:session', (d) => this.sessionState.set(d.state));
  }
}
```
