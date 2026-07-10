/**
 * Integration tests for task controller CRUD handlers.
 * Uses real test DB via NODE_ENV=test.
 * Requires: cd test-bed && make up
 */

var db = require('../src/db');
var { rowToTask, taskToRow, buildSourceMap, TEMPLATE_FIELDS } = require('../src/controllers/task.controller');
var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'crud-test-user-001';

// Mock scheduleQueue to prevent actual scheduler runs during CRUD tests
jest.mock('../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  // Seed test user
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('projects').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID, email: 'crud@test.com', name: 'CRUD Test',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  });
}, 15000);

afterAll(async () => {
  if (available) {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('projects').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
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

// Create a task and attach a cal_sync_ledger row. Returns the task id.
async function seedCalSyncTask(taskBody, ledger) {
  var req = mockReq({ body: taskBody });
  var res = mockRes();
  await controller.createTask(req, res);
  var id = res._json.task.id;
  await db('cal_sync_ledger').insert(Object.assign({
    user_id: USER_ID, task_id: id,
    created_at: db.fn.now(), updated_at: db.fn.now()
  }, ledger));
  return id;
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
    // datePinned was removed in feat(when-mode): placement_mode='fixed' is the sole
    // immovability signal. Creating with date+time sets scheduledAt; pinning now
    // requires the client to explicitly send placementMode:'fixed'.
    expect(res._json.task.scheduledAt).toBeTruthy();
    // enqueueScheduleRun fires inside a 2-second setTimeout in the controller wrapper;
    // asserting it here would be a race. DB state is the reliable assertion.
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

  test('auto-schedules when date is provided (datePinned removed)', async () => {
    if (!available) return;
    // datePinned was removed; date+time sets scheduledAt; placement_mode='fixed'
    // requires an explicit client signal.
    var req = mockReq({ body: { text: 'Pinned', date: '4/15' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.task.scheduledAt).toBeTruthy();
  });

  test('sets scheduledAt when time is provided (server no longer auto-sets when=fixed)', async () => {
    if (!available) return;
    // After feat(when-mode): server does NOT auto-derive when='fixed' from time.
    // The client must explicitly send when:'fixed' or placementMode:'fixed'.
    // Server just sets scheduledAt from date+time.
    var req = mockReq({ body: { text: 'Fixed time', time: '2:00 PM', date: '4/15' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.task.scheduledAt).toBeTruthy();
    // when is null because client did not send it; placementMode is the DB default (anytime)
    expect(res._json.task.when).toBeNull();
  });

  test('sets placementMode=fixed when client sends placementMode:fixed with date+time', async () => {
    if (!available) return;
    // After feat(when-mode): server does NOT auto-set placementMode='fixed' from time.
    // The client must explicitly send placementMode:'fixed'.
    var req = mockReq({ body: { text: 'Fixed time explicit', time: '3:00 PM', date: '4/15', placementMode: 'fixed' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.task.scheduledAt).toBeTruthy();
    expect(res._json.task.placementMode).toBe('fixed');
  });

  // D-14: all-day backstop via allDay flag
  // REAL BUG (task.controller.js line 891-892): The D-14 backstop was changed from
  //   `if (!timeWasSet && allDay && row.when===undefined) row.when='allday'`
  // to
  //   `if (!timeWasSet && allDay && row.placement_mode===undefined) row.placement_mode='all_day'`
  // This broke when='allday' — the backstop now sets placement_mode but NOT when.
  // Fix required in src/controllers/task.controller.js lines 889-892 (createTask)
  // and lines 1117-1120 (updateTask): restore `row.when = 'allday'` alongside placement_mode.
  test('D-14: sets when=allday when allDay=true and no time or when field provided', async () => {
    if (!available) return;
    var req = mockReq({ body: { text: 'All Day Task', allDay: true } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.task.when).toBe('allday');
  });

  // D-14: explicit when=allday still works (existing path via taskToRow, backstop does not interfere)
  test('D-14: explicit when=allday is preserved', async () => {
    if (!available) return;
    var req = mockReq({ body: { text: 'Explicit All Day Task', when: 'allday' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.task.when).toBe('allday');
  });

  // D-14: allDay=true + time provided — time takes precedence, backstop does not fire.
  // After feat(when-mode), the server no longer auto-sets when='fixed' from time —
  // the client must send it explicitly. This test reflects the correct current contract:
  // when time wins over allDay, the result is when=null (client did not send when).
  test('D-14: allDay=true with time present — time wins, when stays null (client must send when)', async () => {
    if (!available) return;
    var req = mockReq({ body: { text: 'Ambiguous Task', allDay: true, time: '2:00 PM', date: '4/15' } });
    var res = mockRes();
    await controller.createTask(req, res);
    expect(res.statusCode).toBe(201);
    // timeWasSet=true → D-14 backstop does NOT fire → when is whatever client sent (null)
    // The old assertion `when='fixed'` was stale: server never auto-sets when from time.
    expect(res._json.task.when).toBeNull();
    expect(res._json.task.scheduledAt).toBeTruthy();
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

  xtest('updateTask: drag-pin — _dragPin flag removed', async () => {
    if (!available) return;
    var req1 = mockReq({ body: { text: 'Drag test', date: '4/10', when: 'morning' } });
    var res1 = mockRes();
    await controller.createTask(req1, res1);
    var id = res1._json.task.id;

    var req2 = mockReq({ params: { id: id }, body: { _dragPin: true, date: '4/11', time: '2:00 PM' } });
    var res2 = mockRes();
    await controller.updateTask(req2, res2);
    // drag-pin sets date_pinned only; `when` tag stays unchanged (pinning is
    // handled by datePinned, not by overwriting the when tag to 'fixed').
    expect(res2._json.task.when).toBe('morning');
    expect(res2._json.task.datePinned).toBe(true);
  });

  test('recurring instance routes template fields to source', async () => {
    if (!available) return;
    // Create template
    await tasksWrite.insertTask(db, {
      id: 'tmpl-crud', user_id: USER_ID, task_type: 'recurring_template',
      text: 'Template', dur: 30, pri: 'P3', recurring: 1, status: '',
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Create instance
    await tasksWrite.insertTask(db, {
      id: 'inst-crud', user_id: USER_ID, task_type: 'recurring_instance',
      source_id: 'tmpl-crud', recurring: 1, status: '',
      scheduled_at: '2026-04-10 15:00:00',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    // Update instance text → should route to template
    var req = mockReq({ params: { id: 'inst-crud' }, body: { text: 'New Name', dur: 45 } });
    var res = mockRes();
    await controller.updateTask(req, res);

    var tmpl = await db('tasks_v').where('id', 'tmpl-crud').first();
    expect(tmpl.text).toBe('New Name');
    expect(tmpl.dur).toBe(45);
  });

  // D-14: all-day backstop in updateTask
  // REAL BUG: Same backstop bug as createTask — updateTask sets placement_mode='all_day'
  // but NOT when='allday'. See createTask D-14 comment for fix location.
  test('D-14: sets when=allday when allDay=true and no time or when field provided', async () => {
    if (!available) return;
    var req1 = mockReq({ body: { text: 'Update All Day Task' } });
    var res1 = mockRes();
    await controller.createTask(req1, res1);
    var id = res1._json.task.id;

    var req2 = mockReq({ params: { id: id }, body: { allDay: true } });
    var res2 = mockRes();
    await controller.updateTask(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2._json.task.when).toBe('allday');
  });

  test('preferred_time_mins routes to template', async () => {
    if (!available) return;
    await tasksWrite.insertTask(db, {
      id: 'tmpl-ptm-crud', user_id: USER_ID, task_type: 'recurring_template',
      text: 'Breakfast', dur: 20, pri: 'P3', recurring: 1, status: '',
      preferred_time: 1, recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await tasksWrite.insertTask(db, {
      id: 'inst-ptm-crud', user_id: USER_ID, task_type: 'recurring_instance',
      source_id: 'tmpl-ptm-crud', recurring: 1, status: '',
      scheduled_at: '2026-04-10 11:00:00',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    var req = mockReq({ params: { id: 'inst-ptm-crud' }, body: { preferredTimeMins: 420, timeFlex: 60 } });
    var res = mockRes();
    await controller.updateTask(req, res);

    var tmpl = await db('tasks_v').where('id', 'tmpl-ptm-crud').first();
    expect(tmpl.preferred_time_mins).toBe(420);
    expect(tmpl.time_flex).toBe(60);
    // scheduled_at should NOT be on the template
    var inst = await db('tasks_v').where('id', 'inst-ptm-crud').first();
    expect(inst.scheduled_at).toBe('2026-04-10 11:00:00'); // unchanged
  });

  test('juggler-originated cal-synced task remains editable (fast path)', async () => {
    if (!available) return;
    var id = await seedCalSyncTask(
      { text: 'Juggler origin', date: '4/10', time: '9:00 AM' },
      { provider: 'gcal', provider_event_id: 'evt-123', origin: 'juggler', status: 'active' }
    );
    var req = mockReq({ params: { id: id }, body: { text: 'Updated' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json.task.text).toBe('Updated');
  });

  test('ingested cal-synced task blocks edits (fast path)', async () => {
    if (!available) return;
    var id = await seedCalSyncTask(
      { text: 'Ingested origin', date: '4/10', time: '9:00 AM' },
      { provider: 'gcal', provider_event_id: 'evt-456', origin: 'gcal', status: 'active' }
    );
    var req = mockReq({ params: { id: id }, body: { text: 'Should fail' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._json.code).toBe('CAL_SYNCED_READONLY');
  });

  test('ingested cal-synced task blocks placementMode change (replaces stale date_pinned C-1)', async () => {
    if (!available) return;
    // date_pinned was removed in feat(when-mode); placement_mode='fixed' is the
    // sole immovability signal. Cal-ingested tasks have placement_mode set by the
    // cal adapter. checkCalSyncEditGuard blocks all field changes except status/notes
    // on origin!='juggler' tasks — including placementMode changes.
    var id = await seedCalSyncTask(
      { text: 'Ingested pinned', date: '4/10', time: '9:00 AM', placementMode: 'fixed' },
      { provider: 'gcal', provider_event_id: 'evt-pinned', origin: 'gcal', status: 'active' }
    );
    // Pre-condition: placement_mode='fixed' was set on create
    var before = await db('task_masters').where('id', id).first();
    expect(before.placement_mode).toBe('fixed');

    // Attempt to change placementMode on an ingested task → blocked (403 CAL_SYNCED_READONLY)
    var req = mockReq({ params: { id: id }, body: { placementMode: 'anytime' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._json.code).toBe('CAL_SYNCED_READONLY');

    // placement_mode must remain 'fixed'
    var after = await db('task_masters').where('id', id).first();
    expect(after.placement_mode).toBe('fixed');
  });

  test('ingested cal-synced task blocks when and allows notes', async () => {
    if (!available) return;
    var id = await seedCalSyncTask(
      { text: 'Ingested complex', when: 'morning' },
      { provider: 'msft', provider_event_id: 'evt-789', origin: 'msft', status: 'active' }
    );

    // Complex path: edit `when` → blocked
    var req2 = mockReq({ params: { id: id }, body: { when: 'afternoon' } });
    var res2 = mockRes();
    await controller.updateTask(req2, res2);
    expect(res2.statusCode).toBe(403);
    expect(res2._json.code).toBe('CAL_SYNCED_READONLY');

    // Allowed field: notes → succeeds
    var req3 = mockReq({ params: { id: id }, body: { notes: 'Added note' } });
    var res3 = mockRes();
    await controller.updateTask(req3, res3);
    expect(res3.statusCode).toBe(200);
    expect(res3._json.task.notes).toBe('Added note');
  });

  test('juggler-originated edit writes to DB, not just response', async () => {
    if (!available) return;
    var id = await seedCalSyncTask(
      { text: 'DB verify', date: '4/10', time: '9:00 AM' },
      { provider: 'gcal', provider_event_id: 'evt-db', origin: 'juggler', status: 'active' }
    );
    var req = mockReq({ params: { id: id }, body: { text: 'DB Updated' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(200);
    var row = await db('tasks_v').where('id', id).first();
    expect(row.text).toBe('DB Updated');
  });

  test('ingested blocked edit leaves DB untouched', async () => {
    if (!available) return;
    var id = await seedCalSyncTask(
      { text: 'Untouched', date: '4/10', time: '9:00 AM' },
      { provider: 'gcal', provider_event_id: 'evt-no-touch', origin: 'gcal', status: 'active' }
    );
    var req = mockReq({ params: { id: id }, body: { text: 'Nope' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._json.blockedFields).toContain('text');
    var row = await db('tasks_v').where('id', id).first();
    expect(row.text).toBe('Untouched');
  });

  test('mixed allowed + blocked fields rejected', async () => {
    if (!available) return;
    var id = await seedCalSyncTask(
      { text: 'Mixed', date: '4/10', time: '9:00 AM' },
      { provider: 'gcal', provider_event_id: 'evt-mix', origin: 'gcal', status: 'active' }
    );
    var req = mockReq({ params: { id: id }, body: { text: 'Blocked', notes: 'Allowed' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(403);
    var row = await db('tasks_v').where('id', id).first();
    expect(row.text).toBe('Mixed');
  });

  test('inactive ledger row makes task editable', async () => {
    if (!available) return;
    await tasksWrite.insertTask(db, { id: 'inact-led', user_id: USER_ID, task_type: 'task', text: 'Inactive ledger', status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('cal_sync_ledger').insert({
      task_id: 'inact-led', user_id: USER_ID, provider: 'gcal',
      provider_event_id: 'evt-inact', origin: 'gcal', status: 'deleted',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var req = mockReq({ params: { id: 'inact-led' }, body: { text: 'Edited' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(200);
    var row = await db('tasks_v').where('id', 'inact-led').first();
    expect(row.text).toBe('Edited');
  });

  test('multi-provider origin collision prefers non-juggler', async () => {
    if (!available) return;
    await tasksWrite.insertTask(db, { id: 'multi-prov', user_id: USER_ID, task_type: 'task', text: 'Multi', status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    await db('cal_sync_ledger').insert({
      task_id: 'multi-prov', user_id: USER_ID, provider: 'gcal',
      provider_event_id: 'evt-g', origin: 'juggler', status: 'active',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db('cal_sync_ledger').insert({
      task_id: 'multi-prov', user_id: USER_ID, provider: 'msft',
      provider_event_id: 'evt-m', origin: 'msft', status: 'active',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var req = mockReq({ params: { id: 'multi-prov' }, body: { text: 'Blocked' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(403);
  });

  test('ingested task with _allowUnfix can clear placementMode=fixed (replaces stale date_pinned)', async () => {
    if (!available) return;
    // REAL BUG (task.controller.js): After feat(when-mode) removed datePinned, the
    // _allowUnfix bypass was NOT updated to allow placementMode changes through
    // checkCalSyncEditGuard. The guard's allowed list is ['status','notes','_allowUnfix'];
    // 'placementMode' is not in it. So { placementMode:'anytime', _allowUnfix:true }
    // is still blocked with 403 CAL_SYNCED_READONLY.
    // Fix required: add 'placementMode' to the allowed list in checkCalSyncEditGuard
    // when _allowUnfix is present, OR check _allowUnfix before the guard fires.
    var id = await seedCalSyncTask(
      { text: 'AllowUnfix', date: '4/10', time: '9:00 AM', placementMode: 'fixed' },
      { provider: 'apple', provider_event_id: 'evt-unfix', origin: 'apple', status: 'active' }
    );
    // Pre-condition: task has placement_mode='fixed'
    var before = await db('task_masters').where('id', id).first();
    expect(before.placement_mode).toBe('fixed');

    // _allowUnfix=true should permit clearing placement_mode on a cal-linked task
    var req = mockReq({ params: { id: id }, body: { placementMode: 'anytime', _allowUnfix: true } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(200);
    var after = await db('task_masters').where('id', id).first();
    expect(after.placement_mode).toBe('anytime');
  });

  test('wrong-user cannot edit cal-synced task', async () => {
    if (!available) return;
    var id = await seedCalSyncTask(
      { text: 'Wrong user', date: '4/10', time: '9:00 AM' },
      { provider: 'gcal', provider_event_id: 'evt-wrong', origin: 'gcal', status: 'active' }
    );
    var req = mockReq({ user: { id: 'other-user' }, params: { id: id }, body: { text: 'Hacked' } });
    var res = mockRes();
    await controller.updateTask(req, res);
    expect(res.statusCode).toBe(404);
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

    // R55 no-hard-delete: the task is KEPT as a record, soft-cancelled
    // (status='cancelled'), not physically removed.
    var row = await db('tasks_v').where('id', id).first();
    expect(row).toBeDefined();
    expect(row.status).toBe('cancelled');
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
    await tasksWrite.insertTask(db, {
      id: 'dep-parent', user_id: USER_ID, task_type: 'task',
      text: 'Parent', status: '', depends_on: '[]',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await tasksWrite.insertTask(db, {
      id: 'dep-child', user_id: USER_ID, task_type: 'task',
      text: 'Child', status: '', depends_on: '["dep-parent"]',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    var req = mockReq({ params: { id: 'dep-parent' }, query: {} });
    var res = mockRes();
    await controller.deleteTask(req, res);

    var child = await db('tasks_v').where('id', 'dep-child').first();
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

  test('done on one split chunk does NOT touch siblings (chunk-only, 999.1220)', async () => {
    if (!available) return;
    var crypto = require('crypto');
    // Simulate a recurring master with 2 split chunks on the same date. We
    // create the rows directly (bypassing createTask) so the test exercises
    // updateTaskStatus's sibling-propagation gate without going through the
    // full recurring expansion pipeline.
    //
    // 999.1220 (David ruling 2026-07-06): done = THIS chunk only, everywhere.
    // The old propagate-to-all expectation (siblingsUpdated 1, chunk 2 done)
    // is REVERSED — non-done statuses (skip/cancel) still propagate; see
    // tests/scheduler/splitStatusPropagation.test.js for the full matrix.
    //
    // NOTE: action_log.task_id is VARCHAR(36). Using a full UUID (36 chars)
    // as masterId and appending '-20260416' would exceed that limit (45 chars).
    // Use a short deterministic prefix so chunk IDs stay within 36 chars.
    var masterShort = 'sc-' + crypto.randomUUID().slice(0, 28); // 31 chars
    var masterId = masterShort;
    var chunk1Id = masterShort.slice(0, 27) + '-c1'; // 30 chars
    var chunk2Id = masterShort.slice(0, 27) + '-c2'; // 30 chars
    var now = new Date();

    await db('task_masters').insert({
      id: masterId, user_id: USER_ID, text: 'Split recurring', dur: 60,
      pri: 'P3', recurring: 1, split: 1, split_min: 30,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
      created_at: now, updated_at: now,
    });
    for (var i = 0; i < 2; i++) {
      await db('task_instances').insert({
        id: i === 0 ? chunk1Id : chunk2Id,
        master_id: masterId, user_id: USER_ID,
        occurrence_ordinal: 1, split_ordinal: i + 1, split_total: 2,
        scheduled_at: new Date(Date.parse('2026-04-16T14:00:00Z') + i * 3600000),
        dur: 30, status: '', generated: 0,
        created_at: now, updated_at: now,
      });
    }

    // Mark chunk 1 done via updateTaskStatus.
    var req = mockReq({ params: { id: chunk1Id }, body: { status: 'done' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);
    expect(res._json.task.status).toBe('done');
    expect(res._json.siblingsUpdated).toBe(0); // done is chunk-only

    // Chunk 2 must be UNTOUCHED.
    var chunk2Row = await db('task_instances').where({ id: chunk2Id }).first();
    expect(chunk2Row.status).toBe('');
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

    var count = await db('tasks_v').where('user_id', USER_ID).count('* as c').first();
    expect(parseInt(count.c)).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// unpinTask
// ═══════════════════════════════════════════════════════════════

xdescribe('unpinTask — endpoint removed', () => {
  test('restores prev_when and clears date_pinned', async () => {
    if (!available) return;
    await tasksWrite.insertTask(db, {
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

    var row = await db('tasks_v').where('id', 'unpin-test').first();
    expect(row.date_pinned).toBeFalsy();
    expect(row.when).toBe('morning');
  });
});
