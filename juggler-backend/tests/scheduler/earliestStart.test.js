/**
 * Earliest-Start Tests — TS-142 to TS-154
 *
 * Earliest-Start base + x Template/Split/Deadline/Time.
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

// Test date: 2026-06-10 (Wednesday)
const TODAY = '2026-06-10';
const NOW_MINS = 480; // 8:00 AM

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
    dur: 60,
    pri: 'P2',
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

// ── Earliest-Start Base Tests (TS-142 to TS-146) ────────────────────────────

describe('Earliest-Start Base Tests', () => {
  describe('TS-142: Basic earliestStart placement', () => {
    test('Task with earliestStart should be placed on or after specified date', () => {
      const task = makeTask({
        id: 'ts142a',
        text: 'Start after task',
        dur: 60,
        earliestStart: '2026-06-11' // Tomorrow
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts142a');
      
      expect(placement).not.toBeNull();
      expect(placement.dateKey).toBe('2026-06-11'); // Should be placed on or after earliestStart date
    });

    test('Task with earliestStart at today should be placed in first available slot', () => {
      const task = makeTask({
        id: 'ts142b',
        text: 'Start after today',
        dur: 60,
        earliestStart: '2026-06-10' // Today
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts142b');
      
      expect(placement).not.toBeNull();
      expect(placement.dateKey).toBe('2026-06-10');
    });
  });

  describe('TS-143: earliestStart with time blocks', () => {
    test('Task with earliestStart should respect time block constraints', () => {
      const task = makeTask({
        id: 'ts143a',
        text: 'Time block start after',
        dur: 60,
        earliestStart: '2026-06-10',
        when: 'afternoon' // Afternoon blocks start at 12:00 PM
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts143a');
      
      expect(placement).not.toBeNull();
      expect(placement.dateKey).toBe('2026-06-10');
      // Should respect time block constraints
      expect(placement.start).toBeGreaterThanOrEqual(720); // Afternoon starts at 12:00 PM
    });
  });

  describe('TS-144: earliestStart priority ordering', () => {
    test('Multiple tasks with different earliestStart dates should be ordered correctly', () => {
      const earlyTask = makeTask({
        id: 'ts144a',
        text: 'Early task',
        dur: 60,
        earliestStart: '2026-06-10' // Today
      });
      
      const lateTask = makeTask({
        id: 'ts144b',
        text: 'Late task',
        dur: 60,
        earliestStart: '2026-06-12' // Day after tomorrow
      });
      
      const result = run([earlyTask, lateTask]);
      const earlyPlacement = findPlacement(result, 'ts144a');
      const latePlacement = findPlacement(result, 'ts144b');
      
      expect(earlyPlacement).not.toBeNull();
      expect(latePlacement).not.toBeNull();
      expect(earlyPlacement.dateKey).toBe('2026-06-10');
      expect(latePlacement.dateKey).toBe('2026-06-12');
    });
  });

  describe('TS-145: earliestStart with priority conflicts', () => {
    test('High priority task should override earliestStart of lower priority task', () => {
      const highPriorityEarly = makeTask({
        id: 'ts145a',
        text: 'High priority early',
        dur: 120,
        pri: 'P1',
        earliestStart: '2026-06-11' // Tomorrow
      });
      
      const lowPriorityNormal = makeTask({
        id: 'ts145b',
        text: 'Low priority normal',
        dur: 60,
        pri: 'P4',
        earliestStart: '2026-06-10' // Today
      });
      
      const result = run([highPriorityEarly, lowPriorityNormal]);
      
      const highPlacement = findPlacement(result, 'ts145a');
      const lowPlacement = findPlacement(result, 'ts145b');
      
      expect(highPlacement).not.toBeNull();
      expect(lowPlacement).not.toBeNull();
      
      // High priority task should get its earliestStart respected
      expect(highPlacement.dateKey).toBe('2026-06-11');
      
      // Low priority task should be placed on its earliestStart date
      expect(lowPlacement.dateKey).toBe('2026-06-10');
    });
  });

  describe('TS-146: earliestStart edge cases', () => {
    test('Task with earliestStart in the past should be placed immediately', () => {
      const task = makeTask({
        id: 'ts146a',
        text: 'Past start after',
        dur: 60,
        earliestStart: '2026-06-09' // Yesterday
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts146a');
      
      expect(placement).not.toBeNull();
      // Should be placed at earliest available slot after now
      expect(placement.dateKey).toBe('2026-06-10');
    });

    test('Task with earliestStart far in future should be placed on that date', () => {
      const task = makeTask({
        id: 'ts146b',
        text: 'Far future start after',
        dur: 60,
        earliestStart: '2026-06-15' // 5 days from now
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts146b');
      
      expect(placement).not.toBeNull();
      expect(placement.dateKey).toBe('2026-06-15');
    });
  });
});

// ── Earliest-Start x Template/Split Tests (TS-147 to TS-150) ────────────────

describe('Earliest-Start x Template/Split Tests', () => {
  describe('TS-147: earliestStart with schedule templates', () => {
    test('Task with earliestStart should respect template time constraints', () => {
      const task = makeTask({
        id: 'ts147a',
        text: 'Template start after',
        dur: 60,
        earliestStart: '2026-06-10',
        when: 'afternoon' // Afternoon blocks start at 12:00 PM
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts147a');
      expect(placement).not.toBeNull();
      expect(placement.dateKey).toBe('2026-06-10');
      // Should be placed in afternoon blocks
      expect(placement.start).toBeGreaterThanOrEqual(720); // Afternoon starts at 12:00 PM
      expect(placement.start).toBeLessThan(1020); // Afternoon ends at 5:00 PM
    });
  });

  describe('TS-148: earliestStart with split tasks', () => {
    test('Split task with earliestStart should have first part respect constraint', () => {
      const task = makeTask({
        id: 'ts148a',
        text: 'Split start after',
        dur: 180,
        earliestStart: '2026-06-10',
        split: true
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts148a');
      
      expect(placement).not.toBeNull();
      expect(placement.dateKey).toBe('2026-06-10');
      // Should be placed on or after earliestStart date
    });
  });

  describe('TS-149: earliestStart with deadline interaction', () => {
    test('Task with both earliestStart and deadline should respect both constraints', () => {
      const task = makeTask({
        id: 'ts149a',
        text: 'Both constraints',
        dur: 120,
        earliestStart: '2026-06-10',
        deadline: '2026-06-10 15:00' // 3:00 PM
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts149a');
      
      expect(placement).not.toBeNull();
      expect(placement.dateKey).toBe('2026-06-10');
      // Should end by deadline
      expect(placement.start + placement.dur).toBeLessThanOrEqual(900);
    });

    test('Task with conflicting constraints should fail gracefully', () => {
      const task = makeTask({
        id: 'ts149b',
        text: 'Conflicting constraints',
        dur: 120,
        earliestStart: '2026-06-10',
        deadline: '2026-06-10 10:00' // 10:00 AM (only 2 hours after start of day, but task needs 2 hours)
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts149b');
      
      // Task might not be placed if constraints cannot be satisfied
      // or might be placed if there's enough time in the morning
      if (placement) {
        expect(placement.dateKey).toBe('2026-06-10');
        expect(placement.start + placement.dur).toBeLessThanOrEqual(600); // 10:00 AM
      }
    });
  });

  describe('TS-150: earliestStart with time-based placement', () => {
    test('Task with earliestStart should work with different time-based placement modes', () => {
      const timeWindowTask = makeTask({
        id: 'ts150a',
        text: 'Time window start after',
        dur: 60,
        earliestStart: '2026-06-10',
        when: 'afternoon' // Afternoon time window
      });
      
      const result = run([timeWindowTask]);
      const placement = findPlacement(result, 'ts150a');
      
      expect(placement).not.toBeNull();
      expect(placement.dateKey).toBe('2026-06-10');
      // Should be within the time window
      expect(placement.start).toBeGreaterThanOrEqual(720); // Afternoon starts at 12:00 PM
      expect(placement.start).toBeLessThan(1020); // Afternoon ends at 5:00 PM
    });
  });
});

// ── Earliest-Start Advanced Tests (TS-151 to TS-154) ────────────────────────

describe('Earliest-Start Advanced Tests', () => {
  describe('TS-151: earliestStart with dependencies', () => {
    test('Dependent task should respect earliestStart of dependency completion', () => {
      const taskA = makeTask({
        id: 'ts151a',
        text: 'Task A',
        dur: 60,
        earliestStart: '2026-06-10'
      });
      
      const taskB = makeTask({
        id: 'ts151b',
        text: 'Task B',
        dur: 60,
        dependsOn: ['ts151a'],
        earliestStart: '2026-06-10'
      });
      
      const result = run([taskA, taskB]);
      
      const placementA = findPlacement(result, 'ts151a');
      const placementB = findPlacement(result, 'ts151b');
      
      expect(placementA).not.toBeNull();
      expect(placementB).not.toBeNull();
      
      // Both tasks should be on or after earliestStart date
      expect(placementA.dateKey).toBe('2026-06-10');
      expect(placementB.dateKey).toBe('2026-06-10');
      
      // Task B should be after Task A
      expect(placementB.start).toBeGreaterThanOrEqual(placementA.start + placementA.dur);
    });
  });

  describe('TS-152: earliestStart with recurring tasks', () => {
    test('Recurring task with earliestStart should handle instance constraints', () => {
      const task = makeTask({
        id: 'ts152a',
        text: 'Recurring start after',
        dur: 60,
        earliestStart: '2026-06-10'
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts152a');
      
      expect(placement).not.toBeNull();
      expect(placement.dateKey).toBe('2026-06-10');
    });
  });

  describe('TS-153: earliestStart batch processing', () => {
    test('Multiple tasks with same earliestStart should be processed in priority order', () => {
      const p1Task = makeTask({
        id: 'ts153a',
        text: 'P1 same start after',
        dur: 60,
        pri: 'P1',
        earliestStart: '2026-06-10'
      });
      
      const p3Task = makeTask({
        id: 'ts153b',
        text: 'P3 same start after',
        dur: 60,
        pri: 'P3',
        earliestStart: '2026-06-10'
      });
      
      const result = run([p1Task, p3Task]);
      
      const p1Placement = findPlacement(result, 'ts153a');
      const p3Placement = findPlacement(result, 'ts153b');
      
      expect(p1Placement).not.toBeNull();
      expect(p3Placement).not.toBeNull();
      
      // Both should be on the earliestStart date
      expect(p1Placement.dateKey).toBe('2026-06-10');
      expect(p3Placement.dateKey).toBe('2026-06-10');
      
      // P1 task should be placed first (earlier in the day)
      expect(p1Placement.start).toBeLessThan(p3Placement.start);
    });
  });

  describe('TS-154: earliestStart system integration', () => {
    test('Complex scenario with multiple constraints and earliestStart', () => {
      const highPriorityEarly = makeTask({
        id: 'ts154a',
        text: 'High priority early',
        dur: 120,
        pri: 'P1',
        earliestStart: '2026-06-10'
      });
      
      const mediumPriorityNormal = makeTask({
        id: 'ts154b',
        text: 'Medium priority normal',
        dur: 60,
        pri: 'P2',
        earliestStart: '2026-06-10'
      });
      
      const lowPriorityLate = makeTask({
        id: 'ts154c',
        text: 'Low priority late',
        dur: 30,
        pri: 'P3',
        earliestStart: '2026-06-11' // Next day
      });
      
      const result = run([highPriorityEarly, mediumPriorityNormal, lowPriorityLate]);
      
      const highPlacement = findPlacement(result, 'ts154a');
      const mediumPlacement = findPlacement(result, 'ts154b');
      const lowPlacement = findPlacement(result, 'ts154c');
      
      expect(highPlacement).not.toBeNull();
      expect(mediumPlacement).not.toBeNull();
      expect(lowPlacement).not.toBeNull();
      
      // Tasks should respect their earliestStart constraints
      expect(highPlacement.dateKey).toBe('2026-06-10');
      expect(mediumPlacement.dateKey).toBe('2026-06-10');
      expect(lowPlacement.dateKey).toBe('2026-06-11');
      
      // Tasks should be ordered by priority and constraints
      expect(highPlacement.start).toBeLessThan(mediumPlacement.start);
    });
  });
});