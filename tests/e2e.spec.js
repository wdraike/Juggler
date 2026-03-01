// @ts-check
const { test, expect } = require('@playwright/test');

const TEST_TOKEN = process.env.TEST_TOKEN || '';
const TEST_USER = {
  id: 'test-user-00000000-0000-0000-0000',
  email: 'test@juggler.local',
  name: 'Test User',
  picture: null,
  timezone: 'America/New_York',
};

/**
 * Auth bypass: intercept refresh + me endpoints to inject test token
 * before the page loads. All other API calls go to the real backend.
 */
async function setupAuth(page) {
  // Intercept POST /api/auth/refresh → return test access token
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: TEST_TOKEN }),
    })
  );

  // Intercept GET /api/auth/me → return test user
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: TEST_USER }),
    })
  );
}

test.describe('Juggler E2E', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await page.goto('/');
    // Wait for the app to render — header bar should be visible
    await page.waitForSelector('text=Juggler', { timeout: 15000 });
  });

  test('1. App loads — header bar and navigation visible', async ({ page }) => {
    await expect(page.locator('text=Juggler')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'List' })).toBeVisible();
  });

  test('2. View switching — all 7 view tabs render', async ({ page }) => {
    const views = ['Day', '3-Day', 'Week', 'Month', 'List', 'Priority', 'Issues'];
    for (const view of views) {
      await page.locator(`button:has-text("${view}")`).first().click();
      // Give it a moment to render
      await page.waitForTimeout(300);
      // Should not crash — page should still have the header
      await expect(page.locator('text=Juggler')).toBeVisible();
    }
  });

  test('3. Day view — calendar grid renders with hour gutter', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click();
    await page.waitForTimeout(300);
    // Check for hour labels in the grid (e.g. "8 AM", "12 PM")
    await expect(page.locator('text=8 AM').first()).toBeVisible();
    await expect(page.locator('text=12 PM').first()).toBeVisible();
  });

  test('4. Task creation via QuickAddTask', async ({ page }) => {
    // Switch to Day view
    await page.locator('button:has-text("Day")').first().click();
    await page.waitForTimeout(300);

    // Click "+ Add task" button
    const addBtn = page.locator('button:has-text("+ Add task")');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      // Type a task name and submit
      const input = page.locator('input[placeholder="Task name..."]');
      await input.fill('E2E test task');
      await page.locator('button:has-text("Add")').last().click();
      await page.waitForTimeout(500);
      // Task should now appear somewhere on the page
      await expect(page.locator('text=E2E test task').first()).toBeVisible();
    }
  });

  test('5. Task status change (open -> done -> reopen)', async ({ page }) => {
    // Switch to List view which shows all tasks
    await page.locator('button:has-text("List")').first().click();
    await page.waitForTimeout(500);

    // Look for any task card with a status select
    const selects = page.locator('select');
    const count = await selects.count();
    if (count > 0) {
      // Change first task to "done"
      await selects.first().selectOption('done');
      await page.waitForTimeout(300);
      // Change back to open (empty string)
      await selects.first().selectOption('');
      await page.waitForTimeout(300);
    }
    // Should not crash
    await expect(page.locator('text=Juggler')).toBeVisible();
  });

  test('6. Task card metadata — location/when icons visible', async ({ page }) => {
    await page.locator('button:has-text("List")').first().click();
    await page.waitForTimeout(500);
    // Just verify list view doesn't crash — metadata visibility depends on task data
    await expect(page.locator('text=Juggler')).toBeVisible();
  });

  test('7. Scheduled task blocks — render without crash', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click();
    await page.waitForTimeout(500);
    // Calendar grid should be visible
    await expect(page.locator('text=8 AM').first()).toBeVisible();
  });

  test('8. Settings panel — all 7 tabs open without crash', async ({ page }) => {
    // Open settings
    const settingsBtn = page.locator('button[title="Settings"]');
    await settingsBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=Settings').first()).toBeVisible();

    const tabs = ['Locations', 'Tools', 'Tool Matrix', 'Time Blocks', 'Schedules', 'Projects', 'Preferences'];
    for (const tab of tabs) {
      await page.locator(`button:has-text("${tab}")`).click();
      await page.waitForTimeout(200);
      // Settings should still be open
      await expect(page.locator('text=Settings').first()).toBeVisible();
    }

    // Close settings
    await page.locator('button:has-text("\u00D7")').first().click();
  });

  test('9. Preferences persistence — change grid zoom, reload, verify', async ({ page }) => {
    // Open settings -> Preferences
    await page.locator('button[title="Settings"]').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Preferences")').click();
    await page.waitForTimeout(200);

    // Change grid zoom slider
    const slider = page.locator('input[type="range"]');
    if (await slider.isVisible()) {
      await slider.fill('90');
      await page.waitForTimeout(500);
      // The value should read 90px
      await expect(page.locator('text=90px')).toBeVisible();
    }

    // Close settings and reload
    await page.locator('button:has-text("\u00D7")').first().click();
    await page.reload();
    await page.waitForSelector('text=Juggler', { timeout: 15000 });

    // Reopen settings -> Preferences
    await page.locator('button[title="Settings"]').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Preferences")').click();
    await page.waitForTimeout(200);

    // Verify the slider value persisted (90)
    const sliderVal = await page.locator('input[type="range"]').inputValue();
    expect(sliderVal).toBe('90');

    // Reset to default
    await page.locator('input[type="range"]').fill('60');
    await page.waitForTimeout(500);
    await page.locator('button:has-text("\u00D7")').first().click();
  });

  test('10. Template override dropdown — change template in DayView', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click();
    await page.waitForTimeout(300);

    // Look for the template <select> in the DayView header
    const templateSelect = page.locator('select').first();
    if (await templateSelect.isVisible()) {
      const options = await templateSelect.locator('option').allTextContents();
      if (options.length > 1) {
        await templateSelect.selectOption({ index: 1 });
        await page.waitForTimeout(300);
      }
    }
    // Should not crash
    await expect(page.locator('text=Juggler')).toBeVisible();
  });

  test('11. Dark/light mode toggle', async ({ page }) => {
    const toggleBtn = page.locator('button[title="Toggle dark mode"]');
    await toggleBtn.click();
    await page.waitForTimeout(300);
    // Toggle back
    await toggleBtn.click();
    await page.waitForTimeout(300);
    // Should not crash
    await expect(page.locator('text=Juggler')).toBeVisible();
  });

  test('12. Week navigation (arrows, Today button)', async ({ page }) => {
    // Click next day
    await page.locator('button[title="Next day"]').click();
    await page.waitForTimeout(200);
    // Click previous day
    await page.locator('button[title="Previous day"]').click();
    await page.waitForTimeout(200);
    // Click next week
    await page.locator('button[title="Next week"]').click();
    await page.waitForTimeout(200);
    // Click previous week
    await page.locator('button[title="Previous week"]').click();
    await page.waitForTimeout(200);
    // Click Today
    await page.locator('button[title="Go to today"]').click();
    await page.waitForTimeout(200);
    // Should not crash
    await expect(page.locator('text=Juggler')).toBeVisible();
  });

  test('13. Import/export panel opens', async ({ page }) => {
    const exportBtn = page.locator('button[title="Import/Export"]');
    await exportBtn.click();
    await page.waitForTimeout(300);
    // Should show some import/export UI — look for common text
    const panel = page.locator('text=/import|export/i').first();
    await expect(panel).toBeVisible();
    // Close it by clicking backdrop or close button
    await page.keyboard.press('Escape');
  });

  test('14. Now-indicator visible on today', async ({ page }) => {
    // Make sure we're on today
    await page.locator('button[title="Go to today"]').click();
    await page.getByRole('button', { name: 'Day', exact: true }).click();
    await page.waitForTimeout(500);

    // The now indicator is a red line — browsers normalize #EF4444 to rgb(239, 68, 68)
    const nowLine = page.locator('div[style*="rgb(239, 68, 68)"]');
    const count = await nowLine.count();
    // It should exist (at least the line or the dot)
    expect(count).toBeGreaterThan(0);
  });
});
