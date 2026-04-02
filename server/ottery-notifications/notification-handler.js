/**
 * OtteryLive Notification Handler
 *
 * Handles internal OtteryLive notifications triggered by chat commands:
 *   !credits  → otterly.credit_count  (viewer balance lookup)
 *   !playing  → otterly.playing       (Spotify now-playing stub — TBD)
 *
 * otterly.redeem events are emitted by the credits spend API, not here.
 */

'use strict';

const db       = require('../db/knex');
const eventBus = require('../events/event-bus');
const logger   = require('../lib/logger');
const { generateId } = require('../lib/id');

let activeSessionId = null;
let eventHandler    = null;

function buildEvent(type, actor, data) {
  return {
    id:        generateId(),
    sessionId: activeSessionId,
    platform:  'otterly',
    type,
    timestamp: new Date().toISOString(),
    actor:     actor ?? null,
    data:      data ?? {},
  };
}

async function handleChatMessage(e) {
  const { actor, platform, data } = e;
  if (!actor) return;

  const message = String(data.message ?? '').trim().toLowerCase();

  // !credits — respond with the viewer's current balance
  if (message === '!credits') {
    try {
      const viewer = await db('viewer_credits')
        .where({ platform, platform_user_id: actor.platformId })
        .first('id', 'credits');

      eventBus.emit('event', buildEvent('otterly.credit_count', actor, {
        credits:        viewer?.credits ?? 0,
        sourcePlatform: platform,
      }));
    } catch (err) {
      logger.error('[ottery-notifications] !credits lookup failed', err);
    }
    return;
  }

  // !playing — Spotify now-playing stub
  // TODO: integrate Spotify Web API (GET /v1/me/player/currently-playing)
  //       emit otterly.playing with { title, artist, albumArt }
  //       requires credentials stored in settings: spotify.accessToken, spotify.refreshToken
}

function start() {
  eventBus.on('session.started', ({ sessionId } = {}) => {
    activeSessionId = sessionId ?? null;
  });
  eventBus.on('session.ended', () => {
    activeSessionId = null;
  });

  eventHandler = (e) => {
    if (e.type === 'chat.message') {
      handleChatMessage(e).catch(() => {});
    }
  };
  eventBus.on('event', eventHandler);

  logger.info('[ottery-notifications] notification handler started');
}

function stop() {
  if (eventHandler) {
    eventBus.off('event', eventHandler);
    eventHandler = null;
  }
  logger.info('[ottery-notifications] notification handler stopped');
}

module.exports = { start, stop };
