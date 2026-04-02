'use strict';

// No-op electron-log mock for Jest tests
const noop = () => {};

const log = {
  error: noop,
  warn: noop,
  info: noop,
  verbose: noop,
  debug: noop,
  silly: noop,
  log: noop,
  transports: {
    file: {
      level: 'info',
      maxSize: 0,
      resolvePathFn: noop,
      format: '',
    },
    console: {
      level: 'info',
      format: '',
    },
  },
};

module.exports = log;
