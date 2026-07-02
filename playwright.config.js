// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Playwright's default testMatch also picks up *.test.js — but tests/ mixes real
  // e2e specs (*.spec.js) with jest unit tests (*.test.js, e.g. tests/api/*.test.js,
  // tests/helpers/mockChainDb.js). Narrow to *.spec.js only, or `npx playwright test`
  // tries to run jest files under the Playwright runner (jest global undefined, crash).
  testMatch: '**/*.spec.js',
  timeout: 30000,
  retries: 0,
  use: {
    // Caddy HTTPS reverse proxy — set PLAYWRIGHT_BASE_URL to override
    baseURL: process.env.PLAYWRIGHT_BASE_URL || process.env.FRONTEND_URL || 'https://juggler.test.raike.local:8443',
    ignoreHTTPSErrors: true, // self-signed certs in CI/UAT
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
