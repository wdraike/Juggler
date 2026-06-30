// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
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
