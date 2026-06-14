/**
 * Dependency-Gating Characterization Tests — jug-sched-deps-cache (ROADMAP 999.243)
 *
 * These tests PIN the CURRENT behavior of `depsSatisfied` and the `checkDeps`
 * gate in `findEarliestSlot` / `findLatestSlot` as exercised through the full
 * `unifiedScheduleV2` entry point. They must be GREEN on the UNMODIFIED code
 * and must stay green after the refactor that hoists per-task dep-readiness
 * out of the per-candidate-slot loop.
 *
 * Contract behaviors (B1–B7) per TRACEABILITY.md:
 *   B1  No-dep item always dep-ready (depReadyAbs = -Infinity path)
 *   B2  Unplaced live dep ⇒ dependent task not placed yet (depReadyAbs = +Inf)
 *   B3  Placed dep gates candidate: dependent starts only at/after dep's end
 *   B4  Terminal-status dep (done/cancel/skip/disabled/pause) is NON-constraining
 *   B5  Unknown-status dep (id not in pool / undefined) is NON-constraining
 *   B6  Off-horizon placed dep (placed before the dates window) is NON-constraining
 *   B7  relaxDeps / checkDeps==false path: dep gating is bypassed
 *
 * Self-mutation verification was performed for each pin (see inline comments).
 * Tests exercise the PRODUCTION code path; assertions observe output placements,
 * not mocks or source text.
 *
 * Re-review 2026-06-14 (zoe BLOCK-1, BLOCK-2, WARN-1, WARN-2):
 *   B6.1 — rebuilt as direct unit test of computeDepReadyAbs via _testOnly export;
 *           full-scheduler path cannot reach depDateIdx<0 (past-date deps always
 *           land on today+ in placedById). Mutation: return Infinity → RED.
 *   B7.1 — added dateKey assertion; relaxDeps places child TODAY, not day+20.
 *           Mutation: relaxDeps:false → child stays unplaced → RED.
 *   B2.1 — tightened: uses a fixture where removing return-Infinity for unplaced
 *           dep would let the child place freely today. Mutation: continue →
 *           child IS placed today → test RED (was: B2.2 went RED, B2.1 stayed GREEN).
 *   B3.1 — fixed confound: dep occupies 10:00-12:00 (600-720), nowMins=480 means
 *           slots 480-600 are FREE for an ungated task but BLOCKED for the gated
 *           child. Assertion: child starts at exactly 720 (dep end), which an
 *           ungated child would NOT land at (it lands at 480). Mutation: neuter
 *           depAbsEnd check → child lands at 480 → RED.
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { computeDepReadyAbs, indexOfDate, absoluteMin } = require('../../src/scheduler/unifiedScheduleV2')._testOnly;
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = '2026-03-22'; // Sunday — matches schedulerRules.test.js context
const NOW_MINS = 480; // 8:00 AM — first slots start at 8:00 AM

let _idCounter = 0;
function uid(prefix) { return prefix + '_' + (++_idCounter); }

function makeTask(overrides) {
  return Object.assign({
    id: uid('t'),
    text: 'Test task',
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

const cfg = makeCfg();

/** Run the full scheduler. Statuses are auto-built from task.status fields. */
function run(tasks, todayKey, nowMins, overrideCfg) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, todayKey || TODAY, nowMins != null ? nowMins : NOW_MINS, overrideCfg || cfg);
}

/** Return the placement entry for a task, or null. */
function placement(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (p && p.task && p.task.id === taskId) found = { dateKey: dk, start: p.start, dur: p.dur };
    });
  });
  return found;
}

function isPlaced(result, taskId) {
  return placement(result, taskId) !== null;
}

/** ISO date key N days from TODAY */
function dateKey(n) {
  var d = new Date(2026, 2, 22);
  d.setDate(d.getDate() + n);
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

// ── B1 ───────────────────────────────────────────────────────────────────────
// B1: No-dep item is always dep-ready — the depsSatisfied early-return (no deps → true)
// means checkDeps is never entered and the item can be placed freely.
//
// Self-mutation verified: commenting out the `if (!item.dependsOn || length===0) return true`
// fast-path in depsSatisfied causes this test to remain green (because checkDeps is also false
// when dependsOn is empty). The primary seam mutation is the checkDeps guard at line ~854:
// changing `item.dependsOn && item.dependsOn.length > 0` to `true` causes B1 tasks to also
// try dep-gating — with no placedById entry for anything, they still pass (no deps listed),
// so that mutation is not distinguishable here. B1 is pinned by the observable: no-dep tasks
// ARE placed, with no dep-related unplaced entries.

describe('B1: No-dep item is placed without dep gating', () => {
  test('B1.1: task with no dependsOn is placed freely', () => {
    var task = makeTask({ id: 'b1_nodep', dur: 30 });
    var result = run([task]);
    expect(isPlaced(result, 'b1_nodep')).toBe(true);
    // Must not appear in unplaced list
    var inUnplaced = result.unplaced.some(function(u) { return u && u.id === 'b1_nodep'; });
    expect(inUnplaced).toBe(false);
  });

  test('B1.2: task with empty dependsOn array is placed freely', () => {
    var task = makeTask({ id: 'b1_empty', dur: 30, dependsOn: [] });
    var result = run([task]);
    expect(isPlaced(result, 'b1_empty')).toBe(true);
  });
});

// ── B2 ───────────────────────────────────────────────────────────────────────
// B2: Unplaced live dep ⇒ computeDepReadyAbs returns Infinity (blocked).
// When dep has a live status ('') and no entry in placedById, the function
// must return Infinity so the candidate loop's `candidateAbs < depReadyAbs`
// check blocks every finite slot.
//
// Self-mutation verified (re-review 2026-06-14):
//   Original B2.1 used the full scheduler: dep fixed on day+20 (Phase 0 placed
//   before the queue), child deadline=tomorrow. Dep IS in placedById when the
//   child fires — so `if (!placed) return Infinity` never executes. The test was
//   pinning the depAbsEnd >> deadline window path, not the unplaced-dep path.
//   Removing `return Infinity` → `continue` mutated B2.2 RED (child placed before
//   dep ends) but left B2.1 GREEN — wrong seam.
//
//   Fix: B2.1 now directly tests `computeDepReadyAbs` with a synthetic placedById
//   that has NO entry for the dep. This is the exact code path for "live unplaced
//   dep". B2.2 stays as the full-scheduler ordering pin.
//
//   Mutation: changing `if (!placed) return Infinity` → `if (!placed) continue`
//   causes computeDepReadyAbs to return -Infinity instead of Infinity → test RED.

describe('B2: Unplaced live dep prevents dependent from placing', () => {
  test('B2.1: computeDepReadyAbs returns Infinity when live dep has no placedById entry', () => {
    // Directly exercise the `if (!placed) return Infinity` guard.
    // dep is live (status='') but has no entry in placedById → must return Infinity.
    // Mutation: `continue` instead of `return Infinity` → returns -Infinity → RED.
    var dates = [
      { key: TODAY, date: new Date(2026, 2, 22), isoDow: 0, isToday: true },
      { key: dateKey(1), date: new Date(2026, 2, 23), isoDow: 1, isToday: false },
    ];
    var item = { id: 'b2_child', dependsOn: ['b2_live_dep'] };
    var placedById = {}; // dep is NOT in placedById — it is unplaced
    var statuses = { 'b2_live_dep': '' }; // live dep (empty string = pending)

    var result = computeDepReadyAbs(item, placedById, statuses, dates);

    // Unplaced live dep → must return Infinity (blocks every finite candidateAbs).
    // Mutation: return Infinity → continue → result = -Infinity → test RED.
    expect(result).toBe(Infinity);
  });

  test('B2.2: once dep IS placed, dependent can place after it', () => {
    // Simpler: dep has room to place (today is empty), so dep places first,
    // then dependent gates on dep's end time and places after it.
    var dep = makeTask({ id: 'b2_dep2', dur: 30 });
    var dependent = makeTask({ id: 'b2_child2', dur: 30, dependsOn: ['b2_dep2'] });
    var result = run([dep, dependent]);

    expect(isPlaced(result, 'b2_dep2')).toBe(true);
    expect(isPlaced(result, 'b2_child2')).toBe(true);
    // Ordering: dep end <= child start
    var pDep = placement(result, 'b2_dep2');
    var pChild = placement(result, 'b2_child2');
    var depEndAbs = pDep.start + pDep.dur;
    var childStartAbs = pChild.start;
    // Same day: direct minute comparison; cross-day: child always later
    if (pDep.dateKey === pChild.dateKey) {
      expect(childStartAbs).toBeGreaterThanOrEqual(depEndAbs);
    } else {
      expect(pDep.dateKey < pChild.dateKey).toBe(true);
    }
  });
});

// ── B3 ───────────────────────────────────────────────────────────────────────
// B3: Placed dep gates candidate by depAbsEnd <= candidateAbs.
// When the dep IS placed, `depsSatisfied` computes depAbsEnd = absoluteMin(depDateIdx, placed.start + placed.dur)
// and rejects any candidate slot where depAbsEnd > candidateAbs.
//
// Self-mutation verified (re-review 2026-06-14):
//   Original B3.1 confound: dep fixed 8:00-9:00 (480-540). nowMins=480 blocks slots
//   0-480. First free slot is 540 — which is ALSO the dep-end. A no-dep child in the
//   same fixture lands at exactly 540 too (occupancy, not dep-gating, is the reason).
//   Removing `if (depAbsEnd > candidateAbs) return false` (B3 mutation) left B3.1 GREEN.
//
//   Fix: dep is fixed at 10:00 AM (600 min), dur=120 → ends at 720 (noon).
//   nowMins=480 (8 AM) → slots 480-600 are FREE for any ungated task.
//   A no-dep child placed alone (same dep fixture) would land at 480, NOT 720.
//   The gated child MUST wait until 720 (dep end) → start=720 is the dep-gate signal.
//   Mutation: neuter `if (depAbsEnd > candidateAbs) continue` → child lands at 480 → RED.

describe('B3: Placed dep gates candidate by dep end time', () => {
  test('B3.1: dependent starts exactly at dep end (not at first free slot before dep end)', () => {
    // dep fixed at 10:00 AM (600 min), dur=120 → ends at 720 (noon).
    // Slots 480-600 are FREE (nowMins=480, dep starts at 600).
    // An ungated child would land at 480 (first free slot).
    // The gated child must wait until depAbsEnd=720 → lands at 720.
    // If dep gating is removed, gated child lands at 480 — test goes RED.
    var dep = makeTask({
      id: 'b3_dep',
      dur: 120,
      placementMode: 'fixed',
      time: '10:00 AM',
      date: TODAY,
    });
    var dependent = makeTask({ id: 'b3_child', dur: 30, dependsOn: ['b3_dep'] });
    var result = run([dep, dependent]);

    expect(isPlaced(result, 'b3_dep')).toBe(true);
    expect(isPlaced(result, 'b3_child')).toBe(true);
    var pDep = placement(result, 'b3_dep');
    var pChild = placement(result, 'b3_child');
    var depEnd = pDep.start + pDep.dur; // 600 + 120 = 720

    // The child must start at or after depEnd.
    // Crucially: slots 480-600 were free, so only dep-gating pushes child to 720.
    // (An ungated task with same fixture lands at 480 — confirmed by probe.)
    expect(pChild.start).toBeGreaterThanOrEqual(depEnd);
    // Exact pin: child starts at 720, not 480 or some other slot.
    // This is the value that flips under the dep-gate mutation.
    expect(pChild.start).toBe(720);
  });

  test('B3.2: dependent with fixed date on tomorrow can place earlier than dep end on today', () => {
    // Dep fixed on today at 8:00 PM (1200 min), dur=30 → ends at 1230.
    // absoluteMin for dep end = 0*1440 + 1230 = 1230.
    // Dependent fixed on tomorrow at 8:00 AM → candidateAbs = 1*1440 + 480 = 1920 > 1230 → SATISFIED.
    // This pins: a dependent scheduled on a subsequent day CAN start before dep's wall-clock
    // time because absoluteMin crosses the day boundary.
    var dep = makeTask({
      id: 'b3_dep_d1',
      dur: 30,
      placementMode: 'fixed',
      time: '8:00 PM',
      date: TODAY,
    });
    var tomorrow = dateKey(1);
    var dependent = makeTask({
      id: 'b3_child_d1',
      dur: 30,
      placementMode: 'fixed',
      time: '8:00 AM',
      date: tomorrow,
      dependsOn: ['b3_dep_d1'],
    });
    var result = run([dep, dependent]);

    expect(isPlaced(result, 'b3_dep_d1')).toBe(true);
    expect(isPlaced(result, 'b3_child_d1')).toBe(true);
    // Dependent is on tomorrow (absolute minutes >> dep end on today) → placed normally
    var pChild = placement(result, 'b3_child_d1');
    expect(pChild.dateKey).toBe(tomorrow);
    expect(pChild.start).toBe(480); // fixed at 8:00 AM = 480 minutes
  });
});

// ── B4 ───────────────────────────────────────────────────────────────────────
// B4: Terminal-status dep (done/cancel/skip/disabled/pause) is NON-constraining.
// depsSatisfied short-circuits at `continue` for each terminal status, so the
// dependent is not blocked.
//
// Self-mutation verified: removing one `continue` for 'cancel' causes the cancel-dep test
// to fail when there's no placement for the dep (the placed check returns false).
// The existing Group 50 test covers 'done'. This suite covers cancel/skip/disabled/pause.

describe('B4: Terminal-status dep is non-constraining', () => {
  // B4 'done' is already covered by Group 50 in schedulerRules.test.js.
  // Add tests for the remaining four terminal statuses.

  test('B4.1: cancel dep — dependent places freely', () => {
    var dep = makeTask({ id: 'b4_cancel_dep', dur: 30, status: 'cancel' });
    var child = makeTask({ id: 'b4_cancel_child', dur: 30, dependsOn: ['b4_cancel_dep'] });
    var result = run([dep, child]);
    // cancel dep is not scheduled itself
    expect(isPlaced(result, 'b4_cancel_dep')).toBe(false);
    // child must not be blocked by the cancel dep
    expect(isPlaced(result, 'b4_cancel_child')).toBe(true);
  });

  test('B4.2: skip dep — dependent places freely', () => {
    var dep = makeTask({ id: 'b4_skip_dep', dur: 30, status: 'skip' });
    var child = makeTask({ id: 'b4_skip_child', dur: 30, dependsOn: ['b4_skip_dep'] });
    var result = run([dep, child]);
    expect(isPlaced(result, 'b4_skip_dep')).toBe(false);
    expect(isPlaced(result, 'b4_skip_child')).toBe(true);
  });

  test('B4.3: disabled dep — dependent places freely', () => {
    var dep = makeTask({ id: 'b4_dis_dep', dur: 30, status: 'disabled' });
    var child = makeTask({ id: 'b4_dis_child', dur: 30, dependsOn: ['b4_dis_dep'] });
    var result = run([dep, child]);
    expect(isPlaced(result, 'b4_dis_dep')).toBe(false);
    expect(isPlaced(result, 'b4_dis_child')).toBe(true);
  });

  test('B4.4: pause dep — dependent places freely', () => {
    var dep = makeTask({ id: 'b4_pause_dep', dur: 30, status: 'pause' });
    var child = makeTask({ id: 'b4_pause_child', dur: 30, dependsOn: ['b4_pause_dep'] });
    var result = run([dep, child]);
    expect(isPlaced(result, 'b4_pause_dep')).toBe(false);
    expect(isPlaced(result, 'b4_pause_child')).toBe(true);
  });

  test('B4.5: all terminal statuses — multi-dep child places freely', () => {
    // A child that depends on one dep of each terminal status must still place.
    var deps = [
      makeTask({ id: 'b4_m_done', dur: 30, status: 'done' }),
      makeTask({ id: 'b4_m_cancel', dur: 30, status: 'cancel' }),
      makeTask({ id: 'b4_m_skip', dur: 30, status: 'skip' }),
      makeTask({ id: 'b4_m_disabled', dur: 30, status: 'disabled' }),
      makeTask({ id: 'b4_m_pause', dur: 30, status: 'pause' }),
    ];
    var child = makeTask({
      id: 'b4_m_child',
      dur: 30,
      dependsOn: deps.map(function(d) { return d.id; }),
    });
    var result = run(deps.concat([child]));
    expect(isPlaced(result, 'b4_m_child')).toBe(true);
  });
});

// ── B5 ───────────────────────────────────────────────────────────────────────
// B5: Unknown-status dep (dep ID not in the task pool) is NON-constraining.
// `effectiveStatuses[depId]` is undefined for IDs not in allTasks, so
// `depsSatisfied` hits `if (st === undefined) continue` → satisfied.
//
// The scheduler builds effectiveStatuses from allTasks only. A dep ID that
// doesn't appear in allTasks will have st===undefined → non-constraining.
//
// Self-mutation verified: removing `if (st === undefined) continue` causes the
// scheduler to fall through to `if (!placed) return false` for the phantom dep
// (which has no placedById entry), blocking the child. That makes this test RED.

describe('B5: Unknown-status dep (not in pool) is non-constraining', () => {
  test('B5.1: child with dep on a non-existent task ID is placed freely', () => {
    var child = makeTask({
      id: 'b5_child',
      dur: 30,
      dependsOn: ['phantom_dep_id_that_does_not_exist'],
    });
    var result = run([child]);
    // Child must be placed despite pointing at an ID not in the task pool
    expect(isPlaced(result, 'b5_child')).toBe(true);
    var inUnplaced = result.unplaced.some(function(u) { return u && u.id === 'b5_child'; });
    expect(inUnplaced).toBe(false);
  });

  test('B5.2: child with mix of phantom and live placed dep is gated only by live dep', () => {
    // phantom_id is not in pool → non-constraining.
    // b5_live_dep IS in pool, placed → dependent must start at/after dep end.
    var dep = makeTask({
      id: 'b5_live_dep',
      dur: 60,
      placementMode: 'fixed',
      time: '8:00 AM',
      date: TODAY,
    });
    var child = makeTask({
      id: 'b5_live_child',
      dur: 30,
      dependsOn: ['phantom_id_xyz', 'b5_live_dep'],
    });
    var result = run([dep, child]);
    expect(isPlaced(result, 'b5_live_child')).toBe(true);
    var pDep = placement(result, 'b5_live_dep');
    var pChild = placement(result, 'b5_live_child');
    if (pDep.dateKey === pChild.dateKey) {
      expect(pChild.start).toBeGreaterThanOrEqual(pDep.start + pDep.dur);
    } else {
      expect(pDep.dateKey < pChild.dateKey).toBe(true);
    }
  });
});

// ── B6 ───────────────────────────────────────────────────────────────────────
// B6: Off-horizon placed dep (depDateIdx < 0) is NON-constraining.
// `indexOfDate(dates, placed.dateKey) < 0` → `continue` (satisfied).
//
// Why a direct unit test (not full-scheduler):
//   The full scheduler's `placedById` is seeded only from `dayPlacements`, which
//   is built for dates[] = today+. A past-date dep can never appear in `placedById`
//   with a past dateKey via the normal scheduling path: `tryPlaceAtTime` returns
//   false when `dayOcc[anchorDate]` is undefined (past date not in dayOcc), so the
//   dep falls to the queue and lands on today+. The `depDateIdx<0` guard in
//   `computeDepReadyAbs` is therefore unreachable through the full scheduler entry
//   point — it must be tested at the function level via the _testOnly export.
//
// Self-mutation verified:
//   Changing `if (depDateIdx < 0) continue` → `if (depDateIdx < 0) return Infinity`
//   causes the test to go RED: computeDepReadyAbs returns Infinity (blocked) instead
//   of the correct -Infinity (non-constraining) when the dep's dateKey is off-horizon.

describe('B6: Off-horizon placed dep is non-constraining', () => {
  test('B6.1: computeDepReadyAbs returns -Infinity when dep placed before dates[] window', () => {
    // Build a synthetic dates[] that starts at today (2026-03-22).
    // The dep is "placed" on yesterday (2026-03-21) — before the window start.
    // indexOfDate(dates, yesterday) = -1 → off-horizon → non-constraining.
    //
    // With the off-horizon guard correct (continue): depReadyAbs stays -Infinity → returned.
    // With mutation (return Infinity): function returns Infinity → child blocked → RED.
    var yesterday = '2026-03-21';
    var todayKey  = '2026-03-22';

    // Minimal dates[] array starting at today (matches buildDates output shape).
    var dates = [
      { key: todayKey,  date: new Date(2026, 2, 22), isoDow: 0, isToday: true  },
      { key: '2026-03-23', date: new Date(2026, 2, 23), isoDow: 1, isToday: false },
      { key: '2026-03-24', date: new Date(2026, 2, 24), isoDow: 2, isToday: false },
    ];

    // Dep is live (status='') and placed on yesterday (off the dates[] window).
    var item = { id: 'b6_child', dependsOn: ['b6_past_dep'] };
    var placedById = {
      'b6_past_dep': { dateKey: yesterday, start: 540, dur: 60 }, // placed on yesterday
    };
    var statuses = {
      'b6_past_dep': '', // live dep — not terminal
    };

    var result = computeDepReadyAbs(item, placedById, statuses, dates);

    // Off-horizon dep is non-constraining → depReadyAbs = -Infinity.
    // Mutation: `return Infinity` → result = Infinity → test RED.
    expect(result).toBe(-Infinity);

    // Sanity: confirm indexOfDate returns -1 for yesterday (off-horizon).
    expect(indexOfDate(dates, yesterday)).toBe(-1);
    // Sanity: confirm indexOfDate returns 0 for today (in-horizon).
    expect(indexOfDate(dates, todayKey)).toBe(0);
  });

  test('B6.2: computeDepReadyAbs returns depAbsEnd when dep placed ON today (in-horizon)', () => {
    // Counter-case: same structure but dep placed today → in-horizon → constraining.
    // depAbsEnd = absoluteMin(0, 540+60) = 600.
    var todayKey = '2026-03-22';
    var dates = [
      { key: todayKey, date: new Date(2026, 2, 22), isoDow: 0, isToday: true },
      { key: '2026-03-23', date: new Date(2026, 2, 23), isoDow: 1, isToday: false },
    ];
    var item = { id: 'b6_child2', dependsOn: ['b6_today_dep'] };
    var placedById = {
      'b6_today_dep': { dateKey: todayKey, start: 540, dur: 60 }, // placed today, ends 600
    };
    var statuses = { 'b6_today_dep': '' };

    var result = computeDepReadyAbs(item, placedById, statuses, dates);
    // In-horizon dep → depAbsEnd = 0*1440 + 600 = 600.
    expect(result).toBe(600);
    expect(result).toBe(absoluteMin(0, 540 + 60));
  });
});

// ── B7 ───────────────────────────────────────────────────────────────────────
// B7: relaxDeps / checkDeps==false path bypasses dep gating entirely.
// When `relaxDeps=true` is set on the env/opts, `checkDeps` is false and
// `depsSatisfied` is never called — the dependent can place even with a live
// unplaced dep.
//
// The scheduler activates relaxDeps automatically in its deadline-relaxation
// pass (line ~1735) for overdue tasks with unmet deps. We test that by
// creating a task with a dep that blocks it AND a deadline of today — the
// scheduler's last-resort path should place it via relaxDeps.
//
// Self-mutation verified (re-review 2026-06-14):
//   Original B7.1 only asserted isPlaced(child)===true. Both paths (relaxDeps on or off)
//   could place the child — without relaxDeps but with ignoreDeadline=true, the child
//   eventually places next to the dep on day+20 instead of today. Mutation: disabling
//   relaxDeps left B7.1 GREEN (child placed at day+20, still "placed").
//
//   Fix: assert child.dateKey === TODAY. With relaxDeps, child bypasses dep gating and
//   places at 8:00 AM TODAY. Without relaxDeps (mutation), dep gating blocks all
//   today/tomorrow candidates and child places on day+20 alongside the dep. Since
//   dateKey(TODAY) != dateKey(20), the assertion flips RED under mutation.
//
//   Mutation: hardcoding relaxDeps:false in tryPlaceQueued/deadlineRelaxed pass causes
//   the child to place on day+20 (dep's date), not TODAY → dateKey assertion RED.

describe('B7: relaxDeps bypass — dep gating skipped on overdue deadline pass', () => {
  test('B7.1: overdue child places TODAY via relaxDeps, not on dep\'s far-future date', () => {
    // dep is fixed on day+20 at 9:00 AM. depAbsEnd = 20*1440+570 — far beyond today.
    // Without relaxDeps, child's every candidate slot today fails: depAbsEnd > candidateAbs.
    // The deadline-relaxation pass (line ~1728) fires because:
    //   child.deadlineDate <= todayIsoKey AND child.dependsOn.length > 0
    // relaxDeps=true bypasses checkDeps → child places freely at the first slot TODAY.
    // Expected: child IS placed, and its dateKey is TODAY (not day+20).
    //
    // Mutation proof: setting relaxDeps:false in the deadline-relaxation pass means
    // dep gating stays active. ignoreDeadline:true extends the search through the
    // full horizon. Child eventually places NEXT TO the dep on day+20 → dateKey
    // is day+20, not TODAY → expect(pChild.dateKey).toBe(TODAY) → RED.
    var farFuture = dateKey(20);
    var dep = makeTask({
      id: 'b7_dep',
      dur: 30,
      placementMode: 'fixed',
      time: '9:00 AM',
      date: farFuture,
    });
    var child = makeTask({
      id: 'b7_child',
      dur: 30,
      deadline: TODAY, // deadline <= today triggers the relaxDeps last-resort pass
      dependsOn: ['b7_dep'],
    });
    var result = run([dep, child]);

    // dep is placed (fixed on day+20)
    expect(isPlaced(result, 'b7_dep')).toBe(true);
    // child must be placed via relaxDeps last-resort
    expect(isPlaced(result, 'b7_child')).toBe(true);
    // KEY assertion (missing in original): child places TODAY, not on dep's date.
    // relaxDeps bypasses dep gating → child finds first free slot = today at 8:00 AM.
    // Mutation (relaxDeps:false) → child places on day+20 → this assertion → RED.
    var pChild = placement(result, 'b7_child');
    expect(pChild.dateKey).toBe(TODAY);
  });
});
