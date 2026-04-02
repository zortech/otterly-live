'use strict';

const crypto = require('crypto');
const db = require('../../db/knex');
const StreamService = require('../../models/stream-service');
const { TokenRefreshError } = require('../token-refresh-error');
const logger = require('../../lib/logger');

const KICK_AUTH_URL = 'https://id.kick.com/oauth/authorize';
const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';
const KICK_CHANNEL_API = 'https://api.kick.com/public/v1/channels';
const KICK_STREAM_KEY_API = 'https://api.kick.com/public/v1/stream-key';

// Scopes needed: channel:read for chatroom ID lookup, streamkey:read to fetch the stream key
const PKCE_SCOPES = 'channel:read streamkey:read';

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
 * Start a PKCE authorization flow.
 * Returns { authUrl, codeVerifier, state } — store codeVerifier + state server-side
 * until the callback arrives.
 *
 * IMPORTANT: redirect_uri MUST use 'localhost' not '127.0.0.1' — Kick's auth server
 * (NextJS) rejects 127.0.0.1 redirect URIs.
 */
function startPkceFlow({ clientId, serverPort }) {
  const { verifier, challenge } = _generatePkce();
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `http://localhost:${serverPort}/auth/kick/callback`,
    scope: PKCE_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  const authUrl = `${KICK_AUTH_URL}?${params.toString()}`;
  return { authUrl, codeVerifier: verifier, state };
}

/**
 * Exchange the authorization code for tokens.
 * Returns { access_token, refresh_token, expires_in }.
 */
async function exchangeCode({ code, codeVerifier, clientId, serverPort }) {
  const res = await fetch(KICK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      redirect_uri: `http://localhost:${serverPort}/auth/kick/callback`,
    }).toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || `Token exchange failed (HTTP ${res.status})`);
  }
  return data; // { access_token, refresh_token, expires_in, token_type, ... }
}

/**
 * Refresh the Kick access token using the stored refresh token.
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

  const res = await fetch(KICK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    const requiresReauth = data.error === 'invalid_grant';
    throw new TokenRefreshError(data.message || data.error || 'Token refresh failed', { requiresReauth });
  }

  await StreamService.setCredential(svc.id, 'api_access_token', data.access_token);
  if (data.refresh_token) {
    // Kick may or may not rotate the refresh token
    await StreamService.setCredential(svc.id, 'api_refresh_token', data.refresh_token);
  }
  await db('stream_services').where({ id: svc.id }).update({
    api_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    needs_reauth: false,
    updated_at: new Date().toISOString(),
  });

  logger.info(`[kick-token] refreshed access token for service ${svc.id}`);
}

/**
 * Fetch the Kick channel info (chatroom ID + slug) using the official API.
 * Falls back to the unofficial API if the official one fails.
 * Returns { chatroomId, slug } or null on failure.
 */
async function fetchChannelInfo(accessToken, username) {
  const slug = encodeURIComponent(username);

  // Try official API (requires channel:read scope)
  try {
    const res = await fetch(`${KICK_CHANNEL_API}?slug=${slug}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      const channel = data?.data?.[0];
      if (channel?.chatroom?.id) {
        return { chatroomId: channel.chatroom.id, slug: channel.slug || username };
      }
    }
  } catch (err) {
    logger.warn(`[kick-token] official channel API failed: ${err.message}`);
  }

  // Fallback: unofficial endpoint (no auth, but subject to breakage)
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${slug}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.chatroom?.id) {
        return { chatroomId: data.chatroom.id, slug: data.slug || username };
      }
    }
  } catch (err) {
    logger.warn(`[kick-token] fallback channel API failed: ${err.message}`);
  }

  return null;
}

/**
 * Fetch the Kick stream key (requires streamkey:read scope).
 * Returns the stream key string or null on failure.
 */
async function fetchStreamKey(accessToken) {
  try {
    const res = await fetch(KICK_STREAM_KEY_API, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      // Response shape: { data: { stream_key: "..." } } or { stream_key: "..." }
      return data?.data?.stream_key || data?.stream_key || null;
    }
  } catch (err) {
    logger.warn(`[kick-token] stream key fetch failed: ${err.message}`);
  }
  return null;
}

module.exports = { startPkceFlow, exchangeCode, refresh, fetchChannelInfo, fetchStreamKey };
