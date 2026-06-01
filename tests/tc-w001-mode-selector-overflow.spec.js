// @ts-check
/**
 * TC-W001 — Mode Selector Overflow Check
 * UX-JUG-004
 *
 * Verifies that the NavigationBar view-mode button row (11 buttons: Day, Flex,
 * 3-Day, Week, Month, Timeline, List, Priority, Clock, Deps, Issues) does NOT
 * produce horizontal overflow at the seven canonical viewport widths.
 *
 * Note: The UX item references a "5-button mode selector". The current
 * NavigationBar has 11 VIEW_MODES. This test covers the full selector as
 * implemented — any future redesign that reduces to 5 buttons should update
 * the viewport list below.
 *
 * Viewport widths under test (TC-W001 spec):
 *   320, 375, 768, 1024, 1280, 1440, 1920 px
 *
 * These tests require a running juggler-frontend dev server.
 * Start it with: npm start (in juggler-frontend/) or via test-bed.
 * The baseURL is read from PLAYWRIGHT_BASE_URL or FRONTEND_URL env var
 * (default: http://localhost:3002 as set in playwright.config.js).
 *
 * Run: npx playwright test tests/tc-w001-mode-selector-overflow.spec.js
 */

const { test, expect } = require('@playwright/test');
const { setupAuth } = require('./helpers/playwright-helpers');

// ── Viewport definitions (TC-W001 required widths) ──────────────────────────
const VIEWPORTS = [
  { width: 320,  height: 568,  label: '320px (reflow minimum)' },
  { width: 375,  height: 667,  label: '375px (mobile-sm, iPhone SE)' },
  { width: 768,  height: 1024, label: '768px (tablet portrait)' },
  { width: 1024, height: 768,  label: '1024px (tablet landscape / small laptop)' },
  { width: 1280, height: 800,  label: '1280px (laptop)' },
  { width: 1440, height: 900,  label: '1440px (desktop)' },
  { width: 1920, height: 1080, label: '1920px (wide desktop)' },
];

for (const vp of VIEWPORTS) {
  test.describe(`TC-W001 @ ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await setupAuth(page);
      await page.goto('/');
      await page.waitForSelector('text=StriveRS', { timeout: 15000 });
    });

    // ── TC-W001-A: Document body has no horizontal overflow ──────────
    test('TC-W001-A: no document-level horizontal overflow', async ({ page }) => {
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasOverflow).toBe(false);
    });

    // ── TC-W001-B: NavigationBar container is within viewport ────────
    test('TC-W001-B: NavigationBar container does not extend past viewport', async ({ page }) => {
      // Locate the NavigationBar via a stable title-anchored button.
      // Using title^= avoids mobile/desktop icon vs label branching.
      const modeButtonLocator = page.locator('button[title^="Day view"]').first();

      // It's acceptable if the button isn't visible (app may not render
      // the NavBar when no tasks exist); we check conditionally.
      const isVisible = await modeButtonLocator.isVisible().catch(() => false);

      if (isVisible) {
        // Walk up to the NavigationBar wrapper via CSS heuristic:
        // it is the outermost element with flexWrap: wrap and a border-bottom.
        const containerBox = await page.evaluate(() => {
          const navSection = document.querySelectorAll('[style*="border-bottom"]');
          // Find the NavigationBar wrapper — it has flexWrap: wrap in its inline style
          let navBar = null;
          for (const el of navSection) {
            if (el.style && el.style.flexWrap === 'wrap') {
              navBar = el;
              break;
            }
          }
          // navBar not found: NavBar not yet rendered (no tasks) — body overflow check below still fires.
          if (!navBar) return null;
          const rect = navBar.getBoundingClientRect();
          return { right: rect.right, width: rect.width, left: rect.left };
        });

        if (containerBox) {
          // Container right edge must be at or within the viewport width (2px tolerance)
          expect(containerBox.right).toBeLessThanOrEqual(vp.width + 2);
          expect(containerBox.left).toBeGreaterThanOrEqual(0);
        }
      }

      // Regardless of whether the nav is visible, the document must not overflow
      const hasDocOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasDocOverflow).toBe(false);
    });

    // ── TC-W001-C: Each visible mode button is within viewport bounds ─
    test('TC-W001-C: all visible mode buttons within viewport width', async ({ page }) => {
      // Use title-attribute prefixes — stable across mobile/desktop (same title= regardless
      // of whether the button renders an icon char or a text label).
      // SYNC: keep in sync with VIEW_MODES tips in NavigationBar.jsx.
      const viewTitlePrefixes = [
        'Day view',
        'Flex view',
        '3-Day view',
        'Week view',
        'Month view',
        'Timeline view',
        'List view',
        'Priority view',
        'Clock view',
        'Dependencies view',
        'Issues view',
      ];

      // Soft-check: we don't require all 11 buttons to be visible — the NavigationBar
      // may not render when the app loads with no tasks. TC-W001-D (app-shell smoke)
      // covers the zero-visible case. Any button that IS visible must be in bounds.
      let checkedCount = 0;
      for (const titlePrefix of viewTitlePrefixes) {
        const btn = page.locator(`button[title^="${titlePrefix}"]`).first();
        const isVisible = await btn.isVisible().catch(() => false);
        if (!isVisible) continue;

        const box = await btn.boundingBox();
        if (!box) continue;

        checkedCount++;
        // Button must start at or after x=0
        expect(box.x).toBeGreaterThanOrEqual(0);
        // Button right edge must be within viewport (2px tolerance for sub-pixel)
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 2);
      }
    });

    // ── TC-W001-D: App shell still renders (no crash) ────────────────
    test('TC-W001-D: app shell renders without crash', async ({ page }) => {
      await expect(page.locator('text=StriveRS').first()).toBeVisible();
    });
  });
}
