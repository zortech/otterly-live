# Ottery Live — CLAUDE.md

Ottery Live is a **desktop application** for multi-platform live streaming.
It ingests an OBS RTMP stream, restreams to multiple platforms simultaneously,
captures and normalizes platform events, and provides a unified control dashboard.

Runs on **Windows, macOS, and Linux** as a native desktop app (Electron).
No external servers, databases, or services required beyond OBS.

## Supported Platforms

| Platform      | RTMP Restream | Event Capture | Notes                                                      |
|---------------|:-------------:|:-------------:|------------------------------------------------------------|
| Twitch        | ✅            | ✅            | EventSub WebSocket; Device Code Grant OAuth for desktop    |
| YouTube       | ✅            | ✅            | Official Data API v3; gRPC `streamList` for chat/superchats; Google OAuth review required for public release |
| Kick          | ✅            | ✅            | Unofficial Pusher WS (`LOX-X/Kick-Live-Connector`)         |
| TikTok        | ✅            | ⚠️            | Unofficial WS; requires EulerStream signing key; stream key not static |
| X (Twitter)   | ⚠️            | ❌            | RTMP URL is dynamic per-account (X Media Studio); no live event API exists |
| Joystick.tv   | ⚠️            | ✅            | RTMP URL is dynamic (AWS IVS); bot integration via Action Cable with OAuth |
| Rumble        | ⚠️            | ✅            | RTMP URL is per-account (copy from dashboard); polling via Rumble Live API (no OAuth) |
| Facebook Live | ✅            | ✅            | RTMPS static ingest; SSE comments + polling; Facebook Login for Devices OAuth; Meta App Review required |
| Bilibili Live | ⚠️            | ✅            | RTMP key is session-specific (startLive API); Danmaku WebSocket (`bilibili-live-ws`); chat/gifts/guards/follows |

## Tech Stack

| Layer            | Technology              | Notes                                          |
|------------------|-------------------------|------------------------------------------------|
| Desktop shell    | Electron                | Wraps server + Angular UI as native app        |
| Server process   | Node.js (Express)       | Single process: API + RTMP + events + WebSocket|
| Database         | SQLite (`better-sqlite3`)| Single file, zero config, bundled in app      |
| RTMP ingestion   | `node-media-server`     | Receives OBS stream on localhost:1935          |
| Restreaming      | FFmpeg (`ffmpeg-static`)| Bundled binary, no system install needed       |
| Real-time UI     | Socket.io               | WebSocket from server to Angular               |
| Event bus        | Node.js `EventEmitter`  | In-process; no Redis needed                    |
| Frontend         | Angular 21              | Served as static build from Express            |

> No Rails, MySQL, or Redis required. Everything runs inside one Electron app.

## Component Map

| #   | Name                  | Doc                                                           | Summary                                         |
|-----|-----------------------|---------------------------------------------------------------|-------------------------------------------------|
| 0   | Stream Services       | [docs/STREAM_SERVICES.md](docs/STREAM_SERVICES.md)           | Platform config schema (RTMP, keys, metadata)   |
| 0.1 | Event Capture         | [docs/EVENT_CAPTURE.md](docs/EVENT_CAPTURE.md)               | Per-platform event listeners                    |
| 1   | Restream Engine       | [docs/RESTREAM_ENGINE.md](docs/RESTREAM_ENGINE.md)           | FFmpeg-based multi-platform restreaming         |
| 1.1 | Restream + Events     | [docs/RESTREAM_ENGINE.md](docs/RESTREAM_ENGINE.md)           | Event capture lifecycle tied to restream state  |
| 2   | Unified Event Stream  | [docs/UNIFIED_EVENTS.md](docs/UNIFIED_EVENTS.md)             | Normalized in-process event bus                 |
| 3   | Dashboard             | [docs/DASHBOARD.md](docs/DASHBOARD.md)                       | Stream start/stop, status, live event feed      |
| 4   | Platform Management   | [docs/PLATFORM_MANAGEMENT.md](docs/PLATFORM_MANAGEMENT.md)  | Per-platform settings and credentials UI        |
| 5   | Desktop App           | [docs/DESKTOP_APP.md](docs/DESKTOP_APP.md)                   | Electron packaging, installers, auto-update     |
| 6   | StreamTap             | [docs/STREAMTAP.md](docs/STREAMTAP.md)                       | Optional WS server; broadcasts event stream to overlays/bots |
| 7   | Warudo Relay          | [docs/WARUDO_RELAY.md](docs/WARUDO_RELAY.md)                 | Forwards events to Warudo (built-in WS relay + C# plugin)    |
| 8   | Remote Relay          | [docs/REMOTE_RELAY.md](docs/REMOTE_RELAY.md)                 | Optional cloud relay server; one upload, N-platform fan-out; multi-user |
| —   | App Settings          | [docs/APP_SETTINGS.md](docs/APP_SETTINGS.md)                 | Settings schema, storage, module API            |
| —   | Token Management      | [docs/TOKEN_MANAGEMENT.md](docs/TOKEN_MANAGEMENT.md)         | OAuth token refresh, Twitch hourly validation   |
| —   | Implementation Order  | [docs/IMPLEMENTATION_ORDER.md](docs/IMPLEMENTATION_ORDER.md) | Recommended build sequence (16 phases)          |
| —   | Research Findings     | [docs/RESEARCH_FINDINGS.md](docs/RESEARCH_FINDINGS.md)       | Raw research results for all platforms          |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Main Process                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Node.js Server (single process)                     │   │
│  │                                                      │   │
│  │  [Express REST API]  [Socket.io]  [node-media-server]│   │
│  │         │                │               │           │   │
│  │         ▼                ▼               ▼           │   │
│  │    [SQLite DB]    [EventEmitter]  [RTMP :1935]       │   │
│  │                        │               │             │   │
│  │             ┌──────────┘    OBS pushes here          │   │
│  │             ▼                          │             │   │
│  │   [EventCaptureManager]   [RestreamManager]          │   │
│  │       │                       │                      │   │
│  │   per-platform            per-platform               │   │
│  │   WebSocket clients       FFmpeg processes           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Electron BrowserWindow                                     │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Angular app (static build, served by Express)     │     │
│  │  Connects to Socket.io on localhost                │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘

OBS → rtmp://localhost:1935/live/{key}

FFmpeg (bundled binary via ffmpeg-static):
  → rtmp://live.twitch.tv/app/{key}
  → rtmp://a.rtmp.youtube.com/live2/{key}
  → rtmps://fa723fc1b171.global-contribute.live-video.net/app/{key}   (Kick — RTMPS/TLS)
  → rtmp://global-push.tiktok.com/live/{key}                          (TikTok — session key)
  → rtmp://{dynamic-per-account from X Media Studio}/{key}            (X — no static URL)
  → rtmps://{account-id}.global-contribute.live-video.net/app/{key}   (Joystick — AWS IVS, per-account)
```

## Repository Structure

```
ottery-live/
├── CLAUDE.md                     # This file
├── docs/                         # Component documentation
│   ├── STREAM_SERVICES.md
│   ├── EVENT_CAPTURE.md
│   ├── RESTREAM_ENGINE.md
│   ├── UNIFIED_EVENTS.md
│   ├── DASHBOARD.md
│   ├── PLATFORM_MANAGEMENT.md
│   ├── DESKTOP_APP.md
│   └── STREAMTAP.md
├── electron/
│   ├── main.js                   # Electron main process (app lifecycle, windows)
│   └── preload.js                # Context bridge (expose safe APIs to renderer)
├── server/                       # Node.js server (all backend logic)
│   ├── index.js                  # Entry point; starts Express + Socket.io + RTMP
│   ├── api/                      # Express route handlers
│   │   ├── stream-services.js
│   │   ├── stream-sessions.js
│   │   └── event-capture.js
│   ├── db/                       # SQLite via Knex
│   │   ├── knex.js               # Knex instance
│   │   └── migrations/
│   ├── restream/
│   │   └── restream-manager.js   # FFmpeg process lifecycle
│   ├── event-capture/            # Platform event listeners
│   │   ├── manager.js
│   │   ├── twitch.js
│   │   ├── kick.js
│   │   ├── tiktok.js
│   │   ├── x.js
│   │   └── joystick.js
│   ├── streamtap/
│   │   └── streamtap-server.js   # Optional external WebSocket event broadcast
│   └── events/
│       └── event-bus.js          # EventEmitter + Socket.io bridge
├── frontend/                     # Angular app
│   └── src/app/ottery-live/
│       ├── dashboard/
│       └── platform-management/
└── package.json                  # Root: Electron + server deps
```

## Common Commands

### Development

```bash
# Install all dependencies
npm install

# Run in development mode (Electron + server + Angular dev server)
npm run dev

# Run server only (no Electron, for debugging)
npm run server

# Run Angular dev server only
npm run frontend
```

### Testing

```bash
npm test                          # All tests
npm run test:server               # Server-side tests (Jest)
npm run test:frontend             # Angular tests (Karma)
npm run test:e2e                  # End-to-end (Playwright)
```

### Building / Packaging

```bash
npm run build:frontend            # Compile Angular → dist/frontend/
npm run build                     # Build everything

# Package as installer
npm run package:win               # Windows NSIS installer (.exe)
npm run package:mac               # macOS DMG (.dmg)
npm run package:linux             # Linux AppImage (.AppImage) + .deb
npm run package:all               # All platforms
```

See [docs/DESKTOP_APP.md](docs/DESKTOP_APP.md) for full packaging details.

## Key Concepts

### Single Process Design
Everything runs in one Node.js process inside Electron. There is no separate
API server, database server, or message broker to start, configure, or connect.
The user just opens the app.

### Bundled FFmpeg
`ffmpeg-static` provides the correct FFmpeg binary for the current OS/arch at
install time. No system FFmpeg required.

```js
const ffmpegPath = require('ffmpeg-static');
// → /path/to/app/node_modules/ffmpeg-static/ffmpeg (or ffmpeg.exe on Windows)
```

### Credential Storage
Platform credentials (stream keys, API tokens) are encrypted using the OS
keychain via `keytar`, not stored in plaintext in the SQLite file.

```js
const keytar = require('keytar');
await keytar.setPassword('ottery-live', `stream_key_${serviceId}`, streamKey);
const key = await keytar.getPassword('ottery-live', `stream_key_${serviceId}`);
```

### OBS Configuration
Users configure OBS with:
- **Server**: `rtmp://localhost:1935/live`
- **Stream Key**: value of `RTMP_STREAM_KEY` setting (default: `ottery`)

### In-Process Event Bus
All event capture workers emit to a shared Node.js `EventEmitter`. Socket.io
broadcasts these to the Angular frontend. No Redis or external broker needed.
See [docs/UNIFIED_EVENTS.md](docs/UNIFIED_EVENTS.md).

## Data Storage

- **Database**: SQLite file at `{userData}/ottery-live.db` (Electron userData path)
- **Credentials**: OS keychain via `keytar` (Windows Credential Store, macOS Keychain, Linux libsecret)
- **Logs**: `{userData}/logs/`
- **Settings**: Stored in SQLite (not `electron-store`/localStorage, for SQL queryability)

## Environment / Settings

All configuration is managed via the in-app Settings UI and stored in SQLite.
There are no `.env` files required for production. For development overrides:

```bash
OTTERY_RTMP_PORT=1935       # RTMP listen port (default: 1935)
OTTERY_SERVER_PORT=3737     # Express listen port (default: 3737)
OTTERY_DEV=true             # Enable dev tools in Electron window
```

## Important Notes

- FFmpeg is bundled — no system install required
- Credentials stored in OS keychain — not in the SQLite file
- RTMP port 1935 must be free; app will warn on startup if occupied
- Event capture for TikTok uses an unofficial library; stability not guaranteed
- X event capture requires elevated Twitter API access; restream-only by default
- Joystick.tv event capture is TBD
- OAuth flows open the system browser; callback caught via `ottery-live://` URI scheme
