const { test } = require('@playwright/test');
const { setupAuth, waitForApp } = require('./helpers/playwright-helpers');

test('inspect create form DOM v2', async ({ page }) => {
  await setupAuth(page);
  await page.route('**/api/tasks**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
  );
  await page.goto('/');
  await waitForApp(page);

  // Listen for console errors
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  const addBtn = page.locator('button[title="Add task"]').first();
  console.log('Add btn visible:', await addBtn.isVisible());
  await addBtn.click();
  await page.waitForTimeout(1500);

  // Check if TaskEditForm appeared
  const nameInput = page.locator('input[placeholder="Task name..."]').first();
  console.log('Name input visible:', await nameInput.isVisible().catch(() => false));

  // Dump all visible text
  const bodyText = await page.locator('body').textContent();
  console.log('BODY CONTAINS "New Task":', bodyText.includes('New Task'));
  console.log('BODY CONTAINS "Edit Task":', bodyText.includes('Edit Task'));

  // Dump buttons again
  const buttons = await page.locator('button').evaluateAll((els) =>
    els.map((e) => e.textContent.trim().slice(0, 60))
  );
  console.log('BUTTONS after click:', JSON.stringify(buttons, null, 2));

  console.log('Console errors:', errors.slice(0, 10));

  await page.screenshot({ path: 'test-results/ux-inspect2.png', fullPage: true });
});
