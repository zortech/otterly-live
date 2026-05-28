const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const db = require('../db/knex');
const logger = require('../lib/logger');
const eventBus = require('../events/event-bus');
const { generateId } = require('../lib/id');

const router = express.Router();

const VALID_PLATFORMS = new Set([
  'twitch', 'youtube', 'kick', 'tiktok', 'x', 'joystick',
  'rumble', 'facebook', 'bilibili',
]);

const VALID_EVENT_TYPES = new Set([
  'subscribe', 'subscribe.gift', 'cheer', 'tip', 'redeem',
]);

const VALID_POSITIONS = new Set(['center', 'top', 'bottom', 'left', 'right']);

function serialize(row) {
  return {
    id: row.id,
    label: row.label,
    platform: row.platform,
    eventType: row.event_type,
    triggerKey: row.trigger_key,
    minAmount: row.min_amount,
    animationPath: row.animation_path,
    durationMs: row.duration_ms,
    soundPath: row.sound_path,
    position: row.position,
    enabled: Boolean(row.enabled),
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'Invalid body';
  if (!body.label || typeof body.label !== 'string' || !body.label.trim()) return 'label is required';
  if (!VALID_PLATFORMS.has(body.platform)) return 'Invalid platform';
  if (!VALID_EVENT_TYPES.has(body.eventType)) return 'Invalid eventType';
  if (!body.animationPath || typeof body.animationPath !== 'string') return 'animationPath is required';
  if (body.position && !VALID_POSITIONS.has(body.position)) return 'Invalid position';
  if (body.durationMs != null && (typeof body.durationMs !== 'number' || body.durationMs < 100 || body.durationMs > 60000)) {
    return 'durationMs must be 100..60000';
  }
  return null;
}

router.get('/', async (_req, res) => {
  try {
    const rows = await db('gift_animations').orderBy([{ column: 'priority', order: 'desc' }, { column: 'id', order: 'asc' }]);
    res.json(rows.map(serialize));
  } catch (err) {
    logger.error('GET /api/gift-animations error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await db('gift_animations').where({ id: req.params.id }).first();
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(serialize(row));
  } catch (err) {
    logger.error('GET /api/gift-animations/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const error = validate(req.body);
    if (error) return res.status(422).json({ error });

    const now = new Date().toISOString();
    const [id] = await db('gift_animations').insert({
      label: req.body.label.trim(),
      platform: req.body.platform,
      event_type: req.body.eventType,
      trigger_key: req.body.triggerKey ?? null,
      min_amount: req.body.minAmount ?? null,
      animation_path: req.body.animationPath,
      duration_ms: req.body.durationMs ?? 4000,
      sound_path: req.body.soundPath ?? null,
      position: req.body.position ?? 'center',
      enabled: req.body.enabled !== false,
      priority: req.body.priority ?? 0,
      created_at: now,
      updated_at: now,
    });
    const row = await db('gift_animations').where({ id }).first();
    res.status(201).json(serialize(row));
  } catch (err) {
    logger.error('POST /api/gift-animations error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await db('gift_animations').where({ id: req.params.id }).first();
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const error = validate({ ...serialize(existing), ...req.body });
    if (error) return res.status(422).json({ error });

    const update = {
      label: req.body.label?.trim() ?? existing.label,
      platform: req.body.platform ?? existing.platform,
      event_type: req.body.eventType ?? existing.event_type,
      trigger_key: req.body.triggerKey === undefined ? existing.trigger_key : req.body.triggerKey,
      min_amount: req.body.minAmount === undefined ? existing.min_amount : req.body.minAmount,
      animation_path: req.body.animationPath ?? existing.animation_path,
      duration_ms: req.body.durationMs ?? existing.duration_ms,
      sound_path: req.body.soundPath === undefined ? existing.sound_path : req.body.soundPath,
      position: req.body.position ?? existing.position,
      enabled: req.body.enabled === undefined ? existing.enabled : (req.body.enabled ? 1 : 0),
      priority: req.body.priority ?? existing.priority,
      updated_at: new Date().toISOString(),
    };
    await db('gift_animations').where({ id: req.params.id }).update(update);
    const row = await db('gift_animations').where({ id: req.params.id }).first();
    res.json(serialize(row));
  } catch (err) {
    logger.error('PUT /api/gift-animations/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const n = await db('gift_animations').where({ id: req.params.id }).del();
    if (n === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    logger.error('DELETE /api/gift-animations/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/gift-animations/test — fire a synthetic event on the bus so the
// overlay receives it just like a real one. Body: { platform, eventType, triggerKey?, amount? }
router.post('/test', async (req, res) => {
  try {
    const { platform, eventType } = req.body ?? {};
    if (!VALID_PLATFORMS.has(platform) || !VALID_EVENT_TYPES.has(eventType)) {
      return res.status(422).json({ error: 'platform and eventType required' });
    }

    const actor = {
      platformId: 'test-user',
      username: req.body.username ?? 'TestViewer',
      displayName: req.body.username ?? 'TestViewer',
    };

    const data = {};
    if (eventType === 'tip' && platform === 'tiktok') {
      data.giftName = req.body.giftName ?? 'Test Gift';
      data.giftId = req.body.triggerKey ?? null;
      data.amount = req.body.amount ?? 1;
      data.repeatCount = req.body.repeatCount ?? 1;
    } else if (eventType === 'cheer') {
      data.bits = req.body.amount ?? 100;
      data.message = req.body.message ?? '';
    } else if (eventType === 'tip') {
      data.amount = req.body.amount ?? 5;
      data.currency = 'USD';
      data.message = req.body.message ?? '';
    } else if (eventType === 'subscribe') {
      data.tier = req.body.triggerKey ?? '1000';
    } else if (eventType === 'subscribe.gift') {
      data.count = req.body.amount ?? 1;
      data.tier = req.body.triggerKey ?? '1000';
    } else if (eventType === 'redeem') {
      data.rewardId = req.body.triggerKey ?? 'test-reward';
      data.rewardTitle = req.body.giftName ?? 'Test Reward';
      data.rewardCost = req.body.amount ?? 100;
    }

    eventBus.emit('event', {
      id: generateId(),
      sessionId: null,
      platform,
      type: eventType,
      timestamp: new Date().toISOString(),
      actor,
      data,
      test: true,
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /api/gift-animations/test error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/gift-animations/tiktok-gifts — list all cached TikTok gift definitions
router.get('/tiktok-gifts', (_req, res) => {
  const giftCache = require('../event-capture/tiktok-gift-cache');
  res.json({ count: giftCache.size(), gifts: giftCache.all() });
});

// GET /api/gift-animations/tiktok-gifts/:id — single gift lookup (used by overlay fallback)
router.get('/tiktok-gifts/:id', (req, res) => {
  const giftCache = require('../event-capture/tiktok-gift-cache');
  const gift = giftCache.get(req.params.id);
  if (!gift) return res.status(404).json({ error: 'Not found' });
  res.json(gift);
});

// GET /api/gift-animations/assets/list — list user-uploaded animation files
router.get('/assets/list', async (_req, res) => {
  try {
    const dir = getAssetsDir();
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => /\.(json|lottie|gif|webp|png|jpg|jpeg|mp4|webm)$/i.test(n));
    res.json({ files });
  } catch (err) {
    logger.error('GET /api/gift-animations/assets/list error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function getAssetsDir() {
  // electron.app.getPath('userData') when running under Electron, fallback to ./data
  try {
    const { app } = require('electron');
    if (app?.getPath) return path.join(app.getPath('userData'), 'overlay-assets');
  } catch {}
  return path.join(process.cwd(), 'data', 'overlay-assets');
}

// Serve uploaded animation assets so the overlay can fetch them
router.use('/assets/files', express.static(getAssetsDir(), {
  index: false,
  fallthrough: false,
}));

module.exports = router;
