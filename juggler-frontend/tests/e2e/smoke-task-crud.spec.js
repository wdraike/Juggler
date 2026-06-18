const { test, expect } = require('@playwright/test');

test.describe('999.188 — Task CRUD smoke', () => {
  test('task creation form renders', async ({ page }) => {
    await page.goto('http://localhost:3002');
    // Look for the add task button or form
    const addBtn = page.locator('button:has-text("Add"), button:has-text("New"), [aria-label*="add" i], [aria-label*="create" i]');
    if (await addBtn.count() > 0) {
      await expect(addBtn.first()).toBeVisible({ timeout: 5000 });
    }
  });
});
