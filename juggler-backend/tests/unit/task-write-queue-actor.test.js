'use strict';

/**
 * 999.1576 inc.2b — the task_write_queue actor carrier. Queued writes are
 * applied later by the flusher under the 'scheduler' context, so the
 * ORIGINATOR must ride the queue row: enqueueWrite captures the ambient
 * audit-context actor into the row's own created_by/updated_by columns.
 * (Soft capture until the inc.4 tightening: outside any context the columns
 * stay NULL and the flusher attributes the honest 'unknown-backfill'.)
 */

jest.mock('../../src/db', () => {
  const inserts = [];
  const dbFn = (table) => ({
    insert: (row) => {
      inserts.push({ table, row });
      return Promise.resolve([1]);
    },
  });
  dbFn.__inserts = inserts;
  return dbFn;
});

const db = require('../../src/db');
const { runWithActor } = require('../../src/lib/audit-context');
const { enqueueWrite } = require('../../src/lib/task-write-queue');

beforeEach(() => {
  db.__inserts.length = 0;
});

test('enqueueWrite carries the ambient actor into the queue row', async () => {
  await runWithActor('user-9', () =>
    enqueueWrite('user-9', 'task-1', 'update', { pri: 'P1' }, 'http')
  );
  expect(db.__inserts).toHaveLength(1);
  const { table, row } = db.__inserts[0];
  expect(table).toBe('task_write_queue');
  expect(row.created_by).toBe('user-9');
  expect(row.updated_by).toBe('user-9');
});

test('system identities ride the row the same way', async () => {
  await runWithActor('cal-sync', () =>
    enqueueWrite('user-9', 'task-2', 'update', { status: 'done' }, 'cal-sync')
  );
  expect(db.__inserts[0].row.created_by).toBe('cal-sync');
});

test('outside any context the carrier stays NULL (soft until inc.4 tightening)', async () => {
  await enqueueWrite('user-9', 'task-3', 'delete', {}, 'test');
  expect(db.__inserts[0].row.created_by).toBeNull();
  expect(db.__inserts[0].row.updated_by).toBeNull();
});
