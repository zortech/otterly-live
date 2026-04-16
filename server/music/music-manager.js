'use strict';

/**
 * Music Manager
 *
 * Orchestrates Spotify integration:
 *   - Listens to unified event bus for chat commands (!play, !song, !queue, !skip, !remove, !undo)
 *   - Manages the internal song request queue via song-queue.js
 *   - Polls Spotify every N seconds to detect track changes and advance the queue
 *   - Handles playback modes: requests_only, fallback, interleave
 *   - Emits music.* events to the event bus for dashboard + StreamTap
 */

const db = require('../db/knex');
const settings = require('../settings');
const logger = require('../lib/logger');
const eventBus = require('../events/event-bus');
const { generateId } = require('../lib/id');
const spotify = require('./spotify-client');
const queue = require('./song-queue');

let pollTimer = null;
let settingsRefreshTimer = null;
let cleanupTimer = null;
let eventHandler = null;
let lastTrackId = null;            // Spotify track ID of last known playing song
let playingQueueId = null;         // Internal queue item ID currently pushed to Spotify
let playingQueueSpotifyId = null;  // Spotify track ID of the item we pushed (to confirm it actually plays)
let playingQueueRequester = null;  // { username, displayName, platform } or null — who requested it
let _advancingQueue = false;       // Re-entrancy guard for advanceQueue()
let activeSessionId = null;        // Current stream session ID (for queue scoping)
const queueCommandLastUsed = new Map(); // platform:userId → timestamp, for !queue cooldown

// Local settings cache
let cfg = {
  enabled: false,
  playbackMode: 'fallback',         // 'requests_only' | 'fallback' | 'interleave'
  streamPlaylistId: '',
  streamPlaylistShuffle: true,
  interleaveRatio: 3,
  srEnabled: true,
  srCreditCost: 50,
  srMaxQueuePerViewer: 3,
  srBlockExplicit: true,
  srCommandReply: true,
  srShowRejectionInChat: false,
  queueCommandEnabled: true,
  queueCommandLimit: 5,
  queueCommandCooldownMs: 30000,
  pollIntervalMs: 5000,
  songQueueRetentionDays: 180,
};

// Interleave counter: tracks how many requests have played since last playlist song
let interleaveCounter = 0;

// ─── Queue cleanup ────────────────────────────────────────────────────────────

async function runQueueCleanup() {
  const retentionDays = cfg.songQueueRetentionDays;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const deleted = await db('song_queue')
      .whereIn('status', [queue.STATUS.PLAYED, queue.STATUS.REMOVED])
      .where('updated_at', '<', cutoff)
      .delete();
    if (deleted > 0) {
      logger.info(`[music] cleaned up ${deleted} old song queue entries (retention: ${retentionDays} days)`);
    }
  } catch (err) {
    logger.error('[music] queue cleanup failed', err);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function refreshSettings() {
  cfg = {
    enabled:               (await settings.get('music.enabled'))               ?? false,
    playbackMode:          (await settings.get('music.playbackMode'))          ?? 'fallback',
    streamPlaylistId:      (await settings.get('music.streamPlaylistId'))      ?? '',
    streamPlaylistShuffle: (await settings.get('music.streamPlaylistShuffle')) ?? true,
    interleaveRatio:       (await settings.get('music.interleaveRatio'))       ?? 3,
    srEnabled:             (await settings.get('music.srEnabled'))             ?? true,
    srCreditCost:          (await settings.get('music.srCreditCost'))          ?? 50,
    srMaxQueuePerViewer:   (await settings.get('music.srMaxQueuePerViewer'))   ?? 3,
    srDuplicateMode:       (await settings.get('music.srDuplicateMode'))       ?? 'queue',
    srBlockExplicit:       (await settings.get('music.srBlockExplicit'))       ?? true,
    srCommandReply:        (await settings.get('music.srCommandReply'))        ?? true,
    srShowRejectionInChat: (await settings.get('music.srShowRejectionInChat')) ?? false,
    queueCommandEnabled:   (await settings.get('music.queueCommandEnabled'))   ?? true,
    queueCommandLimit:     (await settings.get('music.queueCommandLimit'))     ?? 5,
    queueCommandCooldownMs: (await settings.get('music.queueCommandCooldownMs')) ?? 30000,
    pollIntervalMs:           (await settings.get('music.pollIntervalMs'))           ?? 5000,
    songQueueRetentionDays:   (await settings.get('music.songQueueRetentionDays'))   ?? 180,
  };
}

// ─── Permission checks ────────────────────────────────────────────────────────

async function isSpotifyAdmin(platform, platformUserId) {
  const row = await db('spotify_admins')
    .where({ platform, platform_user_id: platformUserId })
    .first();
  return !!row;
}

function canModerate(actor) {
  return actor?.isMod || actor?.isBroadcaster;
}

async function canAdminMusic(actor) {
  if (!actor) return false;
  if (actor.isBroadcaster) return true;
  if (await isSpotifyAdmin(actor.platform, actor.platformId)) return true;
  return false;
}

// ─── Chat reply helper ────────────────────────────────────────────────────────

function chatReply(platform, message) {
  eventBus.emit('chat.reply', { platform, message });
}

// ─── SR event emitter ─────────────────────────────────────────────────────────

/**
 * Emit a music song-request activity event to the unified event bus.
 * These appear in the dashboard event log and are persisted to stream_events.
 *
 * @param {'music.sr_added'|'music.sr_rejected'} type
 * @param {string} platform
 * @param {object|null} actor
 * @param {object} data
 */
function emitSrEvent(type, platform, actor, data) {
  eventBus.emit('event', {
    id:        generateId(),
    sessionId: activeSessionId,
    platform,
    type,
    timestamp: new Date().toISOString(),
    actor:     actor ?? null,
    data,
  });
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleSongRequest(e) {
  if (!cfg.srEnabled) {
    logger.warn('[music] !play blocked — song requests disabled (music.srEnabled=false)');
    return;
  }
  const rawArgs = e.data?.args?.trim();
  const query = parseSearchQuery(rawArgs);
  logger.debug(`[music] !play rawArgs="${rawArgs}" → query="${query}"`);
  if (!query) {
    if (cfg.srCommandReply) chatReply(e.platform, '🎵 Usage: !play <song>, !play "title" "artist", or !play title by artist');
    return;
  }

  const { actor, platform } = e;

  // Credit check
  if (cfg.srCreditCost > 0) {
    const viewer = await db('viewer_credits')
      .where({ platform, platform_user_id: actor.platformId })
      .first();
    const balance = viewer?.credits ?? 0;
    if (!viewer || balance < cfg.srCreditCost) {
      logger.info(`[music] !play rejected for ${actor.username}@${platform} — insufficient credits (balance=${balance}, cost=${cfg.srCreditCost})`);
      emitSrEvent('music.sr_rejected', platform, actor, {
        query, reason: 'no_credits', creditBalance: balance, creditCost: cfg.srCreditCost,
      });
      if (cfg.srShowRejectionInChat) chatReply(platform, `@${actor.displayName} You need ${cfg.srCreditCost} credits to request a song (you have ${balance}).`);
      return;
    }
  }

  // Per-viewer queue limit
  const inQueue = await queue.countByUser(platform, actor.platformId);
  if (inQueue >= cfg.srMaxQueuePerViewer) {
    logger.info(`[music] !play rejected for ${actor.username}@${platform} — queue limit (${inQueue}/${cfg.srMaxQueuePerViewer})`);
    emitSrEvent('music.sr_rejected', platform, actor, {
      query, reason: 'queue_limit', inQueue, maxQueue: cfg.srMaxQueuePerViewer,
    });
    if (cfg.srShowRejectionInChat) chatReply(platform, `@${actor.displayName} You already have ${inQueue} songs in the queue (max ${cfg.srMaxQueuePerViewer}).`);
    return;
  }

  logger.info(`[music] searching Spotify: query="${query}" | user=${actor.username}@${platform}`);
  let tracks;
  try {
    tracks = await spotify.search(query);
  } catch (err) {
    logger.error('[music] Spotify search error', err);
    if (cfg.srCommandReply) chatReply(platform, `@${actor.displayName} Search failed — try again.`);
    return;
  }

  // Log all results returned, not just the count
  logger.info(`[music] Spotify returned ${tracks.length} result(s) for query="${query}"`);
  if (tracks.length) {
    tracks.forEach((t, i) => {
      const artists = t.artists?.map((a) => a.name).join(', ') ?? 'Unknown';
      logger.debug(`[music]   [${i}] "${t.name}" by ${artists} (id=${t.id}, explicit=${t.explicit}, duration=${t.duration_ms}ms)`);
    });
  }

  if (!tracks.length) {
    logger.info(`[music] !play rejected for ${actor.username}@${platform} — no results for query="${query}"`);
    emitSrEvent('music.sr_rejected', platform, actor, { query, reason: 'not_found' });
    if (cfg.srCommandReply) chatReply(platform, `@${actor.displayName} No results found for "${rawArgs}"`);
    return;
  }

  const track = tracks[0];
  const artistName = track.artists?.map((a) => a.name).join(', ') ?? 'Unknown';
  logger.info(`[music] top result: "${track.name}" by ${artistName} (id=${track.id}, explicit=${track.explicit}, duration=${track.duration_ms}ms)`);

  // Explicit content check
  if (cfg.srBlockExplicit && track.explicit) {
    logger.info(`[music] !play rejected for ${actor.username}@${platform} — explicit track "${track.name}" by ${artistName}`);
    emitSrEvent('music.sr_rejected', platform, actor, {
      query, reason: 'explicit', trackName: track.name, artistName,
    });
    if (cfg.srShowRejectionInChat) chatReply(platform, `@${actor.displayName} "${track.name}" is marked explicit and cannot be requested on this stream.`);
    return;
  }

  // Dupe check — behaviour controlled by music.srDuplicateMode setting
  if (cfg.srDuplicateMode !== 'off' && await queue.isDuplicate(track.id, cfg.srDuplicateMode, activeSessionId)) {
    logger.info(`[music] !play rejected for ${actor.username}@${platform} — duplicate "${track.name}" (mode=${cfg.srDuplicateMode})`);
    emitSrEvent('music.sr_rejected', platform, actor, {
      query, reason: 'duplicate', trackName: track.name, artistName, duplicateMode: cfg.srDuplicateMode,
    });
    if (cfg.srShowRejectionInChat) chatReply(platform, `@${actor.displayName} "${track.name}" is already in the queue.`);
    return;
  }

  // Deduct credits
  if (cfg.srCreditCost > 0) {
    const ts = new Date().toISOString();
    await db('viewer_credits')
      .where({ platform, platform_user_id: actor.platformId })
      .update({ credits: db.raw('credits - ?', [cfg.srCreditCost]), updated_at: ts });
    await db('credit_transactions').insert({
      viewer_id: (await db('viewer_credits').where({ platform, platform_user_id: actor.platformId }).first('id'))?.id,
      delta: -cfg.srCreditCost,
      reason: 'song_request',
      note: `!play "${track.name}"`,
      created_at: ts,
    });
  }

  const item = await queue.add({
    trackId: track.id,
    trackName: track.name,
    artistName,
    albumName: track.album?.name,
    albumArtUrl: track.album?.images?.[0]?.url,
    durationMs: track.duration_ms,
    requesterPlatform: platform,
    requesterPlatformUserId: actor.platformId,
    requesterUsername: actor.username,
    requesterDisplayName: actor.displayName,
    source: 'request',
    creditsCost: cfg.srCreditCost,
    sessionId: activeSessionId,
  });

  logger.info(`[music] queued: "${track.name}" by ${artistName} (queueId=${item.id}) — playingQueueId=${playingQueueId ?? 'none'}`);

  emitSrEvent('music.sr_added', platform, actor, {
    query, trackName: track.name, artistName,
    albumArtUrl: track.album?.images?.[0]?.url ?? null,
    trackId: track.id, durationMs: track.duration_ms,
    queueId: item.id, creditsCost: cfg.srCreditCost,
  });

  if (cfg.srCommandReply) {
    chatReply(platform, `@${actor.displayName} Added to queue: "${track.name}" by ${artistName}`);
  }

  eventBus.emit('music.request_added', { queueItem: item, requester: actor });
  emitQueueUpdate();
  onSongAdded().catch((err) => logger.error('[music] onSongAdded error', err));
}

async function handleRemove(e) {
  const { actor, platform } = e;
  const args = e.data?.args?.trim();

  // Mod/admin can remove by position number
  if (args && (canModerate(actor) || await canAdminMusic(actor))) {
    const pos = parseInt(args, 10);
    if (!isNaN(pos)) {
      const allQueued = await queue.getQueue();
      const item = allQueued[pos - 1]; // 1-indexed
      if (!item) {
        if (cfg.srCommandReply) chatReply(platform, `@${actor.displayName} No song at position ${pos}.`);
        return;
      }
      const removed = await queue.remove(item.id);
      if (removed) {
        await refundItem(removed);
        if (cfg.srCommandReply) chatReply(platform, `@${actor.displayName} Removed "${removed.track_name}" from the queue.`);
        eventBus.emit('music.request_rejected', { queueItem: removed, rejectedBy: actor });
        emitQueueUpdate();
      }
      return;
    }
  }

  // Viewer removes their own last request
  const removed = await queue.removeLastByUser(platform, actor.platformId);
  if (!removed) {
    if (cfg.srCommandReply) chatReply(platform, `@${actor.displayName} You have no songs in the queue to remove.`);
    return;
  }

  await refundItem(removed);
  if (cfg.srCommandReply) chatReply(platform, `@${actor.displayName} Removed "${removed.track_name}" from the queue.`);
  eventBus.emit('music.request_removed', { queueItem: removed });
  emitQueueUpdate();
}

async function handleNowPlaying(e) {
  const state = await spotify.getCurrentlyPlaying().catch(() => null);
  if (!state?.item) {
    chatReply(e.platform, '🎵 Nothing is playing right now.');
    return;
  }
  const artist = state.item.artists?.map((a) => a.name).join(', ') ?? 'Unknown';
  chatReply(e.platform, `🎵 Now playing: "${state.item.name}" by ${artist}`);
}

async function handleQueueCommand(e) {
  if (!cfg.queueCommandEnabled) return;

  const cooldownKey = `${e.platform}:${e.actor?.platformId}`;
  const now = Date.now();
  const lastUsed = queueCommandLastUsed.get(cooldownKey) ?? 0;
  if (now - lastUsed < cfg.queueCommandCooldownMs) return;
  queueCommandLastUsed.set(cooldownKey, now);

  const items = await queue.getQueue();
  if (!items.length) {
    chatReply(e.platform, '🎵 The queue is empty.');
    return;
  }
  const limit = cfg.queueCommandLimit;
  const preview = items.slice(0, limit).map((i, idx) => `${idx + 1}. "${i.track_name}" – ${i.artist_name}`).join(' | ');
  const more = items.length > limit ? ` (+${items.length - limit} more)` : '';
  chatReply(e.platform, `🎵 Queue: ${preview}${more}`);
}

async function handleSkip(e) {
  if (!await canAdminMusic(e.actor)) {
    if (cfg.srCommandReply) chatReply(e.platform, `@${e.actor.displayName} Only the streamer or music admins can skip.`);
    return;
  }
  await skipCurrent();
  if (cfg.srCommandReply) chatReply(e.platform, '⏭️ Skipped.');
}

// ─── Refund helper ────────────────────────────────────────────────────────────

async function refundItem(item) {
  if (!item) return;

  // Credit refund
  if (item.credits_spent > 0 && item.requester_platform && item.requester_platform_user_id) {
    const ts = new Date().toISOString();
    await db('viewer_credits')
      .where({ platform: item.requester_platform, platform_user_id: item.requester_platform_user_id })
      .update({ credits: db.raw('credits + ?', [item.credits_spent]), updated_at: ts })
      .catch(() => {});
  }

  // Twitch Channel Point refund
  if (item.twitch_redemption_id && item.twitch_reward_id) {
    eventBus.emit('twitch.refund_redemption', {
      redemptionId: item.twitch_redemption_id,
      rewardId: item.twitch_reward_id,
    });
  }
}

// ─── Playback / queue advancement ────────────────────────────────────────────

async function skipCurrent() {
  try {
    await spotify.skipToNext();
  } catch (err) {
    logger.warn('[music] skip failed', err);
  }
  // Advance internal queue immediately rather than waiting for next poll
  if (playingQueueId) {
    await queue.markPlayed(playingQueueId);
    playingQueueId = null;
    playingQueueSpotifyId = null;
    playingQueueRequester = null;
    emitQueueUpdate();
  }
  await advanceQueue();
}

/**
 * Push the next internal queue item to Spotify, or fall back to the stream playlist.
 */
async function advanceQueue() {
  if (_advancingQueue) {
    logger.debug('[music] advanceQueue: re-entrancy guard hit — already advancing');
    return;
  }
  _advancingQueue = true;
  try {
    const nextItem = await getNextItem();

    if (!nextItem) {
      // Nothing to push — Spotify's fallback playlist or silence handles it
      logger.debug(`[music] advanceQueue: queue empty — nothing to push (mode=${cfg.playbackMode})`);
      return;
    }

    logger.info(`[music] advanceQueue: pushing "${nextItem.track_name}" by ${nextItem.artist_name} (spotify_track_id=${nextItem.spotify_track_id}, queueId=${nextItem.id})`);
    await spotify.addToQueue(`spotify:track:${nextItem.spotify_track_id}`);
    await queue.markPlaying(nextItem.id);
    playingQueueId = nextItem.id;
    playingQueueSpotifyId = nextItem.spotify_track_id;
    playingQueueRequester = nextItem.requester_username
      ? { username: nextItem.requester_username, displayName: nextItem.requester_display_name, platform: nextItem.requester_platform }
      : null;
    logger.info(`[music] advanceQueue: successfully pushed to Spotify queue — playingQueueId=${playingQueueId}`);
    emitQueueUpdate();
  } catch (err) {
    logger.error('[music] advanceQueue: failed to push track to Spotify queue', err);
  } finally {
    _advancingQueue = false;
  }
}

/**
 * Determine the next item to push based on playback mode.
 */
async function getNextItem() {
  const nextRequest = await queue.getNext();

  if (cfg.playbackMode === 'requests_only') {
    return nextRequest ?? null;
  }

  if (cfg.playbackMode === 'fallback') {
    // Fallback: use requests if available, otherwise let Spotify's context handle it
    return nextRequest ?? null;
  }

  if (cfg.playbackMode === 'interleave') {
    // Interleave: after N requests, insert a playlist song
    if (nextRequest && interleaveCounter < cfg.interleaveRatio) {
      interleaveCounter++;
      return nextRequest;
    }
    // Time for a playlist song
    interleaveCounter = 0;
    return await getPlaylistSongAsQueueItem();
  }

  return nextRequest;
}

/**
 * Pull a song from the streamer's playlist and insert it as a 'playlist' source queue item.
 */
async function getPlaylistSongAsQueueItem() {
  if (!cfg.streamPlaylistId) return null;

  let tracks;
  try {
    tracks = await spotify.getPlaylistTracks(cfg.streamPlaylistId);
  } catch (err) {
    logger.warn('[music] failed to fetch playlist tracks for interleave', err);
    return null;
  }

  if (!tracks.length) return null;

  const track = cfg.streamPlaylistShuffle
    ? tracks[Math.floor(Math.random() * tracks.length)]
    : tracks[0]; // TODO: sequential playlist tracking

  return queue.add({
    trackId: track.id,
    trackName: track.name,
    artistName: track.artists?.map((a) => a.name).join(', ') ?? 'Unknown',
    albumName: track.album?.name,
    albumArtUrl: track.album?.images?.[0]?.url,
    durationMs: track.duration_ms,
    source: 'playlist',
    sessionId: activeSessionId,
  });
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function poll() {
  let state;
  try {
    state = await spotify.getCurrentlyPlaying();
  } catch (err) {
    logger.debug('[music] poll error', err);
    return;
  }

  const currentTrackId = state?.item?.id ?? null;
  const isPlaying = state?.is_playing ?? false;

  // Emit playback state for dashboard progress bar
  if (state?.item) {
    eventBus.emit('music.playback_state', {
      isPlaying,
      progressMs: state.progress_ms ?? 0,
      durationMs: state.item.duration_ms ?? 0,
    });
  }

  // Track changed
  if (currentTrackId && currentTrackId !== lastTrackId) {
    lastTrackId = currentTrackId;

    let requester = null;
    if (playingQueueId) {
      if (currentTrackId === playingQueueSpotifyId) {
        // Our queued song is now playing — capture requester before clearing state
        requester = playingQueueRequester;
        await queue.markPlayed(playingQueueId);
        playingQueueId = null;
        playingQueueSpotifyId = null;
        playingQueueRequester = null;
        emitQueueUpdate();
      } else {
        // Spotify played a different song (playlist resumed) — our pushed song hasn't played yet.
        // Re-queue it on Spotify so it plays next. Also revert its status so it can be re-pushed.
        await queue.revertToQueued(playingQueueId);
        playingQueueId = null;
        playingQueueSpotifyId = null;
        playingQueueRequester = null;
        emitQueueUpdate();
      }
    }

    const artist = state.item.artists?.map((a) => a.name).join(', ') ?? 'Unknown';
    eventBus.emit('music.track_changed', {
      trackId: currentTrackId,
      trackName: state.item.name,
      artistName: artist,
      albumArtUrl: state.item.album?.images?.[0]?.url,
      durationMs: state.item.duration_ms,
      source: 'spotify',
      requester,  // { username, displayName, platform } or null
    });

    // Advance our internal queue to match what's now playing, then pre-load the next
    if (cfg.enabled) await advanceQueue();
  }

  // Proactive push: if Spotify is playing, nothing is pending from our side, and
  // there are queued songs waiting — push now without waiting for the next track change.
  if (cfg.enabled && isPlaying && !playingQueueId) {
    await advanceQueue();
  }
}

// ─── Search query parser ──────────────────────────────────────────────────────

/*
 * Normalise a !play argument string into a Spotify search query.
 *
 * Supported formats:
 *   !play "title with spaces" "artist with spaces"
 *   !play title_with_underscores artist_with_underscores
 *   !play song title by artist name
 *   !play song title                    (plain search, passed through)
 */
function parseSearchQuery(args) {
  if (!args) return '';

  let q = args.replace(/_/g, ' ').trim();

  const quoted = [];
  const quotedRe = /"([^"]+)"/g;
  let m;
  while ((m = quotedRe.exec(q)) !== null) quoted.push(m[1]);

  if (quoted.length >= 2) return `track:"${quoted[0]}" artist:"${quoted[1]}"`;
  if (quoted.length === 1) return quoted[0];

  q = q.replace(/"/g, '').trim();

  const byMatch = q.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    const title = byMatch[1].trim();
    const artist = byMatch[2].trim();
    if (title && artist) return `track:"${title}" artist:"${artist}"`;
  }

  return q;
}

// ─── Event bus integration ────────────────────────────────────────────────────

function parseCommand(message) {
  const text = message?.trim() ?? '';
  const match = text.match(/^!(\w+)(?:\s+(.*))?$/);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2] ?? '' };
}

function handleChatEvent(e) {
  if (e.type !== 'chat.message') return;

  const parsed = parseCommand(e.data?.message);
  if (!parsed) return;

  // Log all music commands as soon as we see them, before any gate checks
  if (['play', 'remove', 'undo', 'revoke', 'song', 'queue', 'skip'].includes(parsed.command)) {
    logger.info(`[music] command received: !${parsed.command} | args="${parsed.args}" | platform=${e.platform} | user=${e.actor?.username ?? '?'} | cfg.enabled=${cfg.enabled} | cfg.srEnabled=${cfg.srEnabled}`);
  }

  if (!cfg.enabled) {
    if (['play', 'remove', 'undo', 'revoke', 'song', 'queue', 'skip'].includes(parsed.command)) {
      logger.warn(`[music] ignoring !${parsed.command} — music feature is disabled (music.enabled=false)`);
    }
    return;
  }

  const enriched = { ...e, data: { ...e.data, args: parsed.args } };

  switch (parsed.command) {
    case 'play':    handleSongRequest(enriched).catch((err) => logger.error('[music] !play error', err)); break;
    case 'remove':
    case 'undo':
    case 'revoke':  handleRemove(enriched).catch((err) => logger.error('[music] !remove error', err)); break;
    case 'song':    handleNowPlaying(enriched).catch((err) => logger.error('[music] !song error', err)); break;
    case 'queue':   handleQueueCommand(enriched).catch((err) => logger.error('[music] !queue error', err)); break;
    case 'skip':    handleSkip(enriched).catch((err) => logger.error('[music] !skip error', err)); break;
  }
}

// ─── Queue update emitter ─────────────────────────────────────────────────────

async function emitQueueUpdate() {
  try {
    const [q, history] = await Promise.all([queue.getQueue(), queue.getRecentlyPlayed(5)]);
    eventBus.emit('music.queue_updated', { queue: q, history });
  } catch (err) {
    logger.error('[music] failed to emit queue update', err);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

async function start() {
  await refreshSettings();

  if (!cfg.enabled) {
    logger.info('[music] disabled — skipping start');
    return;
  }

  const connected = await spotify.isConnected().catch(() => false);
  if (!connected) {
    logger.info('[music] Spotify not connected — waiting for OAuth');
    return;
  }

  // Revert any songs left in 'playing' state from a previous server instance
  await queue.revertAllPlaying().catch(() => {});

  // Prune old played/removed queue entries
  await runQueueCleanup().catch(() => {});

  // Start poll loop
  pollTimer = setInterval(() => poll().catch(() => {}), cfg.pollIntervalMs);
  // Refresh settings every 30s
  settingsRefreshTimer = setInterval(() => refreshSettings().catch(() => {}), 30 * 1000);
  // Re-run cleanup daily
  cleanupTimer = setInterval(() => runQueueCleanup().catch(() => {}), 24 * 60 * 60 * 1000);

  // Track active session for queue scoping
  eventBus.on('session.started', ({ sessionId } = {}) => {
    activeSessionId = sessionId ?? null;
    logger.info(`[music] session started — sessionId=${activeSessionId}`);
  });
  eventBus.on('session.ended', () => {
    logger.info(`[music] session ended — clearing sessionId (was ${activeSessionId})`);
    activeSessionId = null;
  });

  // Listen for chat commands
  eventHandler = (e) => handleChatEvent(e);
  eventBus.on('event', eventHandler);

  // Start fallback playlist if configured
  if ((cfg.playbackMode === 'fallback' || cfg.playbackMode === 'interleave') && cfg.streamPlaylistId) {
    spotify.startPlaylist(`spotify:playlist:${cfg.streamPlaylistId}`).catch((err) => {
      logger.warn('[music] failed to start stream playlist', err);
    });
  }

  logger.info('[music] music manager started');
}

async function stop() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (settingsRefreshTimer) { clearInterval(settingsRefreshTimer); settingsRefreshTimer = null; }
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
  if (eventHandler) { eventBus.off('event', eventHandler); eventHandler = null; }
  logger.info('[music] music manager stopped');
}

/**
 * Called after OAuth completes to start the manager without restarting the server.
 */
async function onSpotifyConnected() {
  await refreshSettings();
  // Revert any songs left stuck in 'playing' state
  await queue.revertAllPlaying().catch(() => {});
  eventBus.emit('music.connected', {});
  if (!pollTimer) {
    pollTimer = setInterval(() => poll().catch(() => {}), cfg.pollIntervalMs);
  }
  if (cfg.enabled && !eventHandler) {
    eventHandler = (e) => handleChatEvent(e);
    eventBus.on('event', eventHandler);
  }
  logger.info(`[music] Spotify connected — poll active, feature ${cfg.enabled ? 'enabled' : 'disabled'}`);
}

async function onSpotifyDisconnected() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (eventHandler) { eventBus.off('event', eventHandler); eventHandler = null; }
  lastTrackId = null;
  playingQueueId = null;
  playingQueueSpotifyId = null;
  playingQueueRequester = null;
  eventBus.emit('music.disconnected', {});
  logger.info('[music] Spotify disconnected');
}

/**
 * Called when a song is added to the queue (via API or !play command).
 * If nothing is currently pending in Spotify's queue from our side, push immediately
 * so the song plays after the current track rather than waiting for the next track change.
 */
async function onSongAdded() {
  if (!cfg.enabled) {
    logger.warn('[music] onSongAdded: skipping — music.enabled=false');
    return;
  }
  if (playingQueueId !== null) {
    logger.debug(`[music] onSongAdded: skipping advanceQueue — already pending queueId=${playingQueueId}`);
    return;
  }
  const connected = await spotify.isConnected().catch(() => false);
  if (!connected) {
    logger.warn('[music] onSongAdded: skipping advanceQueue — Spotify not connected');
    return;
  }
  logger.info('[music] onSongAdded: calling advanceQueue');
  await advanceQueue();
}

module.exports = { start, stop, onSpotifyConnected, onSpotifyDisconnected,
  skipCurrent, emitQueueUpdate, refundItem, onSongAdded };
