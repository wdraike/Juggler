/**
 * BUG-815b regression — buildItems pool-skip omits 'cancelled' (unifiedScheduleV2.js:248)
 *
 * Covers: BUG-815 (:248 pool-skip branch — zoe WARN-3 uncovered mutation)
 * Layer: unit (pure — no DB required)
 * Traceability: .planning/kermit/fixy-cancelled/TRACEABILITY.md BUG-815
 *
 * Root cause: the pool.forEach skip guard at unifiedScheduleV2.js:248:
 *
 *   if (st === 'done' || st === 'cancel' || st === 'skip' || st === 'pause'
 *       || st === 'disabled' || st === 'cancelled') return;
 *
 * Before bert's fix 'cancelled' was absent from this guard. A task with
 * status='cancelled' (R55 series soft-delete) was NOT skipped — it was built
 * into the items array and then placed into dayPlacements. The depgating
 * allow-list (BUG-815 at :819) is the OTHER fix, covered by
 * bug815-cancelled-dep-gating.test.js. THIS test covers the :248 branch.
 *
 * Self-mutation verification (performed during authoring):
 *   Step 1: Removed `|| st === 'cancelled'` from :248 in a /tmp backup copy.
 *   Step 2: Ran this test against the mutated file (via manual require swap).
 *   Step 3: Confirmed test RED (the cancelled task WAS placed → isPlaced returned true).
 *   Step 4: Restored the production file — test GREEN.
 *
 * Mutation-RED confirmation embedded in comments below.
 */

'use strict';

var unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

var TODAY = '2026-03-22';

// Minimal two-day dates window — same shape used across scheduler unit tests.
function makeDates() {
  return [
    { key: TODAY, date: new Date(2026, 2, 22), isoDow: 0, isToday: true },
    { key: '2026-03-23', date: new Date(2026, 2, 23), isoDow: 1, isToday: false },
  ];
}

function makeCfg() {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {},
  };
}

// Unique-ID counter — avoids accidental cross-test collision.
var _seq = 0;
function uid(prefix) { return prefix + '_815b_' + (++_seq); }

function makeTask(overrides) {
  return Object.assign({
    id: uid('t'),
    text: 'Task',
    date: TODAY,
    dur: 30,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    split: false,
    generated: false,
    section: '',
  }, overrides);
}

// Drive the full production entry point — identical to the run() helper in
// bug815-cancelled-dep-gating.test.js. statuses map is built from task.status
// exactly as runSchedule.js builds it from rowToTask output.
function run(tasks) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, 480 /* 8:00 AM */, makeCfg());
}

// Returns true if any dayPlacement slot contains the given taskId.
function isPlaced(result, taskId) {
  var found = false;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (p && p.task && p.task.id === taskId) found = true;
    });
  });
  return found;
}

// ── BUG-815b: buildItems :248 pool-skip — 'cancelled' branch ─────────────────
//
// unifiedScheduleV2 is called with ONE task whose status='cancelled'.
// The :248 guard must skip it → it must NOT appear in dayPlacements.
//
// PRE-FIX (mutant — `|| st === 'cancelled'` removed from :248):
//   The task passes the skip check, gets built into items[], and is placed in
//   dayPlacements. isPlaced() returns true → the assertion `toBe(false)` FAILS.
//
// POST-FIX (production):
//   The task hits the `st === 'cancelled'` branch → skipped → not in items[].
//   isPlaced() returns false → assertion PASSES.

describe('BUG-815b: buildItems :248 — cancelled task must not be placed', function() {
  test('B815b-1: task with status=cancelled is NOT placed (pool-skip :248)', function() {
    // This is the direct regression test for the :248 cancelled branch.
    // Mutation-RED confirmed: removing `|| st === 'cancelled'` from :248 causes
    // this test to FAIL because the task IS placed (isPlaced returns true).
    var cancelledTask = makeTask({ id: uid('cancelled'), status: 'cancelled', dur: 30 });
    var result = run([cancelledTask]);

    // POST-FIX: the pool-skip at :248 skips the task → not placed.
    // PRE-FIX (mutant): skips the guard → task is built and placed → RED.
    expect(isPlaced(result, cancelledTask.id)).toBe(false);
  });

  test('B815b-2: task with status=cancelled is absent from ALL day placements (full window)', function() {
    // Confirm it is not placed on any day in the schedule window — not just today.
    var cancelledTask = makeTask({ id: uid('cancelled_win'), status: 'cancelled', dur: 30 });
    var result = run([cancelledTask]);

    var totalPlacements = 0;
    Object.keys(result.dayPlacements).forEach(function(dk) {
      (result.dayPlacements[dk] || []).forEach(function(p) {
        if (p && p.task && p.task.id === cancelledTask.id) totalPlacements++;
      });
    });

    // Mutation-RED: remove `|| st === 'cancelled'` → totalPlacements > 0 → fails toBe(0).
    expect(totalPlacements).toBe(0);
  });

  test('B815b-3: active task (status="") alongside cancelled — active IS placed, cancelled is NOT', function() {
    // Regression guard: the skip must not over-exclude. An active task paired with a
    // cancelled one must still be placed. This confirms the fix is scoped to 'cancelled'
    // and does not disturb the '' (active) branch.
    var activeTask = makeTask({ id: uid('active'), status: '', dur: 30 });
    var cancelledTask = makeTask({ id: uid('cancelled_pair'), status: 'cancelled', dur: 30 });
    var result = run([activeTask, cancelledTask]);

    expect(isPlaced(result, activeTask.id)).toBe(true);     // active must be placed
    expect(isPlaced(result, cancelledTask.id)).toBe(false); // cancelled must be skipped
  });

  test('B815b-4: status passed via statuses map (not t.status) — still skipped', function() {
    // buildItems reads: var st = statuses[t.id] || t.status || ''
    // This test covers the statuses-map path: t.status='' but statuses[id]='cancelled'.
    // Simulates the production scenario where runSchedule builds the statuses map from DB.
    var taskId = uid('statuses_map');
    var task = makeTask({ id: taskId, status: '' }); // raw task has no status

    // Bypass the run() helper to inject the statuses map directly — same call
    // signature as the production runScheduleAndPersist path at :1503.
    var statuses = {};
    statuses[taskId] = 'cancelled'; // statuses map carries the 'cancelled' status
    var result = unifiedSchedule([task], statuses, TODAY, 480, makeCfg());

    // POST-FIX: statuses[t.id] resolves to 'cancelled' → :248 skip fires.
    // Mutation-RED: removing 'cancelled' from :248 → task placed → fails.
    expect(isPlaced(result, taskId)).toBe(false);
  });
});
