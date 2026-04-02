# Ottery Live

Multi-platform live streaming desktop app. Ingests an OBS RTMP stream and restreams it to multiple platforms simultaneously, while capturing and normalizing platform events (chat, donations, follows, etc.) into a unified dashboard.

> **Note:** This README was generated with AI assistance (Claude Code by Anthropic).

---

## Features

- Stream to multiple platforms at once from a single OBS setup
- Unified event feed — chat, donations, follows, and more, all in one place
- No external servers or databases — everything runs inside the app
- Bundled FFmpeg — no system install required
- Credentials stored in your OS keychain, not in plain text

### Supported Platforms

| Platform      | Restream | Events | Notes |
|---------------|:--------:|:------:|-------|
| Twitch        | Yes      | Yes    | EventSub WebSocket |
| YouTube       | Yes      | Yes    | Data API v3; requires Google OAuth review for public release |
| Kick          | Yes      | Yes    | Unofficial Pusher WebSocket |
| TikTok        | Yes      | Partial | Unofficial WS; requires EulerStream signing key |
| X (Twitter)   | Partial  | No     | RTMP URL is dynamic per-account; no live event API |
| Joystick.tv   | Partial  | Yes    | RTMP URL is dynamic (AWS IVS) |
| Rumble        | Partial  | Yes    | RTMP key is per-account; polling via Rumble Live API |
| Facebook Live | Yes      | Yes    | Facebook Login for Devices; Meta App Review required |
| Bilibili Live | Partial  | Yes    | RTMP key is session-specific; Danmaku WebSocket |

"Partial" means the RTMP URL is dynamic or per-account — you need to paste your stream URL/key manually from that platform's dashboard.

---

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [OBS Studio](https://obsproject.com/) (or any RTMP-capable encoder)
- Ports **1935** (RTMP) and **3737** (API) must be free

No system FFmpeg install needed — a binary is bundled automatically.

---

## OBS Setup

In OBS settings, under **Stream**:

- **Service:** Custom
- **Server:** `rtmp://localhost:1935/live`
- **Stream Key:** `ottery` (default — configurable in Settings)

---

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode (Electron + server + Angular hot reload)
npm run dev
```

---

## Building

### Development

```bash
npm run dev          # Full dev mode: Angular dev server + Node server + Electron
npm run server       # Server only (no Electron, useful for debugging)
npm run frontend     # Angular dev server only
```

### Production Installers

```bash
# Build the Angular frontend first
npm run build

# Then package for your platform
npm run package:win      # Windows — OtteryLive-Setup-x.x.x.exe (NSIS installer)
npm run package:mac      # macOS  — OtteryLive-x.x.x.dmg
npm run package:linux    # Linux  — OtteryLive-x.x.x.AppImage + .deb
npm run package:all      # All three platforms (intended for CI/CD)
```

Output is written to `dist/installers/`.

### Native Module Rebuild

`keytar` and `better-sqlite3` are native Node addons and must be compiled for Electron's Node version. This runs automatically on `npm install` via the `postinstall` script. If you change the Electron version, run it again manually:

```bash
npm run electron:rebuild
```

### macOS Code Signing

Requires full Xcode (not just Command Line Tools) and a valid Developer ID certificate. The `afterSign` hook in `package.json` handles re-signing the bundled FFmpeg binary, which is required under macOS Hardened Runtime.

### electron-builder Version

electron-builder is pinned to `23.6.0`. Versions >= 25.1.8 have a confirmed bug where `asarUnpack` is not honored correctly, which breaks the bundled FFmpeg binary in packaged builds.

---

## Testing

```bash
npm run test:server      # Server-side tests (Jest)
npm run test:frontend    # Angular tests (Karma)
npm run test:e2e         # End-to-end tests (Playwright)
```

---

## Data Storage

| Item        | Location |
|-------------|----------|
| Database    | `%APPDATA%\Ottery Live\ottery-live.db` (Windows) |
|             | `~/Library/Application Support/Ottery Live/ottery-live.db` (macOS) |
|             | `~/.config/Ottery Live/ottery-live.db` (Linux) |
| Credentials | OS keychain (Windows Credential Store / macOS Keychain / Linux libsecret) |
| Logs        | Same `userData` directory, under `logs/` |

---

## Environment Variables (Development Overrides)

```bash
OTTERY_RTMP_PORT=1935       # RTMP listen port (default: 1935)
OTTERY_SERVER_PORT=3737     # Express listen port (default: 3737)
OTTERY_DEV=true             # Enable Electron DevTools
```

No `.env` file is required for normal use.

---

## Tech Stack

- **Desktop shell:** Electron
- **Server:** Node.js + Express + Socket.io
- **Database:** SQLite via `better-sqlite3` + Knex
- **RTMP ingestion:** `node-media-server`
- **Restreaming:** FFmpeg (`ffmpeg-static`, bundled)
- **Frontend:** Angular 21

---

## Support

If you find Ottery Live useful, consider supporting development:

[ko-fi.com/zortech](https://ko-fi.com/zortech)

---

## License

Copyright © 2026 Ottery Live
