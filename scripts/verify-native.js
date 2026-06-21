#!/usr/bin/env node
// Loads the native modules under Electron's runtime/ABI and fails loudly if any
// of them were built for the wrong NODE_MODULE_VERSION. Run with:
//   ELECTRON_RUN_AS_NODE=1 electron scripts/verify-native.js
// (the `verify:native` npm script does this). This is the gate that catches an
// ABI mismatch in CI instead of shipping a packaged app that crashes silently
// on the user's machine before any window or log appears.
let ok = true;

function check(name, fn) {
  try {
    fn();
    console.log(`  OK   ${name}`);
  } catch (err) {
    ok = false;
    console.error(`  FAIL ${name}: ${err.message}`);
  }
}

console.log(`Verifying native modules under ABI MODULE_VERSION ${process.versions.modules} (node ${process.version})`);

check('better-sqlite3', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.prepare('CREATE TABLE t (x)').run();
  db.prepare('SELECT 1 AS ok').get();
  db.close();
});

check('keytar', () => {
  // Loading the binding is enough to prove the ABI matches; no keychain access.
  require('keytar');
});

if (!ok) {
  console.error('\nNative module verification FAILED - wrong ABI for this Electron version.');
  process.exit(1);
}
console.log('\nAll native modules load correctly under this Electron ABI.');
