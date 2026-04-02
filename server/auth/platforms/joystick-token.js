'use strict';

const crypto = require('crypto');
const db = require('../../db/knex');
const StreamService = require('../../models/stream-service');
const { TokenRefreshError } = require('../token-refresh-error');
const logger = require('../../lib/logger');

const JOYSTICK_AUTH_URL = 'https://joystick.tv/api/oauth/authorize';
const JOYSTICK_TOKEN_URL = 'https://joystick.tv/api/oauth/token';

/**
 * Start a standard OAuth2 authorization code flow.
 * Joystick uses a confidential client (requires client_secret) — NOT PKCE.
 * Redirect URI must use 127.0.0.1 (not localhost) per Joystick docs.
 *
 * Returns { authUrl, state }.
 */
function startAuthFlow({ clientId, serverPort }) {
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `http://127.0.0.1:${serverPort}/auth/joystick/callback`,
    state,
  });

  const authUrl = `${JOYSTICK_AUTH_URL}?${params.toString()}`;
  return { authUrl, state };
}

/**
 * Exchange the authorization code for tokens.
 * Returns { access_token, refresh_token, expires_in, ... }.
 */
async function exchangeCode({ code, clientId, clientSecret, serverPort }) {
  const res = await fetch(JOYSTICK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `http://127.0.0.1:${serverPort}/auth/joystick/callback`,
    }).toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || `Token exchange failed (HTTP ${res.status})`);
  }
  return data; // { access_token, refresh_token, expires_in, token_type, ... }
}

/**
 * Refresh the Joystick access token using the stored refresh token.
 * Writes updated credentials and expiry back to keychain/DB.
 * Throws TokenRefreshError with requiresReauth=true on invalid_grant.
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

  const clientSecret = svc.api_client_secret;
  if (!clientSecret) {
    throw new TokenRefreshError('No client secret configured', { requiresReauth: true });
  }

  const res = await fetch(JOYSTICK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    const requiresReauth = data.error === 'invalid_grant';
    throw new TokenRefreshError(data.message || data.error || 'Token refresh failed', { requiresReauth });
  }

  await StreamService.setCredential(svc.id, 'api_access_token', data.access_token);
  if (data.refresh_token) {
    // Some providers rotate the refresh token on use
    await StreamService.setCredential(svc.id, 'api_refresh_token', data.refresh_token);
  } else {
    logger.debug(`[joystick-token] refresh response did not include new refresh_token for service ${svc.id} — keeping existing`);
  }

  await db('stream_services').where({ id: svc.id }).update({
    api_token_expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    needs_reauth: false,
    updated_at: new Date().toISOString(),
  });

  logger.info(`[joystick-token] refreshed access token for service ${svc.id}`);
}

module.exports = { startAuthFlow, exchangeCode, refresh };
