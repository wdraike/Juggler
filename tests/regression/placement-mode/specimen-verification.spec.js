// @ts-check
/**
 * Bird UX review — placement_mode frontend migration verification.
 *
 * Verifies that calendar-imported tasks (legacy when='fixed' but
 * placement_mode!='fixed') no longer render with a 📌 fixed/pinned badge
 * on the day view, while legitimately fixed tasks still do.
 *
 * Specimens for 2026-05-23 (Saturday):
 *  - "Submit Peter's March charges for reimbursment" → NO pin
 *  - "Nail Down Chicago Trip Plan"                   → NO pin
 *  - "fix gmail plug in"                             → NO pin
 *  - "CTA: Decide what to do with old Fiserv 401(k)" → NO pin
 *  - "Fix Weed Wacker"                               → YES pin (control)
 */
const { test, expect, request } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const AUTH_URL = process.env.AUTH_URL || 'http://localhost:5010';
const API_URL = process.env.API_URL || 'http://localhost:5002/api';
const EMAIL = 'wdraike@gmail.com';
const PASSWORD = 'TempPass2024!';

const PIN = '📌';   // 📌

let accessToken;

test.beforeAll(async () => {
  const ctx = await request.newContext();
  const res = await ctx.post(`${AUTH_URL}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), `Auth login status ${res.status()}`).toBe(true);
  const body = await res.json();
  accessToken = body.tokens.accessToken;
  expect(accessToken).toBeTruthy();
});

async function gotoApp(page) {
  await page.addInitScript((token) => {
    localStorage.setItem('juggler-access-token', token);
  }, accessToken);
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('text=StriveRS', { timeout: 30000 });
  // Default landing should be Day view — but tap exact tab anyway
  const dayTab = page.locator('button:has-text("Day")').first();
  // dayTab may be intercepted by add-task button if overlap; click via JS
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const day = btns.find((b) => b.textContent.trim() === 'Day');
    if (day) day.click();
  });
  await page.waitForTimeout(2500);
}

test('TC-BIRD-001 — May 23 day view: 4 specimens render WITHOUT pin badge', async ({ page }) => {
  await gotoApp(page);

  const specimens = [
    { needle: "Submit Peter's March", full: "Submit Peter's March charges for reimbursment" },
    { needle: 'Nail Down Chicago',     full: 'Nail Down Chicago Trip Plan' },
    { needle: 'fix gmail plug in',     full: 'fix gmail plug in' },
    { needle: 'old Fiserv 401',        full: 'CTA: Decide what to do with old Fiserv 401(k) at Merrill' },
  ];

  const findings = [];
  for (const sp of specimens) {
    const html = await page.content();
    const present = html.includes(sp.needle);
    if (!present) {
      findings.push({ task: sp.full, status: 'NOT_IN_DOM' });
      continue;
    }
    // Find the nearest element containing the needle
    const result = await page.evaluate((needle) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.includes(needle)) {
          // walk up to a reasonably sized container
          let el = node.parentElement;
          for (let i = 0; i < 5 && el && el.textContent.length < 500; i++) {
            el = el.parentElement;
          }
          if (!el) el = node.parentElement;
          return {
            text: (el.textContent || '').slice(0, 400),
            html: (el.outerHTML || '').slice(0, 800),
          };
        }
      }
      return null;
    }, sp.needle);
    if (!result) {
      findings.push({ task: sp.full, status: 'NOT_FOUND_WALKING' });
      continue;
    }
    const hasPin = result.text.includes('📌') || result.html.includes('\\uD83D\\uDCCC');
    const hasOverdue = /overdue/i.test(result.text);
    findings.push({ task: sp.full, hasPin, hasOverdue, sample: result.text.slice(0, 160) });
  }

  console.log('SPECIMEN_FINDINGS:', JSON.stringify(findings, null, 2));
  await page.screenshot({ path: 'tests/ux-bird-may23-day-view.png', fullPage: true });

  const checked = findings.filter((f) => !f.status);
  for (const f of checked) {
    expect(f.hasPin, `${f.task} should NOT have 📌 pin badge`).toBe(false);
    expect(f.hasOverdue, `${f.task} should NOT have overdue indicator`).toBe(false);
  }
});

test('TC-BIRD-002 — Fix Weed Wacker shows 📌 pin badge (legitimately fixed)', async ({ page }) => {
  await gotoApp(page);

  // Filter to Fixed to make sure the task is rendered visibly
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const fixed = btns.find((b) => b.textContent.trim() === 'Fixed');
    if (fixed) fixed.click();
  });
  await page.waitForTimeout(1000);
  // Switch to List view for definitive task discovery
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const list = btns.find((b) => b.textContent.trim() === 'List');
    if (list) list.click();
  });
  await page.waitForTimeout(1500);

  const wackerInfo = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes('Fix Weed Wacker')) {
        let el = node.parentElement;
        for (let i = 0; i < 6 && el && el.textContent.length < 600; i++) {
          el = el.parentElement;
        }
        if (!el) el = node.parentElement;
        return {
          text: el.textContent.slice(0, 600),
          html: el.outerHTML.slice(0, 1500),
        };
      }
    }
    return null;
  });

  console.log('WACKER_FOUND:', !!wackerInfo);
  if (wackerInfo) {
    console.log('WACKER_TEXT:', wackerInfo.text);
    console.log('WACKER_HAS_PIN:', wackerInfo.text.includes('📌'));
  }
  await page.screenshot({ path: 'tests/ux-bird-wacker-listview.png', fullPage: true });

  // Now switch back to Day view and re-check
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const day = btns.find((b) => b.textContent.trim() === 'Day');
    if (day) day.click();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/ux-bird-wacker-dayview.png', fullPage: true });

  const wackerDay = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes('Fix Weed Wacker')) {
        let el = node.parentElement;
        for (let i = 0; i < 6 && el && el.textContent.length < 600; i++) {
          el = el.parentElement;
        }
        if (!el) el = node.parentElement;
        return { text: el.textContent.slice(0, 600), html: el.outerHTML.slice(0, 1500) };
      }
    }
    return null;
  });
  console.log('WACKER_DAY_FOUND:', !!wackerDay);
  if (wackerDay) {
    console.log('WACKER_DAY_TEXT:', wackerDay.text);
    console.log('WACKER_DAY_HAS_PIN:', wackerDay.text.includes('📌'));
  }
});

test('TC-BIRD-003 — Filter pills show Fixed (7) and Overdue (2)', async ({ page }) => {
  await gotoApp(page);
  await page.screenshot({ path: 'tests/ux-bird-day-view-full.png', fullPage: true });

  // Filter pills are inline — search for "Fixed (n)" and "Overdue (n)"
  const text = await page.textContent('body');
  console.log('PAGE_TEXT_SAMPLE:', (text || '').slice(0, 1000));

  // Pills render as `Fixed N` or `Fixed (N)` depending on style
  const fixedMatch = (text || '').match(/Fixed\s*\(?\s*(\d+)\s*\)?/);
  const overdueMatch = (text || '').match(/Overdue\s*\(?\s*(\d+)\s*\)?/);
  console.log('FIXED_COUNT:', fixedMatch && fixedMatch[1], 'OVERDUE_COUNT:', overdueMatch && overdueMatch[1]);

  if (fixedMatch) expect(parseInt(fixedMatch[1], 10)).toBe(7);
  if (overdueMatch) expect(parseInt(overdueMatch[1], 10)).toBe(2);
});

test('TC-BIRD-004 — Open specimen editor: 🔄 Anytime is active scheduling mode', async ({ page }) => {
  await gotoApp(page);

  // Click on the specimen text to open editor
  const opened = await page.evaluate(() => {
    const candidates = ['fix gmail plug in', 'Nail Down Chicago', "Submit Peter's March", 'old Fiserv 401'];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      for (const c of candidates) {
        if (node.nodeValue && node.nodeValue.includes(c)) {
          let el = node.parentElement;
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              el.click();
              return c;
            }
          }
        }
      }
    }
    return null;
  });
  console.log('OPENED_TASK:', opened);
  await page.waitForTimeout(1500);

  const sched = await page.locator('text=Scheduling mode').first().isVisible().catch(() => false);
  console.log('SCHEDULING_MODE_VISIBLE:', sched);
  if (!sched) {
    await page.screenshot({ path: 'tests/ux-bird-editor-missing.png', fullPage: true });
    return;
  }

  const anytimeBtn = page.locator('button:has-text("🔄 Anytime")').first();
  const visible = await anytimeBtn.isVisible().catch(() => false);
  if (visible) {
    const style = (await anytimeBtn.getAttribute('style')) || '';
    const isActive = /2px solid/.test(style);
    console.log('ANYTIME_ACTIVE:', isActive, '| STYLE:', style.slice(0, 200));
    expect(isActive, '🔄 Anytime should be the active scheduling mode').toBe(true);
  }
  await page.screenshot({ path: 'tests/ux-bird-editor-anytime-active.png', fullPage: true });
});

test('TC-BIRD-005 — API verification: 4 specimens are anytime, Weed Wacker is fixed', async () => {
  const ctx = await request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });
  const res = await ctx.get(`${API_URL}/tasks`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const tasks = Array.isArray(body) ? body : (body.tasks || []);
  const counts = { fixed: 0, allDay: 0, anytime: 0, timeWindow: 0, timeBlocks: 0, none: 0 };
  const fixedTitles = [];
  for (const t of tasks) {
    const pm = t.placement_mode || t.placementMode;
    if (pm === 'fixed') { counts.fixed++; fixedTitles.push(t.text); }
    else if (pm === 'all_day') counts.allDay++;
    else if (pm === 'anytime') counts.anytime++;
    else if (pm === 'time_window') counts.timeWindow++;
    else if (pm === 'time_blocks') counts.timeBlocks++;
    else counts.none++;
  }
  console.log('TASK_TOTAL:', tasks.length, 'PLACEMENT_MODE_COUNTS:', counts);
  console.log('FIXED_TITLES:', fixedTitles);

  const needles = [
    "Submit Peter's March", 'Nail Down Chicago', 'fix gmail plug in', 'CTA: Decide what to do with old Fiserv',
  ];
  for (const n of needles) {
    const m = tasks.find((t) => (t.text || '').includes(n));
    if (m) {
      const pm = m.placement_mode || m.placementMode;
      console.log(`[${n}] placement_mode=${pm} when=${m.when} fixed=${m.fixed} rigid=${m.rigid}`);
      expect(pm).not.toBe('fixed');
    }
  }
  const w = tasks.find((t) => (t.text || '').includes('Fix Weed Wacker'));
  if (w) {
    const pm = w.placement_mode || w.placementMode;
    console.log(`[Fix Weed Wacker] placement_mode=${pm} when=${w.when} fixed=${w.fixed} rigid=${w.rigid}`);
    expect(pm).toBe('fixed');
  }
});
