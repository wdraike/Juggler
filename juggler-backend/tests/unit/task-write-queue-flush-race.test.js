'use strict';

/**
 * 999.15791 — Race condition: the fire-and-forget enqueueScheduleRun('write-queue-flush')
 * inside _doFlush can complete AFTER dequeueScheduleRun deletes the schedule_queue row,
 * leaving a new row that the poll loop re-runs the scheduler on.
 *
 * RED test: verifies that _doFlush AWAITS enqueueScheduleRun before returning.
 * If the call is fire-and-forget (not awaited), _doFlush resolves before the
 * upsert completes, and a subsequent dequeue can race past it.
 */

jest.mock('../../src/db', () => {
  const state = { entries: [], applied: [], deletedEntryIds: null };
  const makeBuilder = (table) => {
    const b = {
      _table: table,
      where: jest.fn(() => b),
      orderBy: jest.fn(() => b),
      select: jest.fn(() => Promise.resolve(table === 'task_write_queue' ? state.entries : [])),
      first: jest.fn(() => Promise.resolve(undefined)),
      whereIn: jest.fn((col, ids) => {
        state.deletedEntryIds = ids;
        return b;
      }),
      del: jest.fn(() => Promise.resolve(state.deletedEntryIds ? state.deletedEntryIds.length : 0)),
    };
    return b;
  };
  const dbFn = (table) => makeBuilder(table);
  dbFn.transaction = jest.fn(async (cb) => {
    const trx = (table) => makeBuilder(table);
    return cb(trx);
  });
  dbFn.fn = { now: () => 'DB_NOW' };
  dbFn.__state = state;
  return dbFn;
});

jest.mock('../../src/lib/task-repository-trigger', () => {
  const db = require('../../src/db');
  class FakeRepo {
    constructor() {
      this.tasksWrite = {
        insertTask: jest.fn(async () => { db.__state.applied.push({ op: 'create' }); }),
        updateTaskById: jest.fn(async (trx, taskId) => { db.__state.applied.push({ op: 'update', taskId }); }),
        deleteTaskById: jest.fn(async (trx, taskId) => { db.__state.applied.push({ op: 'delete', taskId }); }),
        deleteInstancesWhere: jest.fn(async () => {}),
      };
    }
  }
  return { getKnexTaskRepository: () => FakeRepo };
});

// Deferred-promise mock: the test controls when enqueueScheduleRun resolves.
// Variables prefixed with `mock` are allowed in jest.mock factories.
var mockEnqueueDeferred = null;
jest.mock('../../src/scheduler/scheduleTrigger', () => ({
  enqueueScheduleRun: jest.fn(() => new Promise(function (resolve) {
    mockEnqueueDeferred = resolve;
  })),
}));

jest.mock('../../src/lib/task-instances', () => ({ expandToAllInstanceIds: jest.fn(async (db, u, ids) => ids) }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));
jest.mock('../../src/lib/redis', () => ({ invalidateTasks: jest.fn(() => Promise.resolve()) }));

var db = require('../../src/db');
var { runWithActor } = require('../../src/lib/audit-context');
var { flushQueueInLock } = require('../../src/lib/task-write-queue');
var scheduleTrigger = require('../../src/scheduler/scheduleTrigger');

beforeEach(() => {
  db.__state.entries = [];
  db.__state.applied = [];
  db.__state.deletedEntryIds = null;
  mockEnqueueDeferred = null;
  scheduleTrigger.enqueueScheduleRun.mockClear();
});

test('_doFlush awaits enqueueScheduleRun before resolving — no fire-and-forget race', async () => {
  db.__state.entries = [
    { id: 1, task_id: 't-1', operation: 'update', fields: '{"pri":"P1"}', source: 'http', created_by: 'user-9' },
  ];

  var flushPromise = runWithActor('scheduler', () => flushQueueInLock('user-9'));

  // Give the flush a tick to reach the enqueueScheduleRun call.
  await new Promise(function (r) { setTimeout(r, 10); });

  // enqueueScheduleRun was called (the flush reached the post-transaction section)
  expect(scheduleTrigger.enqueueScheduleRun).toHaveBeenCalledTimes(1);

  // The flush promise should NOT have resolved yet — enqueueScheduleRun is still pending
  var resolved = false;
  flushPromise.then(function () { resolved = true; });
  // Flush the microtask queue
  await new Promise(function (r) { setTimeout(r, 5); });
  expect(resolved).toBe(false);

  // Now resolve the deferred enqueueScheduleRun — the flush should complete
  mockEnqueueDeferred();
  await flushPromise;
  expect(resolved).toBe(true);
});
