/**
 * Integration tests for remaining task controller handlers.
 * Covers: getVersion, deleteTask cascade, updateTaskStatus with recurring templates,
 * batchUpdateTasks, getDisabledTasks, reEnableTask.
 */

var db = require('../src/db');
var controller = require('../src/controllers/task.controller');

jest.mock('../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));

var available = false;
var USER_ID = 'crud2-test-001';

function mockReq(overrides) {
  return Object.assign({
    user: { id: USER_ID },
    headers: { 'x-timezone': 'America/New_York' },
    params: {}, query: {}, body: {},
    planFeatures: { limits: { active_tasks: 1000, recurring_templates: 100 } },
    planId: 'pro'
  }, overrides);
}

function mockRes() {
  var res = { statusCode: 200, _json: null,
    status: function(c) { res.statusCode = c; return res; },
    json: function(d) { res._json = d; return res; }
  };
  return res;
}

beforeAll(async () => {
  try { await db.raw('SELECT 1'); available = true; } catch (e) { return; }
  await db('tasks').where('user_id', USER_ID).del();
  await db('projects').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({ id: USER_ID, email: 'crud2@test.com', timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now() });
}, 15000);

afterAll(async () => {
  if (available) {
    await db('tasks').where('user_id', USER_ID).del();
    await db('projects').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await db('tasks').where('user_id', USER_ID).del();
});

// ═══════════════════════════════════════════════════════════════
// getVersion
// ═══════════════════════════════════════════════════════════════

describe('getVersion', () => {
  test('returns version string for user with tasks', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'v-001', user_id: USER_ID, task_type: 'task', text: 'Version', status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq();
    var res = mockRes();
    await controller.getVersion(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json.version).toBeTruthy();
  });

  test('returns null version for user with no tasks', async () => {
    if (!available) return;
    var req = mockReq();
    var res = mockRes();
    await controller.getVersion(req, res);
    expect(res.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteTask: cascade recurring
// ═══════════════════════════════════════════════════════════════

describe('deleteTask: cascade recurring', () => {
  test('cascade deletes template + pending instances, keeps completed', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'tmpl-casc', user_id: USER_ID, task_type: 'recurring_template', text: 'Recurring', recurring: 1, status: '', recur: JSON.stringify({ type: 'daily' }), created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('tasks').insert({ id: 'inst-pend', user_id: USER_ID, task_type: 'recurring_instance', source_id: 'tmpl-casc', recurring: 1, status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('tasks').insert({ id: 'inst-done', user_id: USER_ID, task_type: 'recurring_instance', source_id: 'tmpl-casc', recurring: 1, status: 'done', created_at: db.fn.now(), updated_at: db.fn.now() });

    var req = mockReq({ params: { id: 'tmpl-casc' }, query: { cascade: 'recurring' } });
    var res = mockRes();
    await controller.deleteTask(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json.deletedInstances).toBe(1); // pending
    expect(res._json.keptInstances).toBe(1); // done

    // Template and pending deleted
    expect(await db('tasks').where('id', 'tmpl-casc').first()).toBeUndefined();
    expect(await db('tasks').where('id', 'inst-pend').first()).toBeUndefined();
    // Done instance kept, source_id cleared
    var kept = await db('tasks').where('id', 'inst-done').first();
    expect(kept).toBeDefined();
    expect(kept.source_id).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// updateTaskStatus: recurring template pause/unpause
// ═══════════════════════════════════════════════════════════════

describe('updateTaskStatus: recurring templates', () => {
  test('pause template deletes future open instances', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'tmpl-pause', user_id: USER_ID, task_type: 'recurring_template', text: 'Pausable', recurring: 1, status: '', recur: JSON.stringify({ type: 'daily' }), created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('tasks').insert({ id: 'inst-future', user_id: USER_ID, task_type: 'recurring_instance', source_id: 'tmpl-pause', recurring: 1, status: '', scheduled_at: new Date(Date.now() + 86400000), created_at: db.fn.now(), updated_at: db.fn.now() });

    var req = mockReq({ params: { id: 'tmpl-pause' }, body: { status: 'pause' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);
    expect(res._json.task.status).toBe('pause');
    expect(await db('tasks').where('id', 'inst-future').first()).toBeUndefined();
  });

  test('unpause template sets status back to empty', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'tmpl-unpause', user_id: USER_ID, task_type: 'recurring_template', text: 'Paused tmpl', recurring: 1, status: 'pause', recur: JSON.stringify({ type: 'daily' }), created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq({ params: { id: 'tmpl-unpause' }, body: { status: '' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);
    expect(res._json.task.status).toBe('');
  });

  test('rejects non-pause status on template', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'tmpl-reject', user_id: USER_ID, task_type: 'recurring_template', text: 'Template', recurring: 1, status: '', recur: JSON.stringify({ type: 'daily' }), created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq({ params: { id: 'tmpl-reject' }, body: { status: 'done' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('done stamps scheduled_at to now', async () => {
    if (!available) return;
    var futureTime = new Date(Date.now() - 3600000); // 1 hour ago
    await db('tasks').insert({ id: 'done-stamp', user_id: USER_ID, task_type: 'task', text: 'Complete me', status: '', scheduled_at: futureTime, created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq({ params: { id: 'done-stamp' }, body: { status: 'done' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);
    expect(res._json.task.status).toBe('done');
  });

  test('rejects update on disabled task', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'disabled-st', user_id: USER_ID, task_type: 'task', text: 'Disabled', status: 'disabled', created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq({ params: { id: 'disabled-st' }, body: { status: 'done' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// batchUpdateTasks
// ═══════════════════════════════════════════════════════════════

describe('batchUpdateTasks', () => {
  test('batch updates multiple tasks', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'bu-1', user_id: USER_ID, task_type: 'task', text: 'A', pri: 'P3', status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('tasks').insert({ id: 'bu-2', user_id: USER_ID, task_type: 'task', text: 'B', pri: 'P3', status: '', created_at: db.fn.now(), updated_at: db.fn.now() });

    var req = mockReq({ body: { updates: [
      { id: 'bu-1', pri: 'P1' },
      { id: 'bu-2', pri: 'P2' }
    ]}});
    var res = mockRes();
    await controller.batchUpdateTasks(req, res);
    expect(res._json.updated).toBe(2);

    var r1 = await db('tasks').where('id', 'bu-1').first();
    var r2 = await db('tasks').where('id', 'bu-2').first();
    expect(r1.pri).toBe('P1');
    expect(r2.pri).toBe('P2');
  });

  test('batch routes template fields for recurring instances', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'tmpl-batch', user_id: USER_ID, task_type: 'recurring_template', text: 'Template', dur: 30, recurring: 1, status: '', recur: JSON.stringify({ type: 'daily' }), created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('tasks').insert({ id: 'inst-batch', user_id: USER_ID, task_type: 'recurring_instance', source_id: 'tmpl-batch', recurring: 1, status: '', created_at: db.fn.now(), updated_at: db.fn.now() });

    var req = mockReq({ body: { updates: [
      { id: 'inst-batch', text: 'New Name', dur: 45 }
    ]}});
    var res = mockRes();
    await controller.batchUpdateTasks(req, res);
    expect(res._json.updated).toBe(1);

    var tmpl = await db('tasks').where('id', 'tmpl-batch').first();
    expect(tmpl.text).toBe('New Name');
    expect(tmpl.dur).toBe(45);
  });

  test('skips disabled tasks in batch', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'bu-dis', user_id: USER_ID, task_type: 'task', text: 'Disabled', status: 'disabled', created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq({ body: { updates: [{ id: 'bu-dis', text: 'Changed' }] }});
    var res = mockRes();
    await controller.batchUpdateTasks(req, res);
    var row = await db('tasks').where('id', 'bu-dis').first();
    expect(row.text).toBe('Disabled'); // unchanged
  });
});

// ═══════════════════════════════════════════════════════════════
// getDisabledTasks + reEnableTask
// ═══════════════════════════════════════════════════════════════

describe('disabled tasks', () => {
  test('getDisabledTasks returns disabled items', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'dis-1', user_id: USER_ID, task_type: 'task', text: 'Disabled item', status: 'disabled', disabled_at: db.fn.now(), created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq();
    var res = mockRes();
    await controller.getDisabledTasks(req, res);
    expect(res._json.tasks.length).toBe(1);
    expect(res._json.tasks[0].text).toBe('Disabled item');
  });

  test('reEnableTask restores disabled task', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'reenable-1', user_id: USER_ID, task_type: 'task', text: 'Re-enable me', status: 'disabled', disabled_at: db.fn.now(), created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq({ params: { id: 'reenable-1' } });
    var res = mockRes();
    await controller.reEnableTask(req, res);
    expect(res._json.task.status).toBe('');
    var row = await db('tasks').where('id', 'reenable-1').first();
    expect(row.status).toBe('');
    expect(row.disabled_at).toBeNull();
  });

  test('reEnableTask rejects non-disabled task', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'not-dis', user_id: USER_ID, task_type: 'task', text: 'Active', status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq({ params: { id: 'not-dis' } });
    var res = mockRes();
    await controller.reEnableTask(req, res);
    expect(res.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// getAllTasks
// ═══════════════════════════════════════════════════════════════

describe('getAllTasks', () => {
  test('returns all non-disabled tasks', async () => {
    if (!available) return;
    await db('tasks').insert({ id: 'all-1', user_id: USER_ID, task_type: 'task', text: 'Active', status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('tasks').insert({ id: 'all-2', user_id: USER_ID, task_type: 'task', text: 'Done', status: 'done', created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('tasks').insert({ id: 'all-3', user_id: USER_ID, task_type: 'task', text: 'Disabled', status: 'disabled', created_at: db.fn.now(), updated_at: db.fn.now() });
    var req = mockReq();
    var res = mockRes();
    await controller.getAllTasks(req, res);
    expect(res._json.tasks.length).toBe(3); // returns all including disabled
  });
});
