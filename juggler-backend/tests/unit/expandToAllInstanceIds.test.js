/**
 * Unit tests for expandToAllInstanceIds — exported from task.controller.js.
 *
 * Source: src/controllers/task.controller.js lines 75–101.
 *
 * The function issues three sequential DB queries:
 *   1. db('task_masters').where(userId).whereIn(ids).where('recurring', 1).select('id')
 *      → returns master rows for ids that are template masters
 *   2. db('task_instances').where(userId).whereIn(ids).select('id', 'master_id')
 *      → returns instance rows for ids that are instances (to discover their master_id)
 *   3. db('task_instances').where(userId).whereIn(master_id list).select('id')
 *      → returns all sibling instances of every discovered master
 *
 * Mock strategy: because the three calls go to different tables with different
 * shapes, we use a queue-based mock (resolveQueue). Each call to
 * db('task_masters').where(...).whereIn(...).where(...).select() pops the first
 * entry; subsequent calls pop the next.
 */

// We cannot use jest.mock('../../src/db', factory) at require-time for this test
// because the factory value must already be the full mock object before
// task.controller is required. We set up a chainable resolveQueue mock here.

let resolveQueue = [];

const makeChain = () => {
  const chain = {};
  chain.where    = jest.fn(() => chain);
  chain.whereIn  = jest.fn(() => chain);
  chain.select   = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []));
  return chain;
};

// Name must start with 'mock' so Jest's variable-hoisting check allows
// referencing it inside the jest.mock() factory below.
const mockDbInstance = jest.fn((table) => makeChain());  // eslint-disable-line no-unused-vars
mockDbInstance.fn = { now: () => 'MOCK_NOW' };

jest.mock('../../src/db', () => mockDbInstance);

// Stub side-effect modules so the require doesn't crash.
jest.mock('../../src/lib/redis', () => ({
  invalidateTasks: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
}));
jest.mock('../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn().mockReturnValue(false),
  enqueueWrite: jest.fn(),
  splitFields: jest.fn(() => ({ schedulingFields: {}, nonSchedulingFields: {} })),
  flushQueue: jest.fn(),
}));
jest.mock('../../src/lib/tasks-write', () => ({
  updateTaskById: jest.fn().mockResolvedValue(undefined),
}));

const { expandToAllInstanceIds } = require('../../src/controllers/task.controller');

beforeEach(() => {
  resolveQueue = [];
  mockDbInstance.mockClear();
});

describe('expandToAllInstanceIds', () => {
  // ── Empty input ──────────────────────────────────────────────────────────
  test('returns [] for empty input array', async () => {
    const result = await expandToAllInstanceIds('u1', []);
    expect(result).toEqual([]);
  });

  // ── Non-recurring task: no expansion ────────────────────────────────────
  test('returns input ids unchanged when task is not a recurring master or instance', async () => {
    // Query 1: task_masters — task-a is not a recurring master → []
    resolveQueue.push([]);
    // Query 2: task_instances — task-a is not an instance → []
    resolveQueue.push([]);
    // No master IDs found → no Query 3 → returns original ids.
    const result = await expandToAllInstanceIds('u1', ['task-a']);
    expect(result).toEqual(['task-a']);
  });

  // ── Recurring template: expands to sibling instances ────────────────────
  test('expands a recurring template id to include all its instance ids', async () => {
    // Query 1: task_masters — 'tmpl-1' is a recurring master
    resolveQueue.push([{ id: 'tmpl-1' }]);
    // Query 2: task_instances — 'tmpl-1' is not in task_instances → no extra master_ids
    resolveQueue.push([]);
    // Query 3: siblings for master 'tmpl-1'
    resolveQueue.push([{ id: 'inst-a' }, { id: 'inst-b' }]);

    const result = await expandToAllInstanceIds('u1', ['tmpl-1']);
    // Output must include the template id AND both instance ids (deduped).
    expect(result).toContain('tmpl-1');
    expect(result).toContain('inst-a');
    expect(result).toContain('inst-b');
    expect(result.length).toBe(3);
  });

  // ── Recurring instance: discovers master and expands to siblings ─────────
  test('expands a recurring instance id by discovering its master', async () => {
    // Query 1: task_masters — 'inst-x' is not a master → []
    resolveQueue.push([]);
    // Query 2: task_instances — 'inst-x' is an instance with master_id 'tmpl-2'
    resolveQueue.push([{ id: 'inst-x', master_id: 'tmpl-2' }]);
    // Query 3: siblings for master 'tmpl-2'
    resolveQueue.push([{ id: 'inst-x' }, { id: 'inst-y' }]);

    const result = await expandToAllInstanceIds('u1', ['inst-x']);
    // Output includes the original id, the master, and all siblings.
    expect(result).toContain('inst-x');
    expect(result).toContain('tmpl-2');
    expect(result).toContain('inst-y');
  });

  // ── Deduplication: overlapping ids are deduped ───────────────────────────
  test('deduplicates ids when input contains both master and instance of the same template', async () => {
    // Input: ['tmpl-3', 'inst-c'] where inst-c belongs to tmpl-3
    // Query 1: task_masters — 'tmpl-3' is a master
    resolveQueue.push([{ id: 'tmpl-3' }]);
    // Query 2: task_instances — 'inst-c' is an instance of 'tmpl-3'
    resolveQueue.push([{ id: 'inst-c', master_id: 'tmpl-3' }]);
    // Query 3: siblings for master 'tmpl-3' (includes inst-c again)
    resolveQueue.push([{ id: 'inst-c' }, { id: 'inst-d' }]);

    const result = await expandToAllInstanceIds('u1', ['tmpl-3', 'inst-c']);
    // 'inst-c' appears in input, in siblings — must appear only once.
    const instCCount = result.filter((id) => id === 'inst-c').length;
    expect(instCCount).toBe(1);
    expect(result).toContain('tmpl-3');
    expect(result).toContain('inst-d');
    // No duplicates anywhere.
    expect(result.length).toBe(new Set(result).size);
  });
});
