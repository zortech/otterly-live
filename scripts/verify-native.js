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

// Pure-JS deps that are sensitive to the bundled Node version. undici@8 needs a
// newer Node than Electron 33 ships and throws at require time
// (webidl.util.markAsUncloneable is not a function); loading these here catches
// that class of breakage in CI instead of on the user's machine.
for (const mod of ['undici', 'node-media-server', 'socket.io', 'socket.io-client', '@grpc/grpc-js', 'ws']) {
  check(mod, () => require(mod));
}

if (!ok) {
  console.error('\nNative module verification FAILED - wrong ABI for this Electron version.');
  process.exit(1);
}
console.log('\nAll native modules load correctly under this Electron ABI.');
