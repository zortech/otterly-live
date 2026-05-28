'use strict';

const fs               = require('fs');
const NodeMediaServer  = require('node-media-server');
const logger           = require('../lib/logger');

// Lazy requires to avoid circular deps at load time
function getRestreamManager() { return require('../restream/relay-restream-manager'); }

function tokenFromStreamPath(streamPath) {
  // v4 emits session.streamPath like "/live/<token>"; pop strips the token segment.
  return streamPath?.split('/').pop();
}

class RtmpManager {
  constructor() { this.nms = null; }

  start() {
    const port = parseInt(process.env.RELAY_RTMPS_PORT ?? '1936', 10);
    const keyPath  = process.env.RELAY_RTMPS_KEY_PATH;
    const certPath = process.env.RELAY_RTMPS_CERT_PATH;

    const cfg = { logType: 0 };
    const tlsAvailable = keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath);

    if (tlsAvailable) {
      // node-media-server v4 schema: top-level `rtmps` with file paths (not buffers).
      cfg.rtmps = { port, key: keyPath, cert: certPath };
      logger.info(`[rtmp] RTMPS enabled on port ${port}`);
    } else {
      cfg.rtmp = { port };
      logger.warn(`[rtmp] No TLS cert configured — using plain RTMP on port ${port} (dev only)`);
    }

    this.nms = new NodeMediaServer(cfg);

    // v4 emits a single `session` object to publish lifecycle listeners.
    this.nms.on('prePublish', (session) => {
      const token = tokenFromStreamPath(session.streamPath);
      const { activeSessions } = getRestreamManager();
      const found = [...activeSessions.values()].find((s) => s.ingestToken === token);
      if (!found) {
        // v4 has no reject API — closing the underlying socket aborts the publish.
        session.close?.();
        logger.warn('[rtmp] rejected publish attempt with unknown ingest token');
      }
    });

    this.nms.on('postPublish', (session) => {
      const token = tokenFromStreamPath(session.streamPath);
      const { activeSessions } = getRestreamManager();
      const entry = [...activeSessions.entries()].find(([, s]) => s.ingestToken === token);
      if (!entry) return;
      const [sessionId, found] = entry;
      if (found.graceTimer) {
        clearTimeout(found.graceTimer);
        found.graceTimer = null;
        logger.info('[rtmp] stream resumed within grace window', { sessionId });
      } else {
        logger.info('[rtmp] stream received', { sessionId });
      }
      getRestreamManager().onStreamReceived(sessionId);
    });

    // donePublish fires whenever the RTMP publisher disconnects — including
    // transient network drops. Don't delete the session immediately; keep it
    // for SESSION_GRACE_MS so the publisher can reconnect and resume with
    // the same ingestToken. If no reconnect happens in time, drop it.
    const SESSION_GRACE_MS = parseInt(process.env.RELAY_SESSION_GRACE_MS ?? `${5 * 60_000}`, 10);
    this.nms.on('donePublish', (session) => {
      const token = tokenFromStreamPath(session.streamPath);
      const { activeSessions } = getRestreamManager();
      const entry = [...activeSessions.entries()].find(([, s]) => s.ingestToken === token);
      if (!entry) return;

      const [sessionId, found] = entry;
      logger.warn('[rtmp] stream disconnected — keeping session alive for grace window', {
        sessionId, graceMs: SESSION_GRACE_MS,
      });

      // Pause: kill the fan-out FFmpegs (their RTMP source is gone) but keep
      // the session entry intact so addPlatform/removePlatform still work
      // and the publisher's reconnect picks up where it left off.
      getRestreamManager().pauseSession(sessionId);

      if (found.graceTimer) clearTimeout(found.graceTimer);
      found.graceTimer = setTimeout(() => {
        logger.warn('[rtmp] grace window expired — dropping session', { sessionId });
        activeSessions.delete(sessionId);
      }, SESSION_GRACE_MS);
    });

    this.nms.run();
    logger.info(`[rtmp] listening on port ${port}`);
  }

  stop() {
    // v4 has no nms.stop(); close the underlying TCP/TLS servers directly.
    this.nms?.rtmpServer?.tcpServer?.close();
    this.nms?.rtmpServer?.tlsServer?.close();
  }
}

module.exports = new RtmpManager();
