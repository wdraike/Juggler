const { test } = require('@playwright/test');
const { setupAuth, waitForApp } = require('./helpers/playwright-helpers');

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

test('mimic edit mode test', async ({ page }) => {
  await setupAuth(page);
  await page.route('**/api/tasks**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [TASK_BASE] }) })
  );
  await page.route('**/schedule/run**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  );

  await page.goto('/');
  await waitForApp(page);

  // Try to find List button with longer timeout
  const listBtn = page.locator('button:has-text("List")').first();
  console.log('Before wait:', await listBtn.isVisible().catch(() => false));
  await listBtn.waitFor({ state: 'visible', timeout: 5000 });
  console.log('After wait: visible');

  // Dump all buttons again to compare
  const buttons = await page.locator('button').evaluateAll((els) =>
    els.map((e) => e.textContent.trim().slice(0, 40))
  );
  console.log('BUTTONS:', JSON.stringify(buttons.slice(0, 40), null, 2));

  await listBtn.click({ force: true });
  console.log('Clicked List');

  await page.waitForTimeout(600);

  const card = page.locator('text=UX sweep task').first();
  console.log('Card visible:', await card.isVisible().catch(() => false));
});
