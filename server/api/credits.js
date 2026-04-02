const express = require('express');
const db = require('../db/knex');
const settings = require('../settings');
const logger = require('../lib/logger');
const eventBus = require('../events/event-bus');
const creditEngine = require('../credits/credit-engine');
const { generateId } = require('../lib/id');

const router = express.Router();

const CREDIT_SETTING_KEYS = [
  'credits.enabled',
  'credits.nameSingular',
  'credits.perChatMinute',
  'credits.perLikeMinute',
  'credits.giftMultiplier',
  'credits.transactionRetentionDays',
  'credits.apiKey',
];

const CREDIT_DEFAULTS = {
  'credits.enabled': true,
  'credits.nameSingular': 'credit',
  'credits.perChatMinute': 10,
  'credits.perLikeMinute': 5,
  'credits.giftMultiplier': 2.0,
  'credits.transactionRetentionDays': 180,
  'credits.apiKey': '',
};

// ─── Middleware ────────────────────────────────────────────────────────────────

async function requireApiKey(req, res, next) {
  const apiKey = await settings.get('credits.apiKey');
  if (!apiKey) return next(); // no key configured → open access
  if (req.headers['x-ottery-key'] !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', async (_req, res) => {
  try {
    const result = {};
    for (const key of CREDIT_SETTING_KEYS) {
      const val = await settings.get(key);
      result[key.replace('credits.', '')] = val ?? CREDIT_DEFAULTS[key];
    }
    res.json(result);
  } catch (err) {
    logger.error('GET /api/credits/settings error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const allowed = {
      enabled: 'boolean',
      nameSingular: 'string',
      perChatMinute: 'number',
      perLikeMinute: 'number',
      giftMultiplier: 'number',
      transactionRetentionDays: 'number',
      apiKey: 'string',
    };
    for (const [field, type] of Object.entries(allowed)) {
      if (req.body[field] !== undefined) {
        if (typeof req.body[field] !== type) {
          return res.status(400).json({ error: `${field} must be a ${type}` });
        }
        await settings.set(`credits.${field}`, req.body[field]);
      }
    }
    await creditEngine.refreshSettings();
    res.json({ ok: true });
  } catch (err) {
    logger.error('PUT /api/credits/settings error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Viewer list ───────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page  ?? '1',  10));
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '50', 10)));
    const sort     = ['credits', 'last_seen_at', 'username', 'display_name'].includes(req.query.sort)
      ? req.query.sort : 'credits';
    const order    = req.query.order === 'asc' ? 'asc' : 'desc';
    const search   = req.query.search?.trim() ?? '';
    const platform = req.query.platform ?? '';

    let query = db('viewer_credits').select('*');

    if (search) {
      query = query.where(function () {
        this.where('username', 'like', `%${search}%`)
          .orWhere('display_name', 'like', `%${search}%`);
      });
    }
    if (platform) {
      query = query.where('platform', platform);
    }

    const [{ count }] = await query.clone().count('id as count');
    const viewers = await query.orderBy(sort, order).limit(limit).offset((page - 1) * limit);

    res.json({ viewers, total: Number(count), page, limit });
  } catch (err) {
    logger.error('GET /api/credits error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Balance check (for overlays, no auth required) ───────────────────────────

router.get('/balance', async (req, res) => {
  try {
    const { platform, platformUserId } = req.query;
    if (!platform || !platformUserId) {
      return res.status(400).json({ error: 'platform and platformUserId required' });
    }
    const viewer = await db('viewer_credits')
      .where({ platform, platform_user_id: platformUserId })
      .first('id', 'credits', 'username', 'display_name');
    if (!viewer) return res.json({ credits: 0, found: false });
    res.json({ credits: viewer.credits, found: true, viewerId: viewer.id });
  } catch (err) {
    logger.error('GET /api/credits/balance error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Spend (for overlays, requires API key if set) ────────────────────────────

router.post('/spend', requireApiKey, async (req, res) => {
  try {
    const { platform, platformUserId, amount, reason } = req.body;
    if (!platform || !platformUserId || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'platform, platformUserId, and positive amount required' });
    }
    const spendAmount = Math.floor(amount);

    const viewer = await db('viewer_credits')
      .where({ platform, platform_user_id: platformUserId })
      .first();

    if (!viewer) {
      return res.status(404).json({ error: 'Viewer not found', balance: 0 });
    }
    if (viewer.credits < spendAmount) {
      return res.status(422).json({ error: 'insufficient_credits', balance: viewer.credits });
    }

    const newCredits = viewer.credits - spendAmount;
    const now = new Date().toISOString();

    await db.transaction(async (trx) => {
      await trx('viewer_credits').where({ id: viewer.id }).update({
        credits: newCredits,
        updated_at: now,
      });
      await trx('credit_transactions').insert({
        viewer_id: viewer.id,
        delta: -spendAmount,
        reason: 'spend',
        note: reason ?? null,
        created_at: now,
      });
    });

    eventBus.emit('credits.updated', {
      viewerId: viewer.id,
      platform: viewer.platform,
      platformUserId: viewer.platform_user_id,
      username: viewer.username,
      displayName: viewer.display_name,
      credits: newCredits,
    });

    eventBus.emit('event', {
      id:        generateId(),
      sessionId: null,
      platform:  'otterly',
      type:      'otterly.redeem',
      timestamp: new Date().toISOString(),
      actor: {
        platformId:   viewer.platform_user_id,
        username:     viewer.username,
        displayName:  viewer.display_name,
        avatarUrl:    viewer.avatar_url ?? undefined,
      },
      data: {
        item:           reason ?? 'Unknown',
        cost:           spendAmount,
        newBalance:     newCredits,
        sourcePlatform: viewer.platform,
      },
    });

    res.json({ ok: true, newBalance: newCredits });
  } catch (err) {
    logger.error('POST /api/credits/spend error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Single viewer ─────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const viewer = await db('viewer_credits').where({ id: req.params.id }).first();
    if (!viewer) return res.status(404).json({ error: 'Not found' });
    res.json(viewer);
  } catch (err) {
    logger.error('GET /api/credits/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: set credits (absolute) ────────────────────────────────────────────

router.put('/:id', requireApiKey, async (req, res) => {
  try {
    const viewerId = parseInt(req.params.id, 10);
    const { credits, note } = req.body;
    if (typeof credits !== 'number' || !Number.isInteger(credits) || credits < 0) {
      return res.status(400).json({ error: 'credits must be a non-negative integer' });
    }

    const viewer = await db('viewer_credits').where({ id: viewerId }).first();
    if (!viewer) return res.status(404).json({ error: 'Viewer not found' });

    const delta = credits - viewer.credits;
    const now = new Date().toISOString();

    await db.transaction(async (trx) => {
      await trx('viewer_credits').where({ id: viewerId }).update({ credits, updated_at: now });
      await trx('credit_transactions').insert({
        viewer_id: viewerId, delta, reason: 'admin_set', note: note ?? null, created_at: now,
      });
    });

    eventBus.emit('credits.updated', {
      viewerId,
      platform: viewer.platform,
      platformUserId: viewer.platform_user_id,
      username: viewer.username,
      displayName: viewer.display_name,
      credits,
    });

    res.json({ ok: true, credits });
  } catch (err) {
    logger.error('PUT /api/credits/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Admin: adjust credits (relative) ────────────────────────────────────────

router.post('/:id/adjust', requireApiKey, async (req, res) => {
  try {
    const viewerId = parseInt(req.params.id, 10);
    const { delta, note } = req.body;
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ error: 'delta must be a non-zero integer' });
    }

    const viewer = await db('viewer_credits').where({ id: viewerId }).first();
    if (!viewer) return res.status(404).json({ error: 'Viewer not found' });

    const newCredits = Math.max(0, viewer.credits + delta);
    const actualDelta = newCredits - viewer.credits;
    const now = new Date().toISOString();

    await db.transaction(async (trx) => {
      await trx('viewer_credits').where({ id: viewerId }).update({ credits: newCredits, updated_at: now });
      await trx('credit_transactions').insert({
        viewer_id: viewerId, delta: actualDelta, reason: 'manual', note: note ?? null, created_at: now,
      });
    });

    eventBus.emit('credits.updated', {
      viewerId,
      platform: viewer.platform,
      platformUserId: viewer.platform_user_id,
      username: viewer.username,
      displayName: viewer.display_name,
      credits: newCredits,
    });

    res.json({ ok: true, credits: newCredits });
  } catch (err) {
    logger.error('POST /api/credits/:id/adjust error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Transaction history for a viewer ────────────────────────────────────────

router.get('/:id/history', async (req, res) => {
  try {
    const viewerId = parseInt(req.params.id, 10);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10)));
    const page  = Math.max(1, parseInt(req.query.page ?? '1', 10));

    const [{ count }] = await db('credit_transactions').where({ viewer_id: viewerId }).count('id as count');
    const rows = await db('credit_transactions')
      .where({ viewer_id: viewerId })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit);

    res.json({ transactions: rows, total: Number(count), page, limit });
  } catch (err) {
    logger.error('GET /api/credits/:id/history error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
