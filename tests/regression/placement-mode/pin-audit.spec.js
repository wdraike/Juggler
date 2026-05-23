// @ts-check
/**
 * Bird UX audit — comprehensive pin badge discovery across all views.
 * Counts how many 📌 icons render in each view, and which task texts they associate with.
 */
const { test, expect, request } = require('@playwright/test');

const BASE_URL = 'http://localhost:3002';
const AUTH_URL = 'http://localhost:5010';
const API_URL = 'http://localhost:5002/api';
const EMAIL = 'wdraike@gmail.com';
const PASSWORD = 'TempPass2024!';

let accessToken;

test.beforeAll(async () => {
  const ctx = await request.newContext();
  const res = await ctx.post(`${AUTH_URL}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  const body = await res.json();
  accessToken = body.tokens.accessToken;
});

async function setupApp(page) {
  await page.addInitScript((token) => {
    localStorage.setItem('juggler-access-token', token);
  }, accessToken);
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('text=StriveRS', { timeout: 30000 });
  await page.waitForTimeout(2000);
}

async function clickViewTab(page, label) {
  await page.evaluate((lbl) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => x.textContent.trim() === lbl);
    if (b) b.click();
  }, label);
  await page.waitForTimeout(1500);
}

async function clickFilterPill(page, label) {
  await page.evaluate((lbl) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => (x.textContent || '').trim().startsWith(lbl));
    if (b) b.click();
  }, label);
  await page.waitForTimeout(1500);
}

test('AUDIT — Pin badge presence across all views, filtered to Fixed', async ({ page }) => {
  await setupApp(page);

  // Use the Fixed filter so we focus on the 7 tasks the system flagged
  await clickFilterPill(page, 'Fixed');
  await page.waitForTimeout(1500);

  const viewsToTest = ['Day', 'List', 'Week', 'Timeline', 'Priority'];
  const results = {};

  for (const view of viewsToTest) {
    await clickViewTab(page, view);
    await page.waitForTimeout(2500);

    const audit = await page.evaluate(() => {
      const PIN = '📌'; // 📌
      // Find all elements that contain the pin emoji directly (not inherited from large parent)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      const matches = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.includes(PIN)) {
          // Get surrounding context — walk up to find a task-like container
          let el = node.parentElement;
          for (let i = 0; i < 6 && el && el.textContent.length < 300; i++) {
            el = el.parentElement;
          }
          matches.push({
            value: node.nodeValue.slice(0, 40),
            context: el ? el.textContent.slice(0, 200) : 'no-parent',
          });
        }
      }
      // Find all visible task tiles (cards) regardless of pin
      const tiles = Array.from(document.querySelectorAll('div, article')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.textContent || '').trim().length > 0;
      });
      // Find the Fix Weed Wacker task tile
      const wackerTile = tiles.find((el) => (el.textContent || '').includes('Fix Weed Wacker') && (el.textContent || '').length < 400);
      const wackerInfo = wackerTile ? {
        text: wackerTile.textContent.slice(0, 300),
        html: wackerTile.outerHTML.slice(0, 800),
        hasPin: wackerTile.textContent.includes(PIN),
      } : null;
      return { pinCount: matches.length, samples: matches.slice(0, 10), wackerInfo };
    });
    results[view] = audit;
    await page.screenshot({ path: `tests/ux-bird-audit-fixed-${view}.png`, fullPage: true });
  }

  console.log('==== AUDIT RESULTS ====');
  console.log(JSON.stringify(results, null, 2));
});
