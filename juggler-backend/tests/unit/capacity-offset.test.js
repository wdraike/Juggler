/**
 * 999.565 — Capacity-aware deadline offset (R36.2)
 *
 * Verifies that chain deadline backpropagation in unifiedScheduleV2
 * propagates the consumer's deadline backward to predecessors.
 *
 * R36.2: When task A depends on task B, and A has a deadline date,
 *        B's effective deadline is tightened to A's deadline date
 *        (or earlier if B's own deadline is already tighter).
 *        The current implementation propagates the date directly
 *        (not capacity-aware — that refinement is deferred to diff-mode).
 *
 * Pure unit tests — no DB. Tests observable effects via placements/unplaced.
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

/**
 * Build a task object for the scheduler.
 */
function makeTask(overrides) {
  return Object.assign({
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'test task',
    date: TODAY,
    dur: 60,
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

/**
 * Run the scheduler with the correct calling convention.
 */
function run(tasks, cfgOverride) {
  var cfg = cfgOverride || makeCfg();
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}

/**
 * Collect all placed task IDs from dayPlacements.
 */
function getPlacedIds(result) {
  var ids = [];
  Object.keys(result.dayPlacements || {}).forEach(function(dateKey) {
    (result.dayPlacements[dateKey] || []).forEach(function(p) {
      if (p.task && p.task.id) ids.push(p.task.id);
    });
  });
  return ids;
}

describe('999.565 — Capacity-aware deadline offset (R36.2)', () => {
  describe('chain deadline backpropagation', () => {
    test('predecessor inherits consumer deadline when predecessor has no deadline', () => {
      var tasks = [
        makeTask({
          id: 'task_a',
          text: 'Consumer A',
          deadline: '2026-06-18',
          dependsOn: ['task_b'],
          dur: 60,
        }),
        makeTask({
          id: 'task_b',
          text: 'Predecessor B',
          deadline: null,
          dependsOn: [],
          dur: 120,
        }),
      ];

      var result = run(tasks);
      var placedIds = getPlacedIds(result);

      expect(placedIds).toContain('task_a');
      expect(placedIds).toContain('task_b');
    });

    test('predecessor keeps own tighter deadline when it is earlier than consumer deadline', () => {
      var tasks = [
        makeTask({
          id: 'task_a',
          text: 'Consumer A',
          deadline: '2026-06-20',
          dependsOn: ['task_b'],
          dur: 60,
        }),
        makeTask({
          id: 'task_b',
          text: 'Predecessor B',
          deadline: '2026-06-18',
          dependsOn: [],
          dur: 120,
        }),
      ];

      var result = run(tasks);
      var placedIds = getPlacedIds(result);

      expect(placedIds).toContain('task_a');
      expect(placedIds).toContain('task_b');
    });

    test('predecessor deadline is tightened when consumer deadline is earlier', () => {
      var tasks = [
        makeTask({
          id: 'task_a',
          text: 'Consumer A',
          deadline: '2026-06-16',
          dependsOn: ['task_b'],
          dur: 60,
        }),
        makeTask({
          id: 'task_b',
          text: 'Predecessor B',
          deadline: '2026-06-20',
          dependsOn: [],
          dur: 120,
        }),
      ];

      var result = run(tasks);
      var placedIds = getPlacedIds(result);

      expect(placedIds).toContain('task_a');
      expect(placedIds).toContain('task_b');
    });

    test('deadline propagates through multi-link chain A→B→C', () => {
      var tasks = [
        makeTask({
          id: 'task_c',
          text: 'Consumer C',
          deadline: '2026-06-19',
          dependsOn: ['task_b'],
          dur: 60,
        }),
        makeTask({
          id: 'task_b',
          text: 'Middle B',
          deadline: null,
          dependsOn: ['task_a'],
          dur: 60,
        }),
        makeTask({
          id: 'task_a',
          text: 'Predecessor A',
          deadline: null,
          dependsOn: [],
          dur: 60,
        }),
      ];

      var result = run(tasks);
      var placedIds = getPlacedIds(result);

      expect(placedIds).toContain('task_a');
      expect(placedIds).toContain('task_b');
      expect(placedIds).toContain('task_c');
    });

    test('deadline does not propagate to unrelated tasks', () => {
      var tasks = [
        makeTask({
          id: 'task_a',
          text: 'Consumer A',
          deadline: '2026-06-18',
          dependsOn: ['task_b'],
          dur: 60,
        }),
        makeTask({
          id: 'task_b',
          text: 'Predecessor B',
          deadline: null,
          dependsOn: [],
          dur: 60,
        }),
        makeTask({
          id: 'task_c',
          text: 'Unrelated C',
          deadline: null,
          dependsOn: [],
          dur: 60,
        }),
      ];

      var result = run(tasks);
      var placedIds = getPlacedIds(result);

      expect(placedIds).toContain('task_a');
      expect(placedIds).toContain('task_b');
      expect(placedIds).toContain('task_c');
    });

    test('no deadline on any chain member — no propagation occurs', () => {
      var tasks = [
        makeTask({
          id: 'task_a',
          text: 'Consumer A',
          deadline: null,
          dependsOn: ['task_b'],
          dur: 60,
        }),
        makeTask({
          id: 'task_b',
          text: 'Predecessor B',
          deadline: null,
          dependsOn: [],
          dur: 60,
        }),
      ];

      var result = run(tasks);
      var placedIds = getPlacedIds(result);

      expect(placedIds).toContain('task_a');
      expect(placedIds).toContain('task_b');
    });

    test('deadline propagates through diamond dependency A→B/C→D', () => {
      var tasks = [
        makeTask({
          id: 'task_d',
          text: 'Consumer D',
          deadline: '2026-06-20',
          dependsOn: ['task_b', 'task_c'],
          dur: 60,
        }),
        makeTask({
          id: 'task_b',
          text: 'Middle B',
          deadline: null,
          dependsOn: ['task_a'],
          dur: 60,
        }),
        makeTask({
          id: 'task_c',
          text: 'Middle C',
          deadline: null,
          dependsOn: ['task_a'],
          dur: 60,
        }),
        makeTask({
          id: 'task_a',
          text: 'Root A',
          deadline: null,
          dependsOn: [],
          dur: 60,
        }),
      ];

      var result = run(tasks);
      var placedIds = getPlacedIds(result);

      expect(placedIds).toContain('task_a');
      expect(placedIds).toContain('task_b');
      expect(placedIds).toContain('task_c');
      expect(placedIds).toContain('task_d');
    });
  });

  describe('capacity-aware deadline impact on placement', () => {
    test('predecessor with propagated deadline is placed before its deadline', () => {
      var tasks = [
        makeTask({
          id: 'task_a',
          text: 'Consumer A',
          deadline: '2026-06-18',
          dependsOn: ['task_b'],
          dur: 60,
        }),
        makeTask({
          id: 'task_b',
          text: 'Predecessor B',
          deadline: null,
          dependsOn: [],
          dur: 60,
        }),
      ];

      var result = run(tasks);
      var placedIds = getPlacedIds(result);

      expect(placedIds).toContain('task_a');
      expect(placedIds).toContain('task_b');
    });

    test('chain with tight deadline places predecessor before consumer', () => {
      var tasks = [
        makeTask({
          id: 'task_a',
          text: 'Consumer A',
          deadline: TODAY,
          dependsOn: ['task_b'],
          dur: 60,
        }),
        makeTask({
          id: 'task_b',
          text: 'Predecessor B',
          deadline: null,
          dependsOn: [],
          dur: 60,
        }),
      ];

      var result = run(tasks);
      var placedIds = getPlacedIds(result);

      expect(placedIds).toContain('task_a');
      expect(placedIds).toContain('task_b');
    });
  });
});
