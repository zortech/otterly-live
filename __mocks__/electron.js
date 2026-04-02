'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

// Minimal electron mock for Jest tests
const TEST_BASE = path.join(os.tmpdir(), 'ottery-live-test');

module.exports = {
  app: {
    getPath: (name) => {
      const dir = path.join(TEST_BASE, name);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    getVersion: () => '0.1.0',
  },
};
