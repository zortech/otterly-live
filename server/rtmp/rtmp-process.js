// IMPORTANT: Never require('electron') in this file.
// This file is forked as a child process — requiring Electron here is fatal in packaged apps.
const NodeMediaServer = require('node-media-server');

const port = parseInt(process.env.RTMP_PORT, 10);

if (!port || isNaN(port)) {
  process.send({ event: 'error', code: 'BAD_CONFIG', message: 'RTMP_PORT not set or invalid' });
  process.exit(1);
}

const nms = new NodeMediaServer({
  rtmp: {
    port,
    chunk_size: 60000,
    gop_cache: true,
    ping: 60,
    ping_timeout: 30,
  },
  logType: 0, // suppress NMS console output; parent handles logging
});

nms.on('postPublish', (session) => {
  process.send({ event: 'stream.start', streamPath: session.streamPath });
});

nms.on('donePublish', (session) => {
  process.send({ event: 'stream.end', streamPath: session.streamPath });
});

nms.run();

// Watchdog: report heap usage every 30s so parent can restart on memory leak
setInterval(() => {
  const heapUsedMB = process.memoryUsage().heapUsed / 1024 / 1024;
  process.send({ event: 'health', heapUsedMB });
}, 30_000);

process.on('SIGTERM', () => {
  nms.stop();
  process.exit(0);
});
