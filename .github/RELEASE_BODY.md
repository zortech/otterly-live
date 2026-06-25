## What's new in v0.1.8

### Remote relay reliability (important if you stream through a relay)
- **No more silent fallback to a direct push.** If the relay is unreachable, Ottery Live will no longer quietly start pushing every platform directly from your machine. That fallback could saturate a limited uplink (the whole reason you use a relay) and corrupt every destination at once. Auto-start, manual per-platform toggles, and "Start All" now all route through the relay — and refuse to start if the relay session isn't up.
- **You can't miss a relay failure anymore.** When the relay is down, the dashboard shows a persistent "RELAY DOWN — YOU ARE NOT LIVE" banner instead of a toast that disappears after a few seconds. No more believing you're live when nothing is going out.
- **Skip certificate check option.** New toggle in Settings → Restream Mode lets you connect to a relay that uses a self-signed certificate (e.g. accessed by raw IP). Use it only for a relay you control.

### Relay server (self-hosted)
- **Self-signed certs can now carry a SAN.** Set `RELAY_PUBLIC_HOST` to the IP or hostname clients connect to, and the generated cert embeds a matching Subject Alternative Name — required for strict TLS verification when pinning the cert. See `docs/REMOTE_RELAY_DEPLOYMENT.md`.
