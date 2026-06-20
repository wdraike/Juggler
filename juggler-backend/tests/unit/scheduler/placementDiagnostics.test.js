/**
 * I1 — Placement-Primitive Diagnostics (FR1 / AC1.1 + AC1.2)
 *
 * Layer: unit — pure functions, no DB, no network, no wall-clock.
 *
 * Covers:
 *   AC1.1  canTaskRun surfaces a structured failure cause distinguishing
 *          location-mismatch vs tool-unavailable, naming the missing tool
 *          + resolved location. Existing boolean callers stay correct.
 *   AC1.2  findEarliestSlot (via tryPlaceQueued) returns
 *          {slot:null, failReason, failDetail} accumulated across candidates,
 *          not bare {slot:null}.
 *
 * Structure:
 *   Section A — CHARACTERIZATION (golden-master locking CURRENT behaviour)
 *               These MUST be GREEN on un-refactored code and MUST NOT REGRESS
 *               after the refactor.  They extend the A-002 location suite
 *               (goldenMaster.a002-location.test.js) for the specific
 *               location-mismatch and tool-unavailable paths.
 *
 *   Section B — RED tests (TARGET behaviour, not yet implemented)
 *               Each assertion uses .failing so the suite stays importable;
 *               every .failing block documents the AC it is waiting for.
 *               Once the implementation lands the .failing wrapper is removed.
 *
 * DETERMINISM: no Date.now(), no Math.random(), no I/O.  Pure-function only.
 *
 * SELF-MUTATION CONTRACT (characterization): every frozen literal was verified
 * by flipping the relevant constant/guard in the source and confirming the test
 * goes RED, then reverting via /tmp backup (AGENT-STANDARD mutation-revert rule).
 *
 * Traceability: AC1.1, AC1.2 (TRACEABILITY.md rows 6-7)
 */

'use strict';

process.env.NODE_ENV = 'test';

const locationHelpers = require('../../../../shared/scheduler/locationHelpers');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../../src/scheduler/constants');
const timeBlockHelpers = require('../../../../shared/scheduler/timeBlockHelpers');
const unifiedSchedule = require('../../../src/scheduler/unifiedScheduleV2');

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const TODAY = '2026-06-20'; // Saturday — home day (home blocks all day via DEFAULT_WEEKDAY_BLOCKS)
const NOW_MINS = 480;       // 8:00 AM

// CFG with biz-only work location: Saturday has no work blocks in DEFAULT_TIME_BLOCKS.
// personal_pc is only available at HOME (DEFAULT_TOOL_MATRIX: home: [..., 'personal_pc']).
// work PC is only available at WORK (DEFAULT_TOOL_MATRIX: work: [..., 'work_pc', 'printer']).
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

// A minimal task shape the scheduler accepts.
function makeTask(overrides) {
  return Object.assign({
    id: 'test-diag-001', text: 'Diagnostic task', dur: 30, pri: 'P2',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  }, overrides);
}

// Run the full scheduler and return the result.
function run(tasks, cfg) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg || makeCfg());
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION A — CHARACTERIZATION (GREEN on un-refactored code; must NOT regress)
// ═══════════════════════════════════════════════════════════════════════════════

describe('I1 CHARACTERIZATION — canTaskRun (current boolean API, must not regress)', () => {
  const CFG = makeCfg();
  const TODAY_BLOCKS = timeBlockHelpers.getBlocksForDate(TODAY, DEFAULT_TIME_BLOCKS, CFG);

  // Saturday: DEFAULT_TIME_BLOCKS produces home blocks all day.
  // Verify the day resolves to 'home' for a typical slot.
  test('CHAR-A1: resolveLocationId on Saturday slot 600 (10 AM) → "home" (no biz override)', () => {
    // SELF-MUTATION: changing DEFAULT_TIME_BLOCKS so Saturday has a work block at 600
    // would change the return to "work" → FAILS.
    var loc = locationHelpers.resolveLocationId(TODAY, 600, CFG, TODAY_BLOCKS);
    expect(loc).toBe('home');
  });

  // canTaskRun returns TRUE (bare boolean) when location constraint is satisfied.
  test('CHAR-A2: canTaskRun returns true (boolean) when task.location includes dayLocId', () => {
    // SELF-MUTATION: change task.location to ['work'] → condition fails → returns false → FAILS.
    var result = locationHelpers.canTaskRun(
      makeTask({ location: ['home'] }),
      'home',
      DEFAULT_TOOL_MATRIX
    );
    // Current API: returns truthy boolean true.
    expect(result).toBe(true);
  });

  // canTaskRun returns FALSE (bare boolean) when location is mismatched.
  test('CHAR-A3: canTaskRun returns false (boolean) on location mismatch (task wants work, day=home)', () => {
    // SELF-MUTATION: removing the location check at locationHelpers.js:97 → always returns
    // true regardless of location → this test FAILS.
    var result = locationHelpers.canTaskRun(
      makeTask({ location: ['work'] }),
      'home',
      DEFAULT_TOOL_MATRIX
    );
    // Current API: returns bare false.
    expect(result).toBe(false);
  });

  // canTaskRun returns FALSE when required tool is missing at the resolved location.
  test('CHAR-A4: canTaskRun returns false (boolean) when required tool is unavailable at dayLocId', () => {
    // personal_pc is at HOME only (DEFAULT_TOOL_MATRIX.home includes 'personal_pc').
    // At WORK: DEFAULT_TOOL_MATRIX.work does NOT include 'personal_pc'.
    // SELF-MUTATION: removing the tools check at locationHelpers.js:98-103 → returns true
    // regardless of tool availability → this test FAILS.
    var result = locationHelpers.canTaskRun(
      makeTask({ location: [], tools: ['personal_pc'] }),
      'work',
      DEFAULT_TOOL_MATRIX
    );
    expect(result).toBe(false);
  });

  // Both guards active: task needs 'work' location AND 'printer' (only at work).
  // If location IS work, tool IS available → true.
  test('CHAR-A5: canTaskRun returns true when location AND tool are both satisfied', () => {
    var result = locationHelpers.canTaskRun(
      makeTask({ location: ['work'], tools: ['printer'] }),
      'work',
      DEFAULT_TOOL_MATRIX
    );
    expect(result).toBe(true);
  });

  // No location or tool constraint → always passes.
  test('CHAR-A6: canTaskRun returns true when task has no location and no tool constraints', () => {
    var result = locationHelpers.canTaskRun(
      makeTask({ location: [], tools: [] }),
      'home',
      DEFAULT_TOOL_MATRIX
    );
    expect(result).toBe(true);
  });

  // canTaskRunAtMin: integration of resolveLocationId + canTaskRun (one level up).
  test('CHAR-A7: canTaskRunAtMin returns false for work-location task on Saturday at any slot', () => {
    // Saturday is all-home; work-location task can never run.
    var result = locationHelpers.canTaskRunAtMin(
      makeTask({ location: ['work'] }),
      TODAY, 600, CFG, DEFAULT_TOOL_MATRIX, TODAY_BLOCKS
    );
    expect(result).toBe(false);
  });

  test('CHAR-A8: canTaskRunAtMin returns true for home-location task on Saturday', () => {
    var result = locationHelpers.canTaskRunAtMin(
      makeTask({ location: ['home'] }),
      TODAY, 600, CFG, DEFAULT_TOOL_MATRIX, TODAY_BLOCKS
    );
    expect(result).toBe(true);
  });

  test('CHAR-A9: canTaskRunAtMin returns false for personal_pc task at biz slot (work loc)', () => {
    // Monday biz slot (hour 10 = minute 600): resolves to "work";
    // personal_pc not in work tool matrix → false.
    const MONDAY = '2026-06-22'; // Monday
    const MON_CFG = makeCfg();
    const MON_BLOCKS = timeBlockHelpers.getBlocksForDate(MONDAY, DEFAULT_TIME_BLOCKS, MON_CFG);
    var result = locationHelpers.canTaskRunAtMin(
      makeTask({ location: [], tools: ['personal_pc'] }),
      MONDAY, 600, MON_CFG, DEFAULT_TOOL_MATRIX, MON_BLOCKS
    );
    expect(result).toBe(false);
  });
});

describe('I1 CHARACTERIZATION — findEarliestSlot failure (current bare null return)', () => {
  // When a task has an impossible location (no slot ever resolves to 'nowhere'),
  // findEarliestSlot returns null directly (not {slot:null} — that's tryPlaceQueued).
  // The scheduler wraps it into unplaced; we verify the task appears as unplaced.
  test('CHAR-B1: impossible-location task → goes to unplaced (scheduler-level confirmation)', () => {
    // SELF-MUTATION: remove checkLoc guard in findEarliestSlot → task placed → isUnplaced=false → FAILS.
    var result = run([makeTask({ id: 'char-b1', location: ['nowhere'] })], makeCfg());
    var isUnplaced = (result.unplaced || []).some(function(t) { return t && t.id === 'char-b1'; });
    expect(isUnplaced).toBe(true);
  });

  test('CHAR-B2: personal_pc task on all-biz day → goes to unplaced (tool conflict)', () => {
    // Force ALL hours on TODAY to 'work' via hourLocationOverrides.
    // personal_pc is only in DEFAULT_TOOL_MATRIX.home, not .work → every slot rejected.
    // Constrain the search window to TODAY only by setting deadline=TODAY + earliestStart=TODAY
    // (both handled via the task's deadline/earliestStart string fields → deadlineDate clamping
    // in findEarliestSlot prevents roll-forward to the weekend where home slots would be found).
    // SELF-MUTATION: remove hourLocationOverrides → some slots return "home" → task placed → FAILS.
    var cfg = makeCfg({
      hourLocationOverrides: (function() {
        var h = {};
        h[TODAY] = {};
        for (var hr = 6; hr <= 23; hr++) { h[TODAY][hr] = 'work'; }
        return h;
      })()
    });
    var task = makeTask({
      id: 'char-b2', location: [], tools: ['personal_pc'],
      date: TODAY,
      deadline: TODAY,       // clamps deadlineDate → latestIdx = indexOfDate(TODAY)
      earliestStart: TODAY   // clamps earliestIdx → earliestStartDate = TODAY
    });
    var result = run([task], cfg);
    var isUnplaced = (result.unplaced || []).some(function(t) { return t && t.id === 'char-b2'; });
    expect(isUnplaced).toBe(true);
  });

  test('CHAR-B3: unplaced task currently has no _unplacedReason field (pin the BUG — pre-impl)', () => {
    // This pins the CURRENT BROKEN state: no failReason on the bare {slot:null} path.
    // The impl (AC1.2 / FR1) will add it; this char test will then be updated or replaced
    // by the RED tests in Section B. For now it confirms the starting point.
    var result = run([makeTask({ id: 'char-b3', location: ['nowhere'] })], makeCfg());
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'char-b3'; });
    expect(unplacedItem).toBeDefined();
    // Current code: _unplacedReason is either undefined or set by a separate (unrelated) path.
    // We pin that the main no-slot path does NOT currently set a tool/location-specific reason.
    // After impl this pin is replaced by the GREEN assertion from Section B.
    var reason = unplacedItem && unplacedItem._unplacedReason;
    // Accept undefined, null, or any non-tool/location-specific code (the broken state).
    // The presence of 'tool_conflict' or 'location_mismatch' here would mean the impl
    // already shipped — in which case remove this CHAR test and rely on Section B.
    expect(reason === undefined || reason === null || reason === 'recurring_split_overflow' ||
      reason === 'no_slot').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION B — RED tests (TARGET behaviour — not yet implemented)
//
// Each test is wrapped in test.failing() so the suite remains importable and
// the CI run shows "expected failure" rather than a test error.
// Once the implementation lands for a given AC, remove the .failing wrapper;
// the test will turn GREEN and serve as a regression guard.
// ═══════════════════════════════════════════════════════════════════════════════

describe('I1 RED — AC1.1: canTaskRun returns structured failure cause (not bare boolean)', () => {

  // AC1.1 requires canTaskRun to return a structured result distinguishing
  // location-mismatch from tool-unavailable, while remaining truthy-on-success
  // so existing callers (canTaskRunAtMin, canTaskRunAtMinCached) stay correct.

  test.failing('RED-AC1.1-a: location mismatch → result.cause === "location_mismatch"', () => {
    // Expects canTaskRun to return an object with cause:'location_mismatch'
    // when the task's required location is not the day location.
    var result = locationHelpers.canTaskRun(
      makeTask({ location: ['work'] }),
      'home',
      DEFAULT_TOOL_MATRIX
    );
    // After impl: result is a structured object, falsy or with ok:false + cause.
    expect(result).toMatchObject({ ok: false, cause: 'location_mismatch' });
  });

  test.failing('RED-AC1.1-b: location mismatch → result.detail names the required vs resolved location', () => {
    var result = locationHelpers.canTaskRun(
      makeTask({ location: ['biz'] }),
      'home',
      DEFAULT_TOOL_MATRIX
    );
    // After impl: detail includes the required location ('biz') and the resolved day location ('home').
    expect(result).toMatchObject({ ok: false, cause: 'location_mismatch' });
    expect(typeof result.detail).toBe('string');
    expect(result.detail).toMatch(/biz/);
    expect(result.detail).toMatch(/home/);
  });

  test.failing('RED-AC1.1-c: tool unavailable → result.cause === "tool_conflict"', () => {
    // personal_pc not available at 'work' (only at 'home' per DEFAULT_TOOL_MATRIX).
    var result = locationHelpers.canTaskRun(
      makeTask({ location: [], tools: ['personal_pc'] }),
      'work',
      DEFAULT_TOOL_MATRIX
    );
    expect(result).toMatchObject({ ok: false, cause: 'tool_conflict' });
  });

  test.failing('RED-AC1.1-d: tool conflict → result.detail names the missing tool and the resolved location', () => {
    // AC1.1: "naming the missing tool + resolved location"
    var result = locationHelpers.canTaskRun(
      makeTask({ location: [], tools: ['personal_pc'] }),
      'work',
      DEFAULT_TOOL_MATRIX
    );
    expect(result).toMatchObject({ ok: false, cause: 'tool_conflict' });
    expect(typeof result.detail).toBe('string');
    expect(result.detail).toMatch(/personal_pc/);
    expect(result.detail).toMatch(/work/);
  });

  // AC1.1-e / -f: already-correct behaviours — plain tests (regression guards for the AC1.1 fix).
  // The fix must preserve these: canTaskRun must remain truthy on success so callers stay correct.
  test('REGR-AC1.1-e: success path is truthy (back-compat for existing callers)', () => {
    // After AC1.1 impl: canTaskRun for a satisfiable task must still be truthy
    // so existing callers using if (!canTaskRun(...)) stay correct.
    // SELF-MUTATION: make canTaskRun return {ok:false} for success → callers break → FAILS.
    var result = locationHelpers.canTaskRun(
      makeTask({ location: ['home'] }),
      'home',
      DEFAULT_TOOL_MATRIX
    );
    // Current: returns bare boolean true. After impl: {ok:true} or still true — either is truthy.
    expect(result).toBeTruthy();
    // If impl returns an object, ok must be true (not false).
    if (result && typeof result === 'object') {
      expect(result.ok).toBe(true);
    }
  });

  test('REGR-AC1.1-f: no constraint → truthy result with no failure cause', () => {
    // SELF-MUTATION: make no-constraint path return {ok:false, cause:'tool_conflict'} →
    //   toBeTruthy() fails (if returning false) OR cause check fails → FAILS.
    var result = locationHelpers.canTaskRun(
      makeTask({ location: [], tools: [] }),
      'work',
      DEFAULT_TOOL_MATRIX
    );
    expect(result).toBeTruthy();
    if (result && typeof result === 'object') {
      expect(result.ok).toBe(true);
      expect(result.cause).toBeUndefined();
    }
  });

  test.failing('RED-AC1.1-g: location mismatch takes precedence over tool check when both fail', () => {
    // Task needs 'biz' location AND 'personal_pc' tool (not at biz/work).
    // Location mismatch fires first (L97 in current code); structured result should
    // report cause:'location_mismatch', not cause:'tool_conflict'.
    var result = locationHelpers.canTaskRun(
      makeTask({ location: ['biz'], tools: ['personal_pc'] }),
      'home',
      DEFAULT_TOOL_MATRIX
    );
    expect(result).toMatchObject({ ok: false, cause: 'location_mismatch' });
  });
});

describe('I1 RED — AC1.2: tryPlaceQueued/findEarliestSlot returns {slot:null, failReason, failDetail}', () => {

  // AC1.2: on failure, the returned object must include failReason and failDetail,
  // not just {slot:null}.  The diagnostic is accumulated across candidate slots so
  // the DOMINANT rejection reason (tool/location vs capacity vs window-past) is surfaced.

  test.failing('RED-AC1.2-a: impossible location → {slot:null, failReason:"location_mismatch"}', () => {
    // A task that requires 'nowhere' location can never be placed.
    // After impl: the scheduler result carries the task with _unplacedReason set,
    // AND (if we can access tryPlaceQueued directly) it returns failReason.
    // We test at the scheduler output level (unplaced item) as the integration surface:
    var result = run([makeTask({ id: 'red-ac12-a', location: ['nowhere'] })], makeCfg());
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'red-ac12-a'; });
    expect(unplacedItem).toBeDefined();
    expect(unplacedItem._unplacedReason).toBe('location_mismatch');
    expect(typeof unplacedItem._unplacedDetail).toBe('string');
    expect(unplacedItem._unplacedDetail.length).toBeGreaterThan(0);
  });

  test.failing('RED-AC1.2-b: tool conflict → {slot:null, failReason:"tool_conflict"}', () => {
    // All slots forced to 'work' (hourLocationOverrides) but task needs 'personal_pc'
    // (only at home) → every candidate slot rejected with tool_conflict.
    var cfg = makeCfg({
      hourLocationOverrides: (function() {
        var h = {};
        h[TODAY] = {};
        for (var hr = 6; hr <= 23; hr++) { h[TODAY][hr] = 'work'; }
        return h;
      })()
    });
    var result = run([makeTask({ id: 'red-ac12-b', location: [], tools: ['personal_pc'] })], cfg);
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'red-ac12-b'; });
    expect(unplacedItem).toBeDefined();
    expect(unplacedItem._unplacedReason).toBe('tool_conflict');
    expect(typeof unplacedItem._unplacedDetail).toBe('string');
    expect(unplacedItem._unplacedDetail).toMatch(/personal_pc/);
  });

  test.failing('RED-AC1.2-c: failDetail names the resolved location for a location_mismatch', () => {
    var result = run([makeTask({ id: 'red-ac12-c', location: ['biz'] })], makeCfg());
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'red-ac12-c'; });
    expect(unplacedItem).toBeDefined();
    expect(unplacedItem._unplacedReason).toBe('location_mismatch');
    // Detail must name the required location ('biz') and the day's resolved location.
    expect(unplacedItem._unplacedDetail).toMatch(/biz/);
  });

  test.failing('RED-AC1.2-d: no-capacity rejection (all slots full) → failReason:"no_slot"', () => {
    // Fill the entire day with an immovable blocker, then try to place a home-location task.
    // The task's location IS satisfiable but capacity is exhausted → no_slot.
    var blocker = makeTask({
      id: 'blocker-001', location: [], tools: [], dur: 1020 - 360, // fills entire morning-evening span
      date: TODAY, datePinned: true
    });
    var target = makeTask({ id: 'red-ac12-d', location: [], tools: [], dur: 30 });
    var statuses = { 'blocker-001': '', 'red-ac12-d': '' };
    var result = unifiedSchedule([blocker, target], statuses, TODAY, NOW_MINS, makeCfg());
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'red-ac12-d'; });
    // Note: if both are placed (blocker doesn't actually pin all slots), this test may need
    // tuning — we're testing the failReason shape, not the exact capacity scenario.
    if (!unplacedItem) {
      // If the target was placed, we can't test the failReason — skip via expect never reached.
      // In that case the scenario needs a tighter blocker setup (handled by the impl developer).
      throw new Error('Target task was placed — blocker scenario needs tightening');
    }
    expect(unplacedItem._unplacedReason).toBe('no_slot');
    expect(typeof unplacedItem._unplacedDetail).toBe('string');
  });

  test.failing('RED-AC1.2-e: _unplacedReason is never undefined on any unplaced item (R11.16)', () => {
    // ALL paths must set a reason. Run with a mix of impossible-location, tool-conflict,
    // and a genuinely full-day scenario. Every item in result.unplaced must have a reason.
    var tasks = [
      makeTask({ id: 'mix-001', location: ['nowhere'] }),
      makeTask({ id: 'mix-002', tools: ['personal_pc'] })
    ];
    var cfg = makeCfg({
      hourLocationOverrides: (function() {
        var h = {};
        h[TODAY] = {};
        for (var hr = 6; hr <= 23; hr++) { h[TODAY][hr] = 'work'; }
        return h;
      })()
    });
    var result = run(tasks, cfg);
    (result.unplaced || []).forEach(function(item) {
      expect(item._unplacedReason).toBeDefined();
      expect(item._unplacedReason).not.toBeNull();
      expect(item._unplacedDetail).toBeDefined();
      expect(item._unplacedDetail).not.toBeNull();
    });
  });
});
