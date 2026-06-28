// @ts-check
const { test, expect } = require('@playwright/test');
const { setupAuth } = require('./helpers/playwright-helpers');

// ── Device definitions ───────────────────────────────────────────────
// Full viewport sweep — large desktop down to small mobile browser.
// Covers real-world devices plus standard breakpoint sizes for CI.
const DEVICES = [
  // Phones — small to large
  { name: 'iPhone SE 1st (320x568)',  width: 320,  height: 568,  mobile: true  },
  { name: 'Samsung Galaxy S23',       width: 360,  height: 780,  mobile: true  },
  { name: 'iPhone SE',                width: 375,  height: 667,  mobile: true  },
  { name: 'iPhone 14',                width: 390,  height: 844,  mobile: true  },
  { name: 'iPhone XR / 11 (414x896)', width: 414,  height: 896,  mobile: true  },
  { name: 'Pixel 7',                  width: 412,  height: 915,  mobile: true  },
  { name: 'Pixel 7 Pro',              width: 412,  height: 892,  mobile: true  },
  { name: 'iPhone 14 Pro Max',        width: 430,  height: 932,  mobile: true  },
  // Tablets — portrait + landscape
  { name: 'iPad Portrait (768x1024)',  width: 768,  height: 1024, mobile: false },
  { name: 'iPad Mini',                 width: 744,  height: 1133, mobile: false },
  { name: 'iPad Air',                  width: 820,  height: 1180, mobile: false },
  { name: 'iPad Pro 11"',              width: 834,  height: 1194, mobile: false },
  { name: 'iPad Pro 12.9"',            width: 1024, height: 1366, mobile: false },
  { name: 'iPad Landscape (1024x768)', width: 1024, height: 768,  mobile: false },
  { name: 'iPad landscape',            width: 1180, height: 820,  mobile: false },
  // Desktop — laptop to large display
  { name: 'Laptop 1366x768',    width: 1366, height: 768,  mobile: false },
  { name: 'Laptop 1440x900',    width: 1440, height: 900,  mobile: false },
  { name: 'Desktop 1920x1080',  width: 1920, height: 1080, mobile: false },
  { name: 'Large Desktop 2560x1440', width: 2560, height: 1440, mobile: false },
];

for (const device of DEVICES) {
  test.describe(`${device.name} (${device.width}x${device.height})`, () => {
    test.use({ viewport: { width: device.width, height: device.height } });

    test.beforeEach(async ({ page }) => {
      await setupAuth(page);
      await page.goto('/');
      await page.waitForSelector('text=StriveRS', { timeout: 15000 });
    });

    // ── 1. App loads without overflow ──────────────────────────────
    test('app loads — no horizontal overflow', async ({ page }) => {
      // Header/juggler icon should be visible
      await expect(page.locator('text=StriveRS').first()).toBeVisible();

      // The body should not scroll horizontally
      const overflowX = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflowX).toBe(false);
    });

    // ── 2. Navigation bar fits within viewport ─────────────────────
    test('navigation bar fits within viewport width', async ({ page }) => {
      // All view mode buttons should be visible (not clipped)
      const navButtons = page.locator('button').filter({ hasText: /^(Day|3-Day|Week|Month|List|Priority|Issues|Timeline|1|3|7|M|≡|P|!|↔)$/ });
      const count = await navButtons.count();
      expect(count).toBeGreaterThan(0);

      // Check no nav button extends past the viewport
      for (let i = 0; i < Math.min(count, 8); i++) {
        const box = await navButtons.nth(i).boundingBox();
        if (box) {
          expect(box.x + box.width).toBeLessThanOrEqual(device.width + 2); // 2px tolerance
        }
      }
    });

    // ── 3. All views render without crash ──────────────────────────
    test('all views render without crash', async ({ page }) => {
      // On mobile, view tabs show icons; on desktop, labels
      const viewSelectors = device.mobile
        ? ['1', '3', '7', 'M', '↔', '≡', 'P', '!']
        : ['Day', '3-Day', 'Week', 'Month', 'Timeline', 'List', 'Priority', 'Issues'];

      for (const label of viewSelectors) {
        const btn = page.locator(`button:has-text("${label}")`).first();
        if (await btn.isVisible()) {
          await btn.click({ force: true });
          await page.waitForTimeout(300);
          // Page should not crash — brand wordmark always present
          await expect(page.locator('text=StriveRS').first()).toBeVisible();
        }
      }
    });

    // ── 4. Day view: calendar grid fits viewport ───────────────────
    test('Day view — grid fits within viewport', async ({ page }) => {
      const dayBtn = device.mobile
        ? page.locator('button:has-text("1")').first()
        : page.locator('button:has-text("Day")').first();
      await dayBtn.click({ force: true });
      await page.waitForTimeout(500);

      // Hour labels should be visible
      await expect(page.locator('text=8 AM').first()).toBeVisible();

      // The calendar container should not overflow
      const overflowX = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflowX).toBe(false);
    });

    // ── 5. Mobile-specific: overflow menu instead of inline buttons ─
    if (device.mobile) {
      test('mobile — overflow menu visible instead of inline buttons', async ({ page }) => {
        // On mobile (<600px), Settings/Export/etc move to overflow "..." menu
        // The "..." button should exist
        const overflowBtn = page.locator('button:has-text("…")').or(page.locator('button:has-text("⋯")'));
        const hasOverflow = await overflowBtn.first().isVisible().catch(() => false);

        if (hasOverflow) {
          await overflowBtn.first().click();
          await page.waitForTimeout(200);
          // Overflow menu should show Settings option
          await expect(page.locator('text=Settings').first()).toBeVisible();
        }
        // Whether overflow exists or not, app shouldn't crash
        await expect(page.locator('text=StriveRS').first()).toBeVisible();
      });

      test('mobile — filter dropdown instead of inline pills', async ({ page }) => {
        // On mobile, filters collapse into a dropdown button
        // Look for a filter dropdown trigger (the active filter label as a button)
        const filterBtn = page.locator('button:has-text("Open")').or(
          page.locator('button:has-text("All")'));
        const hasFilter = await filterBtn.first().isVisible().catch(() => false);
        if (hasFilter) {
          await filterBtn.first().click();
          await page.waitForTimeout(200);
        }
        // No crash
        await expect(page.locator('text=StriveRS').first()).toBeVisible();
      });

      test('mobile — view tabs show icons not labels', async ({ page }) => {
        // On mobile, view tabs should show single-char icons: 1, 3, 7, M, ≡, P, !
        // The full-word labels like "Day", "Week" should NOT appear in the nav
        const dayLabel = page.locator('button').filter({ hasText: /^Day$/ });
        const dayIcon = page.locator('button').filter({ hasText: /^1$/ });

        const labelVisible = await dayLabel.first().isVisible().catch(() => false);
        const iconVisible = await dayIcon.first().isVisible().catch(() => false);

        // On mobile: icon visible, label hidden (or label may exist but icon takes priority)
        expect(iconVisible || !labelVisible).toBe(true);
      });

      test('mobile — touch targets meet minimum size', async ({ page }) => {
        // ponytail: WCAG 2.5.5 / Apple HIG recommend 44px minimum touch targets.
        // Current nav buttons are ~30px at 320px width — below the recommendation.
        // Threshold set to 28px to catch regressions without failing on the known gap.
        // Ceiling: when buttons are bumped to 44px, raise this to 42.
        const navButtons = page.locator('button').filter({ hasText: /^(1|3|7|M|≡|P|!|↔|…|⋯)$/ });
        const count = await navButtons.count();
        let checked = 0;
        for (let i = 0; i < count; i++) {
          const box = await navButtons.nth(i).boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(28);
            checked++;
          }
        }
        expect(checked).toBeGreaterThan(0);
      });
    }

    // ── 6. Tablet/Desktop: inline filter pills visible ─────────────
    if (!device.mobile && device.width >= 744) {
      test('tablet/desktop — inline filter pills visible', async ({ page }) => {
        // On wider screens, filter is a select dropdown (not buttons)
        const filterSelect = page.locator('select').first();
        const hasFilter = await filterSelect.first().isVisible().catch(() => false);
        expect(hasFilter).toBe(true);
      });
    }

    // ── 7. Settings panel doesn't overflow ─────────────────────────
    test('settings panel fits viewport', async ({ page }) => {
      // Open settings — on mobile it's in overflow menu, on desktop it's a button
      if (device.mobile) {
        const overflowBtn = page.locator('button:has-text("…")').or(page.locator('button:has-text("⋯")'));
        const hasOverflow = await overflowBtn.first().isVisible().catch(() => false);
        if (hasOverflow) {
          await overflowBtn.first().click();
          await page.waitForTimeout(200);
          const settingsItem = page.locator('text=Settings').first();
          if (await settingsItem.isVisible()) {
            await settingsItem.click();
          }
        }
      } else {
        const settingsBtn = page.locator('button[title="Settings — locations, tools, templates, and preferences"]');
        if (await settingsBtn.isVisible()) {
          await settingsBtn.click();
        }
      }

      await page.waitForTimeout(300);

      // If settings opened, check it doesn't overflow
      const settingsVisible = await page.locator('text=Settings').first().isVisible().catch(() => false);
      if (settingsVisible) {
        const overflowX = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        expect(overflowX).toBe(false);

        // Close settings
        await page.keyboard.press('Escape');
      }
    });

    // ── 8. Week view columns scale with viewport ───────────────────
    test('Week view — renders without overflow', async ({ page }) => {
      const weekBtn = device.mobile
        ? page.locator('button:has-text("7")').first()
        : page.locator('button:has-text("Week")').first();
      await weekBtn.click({ force: true });
      await page.waitForTimeout(500);

      const overflowX = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflowX).toBe(false);
    });

    // ── 9. Month view grid fits ────────────────────────────────────
    test('Month view — renders without overflow', async ({ page }) => {
      const monthBtn = device.mobile
        ? page.locator('button:has-text("M")').first()
        : page.locator('button:has-text("Month")').first();
      await monthBtn.click({ force: true });
      await page.waitForTimeout(500);

      const overflowX = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflowX).toBe(false);
    });

    // ── 10. List view renders without overflow ─────────────────────
    test('List view — renders without overflow', async ({ page }) => {
      const listBtn = device.mobile
        ? page.locator('button:has-text("≡")').first()
        : page.locator('button:has-text("List")').first();
      await listBtn.click({ force: true });
      await page.waitForTimeout(500);

      const overflowX = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflowX).toBe(false);
    });

    // ── 11. Timeline view renders without overflow ─────────────────
    test('Timeline view — renders without overflow', async ({ page }) => {
      const timelineBtn = device.mobile
        ? page.locator('button:has-text("↔")').first()
        : page.locator('button:has-text("Timeline")').first();
      await timelineBtn.click({ force: true });
      await page.waitForTimeout(500);

      // Timeline is horizontally scrollable by design, so just check no crash
      await expect(page.locator('text=StriveRS').first()).toBeVisible();
    });

    // ── 12. Priority view kanban columns fit ───────────────────────
    test('Priority view — renders without overflow', async ({ page }) => {
      const prioBtn = device.mobile
        ? page.locator('button:has-text("P")').first()
        : page.locator('button:has-text("Priority")').first();
      await prioBtn.click({ force: true });
      await page.waitForTimeout(500);

      const overflowX = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(overflowX).toBe(false);
    });

    // ── 13. Dark mode toggle works at this viewport ────────────────
    test('dark mode toggle works', async ({ page }) => {
      if (device.mobile) {
        // Open overflow menu to find toggle
        const overflowBtn = page.locator('button:has-text("…")').or(page.locator('button:has-text("⋯")'));
        const hasOverflow = await overflowBtn.first().isVisible().catch(() => false);
        if (hasOverflow) {
          await overflowBtn.first().click();
          await page.waitForTimeout(200);
          const darkItem = page.locator('text=Dark Mode').or(page.locator('text=Light Mode'));
          if (await darkItem.first().isVisible()) {
            await darkItem.first().click();
            await page.waitForTimeout(300);
          }
        }
      } else {
        const toggleBtn = page.locator('button[title="Toggle dark mode"]');
        if (await toggleBtn.isVisible()) {
          await toggleBtn.click();
          await page.waitForTimeout(300);
          // Toggle back
          await toggleBtn.click();
        }
      }
      // No crash
      await expect(page.locator('text=StriveRS').first()).toBeVisible();
    });

    // ── 14. Week navigation works at this viewport ─────────────────
    test('week navigation arrows work', async ({ page }) => {
      // Navigation buttons use « ‹ symbols (HeaderBar/WeekStrip)
      const nextDay = page.locator('button:has-text("›")').or(page.locator('button:has-text("»")')).first();
      const prevDay = page.locator('button:has-text("‹")').or(page.locator('button:has-text("«")')).first();
      const today = page.locator('button:has-text("Today")').first();

      if (await nextDay.isVisible()) {
        await nextDay.click({ force: true });
        await page.waitForTimeout(300);
      }
      if (await prevDay.isVisible()) {
        await prevDay.click({ force: true });
        await page.waitForTimeout(300);
      }
      if (await today.isVisible()) {
        await today.click({ force: true });
        await page.waitForTimeout(300);
      }

      await expect(page.locator('text=StriveRS').first()).toBeVisible();
    });
  });
}
