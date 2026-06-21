## What's new in v0.1.5

### Windows startup crash fixed
- **App now launches on Windows.** The packaged `better-sqlite3` was built for Node's ABI (`NODE_MODULE_VERSION 127`) instead of the bundled Electron's ABI (`130`), so `require('better-sqlite3')` failed on launch — the window never appeared, with no error and no log. Native modules are now rebuilt for the Electron ABI during packaging.
- **Builds are verified before release.** A new `verify:native` gate loads `better-sqlite3` and `keytar` under the actual Electron runtime during CI, so a wrong-ABI binary can never be shipped silently again.
- **Startup failures are now visible.** Any fatal error during startup shows an error dialog (with the log path) instead of dying silently.
