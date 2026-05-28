'use strict';

const { spawn } = require('child_process');
const db     = require('../db/knex');
const logger = require('../lib/logger');

// Map<sessionId, { userId, ingestToken, platforms: [...], processes: Map<platformIndex, entry> }>
// Stream keys live inside platforms[].streamKey — in memory ONLY, never written to DB or logs.
const activeSessions = new Map();

// Emit progress (frame/drop counters) at most once per fan-out per this window.
const PROGRESS_EMIT_INTERVAL_MS = 5000;
// Throttle identical warning messages per fan-out — at most one emit per window.
const WARNING_DEDUPE_MS = 5000;

// Lines that indicate a real problem worth surfacing to the user. Anything not
// matching these (and not a progress line) is logged at debug only so the relay
// log stays readable during normal operation.
const WARNING_PATTERNS = [
  /non[- ]monotonous dts/i,
  /past duration/i,
  /queue input is backward in time/i,
  /queue overflow/i,
  /buffer underflow/i,
  /connection (?:refused|reset|timed out)/i,
  /cannot (?:open|determine)/i,
  /error (?:opening|muxing|writing|while)/i,
  /failed to/i,
  /no route to host/i,
];

// Redact stream key segment from rtmp(s):// URLs before logging
function redactKey(line) {
  return line.replace(/(rtmps?:\/\/[^/]+\/[^/]+\/)(\S+)/, '$1[REDACTED]');
}

// Parse the `frame= 123 ... [drop= 4]` portion of an FFmpeg progress line.
// `drop=` is only emitted when FFmpeg is transcoding; with `-c copy` (our
// fan-out config) it's absent and dropped defaults to 0.
function parseProgress(line) {
  const frameMatch = line.match(/frame=\s*(\d+)/);
  if (!frameMatch) return null;
  const dropMatch = line.match(/drop=\s*(\d+)/);
  return {
    frames:  Number(frameMatch[1]),
    dropped: dropMatch ? Number(dropMatch[1]) : 0,
  };
}

function isWarningLine(line) {
  for (const p of WARNING_PATTERNS) if (p.test(line)) return true;
  return false;
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

    session.streamActive = true;
    const activeCount = session.platforms.filter(Boolean).length;
    logger.info('[relay-restream] stream received', { sessionId, platforms: activeCount });

    for (let i = 0; i < session.platforms.length; i++) {
      if (session.platforms[i]) this._startPlatformProc(sessionId, i, session.platforms[i]);
    }

    try {
      await db('sessions').where({ session_id: sessionId }).update({ state: 'active' });
    } catch (err) {
      logger.warn('[relay-restream] failed to update session state', err.message);
    }
  }

  // Add a single platform to an existing session. If the ingest stream is
  // already active, spawn its fan-out FFmpeg immediately; otherwise it'll
  // start when onStreamReceived fires.
  addPlatform(sessionId, platform) {
    const session = activeSessions.get(sessionId);
    if (!session) throw new Error('session_not_found');
    if (session.platforms.some((p) => p && p.serviceId === platform.serviceId)) {
      throw new Error('platform_already_in_session');
    }
    const index = session.platforms.push(platform) - 1;
    if (session.streamActive) {
      this._startPlatformProc(sessionId, index, platform);
    }
    return { index };
  }

  // Remove a single platform from a session. Kills its FFmpeg if running.
  // The platforms[] slot is set to null (not spliced) to preserve index-based
  // process tracking.
  removePlatform(sessionId, serviceId) {
    const session = activeSessions.get(sessionId);
    if (!session) throw new Error('session_not_found');
    const index = session.platforms.findIndex((p) => p && p.serviceId === serviceId);
    if (index === -1) throw new Error('platform_not_in_session');

    const entry = session.processes?.get(index);
    if (entry) {
      entry.stopping = true;
      if (entry.restartTimer) clearTimeout(entry.restartTimer);
      entry.proc?.kill('SIGTERM');
      session.processes.delete(index);
    }
    session.platforms[index] = null;
    this._emitToSession(sessionId, 'restream.stopped', { serviceId, status: 'stopped' });
    logger.info('[relay-restream] platform removed', { sessionId, serviceId });
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

    const startedAt = Date.now();
    if (!session.processes) session.processes = new Map();
    const entry = {
      proc, svc,
      startedAt,
      restarts: 0,
      stopping: false,
      restartTimer: null,
      frames: 0,
      dropped: 0,
      lastProgressEmit: 0,
      lastWarningMessage: null,
      lastWarningAt: 0,
    };
    session.processes.set(platformIndex, entry);

    const prefix = `[relay-ffmpeg:${svc.platform}:${svc.serviceId}]`;
    proc.stderr?.on('data', (d) => {
      // FFmpeg writes progress with \r (not \n), so chunks may contain
      // multiple updates or partial lines. Split on either.
      const chunk = redactKey(d.toString());
      for (const raw of chunk.split(/[\r\n]+/)) {
        const line = raw.trim();
        if (!line) continue;
        this._handleFfmpegLine(sessionId, platformIndex, svc, line, prefix);
      }
    });
    proc.stdout?.on('data', (d) => logger.debug(prefix, redactKey(d.toString().trim())));
    proc.on('exit', (code, signal) => this._handleExit(sessionId, platformIndex, svc, code, signal));

    logger.info(`[relay-restream] started ${svc.platform} (serviceId=${svc.serviceId})`);
    this._emitToSession(sessionId, 'restream.started', {
      serviceId: svc.serviceId, platform: svc.platform, status: 'live', startedAt,
    });
  }

  _handleFfmpegLine(sessionId, platformIndex, svc, line, prefix) {
    const session = activeSessions.get(sessionId);
    const entry = session?.processes?.get(platformIndex);
    if (!entry) return;

    if (/^frame=/.test(line)) {
      const p = parseProgress(line);
      if (!p) return;
      entry.frames = p.frames;
      entry.dropped = p.dropped;
      const now = Date.now();
      if (now - entry.lastProgressEmit < PROGRESS_EMIT_INTERVAL_MS) return;
      entry.lastProgressEmit = now;
      this._emitToSession(sessionId, 'restream.progress', {
        serviceId: svc.serviceId,
        platform:  svc.platform,
        frames:    p.frames,
        dropped:   p.dropped,
      });
      return;
    }

    if (isWarningLine(line)) {
      logger.warn(prefix, line);
      const now = Date.now();
      // Suppress identical warnings repeated within the dedupe window.
      if (entry.lastWarningMessage === line && now - entry.lastWarningAt < WARNING_DEDUPE_MS) return;
      entry.lastWarningMessage = line;
      entry.lastWarningAt = now;
      this._emitToSession(sessionId, 'restream.warning', {
        serviceId: svc.serviceId,
        platform:  svc.platform,
        message:   line.slice(0, 500),
        at:        now,
      });
      return;
    }

    logger.debug(prefix, line);
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

  /**
   * Terminate a session permanently. Kills all fan-out FFmpegs and signals
   * the client that the session is over. Called from DELETE /api/sessions/:id
   * or when the grace window expires.
   */
  stopSession(sessionId) {
    this._killSessionProcs(sessionId);
    const session = activeSessions.get(sessionId);
    if (session) {
      logger.info('[relay-restream] session stopped', { sessionId });
      this._emitToSession(sessionId, 'session.ended', {});
    }
  }

  /**
   * Pause a session due to a transient disconnect. Kills the fan-out
   * FFmpegs (their RTMP source is gone) but keeps the session entry intact
   * so the publisher can reconnect with the same ingestToken and resume.
   * Does NOT emit session.ended — clients should keep their socket open and
   * wait for restream.started when fan-outs respawn.
   */
  pauseSession(sessionId) {
    this._killSessionProcs(sessionId);
    const session = activeSessions.get(sessionId);
    if (session) {
      logger.info('[relay-restream] session paused (awaiting reconnect)', { sessionId });
    }
  }

  _killSessionProcs(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    session.streamActive = false;
    for (const entry of (session.processes?.values() ?? [])) {
      if (entry.restartTimer) clearTimeout(entry.restartTimer);
      entry.stopping = true;
      entry.proc?.kill('SIGTERM');
    }
    // Reset processes Map so next onStreamReceived spawns fresh entries
    session.processes = new Map();
  }

  getStatus(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session?.processes) return {};
    const out = {};
    for (const [index, entry] of session.processes) {
      const svc = session.platforms[index];
      if (!svc) continue;
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
