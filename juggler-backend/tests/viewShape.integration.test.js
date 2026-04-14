/**
 * Integration tests pinning the row shape returned by `tasks_v` and
 * `tasks_with_sync_v` for every distinct branch:
 *   - recurring template (master with recurring=1, no instance row)
 *   - non-recurring task (master + instance, shared id)
 *   - recurring instance (instance JOIN master)
 *   - detached instance (master_id=NULL after FK ON DELETE SET NULL)
 *   - persistent split chunks (split_ordinal/split_total surfaced)
 *   - calendar event ids from cal_sync_ledger via tasks_with_sync_v
 */
var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var { insertTask, deleteTaskById } = require('../src/lib/tasks-write');
var { reconcileSplitsForMaster } = require('../src/lib/reconcile-splits');

var available = false;
var USER_ID = 'view-shape-test-user';

beforeAll(async () => {
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message); return;
  }
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID, email: 'viewshape@test.com', name: 'View Shape Test',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  });
}, 15000);

afterAll(async () => {
  if (available) {
    await db('cal_sync_ledger').where('user_id', USER_ID).del();
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
});

describe('tasks_v shape — by row class', () => {
  test('recurring template row: task_type=recurring_template, scheduled_at=NULL, source_id=NULL', async () => {
    if (!available) return;
    var tid = uuidv7();
    await insertTask(db, {
      id: tid, user_id: USER_ID, text: 'tmpl', task_type: 'recurring_template',
      recurring: 1, dur: 30, pri: 'P3', recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var row = await db('tasks_v').where('id', tid).first();
    expect(row).toBeTruthy();
    expect(row.task_type).toBe('recurring_template');
    expect(row.scheduled_at).toBeNull();
    expect(row.source_id).toBeNull();
    expect(row.text).toBe('tmpl');
    expect(Number(row.recurring)).toBe(1);
  });

  test('non-recurring row: master+instance merged, task_type=task', async () => {
    if (!available) return;
    var id = uuidv7();
    await insertTask(db, {
      id: id, user_id: USER_ID, text: 'one-shot', task_type: 'task',
      dur: 25, pri: 'P2', status: '',
      scheduled_at: new Date('2026-06-01T15:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var rows = await db('tasks_v').where('id', id).select();
    expect(rows).toHaveLength(1);
    var row = rows[0];
    expect(row.task_type).toBe('task');
    expect(row.text).toBe('one-shot');           // from master
    expect(row.pri).toBe('P2');                  // from master
    expect(row.dur).toBe(25);                    // from instance (COALESCE)
    expect(row.scheduled_at).toBeTruthy();       // from instance
    expect(row.source_id).toBeNull();
    expect(row.occurrence_ordinal).toBe(1);
    expect(row.split_ordinal).toBe(1);
    expect(row.split_total).toBe(1);
  });

  test('recurring instance: task_type=recurring_instance, source_id=template.id, template fields inherited', async () => {
    if (!available) return;
    var tid = uuidv7();
    await insertTask(db, {
      id: tid, user_id: USER_ID, text: 'daily', task_type: 'recurring_template',
      recurring: 1, dur: 45, pri: 'P1', project: 'Health',
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var iid = uuidv7();
    await insertTask(db, {
      id: iid, user_id: USER_ID, task_type: 'recurring_instance',
      source_id: tid, recurring: 1, dur: 45, pri: 'P1', status: '',
      scheduled_at: new Date('2026-06-02T08:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var row = await db('tasks_v').where('id', iid).first();
    expect(row.task_type).toBe('recurring_instance');
    expect(row.source_id).toBe(tid);             // points to template master
    expect(row.text).toBe('daily');              // inherited from template
    expect(row.pri).toBe('P1');                  // inherited
    expect(row.project).toBe('Health');          // inherited
    expect(Number(row.recurring)).toBe(1);
    expect(row.scheduled_at).toBeTruthy();
    expect(row.occurrence_ordinal).toBe(1);
  });

  test('detached instance: master deleted, FK SET NULL leaves instance with master fields NULL', async () => {
    if (!available) return;
    var tid = uuidv7();
    await insertTask(db, {
      id: tid, user_id: USER_ID, text: 'will-detach',
      task_type: 'recurring_template', recurring: 1, dur: 30, pri: 'P3',
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var doneIid = uuidv7();
    await insertTask(db, {
      id: doneIid, user_id: USER_ID, task_type: 'recurring_instance',
      source_id: tid, recurring: 1, dur: 30, pri: 'P3', status: 'done',
      scheduled_at: new Date('2026-06-03T08:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Delete the template — FK SET NULL detaches the done instance
    await deleteTaskById(db, tid, USER_ID);

    var row = await db('tasks_v').where('id', doneIid).first();
    expect(row).toBeTruthy();                    // still in view via LEFT JOIN
    expect(row.task_type).toBe('task');           // fallback when m.id IS NULL
    expect(row.text).toBeNull();                  // master gone, can't inherit
    expect(row.pri).toBeNull();
    expect(row.recurring).toBeNull();
    expect(row.scheduled_at).toBeTruthy();        // instance fields still populated
    expect(row.status).toBe('done');
  });

  test('persistent split chunks: split_ordinal 1..N and split_total surface in view', async () => {
    if (!available) return;
    var id = uuidv7();
    await insertTask(db, {
      id: id, user_id: USER_ID, text: 'split90', task_type: 'task',
      dur: 90, split: 1, split_min: 30, pri: 'P3', status: '',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, id); });
    var rows = await db('tasks_v')
      .where('user_id', USER_ID)
      .whereNotNull('split_ordinal')
      .orderBy('split_ordinal');
    expect(rows).toHaveLength(3);
    expect(rows.map(function(r) { return r.split_ordinal; })).toEqual([1, 2, 3]);
    expect(rows.every(function(r) { return r.split_total === 3; })).toBe(true);
    expect(rows.every(function(r) { return r.dur === 30; })).toBe(true);
  });
});

describe('tasks_with_sync_v — provider event ids from ledger', () => {
  test('returns gcal_event_id from active ledger entry, msft/apple null if no entry', async () => {
    if (!available) return;
    var id = uuidv7();
    await insertTask(db, {
      id: id, user_id: USER_ID, text: 'synced', task_type: 'task',
      dur: 30, pri: 'P3', scheduled_at: new Date('2026-06-04T10:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db('cal_sync_ledger').insert({
      user_id: USER_ID, provider: 'gcal', task_id: id,
      provider_event_id: 'gcal_evt_abc123', origin: 'juggler',
      status: 'active', synced_at: db.fn.now(), created_at: db.fn.now()
    });

    var row = await db('tasks_with_sync_v').where('id', id).first();
    expect(row.gcal_event_id).toBe('gcal_evt_abc123');
    expect(row.msft_event_id).toBeNull();
    expect(row.apple_event_id).toBeNull();

    // Sanity: tasks_v alone returns NULL for all provider event ids
    var bareRow = await db('tasks_v').where('id', id).first();
    expect(bareRow.gcal_event_id).toBeNull();
  });

  test('inactive ledger entries do NOT show up in the view', async () => {
    if (!available) return;
    var id = uuidv7();
    await insertTask(db, {
      id: id, user_id: USER_ID, text: 't', task_type: 'task',
      dur: 30, pri: 'P3', scheduled_at: new Date('2026-06-05T10:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db('cal_sync_ledger').insert({
      user_id: USER_ID, provider: 'gcal', task_id: id,
      provider_event_id: 'should_not_appear', origin: 'juggler',
      status: 'deleted_local', synced_at: db.fn.now(), created_at: db.fn.now()
    });
    var row = await db('tasks_with_sync_v').where('id', id).first();
    expect(row.gcal_event_id).toBeNull();
  });
});
