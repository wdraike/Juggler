/**
 * 999.498 — Live UAT for the import mode-picker dialog.
 *
 * Verifies the real, in-browser interaction/visual contract of the
 * "How should we import?" mode-picker (ImportExportPanel.jsx), which the RTL
 * suite (__tests__/ImportExportPanel.importMode.test.jsx) cannot observe:
 *   1. backdrop dimming  — the modal wrapper paints a translucent black scrim
 *   2. danger border     — the destructive "Replace all" option has a red
 *                          border, visually distinct from the neutral "Merge"
 *   3. focus management  — focus lands on the safe Cancel button on open, and
 *                          RETURNS to the "Import Data" trigger when the dialog
 *                          is dismissed (Escape and backdrop-click).
 *
 * Runs against the live worktree dev server (PORT=3012). Auth: relies on the
 * shared auth-service session; if no session cookie is present it falls back to
 * a credentialed login with the seeded test account.
 *
 * Run:
 *   PW_BASE_URL=http://localhost:3012 npx playwright test import-mode-picker.spec.js
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.PW_BASE_URL || 'http://localhost:3012';
const TEST_EMAIL = process.env.PW_TEST_EMAIL || 'test-free@raike.test';
const TEST_PASSWORD = process.env.PW_TEST_PASSWORD || 'TestPass123!';

// Danger border colour comes from theme.error (light) / theme.redText (dark).
// rgb forms of #8B2635 and #FCA5A5 — we assert the destructive border is one of
// these AND differs from the neutral merge border, rather than pinning a theme.
const DANGER_RGB = new Set(['rgb(139, 38, 53)', 'rgb(252, 165, 165)']);

async function login(page) {
  await page.goto(BASE_URL);

  // Already authenticated (shared session) → app shell renders the toolbar.
  const toolbar = page.locator('button:has-text("📦")'); // 📦 Import/Export
  if (await toolbar.count() > 0 && await toolbar.first().isVisible().catch(() => false)) {
    return;
  }

  // Click the top "Sign In" button → auth-service. If the shared session is
  // live this auto-completes the OAuth callback; otherwise we land on the
  // credentialed login form. (May take a click to leave the landing page.)
  const signIn = page.locator('button', { hasText: /^sign in$/i }).first();
  await signIn.click().catch(() => {});

  // If we hit the auth-service login form, submit the seeded credentials.
  await page.waitForLoadState('networkidle').catch(() => {});
  const emailField = page.getByRole('textbox', { name: /email/i });
  if (await emailField.count() > 0 && await emailField.isVisible().catch(() => false)) {
    await emailField.fill(TEST_EMAIL);
    await page.getByRole('textbox', { name: /password/i }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();
  }

  // Back on the app, signed in — wait for the toolbar to appear.
  await page.waitForURL(new RegExp(BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?$'), { timeout: 15000 }).catch(() => {});
  await expect(page.locator('button:has-text("📦")').first()).toBeVisible({ timeout: 15000 });
}

// Opens Import/Export, pastes valid JSON, clicks "Import Data" → mode picker.
async function openModePicker(page) {
  await page.locator('button:has-text("📦")').first().click();
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible({ timeout: 10000 });
  await textarea.fill('{"tasks":[]}');
  await page.locator('button:has-text("Import Data")').click();
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toBeVisible({ timeout: 10000 });
}

test.describe('999.498 — Import mode-picker dialog (live UAT)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('backdrop dims, destructive option has danger border', async ({ page }) => {
    await openModePicker(page);

    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toHaveCSS('background-color', /rgba\(0,\s*0,\s*0,\s*0?\.\d+\)/);

    const replaceBtn = dialog.locator('button[aria-label*="Replace all"]');
    const mergeBtn = dialog.locator('button', { hasText: 'Merge' });
    await expect(replaceBtn).toBeVisible();
    await expect(mergeBtn).toBeVisible();

    const replaceBorder = await replaceBtn.evaluate((el) => getComputedStyle(el).borderTopColor);
    const mergeBorder = await mergeBtn.evaluate((el) => getComputedStyle(el).borderTopColor);

    expect(DANGER_RGB.has(replaceBorder),
      `Replace-all border ${replaceBorder} should be a theme danger colour`).toBe(true);
    expect(replaceBorder,
      'destructive border must be visually distinct from the neutral Merge border')
      .not.toBe(mergeBorder);
  });

  test('focus starts on Cancel and returns to trigger on Escape', async ({ page }) => {
    await openModePicker(page);

    // Safe default: focus is on Cancel when the dialog opens.
    const focusedText = await page.evaluate(() =>
      (document.activeElement && document.activeElement.innerText || '').trim());
    expect(focusedText).toBe('Cancel');

    await page.keyboard.press('Escape');

    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
    const returnedToTrigger = await page.evaluate(() =>
      !!(document.activeElement &&
         (document.activeElement.innerText || '').includes('Import Data')));
    expect(returnedToTrigger,
      'focus must return to the "Import Data" trigger after dismissing the dialog').toBe(true);
  });

  test('backdrop click cancels and returns focus to trigger', async ({ page }) => {
    await openModePicker(page);

    // Click the scrim (top-left corner of the full-screen wrapper, away from
    // the inner card) → cancelImportMode → focus back to trigger.
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await dialog.click({ position: { x: 5, y: 5 } });

    await expect(dialog).toHaveCount(0);
    const returnedToTrigger = await page.evaluate(() =>
      !!(document.activeElement &&
         (document.activeElement.innerText || '').includes('Import Data')));
    expect(returnedToTrigger,
      'backdrop-click dismissal must also restore focus to the trigger').toBe(true);
  });
});
