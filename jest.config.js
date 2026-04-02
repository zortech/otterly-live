'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/server/**/*.test.js'],
  moduleNameMapper: {
    // Native modules that can't run under Jest — replaced with in-memory mocks
    '^keytar$': '<rootDir>/__mocks__/keytar.js',
    '^electron-log/main$': '<rootDir>/__mocks__/electron-log.js',
    '^electron-log/node$': '<rootDir>/__mocks__/electron-log.js',
    '^electron-log$': '<rootDir>/__mocks__/electron-log.js',
    '^electron$': '<rootDir>/__mocks__/electron.js',
    '^ffmpeg-static$': '<rootDir>/__mocks__/ffmpeg-static.js',
  },
  clearMocks: true,
  restoreMocks: true,
};
