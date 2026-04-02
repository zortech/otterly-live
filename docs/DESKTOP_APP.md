# Component 5: Desktop App (Electron)

Ottery Live is packaged as a native desktop application using **Electron**.
Users download an installer for their platform — no separate runtime or server setup needed.

## How It Works at Runtime

```
User launches Ottery Live
  │
  ├── Electron main process starts
  │     ├── Checks port 1935 (RTMP) and 3737 (API) — warns if occupied
  │     ├── Runs Knex migrations on the SQLite DB (auto-migrate on start)
  │     ├── Starts the Node.js server (Express + Socket.io + node-media-server)
  │     └── Opens BrowserWindow → loads http://localhost:3737 (Angular app)
  │
  └── Node.js server ready
        └── User sees the Dashboard
```

The server starts **before** the BrowserWindow opens, so Angular is never shown
a blank/loading state due to the server not being ready.

## Electron Main Process

```js
// electron/main.js
const { app, BrowserWindow, shell } = require('electron');
const { startServer } = require('../server');

let mainWindow;

app.whenReady().then(async () => {
  await startServer();           // Express + RTMP ready before window opens
  createWindow();
  registerUriScheme();           // ottery-live:// OAuth callbacks
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 960, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,    // security: never enable this
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });
  mainWindow.loadURL('http://localhost:3737');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

## Context Bridge (preload.js)

The renderer (Angular) must not have direct Node.js access. Expose only what's
needed via the context bridge:

```js
// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('otteryElectron', {
  // Server port — Angular uses this to connect Socket.io to the correct port
  // Set by main.js via process.env before preload runs
  serverPort: parseInt(process.env.OTTERY_SERVER_PORT) || 3737,
  // Open OAuth URL in system browser (validated in main — never arbitrary input)
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Get app version for Settings → About page
  getVersion: () => ipcRenderer.invoke('get-version'),
  // Trigger manual update check
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
});
```

Angular accesses these as `window.otteryElectron.serverPort`, `window.otteryElectron.openExternal(url)`, etc.

### TypeScript Declaration

Add a global type declaration so Angular can use `window.otteryElectron` without TypeScript errors:

```typescript
// frontend/src/electron.d.ts
interface OtteryElectronBridge {
  serverPort: number;
  openExternal(url: string): Promise<void>;
  getVersion(): Promise<string>;
  checkForUpdates(): Promise<void>;
}

declare interface Window {
  otteryElectron?: OtteryElectronBridge;
}
```

The `?` makes it optional so the Angular app can gracefully handle running outside Electron (e.g., Angular dev server without Electron).

### IPC Handlers (main.js)

The preload `ipcRenderer.invoke()` calls require matching `ipcMain.handle()` registrations:

```js
// electron/main.js
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

// Allowlist of OAuth domains — only these are permitted for openExternal
const ALLOWED_OAUTH_ORIGINS = [
  'id.twitch.tv', 'www.twitch.tv',
  'id.kick.com',
  'accounts.google.com',
  'joystick.tv',
];

ipcMain.handle('open-external', async (_event, url) => {
  // Security: validate URL before opening system browser
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return;
    if (!ALLOWED_OAUTH_ORIGINS.some(o => parsed.hostname === o || parsed.hostname.endsWith('.' + o))) return;
    await shell.openExternal(url);
  } catch { /* invalid URL — ignore */ }
});

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdatesAndNotify());
```

## SQLite Data Location

Data is stored in Electron's `userData` directory:

| OS      | Path                                                      |
|---------|-----------------------------------------------------------|
| Windows | `%APPDATA%\Ottery Live\ottery-live.db`                    |
| macOS   | `~/Library/Application Support/Ottery Live/ottery-live.db`|
| Linux   | `~/.config/Ottery Live/ottery-live.db`                    |

```js
const { app } = require('electron');
const dbPath = path.join(app.getPath('userData'), 'ottery-live.db');
```

Migrations run automatically on startup (`knex.migrate.latest()`).

## Auto-Update

Auto-update uses **`electron-updater`** (part of `electron-builder`).

```js
// electron/main.js
const { autoUpdater } = require('electron-updater');

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
});

autoUpdater.on('update-downloaded', () => {
  mainWindow.webContents.send('update-ready');
  // Angular shows a "Restart to update" banner
});
```

Update artifacts (RELEASES file, delta packages) are published alongside installers.
Configure the update feed URL in `package.json` under `"build"`.

## Building and Packaging

### Prerequisites

```bash
npm install
# Rebuild native modules (keytar, better-sqlite3) for Electron's Node version
npm run electron:rebuild
```

### Development

```bash
npm run dev
# Starts: Angular dev server + Node.js server + Electron
# Hot reload for Angular (frontend changes)
# Nodemon for server changes
# Electron reloads BrowserWindow on server restart
```

### Production Build

```bash
npm run build            # Compile Angular + bundle server
npm run package:win      # .exe installer (NSIS) — run on Windows or via wine
npm run package:mac      # .dmg — requires macOS (code signing needs Xcode)
npm run package:linux    # .AppImage + .deb
npm run package:all      # all three (CI/CD only)
```

### electron-builder Version Pin

**Pin electron-builder to `23.6.0`** (or test carefully before upgrading past `25.1.8`).
Versions ≥ 25.1.8 have a confirmed bug where `asarUnpack` is not honored correctly,
causing native binaries to be included in the asar archive instead of unpacked alongside it.

### electron-builder Configuration (`package.json`)

```json
{
  "build": {
    "appId": "tv.ottery.live",
    "productName": "Ottery Live",
    "copyright": "Copyright © 2026 Ottery Live",
    "directories": { "output": "dist/installers" },
    "files": [
      "electron/**/*",
      "server/**/*",
      "dist/frontend/**/*",
      "node_modules/**/*",
      "!node_modules/ffmpeg-static/bin/linux/**",
      "!node_modules/ffmpeg-static/bin/darwin/**"
    ],
    "asarUnpack": [
      "node_modules/ffmpeg-static/bin/${os}/${arch}/ffmpeg",
      "node_modules/ffmpeg-static/index.js",
      "node_modules/ffmpeg-static/package.json"
    ],
    "extraResources": [
      { "from": "assets/", "to": "assets/" }
    ],
    "win": {
      "target": ["nsis"],
      "icon": "assets/icon.ico",
      "artifactName": "OtteryLive-Setup-${version}.exe"
    },
    "mac": {
      "target": ["dmg"],
      "icon": "assets/icon.icns",
      "category": "public.app-category.utilities",
      "artifactName": "OtteryLive-${version}.dmg"
    },
    "linux": {
      "target": ["AppImage", "deb"],
      "icon": "assets/icon.png",
      "category": "AudioVideo",
      "artifactName": "OtteryLive-${version}.AppImage"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true
    },
    "publish": {
      "provider": "github",
      "owner": "ottery-live",
      "repo": "ottery-live"
    }
  }
}
```

### Handling Native Modules

`keytar` and `better-sqlite3` are native Node addons. They must be compiled
for Electron's Node version, not the system Node version.

```bash
# Rebuild after npm install and after electron version changes
./node_modules/.bin/electron-rebuild
```

In CI/CD, run `electron-rebuild` before packaging.

### FFmpeg Binary Inclusion

`ffmpeg-static` ships binaries for all platforms. Exclude unused platform
binaries from the installer to reduce size:

```json
"files": [
  "!node_modules/ffmpeg-static/bin/linux/**",   // exclude on Windows build
  "!node_modules/ffmpeg-static/bin/darwin/**"   // exclude on Windows build
]
```

Or use platform-specific overrides in `win`/`mac`/`linux` sections.

## FFmpeg Path Resolution

Always resolve the FFmpeg path in the **main/server process**, not the renderer.
Apply the `.replace()` fix for packaged builds:

```js
// server/restream/restream-manager.js (or electron/main.js before server start)
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
// Safe in dev (path won't contain 'app.asar'); correct in production
```

**Windows arm64:** `ffmpeg-static` does not ship a Windows arm64 binary.
For arm64 support, place a custom `ffmpeg.exe` in `extraResources` and resolve via:
```js
const ffmpegPath = path.join(process.resourcesPath, 'ffmpeg.exe');
```

## macOS Code Signing (Hardened Runtime + FFmpeg)

FFmpeg binaries crash with `SIGILL` under macOS Hardened Runtime unless signed correctly.
This must happen **before** notarization and **after** the ASAR is unpacked.

**Required steps:**

1. Ensure ffmpeg is in `app.asar.unpacked` (configured via `asarUnpack` above)
2. Sign the ffmpeg binary directly — `--deep` on the app bundle is not sufficient:
   ```bash
   codesign --force --options runtime \
     --entitlements entitlements.plist \
     --sign "Developer ID Application: Your Name (TEAMID)" \
     "Ottery Live.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/bin/darwin/arm64/ffmpeg"
   ```
3. Use full **Xcode** (not just Xcode Command Line Tools) — `--entitlements` can silently fail with CLI tools only
4. `entitlements.plist` must include:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>com.apple.security.cs.allow-jit</key><true/>
     <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
   </dict></plist>
   ```

electron-builder can automate this via the `afterSign` hook — add a script that
re-signs the ffmpeg binary after the main app bundle is signed.

## Port Conflict Detection

On startup, before launching the server, check required ports:

```js
// server/lib/port-check.js
async function checkPorts() {
  const issues = [];
  if (!await isPortFree(1935)) issues.push('Port 1935 (RTMP) is already in use');
  if (!await isPortFree(3737)) issues.push('Port 3737 (API) is already in use');
  return issues;
}
```

If ports are occupied, show an error dialog (not a crash) with instructions.
Allow the user to configure alternate ports in Settings.

## System Tray

Ottery Live runs in the system tray. Closing the main window does not quit the app —
the RTMP server keeps running so OBS stays connected.

```js
const tray = new Tray(path.join(__dirname, '../assets/tray-icon.png'));
tray.setContextMenu(Menu.buildFromTemplate([
  { label: 'Open Dashboard', click: () => mainWindow.show() },
  { label: 'Quit', click: () => app.exit() },
]));

mainWindow.on('close', (e) => {
  e.preventDefault();     // intercept close
  mainWindow.hide();      // minimize to tray instead of quitting
});
```

### Tray Icon Asset Requirements

| Platform | Format | Size | Notes |
|---|---|---|---|
| macOS | PNG template image | 16×16 + 32×32 (@2x) | Must be black + transparent only (no color). Filename: `tray-icon.png` + `tray-icon@2x.png`. macOS renders template images in light/dark mode automatically. |
| Windows | PNG or ICO | 16×16 | Color OK; 32-bit PNG with alpha works |
| Linux | PNG | 22×22 or 24×24 | Color OK; matches typical system tray size |

Provide separate tray assets from the app icon. A colored app icon used as a tray icon looks wrong on macOS.

## Security Checklist

- `nodeIntegration: false` — renderer never has direct Node.js access
- `contextIsolation: true` — preload and renderer are separate contexts
- `contextBridge` exposes only specific, safe methods — see IPC Handlers section for `open-external` allowlist
- No `eval()` or `new Function()` in renderer
- `Content-Security-Policy` header set on the Express server (see below)
- `webSecurity: true` (default) — do not disable
- Shell open only for explicitly allowlisted OAuth domains, not arbitrary user input
- **Express binds to `127.0.0.1` only** — never `0.0.0.0`. If bound to all interfaces, the API is reachable from any LAN machine.
  ```js
  server.listen(port, '127.0.0.1', () => { ... });
  ```
- **No CORS** — omit `cors()` middleware entirely. The Angular app is same-origin (served by Express). An open CORS policy would allow any browser tab to call the API.
- **SQLite WAL mode** — enable after connecting to prevent corruption on force-quit:
  ```js
  // server/db/knex.js — after knex instance is created
  db.raw('PRAGMA journal_mode=WAL').then(() => {});
  db.raw('PRAGMA foreign_keys=ON').then(() => {});
  ```
- **Rate limit test endpoints** — `POST /api/stream-services/:id/test-rtmp` spawns FFmpeg; add a 10-second cooldown per service to prevent spawn floods.

### Content-Security-Policy

Set this header in the Express server for all responses (including the Angular app):

```js
// server/index.js
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +         // Angular needs inline styles
    "connect-src 'self' ws://localhost:* wss://localhost:*; " +  // Socket.io WebSocket
    "img-src 'self' data: https:; " +              // platform avatars via HTTPS
    "font-src 'self' data:;"
  );
  next();
});
```

> `unsafe-inline` for styles is required by Angular's component styles. Do not add it to `script-src`.

## Startup Sequence

```
1. app.whenReady()
2. Check port availability → dialog if conflict
3. Resolve SQLite path from userData
4. Run knex.migrate.latest() — apply any new migrations
5. Start Express + Socket.io on port 3737
6. Start node-media-server on port 1935
7. Set up URI scheme handler (ottery-live://)
8. Create BrowserWindow → loadURL('http://localhost:3737')
9. Register system tray icon + context menu
10. Check for auto-updates (after window is ready)
```
