'use strict';

class TokenRefreshError extends Error {
  constructor(message, { requiresReauth = false } = {}) {
    super(message);
    this.name = 'TokenRefreshError';
    this.requiresReauth = requiresReauth;
  }
}

module.exports = { TokenRefreshError };
