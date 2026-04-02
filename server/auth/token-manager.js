'use strict';

const db = require('../db/knex');
const StreamService = require('../models/stream-service');
const eventBus = require('../events/event-bus');
const logger = require('../lib/logger');
const { TokenRefreshError } = require('./token-refresh-error');
const twitchToken = require('./platforms/twitch-token');

const MAX_TIMEOUT_MS = 2147483647; // Max safe setTimeout value (~24.8 days)

class TokenManager {
  constructor() {
    this.validationInterval = null;
    this.refreshTimers = new Map(); // serviceId → setTimeout handle
  }

  async start() {
    let services;
    try {
      services = await db('stream_services').where({ active: true });
    } catch (err) {
      logger.error('[token-manager] failed to load services on start', err);
      return;
    }

    // Schedule proactive refresh for each service
    for (const svc of services) {
      try {
        await this.scheduleRefresh(svc);
      } catch (err) {
        logger.error(`[token-manager] scheduleRefresh failed for service ${svc.id}`, err);
      }
    }

    // Emit auth.required for any service already flagged
    for (const svc of services) {
      if (svc.needs_reauth) {
        eventBus.emit('auth.required', { serviceId: svc.id, platform: svc.platform });
      }
    }

    // Start Twitch hourly validation (runs immediately on startup, then every hour)
    this.startHourlyValidation();

    logger.info('[token-manager] started');
  }

  async scheduleRefresh(svc) {
    // Cancel any existing timer for this service
    this.cancelRefresh(svc.id);

    if (!svc.api_token_expires_at) {
      // No expiry info — rely on reactive refresh (401 handling)
      return;
    }

    const expiresAt = new Date(svc.api_token_expires_at).getTime();
    const timeUntilExpiry = expiresAt - Date.now();
    // Refresh at 75% through the token lifetime, min 5 min buffer, max 24h buffer.
    // This handles short-lived tokens (e.g. Twitch DCF = 4h) without looping.
    const refreshBuffer = Math.min(24 * 60 * 60 * 1000, Math.max(5 * 60 * 1000, timeUntilExpiry * 0.25));
    const refreshAt = expiresAt - refreshBuffer;
    const delay = refreshAt - Date.now();

    if (delay <= 0) {
      // Already past the refresh window — refresh immediately
      try {
        await this.refreshNow(svc.id);
      } catch (err) {
        // Error already handled in refreshNow (sets needs_reauth, emits auth.required)
      }
      return;
    }

    const timer = setTimeout(() => this.refreshNow(svc.id).catch(() => {}), Math.min(delay, MAX_TIMEOUT_MS));
    this.refreshTimers.set(svc.id, timer);
    logger.debug(`[token-manager] scheduled refresh for service ${svc.id} in ${Math.round(delay / 1000 / 60)}m`);
  }

  cancelRefresh(serviceId) {
    const timer = this.refreshTimers.get(serviceId);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(serviceId);
    }
  }

  async refreshNow(serviceId) {
    let svc;
    try {
      svc = await StreamService.getWithCredentials(serviceId);
    } catch (err) {
      logger.error(`[token-manager] failed to load service ${serviceId} for refresh`, err);
      throw err;
    }

    if (!svc) {
      logger.warn(`[token-manager] service ${serviceId} not found — skipping refresh`);
      return;
    }

    try {
      switch (svc.platform) {
        case 'twitch':
          await twitchToken.refresh(svc);
          break;
        case 'kick': {
          const { refresh: kickRefresh } = require('./platforms/kick-token');
          await kickRefresh(svc);
          break;
        }
        case 'joystick': {
          const { refresh: joystickRefresh } = require('./platforms/joystick-token');
          await joystickRefresh(svc);
          break;
        }
        case 'youtube': {
          const { refresh: youtubeRefresh } = require('./platforms/youtube-token');
          await youtubeRefresh(svc);
          break;
        }
        default:
          logger.debug(`[token-manager] no refresh handler for platform '${svc.platform}'`);
          return;
      }
    } catch (err) {
      if (err instanceof TokenRefreshError && err.requiresReauth) {
        logger.warn(`[token-manager] service ${serviceId} requires re-auth: ${err.message}`);
        try {
          await db('stream_services').where({ id: serviceId }).update({
            needs_reauth: true,
            updated_at: new Date().toISOString(),
          });
        } catch (dbErr) {
          logger.error('[token-manager] failed to set needs_reauth', dbErr);
        }
        eventBus.emit('auth.required', { serviceId, platform: svc.platform });
      } else {
        logger.error(`[token-manager] refresh failed for service ${serviceId}: ${err.message}`);
      }
      throw err;
    }

    // Refresh succeeded — re-arm the timer for the new expiry
    try {
      const updated = await db('stream_services').where({ id: serviceId }).first();
      if (updated) await this.scheduleRefresh(updated);
    } catch (err) {
      logger.error(`[token-manager] failed to re-schedule refresh for service ${serviceId}`, err);
    }
  }

  startHourlyValidation() {
    const validate = async () => {
      let twitchServices;
      try {
        twitchServices = await db('stream_services').where({ platform: 'twitch', active: true });
      } catch (err) {
        logger.error('[token-manager] hourly validation: failed to load Twitch services', err);
        return;
      }

      for (const svc of twitchServices) {
        try {
          const result = await twitchToken.validate(svc);
          if (!result.valid) {
            logger.info(`[token-manager] Twitch token invalid for service ${svc.id} (${result.reason}) — refreshing`);
            await this.refreshNow(svc.id);
          }
        } catch (err) {
          logger.error(`[token-manager] hourly validation failed for service ${svc.id}`, err);
        }
      }
    };

    // Run immediately on startup (fire-and-forget — don't block)
    validate().catch((err) => logger.error('[token-manager] initial validation error', err));

    this.validationInterval = setInterval(validate, 60 * 60 * 1000);
  }

  stop() {
    if (this.validationInterval) {
      clearInterval(this.validationInterval);
      this.validationInterval = null;
    }
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    logger.info('[token-manager] stopped');
  }
}

module.exports = new TokenManager();
module.exports.TokenRefreshError = TokenRefreshError;
