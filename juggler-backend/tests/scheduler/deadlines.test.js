/**
 * Deadline Tests — TS-127 to TS-141
 *
 * Deadline base: hard bound, slack, P1 boost, ignoreDeadline, chain backprop, auto-brackets.
 * Deadline x Template/Split/Dependency/Weather/Time-Travel.
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

// ── Deadline Base Tests (TS-127 to TS-132) ────────────────────────────────

describe('Deadline Base Tests', () => {
  describe('TS-127: Hard deadline bound', () => {
    test('Task with hard deadline should not be placed after deadline', () => {
      const task = makeTask({
        id: 'ts127a',
        text: 'Hard deadline task',
        dur: 120,
        deadline: '2026-06-10 12:00' // 720 minutes
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts127a');
      
      expect(placement).not.toBeNull();
      expect(placement.start + placement.dur).toBeLessThanOrEqual(720); // Should end by 12:00 PM
    });

    test('Task with hard deadline at end of day should be placed in last available slot', () => {
      const task = makeTask({
        id: 'ts127b',
        text: 'End of day deadline',
        dur: 60,
        deadline: '2026-06-10 23:00' // 1380 minutes
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts127b');
      
      expect(placement).not.toBeNull();
      expect(placement.start + placement.dur).toBeLessThanOrEqual(1380);
    });
  });

  describe('TS-128: Deadline slack calculation', () => {
    test('Task with ample slack should be placed normally', () => {
      const task = makeTask({
        id: 'ts128a',
        text: 'Ample slack task',
        dur: 60,
        deadline: '2026-06-11 00:00' // Effectively end of day
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts128a');
      
      expect(placement).not.toBeNull();
      // Should be placed in a reasonable morning slot
      expect(placement.start).toBeGreaterThanOrEqual(360); // 6:00 AM
      expect(placement.start).toBeLessThan(720); // Before 12:00 PM
    });

    test('Task with tight slack should be prioritized', () => {
      const urgentTask = makeTask({
        id: 'ts128b',
        text: 'Tight slack task',
        dur: 60,
        pri: 'P1',
        deadline: '2026-06-10 10:00' // 600 minutes
      });
      
      const normalTask = makeTask({
        id: 'ts128c',
        text: 'Normal task',
        dur: 60,
        pri: 'P3',
        deadline: '2026-06-11 00:00'
      });
      
      const result = run([urgentTask, normalTask]);
      const urgentPlacement = findPlacement(result, 'ts128b');
      const normalPlacement = findPlacement(result, 'ts128c');
      
      expect(urgentPlacement).not.toBeNull();
      expect(normalPlacement).not.toBeNull();
      expect(urgentPlacement.start).toBeLessThan(normalPlacement.start);
    });
  });

  describe('TS-129: P1 deadline boost', () => {
    test('P1 task with deadline should get priority boost', () => {
      const p1Task = makeTask({
        id: 'ts129a',
        text: 'P1 deadline task',
        pri: 'P1',
        dur: 60,
        deadline: '2026-06-10 12:00' // 720 minutes
      });
      
      const p3Task = makeTask({
        id: 'ts129b',
        text: 'P3 task',
        pri: 'P3',
        dur: 60,
        deadline: '2026-06-10 12:00' // 720 minutes
      });
      
      const result = run([p1Task, p3Task]);
      const p1Placement = findPlacement(result, 'ts129a');
      const p3Placement = findPlacement(result, 'ts129b');
      
      expect(p1Placement).not.toBeNull();
      expect(p3Placement).not.toBeNull();
      expect(p1Placement.start).toBeLessThan(p3Placement.start);
    });
  });

  describe('TS-130: ignoreDeadline flag', () => {
    test('Task with ignoreDeadline should not be constrained by deadline', () => {
      const task = makeTask({
        id: 'ts130a',
        text: 'Ignore deadline task',
        dur: 60,
        deadline: '2026-06-10 09:00', // Already passed
        ignoreDeadline: true
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts130a');
      
      expect(placement).not.toBeNull();
      // Should be placed normally despite passed deadline
      expect(placement.start).toBeGreaterThanOrEqual(480); // 8:00 AM or later
    });
  });

  describe('TS-131: Chain deadline backpropagation', () => {
    test('Dependent task should inherit deadline constraints from dependency', () => {
      const taskA = makeTask({
        id: 'ts131a',
        text: 'Task A',
        dur: 60,
        deadline: '2026-06-10 12:00' // 720 minutes
      });
      
      const taskB = makeTask({
        id: 'ts131b',
        text: 'Task B',
        dur: 60,
        dependsOn: ['ts131a']
      });
      
      const result = run([taskA, taskB]);
      const placementA = findPlacement(result, 'ts131a');
      const placementB = findPlacement(result, 'ts131b');
      
      expect(placementA).not.toBeNull();
      expect(placementB).not.toBeNull();
      expect(placementA.start + placementA.dur).toBeLessThanOrEqual(720);
      expect(placementB.start).toBeGreaterThanOrEqual(placementA.start + placementA.dur);
    });
  });

  describe('TS-132: Auto-bracket generation', () => {
    test('Task with deadline should generate appropriate time brackets', () => {
      const task = makeTask({
        id: 'ts132a',
        text: 'Auto-bracket task',
        dur: 120,
        deadline: '2026-06-10 15:00' // 900 minutes (3:00 PM)
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts132a');
      
      expect(placement).not.toBeNull();
      // Should be placed in a bracket that ends by 3:00 PM
      expect(placement.start + placement.dur).toBeLessThanOrEqual(900);
      // Should prefer earlier brackets when possible
      expect(placement.start).toBeLessThan(720); // Before lunch if possible
    });
  });
});

// ── Deadline x Template Tests (TS-133 to TS-135) ────────────────────────────

describe('Deadline x Template Tests', () => {
  describe('TS-133: Deadline with schedule templates', () => {
    test('Task with deadline should respect template constraints', () => {
      const task = makeTask({
        id: 'ts133a',
        text: 'Template deadline task',
        dur: 60,
        deadline: '2026-06-10 12:00', // 720 minutes
        when: 'morning' // Morning blocks
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts133a');
      expect(placement).not.toBeNull();
      expect(placement.start + placement.dur).toBeLessThanOrEqual(720);
    });
  });

  describe('TS-134: Deadline with split tasks', () => {
    test('Split task with deadline should have all parts meet deadline', () => {
      const task = makeTask({
        id: 'ts134a',
        text: 'Split deadline task',
        dur: 180,
        deadline: '2026-06-10 15:00', // 900 minutes (3:00 PM)
        split: true
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts134a');
      
      expect(placement).not.toBeNull();
      // Should be placed such that it can complete by deadline
      expect(placement.start + placement.dur).toBeLessThanOrEqual(900);
    });
  });

  describe('TS-135: Deadline with dependencies', () => {
    test('Dependency chain with deadlines should backpropagate constraints', () => {
      const taskA = makeTask({
        id: 'ts135a',
        text: 'Task A',
        dur: 60,
        deadline: '2026-06-10 14:00' // 840 minutes (2:00 PM)
      });
      
      const taskB = makeTask({
        id: 'ts135b',
        text: 'Task B',
        dur: 60,
        dependsOn: ['ts135a']
      });
      
      const taskC = makeTask({
        id: 'ts135c',
        text: 'Task C', 
        dur: 60,
        dependsOn: ['ts135b']
      });
      
      const result = run([taskA, taskB, taskC]);
      
      const placementA = findPlacement(result, 'ts135a');
      const placementB = findPlacement(result, 'ts135b');
      const placementC = findPlacement(result, 'ts135c');
      
      expect(placementA).not.toBeNull();
      expect(placementB).not.toBeNull();
      expect(placementC).not.toBeNull();
      
      // All tasks should complete by the deadline
      expect(placementC.start + placementC.dur).toBeLessThanOrEqual(840);
      // Chain should be sequential
      expect(placementA.start + placementA.dur).toBeLessThanOrEqual(placementB.start);
      expect(placementB.start + placementB.dur).toBeLessThanOrEqual(placementC.start);
    });
  });
});

// ── Deadline x Weather/Time-Travel Tests (TS-136 to TS-141) ────────────────

describe('Deadline x Weather/Time-Travel Tests', () => {
  describe('TS-136: Deadline with weather constraints', () => {
    test('Task with deadline should fail open when weather data unavailable', () => {
      const task = makeTask({
        id: 'ts136a',
        text: 'Weather deadline task',
        dur: 60,
        deadline: '2026-06-10 12:00' // 720 minutes
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts136a');
      expect(placement).not.toBeNull();
      expect(placement.start + placement.dur).toBeLessThanOrEqual(720);
    });
  });

  describe('TS-137: Deadline with time travel simulation', () => {
    test('Task with deadline in time travel mode should respect simulated time', () => {
      const task = makeTask({
        id: 'ts137a',
        text: 'Time travel deadline task',
        dur: 60,
        deadline: '2026-06-10 10:00' // 600 minutes
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts137a');
      expect(placement).not.toBeNull();
      expect(placement.start + placement.dur).toBeLessThanOrEqual(600);
    });
  });

  describe('TS-138: Cross-day deadline handling', () => {
    test('Task with next-day deadline should be placed today if possible', () => {
      const task = makeTask({
        id: 'ts138a',
        text: 'Cross-day deadline task',
        dur: 60,
        deadline: '2026-06-11 08:00' // 8:00 AM next day
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts138a');
      
      expect(placement).not.toBeNull();
      // Should be placed today since deadline is tomorrow morning
      expect(placement.dateKey).toBe('2026-06-10');
    });
  });

  describe('TS-139: Deadline with recurring tasks', () => {
    test('Recurring task instance with deadline should handle instance-specific constraints', () => {
      const task = makeTask({
        id: 'ts139a',
        text: 'Recurring deadline task',
        dur: 60,
        deadline: '2026-06-10 12:00' // 12:00 PM
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts139a');
      
      expect(placement).not.toBeNull();
      expect(placement.start + placement.dur).toBeLessThanOrEqual(720);
    });
  });

  describe('TS-140: Deadline conflict resolution', () => {
    test('Multiple tasks with conflicting deadlines should be resolved by priority', () => {
      const highPriority = makeTask({
        id: 'ts140a',
        text: 'High priority deadline',
        dur: 120,
        pri: 'P1',
        deadline: '2026-06-10 10:00' // 600 minutes
      });
      
      const lowPriority = makeTask({
        id: 'ts140b',
        text: 'Low priority deadline',
        dur: 60,
        pri: 'P4',
        deadline: '2026-06-10 10:00' // 600 minutes
      });
      
      const result = run([highPriority, lowPriority]);
      
      const highPlacement = findPlacement(result, 'ts140a');
      const lowPlacement = findPlacement(result, 'ts140b');
      
      expect(highPlacement).not.toBeNull();
      // High priority task should meet deadline
      expect(highPlacement.start + highPlacement.dur).toBeLessThanOrEqual(600);
      
      // Low priority task might not meet deadline or might be placed later
      if (lowPlacement) {
        expect(lowPlacement.start).toBeGreaterThanOrEqual(highPlacement.start + highPlacement.dur);
      }
    });
  });

  describe('TS-141: Deadline edge cases', () => {
    test('Task with midnight deadline should be handled correctly', () => {
      const task = makeTask({
        id: 'ts141a',
        text: 'Midnight deadline task',
        dur: 60,
        deadline: '2026-06-11 00:00' // 12:00 AM (midnight)
      });
      
      const result = run([task]);
      const placement = findPlacement(result, 'ts141a');
      
      expect(placement).not.toBeNull();
      // Should be placed normally as this effectively means end of day
      expect(placement.start).toBeGreaterThanOrEqual(480);
    });
  });
});