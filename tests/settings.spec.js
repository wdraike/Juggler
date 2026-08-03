// @ts-check
/**
 * settings.spec.js — Flow 4: Settings panel — all 7 tabs accessible
 *
 * Selector strategy: juggler-frontend/src/ has NO data-testid attributes.
 * All selectors use roles, visible text and button titles verified against actual JSX.
 *
 * Source references:
 *   SettingsPanel.jsx  — TABS array: Locations, Tools, Tool Matrix, Templates,
 *                        Projects, Preferences, Notifications (role="tab" each)
 *   UserDropdown.jsx   — "Settings" menu item behind the avatar button (wide layout)
 *   HeaderBar.jsx      — "Settings" item in the "More options" overflow menu (<920px)
 *   AppLayout.jsx      — onShowSettings → setShowSettings(true)
 *
 * There is no Settings header button: openSettings() opens whichever menu the
 * current viewport renders and clicks the item. These tests run at 1280x800
 * (playwright.config.js default), i.e. the user-dropdown path.
 */

const { test, expect } = require('@playwright/test');
const { setupAuth, waitForApp, openSettings, SELECTORS } = require('./helpers/playwright-helpers');

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

  // Test 1: Settings panel opens — dialog plus the full tab bar
  test('Settings panel opens and shows every tab', async ({ page }) => {
    await expect(page.locator(SELECTORS.SETTINGS_DIALOG)).toBeVisible();
    // TABS array in SettingsPanel.jsx:15 — 7 entries, each rendered role="tab"
    await expect(page.getByRole('tab')).toHaveCount(7);
  });

  // Tests 2-8: each tab renders its own content, not just a persistent heading.
  // Anchor text verified against the live rendered panel, per tab.
  const TAB_CONTENT = [
    ['Locations',   'Locate me'],                                    // LocationsTab.jsx per-location geo button
    ['Tools',       'Tool name'],                                    // ToolsTab.jsx add-tool input placeholder
    ['Tool Matrix', 'Which tools are available at each location'],   // MatrixTab.jsx subtitle
    ['Templates',   'Pick a location, then click or drag'],          // UnifiedTemplateTab.jsx paint hint
    ['Projects',    'Sort:'],                                        // ProjectsTab.jsx sort control
    ['Preferences', 'Grid zoom (px/hour):'],                         // PreferencesTab.jsx slider label
    ['Notifications', 'Browser notifications'],                      // NotificationsTab.jsx heading
  ];

  for (const [label, anchor] of TAB_CONTENT) {
    test(`${label} tab — selects and renders its own content`, async ({ page }) => {
      const tab = page.getByRole('tab', { name: label, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const panel = page.locator(SELECTORS.SETTINGS_DIALOG);
      if (label === 'Tools') {
        await expect(panel.locator(`input[placeholder="${anchor}"]`)).toBeVisible();
      } else {
        await expect(panel.getByText(anchor, { exact: false }).first()).toBeVisible();
      }
    });
  }

  // Test 9: Preferences grid-zoom slider moves and its label follows
  test('Preferences — grid zoom slider updates its label, × closes the panel', async ({ page }) => {
    await page.getByRole('tab', { name: 'Preferences', exact: true }).click();
    const panel = page.locator(SELECTORS.SETTINGS_DIALOG);
    // 2 range inputs: font size (0) and grid zoom (1) — PreferencesTab.jsx
    const slider = panel.locator('input[type="range"]').nth(1);
    await expect(slider).toBeVisible();
    await expect(panel.getByText('60px')).toBeVisible();
    await slider.fill('90');
    await expect(panel.getByText('90px')).toBeVisible();
    await slider.fill('60');

    await panel.locator('button:has-text("×")').first().click();
    await expect(page.locator(SELECTORS.SETTINGS_DIALOG)).toHaveCount(0);
  });
});
