'use strict';

/**
 * electron-builder afterSign hook.
 *
 * Re-signs the FFmpeg binary with Hardened Runtime entitlements after the
 * main app bundle is signed. `--deep` signing on the app bundle does not
 * apply entitlements to nested binaries, causing FFmpeg to crash under
 * macOS Gatekeeper.
 *
 * Only runs on macOS. No-op on other platforms.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterSign(context) {
  if (process.platform !== 'darwin') return;

  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;

  // Resolve signing identity — prefer CSC_NAME env var, fall back to context
  const identity =
    process.env.CSC_NAME ||
    process.env.CSC_IDENTITY ||
    (packager.platformSpecificBuildOptions && packager.platformSpecificBuildOptions.identity);

  if (!identity) {
    console.warn('[after-sign] No signing identity found — skipping FFmpeg re-sign.');
    console.warn('[after-sign] Set CSC_NAME env var to your "Developer ID Application" certificate name.');
    return;
  }

  const ffmpegBin = path.join(
    appOutDir,
    `${appName}.app`,
    'Contents', 'Resources', 'app.asar.unpacked',
    'node_modules', 'ffmpeg-static', 'ffmpeg'
  );

  if (!fs.existsSync(ffmpegBin)) {
    console.warn(`[after-sign] FFmpeg binary not found at: ${ffmpegBin}`);
    console.warn('[after-sign] Check asarUnpack config includes node_modules/ffmpeg-static/ffmpeg');
    return;
  }

  const entitlementsPath = path.resolve(__dirname, '..', 'entitlements.plist');

  console.log(`[after-sign] Re-signing FFmpeg: ${ffmpegBin}`);
  console.log(`[after-sign] Identity: ${identity}`);
  console.log(`[after-sign] Entitlements: ${entitlementsPath}`);

  try {
    execFileSync('codesign', [
      '--force',
      '--options', 'runtime',
      '--entitlements', entitlementsPath,
      '--sign', identity,
      ffmpegBin,
    ], { stdio: 'inherit' });
    console.log('[after-sign] FFmpeg re-signed successfully.');
  } catch (err) {
    console.error('[after-sign] FFmpeg re-sign failed:', err.message);
    throw err; // Fail the build — an unsigned FFmpeg will crash under Gatekeeper
  }
};
