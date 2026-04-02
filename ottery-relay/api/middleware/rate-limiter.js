'use strict';

const rateLimit = require('express-rate-limit');

module.exports = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
