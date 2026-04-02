# Remote Relay

Remote Relay offloads multi-platform restreaming to a server on the internet.
Instead of the local machine pushing N streams (one per platform), it pushes a
single stream to the relay server, which handles the fan-out. This is the key
bandwidth win for users on constrained upstream connections.

## The Problem

A user with 30 Mb/s upload wants to stream to 4 platforms at 8 Mb/s each.
Locally that requires 32 Mb/s — more than they have.

With a relay:
- **Local machine uploads:** 1 × 8 Mb/s to the relay server
- **Relay server uploads:** 4 × 8 Mb/s to the platforms
- The relay server lives on a cloud VM with a fat pipe (100+ Mb/s typical)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  User's Machine                                                     │
│                                                                     │
│  OBS → rtmp://localhost:1935/live/ottery                            │
│           │                                                         │
│           ▼                                                         │
│  Ottery Live (Local)                                                │
│    RtmpManager detects stream.start                                 │
│    ─────────────────────────────────────────────────────────────    │
│    [local mode]   FFmpeg × N → each platform directly              │
│    [remote mode]  FFmpeg × 1 → relay RTMP ingest                   │
│                   + HTTPS push of platform configs to relay API     │
└─────────────────────────────────────────────────────────────────────┘
                            │ single RTMP stream
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Relay Server (cloud VM)                                            │
│                                                                     │
│  ottery-relay                                                       │
│    node-media-server :1935  ← receives stream                      │
│    ExpressAPI :3838         ← session management                   │
│    WebSocket :3838/ws       ← pushes status events back to local   │
│                                                                     │
│    on stream.start:                                                 │
│      FFmpeg → rtmp://live.twitch.tv/app/{key}                      │
│      FFmpeg → rtmp://a.rtmp.youtube.com/live2/{key}                │
│      FFmpeg → rtmps://...kick.../app/{key}                         │
│      FFmpeg → rtmp://global-push.tiktok.com/live/{key}             │
└─────────────────────────────────────────────────────────────────────┘
```

## OBS Configuration

OBS **always** points to `rtmp://localhost:1935/live`. This never changes.
In remote mode, Ottery Live acts as a transparent RTMP relay — it receives
the OBS stream locally and forwards it to the relay server via one FFmpeg
process. The user never reconfigures OBS when switching modes.

```
OBS → local:1935 → [local mode]  N × FFmpeg → platforms
                 → [remote mode] 1 × FFmpeg → relay:1935/ingest/{sessionToken}
                                              → relay spawns N × FFmpeg → platforms
```

## Switching Between Modes

| Situation | Behaviour |
|-----------|-----------|
| OBS not streaming | Switch takes effect immediately |
| OBS streaming | Banner: "Will apply at next stream start" — current session continues with its original mode |

The mode that was active when `onStreamStart` fires is the mode used for the
entire session. Mid-stream mode changes are deferred.

---

## Local Ottery Live Changes

### New Settings

See [APP_SETTINGS.md](APP_SETTINGS.md) for the `relay.*` settings block.

### `RelayClient` (`server/restream/relay-client.js`)

Handles all communication with the relay server from the local app.

```js
class RelayClient {
  constructor(settings) { ... }

  // Push platform configs and receive the session ingest token.
  // platforms: array of { serviceId, platform, rtmpUrl, streamKey }
  // Returns: { sessionId, ingestToken, rtmpPort }
  async startSession(platforms) { ... }

  // Gracefully end the session on the relay.
  async endSession(sessionId) { ... }

  // Open a WebSocket to receive real-time status events from the relay.
  // Emits relay events onto the local eventBus so Angular sees them normally.
  connectStatusSocket(sessionId) { ... }
  disconnectStatusSocket() { ... }
}
```

### `RestreamManager` Changes

`onStreamStart` checks the relay mode setting:

```js
async onStreamStart(rtmpPort, incomingKey) {
  this.rtmpPort = rtmpPort;
  this.incomingKey = incomingKey;

  const mode = await settings.get('relay.mode');  // 'local' | 'remote'

  if (mode === 'remote') {
    await this._startRemoteSession();
  } else {
    await this._startLocalSession();  // existing behaviour
  }
}
```

#### Remote session startup

```js
async _startRemoteSession() {
  const rows = await db('stream_services').where({ active: true, restream_enabled: true, auto_start: true });
  const platforms = [];
  for (const row of rows) {
    const svc = await StreamService.getWithCredentials(row.id);
    if (svc.stream_key && svc.rtmp_url) {
      platforms.push({ serviceId: svc.id, platform: svc.platform, rtmpUrl: svc.rtmp_url, streamKey: svc.stream_key });
    }
  }

  const { sessionId, ingestToken, rtmpPort } = await relayClient.startSession(platforms);
  this.remoteSessionId = sessionId;

  const relayUrl = await settings.get('relay.url');
  const ingestHost = new URL(relayUrl).hostname;
  const dest = `rtmp://${ingestHost}:${rtmpPort}/ingest/${ingestToken}`;

  // One FFmpeg relay process: OBS → relay server
  this._spawnRelayFFmpeg(dest);

  // Connect WebSocket to receive per-platform status from relay
  relayClient.connectStatusSocket(sessionId);
}
```

#### Local relay FFmpeg process

```js
_spawnRelayFFmpeg(dest) {
  const src = `rtmp://127.0.0.1:${this.rtmpPort}/live/${this.incomingKey}`;
  const proc = spawn(ffmpegPath, [
    '-re', '-i', src,
    '-c', 'copy', '-f', 'flv',
    dest,
  ], { windowsHide: true });

  proc.stderr?.on('data', (d) => {
    const line = redactKey(d.toString().trim());
    if (!line) return;
    if (!/^frame=/.test(line)) logger.debug('[relay-ffmpeg]', line);
  });
  proc.on('exit', (code) => {
    if (code !== 0) logger.error('[relay-ffmpeg] relay process exited with code', code);
  });

  this.relayProc = proc;
  eventBus.emit('relay.connected', { status: 'relaying' });
}
```

### Status Events from Relay

The relay pushes status events via WebSocket using the same shape as local
events, so the local eventBus re-emits them transparently. Angular receives
`restream.started`, `restream.stopped`, `restream.error` events with the same
`serviceId`, `platform`, `status` fields — the frontend needs no changes to
handle remote mode.

---

## Remote Relay Server (`ottery-relay/`)

A standalone Node.js application. Self-hosted on any Linux VPS or cloud VM.
Docker image provided for easy deployment.

### Repository Structure

```
ottery-relay/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server.js               Entry point: Express + Socket.io + node-media-server
├── cli.js                  Operator CLI — add/remove/list users, rotate tokens
├── db/
│   ├── knex.js
│   └── migrations/
│       ├── 001_users.js
│       └── 002_sessions.js
├── api/
│   ├── auth.js             POST /api/auth/rotate-token (self-service token rotation only)
│   └── sessions.js         POST/DELETE /api/sessions
├── restream/
│   └── relay-restream-manager.js   Per-user FFmpeg management
├── rtmp/
│   └── rtmp-manager.js     node-media-server, maps ingest tokens to users
└── lib/
    └── logger.js
```

### Database Schema

```js
// 001_users.js
t.increments('id');
t.string('username').unique().notNullable();  // short display name — "alice", "bob"
t.string('api_token_hash').notNullable();     // bcrypt hash of the API token
t.boolean('active').defaultTo(true);
t.timestamps(true, true);

// 002_sessions.js
t.increments('id');
t.string('session_id').unique().notNullable();   // UUID
t.string('ingest_token').unique().notNullable();  // UUID — used in RTMP ingest path
t.integer('user_id').references('users.id');
t.string('state').defaultTo('pending');  // pending | live | ended | error
t.datetime('started_at');
t.datetime('ended_at');
t.timestamps(true, true);
// NOTE: platform configs (including stream keys) are NEVER written to the DB.
// They are held in a per-session in-memory Map only, and discarded on session end.
```

### In-Memory Session State

Stream keys and RTMP URLs are sensitive credentials belonging to the user's
streaming accounts. The relay server holds them **in-memory only** for the
duration of the session — they are never written to disk or logged.

```js
// In RelayRestreamManager
// Map<sessionId, { userId, platforms: [...], processes: Map<serviceId, proc> }>
const activeSessions = new Map();
```

### Operator CLI

There is no web signup. The operator manages users on the server directly:

```bash
# Add a user — prints a token once; share it with your friend out-of-band
node cli.js add-user alice
#  → User created: alice
#  → Token (shown once): 7f3a2b...e9c1
#  → Share this token with alice. It cannot be recovered — only rotated.

# List all users
node cli.js list-users
#  → alice   active   created 2026-03-01
#  → bob     active   created 2026-03-15

# Deactivate a user (revokes access immediately; sessions are terminated)
node cli.js remove-user bob

# Generate a new token for a user (old token stops working immediately)
node cli.js rotate-token alice
#  → New token for alice: 9d1f4e...a7b2
```

`cli.js` runs against the same SQLite DB as the server. If the server is running,
`add-user` and `remove-user` changes take effect immediately because `requireAuth`
reads from the DB on every request — no restart needed.

### REST API

All endpoints require `Authorization: Bearer {apiToken}`.
There are no public endpoints — there is no registration flow.

```
POST   /api/auth/rotate-token
  Returns: { apiToken }    ← generates a new token; old one invalidated immediately

POST   /api/sessions
  Body: {
    platforms: [
      { serviceId: 1, platform: "twitch",  rtmpUrl: "rtmp://...", streamKey: "..." },
      { serviceId: 2, platform: "youtube", rtmpUrl: "rtmp://...", streamKey: "..." },
      ...
    ]
  }
  Returns: { sessionId, ingestToken, rtmpPort: 1935 }

DELETE /api/sessions/:sessionId
  Returns: 204 No Content

GET    /api/sessions/:sessionId/status
  Returns: { state, platforms: { <serviceId>: 'live'|'stopped'|'error' } }

GET    /api/me
  Returns: { userId, username, activeSessions: N }
```

### WebSocket Events

Connect: `wss://{relayHost}/ws?token={apiToken}&session={sessionId}`

| Event | Payload | Description |
|-------|---------|-------------|
| `restream.started` | `{ serviceId, platform, status: 'live' }` | Platform FFmpeg started |
| `restream.stopped` | `{ serviceId, status: 'stopped' }` | Platform FFmpeg stopped cleanly |
| `restream.error` | `{ serviceId, platform, reason, status: 'error' }` | FFmpeg crash / max restarts |
| `relay.streamReceived` | `{}` | Relay received the RTMP stream from local |
| `session.ended` | `{}` | All platforms stopped; session closed |

### RTMP Ingest

node-media-server listens on port 1935. The ingest path is per-session:

```
rtmp://{relayHost}:1935/ingest/{ingestToken}
```

`ingestToken` is a UUID generated at session start. When node-media-server
fires `postPublish` for this path, the relay manager:
1. Validates the token against the active session map
2. Spawns FFmpeg per-platform using the in-memory credentials
3. Emits `relay.streamReceived` on the session WebSocket

If the RTMP stream disconnects (OBS / local relay stops), `donePublish` fires,
all FFmpeg processes for the session are killed, and `session.ended` is emitted.

### Per-User FFmpeg Management

```js
// relay-restream-manager.js (relay server)
class RelayRestreamManager {
  startSession(sessionId, platforms) {
    activeSessions.set(sessionId, { platforms, processes: new Map() });
  }

  onStreamReceived(ingestToken, rtmpPort) {
    const session = this._sessionByToken(ingestToken);
    for (const p of session.platforms) {
      this._spawnFFmpeg(session, p, rtmpPort);
    }
  }

  _spawnFFmpeg(session, platform, ingestRtmpPort) {
    // Same pattern as local RestreamManager — spawn, auto-restart × 3, eventBus emit
    const src = `rtmp://127.0.0.1:${ingestRtmpPort}/ingest/${session.ingestToken}`;
    const dest = `${platform.rtmpUrl}/${platform.streamKey}`;
    const proc = spawn(ffmpegPath, ['-re', '-i', src, '-c', 'copy', '-f', 'flv', dest],
      { windowsHide: false });
    // stderr / exit handling same as RestreamManager
    // Status emitted via WebSocket to the local client
  }

  endSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    for (const proc of session.processes.values()) proc.kill('SIGTERM');
    activeSessions.delete(sessionId);
  }
}
```

### Auto-Restart (same policy as local)

3 attempts with exponential backoff (1s, 2s, 4s). On max retries, emits
`restream.error` via WebSocket.

### Security Model

#### Transport

All client↔relay communication uses TLS:

| Channel | Protocol | Notes |
|---------|----------|-------|
| REST API | HTTPS only | HTTP requests rejected with 301 redirect or 400 |
| WebSocket | WSS only | ws:// rejected at the TLS terminator |
| RTMP ingest (local → relay) | **RTMPS** (RTMP over TLS) | node-media-server v4 `rtmps` config block; cert via Let's Encrypt |
| RTMP restream (relay → platforms) | RTMP or RTMPS | Per-platform as documented in STREAM_SERVICES.md |

node-media-server v4 RTMPS config:

```js
const nms = new NodeMediaServer({
  rtmp:  { port: 1935, chunk_size: 60000, gop_cache: true, ping: 60, ping_timeout: 30 },
  rtmps: {
    port: 1936,
    chunk_size: 60000,
    key:  fs.readFileSync('/etc/letsencrypt/live/relay.example.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/relay.example.com/fullchain.pem'),
  },
});
```

Local Ottery Live connects to `rtmps://{relayHost}:1936/ingest/{ingestToken}`.
Plain RTMP port 1935 is exposed only for local testing; operators should
firewall it in production.

#### API Token Design

- Generated with `crypto.randomBytes(32).toString('hex')` → 64-char hex string (256-bit entropy)
- Stored in relay DB as `bcrypt(token, cost=12)` — never plaintext
- Printed **once** by `cli.js add-user` or `cli.js rotate-token`; not recoverable from the DB — rotate to get a new one
- Transmitted only in the `Authorization: Bearer` header, never in URLs or query params

```js
// relay: generate a token
function generateApiToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

// relay: verify a token
async function verifyToken(providedToken, storedHash) {
  return bcrypt.compare(providedToken, storedHash);
}
```

#### Stream Key Protection

Stream keys are sensitive credentials belonging to the user's platform accounts.

| Threat | Mitigation |
|--------|-----------|
| Keys logged | FFmpeg stderr redacted before logging (same `redactKey()` pattern as local) |
| Keys persisted | Never written to DB or disk — held only in `activeSessions` in-memory Map |
| Keys in transit | POSTed over HTTPS in request body; never in URL path or query params |
| Keys echoed back | Session start response contains only `sessionId` and `ingestToken` — no keys |
| Keys after session | `endSession()` deletes the session entry; `process.on('exit', ...)` clears all sessions |
| Keys on crash | `activeSessions` is in-process memory; lost on crash (acceptable — new session required) |

#### Ingest Path Isolation

Each session's RTMP ingest path is `rtmps://{host}:1936/ingest/{ingestToken}` where
`ingestToken` is `crypto.randomUUID()` (UUID v4, 122 bits of entropy). The relay
validates this token before allowing the publish:

```js
nms.on('prePublish', (id, streamPath, params) => {
  const token = streamPath.split('/').pop();
  const session = sessionsByIngestToken.get(token);
  if (!session) {
    // Reject: no session for this token
    const session = nms.getSession(id);
    session.reject();
    logger.warn('[rtmp] rejected unknown ingest token', { streamPath });
  }
});
```

#### Authentication Middleware

```js
// relay: applied to every /api/* route — no public endpoints exist
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });

  // With only a handful of users, a full-table scan + bcrypt is fine.
  // If this ever needs to scale, store a non-secret 8-char lookup prefix
  // alongside the hash to narrow to one row before running bcrypt.
  const users = await db('users').where({ active: true });
  let matched = null;
  for (const u of users) {
    if (await bcrypt.compare(token, u.api_token_hash)) { matched = u; break; }
  }

  if (!matched) return res.status(401).json({ error: 'invalid_token' });

  req.user = { id: matched.id, username: matched.username };
  next();
}
```

#### Rate Limiting

```js
const rateLimit = require('express-rate-limit');

// All API routes: 30 requests per IP per minute — plenty for a few friends,
// limits damage if a token is ever leaked and abused.
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 30 }));
```

#### Input Validation

All platform configs received in `POST /api/sessions` are validated before
being stored in memory or passed to FFmpeg:

```js
function validatePlatformConfig(p) {
  if (!p.serviceId || typeof p.serviceId !== 'number') throw new Error('invalid serviceId');
  if (!VALID_PLATFORMS.includes(p.platform)) throw new Error('invalid platform');

  // Same URL validation as local app (prevents FFmpeg arg injection)
  const parsed = new URL(p.rtmpUrl);
  if (!['rtmp:', 'rtmps:'].includes(parsed.protocol)) throw new Error('invalid rtmpUrl protocol');
  if (!parsed.hostname) throw new Error('invalid rtmpUrl hostname');

  // Stream key: printable ASCII only, 1–512 chars, no whitespace
  if (!/^[\x21-\x7E]{1,512}$/.test(p.streamKey)) throw new Error('invalid streamKey');
}
```

Stream keys are always passed to FFmpeg via the `args` array (never `shell: true`),
so shell injection is structurally prevented even without validation — but we
validate anyway as defence in depth.

#### Audit Logging

Session events are logged with userId and sessionId but **never** with stream keys:

```js
logger.info('[session] started', { userId: req.user.id, sessionId, platformCount: platforms.length });
logger.info('[session] ended',   { userId: req.user.id, sessionId, durationMs });
logger.warn('[rtmp] rejected unknown ingest token', { streamPath });  // no key in path logged
```

#### CORS

```js
app.use(cors({
  origin: false,       // no browser clients — API is called server-to-server only
  methods: ['GET', 'POST', 'DELETE'],
}));
```

#### Security Headers

```js
app.use(helmet());  // sets X-Content-Type-Options, X-Frame-Options, etc.
app.disable('x-powered-by');
```

#### Summary Table

| Concern | Mitigation |
|---------|------------|
| API token theft | 256-bit random token; bcrypt-hashed in DB; printed once by CLI |
| Token brute force | Rate limiting (30 req/min per IP); bcrypt cost=12 |
| Unauthorised access | No public endpoints — every route requires a valid token |
| No self-service signup | Users created only via `cli.js add-user` on the server — no web registration |
| Stream keys at rest | Never written to disk — in-memory only for session lifetime |
| Stream keys in transit | HTTPS body only; never URL params; never logged |
| RTMP stream sniffing | RTMPS (TLS) for local→relay ingest |
| Ingest path guessing | UUID v4 ingest token; validated by node-media-server prePublish hook |
| Cross-user access | Session Map is keyed by ingest token; no user can address another's session |
| FFmpeg argument injection | RTMP URL validated; args array spawn (never shell:true) |
| Log leakage | Stream keys redacted from all FFmpeg stderr before logging |
| Session persistence | In-memory only; cleaned up on end or crash |
| Information leakage | No X-Powered-By; no stack traces in error responses |

### Operator Configuration (`.env`)

```bash
# Relay server environment
RELAY_API_PORT=3838
RELAY_RTMP_PORT=1935
RELAY_RTMPS_PORT=1936
RELAY_DB_PATH=/data/ottery-relay.db
RELAY_LOG_LEVEL=info
# Path to TLS cert/key for RTMPS (local→relay stream encryption)
RELAY_TLS_CERT=/etc/letsencrypt/live/relay.example.com/fullchain.pem
RELAY_TLS_KEY=/etc/letsencrypt/live/relay.example.com/privkey.pem
```

### Docker Deployment

```yaml
# docker-compose.yml
services:
  relay:
    image: otterlylive/ottery-relay:latest
    ports:
      - "1935:1935"   # RTMP
      - "3838:3838"   # API + WebSocket
    volumes:
      - relay-data:/data
    environment:
      - RELAY_API_PORT=3838
      - RELAY_RTMP_PORT=1935
      - RELAY_DB_PATH=/data/ottery-relay.db
    restart: unless-stopped

volumes:
  relay-data:
```

Put nginx or Caddy in front for TLS termination on port 443/wss.

---

## Settings UI (Local App)

New section in `/ottery-live/settings` → **Restream Mode**.

### Restream Mode Toggle

```
● Local     Use this machine to push directly to all platforms.
○ Remote    Push one stream to a relay server; relay fans out.
```

When **Remote** is selected, show the relay configuration panel:

```
Relay Server URL:   [ https://relay.example.com            ]
API Token:          [ ••••••••••••••••••••••••••••••        ] [Verify]

[Verify] calls GET /api/me on the relay and shows:
  ✓ Connected as alice · 0 active sessions
  ✗ Invalid token
  ✗ Cannot reach relay
```

### Dashboard Mode Indicator

When in remote mode and relaying, the dashboard shows a small badge on the
platform cards:

```
[TWITCH ● LIVE via relay]   [YOUTUBE ● LIVE via relay]
```

The mode badge disappears in local mode — it's only shown when remote is active
to avoid confusing experienced users.

---

## Multi-User on the Relay

The relay is designed for a small trusted group — you and a friend or two
splitting the server cost. The operator adds users via CLI; each user gets
their own token to paste into their Ottery Live settings.

Each user's sessions are isolated:

- Separate RTMP ingest paths (per-session UUID tokens)
- Separate FFmpeg processes tracked in separate Maps
- One user's crash or misconfigured platform cannot affect another

A cheap cloud VM (e.g., 2 vCPU / 4 GB / 200 Mb/s unmetered) handles 2–3
friends streaming to 4 platforms each at 6 Mb/s with plenty of headroom.
Bandwidth is the only real constraint — FFmpeg `-c copy` uses negligible CPU.

---

## Implementation Notes

### `ffmpeg-static` on the relay server
The relay server uses the same `ffmpeg-static` npm package. On Linux (the
typical server OS) this is the `linux-x64` binary. No system FFmpeg needed.

```js
// relay: ffmpeg-static path doesn't need the ASAR workaround
const ffmpegPath = require('ffmpeg-static');
```

### Relay health on stream start
If `relayClient.startSession()` fails (relay unreachable, bad token, server error),
the local app falls back to local mode with a warning toast:

> "Could not reach relay server. Restreaming locally instead."

This ensures the stream always starts even if the relay is unavailable.

### Stream key transmission
Platform configs are POSTed over HTTPS in the request body. Never in query
params (not logged to access logs). The relay immediately moves them into the
in-memory session map and they are not echoed back in any response.

### `ottery-relay` vs `ottery-live`
The relay is a separate npm project (`ottery-relay/`) inside the same
monorepo. It is NOT bundled into the Electron app — it runs as a standalone
server process on the relay host. It shares the `ffmpeg-static` dependency
and the same FFmpeg spawn patterns, but has no Electron, Angular, or SQLite
schema in common with the desktop app.

---

## Phase Summary (see IMPLEMENTATION_ORDER.md Phase 16)

1. `ottery-relay/` server skeleton (Express + node-media-server + SQLite)
2. User registration + API token (bcrypt)
3. Session API (POST/DELETE /api/sessions)
4. RTMP ingest → FFmpeg fan-out per session
5. WebSocket status events
6. `RelayClient` in local app (`server/restream/relay-client.js`)
7. `RestreamManager` remote-mode fork
8. Settings UI: Remote Relay section + Verify button
9. Dashboard: mode badge
10. Docker image + docker-compose
11. Tests: relay session lifecycle, FFmpeg spawn, fallback-to-local
