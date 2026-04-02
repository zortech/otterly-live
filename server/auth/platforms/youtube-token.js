'use strict';

const crypto = require('crypto');
const db = require('../../db/knex');
const StreamService = require('../../models/stream-service');
const { TokenRefreshError } = require('../token-refresh-error');
const logger = require('../../lib/logger');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_CHANNELS_API = 'https://www.googleapis.com/youtube/v3/channels';

// youtube.readonly is the minimum scope needed for event capture.
// Note: this is a sensitive scope — Google requires consent screen verification
// before users outside the 100-user test allowance can authorize.
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

/**
 * Generate a PKCE code_verifier and code_challenge pair.
 * Uses SHA-256 per RFC 7636.
 */
function _generatePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Start a PKCE authorization flow for Google / YouTube.
 * Returns { authUrl, codeVerifier, state }.
 *
 * IMPORTANT: Both `access_type=offline` and `prompt=consent` are required:
 *   - access_type=offline → ensures a refresh_token is issued
 *   - prompt=consent → forces re-consent so a refresh_token is returned on
 *     subsequent authorizations (Google omits it after the first grant otherwise)
 *
 * redirect_uri must exactly match what is registered in Google Cloud Console
 * as an authorized redirect URI for the OAuth client (type: Desktop App).
 * Format: http://localhost:{serverPort}/auth/youtube/callback
 */
function startPkceFlow({ clientId, serverPort }) {
  const { verifier, challenge } = _generatePkce();
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `http://localhost:${serverPort}/auth/youtube/callback`,
    scope: OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  return { authUrl, codeVerifier: verifier, state };
}

/**
 * Exchange an authorization code for tokens.
 * Unlike Kick, Google requires the client_secret even for PKCE / installed apps.
 * Returns { access_token, refresh_token, expires_in, token_type, scope }.
 */
async function exchangeCode({ code, codeVerifier, clientId, clientSecret, serverPort }) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `http://localhost:${serverPort}/auth/youtube/callback`,
    }).toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token exchange failed (HTTP ${res.status})`);
  }
  return data; // { access_token, refresh_token, expires_in, token_type, scope }
}

/**
 * Refresh the YouTube access token using the stored refresh token.
 *
 * CRITICAL: Google does NOT return a new refresh_token on refresh (unlike Twitch/Kick).
 * Only update api_access_token and api_token_expires_at — leave api_refresh_token untouched.
 *
 * Throws TokenRefreshError with requiresReauth=true on invalid_grant (user revoked access).
 */
async function refresh(svc) {
  const refreshToken = svc.api_refresh_token;
  if (!refreshToken) {
    throw new TokenRefreshError('No refresh token stored — user must re-authorize', { requiresReauth: true });
  }

  const clientId = svc.api_client_id;
  const clientSecret = svc.api_client_secret;
  if (!clientId || !clientSecret) {
    throw new TokenRefreshError('Client ID or Secret not configured', { requiresReauth: true });
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
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
    throw new TokenRefreshError(
      data.error_description || data.error || 'Token refresh failed',
      { requiresReauth }
    );
  }

  // Only update access token — Google does NOT return a new refresh_token
  await StreamService.setCredential(svc.id, 'api_access_token', data.access_token);
  await db('stream_services').where({ id: svc.id }).update({
    api_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    needs_reauth: false,
    updated_at: new Date().toISOString(),
  });

  logger.info(`[youtube-token] refreshed access token for service ${svc.id}`);
}

/**
 * Fetch the authenticated user's YouTube channel ID and title.
 * Called after OAuth to auto-populate metadata.channel_id and username.
 * Returns { channelId, title } or null on failure.
 */
async function fetchChannelId(accessToken) {
  try {
    const res = await fetch(`${YOUTUBE_CHANNELS_API}?part=id,snippet&mine=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      const channel = data?.items?.[0];
      if (channel?.id) {
        return {
          channelId: channel.id,
          title: channel.snippet?.title ?? null,
        };
      }
    }
    logger.warn(`[youtube-token] fetchChannelId returned HTTP ${res.status}`);
  } catch (err) {
    logger.warn(`[youtube-token] fetchChannelId failed: ${err.message}`);
  }
  return null;
}

module.exports = { startPkceFlow, exchangeCode, refresh, fetchChannelId };
