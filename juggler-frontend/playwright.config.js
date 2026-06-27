/*
 * ============================================================================
 *  NOT YET INSTALLED / NOT YET RUNNABLE — READ BEFORE USE
 * ============================================================================
 *  @playwright/test is NOT a dependency of this project. It is intentionally
 *  NOT added to package.json. This config is the FOUNDATION scaffold for
 *  backlog 999.884.
 *
 *  Two spec trees are picked up (see testMatch below):
 *      - tests/e2e/**\/*.spec.js  — the pre-existing smoke suite (login,
 *                                   calendar, task-crud, mcp, import-mode-picker)
 *      - e2e/specs/**\/*.spec.js  — the new per-surface specs being authored
 *                                   against e2e/ui-map.json
 *  Both are authored-not-run.
 *
 *  Running the suite requires an explicit David-greenlit setup:
 *      1. npm i -D @playwright/test
 *      2. npx playwright install
 *      3. Point baseURL at a SAFE target — an EPHEMERAL / TEST stack
 *         (e.g. test-bed), NEVER the dev server or dev DB. A prior live-UAT
 *         agent left 281 junk rows in the dev DB; do not repeat that.
 *
 *  baseURL is env-driven so a safe target is supplied WITHOUT editing this
 *  file (PLAYWRIGHT_BASE_URL / FRONTEND_URL). The localhost:3002 literal is a
 *  last-resort placeholder, NOT an endorsement of running against dev.
 *
 *  Until then, do NOT run `npx playwright test`. The pure coverage tooling
 *  (e2e/coverage/*) runs without a browser via `node --test`.
 * ============================================================================
 */
// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  // Root the runner at the project so BOTH spec trees are reachable, and match
  // them explicitly. Adding the new e2e/specs tree must NOT orphan the
  // pre-existing tests/e2e smoke suite.
  testDir: '.',
  testMatch: ['tests/e2e/**/*.spec.js', 'e2e/specs/**/*.spec.js'],
  timeout: 30000,
  retries: 0,
  use: {
    // Env-driven safe target — MUST be an EPHEMERAL/TEST stack.
    // Set PLAYWRIGHT_BASE_URL or FRONTEND_URL; omitting both throws so the
    // runner can NEVER silently aim at the dev server.
    baseURL: (() => {
      const url = process.env.PLAYWRIGHT_BASE_URL || process.env.FRONTEND_URL;
      if (!url) {
        throw new Error(
          'PLAYWRIGHT_BASE_URL or FRONTEND_URL must be set to a SAFE ephemeral/test target. ' +
          'Defaulting to the dev server (localhost:3002) is forbidden — ' +
          'a prior live-UAT agent left 281 junk rows in the dev DB.'
        );
      }
      return url;
    })(),
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
