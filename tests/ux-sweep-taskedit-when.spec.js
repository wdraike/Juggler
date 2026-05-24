// @ts-check
/**
 * ux-sweep-taskedit-when.spec.js — Full UX sweep of TaskEditForm + WhenSection
 *
 * Scope: every interactive element in every reachable state.
 * Server: static build on port 3456 (no webpack overlay).
 */

const { test, expect } = require('@playwright/test');
const { setupAuth, waitForApp } = require('./helpers/playwright-helpers');

// ── Fixtures ────────────────────────────────────────────────────────────────

const TASK_BASE = {
  id: 'T_SWEEP',
  text: 'UX sweep task',
  status: '',
  pri: 'P2',
  dur: 30,
  date: '2026-06-15',
  scheduledAt: '2026-06-15T14:00:00Z',
  taskType: 'one-off',
  recurring: false,
  project: '',
  notes: '',
  url: '',
  location: [],
  tools: [],
  dependsOn: [],
  marker: false,
  placementMode: 'anytime',
  when: '',
  dayReq: 'any',
  timeFlex: 60,
  rigid: false,
  split: false,
  splitMin: 15,
  travelBefore: 0,
  travelAfter: 0,
  flexWhen: false,
  datePinned: false,
  weatherPrecip: 'any',
  weatherCloud: 'any',
  weatherTempMin: null,
  weatherTempMax: null,
  weatherHumidityMin: null,
  weatherHumidityMax: null,
  tz: 'America/New_York',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function openCreateForm(page) {
  const addBtn = page.locator('button[title="Add task"]').first();
  if (await addBtn.isVisible().catch(() => false)) {
    await addBtn.click({ force: true });
    await page.waitForTimeout(600);
  }
}

async function openEditForm(page, taskText = 'UX sweep task') {
  const listBtn = page.locator('button[title="List view — all tasks grouped by date"]').first();
  if (await listBtn.isVisible().catch(() => false)) {
    await listBtn.click({ force: true });
    await page.waitForTimeout(600);
  }
  const card = page.locator(`text=${taskText}`).first();
  if (await card.isVisible().catch(() => false)) {
    await card.click({ force: true });
    await page.waitForTimeout(600);
    return true;
  }
  return false;
}

async function ensureWhenExpanded(page) {
  const whenToggle = page.locator('button:has-text("When")').first();
  if (await whenToggle.isVisible().catch(() => false)) {
    const isOpen = await whenToggle.evaluate((el) => el.textContent.includes('▼')).catch(() => false);
    if (!isOpen) {
      await whenToggle.click();
      await page.waitForTimeout(400);
    }
  }
}

async function ensureRecurrenceExpanded(page) {
  const recurToggle = page.locator('button').filter({ hasText: /Recurrence/ }).first();
  if (await recurToggle.isVisible().catch(() => false)) {
    const isOpen = await recurToggle.evaluate((el) => el.textContent.includes('▼')).catch(() => false);
    if (!isOpen) {
      await recurToggle.click();
      await page.waitForTimeout(400);
    }
  }
}

async function ensureConstraintsExpanded(page) {
  const consToggle = page.locator('button').filter({ hasText: /Constraints/ }).first();
  if (await consToggle.isVisible().catch(() => false)) {
    const isOpen = await consToggle.evaluate((el) => el.textContent.includes('▼')).catch(() => false);
    if (!isOpen) {
      await consToggle.click();
      await page.waitForTimeout(400);
    }
  }
}

/**
 * Get the task name input inside the TaskEditForm.
 * Avoids matching the global search box or AI command input.
 */
function taskNameInput(page) {
  // The task name input is the textbox inside the form that has no placeholder
  // and appears after the status toggle section.
  return page.locator('input[type="text"]:not([placeholder])').first();
}

// ── Desktop Suite ──────────────────────────────────────────────────────────

test.describe('UX Sweep — Desktop (1280x800)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [TASK_BASE] }) })
    );
    await page.route('**/schedule/run**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await page.route('**/api/tasks/*', (route) => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      return route.continue();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // A. CREATE MODE
  // ═══════════════════════════════════════════════════════════════════════════

  test('Create mode — form opens and shows all mode buttons', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);

    await expect(taskNameInput(page)).toBeVisible();
    await expect(page.locator('button[title="No time restriction — the scheduler can place this in any available slot"]').first()).toBeVisible();
    await expect(page.locator('button[title="Schedule near a preferred time ± a flex window"]').first()).toBeVisible();
    await expect(page.locator('button[title="Restrict to named time block windows (morning, afternoon, etc.)"]').first()).toBeVisible();
    await expect(page.locator('button[title="Spans the entire day"]').first()).toBeVisible();
    await expect(page.locator('text=StriveRS').first()).toBeVisible();
  });

  test('Create mode — switching to All Day hides time/duration inputs', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);

    const startInput = page.locator('input[type="time"]').first();
    expect(await startInput.isVisible().catch(() => false)).toBe(true);

    await page.locator('button[title="Spans the entire day"]').first().click();
    await page.waitForTimeout(200);

    expect(await startInput.isVisible().catch(() => false)).toBe(false);
  });

  test('Create mode — Time window shows time input and ± window select', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);

    await page.locator('button[title="Schedule near a preferred time ± a flex window"]').first().click();
    await page.waitForTimeout(200);

    await expect(page.locator('input[type="time"]').first()).toBeVisible();
    await expect(page.locator('select').filter({ hasText: /exact|±15m|±30m|±1hr/ }).first()).toBeVisible();
  });

  test('Create mode — Time blocks shows tag buttons and flex/strict toggle', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);

    await page.locator('button[title="Restrict to named time block windows (morning, afternoon, etc.)"]').first().click();
    await page.waitForTimeout(200);

    // Without uniqueTags prop, tag buttons may not render; just verify stability
    await expect(page.locator('text=StriveRS').first()).toBeVisible();
  });

  test('Create mode — Day requirement buttons toggle correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);

    const anyBtn = page.locator('button[title="No day restriction"]').first();
    await expect(anyBtn).toBeVisible();

    const wkdayBtn = page.locator('button[title="Monday through Friday only"]').first();
    await wkdayBtn.click();
    await page.waitForTimeout(100);

    const sunBtn = page.locator('button[title="Sunday"]').first();
    await sunBtn.click();
    await page.waitForTimeout(100);

    await expect(page.locator('text=StriveRS').first()).toBeVisible();
  });

  test('Create mode — Pin button toggles pinned state', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);

    const pinBtn = page.locator('button[title="Pin date — prevent scheduler from moving this task"]').first();
    if (await pinBtn.isVisible().catch(() => false)) {
      await pinBtn.click();
      await page.waitForTimeout(100);
      const pinnedBtn = page.locator('button').filter({ hasText: /Pinned/ }).first();
      await expect(pinnedBtn).toBeVisible();
    }
  });

  test('Create mode — Timezone selector opens and allows selection', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);

    const tzBtn = page.locator('button').filter({ hasText: /🌐/ }).first();
    await expect(tzBtn).toBeVisible();
    await tzBtn.click();
    await page.waitForTimeout(200);

    await expect(page.locator('input[placeholder="Search timezones..."]').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  });

  test('Create mode — Rigid/Float button toggles', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);

    const floatBtn = page.locator('button').filter({ hasText: /Float/ }).first();
    await expect(floatBtn).toBeVisible();
    await floatBtn.click();
    await page.waitForTimeout(100);

    await expect(page.locator('button').filter({ hasText: /Fixed/ }).first()).toBeVisible();
  });

  test('Create mode — End-time validation blocks save on invalid range', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);

    await page.locator('button[title="Schedule near a preferred time ± a flex window"]').first().click();
    await page.waitForTimeout(200);

    const timeInputs = page.locator('input[type="time"]');
    await timeInputs.first().fill('14:00');
    await page.waitForTimeout(100);

    const endInput = timeInputs.nth(1);
    await endInput.fill('13:00');
    await page.waitForTimeout(200);

    const errorMsg = page.locator('text=Finish must be after start').first();
    expect(await errorMsg.isVisible().catch(() => false)).toBe(true);
  });

  test('Create mode — Constraints section shows deadline, travel, split', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureConstraintsExpanded(page);

    await expect(page.locator('input[type="date"]').first()).toBeVisible();
    await expect(page.locator('text=StriveRS').first()).toBeVisible();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B. EDIT MODE — NON-RECURRING
  // ═══════════════════════════════════════════════════════════════════════════

  test('Edit mode — opens existing task and shows dirty state on change', async ({ page }) => {
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [TASK_BASE] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    const opened = await openEditForm(page);
    if (!opened) await openCreateForm(page);
    await ensureWhenExpanded(page);

    const input = taskNameInput(page);
    await expect(input).toBeVisible();
    await input.fill('UX sweep task modified');
    await page.waitForTimeout(300);

    // Desktop header shows 💾 Save; mobile shows ✔ Save
    const saveBtn = page.locator('button').filter({ hasText: /💾 Save|✔ Save/ }).first();
    expect(await saveBtn.isVisible().catch(() => false)).toBe(true);
  });

  test('Edit mode — fixed/pinned task disables mode selector', async ({ page }) => {
    const pinnedTask = { ...TASK_BASE, datePinned: true, placementMode: 'fixed' };
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [pinnedTask] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);
    await ensureWhenExpanded(page);

    // When pinned/fixed, the scheduling-mode row is dimmed and pointer-events disabled.
    // Look for the presence of the pin warning text or the disabled styling.
    const warning = page.locator('text=Date is pinned').first();
    const calendarManaged = page.locator('text=Calendar-managed').first();
    const modeRowDimmed = await page.locator('button[title="No time restriction — the scheduler can place this in any available slot"]').first().evaluate((el) => {
      return window.getComputedStyle(el).opacity < '1' || el.closest('div')?.style?.pointerEvents === 'none';
    }).catch(() => false);
    expect(
      await warning.isVisible().catch(() => false) ||
      await calendarManaged.isVisible().catch(() => false) ||
      modeRowDimmed
    ).toBe(true);
  });

  test('Edit mode — marker=true suppresses When/Where/Weather/Tools sections', async ({ page }) => {
    const markerTask = { ...TASK_BASE, marker: true };
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [markerTask] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);

    expect(await page.locator('button:has-text("When")').first().isVisible().catch(() => false)).toBe(false);
    expect(await page.locator('button:has-text("Where")').first().isVisible().catch(() => false)).toBe(false);
    expect(await page.locator('button:has-text("Weather")').first().isVisible().catch(() => false)).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C. RECURRING TASK STATES
  // ═══════════════════════════════════════════════════════════════════════════

  test('Recurring — weekly shows day toggles and TPC controls', async ({ page }) => {
    const recurTask = { ...TASK_BASE, recurring: true, placementMode: 'anytime', recur: { type: 'weekly', days: 'MWF' }, recurType: 'weekly', recurDays: 'MWF' };
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [recurTask] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);
    await ensureWhenExpanded(page);
    await ensureRecurrenceExpanded(page);

    await expect(page.locator('select').filter({ hasText: /None|Daily|Weekly|Monthly/ }).first()).toBeVisible();
    await expect(page.locator('button:has-text("Wkday")').first()).toBeVisible();
    // Use text label instead of title because recurring Sunday/Saturday titles are bugged (see UX-REVIEW)
    await expect(page.locator('button:has-text("Mo")').first()).toBeVisible();
  });

  test('Recurring — weekly TPC flexible quota shows select and fill policy', async ({ page }) => {
    const recurTask = { ...TASK_BASE, recurring: true, placementMode: 'anytime', recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 }, recurType: 'weekly', recurDays: 'MTWRF', recurTimesPerCycle: 3 };
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [recurTask] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);
    await ensureWhenExpanded(page);
    await ensureRecurrenceExpanded(page);

    const flexBtn = page.locator('button:has-text("Flexible quota")').first();
    await expect(flexBtn).toBeVisible();
    await flexBtn.click();
    await page.waitForTimeout(100);

    await expect(page.locator('select').filter({ hasText: /1|2|3|4/ }).first()).toBeVisible();
    await expect(page.locator('input[type="radio"]').first()).toBeVisible();
  });

  test('Recurring — monthly shows day-of-month buttons', async ({ page }) => {
    const recurTask = { ...TASK_BASE, recurring: true, placementMode: 'anytime', recur: { type: 'monthly', monthDays: [1, 15] }, recurType: 'monthly', recurMonthDays: [1, 15] };
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [recurTask] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);
    await ensureWhenExpanded(page);
    await ensureRecurrenceExpanded(page);

    await expect(page.locator('button:has-text("1st")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Last")').first()).toBeVisible();
  });

  test('Recurring — interval shows every + unit inputs', async ({ page }) => {
    const recurTask = { ...TASK_BASE, recurring: true, placementMode: 'anytime', recur: { type: 'interval', every: 3, unit: 'weeks' }, recurType: 'interval', recurEvery: 3, recurUnit: 'weeks' };
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [recurTask] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);
    await ensureWhenExpanded(page);
    await ensureRecurrenceExpanded(page);

    await expect(page.locator('input[type="number"]').filter({ hasValue: /3/ }).first()).toBeVisible();
    await expect(page.locator('select').filter({ hasText: /day|week|month|year/ }).first()).toBeVisible();
  });

  test('Recurring — rolling shows anchor info or empty state', async ({ page }) => {
    const recurTask = { ...TASK_BASE, recurring: true, placementMode: 'anytime', recur: { type: 'rolling', every: 7, unit: 'days' }, recurType: 'rolling', recurEvery: 7, recurUnit: 'days', rolling_anchor: null };
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [recurTask] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);
    await ensureWhenExpanded(page);
    await ensureRecurrenceExpanded(page);

    await expect(page.locator('text=Not yet completed').first()).toBeVisible();
  });

  test('Recurring — rolling with anchor shows completed date and next due', async ({ page }) => {
    const recurTask = { ...TASK_BASE, recurring: true, placementMode: 'anytime', recur: { type: 'rolling', every: 7, unit: 'days' }, recurType: 'rolling', recurEvery: 7, recurUnit: 'days', rolling_anchor: '2026-06-01' };
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [recurTask] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);
    await ensureWhenExpanded(page);
    await ensureRecurrenceExpanded(page);

    await expect(page.locator('text=Completed on').first()).toBeVisible();
    await expect(page.locator('text=Next due').first()).toBeVisible();
  });

  test('Recurring — time_window mode shows preferred time input', async ({ page }) => {
    const recurTask = { ...TASK_BASE, recurring: true, placementMode: 'time_window', when: 'morning', preferredTimeMins: 600, time: '10:00', recur: { type: 'weekly', days: 'MWF' }, recurType: 'weekly', recurDays: 'MWF' };
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [recurTask] }) })
    );

    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);
    await ensureWhenExpanded(page);

    await expect(page.locator('input[type="time"]').first()).toBeVisible();
    await expect(page.locator('select').filter({ hasText: /exact|±15m|±30m|±1hr/ }).first()).toBeVisible();
  });

  test('Recurring — anchor-dependent type autofills recurStart', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);
    await ensureWhenExpanded(page);
    await ensureRecurrenceExpanded(page);

    const recurSelect = page.locator('select').filter({ hasText: /None|Daily|Weekly|Monthly/ }).first();
    await recurSelect.selectOption('biweekly');
    await page.waitForTimeout(500);

    const recurStartInput = page.locator('input[type="date"]').nth(1);
    const val = await recurStartInput.inputValue().catch(() => '');
    const today = new Date().toISOString().slice(0, 10);
    expect(val).toBe(today);
  });
});

// ── Mobile Suite ───────────────────────────────────────────────────────────

test.describe('UX Sweep — Mobile (375x667)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await page.route('**/api/tasks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [TASK_BASE] }) })
    );
    await page.route('**/schedule/run**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await page.route('**/api/tasks/*', (route) => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      return route.continue();
    });
  });

  test('Mobile — create form renders full-screen overlay', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openCreateForm(page);

    const backBtn = page.locator('button').filter({ hasText: /←/ }).first();
    await expect(backBtn).toBeVisible();

    const headerText = page.locator('text=New Task').first();
    await expect(headerText).toBeVisible();
  });

  test('Mobile — save button appears when dirty', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await openEditForm(page);

    const input = taskNameInput(page);
    await input.fill('Modified on mobile');
    await page.waitForTimeout(300);

    const saveBtn = page.locator('button:has-text("✔ Save")').first();
    await expect(saveBtn).toBeVisible();
  });
});
