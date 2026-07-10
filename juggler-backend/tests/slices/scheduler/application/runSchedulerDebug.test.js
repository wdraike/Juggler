/**
 * RunSchedulerDebug — use-case unit tests against injected fakes (999.1196).
 * No DB needed — loadTasks/loadConfig/rowToTask/unifiedSchedule are all
 * plain injected functions, mirroring the extraction from
 * schedule.routes.js POST /debug.
 */

'use strict';

const RunSchedulerDebug =
  require('../../../../src/slices/scheduler/application/RunSchedulerDebug');

function makeUseCase(overrides) {
  const deps = Object.assign({
    loadTasks: jest.fn(async () => []),
    loadConfig: jest.fn(async () => ({})),
    rowToTask: jest.fn((row) => ({ id: row.id, text: row.text })),
    unifiedSchedule: jest.fn(() => ({
      placedCount: 0, unplaced: [], score: {}, warnings: [], phaseSnapshots: []
    })),
  }, overrides);
  return { useCase: new RunSchedulerDebug(deps), deps };
}

describe('RunSchedulerDebug', () => {
  test('loads tasks, stamps timezone + _debug:true on config, and returns the shaped body', async () => {
    const tasks = [
      { id: 't1', text: 'Task 1', status: '', task_type: 'task' },
      { id: 't2', text: 'Task 2', status: 'wip', task_type: 'task' },
    ];
    const loadConfig = jest.fn(async () => ({ timeBlocks: 'x' }));
    const unifiedSchedule = jest.fn(() => ({
      placedCount: 2, unplaced: [], score: { total: 5 }, warnings: ['w1'], phaseSnapshots: [{ step: 1 }]
    }));
    const { useCase } = makeUseCase({
      loadTasks: jest.fn(async () => tasks),
      loadConfig,
      unifiedSchedule,
    });

    const result = await useCase.execute({
      userId: 'u1', timezone: 'America/New_York', todayKey: '2026-07-10', nowMins: 600
    });

    // config gets mutated with timezone + _debug (verbatim legacy behavior)
    expect(loadConfig).toHaveBeenCalledWith('u1');
    expect(unifiedSchedule).toHaveBeenCalled();
    const cfgArg = unifiedSchedule.mock.calls[0][4];
    expect(cfgArg.timezone).toBe('America/New_York');
    expect(cfgArg._debug).toBe(true);

    expect(result).toEqual({
      success: true,
      todayKey: '2026-07-10',
      nowMins: 600,
      timezone: 'America/New_York',
      taskCount: 2,
      placedCount: 2,
      unplacedCount: 0,
      score: { total: 5 },
      warnings: ['w1'],
      phaseSnapshots: [{ step: 1 }],
    });
  });

  test('builds statuses map + srcMap (recurring_template / non-generated-recur rows) and maps every task via rowToTask', async () => {
    const tasks = [
      { id: 'tmpl-1', text: 'Recurring template', status: null, task_type: 'recurring_template' },
      { id: 'gen-1', text: 'Generated instance', status: '', task_type: 'task', generated: 1, recur: '{}' },
      { id: 'manual-1', text: 'Manual recur source', status: 'wip', task_type: 'task', generated: 0, recur: '{}' },
      { id: 'plain-1', text: 'Plain task', status: '', task_type: 'task' },
    ];
    const rowToTask = jest.fn((row, tz, srcMap) => ({ id: row.id, srcMapHasId: !!srcMap[row.id] }));
    const { useCase } = makeUseCase({ loadTasks: jest.fn(async () => tasks), rowToTask });

    await useCase.execute({ userId: 'u1', timezone: 'UTC', todayKey: '2026-07-10', nowMins: 0 });

    expect(rowToTask).toHaveBeenCalledTimes(4);
    // srcMap should include the recurring_template row and the manual (non-generated) recur row,
    // but NOT the generated instance or the plain task.
    const calls = rowToTask.mock.calls;
    const srcMapArgFor = (id) => calls.find((c) => c[0].id === id)[2];
    expect(srcMapArgFor('tmpl-1')['tmpl-1']).toBeDefined();
    expect(srcMapArgFor('manual-1')['manual-1']).toBeDefined();
    expect(srcMapArgFor('gen-1')['gen-1']).toBeUndefined();
    expect(srcMapArgFor('plain-1')['plain-1']).toBeUndefined();
  });

  test('taskCount / unplacedCount reflect unifiedSchedule result, not the raw load count', async () => {
    const tasks = [{ id: 't1', text: 'T1' }, { id: 't2', text: 'T2' }];
    const unifiedSchedule = jest.fn(() => ({
      placedCount: 1, unplaced: [{ id: 't2' }], score: {}, warnings: [], phaseSnapshots: []
    }));
    const { useCase } = makeUseCase({ loadTasks: jest.fn(async () => tasks), unifiedSchedule });

    const result = await useCase.execute({ userId: 'u1', timezone: 'UTC', todayKey: '2026-07-10', nowMins: 0 });

    expect(result.taskCount).toBe(2);
    expect(result.placedCount).toBe(1);
    expect(result.unplacedCount).toBe(1);
  });
});
