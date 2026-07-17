/**
 * useDerivedTaskData — basic self-check (999.965)
 * Verifies the extracted hook produces correct derived data from inputs.
 */
import { renderHook } from '@testing-library/react';
import useDerivedTaskData from '../useDerivedTaskData';

var PLACEMENTS = {
  dayPlacements: { '2026-07-17': [{ task: { id: 't1', text: 'Task 1' }, start: 600 }] },
  unplaced: [{ id: 't2', text: 'Unplaced task' }],
  warnings: []
};

var ALL_TASKS = [
  { id: 't1', text: 'Task 1', date: '2026-07-17', time: '10:00 AM', dur: 30 },
  { id: 't2', text: 'Unplaced task' },
  { id: 't3', text: 'Done task', date: '2026-07-17', status: 'done' },
  { id: 'tmpl1', text: 'Template', taskType: 'recurring_template' },
  { id: 't4', text: 'Backlog task' },
];

var STATUSES = { t1: '', t2: '', t3: 'done', tmpl1: '', t4: '' };

describe('useDerivedTaskData', function() {
  it('filters out recurring templates and disabled from visibleTasks', function() {
    var { result } = renderHook(function() {
      return useDerivedTaskData(ALL_TASKS, STATUSES, PLACEMENTS, 'UTC', null, new Date('2026-07-17T12:00:00Z'), '', '');
    });
    var ids = result.current.visibleTasks.map(function(t) { return t.id; });
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
    expect(ids).not.toContain('tmpl1');
  });

  it('filters phantom unplaced entries', function() {
    var placementsWithPhantom = {
      dayPlacements: {},
      unplaced: [
        { id: 't2', text: 'Real unplaced' },
        { id: 'phantom', text: '' },
        { id: 'tmpl1', text: 'Template', taskType: 'recurring_template' },
      ],
      warnings: []
    };
    var { result } = renderHook(function() {
      return useDerivedTaskData(ALL_TASKS, STATUSES, placementsWithPhantom, 'UTC', null, new Date('2026-07-17T12:00:00Z'), '', '');
    });
    var unplacedIds = result.current.unplaced.map(function(t) { return t.id; });
    expect(unplacedIds).toContain('t2');
    expect(unplacedIds).not.toContain('phantom');
    expect(unplacedIds).not.toContain('tmpl1');
  });

  it('computes tasksByDate correctly', function() {
    var { result } = renderHook(function() {
      return useDerivedTaskData(ALL_TASKS, STATUSES, PLACEMENTS, 'UTC', null, new Date('2026-07-17T12:00:00Z'), '', '');
    });
    expect(result.current.tasksByDate['2026-07-17']).toBeDefined();
    expect(result.current.tasksByDate['2026-07-17'].length).toBe(2); // t1 + t3 (done but still in allTasks)
    expect(result.current.tasksByDate.TBD).toBeDefined();
  });

  it('computes backlogTasks: undated active tasks not in unplaced', function() {
    var { result } = renderHook(function() {
      return useDerivedTaskData(ALL_TASKS, STATUSES, PLACEMENTS, 'UTC', null, new Date('2026-07-17T12:00:00Z'), '', '');
    });
    var backlogIds = result.current.backlogTasks.map(function(t) { return t.id; });
    expect(backlogIds).toContain('t4');
    expect(backlogIds).not.toContain('t2');
  });

  it('counts are consistent with derived sets', function() {
    var { result } = renderHook(function() {
      return useDerivedTaskData(ALL_TASKS, STATUSES, PLACEMENTS, 'UTC', null, new Date('2026-07-17T12:00:00Z'), '', '');
    });
    expect(result.current.unplacedCount).toBe(result.current.unplaced.length);
  });
});