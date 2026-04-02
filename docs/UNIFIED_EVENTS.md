# Component 2: Unified Event Stream

All platform events are normalized to a common schema and emitted on an in-process
Node.js `EventEmitter` (the **event bus**). Socket.io broadcasts these to the Angular
frontend in real time. No Redis or external broker required.

## Event Bus

```js
// server/events/event-bus.js
const EventEmitter = require('events');
const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);  // one per platform + system listeners
module.exports = eventBus;
```

All platform capture workers, the restream manager, and Socket.io share this
single instance. Since everything runs in one Node.js process, no IPC is needed.

```
TwitchCapture    ─emit('event', e)─┐
KickCapture      ─emit('event', e)─┤
TikTokCapture    ─emit('event', e)─┤
XCapture         ─emit('event', e)─┼─► eventBus ─► Socket.io ─► Angular
RumbleCapture    ─emit('event', e)─┤              ─► SQLite (async persist)
FacebookCapture  ─emit('event', e)─┤
BilibiliCapture  ─emit('event', e)─┤
RestreamManager  ─emit(...)────────┘
```

## Socket.io Bridge

```js
// server/events/socket-bridge.js
function attachSocketBridge(io, eventBus) {
  eventBus.on('event', (otteryEvent) => {
    io.emit('ottery:event', otteryEvent);
  });
  eventBus.on('restream.started', (data) => io.emit('ottery:status', data));
  eventBus.on('restream.stopped', (data) => io.emit('ottery:status', data));
  eventBus.on('restream.error',   (data) => io.emit('ottery:status', data));
  eventBus.on('session.started',  ()     => io.emit('ottery:session', { state: 'live' }));
  eventBus.on('session.ended',    ()     => io.emit('ottery:session', { state: 'ended' }));
}
```

## Normalized Event Schema

```typescript
interface OtteryEvent {
  id: string;              // Snowflake-style ID (generated server-side)
  sessionId: number | null;
  platform: Platform;      // 'twitch' | 'kick' | 'tiktok' | 'x' | 'joystick'
  type: EventType;
  timestamp: string;       // ISO 8601
  actor: EventActor | null;
  data: Record<string, unknown>;
}

interface EventActor {
  platformId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  isSubscriber?: boolean;
  isModerator?: boolean;
}

type Platform = 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'x' | 'joystick' | 'rumble' | 'facebook' | 'bilibili';

type EventType =
  | 'chat.message'
  | 'follow'
  | 'subscribe'
  | 'subscribe.gift'
  | 'cheer'
  | 'tip'
  | 'like'
  | 'share'
  | 'raid'
  | 'stream.start'
  | 'stream.end'
  | 'viewer_count'
  | 'system.capture_connected'
  | 'system.capture_disconnected'
  | 'system.capture_error';
```

## Event Type Payloads

### `chat.message`
```json
{
  "type": "chat.message",
  "actor": { "username": "CoolViewer", "isSubscriber": true },
  "data": {
    "message": "Hello stream!",
    "color": "#FF4500",
    "badges": ["subscriber/6"],
    "emotes": [{ "id": "25", "name": "Kappa", "positions": [[10, 14]] }]
  }
}
```

### `follow`
```json
{ "type": "follow", "actor": { "username": "NewFan" }, "data": {} }
```

### `subscribe`
```json
{
  "type": "subscribe",
  "actor": { "username": "LoyalSub" },
  "data": { "tier": "1000", "durationMonths": 3, "streakMonths": 3, "message": "Love the content!" }
}
```

### `subscribe.gift`
```json
{
  "type": "subscribe.gift",
  "actor": { "username": "GiftGiver" },
  "data": { "count": 5, "tier": "1000", "totalGifted": 50 }
}
```

### `cheer`
```json
{ "type": "cheer", "actor": { "username": "BitsFan" }, "data": { "bits": 500, "message": "Pog!" } }
```

### `tip`
```json
{ "type": "tip", "actor": { "username": "Generous" }, "data": { "amount": 5.00, "currency": "USD", "message": "Keep it up!" } }
```

### `viewer_count`
```json
{ "type": "viewer_count", "actor": null, "data": { "count": 142 } }
```

### `stream.start` / `stream.end`
```json
{ "type": "stream.start", "actor": null, "data": { "title": "Chill vibes", "game": "Just Chatting" } }
```

### `system.*`
```json
{ "type": "system.capture_error", "actor": null, "data": { "serviceId": 3, "reason": "auth_failed" } }
```

## ID Generation

```js
// server/lib/id.js — simple snowflake-style ID for desktop (single machine)
let seq = 0;
const EPOCH = 1704067200000n;  // 2024-01-01

function generateId() {
  const ts = BigInt(Date.now()) - EPOCH;
  const id = (ts << 22n) | BigInt(seq++ & 0xFFF);
  return id.toString();
}
```

No machine ID component needed — desktop app runs on a single machine.

## Session ID Propagation

Every `OtteryEvent` carries a `sessionId` so events can be linked to the stream session
in SQLite. The active session ID is held by `RestreamManager` after it creates the session
row, and is injected into events by `EventCaptureManager` workers at emit time.

```js
// server/restream/restream-manager.js
async onStreamStart(streamPath) {
  const [sessionId] = await db('stream_sessions').insert({
    state: 'live',
    started_at: new Date().toISOString(),
  });
  this.activeSessionId = sessionId;           // store for capture workers to read
  eventCaptureManager.setSessionId(sessionId);
  this.eventBus.emit('session.started', { sessionId });
  // ... start FFmpeg processes
}

async onStreamEnd() {
  if (this.activeSessionId) {
    await db('stream_sessions').where({ id: this.activeSessionId })
      .update({ state: 'ended', ended_at: new Date().toISOString() });
  }
  this.activeSessionId = null;
  eventCaptureManager.setSessionId(null);
  this.stopAll();
  this.eventBus.emit('session.ended');
}
```

```js
// server/event-capture/manager.js
setSessionId(id) {
  this.activeSessionId = id;
}

// Workers call this helper (provided by manager) to build normalized events:
buildEvent(platform, type, actor, data) {
  return {
    id: generateId(),
    sessionId: this.activeSessionId,   // injected here — workers never set it directly
    platform,
    type,
    timestamp: new Date().toISOString(),
    actor,
    data,
  };
}
```

Workers emit events via `this.emit('event', this.manager.buildEvent(...))` rather than
constructing `OtteryEvent` objects manually. This guarantees `sessionId` is always correct
even when event capture runs without an active restream session (sessionId will be `null`).

## Database Persistence

Events are persisted asynchronously to SQLite after emission (fire-and-forget):

```js
eventBus.on('event', async (e) => {
  await db('stream_events').insert({
    session_id:  e.sessionId,
    platform:    e.platform,
    event_type:  e.type,
    actor_json:  JSON.stringify(e.actor),
    data_json:   JSON.stringify(e.data),
    occurred_at: e.timestamp,
  });
});
```

### Schema

```js
// server/db/migrations/003_create_stream_events.js
t.increments('id');
t.integer('session_id').references('stream_sessions.id').nullable();
t.string('platform').notNullable();
t.string('event_type').notNullable();
t.json('actor_json');
t.json('data_json');
t.datetime('occurred_at').notNullable();
t.timestamps(true, true);

// Indices — stream_events can accumulate millions of rows; these are required
table.index(['session_id']);
table.index(['platform']);
table.index(['event_type']);
table.index(['occurred_at']);
```

## Session Stat Aggregation

Session stats are updated in-memory and flushed to SQLite every 30 seconds:

```js
const stats = { follows: 0, subs: 0, giftSubs: 0, cheers: 0, tips: 0, peakViewers: 0 };

eventBus.on('event', (e) => {
  if (e.type === 'follow')          stats.follows++;
  if (e.type === 'subscribe')       stats.subs++;
  if (e.type === 'subscribe.gift')  stats.giftSubs += e.data.count ?? 1;
  if (e.type === 'cheer')           stats.cheers += e.data.bits ?? 0;
  if (e.type === 'tip')             stats.tips += e.data.amount ?? 0;
  if (e.type === 'viewer_count')    stats.peakViewers = Math.max(stats.peakViewers, e.data.count);
});
```

## Frontend Socket.io Client

```typescript
// frontend/src/app/ottery-live/ottery-live.service.ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3737');

socket.on('ottery:event',   (event: OtteryEvent) => this.handleEvent(event));
socket.on('ottery:status',  (data)               => this.handleStatus(data));
socket.on('ottery:session', (data)               => this.handleSession(data));
```

Port `3737` is the Express server port (configurable in app settings).
Angular always connects to `localhost` since the server is in-process with Electron.
