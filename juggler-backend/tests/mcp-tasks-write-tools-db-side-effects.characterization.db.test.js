/**
 * mcp-tasks-write-tools-db-side-effects.characterization.db.test.js
 *
 * jug-mcp-facade — characterization_target #1 (Intake Brief): "Real-DB
 * (test-bed, 3407) characterization tests for tasks.js's CURRENT
 * (pre-migration) behavior on create_task/create_tasks/update_task/
 * batch_update_tasks/set_task_status/delete_task: response body shape,
 * error strings for {not-found, validation, cal-synced-blocked-fields,
 * fixed-mode-missing-date/time, terminal-on-unscheduled-REJECT}, and DB
 * side effects (rows written/deleted, cal_sync_ledger updates)."
 *
 * SCOPE NOTE: extensive validation-error-string and response-shape coverage
 * for these tools already exists as REAL, non-tautological assertions in
 * mcp-create-task-boundary.test.js, mcp-create-tasks.test.js,
 * mcp-update-task.test.js, mcp-http-calsync-divergence.test.js, and the
 * terminal-on-unscheduled-REJECT string is already pinned end-to-end
 * (real DB) by mcp-terminal-schedule-guard.test.js (999.895) — this file
 * does NOT re-duplicate those; it closes the specific residual gap the
 * brief calls out: those suites drive an in-memory MOCK db (asserting
 * insertTask/updateTaskById were CALLED with certain args), not a REAL
 * database write. This file re-drives the same tool handlers against
 * test-bed MySQL and asserts the row that actually LANDS — the DB-side-
 * effect half of characterization_target #1 that was previously untested.
 * delete_task's real-DB side effects are pinned separately in
 * mcp-delete-task-characterization.db.test.js (kept out of this file to
 * avoid an oversized single suite).
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-tasks-dbfx-001';

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn(), emitTasksChanged: jest.fn() };
});

var { registerTaskTools } = require('../src/mcp/tools/tasks');

function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = { tool: function (name, _desc, _schema, handler) { handlers[name] = handler; } };
  registerTaskTools(fakeServer, userId);
  return handlers;
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

describe('MCP tasks.js write tools — real-DB side effects (BEFORE facade migration)', function () {

  beforeAll(async function () {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    await assertDbAvailable();
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
    await db('users').insert({
      id: USER_ID, email: 'mcp-tasks-dbfx@test.invalid', name: 'MCP tasks db-fx test',
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    });
  }, 15000);

  afterEach(async function () {
    jest.useRealTimers();
    await clearUserTasks();
  });

  afterAll(async function () {
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
  }, 10000);

  // ── create_task ─────────────────────────────────────────────────────────

  test('create_task: REAL row lands in task_masters + task_instances; response envelope is the bare task object', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({ text: 'Real DB create probe', dur: 45, pri: 'P2' });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(body.text).toBe('Real DB create probe');
    expect(body.dur).toBe(45);
    expect(body.pri).toBe('P2');
    expect(typeof body.id).toBe('string');
    // Response is the BARE task object today — no {task:...} wrapper, no
    // {status,body} envelope. This is the exact shape the post-migration
    // adapter must reproduce per behavior_contract's unwrap requirement.
    expect(body.status).not.toBe('object');

    var masterRow = await db('task_masters').where('id', body.id).first();
    var instRow = await db('task_instances').where('id', body.id).first();
    expect(masterRow).toBeTruthy();
    expect(masterRow.text).toBe('Real DB create probe');
    expect(instRow).toBeTruthy();
  });

  test('create_task: fixed-mode-missing-date/time -> validation error string, NO row written', async function () {
    // TELLY FINDING: create_task has TWO "fixed requires scheduling info"
    // checks — validateTaskInput's shared check (task.controller.js, fires
    // FIRST at L151-154) wins with "...requires a date, time, or scheduledAt";
    // the tool's OWN inline check at L165-171 ("...requires a date and time.")
    // is dead code for this exact input shape (unreachable — validateTaskInput
    // already rejects it first). Pinning the string that ACTUALLY reaches the
    // caller today, not the one in the inline comment/code that never fires.
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({ text: 'Fixed no date/time', placementMode: 'fixed' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Validation error: placementMode "fixed" requires a date, time, or scheduledAt');

    var rows = await db('task_masters').where({ user_id: USER_ID, text: 'Fixed no date/time' });
    expect(rows.length).toBe(0);
  });

  test('create_task: missing text -> validation error string, NO row written', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({ dur: 30 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Validation error:/);

    var rows = await db('task_masters').where('user_id', USER_ID).select();
    expect(rows.length).toBe(0);
  });

  // ── create_tasks (batch) ────────────────────────────────────────────────

  test('create_tasks: REAL rows land for every item; response is {created, ids}', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_tasks({
      tasks: [{ text: 'batch probe A', dur: 30 }, { text: 'batch probe B', dur: 15 }]
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(body.created).toBe(2);
    expect(Array.isArray(body.ids)).toBe(true);
    expect(body.ids.length).toBe(2);

    var rows = await db('task_masters').where('user_id', USER_ID).whereIn('id', body.ids).select('id', 'text');
    expect(rows.length).toBe(2);
    var texts = rows.map(function (r) { return r.text; }).sort();
    expect(texts).toEqual(['batch probe A', 'batch probe B']);
  });

  // ── update_task ──────────────────────────────────────────────────────────

  test('update_task: not-found -> "Error: Task not found", isError true', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.update_task({ id: 'does-not-exist-' + Date.now(), text: 'x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: Task not found');
  });

  test('update_task: cal-synced task blocks non-allowed fields -> exact error string, DB row UNCHANGED', async function () {
    var now = new Date();
    var taskId = 'mcp-dbfx-calsync-' + Date.now();
    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'Calendar-linked task', dur: 30, pri: 'P3',
      recurring: 0, status: '', created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now
    });
    await db('cal_sync_ledger').insert({
      user_id: USER_ID, task_id: taskId, provider: 'gcal', origin: 'gcal',
      status: 'active', provider_event_id: 'gcal-evt-' + Date.now(), created_at: now, synced_at: now
    });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.update_task({ id: taskId, text: 'Attempted edit' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Error: This task is synced from an external calendar. Only status and notes can be changed. Blocked fields: text'
    );

    var row = await db('task_masters').where('id', taskId).first();
    expect(row.text).toBe('Calendar-linked task'); // UNCHANGED
  });

  test('update_task: REAL row updated in DB for an allowed field', async function () {
    var now = new Date();
    var taskId = 'mcp-dbfx-update-' + Date.now();
    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'Task to update', dur: 30, pri: 'P3',
      recurring: 0, status: '', created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now
    });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.update_task({ id: taskId, text: 'Updated text', pri: 'P1' });

    expect(result.isError).toBeFalsy();
    var row = await db('task_masters').where('id', taskId).first();
    expect(row.text).toBe('Updated text');
    expect(row.pri).toBe('P1');
  });

  // ── set_task_status ─────────────────────────────────────────────────────

  test('set_task_status: not-found -> "Error: Task not found"', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.set_task_status({ id: 'does-not-exist-' + Date.now(), status: 'done' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: Task not found');
  });

  test('set_task_status: REAL status column updated in task_instances', async function () {
    var now = new Date();
    var taskId = 'mcp-dbfx-status-' + Date.now();
    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'Status probe task', dur: 30, pri: 'P3',
      recurring: 0, status: '', created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      scheduled_at: new Date(now.getTime() + 3600000), created_at: now, updated_at: now
    });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.set_task_status({ id: taskId, status: 'done' });

    expect(result.isError).toBeFalsy();
    var row = await db('task_instances').where('id', taskId).first();
    expect(row.status).toBe('done');
  });

  // ── batch_update_tasks ──────────────────────────────────────────────────

  test('batch_update_tasks: cal-synced task in batch blocks non-allowed fields -> exact error string, transaction NOT applied to any item', async function () {
    var now = new Date();
    var calId = 'mcp-dbfx-batch-cal-' + Date.now();
    var plainId = 'mcp-dbfx-batch-plain-' + Date.now();
    await db('task_masters').insert([
      { id: calId, user_id: USER_ID, text: 'Cal task', dur: 30, pri: 'P3', recurring: 0, status: '',
        created_at: now, updated_at: now },
      { id: plainId, user_id: USER_ID, text: 'Plain task', dur: 30, pri: 'P3', recurring: 0, status: '',
        created_at: now, updated_at: now }
    ]);
    await db('task_instances').insert([
      { id: calId, master_id: calId, user_id: USER_ID, status: '', occurrence_ordinal: 1,
        split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now },
      { id: plainId, master_id: plainId, user_id: USER_ID, status: '', occurrence_ordinal: 1,
        split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now }
    ]);
    await db('cal_sync_ledger').insert({
      user_id: USER_ID, task_id: calId, provider: 'gcal', origin: 'gcal',
      status: 'active', provider_event_id: 'gcal-evt-' + Date.now(), created_at: now, synced_at: now
    });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.batch_update_tasks({
      updates: [{ id: calId, text: 'blocked edit' }, { id: plainId, text: 'allowed edit' }]
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Error: This task is synced from an external calendar. Only status and notes can be changed. Blocked fields: text'
    );

    // batch_update_tasks validates the WHOLE batch up-front (before any DB
    // write) — the plain task's edit is never applied either.
    var plainRow = await db('task_masters').where('id', plainId).first();
    expect(plainRow.text).toBe('Plain task');
  });

  test('batch_update_tasks: REAL rows updated for a valid batch; response is {updated: N}', async function () {
    var now = new Date();
    var idA = 'mcp-dbfx-batch-a-' + Date.now();
    var idB = 'mcp-dbfx-batch-b-' + Date.now();
    await db('task_masters').insert([
      { id: idA, user_id: USER_ID, text: 'A', dur: 30, pri: 'P3', recurring: 0, status: '',
        created_at: now, updated_at: now },
      { id: idB, user_id: USER_ID, text: 'B', dur: 30, pri: 'P3', recurring: 0, status: '',
        created_at: now, updated_at: now }
    ]);
    await db('task_instances').insert([
      { id: idA, master_id: idA, user_id: USER_ID, status: '', occurrence_ordinal: 1,
        split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now },
      { id: idB, master_id: idB, user_id: USER_ID, status: '', occurrence_ordinal: 1,
        split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now }
    ]);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.batch_update_tasks({
      updates: [{ id: idA, text: 'A updated' }, { id: idB, text: 'B updated' }]
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(body.updated).toBe(2);

    var rowA = await db('task_masters').where('id', idA).first();
    var rowB = await db('task_masters').where('id', idB).first();
    expect(rowA.text).toBe('A updated');
    expect(rowB.text).toBe('B updated');
  });
});
