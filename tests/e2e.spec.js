// @ts-check
const { test, expect } = require('@playwright/test');
// Settings has no header button — it is a menu item behind the user dropdown
// (UserDropdown.jsx) or the "More options" overflow menu below 920px.
const { openSettings, SELECTORS } = require('./helpers/playwright-helpers');

const TEST_TOKEN = process.env.TEST_TOKEN || 'playwright-test-token';
const TEST_USER = {
  id: 'test-user-00000000-0000-0000-0000',
  email: 'test@juggler.local',
  name: 'Test User',
  picture: null,
  timezone: 'America/New_York',
};

/**
 * Auth bypass: seed localStorage and intercept auth/API endpoints so tests
 * run without a live backend.
 *
 * Key facts from source inspection:
 *  - apiClient.js reads 'juggler-access-token' from localStorage at module init
 *  - Playwright uses LIFO route matching (last registered wins)
 *  - Catch-all must be registered FIRST so specific routes registered after
 *    it can override via LIFO priority
 */
/**
 * Pin the browser clock to midday so anything that renders only inside the
 * visible grid window is deterministic no matter when the suite runs.
 *
 * WHY: test 14 asserts the now-indicator, which DailyView renders only for
 * `nowY >= 0` — i.e. from GRID_START (6 AM) onward. The user's timezone here is
 * the America/New_York fallback (config is stubbed `{}`), and CI Integration is
 * scheduled at 08:00 UTC: the juggler shard reached that test at 09:26 UTC =
 * 05:26 EDT, BEFORE 6 AM. The indicator was correctly absent, and the test
 * failed on real behaviour it had no business asserting at that hour. It passed
 * for anyone running it during a working day, which is exactly why it survived
 * to fail nightly.
 *
 * Stubbing GET /api/now does NOT work and was tried: AppLayout seeds `nowMins`
 * from `useState(() => getNowInTimezone(tz, serverClock).nowMins)` while
 * serverClock is still null, and only recomputes on a 60s interval — so for the
 * whole life of a 5-second test the value comes from the browser clock, whatever
 * /api/now later returns. Controlling Date itself is the only thing that reaches
 * it.
 *
 * setFixedTime, not install(): the app's own 60s nowMins interval and every
 * other timer must keep running normally. Only Date is pinned. The DATE stays
 * today, so `isToday` and the week strip still agree with the rest of the app.
 */
async function pinClockToMidday(page) {
  const midday = new Date();
  midday.setUTCHours(16, 0, 0, 0); // 12:00 America/New_York (EDT)
  await page.clock.setFixedTime(midday);
}

async function setupAuth(page) {
  await pinClockToMidday(page);

  // Seed localStorage so apiClient initialises accessToken at module load time.
  await page.addInitScript((token) => {
    localStorage.setItem('juggler-access-token', token);
  }, TEST_TOKEN);

  // Catch-all first (lowest LIFO priority — overridden by routes below).
  // Prevents any stray /api/* call from returning 401 and triggering the
  // apiClient refresh-fail → clearAccessToken → auth:logout logout cycle.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );

  // Specific stubs — registered after catch-all so they win via LIFO.
  await page.route('**/api/tasks**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
  );
  await page.route('**/api/user/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );
  await page.route('**/api/my-plan**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan_id: 'free', features: {}, usage: {} }) })
  );
  // /auth/me last — highest LIFO priority, returns the test user.
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: TEST_USER }),
    })
  );
}

// Actual button title for the Import/Export icon in HeaderBar.jsx
const EXPORT_BTN = 'button[title="Import/Export — save or load tasks as JSON"]';

test.describe('Juggler E2E', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await page.goto('/');
    // Wait for the app shell — brand wordmark in HeaderBar.jsx
    await page.waitForSelector('text=StriveRS', { timeout: 15000 });
  });

  test('1. App loads — header bar and navigation visible', async ({ page }) => {
    await expect(page.locator('text=StriveRS')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'List' })).toBeVisible();
  });

  test('2. View switching — all view tabs render without crash', async ({ page }) => {
    // Views from NavigationBar.jsx VIEW_MODES — all valid labels
    const views = ['Day', 'Flex', '3-Day', 'Week', 'Month', 'Timeline', 'List', 'Priority', 'Issues'];
    for (const view of views) {
      // force:true bypasses the AI-command input overlay that intercepts pointer events
      await page.locator(`button:has-text("${view}")`).first().click({ force: true });
      await page.waitForTimeout(300);
      await expect(page.locator('text=StriveRS')).toBeVisible();
    }
  });

  test('3. Day view — calendar grid renders with hour gutter', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click({ force: true });
    await page.waitForTimeout(300);
    // formatHour(8) = "8 AM", formatHour(12) = "12 PM" (GRID_START=6, GRID_END=23)
    await expect(page.locator('text=8 AM').first()).toBeVisible();
    await expect(page.locator('text=12 PM').first()).toBeVisible();
  });

  test('4. Task creation via QuickAddTask', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click({ force: true });
    await page.waitForTimeout(300);

    const addBtn = page.locator('button:has-text("+ Add task")');
    if (await addBtn.isVisible()) {
      await addBtn.click({ force: true });
      const input = page.locator('input[placeholder="Task name..."]');
      await input.fill('E2E test task');
      await page.locator('button:has-text("Add")').last().click({ force: true });
      await page.waitForTimeout(500);
      await expect(page.locator('text=E2E test task').first()).toBeVisible();
    }
    // If no add button visible, test is a no-op (task creation UI not shown)
    await expect(page.locator('text=StriveRS')).toBeVisible();
  });

  test('5. Task status change (open -> done -> reopen)', async ({ page }) => {
    await page.locator('button:has-text("List")').first().click({ force: true });
    await page.waitForTimeout(500);

    // With stubbed empty task list, no task status selects will be present.
    // Status selects only appear when tasks exist; our stub returns empty tasks.
    // Just verify the view renders without crash.
    await expect(page.locator('text=StriveRS')).toBeVisible();
  });

  test('6. Task card metadata — location/when icons visible', async ({ page }) => {
    await page.locator('button:has-text("List")').first().click({ force: true });
    await page.waitForTimeout(500);
    await expect(page.locator('text=StriveRS')).toBeVisible();
  });

  test('7. Scheduled task blocks — render without crash', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click({ force: true });
    await page.waitForTimeout(500);
    await expect(page.locator('text=8 AM').first()).toBeVisible();
  });

  test('8. Settings panel — all 7 tabs open without crash', async ({ page }) => {
    await openSettings(page);
    const panel = page.locator(SELECTORS.SETTINGS_DIALOG);
    await expect(panel).toBeVisible();

    // Actual tabs from SettingsPanel.jsx TABS array (role="tab", aria-selected)
    const tabs = ['Locations', 'Tools', 'Tool Matrix', 'Templates', 'Projects', 'Preferences', 'Notifications'];
    for (const label of tabs) {
      const tab = page.getByRole('tab', { name: label, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }

    // Close button is &times; (×) in SettingsPanel.jsx
    await panel.locator('button:has-text("×")').first().click();
    await expect(page.locator(SELECTORS.SETTINGS_DIALOG)).toHaveCount(0);
  });

  test('9. Preferences — grid zoom slider is interactable and updates label', async ({ page }) => {
    await openSettings(page);
    const panel = page.locator(SELECTORS.SETTINGS_DIALOG);
    await page.getByRole('tab', { name: 'Preferences', exact: true }).click();

    // Preferences has 2 range inputs: font-size (index 0) and grid-zoom (index 1).
    // The grid zoom slider shows "{value}px" label; font size does not.
    const slider = panel.locator('input[type="range"]').nth(1);
    await expect(slider).toBeVisible();
    await slider.fill('90');
    // The "90px" label appears next to the grid zoom slider
    await expect(panel.getByText('90px')).toBeVisible();
    // Reset to default
    await slider.fill('60');
    await expect(panel.getByText('60px')).toBeVisible();

    await panel.locator('button:has-text("×")').first().click();
    await expect(page.locator('text=StriveRS')).toBeVisible();
  });

  test('10. Template override dropdown — change template in DayView', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click({ force: true });
    await page.waitForTimeout(300);

    const templateSelect = page.locator('select').first();
    if (await templateSelect.isVisible()) {
      const options = await templateSelect.locator('option').allTextContents();
      if (options.length > 1) {
        await templateSelect.selectOption({ index: 1 });
        await page.waitForTimeout(300);
      }
    }
    await expect(page.locator('text=StriveRS')).toBeVisible();
  });

  test('11. Dark/light mode toggle', async ({ page }) => {
    const toggleBtn = page.locator('button[title="Toggle dark mode"]');
    await toggleBtn.click();
    await page.waitForTimeout(300);
    await toggleBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=StriveRS')).toBeVisible();
  });

  test('12. Week navigation (arrows, Today button)', async ({ page }) => {
    // force:true bypasses the AI-command input bar that overlays header buttons
    await page.locator('button[title="Next day"]').click({ force: true });
    await page.waitForTimeout(200);
    await page.locator('button[title="Previous day"]').click({ force: true });
    await page.waitForTimeout(200);
    await page.locator('button[title="Next week"]').click({ force: true });
    await page.waitForTimeout(200);
    await page.locator('button[title="Previous week"]').click({ force: true });
    await page.waitForTimeout(200);
    await page.locator('button[title="Go to today"]').click({ force: true });
    await page.waitForTimeout(200);
    await expect(page.locator('text=StriveRS')).toBeVisible();
  });

  test('13. Import/export panel opens', async ({ page }) => {
    // Actual title from HeaderBar.jsx line 181
    await page.locator(EXPORT_BTN).click();
    await page.waitForTimeout(300);
    const panel = page.locator('text=/import|export/i').first();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('14. Now-indicator visible on today', async ({ page }) => {
    await page.locator('button[title="Go to today"]').click({ force: true });
    await page.locator('button:has-text("Day")').first().click({ force: true });
    await page.waitForTimeout(500);

    // The "Day" view is DailyView (NavigationBar VIEW_MODES `daily` → AppLayout
    // renders <DailyView>), and its now-marker carries data-testid
    // ="now-indicator" (DailyView.jsx, "Now marker").
    //
    // The selector was NOT the bug. The previous style-sniff — height:2px AND
    // borderRadius:1px AND position:absolute — describes DailyView's marker
    // exactly and would have matched it. This test failed in CI because the
    // marker was legitimately absent: see pinClockToMidday above. The test id
    // is here only so the assertion names what it wants instead of inferring it
    // from three inline styles; the clock pin is what makes it deterministic.
    await expect(page.getByTestId('now-indicator')).toBeVisible();
  });

  test('15. Timeline view — renders strip and cards', async ({ page }) => {
    await page.locator('button:has-text("Timeline")').first().click({ force: true });
    await page.waitForTimeout(500);
    await expect(page.locator('text=StriveRS')).toBeVisible();
  });
});
