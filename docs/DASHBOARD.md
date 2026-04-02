# Component 3: Dashboard

The dashboard is the primary operator interface for Ottery Live. It gives a
real-time view of stream health, per-platform restream and capture controls,
a live unified event feed, session statistics, and a viewer count chart.
A secondary route (`/ottery-live/events`) provides a full filterable,
searchable, exportable historical event log backed by SQLite.

---

## Routes

| Route                    | Description                                                          |
|--------------------------|----------------------------------------------------------------------|
| `/ottery-live`           | Main dashboard: stream health, platform cards, live event feed, session stats |
| `/ottery-live/events`    | Historical event log: filters, table view, pagination, CSV export    |
| `/ottery-live/platforms` | Platform Management (Component 4 — separate doc)                     |
| `/ottery-live/settings`  | App Settings (separate doc)                                          |

---

## Layout

### Idle State (no active session)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Ottery Live                                    [Start All]  [Stop All]     │
│  ○ Waiting for OBS  ·  Server: rtmp://localhost:1935/live  Key: ottery      │
├──────────────────────────────┬─────────────────────────────────────────────┤
│  STREAM STATUS               │  LIVE EVENT FEED                            │
│                              │                                             │
│  ┌──────────────────────┐    │  [All] [Twitch] [YouTube] [Kick]            │
│  │ ○ Twitch   ○/○       │    │  [TikTok] [X] [Joystick]                   │
│  │   Restream  [▶ Start]│    │  [All types] [Chat] [Follows] [Subs]        │
│  │   Capture   [▶ Start]│    │  [Donations] [Raids] [System]              │
│  └──────────────────────┘    │  ─────────────────────────────────────────  │
│  ┌──────────────────────┐    │                                             │
│  │ ○ YouTube  ○/○       │    │      No active session.                     │
│  │   Restream  [▶ Start]│    │      Start streaming from OBS to see        │
│  │   Capture   [▶ Start]│    │      live events here.                      │
│  └──────────────────────┘    │                                             │
│  ┌──────────────────────┐    │                                             │
│  │ ○ Kick     ○/○       │    │                                             │
│  │   Restream  [▶ Start]│    │                                             │
│  │   Capture   [▶ Start]│    │                                             │
│  └──────────────────────┘    │                                             │
│  ┌──────────────────────┐    │                                             │
│  │ ⚠ TikTok   ○/○       │    │                                             │
│  │   (capture only)     │    │                                             │
│  │   Capture   [▶ Start]│    │                                             │
│  └──────────────────────┘    │                                             │
│  ┌──────────────────────┐    │                                             │
│  │ ○ X        ○/─       │    │                                             │
│  │   Restream  [▶ Start]│    │                                             │
│  │   Capture   N/A      │    │                                             │
│  └──────────────────────┘    │                                             │
│  ┌──────────────────────┐    │                                             │
│  │ ○ Joystick ○/○       │    │                                             │
│  │   Restream  [▶ Start]│    │                                             │
│  │   Capture   [▶ Start]│    │                                             │
│  └──────────────────────┘    │                                             │
│                              │                                             │
│  SESSION STATS               │                                             │
│  ─────────────────           │                                             │
│  No active session.          │                                             │
│  Start OBS to begin.         │                                             │
└──────────────────────────────┴─────────────────────────────────────────────┘
```

### Live State (active session, all panels)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Ottery Live                                    [Start All]  [Stop All]     │
│  ● OBS Connected · Session 1h 23m 44s                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ ⚠  Twitch: Re-authentication required.  [Reconnect]           [✕]   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────┤
│  STREAM HEALTH     3,850 kbps  ▓▓▓▓▓▓▓▓░  30fps  0 dropped  ↺0 reconnects  │
│  Twitch ●  Kick ●  YouTube ●  TikTok ─  X ●                                │
├──────────────────────────────┬─────────────────────────────────────────────┤
│  STREAM STATUS               │  LIVE EVENT FEED                            │
│                              │                                             │
│  ┌──────────────────────┐    │  [All] [Twitch] [YouTube] [Kick]            │
│  │ ● Twitch   ●/●       │    │  [TikTok] [X] [Joystick]                   │
│  │   Restream  [■ Stop] │    │  [All types] [Chat] [Follows] [Subs]        │
│  │   Capture   (auto)   │    │  [Donations] [Raids] [System]              │
│  └──────────────────────┘    │  ─────────────────────────────────────────  │
│  ┌──────────────────────┐    │  14:32:22  youtube  sub    LoyalMember · 3m │
│  │ ● YouTube  ●/●       │    │  14:32:18  twitch   follow  NewFan followed │
│  │   Restream  [■ Stop] │    │  14:32:11  kick     tip    Generous $10.00  │
│  │   Capture   (auto)   │    │  14:32:01  tiktok   like   × 247 likes      │
│  └──────────────────────┘    │  14:31:55  twitch   cheer  BitsFan 500 bits │
│  ┌──────────────────────┐    │  14:31:44  tiktok   gift   5 roses ($5.00)  │
│  │ ● Kick     ●/●       │    │  14:31:12  twitch   chat   CoolViewer: hi!  │
│  │   Restream  [■ Stop] │    │  ...                                        │
│  │   Capture   (auto)   │    │                                             │
│  └──────────────────────┘    │                                             │
│  ┌──────────────────────┐    │                                             │
│  │ ⚠ TikTok   ─/●       │    │                                             │
│  │   (capture only)     │    │                                             │
│  │   Capture   [■ Stop] │    │                                             │
│  └──────────────────────┘    │                                             │
│  ┌──────────────────────┐    │                                             │
│  │ ● X        ●/─       │    │                                             │
│  │   Restream  [■ Stop] │    │                                             │
│  │   Capture   N/A      │    │                                             │
│  └──────────────────────┘    │                                             │
│  ┌──────────────────────┐    │                                             │
│  │ ● Joystick ●/●       │    │                                             │
│  │   Restream  [■ Stop] │    │                                             │
│  │   Capture   (auto)   │    │                                             │
│  └──────────────────────┘    │                                             │
│                              │                                             │
│  SESSION STATS               │                                             │
│  ─────────────────────────   │                                             │
│  Duration   1h 23m 44s       │                                             │
│  Viewers    142 peak         │                                             │
│             34  Twitch       │                                             │
│             89  Kick         │                                             │
│             19  TikTok       │                                             │
│  Follows    34               │                                             │
│  Subs        7               │                                             │
│  Gift Subs   3               │                                             │
│  Cheers   1,250 bits         │                                             │
│  Tips      $22.50 USD        │                                             │
│                              │                                             │
│  VIEWER CHART                │                                             │
│  ───────────                 │                                             │
│  [line chart: viewers        │                                             │
│   over session time,         │                                             │
│   per-platform lines]        │                                             │
└──────────────────────────────┴─────────────────────────────────────────────┘
```

The left column (stream status, session stats, viewer chart) has a fixed width
(~280–320px). The right column (event feed) fills remaining space with virtual
scroll.

---

## Socket.io Message Schemas

The server sends the following Socket.io events. All are sent server → client.
The client never sends anything back on these channels; REST API is used for all
commands.

### `ottery:snapshot`

Sent immediately on client `connect`. Gives the frontend complete current state
without waiting for the next event. This is always the first message a freshly
connected client receives.

```typescript
interface OtterySnapshot {
  platforms:     PlatformStatus[];     // all configured services + live state
  session:       SessionState | null;  // null if no active session
  obs:           { state: 'publishing' | 'idle' };
  streamHealth:  StreamHealth | null;  // null until first OBS WebSocket data
  authRequired:  AuthRequired[];       // platforms currently needing reauth
  recentEvents:  OtteryEvent[];        // last 50 events (newest first)
}

interface PlatformStatus {
  serviceId:        number;
  platform:         string;   // 'twitch'|'youtube'|'kick'|'tiktok'|'x'|'joystick'
  displayName:      string;
  restreamEnabled:  boolean;
  captureEnabled:   boolean;
  captureSupported: boolean;  // false for X
  restreamState:    'live' | 'stopped' | 'connecting' | 'error';
  captureState:     'live' | 'stopped' | 'connecting' | 'error' | 'n/a';
  errorMessage?:    string;
  needsReauth:      boolean;
  ffmpegHealth:     FfmpegHealth | null;  // null when not live
}

interface FfmpegHealth {
  kbitsPerSec:    number;    // current bitrate reported by FFmpeg stderr
  fps:            number;
  droppedFrames:  number;    // cumulative since process start
  totalFrames:    number;
  reconnects:     number;    // how many times this FFmpeg process has been restarted
  uptime:         number;    // seconds since this FFmpeg process started
}

interface StreamHealth {
  // From OBS WebSocket (obs-websocket plugin) if connected; null if not
  kbitsPerSec:       number;   // bitrate OBS is sending out
  fps:               number;   // actual output FPS
  droppedFrames:     number;   // cumulative dropped frames reported by OBS
  totalFrames:       number;
  obsWebsocketConnected: boolean;
}

interface SessionState {
  sessionId:  number;
  state:      'live' | 'ended';
  startedAt:  string;          // ISO 8601
  endedAt?:   string;
  stats:      SessionStats;
  viewerHistory: ViewerHistoryPoint[];  // for chart pre-population on reconnect
}

interface SessionStats {
  follows:        number;
  subs:           number;
  giftSubs:       number;
  cheers:         number;          // total bits
  tips:           number;          // total USD value
  tipsCurrency:   string;          // always 'USD'
  peakViewers:    number;
  currentViewers: Partial<Record<Platform, number | null>>;
}

interface ViewerHistoryPoint {
  elapsedMs:  number;   // milliseconds since session start
  platform:   Platform;
  count:      number;
}

interface AuthRequired {
  serviceId:    number;
  platform:     string;
  displayName:  string;
}
```

Server builds the snapshot synchronously from in-memory managers on each new
connection:

```js
// server/events/socket-bridge.js
io.on('connection', (socket) => {
  socket.emit('ottery:snapshot', buildSnapshot());
});

function buildSnapshot() {
  return {
    platforms:    buildPlatformStatuses(),
    session:      sessionManager.getActiveSessionState(),
    obs:          { state: rtmpManager.isPublishing() ? 'publishing' : 'idle' },
    streamHealth: streamHealthMonitor.getCurrent(),
    authRequired: buildPlatformStatuses().filter(p => p.needsReauth)
                    .map(({ serviceId, platform, displayName }) => ({ serviceId, platform, displayName })),
    recentEvents: eventBuffer.getLast(50),  // in-memory ring buffer (last 100 events)
  };
}
```

### `ottery:event`

A normalized platform event. See UNIFIED_EVENTS.md for the full `OtteryEvent`
schema. No changes.

### `ottery:status`

Sent when the restream or capture state of one platform changes.

```typescript
interface OtteryStatusMessage {
  serviceId:     number;
  platform:      string;
  displayName:   string;
  type:          'restream' | 'capture';
  state:         'live' | 'stopped' | 'connecting' | 'error';
  errorMessage?: string;
}
```

Server emits:

```js
eventBus.on('restream.started',   (d) => io.emit('ottery:status', { ...d, type: 'restream', state: 'live' }));
eventBus.on('restream.stopped',   (d) => io.emit('ottery:status', { ...d, type: 'restream', state: 'stopped' }));
eventBus.on('restream.error',     (d) => io.emit('ottery:status', { ...d, type: 'restream', state: 'error', errorMessage: d.reason }));
eventBus.on('restream.connecting',(d) => io.emit('ottery:status', { ...d, type: 'restream', state: 'connecting' }));
eventBus.on('capture.started',    (d) => io.emit('ottery:status', { ...d, type: 'capture',  state: 'live' }));
eventBus.on('capture.stopped',    (d) => io.emit('ottery:status', { ...d, type: 'capture',  state: 'stopped' }));
eventBus.on('capture.error',      (d) => io.emit('ottery:status', { ...d, type: 'capture',  state: 'error', errorMessage: d.reason }));
eventBus.on('capture.connecting', (d) => io.emit('ottery:status', { ...d, type: 'capture',  state: 'connecting' }));
```

### `ottery:session`

Sent when a session starts, ends, or stats are flushed (every 30s during a
live session).

```typescript
interface OtterySessionMessage {
  state:      'live' | 'ended';
  sessionId:  number;
  startedAt:  string;    // ISO 8601
  endedAt?:   string;    // only when state = 'ended'
  stats:      SessionStats;
}
```

The Angular duration timer is client-side from `startedAt`. Stats are absolute
totals, not deltas.

```js
// 30-second stat flush
setInterval(() => {
  if (!sessionManager.isActive()) return;
  const s = sessionManager.getActiveSession();
  io.emit('ottery:session', { state: 'live', sessionId: s.id,
    startedAt: s.started_at, stats: statsAggregator.current() });
}, 30_000);
```

### `ottery:health`

Sent whenever stream health data changes. Emitted on every FFmpeg stderr parse
cycle (~every 2 seconds) and whenever OBS WebSocket pushes a stats update.

```typescript
interface OtteryHealthMessage {
  // Overall (from OBS WebSocket if connected)
  obs: StreamHealth | null;

  // Per-platform (from FFmpeg stderr parse)
  platforms: Partial<Record<Platform, FfmpegHealth>>;
}
```

Server parses FFmpeg stderr in `restream-manager.js`:

```js
proc.stderr.on('data', (chunk) => {
  const line = chunk.toString();
  // FFmpeg progress line: "frame= 1800 fps= 30 q=28.0 size=  45600kB time=00:01:00 bitrate=6240.0kbits/s speed=   1x"
  const m = line.match(/frame=\s*(\d+).*fps=\s*([\d.]+).*bitrate=\s*([\d.]+)kbits/);
  if (m) {
    const health = { totalFrames: +m[1], fps: +m[2], kbitsPerSec: +m[3], ... };
    eventBus.emit('ffmpeg.health', { serviceId: svc.id, platform: svc.platform, health });
  }
});

eventBus.on('ffmpeg.health', (d) => {
  streamHealthMonitor.update(d.platform, d.health);
  // Throttle Socket.io emissions to once per 2 seconds
  healthDebouncer.schedule(() => io.emit('ottery:health', streamHealthMonitor.getAll()));
});
```

### `ottery:obs`

OBS RTMP publish state changes.

```typescript
interface OtteryObsMessage {
  state: 'connected' | 'disconnected';
}
```

### `ottery:auth`

Authentication state changes for a platform.

```typescript
interface OtteryAuthMessage {
  serviceId:   number;
  platform:    string;
  displayName: string;
  action:      'required' | 'cleared';
}
```

`auth.cleared` is emitted by `TokenManager` after successful OAuth reconnect or
token refresh. It clears `needs_reauth` in the DB before emitting.

---

## TypeScript Interfaces (Frontend)

```typescript
// frontend/src/app/ottery-live/models/dashboard.models.ts

export type Platform = 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'x' | 'joystick';
export type RestreamState = 'live' | 'stopped' | 'connecting' | 'error';
export type CaptureState  = 'live' | 'stopped' | 'connecting' | 'error' | 'n/a';
export type ObsState      = 'connected' | 'waiting' | 'offline';
// 'connected' = OBS actively publishing RTMP
// 'waiting'   = socket.io connected, no active publish
// 'offline'   = socket.io disconnected

export interface PlatformStatus {
  serviceId:        number;
  platform:         Platform;
  displayName:      string;
  restreamEnabled:  boolean;
  captureEnabled:   boolean;
  captureSupported: boolean;
  restreamState:    RestreamState;
  captureState:     CaptureState;
  errorMessage?:    string;
  needsReauth:      boolean;
  ffmpegHealth:     FfmpegHealth | null;
}

export interface FfmpegHealth {
  kbitsPerSec:   number;
  fps:           number;
  droppedFrames: number;
  totalFrames:   number;
  reconnects:    number;
  uptime:        number;
}

export interface StreamHealth {
  kbitsPerSec:             number;
  fps:                     number;
  droppedFrames:           number;
  totalFrames:             number;
  obsWebsocketConnected:   boolean;
}

export interface SessionStats {
  follows:        number;
  subs:           number;
  giftSubs:       number;
  cheers:         number;
  tips:           number;
  tipsCurrency:   string;
  peakViewers:    number;
  currentViewers: Partial<Record<Platform, number | null>>;
}

export interface StreamSession {
  sessionId:  number;
  state:      'live' | 'ended';
  startedAt:  string;
  endedAt?:   string;
  stats:      SessionStats;
}

export interface ViewerHistoryPoint {
  elapsedMs: number;
  platform:  Platform;
  count:     number;
}

export interface ReauthBanner {
  serviceId:   number;
  platform:    Platform;
  displayName: string;
  dismissed:   boolean;   // local-only; resets if auth.required fires again
}

export interface AlertSettings {
  newSub:      { visual: boolean; sound: boolean };
  giftSub:     { visual: boolean; sound: boolean; threshold: number };
  raid:        { visual: boolean; sound: boolean; threshold: number };
  tip:         { visual: boolean; sound: boolean; threshold: number };  // USD
  cheer:       { visual: boolean; sound: boolean; threshold: number };  // bits
  soundVolume: number;   // 0–100
  soundFile:   string;   // 'default' or absolute path to .wav/.mp3
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  newSub:      { visual: true,  sound: true  },
  giftSub:     { visual: true,  sound: true,  threshold: 1   },
  raid:        { visual: true,  sound: true,  threshold: 1   },
  tip:         { visual: true,  sound: true,  threshold: 1   },
  cheer:       { visual: true,  sound: false, threshold: 100 },
  soundVolume: 80,
  soundFile:   'default',
};

// Event type groups for the feed type filter
export type EventTypeGroup = 'all' | 'chat' | 'follows' | 'subs' | 'donations' | 'raids' | 'system';

export const EVENT_TYPE_GROUPS: Record<EventTypeGroup, string[]> = {
  all:       [],  // empty = no filter
  chat:      ['chat.message'],
  follows:   ['follow'],
  subs:      ['subscribe', 'subscribe.gift'],
  donations: ['cheer', 'tip', 'like', 'share'],
  raids:     ['raid'],
  system:    ['stream.start', 'stream.end', 'viewer_count',
               'system.capture_connected', 'system.capture_disconnected', 'system.capture_error'],
};
```

---

## Dashboard Component: State Bootstrap

```typescript
// frontend/src/app/ottery-live/dashboard/dashboard.component.ts

export class DashboardComponent implements OnInit, OnDestroy {
  private socket!: Socket;

  // ── Signals ──────────────────────────────────────────────────────
  platforms       = signal<PlatformStatus[]>([]);
  session         = signal<StreamSession | null>(null);
  obsState        = signal<ObsState>('offline');
  streamHealth    = signal<StreamHealth | null>(null);
  reauthBanners   = signal<ReauthBanner[]>([]);
  events          = signal<OtteryEvent[]>([]);
  platformFilter  = signal<Platform[]>([]);
  typeFilter      = signal<EventTypeGroup>('all');
  alertSettings   = signal<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  viewerHistory   = signal<ViewerHistoryPoint[]>([]);
  sessionDurationMs = signal<number>(0);

  // ── Computed ──────────────────────────────────────────────────────
  filteredEvents = computed(() => {
    const pf = this.platformFilter();
    const tf = this.typeFilter();
    return this.events().filter(e => {
      const platformOk = pf.length === 0 || pf.includes(e.platform as Platform);
      const typeOk = tf === 'all' || EVENT_TYPE_GROUPS[tf].includes(e.type);
      return platformOk && typeOk;
    });
  });

  totalViewers = computed(() => {
    const cv = this.session()?.stats.currentViewers ?? {};
    return Object.values(cv).filter((v): v is number => v !== null).reduce((a, b) => a + b, 0);
  });

  // Sum bitrate across all live FFmpeg processes
  totalBitrate = computed(() =>
    this.platforms()
      .filter(p => p.restreamState === 'live' && p.ffmpegHealth)
      .reduce((sum, p) => sum + (p.ffmpegHealth?.kbitsPerSec ?? 0), 0)
  );

  visibleReauthBanners = computed(() =>
    this.reauthBanners().filter(b => !b.dismissed)
  );

  private durationTimer?: ReturnType<typeof setInterval>;
  private lastViewerCount: Partial<Record<Platform, { count: number; ts: number }>> = {};

  ngOnInit(): void {
    const port = (window as any).otteryElectron?.serverPort ?? 3737;
    this.socket = io(`http://localhost:${port}`);

    this.socket.on('connect',    () => this.obsState.set('waiting'));
    this.socket.on('disconnect', () => this.obsState.set('offline'));

    this.socket.on('ottery:snapshot', (snap: OtterySnapshot) => {
      this.platforms.set(snap.platforms);
      this.session.set(snap.session);
      this.streamHealth.set(snap.streamHealth);
      this.obsState.set(snap.obs.state === 'publishing' ? 'connected' : 'waiting');
      this.reauthBanners.set(snap.authRequired.map(a => ({ ...a, dismissed: false })));
      this.events.set([...snap.recentEvents].reverse());  // oldest first for feed display
      if (snap.session?.state === 'live') {
        this.startDurationTimer(snap.session.startedAt);
        this.viewerHistory.set(snap.session.viewerHistory ?? []);
      }
    });

    this.socket.on('ottery:event', (e: OtteryEvent) => {
      this.events.update(ev => [e, ...ev].slice(0, 500));
      this.handleViewerCount(e);
      this.checkAlerts(e);
    });

    this.socket.on('ottery:status', (d: OtteryStatusMessage) => {
      this.platforms.update(platforms => platforms.map(p => {
        if (p.serviceId !== d.serviceId) return p;
        return d.type === 'restream'
          ? { ...p, restreamState: d.state, errorMessage: d.errorMessage }
          : { ...p, captureState:  d.state, errorMessage: d.errorMessage };
      }));
    });

    this.socket.on('ottery:session', (d: OtterySessionMessage) => {
      this.session.set({
        sessionId: d.sessionId, state: d.state,
        startedAt: d.startedAt, endedAt: d.endedAt, stats: d.stats,
      });
      if (d.state === 'live')  this.startDurationTimer(d.startedAt);
      if (d.state === 'ended') this.stopDurationTimer();
    });

    this.socket.on('ottery:health', (d: OtteryHealthMessage) => {
      this.streamHealth.set(d.obs);
      this.platforms.update(ps => ps.map(p =>
        d.platforms[p.platform] ? { ...p, ffmpegHealth: d.platforms[p.platform]! } : p
      ));
    });

    this.socket.on('ottery:obs', (d: OtteryObsMessage) => {
      this.obsState.set(d.state === 'connected' ? 'connected' : 'waiting');
    });

    this.socket.on('ottery:auth', (d: OtteryAuthMessage) => {
      if (d.action === 'required') {
        this.reauthBanners.update(banners => {
          const exists = banners.find(b => b.serviceId === d.serviceId);
          if (exists) return banners.map(b =>
            b.serviceId === d.serviceId ? { ...b, dismissed: false } : b
          );
          return [...banners, { serviceId: d.serviceId,
            platform: d.platform as Platform, displayName: d.displayName, dismissed: false }];
        });
      } else {
        this.reauthBanners.update(b => b.filter(x => x.serviceId !== d.serviceId));
        this.platforms.update(p => p.map(x =>
          x.serviceId === d.serviceId ? { ...x, needsReauth: false } : x
        ));
      }
    });
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
    this.stopDurationTimer();
  }

  dismissReauth(serviceId: number): void {
    this.reauthBanners.update(b => b.map(x =>
      x.serviceId === serviceId ? { ...x, dismissed: true } : x
    ));
  }

  private startDurationTimer(startedAt: string): void {
    this.stopDurationTimer();
    const start = new Date(startedAt).getTime();
    this.sessionDurationMs.set(Date.now() - start);
    this.durationTimer = setInterval(() =>
      this.sessionDurationMs.set(Date.now() - start), 1000);
  }

  private stopDurationTimer(): void {
    if (this.durationTimer) clearInterval(this.durationTimer);
  }

  private handleViewerCount(e: OtteryEvent): void {
    if (e.type !== 'viewer_count' || e.data.count == null) return;
    const platform = e.platform as Platform;
    const count = e.data.count as number;
    // Debounce: skip if value unchanged or updated within last 5s
    const last = this.lastViewerCount[platform];
    if (last?.count === count || (Date.now() - (last?.ts ?? 0)) < 5000) return;
    this.lastViewerCount[platform] = { count, ts: Date.now() };

    this.session.update(s => {
      if (!s) return s;
      const newViewers = { ...s.stats.currentViewers, [platform]: count };
      const total = Object.values(newViewers)
        .filter((v): v is number => v !== null).reduce((a, b) => a + b, 0);
      return { ...s, stats: {
        ...s.stats,
        currentViewers: newViewers,
        peakViewers: Math.max(s.stats.peakViewers, total),
      }};
    });

    // Add point to viewer history for the chart
    const startedAt = this.session()?.startedAt;
    if (startedAt) {
      const elapsedMs = Date.now() - new Date(startedAt).getTime();
      this.viewerHistory.update(h => [...h, { elapsedMs, platform, count }]);
    }
  }

  private checkAlerts(e: OtteryEvent): void {
    const s = this.alertSettings();
    const play = () => this.playAlertSound();
    if (e.type === 'subscribe'       && s.newSub.sound) play();
    if (e.type === 'subscribe.gift'  && s.giftSub.sound
        && (e.data.count as number) >= s.giftSub.threshold) play();
    if (e.type === 'raid'            && s.raid.sound
        && (e.data.viewerCount as number) >= s.raid.threshold) play();
    if (e.type === 'tip'             && s.tip.sound
        && (e.data.amount as number) >= s.tip.threshold) play();
    if (e.type === 'cheer'           && s.cheer.sound
        && (e.data.bits as number) >= s.cheer.threshold) play();
  }

  private playAlertSound(): void {
    const src = this.alertSettings().soundFile === 'default'
      ? 'assets/sounds/alert.wav'
      : this.alertSettings().soundFile;
    const audio = new Audio(src);
    audio.volume = this.alertSettings().soundVolume / 100;
    audio.play().catch(() => {});  // ignore autoplay policy errors
  }
}
```

---

## OBS Status Banner

Always visible below the header. Three states:

| `obsState` | Dot  | Text |
|------------|------|------|
| `connected` | Green ● | `OBS Connected · Session 1h 23m 44s` |
| `waiting`   | Amber ◌ | `Waiting for OBS` + setup hint |
| `offline`   | Grey  ○ | `Server offline — Ottery Live is not responding` |

When `waiting`: show one-line helper text using values from settings:
> Configure OBS — Server: `rtmp://localhost:1935/live` · Key: `ottery`
> [Settings ↗]

Duration format: `1h 23m 44s`, `44m 12s`, `12s`.

---

## Reauth Banners

Stacked between the OBS banner and the main layout. One per platform requiring
reauth, with `dismissed === false`.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚠  Twitch: Re-authentication required.  [Reconnect]           [✕]   │
└──────────────────────────────────────────────────────────────────────┘
```

- **[Reconnect]**: navigates to `/ottery-live/platforms/:id` for OAuth reconnect
- **[✕]**: sets `dismissed: true` locally — banner hides but reappears if
  `ottery:auth { action: 'required' }` fires again
- Amber/warning style, visually distinct from OBS banner

---

## Stream Health Bar

A compact status bar spanning the full width just above the main two-column
split. Shows when OBS is connected (hidden in idle state).

```
STREAM HEALTH     3,850 kbps  ▓▓▓▓▓▓▓░░  30fps  0 dropped  ↺0 reconnects
Twitch ●  YouTube ●  Kick ●  TikTok ─  X ●  Joystick ●
```

### Data Sources

**OBS WebSocket** (preferred, requires `obs-websocket` plugin v5):

The app optionally connects to the OBS WebSocket server to get source-of-truth
stream metrics. Configure in App Settings: host (default `localhost`), port
(default `4455`), password.

```js
// server/obs/obs-websocket.js
const OBSWebSocket = require('obs-websocket-js').default;
const obs = new OBSWebSocket();

async function connect(host, port, password) {
  await obs.connect(`ws://${host}:${port}`, password);
  // Poll GetStats every 2s
  setInterval(async () => {
    const stats = await obs.call('GetStats');
    // stats: { activeFps, renderTotalFrames, renderSkippedFrames,
    //          outputTotalFrames, outputSkippedFrames, webSocketSessionIncomingMessages,
    //          webSocketSessionOutgoingMessages }
    const stream = await obs.call('GetStreamStatus');
    // stream: { outputActive, outputReconnecting, outputTimecode,
    //           outputDuration, outputCongestion, outputBytes,
    //           outputSkippedFrames, outputTotalFrames }
    // Note: kbitsPerSec not directly in GetStreamStatus — calculate from outputBytes delta
    eventBus.emit('obs.health', { kbitsPerSec: calcBitrate(), fps: stats.activeFps, ... });
  }, 2000);
}
```

If OBS WebSocket is not configured or not connected, fall back to FFmpeg stderr
parsing for per-platform bitrate.

**FFmpeg stderr parsing** (always available when platforms are live):

```js
// In restream-manager.js, for each FFmpeg process:
const FFMPEG_PROGRESS_RE = /frame=\s*(\d+)\s+fps=\s*([\d.]+)\s+.*bitrate=\s*([\d.]+)kbits\/s/;

proc.stderr.on('data', (chunk) => {
  const line = chunk.toString();
  const m = line.match(FFMPEG_PROGRESS_RE);
  if (m) {
    const health = {
      totalFrames: parseInt(m[1]),
      fps: parseFloat(m[2]),
      kbitsPerSec: parseFloat(m[3]),
      droppedFrames: /* track from frame count delta */ 0,
      reconnects: this.processes.get(svc.id)?.restarts ?? 0,
      uptime: Math.floor((Date.now() - processStartTime) / 1000),
    };
    eventBus.emit('ffmpeg.health', { serviceId: svc.id, platform: svc.platform, health });
  }
});
```

### Stream Health Bar Components

**Overall bitrate meter**: shows the sum of all live platform bitrates as a
bar. Fill color: green (< 80% of target bitrate from settings), amber (80–95%),
red (> 95% or < 50% of target — indicates congestion or encoding failure).

**Dropped frames**: cumulative count from the OBS WebSocket `outputSkippedFrames`
field. Alert styling when > 0.5% of total frames.

**Per-platform indicators**: colored dot (green/amber/red/grey) per configured
platform. Color reflects `restreamState` + whether FFmpeg is reporting healthy
stats.

```
Twitch ●   = live, bitrate healthy
YouTube ◐  = connecting
Kick ●     = live
TikTok ─   = capture-only (no restream)
X ●        = live
Joystick ─ = stopped
```

**Reconnect counter** (`↺N`): sum of all FFmpeg `restarts` across live platforms.
Shows `↺0` normally; amber when > 0 to indicate instability.

---

## Stream Status Panel (Left Column)

### Platform Card

Each configured `StreamService` gets one card.

```
┌────────────────────────────────────────────────┐
│  ●  Twitch                                      │
│     Restream  ●  live     [■ Stop]              │
│     Capture   ●  live     (auto)  [■ Stop]      │
│                                                 │
│     3,850 kbps · 30fps · 0 dropped             │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│  ◐  Kick                                        │
│     Restream  ◐  connecting  [■ Stop]           │
│     Capture   ●  live        (auto)  [■ Stop]   │
│                                                 │
│     Connecting... (attempt 1/3)                 │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│  ●  Kick  (error)                               │
│     Restream  ●  error    [↺ Retry]             │
│       Authentication failed — stream key expired│
│     Capture   ●  live     (auto)  [■ Stop]      │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│  ○  TikTok             (capture only)           │
│     Capture   ●  live     [■ Stop]              │
│                                                 │
│     No bitrate (capture only)                   │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│  ○  X                                           │
│     Restream  ○  stopped  [▶ Start]             │
│     Capture   ─  N/A                            │
└────────────────────────────────────────────────┘
```

#### Status Dot Color Mapping

| State        | Dot | Color     |
|--------------|-----|-----------|
| `live`       | ●   | Green     |
| `connecting` | ◐   | Amber     |
| `error`      | ●   | Red       |
| `stopped`    | ○   | Grey      |
| `n/a`        | ─   | Grey dim  |

The card header dot reflects the worst state: red > amber > grey > green.
A reauth warning icon (⚠) is shown in the header when `needsReauth === true`.

#### Restream Toggle

| Current state | Button    | API call                                             |
|---------------|-----------|------------------------------------------------------|
| `stopped`     | `▶ Start` | `POST /api/stream/toggle { serviceId, enabled: true }` |
| `live`        | `■ Stop`  | `POST /api/stream/toggle { serviceId, enabled: false }` |
| `connecting`  | `■ Stop`  | Same as live — allow cancel                          |
| `error`       | `↺ Retry` | `POST /api/stream/toggle { serviceId, enabled: true }` |
| disabled      | _(none)_  | `restreamEnabled === false`                          |

Optimistic update: set `restreamState` to `connecting` immediately on start.

#### Capture Toggle

Same pattern, calling:
- `POST /api/event-capture/start { serviceId }`
- `POST /api/event-capture/stop  { serviceId }`

When capture is live and was auto-started: show `(auto)` label alongside a
`[■ Stop]` button. Always show the button — don't hide it.

When `captureSupported === false` (X): show `─  N/A` with no button.

#### Capture-Only Mode (TikTok)

When `restreamEnabled === false`:
- No restream row (or dimmed "Restream: disabled")
- `(capture only)` pill in the card header
- Only the capture toggle shown

#### FFmpeg Stats Row

When `restreamState === 'live'` and `ffmpegHealth !== null`:
Show a stats line below the controls:
```
3,850 kbps · 30fps · 0 dropped
```
Color the kbps value green/amber/red based on health thresholds.
When `restreamState !== 'live'`: omit the stats row.

#### Error Message Mapping

| Server `reason` code     | Displayed message                              |
|--------------------------|------------------------------------------------|
| `max_restarts`           | Connection failed after 3 attempts             |
| `auth_failed`            | Authentication failed — check credentials      |
| `stream_key_expired`     | Stream key expired — update in Platform Settings |
| `not_supported`          | Event capture not supported                    |
| `too_many_connections`   | Too many connections — backing off             |
| _(other)_                | Show `errorMessage` from server directly       |

---

## Session Stats Panel

Shown below the platform cards in the left column.

### Idle State
```
SESSION STATS
─────────────
No active session.
Start OBS to begin.
```

### Live State
```
SESSION STATS
────────────────────────────
Duration    1h 23m 44s
Viewers     142 peak
            34  Twitch
            89  Kick
            19  TikTok
Follows     34
Subs        12
Gift Subs    3
Cheers    1,250 bits
Tips        $22.50 USD
```

- **Duration**: client-side from `startedAt`, updated every second
- **Viewers (peak)**: `session.stats.peakViewers` — highest total viewer count seen
- **Viewers (per-platform)**: `currentViewers[platform]` — latest count per platform;
  only show platforms that have reported a count this session
- **Subs**: includes Twitch subs, Kick subs, YouTube memberships
- **Gift Subs**: total individuals receiving gifts (`data.count` from `subscribe.gift`)
- **Cheers**: total bits from Twitch `cheer` events
- **Tips**: sum of `data.amount` from all `tip` events (YouTube Super Chats, Kick
  tips, TikTok gifts normalized to USD); shown as `$X.XX USD`

### Post-Session Summary State

When `session.state === 'ended'`:

```
SESSION SUMMARY
────────────────────────────
Ended at    14:32:01
Duration    1h 23m 44s
Viewers     142 peak
Follows     34
Subs        12
Gift Subs    3
Cheers    1,250 bits
Tips        $22.50 USD

[View Full Event Log]
```

`[View Full Event Log]` navigates to `/ottery-live/events?sessionId=N`.
The duration timer stops; `sessionDurationMs` retains the final value.

---

## Viewer Count Chart

Shown below Session Stats in the left column, only when `session !== null`.

### Design

A line chart with:
- **X-axis**: elapsed session time (0 to current duration), formatted as `HH:MM`
- **Y-axis**: viewer count (0 to peak + 10% padding)
- **One line per platform** that has reported viewer counts, colored with the
  platform accent color
- Points plotted from the `viewerHistory` signal

### Library

Use **Chart.js** via `ng2-charts` (PrimeNG's `p-chart` also works). Chart.js is
already a common dependency; no additional heavy library needed.

```typescript
// frontend/src/app/ottery-live/dashboard/viewer-chart/viewer-chart.component.ts

@Component({
  selector: 'app-viewer-chart',
  template: `<canvas baseChart [data]="chartData()" [options]="chartOptions" type="line"></canvas>`
})
export class ViewerChartComponent {
  session       = input.required<StreamSession | null>();
  viewerHistory = input.required<ViewerHistoryPoint[]>();

  chartData = computed(() => {
    const history = this.viewerHistory();
    const platforms = [...new Set(history.map(h => h.platform))];
    return {
      datasets: platforms.map(p => ({
        label: PLATFORM_LABELS[p],
        data: history
          .filter(h => h.platform === p)
          .map(h => ({ x: h.elapsedMs / 60000, y: h.count })),  // x in minutes
        borderColor: PLATFORM_COLORS[p],
        backgroundColor: PLATFORM_COLORS[p] + '22',
        tension: 0.3,
        pointRadius: 2,
      })),
    };
  });

  chartOptions: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,  // disable for real-time performance
    scales: {
      x: { type: 'linear', title: { display: false }, ticks: { callback: v => `${Math.floor(+v)}m` } },
      y: { min: 0, title: { display: false }, ticks: { stepSize: 10 } },
    },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
  };
}
```

### Data Flow

`viewerHistory` is populated from two sources:
1. **Snapshot** (`ottery:snapshot`): `session.viewerHistory` — server returns all
   viewer count events recorded in SQLite for the current session on connect.
   Allows chart to be pre-populated when the user reloads the dashboard mid-session.
2. **Live updates**: each `viewer_count` event appended to `viewerHistory` signal
   in `handleViewerCount()` (after debounce).

### Server-Side: Snapshot Viewer History

The server queries SQLite for current-session `viewer_count` events when building
the snapshot:

```js
// In buildSnapshot():
const viewerHistory = await db('stream_events')
  .where({ session_id: activeSession.id, event_type: 'viewer_count' })
  .orderBy('occurred_at', 'asc')
  .select('platform', 'data_json', 'occurred_at');

return viewerHistory.map(row => ({
  elapsedMs: new Date(row.occurred_at) - new Date(activeSession.started_at),
  platform:  row.platform,
  count:     JSON.parse(row.data_json).count,
}));
```

This ensures the chart is fully populated even if the user opens the dashboard
hours into a session.

---

## Live Event Feed (Right Column)

### Filter Bar

**Row 1: Platform chips** (toggle, multiple select, empty = all)
```
[All] [Twitch] [YouTube] [Kick] [TikTok] [X] [Joystick]
```
Each chip uses the platform's accent color as background (with white/dark text).

**Row 2: Event type group** (single select, radio behavior)
```
[All types] [Chat] [Follows] [Subs] [Donations] [Raids] [System]
```

### Virtual Scroll

Use `@angular/cdk/scrolling` `CdkVirtualScrollViewport`.

- `itemSize`: `44` (px) — use uniform height; vary visually via CSS, not item height
- `minBufferPx`: `200`, `maxBufferPx`: `400`
- `trackBy`: `(i, e) => e.id`
- Max in-memory: 500 events (signal slice: `[e, ...ev].slice(0, 500)`)
- Older events accessible via `/ottery-live/events`

### Per-Event-Type Summary Strings

```
chat.message     {actor.displayName}: {data.message}
                 Badges: [S] subscriber, [M] moderator — shown before username

follow           {actor.displayName} started following

subscribe        {actor.displayName} subscribed · {durationMonths}mo
                 + message if present: · "{message}"
                 YouTube: {displayName} became a member

subscribe.gift   {actor.displayName} gifted {count} sub(s)
                 + total: · {totalGifted} total gifted

cheer            {actor.displayName} cheered {bits} bits
                 + message if present: · "{message}"

tip              {actor.displayName} tipped {currency}{amount}
                 YouTube Super Chat: {displayName} Super Chat {currency}{amount}
                 + message if present: · "{message}"

like             × {count} likes  (TikTok — bulk, no actor)

share            {actor.displayName} shared the stream

raid             {actor.displayName} raided with {viewerCount} viewers

stream.start     {platform} stream went live · "{title}"

stream.end       {platform} stream ended

viewer_count     {count} viewers  (muted system row, small text)

system.capture_connected     Capture connected
system.capture_disconnected  Capture disconnected
system.capture_error         Capture error: {reason}
```

### Row Highlighting (Visual Pop)

High-value events get a left-border accent + brief scale animation on entry:

| Event type         | Condition                            | Highlight                          |
|--------------------|--------------------------------------|------------------------------------|
| `subscribe`        | Always                               | Subtle glow in platform color      |
| `subscribe.gift`   | `count >= giftSub.threshold`         | Bold, bright border                |
| `raid`             | `viewerCount >= raid.threshold`      | Bold, bright border                |
| `tip`              | `amount >= tip.threshold`            | Bold, bright border + amount large |
| `cheer`            | `bits >= cheer.threshold`            | Subtle glow                        |

Animation: CSS `@keyframes` entry — item slides in from top (all events) and
briefly scales to `1.04` with a glowing border for qualifying events, settling
in ~500ms. Use Angular `@trigger` or a CSS class toggled via a `setTimeout(0)`.

### Platform Color Reference

| Platform    | Hex       | Text on dark BG |
|-------------|-----------|-----------------|
| Twitch      | `#9146FF` | White           |
| YouTube     | `#FF0000` | White           |
| Kick        | `#2DB810` | White (darken `#53FC18` for dark UI) |
| TikTok      | `#EE1D52` | White           |
| X           | `#E7E7E7` | Dark (use near-white on dark UI)  |
| Joystick.tv | `#FF6B35` | White           |

### Timestamp Format

`HH:MM:SS` 24-hour local time, from `event.timestamp` (ISO 8601):
```typescript
new Date(event.timestamp).toLocaleTimeString('en-GB', { hour12: false })
// → "14:32:01"
```

### Subscriber / Moderator Badges

On `chat.message` items:
- `actor.isSubscriber === true`: show `[S]` chip or platform sub icon before username
- `actor.isModerator === true`: show `[M]` chip or mod sword icon

---

## Start All / Stop All

Header buttons, always visible.

**Start All**: `POST /api/stream/start`
- Starts all platforms where `restream_enabled && auto_start`
- Disabled when all auto-start platforms are already `live` or `connecting`
- Optimistic: set affected platforms to `connecting`

**Stop All**: `POST /api/stream/stop`
- Stops all running restream processes
- When `session.state === 'live'`: show a confirmation dialog before calling:

```
┌──────────────────────────────────────────────────┐
│  Stop all streams?                               │
│                                                 │
│  Restreaming will stop for all platforms.       │
│  Event capture will continue running.           │
│                                                 │
│             [Cancel]     [Stop All]             │
└──────────────────────────────────────────────────┘
```

Button shows `■ Stopping...` while the request is in flight.

---

## Session End Behavior

When OBS disconnects (`ottery:obs { state: 'disconnected' }`):

1. Server stops all restream processes → `restream.stopped` per platform → `ottery:status` messages → platform cards update to `stopped`
2. Server finalizes session: writes `ended_at` + final stats to SQLite → emits `session.ended` → `ottery:session { state: 'ended', ... }`
3. Frontend:
   - Stops duration timer (retains final value)
   - `obsState` → `'waiting'`
   - Session stats transitions to "Session Summary" view
   - Event feed remains visible (do not clear)
   - Viewer chart stays visible with final data
4. Event capture continues unless `stopCaptureOnStreamEnd` setting is true

---

## Historical Event Log (`/ottery-live/events`)

Full-page view. Platform cards and session stats are not shown here.

### Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Event Log                                          [Table] [Feed]         │
│                                                         [Export CSV ↓]    │
├───────────────────────────────────────────────────────────────────────────┤
│  Session: [All sessions ▼]  Platform: [All ▼]  Type: [All ▼]             │
│  Date: [2026-03-01] – [2026-03-14]   Search: [__________________________] │
├───────────────────────────────────────────────────────────────────────────┤
│  Showing 1–50 of 2,341 events               [← Prev]  Page 1/47  [Next →] │
├──────────────┬──────────────┬──────────────┬────────────────────────────  │
│  Time        │ Platform     │ Type         │ Summary                       │
├──────────────┼──────────────┼──────────────┼────────────────────────────  │
│  14:32:01    │ twitch       │ follow       │ NewFan started following       │
│  14:31:58    │ kick         │ subscribe    │ LoyalSub · 3mo                 │
│  14:31:45    │ youtube      │ tip          │ Generous Super Chat $10.00     │
│  ...                                                                       │
└────────────────────────────────────────────────────────────────────────────
```

### Filters

| Filter     | UI Element          | Query Param                          |
|------------|---------------------|--------------------------------------|
| Session    | Dropdown            | `sessionId=N` (omit = all sessions)  |
| Platform   | Multi-select        | `platform=twitch,kick`               |
| Event type | Multi-select        | `type=follow,subscribe`              |
| Date range | Two date pickers    | `from=2026-03-01&to=2026-03-14`      |
| Search     | Text input          | `search=text` (actor.username or message) |

Filters sync to URL query params (`ActivatedRoute.queryParams`). Bookmarkable.

### Table View

Columns: Time | Platform (chip) | Event type | Actor | Summary | Session #

Default sort: `occurred_at DESC`. Sortable by time only (re-fetch on sort change).

### Feed View

Reuses `event-item.component`. Scroll pagination (not virtual scroll — history
is not real-time, items per page are fixed).

### Pagination

50 events per page. `[← Prev] Page N/M [Next →]`.

API call: `GET /api/stream-sessions/events` (see New API Endpoints below).

### Export as CSV

```
GET /api/stream-sessions/events/export?sessionId=N&platform=...&type=...&from=...&to=...&search=...
```

Response: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="events-2026-03-14.csv"`

CSV columns:
```
id,session_id,occurred_at,platform,event_type,actor_username,actor_display_name,data_summary
```

`data_summary`: server-side summary string using same per-event-type logic as
the event feed. Handled in `server/lib/event-summary.js` — shared by the API
export and the snapshot's `recentEvents` formatting.

---

## Component Tree

```
frontend/src/app/ottery-live/
├── ottery-live.routes.ts
├── models/
│   └── dashboard.models.ts               # All TypeScript interfaces + constants
│
├── dashboard/
│   ├── dashboard.component.ts            # Container: owns socket, all signals
│   ├── dashboard.component.html
│   ├── dashboard.component.scss
│   │
│   ├── obs-status-bar/
│   │   └── obs-status-bar.component.ts   # Green/amber/grey banner + OBS setup hint
│   │
│   ├── reauth-banner/
│   │   └── reauth-banner.component.ts    # Per-platform reauth warning row
│   │
│   ├── stream-health-bar/
│   │   └── stream-health-bar.component.ts # Bitrate, fps, dropped frames, per-platform dots
│   │
│   ├── stream-status-panel/
│   │   ├── stream-status-panel.component.ts   # Left column: platform cards list
│   │   └── platform-status-card/
│   │       └── platform-status-card.component.ts  # Per-platform card
│   │           # inputs: PlatformStatus; outputs: toggleRestream, toggleCapture
│   │
│   ├── session-stats/
│   │   └── session-stats.component.ts    # Duration, viewers breakdown, totals
│   │                                     # + post-session summary state
│   │
│   ├── viewer-chart/
│   │   └── viewer-chart.component.ts     # Chart.js line chart (ng2-charts)
│   │
│   └── event-feed/
│       ├── event-feed.component.ts       # CDK virtual scroll + filter bars
│       ├── event-feed-filter.component.ts # Platform chips + type group chips
│       └── event-item/
│           └── event-item.component.ts   # Single event row; inputs: OtteryEvent, AlertSettings
│                                         # Handles highlight CSS class + animation trigger
│
├── event-log/
│   ├── event-log.component.ts            # /ottery-live/events page; reads URL params
│   ├── event-log-filters.component.ts    # Session/platform/type/date/search controls
│   ├── event-log-table.component.ts      # Table view
│   └── event-log-feed.component.ts       # Feed view (reuses event-item.component)
│
└── shared/
    ├── platform-chip.component.ts        # Colored platform badge — reused everywhere
    ├── status-dot.component.ts           # ●/◐/○/─ colored dot
    ├── duration.pipe.ts                  # ms → "1h 23m 44s"
    ├── platform-colors.ts                # PLATFORM_COLORS, PLATFORM_LABELS constants
    └── alert-settings.service.ts         # GET/PUT /api/settings/alerts; signal-based
```

---

## New API Endpoints Needed

```
# Stream health via OBS WebSocket (optional, requires obs-websocket plugin)
GET  /api/settings/obs-websocket           obs-websocket config { host, port, hasPassword }
PUT  /api/settings/obs-websocket           set { host, port, password }
GET  /api/obs/status                       { connected, health: StreamHealth | null }

# Historical event log — all sessions
GET  /api/stream-sessions/events
     ?page=1&limit=50
     &sessionId=N           (optional)
     &platform=twitch,kick  (optional, comma-separated)
     &type=follow,subscribe (optional)
     &from=2026-03-01       (optional)
     &to=2026-03-14         (optional)
     &search=username       (optional)
     Response: { events: OtteryEvent[], total: number, page: number, limit: number }

# CSV export
GET  /api/stream-sessions/events/export    (same params, no pagination)
     Response: text/csv

# Past sessions list (for event log session dropdown)
GET  /api/stream-sessions
     Response: { sessions: [{ id, started_at, ended_at, state, total_events }] }

# Per-session events (scoped by ID, not just 'current')
GET  /api/stream-sessions/:id/events
     ?page=1&limit=50&platform=...&type=...&search=...

# Infinite scroll "load older" for live feed
GET  /api/stream-sessions/current/events
     ?before_id=X&limit=50   (return events older than X)
     Response: { events: OtteryEvent[], hasMore: boolean }

# Alert settings
GET  /api/settings/alerts          Response: AlertSettings
PUT  /api/settings/alerts          Body: Partial<AlertSettings>
```

Existing endpoints (unchanged):
```
GET  /api/stream-services
POST /api/stream/start
POST /api/stream/stop
POST /api/stream/toggle
GET  /api/stream-sessions/current
POST /api/event-capture/start
POST /api/event-capture/stop
```

---

## Server-Side: In-Memory Ring Buffer

The server keeps the last 100 events in a synchronous ring buffer for zero-cost
snapshot building. SQLite is the persistent store; the ring buffer is just for
the `recentEvents` field in the snapshot.

```js
// server/events/event-buffer.js
class EventRingBuffer {
  constructor(maxSize = 100) { this.buffer = []; this.maxSize = maxSize; }
  push(event) {
    this.buffer.unshift(event);   // newest first
    if (this.buffer.length > this.maxSize) this.buffer.pop();
  }
  getLast(n) { return this.buffer.slice(0, n); }
}
```

---

## Implementation Notes

**YouTube color**: `#FF0000` (YouTube brand red). Use `color: white` for text on
this background. In the platform color map, export both `PLATFORM_COLORS` (for
chips) and `PLATFORM_COLORS_DARK` (slightly adjusted for dark backgrounds if
needed).

**TikTok capture-only**: The most common TikTok configuration. The platform card
must gracefully show no restream row when `restreamEnabled === false`. Mark with
`(capture only)` pill.

**Viewer count debouncing**: TikTok fires `viewer_count` on nearly every protobuf
message. Debounce to max one update per 5 seconds per platform (skip if value
unchanged). This prevents excessive signal updates and chart point density.

**OBS WebSocket is optional**: Stream health still works without it, using FFmpeg
stderr. Show `obs-websocket: not connected` in settings with a help link if the
user hasn't configured it. The stream health bar always shows FFmpeg-derived
per-platform health regardless.

**Socket port discovery**: Always read from `window.otteryElectron.serverPort`
(injected by Electron preload). Hardcoding `3737` is acceptable as a fallback
but not the primary mechanism.

**`needs_reauth` on first load**: `TokenManager.start()` emits `auth.required`
for any flagged service on startup. The snapshot captures `needs_reauth` from
the DB, so banners appear immediately on first render without waiting for a
separate Socket.io event.

**Chart performance**: Set `animation: false` in Chart.js options for real-time
updates. Use `chart.update('none')` instead of full re-render when adding new
data points. With high-frequency viewer events debounced to 5s intervals, the
chart update rate is acceptably low.

**Event feed performance**: With TikTok active, chat can flood the feed. The
500-event cap and CDK virtual scroll are essential. Use `trackBy: (_, e) => e.id`
to prevent full list re-renders on each new event.

**Goals / sound overlays (future)**: A future phase will add configurable
follower/sub/tip goals with progress bars, and a browser-source overlay URL
for OBS scene integration. AlertSettings is already in the schema to support this.
The overlay system will be a separate component served at a distinct route
(e.g., `/ottery-live/overlay`) by the Express server.
