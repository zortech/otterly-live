# Music Integration

Ottery Live includes a full music integration layer: Spotify "Now Playing" display,
viewer song requests via chat, queue management, and playback controls — all built
on the streamer's own Spotify developer credentials (no shared client ID, no monthly fee).

## Motivation

Services like TikInfinity charge ~$20/month for song request features that amount to
a chat command listener + a Spotify API call. Because Spotify's developer tier has no
viable path for open-source apps (5-user dev cap, 250k MAU for extended access), the
BYOC (bring your own credentials) pattern is used: each user registers a free Spotify
developer app and provides their Client ID to Ottery Live.

---

## Spotify Setup (BYOC)

One-time setup, ~5 minutes:

1. Go to [developer.spotify.com](https://developer.spotify.com) and create a free account
2. Create a new app — set the redirect URI to `ottery-live://spotify-callback`
3. Copy the **Client ID** (no secret needed — PKCE flow eliminates the need for one)
4. In Ottery Live → Settings → Music → enter the Client ID and click **Connect Spotify**
5. System browser opens → Spotify consent screen → redirects back to app
6. Token stored in OS keychain via `keytar` (same as all other platform credentials)

Refresh tokens handle silent re-auth. The streamer is never prompted again unless they
explicitly disconnect or revoke access in Spotify.

### Required Scopes

```
user-read-playback-state
user-read-currently-playing
user-modify-playback-state
playlist-read-private
playlist-read-collaborative
```

---

## Permission Model

Four levels of music control, independent of platform mod status:

| Role | Add to queue | Remove own | Remove any | Skip | Reject others | Manage admins |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| Viewer | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Mod (platform mod) | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Spotify Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Streamer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Spotify Admin** is a per-viewer role granted by the streamer in Settings → Music → Admins.
Stored in the `spotify_admins` table. Useful for a trusted music co-host.
Not tied to Twitch/Kick/YouTube mod status (though mods also get elevated access).

Platform mod detection uses the `actor.isMod` flag already present on normalized events.

---

## Chat Commands

All commands work unified across all connected platforms (Twitch, YouTube, Kick, TikTok, etc.)
via the existing unified event stream.

| Command | Who | Action |
|---------|-----|--------|
| `!play <song>` | Viewer+ | Add to queue. Searches Spotify; adds top result |
| `!remove` / `!undo` | Viewer (own last only) | Remove own last request + refund |
| `!song` | Anyone | Show currently playing in chat |
| `!queue` | Anyone | Show next N queued songs |
| `!skip` | Streamer / Spotify Admin | Skip current song |
| `!remove <position>` | Mod / Spotify Admin / Streamer | Remove any queue position |

Replies are sent back to the **originating platform only** (via the platform's chat API).
The streamer can configure which commands are enabled and whether to respond in chat.

### Song Request Cost

Requests can optionally cost viewer credits (from the credits system):
- `music.srCreditCost` setting (default: 0 = free)
- If > 0, credits are deducted on `!play` and refunded on `!remove`
- Twitch Channel Point redemptions: if a reward is linked, canceling the redemption
  returns points to the viewer automatically via the Twitch API

---

## Internal Queue Architecture

Songs are **not** pushed to Spotify's native queue immediately. Ottery Live maintains
its own queue in SQLite and feeds Spotify one song at a time. This gives full control:
remove, reorder, interleave, and undo — none of which are possible once a song is
in Spotify's opaque queue.

```
Viewer !play          → Search Spotify → store in song_queue (status: 'queued')
                                               ↓
                                   When current track ends (detected via polling)
                                               ↓
                               Pull next item from song_queue
                               Push to Spotify via POST /me/player/queue
                               Mark item status: 'playing'
                                               ↓
                               When that track ends → repeat
```

The Spotify poller (`GET /me/player` every 5 seconds) detects track changes by comparing
the current `item.id` to the last known playing track. On change, it advances the internal
queue and pushes the next song.

---

## Playback Modes

### 1. Requests Only
Only songs from the request queue play. When the queue is empty, Spotify playback stops.

### 2. Fallback Mode *(default)*
Requests play when queued. When the queue drains, the streamer's selected playlist resumes.

Implementation: Start Spotify playing the designated playlist as the active context.
`POST /me/player/queue` entries play before the next playlist song; when all queued
requests are exhausted, Spotify naturally resumes the playlist. Ottery Live does not need
to actively push playlist songs — Spotify handles the fallback.

### 3. Interleave Mode
Explicit mixing by ratio. The streamer sets a ratio like "1 playlist song per every 3 requests".

```
[request] [request] [request] [playlist] [request] [request] [request] [playlist] ...
```

Ottery Live manages both queues internally, pulling from the streamer's playlist to fill
interleave slots. Playlist songs are fetched via `GET /playlists/{id}/tracks` and
shuffled in-memory (or sequentially, configurable).

---

## Streamer Playlist

In Settings → Music, the streamer selects one of their Spotify playlists as the
"stream playlist" used in Fallback and Interleave modes.

- Playlist list fetched via `GET /me/playlists` on connect
- Can be refreshed manually
- Shuffle on/off setting
- Optional: Ottery Live can create a dedicated "Ottery Live Stream" playlist
  (`POST /users/{id}/playlists`) — requires `playlist-modify-public` or
  `playlist-modify-private` scope (not requested by default; opt-in)

---

## Database Schema

### `song_queue`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `spotify_track_id` | TEXT | e.g. `4iV5W9uYEdYUVa79Axb7Rh` |
| `track_name` | TEXT | |
| `artist_name` | TEXT | |
| `album_name` | TEXT | |
| `album_art_url` | TEXT | |
| `duration_ms` | INTEGER | |
| `requester_platform` | TEXT | null for streamer/system |
| `requester_platform_user_id` | TEXT | |
| `requester_username` | TEXT | |
| `requester_display_name` | TEXT | |
| `source` | TEXT | `request` \| `playlist` \| `streamer` |
| `position` | INTEGER | sort order in queue |
| `status` | TEXT | `queued` \| `playing` \| `played` \| `removed` |
| `twitch_redemption_id` | TEXT | for channel point refunds |
| `twitch_reward_id` | TEXT | |
| `credits_spent` | INTEGER | for credit refunds |
| `created_at` | TEXT | ISO8601 |
| `updated_at` | TEXT | ISO8601 |

### `spotify_admins`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `platform` | TEXT | |
| `platform_user_id` | TEXT | |
| `username` | TEXT | |
| `granted_by` | TEXT | streamer's display name |
| `created_at` | TEXT | ISO8601 |

Unique on `(platform, platform_user_id)`.

---

## Event Bus Events

| Event | Payload | Description |
|-------|---------|-------------|
| `music.track_changed` | `{ trackId, trackName, artistName, albumArtUrl, durationMs, source }` | New song started playing |
| `music.queue_updated` | `{ queue: [...] }` | Queue changed (add/remove/reorder) |
| `music.request_added` | `{ queueItem, requester }` | New song request accepted |
| `music.request_rejected` | `{ trackName, requester, rejectedBy, reason }` | Request removed by mod/admin |
| `music.request_removed` | `{ queueItem }` | Requester removed their own song |
| `music.playback_state` | `{ isPlaying, progressMs, durationMs }` | Poll update (5s interval) |
| `music.connected` | `{ userId, displayName }` | Spotify OAuth completed |
| `music.disconnected` | `{}` | Spotify disconnected |

`music.track_changed` is forwarded by StreamTap to overlay WebSocket clients, enabling
"Now Playing" OBS overlays without any additional configuration.

---

## Settings Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `music.enabled` | boolean | `false` | Master switch |
| `music.spotifyClientId` | string | `''` | User's Spotify Client ID |
| `music.playbackMode` | string | `'fallback'` | `requests_only` \| `fallback` \| `interleave` |
| `music.streamPlaylistId` | string | `''` | Spotify playlist ID for fallback/interleave |
| `music.streamPlaylistShuffle` | boolean | `true` | Shuffle stream playlist |
| `music.interleaveRatio` | integer | `3` | Requests per playlist song in interleave mode |
| `music.srEnabled` | boolean | `true` | Whether `!play` command is active |
| `music.srCreditCost` | integer | `0` | Credits to charge per request (0 = free) |
| `music.srMaxQueuePerViewer` | integer | `3` | Max queued songs per viewer at once |
| `music.srBlockDuplicates` | boolean | `true` | Block the same track twice in queue |
| `music.srCommandReply` | boolean | `true` | Reply in chat when song is added |
| `music.srChatPlatforms` | string[] | `[]` | Platforms to respond on (empty = all) |
| `music.pollIntervalMs` | integer | `5000` | Spotify polling interval |

---

## Server Files

```
server/
├── music/
│   ├── spotify-client.js     # Spotify Web API client (PKCE auth + API calls)
│   ├── song-queue.js         # SQLite-backed internal queue manager
│   └── music-manager.js      # Orchestrator: chat commands, polling, playback logic
├── api/
│   └── music.js              # Express REST endpoints for dashboard
└── db/migrations/
    └── 008_music.js          # song_queue + spotify_admins tables
```

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/music/status` | — | Connection status + now playing |
| `GET` | `/api/music/queue` | — | Current queue |
| `POST` | `/api/music/queue` | Streamer | Manually add a song |
| `DELETE` | `/api/music/queue/:id` | Streamer/Admin | Remove a queue item |
| `POST` | `/api/music/queue/:id/bump` | Streamer/Admin | Move item up/down |
| `POST` | `/api/music/skip` | Streamer/Admin | Skip current song |
| `PUT` | `/api/music/playback` | Streamer/Admin | Play/pause |
| `GET` | `/api/music/playlists` | — | List streamer's Spotify playlists |
| `GET` | `/api/music/admins` | — | List Spotify admins |
| `POST` | `/api/music/admins` | Streamer | Grant Spotify admin |
| `DELETE` | `/api/music/admins/:id` | Streamer | Revoke Spotify admin |
| `GET` | `/auth/spotify` | — | Start PKCE OAuth flow |
| `GET` | `/auth/spotify/callback` | — | OAuth callback handler |
| `DELETE` | `/auth/spotify` | — | Disconnect Spotify |
