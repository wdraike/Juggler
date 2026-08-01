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
  // Progressive reporter, deliberately not the CI default. Playwright picks
  // 'dot' when CI is set and buffers every failure detail to the end of the
  // run — but this suite is invoked under `timeout 900`, and a timeout kill
  // lands before that summary is ever written. Two full CI runs (30715466353,
  // 30720107084) therefore produced nothing but progress characters:
  //   Running 313 tests using 1 worker, shard 1 of 2
  //   TTTTTTTTTTTTFFFFFFFFFFFFFFFTTTTTTT
  // — no test name, no error, no URL, for 30 minutes of wall clock each time.
  // 'list' prints each test and its error AS IT FINISHES, so a killed run
  // still leaves a readable trail. 999.5080.
  reporter: 'list',
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
