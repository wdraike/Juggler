// @covers screen:login
// @covers path:15
const { test, expect } = require('@playwright/test');

test.describe('999.187 — Login → Dashboard smoke', () => {
  test('landing page loads and shows sign-in button', async ({ page }) => {
    await page.goto('http://localhost:3002');
    await expect(page.locator('text=SIGN IN').first()).toBeVisible({ timeout: 10000 });
  });

  test('sign-in button navigates to auth', async ({ page }) => {
    await page.goto('http://localhost:3002');
    await page.locator('text=SIGN IN').first().click();
    // Should redirect to auth service
    await page.waitForURL(/auth/, { timeout: 10000 });
    expect(page.url()).toContain('auth');
  });
});
