'use strict';

const db = require('../db/knex');
const StreamService = require('../models/stream-service');
const eventBus = require('../events/event-bus');
const logger = require('../lib/logger');
const { generateId } = require('../lib/id');

const MAX_FAILURES = 5;
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
const CLEAN_RECONNECT_DELAY_MS = 5000;

// Lazy-require worker classes by platform to avoid loading all at startup
function loadWorker(platform) {
  switch (platform) {
    case 'twitch':   return require('./twitch');
    case 'kick':     return require('./kick');
    case 'youtube':  return require('./youtube');
    case 'tiktok':   return require('./tiktok');
    case 'joystick': return require('./joystick');
    case 'x':        return require('./x');
    case 'rumble':   return require('./rumble');
    case 'facebook': return require('./facebook');
    case 'bilibili': return require('./bilibili');
    default: return null;
  }
}

class EventCaptureManager {
  constructor() {
    // Map<serviceId, WorkerEntry>
    // WorkerEntry: { worker, svc, state, failures, retryTimer, stopping }
    this.workers = new Map();
    this.activeSessionId = null;
  }

  setSessionId(id) {
    this.activeSessionId = id;
  }

  buildEvent(platform, type, actor, data) {
    return {
      id: generateId(),
      sessionId: this.activeSessionId,
      platform,
      type,
      timestamp: new Date().toISOString(),
      actor: actor ?? null,
      data: data ?? {},
    };
  }

  async start(serviceId) {
    if (this.workers.has(serviceId)) {
      logger.warn(`[capture-manager] start called for serviceId=${serviceId} — already running`);
      return;
    }

    let svc;
    try {
      svc = await StreamService.getWithCredentials(serviceId);
    } catch (err) {
      logger.error(`[capture-manager] failed to load service ${serviceId}`, err);
      return;
    }

    if (!svc || !svc.active || !svc.event_capture_enabled) {
      logger.debug(`[capture-manager] service ${serviceId} not eligible for capture — skipping`);
      return;
    }

    const WorkerClass = loadWorker(svc.platform);
    if (!WorkerClass) {
      logger.debug(`[capture-manager] no capture worker for platform '${svc.platform}' — skipping`);
      return;
    }

    const entry = {
      worker: null,
      svc,
      state: 'connecting',
      failures: 0,
      retryTimer: null,
      stopping: false,
    };
    this.workers.set(serviceId, entry);

    entry.worker = new WorkerClass(svc, this);
    this._wireWorkerEvents(serviceId, entry);

    eventBus.emit('capture.connecting', { serviceId, platform: svc.platform, status: 'connecting' });
    logger.info(`[capture-manager] starting capture for ${svc.platform} (serviceId=${serviceId})`);

    try {
      await entry.worker.connect();
    } catch (err) {
      // Sync connect errors are treated as error events
      entry.worker.emit('error', err);
    }
  }

  _wireWorkerEvents(serviceId, entry) {
    const worker = entry.worker;

    worker.on('connected', () => {
      if (!this.workers.has(serviceId)) return;
      entry.state = 'connected';
      entry.failures = 0;
      logger.info(`[capture-manager] ${entry.svc.platform} (serviceId=${serviceId}) connected`);
      eventBus.emit('capture.started', { serviceId, platform: entry.svc.platform, status: 'live' });
    });

    worker.on('disconnected', ({ reason } = {}) => {
      if (!this.workers.has(serviceId)) return;
      entry.state = 'disconnected';
      logger.info(`[capture-manager] ${entry.svc.platform} (serviceId=${serviceId}) disconnected (${reason})`);
      eventBus.emit('capture.stopped', { serviceId, platform: entry.svc.platform, status: 'stopped' });

      if (!entry.stopping) {
        // Clean disconnect — schedule reconnect
        entry.retryTimer = setTimeout(() => this._reconnect(serviceId), CLEAN_RECONNECT_DELAY_MS);
      }
    });

    worker.on('error', (err) => {
      if (!this.workers.has(serviceId)) return;
      const errMsg = err?.message || String(err);

      if (err?.permanent) {
        entry.state = 'error';
        this.workers.delete(serviceId);
        logger.error(`[capture-manager] ${entry.svc.platform} (serviceId=${serviceId}) permanent error — ${errMsg}`);
        eventBus.emit('capture.error', { serviceId, platform: entry.svc.platform, reason: err?.code ?? 'permanent', status: 'error' });
        return;
      }

      entry.failures++;
      logger.warn(`[capture-manager] ${entry.svc.platform} (serviceId=${serviceId}) error #${entry.failures}: ${errMsg}`);

      if (entry.failures >= MAX_FAILURES) {
        entry.state = 'error';
        this.workers.delete(serviceId);
        logger.error(`[capture-manager] ${entry.svc.platform} (serviceId=${serviceId}) exceeded max failures — giving up`);
        eventBus.emit('capture.error', { serviceId, platform: entry.svc.platform, reason: 'max_failures', status: 'error' });
        return;
      }

      const delay = BACKOFF_DELAYS_MS[Math.min(entry.failures - 1, BACKOFF_DELAYS_MS.length - 1)];
      entry.retryTimer = setTimeout(() => this._reconnect(serviceId), delay);
    });

    worker.on('event', (otteryEvent) => {
      eventBus.emit('event', otteryEvent);
    });
  }

  async _reconnect(serviceId) {
    const entry = this.workers.get(serviceId);
    if (!entry || entry.stopping) return;

    logger.info(`[capture-manager] reconnecting ${entry.svc.platform} (serviceId=${serviceId})`);

    // Reload fresh credentials (tokens may have been refreshed since last attempt)
    let freshSvc;
    try {
      freshSvc = await StreamService.getWithCredentials(serviceId);
    } catch (err) {
      logger.error(`[capture-manager] failed to reload service ${serviceId} for reconnect`, err);
      return;
    }

    if (!freshSvc) return;
    entry.svc = freshSvc;

    const WorkerClass = loadWorker(freshSvc.platform);
    if (!WorkerClass) return;

    // Replace the worker with a fresh instance and re-wire
    entry.worker = new WorkerClass(freshSvc, this);
    this._wireWorkerEvents(serviceId, entry);
    entry.state = 'connecting';
    entry.retryTimer = null;

    try {
      await entry.worker.connect();
    } catch (err) {
      entry.worker.emit('error', err);
    }
  }

  async stop(serviceId) {
    const entry = this.workers.get(serviceId);
    if (!entry) return;

    entry.stopping = true;
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }

    try {
      await entry.worker.disconnect();
    } catch (err) {
      logger.warn(`[capture-manager] error during disconnect for serviceId=${serviceId}: ${err.message}`);
    }

    this.workers.delete(serviceId);
    eventBus.emit('capture.stopped', { serviceId, platform: entry.svc.platform, status: 'stopped' });
    logger.info(`[capture-manager] stopped capture for serviceId=${serviceId}`);
  }

  async stopAll() {
    for (const id of Array.from(this.workers.keys())) {
      await this.stop(id);
    }
  }

  async startForAll() {
    let services;
    try {
      services = await db('stream_services').where({ active: true, event_capture_enabled: true, auto_start: true });
    } catch (err) {
      logger.error('[capture-manager] startForAll: failed to load services', err);
      return;
    }
    for (const row of services) {
      this.start(row.id).catch((err) =>
        logger.error(`[capture-manager] startForAll: failed to start service ${row.id}`, err)
      );
    }
  }

  status() {
    const out = {};
    for (const [id, entry] of this.workers) {
      out[id] = {
        serviceId: id,
        platform: entry.svc.platform,
        state: entry.state,
        failures: entry.failures,
      };
    }
    return out;
  }
}

module.exports = new EventCaptureManager();
