// @covers screen:login
/*
 * ============================================================================
 *  AUTHORED, NOT RUN — foundation scaffold for backlog 999.884.
 * ============================================================================
 *  ANNOTATION CONVENTION
 *  ---------------------
 *  Each spec declares the UI-map ids it exercises with a line comment of the
 *  form "(slash-slash) @covers <id>" where <id> is a screen/modal/path id
 *  from e2e/ui-map.json
 *  (e.g. screen:login, modal:settings, path:14). collect-coverage.js harvests
 *  these annotations to compute UI coverage. One spec may carry several.
 *
 *  These tests are NOT run yet: @playwright/test is not installed and there is
 *  no safe target. Running requires David's greenlit setup (see
 *  playwright.config.js header) against an ephemeral/test stack — NEVER dev.
 *
 *  Assertions below are illustrative of the PATTERN we standardize on:
 *    content (headings, button text) · layout (key regions present) ·
 *    help/instruction text · branding (brand color tokens from theme/colors.js).
 * ============================================================================
 */
const { test, expect } = require('@playwright/test');
// RGB→HEX REFERENCE PATTERN for the 999.884 decomposition — copy THIS import, not the old
// startsWith('#') ternary (which was a tautology: always substituted the expected token).
const { rgbToHex, BRAND_HEXES } = require('./brand-helpers');

test.describe('Login screen (screen:login)', () => {
  test.beforeEach(async ({ page }) => {
    // Unauthenticated: App.js renders LoginPage when useAuth().user is falsy.
    await page.goto('/');
  });

  test('content: shows product heading and a Sign In affordance', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /juggler/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('help text: explains what signing in does', async ({ page }) => {
    // Instruction/help copy should orient a first-time visitor.
    await expect(page.getByText(/sign in to (continue|manage|access)/i)).toBeVisible();
  });

  test('branding: primary action carries a brand color token', async ({ page }) => {
    // Asserts REAL branding conformance — fails on any non-brand color (e.g. plain white).
    // rgbToHex converts browser's 'rgb(r,g,b)' to uppercase #RRGGBB before the membership check.
    const signIn = page.getByRole('button', { name: /sign in/i });
    const bg = await signIn.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(BRAND_HEXES).toContain(rgbToHex(bg));
  });
});
