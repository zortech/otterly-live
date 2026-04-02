'use strict';

const fs               = require('fs');
const NodeMediaServer  = require('node-media-server');
const logger           = require('../lib/logger');

// Lazy requires to avoid circular deps at load time
function getRestreamManager() { return require('../restream/relay-restream-manager'); }

class RtmpManager {
  constructor() { this.nms = null; }

  start() {
    const port = parseInt(process.env.RELAY_RTMPS_PORT ?? '1936', 10);
    const keyPath  = process.env.RELAY_RTMPS_KEY_PATH;
    const certPath = process.env.RELAY_RTMPS_CERT_PATH;

    const cfg = {
      rtmp: { port, chunk_size: 60000, gop_cache: true, ping: 60, ping_timeout: 30 },
      logType: 0,
    };

    if (keyPath && certPath) {
      try {
        cfg.rtmp.ssl = {
          port,
          key:  fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        };
        logger.info(`[rtmp] RTMPS enabled on port ${port}`);
      } catch (err) {
        logger.warn(`[rtmp] Could not load TLS cert/key — falling back to plain RTMP: ${err.message}`);
      }
    } else {
      logger.warn(`[rtmp] No TLS cert configured — using plain RTMP on port ${port} (dev only)`);
    }

    this.nms = new NodeMediaServer(cfg);

    this.nms.on('prePublish', (id, streamPath) => {
      const token   = streamPath.split('/').pop();
      const { activeSessions } = getRestreamManager();
      const session = [...activeSessions.values()].find(s => s.ingestToken === token);
      if (!session) {
        // Reject unknown ingest tokens — do not log the token value
        this.nms.getSession(id)?.reject();
        logger.warn('[rtmp] rejected publish attempt with unknown ingest token');
      }
    });

    this.nms.on('postPublish', (_id, streamPath) => {
      const token = streamPath.split('/').pop();
      const { activeSessions } = getRestreamManager();
      const entry = [...activeSessions.entries()].find(([, s]) => s.ingestToken === token);
      if (entry) {
        const [sessionId] = entry;
        logger.info('[rtmp] stream received', { sessionId });
        getRestreamManager().onStreamReceived(sessionId);
      }
    });

    this.nms.on('donePublish', (_id, streamPath) => {
      const token = streamPath.split('/').pop();
      const { activeSessions } = getRestreamManager();
      const entry = [...activeSessions.entries()].find(([, s]) => s.ingestToken === token);
      if (entry) {
        const [sessionId] = entry;
        logger.info('[rtmp] stream ended', { sessionId });
        getRestreamManager().stopSession(sessionId);
        activeSessions.delete(sessionId);
      }
    });

    this.nms.run();
    logger.info(`[rtmp] listening on port ${port}`);
  }

  stop() {
    this.nms?.stop();
  }
}

module.exports = new RtmpManager();
