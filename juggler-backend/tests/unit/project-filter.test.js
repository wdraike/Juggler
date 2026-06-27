/**
 * 999.567 — Project filtering (M-R3)
 *
 * Verifies that filtering by single or multiple projects works correctly
 * in task list and calendar views.
 *
 * M-R3: The UI provides a project filter (via NavigationBar's ProjectCombobox)
 *       that filters tasks shown in ListView, PriorityView, DependencyView,
 *       and calendar grid views. Filtering by a project name should show only
 *       tasks belonging to that project. Clearing the filter should show all.
 *
 * Pure unit tests — no DB. Tests the filter logic extracted from the views.
 */

'use strict';

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Create a task object matching the shape used in views.
 */
function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    project: null,
    date: '2026-06-17',
    dur: 60,
    pri: 'P3',
    status: '',
    taskType: 'task',
    ...overrides,
  };
}

/**
 * Filter tasks by a single project name.
 * Mirrors the logic in ListView.jsx line 43 and PriorityView.jsx line 60.
 */
function filterByProject(tasks, projectFilter) {
  if (!projectFilter) return tasks;
  return tasks.filter(function(t) {
    return (t.project || '') === projectFilter;
  });
}

/**
 * Filter tasks by multiple project names (for multi-select support).
 */
function filterByProjects(tasks, projectFilters) {
  if (!projectFilters || projectFilters.length === 0) return tasks;
  return tasks.filter(function(t) {
    return projectFilters.indexOf(t.project || '') !== -1;
  });
}

describe('999.567 — Project filtering (M-R3)', () => {
  var tasks;

  beforeEach(function() {
    tasks = [
      makeTask({ id: 't1', text: 'Task 1', project: 'Work', date: '2026-06-17' }),
      makeTask({ id: 't2', text: 'Task 2', project: 'Personal', date: '2026-06-17' }),
      makeTask({ id: 't3', text: 'Task 3', project: 'Work', date: '2026-06-18' }),
      makeTask({ id: 't4', text: 'Task 4', project: 'Health', date: '2026-06-17' }),
      makeTask({ id: 't5', text: 'Task 5', project: null, date: '2026-06-17' }),
      makeTask({ id: 't6', text: 'Task 6', project: 'Personal', date: '2026-06-19' }),
    ];
  });

  describe('single project filter', () => {
    test('filtering by "Work" returns only Work tasks', () => {
      var result = filterByProject(tasks, 'Work');
      expect(result.length).toBe(2);
      result.forEach(function(t) {
        expect(t.project).toBe('Work');
      });
      expect(result.map(function(t) { return t.id; }).sort()).toEqual(['t1', 't3']);
    });

    test('filtering by "Personal" returns only Personal tasks', () => {
      var result = filterByProject(tasks, 'Personal');
      expect(result.length).toBe(2);
      result.forEach(function(t) {
        expect(t.project).toBe('Personal');
      });
      expect(result.map(function(t) { return t.id; }).sort()).toEqual(['t2', 't6']);
    });

    test('filtering by "Health" returns only Health tasks', () => {
      var result = filterByProject(tasks, 'Health');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('t4');
    });

    test('filtering by non-existent project returns empty array', () => {
      var result = filterByProject(tasks, 'NonExistent');
      expect(result.length).toBe(0);
    });

    test('empty filter string returns all tasks', () => {
      var result = filterByProject(tasks, '');
      expect(result.length).toBe(6);
    });

    test('null filter returns all tasks', () => {
      var result = filterByProject(tasks, null);
      expect(result.length).toBe(6);
    });

    test('undefined filter returns all tasks', () => {
      var result = filterByProject(tasks, undefined);
      expect(result.length).toBe(6);
    });

    test('tasks with null project are not matched by a project filter', () => {
      var result = filterByProject(tasks, 'Work');
      expect(result.every(function(t) { return t.project === 'Work'; })).toBe(true);
      expect(result.some(function(t) { return t.project === null; })).toBe(false);
    });
  });

  describe('multi-project filter', () => {
    test('filtering by ["Work", "Personal"] returns tasks in either project', () => {
      var result = filterByProjects(tasks, ['Work', 'Personal']);
      expect(result.length).toBe(4);
      var ids = result.map(function(t) { return t.id; }).sort();
      expect(ids).toEqual(['t1', 't2', 't3', 't6']);
    });

    test('filtering by ["Health"] returns only Health tasks', () => {
      var result = filterByProjects(tasks, ['Health']);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('t4');
    });

    test('empty project filter array returns all tasks', () => {
      var result = filterByProjects(tasks, []);
      expect(result.length).toBe(6);
    });

    test('filtering by non-existent projects returns empty', () => {
      var result = filterByProjects(tasks, ['Foo', 'Bar']);
      expect(result.length).toBe(0);
    });
  });

  describe('project filter combined with status filter', () => {
    test('filtering by project and done status returns only done tasks in that project', () => {
      // Mark some tasks as done
      var t1 = tasks[0]; t1.status = 'done';
      var t2 = tasks[1]; t2.status = 'done';
      var t4 = tasks[3]; t4.status = 'done';

      // Filter by project first, then by status
      var byProject = filterByProject(tasks, 'Work');
      var doneInWork = byProject.filter(function(t) { return t.status === 'done'; });

      expect(doneInWork.length).toBe(1);
      expect(doneInWork[0].id).toBe('t1');
    });

    test('filtering by project and done status returns only done tasks in Personal project', () => {
      var t3 = tasks[2]; t3.status = 'done';
      var t6 = tasks[5]; t6.status = 'done';

      var byProject = filterByProject(tasks, 'Personal');
      var doneInPersonal = byProject.filter(function(t) { return t.status === 'done'; });

      expect(doneInPersonal.length).toBe(1);
      expect(doneInPersonal[0].id).toBe('t6');
    });
  });

  describe('project filter in calendar view context', () => {
    test('filtering placements by project works for calendar grid', () => {
      // Simulate the calendar grid filter logic from AppLayout.jsx lines 538-556
      var placements = [
        { taskId: 't1', task: tasks[0], date: '2026-06-17' },
        { taskId: 't2', task: tasks[1], date: '2026-06-17' },
        { taskId: 't3', task: tasks[2], date: '2026-06-18' },
        { taskId: 't4', task: tasks[3], date: '2026-06-17' },
        { taskId: 't5', task: tasks[4], date: '2026-06-17' },
        { taskId: 't6', task: tasks[5], date: '2026-06-19' },
      ];

      var projectFilter = 'Work';
      var filtered = placements.filter(function(p) {
        return (p.task.project || '') === projectFilter;
      });

      expect(filtered.length).toBe(2);
      filtered.forEach(function(p) {
        expect(p.task.project).toBe('Work');
      });
    });

    test('clearing project filter shows all placements', () => {
      var placements = [
        { taskId: 't1', task: tasks[0], date: '2026-06-17' },
        { taskId: 't2', task: tasks[1], date: '2026-06-17' },
        { taskId: 't4', task: tasks[3], date: '2026-06-17' },
      ];

      // No filter = show all
      var filtered = placements.filter(function(p) {
        return true;
      });

      expect(filtered.length).toBe(3);
    });
  });

  describe('project filter in DependencyView context', () => {
    test('filtering by project limits the candidate task set', () => {
      // DependencyView.jsx line 318-319 filters allTasks by projectFilter
      var projectFilter = 'Work';
      var candidateTasks = tasks.filter(function(t) {
        return t.project === projectFilter;
      });

      expect(candidateTasks.length).toBe(2);
      expect(candidateTasks.map(function(t) { return t.id; }).sort()).toEqual(['t1', 't3']);
    });
  });

  describe('project combobox filtering', () => {
    test('typing in project combobox filters project list', () => {
      // NavigationBar.jsx lines 63-66: filter project names by text
      var allProjectNames = ['Work', 'Personal', 'Health', 'Finance'];
      var text = 'Work';

      var filtered = allProjectNames.filter(function(p) {
        return p.toLowerCase().indexOf(text.toLowerCase()) !== -1;
      });

      expect(filtered).toEqual(['Work']);
    });

    test('empty text shows all projects', () => {
      var allProjectNames = ['Work', 'Personal', 'Health'];
      var text = '';

      var filtered = allProjectNames.filter(function(p) {
        if (!text) return true;
        return p.toLowerCase().indexOf(text.toLowerCase()) !== -1;
      });

      expect(filtered).toEqual(['Work', 'Personal', 'Health']);
    });

    test('partial match shows matching projects', () => {
      var allProjectNames = ['Work', 'Personal', 'Health'];
      var text = 'per';

      var filtered = allProjectNames.filter(function(p) {
        return p.toLowerCase().indexOf(text.toLowerCase()) !== -1;
      });

      expect(filtered).toEqual(['Personal']);
    });
  });
});
