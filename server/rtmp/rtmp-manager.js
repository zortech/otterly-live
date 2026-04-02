const { fork } = require('child_process');
const path = require('path');
const db = require('../db/knex');
const settings = require('../settings');
const logger = require('../lib/logger');
const eventBus = require('../events/event-bus');
const restreamManager = require('../restream/restream-manager');
const eventCaptureManager = require('../event-capture/manager');

const HEAP_RESTART_MB = 512;
const RESTART_DELAY_MS = 2000;

class RtmpManager {
  constructor() {
    this.proc = null;
    this.port = null;
    this.incomingKey = null;
    this._sessionState = 'idle'; // 'idle' | 'live' | 'ended'
    this.activeSessionId = null;
    this._intentionalStop = false;
  }

  async start() {
    [this.port, this.incomingKey] = await Promise.all([
      settings.get('rtmp.port'),
      settings.get('rtmp.incomingKey'),
    ]);
    this._spawnProcess();
  }

  _spawnProcess() {
    this._intentionalStop = false;

    this.proc = fork(path.join(__dirname, 'rtmp-process.js'), [], {
      env: { ...process.env, RTMP_PORT: String(this.port) },
      silent: true,
    });

    // Route child stdout/stderr through the parent logger
    this.proc.stdout?.on('data', (d) => logger.debug('[rtmp]', d.toString().trim()));
    this.proc.stderr?.on('data', (d) => logger.debug('[rtmp]', d.toString().trim()));

    this.proc.on('message', (msg) => this._handleMessage(msg));

    this.proc.on('exit', (code, signal) => {
      if (this._intentionalStop) return;
      logger.warn(`[rtmp] child exited (code=${code} signal=${signal}), restarting in ${RESTART_DELAY_MS}ms`);
      setTimeout(() => this._spawnProcess(), RESTART_DELAY_MS);
    });

    logger.info(`[rtmp] RTMP server started on port ${this.port}`);
  }

  _handleMessage(msg) {
    if (msg.event === 'stream.start') this._onStreamStart(msg.streamPath);
    else if (msg.event === 'stream.end') this._onStreamEnd(msg.streamPath);
    else if (msg.event === 'health') {
      if (msg.heapUsedMB > HEAP_RESTART_MB) {
        logger.warn(`[rtmp] heap ${msg.heapUsedMB.toFixed(1)}MB > ${HEAP_RESTART_MB}MB — restarting child`);
        this.restart();
      }
    } else if (msg.event === 'error') {
      logger.error(`[rtmp] child error: ${msg.code} — ${msg.message}`);
      eventBus.emit('restream.error', { code: msg.code, message: msg.message });
    }
  }

  async _onStreamStart(streamPath) {
    // Extract key from path: '/live/ottery' → 'ottery'
    const segments = streamPath.split('/');
    const key = segments[segments.length - 1];

    if (key !== this.incomingKey) {
      logger.warn(`[rtmp] rejected stream on path "${streamPath}" — expected key "${this.incomingKey}"`);
      return;
    }

    if (this.activeSessionId !== null) {
      logger.warn('[rtmp] stream.start received while session already active — ignoring');
      return;
    }

    try {
      const now = new Date().toISOString();
      const [id] = await db('stream_sessions').insert({
        started_at: now,
        obs_stream_key: '[configured]',
      });
      this.activeSessionId = id;
      this._sessionState = 'live';
      logger.info(`[rtmp] session ${id} started`);
      eventBus.emit('session.started', { sessionId: id });
      // Set session ID on capture manager BEFORE starting workers (first events get sessionId)
      eventCaptureManager.setSessionId(id);
      restreamManager.onStreamStart(this.port, this.incomingKey).catch((err) => {
        logger.error('[rtmp] restreamManager.onStreamStart failed', err);
      });
      eventCaptureManager.startForAll();
    } catch (err) {
      logger.error('[rtmp] failed to create stream_session', err);
    }
  }

  async _onStreamEnd(streamPath) {
    if (this.activeSessionId === null) {
      logger.warn(`[rtmp] stream.end received for "${streamPath}" with no active session — ignoring`);
      return;
    }

    const sessionId = this.activeSessionId;

    try {
      const row = await db('stream_sessions').where({ id: sessionId }).first();
      const durationSeconds = row?.started_at
        ? Math.round((Date.now() - new Date(row.started_at).getTime()) / 1000)
        : null;

      await db('stream_sessions').where({ id: sessionId }).update({
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
      });

      logger.info(`[rtmp] session ${sessionId} ended (${durationSeconds}s)`);
    } catch (err) {
      logger.error('[rtmp] failed to close stream_session', err);
    }

    this.activeSessionId = null;
    this._sessionState = 'ended';
    eventBus.emit('session.ended', { sessionId });
    restreamManager.onStreamEnd();
    // Null out session ID but do NOT stopAll — capture continues after OBS disconnects
    eventCaptureManager.setSessionId(null);
  }

  getSessionState() {
    return this._sessionState;
  }

  getActiveSessionId() {
    return this.activeSessionId;
  }

  restart() {
    this._intentionalStop = true;
    this.proc?.kill('SIGTERM');
    setTimeout(() => this._spawnProcess(), RESTART_DELAY_MS);
  }

  async stop() {
    this._intentionalStop = true;
    restreamManager.stopAll();
    await eventCaptureManager.stopAll();
    // Close any open session on graceful app quit
    if (this.activeSessionId !== null) {
      await this._onStreamEnd('/live/' + this.incomingKey);
    }
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }
}

module.exports = new RtmpManager();
