# Component 6: StreamTap

StreamTap is an **optional plain WebSocket server** that broadcasts the unified event
stream to any external process that connects to it. It is independent of the internal
Socket.io connection used by the Angular frontend.

Enable it in Settings → StreamTap. It is **off by default**.

## Purpose

Primary use cases:
- OBS browser-source overlays (alerts, chat widgets, donation tickers)
- Local alert bots and automation scripts
- Custom dashboards running in a separate process
- Any third-party tool that can consume a WebSocket

## Architecture

```
eventBus ──► StreamTapServer ──► connected clients (overlays, bots, tools)
                 │
                 ├── plain ws:// (not Socket.io)
                 ├── newline-delimited JSON messages
                 └── optional auth token
```

StreamTap listens on a separate port from the Express server (default `4747`).
It does **not** use Socket.io — clients connect with any standard WebSocket implementation.

## Message Format

Every `OtteryEvent` from the internal event bus is serialized as a single JSON line
followed by `\n`. The schema is identical to the normalized event schema in
[UNIFIED_EVENTS.md](UNIFIED_EVENTS.md).

```json
{"id":"18446744073709551615","sessionId":1,"platform":"twitch","type":"chat.message","timestamp":"2026-03-16T14:00:00.000Z","actor":{"platformId":"12345","username":"CoolViewer","displayName":"CoolViewer","isSubscriber":true,"isModerator":false},"data":{"message":"Hello stream!","color":"#FF4500","badges":["subscriber/6"],"emotes":[]}}
```

StreamTap also emits two system-level messages that are **not** `OtteryEvent` objects:

```json
{ "type": "streamtap.hello", "version": 1, "authenticated": true }
```
Sent immediately after a client connects (and authenticates, if a token is configured).

```json
{ "type": "streamtap.ping" }
```
Sent every 30 seconds as a keepalive. Clients may respond with any message containing
`"type":"streamtap.pong"` — no response is required; the ping is informational.

## Authentication

If `streamtap.authToken` is set (non-empty), clients must send the token as the first
message after connecting, within 5 seconds. The token message format:

```json
{ "type": "streamtap.auth", "token": "your-token-here" }
```

If the token is missing or incorrect the connection is closed with code `4401`.
If `streamtap.authToken` is empty (default) the server accepts all connections
immediately and sends `streamtap.hello` with `"authenticated": true`.

## Server Implementation

```js
// server/streamtap/streamtap-server.js
const { WebSocketServer } = require('ws');
const settings = require('../settings');
const eventBus = require('../events/event-bus');

class StreamTapServer {
  constructor() {
    this.wss = null;
    this.pingInterval = null;
  }

  async start() {
    const port = await settings.get('streamtap.port');
    const token = await settings.get('streamtap.authToken');  // may be null/empty

    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => this._handleConnection(ws, token));

    // Forward every OtteryEvent to all authenticated clients
    this._eventListener = (event) => this._broadcast(JSON.stringify(event) + '\n');
    eventBus.on('event', this._eventListener);

    // Keepalive ping every 30 s
    this.pingInterval = setInterval(() => {
      this._broadcast(JSON.stringify({ type: 'streamtap.ping' }) + '\n');
    }, 30_000);

    console.log(`[streamtap] listening on ws://localhost:${port}`);
  }

  stop() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this._eventListener) eventBus.off('event', this._eventListener);
    if (this.wss) this.wss.close();
    this.wss = null;
    console.log('[streamtap] stopped');
  }

  _handleConnection(ws, requiredToken) {
    ws.isAuthenticated = !requiredToken;  // no token = auto-authenticated

    if (ws.isAuthenticated) {
      this._sendHello(ws);
    } else {
      // Give client 5 s to send auth message
      ws._authTimer = setTimeout(() => {
        if (!ws.isAuthenticated) ws.close(4401, 'auth timeout');
      }, 5_000);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'streamtap.auth' && msg.token === requiredToken) {
            clearTimeout(ws._authTimer);
            ws.isAuthenticated = true;
            this._sendHello(ws);
          } else {
            ws.close(4401, 'invalid token');
          }
        } catch {
          ws.close(4400, 'bad message');
        }
      });
    }

    ws.on('error', (err) => console.warn('[streamtap] client error:', err.message));
  }

  _sendHello(ws) {
    ws.send(JSON.stringify({ type: 'streamtap.hello', version: 1, authenticated: true }) + '\n');
  }

  _broadcast(data) {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.isAuthenticated && client.readyState === 1 /* OPEN */) {
        client.send(data);
      }
    }
  }
}

module.exports = new StreamTapServer();
```

## Lifecycle

StreamTap is started/stopped by `server/index.js` based on the `streamtap.enabled` setting.
It also restarts automatically when the port setting changes (after the app restarts, per the
standard port-change flow).

```js
// server/index.js (excerpt)
const streamTap = require('./streamtap/streamtap-server');

async function startServer() {
  // ... start Express, Socket.io, RTMP ...
  if (await settings.get('streamtap.enabled')) {
    await streamTap.start();
  }
}
```

When the user toggles StreamTap on/off in Settings, the API calls `streamTap.start()` or
`streamTap.stop()` immediately — no app restart required (unlike port changes).

## Settings

See [APP_SETTINGS.md](APP_SETTINGS.md) for the full settings module. StreamTap adds:

| Key | Type | Default | Storage | Description |
|-----|------|---------|---------|-------------|
| `streamtap.enabled` | boolean | `false` | SQLite | Enable/disable the StreamTap WebSocket server |
| `streamtap.port` | number | `4747` | SQLite | Port StreamTap listens on. Requires restart to change. |
| `streamtap.authToken` | string | `""` | keychain | Optional bearer token. Empty = no auth required. |

### Settings UI

Located in Settings → StreamTap section:

| Setting | UI | Note |
|---|---|---|
| Enable StreamTap | Toggle | Starts/stops server immediately |
| Port | Number input | Default 4747; requires app restart to change |
| Auth token | Masked input + [Clear] button | Write-only; empty = open access |

When enabled, show a read-only connection info box:

> **Connect to:** `ws://localhost:4747`
> Events are broadcast as newline-delimited JSON.
> [Copy URL]

## Dependencies

| Package | Purpose |
|---------|---------|
| `ws` | Plain WebSocket server (already a common Node dep; lightweight) |

No Socket.io, no HTTP upgrade dance — `ws` speaks standard RFC 6455 WebSocket directly.

## Client Example

Minimal browser overlay (OBS browser source):

```html
<!DOCTYPE html>
<html>
<body>
<ul id="feed"></ul>
<script>
const ws = new WebSocket('ws://localhost:4747');

ws.onmessage = ({ data }) => {
  const event = JSON.parse(data.trim());
  if (!event.type || event.type.startsWith('streamtap.')) return;  // skip system messages

  const li = document.createElement('li');
  li.textContent = `[${event.platform}] ${event.type} — ${event.actor?.username ?? ''}`;
  document.getElementById('feed').prepend(li);
};
</script>
</body>
</html>
```

Minimal Node.js consumer:

```js
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:4747');

ws.on('message', (raw) => {
  const event = JSON.parse(raw.toString().trim());
  if (event.type?.startsWith('streamtap.')) return;
  console.log(event.platform, event.type, event.actor?.username);
});
```
