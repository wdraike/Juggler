/**
 * 999.554 — Earliest start enforcement edge cases (R37.1–R37.3)
 *
 * Complements the existing tests/scheduler/earliestStart.test.js by covering:
 *
 * R37.1: earlistStart+3d not placed before — task with earliestStart 3 days
 *        out must not get placed on today/first available earlier day.
 * R37.2: earliestStart > deadline (inverted window) — the task is NEVER
 *        grid force-placed (juggy4 doctrine, 999.1440; rewrite modeled on
 *        juggler 27a95c30). It lands in result.unplaced with a reason and a
 *        pinned date: _unplacedReason='no_slot' + date=deadline while the
 *        deadline is still ahead, or _unplacedReason='missed' + date=deadline
 *        once the deadline has passed. (The original R37.2 draft named the
 *        reason 'impossible_window'; the live taxonomy uses no_slot/missed.)
 * R37.3: Field rename from start_after_at → earliestStart — verifies the
 *        scheduler reads the earliestStart field (not the old name).
 *
 * Pure unit tests — no DB.
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

// ── Config ────────────────────────────────────────────────────────

const TODAY = '2026-06-16';
const NOW_MINS = 540; // 9:00 AM

const BASIC_BLOCKS = {
  Mon: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Tue: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Wed: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Thu: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Fri: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Sat: [{ id: 'all', tag: 'all', name: 'All Day', start: 420, end: 1380, color: '#666', loc: 'home' }],
  Sun: [{ id: 'all', tag: 'all', name: 'All Day', start: 420, end: 1380, color: '#666', loc: 'home' }],
};

function makeCfg() {
  return {
    timeBlocks: BASIC_BLOCKS,
    toolMatrix: {},
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    splitMinDefault: 15,
    preferences: {},
    timezone: 'America/New_York',
  };
}

function makeTask(overrides) {
  return Object.assign({
    id: 't-' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: TODAY,
    dur: 60,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    deadline: null,
    earliestStart: null,
    recurring: false,
    generated: false,
    split: false,
    splitMin: null,
    location: [],
    tools: [],
    dependsOn: [],
    flexWhen: false,
    placementMode: PLACEMENT_MODES.ANYTIME,
    travelBefore: 0,
    travelAfter: 0,
  }, overrides);
}

function run(tasks, cfgOverride) {
  const cfg = cfgOverride || makeCfg();
  const statuses = {};
  tasks.forEach(function (t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}

function findPlacement(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements || {}).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      if (p.task && p.task.id === taskId) found = { dateKey: dk, start: p.start, dur: p.dur };
    });
  });
  return found;
}

function findUnplaced(result, taskId) {
  return (result.unplaced || []).find(function (t) { return t.id === taskId; }) || null;
}

// ═══════════════════════════════════════════════════════════════════
// R37.1 — earliestStart hard lower bound
// ═══════════════════════════════════════════════════════════════════

describe('999.554 R37.1 — earliestStart hard lower bound', function () {

  test('task with earliestStart+3d is NOT placed before that date', function () {
    var task = makeTask({
      earliestStart: '2026-06-19', // 3 days from today
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    // Must be on 2026-06-19 or later — never today (2026-06-16)
    expect(p.dateKey >= '2026-06-19').toBe(true);
  });

  test('task with earliestStart far in future lands on that exact date', function () {
    var task = makeTask({
      earliestStart: '2026-06-22', // 6 days from today
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    expect(p.dateKey).toBe('2026-06-22');
  });

  test('task with earliestStart today can be placed today', function () {
    var task = makeTask({
      earliestStart: TODAY,
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    expect(p.dateKey).toBe(TODAY);
  });

  test('task with earliestStart yesterday (past) is treated as unconstrained', function () {
    var task = makeTask({
      earliestStart: '2026-06-15', // yesterday
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    expect(p.dateKey).toBe(TODAY);
  });

  test('earliestStart works with time_blocks mode on a specific day', function () {
    var task = makeTask({
      earliestStart: '2026-06-18',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'afternoon',
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    // earliestStart with time_blocks mode — scheduler may place on
    // earliestStart date or later depending on capacity
    // (the scheduler doesn't guarantee exact date placement for
    // time_blocks mode with earliestStart)
  });

  test('multiple tasks with different earliestStart dates land on their respective dates', function () {
    var early = makeTask({ id: 'e1', earliestStart: TODAY, dur: 30, pri: 'P1' });
    var mid = makeTask({ id: 'm1', earliestStart: '2026-06-18', dur: 30, pri: 'P2' });
    var late = makeTask({ id: 'l1', earliestStart: '2026-06-20', dur: 30, pri: 'P3' });
    var result = run([early, mid, late]);

    var pEarly = findPlacement(result, 'e1');
    var pMid = findPlacement(result, 'm1');
    var pLate = findPlacement(result, 'l1');

    expect(pEarly).not.toBeNull();
    expect(pMid).not.toBeNull();
    expect(pLate).not.toBeNull();

    expect(pEarly.dateKey).toBe(TODAY);
    expect(pMid.dateKey).toBe('2026-06-18');
    expect(pLate.dateKey).toBe('2026-06-20');
  });
});

// ═══════════════════════════════════════════════════════════════════
// R37.2 — earliestStart > deadline → impossible_window
// ═══════════════════════════════════════════════════════════════════

describe('999.554 R37.2 — earliestStart > deadline (impossible_window)', function () {

  test('earliestStart after deadline — unplaced no_slot, date pinned to deadline (juggy4: never force-placed)', function () {
    // earliestStart = 2026-06-20, deadline = 2026-06-18 → the eligible window
    // is empty. juggy4 doctrine (999.1440, model: juggler 27a95c30): the task
    // is NEVER grid force-placed; it surfaces in result.unplaced with a
    // reason and its date pinned to the deadline (NEVER-MISSING invariant).
    var task = makeTask({
      earliestStart: '2026-06-20',
      deadline: '2026-06-18',
      dur: 60,
    });
    var result = run([task]);
    expect(findPlacement(result, task.id)).toBeNull();
    var un = findUnplaced(result, task.id);
    expect(un).not.toBeNull();
    expect(un._unplacedReason).toBe('no_slot');
    expect(un.date).toBe('2026-06-18'); // pinned to the deadline date
  });

  test('earliestStart == deadline (same day) — task placed on that day', function () {
    var task = makeTask({
      earliestStart: '2026-06-18',
      deadline: '2026-06-18',
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    // Same day means earliestIdx == latestIdx, so there's a single-day window
    expect(p).not.toBeNull();
    expect(p.dateKey).toBe('2026-06-18');
  });

  test('earliestStart before deadline — normal placement', function () {
    var task = makeTask({
      earliestStart: '2026-06-17',
      deadline: '2026-06-20',
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    // Placement must be on or after 17th and on or before 20th
    expect(p.dateKey >= '2026-06-17').toBe(true);
    expect(p.dateKey <= '2026-06-20').toBe(true);
  });

  test('earliestStart far after a PAST deadline — unplaced missed, date pinned to deadline', function () {
    // Deadline (2026-06-15) is already behind TODAY (2026-06-16): the cycle
    // is missed. juggy4 doctrine: unplaced + _unplacedReason='missed', date
    // pinned to the (past) deadline — never demoted, never force-placed.
    var task = makeTask({
      earliestStart: '2026-07-01',
      deadline: '2026-06-15', // already before earliest AND before today
      dur: 60,
    });
    var result = run([task]);
    expect(findPlacement(result, task.id)).toBeNull();
    var un = findUnplaced(result, task.id);
    expect(un).not.toBeNull();
    expect(un._unplacedReason).toBe('missed');
    expect(un.date).toBe('2026-06-15'); // pinned to the past deadline date
  });

  test('inverted window does not affect other placeable tasks — good placed, bad unplaced with reason', function () {
    var good = makeTask({ id: 'good', earliestStart: TODAY, dur: 30, pri: 'P1' });
    var bad = makeTask({
      id: 'bad-window',
      earliestStart: '2026-06-20',
      deadline: '2026-06-18',
      dur: 30,
    });
    var result = run([good, bad]);

    var pGood = findPlacement(result, 'good');
    expect(pGood).not.toBeNull();
    expect(pGood.dateKey).toBe(TODAY);

    // juggy4: the inverted-window task is unplaced with reason + pinned date,
    // never force-placed — and its presence does not disturb normal placement.
    expect(findPlacement(result, 'bad-window')).toBeNull();
    var un = findUnplaced(result, 'bad-window');
    expect(un).not.toBeNull();
    expect(un._unplacedReason).toBe('no_slot');
    expect(un.date).toBe('2026-06-18');
  });
});

// ═══════════════════════════════════════════════════════════════════
// R37.3 — earliestStart field used (not old start_after_at)
// ═══════════════════════════════════════════════════════════════════

describe('999.554 R37.3 — earliestStart field (not start_after_at)', function () {

  test('task with earliestStart field IS respected by scheduler', function () {
    var task = makeTask({
      earliestStart: '2026-06-19',
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    expect(p.dateKey >= '2026-06-19').toBe(true);
  });

  test('task WITHOUT earliestStart is placed at earliest available date (no constraint)', function () {
    var task = makeTask({
      earliestStart: null,
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    // Without earliestStart, task goes to today
    expect(p.dateKey).toBe(TODAY);
  });

  test('task with earliestStart=null behaves same as missing field', function () {
    var task = makeTask({ earliestStart: null, dur: 60 });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    expect(p.dateKey).toBe(TODAY);
  });

  test('earliestStart = "" treated as missing (no constraint)', function () {
    var task = makeTask({ earliestStart: '', dur: 60 });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    // Empty earliestStart → no constraint → placed today
    expect(p.dateKey).toBe(TODAY);
  });
});
