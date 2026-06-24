## What's new in v0.1.7

### Chat capture fixes
- **YouTube chat now connects.** The live-broadcast lookup was sending two mutually exclusive filters (`mine` + `broadcastStatus`), which the YouTube API rejected outright — so chat was never found and capture gave up. Fixed the request, and made capture tolerant of transient API hiccups so it keeps polling instead of permanently quitting.
- **YouTube permission problems are now visible.** A genuine auth/permission failure (expired login or missing scope) now surfaces a "reconnect your YouTube account" prompt instead of silently sitting on "connecting" forever.
- **Twitch no longer shows a phantom live capture.** Twitch now reports "connected" only once chat is actually subscribed. Previously it could show a live capture while delivering no events.
- **Twitch missing-permission prompt.** When a saved Twitch login is missing the chat permission, the dashboard now shows an actionable "reconnect" banner (with the reason) and a re-auth badge, instead of a vague error.

### Settings / UI
- **OBS instructions show your real stream key.** The "How to connect OBS" steps now display the actual configured incoming stream key instead of a hardcoded placeholder.
- **Readable disabled controls.** Disabled buttons and "… — Not set" chips no longer render near-black text on a dark surface in the dark theme.
