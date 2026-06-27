// @covers screen:month
const { test, expect } = require('@playwright/test');

test.describe('999.189 — Calendar render smoke', () => {
  test('page renders without crash', async ({ page }) => {
    await page.goto('http://localhost:3002');
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    // No JS errors
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.waitForTimeout(2000);
    expect(errors.length).toBe(0);
  });
});
