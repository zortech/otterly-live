# Research Findings (March 2026)

Findings from research conducted to resolve unknowns in the initial planning docs.
Each section is a direct reference — the component docs have been updated accordingly.

---

## Twitch

**EventSub WebSocket endpoint:** `wss://eventsub.wss.twitch.tv/ws` — unchanged.

**Subscription types and required scopes (all confirmed valid):**

| Subscription Type | Scope Required | Notes |
|---|---|---|
| `channel.chat.message` | `user:read:chat` | Replaces IRC/TMI.js; WebSocket transport only |
| `channel.follow` **v2** | `moderator:read:followers` | v1 was killed Sep 2023. Condition needs both `broadcaster_user_id` and `moderator_user_id` (set both to your own ID if you're the broadcaster) |
| `channel.subscribe` | `channel:read:subscriptions` | |
| `channel.subscription.gift` | `channel:read:subscriptions` | |
| `channel.cheer` | `bits:read` | |
| `channel.raid` | (none) | |
| `stream.online` / `stream.offline` | (none) | Can use App Access Token |

**PubSub is fully dead** as of April 14, 2025. Do not use it.

**OAuth for Electron (desktop):** Use the **Device Code Grant Flow** — NOT Authorization Code + PKCE (Twitch does not support PKCE). Public clients using DCF do not need a `client_secret`. Refresh tokens expire after **30 days** for public clients.

**Mandatory hourly validation:** Must call `GET https://id.twitch.tv/oauth2/validate` on startup and every hour. Twitch audits for this and will contact non-compliant apps.

**10-second subscribe window:** After receiving the EventSub WebSocket `session_welcome`, you have 10 seconds to POST your first subscription via REST or the connection is dropped.

**`channel.chat.notification`** covers subs, resubs, gift subs, and community gift subs in a single subscription — consider using it instead of subscribing to each separately.

---

## YouTube

### RTMP

**Primary:** `rtmp://a.rtmp.youtube.com/live2/{stream_key}`
**Backup:** `rtmp://b.rtmp.youtube.com/live2?backup=1/{stream_key}`

Stream keys support `isReusable: true` — the same key persists across multiple broadcasts.
This is YouTube's documented "most common use case." Users do not need to get a new key per session.

### Event Capture

**Two mechanisms:**

1. **REST polling** — `GET https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=...`
   - 5 quota units per call; returns `pollingIntervalMillis` hint
   - **Do not use as primary** — exhausts 10k quota/day in hours at any reasonable interval

2. **gRPC `streamList`** (recommended) — `V3DataLiveChatMessageService.StreamList`
   - Persistent server-streaming via HTTP/2 + Protocol Buffers
   - YouTube pushes messages; no polling; near-zero quota cost
   - Node.js: use `@grpc/grpc-js` + `@grpc/proto-loader` + `stream_list.proto`
   - Known bug: cannot distinguish `LIVE_CHAT_DISABLED` from `LIVE_CHAT_ENDED` via gRPC error code
     — fall back to a `liveBroadcasts.list` call to determine actual state

**Getting `liveChatId`:**
`GET https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&mine=true`
→ `items[0].snippet.liveChatId`
Poll every 30s while waiting for stream start. Re-fetch per broadcast (changes each time).

**Available event types** (via `snippet.type`):
`textMessageEvent`, `superChatEvent`, `superStickerEvent`, `newSponsorEvent`,
`memberMilestoneChatEvent`, `membershipGiftingEvent`, `giftMembershipReceivedEvent`,
`pollEvent`, `messageDeletedEvent`, `messageRetractedEvent`, `userBannedEvent`

### OAuth

**Scope:** `youtube.readonly` (`https://www.googleapis.com/auth/youtube.readonly`)
→ Sufficient for reading chat, broadcasts, and channel info.
→ `youtube.force-ssl` additionally required only if writing chat messages or banning.

**Scope classification:** **Sensitive** (not Restricted) — requires Google OAuth consent screen
verification before real users can authorize. No annual security assessment needed (that's only
for Restricted scopes). Verification involves: domain ownership, privacy policy, demo video,
scope justification.

**During development:** Add up to 100 test users in Google Cloud Console — they can authorize
without triggering the "unverified app" screen. No approval needed.

**Desktop OAuth:** Installed app / PKCE flow.
Redirect URI: `http://localhost:{port}` (register in GCP Console; spin up local HTTP server).
`urn:ietf:wg:oauth:2.0:oob` (copy-paste code) is deprecated but may still function.

**Refresh tokens:** Valid indefinitely until revoked. Google returns only a new `access_token`
on refresh — keep the original refresh token.

### Quota

- **10,000 units/day per GCP project** — shared across all users of the same OAuth client
- `liveChatMessages.list`: ~5 units/call
- `liveBroadcasts.list`: ~1 unit/call
- gRPC `streamList`: near-zero (persistent connection, not per-message)
- **Architecture decision:** Each user should create their own GCP project to avoid sharing
  the 10k quota. Document this clearly in the app's setup guide.

### Known Limitations

- No webhook/push for broadcast state changes — must poll `liveBroadcasts.list`
- `liveChatId` is null after broadcast ends — reconnect logic required
- Google OAuth review can take weeks to months — submit early
- gRPC `LIVE_CHAT_DISABLED` / `LIVE_CHAT_ENDED` ambiguity (known Google bug, under investigation)

---

## Kick

### Developer Access

**Fully self-service — no approval gate.** Any Kick account holder with 2FA enabled can register an app at [dev.kick.com](https://dev.kick.com) and receive credentials immediately. No follower count or channel verification required.

**OAuth 2.1 with PKCE** (Authorization Code Grant). No `client_secret` required for public clients — PKCE handles security. `state` parameter is currently mandatory.

**Redirect URI for Electron/desktop:** Use `http://localhost:{port}/callback` — NOT `http://127.0.0.1`. Kick's auth UI is built on NextJS which rewrites the first occurrence of `127.0.0.1` → `localhost`, causing exact-match failures. Documented workaround exists but using `localhost` is simpler.

**`streamkey:read` scope:** The official API can return the user's Kick stream key and RTMP URL. This means Kick stream key setup can be **fully automated** after OAuth — no manual copy-paste. This is a significant UX advantage over other platforms.

**Key scopes for Ottery Live:**
| Scope | Purpose |
|---|---|
| `streamkey:read` | Auto-fetch stream key and RTMP URL after OAuth |
| `user:read` | Get username, streamer ID |
| `channel:read` | Get chatroom ID for Pusher event capture |
| `events:subscribe` | Subscribe to official webhook events |
| `chat:write` | Optional: send bot messages to chat |

**Rate limits:** Not publicly documented. Known `429` responses exist. Treat as risk — implement conservative backoff. Empirical testing needed.

**Known OAuth bug (does not affect Electron):** On mobile, iOS Universal Links / Android App Links intercept the `id.kick.com/oauth/authorize` URL and open the Kick native app, breaking web OAuth. Electron opens a BrowserWindow or system browser, bypassing this entirely.

### RTMP URL:** `rtmps://fa723fc1b171.global-contribute.live-video.net/app`
- Protocol is **RTMPS** (TLS), not plain RTMP
- Port 443 optional: `rtmps://fa723fc1b171.global-contribute.live-video.net:443/app`
- The `/app` suffix is required — append it in OBS "Custom" service config
- CBR encoding only; keyframe interval 2s; max ~8,000 Kbps

**Official API:** `api.kick.com/public/v1/` — launched 2024, actively expanded. Official docs at `docs.kick.com`. GitHub: `KickEngineering/KickDevDocs`.

**Official API is webhooks only** for real-time events. WebSocket push is on the roadmap ([Issue #20](https://github.com/KickEngineering/KickDevDocs/issues/20)) but not shipped.

**Unofficial Pusher WebSocket (reverse-engineered, used by all community tools):**
- Pusher app key: `32cbd69e4b950bf97679`
- WS URL: `wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false`
- Channel naming: `chatrooms.{chatroomId}.v2`
- `chatroomId` fetched from: `GET https://kick.com/api/v2/channels/{username}` → `.chatroom.id`
- Public channels require **no credentials**

**Official webhook event types:** `chat.message.sent`, `channel.followed`, `channel.subscription.new`, `channel.subscription.renewal`, `channel.subscription.gifts`, `livestream.status.updated`

**Unofficial Pusher event names** (what community libraries expose): `ChatMessage`, `MessageDeleted`, `Subscription`, `GiftedSubscriptions`, `StreamerIsLive`, `StreamEnd`, `ViewerCount`, `UserBanned`, `PollUpdate`

**Recommended Node.js library:** [`LOX-X/Kick-Live-Connector`](https://github.com/lox-x/kick-live-connector) — TypeScript, uses Pusher WS, no auth required, most feature-complete.

---

## TikTok

### RTMP Streaming (video → TikTok)

**RTMP URL:** `rtmp://global-push.tiktok.com/live`
(Old URL `rtmp://push.rtmp.tiktok.com/stream` is superseded.)

**Stream key is session-specific** — generated fresh each session at
[livecenter.tiktok.com/producer](https://livecenter.tiktok.com/producer).
Cannot be pre-configured. OBS scenes/settings can be saved; only the key must be pasted fresh.

**Access requirements:**
- Basic live access: 1,000+ followers (or lower with high "authority score" in some regions)
- RTMP/OBS access: requires joining a TikTok Creator Network/Agency — this bypasses the
  follower count. Enrollment is **free**. Any agency charging money is a scam.
- Legitimate free agencies: **FTTV**, **Doves4Love**, **Talenture**
- Agency list: [toktutorials.com/list-of-agencies](https://www.toktutorials.com/list-of-agencies)
- Geographic restriction: RTMP feature not available in all regions even where TikTok works

**Recommended OBS settings:** 1080×1920 (portrait 9:16), 4,000 kbps CBR, keyframe 2s, hardware encoder

### Event Capture (events ← TikTok) — separate from RTMP

**EulerStream is for event capture only — not for RTMP streaming.**
The two systems are completely independent:
- RTMP → pushes video *to* TikTok (no EulerStream involved)
- EulerStream → pulls event data *from* a TikTok LIVE WebSocket (chat, gifts, likes, etc.)

**Official API for LIVE events:** Does not exist at any tier.

**Recommended library:** [`tiktok-live-connector`](https://www.npmjs.com/package/tiktok-live-connector)
(npm, v2.1.1-beta1). Connects to TikTok's internal Webcast WebSocket with protobuf decoding.
Only needs the streamer's `@username` — no credentials of any kind required.
Streamer must be live for the connection to succeed. EulerStream is not mentioned in the
library README and is not required. `signProviderOptions` exists as an optional hook for a
custom signing server, but the library works without it.

**Known instability:**
- TikTok actively updates internals, breaking libraries — forced version upgrades happen
- IP/country blocking on room ID lookups; proxy/VPN as workaround
- WebSocket close `4429` = `TOO_MANY_CONNECTIONS`
- Protobuf schema drift can break deserialization

---

## X (Twitter)

**`rtmp://ingest.pscp.tv` is DEAD.** Periscope was shut down March 2021. Do not use this URL.

**Current RTMP:** X uses **dynamically generated per-account RTMP URLs** from X Media Studio Producer.
- Access via: X Media Studio → Sources tab → Create Source → RTMP
- Choose nearest geographic region; URL is generated per source
- Requires **X Premium or Premium+** subscription to access streaming
- Account limit: 100 sources
- Region cannot be changed after creation
- Both RTMP and RTMPS URLs are provided

**No API for live stream events.** No official API exists at any tier for:
- Live stream chat/comments
- Viewer count
- Stream start/stop events

This is confirmed by developer community threads and official docs (as of Feb 2025).

**Filtered stream for tweets** (not live events): Requires **Pro tier at $5,000/month**. Not relevant for live stream event capture.

**Verdict:** X is **restream-only** for Ottery Live. No event capture is possible through official or well-supported unofficial means. The stream key setup requires the streamer to manually copy their dynamic URL from Media Studio.

---

## Joystick.tv

**RTMP URL:** `rtmp://rtmp.joystick.tv/live` **does not exist** in any public source.
Joystick.tv uses **AWS IVS** as its streaming backbone. Per-account RTMP ingest URLs follow the AWS IVS pattern but are generated per-channel and found only in the streamer's dashboard (Stream Settings). Cannot be pre-configured; user must copy from dashboard.

**Platform is active:** ~725,000 monthly visits (Dec 2025, up 33.96% MoM). GitHub org updated March 2026.

**WebSocket event capture IS possible:**
- Endpoint: `wss://joystick.tv/cable`
- Protocol: **Action Cable** (Rails ActionCable) — not Pusher
- Channel: `GatewayChannel`
- Auth: OAuth access token passed as query param: `?token=<ACCESS_TOKEN>`
- Confirmed event: `new_message` (chat messages)
- Follows, subs, viewer count: not confirmed in public sources

**OAuth 2.0 system exists:**
- Authorize: `https://joystick.tv/api/oauth/authorize?client_id=...`
- Token: `POST https://joystick.tv/api/oauth/token`
- Credentials must be requested from Joystick.tv directly (no self-service portal found)
- Redirect URI supports loopback (`http://127.0.0.1:{port}/auth`) — compatible with Electron

**Official bot examples** (MIT licensed) in Python, Ruby, JavaScript, and Crystal from the [joysticktv GitHub org](https://github.com/joysticktv). `GatewayChannel` is the official bot channel — this is a supported integration path, not a reverse-engineer. No npm package published; implement directly from their JS example.

**No webhook system** found. Integration model is WebSocket-only for real-time events.

---

## node-media-server

**Version:** v4.2.4 (active). **Breaking from v2** — most tutorials are for v2; use v4 docs only.

**No native module rebuild needed** — pure JS dependencies only (`cors`, `express`, `ws`).
Works with Electron's bundled Node version without `electron-rebuild`.

**Run as a child process**, not in-process with Express/Socket.io:
- Confirmed memory leaks in long-running sessions (issues #448, #473) — heap grows to
  4+ GB and triggers OOM. Isolating as a child process lets the watchdog restart it
  without killing the Electron app.
- Under short sessions (typical stream: 2–6 hours) the leak is manageable but real.
- FFmpeg transcoding CPU cost is external (separate FFmpeg child processes) — the
  node-media-server process itself is lightweight at idle.

**Windows port 1935 issue:** Binding to port 1935 throws `EACCES` on Windows even when
nothing is using it (OS-level reservation, UAC, or Windows 11 update). Workaround:
run on a higher port (e.g., 19350) or prompt the user to change the port in Settings.

**Alternatives considered:**
- `node-rtsp-rtmp-server`, `node-rtmp`: low/no activity — avoid
- **MediaMTX** (Go binary): most battle-hardened option; runs as a sidecar process;
  no memory leak issues; but requires bundling a Go binary per platform. Worth considering
  if `node-media-server` memory issues prove unacceptable in testing.

---

## ffmpeg-static

**Version:** v5.x, ships **FFmpeg 6.1.1** (updated Nov 14, 2025). Actively maintained. ~217K weekly downloads.

**Platform support:**

| OS | Arch | Supported |
|---|---|---|
| Windows | x64 | Yes |
| Windows | arm64 | **No** |
| macOS | x64 (Intel) | Yes |
| macOS | arm64 (Apple Silicon) | Yes |
| Linux | x64 | Yes |
| Linux | arm64 | Yes |

Windows arm64 requires a custom binary supplied via `extraResources`.

**ASAR issue — must be handled explicitly:**

Even though electron-builder has auto-detection for ffmpeg-static, it is unreliable. Always configure explicitly:

```json
// package.json build config
"asarUnpack": [
  "node_modules/ffmpeg-static/bin/${os}/${arch}/ffmpeg",
  "node_modules/ffmpeg-static/index.js",
  "node_modules/ffmpeg-static/package.json"
]
```

**electron-builder ≥ 25.1.8 bug:** `asarUnpack` is not honored correctly. Pin to `23.6.0` or test carefully before upgrading.

**Path resolution in code:**

```js
// Always in main process — never renderer (webpack rewrites require())
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
```

The `.replace()` is a no-op in development (path won't contain `app.asar`), so this is safe for both dev and production.

**macOS code signing (Hardened Runtime):**

FFmpeg binaries can crash with `SIGILL` under Hardened Runtime unless:
1. The binary is in `app.asar.unpacked` **before** signing
2. The binary is signed separately (not just via `--deep`) with `--options runtime`
3. Entitlements plist includes:
   ```xml
   <key>com.apple.security.cs.allow-jit</key><true/>
   <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
   ```
4. Use full Xcode (not just CLI tools) — `--entitlements` can silently fail with CLI tools only

---

## Rumble

### RTMP

Rumble provides a **static RTMP URL and stream key** per account. Both are fixed across streams
(no session-specific key rotation). The user copies them from:
`rumble.com` → Dashboard → Live → Stream Settings

There is no programmatic API to fetch the RTMP URL or stream key. Model it the same as
X/Joystick: user pastes in their URL. Store RTMP URL in `rtmp_url` DB field; stream key in keychain.

### Live Event API

Rumble has an **official Live Stream API (beta)** — REST-based, polling-only, no WebSocket.

**API URL:** `https://rumble.com/api/v0/live_stream_api/{user_id}/{key}/`
- Found at: `rumble.com/account/livestream-api`
- The URL contains the user's secret key embedded in the path — treat as a credential
- No OAuth required — the URL itself is the authentication mechanism
- Resettable from the dashboard

**Polling interval:** Every 3 seconds is reasonable. Rumble does not publish rate limits.

**Response structure (root endpoint):**
```json
{
  "livestreams": [
    {
      "id": "...",
      "title": "...",
      "chat": [
        { "id": "...", "time": "...", "username": "...", "text": "..." }
      ],
      "rants": [
        { "id": "...", "time": "...", "username": "...", "text": "...", "price_cents": 500 }
      ]
    }
  ],
  "followers": {
    "num_followers": 1234,
    "num_followers_total": 5678,
    "latest_follower": { "username": "..." },
    "recent_followers": [ { "username": "..." } ]
  },
  "subscribers": { ... }
}
```

`chat` and `rants` are only populated during an active live stream (up to 50 each).
`recent_followers` is always populated regardless of stream state.

**Python reference implementation:** [Cocorum](https://pypi.org/project/cocorum/) (MIT).

### No OAuth

No developer app registration system exists for rumble.com. There is no "Login with Rumble"
OAuth or API key management portal analogous to Twitch/YouTube.
`docs.rumble.cloud` is an unrelated product — do not confuse with the streaming platform.

---

## Facebook Live

### RTMP

**Static base URL (RTMPS only):**
```
rtmps://live-api-s.facebook.com:443/rtmp/
```
Facebook deprecated plain RTMP; RTMPS is required. The stream key is dynamic per live video —
generated by `POST /{user-or-page-id}/live_videos` or from Facebook Live Producer UI.

Full push URL: `rtmps://live-api-s.facebook.com:443/rtmp/{STREAM_KEY}`

To get the key via Graph API:
```
POST /me/live_videos?access_token={token}
→ Response: { secure_stream_url: "rtmps://live-api-s.facebook.com:443/rtmp/{KEY}", ... }
```

### Event Capture

**Server-Sent Events (SSE)** endpoint for real-time comments:
```
GET https://streaming-graph.facebook.com/{live-video-id}/live_comments
  ?access_token={page_or_user_token}
  &comment_rate=one_per_two_seconds    (or "one_hundred_per_second" for high-volume)
  &fields=id,message,from{id,name,pic}
```
Persistent HTTP SSE stream. Read with Node.js `fetch` + `response.body.getReader()`.

**Viewer count:** Poll `GET /{video-id}?fields=live_views,status&access_token={token}`.
No push mechanism for viewer count. Poll every 30s.

**Finding active live video:** `GET /me/live_videos?status=LIVE` or `GET /{page-id}/live_videos?status=LIVE`.
Re-poll every 30s when no video is active (wait for stream to start).

**Stream end detection:** Poll `status` field — `LIVE_STOPPED`, `VOD`, or `PROCESSING` indicates the stream ended.

### OAuth — Facebook Login for Devices

Facebook supports Device Code Grant for desktop apps as "Facebook Login for Devices."

```
POST https://graph.facebook.com/oauth/device
  access_token={app_id}|{app_secret}
  scope=pages_manage_posts,pages_read_engagement,pages_read_user_content,publish_video

→ { code, user_code, verification_uri: "https://www.facebook.com/device", interval, expires_in }
```
User enters `user_code` at `facebook.com/device`. Poll the same endpoint with `code` at `interval` seconds.

Enable "Login from Devices" in App Dashboard → Products → Facebook Login → Settings.

**Page access token:** For Page-based streams, exchange user token: `GET /me/accounts` returns an array
of Pages the user manages, each with an `access_token` — use that for all Page-level Graph API calls.

**Required scopes:**
- `pages_manage_posts` — create live videos on a Page
- `pages_read_engagement` — read Page engagement (viewer count)
- `pages_read_user_content` — read comments on Page posts
- `publish_video` — publish videos (including live) to timeline/Page

**App Review:** `publish_video` and Page management permissions require Meta App Review before
public users can authorize. During development: use test users in App Dashboard.

### Graph API Version

Use `v19.0`. Update as Facebook releases new versions. Breaking changes are announced 2 years ahead.

---

## Bilibili Live

### RTMP Streaming (TO Bilibili)

Stream address is **session-specific**, obtained via API:
```
POST https://api.live.bilibili.com/room/v1/Room/startLive
  room_id={id}&platform=pc_link&area_v2={category_id}&csrf={bili_jct}&csrf_token={bili_jct}
```
Response:
```json
{
  "rtmp": {
    "addr": "rtmp://live-push.bilivideo.com/live-bvc/",
    "code": "?streamname=live_{UID}_{n}&key={hex}&schedule=rtmp&pflag=1"
  }
}
```
Full push URL = `addr` + `code`. Requires session cookies (`SESSDATA`, `bili_jct`).

To stop: `POST https://api.live.bilibili.com/room/v1/Room/stopLive`

### Event Capture — Danmaku WebSocket

**WebSocket URL:** `wss://broadcastlv.chat.bilibili.com/sub`

Get optimal host + auth token for a room (no auth required for public rooms):
```
GET https://api.live.bilibili.com/room/v1/Danmu/getConf?room_id={id}&platform=pc&player=web
→ { data: { token: "...", host_list: [{ host: "...", port: 443 }] } }
```

**Binary packet format (16-byte header):**

| Offset | Bytes | Field | Notes |
|---|---|---|---|
| 0 | 4 | packet_length | Total size including header |
| 4 | 2 | header_length | Always 16 |
| 6 | 2 | protocol_version | 0=JSON, 1=popularity int32, 2=zlib, 3=brotli |
| 8 | 4 | operation | Op code (see below) |
| 12 | 4 | sequence_id | Usually 1 |

**Op codes:** 2=heartbeat (client→server, every 30s), 3=heartbeat reply (viewer count as uint32), 5=CMD message, 7=auth, 8=auth success

**Auth packet (op=7, sent within 5s of connect):**
```json
{ "uid": 0, "roomid": 12345, "protover": 3, "platform": "web", "type": 2, "key": "{token}" }
```

**Key CMD types (op=5):**

| CMD | Normalized Event | Key Fields |
|---|---|---|
| `DANMU_MSG` | `chat.message` | `info[1]`=text, `info[2]`=[uid, uname, is_admin] |
| `SUPER_CHAT_MESSAGE` | `tip` | `data.price` (CNY), `data.message`, `data.user_info` |
| `SEND_GIFT` | `tip` (gold only) | `data.coin_type`, `data.total_coin/1000` (CNY), `data.giftName` |
| `GUARD_BUY` | `subscribe` | `data.guard_level` (1=governor,2=admiral,3=captain) |
| `INTERACT_WORD` | `follow` (msg_type=2,4) | `data.uid`, `data.uname`, `data.msg_type` |
| `LIVE` | `stream.start` | — |
| `PREPARING` | `stream.end` | — |

**npm package:** [`bilibili-live-ws`](https://www.npmjs.com/package/bilibili-live-ws) (4.x)
handles all binary protocol, heartbeat, compression, and CMD parsing. Emits typed events.

### Authentication

**No OAuth.** Bilibili uses cookie-based session auth (`SESSDATA`, `bili_jct`, `DedeUserID`).

- **Event capture on public rooms:** No credentials required. Username display is partially
  masked per Bilibili's 2023 privacy policy update (some UIDs/names asterisked for unauthenticated connections).
- **RTMP stream start/stop:** Requires `SESSDATA` + `bili_jct` cookies.

For a desktop app, login can be implemented via QR code:
```
GET https://passport.bilibili.com/qrcode/getLoginUrl  → { url, oauthKey }
// Show QR code to user; poll:
POST https://passport.bilibili.com/qrcode/getLoginInfo  body: oauthKey={oauthKey}
// On success: returns cookies (SESSDATA, bili_jct, DedeUserID)
```

Bilibili requires accounts to have 100+ followers to use external encoders (OBS/RTMP) by default.

