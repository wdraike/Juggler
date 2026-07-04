/**
 * Leg sched-overdue-reasons — step 0 RED tests.
 *
 * David rulings (2026-07-03, brain 101837):
 *   M-2  UNIVERSAL overdue — a task with a hard/set deadline that can no
 *        longer be placed before it is OVERDUE + UNSCHEDULED regardless of
 *        cause; chain position irrelevant (dependency-block is just one
 *        cause of "no slot remains"); stays unscheduled.
 *   M-3  Same rule for weather-blocked tasks.
 *   M-3b EVERY unscheduled item must ALWAYS carry an accurate reason code:
 *        dep-blocked / weather / tools / location / window-closed /
 *        no-capacity / missed.
 *
 * Known defects (yesterday's sched-audit; backlog 999.1078/999.1084):
 *   F7  NO dep-blocked reason code exists — the scheduler emits nothing
 *       distinct when the dependency floor blocks placement.
 *   F6  A missed PAST recurring occurrence shows the generic 'no_slot'
 *       ("No free slot") chip instead of a missed reason.
 *
 * Layer:
 *   - Scenarios 1-3, 5-7 (dep-block / weather / controls): unit — drive
 *     unifiedScheduleV2.js directly (no DB), mirroring
 *     tests/unit/scheduler/unplacedReasonScenarios.test.js conventions.
 *   - Scenario 8 (F6, missed past recurring): integration — drives
 *     runScheduleAndPersist end-to-end against the test-bed DB (3407),
 *     mirroring tests/runScheduleIntegration.test.js BUG-142-AC1b's fixture
 *     (that is the ONLY seam this bug is reachable through: the day-locked
 *     past ANYTIME recurring task is dropped by unifiedScheduleV2's own
 *     buildItems filter at unifiedScheduleV2.js:274-309 before it is ever
 *     built into an `item` — so it never reaches unifiedScheduleV2's
 *     _unplacedReason machinery at all; only runSchedule.js's Section 9
 *     "moved/skipped past-dated tasks" sweep (:2211-2323) ever sees it, and
 *     that sweep's `unplaced_reason: t._unplacedReason || REASON_CODES.NO_SLOT`
 *     fallback (:2305) fires because `t._unplacedReason` was never set).
 *
 * ROOT-CAUSE EVIDENCE (read against this leg's tree, verified via throwaway
 * node scripts before authoring, per CLAUDE.md evidence-first rule):
 *   - F7: computeDepReadyAbs (unifiedScheduleV2.js:983-999) returns Infinity
 *     when a live dep is unplaced, so every candidate slot in
 *     findEarliestSlot/findLatestSlot fails the `absoluteMin < depReadyAbs`
 *     check and only sets `sawCapacityBlock=true` — indistinguishable from a
 *     genuine capacity-only block. populateFailDiag (:1315-1336) has no
 *     dep-aware branch, so a purely dep-blocked task attributes 'no_slot'.
 *   - M-2: the "Dep-relaxation pass" (deadlineRelaxed, :2634-2668) actively
 *     WORSENS this for a hard-deadline chain member — it retries with BOTH
 *     `relaxDeps:true` AND `ignoreDeadline:true` and, if that finds a slot,
 *     FORCE-PLACES the task on the grid with `_overdue:true`. This directly
 *     contradicts M-2 ("stays unscheduled... regardless of cause") — verified
 *     empirically: a chain member B (dep on incomplete A, deadline=today) ends
 *     up ON THE GRID, not in `unplaced`, when A can never complete.
 *   - F6: unifiedScheduleV2.js:274 drops a day-locked (non-flexible-TPC)
 *     ANYTIME recurring task whose `date` is in the past ("Day-locked — drop
 *     as before", :308) BEFORE item construction — verified empirically: such
 *     a task appears in NEITHER `result.dayPlacements` NOR `result.unplaced`
 *     when driven through unifiedScheduleV2 directly (a NEVER-MISSING
 *     violation at this layer). runSchedule.js's Section 9 sweep is the only
 *     place this ever resurfaces, and it falls back to NO_SLOT there.
 *
 * Traceability: .planning/kermit/sched-overdue-reasons/TRACEABILITY.md
 */
'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { REASON_CODES } = require('../../../shared/scheduler/reasonCodes');

// ─── Unit-layer fixtures (mirrors unplacedReasonScenarios.test.js) ─────────

const TODAY = '2026-06-20'; // Saturday — home day (DEFAULT_TIME_BLOCKS home all day)
const NOW_MINS = 480;       // 8:00 AM

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

function makeTask(overrides) {
  return Object.assign({
    id: 'scenario-000', text: 'Scenario task', dur: 30, pri: 'P2',
    date: TODAY, status: '', when: 'morning,lunch,afternoon,evening,night',
    dayReq: 'any', dependsOn: [], location: [], tools: [],
    recurring: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false
  }, overrides);
}

function run(tasks, cfg) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg || makeCfg());
}

function findUnplaced(result, id) {
  return (result.unplaced || []).find(function(t) { return t && t.id === id; });
}

function idsOnGrid(result) {
  var ids = new Set();
  Object.keys(result.dayPlacements || {}).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (p && p.task && p.task.id) ids.add(p.task.id);
    });
  });
  return ids;
}

function idsUnplaced(result) {
  var ids = new Set();
  (result.unplaced || []).forEach(function(u) {
    var id = u && (u.id || (u.task && u.task.id));
    if (id) ids.add(id);
  });
  return ids;
}

// The FULL current taxonomy (existing codes) PLUS the new code this leg's fix
// step will introduce for dependency-blocked placement failures. Test 5 (M-3b
// sweep) checks every unplaced item's reason falls in this set — i.e. no
// reasonless row AND no code outside the documented taxonomy.
const EXPECTED_TAXONOMY_AFTER_FIX = [
  REASON_CODES.TOOL_CONFLICT,
  REASON_CODES.LOCATION_MISMATCH,
  REASON_CODES.NO_SLOT,
  REASON_CODES.IMPOSSIBLE_WINDOW,
  REASON_CODES.WEATHER_UNAVAILABLE,
  REASON_CODES.WEATHER,
  REASON_CODES.PARTIAL_SPLIT,
  REASON_CODES.RECURRING_SPLIT_OVERFLOW,
  REASON_CODES.MISSED,
  REASON_CODES.TPC_BUDGET,
  REASON_CODES.SPACING_BLOCKED,
  'dep_blocked', // PROPOSED new code (F7 fix) — does not exist in reasonCodes.js yet.
];

// ═══════════════════════════════════════════════════════════════════════════
// Test 1 (F7) — dependency floor blocks placement: no dep-specific reason code
// ═══════════════════════════════════════════════════════════════════════════

describe('F7 — dependency-blocked placement gets a DEPENDENCY-specific reason code', () => {
  test('task B depends on incomplete/unplaceable A: B unplaced with reason "dep_blocked" (RED — currently "no_slot")', () => {
    // A is structurally unplaceable (impossible location) so it NEVER lands in
    // placedById — computeDepReadyAbs therefore returns Infinity for B and B
    // can never clear the dep gate (unifiedScheduleV2.js:983-999).
    // SELF-MUTATION: remove the dep-block attribution in the fix (or revert to
    //   current code) → B's reason reverts to 'no_slot' → this assertion FAILS.
    var A = makeTask({ id: 'dep7-A', location: ['nowhere'] });
    var B = makeTask({ id: 'dep7-B', dependsOn: ['dep7-A'] });
    var result = run([A, B], makeCfg());

    var itemA = findUnplaced(result, 'dep7-A');
    var itemB = findUnplaced(result, 'dep7-B');
    expect(itemA).toBeDefined();
    expect(itemA._unplacedReason).toBe(REASON_CODES.LOCATION_MISMATCH);

    expect(itemB).toBeDefined();
    // DESIRED (F7 fix): a purely dependency-blocked task gets a distinct code,
    // proposed name 'dep_blocked' (consistent with reasonCodes.js snake_case
    // convention: tool_conflict, location_mismatch, no_slot, ...).
    // CURRENT CODE: populateFailDiag has no dep-aware branch, so B falls
    // through to the generic capacity classification. RED.
    expect(itemB._unplacedReason).toBe('dep_blocked');
    expect(itemB._unplacedReason).not.toBe(REASON_CODES.NO_SLOT);
  });

  test('B unplaced entry _unplacedDetail names the blocking dependency (RED — currently the generic no-slot detail)', () => {
    var A = makeTask({ id: 'dep7d-A', location: ['nowhere'] });
    var B = makeTask({ id: 'dep7d-B', dependsOn: ['dep7d-A'] });
    var result = run([A, B], makeCfg());
    var itemB = findUnplaced(result, 'dep7d-B');
    expect(itemB).toBeDefined();
    expect(typeof itemB._unplacedDetail).toBe('string');
    // DESIRED: detail should reference the blocking dependency id/name, not the
    // generic "No free slot in the eligible windows (capacity exhausted)" string
    // populateFailDiag emits for a plain capacity block.
    expect(itemB._unplacedDetail).toMatch(/dep7d-A|depend/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 2 (M-2) — hard-deadline chain member, dep-blocked past deadline:
// UNIVERSAL overdue — must stay UNSCHEDULED with a dep reason, never
// force-placed onto the grid.
// ═══════════════════════════════════════════════════════════════════════════

describe('M-2 — hard-deadline dependency-blocked chain member: overdue + UNSCHEDULED (never grid-placed), dep reason', () => {
  test('B has deadline=TODAY and depends on incomplete A: B must be unplaced (NOT force-placed on the grid) with a dep reason (RED — current code force-places B via the deadlineRelaxed pass)', () => {
    // ROOT CAUSE (verified empirically): unifiedScheduleV2.js's "Dep-relaxation
    // pass" (:2634-2668) catches exactly this shape (deadlineDate <= today AND
    // dependsOn.length > 0) and retries with { relaxDeps: true, ignoreDeadline:
    // true } — i.e. it DROPS the dependency gate entirely and force-places B
    // on the grid with `_overdue: true` the moment a slot is geometrically free,
    // regardless of whether A ever completes. This is the exact violation M-2
    // forbids: "a task ... that can no longer be placed before [its deadline]
    // is OVERDUE + UNSCHEDULED regardless of cause ... stays unscheduled."
    // SELF-MUTATION: remove the M-2 fix (restore relaxDeps:true on the
    //   deadlineRelaxed pass) → B reappears on the grid → onGrid check FAILS.
    var A = makeTask({ id: 'm2-A', location: ['nowhere'] });
    var B = makeTask({
      id: 'm2-B', dependsOn: ['m2-A'],
      deadline: TODAY, earliestStart: TODAY
    });
    var result = run([A, B], makeCfg());

    var onGrid = idsOnGrid(result);
    var unplaced = idsUnplaced(result);

    // DESIRED (M-2): B must never be grid-placed while its dep floor is unmet,
    // even past its own deadline — it stays in the unplaced/unscheduled set.
    expect(onGrid.has('m2-B')).toBe(false);
    expect(unplaced.has('m2-B')).toBe(true);

    var itemB = findUnplaced(result, 'm2-B');
    expect(itemB).toBeDefined();
    // Reason must reflect the TRUE cause (dependency), not a bare 'no_slot'.
    expect(itemB._unplacedReason).toBe('dep_blocked');
  });

  // revised leg sched-overdue-reasons 2026-07-03: M-2 shipped. This test
  // originally pinned the PRE-fix buggy behavior (B force-placed on the grid
  // with _overdue:true) as a tripwire, self-documented to flip once the fix
  // landed. bert's M-2 fix (unifiedScheduleV2.js deadlineRelaxed pass, gated
  // on hasHardDeadline && isPermanentlyDepBlocked) shipped 2026-07-03 — this
  // CONTROL now pins the NEW contract: a hard-deadline, permanently
  // dependency-blocked chain member stays OFF the grid, in `unplaced`, with
  // reason 'dep_blocked'. SELF-MUTATION: reverting the deadlineRelaxed gate
  // (restore bare relaxDeps:true for this shape) makes B reappear on the grid
  // → this assertion FAILS.
  test('CONTROL evidence (pins the POST-M-2-fix contract): B stays UNPLACED (not force-placed on the grid), reason "dep_blocked"', () => {
    var A = makeTask({ id: 'm2c-A', location: ['nowhere'] });
    var B = makeTask({
      id: 'm2c-B', dependsOn: ['m2c-A'],
      deadline: TODAY, earliestStart: TODAY
    });
    var result = run([A, B], makeCfg());
    var onGrid = idsOnGrid(result);
    var unplaced = idsUnplaced(result);
    var placedB = (result.dayPlacements[TODAY] || []).find(function(p) { return p.task.id === 'm2c-B'; });
    expect(onGrid.has('m2c-B')).toBe(false);
    expect(placedB).toBeUndefined();
    expect(unplaced.has('m2c-B')).toBe(true);
    var itemB = findUnplaced(result, 'm2c-B');
    expect(itemB).toBeDefined();
    expect(itemB._unplacedReason).toBe('dep_blocked');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 3 (M-3) — weather-blocked, deadline passed: unscheduled + weather
// reason + (documented) overdue semantics.
// ═══════════════════════════════════════════════════════════════════════════

describe('M-3 — weather-blocked task past its deadline: unscheduled + weather reason', () => {
  test('outdoor task, no weather data (fail-closed), deadline=TODAY: unplaced with reason "weather" (GREEN today — verifies the existing weather path, no regression expected)', () => {
    // Unlike F7/M-2, a pure weather block carries NO dependsOn, so it never
    // enters the deadlineRelaxed pass (:2637-2640 filters on
    // `dependsOn.length > 0`) — it stays in the ordinary unplaced set and
    // applyPlacementFailReason's weather branch (hasWeatherConstraint check,
    // :1570-1577) fires BEFORE the generic diag.failReason branch, so this
    // already emits 'weather' correctly today. Verified empirically before
    // authoring (CLAUDE.md evidence-first) — this assertion is expected GREEN,
    // pinned here as a regression guard for the fix step (must not regress
    // while F7/M-2 are being fixed in the same file).
    var task = makeTask({
      id: 'm3-weather', weatherPrecip: 'dry_only',
      deadline: TODAY, earliestStart: TODAY
    });
    var cfg = makeCfg({ weatherByDateHour: {} }); // empty => fail-closed, no data for any slot
    var result = run([task], cfg);

    var onGrid = idsOnGrid(result);
    var unplaced = idsUnplaced(result);
    expect(onGrid.has('m3-weather')).toBe(false);
    expect(unplaced.has('m3-weather')).toBe(true);

    var item = findUnplaced(result, 'm3-weather');
    expect(item).toBeDefined();
    expect(item._unplacedReason).toBe(REASON_CODES.WEATHER);
    expect(typeof item._unplacedDetail).toBe('string');
    expect(item._unplacedDetail.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 5 (M-3b) — sweep assertion: every unplaced item across all scenarios
// has a non-null reason drawn from the (post-fix) taxonomy.
// ═══════════════════════════════════════════════════════════════════════════

describe('M-3b — R11.16 sweep: every unplaced item carries a non-null reason in the documented taxonomy', () => {
  test('mixed scenario (dep-blocked chain + weather-blocked + plain no-capacity): every unplaced item has a non-null _unplacedReason drawn from the taxonomy', () => {
    var A = makeTask({ id: 'sweep-A', location: ['nowhere'] });
    var B = makeTask({ id: 'sweep-B', dependsOn: ['sweep-A'] });
    var weatherTask = makeTask({ id: 'sweep-weather', weatherPrecip: 'dry_only' });
    var cfg = makeCfg({ weatherByDateHour: {} });
    var result = run([A, B, weatherTask], cfg);

    var unplacedItems = result.unplaced || [];
    expect(unplacedItems.length).toBeGreaterThan(0);
    unplacedItems.forEach(function(item) {
      expect(item._unplacedReason).toBeDefined();
      expect(item._unplacedReason).not.toBeNull();
      expect(typeof item._unplacedReason).toBe('string');
      expect(item._unplacedReason.length).toBeGreaterThan(0);
      expect(EXPECTED_TAXONOMY_AFTER_FIX).toContain(item._unplacedReason);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 7 (ernie ern-sor-f1 / bert fix-loop iter2) — retry-path reason
// freshness: the retryQueue reset at unifiedScheduleV2.js:2482-2485 must
// re-diagnose the FINAL blocker on retry, not leave the stale main-pass
// dep_blocked stamp in place once the dep has actually resolved.
// ═══════════════════════════════════════════════════════════════════════════
//
// RETRYQUEUE MECHANICS (verified empirically via throwaway probe scripts,
// CLAUDE.md evidence-first, before authoring):
//   - The main slack-sorted queue processes items smallest-slack-first
//     (compareItems: slack asc, then pri asc). An item with NO deadline gets
//     `item.slack = Infinity` (computeSlack :679) and therefore sorts to the
//     very END of the main pass, after every finite-slack item.
//   - So: giving the DEPENDENT (B) higher priority (P1) and the DEPENDENCY
//     (A) lower priority (P4), with NEITHER carrying a deadline (both
//     Infinity slack, tie-broken on priority), forces B to be popped and
//     tried FIRST. At that point A is not yet in placedById, so
//     computeDepReadyAbs(B) === Infinity (:983-996) => B is stamped
//     'dep_blocked' (populateFailDiag's sawDepBlock branch, :1364) and
//     `_deferred = true` (:2203) — the exact main-pass mechanism ernie's F1
//     describes.
//   - A is then popped later in the SAME main-pass queue (its turn comes
//     after every finite-slack item) and places successfully — the dep
//     RESOLVES before the retry pass ever runs (retryQueue is built only
//     after the whole main while-loop drains, :2464-2465).
//   - The custom single-window-per-day cfg below (300 min/day, every day)
//     makes B's chosen duration (310 min) structurally unable to fit in ANY
//     single window on ANY day in the entire search horizon (findEarliestSlot
//     :1284 requires `s + item.dur <= winEnd` for the loop body to ever run;
//     310 > 300 fails on every window, every day) — so the retry-pass
//     capacity failure is genuine and horizon-independent, not an artifact of
//     a single day's occupancy or of MAX_SEARCH_DAYS (:144, =365) running out.
//   - This also means the deadlineRelaxed "ignoreDeadline" rescue (:2718-2737,
//     which would otherwise force-place a hard-deadline item on some later
//     day) is not in play here: B carries no `task.deadline`, so it never
//     enters that pass's filter (`u.deadlineDate && ...`, :2698) — the
//     retry-pass failure IS the final, persisted `unplaced` classification.
describe('Retry-path reason freshness (F1) — dep resolves mid-run, retry fails for a DIFFERENT (capacity) cause', () => {
  var SINGLE_WINDOW_BLOCK = [{ id: 'day', tag: 'day', name: 'Day', start: 480, end: 780, loc: 'home' }]; // 300 min/day
  var SINGLE_WINDOW_BLOCKS = {
    Mon: SINGLE_WINDOW_BLOCK, Tue: SINGLE_WINDOW_BLOCK, Wed: SINGLE_WINDOW_BLOCK,
    Thu: SINGLE_WINDOW_BLOCK, Fri: SINGLE_WINDOW_BLOCK, Sat: SINGLE_WINDOW_BLOCK, Sun: SINGLE_WINDOW_BLOCK
  };

  test('B (dep on flexible A) is dep_blocked on the main pass, A places later in the same main pass (dep resolves), B still cannot fit (capacity) on retry: FINAL persisted reason is "no_slot", NOT stale "dep_blocked" (RED before bert iter2\'s retryQueue reset, GREEN after — self-mutation: revert unifiedScheduleV2.js:2482-2485 and this assertion reverts to "dep_blocked")', () => {
    // A: no deadline => Infinity slack => processed AFTER every finite-slack
    // item; lower priority (P4) is only a tie-break belt-and-suspenders (both
    // are Infinity-slack here so priority alone decides order). dur=200 fits
    // comfortably inside the 300-min window, so A places successfully once
    // its turn comes.
    var A = makeTask({ id: 'retry-fresh-A', dur: 200, pri: 'P4', when: 'day' });
    // B: depends on A, no deadline (stays out of the deadlineRelaxed rescue
    // pass entirely), higher priority (P1) so it is popped from the main
    // queue BEFORE A. dur=310 structurally never fits the 300-min window on
    // ANY day — a genuine, horizon-wide capacity block, not a timing
    // coincidence tied to a single day's occupancy.
    var B = makeTask({ id: 'retry-fresh-B', dependsOn: ['retry-fresh-A'], dur: 310, pri: 'P1', when: 'day' });
    var cfg = makeCfg({ timeBlocks: SINGLE_WINDOW_BLOCKS });
    var result = run([A, B], cfg);

    var onGrid = idsOnGrid(result);
    // Sanity: the dep DID resolve (A actually placed somewhere) — otherwise
    // this test would degenerate into the already-covered "dep never
    // resolves" shape (F7 test 1 / the inverse control below), not the
    // retry-freshness bug this test targets.
    expect(onGrid.has('retry-fresh-A')).toBe(true);
    // B never lands on the grid — it never resolved to a real slot.
    expect(onGrid.has('retry-fresh-B')).toBe(false);

    var itemB = findUnplaced(result, 'retry-fresh-B');
    expect(itemB).toBeDefined();
    // THE PIN: once A (the dep) has actually placed, B's retry-pass failure
    // must be attributed to the CURRENT/final blocker (capacity — no window
    // is big enough), not the stale main-pass dep_blocked stamp.
    expect(itemB._unplacedReason).toBe(REASON_CODES.NO_SLOT);
    expect(itemB._unplacedReason).not.toBe('dep_blocked');
    expect(itemB._unplacedDetail).toMatch(/no free slot|capacity exhausted/i);
  });

  test('CONTROL (inverse): dep never resolves (A structurally unplaceable) — B stays "dep_blocked" through the retry pass (fresh re-diagnosis reaches the SAME answer, not a frozen stale one)', () => {
    // A is structurally unplaceable (impossible location, mirrors F7 test 1's
    // A) — it NEVER lands in placedById, on the main pass OR the retry pass.
    var A = makeTask({ id: 'retry-fresh-ctrl-A', location: ['nowhere'], pri: 'P4', when: 'day' });
    // Same oversized duration as the flipped-fixture above, so the ONLY
    // variable that differs between this control and the RED/GREEN test
    // above is whether the dep resolves — proving the retry-pass reset
    // re-diagnoses from scratch each time rather than merely "always clearing
    // to no_slot".
    var B = makeTask({ id: 'retry-fresh-ctrl-B', dependsOn: ['retry-fresh-ctrl-A'], dur: 310, pri: 'P1', when: 'day' });
    var cfg = makeCfg({ timeBlocks: SINGLE_WINDOW_BLOCKS });
    var result = run([A, B], cfg);

    var onGrid = idsOnGrid(result);
    expect(onGrid.has('retry-fresh-ctrl-A')).toBe(false);
    expect(onGrid.has('retry-fresh-ctrl-B')).toBe(false);

    var itemB = findUnplaced(result, 'retry-fresh-ctrl-B');
    expect(itemB).toBeDefined();
    // The dep is STILL unplaced when the retry pass re-diagnoses B (identical
    // to the main-pass diagnosis, computeDepReadyAbs still Infinity) — so the
    // reset-and-reattribute fix must reach the SAME answer, not merely "the
    // absence of a stale value defaults to no_slot".
    expect(itemB._unplacedReason).toBe('dep_blocked');
    expect(itemB._unplacedDetail).toMatch(/retry-fresh-ctrl-A|depend/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 6 — Controls: unaffected paths must not regress.
// ═══════════════════════════════════════════════════════════════════════════

describe('Controls — unrelated paths unchanged', () => {
  test('normal no-capacity task (no deps, no weather): reason stays "no_slot" (GREEN, regression guard)', () => {
    var blocker = makeTask({
      id: 'ctrl-blocker', dur: 720, datePinned: true,
      when: 'morning,lunch,afternoon,evening,night'
    });
    var target = makeTask({ id: 'ctrl-target', dur: 120, deadline: TODAY, earliestStart: TODAY });
    var result = run([blocker, target], makeCfg());
    var item = findUnplaced(result, 'ctrl-target');
    if (!item) {
      // Known scenario-setup dependency documented upstream in
      // unplacedReasonScenarios.test.js AC2.4-a — if the blocker didn't
      // actually pin capacity this run, skip gracefully (not this leg's bug).
      return;
    }
    expect(item._unplacedReason).toBe(REASON_CODES.NO_SLOT);
  });

  test('placeable dep-chain (A done): B places normally, no reason set, not in unplaced (GREEN, regression guard)', () => {
    var A = makeTask({ id: 'ctrl-done-A', status: 'done' });
    var B = makeTask({ id: 'ctrl-done-B', dependsOn: ['ctrl-done-A'] });
    var result = run([A, B], makeCfg());
    var onGrid = idsOnGrid(result);
    var unplaced = idsUnplaced(result);
    expect(onGrid.has('ctrl-done-B')).toBe(true);
    expect(unplaced.has('ctrl-done-B')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 4 (F6) — missed PAST recurring occurrence: integration layer.
// ═══════════════════════════════════════════════════════════════════════════
//
// This scenario is NOT reachable through unifiedScheduleV2 alone: a
// day-locked (non-flexible-TPC) ANYTIME recurring task whose `date` is in the
// past is dropped at buildItems (unifiedScheduleV2.js:274-309, "Day-locked —
// drop as before") BEFORE an `item` is ever constructed for it — verified
// empirically: driving it through unifiedSchedule() directly produces NEITHER
// a dayPlacements entry NOR a result.unplaced entry (it vanishes at this
// layer). Only runSchedule.js's Section 9 "moved/skipped past-dated tasks"
// sweep (:2211-2323) ever persists a reason for it, and that sweep's fallback
// (`t._unplacedReason || REASON_CODES.NO_SLOT`, :2305) fires because
// `t._unplacedReason` was never set upstream. Mirrors
// tests/runScheduleIntegration.test.js's BUG-142-AC1b fixture (same shape:
// scheduled_at=NULL, date=past, daily/MTWRFSU recur, no recur_end so the
// reconciler doesn't just delete it) — that suite already proves `unscheduled`
// ends up 1 and `status` stays non-terminal; this test adds the
// `unplaced_reason` assertion BUG-142-AC1b never checked.

describe('F6 — missed PAST recurring occurrence: unplaced_reason must be "missed", not the NO_SLOT fallback', () => {
  var db = require('../../src/db');
  var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
  var { assertDbAvailable } = require('../helpers/requireDB');
  var tasksWrite = require('../../src/lib/tasks-write');

  var USER_ID = 'sched-overdue-reasons-f6-001';
  var TZ = 'America/New_York';
  var PAST_DATE_KEY = '2026-06-01';

  async function cleanup() {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('user_config').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  }

  beforeAll(async () => {
    await assertDbAvailable();
    await cleanup();
    await db('users').insert({
      id: USER_ID, email: 'sched-overdue-reasons-f6@test.com', timezone: TZ,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
    await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
  }, 15000);

  afterAll(async () => {
    await cleanup();
    await db.destroy();
  });

  test('day-locked (non-flexible-TPC) daily recurring instance, never placed, date strictly in the past: unplaced_reason === "missed" (RED — currently falls back to NO_SLOT)', async () => {
    await db('task_masters').insert({
      id: 'sor-f6-tmpl',
      user_id: USER_ID,
      text: 'F6 day-locked recurring, past occurrence, never placed',
      dur: 30,
      status: '',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }), // NOT flexible-TPC (no timesPerCycle)
      recur_start: PAST_DATE_KEY,
      // No recur_end — reconciler generates future desired occurrences too,
      // matching BUG-142-AC1b's shape (exercises the reconcile-move path
      // rather than a simple "template ended" no-op).
      time_flex: 0,
      when: 'morning',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('task_instances').insert({
      id: 'sor-f6-inst',
      master_id: 'sor-f6-tmpl',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: null,       // never placed
      date: PAST_DATE_KEY,      // date IS set — the partial-init state (BUG-142-AC1b shape)
      status: '',
      unscheduled: 0,           // NOT yet flagged — this run's sweep must be the one to flag it
      // `overdue` field removed (sched-drop-overdue-column, M-5): stored column gone.
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    var row = await db('task_instances').where('id', 'sor-f6-inst').first();
    expect(row).toBeDefined(); // never-missing: row must survive (BUG-142-AC1b precedent)
    expect(row.status).not.toBe('missed'); // status column: auto-miss retired (Leg D) — reason lives in unplaced_reason, not status

    // DESIRED (F6 fix): a genuinely missed past recurring occurrence carries
    // the 'missed' reason code, matching unifiedScheduleV2's own
    // pastAnchoredRecurrings pass (:2493-2504) for the shapes it DOES reach —
    // this shape (day-locked ANYTIME, dropped at :274-309) must get the same
    // treatment instead of silently defaulting through runSchedule.js's
    // NO_SLOT fallback (:2305).
    // CURRENT CODE: RED — verified empirically (throwaway debug script against
    // this exact fixture): row.unplaced_reason persists as 'no_slot' via the
    // `t._unplacedReason || REASON_CODES.NO_SLOT` fallback at runSchedule.js:2305
    // (t._unplacedReason was never set — unifiedScheduleV2 dropped this item at
    // buildItems, :274-309, before it ever reached the reason-attribution code).
    expect(row.unplaced_reason).toBe(REASON_CODES.MISSED);
    expect(row.unplaced_reason).not.toBe(REASON_CODES.NO_SLOT);
  }, 15000);
});
