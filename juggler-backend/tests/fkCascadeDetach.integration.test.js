/**
 * End-to-end test for the FK ON DELETE SET NULL behavior introduced in
 * migration 20260415010700. When a recurring template is deleted:
 *   - pending instances should be explicitly removed by the application
 *     (cascade-delete-recurring path in task.controller deleteTask)
 *   - completed instances (status in {done, cancel, skip}) should remain
 *     with master_id = NULL (detached but preserved as history)
 */
var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var { insertTask, deleteTaskById, deleteInstancesWhere } = require('../src/lib/tasks-write');

var available = false;
var USER_ID = 'fk-cascade-test-user';

beforeAll(async () => {
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message); return;
  }
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID, email: 'fkcascade@test.com', name: 'FK Cascade Test',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  });
}, 15000);

afterAll(async () => {
  if (available) {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
});

describe('FK ON DELETE SET NULL on task_instances.master_id', () => {
  test('deleting master with mixed-status instances: pending must be explicitly deleted; completed survive detached', async () => {
    if (!available) return;
    var tid = uuidv7();
    await insertTask(db, {
      id: tid, user_id: USER_ID, text: 'cascade-test',
      task_type: 'recurring_template', recurring: 1, dur: 30, pri: 'P3',
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var pending1 = uuidv7(), pending2 = uuidv7(), done1 = uuidv7(), cancel1 = uuidv7();
    var base = {
      user_id: USER_ID, task_type: 'recurring_instance', source_id: tid,
      recurring: 1, dur: 30, pri: 'P3',
      created_at: db.fn.now(), updated_at: db.fn.now()
    };
    await insertTask(db, Object.assign({}, base, { id: pending1, status: '', scheduled_at: new Date('2026-07-01T10:00:00Z') }));
    await insertTask(db, Object.assign({}, base, { id: pending2, status: '', scheduled_at: new Date('2026-07-02T10:00:00Z') }));
    await insertTask(db, Object.assign({}, base, { id: done1, status: 'done', scheduled_at: new Date('2026-06-29T10:00:00Z') }));
    await insertTask(db, Object.assign({}, base, { id: cancel1, status: 'cancel', scheduled_at: new Date('2026-06-30T10:00:00Z') }));

    // Mirror what task.controller.deleteTask cascade='recurring' does:
    // explicitly delete pending, then delete the master (FK SET NULL detaches done/cancel/skip).
    await db.transaction(async function(trx) {
      await deleteInstancesWhere(trx, USER_ID, function(q) {
        return q.where('master_id', tid).whereIn('status', ['']);
      });
      await deleteTaskById(trx, tid, USER_ID);
    });

    expect(await db('task_masters').where('id', tid).first()).toBeUndefined();
    expect(await db('task_instances').where('id', pending1).first()).toBeUndefined();
    expect(await db('task_instances').where('id', pending2).first()).toBeUndefined();

    var doneRow = await db('task_instances').where('id', done1).first();
    var cancelRow = await db('task_instances').where('id', cancel1).first();
    expect(doneRow).toBeTruthy();
    expect(doneRow.master_id).toBeNull();
    expect(doneRow.status).toBe('done');
    expect(cancelRow).toBeTruthy();
    expect(cancelRow.master_id).toBeNull();
    expect(cancelRow.status).toBe('cancel');
  });

  test('detached row appears in tasks_v with task_type=task and master fields NULL', async () => {
    if (!available) return;
    var tid = uuidv7();
    await insertTask(db, {
      id: tid, user_id: USER_ID, text: 'will-orphan',
      task_type: 'recurring_template', recurring: 1, dur: 30, pri: 'P3',
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var doneId = uuidv7();
    await insertTask(db, {
      id: doneId, user_id: USER_ID, task_type: 'recurring_instance',
      source_id: tid, recurring: 1, dur: 30, pri: 'P3', status: 'done',
      scheduled_at: new Date('2026-07-05T10:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await deleteTaskById(db, tid, USER_ID);

    var inst = await db('task_instances').where('id', doneId).first();
    expect(inst.master_id).toBeNull();

    var view = await db('tasks_v').where('id', doneId).first();
    expect(view).toBeTruthy();
    expect(view.task_type).toBe('task');     // m.id IS NULL fallback
    expect(view.text).toBeNull();             // master gone
    expect(view.recurring).toBeNull();
  });

  test('archival master: completed instances re-parented to __archived__:<userId> with new ordinals', async () => {
    if (!available) return;
    var tw = require('../src/lib/tasks-write');
    var tid = uuidv7();
    await insertTask(db, {
      id: tid, user_id: USER_ID, text: 'soon-to-archive',
      task_type: 'recurring_template', recurring: 1, dur: 30, pri: 'P3',
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var doneA = uuidv7(), doneB = uuidv7();
    var base = {
      user_id: USER_ID, task_type: 'recurring_instance', source_id: tid,
      recurring: 1, dur: 30, pri: 'P3',
      created_at: db.fn.now(), updated_at: db.fn.now()
    };
    await insertTask(db, Object.assign({}, base, { id: doneA, status: 'done', scheduled_at: new Date('2026-08-01T10:00:00Z') }));
    await insertTask(db, Object.assign({}, base, { id: doneB, status: 'done', scheduled_at: new Date('2026-08-02T10:00:00Z') }));

    await db.transaction(async function(trx) {
      await tw.archiveInstances(trx, USER_ID, [doneA, doneB]);
      await deleteTaskById(trx, tid, USER_ID);
    });

    var archivedId = '__archived__:' + USER_ID;
    var archMaster = await db('task_masters').where('id', archivedId).first();
    expect(archMaster).toBeTruthy();
    expect(archMaster.text).toBe('[Archived]');

    var rowA = await db('task_instances').where('id', doneA).first();
    var rowB = await db('task_instances').where('id', doneB).first();
    expect(rowA.master_id).toBe(archivedId);
    expect(rowB.master_id).toBe(archivedId);
    // Sequential ordinals starting at 1
    expect([rowA.occurrence_ordinal, rowB.occurrence_ordinal].sort()).toEqual([1, 2]);

    // View now returns text='[Archived]' for these rows (instead of NULL)
    var viewA = await db('tasks_v').where('id', doneA).first();
    expect(viewA.text).toBe('[Archived]');

    // Cleanup the archival master to keep test isolation
    await db('task_instances').where('master_id', archivedId).del();
    await db('task_masters').where('id', archivedId).del();
  });

  test('non-recurring task delete: removes both master and instance', async () => {
    if (!available) return;
    var id = uuidv7();
    await insertTask(db, {
      id: id, user_id: USER_ID, text: 'one-shot', task_type: 'task',
      dur: 30, pri: 'P3', status: '',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var r = await deleteTaskById(db, id, USER_ID);
    expect(r.masterDeleted).toBe(1);
    expect(r.instanceDeleted).toBe(1);
    expect(await db('task_masters').where('id', id).first()).toBeUndefined();
    expect(await db('task_instances').where('id', id).first()).toBeUndefined();
  });
});
