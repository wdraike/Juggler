/**
 * Integration tests for task controller CRUD handlers.
 * Uses real test DB via NODE_ENV=test.
 * Requires: docker compose -f docker-compose.test.yml up -d
 */

var db = require('../src/db');
var { rowToTask, taskToRow, buildSourceMap, TEMPLATE_FIELDS } = require('../src/controllers/task.controller');
var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');

var available = false;
var USER_ID = 'crud-test-user-001';

// Mock scheduleQueue to prevent actual scheduler runs during CRUD tests
jest.mock('../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));

beforeAll(async () => {
  try {
    await db.raw('SELECT 1');
    available = true;
  } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  // Seed test user
  await db('tasks').where('user_id', USER_ID).del();
  await db('projects').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID, email: 'crud@test.com', name: 'CRUD Test',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  });
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
  await db('projects').where('user_id', USER_ID).del();
  enqueueScheduleRun.mockClear();
});

// Helper to call controller handlers with mocked req/res
function mockReq(overrides) {
  return Object.assign({
    user: { id: USER_ID },
    headers: { 'x-timezone': 'America/New_York' },
    params: {},
    query: {},
    body: {},
    planFeatures: null,
    planId: 'free'
  }, overrides);
}

function mockRes() {
  var res = {
    statusCode: 200,
    _json: null,
    status: function(code) { res.statusCode = code; return res; },
    json: function(data) { res._json = data; return res; }
  };
  return res;
}

// Import controller handlers
var controller = require('../src/controllers/task.controller');

// ═══════════════════════════════════════════════════════════════
// createTask
// ═══════════════════════════════════════════════════════════════

describe('createTask', () => {
  test('creates a task with text and date', async () => {
    if (!available) return;
    var req = mockReq({ body: { text: 'Buy milk', date: '4/10', time: '9:00 AM' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.task.text).toBe('Buy milk');
    expect(res._json.task.datePinned).toBe(true);
    // Verify enqueue was called
    expect(enqueueScheduleRun).toHaveBeenCalledWith(USER_ID, 'api:createTask');
  });

  test('creates a task with auto-generated ID', async () => {
    if (!available) return;
    var req = mockReq({ body: { text: 'Auto ID task' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.task.id).toBeTruthy();
    expect(res._json.task.id.length).toBeGreaterThan(10);
  });

  test('creates a task with priority normalization', async () => {
    if (!available) return;
    var req = mockReq({ body: { text: 'Priority test', pri: 'p1' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res._json.task.pri).toBe('P1');
  });

  test('rejects task with no text', async () => {
    if (!available) return;
    var req = mockReq({ body: { _requireText: true } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('auto-pins when date is provided', async () => {
    if (!available) return;
    var req = mockReq({ body: { text: 'Pinned', date: '4/15' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res._json.task.datePinned).toBe(true);
  });

  test('sets when=fixed when time is provided', async () => {
    if (!available) return;
    var req = mockReq({ body: { text: 'Fixed time', time: '2:00 PM', date: '4/15' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res._json.task.when).toBe('fixed');
  });
});

// ═══════════════════════════════════════════════════════════════
// updateTask
// ═══════════════════════════════════════════════════════════════

describe('updateTask', () => {
  test('updates task text', async () => {
    if (!available) return;
    // Create first
    var req1 = mockReq({ body: { text: 'Original' } });
    var res1 = mockRes();
    await controller.createTask(req1, res1);
    var id = res1._json.task.id;

    // Update
    var req2 = mockReq({ params: { id: id }, body: { text: 'Updated' } });
    var res2 = mockRes();
    await controller.updateTask(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2._json.task.text).toBe('Updated');
  });

  test('returns 404 for non-existent task', async () => {
    if (!available) return;
    var req = mockReq({ params: { id: 'nonexistent-id' }, body: { text: 'Nope' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(404);
  });

  test('sets desired_at when date/time changed', async () => {
    if (!available) return;
    var req1 = mockReq({ body: { text: 'Desired test' } });
    var res1 = mockRes();
    await controller.createTask(req1, res1);
    var id = res1._json.task.id;

    var req2 = mockReq({ params: { id: id }, body: { date: '4/12', time: '3:00 PM' } });
    var res2 = mockRes();
    await controller.updateTask(req2, res2);
    expect(res2._json.task.desiredAt).toBeTruthy();
  });

  test('drag-pin sets when=fixed and date_pinned', async () => {
    if (!available) return;
    var req1 = mockReq({ body: { text: 'Drag test', date: '4/10', when: 'morning' } });
    var res1 = mockRes();
    await controller.createTask(req1, res1);
    var id = res1._json.task.id;

    var req2 = mockReq({ params: { id: id }, body: { _dragPin: true, date: '4/11', time: '2:00 PM' } });
    var res2 = mockRes();
    await controller.updateTask(req2, res2);
    expect(res2._json.task.when).toBe('fixed');
    expect(res2._json.task.datePinned).toBe(true);
  });

  test('recurring instance routes template fields to source', async () => {
    if (!available) return;
    // Create template
    await db('tasks').insert({
      id: 'tmpl-crud', user_id: USER_ID, task_type: 'recurring_template',
      text: 'Template', dur: 30, pri: 'P3', recurring: 1, status: '',
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Create instance
    await db('tasks').insert({
      id: 'inst-crud', user_id: USER_ID, task_type: 'recurring_instance',
      source_id: 'tmpl-crud', recurring: 1, status: '',
      scheduled_at: '2026-04-10 15:00:00',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    // Update instance text → should route to template
    var req = mockReq({ params: { id: 'inst-crud' }, body: { text: 'New Name', dur: 45 } });
    var res = mockRes();
    await controller.updateTask(req, res);

    var tmpl = await db('tasks').where('id', 'tmpl-crud').first();
    expect(tmpl.text).toBe('New Name');
    expect(tmpl.dur).toBe(45);
  });

  test('preferred_time_mins routes to template', async () => {
    if (!available) return;
    await db('tasks').insert({
      id: 'tmpl-ptm-crud', user_id: USER_ID, task_type: 'recurring_template',
      text: 'Breakfast', dur: 20, pri: 'P3', recurring: 1, status: '',
      preferred_time: 1, recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db('tasks').insert({
      id: 'inst-ptm-crud', user_id: USER_ID, task_type: 'recurring_instance',
      source_id: 'tmpl-ptm-crud', recurring: 1, status: '',
      scheduled_at: '2026-04-10 11:00:00',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    var req = mockReq({ params: { id: 'inst-ptm-crud' }, body: { preferredTimeMins: 420, timeFlex: 60 } });
    var res = mockRes();
    await controller.updateTask(req, res);

    var tmpl = await db('tasks').where('id', 'tmpl-ptm-crud').first();
    expect(tmpl.preferred_time_mins).toBe(420);
    expect(tmpl.time_flex).toBe(60);
    // scheduled_at should NOT be on the template
    var inst = await db('tasks').where('id', 'inst-ptm-crud').first();
    expect(inst.scheduled_at).toBe('2026-04-10 11:00:00'); // unchanged
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteTask
// ═══════════════════════════════════════════════════════════════

describe('deleteTask', () => {
  test('deletes a task', async () => {
    if (!available) return;
    var req1 = mockReq({ body: { text: 'To delete' } });
    var res1 = mockRes();
    await controller.createTask(req1, res1);
    var id = res1._json.task.id;

    var req2 = mockReq({ params: { id: id }, query: {} });
    var res2 = mockRes();
    await controller.deleteTask(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2._json.message).toBe('Task deleted');

    var row = await db('tasks').where('id', id).first();
    expect(row).toBeUndefined();
  });

  test('returns 404 for non-existent task', async () => {
    if (!available) return;
    var req = mockReq({ params: { id: 'nonexistent' }, query: {} });
    var res = mockRes();
    await controller.deleteTask(req, res);
    expect(res.statusCode).toBe(404);
  });

  test('remaps dependencies on delete', async () => {
    if (!available) return;
    await db('tasks').insert({
      id: 'dep-parent', user_id: USER_ID, task_type: 'task',
      text: 'Parent', status: '', depends_on: '[]',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db('tasks').insert({
      id: 'dep-child', user_id: USER_ID, task_type: 'task',
      text: 'Child', status: '', depends_on: '["dep-parent"]',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    var req = mockReq({ params: { id: 'dep-parent' }, query: {} });
    var res = mockRes();
    await controller.deleteTask(req, res);

    var child = await db('tasks').where('id', 'dep-child').first();
    var deps = typeof child.depends_on === 'string' ? JSON.parse(child.depends_on) : (child.depends_on || []);
    expect(deps).not.toContain('dep-parent');
  });
});

// ═══════════════════════════════════════════════════════════════
// updateTaskStatus
// ═══════════════════════════════════════════════════════════════

describe('updateTaskStatus', () => {
  test('marks task done', async () => {
    if (!available) return;
    var req1 = mockReq({ body: { text: 'To complete', date: '4/10', time: '9:00 AM' } });
    var res1 = mockRes();
    await controller.createTask(req1, res1);
    var id = res1._json.task.id;

    var req2 = mockReq({ params: { id: id }, body: { status: 'done' } });
    var res2 = mockRes();
    await controller.updateTaskStatus(req2, res2);
    expect(res2._json.task.status).toBe('done');
  });

  test('rejects invalid status', async () => {
    if (!available) return;
    var req1 = mockReq({ body: { text: 'Status test' } });
    var res1 = mockRes();
    await controller.createTask(req1, res1);
    var id = res1._json.task.id;

    var req2 = mockReq({ params: { id: id }, body: { status: 'invalid' } });
    var res2 = mockRes();
    await controller.updateTaskStatus(req2, res2);
    expect(res2.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// batchCreateTasks
// ═══════════════════════════════════════════════════════════════

describe('batchCreateTasks', () => {
  test('creates multiple tasks', async () => {
    if (!available) return;
    var crypto = require('crypto');
    var req = mockReq({
      body: {
        tasks: [
          { id: crypto.randomUUID(), text: 'Batch 1', pri: 'P1' },
          { id: crypto.randomUUID(), text: 'Batch 2', pri: 'P2' },
          { id: crypto.randomUUID(), text: 'Batch 3', pri: 'P3' }
        ]
      }
    });
    var res = mockRes();
    await controller.batchCreateTasks(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.created).toBe(3);

    var count = await db('tasks').where('user_id', USER_ID).count('* as c').first();
    expect(parseInt(count.c)).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// unpinTask
// ═══════════════════════════════════════════════════════════════

describe('unpinTask', () => {
  test('restores prev_when and clears date_pinned', async () => {
    if (!available) return;
    await db('tasks').insert({
      id: 'unpin-test', user_id: USER_ID, task_type: 'task',
      text: 'Pinned task', when: 'fixed', prev_when: 'morning',
      date_pinned: 1, status: '',
      scheduled_at: '2026-04-10 15:00:00',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    var req = mockReq({ params: { id: 'unpin-test' } });
    var res = mockRes();
    await controller.unpinTask(req, res);
    expect(res._json.action).toBe('unpinned');
    expect(res._json.when).toBe('morning');

    var row = await db('tasks').where('id', 'unpin-test').first();
    expect(row.date_pinned).toBeFalsy();
    expect(row.when).toBe('morning');
  });
});
