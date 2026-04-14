/**
 * Regression test for the "deleted calendar-linked tasks come back" bug.
 *
 * Pattern: user deletes a task that was synced to a calendar (gcal/msft/apple).
 * The cal_sync_ledger row must be retired with status='deleted_local' so the
 * next sync pull doesn't re-ingest the still-existing calendar event as a
 * brand-new task. Previously the cleanup just nulled task_id while leaving
 * status='active', leaking the event back in.
 */
var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var taskController = require('../src/controllers/task.controller');

jest.mock('../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));

var available = false;
var USER_ID = 'del-cal-link-test';

beforeAll(async () => {
  try { await db.raw('SELECT 1'); available = true; } catch (e) { return; }
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID, email: 'delcal@test.com', name: 'Del Cal Link',
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

function mockReq(taskId) {
  return { user: { id: USER_ID }, params: { id: taskId }, query: {}, body: {}, headers: {} };
}
function mockRes() {
  var res = { statusCode: 200, _json: null };
  res.status = function(c) { res.statusCode = c; return res; };
  res.json = function(d) { res._json = d; return res; };
  return res;
}

describe('deleteTask: calendar-linked task cleanup', () => {
  test('retires ledger row to status=deleted_local instead of leaving it active', async () => {
    if (!available) return;
    var taskWrite = require('../src/lib/tasks-write');
    var id = uuidv7();
    await taskWrite.insertTask(db, {
      id: id, user_id: USER_ID, text: 'cal-linked task', task_type: 'task',
      dur: 30, pri: 'P3', status: '',
      scheduled_at: new Date('2026-08-01T10:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Simulate a prior gcal sync — ledger row points at this task
    await db('cal_sync_ledger').insert({
      user_id: USER_ID, provider: 'gcal', task_id: id,
      provider_event_id: 'gcal_evt_will_be_orphaned', origin: 'juggler',
      status: 'active', synced_at: db.fn.now(), created_at: db.fn.now()
    });

    // User deletes the task
    var res = mockRes();
    await taskController.deleteTask(mockReq(id), res);
    expect(res.statusCode).toBe(200);

    // Ledger row must now be terminal (status='deleted_local'), task_id null,
    // provider_event_id null — so the next sync pull WON'T re-ingest the event.
    var ledger = await db('cal_sync_ledger')
      .where({ user_id: USER_ID, provider: 'gcal' }).first();
    expect(ledger).toBeTruthy();
    expect(ledger.status).toBe('deleted_local');
    expect(ledger.task_id).toBeNull();
    expect(ledger.provider_event_id).toBeNull();

    // Crucially: NO orphan ledger row (task_id NULL + status active)
    var orphans = await db('cal_sync_ledger')
      .where('user_id', USER_ID).whereNull('task_id').where('status', 'active');
    expect(orphans.length).toBe(0);
  });

  test('non-cal-linked task delete: no ledger writes', async () => {
    if (!available) return;
    var taskWrite = require('../src/lib/tasks-write');
    var id = uuidv7();
    await taskWrite.insertTask(db, {
      id: id, user_id: USER_ID, text: 'no-sync', task_type: 'task',
      dur: 30, pri: 'P3', status: '',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var res = mockRes();
    await taskController.deleteTask(mockReq(id), res);
    expect(res.statusCode).toBe(200);
    var ledgerCount = await db('cal_sync_ledger').where('user_id', USER_ID).count({ c: 'id' }).first();
    expect(Number(ledgerCount.c)).toBe(0);
  });
});
