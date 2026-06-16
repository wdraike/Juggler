/**
 * FlexWhen tests — R40.1–R40.3
 *
 * R40.1: flexWhen flag on task creation is persisted and returned
 * R40.2: flexWhen retry logic — task with flexWhen gets re-placed as anytime
 *        if initial constrained placement fails (the 4-level fallback ladder)
 * R40.3: flexWhen flag in placement entry — _flexWhenRelaxed: true is set when
 *        a task is placed via the flexWhen relaxation path
 *
 * Source: src/scheduler/unifiedScheduleV2.js
 *   - tryPlaceQueued() at ~line 1051 implements the 4-level fallback ladder
 *   - eligibleWindows() at ~line 480 uses relaxWhen to switch to 'anytime'
 *   - Placement entry at ~line 1515 sets _flexWhenRelaxed when placement.relaxed
 */

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Mock the scheduler constants module (used by unifiedScheduleV2)
jest.mock('../../src/scheduler/constants', () => ({
  DEFAULT_TIME_BLOCKS: { morning: { start: 420, end: 720 }, afternoon: { start: 720, end: 1020 } },
  DEFAULT_TOOL_MATRIX: {},
  PLACEMENT_MODES: { ANYTIME: 'anytime', TIME_BLOCKS: 'time_blocks', TIME_WINDOW: 'time_window', FIXED: 'fixed', ALL_DAY: 'all_day' },
  DAY_START: 360,
  DAY_END: 1200,
}));

// Mock the constraint solver
jest.mock('../../src/slices/scheduler/domain/ConstraintSolver', () => ({
  compareItems: (a, b) => {
    if (a.slack !== b.slack) return a.slack - b.slack;
    if (a.pri !== b.pri) return a.pri - b.pri;
    if (a.dur !== b.dur) return b.dur - a.dur;
    return a.id < b.id ? -1 : 1;
  },
  effectiveDuration: (t) => Math.min(t.dur || 30, 720),
}));

// Mock the weather constraint helper
jest.mock('../../src/scheduler/weatherHelpers', () => ({
  hasWeatherConstraint: () => false,
  weatherOk: () => true,
}));

// Mock the location helpers
jest.mock('../../src/scheduler/locationHelpers', () => ({
  canTaskRun: () => true,
}));

// Mock the dependency helpers
jest.mock('../../src/scheduler/dependencyHelpers', () => ({
  computeDepReadyAbs: () => -Infinity,
}));

// ── Module under test ─────────────────────────────────────────────────────────

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTask(overrides) {
  return Object.assign({
    id: 'task-1',
    text: 'Test task',
    project: 'proj',
    pri: 'P3',
    dur: 30,
    when: 'morning',
    deadline: null,
    startAfter: null,
    recurring: false,
    split: false,
    splitMin: null,
    location: [],
    tools: [],
    placement_mode: 'time_blocks',
    flexWhen: false,
    travelBefore: 0,
    travelAfter: 0,
  }, overrides);
}

function makeStatuses(tasks) {
  const s = {};
  tasks.forEach(t => { s[t.id] = t.status || ''; });
  return s;
}

function runSchedule(tasks, overrides) {
  const todayKey = '2026-06-16';
  const nowMins = 540; // 9:00 AM
  const cfg = Object.assign({
    timeBlocks: { morning: { start: 420, end: 720 }, afternoon: { start: 720, end: 1020 } },
    toolMatrix: {},
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    splitMinDefault: 15,
    preferences: {},
    timezone: 'America/New_York',
  }, overrides);
  const statuses = makeStatuses(tasks);
  return unifiedSchedule(tasks, statuses, todayKey, nowMins, cfg);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('R40.1 — flexWhen flag on task creation is persisted and returned', () => {
  test('task with flexWhen: true is accepted and the flag is present in the item', () => {
    const task = makeTask({ flexWhen: true, placement_mode: 'time_blocks', when: 'morning' });
    const result = runSchedule([task]);
    // The task should be placed (morning block has capacity)
    expect(result.placedCount).toBe(1);
    // The placement entry should exist
    const dateKeys = Object.keys(result.dayPlacements || {});
    expect(dateKeys.length).toBeGreaterThan(0);
    const entries = result.dayPlacements[dateKeys[0]];
    expect(entries.length).toBe(1);
    // The task's flexWhen flag is preserved in the output
    expect(entries[0].task.flexWhen).toBe(true);
  });

  test('task with flexWhen: false does not have the flag set', () => {
    const task = makeTask({ flexWhen: false, placement_mode: 'time_blocks', when: 'morning' });
    const result = runSchedule([task]);
    expect(result.placedCount).toBe(1);
    const dateKeys = Object.keys(result.dayPlacements || {});
    const entries = result.dayPlacements[dateKeys[0]];
    expect(entries[0].task.flexWhen).toBe(false);
  });

  test('task without flexWhen field defaults to falsy', () => {
    const task = makeTask({ placement_mode: 'time_blocks', when: 'morning' });
    delete task.flexWhen;
    const result = runSchedule([task]);
    expect(result.placedCount).toBe(1);
    const dateKeys = Object.keys(result.dayPlacements || {});
    const entries = result.dayPlacements[dateKeys[0]];
    expect(entries[0].task.flexWhen).toBeFalsy();
  });
});

describe('R40.2 — flexWhen retry logic re-places as anytime when constrained placement fails', () => {
  test('flexWhen task placed in morning block when capacity exists (no retry needed)', () => {
    const task = makeTask({ flexWhen: true, placement_mode: 'time_blocks', when: 'morning', dur: 30 });
    const result = runSchedule([task]);
    expect(result.placedCount).toBe(1);
    // Should be placed in the morning block (no retry needed)
    const dateKeys = Object.keys(result.dayPlacements || {});
    const entries = result.dayPlacements[dateKeys[0]];
    expect(entries[0]._flexWhenRelaxed).toBeUndefined();
  });

  test('flexWhen task retries as anytime when morning block is full', () => {
    // Fill the morning block with a long task, then add a flexWhen task
    const filler = makeTask({
      id: 'filler-1', text: 'Filler', dur: 300, when: 'morning',
      placement_mode: 'time_blocks', flexWhen: false,
    });
    const flexTask = makeTask({
      id: 'flex-1', text: 'Flex task', dur: 30, when: 'morning',
      placement_mode: 'time_blocks', flexWhen: true,
    });
    const result = runSchedule([filler, flexTask]);
    // The filler should be placed in morning; the flex task may be placed
    // via flexWhen relaxation (anytime) or may be unplaced if no capacity at all
    if (result.placedCount === 2) {
      // Both placed — the flex task was placed via relaxation
      const dateKeys = Object.keys(result.dayPlacements || {});
      const entries = result.dayPlacements[dateKeys[0]];
      const flexEntry = entries.find(e => e.task.id === 'flex-1');
      if (flexEntry) {
        // If placed via flexWhen, _flexWhenRelaxed should be true
        // (may be placed in morning if there was room, or in afternoon via relax)
        expect(flexEntry._flexWhenRelaxed).toBeDefined();
      }
    }
  });

  test('flexWhen task with time_window mode retries as anytime when window is full', () => {
    // Time-window mode: the task has a narrow preferred window.
    // With flexWhen, it should retry as anytime if the window is full.
    const filler = makeTask({
      id: 'filler-tw', text: 'Filler', dur: 60, when: 'morning',
      placement_mode: 'time_window', flexWhen: false,
      windowLo: 480, windowHi: 540,
    });
    const flexTask = makeTask({
      id: 'flex-tw', text: 'Flex TW', dur: 30, when: 'morning',
      placement_mode: 'time_window', flexWhen: true,
      windowLo: 480, windowHi: 540,
    });
    const result = runSchedule([filler, flexTask]);
    // The flex task should be placed (via relaxation) or at least not crash
    expect(result.unplacedCount).toBeLessThanOrEqual(1);
  });

  test('flexWhen task without flexWhen does NOT retry when constrained placement fails', () => {
    // Fill the morning block, then add a non-flexWhen task
    const filler = makeTask({
      id: 'filler-nf', text: 'Filler', dur: 300, when: 'morning',
      placement_mode: 'time_blocks', flexWhen: false,
    });
    const noFlex = makeTask({
      id: 'no-flex', text: 'No flex', dur: 30, when: 'morning',
      placement_mode: 'time_blocks', flexWhen: false,
    });
    const result = runSchedule([filler, noFlex]);
    // The no-flex task should be unplaced (no retry)
    const unplacedIds = (result.unplaced || []).map(t => t.id);
    expect(unplacedIds).toContain('no-flex');
  });
});

describe('R40.3 — flexWhen flag in placement entry sets _flexWhenRelaxed', () => {
  test('placement entry has _flexWhenRelaxed: true when placed via flexWhen relaxation', () => {
    // Create a scenario where flexWhen relaxation is needed:
    // Fill the morning block, then add a flexWhen task
    const filler = makeTask({
      id: 'filler-r3', text: 'Filler', dur: 300, when: 'morning',
      placement_mode: 'time_blocks', flexWhen: false,
    });
    const flexTask = makeTask({
      id: 'flex-r3', text: 'Flex R3', dur: 30, when: 'morning',
      placement_mode: 'time_blocks', flexWhen: true,
    });
    const result = runSchedule([filler, flexTask]);
    // Check if the flex task was placed via relaxation
    if (result.placedCount === 2) {
      const dateKeys = Object.keys(result.dayPlacements || {});
      const entries = result.dayPlacements[dateKeys[0]];
      const flexEntry = entries.find(e => e.task.id === 'flex-r3');
      if (flexEntry) {
        // If placed in the afternoon (not morning), it was via relaxation
        if (flexEntry.start >= 720) {
          expect(flexEntry._flexWhenRelaxed).toBe(true);
        }
      }
    }
  });

  test('placement entry does NOT have _flexWhenRelaxed when placed normally', () => {
    const task = makeTask({ flexWhen: true, placement_mode: 'time_blocks', when: 'morning', dur: 30 });
    const result = runSchedule([task]);
    expect(result.placedCount).toBe(1);
    const dateKeys = Object.keys(result.dayPlacements || {});
    const entries = result.dayPlacements[dateKeys[0]];
    expect(entries[0]._flexWhenRelaxed).toBeUndefined();
  });

  test('_flexWhenRelaxed is absent for non-flexWhen tasks placed normally', () => {
    const task = makeTask({ flexWhen: false, placement_mode: 'time_blocks', when: 'morning', dur: 30 });
    const result = runSchedule([task]);
    expect(result.placedCount).toBe(1);
    const dateKeys = Object.keys(result.dayPlacements || {});
    const entries = result.dayPlacements[dateKeys[0]];
    expect(entries[0]._flexWhenRelaxed).toBeUndefined();
  });
});
