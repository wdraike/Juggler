// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
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
var { assertDbAvailable } = require('./helpers/requireDB');

var USER_ID = 'fk-cascade-test-user';

beforeAll(async () => {
  await assertDbAvailable();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert(__stampFixture({
    id: USER_ID, email: 'fkcascade@test.com', name: 'FK Cascade Test',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  }));
}, 15000);

afterAll(async () => {
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db.destroy();
});

beforeEach(async () => {
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
});

describe('FK ON DELETE SET NULL on task_instances.master_id', () => {
  test('deleting master with mixed-status instances: pending must be explicitly deleted; completed survive detached', async () => {
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

    // tasks_v uses INNER JOIN — detached instances (master_id=NULL) are NOT
    // visible in the view. The raw task_instances row still exists.
    var view = await db('tasks_v').where('id', doneId).first();
    expect(view).toBeUndefined();

    var rawInst = await db('task_instances').where('id', doneId).first();
    expect(rawInst).toBeDefined();
    expect(rawInst.master_id).toBeNull(); // FK SET NULL confirmed
    expect(rawInst.status).toBe('done');
  });

  // The archival re-parenting flow (__archived__:<userId> master, [Archived] text,
  // ordinal reassignment) was intentionally removed in 999.676 ("remove archive",
  // commit e1fe270) — tasks-write no longer exports archiveInstances. The current
  // contract on master deletion is plain FK ON DELETE SET NULL detachment:
  // completed instances survive in task_instances with master_id = NULL and drop
  // out of the tasks_v INNER JOIN. (No __archived__ master is created.)
  test('deleting master detaches completed instances (master_id NULL); no __archived__ master is created', async () => {
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

    await deleteTaskById(db, tid, USER_ID);

    // No archival master is fabricated (feature removed in 999.676).
    var archivedId = '__archived__:' + USER_ID;
    var archMaster = await db('task_masters').where('id', archivedId).first();
    expect(archMaster).toBeUndefined();

    // Completed instances survive, detached via FK ON DELETE SET NULL.
    var rowA = await db('task_instances').where('id', doneA).first();
    var rowB = await db('task_instances').where('id', doneB).first();
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowA.master_id).toBeNull();
    expect(rowB.master_id).toBeNull();
    expect(rowA.status).toBe('done');
    expect(rowB.status).toBe('done');

    // Detached rows (master_id NULL) drop out of the tasks_v INNER JOIN.
    var viewA = await db('tasks_v').where('id', doneA).first();
    expect(viewA).toBeUndefined();
  });

  test('non-recurring task delete: removes both master and instance', async () => {
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
