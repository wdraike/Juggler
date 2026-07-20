'use strict';

/**
 * 999.1576 inc.4 — flush-side attribution (harrison inc.2b INFO-4).
 *
 * The flusher applies queued USER edits under the scheduler's claimAndRun
 * context; each row must be applied under runWithActor(row.created_by) so the
 * ORIGINATOR — not 'scheduler' — lands in the audit columns. Strict since
 * inc.4: an entry with no carrier actor aborts the flush (fail-loud) — the
 * NOT NULL migration backfilled the soft-era rows, so a NULL carrier can only
 * mean a bug.
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
  const { peekActor } = require('../../src/lib/audit-context');
  const db = require('../../src/db');
  class FakeRepo {
    constructor() {
      this.tasksWrite = {
        insertTask: jest.fn(async () => {
          db.__state.applied.push({ op: 'create', actor: peekActor() });
        }),
        updateTaskById: jest.fn(async (trx, taskId) => {
          db.__state.applied.push({ op: 'update', taskId, actor: peekActor() });
        }),
        deleteTaskById: jest.fn(async (trx, taskId) => {
          db.__state.applied.push({ op: 'delete', taskId, actor: peekActor() });
        }),
        deleteInstancesWhere: jest.fn(async () => {}),
      };
    }
  }
  return { getKnexTaskRepository: () => FakeRepo };
});

jest.mock('../../src/scheduler/scheduleTrigger', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/task-instances', () => ({ expandToAllInstanceIds: jest.fn(async (db, u, ids) => ids) }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));
jest.mock('../../src/lib/redis', () => ({ invalidateTasks: jest.fn(() => Promise.resolve()) }));

const db = require('../../src/db');
const { runWithActor } = require('../../src/lib/audit-context');
const { flushQueueInLock } = require('../../src/lib/task-write-queue');

beforeEach(() => {
  db.__state.entries = [];
  db.__state.applied = [];
  db.__state.deletedEntryIds = null;
});

test('each queued write is applied under its ORIGINATOR, not the scheduler flush context', async () => {
  db.__state.entries = [
    { id: 1, task_id: 't-1', operation: 'update', fields: '{"pri":"P1"}', source: 'http', created_by: 'user-9' },
    { id: 2, task_id: 't-2', operation: 'update', fields: '{"status":"done"}', source: 'cal-sync', created_by: 'cal-sync' },
  ];
  await runWithActor('scheduler', () => flushQueueInLock('user-9'));

  expect(db.__state.applied).toEqual([
    { op: 'update', taskId: 't-1', actor: 'user-9' },
    { op: 'update', taskId: 't-2', actor: 'cal-sync' },
  ]);
  expect(db.__state.deletedEntryIds).toEqual([1, 2]);
});

test('last contributing entry wins attribution for a coalesced task', async () => {
  db.__state.entries = [
    { id: 1, task_id: 't-1', operation: 'update', fields: '{"pri":"P1"}', source: 'http', created_by: 'user-9' },
    { id: 2, task_id: 't-1', operation: 'update', fields: '{"pri":"P2"}', source: 'mcp', created_by: 'mcp' },
  ];
  await runWithActor('scheduler', () => flushQueueInLock('user-9'));

  expect(db.__state.applied).toEqual([{ op: 'update', taskId: 't-1', actor: 'mcp' }]);
});

test('STRICT: an entry with no carrier actor aborts the flush — nothing applied', async () => {
  db.__state.entries = [
    { id: 1, task_id: 't-1', operation: 'update', fields: '{"pri":"P1"}', source: 'http', created_by: null },
  ];
  await expect(
    runWithActor('scheduler', () => flushQueueInLock('user-9'))
  ).rejects.toThrow(/no actor|carrier/i);
  expect(db.__state.applied).toEqual([]);
});
