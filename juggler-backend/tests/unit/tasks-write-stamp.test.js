'use strict';

/**
 * 999.1576 inc.3a — who-attribution stamping at the tasks-write boundary.
 * Every insert carries created_by+updated_by from the ambient actor; every
 * update carries updated_by routed to BOTH tables; caller-provided values win
 * (import/backfill attribution survives); bookkeeping-only change-sets do not
 * flip the "no real change" bail-outs.
 */

const { runWithActor } = require('../../src/lib/audit-context');
const tasksWrite = require('../../src/lib/tasks-write');

// Capturing fake knex: db(table) returns a chainable recording builder.
function fakeDb() {
  const ops = [];
  const dbFn = (table) => {
    const ctx = { table, wheres: [] };
    const builder = {
      where(w) { ctx.wheres.push(w); return builder; },
      whereIn() { return builder; },
      max() { return builder; },
      groupBy() { return builder; },
      select() { return builder; },
      first() { return Promise.resolve(null); },
      insert(row) { ops.push({ table, kind: 'insert', row }); return Promise.resolve([1]); },
      update(changes) { ops.push({ table, kind: 'update', changes }); return Promise.resolve(1); },
      del() { ops.push({ table, kind: 'del' }); return Promise.resolve(1); },
    };
    return builder;
  };
  dbFn.fn = { now: () => 'NOW()' };
  dbFn.__ops = ops;
  return dbFn;
}

test('insertTask stamps both who-columns on master and instance rows', async () => {
  const db = fakeDb();
  await runWithActor('user-42', () =>
    tasksWrite.insertTask(db, { id: 't1', user_id: 'user-42', text: 'x' })
  );
  const inserts = db.__ops.filter((o) => o.kind === 'insert');
  expect(inserts.map((o) => o.table).sort()).toEqual(['task_instances', 'task_masters']);
  inserts.forEach((o) => {
    expect(o.row.created_by).toBe('user-42');
    expect(o.row.updated_by).toBe('user-42');
  });
});

test('caller-provided attribution wins (import/backfill path)', async () => {
  const db = fakeDb();
  await runWithActor('migration-backfill', () =>
    tasksWrite.insertTask(db, {
      id: 't2',
      user_id: 'u',
      text: 'restored',
      created_by: 'original-user',
    })
  );
  const master = db.__ops.find((o) => o.table === 'task_masters');
  expect(master.row.created_by).toBe('original-user'); // preserved
  expect(master.row.updated_by).toBe('migration-backfill'); // absent -> stamped
});

test('updateTaskById routes updated_by to BOTH tables', async () => {
  const db = fakeDb();
  await runWithActor('mcp', () =>
    tasksWrite.updateTaskById(db, 't1', { text: 'renamed', status: 'wip' }, 'u')
  );
  const updates = db.__ops.filter((o) => o.kind === 'update');
  expect(updates).toHaveLength(2);
  updates.forEach((o) => expect(o.changes.updated_by).toBe('mcp'));
});

test('softCancel stamps updated_by', async () => {
  const db = fakeDb();
  await runWithActor('scheduler', () => tasksWrite.softCancelById(db, 't1', 'u'));
  const updates = db.__ops.filter((o) => o.kind === 'update');
  expect(updates.length).toBeGreaterThan(0);
  updates.forEach((o) => {
    expect(o.changes.status).toBe('cancelled');
    expect(o.changes.updated_by).toBe('scheduler');
  });
});

test('no ambient context: row passes through unstamped (honest NULL until inc.4)', async () => {
  const db = fakeDb();
  await tasksWrite.insertTask(db, { id: 't9', user_id: 'u', text: 'x' });
  const master = db.__ops.find((o) => o.table === 'task_masters');
  expect(master.row.created_by).toBeUndefined();
  expect(master.row.updated_by).toBeUndefined();
});

test('empty change-set stays a no-op even with an ambient actor (harrison)', async () => {
  const db = fakeDb();
  await runWithActor('user-1', () => tasksWrite.updateTaskById(db, 't1', {}, 'u'));
  expect(db.__ops).toHaveLength(0);
});

test('updated_by alone does not flip the no-real-change bail-outs', async () => {
  const db = fakeDb();
  // Scheduler-persist shape: only updated_at bookkeeping on the master side.
  await runWithActor('scheduler', () =>
    tasksWrite.updateTasksWhere(db, 'u', (q) => q, { updated_at: 'NOW()' })
  );
  // No real field changed anywhere -> no update op at all.
  expect(db.__ops.filter((o) => o.kind === 'update')).toHaveLength(0);
});
