#!/usr/bin/env node
/**
 * Generates platform icon assets from assets/icon.png.
 *
 * Outputs:
 *   assets/icon.ico   — Windows (multi-resolution: 16, 32, 48, 256px)
 *   assets/icon.icns  — macOS
 *
 * Prerequisites:
 *   npm install --save-dev png2icons
 *
 * Usage:
 *   node scripts/generate-icons.js
 *
 * Note: For production-quality macOS icons, prefer using Xcode's iconutil
 * with a proper .iconset directory. This script is suitable for development
 * builds.
 */

'use strict';

const path = require('path');
const fs = require('fs');

let png2icons;
try {
  png2icons = require('png2icons');
} catch {
  console.error('Missing dependency: npm install --save-dev png2icons');
  process.exit(1);
}

const src = path.resolve(__dirname, '../assets/icon.png');
const outIco = path.resolve(__dirname, '../assets/icon.ico');
const outIcns = path.resolve(__dirname, '../assets/icon.icns');

if (!fs.existsSync(src)) {
  console.error(`Source icon not found: ${src}`);
  process.exit(1);
}

const srcBuf = fs.readFileSync(src);

// Generate .icns (macOS)
const icns = png2icons.createICNS(srcBuf, png2icons.BILINEAR, 0);
if (!icns) {
  console.error('Failed to generate .icns');
  process.exit(1);
}
fs.writeFileSync(outIcns, icns);
console.log('Written:', outIcns);

// Generate .ico (Windows)
const ico = png2icons.createICO(srcBuf, png2icons.BILINEAR, 0, true, true);
if (!ico) {
  console.error('Failed to generate .ico');
  process.exit(1);
}
fs.writeFileSync(outIco, ico);
console.log('Written:', outIco);

console.log('Icon generation complete.');
