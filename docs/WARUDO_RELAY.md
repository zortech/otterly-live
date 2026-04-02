# Warudo Relay

Ottery Live can forward stream events to [Warudo](https://warudo.app), the 3D VTubing
software, so you can drive avatar reactions, scene triggers, and alerts from live events
(follows, subscriptions, chat messages, cheers, tips, raids, etc.).

There are two integration paths — pick one or use both:

| | Path A — Built-in Relay | Path B — C# Plugin |
|---|---|---|
| **How it works** | Ottery pushes JSON to Warudo's built-in WebSocket server | Warudo plugin connects to Ottery's StreamTap WebSocket |
| **Requires Warudo plugin?** | No | Yes (`OtteryLivePlugin.cs`) |
| **Blueprint nodes** | Generic "On WebSocket Message Received" | Typed nodes per event (On Ottery Follow, etc.) |
| **Setup complexity** | Simpler | Slightly more (build & install the plugin) |

---

## Path A — Built-in Relay (no plugin)

### How to enable

Settings → Warudo → enable, set host/port if needed.

Ottery Live opens an outbound WebSocket connection to `ws://{host}:{port}` (default
`ws://localhost:19190`). It reconnects automatically every 5 seconds when Warudo isn't
running or isn't yet reachable.

### Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `warudo.enabled` | boolean | `false` | Enable/disable the relay |
| `warudo.host` | string | `localhost` | Warudo WebSocket host |
| `warudo.port` | number | `19190` | Warudo WebSocket port |

Changes to `warudo.enabled` take effect immediately (no restart needed).
Changing host or port requires toggling the relay off and on again.

### Warudo blueprint setup

1. Open Warudo → Blueprint editor
2. Add an **"On WebSocket Message Received"** node
3. Connect it to a **"Parse JSON"** node — Warudo will expose each field as a pin
4. Route on the `type` field using a **"Switch"** or **"Branch"** node

### Message format

Every message is a flat JSON object (no wrapping envelope). Fields present depend on
the event type.

#### Common fields (all event types)

| Field | Type | Description |
|---|---|---|
| `type` | string | Event type (see table below) |
| `platform` | string | Source platform: `twitch`, `youtube`, `kick`, `tiktok`, `x`, `joystick` |
| `timestamp` | string | ISO 8601 UTC |
| `username` | string | Actor's login/handle (null if no actor) |
| `displayName` | string | Actor's display name |
| `isSubscriber` | boolean\|null | Whether the actor is a subscriber |
| `isModerator` | boolean\|null | Whether the actor is a moderator |

#### Per-type extra fields

| `type` | Extra fields |
|---|---|
| `chat.message` | `message` (string), `color` (string hex) |
| `follow` | _(none)_ |
| `subscribe` | `tier` (string: `"1000"` / `"2000"` / `"3000"`), `months` (int), `message` (string) |
| `subscribe.gift` | `count` (int), `tier` (string) |
| `cheer` | `bits` (int), `message` (string) |
| `tip` | `amount` (float), `currency` (string, e.g. `"USD"`), `message` (string) |
| `raid` | `viewerCount` (int) |
| `like` | _(none)_ |
| `share` | _(none)_ |

#### Example messages

```json
// chat.message
{
  "type": "chat.message",
  "platform": "twitch",
  "timestamp": "2026-03-16T14:00:00.000Z",
  "username": "CoolViewer",
  "displayName": "CoolViewer",
  "isSubscriber": true,
  "isModerator": false,
  "message": "Hello stream!",
  "color": "#FF4500"
}

// follow
{
  "type": "follow",
  "platform": "twitch",
  "timestamp": "2026-03-16T14:01:00.000Z",
  "username": "NewFan",
  "displayName": "NewFan",
  "isSubscriber": false,
  "isModerator": false
}

// subscribe
{
  "type": "subscribe",
  "platform": "twitch",
  "timestamp": "2026-03-16T14:02:00.000Z",
  "username": "LoyalSub",
  "displayName": "LoyalSub",
  "isSubscriber": true,
  "isModerator": false,
  "tier": "1000",
  "months": 3,
  "message": "Love the content!"
}

// subscribe.gift
{
  "type": "subscribe.gift",
  "platform": "twitch",
  "timestamp": "2026-03-16T14:03:00.000Z",
  "username": "GiftGiver",
  "displayName": "GiftGiver",
  "isSubscriber": true,
  "isModerator": false,
  "count": 5,
  "tier": "1000"
}

// cheer
{
  "type": "cheer",
  "platform": "twitch",
  "timestamp": "2026-03-16T14:04:00.000Z",
  "username": "BitsFan",
  "displayName": "BitsFan",
  "isSubscriber": false,
  "isModerator": false,
  "bits": 500,
  "message": "Pog!"
}

// tip
{
  "type": "tip",
  "platform": "kick",
  "timestamp": "2026-03-16T14:05:00.000Z",
  "username": "Generous",
  "displayName": "Generous",
  "isSubscriber": null,
  "isModerator": null,
  "amount": 5.00,
  "currency": "USD",
  "message": "Keep it up!"
}

// raid
{
  "type": "raid",
  "platform": "twitch",
  "timestamp": "2026-03-16T14:06:00.000Z",
  "username": "RaidLeader",
  "displayName": "RaidLeader",
  "isSubscriber": false,
  "isModerator": false,
  "viewerCount": 150
}
```

### Filtered event types

The relay does **not** forward these types — they are internal to Ottery Live:

- `viewer_count`
- `stream.start` / `stream.end`
- `system.capture_connected` / `system.capture_disconnected` / `system.capture_error`

---

## Path B — C# Plugin (typed blueprint nodes)

The plugin file is at `warudo/OtteryLivePlugin.cs` in this repo.

This approach gives you **typed blueprint nodes** in Warudo's "Ottery Live" category — no
manual JSON parsing needed.

### How it works

```
StreamTap (ws://localhost:4747)
  ──► OtteryLivePlugin (C# Warudo plugin)
        ├── parses OtteryEvent JSON from StreamTap
        └── fires typed blueprint nodes
              On Ottery Chat Message
              On Ottery Follow
              On Ottery Subscribe
              On Ottery Gift Sub
              On Ottery Cheer
              On Ottery Tip
              On Ottery Raid
              On Ottery Like / Share
```

The plugin connects **inbound to Ottery Live** (it is a WebSocket client against
StreamTap), so Ottery Live doesn't need to know anything about Warudo.

### Prerequisites

1. **Ottery Live**: Settings → StreamTap → Enable. Note the port (default `4747`).
   If you set an auth token, copy it — you'll need it in the plugin settings.
2. **Warudo**: Set up a mod/plugin project per the
   [Warudo plugin mod guide](https://docs.warudo.app/docs/scripting/creating-your-first-plugin-mod).
3. Copy `OtteryLivePlugin.cs` into your mod folder and build.

### Plugin settings (appear in Warudo scene panel)

| Setting | Default | Description |
|---|---|---|
| StreamTap Host | `localhost` | Ottery Live's StreamTap host |
| StreamTap Port | `4747` | Ottery Live's StreamTap port |
| Auth Token | _(blank)_ | Required only if StreamTap auth is enabled |
| Auto Connect on Load | `true` | Connect when the scene loads |

The panel also exposes **Connect** and **Disconnect** trigger buttons.

### Blueprint nodes

All nodes live under the **"Ottery Live"** category in the blueprint node picker.

#### On Ottery Chat Message
Fires on every chat message from any enabled platform.

| Output | Type | Description |
|---|---|---|
| → _(flow)_ | — | Triggers connected nodes |
| Platform | string | Source platform |
| Username | string | Sender's login |
| Display Name | string | Sender's display name |
| Message | string | Chat text |
| Color | string | Username color (hex, Twitch only; empty otherwise) |
| Is Subscriber | bool | |
| Is Moderator | bool | |
| Timestamp | string | ISO 8601 |

#### On Ottery Follow
| Output | Type |
|---|---|
| Platform, Username, Display Name, Timestamp | string |

#### On Ottery Subscribe
| Output | Type | Description |
|---|---|---|
| Platform, Username, Display Name, Timestamp | string | |
| Tier | string | `"1000"` / `"2000"` / `"3000"` (Twitch tier) |
| Months | int | Cumulative months subscribed |
| Message | string | Optional sub message |
| Is Subscriber | bool | Always true for new subs |

#### On Ottery Gift Sub
| Output | Type | Description |
|---|---|---|
| Platform, Username, Display Name, Tier, Timestamp | string | Gifter info |
| Count | int | Number of subs gifted in this event |

#### On Ottery Cheer
| Output | Type |
|---|---|
| Platform, Username, Display Name, Message, Timestamp | string |
| Bits | int |

#### On Ottery Tip
| Output | Type |
|---|---|
| Platform, Username, Display Name, Currency, Message, Timestamp | string |
| Amount | float |

#### On Ottery Raid
| Output | Type |
|---|---|
| Platform, Username, Display Name, Timestamp | string |
| Viewer Count | int |

#### On Ottery Like / Share
Covers TikTok/Kick engagement events.

| Output | Type | Description |
|---|---|---|
| Event Type | string | `"like"` or `"share"` |
| Platform, Username, Display Name, Timestamp | string | |

#### On Ottery Raw Event
Fires for **every** event type, including types not listed above. Useful for
custom handling or debugging.

| Output | Type | Description |
|---|---|---|
| Event Type | string | Raw type string |
| Platform | string | |
| Payload | JObject | Full JSON object — inspect with Get JSON Field nodes |

---

## Choosing between Path A and Path B

- **No C# experience / quick setup** → Path A. Enable the relay, add "On WebSocket
  Message Received" in blueprints, use "Parse JSON" to pull out the fields you need.
- **Rich blueprint UX / multiple triggers** → Path B. Typed nodes, no JSON parsing,
  cleaner blueprint graphs.
- **Both enabled at once** is fine — they are independent.
