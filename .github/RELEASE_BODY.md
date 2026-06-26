## What's new in v0.1.9

### Event capture reliability
- **No more YouTube reconnect storms.** When YouTube's gRPC chat endpoint reported a method as unavailable, the app would reconnect in a tight loop — flooding logs, stalling event processing long enough to drop the relay connection, and burning the daily YouTube API quota. It now detects this case, falls back to REST chat polling, and re-checks gRPC periodically so it recovers on its own without restarting the app.
- **TikTok config problems surface instead of failing silently.** A failure to resolve your TikTok room from any source (for example, an invalid or expired signing key) is now reported as an error you can see and act on, rather than being misread as "streamer offline" and retried forever in the background. Genuinely-offline streamers still wait patiently for you to go live.
- **TikTok waits for your stream to come up.** Event capture now gives the stream a few seconds to propagate after you go live before its first connection attempt, so it isn't misread as "not live yet".

### Dashboard
- **Stream status and chat/alert status are now separate.** Previously a problem with event capture (chat, alerts) could make a platform look like the stream itself had stopped. Each platform card now shows the restream as its main status with a separate "Events" indicator, and error messages tell you which one failed — so a chat hiccup never makes you think you've dropped off the air.
