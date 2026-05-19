// @ts-check
/**
 * Shared Playwright helpers for juggler screen tests.
 *
 * Selector strategy: the juggler-frontend source contains NO data-testid
 * attributes (verified via grep across juggler-frontend/src/). All selectors
 * here use role, title, or visible-text anchors matched against actual JSX.
 *
 * Key source facts:
 *   - App brand text: "StriveRS" (HeaderBar.jsx)
 *   - Settings button: title="Settings — locations, tools, templates, and preferences"
 *   - Add-task button: title="Add task"
 *   - View tabs: button text Day / Flex / 3-Day / Week / Month / Timeline / List / Priority
 *   - QuickAddTask trigger: button text "+ Add task"; input placeholder "Task name..."
 *   - Settings tabs: text Locations / Tools / Tool Matrix / Templates / Projects / Preferences
 *   - RecurringDeleteDialog: "Skip this instance" / "Delete entire series"
 */

const TEST_TOKEN = process.env.TEST_TOKEN || 'playwright-test-token';
const TEST_USER = {
  id: 'test-user-00000000-0000-0000-0000',
  email: 'test@juggler.local',
  name: 'Test User',
  picture: null,
  timezone: 'America/New_York',
};

// ── Selector constants ───────────────────────────────────────────────────────
// All verified against juggler-frontend/src/ source — no data-testid exists.
const SELECTORS = {
  // App shell — "StriveRS" is the brand wordmark in HeaderBar.jsx
  APP_BRAND: 'text=StriveRS',
  // Header action buttons (title attributes from HeaderBar.jsx)
  BTN_SETTINGS: 'button[title="Settings — locations, tools, templates, and preferences"]',
  BTN_ADD_TASK: 'button[title="Add task"]',
  BTN_TOGGLE_DARK: 'button[title="Toggle dark mode"]',
  BTN_PREV_DAY: 'button[title="Previous day"]',
  BTN_NEXT_DAY: 'button[title="Next day"]',
  BTN_TODAY: 'button[title="Go to today"]',
  // QuickAddTask (QuickAddTask.jsx) — button text then input placeholder
  QUICK_ADD_BTN: 'button:has-text("+ Add task")',
  QUICK_ADD_INPUT: 'input[placeholder="Task name..."]',
  QUICK_ADD_SUBMIT: 'button:has-text("Add")',
  // Settings panel (SettingsPanel.jsx)
  SETTINGS_HEADING: 'text=Settings',
  SETTINGS_CLOSE: 'button:has-text("×")',
  // Settings tab labels (from TABS array in SettingsPanel.jsx)
  TAB_LOCATIONS: 'button:has-text("Locations")',
  TAB_TOOLS: 'button:has-text("Tools")',
  TAB_TOOL_MATRIX: 'button:has-text("Tool Matrix")',
  TAB_TEMPLATES: 'button:has-text("Templates")',
  TAB_PROJECTS: 'button:has-text("Projects")',
  TAB_PREFERENCES: 'button:has-text("Preferences")',
  // Navigation view tabs (NavigationBar.jsx VIEW_MODES)
  VIEW_DAY: 'button:has-text("Day")',
  VIEW_FLEX: 'button:has-text("Flex")',
  VIEW_3DAY: 'button:has-text("3-Day")',
  VIEW_WEEK: 'button:has-text("Week")',
  VIEW_MONTH: 'button:has-text("Month")',
  VIEW_LIST: 'button:has-text("List")',
  VIEW_PRIORITY: 'button:has-text("Priority")',
  VIEW_DEPS: 'button:has-text("Deps")',
  // RecurringDeleteDialog (RecurringDeleteDialog.jsx)
  RECUR_SKIP_INSTANCE: 'button:has-text("Skip this instance")',
  RECUR_DELETE_SERIES: 'button:has-text("Delete entire series")',
};

// ── Auth bypass ──────────────────────────────────────────────────────────────

/**
 * Intercept auth endpoints so tests run without a live auth-service.
 * Must be called before page.goto('/').
 * @param {import('@playwright/test').Page} page
 */
async function setupAuth(page) {
  // Seed localStorage so apiClient.js picks up the token at module init time.
  // Without this, getAccessToken() returns null → auth falls through to
  // refresh/SSO paths, neither of which work in a test environment.
  await page.addInitScript((token) => {
    localStorage.setItem('juggler-access-token', token);
  }, TEST_TOKEN);

  // Playwright uses LIFO route matching — last registered wins.
  // Register catch-all FIRST so specific routes registered after it take priority.

  // Catch-all: any /api/* call returns 200 to prevent 401s that would
  // trigger the apiClient refresh-fail → clearAccessToken → auth:logout cycle.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );

  // Specific stubs (registered after catch-all so they win via LIFO priority)
  await page.route('**/api/tasks**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
  );
  await page.route('**/api/user/config**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );
  await page.route('**/api/my-plan**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan_id: 'free', features: {}, usage: {} }) })
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: TEST_USER }),
    })
  );
}

// ── App readiness ────────────────────────────────────────────────────────────

/**
 * Wait for the main app shell to finish loading.
 * Uses the "StriveRS" brand wordmark which HeaderBar always renders.
 * @param {import('@playwright/test').Page} page
 */
async function waitForApp(page) {
  // Retry logic for flaky loads — 3 attempts, 30s timeout each
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.waitForSelector(SELECTORS.APP_BRAND, { timeout: 30000 });
      return; // success
    } catch (err) {
      if (attempt === 3) throw err; // last attempt fails → bubble up
      // reload and retry
      await page.reload({ waitUntil: 'networkidle' });
    }
  }
}

// ── Task helpers ─────────────────────────────────────────────────────────────

/**
 * Create a task via the QuickAddTask inline form.
 * Clicks "+ Add task" to expand the form, fills the text, presses Enter.
 * @param {import('@playwright/test').Page} page
 * @param {{ text: string }} opts
 */
async function createTask(page, opts) {
  const addBtn = page.locator(SELECTORS.QUICK_ADD_BTN).first();
  if (await addBtn.isVisible()) {
    await addBtn.click();
  }
  await page.fill(SELECTORS.QUICK_ADD_INPUT, opts.text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

/**
 * Open the TaskEditForm by clicking the global "+" (Add task) header button.
 * The form slides in as a panel on the right side.
 * @param {import('@playwright/test').Page} page
 */
async function openTaskForm(page) {
  await page.click(SELECTORS.BTN_ADD_TASK);
  // TaskEditForm is inside a panel; wait for a visible input element
  await page.waitForSelector('input[placeholder="Task name..."]', { timeout: 5000 });
}

/**
 * Change a task's status via the StatusToggle buttons.
 * StatusToggle renders title-labelled buttons (Open, Complete, Start, Cancel, Skip, Pause).
 * @param {import('@playwright/test').Page} page
 * @param {'done'|'wip'|'cancel'|'skip'|'pause'|''} status
 */
async function setStatus(page, status) {
  const labelMap = {
    '': 'Open',
    done: 'Complete',
    wip: 'Start',
    cancel: 'Cancel',
    skip: 'Skip',
    pause: 'Pause',
  };
  const label = labelMap[status] || status;
  const btn = page.locator(`button[title="${label}"]`).first();
  await btn.click();
}

/**
 * Open the settings panel via the gear button.
 * @param {import('@playwright/test').Page} page
 */
async function openSettings(page) {
  await page.click(SELECTORS.BTN_SETTINGS);
  await page.waitForSelector(SELECTORS.SETTINGS_HEADING, { timeout: 5000 });
}

module.exports = {
  TEST_TOKEN,
  TEST_USER,
  SELECTORS,
  setupAuth,
  waitForApp,
  createTask,
  openTaskForm,
  setStatus,
  openSettings,
};
