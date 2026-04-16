## What's new in v0.1.1

### Chat Overlay
- **Emote rendering** — Twitch and TikTok emotes now display inline as images
- **Configurable exit animations** — 7 options: slide left/right/up, dissolve, shrink, flip, blur-out
- **Test pattern** — shows sample messages for OBS positioning when you're not live
- **Bottom-anchored layout** — new messages appear at the bottom, old messages push up
- **Overflow trim** — messages are automatically removed when they exceed the visible area

### Goal Single Overlay
- **Persistent count** — current progress is saved to the database and restored on reload
- **Set/reset from dashboard** — Interfaces UI now has a current count field and reset button
- **Resets on session end** — counter clears when the stream ends
- **Full-width positioning** — overlay uses `inset: 0` so it can be positioned freely in OBS

### Music Queue / Now Playing Overlays
- Full-width layout (`width: 100%`) with proper `box-sizing` — easier to position in OBS

### Platform Management
- Dialog is wider (660px, 90vh max) and scrolls properly
- Cancel button uses stroked style for better visual contrast
- OAuth device flow shows a manual navigation message if the browser couldn't be opened automatically
- Better error messages from HTTP error responses during OAuth

### Music Commands
- `!revoke` added as an alias for `!remove` / `!undo`
- `!queue` command is now configurable: enable/disable, item limit, per-user cooldown

### CI / Build
- Removed invalid `--browsers=ChromeHeadless` flag from the frontend CI test script — Vitest 4 with jsdom environment doesn't use browser providers

### Other Fixes
- Event capture starts immediately on server startup — chat and events work before going live
- `open-external` IPC handler now returns a boolean success value and logs errors
- `twitch.tv` added to the OAuth allowlist (bare domain, not just `www.twitch.tv`)
- Various Angular style fixes: primary button colour, form field hint colour, text input colour
