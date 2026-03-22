/**
 * Dependency Helpers Tests
 */

const { getTaskDeps, getDepsStatus, topoSortTasks, getDependents } = require('../../shared/scheduler/dependencyHelpers');

describe('getTaskDeps', () => {
  test('returns array from dependsOn array', () => {
    expect(getTaskDeps({ dependsOn: ['t1', 't2'] })).toEqual(['t1', 't2']);
  });

  test('wraps single string in array', () => {
    expect(getTaskDeps({ dependsOn: 't1' })).toEqual(['t1']);
  });

  test('returns empty for null', () => {
    expect(getTaskDeps({ dependsOn: null })).toEqual([]);
  });

  test('returns empty for undefined', () => {
    expect(getTaskDeps({})).toEqual([]);
  });

  test('returns empty for non-array non-string', () => {
    expect(getTaskDeps({ dependsOn: 42 })).toEqual([]);
  });
});

describe('getDepsStatus', () => {
  const tasks = [
    { id: 't1', text: 'A' },
    { id: 't2', text: 'B' },
    { id: 't3', text: 'C', dependsOn: ['t1', 't2'] }
  ];

  test('all deps done = satisfied', () => {
    const result = getDepsStatus(tasks[2], tasks, { t1: 'done', t2: 'done', t3: '' });
    expect(result.satisfied).toBe(true);
    expect(result.done).toEqual(['t1', 't2']);
    expect(result.pending).toEqual([]);
  });

  test('pending deps = not satisfied', () => {
    const result = getDepsStatus(tasks[2], tasks, { t1: 'done', t2: '', t3: '' });
    expect(result.satisfied).toBe(false);
    expect(result.pending).toEqual(['t2']);
    expect(result.done).toEqual(['t1']);
  });

  test('missing dep IDs tracked', () => {
    const taskWithMissing = { id: 't4', dependsOn: ['t1', 'nonexistent'] };
    const result = getDepsStatus(taskWithMissing, tasks, { t1: 'done' });
    expect(result.satisfied).toBe(false);
    expect(result.missing).toEqual(['nonexistent']);
  });

  test('no deps = satisfied', () => {
    const result = getDepsStatus(tasks[0], tasks, { t1: '' });
    expect(result.satisfied).toBe(true);
  });
});

describe('topoSortTasks', () => {
  test('linear chain sorted correctly', () => {
    const tasks = [
      { id: 'c', dependsOn: ['b'] },
      { id: 'a' },
      { id: 'b', dependsOn: ['a'] }
    ];
    const sorted = topoSortTasks(tasks);
    const ids = sorted.map(t => t.id);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
  });

  test('handles cycles without infinite loop', () => {
    const tasks = [
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] }
    ];
    // Should not hang — returns some result
    const sorted = topoSortTasks(tasks);
    expect(sorted).toHaveLength(2);
  });

  test('independent tasks returned in original order', () => {
    const tasks = [
      { id: 'z' },
      { id: 'a' },
      { id: 'm' }
    ];
    const sorted = topoSortTasks(tasks);
    expect(sorted.map(t => t.id)).toEqual(['z', 'a', 'm']);
  });
});

describe('getDependents', () => {
  test('finds all tasks depending on given ID', () => {
    const tasks = [
      { id: 't1' },
      { id: 't2', dependsOn: ['t1'] },
      { id: 't3', dependsOn: ['t1'] },
      { id: 't4', dependsOn: ['t2'] }
    ];
    const deps = getDependents('t1', tasks);
    expect(deps.map(t => t.id)).toEqual(['t2', 't3']);
  });

  test('returns empty when no dependents', () => {
    const tasks = [
      { id: 't1' },
      { id: 't2' }
    ];
    expect(getDependents('t1', tasks)).toEqual([]);
  });
});
