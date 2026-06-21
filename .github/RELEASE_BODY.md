## What's new in v0.1.6

### Windows startup crash fixed
- **App now launches on Windows.** The packaged `better-sqlite3` was built for Node's ABI instead of the bundled Electron's ABI, so it failed to load on launch — the window never appeared, with no error and no log. Native modules are now rebuilt for the Electron ABI during packaging.
- **undici pinned to v6.** `undici@8` calls an API missing from the Node version Electron 33 bundles, which crashed the app at startup right after the database fix. Pinned to the v6 line that matches Electron's runtime.
- **Resilient auto-updater.** A failed update check (no release yet, offline, or a missing `latest.yml`) is now logged and ignored instead of crashing the app.

### Reliability
- **Startup failures are visible.** Any fatal error during startup shows a dialog (with the log path) instead of dying silently.
- **Builds are verified before release.** CI loads `better-sqlite3`, `keytar`, `undici`, and the other runtime-critical modules under the real Electron runtime, so a wrong-ABI or incompatible dependency fails the build instead of shipping.

### Relay / restream
- Verify relay TLS by default (pin a self-signed cert via `relay.caCert`, or opt out explicitly with `relay.allowSelfSigned`); all relay requests now time out instead of hanging stream start/stop.
- Restream now reports a `reconnecting` state end-to-end while a platform connection is down.
