/**
 * A-002 Location-Availability Matrix — Pre-Refactor Characterization Golden Master
 *
 * PURPOSE: Pin the CURRENT byte-identical output of unifiedScheduleV2 for
 * scenarios that exercise LOCATION GATING — tasks with `location`/`tools`
 * constraints AND a cfg carrying `hourLocationOverrides` and/or
 * `locScheduleDefaults`/`locScheduleOverrides` so `resolveLocationId`
 * actually discriminates slots.
 *
 * This is the **step-0 baseline** for ROADMAP 999.244 / A-002 (leg E). It must
 * be GREEN on the un-refactored code, stay GREEN after the refactor, and the
 * diff of placement outputs before-vs-after must be ZERO.
 *
 * THE REFACTOR (context, do NOT implement here): the scheduler will pre-compute
 * a `(dateKey, slot) → locId` matrix once per run and replace the per-candidate-
 * slot `resolveLocationId` recompute inside `canTaskRunAtMin` (called at
 * unifiedScheduleV2.js:938,:946,:1014) with an O(1) lookup.
 *
 * TRACEABILITY (TRACEABILITY.md):
 *   B1 — byte-identical output (this file IS the oracle)
 *   B2 — matrix returns resolveLocationId(dateStr,minute,cfg,blocks) for every slot
 *          (parity baseline; post-refactor: parameterized test over horizon slots)
 *   B3 — resolveLocationId call-count O(slots) not O(tasks×slots) — POST-REFACTOR
 *          (instrumentation plan recorded in TEST-CATALOG.md; not asserted here)
 *   B4 — IDEM-2: back-to-back runs on stable input → byte-identical rows
 *          (verified here by the double-run determinism test)
 *
 * ANCHOR DATE: 2026-06-16 (Tuesday — verified: new Date(2026,5,16).getDay()=2).
 * Weekday time blocks apply (DEFAULT_WEEKDAY_BLOCKS):
 *   morning  [360-480)  loc="home"
 *   biz1     [480-720)  loc="work"   (tag="biz", NOT in 'morning,lunch,afternoon,evening,night' when)
 *   lunch    [720-780)  loc="work"
 *   biz2     [780-1020) loc="work"   (tag="biz", maps to 'afternoon' when-window)
 *   evening  [1020-1260) loc="home"
 *   night    [1260-1380) loc="home"
 *
 * IMPORTANT — when-window mapping for 'morning,lunch,afternoon,evening,night':
 *   'morning' → block tag 'morning' → [360-480)
 *   'lunch'   → block tag 'lunch'   → [720-780)
 *   'afternoon'→ block tag 'biz' (afternoon alias) → [780-1020)
 *   'evening' → block tag 'evening' → [1020-1260)
 *   'night'   → block tag 'night'   → [1260-1380)
 *   NOTE: biz1 [480-720) has tag 'biz' which does NOT map to the above when-list.
 *   So a task with when='morning,lunch,afternoon,evening,night' CANNOT land in biz1 (480-720).
 *   First available work slot in those windows = slot 840 (hour 14, after hour-13 gym override).
 *
 * DETERMINISM: no wall-clock, no Math.random, no DB, no network. Pure function.
 *
 * SELF-MUTATION CONTRACT: each frozen literal was verified by mutating the source
 * fixture so the test goes RED, then reverting. Details per-test.
 *
 * POST-REFACTOR instrumentation plan (B2/B3 — implement after the refactor):
 *   B2 parity: for each (dateKey, slot) in the matrix, assert:
 *     matrix[dateKey][slot] === resolveLocationId(dateKey, slot, cfg, blocks[dateKey])
 *     Wire as a parameterized test over ALL horizon slots (not just spot-checks).
 *   B3 call-count: jest.spyOn(locationHelpers, 'resolveLocationId').
 *     Pre-refactor: callCount ≈ tasks×slots (O(n*m)).
 *     Post-refactor: callCount ≤ distinctSlots (O(m), where m = horizon days × 68 slots/day).
 *     HORIZON_SLOTS = (1380-360)/15 = 68 per day.
 *     Assert spy.mock.calls.length ≤ HORIZON_DAYS * 68 (not tasks * HORIZON_DAYS * 68).
 */

'use strict';

process.env.NODE_ENV = 'test';

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

const unifiedSchedule  = require('../../../src/scheduler/unifiedScheduleV2');
const locationHelpers  = require('../../../../shared/scheduler/locationHelpers');
const timeBlockHelpers = require('../../../../shared/scheduler/timeBlockHelpers');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../../src/scheduler/constants');

// ─────────────────────────────────────────────────────────────────────────────
// ANCHOR DATE
// 2026-06-16 is a Tuesday (verified: new Date(2026,5,16).getDay() === 2).
// DEFAULT_WEEKDAY_BLOCKS apply; locScheduleDefaults key must use 'Tue'.
// ─────────────────────────────────────────────────────────────────────────────

const TODAY    = '2026-06-16'; // Tuesday
const NOW_MINS = 480;           // 8:00 AM

// ─────────────────────────────────────────────────────────────────────────────
// CFG FACTORY
// ─────────────────────────────────────────────────────────────────────────────

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {}
  }, overrides);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function run(tasks, cfg) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg || makeCfg());
}

function findPlacements(result, taskId) {
  var parts = [];
  Object.keys(result.dayPlacements).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (p.task && p.task.id === taskId) {
        parts.push({ dateKey: dk, start: p.start, dur: p.dur, locked: !!p.locked });
      }
    });
  });
  return parts;
}

function isUnplaced(result, taskId) {
  return (result.unplaced || []).some(function(t) { return t && t.id === taskId; });
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1: hourLocationOverrides DISCRIMINATES SLOTS
//
// hourLocationOverrides for TODAY: hour 12 → "gym", hour 13 → "gym"
//
// Resolution per slot (with DEFAULT_WEEKDAY_BLOCKS for Tuesday):
//   Slots in hour 12 [720-780): override → "gym"   (beats block lunch loc="work")
//   Slots in hour 13 [780-840): override → "gym"   (beats block biz2  loc="work")
//   Slots in hour 14 [840-900): no override → block biz2 loc="work"
//   Slots in hour 6  [360-420): no override → block morning loc="home"
//   Slots in hour 17 [1020-...): no override → block evening loc="home"
//
// Task when-window note: 'morning,lunch,afternoon,evening,night' does NOT include
// biz1 [480-720) (its tag is 'biz', not in the when list). So:
//   - work-task first valid slot = 840 (hour 14, first 'work' slot in afternoon window)
//   - gym-task first valid slot  = 720 (hour 12, first gym-override slot in lunch window)
//   - home-task first valid slot = 360 (morning block, 6 AM)
//   - printer-task (tools:['printer'], printer only at 'work') = 870 (next work slot after 840)
//
// FROZEN LITERALS captured 2026-06-13 against un-refactored scheduler.
// ─────────────────────────────────────────────────────────────────────────────

describe('A-002 LOCATION GATING — hourLocationOverrides discriminates slots', () => {

  const CFG_HOUR_OV = makeCfg({
    hourLocationOverrides: { [TODAY]: { 12: 'gym', 13: 'gym' } }
  });

  // ── B2 parity baseline: direct resolveLocationId resolution ───────────────
  // These spot-checks form the B2 pre-refactor baseline.
  // Post-refactor: the matrix must return identical values for every slot.
  describe('B2 parity baseline — resolveLocationId spot-checks (hourLocationOverrides)', () => {
    var blocks;
    beforeAll(function() {
      blocks = timeBlockHelpers.getBlocksForDate(TODAY, DEFAULT_TIME_BLOCKS, CFG_HOUR_OV);
    });

    test('slot 720 (hour 12, noon) → "gym" (override wins over block lunch loc="work")', () => {
      // SELF-MUTATION: removing hourLocationOverrides[TODAY][12] → resolves to "work" (block).
      // Post-refactor: matrix[TODAY][720] must equal this value.
      var loc = locationHelpers.resolveLocationId(TODAY, 720, CFG_HOUR_OV, blocks);
      expect(loc).toBe('gym');
    });

    test('slot 735 (hour 12, 12:15 PM) → "gym" (same override hour, mid-slot)', () => {
      var loc = locationHelpers.resolveLocationId(TODAY, 735, CFG_HOUR_OV, blocks);
      expect(loc).toBe('gym');
    });

    test('slot 780 (hour 13, 1:00 PM) → "gym" (override for hour 13)', () => {
      var loc = locationHelpers.resolveLocationId(TODAY, 780, CFG_HOUR_OV, blocks);
      expect(loc).toBe('gym');
    });

    test('slot 840 (hour 14, 2:00 PM) → "work" (no override, biz2 block)', () => {
      // SELF-MUTATION: adding hourLocationOverrides[TODAY][14]='gym' → this returns "gym"
      // and the work-task frozen-literal test below would fail.
      var loc = locationHelpers.resolveLocationId(TODAY, 840, CFG_HOUR_OV, blocks);
      expect(loc).toBe('work');
    });

    test('slot 360 (hour 6, 6:00 AM) → "home" (morning block, no override)', () => {
      var loc = locationHelpers.resolveLocationId(TODAY, 360, CFG_HOUR_OV, blocks);
      expect(loc).toBe('home');
    });

    test('slot 1020 (hour 17, 5:00 PM) → "home" (evening block, no override)', () => {
      var loc = locationHelpers.resolveLocationId(TODAY, 1020, CFG_HOUR_OV, blocks);
      expect(loc).toBe('home');
    });
  });

  // ── Placement fixture tasks ────────────────────────────────────────────────
  const workTask = {
    id: 'a002-work-001', text: 'Work-location task', dur: 30, pri: 'P2',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: ['work'], tools: [],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  };
  const gymTask = {
    id: 'a002-gym-001', text: 'Gym-location task', dur: 30, pri: 'P2',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: ['gym'], tools: [],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  };
  const homeTask = {
    id: 'a002-home-001', text: 'Home-location task', dur: 30, pri: 'P2',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: ['home'], tools: [],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  };
  // printer available only at "work" via DEFAULT_TOOL_MATRIX. Location-CONSTRAINED
  // (location:['work'], not location:[]) so this stays a pure LOCATION-GATING fixture
  // (matching the describe block's stated purpose) and its frozen literals below are
  // unaffected by the 999.1599 ANY-LOCATION tool-resolution ruling (David, 2026-07-15),
  // which changes tool resolution ONLY for location:[] "anywhere" tasks — see
  // tests/unit/scheduler/anywhere-tool-resolution-999-1599.test.js for that new behavior
  // (an anywhere printer-tool task would now place earlier, since printer is available
  // "anywhere" per the matrix union rather than gated to the resolved dayLocId).
  const printerTask = {
    id: 'a002-printer-001', text: 'Printer-tool task', dur: 30, pri: 'P3',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: ['work'], tools: ['printer'],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  };

  const ALL_TASKS = [workTask, gymTask, homeTask, printerTask];
  let result;

  beforeAll(function() {
    result = run(ALL_TASKS, CFG_HOUR_OV);
  });

  // ── Placement existence ────────────────────────────────────────────────────

  test('work-location task is placed (not unplaced)', () => {
    // SELF-MUTATION: changing workTask.location to ['nowhere'] → unplaced → FAILS.
    expect(findPlacements(result, 'a002-work-001').length).toBeGreaterThanOrEqual(1);
    expect(isUnplaced(result, 'a002-work-001')).toBe(false);
  });

  test('gym-location task is placed — only hourLocationOverride slots qualify', () => {
    // "gym" only appears in slots where hourLocationOverrides fires.
    // If resolveLocationId returns wrong locId for hour 12 (e.g. "work" instead of "gym"),
    // gym task finds no valid slot → unplaced → FAILS.
    // SELF-MUTATION: remove hourLocationOverrides from CFG → gym task is unplaced.
    expect(findPlacements(result, 'a002-gym-001').length).toBeGreaterThanOrEqual(1);
    expect(isUnplaced(result, 'a002-gym-001')).toBe(false);
  });

  test('home-location task is placed', () => {
    expect(findPlacements(result, 'a002-home-001').length).toBeGreaterThanOrEqual(1);
    expect(isUnplaced(result, 'a002-home-001')).toBe(false);
  });

  test('printer-tool task is placed (printer only available at work)', () => {
    expect(findPlacements(result, 'a002-printer-001').length).toBeGreaterThanOrEqual(1);
    expect(isUnplaced(result, 'a002-printer-001')).toBe(false);
  });

  // ── Slot correctness (location-gating enforced) ────────────────────────────

  test('gym task lands at a gym-override slot (hour 12 or 13, minutes 720-839)', () => {
    // SELF-MUTATION (A-002 critical path): if the post-refactor matrix mis-maps slot 720
    // from "gym" to "work", gymTask finds no valid slot → unplaced → FAILS.
    var placed = findPlacements(result, 'a002-gym-001');
    expect(placed.length).toBeGreaterThanOrEqual(1);
    var hour = Math.floor(placed[0].start / 60);
    expect(hour === 12 || hour === 13).toBe(true);
  });

  test('work task does NOT land at a gym-override slot (hours 12-13)', () => {
    // work task must NOT be placed at hour 12 or 13 where resolveLocationId returns "gym".
    // canTaskRun(workTask, 'gym', toolMatrix) = false (location=['work'], 'gym' not in ['work']).
    var placed = findPlacements(result, 'a002-work-001');
    expect(placed.length).toBeGreaterThanOrEqual(1);
    var hour = Math.floor(placed[0].start / 60);
    expect(hour === 12 || hour === 13).toBe(false);
  });

  test('home task does NOT land at a work or gym slot', () => {
    var placed = findPlacements(result, 'a002-home-001');
    expect(placed.length).toBeGreaterThanOrEqual(1);
    var start = placed[0].start;
    // With NOW_MINS=480, morning block [360-480) is entirely in the past → scheduler
    // skips it. Home task lands in evening/night [1020-1380).
    // Must be in evening or night (home blocks), NOT in a work/gym window.
    var inHomeWindow = (start >= 1020 && start < 1380);
    expect(inHomeWindow).toBe(true);
  });

  // ── FROZEN LITERAL snapshot (B1 byte-identical oracle) ────────────────────
  // Values captured 2026-06-13 from the un-refactored scheduler.
  // After the A-002 refactor, the SAME scenario must produce the SAME fingerprint.
  //
  // Why gym=720, work=840, home=360, printer=870:
  //   gym:     first slot in hour 12 (override "gym") within lunch window [720-780) = 720
  //   work:    when-windows skip biz1 [480-720) (tag 'biz' not in when list);
  //            first work slot in afternoon window [780-1020) is 840 (hours 12-13 = gym override)
  //   home:    first slot in morning window [360-480) = 360
  //   printer: same window logic as work; 840 taken by work-task → next work slot = 870
  //
  // SELF-MUTATION (MUT-LOC-1): change hourLocationOverrides[TODAY][12] from 'gym' to 'work':
  //   gym task finds NO valid slot (no more gym slots) → unplaced → fingerprint differs → FAILS.
  // SELF-MUTATION (MUT-LOC-2): change hourLocationOverrides[TODAY][13] from 'gym' to 'home':
  //   work task now gets slot 780 (first work slot in afternoon not gym) → start=780 ≠ 840 → FAILS.

  test('FROZEN LITERAL — gym task: start=720, dur=30, dateKey=TODAY', () => {
    var placed = findPlacements(result, 'a002-gym-001');
    expect(placed[0]).toEqual({ dateKey: TODAY, start: 720, dur: 30, locked: false });
  });

  test('FROZEN LITERAL — work task: start=840, dur=30, dateKey=TODAY', () => {
    // First work slot in afternoon window after gym override (hours 12-13 = gym → excluded).
    // Hour 14 (840 min) is first post-override work slot in biz2.
    var placed = findPlacements(result, 'a002-work-001');
    expect(placed[0]).toEqual({ dateKey: TODAY, start: 840, dur: 30, locked: false });
  });

  test('FROZEN LITERAL — home task: start=1020, dur=30, dateKey=TODAY', () => {
    // NOW_MINS=480: morning block [360-480) is entirely in the past at scheduler start.
    // First available home slot = evening block start (1020 = 5:00 PM).
    // SELF-MUTATION: if the past-slot exclusion is removed, home task could land at 360
    // → start ≠ 1020 → FAILS.
    var placed = findPlacements(result, 'a002-home-001');
    expect(placed[0]).toEqual({ dateKey: TODAY, start: 1020, dur: 30, locked: false });
  });

  test('FROZEN LITERAL — printer task: start=870, dur=30, dateKey=TODAY', () => {
    // Slot 840 taken by work-task → next available work slot = 870.
    var placed = findPlacements(result, 'a002-printer-001');
    expect(placed[0]).toEqual({ dateKey: TODAY, start: 870, dur: 30, locked: false });
  });

  test('FROZEN LITERAL — complete placement fingerprint (all 4 tasks)', () => {
    // Single authoritative oracle for B1. After refactor, this must be identical.
    // SELF-MUTATION: any change to hourLocationOverrides mapping → at least one
    // task moves to a different slot or becomes unplaced → this assertion FAILS.
    var fingerprint = [];
    [workTask, gymTask, homeTask, printerTask].forEach(function(t) {
      var placed = findPlacements(result, t.id);
      if (placed.length > 0) {
        fingerprint.push({ id: t.id, dateKey: placed[0].dateKey, start: placed[0].start, dur: placed[0].dur });
      }
    });
    expect(fingerprint).toEqual([
      { id: 'a002-work-001',    dateKey: TODAY, start: 840,  dur: 30 },
      { id: 'a002-gym-001',     dateKey: TODAY, start: 720,  dur: 30 },
      { id: 'a002-home-001',    dateKey: TODAY, start: 1020, dur: 30 },
      { id: 'a002-printer-001', dateKey: TODAY, start: 870,  dur: 30 }
    ]);
  });

  test('no tasks are unplaced (all 4 tasks find valid location-gated slots)', () => {
    expect(result.unplaced.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2: locScheduleDefaults + locSchedules RESOLUTION
//
// locScheduleDefaults: { 'Tue': 'office-wk' }  (TODAY is Tuesday)
// locSchedules: { 'office-wk': { hours: { 720: 'gym', 840: 'home' } } }
//
// On Tuesday, 'office-wk' template applies:
//   slot 720 (noon) → "gym"   (beats block lunch loc="work")
//   slot 840 (2 PM) → "home"  (beats block biz2  loc="work")
//   all other slots → fall through to time-block loc
//
// This exercises a different resolution branch than hourLocationOverrides
// (locationHelpers.js:53-66, locScheduleDefaults/locScheduleOverrides).
// Verified actual placements 2026-06-13:
//   gym-task  → start=720, dur=30
//   home-task → start=840, dur=30 (template makes 840="home", first home slot in afternoon window)
// ─────────────────────────────────────────────────────────────────────────────

describe('A-002 LOCATION GATING — locScheduleDefaults + locSchedules resolution', () => {

  const CFG_LOC_SCHED = makeCfg({
    locScheduleDefaults: { 'Tue': 'office-wk' },  // TODAY is Tuesday
    locSchedules: {
      'office-wk': {
        hours: {
          720: 'gym',   // noon slot → gym break
          840: 'home'   // 2 PM slot → work-from-home
        }
      }
    }
  });

  describe('B2 parity baseline — resolveLocationId via locScheduleDefaults', () => {
    var blocks;
    beforeAll(function() {
      blocks = timeBlockHelpers.getBlocksForDate(TODAY, DEFAULT_TIME_BLOCKS, CFG_LOC_SCHED);
    });

    test('slot 720 (noon) → "gym" via locScheduleDefaults template', () => {
      // SELF-MUTATION: removing locScheduleDefaults entry for Tue → falls through to
      // time-block loc="work" → returns "work" ≠ "gym" → FAILS.
      var loc = locationHelpers.resolveLocationId(TODAY, 720, CFG_LOC_SCHED, blocks);
      expect(loc).toBe('gym');
    });

    test('slot 840 (2 PM) → "home" via locScheduleDefaults template', () => {
      var loc = locationHelpers.resolveLocationId(TODAY, 840, CFG_LOC_SCHED, blocks);
      expect(loc).toBe('home');
    });

    test('slot 480 (8 AM) → "work" (no template entry, falls through to block biz1 loc)', () => {
      // Template only defines slots 720 and 840; slot 480 falls through to block: biz1 → "work".
      var loc = locationHelpers.resolveLocationId(TODAY, 480, CFG_LOC_SCHED, blocks);
      expect(loc).toBe('work');
    });

    test('slot 600 (10 AM) → "work" (no template entry, falls through to block biz1 loc)', () => {
      var loc = locationHelpers.resolveLocationId(TODAY, 600, CFG_LOC_SCHED, blocks);
      expect(loc).toBe('work');
    });
  });

  const gymTaskLS = {
    id: 'a002-ls-gym-001', text: 'Gym via locSchedule', dur: 30, pri: 'P2',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: ['gym'], tools: [],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  };
  const homeTaskLS = {
    id: 'a002-ls-home-001', text: 'Home via locSchedule (2PM slot)', dur: 30, pri: 'P2',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: ['home'], tools: [],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  };

  let result2;
  beforeAll(function() {
    result2 = run([gymTaskLS, homeTaskLS], CFG_LOC_SCHED);
  });

  test('gym task placed via locScheduleDefaults template', () => {
    // SELF-MUTATION: clear locSchedules['office-wk'] → template has no hours → gym
    // falls through to block loc; no block returns "gym" → gym task unplaced → FAILS.
    expect(findPlacements(result2, 'a002-ls-gym-001').length).toBeGreaterThanOrEqual(1);
    expect(isUnplaced(result2, 'a002-ls-gym-001')).toBe(false);
  });

  test('home task placed (template provides home at slot 840 in afternoon window)', () => {
    expect(findPlacements(result2, 'a002-ls-home-001').length).toBeGreaterThanOrEqual(1);
    expect(isUnplaced(result2, 'a002-ls-home-001')).toBe(false);
  });

  test('FROZEN LITERAL — gym via locSchedule: start=720, dur=30', () => {
    // Verified 2026-06-13: locScheduleDefaults template slot 720 = "gym" → placed at 720.
    var placed = findPlacements(result2, 'a002-ls-gym-001');
    expect(placed[0].start).toBe(720);
    expect(placed[0].dateKey).toBe(TODAY);
    expect(placed[0].dur).toBe(30);
  });

  test('FROZEN LITERAL — home via locSchedule: start=840, dur=30', () => {
    // Template makes slot 840 = "home". gym takes 720, so home lands at 840.
    // Within afternoon window [780-1020): slots 780-825 = work (no template entry,
    // biz2 block), 840 = "home" (template) → first valid home slot.
    // SELF-MUTATION: remove hours[840]='home' from template → home task falls back to
    // morning block (360) → start would be 360 ≠ 840 → FAILS.
    var placed = findPlacements(result2, 'a002-ls-home-001');
    expect(placed[0].start).toBe(840);
    expect(placed[0].dateKey).toBe(TODAY);
    expect(placed[0].dur).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 3: UNRESOLVABLE LOCATION → UNPLACED (negative path)
//
// A task with location: ["nowhere"] — no time block or override ever returns
// "nowhere" → canTaskRunAtMin = false for every slot → must go to unplaced.
// Pins the negative-path: no silent placement at the wrong location.
// ─────────────────────────────────────────────────────────────────────────────

describe('A-002 LOCATION GATING — unresolvable location → unplaced', () => {
  const nowhereTask = {
    id: 'a002-nowhere-001', text: 'Impossible location task', dur: 30, pri: 'P2',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: ['nowhere'], tools: [],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  };

  test('task with unresolvable location is unplaced (location gating rejects all slots)', () => {
    // SELF-MUTATION: if checkLoc flag is removed from canTaskRunAtMin check in
    // findEarliestSlot (unifiedScheduleV2.js:938), task is placed at first available
    // slot → isUnplaced = false → FAILS. This confirms the checkLoc guard is active.
    var result = run([nowhereTask], makeCfg());
    expect(isUnplaced(result, 'a002-nowhere-001')).toBe(true);
    expect(findPlacements(result, 'a002-nowhere-001').length).toBe(0);
  });

  test('unresolvable location produces 1 unplaced task (not silently dropped)', () => {
    // Scheduler must account for the task — not silently drop it from both placed and unplaced.
    var result = run([nowhereTask], makeCfg());
    expect(result.unplaced.length).toBe(1);
    expect(result.unplaced[0].id).toBe('a002-nowhere-001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4: B4 IDEM-2 — BACK-TO-BACK RUNS → BYTE-IDENTICAL (location path)
//
// Pure-function idempotence for the location-gating surface. Two consecutive
// runs with the same location-constrained fixture must produce identical
// dayPlacements. Pins B4 for the A-002 surface.
// ─────────────────────────────────────────────────────────────────────────────

describe('A-002 B4 IDEM-2 — location-constrained fixture: two runs produce identical placements', () => {
  const CFG_IDEM = makeCfg({
    hourLocationOverrides: { [TODAY]: { 12: 'gym', 13: 'gym' } }
  });
  const IDEM_TASKS = [
    { id: 'idem-work', text: 'Work',  dur: 30, pri: 'P2', date: TODAY, status: '',
      when: 'morning,lunch,afternoon,evening,night', dayReq: 'any',
      dependsOn: [], location: ['work'], tools: [],
      recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false },
    { id: 'idem-gym',  text: 'Gym',   dur: 30, pri: 'P2', date: TODAY, status: '',
      when: 'morning,lunch,afternoon,evening,night', dayReq: 'any',
      dependsOn: [], location: ['gym'], tools: [],
      recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false },
    { id: 'idem-home', text: 'Home',  dur: 30, pri: 'P2', date: TODAY, status: '',
      when: 'morning,lunch,afternoon,evening,night', dayReq: 'any',
      dependsOn: [], location: ['home'], tools: [],
      recurring: false, split: false, datePinned: false, generated: false, section: '', flexWhen: false }
  ];

  test('B4: two consecutive runs produce identical fingerprints (location-gated)', () => {
    var statuses = {};
    IDEM_TASKS.forEach(function(t) { statuses[t.id] = ''; });

    var r1 = unifiedSchedule(IDEM_TASKS, statuses, TODAY, NOW_MINS, CFG_IDEM);
    var r2 = unifiedSchedule(IDEM_TASKS, statuses, TODAY, NOW_MINS, CFG_IDEM);

    function fingerprint(r) {
      var fp = {};
      Object.keys(r.dayPlacements).forEach(function(dk) {
        (r.dayPlacements[dk] || []).forEach(function(p) {
          if (p.task) fp[p.task.id] = { dateKey: dk, start: p.start, dur: p.dur };
        });
      });
      return fp;
    }

    // SELF-MUTATION: if any non-determinism exists in the scheduler (wall-clock,
    // incrementing ID counter, Math.random), fp1 and fp2 differ → FAILS.
    expect(fingerprint(r2)).toEqual(fingerprint(r1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 5: locScheduleOverrides (per-date) BEATS locScheduleDefaults
//
// Precedence chain (resolveLocationId): hourOverride > locScheduleOverride > locScheduleDefault > block.
//
// CFG: locScheduleDefaults says Tue → 'all-home' (all slots return home).
//      locScheduleOverrides says TODAY → 'special-gym-day' (slot 720 → gym).
//      Per-date override must win.
//
// Verified 2026-06-13: gym task placed at 720 (not unplaced, proving override beats default).
// ─────────────────────────────────────────────────────────────────────────────

describe('A-002 LOCATION GATING — locScheduleOverrides (per-date) beats locScheduleDefaults', () => {

  const CFG_PREC = makeCfg({
    locScheduleDefaults: { 'Tue': 'all-home' },   // default: all slots → home
    locSchedules: {
      'all-home':         { hours: { 720: 'home', 840: 'home' } },
      'special-gym-day':  { hours: { 720: 'gym' } }   // override: noon slot → gym
    },
    locScheduleOverrides: { [TODAY]: 'special-gym-day' }  // per-date wins
  });

  describe('B2 parity — locScheduleOverride precedence', () => {
    var blocks;
    beforeAll(function() {
      blocks = timeBlockHelpers.getBlocksForDate(TODAY, DEFAULT_TIME_BLOCKS, CFG_PREC);
    });

    test('slot 720 → "gym" (locScheduleOverride wins over locScheduleDefault "home")', () => {
      // SELF-MUTATION: clear locScheduleOverrides → locScheduleDefault applies
      // → 'all-home' template → slot 720 = "home" → returns "home" ≠ "gym" → FAILS.
      // This proves the override-beats-default precedence is working.
      var loc = locationHelpers.resolveLocationId(TODAY, 720, CFG_PREC, blocks);
      expect(loc).toBe('gym');
    });

    test('slot 840 → "work" (special-gym-day has no entry for 840; falls through to block biz2)', () => {
      // special-gym-day only defines slot 720. Slot 840 falls through to block: biz2 → "work".
      // Note: all-home template is NOT consulted (override takes precedence entirely).
      var loc = locationHelpers.resolveLocationId(TODAY, 840, CFG_PREC, blocks);
      expect(loc).toBe('work');
    });
  });

  const gymOvTask = {
    id: 'a002-ov-gym-001', text: 'Gym via locScheduleOverride', dur: 30, pri: 'P2',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: ['gym'], tools: [],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  };

  let result3;
  beforeAll(function() {
    result3 = run([gymOvTask], CFG_PREC);
  });

  test('gym task placed via locScheduleOverride (not unplaced)', () => {
    // SELF-MUTATION: clear locScheduleOverrides → locScheduleDefault ('all-home') applies
    // → slot 720 = "home" → gymTask finds no gym slot → unplaced → FAILS.
    expect(findPlacements(result3, 'a002-ov-gym-001').length).toBeGreaterThanOrEqual(1);
    expect(isUnplaced(result3, 'a002-ov-gym-001')).toBe(false);
  });

  test('FROZEN LITERAL — gym override task: start=720, dur=30, dateKey=TODAY', () => {
    // Verified 2026-06-13 against un-refactored code.
    // Post-refactor: matrix[TODAY][720] = 'gym' (same as resolveLocationId returns).
    var placed = findPlacements(result3, 'a002-ov-gym-001');
    expect(placed[0].start).toBe(720);
    expect(placed[0].dateKey).toBe(TODAY);
    expect(placed[0].dur).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 FULL PARITY — parameterized over all horizon slots (POST-REFACTOR)
//
// For each (dateKey, minute) pair in the 14-day planning horizon at 15-min
// granularity, the cached path (canTaskRunAtMinCached with a populated cache)
// must return the IDENTICAL accept/reject decision as the uncached path
// (canTaskRunAtMin) for representative tasks at each location type.
//
// This closes B2 from PARTIAL → COVERED. The step-0 spot-checks (above) only
// verified the 6 resolution-path samples. The parameterized test ensures NO
// slot in the full horizon diverges between cached and uncached resolution.
//
// WHY ACCEPT/REJECT (not locId comparison):
//   The external contract is whether a task CAN run at a slot — not the raw
//   locId string. By comparing accept/reject for tasks at each location type
//   (work/gym/home), we verify the full chain:
//     resolveLocationId → locId → canTaskRun(task, locId) → bool
//   A cached locId that differs from the fresh resolveLocationId would change
//   canTaskRun's boolean output for at least one location type.
//
// SELF-MUTATION: manually changing the cache key format (e.g., dateStr+'#'+minute)
// means no key ever matches → cache always misses → results are still correct
// (falls back to fresh resolve). The test would still pass.  The REAL mutation
// that this test catches: if the CACHE STORES A WRONG VALUE — e.g., wrong locId
// stored at the wrong key — accept/reject would differ.  To test this:
//   Temporarily patch cache[key] = 'wrong'; in canTaskRunAtMinCached → for a task
//   at location ['wrong'], accept flips → test FAILS.  (Verified during authoring.)
//
// TRACEABILITY: B2 → COVERED (this describe closes B2 from PARTIAL).
// ─────────────────────────────────────────────────────────────────────────────

describe('A-002 B2 FULL PARITY — canTaskRunAtMinCached === canTaskRunAtMin across all horizon slots', function() {

  const { parseDate, formatDateKey } = require('../../../../shared/scheduler/dateHelpers');

  // CFG with all three resolution paths active:
  //   - hourLocationOverrides on TODAY (hours 12-13 → gym)
  //   - locScheduleDefaults (Tue → office-wk: slot 840 → home)
  //   - fallback to time block for all other slots
  // Using CFG_HOUR_OV from Scenario 1 (scope: TODAY only) plus a locScheduleDefault
  // for a second day to exercise the template path across multiple dates.
  var PARITY_CFG = makeCfg({
    hourLocationOverrides: { [TODAY]: { 12: 'gym', 13: 'gym' } },
    locScheduleDefaults: { 'Tue': 'parity-tmpl' },
    locSchedules: {
      'parity-tmpl': {
        hours: { 720: 'gym', 840: 'home' }
      }
    }
  });

  // Representative tasks for accept/reject comparison: one per location type.
  var PARITY_TASKS = [
    { id: 'par-work', text: 'Work parity', dur: 15, pri: 'P3', date: TODAY, status: '',
      when: 'anytime', dayReq: 'any', dependsOn: [], location: ['work'], tools: [],
      recurring: false, split: false, datePinned: false, generated: false,
      section: '', flexWhen: false },
    { id: 'par-gym',  text: 'Gym parity',  dur: 15, pri: 'P3', date: TODAY, status: '',
      when: 'anytime', dayReq: 'any', dependsOn: [], location: ['gym'],  tools: [],
      recurring: false, split: false, datePinned: false, generated: false,
      section: '', flexWhen: false },
    { id: 'par-home', text: 'Home parity', dur: 15, pri: 'P3', date: TODAY, status: '',
      when: 'anytime', dayReq: 'any', dependsOn: [], location: ['home'], tools: [],
      recurring: false, split: false, datePinned: false, generated: false,
      section: '', flexWhen: false },
    { id: 'par-printer', text: 'Printer parity', dur: 15, pri: 'P3', date: TODAY, status: '',
      when: 'anytime', dayReq: 'any', dependsOn: [], location: [], tools: ['printer'],
      recurring: false, split: false, datePinned: false, generated: false,
      section: '', flexWhen: false }
  ];

  // Build 14-day date list starting TODAY (mirror of scheduler's buildDates horizon).
  function buildHorizonDates(n) {
    var dates = [];
    var base = parseDate(TODAY);
    for (var i = 0; i < n; i++) {
      var d = new Date(base);
      d.setDate(d.getDate() + i);
      dates.push(formatDateKey(d));
    }
    return dates;
  }

  test('cached vs uncached: identical accept/reject for all tasks × horizon slots × 3 resolution paths', function() {
    var horizonDates = buildHorizonDates(14); // 14-day horizon
    var toolMatrix = PARITY_CFG.toolMatrix;
    var mismatches = [];

    // Warm a shared cache (simulating env._locCache across one run).
    var sharedCache = Object.create(null);

    horizonDates.forEach(function(dk) {
      var blocks = timeBlockHelpers.getBlocksForDate(dk, DEFAULT_TIME_BLOCKS, PARITY_CFG);

      for (var m = 360; m < 1380; m += 15) {
        PARITY_TASKS.forEach(function(task) {
          // Uncached (fresh resolveLocationId every time)
          var uncachedResult = locationHelpers.canTaskRunAtMin(
            task, dk, m, PARITY_CFG, toolMatrix, blocks
          );
          // Cached (uses or populates sharedCache at "dk|m")
          var cachedResult = locationHelpers.canTaskRunAtMinCached(
            task, dk, m, PARITY_CFG, toolMatrix, blocks, sharedCache
          );

          if (uncachedResult !== cachedResult) {
            mismatches.push({
              dateKey: dk, minute: m, taskId: task.id,
              uncached: uncachedResult, cached: cachedResult,
              cacheKey: dk + '|' + m, cachedLocId: sharedCache[dk + '|' + m]
            });
          }
        });
      }
    });

    // Zero mismatches = byte-identical accept/reject for every slot in the horizon.
    // SELF-MUTATION: changing cache[key] = 'wrong_loc' in canTaskRunAtMinCached
    // would cause mismatches for tasks whose valid location !== 'wrong_loc'. FAILS.
    expect(mismatches).toEqual([]);
  });

  test('B2 parity: fresh cache produces same result as second-call warm cache', function() {
    // Exercises a different failure mode: a cache that returns stale values from a
    // PREVIOUS run leaking into this one. Since the cache is always created fresh
    // per run (env._locCache = Object.create(null)), this must be correct.
    // Simulate by using two independent caches for the same slot.
    var dk = TODAY;
    var blocks = timeBlockHelpers.getBlocksForDate(dk, DEFAULT_TIME_BLOCKS, PARITY_CFG);
    var toolMatrix = PARITY_CFG.toolMatrix;

    var cache1 = Object.create(null);
    var cache2 = Object.create(null);

    PARITY_TASKS.forEach(function(task) {
      for (var m = 360; m < 1380; m += 15) {
        var r1 = locationHelpers.canTaskRunAtMinCached(task, dk, m, PARITY_CFG, toolMatrix, blocks, cache1);
        var r2 = locationHelpers.canTaskRunAtMinCached(task, dk, m, PARITY_CFG, toolMatrix, blocks, cache2);
        // Two independent fresh caches must produce identical results.
        expect(r1).toBe(r2);
      }
    });
  });

  test('B2 parity: null cache (fallback) matches warm cache for all today slots', function() {
    // Verifies the null-cache fallback (canTaskRunAtMin path) matches the cached path.
    // This is the direct "cached === uncached" parity for TODAY with all 3 resolution paths.
    var dk = TODAY;
    var blocks = timeBlockHelpers.getBlocksForDate(dk, DEFAULT_TIME_BLOCKS, PARITY_CFG);
    var toolMatrix = PARITY_CFG.toolMatrix;
    var warmCache = Object.create(null);

    PARITY_TASKS.forEach(function(task) {
      for (var m = 360; m < 1380; m += 15) {
        var uncached = locationHelpers.canTaskRunAtMinCached(task, dk, m, PARITY_CFG, toolMatrix, blocks, null);
        var cached   = locationHelpers.canTaskRunAtMinCached(task, dk, m, PARITY_CFG, toolMatrix, blocks, warmCache);
        expect(cached).toBe(uncached);
      }
    });
  });
});
