'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const logger = require('../lib/logger');

// GET /api/stream-sessions — list all sessions with event counts
router.get('/', async (req, res) => {
  try {
    const sessions = await db('stream_sessions')
      .orderBy('started_at', 'desc')
      .select('id', 'started_at', 'ended_at', 'duration_seconds', 'stats');

    const counts = await db('stream_events')
      .groupBy('session_id')
      .select('session_id')
      .count('id as total_events');

    const countMap = {};
    for (const r of counts) countMap[r.session_id] = Number(r.total_events);

    res.json(
      sessions.map((s) => ({
        id: s.id,
        started_at: s.started_at,
        ended_at: s.ended_at,
        duration_seconds: s.duration_seconds,
        stats: s.stats ? JSON.parse(s.stats) : null,
        state: s.ended_at ? 'ended' : 'live',
        total_events: countMap[s.id] ?? 0,
      }))
    );
  } catch (err) {
    logger.error('GET /api/stream-sessions error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stream-sessions/events — paginated event query
// Query params: page, limit, sessionId, platform (csv), type (csv), from (ISO), to (ISO/date), search, sort (asc|desc)
router.get('/events', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const sort = req.query.sort === 'asc' ? 'asc' : 'desc';

    const sessionId = req.query.sessionId ? parseInt(req.query.sessionId, 10) : null;
    const platforms = req.query.platform ? req.query.platform.split(',').filter(Boolean) : [];
    const types = req.query.type ? req.query.type.split(',').filter(Boolean) : [];
    const from = req.query.from || null;
    const to = req.query.to || null;
    const search = req.query.search ? req.query.search.trim() : null;

    let query = db('stream_events').orderBy('occurred_at', sort);

    if (sessionId) query = query.where('session_id', sessionId);
    if (platforms.length) query = query.whereIn('platform', platforms);
    if (types.length) query = query.whereIn('event_type', types);
    if (from) query = query.where('occurred_at', '>=', from);
    if (to) {
      // If 'to' is a date only (YYYY-MM-DD), include the full day
      const toEnd = to.length === 10 ? `${to}T23:59:59.999Z` : to;
      query = query.where('occurred_at', '<=', toEnd);
    }
    if (search) query = query.where('actor_json', 'like', `%${search}%`);

    const countResult = await query.clone().count('id as count').first();
    const total = Number(countResult.count);

    const rows = await query
      .select('id', 'session_id', 'platform', 'event_type', 'actor_json', 'data_json', 'occurred_at')
      .offset((page - 1) * limit)
      .limit(limit);

    const events = rows.map((r) => ({
      id: String(r.id),
      sessionId: r.session_id,
      platform: r.platform,
      type: r.event_type,
      timestamp: r.occurred_at,
      actor: r.actor_json ? JSON.parse(r.actor_json) : null,
      data: r.data_json ? JSON.parse(r.data_json) : {},
    }));

    res.json({ events, total, page, limit });
  } catch (err) {
    logger.error('GET /api/stream-sessions/events error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
