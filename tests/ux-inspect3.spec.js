const { test } = require('@playwright/test');
const { setupAuth, waitForApp } = require('./helpers/playwright-helpers');

test('inspect List button click', async ({ page }) => {
  await setupAuth(page);
  await page.route('**/api/tasks**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
  );
  await page.goto('/');
  await waitForApp(page);

  const listBtn = page.locator('button:has-text("List")').first();
  console.log('List visible:', await listBtn.isVisible().catch(() => false));
  console.log('List count:', await page.locator('button:has-text("List")').count());

  // Try evaluating the element
  const info = await listBtn.evaluate((el) => ({
    tag: el.tagName,
    text: el.textContent,
    disabled: el.disabled,
    rect: el.getBoundingClientRect(),
  })).catch((e) => e.message);
  console.log('List info:', JSON.stringify(info, null, 2));

  await listBtn.click({ force: true, timeout: 5000 });
  console.log('Clicked');
});
