'use strict';

const bcrypt = require('bcryptjs');
const db     = require('../../db/knex');
const logger = require('../../lib/logger');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'missing_token' });
  }

  try {
    const users = await db('users').where({ active: true });
    for (const user of users) {
      if (await bcrypt.compare(token, user.api_token_hash)) {
        req.user = { id: user.id, username: user.username };
        return next();
      }
    }
  } catch (err) {
    logger.error('[auth] DB error during token validation', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }

  return res.status(401).json({ error: 'invalid_token' });
}

module.exports = requireAuth;
