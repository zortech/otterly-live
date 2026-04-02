import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:3737',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the Express server before running tests.
  // Requires the Angular frontend to be pre-built: npm run build:frontend
  webServer: {
    command: 'node server/index.js',
    url: 'http://localhost:3737/api/health',
    reuseExistingServer: !process.env['CI'],
    timeout: 30000,
    env: {
      OTTERY_DEV: 'false',
    },
  },
});
