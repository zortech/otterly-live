'use strict';

/**
 * Spotify Web API client using Authorization Code + PKCE flow.
 *
 * Tokens are stored in the OS keychain via keytar under service 'ottery-live',
 * account 'spotify_tokens' (JSON: { accessToken, refreshToken, expiresAt }).
 *
 * The streamer provides their own Spotify Client ID (BYOC). No client secret
 * is needed for PKCE.
 */

const crypto = require('crypto');
const https = require('https');
const keytar = require('keytar');
const settings = require('../settings');
const logger = require('../lib/logger');

const KEYTAR_SERVICE = 'ottery-live';
const KEYTAR_ACCOUNT = 'spotify_tokens';
const _PORT = parseInt(process.env.OTTERY_SERVER_PORT, 10) || 3737;
const REDIRECT_URI = `http://127.0.0.1:${_PORT}/auth/spotify/callback`;
const SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

// In-memory PKCE state — lives only during the auth flow
let _pendingCodeVerifier = null;
let _pendingState = null;

// Cached token in memory to avoid keytar round-trips on every API call
let _cachedTokens = null; // { accessToken, refreshToken, expiresAt }

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── Token persistence ────────────────────────────────────────────────────────

async function saveTokens(tokens) {
  _cachedTokens = tokens;
  await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(tokens));
}

async function loadTokens() {
  if (_cachedTokens) return _cachedTokens;
  try {
    const raw = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    if (!raw) return null;
    _cachedTokens = JSON.parse(raw);
    return _cachedTokens;
  } catch {
    return null;
  }
}

async function clearTokens() {
  _cachedTokens = null;
  await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

const HTTPS_TIMEOUT_MS = 10000;

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.setTimeout(HTTPS_TIMEOUT_MS, () => req.destroy(new Error('Spotify API request timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url, accessToken) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode === 204) return resolve({ status: 204, body: null });
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.setTimeout(HTTPS_TIMEOUT_MS, () => req.destroy(new Error('Spotify API request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function httpsMethod(method, url, accessToken, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode === 204) return resolve({ status: 204, body: null });
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.setTimeout(HTTPS_TIMEOUT_MS, () => req.destroy(new Error('Spotify API request timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Auth flow ────────────────────────────────────────────────────────────────

/**
 * Build the Spotify authorization URL and store PKCE state.
 * Returns the URL to open in the system browser.
 */
async function buildAuthUrl() {
  const clientId = await settings.get('music.spotifyClientId');
  if (!clientId) throw new Error('No Spotify Client ID configured');

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  _pendingCodeVerifier = verifier;
  _pendingState = state;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  return `https://accounts.spotify.com/authorize?${params}`;
}

/**
 * Handle the OAuth callback. Call with the full callback URL.
 * Returns the Spotify user profile on success.
 */
async function handleCallback(callbackUrl) {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) throw new Error(`Spotify auth denied: ${error}`);
  if (!code) throw new Error('No authorization code in callback');
  if (!_pendingState || state !== _pendingState) throw new Error('OAuth state mismatch');

  const clientId = await settings.get('music.spotifyClientId');
  const verifier = _pendingCodeVerifier;

  _pendingCodeVerifier = null;
  _pendingState = null;

  const result = await httpsPost('https://accounts.spotify.com/api/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });

  if (result.status !== 200) {
    throw new Error(`Token exchange failed (${result.status}): ${JSON.stringify(result.body)}`);
  }

  const { access_token, refresh_token, expires_in } = result.body;
  await saveTokens({
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: Date.now() + expires_in * 1000,
  });

  logger.info('[spotify] OAuth flow completed successfully');
  return getProfile();
}

/**
 * Refresh the access token using the stored refresh token.
 */
async function refreshAccessToken() {
  const tokens = await loadTokens();
  if (!tokens?.refreshToken) throw new Error('No Spotify refresh token — re-auth required');

  const clientId = await settings.get('music.spotifyClientId');

  const result = await httpsPost('https://accounts.spotify.com/api/token', {
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });

  if (result.status !== 200) {
    await clearTokens();
    throw new Error(`Spotify token refresh failed (${result.status})`);
  }

  const { access_token, refresh_token, expires_in } = result.body;
  await saveTokens({
    accessToken: access_token,
    refreshToken: refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + expires_in * 1000,
  });

  logger.debug('[spotify] access token refreshed');
  return access_token;
}

/**
 * Return a valid access token, refreshing if within 60s of expiry.
 */
async function getAccessToken() {
  let tokens = await loadTokens();
  if (!tokens) throw new Error('Not connected to Spotify');

  if (Date.now() >= tokens.expiresAt - 60 * 1000) {
    tokens = { ...tokens, accessToken: await refreshAccessToken() };
  }
  return tokens.accessToken;
}

async function disconnect() {
  await clearTokens();
  logger.info('[spotify] disconnected');
}

async function isConnected() {
  const tokens = await loadTokens();
  return !!tokens?.refreshToken;
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function getProfile() {
  const token = await getAccessToken();
  const res = await httpsGet('https://api.spotify.com/v1/me', token);
  if (res.status !== 200) throw new Error(`Failed to get Spotify profile (${res.status})`);
  return res.body;
}

async function getCurrentlyPlaying() {
  const token = await getAccessToken();
  const res = await httpsGet('https://api.spotify.com/v1/me/player', token);
  if (res.status === 204 || !res.body) return null;
  if (res.status === 401) {
    await refreshAccessToken();
    return getCurrentlyPlaying();
  }
  if (res.status !== 200) return null;
  return res.body;
}

async function search(query) {
  const token = await getAccessToken();
  const params = new URLSearchParams({ q: query, type: 'track', limit: '5' });
  const res = await httpsGet(`https://api.spotify.com/v1/search?${params}`, token);
  if (res.status !== 200) throw new Error(`Spotify search failed (${res.status})`);
  return res.body.tracks?.items ?? [];
}

// Spotify player control endpoints return 204 by spec but some client/device
// combinations return 200 with an empty or small body — accept both.
function isPlayerSuccess(status) {
  return status === 200 || status === 204;
}

async function addToQueue(trackUri) {
  const token = await getAccessToken();
  const params = new URLSearchParams({ uri: trackUri });
  const res = await httpsMethod('POST', `https://api.spotify.com/v1/me/player/queue?${params}`, token);
  if (!isPlayerSuccess(res.status)) throw new Error(`Failed to add to Spotify queue (${res.status})`);
}

async function skipToNext() {
  const token = await getAccessToken();
  const res = await httpsMethod('POST', 'https://api.spotify.com/v1/me/player/next', token);
  if (!isPlayerSuccess(res.status)) throw new Error(`Failed to skip track (${res.status})`);
}

async function pausePlayback() {
  const token = await getAccessToken();
  const res = await httpsMethod('PUT', 'https://api.spotify.com/v1/me/player/pause', token);
  if (!isPlayerSuccess(res.status)) throw new Error(`Failed to pause (${res.status})`);
}

async function resumePlayback() {
  const token = await getAccessToken();
  const res = await httpsMethod('PUT', 'https://api.spotify.com/v1/me/player/play', token);
  if (!isPlayerSuccess(res.status)) throw new Error(`Failed to resume (${res.status})`);
}

async function startPlaylist(playlistUri) {
  const token = await getAccessToken();
  const res = await httpsMethod('PUT', 'https://api.spotify.com/v1/me/player/play', token, {
    context_uri: playlistUri,
  });
  if (!isPlayerSuccess(res.status)) throw new Error(`Failed to start playlist (${res.status})`);
}

async function getPlaylists(limit = 50) {
  const token = await getAccessToken();
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await httpsGet(`https://api.spotify.com/v1/me/playlists?${params}`, token);
  if (res.status !== 200) throw new Error(`Failed to get playlists (${res.status})`);
  return res.body.items ?? [];
}

async function getPlaylistTracks(playlistId, limit = 100) {
  const token = await getAccessToken();
  const params = new URLSearchParams({ limit: String(limit), fields: 'items(track(id,name,artists,album,duration_ms,uri))' });
  const res = await httpsGet(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?${params}`, token);
  if (res.status !== 200) throw new Error(`Failed to get playlist tracks (${res.status})`);
  return (res.body.items ?? []).map((i) => i.track).filter(Boolean);
}

module.exports = {
  buildAuthUrl,
  handleCallback,
  refreshAccessToken,
  getAccessToken,
  disconnect,
  isConnected,
  getProfile,
  getCurrentlyPlaying,
  search,
  addToQueue,
  skipToNext,
  pausePlayback,
  resumePlayback,
  startPlaylist,
  getPlaylists,
  getPlaylistTracks,
};
