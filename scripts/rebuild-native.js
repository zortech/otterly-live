#!/usr/bin/env node
// Rebuilds native modules (better-sqlite3, keytar, ...) against the ABI of the
// Electron version that is actually installed. Hardcoding the version lets it
// drift from devDependencies, which ships a binary with the wrong
// NODE_MODULE_VERSION and crashes the packaged app on load before any window
// or log appears. Always read it from the installed electron package.
const { rebuild } = require('@electron/rebuild');

const electronVersion = require('electron/package.json').version;

console.log(`Rebuilding native modules for Electron ${electronVersion}...`);

rebuild({ buildPath: process.cwd(), electronVersion, force: true })
  .then(() => {
    console.log(`Native modules rebuilt for Electron ${electronVersion}.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Rebuild failed:', err.message);
    process.exit(1);
  });
