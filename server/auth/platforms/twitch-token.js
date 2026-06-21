'use strict';

const db = require('../../db/knex');
const StreamService = require('../../models/stream-service');
const { TokenRefreshError } = require('../token-refresh-error');
const logger = require('../../lib/logger');

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';

// Scopes required for all EventSub subscriptions used in Phase 6
const DCF_SCOPES = 'user:read:chat moderator:read:followers channel:read:subscriptions bits:read channel:read:redemptions';

/**
 * Refresh the Twitch access token using the refresh token.
 * Both access_token and refresh_token rotate on each refresh (public client / DCF).
 */
async function refresh(svc) {
  const refreshToken = svc.api_refresh_token;
  if (!refreshToken) {
    throw new TokenRefreshError('No refresh token stored', { requiresReauth: true });
  }

  const clientId = svc.api_client_id;
  if (!clientId) {
    throw new TokenRefreshError('No client ID configured', { requiresReauth: true });
  }

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      // No client_secret — Device Code Grant is a public client
    }).toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    const message = data.message || data.error || '';

    // Device Code Grant is a public client and correctly sends no secret, so a
    // "missing client secret" response does NOT mean a secret is needed. Twitch
    // returns it when it can't match the request to a valid public client —
    // usually a wrong/stale Client ID, or an app whose Client Type isn't "Public".
    // Surface that instead of the misleading raw message.
    if (res.status === 400 && message.includes('missing client secret')) {
      throw new TokenRefreshError(
        'Twitch did not recognize this Client ID as a Public client. ' +
        'Check that the Client ID matches your Twitch application and that the ' +
        "app's Client Type is set to \"Public\" in the Twitch Developer Console, " +
        'then reconnect your Twitch account.',
        { requiresReauth: true }
      );
    }

    const requiresReauth = res.status === 400 && (
      message.includes('Invalid refresh token') ||
      data.error === 'invalid_grant'
    );
    throw new TokenRefreshError(message || 'Token refresh failed', { requiresReauth });
  }

  await StreamService.setCredential(svc.id, 'api_access_token', data.access_token);
  await StreamService.setCredential(svc.id, 'api_refresh_token', data.refresh_token);
  await db('stream_services').where({ id: svc.id }).update({
    api_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    needs_reauth: false,
    updated_at: new Date().toISOString(),
  });

  logger.info(`[twitch-token] refreshed access token for service ${svc.id}`);
}

/**
 * Validate the current Twitch access token (mandatory hourly per Twitch ToS).
 * Returns { valid: boolean }.
 */
async function validate(svc) {
  const token = await StreamService.getCredential(svc.id, 'api_access_token');
  if (!token) return { valid: false, reason: 'no_token' };

  let res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    res = await fetch(TWITCH_VALIDATE_URL, {
      headers: { Authorization: `OAuth ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    // Network error or timeout — assume valid (don't force refresh on Twitch downtime)
    logger.warn(`[twitch-token] validate request failed for service ${svc.id}: ${err.message}`);
    return { valid: true };
  }

  if (res.status === 401) return { valid: false, reason: 'unauthorized' };
  if (!res.ok) {
    logger.warn(`[twitch-token] validate returned HTTP ${res.status} for service ${svc.id} — assuming valid`);
    return { valid: true };
  }
  return { valid: true };
}

/**
 * Initiate Device Code Grant flow.
 * Returns the raw response from Twitch: { device_code, user_code, verification_uri, expires_in, interval }.
 */
async function startOAuthFlow({ api_client_id: clientId }) {
  const res = await fetch(TWITCH_DEVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: DCF_SCOPES }).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Failed to start Device Code Grant flow');
  }
  return data; // { device_code, user_code, verification_uri, expires_in, interval }
}

/**
 * Poll the token endpoint until the user authorizes (or an error/expiry occurs).
 * Returns { access_token, refresh_token, expires_in }.
 */
async function pollOAuthToken(deviceCode, clientId, intervalSeconds) {
  return new Promise((resolve, reject) => {
    let pollInterval = (intervalSeconds ?? 5) * 1000;
    let attempts = 0;
    const maxAttempts = 120; // ~10 minutes at 5s interval

    const poll = async () => {
      attempts++;
      if (attempts > maxAttempts) {
        reject(new Error('Authorization timed out'));
        return;
      }

      try {
        const res = await fetch(TWITCH_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: clientId,
          }).toString(),
        });
        const data = await res.json();

        if (res.ok) {
          resolve(data); // { access_token, refresh_token, expires_in, ... }
          return;
        }

        // Twitch returns status in either data.error or data.message depending on endpoint version
        const status = data.error || data.message || '';

        switch (status) {
          case 'authorization_pending':
            // User hasn't authorized yet — continue polling
            setTimeout(poll, pollInterval);
            break;
          case 'slow_down':
            // Per DCF spec: increase interval by 5s
            pollInterval += 5000;
            setTimeout(poll, pollInterval);
            break;
          case 'access_denied':
            reject(new Error('User denied authorization'));
            break;
          case 'expired_token':
            reject(new Error('Device code expired — please try again'));
            break;
          default:
            reject(new Error(data.message || data.error || 'OAuth polling failed'));
        }
      } catch (err) {
        // Network error — retry
        setTimeout(poll, pollInterval);
      }
    };

    setTimeout(poll, pollInterval);
  });
}

/**
 * Fetch the broadcaster's user ID and login from the Twitch API.
 * Returns { id, login, display_name }.
 */
async function fetchChannelId(accessToken, clientId) {
  const res = await fetch(TWITCH_USERS_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
    },
  });
  const data = await res.json();
  if (!res.ok || !data.data?.[0]) {
    throw new Error('Failed to fetch Twitch user info');
  }
  return {
    id: data.data[0].id,
    login: data.data[0].login,
    display_name: data.data[0].display_name,
  };
}

module.exports = { refresh, validate, startOAuthFlow, pollOAuthToken, fetchChannelId };
