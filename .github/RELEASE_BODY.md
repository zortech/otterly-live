## What's new in v0.1.2

### CI / Build Fix
- **Windows build restored** — `better-sqlite3` has no prebuilt binary for Node 25 on Windows, causing the native compile to fail with a `llvm-lib.exe /LTCG:INCREMENTAL` error. The Windows CI job now uses Node 22 LTS where prebuilt binaries are available, bypassing the from-source compile entirely. macOS and Linux remain on Node 25.
