# Token Management

Covers the full lifecycle of OAuth access tokens and refresh tokens across all platforms:
storage, background refresh, expiry detection, hourly validation, and failure handling.

## Storage

All tokens are stored in the OS keychain via `keytar` (see STREAM_SERVICES.md).
The SQLite `stream_services.api_token_expires_at` column stores the expiry timestamp
so expiry can be checked without touching the keychain.

```
Keychain entries per StreamService:
  ottery-live / api_access_token_{id}
  ottery-live / api_refresh_token_{id}
  ottery-live / api_client_secret_{id}
```

## Token Lifecycle Manager

A single `TokenManager` runs in the server process and owns all token operations.

```js
// server/auth/token-manager.js
class TokenManager {
  constructor(settings, eventBus) {
    this.validationInterval = null;
    this.refreshTimers = new Map();   // serviceId → setTimeout handle
  }

  // Call once on server start
  async start() {
    const services = await StreamService.getAllActive();
    for (const svc of services) {
      await this.scheduleRefresh(svc);
    }
    this.startHourlyValidation();
  }

  // Call when a new service is added or tokens are updated
  async scheduleRefresh(svc) { ... }

  // Cancel timers for a deleted/disabled service
  cancelRefresh(serviceId) { ... }

  // Force-refresh now (called by capture workers on auth error)
  async refreshNow(serviceId) { ... }

  // Twitch compliance: validate all active Twitch tokens every hour
  startHourlyValidation() { ... }

  stop() {
    clearInterval(this.validationInterval);
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
  }
}
```

## Per-Platform Strategy

### Twitch

**Token type:** User Access Token (from Device Code Grant Flow)
**Expiry:** Access token expires; refresh token expires after **30 days** for public clients.
**Mandatory hourly validation:** `GET https://id.twitch.tv/oauth2/validate` — required by Twitch ToS.

**Refresh trigger:** Proactive — refresh 24 hours before `api_token_expires_at`.

```js
// server/auth/platforms/twitch-token.js
async function refresh(svc) {
  const refreshToken = await StreamService.getCredential(svc.id, 'api_refresh_token');
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: svc.api_client_id,
      // No client_secret — public client (Device Code Grant)
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new TokenRefreshError(data.message);

  // Both tokens rotate — store both
  await StreamService.setCredential(svc.id, 'api_access_token', data.access_token);
  await StreamService.setCredential(svc.id, 'api_refresh_token', data.refresh_token);
  await db('stream_services').where({ id: svc.id }).update({
    api_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  });
}
```

**Hourly validation:**

```js
function startHourlyValidation() {
  const validate = async () => {
    const twitchServices = await StreamService.getByPlatform('twitch');
    for (const svc of twitchServices) {
      const token = await StreamService.getCredential(svc.id, 'api_access_token');
      if (!token) continue;
      const res = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${token}` },
      });
      if (res.status === 401) {
        // Token invalid — trigger refresh immediately
        await this.refreshNow(svc.id);
      }
    }
  };

  validate();  // Run immediately on startup
  this.validationInterval = setInterval(validate, 60 * 60 * 1000);  // Every hour
}
```

**Refresh token expiry (30 days):** If the refresh token itself has expired, refresh fails.
The user must re-authenticate via Device Code Grant. The dashboard shows a
"Twitch reconnection required" alert for that service.

### YouTube

**Token type:** OAuth 2.0 access token + refresh token (installed app / PKCE flow)
**Access token expiry:** ~1 hour (`expires_in: 3599`)
**Refresh token expiry:** Indefinitely valid until revoked by user or Google — never expires on its own.

**Key difference from Twitch:** Google returns a **new `access_token` only** on refresh.
The original `refresh_token` is reused indefinitely — do not overwrite it on refresh.
A new refresh token is only issued on the very first authorization.

```js
// server/auth/platforms/youtube-token.js
async function refresh(svc) {
  const refreshToken = await StreamService.getCredential(svc.id, 'api_refresh_token');
  const clientSecret = await StreamService.getCredential(svc.id, 'api_client_secret');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: await StreamService.getCredential(svc.id, 'api_client_id'),
      client_secret: clientSecret,  // YouTube installed app requires client_secret
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new TokenRefreshError(data.error_description ?? data.error);

  // Only access_token is returned — keep the existing refresh_token unchanged
  await StreamService.setCredential(svc.id, 'api_access_token', data.access_token);
  await db('stream_services').where({ id: svc.id }).update({
    api_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  });
}
```

**Refresh trigger:** Proactive — refresh 24 hours before `api_token_expires_at` (token
expires in ~1 hour, so in practice this means refresh on startup if token is stale, and
schedule a refresh ~35 minutes after each successful refresh).

**Re-auth:** Only required if the user explicitly revokes access in their Google Account
settings, or if Google invalidates the token due to inactivity (>6 months). Unlike Twitch,
there is no 30-day expiry to worry about. On `invalid_grant` error from token refresh,
set `needs_reauth = true` and prompt user to re-authorize.

**No hourly validation required** — Google has no equivalent of Twitch's mandatory
validate endpoint.

### Kick

**Token type:** OAuth 2.0 access token (official API)
**Expiry:** Not publicly documented — treat as potentially expiring; store `api_token_expires_at`
if returned in the token response.

**Unofficial Pusher WS:** Does not require a token — chatroom events are public.
Token is only needed for moderation actions via the official API.

**Strategy:** Refresh proactively 24 hours before expiry if `expires_in` is provided.
If no expiry info is returned, validate weekly by making a lightweight API call
(`GET /api/stream-services/:slug`). On 401, trigger re-auth via OAuth flow.

### TikTok

**No OAuth tokens.** TikTok event capture requires only:
- `@username` (stored in `stream_services.username`)
- EulerStream API key (global app setting, not per-service)

No token refresh needed for event capture.
RTMP stream key is session-specific but is not a token — it's copied manually per stream.

### X (Twitter)

Event capture not supported. No tokens needed for restreaming (RTMP URL is in the DB,
stream key in keychain — static per source, does not expire).

### Joystick.tv

**Token type:** OAuth 2.0 access + refresh token
**Expiry:** Treat same as Kick — refresh 24 hours before `api_token_expires_at` if provided.
On 401 from WebSocket, trigger refresh. Loopback OAuth re-auth if refresh fails.

## Refresh Schedule Logic

```js
async function scheduleRefresh(svc) {
  const existing = this.refreshTimers.get(svc.id);
  if (existing) clearTimeout(existing);

  const expiresAt = svc.api_token_expires_at
    ? new Date(svc.api_token_expires_at).getTime()
    : null;

  if (!expiresAt) return;  // No expiry info — rely on reactive refresh (401 handling)

  const refreshAt = expiresAt - 24 * 60 * 60 * 1000;  // 24h before expiry
  const delay = refreshAt - Date.now();

  if (delay <= 0) {
    // Already past refresh window — refresh immediately
    await this.refreshNow(svc.id);
    return;
  }

  const timer = setTimeout(() => this.refreshNow(svc.id), Math.min(delay, 2147483647));
  this.refreshTimers.set(svc.id, timer);
}
```

`Math.min(delay, 2147483647)` — `setTimeout` overflows for delays > ~24.8 days.
For Twitch's 30-day refresh tokens, re-schedule after each refresh.

## Reactive Refresh (On 401)

Event capture workers call `tokenManager.refreshNow(serviceId)` when they receive
an auth error from the platform:

```js
// In any capture worker:
ws.on('error', async (err) => {
  if (err.code === 401 || err.message?.includes('Unauthorized')) {
    try {
      await tokenManager.refreshNow(this.svc.id);
      await this.reconnect();  // Retry with new token
    } catch (refreshErr) {
      this.emit('error', { code: 'AUTH_FAILED', requiresReauth: true });
    }
  }
});
```

## Re-Authentication Required

When a refresh fails (expired refresh token, revoked access), the service enters
`needs_reauth` state:

```js
await db('stream_services').where({ id }).update({ needs_reauth: true });
eventBus.emit('auth.required', { serviceId: id, platform: svc.platform });
```

Add `needs_reauth` boolean column to `stream_services` migration.

The dashboard shows a persistent banner per affected platform:
> "⚠ Twitch: Re-authentication required. [Reconnect]"

Clicking **[Reconnect]** restarts the OAuth flow for that platform.

## Token Refresh Error Classes

```js
class TokenRefreshError extends Error {
  constructor(message, { requiresReauth = false } = {}) {
    super(message);
    this.requiresReauth = requiresReauth;  // true = refresh token also invalid
  }
}
```

## Startup Sequence

On server start, `TokenManager.start()`:
1. Loads all active StreamServices
2. For each: checks `api_token_expires_at` — if within 24h or past, refreshes immediately
3. Schedules future refresh timers for all services
4. Starts Twitch hourly validation interval (validates immediately on startup too)
5. Checks `needs_reauth` flag — emits `auth.required` events for any flagged services

This means tokens are always fresh before any capture worker tries to connect.
