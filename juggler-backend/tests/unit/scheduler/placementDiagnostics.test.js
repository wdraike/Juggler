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
  test('CHAR-A4: canTaskRun returns false (boolean) when required tool is unavailable at dayLocId (location-constrained task)', () => {
    // personal_pc is at HOME only (DEFAULT_TOOL_MATRIX.home includes 'personal_pc').
    // At WORK: DEFAULT_TOOL_MATRIX.work does NOT include 'personal_pc'.
    // Location-CONSTRAINED (location:['work']) so ANY-LOCATION semantics (999.1599,
    // David ruling 2026-07-15 — applies ONLY to location-'anywhere'/location:[] tasks)
    // does not fire here; dayLocId is already pinned to one of the task's allowed
    // locations, so only that location's tools are checked, unchanged from before.
    // Prior to 999.1599 this fixture used location:[] ("anywhere") — that shape now
    // correctly returns true (personal_pc IS available somewhere — home — in the
    // matrix, and an anywhere task isn't tied to the arbitrarily-resolved dayLocId);
    // see anywhere-tool-resolution-999-1599.test.js for that behavior.
    // SELF-MUTATION: removing the tools check at locationHelpers.js:126-134 → returns true
    // regardless of tool availability → this test FAILS.
    var result = locationHelpers.canTaskRun(
      makeTask({ location: ['work'], tools: ['personal_pc'] }),
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

  test('CHAR-A9: canTaskRunAtMin returns false for personal_pc task at biz slot (work loc, location-constrained)', () => {
    // Monday biz slot (hour 10 = minute 600): resolves to "work";
    // personal_pc not in work tool matrix → false. Location-CONSTRAINED (['work']) so
    // ANY-LOCATION semantics (999.1599) doesn't apply — see CHAR-A4 comment above.
    const MONDAY = '2026-06-22'; // Monday
    const MON_CFG = makeCfg();
    const MON_BLOCKS = timeBlockHelpers.getBlocksForDate(MONDAY, DEFAULT_TIME_BLOCKS, MON_CFG);
    var result = locationHelpers.canTaskRunAtMin(
      makeTask({ location: ['work'], tools: ['personal_pc'] }),
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

  test('CHAR-B2: personal_pc task on all-biz day → goes to unplaced (tool conflict, location-constrained)', () => {
    // Force ALL hours on TODAY to 'work' via hourLocationOverrides.
    // personal_pc is only in DEFAULT_TOOL_MATRIX.home, not .work → every slot rejected.
    // Constrain the search window to TODAY only by setting deadline=TODAY + earliestStart=TODAY
    // (both handled via the task's deadline/earliestStart string fields → deadlineDate clamping
    // in findEarliestSlot prevents roll-forward to the weekend where home slots would be found).
    // Location-CONSTRAINED (location:['work']) so ANY-LOCATION semantics (999.1599, David
    // ruling 2026-07-15 — anywhere/location:[] tasks only) doesn't apply: the task is pinned
    // to 'work', which genuinely lacks personal_pc, so it stays unplaced regardless of the
    // fix. (Prior to 999.1599 this fixture used location:[] — an anywhere task — which now
    // correctly PLACES via the union check since personal_pc exists at home; see
    // anywhere-tool-resolution-999-1599.test.js for that scheduler-level case.)
    // harrison review 2026-07-15 (999.1599): TODAY is Saturday (a home day per
    // DEFAULT_TIME_BLOCKS/DEFAULT_WEEKEND_BLOCKS) — a location:['work'] task is
    // ALREADY unplaceable there by location_mismatch alone, with or without
    // hourLocationOverrides. The bare isUnplaced===true assertion below was
    // tautological: removing hourLocationOverrides did NOT make the test fail
    // ("differently" or otherwise) as the SELF-MUTATION note claimed — the task
    // stayed unplaced via location_mismatch either way, so the fixture no longer
    // exercised the tool_conflict path it's named for. Asserting the specific
    // reason code makes hourLocationOverrides load-bearing again: WITH it, every
    // TODAY slot resolves to 'work' (location matches → tool check runs →
    // personal_pc absent at work → tool_conflict); WITHOUT it, Saturday's home
    // blocks make dayLocId 'home' → location_mismatch (task wants 'work') →
    // the assertion below would fail on the wrong reason code.
    // SELF-MUTATION: remove hourLocationOverrides → dayLocId resolves 'home' on
    // Saturday → _unplacedReason becomes 'location_mismatch', not 'tool_conflict'
    // → this test's reason-code assertion FAILS.
    var cfg = makeCfg({
      hourLocationOverrides: (function() {
        var h = {};
        h[TODAY] = {};
        for (var hr = 6; hr <= 23; hr++) { h[TODAY][hr] = 'work'; }
        return h;
      })()
    });
    var task = makeTask({
      id: 'char-b2', location: ['work'], tools: ['personal_pc'],
      date: TODAY,
      deadline: TODAY,       // clamps deadlineDate → latestIdx = indexOfDate(TODAY)
      earliestStart: TODAY   // clamps earliestIdx → earliestStartDate = TODAY
    });
    var result = run([task], cfg);
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'char-b2'; });
    expect(unplacedItem).toBeDefined();
    expect(unplacedItem._unplacedReason).toBe('tool_conflict');
  });

  test('CHAR-B3: impossible-location task carries a specific _unplacedReason (impl landed)', () => {
    // BUG-PIN WAS: no failReason on the bare {slot:null} path.
    // IMPL LANDED (AC1.2 / I3): now the reason engine sets a code.
    // A task with location=['nowhere'] gets 'location_mismatch' (no matching slot ever found).
    // This replaces the old broken-state pin — Section B GREEN tests now serve as the primary
    // coverage; this CHAR test guards the regression that the reason is never undefined.
    var result = run([makeTask({ id: 'char-b3', location: ['nowhere'] })], makeCfg());
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'char-b3'; });
    expect(unplacedItem).toBeDefined();
    // After impl: reason is a valid, non-null, non-undefined code.
    var reason = unplacedItem && unplacedItem._unplacedReason;
    expect(reason).toBeDefined();
    expect(reason).not.toBeNull();
    expect(typeof reason).toBe('string');
    expect(reason.length).toBeGreaterThan(0);
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

describe('I1 RED — AC1.1: whyCannotRun returns structured failure cause (parallel to bare-boolean canTaskRun)', () => {

  // AC1.1 back-compat decision (SPEC open-decision #2): canTaskRun KEEPS its bare-boolean
  // contract (CHAR-A2–A9 + all existing callers depend on truthy-on-success), and the
  // structured failure cause is surfaced by a PARALLEL helper whyCannotRun (lower blast
  // radius — no boolean call site changes). whyCannotRun distinguishes location-mismatch
  // from tool-unavailable, naming the missing tool + the resolved location.

  test('RED-AC1.1-a: location mismatch → result.cause === "location_mismatch"', () => {
    // Expects whyCannotRun to return an object with cause:'location_mismatch'
    // when the task's required location is not the day location.
    var result = locationHelpers.whyCannotRun(
      makeTask({ location: ['work'] }),
      'home',
      DEFAULT_TOOL_MATRIX
    );
    expect(result).toMatchObject({ ok: false, cause: 'location_mismatch' });
  });

  test('RED-AC1.1-b: location mismatch → result.detail names the required vs resolved location', () => {
    var result = locationHelpers.whyCannotRun(
      makeTask({ location: ['biz'] }),
      'home',
      DEFAULT_TOOL_MATRIX
    );
    // detail includes the required location ('biz') and the resolved day location ('home').
    expect(result).toMatchObject({ ok: false, cause: 'location_mismatch' });
    expect(typeof result.detail).toBe('string');
    expect(result.detail).toMatch(/biz/);
    expect(result.detail).toMatch(/home/);
  });

  test('RED-AC1.1-c: tool unavailable → result.cause === "tool_conflict" (location-constrained)', () => {
    // personal_pc not available at 'work' (only at 'home' per DEFAULT_TOOL_MATRIX).
    // Location-CONSTRAINED (['work']) so ANY-LOCATION semantics (999.1599, David ruling
    // 2026-07-15 — anywhere/location:[] tasks only) doesn't apply — see CHAR-A4 comment.
    var result = locationHelpers.whyCannotRun(
      makeTask({ location: ['work'], tools: ['personal_pc'] }),
      'work',
      DEFAULT_TOOL_MATRIX
    );
    expect(result).toMatchObject({ ok: false, cause: 'tool_conflict' });
  });

  test('RED-AC1.1-d: tool conflict → result.detail names the missing tool and the resolved location (location-constrained)', () => {
    // AC1.1: "naming the missing tool + resolved location"
    // Location-CONSTRAINED (['work']) — see RED-AC1.1-c comment.
    var result = locationHelpers.whyCannotRun(
      makeTask({ location: ['work'], tools: ['personal_pc'] }),
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

  test('RED-AC1.1-g: location mismatch takes precedence over tool check when both fail', () => {
    // Task needs 'biz' location AND 'personal_pc' tool (not at biz/work).
    // Location mismatch fires first (mirrors canTaskRun's guard order); structured
    // result should report cause:'location_mismatch', not cause:'tool_conflict'.
    var result = locationHelpers.whyCannotRun(
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

  test('RED-AC1.2-a: impossible location → {slot:null, failReason:"location_mismatch"}', () => {
    // A task that requires 'nowhere' location can never be placed.
    // IMPL LANDED (I3): the scheduler result now carries _unplacedReason='location_mismatch'.
    // Converted from test.failing — RED→GREEN transition confirmed 2026-06-20.
    // We test at the scheduler output level (unplaced item) as the integration surface:
    var result = run([makeTask({ id: 'red-ac12-a', location: ['nowhere'] })], makeCfg());
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'red-ac12-a'; });
    expect(unplacedItem).toBeDefined();
    expect(unplacedItem._unplacedReason).toBe('location_mismatch');
    expect(typeof unplacedItem._unplacedDetail).toBe('string');
    expect(unplacedItem._unplacedDetail.length).toBeGreaterThan(0);
  });

  test('RED-AC1.2-b: tool conflict → {slot:null, failReason:"tool_conflict"} (location-constrained)', () => {
    // All slots forced to 'work' (hourLocationOverrides) but task needs 'personal_pc'
    // (only at home) → every candidate slot rejected with tool_conflict.
    //
    // SETUP FIX (test-setup issue, not impl gap): the original setup used only TODAY's
    // hourLocationOverrides but a plain (non-generated) task can roll forward to Sunday where
    // home slots exist — Sunday has no override, so personal_pc is available there → placed.
    // Fix: use generated:true + deadline:TODAY to day-lock the task to TODAY only (scheduler
    // isGenerated && anchorMin==null path clamps earliestIdx=latestIdx=anchorDate's index).
    // With all TODAY hours overridden to 'work', personal_pc is unavailable everywhere →
    // unplaced with _unplacedReason='tool_conflict'.
    // Converted from test.failing — RED→GREEN transition confirmed 2026-06-20.
    // Location-CONSTRAINED (location:['work'], added 999.1599, David ruling 2026-07-15):
    // ANY-LOCATION union semantics apply only to location:[] "anywhere" tasks — this fixture
    // is pinned to 'work' so the tool check stays single-location and this scenario keeps
    // testing genuine tool_conflict (personal_pc is real absent at 'work'). The location:[]
    // shape now correctly PLACES instead (see anywhere-tool-resolution-999-1599.test.js).
    var cfg = makeCfg({
      hourLocationOverrides: (function() {
        var h = {};
        h[TODAY] = {};
        for (var hr = 6; hr <= 23; hr++) { h[TODAY][hr] = 'work'; }
        return h;
      })()
    });
    var result = run([makeTask({
      id: 'red-ac12-b', location: ['work'], tools: ['personal_pc'],
      generated: true,    // day-locks the task to TODAY (isGenerated && anchorMin==null)
      deadline: TODAY     // secondary guard: no ignoreDeadline extension past TODAY
    })], cfg);
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'red-ac12-b'; });
    expect(unplacedItem).toBeDefined();
    expect(unplacedItem._unplacedReason).toBe('tool_conflict');
    expect(typeof unplacedItem._unplacedDetail).toBe('string');
    expect(unplacedItem._unplacedDetail).toMatch(/personal_pc/);
  });

  test('RED-AC1.2-c: failDetail names the resolved location for a location_mismatch', () => {
    var result = run([makeTask({ id: 'red-ac12-c', location: ['biz'] })], makeCfg());
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'red-ac12-c'; });
    expect(unplacedItem).toBeDefined();
    expect(unplacedItem._unplacedReason).toBe('location_mismatch');
    // Detail must name the required location ('biz') and the day's resolved location.
    expect(unplacedItem._unplacedDetail).toMatch(/biz/);
  });

  test('RED-AC1.2-d: no-capacity rejection (all slots full) → failReason:"no_slot"', () => {
    // Prove no_slot by exhausting the only available window on a day.
    //
    // SETUP FIX (test-setup issue, not impl gap): the original setup tried a large datePinned
    // blocker but the scheduler re-orders tasks by constraint and doesn't guarantee the blocker
    // occupies slots before the target. Also, plain tasks with deadline=TODAY get
    // ignoreDeadline retry when slack<0 and roll to the next day.
    //
    // Fix: use a TINY custom time block (only 30 min on Saturday: 480-510) and two
    // generated+day-locked tasks. generated:true + no anchorMin → isGenerated path in
    // findEarliestSlot clamps earliest=latest=anchorDate index (TODAY only). Blocker is P0
    // (placed first by compareItems; most constrained wins), fills the only slot.
    // Target is P3 (lower priority, placed second) → no free slot → no_slot.
    // No location/tool constraints on either task → checkLoc=false → populateFailDiag
    // produces no_slot (not location_mismatch or tool_conflict).
    //
    // Converted from test.failing — RED→GREEN transition confirmed 2026-06-20.
    var TINY_BLOCKS = {
      Sat: [{ id: 'tiny', tag: 'morning', name: 'Tiny', start: 480, end: 510, color: '#F59E0B', loc: 'home' }]
    };
    var cfg = makeCfg({ timeBlocks: TINY_BLOCKS });
    var blocker = makeTask({
      id: 'blocker-d', location: [], tools: [], dur: 30, pri: 'P0',
      generated: true, date: TODAY, deadline: TODAY
    });
    var target = makeTask({
      id: 'red-ac12-d', location: [], tools: [], dur: 30, pri: 'P3',
      generated: true, date: TODAY, deadline: TODAY
    });
    var statuses = { 'blocker-d': '', 'red-ac12-d': '' };
    var result = unifiedSchedule([blocker, target], statuses, TODAY, NOW_MINS, cfg);
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === 'red-ac12-d'; });
    // HARD GUARD: if target is placed the scenario is broken; fail loudly.
    if (!unplacedItem) {
      throw new Error('Target task was placed — capacity scenario broken; check TINY_BLOCKS covers only one slot');
    }
    expect(unplacedItem._unplacedReason).toBe('no_slot');
    expect(typeof unplacedItem._unplacedDetail).toBe('string');
    expect(unplacedItem._unplacedDetail.length).toBeGreaterThan(0);
  });

  test('RED-AC1.2-e: _unplacedReason is never undefined on any unplaced item (R11.16)', () => {
    // ALL paths must set a reason. Run with a GENUINE mix of two distinct failure paths:
    //   mix-001 — impossible location ('nowhere') → location_mismatch
    //   mix-002 — tool conflict (personal_pc on all-'work' day) → tool_conflict
    //
    // DAY-LOCK BOTH tasks via generated:true + deadline:TODAY.
    // Without this, mix-002 (plain task) would roll forward to 2026-06-21 (Sunday)
    // where personal_pc IS available at home and get PLACED — leaving only mix-001
    // in result.unplaced. That makes the forEach single-item: it would validate
    // only the location_mismatch path and silently miss tool_conflict (the bug zoe caught).
    // generated:true + deadline:TODAY uses the isGenerated&&anchorMin==null path in
    // findEarliestSlot to clamp earliestIdx=latestIdx=anchorDate's index (TODAY only).
    //
    // SELF-MUTATION: removing generated:true from mix-002 → it rolls to Sunday (placed)
    // → result.unplaced.length < 2 → the hard guard below throws → FAILS.
    // SELF-MUTATION: removing the tool check in locationHelpers → mix-002 placed on TODAY
    // → length < 2 → hard guard → FAILS.
    // SELF-MUTATION: changing the reason engine to emit 'no_slot' for tool conflicts →
    // mix-002 reason !== 'tool_conflict' → FAILS.
    // mix-002 is location-CONSTRAINED (location:['work'], added 999.1599, David ruling
    // 2026-07-15): ANY-LOCATION union semantics apply only to location:[] "anywhere"
    // tasks, so this fixture must stay pinned to 'work' to keep exercising a genuine
    // tool_conflict (personal_pc really is absent at 'work') rather than now correctly
    // placing via the union check.
    var tasks = [
      makeTask({ id: 'mix-001', location: ['nowhere'], generated: true, deadline: TODAY }),
      makeTask({ id: 'mix-002', location: ['work'], tools: ['personal_pc'], generated: true, deadline: TODAY })
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

    // HARD GUARD: both tasks must be unplaced. If either is placed, the scenario is
    // broken (day-lock failed or tool/location check missing) — fail loudly so the
    // forEach below cannot run on a single item and silently pass.
    if ((result.unplaced || []).length < 2) {
      var placedIds = [];
      var days = result.dayPlacements ? Object.keys(result.dayPlacements) : [];
      days.forEach(function(d) {
        (result.dayPlacements[d] || []).forEach(function(block) {
          if (block && block.task) placedIds.push(block.task.id + '@' + d);
        });
      });
      throw new Error(
        'AC1.2-e scenario broken: expected 2 unplaced items but got ' +
        (result.unplaced || []).length + '. Placed: ' + JSON.stringify(placedIds)
      );
    }

    // SPECIFIC per-item assertions: each path must carry its OWN distinct reason code.
    // A generic "reason is defined" loop cannot catch a regression where one code
    // silently replaces the other — these assertions WILL.
    var item001 = (result.unplaced || []).find(function(t) { return t && t.id === 'mix-001'; });
    var item002 = (result.unplaced || []).find(function(t) { return t && t.id === 'mix-002'; });

    expect(item001).toBeDefined();
    expect(item001._unplacedReason).toBe('location_mismatch');
    expect(typeof item001._unplacedDetail).toBe('string');
    expect(item001._unplacedDetail.length).toBeGreaterThan(0);

    expect(item002).toBeDefined();
    expect(item002._unplacedReason).toBe('tool_conflict');
    expect(typeof item002._unplacedDetail).toBe('string');
    expect(item002._unplacedDetail).toMatch(/personal_pc/);

    // UNIVERSAL LOOP (R11.16): every unplaced item across the whole result must carry
    // a non-null reason AND detail — proves the floor holds regardless of scenario shape.
    (result.unplaced || []).forEach(function(item) {
      expect(item._unplacedReason).toBeDefined();
      expect(item._unplacedReason).not.toBeNull();
      expect(item._unplacedDetail).toBeDefined();
      expect(item._unplacedDetail).not.toBeNull();
    });
  });
});
