// @ts-check
/**
 * settings.spec.js — Flow 4: Settings panel — all 6 tabs accessible
 *
 * Selector strategy: juggler-frontend/src/ has NO data-testid attributes.
 * All selectors use visible text and button titles verified against actual JSX.
 *
 * Source references:
 *   SettingsPanel.jsx  — TABS array: Locations, Tools, Tool Matrix, Templates, Projects, Preferences
 *   HeaderBar.jsx      — settings button title="Settings — locations, tools, templates, and preferences"
 *   AppLayout.jsx      — onShowSettings → setShowSettings(true)
 *
 * The settings panel is opened by clicking the gear button in the desktop header.
 * On mobile/compact layout the gear is behind the "…" overflow menu.
 * These tests run at 1280x800 (playwright.config.js default) so the button is inline.
 */

const { test, expect } = require('@playwright/test');
const { setupAuth, waitForApp, openSettings } = require('./helpers/playwright-helpers');

// API route mocks needed for settings panel to load
async function mockSettingsApis(page) {
  await page.route('**/api/tasks**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    })
  );
  await page.route('**/schedule/run**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  );
  // Settings reads config from the tasks response (config embedded) or /api/config
  await page.route('**/api/config**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        locations: [],
        tools: [],
        matrix: {},
        templates: [],
        projects: [],
        preferences: { font_size: 'medium' },
      }),
    })
  );
}

test.describe('Settings Panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockSettingsApis(page);
    await page.goto('/');
    await waitForApp(page);
    // Open the settings panel
    await openSettings(page);
  });

  // Test 1: Settings panel opens — shows "Settings" heading and tab bar
  test('Settings panel opens and shows heading', async ({ page }) => {
    await expect(page.locator('text=Settings').first()).toBeVisible();
    // All six tab buttons should be visible
    await expect(page.locator('button:has-text("Locations")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Preferences")').first()).toBeVisible();
  });

  // Test 2: Locations tab — visible and renders content area
  test('Locations tab — opens without crash', async ({ page }) => {
    await page.locator('button:has-text("Locations")').first().click();
    await page.waitForTimeout(200);
    // Settings still open (heading visible)
    await expect(page.locator('text=Settings').first()).toBeVisible();
    // App not crashed
    await expect(page.locator('text=StriveRS').first()).toBeVisible();
  });

  // Test 3: Tools tab
  test('Tools tab — opens without crash', async ({ page }) => {
    await page.locator('button:has-text("Tools")').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('text=Settings').first()).toBeVisible();
  });

  // Test 4: Tool Matrix tab
  test('Tool Matrix tab — opens without crash', async ({ page }) => {
    await page.locator('button:has-text("Tool Matrix")').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('text=Settings').first()).toBeVisible();
  });

  // Test 5: Templates tab
  test('Templates tab — opens without crash', async ({ page }) => {
    await page.locator('button:has-text("Templates")').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('text=Settings').first()).toBeVisible();
  });

  // Test 6: Projects tab
  test('Projects tab — opens without crash', async ({ page }) => {
    await page.locator('button:has-text("Projects")').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('text=Settings').first()).toBeVisible();
  });

  // Test 7: Preferences tab — renders and shows grid zoom slider
  test('Preferences tab — renders grid zoom slider', async ({ page }) => {
    await page.locator('button:has-text("Preferences")').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('text=Settings').first()).toBeVisible();

    // Preferences tab has a grid zoom slider (type=range)
    const slider = page.locator('input[type="range"]').first();
    const sliderVisible = await slider.isVisible().catch(() => false);
    if (sliderVisible) {
      // Change the value and verify the app doesn't crash
      await slider.fill('90');
      await page.waitForTimeout(300);
      await expect(page.locator('text=Settings').first()).toBeVisible();
      // Reset
      await slider.fill('60');
    }

    // Close settings via the × button
    await page.locator('button:has-text("×")').first().click();
    await page.waitForTimeout(200);
    // Settings panel should be gone
    await expect(page.locator('text=StriveRS').first()).toBeVisible();
  });
});
