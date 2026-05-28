# Overlay: Gift Alerts

Custom animations for tips, gifts, subscriptions, bits, and channel-point redeems.
Subscribes to the unified event bus and plays per-mapping animations as a browser-source overlay in OBS.

> **TL;DR.** Two URLs share the same route:
> - `…/overlays/gift-alerts?fallback=tiktok-assets` — unmapped TikTok gifts fall back to TikTok's own icon. Use **only on TikTok-led scenes**.
> - `…/overlays/gift-alerts?fallback=safe` — unmapped TikTok gifts are hidden. Safe to use everywhere.
>
> The mapping table (your custom animations) is **shared** — variants only change unmapped-gift fallback behavior.

## Event sources

Driven entirely by [Unified Events](UNIFIED_EVENTS.md). Listens for:

| Event type        | Source platforms              | Trigger key extracted     | Amount extracted     |
|-------------------|-------------------------------|---------------------------|----------------------|
| `tip`             | tiktok (gifts), generic tips  | TikTok `giftId`           | `data.amount`        |
| `cheer`           | twitch (bits), kick           | —                         | `data.bits`          |
| `subscribe`       | twitch, kick, youtube, ...    | `data.tier`               | —                    |
| `subscribe.gift`  | twitch, kick                  | `data.tier`               | `data.count`         |
| `redeem`          | twitch (channel points)       | `data.rewardId`           | `data.rewardCost`    |

The TikTok event capture worker enables `enableExtendedGiftInfo` and populates an in-memory
gift-metadata cache (id, name, diamond count, icon URL). The `tip` event payload now
includes `giftIconUrl` so the overlay can render TikTok's official artwork as a fallback
when the user has not authored their own animation for that gift yet.

## Storage

```js
// server/db/migrations/010_gift_animations.js
gift_animations:
  id, label, platform, event_type,
  trigger_key,        // tiktok giftId / twitch rewardId / sub tier — null = matches all of this type
  min_amount,         // optional minimum (bits, tip amount, gift sub count)
  animation_path,     // filename inside userData/overlay-assets/, or 'builtin:name'
  duration_ms, sound_path, position,
  enabled, priority,  // higher priority wins ties
  created_at, updated_at
```

Indexed on `(platform, event_type, enabled)`.

## API — `/api/gift-animations`

| Method | Path                          | Purpose                              |
|--------|-------------------------------|--------------------------------------|
| GET    | `/`                           | List all mappings                    |
| GET    | `/:id`                        | One mapping                          |
| POST   | `/`                           | Create                               |
| PUT    | `/:id`                        | Update                               |
| DELETE | `/:id`                        | Delete                               |
| POST   | `/test`                       | Fire a synthetic event onto the bus  |
| GET    | `/tiktok-gifts`               | List cached TikTok gift definitions  |
| GET    | `/tiktok-gifts/:id`           | Single TikTok gift lookup            |
| GET    | `/assets/list`                | List filenames in `overlay-assets/`  |
| GET    | `/assets/files/:filename`     | Serve an asset (Lottie JSON, image, video, audio) |

## Match scoring

When an event arrives, the overlay picks the best mapping for `(platform, event_type)`:

1. Exact `triggerKey` match → score 100
2. `minAmount` satisfied → score 50 + min_amount (more specific minimum wins)
3. Generic (no trigger key, no min amount) → score 1
4. Priority breaks ties
5. **Mappings tied on both score and priority are chosen randomly** — see Random variants below

This lets you author both a generic "any TikTok gift" animation and a specific Rose-only one
at the same time — the more specific one wins.

## Random variants

Common gifts (TikTok Galaxies, Roses) get repetitive fast if they always play the same
animation. To rotate between multiple animations for one trigger, create N mappings with
**identical** `(platform, event_type, trigger_key, min_amount, priority)` and different
`animation_path` values. The overlay picks one uniformly at random each time the event fires.

Each variant is fully independent — you can give every variant its own duration, sound, and
position. The editor labels variant-grouped rows with a `1/N` badge (e.g., "Rose v1 — 1/3
randomized") so you can see at a glance which mappings share a trigger.

The **Add variant** button in the editor clones the current mapping with a cleared
`animation_path` and an auto-incremented label, ready for you to pick a different file.

To force a specific mapping to always win, set its `priority` higher than its siblings —
priority beats randomness.

## Overlay behavior

```
ottery:event ─┐
              ├─► match against gift_animations
              ├─► play Lottie/image/video (380×380 by default, positioned per mapping)
              └─► optional sound, fades out after duration_ms
```

If no mapping matches:
- **TikTok `tip` + `?fallback=tiktok-assets`** → render `giftIconUrl` from TikTok's CDN + caption (e.g., "@bob sent a Rose ×5")
- **TikTok `tip` + `?fallback=safe`** → hide
- **Any other unmapped event** → hide (no spam)

## Asset format support

| Extension          | Renderer             |
|--------------------|----------------------|
| `.json`, `.lottie` | lottie-web (SVG)     |
| `.mp4`, `.webm`    | `<video>` autoplay   |
| `.webp`, `.gif`, `.png`, `.jpg`, `.jpeg` | `<img>` |

Drop files into `{userData}/overlay-assets/` (development fallback: `./data/overlay-assets/`).

## Editor

`/ottery-live/gift-alerts` in the app — a two-pane editor (list + form). Includes a
**Test** button that calls `POST /api/gift-animations/test` to fire a synthetic event so
you can preview without waiting for a real one.

The Interfaces page exposes two cards:
- **Gift Alerts (with TikTok assets)** — copies the `?fallback=tiktok-assets` URL
- **Gift Alerts (safe)** — copies the `?fallback=safe` URL

## TikTok gift artwork — legal note

TikTok's [Virtual Items Policy](https://www.tiktok.com/legal/page/global/virtual-items-policy/en)
treats gifts as a *limited license to digital products*; redistribution of the artwork is not granted.

The `?fallback=tiktok-assets` variant **hotlinks** the icon directly from TikTok's CDN at
display time — the assets are never copied, repackaged, or persisted by Ottery Live. The
`?fallback=safe` variant never references the CDN at all. Any custom animations you
author for specific `giftId`s are your own work and play in either variant.

## Files

```
server/
├── db/migrations/010_gift_animations.js
├── api/gift-animations.js
└── event-capture/
    ├── tiktok.js               # enables enableExtendedGiftInfo, emits giftIconUrl
    └── tiktok-gift-cache.js    # in-memory giftId → metadata cache

overlays/src/app/gift-alerts/
└── gift-alerts-overlay.component.ts

frontend/src/app/ottery-live/gift-alerts/
├── gift-alerts.component.ts
└── gift-alerts.service.ts
```
