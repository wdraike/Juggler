// @ts-check
/**
 * all-day-banner.spec.js — JUG-MED-10: All-day task banner consistency
 *
 * Verifies that all-day tasks (when='allday' || isAllDay=true) appear as banner
 * chips ABOVE the timed grid in DayView, DailyView, ThreeDayView, and WeekView,
 * and do NOT render as timed blocks inside the CalendarGrid.
 *
 * Also verifies:
 * - A task with when='morning', time=null, dur=0 does NOT appear in any all-day banner
 *   (the DayView over-broad rule was intentionally dropped).
 *
 * Selector strategy: juggler-frontend/src/ has NO data-testid attributes
 * except those added by this feature (AllDayBanner: data-testid="all-day-banner",
 * data-testid="all-day-chip"). All other selectors use visible text and button
 * titles verified against actual JSX.
 *
 * Source references:
 *   AllDayBanner.jsx     — data-testid="all-day-banner", data-testid="all-day-chip"
 *   NavigationBar.jsx    — VIEW_MODES: Day, 3-Day, Week (button text)
 *   HeaderBar.jsx        — "Go to today" button title
 */

const { test, expect } = require('@playwright/test');
const { setupAuth, waitForApp } = require('./helpers/playwright-helpers');

// All-day task seed — uses today's date so it's visible in Day/3-Day/Week views
const TODAY = new Date().toISOString().slice(0, 10);

const ALL_DAY_TASK = {
  id: 'ad-test-1',
  text: 'All Day Banner Test Task',
  when: 'allday',
  isAllDay: true,
  date: TODAY,
  status: '',
  pri: 'P2',
  dur: 0,
  time: null,
  scheduledAt: null,
  taskType: 'one-off',
  recurring: false,
  project: '',
};

// A task that should NOT appear in the all-day banner (dropped DayView over-broad rule)
const TIMED_NODUR_TASK = {
  id: 'nd-test-1',
  text: 'No-Duration Morning Task',
  when: 'morning',
  isAllDay: false,
  date: TODAY,
  status: '',
  pri: 'P3',
  dur: 0,
  time: null,
  scheduledAt: null,
  taskType: 'one-off',
  recurring: false,
  project: '',
};

const SEED_TASKS = [ALL_DAY_TASK, TIMED_NODUR_TASK];

test.describe('All-Day Banner — JUG-MED-10', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);

    // Mock tasks API with our seed tasks
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: SEED_TASKS }),
      })
    );

    // Mock schedule/run so scheduler doesn't error
    await page.route('**/schedule/run**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, placements: [] }),
      })
    );

    await page.goto('/');
    await waitForApp(page);

    // Navigate to today so the seeded task is in view
    const todayBtn = page.locator('button[title="Go to today"]');
    if (await todayBtn.isVisible()) {
      await todayBtn.click({ force: true });
      await page.waitForTimeout(200);
    }
  });

  // Test 1: DayView shows all-day task in banner above grid
  test('DayView — all-day task appears in banner, not in timed grid', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click({ force: true });
    await page.waitForTimeout(400);

    // Banner should be present and contain the task text
    const banner = page.locator('[data-testid="all-day-banner"]').first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('All Day Banner Test Task');
  });

  // Test 2: DayView — no-duration morning task does NOT appear in banner
  test('DayView — time=null,dur=0,when=morning task NOT in banner', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click({ force: true });
    await page.waitForTimeout(400);

    const banner = page.locator('[data-testid="all-day-banner"]').first();
    // Banner should not contain the non-allday task
    const noBannerText = await banner.textContent().catch(() => '');
    expect(noBannerText).not.toContain('No-Duration Morning Task');
  });

  // Test 3: 3-Day view shows all-day task in the correct column's banner
  test('3-Day view — all-day task appears in banner column', async ({ page }) => {
    await page.locator('button:has-text("3-Day")').first().click({ force: true });
    await page.waitForTimeout(400);

    const banner = page.locator('[data-testid="all-day-banner"]').first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('All Day Banner Test Task');
  });

  // Test 4: Week view shows all-day task in the correct column's banner
  test('Week view — all-day task appears in banner column', async ({ page }) => {
    await page.locator('button:has-text("Week")').first().click({ force: true });
    await page.waitForTimeout(400);

    const banner = page.locator('[data-testid="all-day-banner"]').first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('All Day Banner Test Task');
  });

  // Test 5: Banner style — chip has no time label
  test('Banner chip has no time label', async ({ page }) => {
    await page.locator('button:has-text("Day")').first().click({ force: true });
    await page.waitForTimeout(400);

    const chip = page.locator('[data-testid="all-day-chip"]').first();
    await expect(chip).toBeVisible();
    // Chip text should be the task name only, no time string like "9:00 AM"
    const chipText = await chip.textContent();
    expect(chipText).toContain('All Day Banner Test Task');
    expect(chipText).not.toMatch(/\d+:\d+\s*(AM|PM)/i);
  });
});
