'use strict';

/**
 * SQLite-backed song request queue.
 *
 * Songs are stored with status 'queued' until music-manager pushes them to
 * Spotify. Status lifecycle: queued → playing → played (or removed at any point).
 * Position determines play order; gaps are acceptable — ORDER BY position ASC.
 */

const db = require('../db/knex');
const logger = require('../lib/logger');

const STATUS = { QUEUED: 'queued', PLAYING: 'playing', PLAYED: 'played', REMOVED: 'removed' };

function now() {
  return new Date().toISOString();
}

/**
 * Get all queued (not yet played/removed) items ordered by position.
 */
async function getQueue() {
  return db('song_queue')
    .whereIn('status', [STATUS.QUEUED, STATUS.PLAYING])
    .orderBy('position', 'asc');
}

/**
 * Get the currently playing item, if any.
 */
async function getPlaying() {
  return db('song_queue').where({ status: STATUS.PLAYING }).first();
}

/**
 * Get the next queued item (lowest position with status 'queued').
 */
async function getNext() {
  return db('song_queue').where({ status: STATUS.QUEUED }).orderBy('position', 'asc').first();
}

/**
 * Add a song to the queue. Returns the new queue item.
 */
async function add({ trackId, trackName, artistName, albumName, albumArtUrl, durationMs,
  requesterPlatform, requesterPlatformUserId, requesterUsername, requesterDisplayName,
  source = 'request', creditsCost = 0, twitchRedemptionId = null, twitchRewardId = null,
  sessionId = null }) {

  const maxPos = await db('song_queue')
    .whereIn('status', [STATUS.QUEUED, STATUS.PLAYING])
    .max('position as m')
    .first();

  const position = (maxPos?.m ?? 0) + 1;
  const ts = now();

  const [id] = await db('song_queue').insert({
    spotify_track_id: trackId,
    track_name: trackName,
    artist_name: artistName,
    album_name: albumName ?? null,
    album_art_url: albumArtUrl ?? null,
    duration_ms: durationMs ?? null,
    requester_platform: requesterPlatform ?? null,
    requester_platform_user_id: requesterPlatformUserId ?? null,
    requester_username: requesterUsername ?? null,
    requester_display_name: requesterDisplayName ?? null,
    source,
    position,
    status: STATUS.QUEUED,
    twitch_redemption_id: twitchRedemptionId,
    twitch_reward_id: twitchRewardId,
    credits_spent: creditsCost,
    session_id: sessionId,
    created_at: ts,
    updated_at: ts,
  });

  logger.debug(`[song-queue] added "${trackName}" by ${artistName} (id=${id})`);
  return db('song_queue').where({ id }).first();
}

/**
 * Remove a queue item by id. Returns the removed item (for refund handling).
 */
async function remove(id) {
  const item = await db('song_queue').where({ id }).first();
  if (!item) return null;
  if (item.status === STATUS.PLAYING || item.status === STATUS.PLAYED) return null; // too late

  await db('song_queue').where({ id }).update({ status: STATUS.REMOVED, updated_at: now() });
  logger.debug(`[song-queue] removed item id=${id} "${item.track_name}"`);
  return item;
}

/**
 * Remove the last 'queued' item added by a specific viewer. Returns the item or null.
 */
async function removeLastByUser(platform, platformUserId) {
  const item = await db('song_queue')
    .where({ requester_platform: platform, requester_platform_user_id: platformUserId, status: STATUS.QUEUED })
    .orderBy('created_at', 'desc')
    .first();

  if (!item) return null;
  await db('song_queue').where({ id: item.id }).update({ status: STATUS.REMOVED, updated_at: now() });
  logger.debug(`[song-queue] viewer ${platform}:${platformUserId} removed their last request "${item.track_name}"`);
  return item;
}

/**
 * Count queued items for a specific viewer (for per-viewer queue limits).
 */
async function countByUser(platform, platformUserId) {
  const result = await db('song_queue')
    .where({ requester_platform: platform, requester_platform_user_id: platformUserId, status: STATUS.QUEUED })
    .count('id as c')
    .first();
  return result?.c ?? 0;
}

/**
 * Check for duplicate tracks based on the configured mode:
 *   'off'          – never block
 *   'playing_only' – block only if the track is currently playing
 *   'session'      – block if playing or queued within the current session (default)
 *   'queue'        – block if playing or anywhere in the queue (all sessions)
 */
async function isDuplicate(spotifyTrackId, mode = 'session', sessionId = null) {
  if (mode === 'off') return false;

  if (mode === 'playing_only') {
    const item = await db('song_queue')
      .where({ spotify_track_id: spotifyTrackId, status: STATUS.PLAYING })
      .first();
    return !!item;
  }

  // 'session' and 'queue' both check PLAYING + QUEUED; 'session' adds a session filter
  const query = db('song_queue')
    .where({ spotify_track_id: spotifyTrackId })
    .whereIn('status', [STATUS.QUEUED, STATUS.PLAYING]);

  if (mode === 'session' && sessionId) {
    query.where({ session_id: sessionId });
  }

  const item = await query.first();
  return !!item;
}

/**
 * Mark an item as currently playing.
 */
async function markPlaying(id) {
  await db('song_queue').where({ id }).update({ status: STATUS.PLAYING, updated_at: now() });
}

/**
 * Revert a 'playing' item back to 'queued' so it can be re-pushed to Spotify.
 * Used when Spotify didn't honour the addToQueue call (playlist resumed instead).
 */
async function revertToQueued(id) {
  await db('song_queue').where({ id, status: STATUS.PLAYING }).update({ status: STATUS.QUEUED, updated_at: now() });
}

/**
 * Mark an item as played (finished).
 */
async function markPlayed(id) {
  await db('song_queue').where({ id }).update({ status: STATUS.PLAYED, updated_at: now() });
}

/**
 * Move an item up or down in the queue.
 * direction: 'up' | 'down'
 */
async function bump(id, direction) {
  const item = await db('song_queue').where({ id, status: STATUS.QUEUED }).first();
  if (!item) return false;

  const queue = await db('song_queue').where({ status: STATUS.QUEUED }).orderBy('position', 'asc');
  const idx = queue.findIndex((i) => i.id === id);
  if (idx === -1) return false;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= queue.length) return false;

  const swapItem = queue[swapIdx];
  const ts = now();
  await db.transaction(async (trx) => {
    await trx('song_queue').where({ id: item.id }).update({ position: swapItem.position, updated_at: ts });
    await trx('song_queue').where({ id: swapItem.id }).update({ position: item.position, updated_at: ts });
  });
  return true;
}

/**
 * Revert all 'playing' items back to 'queued'.
 * Called on startup to recover items left stuck by a previous server instance.
 */
async function revertAllPlaying() {
  const count = await db('song_queue')
    .where({ status: STATUS.PLAYING })
    .update({ status: STATUS.QUEUED, updated_at: now() });
  if (count > 0) logger.debug(`[song-queue] reverted ${count} stuck 'playing' item(s) to 'queued'`);
}

/**
 * Get the last N played items, most recent first.
 */
async function getRecentlyPlayed(limit = 5) {
  return db('song_queue')
    .where({ status: STATUS.PLAYED })
    .orderBy('updated_at', 'desc')
    .limit(limit);
}

/**
 * Clear all queued (not playing/played) items.
 */
async function clearQueued() {
  await db('song_queue').where({ status: STATUS.QUEUED }).update({ status: STATUS.REMOVED, updated_at: now() });
}

module.exports = { getQueue, getPlaying, getNext, add, remove, removeLastByUser,
  countByUser, isDuplicate, markPlaying, markPlayed, revertToQueued, revertAllPlaying, bump, clearQueued, getRecentlyPlayed, STATUS };
