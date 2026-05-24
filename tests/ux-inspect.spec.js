// Diagnostic: capture DOM when create form is open
const { test, expect } = require('@playwright/test');
const { setupAuth, waitForApp } = require('./helpers/playwright-helpers');

test('inspect create form DOM', async ({ page }) => {
  await setupAuth(page);
  await page.route('**/api/tasks**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
  );
  await page.goto('/');
  await waitForApp(page);

  // Open create form
  const addBtn = page.locator('button[title="Add task"]').first();
  await addBtn.click({ force: true });
  await page.waitForTimeout(800);

  // Expand When
  const whenToggle = page.locator('button:has-text("When")').first();
  if (await whenToggle.isVisible().catch(() => false)) {
    await whenToggle.click();
    await page.waitForTimeout(400);
  }

  // Dump visible buttons
  const buttons = await page.locator('button').evaluateAll((els) =>
    els.map((e) => ({ text: e.textContent.trim().slice(0, 60), title: e.title }))
  );
  console.log('BUTTONS:', JSON.stringify(buttons, null, 2));

  // Dump visible inputs
  const inputs = await page.locator('input, select').evaluateAll((els) =>
    els.map((e) => ({ tag: e.tagName, type: e.type, placeholder: e.placeholder, value: (e.value || '').slice(0, 30) }))
  );
  console.log('INPUTS:', JSON.stringify(inputs, null, 2));

  await page.screenshot({ path: 'test-results/ux-inspect.png', fullPage: true });
});
