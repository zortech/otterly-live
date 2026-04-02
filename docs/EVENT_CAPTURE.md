# Component 0.1: Event Capture

Each platform has a dedicated event capture worker in `server/event-capture/`.
Workers connect to platform APIs/WebSockets, receive raw events, normalize them,
and emit them on the in-process EventEmitter event bus.

See [RESEARCH_FINDINGS.md](RESEARCH_FINDINGS.md) for the raw research behind this doc.

## Worker Interface

All event capture workers implement the same interface:

```js
// server/event-capture/base-capture.js
class BaseCapture extends EventEmitter {
  constructor(streamService) { ... }  // streamService = full record including credentials
  async connect() { ... }
  async disconnect() { ... }
  isConnected() { ... }
  // emits: 'event' (normalizedEvent), 'error', 'connected', 'disconnected'
}
```

Workers are managed by the `EventCaptureManager`:

```js
// server/event-capture/manager.js
class EventCaptureManager {
  start(streamServiceId)    // instantiate + connect worker
  stop(streamServiceId)     // disconnect + remove worker
  stopAll()
  status()                  // { [serviceId]: 'connected'|'disconnected'|'error' }
}
```

## Platform Workers

### Twitch (`twitch.js`)

Uses the **Twitch EventSub WebSocket** transport.

**Setup required on StreamService:**
- `api_access_token`: User Access Token (NOT App Access Token — WebSocket requires user token)
- `api_refresh_token`: stored in keychain; token expires, must be refreshed
- `api_client_id`: your Twitch app's client ID
- `username` + channel ID in `metadata.channel_id`

**OAuth flow for Electron:** Use the **Device Code Grant Flow** — Twitch does not support PKCE.
Do not bundle `client_secret` in the app (public client; DCF doesn't need it).

```js
// Device Code Grant Flow
// 1. POST https://id.twitch.tv/oauth2/device (get device_code + user_code)
// 2. Show user_code to user; open https://www.twitch.tv/activate in system browser
// 3. Poll POST https://id.twitch.tv/oauth2/token until authorized or expired
//    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
```

**Connection flow:**
1. Open `wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30`
2. Receive `session_welcome` — extract `session.id`
3. Within 10 seconds, POST subscriptions to REST API (one per event type):
   `POST https://api.twitch.tv/helix/eventsub/subscriptions`
4. Receive `notification` messages; normalize and emit

**Subscriptions to register:**

| Type | Scope |
|---|---|
| `channel.chat.message` | `user:read:chat` |
| `channel.follow` v2 | `moderator:read:followers` (set `moderator_user_id` = `broadcaster_user_id`) |
| `channel.subscribe` | `channel:read:subscriptions` |
| `channel.subscription.gift` | `channel:read:subscriptions` |
| `channel.cheer` | `bits:read` |
| `channel.raid` | (none) |
| `stream.online` / `stream.offline` | (none) |

> Consider using `channel.chat.notification` instead of separate sub/gift/resub subscriptions
> — it covers all of them in one event stream.

**Token refresh:** Refresh tokens for public clients (DCF) expire after **30 days**.

```js
// POST https://id.twitch.tv/oauth2/token
// grant_type=refresh_token&refresh_token=...&client_id=...
// Response returns NEW access_token AND NEW refresh_token — store both
```

**Mandatory hourly validation:** Call `GET https://id.twitch.tv/oauth2/validate` on startup
and every hour. Twitch audits for this and will contact non-compliant apps.

**WebSocket rules:**
- Do NOT send any messages to the server (causes disconnection)
- On `session_reconnect`: connect to `reconnect_url` before closing old connection
- On reconnect after drop: re-subscribe (no replay)

### Kick (`kick.js`)

Uses the **unofficial Pusher WebSocket layer** (reverse-engineered; no auth required for public channels).

**Recommended library:** [`LOX-X/Kick-Live-Connector`](https://github.com/lox-x/kick-live-connector) — TypeScript, most feature-complete.

**Setup required on StreamService:**
- `username`: Kick channel slug (used to look up chatroom ID)
- `api_access_token`: OAuth token with `channel:read` scope (for chatroom ID lookup)
- `stream_key` + `rtmp_url`: auto-fetched via `streamkey:read` scope after OAuth
- No credentials needed for Pusher WS connection itself — public channels are open

**OAuth:** PKCE flow (no `client_secret`). Register at [dev.kick.com](https://dev.kick.com) —
self-service, instant, requires 2FA. Use `http://localhost:{port}/callback` as redirect URI
(not `127.0.0.1` — NextJS rewrite bug in Kick's auth server).

**Connection flow:**
1. Fetch chatroom ID using the **official API**: `GET https://api.kick.com/public/v1/channels?slug={username}` → `.data[0].chatroom.id`
   - Requires OAuth token with `channel:read` scope (already obtained during setup)
   - Fallback if official API is unavailable: `GET https://kick.com/api/v2/channels/{username}` → `.chatroom.id` (unofficial, no auth needed, but subject to breakage)
2. Connect to Pusher: `wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false`
3. Subscribe to channel: `chatrooms.{chatroomId}.v2`
4. Listen for events; normalize and emit

**Pusher app key:** `32cbd69e4b950bf97679` (store in platform registry, not per-service)

**Available event types (unofficial Pusher layer):**
- `ChatMessage`, `MessageDeleted`
- `Subscription`, `GiftedSubscriptions`, `LuckyUsersWhoGotGiftSubscriptions`
- `StreamerIsLive`, `StreamEnd`, `ViewerCount`
- `UserBanned`, `PollUpdate`

**Stability note:** The Pusher key and channel naming are undocumented and subject to change.
If the connection stops working, inspect the Network tab on a live Kick page, filter by `pusher`,
to find the current WS URL and app key.

### TikTok (`tiktok.js`)

Uses [`tiktok-live-connector`](https://www.npmjs.com/package/tiktok-live-connector) (unofficial WebSocket, protobuf events).

**Fallback option:** [tik.tools](https://tik.tools) (TikTool Live) provides a paid third-party
WebSocket API for TikTok LIVE events with sub-50ms delivery — use if the unofficial connector
becomes unreliable (TikTok regularly changes their internal API).

**What's needed:**
- `username`: the streamer's TikTok `@unique_id` — no credentials of any kind required
- The streamer **must be live** for the connection to succeed

```js
const { WebcastPushConnection } = require('tiktok-live-connector');

const connection = new WebcastPushConnection('@username');

connection.on('chat', (data) => emit('chat.message', normalize(data)));
connection.on('gift', (data) => emit('tip', normalize(data)));
connection.on('like', (data) => emit('like', normalize(data)));
connection.on('follow', (data) => emit('follow', normalize(data)));
connection.on('share', (data) => emit('share', normalize(data)));
connection.on('roomUser', (data) => emit('viewer_count', normalize(data)));
```

**RTMP note:** TikTok stream keys are **session-specific** — generated fresh per stream at
[livecenter.tiktok.com/producer](https://livecenter.tiktok.com/producer).
The `rtmp_url` field should be set to `rtmp://global-push.tiktok.com/live`
but the user must paste a new stream key before each stream.

**Known instability:**
- TikTok actively breaks unofficial clients — library version upgrades may be forced
- IP/country blocking: some IPs cannot fetch room IDs; proxy/VPN may be needed
- WebSocket close `4429` = `TOO_MANY_CONNECTIONS` (back off and retry)
- Protobuf schema drift: TikTok can change binary formats

### YouTube (`youtube.js`)

Uses the **YouTube Data API v3** — official, fully supported.

**Preferred transport: gRPC `liveChatMessages.streamList`** — persistent server-streaming
connection; YouTube pushes messages as they arrive. Dramatically lower quota cost than REST polling.

> **Do not use REST polling** (`liveChatMessages.list`) as the primary mechanism.
> At 5 quota units/call and the API's `pollingIntervalMillis` guidance (~5s), a single
> active stream would exhaust the default 10,000 units/day in under 3 hours.
> Use gRPC streaming; fall back to REST polling only if gRPC fails.

**Setup required on StreamService:**
- `api_access_token`: OAuth token with `youtube.readonly` scope
- `api_refresh_token`: stored in keychain (indefinitely valid until revoked)
- `api_client_id` / `api_client_secret`: from Google Cloud Console
- `username` / `metadata.channel_id`: YouTube channel ID

**OAuth flow for Electron:** Installed app PKCE flow.
Use `http://localhost:{port}` as redirect URI (registered in Google Cloud Console).
Spin up a local HTTP server to catch the redirect, then shut it down.

> ⚠️ **Google OAuth review required for public release.** `youtube.readonly` is a
> sensitive scope. Before real users outside your 100-user test allowance can authorize,
> Google requires a verified consent screen, privacy policy, demo video, and scope
> justification. Plan several weeks for this in your launch timeline. During development,
> add up to 100 test users in Google Cloud Console.

**Connection flow:**
1. Fetch `liveChatId` by calling:
   `GET https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&mine=true`
   → `items[0].snippet.liveChatId`
2. If no active broadcast → poll this endpoint every 30s until one starts, then connect
3. Establish gRPC `streamList` connection using `@grpc/grpc-js` and `stream_list.proto`
4. Receive `LiveChatMessage` objects; normalize and emit
5. On gRPC disconnect: determine whether chat ended or was disabled via a `liveBroadcasts.list`
   call (known gRPC bug — error code is ambiguous); reconnect if broadcast still active

```js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Load proto from google/youtube/v3/live_chat/stream_list.proto
const packageDefinition = protoLoader.loadSync('stream_list.proto', { ... });
const proto = grpc.loadPackageDefinition(packageDefinition);

const client = new proto.google.youtube.v3.V3DataLiveChatMessageService(
  'youtubei.googleapis.com:443',
  grpc.credentials.createSsl()
);

client.StreamList({ liveChatId, ... }, metadata, (err, stream) => {
  stream.on('data', (msg) => emit(normalize(msg)));
  stream.on('end', () => handleStreamEnd());
  stream.on('error', (err) => handleError(err));
});
```

**Available event types** (from `snippet.type`):

| `snippet.type` | Normalized event |
|---|---|
| `textMessageEvent` | `chat.message` |
| `superChatEvent` | `tip` (with `amount`, `currency`) |
| `superStickerEvent` | `tip` (with `sticker_id`) |
| `memberMilestoneChatEvent` | `subscribe` (milestone) |
| `newSponsorEvent` | `subscribe` (new membership) |
| `membershipGiftingEvent` | `gift_sub` (gifter) |
| `giftMembershipReceivedEvent` | `gift_sub` (recipient) |
| `messageDeletedEvent` | (silently discard from feed) |
| `userBannedEvent` | (silently discard) |

**Quota:**
- gRPC `streamList`: ~0–1 units/connection (persistent; not per-message)
- `liveBroadcasts.list`: ~1 unit/call — poll every 30s max while waiting for stream
- `liveChatMessages.list` (fallback): 5 units/call — use `pollingIntervalMillis` hint

**Broadcast lifecycle polling:**
Poll `liveBroadcasts.list?broadcastStatus=active&mine=true` every 30s when not connected
to detect stream start. On `'disconnected'` from gRPC, re-poll to decide reconnect vs. ended.

**Token refresh:** Standard OAuth2 refresh flow.
```
POST https://oauth2.googleapis.com/token
grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...
```
Refresh tokens are valid indefinitely (until user revokes or Google invalidates).
Google returns a new `access_token` (no new `refresh_token` — keep the existing one).

**Per-project quota note:** The 10,000 unit/day quota is per Google Cloud project, not per
end-user. If your app is public, all users share the same quota unless each user registers
their own GCP project. For a desktop app used by individuals, registering their own GCP
project is the recommended path — document this clearly in the setup guide.

### X (`x.js`)

**Event capture: not supported.** No official or unofficial API exists for X live stream events
(chat, viewer count, stream start/end) at any API tier or price point.

**RTMP restream works** but requires a dynamic per-account URL from X Media Studio Producer.
Users must copy their RTMP URL from [studio.twitter.com](https://studio.twitter.com) → Sources → Create Source.
Requires X Premium or Premium+ subscription.

The X capture worker is a stub that immediately emits `'disconnected'` with reason `not_supported`:

```js
// server/event-capture/x.js
class XCapture extends BaseCapture {
  async connect() {
    this.emit('disconnected', { reason: 'not_supported' });
  }
}
```

### Joystick.tv (`joystick.js`)

Joystick.tv event capture is a **bot integration** using their official Action Cable WebSocket.
Joystick.tv publishes [official MIT-licensed bot examples](https://github.com/joysticktv) in
Python, Ruby, JavaScript, and Crystal — this is a supported, documented path, not a hack.

**Integration model:** Connect to `wss://joystick.tv/cable` with an OAuth token, subscribe to
`GatewayChannel`, receive events. Identical to how their own `chatterbot` tool works.

**Setup required on StreamService:**
- `username`: Joystick.tv account/bot username
- `api_access_token`: OAuth access token (stored in keychain)
- `api_refresh_token`: stored in keychain
- `api_client_id` / `api_client_secret`: from Joystick.tv (contact them — no self-service portal)

**OAuth endpoints:**
```
Authorize: https://joystick.tv/api/oauth/authorize?client_id=...
Token:     POST https://joystick.tv/api/oauth/token
Redirect:  http://127.0.0.1:{port}/auth   (loopback — works with Electron)
```

**Connection flow:**
```js
const ws = new WebSocket(`wss://joystick.tv/cable?token=${accessToken}`);

ws.on('open', () => {
  // Action Cable subscribe message
  ws.send(JSON.stringify({
    command: 'subscribe',
    identifier: JSON.stringify({ channel: 'GatewayChannel' }),
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type === 'ping') return;                      // Action Cable keepalive
  if (msg.type === 'confirm_subscription') return;      // subscription acknowledged
  const payload = msg.message;
  if (!payload) return;
  if (payload.type === 'new_message') emit('chat.message', normalize(payload));
  // Discover and document additional event types as they're observed in production
});
```

**Confirmed events:** `new_message` (chat messages)
**To discover:** follows, subscriptions, viewer count, stream start/end — log all payload
types during a live session and update this doc as new types are confirmed.

**RTMP note:** Joystick.tv uses AWS IVS — RTMP URLs are dynamic per-account from the
Joystick.tv dashboard (Stream Settings). No static URL. User must copy it after logging in.

### Rumble (`rumble.js`)

Uses **Rumble's official Live Stream API** — a REST polling endpoint, no OAuth required.
The API URL is a per-account secret endpoint that the user copies from their dashboard.

**Setup required on StreamService:**
- `rtmp_url`: copied from Rumble dashboard → Live → Stream Settings
- `stream_key`: copied from Rumble dashboard → Live → Stream Settings
- `api_access_token` (keychain): the **full Rumble Live API URL** from `rumble.com/account/livestream-api`
  (format: `https://rumble.com/api/v0/live_stream_api/{user_id}/{key}/`)
  The URL contains the user's secret key — treat it as a credential.

**No OAuth flow.** The API URL itself is the authentication mechanism. It is resettable from the dashboard.

**Connection flow:** Polls the API endpoint every 3 seconds.

**Available data** (from polling response):
```js
data.livestreams[0].chat       // array of recent chat messages (up to 50)
data.livestreams[0].rants      // array of recent rants/superchats (up to 50)
data.followers.recent_followers  // array of recent new followers
```

**Events emitted:**

| Event | Source |
|---|---|
| `chat.message` | `livestreams[0].chat` — deduped by message ID |
| `tip` | `livestreams[0].rants` (superchats) — amount in USD (cents/100) |
| `follow` | `followers.recent_followers` — deduped by username |

**Priming:** On first connect, the worker silently reads existing messages to populate
the seen-ID sets — this prevents re-emitting chat history that predates the connect.

**RTMP note:** Rumble provides a static RTMP URL and stream key per account. Both must be
copied manually from the Rumble dashboard. There is no programmatic fetch mechanism.

### Facebook Live (`facebook.js`)

Uses the **Facebook Graph API** for discovering live videos and the
**Server-Sent Events (SSE)** streaming endpoint for real-time comments.

**Dependency:** None beyond Node.js built-in `fetch` (Node 18+).

**Setup required on StreamService:**
- `api_access_token` (keychain): Facebook User Access Token (from Device Code flow)
- `api_client_id` (keychain): Facebook App ID
- `metadata.page_id` (optional): Facebook Page ID, if streaming to a Page rather than personal profile

**OAuth flow for Electron:** Facebook Login for Devices (Device Code Grant).

```js
// Step 1 — request device code
POST https://graph.facebook.com/oauth/device
  access_token={app_id}|{app_secret}
  scope=pages_manage_posts,pages_read_engagement,pages_read_user_content,publish_video

// Response: { code, user_code, verification_uri: "https://www.facebook.com/device", interval }

// Step 2 — show user_code, open facebook.com/device in system browser
// Step 3 — poll for token
POST https://graph.facebook.com/oauth/device
  access_token={app_id}|{app_secret}
  code={code}
```

> Enable "Login from Devices" in App Dashboard → Products → Facebook Login → Settings.
> `publish_video` and Page permissions require **Meta App Review** before public users can grant them.
> During development, use test users added via App Dashboard.

**Connection flow:**
1. Derive Page Access Token: `GET /me/accounts` → find entry matching `metadata.page_id` → use its `access_token`
2. Find active live video: `GET /me/live_videos?status=LIVE` or `GET /{page-id}/live_videos?status=LIVE`
3. If no live video, poll every 30s until one starts
4. Connect to SSE comment stream: `GET https://streaming-graph.facebook.com/{video-id}/live_comments`
5. Poll viewer count every 30s: `GET /{video-id}?fields=live_views,status`
6. On `status=LIVE_STOPPED` or `VOD`: emit `stream.end`, emit `disconnected` → manager reconnects (→ step 2)

**SSE endpoint:**
```
GET https://streaming-graph.facebook.com/{live-video-id}/live_comments
  ?access_token={page_or_user_token}
  &comment_rate=one_per_two_seconds
  &fields=id,message,from{id,name,pic}
```
Returns a persistent HTTP response with SSE-formatted JSON objects. Read via `fetch` with streaming.

**Available event types:**

| Event | Source |
|---|---|
| `chat.message` | SSE comment stream |
| `viewer_count` | `live_views` field polled every 30s |
| `stream.end` | `status` field polled every 30s (LIVE_STOPPED, VOD, PROCESSING) |

**Facebook API version:** v19.0 (hardcoded in worker; update as new versions release).

**RTMP note:** RTMPS only (`rtmps://live-api-s.facebook.com:443/rtmp/{stream_key}`).
The stream key is returned by `POST /me/live_videos` (Graph API) as `secure_stream_url`,
or can be copied from Facebook Live Producer. It changes with each new live video creation.

### Bilibili Live (`bilibili.js`)

Uses **Bilibili's public Danmaku WebSocket** for real-time live room events.
No credentials required for event capture on public rooms (though username display
is partially masked by Bilibili's 2023 privacy policy for unauthenticated connections).

**Dependency:** `bilibili-live-ws` npm package (`npm install bilibili-live-ws`).

**Setup required on StreamService:**
- `metadata.room_id`: Bilibili live room number (from `bilibili.com/live/{room_id}`)
- `metadata.uid` (optional): Bilibili UID — set to `0` for anonymous; reduces username masking if authenticated

**No OAuth flow.** Bilibili uses cookie-based session authentication. Event capture for
public rooms works without any credentials. For RTMP streaming (start/stop), you would
need `SESSDATA` and `bili_jct` cookie values — but that is handled separately outside
this worker.

**Connection flow:**
1. `GET https://api.live.bilibili.com/room/v1/Danmu/getConf?room_id={id}` → optimal host + auth token
2. Connect to Danmaku WebSocket: `wss://{host}/sub` (falls back to `wss://broadcastlv.chat.bilibili.com/sub`)
3. Send auth packet (OP 7) with room ID and token within 5 seconds of connect
4. Send heartbeat (OP 2) every 30 seconds — server replies with OP 3 (viewer count)
5. Receive OP 5 messages (CMD events); decompress if protocol_version=2 (zlib) or 3 (brotli)

**The `bilibili-live-ws` library handles all of the above automatically.**

**Available CMD types and normalized events:**

| Bilibili CMD | Event Type | Notes |
|---|---|---|
| `DANMU_MSG` | `chat.message` | info[1]=text, info[2]=[uid, uname, is_admin, ...] |
| `SUPER_CHAT_MESSAGE` | `tip` | `price` field in CNY |
| `SEND_GIFT` (gold coin_type only) | `tip` | `total_coin / 1000` ≈ CNY; silver gifts ignored |
| `COMBO_SEND` (gold only) | `tip` | Same as SEND_GIFT |
| `GUARD_BUY` | `subscribe` | tier: captain/admiral/governor; `num` = months |
| `INTERACT_WORD` (msg_type=2 or 4) | `follow` | msg_type 2=follow, 4=special follow |
| `LIVE` | `stream.start` | emitted by `bilibili-live-ws` as `'live'` event |
| `PREPARING` | `stream.end` | Stream ending |
| OP 3 heartbeat reply | `viewer_count` | Current viewer count as uint32 |

> Silver coin gifts (free/virtual currency) are discarded — only gold coin gifts
> (paid with real money) are emitted as `tip` events.
> Guard tiers: 3=舰长 (Captain), 2=提督 (Admiral), 1=总督 (Governor).

**RTMP note for Bilibili streaming:**
Stream address and key are session-specific. To start a live stream programmatically:
```
POST https://api.live.bilibili.com/room/v1/Room/startLive
  room_id={id}&platform=pc_link&area_v2={category}&csrf={bili_jct}&csrf_token={bili_jct}

Response:
{
  "rtmp": {
    "addr": "rtmp://live-push.bilivideo.com/live-bvc/",
    "code": "?streamname=live_{UID}_{n}&key={hex}&schedule=rtmp&pflag=1"
  }
}
// Full push URL = addr + code
```
Requires a logged-in Bilibili session (`SESSDATA`, `bili_jct` cookies).
Users can also copy the address and key directly from the Bilibili Live dashboard.

## Starting Event Capture Without Restreaming

The `EventCaptureManager` is independent of the restream engine.

```
POST /api/event-capture/start  { serviceId: 4 }
POST /api/event-capture/stop   { serviceId: 4 }
GET  /api/event-capture/status
```

This is the primary use case for TikTok — monitoring chat/gifts without restreaming.

## Error Handling and Retry

- Workers must catch all errors and emit `'error'` (never throw uncaught)
- Manager retries with exponential backoff: 1s, 2s, 4s, 8s (max 60s)
- After 5 consecutive failures: mark as `error` state, stop retrying, notify dashboard
- On `'disconnected'` (clean close from platform): attempt reconnect after 5s
