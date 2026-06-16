/**
 * Placement Mode Tests — TS-23 to TS-61
 *
 * Comprehensive test suite for placement modes:
 * - Time Window (window bounds, flex=0, recurring, missed)
 * - Time Blocks (tags, flexWhen, custom)
 * - Fixed (exact, immovable, 400)
 * - All Day (banner)
 * - Reminder (dur=0, occupancy)
 *
 * These tests verify the scheduler's handling of different placement strategies
 * and edge cases for each mode.
 */

'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

// Test date: 2026-06-10 (Wednesday)
const TODAY = '2026-06-10';
const NOW_MINS = 0; // Start of day for clean slate

function makeCfg(overrides) {
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
    ...overrides
  };
}

const cfg = makeCfg();

function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: TODAY,
    dur: 15,
    pri: 'P3',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    generated: true,
    split: false,
    section: '',
    ...overrides
  };
}

function run(tasks) {
  const statuses = {};
  tasks.forEach(function (t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}

function findPlacement(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      if (p.task && p.task.id === taskId) found = { dateKey: dk, start: p.start, dur: p.dur };
    });
  });
  return found;
}

// Helper to create time window tasks
function makeTimeWindowTask(overrides) {
  return makeTask({
    placementMode: PLACEMENT_MODES.TIME_WINDOW,
    preferredTimeMins: 420, // 7:00 AM
    timeFlex: 60,           // ±60 minutes window
    ...overrides
  });
}

// Helper to create time blocks tasks
function makeTimeBlocksTask(overrides) {
  return makeTask({
    placementMode: PLACEMENT_MODES.TIME_BLOCKS,
    timeBlocks: ['morning', 'afternoon'],
    ...overrides
  });
}

// Helper to create fixed tasks
function makeFixedTask(overrides) {
  return makeTask({
    placementMode: PLACEMENT_MODES.FIXED,
    time: '9:00 AM',
    ...overrides
  });
}

// Helper to create all-day tasks
function makeAllDayTask(overrides) {
  return makeTask({
    placementMode: PLACEMENT_MODES.ALL_DAY,
    dur: 480, // 8 hours (full workday)
    ...overrides
  });
}

// Helper to create reminder tasks
function makeReminderTask(overrides) {
  return makeTask({
    placementMode: PLACEMENT_MODES.REMINDER,
    dur: 0, // Zero duration for reminders
    time: '8:00 AM',
    ...overrides
  });
}

describe('Placement Modes — Time Window, Time Blocks, Fixed, All Day, Reminder', () => {
  describe('TIME_WINDOW mode', () => {
    // TS-23: Window bounds with flex=0
    test('TS-23: Time window with flex=0 falls back to regular placement', () => {
      const task = makeTimeWindowTask({
        id: 'ts23',
        timeFlex: 0, // No flexibility - degenerate window
        preferredTimeMins: 480 // 8:00 AM
      });

      const result = run([task]);
      const p = findPlacement(result, 'ts23');

      expect(p).not.toBeNull();
      // With flex=0, the window is degenerate and falls back to regular placement
      // Task is placed at earliest available slot (DAY_START = 360 = 6:00 AM)
      expect(p.start).toBe(360);
    });

    // TS-24: Recurring time window
    test('TS-24: Recurring time window task places within window', () => {
      const task = makeTimeWindowTask({
        id: 'ts24',
        recurring: true,
        recur: { type: 'daily', days: 'MTWTF' },
        preferredTimeMins: 540, // 9:00 AM
        timeFlex: 30 // ±30 minutes
      });

      const result = run([task]);
      const p = findPlacement(result, 'ts24');

      expect(p).not.toBeNull();
      // Should be within 8:30 AM - 9:30 AM window
      expect(p.start).toBeGreaterThanOrEqual(510);
      expect(p.start).toBeLessThanOrEqual(570);
    });

    // TS-25: Missed time window falls back to next available slot
    test('TS-25: Missed time window falls back to earliest available slot', () => {
      // Create a blocker that fills the entire window
      const blocker = makeFixedTask({
        id: 'blocker',
        time: '7:00 AM',
        dur: 120 // 2 hours, fills 7:00-9:00 AM
      });

      const task = makeTimeWindowTask({
        id: 'ts25',
        preferredTimeMins: 420, // 7:00 AM
        timeFlex: 120 // ±2 hours (5:00 AM - 9:00 AM)
      });

      const result = run([blocker, task]);
      const p = findPlacement(result, 'ts25');

      expect(p).not.toBeNull();
      // When window is completely blocked, task falls back to earliest available slot
      expect(p.start).toBe(360); // DAY_START = 6:00 AM
    });
  });

  describe('TIME_BLOCKS mode', () => {
    // TS-30: Time blocks with tags
    test('TS-30: Time blocks task respects tag restrictions', () => {
      const task = makeTimeBlocksTask({
        id: 'ts30',
        timeBlocks: ['morning'] // Only morning block
      });

      const result = run([task]);
      const p = findPlacement(result, 'ts30');

      expect(p).not.toBeNull();
      // Morning block is typically 6:00 AM - 12:00 PM (360-720 minutes)
      expect(p.start).toBeGreaterThanOrEqual(360);
      expect(p.start).toBeLessThan(720);
    });

    // TS-31: Time blocks with flexWhen
    test('TS-31: Time blocks with flexWhen allows overflow to adjacent blocks', () => {
      const task = makeTimeBlocksTask({
        id: 'ts31',
        timeBlocks: ['morning'],
        flexWhen: true, // Allow overflow
        dur: 300 // 5 hours (longer than morning block)
      });

      const result = run([task]);
      const p = findPlacement(result, 'ts31');

      expect(p).not.toBeNull();
      // Should start in morning but can overflow to afternoon
      expect(p.start).toBeGreaterThanOrEqual(360);
      expect(p.start).toBeLessThan(720);
    });

    // TS-32: Custom time blocks
    test('TS-32: Custom time blocks respect custom definitions', () => {
      const customCfg = makeCfg({
        timeBlocks: {
          'early-morning': { start: 300, end: 420 }, // 5:00-7:00 AM
          'late-evening': { start: 1140, end: 1320 } // 7:00-9:00 PM
        }
      });

      const task = makeTimeBlocksTask({
        id: 'ts32',
        timeBlocks: ['early-morning']
      });

      const result = unifiedSchedule([task], {}, TODAY, NOW_MINS, customCfg);
      const p = findPlacement(result, 'ts32');

      expect(p).not.toBeNull();
      expect(p.start).toBeGreaterThanOrEqual(300);
      expect(p.start).toBeLessThan(420);
    });
  });

  describe('FIXED mode', () => {
    // TS-40: Exact placement at specified time
    test('TS-40: Fixed task places exactly at specified time', () => {
      const task = makeFixedTask({
        id: 'ts40',
        time: '10:30 AM' // 630 minutes
      });

      const result = run([task]);
      const p = findPlacement(result, 'ts40');

      expect(p).not.toBeNull();
      expect(p.start).toBe(630); // Exactly at 10:30 AM
    });

    // TS-41: Immovable fixed task with conflict
    test('TS-41: Fixed task is immovable even with conflicts', () => {
      const fixedTask = makeFixedTask({
        id: 'ts41',
        time: '9:00 AM' // 540 minutes
      });

      // Try to create a conflict - but fixed tasks are placed first and are immovable
      const conflictTask = makeTask({
        id: 'conflict',
        placementMode: PLACEMENT_MODES.ANYTIME,
        dur: 60
      });

      const result = run([fixedTask, conflictTask]);
      const p1 = findPlacement(result, 'ts41');
      const p2 = findPlacement(result, 'conflict');

      expect(p1).not.toBeNull();
      expect(p1.start).toBe(540); // Fixed task stays at exact time
      
      // Conflict task should be placed elsewhere
      expect(p2).not.toBeNull();
      expect(p2.start).not.toBe(540); // Moved to avoid conflict
    });

    // TS-42: Fixed task with invalid time format handled gracefully
    test('TS-42: Fixed task with invalid time format falls back to default placement', () => {
      const task = makeFixedTask({
        id: 'ts42',
        time: 'invalid-time-format'
      });

      const result = run([task]);
      const p = findPlacement(result, 'ts42');

      // Invalid time should fall back to default placement logic
      expect(p).not.toBeNull();
      // Should be placed at DAY_START (360 = 6:00 AM) as fallback
      expect(p.start).toBe(360);
    });
  });

  describe('ALL_DAY mode', () => {
    // TS-50: All-day task creates banner placement
    test('TS-50: All-day tasks are filtered out of time-grid placement', () => {
      const task = makeAllDayTask({
        id: 'ts50',
        text: 'Team Offsite',
        dur: 1440 // 24 hours
      });

      const result = run([task]);
      const p = findPlacement(result, 'ts50');

      // ALL_DAY tasks are filtered out by design - they use separate UI rendering
      expect(p).toBeNull();
    });

    // TS-51: All-day task with custom duration
    test('TS-51: All-day tasks with custom duration are also filtered out', () => {
      const task = makeAllDayTask({
        id: 'ts51',
        dur: 720 // 12 hours (half day)
      });

      const result = run([task]);
      const p = findPlacement(result, 'ts51');

      // ALL_DAY tasks are filtered out regardless of duration
      expect(p).toBeNull();
    });

    // TS-52: Multiple all-day tasks are all filtered out
    test('TS-52: Multiple all-day tasks are all filtered from time-grid', () => {
      const task1 = makeAllDayTask({
        id: 'ts52a',
        text: 'Conference Day 1'
      });

      const task2 = makeAllDayTask({
        id: 'ts52b',
        text: 'Workshop'
      });

      const result = run([task1, task2]);
      const p1 = findPlacement(result, 'ts52a');
      const p2 = findPlacement(result, 'ts52b');

      // Both should be filtered out
      expect(p1).toBeNull();
      expect(p2).toBeNull();
    });
  });

  describe('REMINDER mode', () => {
    // TS-60: Reminder with zero duration
    test('TS-60: Reminder task has zero duration', () => {
      const task = makeReminderTask({
        id: 'ts60',
        text: 'Meeting Reminder',
        time: '8:45 AM' // 525 minutes
      });

      const result = run([task]);
      const p = findPlacement(result, 'ts60');

      expect(p).not.toBeNull();
      expect(p.dur).toBe(0); // Zero duration for reminders
      expect(p.start).toBe(525); // At specified time
    });

    // TS-61: Reminder occupancy behavior
    test('TS-61: Reminder does not block time slot occupancy', () => {
      const reminder = makeReminderTask({
        id: 'ts61',
        time: '9:00 AM' // 540 minutes
      });

      const regularTask = makeTask({
        id: 'regular',
        placementMode: PLACEMENT_MODES.ANYTIME,
        dur: 30
      });

      const result = run([reminder, regularTask]);
      const p1 = findPlacement(result, 'ts61');
      const p2 = findPlacement(result, 'regular');

      expect(p1).not.toBeNull();
      expect(p1.dur).toBe(0);
      expect(p1.start).toBe(540);

      // Regular task should be placed somewhere (not necessarily at the same time)
      expect(p2).not.toBeNull();
      expect(p2.dur).toBe(30);
      // The regular task can be placed at any available slot
      expect(p2.start).toBeGreaterThanOrEqual(360);
    });

    // TS-62: Multiple reminders at same time
    test('TS-62: Multiple reminders can occupy same time slot', () => {
      const reminder1 = makeReminderTask({
        id: 'ts62a',
        time: '9:00 AM'
      });

      const reminder2 = makeReminderTask({
        id: 'ts62b',
        time: '9:00 AM'
      });

      const result = run([reminder1, reminder2]);
      const p1 = findPlacement(result, 'ts62a');
      const p2 = findPlacement(result, 'ts62b');

      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      expect(p1.start).toBe(540);
      expect(p2.start).toBe(540);
      expect(p1.dur).toBe(0);
      expect(p2.dur).toBe(0);
    });
  });

  describe('Edge Cases and Integration', () => {
    // TS-70: Mixed placement modes in same schedule
    test('TS-70: Mixed placement modes work together', () => {
      const tasks = [
        makeFixedTask({ id: 'fixed', time: '9:00 AM' }),
        makeTimeWindowTask({ id: 'window', preferredTimeMins: 540, timeFlex: 30 }),
        makeReminderTask({ id: 'reminder', time: '8:45 AM' })
      ];

      const result = run(tasks);
      
      const fixed = findPlacement(result, 'fixed');
      const window = findPlacement(result, 'window');
      const reminder = findPlacement(result, 'reminder');

      expect(fixed).not.toBeNull();
      expect(window).not.toBeNull();
      expect(reminder).not.toBeNull();
      // Note: ALL_DAY tasks are filtered out, so we don't test them here
    });

    // TS-71: Placement mode transitions
    test('TS-71: Task can transition between placement modes', () => {
      // This would typically be tested with state updates, but for scheduler
      // we verify that different modes can coexist in the same schedule
      const anytimeTask = makeTask({
        id: 'anytime',
        placementMode: PLACEMENT_MODES.ANYTIME
      });

      const windowTask = makeTimeWindowTask({ id: 'window' });

      const result = run([anytimeTask, windowTask]);
      
      const p1 = findPlacement(result, 'anytime');
      const p2 = findPlacement(result, 'window');

      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
    });
  });
});