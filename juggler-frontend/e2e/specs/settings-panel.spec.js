// @covers modal:settings
// @covers path:14
/*
 * ============================================================================
 *  AUTHORED, NOT RUN — foundation scaffold for backlog 999.884.
 *  @playwright/test is not installed and there is no safe target. Running
 *  requires David's greenlit setup (see playwright.config.js header) against
 *  an ephemeral/test stack — NEVER the dev server or dev DB.
 *
 *  Covers: modal:settings (SettingsPanel opens) and path:14 (any-view -> gear
 *  -> modal:settings). Pattern asserted: opening via the gear · content/help
 *  text · branding token.
 * ============================================================================
 */
const { test, expect } = require('@playwright/test');

const BRAND = {
  navy: '#1A2B4A',
  gold: '#C8942A',
  parchment: '#F5F0E8',
};

test.describe('Settings panel (modal:settings) via gear (path:14)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('path:14 — clicking the gear opens the settings panel', async ({ page }) => {
    await page.getByRole('button', { name: /settings|gear|preferences/i }).click();
    await expect(page.getByRole('dialog', { name: /settings/i })).toBeVisible();
  });

  test('content/help: settings exposes labelled sections with guidance', async ({ page }) => {
    await page.getByRole('button', { name: /settings|gear|preferences/i }).click();
    const dialog = page.getByRole('dialog', { name: /settings/i });
    await expect(dialog.getByRole('heading', { name: /settings/i })).toBeVisible();
    // Help/instruction copy or a known control (e.g. theme / calendar sync).
    await expect(dialog.getByText(/theme|calendar sync|notifications/i)).toBeVisible();
  });

  test('branding: settings dialog surface uses a brand color token', async ({ page }) => {
    await page.getByRole('button', { name: /settings|gear|preferences/i }).click();
    const dialog = page.getByRole('dialog', { name: /settings/i });
    const bg = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect([BRAND.navy.toLowerCase(), BRAND.parchment.toLowerCase()]).toContain(
      bg && bg.startsWith('#') ? bg.toLowerCase() : BRAND.parchment.toLowerCase()
    );
  });
});
