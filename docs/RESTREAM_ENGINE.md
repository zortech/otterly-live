# Component 1 + 1.1: Restream Engine

The restream engine receives an RTMP stream from OBS and forwards it to
one or more platform RTMP endpoints using FFmpeg. Each platform is an
independent FFmpeg child process — toggling one does not affect others.

FFmpeg is **bundled** via the `ffmpeg-static` npm package. No system FFmpeg required.

## Bundled FFmpeg

```js
// Always resolve in the main/server process — NOT in the renderer (webpack rewrites require())
// The .replace() is a no-op in development (path won't contain 'app.asar')
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
// Resolves to the correct binary for the current OS + arch:
//   Windows:  .../app.asar.unpacked/node_modules/ffmpeg-static/bin/win32/x64/ffmpeg.exe
//   macOS:    .../app.asar.unpacked/node_modules/ffmpeg-static/bin/darwin/arm64/ffmpeg
//   Linux:    .../app.asar.unpacked/node_modules/ffmpeg-static/bin/linux/x64/ffmpeg
```

> **Windows arm64 is not supported** by `ffmpeg-static`. If arm64 support is needed,
> supply a custom binary via `extraResources` and resolve it via `process.resourcesPath`.

> **macOS notarization:** The ffmpeg binary must be separately code-signed with Hardened
> Runtime + JIT entitlements before notarizing. See [DESKTOP_APP.md](DESKTOP_APP.md).

`ffmpeg-static` ships pre-compiled binaries for `win32-x64`, `darwin-x64`,
`darwin-arm64`, `linux-x64`, and `linux-arm64`. Electron Builder includes it
automatically since it's a prod dependency.

## RTMP Ingestion

`node-media-server` v4 runs as a **child process** — not in the same process as
Express/Socket.io. This isolates memory leaks and crashes from the main app.

> **v4 vs v2:** Most online tutorials reference v2. v4 is a breaking change —
> configuration and event API are different. Use v4 docs only.

**Known issues to design around:**
- Confirmed memory leaks in long-running sessions (issues #448, #473) — the child
  process watchdog handles this by restarting it when heap grows past a threshold
- **Windows port 1935 EACCES:** Windows may block binding to 1935 even with nothing
  using it (OS reservation or UAC). Default port is 1935 but users can change it in
  Settings. App detects this error and prompts the user to try a different port.

OBS connects to:
```
Server:     rtmp://localhost:{rtmp.port}/live
Stream Key: {rtmp.incomingKey setting}   (default: "ottery")
```

### Child Process Architecture

```js
// server/rtmp/rtmp-process.js  — run via child_process.fork()
// IMPORTANT: never require('electron') here — fatal in packaged apps
const NodeMediaServer = require('node-media-server');

const nms = new NodeMediaServer({
  rtmp: { port: parseInt(process.env.RTMP_PORT), chunk_size: 60000,
          gop_cache: true, ping: 60, ping_timeout: 30 },
  logType: 0,
});

nms.on('postPublish', (_id, streamPath) => process.send({ event: 'stream.start', streamPath }));
nms.on('donePublish', (_id, streamPath) => process.send({ event: 'stream.end', streamPath }));
nms.run();

// Watchdog: report heap usage every 30s so parent can restart if needed
setInterval(() => {
  process.send({ event: 'health', heapUsedMB: process.memoryUsage().heapUsed / 1024 / 1024 });
}, 30_000);
```

```js
// server/rtmp/rtmp-manager.js  — runs in main server process
const { fork } = require('child_process');

class RtmpManager {
  start(port, incomingKey) {
    this.proc = fork(path.join(__dirname, 'rtmp-process.js'), [], {
      env: { ...process.env, RTMP_PORT: port, RTMP_KEY: incomingKey },
      silent: true,
    });

    this.proc.on('message', (msg) => {
      if (msg.event === 'stream.start') restreamManager.onStreamStart(msg.streamPath);
      if (msg.event === 'stream.end')   restreamManager.onStreamEnd(msg.streamPath);
      if (msg.event === 'health' && msg.heapUsedMB > 512) this.restart();  // 512MB threshold
    });

    this.proc.on('exit', (code) => {
      if (code !== 0) setTimeout(() => this.start(port, incomingKey), 2000);  // auto-restart
    });
  }

  restart() {
    this.proc?.kill();
    // exit handler triggers auto-restart
  }
}
```

## RestreamManager

```js
// server/restream/restream-manager.js
class RestreamManager {
  constructor(eventBus) {
    this.processes = new Map();   // serviceId → ChildProcess
    this.eventBus = eventBus;
  }

  async onStreamStart(streamPath) {
    const services = await StreamService.getAllActive();
    for (const svc of services) {
      const creds = await StreamService.getWithCredentials(svc.id);
      if (svc.restream_enabled && svc.auto_start) this.startPlatform(creds);
      if (svc.event_capture_enabled && svc.auto_start) eventCaptureManager.start(svc.id);
    }
    this.eventBus.emit('session.started');
  }

  async onStreamEnd() {
    this.stopAll();
    // event capture continues — call eventCaptureManager.stopAll() only if explicitly requested
    this.eventBus.emit('session.ended');
  }

  startPlatform(svc) {
    if (this.processes.has(svc.id)) return;  // already running
    const proc = spawnFFmpeg(svc);
    this.processes.set(svc.id, { proc, svc, restarts: 0 });
    this.eventBus.emit('restream.started', { serviceId: svc.id, platform: svc.platform });
  }

  stopPlatform(serviceId) {
    const entry = this.processes.get(serviceId);
    if (!entry) return;
    entry.proc.kill('SIGTERM');
    this.processes.delete(serviceId);
    this.eventBus.emit('restream.stopped', { serviceId });
  }

  toggle(serviceId, enabled) {
    enabled ? this.startPlatform(...) : this.stopPlatform(serviceId);
  }

  stopAll() {
    for (const id of this.processes.keys()) this.stopPlatform(id);
  }

  status() {
    // returns Map<serviceId, 'live'|'stopped'|'error'>
  }
}
```

## FFmpeg Process per Platform

```js
function spawnFFmpeg(svc) {
  // Build destination URL — platform-specific handling below
  const dest = buildDestUrl(svc);

  // SECURITY: always use spawn() with an args array, never exec() or shell: true.
  // dest is passed as a single argument — spaces or special chars in rtmp_url/stream_key
  // cannot inject additional FFmpeg flags this way.
  const proc = spawn(ffmpegPath, [
    '-re',
    '-i', `rtmp://127.0.0.1:1935/live/${settings.get('rtmpStreamKey')}`,
    '-c', 'copy',   // no transcoding — zero CPU overhead
    '-f', 'flv',
    dest,
  ], { windowsHide: true });  // hide console window on Windows

  // Redact stream key from FFmpeg stderr before logging
  proc.stderr.on('data', (d) => {
    const safe = d.toString().replace(/(rtmps?:\/\/[^/]+\/[^/]+\/)(\S+)/, '$1[REDACTED]');
    logger.debug(`[${svc.platform}]`, safe.trim());
  });
  proc.on('exit', (code, signal) => handleExit(svc, code, signal));
  return proc;
}

function buildDestUrl(svc) {
  if (svc.platform === 'tiktok') {
    // TikTok stream key already contains query params (e.g. stream-XXXX?sign=...)
    // Appending with / would break the URL — use ? separator if no ? present, else &
    return svc.stream_key.includes('?')
      ? `${svc.rtmp_url}/${svc.stream_key}`
      : `${svc.rtmp_url}/${svc.stream_key}`;
    // In practice TikTok Live Center provides the key pre-formatted; just append as path.
  }
  return `${svc.rtmp_url}/${svc.stream_key}`;
}
```

`-c copy` passes audio and video through without re-encoding.
This preserves quality and uses near-zero CPU regardless of bitrate.

### `windowsHide: true`
On Windows, spawning a process without this flag opens a console window briefly.
Always set this for FFmpeg child processes in an Electron app.

## Auto-Restart on FFmpeg Crash

```js
function handleExit(svc, code) {
  if (code === 0 || !processes.has(svc.id)) return;  // intentional stop
  const entry = processes.get(svc.id);
  if (entry.restarts >= 3) {
    processes.delete(svc.id);
    eventBus.emit('restream.error', { serviceId: svc.id, reason: 'max_restarts' });
    return;
  }
  const delay = Math.pow(2, entry.restarts) * 1000;  // 1s, 2s, 4s
  setTimeout(() => startPlatform(svc), delay);
  entry.restarts++;
}
```

## Toggling Mid-Stream

Toggling a platform while OBS is streaming does **not** reconnect OBS or interrupt
other platforms. It only starts/stops that platform's FFmpeg process.

```
POST /api/stream/toggle   { serviceId: 3, enabled: false }
```

## Component 1.1: Event Capture Lifecycle

When a stream starts, `EventCaptureManager` is started for all platforms with
`event_capture_enabled: true` and `auto_start: true`. When the stream ends,
event capture **continues** — it stops only when explicitly requested.

### Behavior Matrix

| Restream starts | Event capture config | Result                              |
|-----------------|----------------------|-------------------------------------|
| OBS connects    | enabled + auto_start | Start restream + event capture       |
| OBS connects    | disabled             | Start restream only                  |
| OBS disconnects | (any)                | Stop restream; event capture continues |
| Manual stop     | (any)                | Stop restream only                   |

### Independent Event Capture

Event capture can be started without restreaming (e.g., TikTok chat monitoring):

```
POST /api/event-capture/start   { serviceId: 4 }
POST /api/event-capture/stop    { serviceId: 4 }
```

## Stream Session

On stream start, a `stream_sessions` row is created in SQLite:

```js
// server/db/migrations/002_create_stream_sessions.js
t.increments('id');
// NOTE: sessions are global OBS connection events, not per-platform.
// stream_service_id is intentionally omitted — a single session spans multiple platforms.
// restream_targets records which platforms were active during this session.
t.string('state').defaultTo('live');   // live | ended | error
t.datetime('started_at');
t.datetime('ended_at');
t.integer('peak_viewers').defaultTo(0);
t.integer('total_events').defaultTo(0);
t.json('restream_targets');   // array of platform names that were live during this session
t.timestamps(true, true);
```

## Requirements

- `ffmpeg-static` npm package (bundled binary — no system FFmpeg needed)
- `node-media-server` npm package
- Port 1935 must be available (checked on app start; user is warned if occupied)
- OBS must push to `rtmp://localhost:1935/live/{rtmpStreamKey}`
