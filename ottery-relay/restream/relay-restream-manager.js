'use strict';

const { spawn } = require('child_process');
const db     = require('../db/knex');
const logger = require('../lib/logger');

// Map<sessionId, { userId, ingestToken, platforms: [...], processes: Map<platformIndex, entry> }>
// Stream keys live inside platforms[].streamKey — in memory ONLY, never written to DB or logs.
const activeSessions = new Map();

// Redact stream key segment from rtmp(s):// URLs before logging
function redactKey(line) {
  return line.replace(/(rtmps?:\/\/[^/]+\/[^/]+\/)(\S+)/, '$1[REDACTED]');
}

function getIo() {
  // Lazy require to avoid circular dep at load time
  return require('../server').getIo();
}

class RelayRestreamManager {
  // Called by RTMPS manager when a stream is published to the relay ingest
  async onStreamReceived(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) {
      logger.error('[relay-restream] onStreamReceived: no session for', sessionId);
      return;
    }

    logger.info('[relay-restream] stream received', { sessionId, platforms: session.platforms.length });

    for (let i = 0; i < session.platforms.length; i++) {
      this._startPlatformProc(sessionId, i, session.platforms[i]);
    }

    try {
      await db('sessions').where({ session_id: sessionId }).update({ state: 'active' });
    } catch (err) {
      logger.warn('[relay-restream] failed to update session state', err.message);
    }
  }

  _startPlatformProc(sessionId, platformIndex, svc) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const rtmpsPort = parseInt(process.env.RELAY_RTMPS_PORT ?? '1936', 10);
    const src  = `rtmps://127.0.0.1:${rtmpsPort}/live/${session.ingestToken}`;
    const dest = `${svc.rtmpUrl}/${svc.streamKey}`;

    let proc;
    try {
      proc = spawn('ffmpeg', [
        '-re', '-i', src,
        '-c', 'copy',
        '-f', 'flv',
        dest,
      ]);
    } catch (err) {
      logger.error(`[relay-restream] spawn failed for ${svc.platform}`, err.message);
      this._emitToSession(sessionId, 'restream.error', {
        serviceId: svc.serviceId, platform: svc.platform, reason: 'ffmpeg_not_found', status: 'error',
      });
      return;
    }

    const prefix = `[relay-ffmpeg:${svc.platform}:${svc.serviceId}]`;
    proc.stderr?.on('data', (d) => {
      const line = redactKey(d.toString().trim());
      if (!line || /^frame=/.test(line)) return;
      logger.debug(prefix, line);
    });
    proc.stdout?.on('data', (d) => logger.debug(prefix, redactKey(d.toString().trim())));
    proc.on('exit', (code, signal) => this._handleExit(sessionId, platformIndex, svc, code, signal));

    if (!session.processes) session.processes = new Map();
    session.processes.set(platformIndex, { proc, svc, restarts: 0, stopping: false, restartTimer: null });

    logger.info(`[relay-restream] started ${svc.platform} (serviceId=${svc.serviceId})`);
    this._emitToSession(sessionId, 'restream.started', {
      serviceId: svc.serviceId, platform: svc.platform, status: 'live',
    });
  }

  _handleExit(sessionId, platformIndex, svc, code, signal) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const entry = session.processes?.get(platformIndex);
    if (!entry || entry.stopping) return;

    if (code === 0) {
      session.processes.delete(platformIndex);
      logger.info(`[relay-restream] ${svc.platform} exited cleanly`);
      this._emitToSession(sessionId, 'restream.stopped', { serviceId: svc.serviceId, status: 'stopped' });
      return;
    }

    if (entry.restarts >= 3) {
      session.processes.delete(platformIndex);
      logger.error(`[relay-restream] ${svc.platform} exceeded max restarts`);
      this._emitToSession(sessionId, 'restream.error', {
        serviceId: svc.serviceId, platform: svc.platform, reason: 'max_restarts', status: 'error',
      });
      return;
    }

    const delay = Math.pow(2, entry.restarts) * 1000;
    entry.restarts++;
    entry.proc = null;
    logger.warn(`[relay-restream] ${svc.platform} crashed (code=${code}), restart ${entry.restarts}/3 in ${delay}ms`);

    entry.restartTimer = setTimeout(() => {
      if (activeSessions.has(sessionId) && session.processes?.has(platformIndex)) {
        this._startPlatformProc(sessionId, platformIndex, svc);
      }
    }, delay);
  }

  stopSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    for (const entry of (session.processes?.values() ?? [])) {
      if (entry.restartTimer) clearTimeout(entry.restartTimer);
      entry.stopping = true;
      entry.proc?.kill('SIGTERM');
    }

    logger.info('[relay-restream] session stopped', { sessionId });
    this._emitToSession(sessionId, 'session.ended', {});
  }

  getStatus(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session?.processes) return {};
    const out = {};
    for (const [index, entry] of session.processes) {
      const svc = session.platforms[index];
      out[svc.serviceId] = entry.proc ? 'live' : 'stopped';
    }
    return out;
  }

  _emitToSession(sessionId, event, data) {
    getIo()?.to(sessionId).emit(event, data);
  }
}

const manager = new RelayRestreamManager();

module.exports = manager;
module.exports.activeSessions = activeSessions;
