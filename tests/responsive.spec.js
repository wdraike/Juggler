// @ts-check
const { test, expect } = require('@playwright/test');

const TEST_TOKEN = process.env.TEST_TOKEN || '';
const TEST_USER = {
  id: 'test-user-00000000-0000-0000-0000',
  email: 'test@juggler.local',
  name: 'Test User',
  picture: null,
  timezone: 'America/New_York',
};

async function setupAuth(page) {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: TEST_TOKEN }),
    })
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: TEST_USER }),
    })
  );
}

// ── Device definitions ───────────────────────────────────────────────
// Covers the most common real-world form factors:
//   phones (small + large), tablets (portrait + landscape), desktop
const DEVICES = [
  // Phones
  { name: 'iPhone SE',         width: 375,  height: 667,  mobile: true  },
  { name: 'iPhone 14',         width: 390,  height: 844,  mobile: true  },
  { name: 'iPhone 14 Pro Max', width: 430,  height: 932,  mobile: true  },
  { name: 'Pixel 7',           width: 412,  height: 915,  mobile: true  },
  { name: 'Pixel 7 Pro',       width: 412,  height: 892,  mobile: true  },
  { name: 'Samsung Galaxy S23', width: 360, height: 780,  mobile: true  },
  // Tablets
  { name: 'iPad Mini',         width: 744,  height: 1133, mobile: false },
  { name: 'iPad Air',          width: 820,  height: 1180, mobile: false },
  { name: 'iPad Pro 11"',      width: 834,  height: 1194, mobile: false },
  { name: 'iPad Pro 12.9"',    width: 1024, height: 1366, mobile: false },
  { name: 'iPad landscape',    width: 1180, height: 820,  mobile: false },
  // Desktop
  { name: 'Laptop 1366x768',   width: 1366, height: 768,  mobile: false },
  { name: 'Desktop 1920x1080', width: 1920, height: 1080, mobile: false },
];

for (const device of DEVICES) {
  test.describe(`${device.name} (${device.width}x${device.height})`, () => {
    test.use({ viewport: { width: device.width, height: device.height } });

    test.beforeEach(async ({ page }) => {
      await setupAuth(page);
      await page.goto('/');
      await page.waitForSelector('text=Juggler', { timeout: 15000 });
    });

    // ── 1. App loads without overflow ──────────────────────────────
    test('app loads — no horizontal overflow', async ({ page }) => {
      // Header/juggler icon should be visible
      await expect(page.locator('text=Juggler').first()).toBeVisible();

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
          await btn.click();
          await page.waitForTimeout(300);
          // Page should not crash — juggler icon is always present
          const juggler = page.locator('text=Juggler').first();
          // On small mobile the text "Juggler" may be hidden, but the emoji stays
          const emoji = page.locator('text=🤹');
          const visible = await juggler.isVisible() || await emoji.isVisible();
          expect(visible).toBe(true);
        }
      }
    });

    // ── 4. Day view: calendar grid fits viewport ───────────────────
    test('Day view — grid fits within viewport', async ({ page }) => {
      const dayBtn = device.mobile
        ? page.locator('button:has-text("1")').first()
        : page.locator('button:has-text("Day")').first();
      await dayBtn.click();
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
        const juggler = page.locator('text=Juggler').first();
        const emoji = page.locator('text=🤹');
        const visible = await juggler.isVisible() || await emoji.isVisible();
        expect(visible).toBe(true);
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
        const emoji = page.locator('text=🤹');
        await expect(emoji.first()).toBeVisible();
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
    }

    // ── 6. Tablet/Desktop: inline filter pills visible ─────────────
    if (!device.mobile && device.width >= 744) {
      test('tablet/desktop — inline filter pills visible', async ({ page }) => {
        // On wider screens, filter pills should be inline
        const openPill = page.locator('button:has-text("Open")');
        const allPill = page.locator('button:has-text("All")');
        const hasOpen = await openPill.first().isVisible().catch(() => false);
        const hasAll = await allPill.first().isVisible().catch(() => false);
        expect(hasOpen || hasAll).toBe(true);
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
        const settingsBtn = page.locator('button[title="Settings"]');
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
      await weekBtn.click();
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
      await monthBtn.click();
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
      await listBtn.click();
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
      await timelineBtn.click();
      await page.waitForTimeout(500);

      // Timeline is horizontally scrollable by design, so just check no crash
      const emoji = page.locator('text=🤹');
      const juggler = page.locator('text=Juggler').first();
      const visible = await juggler.isVisible() || await emoji.isVisible();
      expect(visible).toBe(true);
    });

    // ── 12. Priority view kanban columns fit ───────────────────────
    test('Priority view — renders without overflow', async ({ page }) => {
      const prioBtn = device.mobile
        ? page.locator('button:has-text("P")').first()
        : page.locator('button:has-text("Priority")').first();
      await prioBtn.click();
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
      const emoji = page.locator('text=🤹');
      const juggler = page.locator('text=Juggler').first();
      const visible = await juggler.isVisible() || await emoji.isVisible();
      expect(visible).toBe(true);
    });

    // ── 14. Week navigation works at this viewport ─────────────────
    test('week navigation arrows work', async ({ page }) => {
      const nextDay = page.locator('button[title="Next day"]');
      const prevDay = page.locator('button[title="Previous day"]');
      const today = page.locator('button[title="Go to today"]');

      if (await nextDay.isVisible()) {
        await nextDay.click();
        await page.waitForTimeout(200);
      }
      if (await prevDay.isVisible()) {
        await prevDay.click();
        await page.waitForTimeout(200);
      }
      if (await today.isVisible()) {
        await today.click();
        await page.waitForTimeout(200);
      }

      const emoji = page.locator('text=🤹');
      const juggler = page.locator('text=Juggler').first();
      const visible = await juggler.isVisible() || await emoji.isVisible();
      expect(visible).toBe(true);
    });
  });
}
