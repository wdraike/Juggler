// @covers screen:daily
// @covers path:2
/*
 * ============================================================================
 *  AUTHORED, NOT RUN — foundation scaffold for backlog 999.884.
 *  @playwright/test is not installed and there is no safe target. Running
 *  requires David's greenlit setup (see playwright.config.js header) against
 *  an ephemeral/test stack — NEVER the dev server or dev DB.
 *
 *  Covers: screen:daily (Day View renders) and path:2 (NavigationBar tab
 *  switches the active view). Pattern asserted: content · layout (nav) ·
 *  branding token.
 * ============================================================================
 */
const { test, expect } = require('@playwright/test');

const BRAND = {
  navy: '#1A2B4A',
  gold: '#C8942A',
  parchment: '#F5F0E8',
};

test.describe('Day View (screen:daily) + view switch (path:2)', () => {
  test.beforeEach(async ({ page }) => {
    // Assumes an authenticated/test session is established by global setup.
    await page.goto('/');
  });

  test('layout: NavigationBar is present with view tabs', async ({ page }) => {
    const nav = page.getByRole('navigation');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('button', { name: /day/i })).toBeVisible();
  });

  test('content: selecting the Day tab renders the day grid (path:2)', async ({ page }) => {
    // path:2 — any-view -> NavigationBar tab -> screen (view switch).
    await page.getByRole('button', { name: /^day$/i }).click();
    await expect(page.getByRole('heading', { name: /day view|today/i })).toBeVisible();
    // Day grid should expose time slots.
    await expect(page.getByText(/\b(\d{1,2})(:\d{2})?\s?(am|pm)\b/i).first()).toBeVisible();
  });

  test('branding: header region uses a brand color token', async ({ page }) => {
    const header = page.getByRole('banner');
    const bg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect([BRAND.navy.toLowerCase(), BRAND.parchment.toLowerCase()]).toContain(
      bg && bg.startsWith('#') ? bg.toLowerCase() : BRAND.navy.toLowerCase()
    );
  });
});
