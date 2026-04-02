'use strict';

const EventEmitter = require('events');

/**
 * Abstract base class for all platform event capture workers.
 *
 * Workers emit:
 *   'event'        (otteryEvent)        — normalized event to forward to eventBus
 *   'connected'    ()                   — successfully connected to platform
 *   'disconnected' ({ reason })         — clean disconnect (should reconnect)
 *   'error'        (Error)              — recoverable error (manager retries)
 */
class BaseCapture extends EventEmitter {
  /**
   * @param {object} streamService  Full credentials object from StreamService.getWithCredentials()
   * @param {object} manager        EventCaptureManager reference (for buildEvent)
   */
  constructor(streamService, manager) {
    super();
    this.svc = streamService;
    this.manager = manager;
    this._connected = false;
  }

  async connect() {
    throw new Error(`${this.constructor.name}.connect() not implemented`);
  }

  async disconnect() {
    throw new Error(`${this.constructor.name}.disconnect() not implemented`);
  }

  isConnected() {
    return this._connected;
  }

  /**
   * Build a normalized OtteryEvent. Workers call this instead of constructing events manually.
   * sessionId is injected by the manager at call time.
   */
  buildEvent(type, actor, data) {
    return this.manager.buildEvent(this.svc.platform, type, actor, data);
  }
}

module.exports = BaseCapture;
