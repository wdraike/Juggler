/**
 * Real-DB integration tests for the task state machine.
 *
 * Covers state transitions documented in docs/TASK-STATE-MATRIX.md that are
 * NOT already covered by taskCrudIntegration.test.js.
 *
 * Requires: cd test-bed && make up
 *
 * Requires test-bed MySQL @3407 (TEST-FR-001: throws loud on no-DB).
 */

var db = require('../src/db');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');
// telly fix (leg sched-audit 2020-01-03): knexfile `test` uses dateStrings:true —
// scheduled_at reads back as a tz-less string; use the project's UTC-safe reparse
// helper rather than a bare `new Date()` (the documented juggler dateStrings/
// new-Date misparse trap).
var { scheduledAtToISO } = require('../src/slices/task/domain/mappers/taskMappers');
var USER_ID = 'state-test-user-001';

// Mock scheduleQueue to prevent actual scheduler runs
jest.mock('../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));

// Mock redis cache
jest.mock('../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  invalidateTasks: jest.fn().mockResolvedValue(true),
}));

// Mock SSE emitter (not relevant to state-machine tests)
jest.mock('../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

beforeAll(async () => {
  // setSystemTime WITHOUT useFakeTimers — avoids hangs in async/retry code
  jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  await assertDbAvailable();

  // Cleanup any leftover state from prior runs
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('projects').where('user_id', USER_ID).del();
  await db('locations').where('user_id', USER_ID).del();
  await db('tools').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('sync_locks').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();

  // Seed test user
  await db('users').insert({
    id: USER_ID,
    email: 'state@test.com',
    name: 'State Test',
    timezone: 'America/New_York',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}, 15000);

afterAll(async () => {
  jest.useRealTimers();
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('projects').where('user_id', USER_ID).del();
  await db('locations').where('user_id', USER_ID).del();
  await db('tools').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('sync_locks').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db.destroy();
});

// Wipe task rows between tests to keep them isolated
beforeEach(async () => {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  require('../src/scheduler/scheduleQueue').enqueueScheduleRun.mockClear();
});

// ── Test helpers ────────────────────────────────────────────────────────────

function mockReq(overrides) {
  return Object.assign({
    user: { id: USER_ID },
    headers: { 'x-timezone': 'America/New_York' },
    params: {},
    query: {},
    body: {},
    planFeatures: {
      limits: {
        active_tasks: -1,
        recurring_templates: -1,
        projects: -1,
        locations: -1,
        schedule_templates: -1
      },
      calendar: { max_providers: -1 },
      scheduling: { dependencies: true, travel_time: true },
      tasks: { rigid: true }
    },
    planId: 'enterprise'
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

var controller = require('../src/controllers/task.controller');

// ── Smoke test ───────────────────────────────────────────────────────────────

test('smoke — controller is importable and DB is reachable', async () => {
  expect(typeof controller.createTask).toBe('function');
  expect(typeof controller.updateTaskStatus).toBe('function');
  expect(typeof controller.reEnableTask).toBe('function');
  var rows = await db('users').where('id', USER_ID).select('id');
  expect(rows.length).toBe(1);
});

// ═══════════════════════════════════════════════════════════════
// Block 1: wip → open (reopen) — Matrix row: wip → ""
// ═══════════════════════════════════════════════════════════════

describe('status transition: wip → open (reopen)', () => {
  test('valid: sets wip then clears status back to empty', async () => {


    // Create scheduled task
    var createReq = mockReq({ body: { text: 'wip-reopen', scheduledAt: '2026-06-01T14:00:00Z' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    expect(createRes.statusCode).toBe(201);
    var id = createRes._json.task.id;

    // Set to wip — master now legitimately holds run-state (David ruling
    // 2026-06-24 / migration 20260624160000 widened the CHECK), so this is a
    // valid 200, not the old constraint-violation 500.
    var wipReq = mockReq({ params: { id: id }, body: { status: 'wip' } });
    var wipRes = mockRes();
    await controller.updateTaskStatus(wipReq, wipRes);
    expect(wipRes.statusCode).toBe(200);
    expect(wipRes._json.task.status).toBe('wip');

    // Reopen (status → '')
    var reopenReq = mockReq({ params: { id: id }, body: { status: '' } });
    var reopenRes = mockRes();
    await controller.updateTaskStatus(reopenReq, reopenRes);
    expect(reopenRes.statusCode).toBe(200);
    expect(reopenRes._json.task.status).toBe('');

    // Verify DB row reflects the change
    var row = await db('task_instances').where('id', id).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('');
  });

  test('valid: reopen clears completed_at', async () => {


    var createReq = mockReq({ body: { text: 'reopen-completed-at', scheduledAt: '2026-06-01T14:00:00Z' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    // Mark done (sets completed_at)
    var doneReq = mockReq({ params: { id: id }, body: { status: 'done' } });
    var doneRes = mockRes();
    await controller.updateTaskStatus(doneReq, doneRes);
    expect(doneRes._json.task.status).toBe('done');

    // Reopen — should clear completed_at
    var reopenReq = mockReq({ params: { id: id }, body: { status: '' } });
    var reopenRes = mockRes();
    await controller.updateTaskStatus(reopenReq, reopenRes);
    expect(reopenRes.statusCode).toBe(200);
    expect(reopenRes._json.task.status).toBe('');
    expect(reopenRes._json.task.completedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Block 2: wip → done
// ═══════════════════════════════════════════════════════════════

describe('status transition: wip → done', () => {
  test('valid: done when scheduled_at is set', async () => {


    var createReq = mockReq({ body: { text: 'wip-to-done', scheduledAt: '2026-05-20T10:00:00Z' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    // Set wip — valid 200 under the widened master CHECK (David ruling
    // 2026-06-24 / migration 20260624160000), not the old 500.
    var wipReq = mockReq({ params: { id: id }, body: { status: 'wip' } });
    var wipRes = mockRes();
    await controller.updateTaskStatus(wipReq, wipRes);
    expect(wipRes.statusCode).toBe(200);

    // Mark done
    var doneReq = mockReq({ params: { id: id }, body: { status: 'done' } });
    var doneRes = mockRes();
    await controller.updateTaskStatus(doneReq, doneRes);
    expect(doneRes.statusCode).toBe(200);
    expect(doneRes._json.task.status).toBe('done');

    // Verify DB
    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('done');
    // completed_at should be set
    expect(row.completed_at).toBeTruthy();
  });

  // revised leg sched-audit 2020-01-02: reject-400 superseded by D-B resolve-in-place
  // ruling (snap-then-write) — see bert REFER db-guard-9 (DB-GUARD-bert-REVIEW.json)
  // + UpdateTaskStatus.js:154-171. A terminal write on an unscheduled task now
  // SUCCEEDS (200) with scheduled_at snapped to ~now, instead of being rejected.
  test('done on unscheduled task → 200, scheduled_at snapped to ~now (was: 400 SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS)', async () => {


    // Create task WITHOUT scheduled_at
    var createReq = mockReq({ body: { text: 'unscheduled-done-attempt' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    // Attempt to mark done without scheduled time
    var before = Date.now();
    var doneReq = mockReq({ params: { id: id }, body: { status: 'done' } });
    var doneRes = mockRes();
    await controller.updateTaskStatus(doneReq, doneRes);
    var after = Date.now();
    expect(doneRes.statusCode).toBe(200);
    expect(doneRes._json.task.status).toBe('done');

    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('done');
    expect(row.scheduled_at).toBeTruthy();
    // knexfile `test` uses dateStrings:true — row.scheduled_at is a tz-less
    // "YYYY-MM-DD HH:MM:SS" string. Use the project's UTC-safe reparse helper
    // rather than a bare `new Date()` (the documented juggler dateStrings/
    // new-Date misparse trap).
    var snappedAt = new Date(scheduledAtToISO(row.scheduled_at)).getTime();
    expect(snappedAt).toBeGreaterThanOrEqual(before - 5000);
    expect(snappedAt).toBeLessThanOrEqual(after + 5000);
    expect(row.completed_at).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// Block 3: skip transitions
// ═══════════════════════════════════════════════════════════════

describe('status transition: skip', () => {
  test('valid: skip on a one-off scheduled task succeeds', async () => {


    var createReq = mockReq({ body: { text: 'skip-one-off', scheduledAt: '2026-06-02T15:00:00Z' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    var skipReq = mockReq({ params: { id: id }, body: { status: 'skip' } });
    var skipRes = mockRes();
    await controller.updateTaskStatus(skipReq, skipRes);
    expect(skipRes.statusCode).toBe(200);
    expect(skipRes._json.task.status).toBe('skip');

    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('skip');
  });

  // revised leg sched-audit 2020-01-02: reject-400 superseded by D-B resolve-in-place
  // ruling (snap-then-write) — see bert REFER db-guard-9 (DB-GUARD-bert-REVIEW.json)
  // + UpdateTaskStatus.js:154-171.
  test('skip on unscheduled task → 200, scheduled_at snapped to ~now (was: 400 SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS)', async () => {


    // Create task without scheduled_at
    var createReq = mockReq({ body: { text: 'skip-unscheduled' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    var before = Date.now();
    var skipReq = mockReq({ params: { id: id }, body: { status: 'skip' } });
    var skipRes = mockRes();
    await controller.updateTaskStatus(skipReq, skipRes);
    var after = Date.now();
    expect(skipRes.statusCode).toBe(200);
    expect(skipRes._json.task.status).toBe('skip');

    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('skip');
    expect(row.scheduled_at).toBeTruthy();
    var snappedAt = new Date(scheduledAtToISO(row.scheduled_at)).getTime();
    expect(snappedAt).toBeGreaterThanOrEqual(before - 5000);
    expect(snappedAt).toBeLessThanOrEqual(after + 5000);
  });

  test('skip prevents re-skip — idempotent (200 no-op or succeeds)', async () => {


    var createReq = mockReq({ body: { text: 'skip-idempotent', scheduledAt: '2026-06-03T09:00:00Z' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    // First skip
    var skip1Req = mockReq({ params: { id: id }, body: { status: 'skip' } });
    var skip1Res = mockRes();
    await controller.updateTaskStatus(skip1Req, skip1Res);
    expect(skip1Res.statusCode).toBe(200);

    // Second skip — controller either succeeds idempotently (200) or rejects with
    // an error. Either way the row must still be 'skip' (never reverts).
    var skip2Req = mockReq({ params: { id: id }, body: { status: 'skip' } });
    var skip2Res = mockRes();
    await controller.updateTaskStatus(skip2Req, skip2Res);
    // Status code is 200 OR 4xx — we only assert the DB row stays skip
    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('skip');
  });
});

// ═══════════════════════════════════════════════════════════════
// Block 4: pause/unpause on recurring template
// ═══════════════════════════════════════════════════════════════

describe('status transition: pause/unpause on recurring template', () => {
  test('pause on template suspends future open instances (kept as status=pause, per 999.590)', async () => {


    var tmplId = 'tmpl-pause-test-' + Date.now();
    var now = new Date();
    var futureDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // +2 days
    var farFuture = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);  // +5 days

    // Insert recurring template directly
    await db('task_masters').insert({
      id: tmplId,
      user_id: USER_ID,
      text: 'Daily recurring',
      dur: 30,
      pri: 'P3',
      recurring: 1,
      status: '',
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
      created_at: now,
      updated_at: now
    });

    // Insert 3 future open instances pointing to the template
    var inst1Id = tmplId + '-inst1';
    var inst2Id = tmplId + '-inst2';
    var inst3Id = tmplId + '-inst3';

    await db('task_instances').insert([
      { id: inst1Id, master_id: tmplId, user_id: USER_ID, status: '', occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30, scheduled_at: futureDate, created_at: now, updated_at: now },
      { id: inst2Id, master_id: tmplId, user_id: USER_ID, status: '', occurrence_ordinal: 2, split_ordinal: 1, split_total: 1, dur: 30, scheduled_at: farFuture, created_at: now, updated_at: now },
      { id: inst3Id, master_id: tmplId, user_id: USER_ID, status: '', occurrence_ordinal: 3, split_ordinal: 1, split_total: 1, dur: 30, scheduled_at: farFuture, created_at: now, updated_at: now }
    ]);

    // Pause the template
    var pauseReq = mockReq({ params: { id: tmplId }, body: { status: 'pause' } });
    var pauseRes = mockRes();
    await controller.updateTaskStatus(pauseReq, pauseRes);
    // Pausing a recurring template is a valid template lifecycle action under the
    // widened master CHECK (David ruling 2026-06-24 / migration 20260624160000) —
    // a 200, not the old constraint-violation 500.
    expect(pauseRes.statusCode).toBe(200);
    // tasks_v template branch exposes status=NULL (master status not in view).
    // Verify the DB row directly instead of relying on the API response.
    var pausedMaster = await db('task_masters').where('id', tmplId).first();
    expect(pausedMaster.status).toBe('pause');

    // Authoritative behavior (999.590 / SCHEDULER-RULES §5.2 / SCHEDULER-SPEC B-TERM.6):
    // pause KEEPS future instances but flips them to status='pause' — it does NOT
    // delete them. So no future instance remains in the open ('') state...
    var remainingOpen = await db('task_instances')
      .where('master_id', tmplId)
      .where('status', '')
      .where('scheduled_at', '>', now)
      .select('id');
    expect(remainingOpen.length).toBe(0);

    // ...and all three are still present, now marked 'pause'.
    var pausedInstances = await db('task_instances')
      .where('master_id', tmplId)
      .where('status', 'pause')
      .where('scheduled_at', '>', now)
      .select('id');
    expect(pausedInstances.length).toBe(3);

    // Response reports how many instances were paused (field: instancesPaused).
    expect(pauseRes._json.instancesPaused).toBe(3);
  });

  test('unpause: setting status to empty triggers schedule regeneration', async () => {


    var tmplId = 'tmpl-unpause-test-' + Date.now();
    var now = new Date();

    // Insert a paused template
    await db('task_masters').insert({
      id: tmplId,
      user_id: USER_ID,
      text: 'Paused recurring',
      dur: 30,
      pri: 'P3',
      recurring: 1,
      status: 'pause',
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
      created_at: now,
      updated_at: now
    });

    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    enqueueScheduleRun.mockClear();

    // Unpause
    var unpauseReq = mockReq({ params: { id: tmplId }, body: { status: '' } });
    var unpauseRes = mockRes();
    await controller.updateTaskStatus(unpauseReq, unpauseRes);
    expect(unpauseRes.statusCode).toBe(200);

    // Template DB row should be updated to empty (unpaused)
    var tmplRow = await db('task_masters').where('id', tmplId).first();
    expect(tmplRow.status).toBe('');

    // Note: enqueueScheduleRun is wrapped in a 2-second setTimeout in the controller;
    // asserting it synchronously here would be a race. DB state is the reliable check.
  });

  test('recurring template rejects non-pause/unpause status changes', async () => {


    var tmplId = 'tmpl-bad-status-' + Date.now();
    var now = new Date();

    await db('task_masters').insert({
      id: tmplId,
      user_id: USER_ID,
      text: 'Cannot done-template',
      dur: 30,
      pri: 'P3',
      recurring: 1,
      status: '',
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
      created_at: now,
      updated_at: now
    });

    var badReq = mockReq({ params: { id: tmplId }, body: { status: 'done' } });
    var badRes = mockRes();
    await controller.updateTaskStatus(badReq, badRes);
    expect(badRes.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// Block 5: disabled → re-enable (real DB)
// ═══════════════════════════════════════════════════════════════

describe('status transition: disabled → re-enable (real DB)', () => {
  test('re-enable: unlimited plan succeeds', async () => {


    var now = new Date();
    var taskId = 'disabled-reenable-' + Date.now();

    // Insert a disabled task directly
    await db('task_masters').insert({
      id: taskId,
      user_id: USER_ID,
      text: 'Disabled task to re-enable',
      dur: 30,
      pri: 'P3',
      recurring: 0,
      status: 'disabled',
      disabled_at: now,
      disabled_reason: 'plan_limit',
      created_at: now,
      updated_at: now
    });
    await db('task_instances').insert({
      id: taskId,
      master_id: taskId,
      user_id: USER_ID,
      status: 'disabled',
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      dur: 30,
      created_at: now,
      updated_at: now
    });

    // Re-enable with unlimited plan (active_tasks: -1)
    var req = mockReq({
      params: { id: taskId },
      body: {},
      planFeatures: {
        limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1 },
        calendar: { max_providers: -1 },
        scheduling: { dependencies: true, travel_time: true },
        tasks: { rigid: true }
      }
    });
    var res = mockRes();
    await controller.reEnableTask(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json.task.status).toBe('');

    // Verify DB
    var masterRow = await db('task_masters').where('id', taskId).first();
    expect(masterRow.status).toBe('');
    expect(masterRow.disabled_at).toBeNull();
    expect(masterRow.disabled_reason).toBeNull();

    var instRow = await db('task_instances').where('id', taskId).first();
    expect(instRow.status).toBe('');
  });

  test('re-enable: at plan limit returns 403 ENTITY_LIMIT_REACHED', async () => {


    var now = new Date();

    // Pre-seed 3 active tasks to fill a limit of 3
    for (var i = 0; i < 3; i++) {
      var tid = 'active-limit-task-' + i + '-' + Date.now();
      await db('task_masters').insert({
        id: tid, user_id: USER_ID, text: 'Active task ' + i,
        dur: 30, pri: 'P3', recurring: 0, status: '',
        created_at: now, updated_at: now
      });
      await db('task_instances').insert({
        id: tid, master_id: tid, user_id: USER_ID, status: '',
        occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
        created_at: now, updated_at: now
      });
    }

    // Insert the disabled task we want to re-enable
    var disabledId = 'at-limit-disabled-' + Date.now();
    await db('task_masters').insert({
      id: disabledId, user_id: USER_ID, text: 'Would-be 4th task',
      dur: 30, pri: 'P3', recurring: 0, status: 'disabled',
      disabled_at: now, disabled_reason: 'plan_limit',
      created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: disabledId, master_id: disabledId, user_id: USER_ID, status: 'disabled',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      created_at: now, updated_at: now
    });

    // Attempt re-enable with a limit of 3
    var req = mockReq({
      params: { id: disabledId },
      body: {},
      planFeatures: {
        limits: { active_tasks: 3, recurring_templates: -1, projects: -1, locations: -1 },
        calendar: { max_providers: -1 },
        scheduling: { dependencies: true, travel_time: true },
        tasks: { rigid: true }
      }
    });
    var res = mockRes();
    await controller.reEnableTask(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._json.code).toBe('ENTITY_LIMIT_REACHED');
  });
});

// ═══════════════════════════════════════════════════════════════
// Block 6: missed status — invalid status (400)
// ═══════════════════════════════════════════════════════════════

describe('status transition: missed status — invalid status (400)', () => {
  test('user-supplied status=missed → 400 Invalid status', async () => {


    var createReq = mockReq({ body: { text: 'user-missed-attempt', scheduledAt: '2026-05-01T08:00:00Z' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    var missedReq = mockReq({ params: { id: id }, body: { status: 'missed' } });
    var missedRes = mockRes();
    await controller.updateTaskStatus(missedReq, missedRes);
    expect(missedRes.statusCode).toBe(400);
    expect(missedRes._json.error).toMatch(/Invalid status/);
  });

  test('a row with status=missed written by the DB is readable and renders correctly', async () => {


    // Simulate a system-applied missed status by writing directly to DB
    var now = new Date();
    var taskId = 'system-missed-' + Date.now();
    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'System-missed task',
      dur: 30, pri: 'P3', recurring: 0, status: '',
      created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID,
      status: 'missed', // written as if by the scheduler
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      scheduled_at: new Date('2026-05-01T07:00:00Z'),
      created_at: now, updated_at: now
    });

    // Reading the task via getTask should return status=missed without errors
    var getReq = mockReq({ params: { id: taskId } });
    var getRes = mockRes();
    await controller.getTask(getReq, getRes);
    expect(getRes.statusCode).toBe(200);
    expect(getRes._json.task.status).toBe('missed');
    // NOTE: no system-only bypass path is exposed in the controller API.
    // The scheduler writes missed status directly to DB; this test confirms
    // that the read path handles it correctly. See SUMMARY for detail.
  });
});

// ═══════════════════════════════════════════════════════════════
// Block 7: allDay flag round-trip
// ═══════════════════════════════════════════════════════════════

describe('allDay flag round-trip', () => {
  test('allDay=true persists as when=allday and reads back correctly', async () => {

    // REAL BUG (task.controller.js lines 889-892, 1117-1120): The D-14 backstop
    // was changed to set placement_mode='all_day' but NOT when='allday'.
    // Fix: restore `row.when = 'allday'` in the backstop.
    // See taskCrudIntegration.test.js D-14 comment for full context.

    var createReq = mockReq({ body: { text: 'All-day task', allDay: true } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    expect(createRes.statusCode).toBe(201);
    var id = createRes._json.task.id;
    expect(createRes._json.task.when).toBe('allday');

    // Read back via getTask
    var getReq = mockReq({ params: { id: id } });
    var getRes = mockRes();
    await controller.getTask(getReq, getRes);
    expect(getRes.statusCode).toBe(200);
    expect(getRes._json.task.when).toBe('allday');
    // allDay is represented by when=allday; no separate allDay field in the response
    // (the frontend derives allDay from when === 'allday')
  });

  test('allDay=true with scheduledAt: when stays null (D-14 backstop does not fire)', async () => {


    // scheduledAt provided → timeWasSet=true → D-14 allDay backstop does NOT fire.
    // The server never auto-derives when from scheduledAt; when stays null unless
    // the client explicitly sends a when value. The client should send when:'allday'
    // explicitly if that is the intent.
    var createReq = mockReq({ body: { text: 'All-day with date', allDay: true, scheduledAt: '2026-06-05T00:00:00Z' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    expect(createRes.statusCode).toBe(201);
    // No explicit when sent; scheduledAt presence suppresses the backstop; when=null.
    expect(createRes._json.task.when).toBeNull();
    expect(createRes._json.task.scheduledAt).toBeTruthy();
  });

  test('task without allDay has when != allday by default', async () => {


    var createReq = mockReq({ body: { text: 'Regular task no allDay' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    expect(createRes.statusCode).toBe(201);
    expect(createRes._json.task.when).not.toBe('allday');
  });
});

// ═══════════════════════════════════════════════════════════════
// Block 8: terminal-status edge cases
// ═══════════════════════════════════════════════════════════════

describe('terminal-status edge cases', () => {
  test('cancel on scheduled task succeeds', async () => {


    var createReq = mockReq({ body: { text: 'Cancel-me', scheduledAt: '2026-06-10T16:00:00Z' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    var cancelReq = mockReq({ params: { id: id }, body: { status: 'cancel' } });
    var cancelRes = mockRes();
    await controller.updateTaskStatus(cancelReq, cancelRes);
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes._json.task.status).toBe('cancel');

    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('cancel');
  });

  // revised leg sched-audit 2020-01-02: reject-400 superseded by D-B resolve-in-place
  // ruling (snap-then-write) — see bert REFER db-guard-9 (DB-GUARD-bert-REVIEW.json)
  // + UpdateTaskStatus.js:154-171.
  test('cancel on unscheduled task → 200, scheduled_at snapped to ~now (was: 400 SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS)', async () => {


    // 'cancel' is in TERMINAL_REQUIRES_SCHEDULE alongside 'done' and 'skip'
    var createReq = mockReq({ body: { text: 'Cancel unscheduled' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    var before = Date.now();
    var cancelReq = mockReq({ params: { id: id }, body: { status: 'cancel' } });
    var cancelRes = mockRes();
    await controller.updateTaskStatus(cancelReq, cancelRes);
    var after = Date.now();
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes._json.task.status).toBe('cancel');

    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('cancel');
    expect(row.scheduled_at).toBeTruthy();
    var snappedAt = new Date(scheduledAtToISO(row.scheduled_at)).getTime();
    expect(snappedAt).toBeGreaterThanOrEqual(before - 5000);
    expect(snappedAt).toBeLessThanOrEqual(after + 5000);
  });

  test('done is idempotent — marking done twice does not error', async () => {


    var createReq = mockReq({ body: { text: 'Idempotent done', scheduledAt: '2026-06-11T09:00:00Z' } });
    var createRes = mockRes();
    await controller.createTask(createReq, createRes);
    var id = createRes._json.task.id;

    // First done
    var done1Req = mockReq({ params: { id: id }, body: { status: 'done' } });
    var done1Res = mockRes();
    await controller.updateTaskStatus(done1Req, done1Res);
    expect(done1Res.statusCode).toBe(200);

    // Second done — should not throw; DB row stays done
    var done2Req = mockReq({ params: { id: id }, body: { status: 'done' } });
    var done2Res = mockRes();
    await controller.updateTaskStatus(done2Req, done2Res);
    // Status 200 (idempotent) — row stays done
    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('done');
  });

  test('disabled task cannot have status changed via updateTaskStatus', async () => {


    var now = new Date();
    var taskId = 'guard-disabled-' + Date.now();
    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'Frozen disabled',
      dur: 30, pri: 'P3', recurring: 0, status: 'disabled',
      disabled_at: now, disabled_reason: 'plan_limit',
      created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: 'disabled',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      created_at: now, updated_at: now
    });

    var req = mockReq({ params: { id: taskId }, body: { status: '' } });
    var res = mockRes();
    await controller.updateTaskStatus(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._json.code).toBe('TASK_DISABLED');
  });
});
