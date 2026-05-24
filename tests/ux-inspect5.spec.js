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

test('debug dirty detection', async ({ page }) => {
  await setupAuth(page);
  await page.route('**/api/tasks**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [TASK_BASE] }) })
  );

  await page.goto('/');
  await waitForApp(page);
  await openEditForm(page);

  // Find all text inputs
  const inputs = await page.locator('input[type="text"]').evaluateAll((els) =>
    els.map((e) => ({ placeholder: e.placeholder, value: e.value, tag: e.tagName }))
  );
  console.log('TEXT INPUTS:', JSON.stringify(inputs, null, 2));

  // Fill the one with no placeholder (our helper logic)
  const target = page.locator('input[type="text"]').filter({ hasNot: page.locator('[placeholder]') }).first();
  console.log('Target count:', await target.count());
  console.log('Target value before:', await target.inputValue());

  await target.fill('Modified text');
  await page.waitForTimeout(500);

  console.log('Target value after:', await target.inputValue());

  // Dump all buttons looking for Save
  const buttons = await page.locator('button').evaluateAll((els) =>
    els.map((e) => e.textContent.trim().slice(0, 40))
  );
  console.log('BUTTONS:', JSON.stringify(buttons, null, 2));

  await page.screenshot({ path: 'test-results/dirty-debug.png', fullPage: true });
});
