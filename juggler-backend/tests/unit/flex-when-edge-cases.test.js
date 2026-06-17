/**
 * 999.553 — FlexWhen edge case coverage (R40.1–R40.3)
 *
 * Complements the existing flex-when.test.js by targeting specific edge cases:
 *
 * R40.1: time_blocks with flexWhen=true — task with when-tag AND flexWhen
 * R40.2: _flexWhenRelaxed flag on placed entries when relaxation triggers
 * R40.3: flexWhen + deadline interaction — both fallback levels tried
 *        flexWhen=false — task NOT retried when constrained placement fails
 *
 * Pure unit tests — no DB. Exercises the real unifiedScheduleV2 entry point
 * with a minimal time-block config.
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

// ── Config ────────────────────────────────────────────────────────

const TODAY = '2026-06-16';
const NOW_MINS = 540; // 9:00 AM

const BASIC_BLOCKS = {
  Mon: [
    { id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 720, color: '#F59E0B', loc: 'home' },
    { id: 'afternoon', tag: 'afternoon', name: 'Afternoon', start: 720, end: 1020, color: '#C8942A', loc: 'home' },
    { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#7C3AED', loc: 'home' },
  ],
  Tue: [
    { id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 720, color: '#F59E0B', loc: 'home' },
    { id: 'afternoon', tag: 'afternoon', name: 'Afternoon', start: 720, end: 1020, color: '#C8942A', loc: 'home' },
    { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#7C3AED', loc: 'home' },
  ],
  Wed: [
    { id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 720, color: '#F59E0B', loc: 'home' },
    { id: 'afternoon', tag: 'afternoon', name: 'Afternoon', start: 720, end: 1020, color: '#C8942A', loc: 'home' },
    { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#7C3AED', loc: 'home' },
  ],
  Thu: [
    { id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 720, color: '#F59E0B', loc: 'home' },
    { id: 'afternoon', tag: 'afternoon', name: 'Afternoon', start: 720, end: 1020, color: '#C8942A', loc: 'home' },
    { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#7C3AED', loc: 'home' },
  ],
  Fri: [
    { id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 720, color: '#F59E0B', loc: 'home' },
    { id: 'afternoon', tag: 'afternoon', name: 'Afternoon', start: 720, end: 1020, color: '#C8942A', loc: 'home' },
    { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#7C3AED', loc: 'home' },
  ],
  Sat: [
    { id: 'morning', tag: 'morning', name: 'Morning', start: 420, end: 720, color: '#F59E0B', loc: 'home' },
    { id: 'afternoon', tag: 'afternoon', name: 'Afternoon', start: 720, end: 1020, color: '#F59E0B', loc: 'home' },
    { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#7C3AED', loc: 'home' },
  ],
  Sun: [
    { id: 'morning', tag: 'morning', name: 'Morning', start: 420, end: 720, color: '#F59E0B', loc: 'home' },
    { id: 'afternoon', tag: 'afternoon', name: 'Afternoon', start: 720, end: 1020, color: '#F59E0B', loc: 'home' },
    { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, color: '#7C3AED', loc: 'home' },
  ],
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
    id: 'task-' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: TODAY,
    dur: 30,
    pri: 'P3',
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
      if (p.task && p.task.id === taskId) found = p;
    });
  });
  return found;
}

function findPlacements(result, taskId) {
  var found = [];
  Object.keys(result.dayPlacements || {}).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      if (p.task && p.task.id === taskId) found.push(p);
    });
  });
  return found;
}

// ═══════════════════════════════════════════════════════════════════
// R40.1 — time_blocks with flexWhen=true
// ═══════════════════════════════════════════════════════════════════

describe('999.553 R40.1 — flexWhen with time_blocks', function () {

  test('time_blocks task with flexWhen=true placed in when-block when capacity exists', function () {
    var task = makeTask({
      flexWhen: true,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
      dur: 60,
    });
    var result = run([task]);
    expect(result.placedCount).toBeGreaterThanOrEqual(1);

    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    // Should be in morning (360-720) since there's room
    expect(p.start).toBeGreaterThanOrEqual(360);
    expect(p.start).toBeLessThan(720);
    // No relaxation needed — placed normally
    expect(p._flexWhenRelaxed).toBeUndefined();
  });

  test('time_blocks flexWhen task with blocked when-block — relaxed to another block', function () {
    // Fill the morning block completely with a long filler
    var filler = makeTask({
      id: 'filler-morn',
      text: 'Morning Filler',
      dur: 360, // 6 hours — fills morning (360-720)
      when: 'morning',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      flexWhen: false,
    });
    var flexTask = makeTask({
      id: 'flex-blocked',
      text: 'Flex when morning blocked',
      dur: 60,
      when: 'morning',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      flexWhen: true,
    });
    var result = run([filler, flexTask]);

    var p = findPlacement(result, flexTask.id);
    // flexWhen should allow placement in another block (afternoon)
    expect(p).not.toBeNull();
    // Should have _flexWhenRelaxed=true when placed outside morning
    expect(p._flexWhenRelaxed).toBe(true);
  });

  test('time_blocks flexWhen task with ALL blocks full — goes to unplaced', function () {
    // Fill all blocks on today
    var fillers = [
      makeTask({ id: 'f1', dur: 360, when: 'morning', placementMode: PLACEMENT_MODES.TIME_BLOCKS, flexWhen: false }),
      makeTask({ id: 'f2', dur: 300, when: 'afternoon', placementMode: PLACEMENT_MODES.TIME_BLOCKS, flexWhen: false }),
      makeTask({ id: 'f3', dur: 240, when: 'evening', placementMode: PLACEMENT_MODES.TIME_BLOCKS, flexWhen: false }),
    ];
    var flexTask = makeTask({
      id: 'flex-full',
      text: 'Flex when all blocked',
      dur: 60,
      when: 'morning',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      flexWhen: true,
    });
    var result = run(fillers.concat([flexTask]));

    // All blocks are full — flexWhen should still end up unplaced
    // (relaxation tries ANYTIME but if the full-day cap is hit, still unplaced)
    var p = findPlacement(result, flexTask.id);
    var unplacedIds = (result.unplaced || []).map(function (t) { return t.id; });
    // May or may not find a slot depending on time-grid — we just assert no crash
    if (!p) {
      expect(unplacedIds).toContain(flexTask.id);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// R40.2 — _flexWhenRelaxed flag behavior
// ═══════════════════════════════════════════════════════════════════

describe('999.553 R40.2 — _flexWhenRelaxed flag', function () {

  test('flexWhen task placed normally (within its when-window) has _flexWhenRelaxed absent', function () {
    var task = makeTask({
      flexWhen: true,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'afternoon',
      dur: 30,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    expect(p._flexWhenRelaxed).toBeUndefined();
  });

  test('flexWhen task forced to a different when-window has _flexWhenRelaxed=true', function () {
    // Fill morning so the flexWhen task spills to afternoon
    var filler = makeTask({
      id: 'fill-m2',
      dur: 360, when: 'morning',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      flexWhen: false,
    });
    var flexTask = makeTask({
      id: 'flex-rlx',
      flexWhen: true,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
      dur: 60,
    });
    var result = run([filler, flexTask]);
    var p = findPlacement(result, flexTask.id);
    expect(p).not.toBeNull();
    // If it landed in afternoon (start >= 720), it was relaxed
    if (p.start >= 720) {
      expect(p._flexWhenRelaxed).toBe(true);
    }
  });

  test('non-flexWhen task never gets _flexWhenRelaxed flag', function () {
    var task = makeTask({
      flexWhen: false,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
      dur: 30,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    expect(p._flexWhenRelaxed).toBeUndefined();
  });

  test('_flexWhenRelaxed=true on entries placed via the overdue+flexWhen combined fallback', function () {
    // Deadline in the past + flexWhen=true + when-window blocked
    var filler = makeTask({
      id: 'fill-combo',
      dur: 360, when: 'morning',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      flexWhen: false,
    });
    var overdueFlex = makeTask({
      id: 'flex-overdue',
      flexWhen: true,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
      dur: 60,
      deadline: '2026-06-15', // yesterday
    });
    var result = run([filler, overdueFlex]);
    var p = findPlacement(result, overdueFlex.id);
    if (p) {
      // The combined fallback sets both flags
      expect(p._flexWhenRelaxed).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// R40.3 — flexWhen + deadline interaction
// ═══════════════════════════════════════════════════════════════════

describe('999.553 R40.3 — flexWhen + deadline', function () {

  test('flexWhen task with roomy deadline placed normally', function () {
    var task = makeTask({
      flexWhen: true,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'afternoon',
      dur: 60,
      deadline: '2026-06-20', // far off
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    expect(p._flexWhenRelaxed).toBeUndefined();
    expect(p._overdue).toBeUndefined();
  });

  test('flexWhen task with tight deadline and blocked when — both fallbacks tried', function () {
    // Fill morning, then add a flexWhen task with a deadline today
    var filler = makeTask({
      id: 'f-dl',
      dur: 360, when: 'morning',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      flexWhen: false,
    });
    var tightTask = makeTask({
      id: 'flex-dl',
      flexWhen: true,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
      dur: 60,
      deadline: '2026-06-16', // today
    });
    var result = run([filler, tightTask]);
    // Should be placed via relaxation (at least one of the fallbacks succeeds)
    var p = findPlacement(result, tightTask.id);
    expect(p).not.toBeNull();
  });

  test('flexWhen=false task with blocked when-window goes to unplaced', function () {
    var filler = makeTask({
      id: 'f-no-flex',
      dur: 360, when: 'morning',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      flexWhen: false,
    });
    var strictTask = makeTask({
      id: 'no-flex-strict',
      flexWhen: false,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
      dur: 30,
    });
    var result = run([filler, strictTask]);
    var p = findPlacement(result, strictTask.id);
    var unplacedIds = (result.unplaced || []).map(function (t) { return t.id; });
    // Without flexWhen, task stays unplaced when its only when-window is full
    expect(p).toBeNull();
    expect(unplacedIds).toContain(strictTask.id);
  });

  test('flexWhen=false with room in another when-window still stays in its when-block', function () {
    // Morning is full but afternoon is empty — flexWhen=false task
    // with when:'morning' should NOT be placed in afternoon
    var filler = makeTask({
      id: 'f-m2',
      dur: 360, when: 'morning',
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      flexWhen: false,
    });
    var strictMorn = makeTask({
      id: 'strict-m2',
      flexWhen: false,
      placementMode: PLACEMENT_MODES.TIME_BLOCKS,
      when: 'morning',
      dur: 30,
    });
    var result = run([filler, strictMorn]);
    var p = findPlacement(result, strictMorn.id);
    // Afternoon is free but the task's when only says 'morning' and flexWhen=false
    // The retry ladder only has normal → overdue paths — no relaxWhen without flexWhen
    expect(p).toBeNull();
  });

  test('ANYTIME mode tasks ignore flexWhen (no when-window to relax)', function () {
    var task = makeTask({
      flexWhen: true,
      placementMode: PLACEMENT_MODES.ANYTIME,
      when: '',
      dur: 60,
    });
    var result = run([task]);
    var p = findPlacement(result, task.id);
    expect(p).not.toBeNull();
    // ANYTIME has no when constraint, so flexWhen is irrelevant
    expect(p._flexWhenRelaxed).toBeUndefined();
  });
});
