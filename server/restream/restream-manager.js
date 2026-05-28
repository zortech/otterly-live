'use strict';

const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const StreamService = require('../models/stream-service');
const logger = require('../lib/logger');
const eventBus = require('../events/event-bus');
const settings = require('../settings');
const relayClient = require('./relay-client');

// Redact stream key from FFmpeg log output before writing to the log.
// Pattern matches rtmp(s)://host/app/<key> and replaces the key segment.
function redactKey(line) {
  return line.replace(/(rtmps?:\/\/[^/]+\/[^/]+\/)(\S+)/, '$1[REDACTED]');
}

function buildDestUrl(svc) {
  return `${svc.rtmp_url}/${svc.stream_key}`;
}

class RestreamManager {
  constructor() {
    // Map<serviceId, { proc, svc, restarts, stopping, restartTimer }>
    this.processes = new Map();
    this.rtmpPort = null;
    this.incomingKey = null;
  }

  /**
   * Called by RtmpManager when OBS connects. Stores RTMP config and
   * starts restreaming — either locally (default) or via the remote relay.
   */
  async onStreamStart(rtmpPort, incomingKey) {
    this.rtmpPort = rtmpPort;
    this.incomingKey = incomingKey;

    const mode = await settings.get('relay.mode');
    if (mode === 'remote') {
      await this._startRemoteSession();
      return;
    }
    await this._startLocalSession();
  }

  /**
   * Local mode: spawn a separate FFmpeg process for each active platform.
   * Extracted from the original onStreamStart so it can also be called as fallback.
   */
  async _startLocalSession() {
    let rows;
    try {
      const db = require('../db/knex');
      rows = await db('stream_services').where({ active: true });
    } catch (err) {
      logger.error('[restream] failed to load stream services on stream start', err);
      return;
    }

    for (const row of rows) {
      if (!row.restream_enabled || !row.auto_start) continue;
      try {
        const svc = await StreamService.getWithCredentials(row.id);
        await this.startPlatform(svc);
      } catch (err) {
        logger.error(`[restream] failed to auto-start platform ${row.id}`, err);
      }
    }
  }

  /**
   * Remote mode: push platform configs to the relay, spawn ONE local FFmpeg
   * relay passthrough process, then let the relay fan out to platforms.
   */
  async _startRemoteSession() {
    let rows;
    try {
      const db = require('../db/knex');
      rows = await db('stream_services').where({ active: true });
    } catch (err) {
      logger.error('[restream] remote: failed to load stream services', err);
      eventBus.emit('relay.error', { reason: `db_error: ${err.message}` });
      return;
    }

    const platforms = [];
    for (const row of rows) {
      if (!row.restream_enabled || !row.auto_start) continue;
      try {
        const svc = await StreamService.getWithCredentials(row.id);
        if (svc.stream_key && svc.rtmp_url) {
          platforms.push({
            serviceId: svc.id,
            platform:  svc.platform,
            rtmpUrl:   svc.rtmp_url,
            streamKey: svc.stream_key,
          });
        }
      } catch (err) {
        logger.warn(`[restream] remote: skipping platform ${row.id} — ${err.message}`);
      }
    }

    // Open the relay session even if no platforms have auto_start. Manual
    // toggles can attach platforms to the running passthrough later.
    //
    // No local fallback: in remote mode the user has explicitly chosen the
    // relay (typically because the sum of platform bitrates exceeds local
    // upload bandwidth). Silently switching to local would saturate the
    // uplink and corrupt every destination. On failure, we emit a hard
    // error and stop.
    let sessionData;
    try {
      sessionData = await relayClient.startSession(platforms);
    } catch (err) {
      logger.error('[restream] relay session start failed — stream NOT started:', err.message);
      eventBus.emit('relay.error', { reason: err.message });
      return;
    }

    await this._spawnRelayFFmpeg(sessionData);
  }

  /**
   * Spawns the single local FFmpeg passthrough: OBS → relay RTMPS ingest.
   */
  async _spawnRelayFFmpeg({ ingestToken, rtmpsPort }) {
    const relayUrl  = await settings.get('relay.url');
    const relayHost = new URL(relayUrl).hostname;
    const dest = `rtmps://${relayHost}:${rtmpsPort}/live/${ingestToken}`;
    const src  = `rtmp://127.0.0.1:${this.rtmpPort}/live/${this.incomingKey}`;

    let proc;
    try {
      proc = spawn(ffmpegPath, [
        '-re', '-i', src,
        '-c', 'copy',
        '-f', 'flv',
        dest,
      ], { windowsHide: true });
    } catch (err) {
      logger.error('[restream] failed to spawn relay FFmpeg:', err.message);
      eventBus.emit('relay.error', { reason: 'ffmpeg_spawn_failed' });
      await this._teardownRelaySession();
      return;
    }

    const prefix = '[ffmpeg:relay]';
    proc.stderr?.on('data', (d) => {
      const line = redactKey(d.toString().trim());
      if (!line || /^frame=/.test(line)) return;
      logger.debug(prefix, line);
    });

    proc.on('error', async (err) => {
      logger.error('[restream] relay FFmpeg spawn error:', err.message);
      this.processes.delete('__relay__');
      eventBus.emit('relay.error', { reason: `ffmpeg_spawn_error: ${err.code ?? err.message}` });
      await this._teardownRelaySession();
    });
    proc.on('exit', (code, signal) => this._handleRelayExit(code, signal, ingestToken, rtmpsPort));

    this.processes.set('__relay__', { proc, svc: null, restarts: 0, stopping: false, restartTimer: null });
    logger.info('[restream] relay passthrough started');
    eventBus.emit('relay.connected', { status: 'relaying' });
  }

  _handleRelayExit(code, signal, ingestToken, rtmpsPort) {
    const entry = this.processes.get('__relay__');
    if (!entry || entry.stopping) return;

    if (code === 0) {
      this.processes.delete('__relay__');
      return;
    }

    // Indefinite reconnect: relay mode exists because the user can't afford
    // local fan-out, so giving up means losing the stream entirely. Cap the
    // backoff at 30s so we don't compound a long outage.
    // 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, ...
    const delay = Math.min(Math.pow(2, entry.restarts) * 1000, 30_000);
    entry.restarts++;
    entry.proc = null;
    logger.warn(`[restream] relay FFmpeg dropped (code=${code}), reconnect attempt ${entry.restarts} in ${delay}ms`);
    eventBus.emit('relay.reconnecting', {
      attempt: entry.restarts,
      delayMs: delay,
      reason:  `exit code ${code}${signal ? ` signal ${signal}` : ''}`,
    });

    entry.restartTimer = setTimeout(() => {
      if (this.processes.has('__relay__')) {
        this._spawnRelayFFmpeg({ ingestToken, rtmpsPort });
      }
    }, delay);
  }

  /**
   * Tear down the relay session entirely on hard failure.
   * Does NOT fall back to local mode — the user picked remote mode for a
   * reason (typically bandwidth), and silently switching to local would
   * almost certainly oversubscribe their uplink. The stream stops; the
   * error event surfaces in the UI.
   */
  async _teardownRelaySession() {
    this._stopRelayProc();
    try { await relayClient.endSession(); } catch (err) {
      logger.warn('[restream] relay endSession after error failed:', err.message);
    }
  }

  _stopRelayProc() {
    const entry = this.processes.get('__relay__');
    if (!entry) return;
    if (entry.restartTimer) clearTimeout(entry.restartTimer);
    entry.stopping = true;
    entry.proc?.kill('SIGTERM');
    this.processes.delete('__relay__');
  }

  /**
   * Called by RtmpManager when OBS disconnects. Stops all FFmpeg processes.
   */
  async onStreamEnd() {
    const mode = await settings.get('relay.mode');
    if (mode === 'remote') {
      this._stopRelayProc();
      try { await relayClient.endSession(); } catch (err) {
        logger.warn('[restream] relay endSession failed:', err.message);
      }
      return;
    }
    this.stopAll();
  }

  /**
   * Start FFmpeg for a single platform. svc must include stream_key from keytar.
   */
  async startPlatform(svc) {
    let inheritedRestarts = 0;
    if (this.processes.has(svc.id)) {
      const existing = this.processes.get(svc.id);
      if (existing.proc !== null) {
        // Actually running — ignore duplicate start request
        logger.warn(`[restream] startPlatform called for ${svc.platform} (${svc.id}) — already running`);
        return;
      }
      // Dead proc slot waiting for restart — carry over the restart count, then clear the stale entry
      inheritedRestarts = existing.restarts;
      this.processes.delete(svc.id);
    }

    if (!svc.stream_key) {
      logger.error(`[restream] no stream key for ${svc.platform} (${svc.id})`);
      eventBus.emit('restream.error', { serviceId: svc.id, platform: svc.platform, reason: 'no_stream_key', status: 'error' });
      return;
    }

    if (!svc.rtmp_url) {
      logger.error(`[restream] no RTMP URL for ${svc.platform} (${svc.id})`);
      eventBus.emit('restream.error', { serviceId: svc.id, platform: svc.platform, reason: 'no_rtmp_url', status: 'error' });
      return;
    }

    const dest = buildDestUrl(svc);
    const src = `rtmp://127.0.0.1:${this.rtmpPort}/live/${this.incomingKey}`;

    let proc;
    try {
      proc = spawn(ffmpegPath, [
        '-re',
        '-i', src,
        '-c', 'copy',
        '-f', 'flv',
        dest,
      ], { windowsHide: true });
    } catch (err) {
      logger.error(`[restream] failed to spawn FFmpeg for ${svc.platform} (${svc.id}): ${err.message}`);
      eventBus.emit('restream.error', { serviceId: svc.id, platform: svc.platform, reason: 'ffmpeg_not_found', status: 'error' });
      return;
    }

    const prefix = `[ffmpeg:${svc.platform}:${svc.id}]`;
    // FFmpeg emits continuous progress lines (frame=, fps=, bitrate=) on stderr.
    // Log these only at debug level and only when the logger is actually in debug mode,
    // to prevent log files growing at hundreds of KB/s during a live stream.
    proc.stderr?.on('data', (d) => {
      const line = redactKey(d.toString().trim());
      if (!line) return;
      // Progress lines contain 'frame=' near the start — skip unless at debug level
      if (/^frame=/.test(line)) {
        if (logger.transports.file.level === 'debug' || logger.transports.console.level === 'debug') {
          logger.debug(prefix, line);
        }
      } else {
        logger.debug(prefix, line);
      }
    });
    proc.stdout?.on('data', (d) => logger.debug(prefix, redactKey(d.toString().trim())));

    proc.on('error', (err) => {
      logger.error(`[restream] FFmpeg spawn error for ${svc.platform} (${svc.id}): ${err.message}`);
      this.processes.delete(svc.id);
      eventBus.emit('restream.error', {
        serviceId: svc.id,
        platform: svc.platform,
        reason: err.code === 'ENOENT' ? 'ffmpeg_not_found' : `spawn_error: ${err.code ?? err.message}`,
        status: 'error',
      });
    });
    proc.on('exit', (code, signal) => this._handleExit(svc, code, signal));

    this.processes.set(svc.id, { proc, svc, restarts: inheritedRestarts, stopping: false, restartTimer: null });

    logger.info(`[restream] started ${svc.platform} (serviceId=${svc.id})`);
    eventBus.emit('restream.started', { serviceId: svc.id, platform: svc.platform, status: 'live' });
  }

  /**
   * Stop FFmpeg for a single platform.
   */
  stopPlatform(serviceId) {
    const entry = this.processes.get(serviceId);
    if (!entry) return;

    entry.stopping = true;
    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }

    entry.proc.kill('SIGTERM');
    this.processes.delete(serviceId);

    logger.info(`[restream] stopped serviceId=${serviceId}`);
    eventBus.emit('restream.stopped', { serviceId, status: 'stopped' });
  }

  /**
   * Stop all running FFmpeg processes (local platform processes only — not the relay passthrough).
   */
  stopAll() {
    for (const id of Array.from(this.processes.keys())) {
      if (id === '__relay__') continue;
      this.stopPlatform(id);
    }
  }

  /**
   * Toggle a platform on or off. Called from POST /api/stream/toggle.
   * svc credentials are fetched here so the toggle route stays thin.
   *
   * Routes through the relay when relay.mode === 'remote' so manual starts
   * use the same path as auto-started platforms.
   */
  async toggle(serviceId, enabled) {
    if (enabled) {
      const svc = await StreamService.getWithCredentials(serviceId);
      if (!svc) throw new Error(`Service ${serviceId} not found`);
      if (!svc.restream_enabled) throw new Error(`Restream not enabled for service ${serviceId}`);

      const useRelay = (await settings.get('relay.mode')) === 'remote' && this.processes.has('__relay__');
      if (useRelay) {
        await this._addPlatformToRelay(svc);
      } else {
        await this.startPlatform(svc);
      }

      // Also start event capture if enabled (lazy require avoids circular deps at load time)
      if (svc.event_capture_enabled) {
        const eventCaptureManager = require('../event-capture/manager');
        eventCaptureManager.start(serviceId).catch((err) =>
          logger.warn(`[restream] failed to start capture on toggle for serviceId=${serviceId}: ${err.message}`)
        );
      }
    } else {
      const useRelay = (await settings.get('relay.mode')) === 'remote' && relayClient.sessionId;
      if (useRelay) {
        try {
          await relayClient.removePlatform(serviceId);
        } catch (err) {
          logger.warn(`[restream] relay removePlatform failed for serviceId=${serviceId}: ${err.message}`);
        }
        eventBus.emit('restream.stopped', { serviceId, status: 'stopped' });
      } else {
        this.stopPlatform(serviceId);
      }
      // Do NOT stop capture on restream toggle — capture is independent per the design
    }
  }

  async _addPlatformToRelay(svc) {
    if (!svc.stream_key) {
      logger.error(`[restream] cannot relay ${svc.platform} (${svc.id}) — no stream key`);
      eventBus.emit('restream.error', { serviceId: svc.id, platform: svc.platform, reason: 'no_stream_key', status: 'error' });
      return;
    }
    if (!svc.rtmp_url) {
      logger.error(`[restream] cannot relay ${svc.platform} (${svc.id}) — no RTMP URL`);
      eventBus.emit('restream.error', { serviceId: svc.id, platform: svc.platform, reason: 'no_rtmp_url', status: 'error' });
      return;
    }

    try {
      await relayClient.addPlatform({
        serviceId: svc.id,
        platform:  svc.platform,
        rtmpUrl:   svc.rtmp_url,
        streamKey: svc.stream_key,
      });
      logger.info(`[restream] relay added ${svc.platform} (serviceId=${svc.id})`);
      // The relay will emit restream.started over WebSocket once its FFmpeg spawns.
    } catch (err) {
      logger.error(`[restream] relay addPlatform failed for ${svc.platform} (${svc.id}): ${err.message}`);
      eventBus.emit('restream.error', { serviceId: svc.id, platform: svc.platform, reason: err.message, status: 'error' });
    }
  }

  /**
   * Returns a map of serviceId → status object for all tracked platforms.
   * Platforms not in the map are implicitly 'stopped'.
   */
  getStatus() {
    const out = {};
    for (const [id, entry] of this.processes) {
      // The '__relay__' entry tracks the OBS→relay passthrough — it has no
      // svc and isn't a platform fan-out, so it doesn't belong in the
      // per-platform status snapshot consumed by the UI.
      if (!entry.svc) continue;
      out[id] = { serviceId: id, platform: entry.svc.platform, status: 'live' };
    }
    return out;
  }

  getStatusForService(serviceId) {
    const entry = this.processes.get(serviceId);
    return entry && entry.svc ? 'live' : 'stopped';
  }

  _handleExit(svc, code, signal) {
    const entry = this.processes.get(svc.id);

    // Intentional stop: stopping flag set, or entry already removed by stopPlatform
    if (!entry || entry.stopping) return;

    // Clean exit — treat as intentional (e.g. FFmpeg EOF on input)
    if (code === 0) {
      this.processes.delete(svc.id);
      logger.info(`[restream] ${svc.platform} (${svc.id}) exited cleanly`);
      eventBus.emit('restream.stopped', { serviceId: svc.id, status: 'stopped' });
      return;
    }

    // Crash — attempt auto-restart with exponential backoff
    if (entry.restarts >= 3) {
      this.processes.delete(svc.id);
      logger.error(`[restream] ${svc.platform} (${svc.id}) exceeded max restarts — giving up`);
      eventBus.emit('restream.error', { serviceId: svc.id, platform: svc.platform, reason: 'max_restarts', status: 'error' });
      return;
    }

    const delay = Math.pow(2, entry.restarts) * 1000; // 1s, 2s, 4s
    entry.restarts++;
    // Mark proc as dead so startPlatform knows this is a restart slot, not a live process
    entry.proc = null;
    logger.warn(`[restream] ${svc.platform} (${svc.id}) crashed (code=${code} signal=${signal}), restart ${entry.restarts}/3 in ${delay}ms`);

    entry.restartTimer = setTimeout(() => {
      // Guard: service may have been explicitly stopped while waiting to restart
      if (this.processes.has(svc.id)) this.startPlatform(svc);
    }, delay);
  }
}

module.exports = new RestreamManager();
