/**
 * R26.3 — recurring + fixed placement_mode falls back to anytime.
 *
 * Backlog 999.584: tests/unit/allowUnfix-opt-in.unit.test.js covers R26.2
 * (unfixing a task by changing placement_mode fixed→anytime) but NOT R26.3.
 *
 *   R26.3 — "The system MUST block recurring+fixed combination: the UI shows
 *            'not available' and the scheduler falls back to anytime."
 *
 * The UI-block half is exercised in tests/scheduler/fixedRecurringGap.test.js
 * (TS-301, DB-backed). This file covers the SCHEDULER half with NO DB:
 * unifiedScheduleV2 must NOT treat a recurring task in FIXED mode as a hard
 * immovable pin. Instead it is a flexible/rigid recurring — movable within the
 * day like an anytime task.
 *
 * Production evidence (src/scheduler/unifiedScheduleV2.js):
 *   line ~272: `var fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring;`
 *              → recurring + FIXED is NEVER flagged `fixed` (the immovable path).
 *   The recurring+fixed task therefore flows through the normal placement /
 *   anytime-fallback ladder and can be displaced from its nominal anchor.
 *
 * Assertions are behavioral (not tautological): we prove the recurring+fixed
 * task is PLACED even with no time, and is DISPLACED to a free slot rather than
 * dropped when its nominal anchor is occupied — i.e. it behaved like anytime.
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

const TODAY = '2026-06-08'; // Monday
const NOW_MINS = 0;

const cfg = {
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

function makeTask(overrides) {
  return Object.assign({
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: TODAY,
    dur: 60,
    pri: 'P3',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    generated: false,
    split: false,
    section: '',
    placementMode: PLACEMENT_MODES.ANYTIME,
  }, overrides);
}

function run(tasks) {
  const statuses = {};
  tasks.forEach((t) => { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}

function placementsFor(result, taskId) {
  const out = [];
  Object.keys(result.dayPlacements).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p.task && p.task.id === taskId) out.push({ dateKey: dk, start: p.start, dur: p.dur, locked: p.locked });
    });
  });
  return out;
}

function isUnplaced(result, taskId) {
  return result.unplaced.some((u) => (u.id || (u.task && u.task.id)) === taskId);
}

describe('R26.3 — recurring + fixed falls back to anytime (scheduler)', () => {
  test('R26.3: recurring + fixed with NO time is still placed (treated as anytime, not dropped)', () => {
    // A genuine hard-fixed task with no time would have nothing to pin to.
    // Because recurring+fixed is NOT a hard pin, it places like anytime.
    const task = makeTask({
      id: 'r263_notime',
      recurring: true,
      recur: { type: 'daily', every: 1 },
      anchorDate: TODAY,
      recurStart: TODAY,
      placementMode: PLACEMENT_MODES.FIXED,
      // no time
    });
    const result = run([task]);
    expect(isUnplaced(result, 'r263_notime')).toBe(false);
    const pls = placementsFor(result, 'r263_notime');
    expect(pls.length).toBeGreaterThanOrEqual(1);
    // Not locked → movable, i.e. the anytime/flexible path, not an immovable pin.
    expect(pls[0].locked).toBe(false);
  });

  test('R26.3: recurring + fixed is DISPLACED to a free slot when its nominal anchor is occupied', () => {
    // A truly-fixed (non-recurring) immovable holds the 09:00 hour. A recurring
    // task in FIXED mode nominally wants 09:00 too. If recurring+fixed were a
    // hard pin it would conflict / drop; instead it falls back to anytime and
    // is placed at a different free slot.
    const immovable = makeTask({
      id: 'r263_immov',
      time: '09:00',
      dur: 60,
      placementMode: PLACEMENT_MODES.FIXED,
      recurring: false,
    });
    const recurringFixed = makeTask({
      id: 'r263_recfixed',
      time: '09:00',
      dur: 60,
      recurring: true,
      recur: { type: 'daily', every: 1 },
      anchorDate: TODAY,
      recurStart: TODAY,
      placementMode: PLACEMENT_MODES.FIXED,
    });
    const result = run([immovable, recurringFixed]);

    // The recurring+fixed task is placed (fell back), not dropped.
    expect(isUnplaced(result, 'r263_recfixed')).toBe(false);
    const recPls = placementsFor(result, 'r263_recfixed');
    expect(recPls.length).toBeGreaterThanOrEqual(1);
    // It is movable (not a hard pin).
    expect(recPls[0].locked).toBe(false);

    // It does not collide with the immovable's time range: the two placements
    // occupy disjoint [start, start+dur) windows on the same day.
    const immPls = placementsFor(result, 'r263_immov');
    expect(immPls.length).toBeGreaterThanOrEqual(1);
    const sameDay = recPls.filter((r) => immPls.some((i) => i.dateKey === r.dateKey));
    sameDay.forEach((r) => {
      immPls.filter((i) => i.dateKey === r.dateKey).forEach((i) => {
        const overlap = r.start < i.start + i.dur && i.start < r.start + r.dur;
        expect(overlap).toBe(false);
      });
    });
  });

  test('R26.3 contrast: a recurring + anytime task places the same way as recurring + fixed (fixed has no special pinning effect)', () => {
    // If recurring+fixed truly fell back to anytime, swapping the mode to
    // anytime should not change whether/where the task can be scheduled in a
    // clean (empty) calendar — both are flexible.
    const recFixed = makeTask({
      id: 'r263_cmp_fixed',
      recurring: true,
      recur: { type: 'daily', every: 1 },
      anchorDate: TODAY,
      recurStart: TODAY,
      placementMode: PLACEMENT_MODES.FIXED,
    });
    const recAnytime = makeTask({
      id: 'r263_cmp_anytime',
      recurring: true,
      recur: { type: 'daily', every: 1 },
      anchorDate: TODAY,
      recurStart: TODAY,
      placementMode: PLACEMENT_MODES.ANYTIME,
    });
    const rFixed = run([recFixed]);
    const rAnytime = run([recAnytime]);

    const pFixed = placementsFor(rFixed, 'r263_cmp_fixed');
    const pAnytime = placementsFor(rAnytime, 'r263_cmp_anytime');

    expect(isUnplaced(rFixed, 'r263_cmp_fixed')).toBe(false);
    expect(isUnplaced(rAnytime, 'r263_cmp_anytime')).toBe(false);
    // Both flexible → both placed, neither locked.
    expect(pFixed[0].locked).toBe(false);
    expect(pAnytime[0].locked).toBe(false);
    // Same flexible behavior → same chosen slot.
    expect(pFixed[0].dateKey).toBe(pAnytime[0].dateKey);
    expect(pFixed[0].start).toBe(pAnytime[0].start);
  });
});
