#!/usr/bin/env node
// Rebuilds native modules for Electron's Node version.
// Uses the programmatic API to avoid electron-rebuild CLI's yargs/ESM issues on Node 25+.
const { rebuild } = require('@electron/rebuild');

rebuild({ buildPath: process.cwd(), electronVersion: '33.0.0' })
  .then(() => {
    console.log('Native modules rebuilt for Electron.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Rebuild failed:', err.message);
    process.exit(1);
  });
