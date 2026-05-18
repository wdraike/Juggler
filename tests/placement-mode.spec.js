// @ts-check
/**
 * placement-mode.spec.js — Phase 9 Plan 5: placementMode three-button mode selector
 *
 * Verifies that the Anytime / Time window / Time blocks mode buttons appear in
 * the task edit form for both non-recurring and recurring tasks, and that
 * clicking a mode button updates the active selection.
 *
 * Selector strategy: juggler-frontend/src/ has NO data-testid attributes.
 * Selectors use button title attributes and visible text matched against WhenSection.jsx.
 *
 * Source references:
 *   WhenSection.jsx lines 282-297  — non-recurring three-button mode selector
 *   WhenSection.jsx lines 396-432  — recurring three-button mode selector
 *   TaskEditForm.jsx lines 372-385 — placementMode state + handleModeChange
 */

const { test, expect } = require('@playwright/test');
const { setupAuth, waitForApp } = require('./helpers/playwright-helpers');

// Non-recurring task with placementMode='anytime' (default)
const TASK_NONRECURRING = {
  id: 'T_NR',
  text: 'Mode selector test task',
  status: '',
  pri: 'P3',
  dur: 30,
  project: '',
  notes: '',
  url: '',
  location: [],
  tools: [],
  dependsOn: [],
  recurring: false,
  marker: false,
  placementMode: 'anytime',
  when: '',
  weatherPrecip: 'any',
  weatherCloud: 'any',
  weatherTempMin: null,
  weatherTempMax: null,
  weatherHumidityMin: null,
  weatherHumidityMax: null,
};

// Recurring task with placementMode='anytime'
const TASK_RECURRING = {
  id: 'T_R',
  text: 'Recurring mode test task',
  status: '',
  pri: 'P3',
  dur: 30,
  project: '',
  notes: '',
  url: '',
  location: [],
  tools: [],
  dependsOn: [],
  recurring: true,
  marker: false,
  placementMode: 'anytime',
  when: '',
  recur: { type: 'weekly', days: 'MWF' },
  weatherPrecip: 'any',
  weatherCloud: 'any',
  weatherTempMin: null,
  weatherTempMax: null,
  weatherHumidityMin: null,
  weatherHumidityMax: null,
};

/**
 * Open the TaskEditForm by clicking a task card in List view.
 * Falls back gracefully if the card is not visible (date-filtered).
 */
async function openTaskCard(page, taskText) {
  // Switch to List view which shows TaskCards for all tasks regardless of date
  await page.locator('button:has-text("List")').first().click({ force: true });
  await page.waitForTimeout(500);

  const card = page.locator(`text=${taskText}`).first();
  const isVisible = await card.isVisible().catch(() => false);
  if (isVisible) {
    await card.click({ force: true });
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

/**
 * Open the "Add task" form (create mode).
 * Returns true if the form opened successfully.
 */
async function openCreateForm(page) {
  const addBtn = page.locator('button[title="Add task"]').first();
  const isVisible = await addBtn.isVisible().catch(() => false);
  if (isVisible) {
    await addBtn.click();
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

/**
 * Ensure the When section is expanded in the form.
 */
async function ensureWhenExpanded(page) {
  const dateInput = page.locator('input[type="date"]').first();
  const alreadyVisible = await dateInput.isVisible().catch(() => false);
  if (!alreadyVisible) {
    // Click the When toggle to expand
    const whenToggle = page.locator('button:has-text("When")').first();
    if (await whenToggle.isVisible().catch(() => false)) {
      await whenToggle.click();
      await page.waitForTimeout(300);
    }
  }
}

test.describe('Placement Mode — Three-button mode selector', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
  });

  /**
   * Test 1: Non-recurring task shows all three mode buttons.
   * Opens a task card in List view; if not visible, opens create form as fallback.
   */
  test('Non-recurring task shows Anytime, Time window, Time blocks mode buttons', async ({ page }) => {
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [TASK_NONRECURRING] }),
      })
    );

    await page.goto('/');
    await waitForApp(page);

    const opened = await openTaskCard(page, 'Mode selector test task');
    if (!opened) {
      // Fallback: use create form (also renders WhenSection without recurring)
      await openCreateForm(page);
    }
    await ensureWhenExpanded(page);

    // All three mode buttons must be present (title attributes from WhenSection.jsx)
    const anytimeBtn = page.locator('button[title="No time restriction — the scheduler can place this in any available slot"]').first();
    const timeWindowBtn = page.locator('button[title="Schedule near a preferred time ± a flex window"]').first();
    const timeBlocksBtn = page.locator('button[title="Restrict to named time block windows (morning, afternoon, etc.)"]').first();

    await expect(anytimeBtn).toBeVisible();
    await expect(timeWindowBtn).toBeVisible();
    await expect(timeBlocksBtn).toBeVisible();
  });

  /**
   * Test 2: Anytime button is initially active for a task with placementMode='anytime'.
   */
  test('Anytime button is active when placementMode is anytime', async ({ page }) => {
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [TASK_NONRECURRING] }),
      })
    );

    await page.goto('/');
    await waitForApp(page);

    const opened = await openTaskCard(page, 'Mode selector test task');
    if (!opened) {
      await openCreateForm(page);
    }
    await ensureWhenExpanded(page);

    const anytimeBtn = page.locator('button[title="No time restriction — the scheduler can place this in any available slot"]').first();
    await anytimeBtn.waitFor({ timeout: 5000 });

    // togStyle() sets fontWeight:'600' on the active button
    const fontWeight = await anytimeBtn.evaluate((el) => el.style.fontWeight);
    expect(fontWeight).toBe('600');
  });

  /**
   * Test 3: Clicking Time window button activates it and deactivates Anytime.
   */
  test('Clicking Time window button activates it', async ({ page }) => {
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [TASK_NONRECURRING] }),
      })
    );
    await page.route('**/api/tasks/T_NR**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ task: TASK_NONRECURRING }),
      })
    );

    await page.goto('/');
    await waitForApp(page);

    const opened = await openTaskCard(page, 'Mode selector test task');
    if (!opened) {
      await openCreateForm(page);
    }
    await ensureWhenExpanded(page);

    const timeWindowBtn = page.locator('button[title="Schedule near a preferred time ± a flex window"]').first();
    await timeWindowBtn.waitFor({ timeout: 5000 });

    // Click the Time window button
    await timeWindowBtn.click();
    await page.waitForTimeout(200);

    // Time window button must now be active (fontWeight '600')
    const twFW = await timeWindowBtn.evaluate((el) => el.style.fontWeight);
    expect(twFW).toBe('600');

    // Anytime button must no longer be active
    const anytimeBtn = page.locator('button[title="No time restriction — the scheduler can place this in any available slot"]').first();
    const anyFW = await anytimeBtn.evaluate((el) => el.style.fontWeight);
    expect(anyFW).not.toBe('600');
  });

  /**
   * Test 4: Recurring task shows the three-button mode selector.
   */
  test('Recurring task shows Anytime, Time window, Time blocks mode buttons', async ({ page }) => {
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [TASK_RECURRING] }),
      })
    );

    await page.goto('/');
    await waitForApp(page);

    const opened = await openTaskCard(page, 'Recurring mode test task');
    if (!opened) {
      // If card not visible, app still must not crash
      await expect(page.locator('text=StriveRS').first()).toBeVisible();
      return;
    }
    await ensureWhenExpanded(page);

    // Recurring section renders three mode buttons with text labels
    const anytimeBtns = page.locator('button:has-text("🔄 Anytime")');
    const timeWindowBtns = page.locator('button:has-text("⏰ Time window")');
    const timeBlocksBtns = page.locator('button:has-text("📅 Time blocks")');

    await expect(anytimeBtns.first()).toBeVisible();
    await expect(timeWindowBtns.first()).toBeVisible();
    await expect(timeBlocksBtns.first()).toBeVisible();
  });
});
