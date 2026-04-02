const path = require('path');

let log;
let _electronApp = null;
try {
  const electron = require('electron');
  _electronApp = electron.app;
} catch { /* not in Electron */ }

if (_electronApp && typeof _electronApp.getPath === 'function') {
  log = require('electron-log/main');
  log.transports.file.resolvePathFn = () =>
    path.join(_electronApp.getPath('userData'), 'logs', 'ottery-live.log');
} else {
  // Outside Electron (tests, npm run server)
  log = require('electron-log/node');
  const devLogsDir = path.join(process.cwd(), 'dev-data', 'logs');
  log.transports.file.resolvePathFn = () =>
    path.join(devLogsDir, 'ottery-live.log');
}

log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB
log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';

module.exports = log;
