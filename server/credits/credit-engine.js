/**
 * Credit Engine
 *
 * Listens to the unified event bus for chat and gift events, awards credits
 * to viewers, and persists them via a 5-second batch flush to SQLite.
 *
 * Rate limiting (chat): one credit award per viewer per minute, tracked in-memory.
 * Batch queue: accumulates pending awards and flushes in a single transaction.
 * Cleanup: removes credit_transactions older than credits.transactionRetentionDays on startup.
 */

const db = require('../db/knex');
const settings = require('../settings');
const logger = require('../lib/logger');
const eventBus = require('../events/event-bus');

// In-memory rate limit maps: "platform:platformUserId" → epochMinute of last credit award
const chatCreditTracker = new Map();
const likeCreditTracker = new Map();

// Batch queue: "platform:platformUserId" → { platform, platformUserId, username, displayName,
//   avatarUrl, deltaCredits, lastSeenAt, transactions[] }
const batchQueue = new Map();

let flushTimer = null;
let cleanupTimer = null;
let chatTrackerTimer = null;
let settingsRefreshTimer = null;
let eventHandler = null;

// Local settings cache — refreshed on start and when refreshSettings() is called
let cachedSettings = {
  enabled: true,
  perChatMinute: 10,
  perLikeMinute: 5,
  giftMultiplier: 2.0,
  transactionRetentionDays: 90,
};

function epochMinute() {
  return Math.floor(Date.now() / 60000);
}

function queueKey(platform, platformUserId) {
  return `${platform}:${platformUserId}`;
}

/**
 * Queue a credit activity for a viewer. Updates last_seen_at always;
 * records a transaction only when deltaCredits > 0.
 */
function queueActivity(actor, platform, deltaCredits, reason, eventId = null, note = null) {
  const key = queueKey(platform, actor.platformId);
  const now = new Date().toISOString();

  if (!batchQueue.has(key)) {
    batchQueue.set(key, {
      platform,
      platformUserId: actor.platformId,
      username: actor.username,
      displayName: actor.displayName,
      avatarUrl: actor.avatarUrl ?? null,
      deltaCredits: 0,
      lastSeenAt: now,
      transactions: [],
    });
  }

  const entry = batchQueue.get(key);
  // Always refresh profile info and last seen
  entry.username = actor.username;
  entry.displayName = actor.displayName;
  if (actor.avatarUrl) entry.avatarUrl = actor.avatarUrl;
  entry.lastSeenAt = now;

  if (deltaCredits > 0) {
    entry.deltaCredits += deltaCredits;
    entry.transactions.push({ delta: deltaCredits, reason, eventId, note });
  }
}

function handleEvent(e) {
  if (!cachedSettings.enabled || !e.actor) return;

  const { platform, actor, type, data, id: eventId } = e;
  const { perChatMinute, perLikeMinute, giftMultiplier } = cachedSettings;

  if (type === 'chat.message') {
    const key = queueKey(platform, actor.platformId);
    const minute = epochMinute();

    if (chatCreditTracker.get(key) === minute) {
      // Rate limited — still update last_seen via a zero-delta queue entry
      queueActivity(actor, platform, 0, 'chat');
      return;
    }
    chatCreditTracker.set(key, minute);
    queueActivity(actor, platform, Math.max(1, perChatMinute), 'chat', eventId);
    return;
  }

  if (type === 'like') {
    const key = queueKey(platform, actor.platformId);
    const minute = epochMinute();

    if (likeCreditTracker.get(key) === minute) {
      queueActivity(actor, platform, 0, 'like');
      return;
    }
    likeCreditTracker.set(key, minute);
    queueActivity(actor, platform, Math.max(1, perLikeMinute), 'like', eventId);
    return;
  }

  // Gift-type events
  let credits = 0;
  let note = null;

  if (type === 'subscribe.gift') {
    const count = Math.max(1, parseInt(data.count ?? 1, 10));
    credits = Math.max(1, Math.round(count * giftMultiplier));
    note = `${count} gift sub${count !== 1 ? 's' : ''} on ${platform}`;
  } else if (type === 'subscribe') {
    credits = Math.max(1, Math.round(giftMultiplier));
    note = `subscribed on ${platform}`;
  } else if (type === 'cheer') {
    const bits = parseInt(data.bits ?? 0, 10);
    if (bits > 0) {
      credits = Math.max(1, Math.round((bits / 100) * giftMultiplier));
      note = `${bits} bits on ${platform}`;
    }
  } else if (type === 'tip') {
    const amount = parseFloat(data.amount ?? 0);
    if (amount > 0) {
      credits = Math.max(1, Math.round(amount * giftMultiplier));
      note = `${data.giftName ?? 'tip'} (${amount}) on ${platform}`;
    }
  }

  if (credits > 0) {
    queueActivity(actor, platform, credits, 'gift', eventId, note);
  }
}

async function flush() {
  if (batchQueue.size === 0) return;

  const entries = [...batchQueue.values()];
  batchQueue.clear();

  const now = new Date().toISOString();
  const updates = [];

  try {
    await db.transaction(async (trx) => {
      for (const entry of entries) {
        const mergeFields = {
          username: entry.username,
          display_name: entry.displayName,
          credits: db.raw('credits + ?', [entry.deltaCredits]),
          last_seen_at: entry.lastSeenAt,
          updated_at: now,
        };
        if (entry.avatarUrl != null) mergeFields.avatar_url = entry.avatarUrl;

        await trx('viewer_credits')
          .insert({
            platform: entry.platform,
            platform_user_id: entry.platformUserId,
            username: entry.username,
            display_name: entry.displayName,
            avatar_url: entry.avatarUrl,
            credits: entry.deltaCredits,
            last_seen_at: entry.lastSeenAt,
            created_at: now,
            updated_at: now,
          })
          .onConflict(['platform', 'platform_user_id'])
          .merge(mergeFields);

        if (entry.transactions.length > 0) {
          const viewer = await trx('viewer_credits')
            .where({ platform: entry.platform, platform_user_id: entry.platformUserId })
            .first('id', 'credits');

          if (viewer) {
            await trx('credit_transactions').insert(
              entry.transactions.map((t) => ({
                viewer_id: viewer.id,
                delta: t.delta,
                reason: t.reason,
                reference_event_id: t.eventId ?? null,
                note: t.note ?? null,
                created_at: now,
              }))
            );
            updates.push({
              viewerId: viewer.id,
              platform: entry.platform,
              platformUserId: entry.platformUserId,
              username: entry.username,
              displayName: entry.displayName,
              credits: viewer.credits,
            });
          }
        }
      }
    });

    for (const u of updates) {
      eventBus.emit('credits.updated', u);
    }
  } catch (err) {
    logger.error('[credits] flush failed', err);
  }
}

async function runCleanup() {
  const retentionDays = cachedSettings.transactionRetentionDays;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const deleted = await db('credit_transactions').where('created_at', '<', cutoff).delete();
    if (deleted > 0) {
      logger.info(`[credits] cleaned up ${deleted} old credit transactions (retention: ${retentionDays} days)`);
    }
  } catch (err) {
    logger.error('[credits] cleanup failed', err);
  }
}

async function refreshSettings() {
  cachedSettings = {
    enabled:                  (await settings.get('credits.enabled'))                  ?? true,
    perChatMinute:            (await settings.get('credits.perChatMinute'))            ?? 10,
    perLikeMinute:            (await settings.get('credits.perLikeMinute'))            ?? 5,
    giftMultiplier:           (await settings.get('credits.giftMultiplier'))           ?? 2.0,
    transactionRetentionDays: (await settings.get('credits.transactionRetentionDays')) ?? 90,
  };
}

// Periodically evict stale entries from the rate limit trackers
function startChatTrackerCleanup() {
  return setInterval(() => {
    const currentMinute = epochMinute();
    for (const [key, minute] of chatCreditTracker) {
      if (minute < currentMinute) chatCreditTracker.delete(key);
    }
    for (const [key, minute] of likeCreditTracker) {
      if (minute < currentMinute) likeCreditTracker.delete(key);
    }
  }, 60 * 1000);
}

async function start() {
  await refreshSettings();
  await runCleanup();

  flushTimer = setInterval(() => flush().catch(() => {}), 5 * 1000);
  // Re-run cleanup daily
  cleanupTimer = setInterval(() => runCleanup().catch(() => {}), 24 * 60 * 60 * 1000);
  chatTrackerTimer = startChatTrackerCleanup();

  // Refresh settings cache every 30 seconds in case the user changed them in the UI
  settingsRefreshTimer = setInterval(() => refreshSettings().catch(() => {}), 30 * 1000);

  eventHandler = (e) => handleEvent(e);
  eventBus.on('event', eventHandler);

  logger.info('[credits] credit engine started');
}

async function stop() {
  if (eventHandler) {
    eventBus.off('event', eventHandler);
    eventHandler = null;
  }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
  if (chatTrackerTimer) { clearInterval(chatTrackerTimer); chatTrackerTimer = null; }
  if (settingsRefreshTimer) { clearInterval(settingsRefreshTimer); settingsRefreshTimer = null; }
  await flush().catch(() => {});
  logger.info('[credits] credit engine stopped');
}

module.exports = { start, stop, refreshSettings };
