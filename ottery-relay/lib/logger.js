'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[process.env.RELAY_LOG_LEVEL ?? 'info'] ?? LEVELS.info;

function log(level, args) {
  if (LEVELS[level] > current) return;
  const ts = new Date().toISOString();
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${ts}] [${level.toUpperCase()}]`, ...args);
}

const logger = {
  error: (...a) => log('error', a),
  warn:  (...a) => log('warn',  a),
  info:  (...a) => log('info',  a),
  debug: (...a) => log('debug', a),
};

module.exports = logger;
