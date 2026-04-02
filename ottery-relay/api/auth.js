'use strict';

const { Router }  = require('express');
const crypto      = require('crypto');
const bcrypt      = require('bcryptjs');
const db          = require('../db/knex');
const requireAuth = require('./middleware/require-auth');
const logger      = require('../lib/logger');

const router = Router();
router.use(requireAuth);

// POST /api/auth/rotate-token
// Generates a new API token for the authenticated user. Old token stops working immediately.
// The new token is shown once in the response — copy it.
router.post('/rotate-token', async (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const hash  = await bcrypt.hash(token, 12);
    await db('users').where({ id: req.user.id }).update({ api_token_hash: hash });
    logger.info('[auth] token rotated', { username: req.user.username });
    res.json({ token });
  } catch (err) {
    logger.error('[auth] rotate-token error', err.message);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
