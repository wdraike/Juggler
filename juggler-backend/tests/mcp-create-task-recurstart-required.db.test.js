/**
 * mcp-create-task-recurstart-required.db.test.js
 *
 * 999.1567 — David ruling 2026-07-15 (binding, supersedes the prior cookie
 * BLOCK-1 "default it in the adapter" fix this file used to pin):
 *
 *   "EXPOSE recurStart in the MCP zod schema (tasks.js) — requirement STAYS,
 *   callers supply it. No adapter default. ClimbRS-side calls adapt via the
 *   served schema; batch/update paths get the same requirement for
 *   consistency."
 *
 * REPLACES mcp-create-task-recurstart-default-characterization.db.test.js
 * (deleted — it pinned the now-REJECTED option (b): silently defaulting
 * recurStart inside the MCP adapter via defaultRecurStartIfAnchorDependent()).
 * That function is removed. `recurStart` is now a first-class field on the
 * shared MCP `taskInputFields` zod schema (used by create_task, create_tasks,
 * update_task, batch_update_tasks) — a caller can and must supply it for
 * anchor-dependent recurrence patterns (biweekly/interval/timesPerCycle,
 * isAnchorDependentRecur — shared/scheduler/expandRecurring.js).
 *
 * Contract pinned here, across all three write-path entry points named in
 * the ruling:
 *   - create_task     (CreateTask.js sets _requireRecurStartIfAnchor — unchanged)
 *   - create_tasks    (BatchCreateTasks.js sets it too — 999.1394, unchanged)
 *   - update_task     (MCP ADAPTER now sets the SAME flag on ITS OWN
 *                      pre-facade validateTaskInput call — tasks.js only,
 *                      scoped to the MCP path; UpdateTask.js's shared facade
 *                      internals, and therefore the HTTP API used by the
 *                      juggler frontend, are UNTOUCHED)
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var { z } = require('zod');
var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-recurstart-required-001';

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

// Captures the RAW zod shape object passed as the 3rd `server.tool(...)` arg
// (the same object the real MCP SDK wraps in z.object(shape) to validate an
// incoming client call BEFORE the handler ever runs) — distinct from
// captureHandlers() above, which only keeps the handler function and
// discards this argument. Used below to prove `recurStart` is actually
// SERVED by the schema (harrison WARN-3), not merely threaded through by the
// handler body — a regression that dropped `recurStart` from
// `taskInputFields` would still pass every test that only calls handlers
// directly with a hand-built params object (zod validation never runs in
// that path), but MUST fail here, since z.object(shape).parse(...) strips
// any key the shape does not declare.
function captureSchemas(userId) {
  var schemas = {};
  var fakeServer = { tool: function (name, _desc, schema) { schemas[name] = schema; } };
  registerTaskTools(fakeServer, userId);
  return schemas;
}

async function seedUser() {
  var existing = await db('users').where('id', USER_ID).first();
  if (!existing) {
    await db('users').insert({
      id: USER_ID, email: 'mcp-recurstart-required@test.invalid', name: 'MCP recurStart required',
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    });
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

var REQUIRED_MSG = 'Recurrence start date is required for biweekly, interval, or times-per-cycle patterns';

describe('MCP create_task/create_tasks/update_task — recurStart EXPOSED + REQUIRED for anchor-dependent recur (999.1567 ruling, no adapter default)', function () {

  beforeAll(async function () {
    await assertDbAvailable();
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
    await seedUser();
  }, 15000);

  afterEach(async function () {
    await clearUserTasks();
  });

  afterAll(async function () {
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
  }, 10000);

  // ── create_task ──────────────────────────────────────────────────────────

  test('create_task: biweekly recur + date, NO recurStart -> 400 (requirement STAYS; no silent default)', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({
      text: 'Biweekly standup, no recurStart supplied',
      date: '2026-08-03',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'biweekly', days: 'M' }
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Validation error: ' + REQUIRED_MSG);
    var rows = await db('task_masters').where('user_id', USER_ID).select();
    expect(rows.length).toBe(0);
  });

  test('create_task: biweekly recur + date + explicit recurStart via the now-exposed schema field -> SUCCEEDS, recur_start = the supplied value', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({
      text: 'Biweekly with explicit recurStart',
      date: '2026-08-03',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'biweekly', days: 'M' },
      recurStart: '2026-08-17'
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    var masterRow = await db('task_masters').where('id', body.id).first();
    expect(masterRow).toBeTruthy();
    expect(String(masterRow.recur_start).slice(0, 10)).toBe('2026-08-17');
  });

  test('create_task: interval recur + recurStart supplied -> SUCCEEDS', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({
      text: 'Interval task with recurStart',
      scheduledAt: '2026-08-04T14:00:00.000Z',
      recurring: true,
      recur: { type: 'interval', every: 3 },
      recurStart: '2026-08-04'
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    var masterRow = await db('task_masters').where('id', body.id).first();
    expect(String(masterRow.recur_start).slice(0, 10)).toBe('2026-08-04');
  });

  test('create_task: NON-anchor-dependent recur (weekly, no timesPerCycle) + NO recurStart -> unaffected (recur_start stays null)', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({
      text: 'Plain weekly, no recurStart needed',
      date: '2026-08-03',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'weekly', days: 'M' }
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    var masterRow = await db('task_masters').where('id', body.id).first();
    expect(masterRow.recur_start).toBeNull();
  });

  // ── create_tasks (batch) ─────────────────────────────────────────────────

  test('create_tasks (batch): biweekly recur, NO recurStart on any item -> 400 for the whole batch, NO rows written', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_tasks({
      tasks: [
        { text: 'Batch biweekly A', date: '2026-08-05', time: '9:00 AM', recurring: true, recur: { type: 'biweekly', days: 'W' } },
        { text: 'Batch biweekly B', date: '2026-08-06', time: '9:00 AM', recurring: true, recur: { type: 'biweekly', days: 'R' } }
      ]
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Validation error: Task 0: ' + REQUIRED_MSG);
    var rows = await db('task_masters').where('user_id', USER_ID).select();
    expect(rows.length).toBe(0);
  });

  test('create_tasks (batch): biweekly recur + recurStart supplied per item -> SUCCEEDS for every item', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_tasks({
      tasks: [
        { text: 'Batch biweekly A', date: '2026-08-05', time: '9:00 AM', recurring: true, recur: { type: 'biweekly', days: 'W' }, recurStart: '2026-08-05' },
        { text: 'Batch biweekly B', date: '2026-08-06', time: '9:00 AM', recurring: true, recur: { type: 'biweekly', days: 'R' }, recurStart: '2026-08-06' }
      ]
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(body.created).toBe(2);
    var masterRows = await db('task_masters').whereIn('id', body.ids).select();
    expect(masterRows.length).toBe(2);
    masterRows.forEach(function (row) {
      expect(row.recur_start).not.toBeNull();
    });
  });

  // ── update_task (999.1567 part 3: batch/update paths get the same requirement) ──

  test('update_task: setting recur to biweekly with NO recurStart -> 400 (NEW: same requirement as create, MCP-adapter-scoped)', async function () {
    var handlers = captureHandlers(USER_ID);
    var createResult = await handlers.create_task({ text: 'Plain task to become biweekly', date: '2026-08-03', time: '9:00 AM' });
    var createBody = JSON.parse(createResult.content[0].text);

    var result = await handlers.update_task({
      id: createBody.id,
      recurring: true,
      recur: { type: 'biweekly', days: 'M' }
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Validation error: ' + REQUIRED_MSG);
    var row = await db('task_masters').where('id', createBody.id).first();
    // Row unchanged — still non-recurring, no partial write from the rejected update.
    expect(row.recurring).toBe(0);
  });

  test('update_task: setting recur to biweekly WITH recurStart supplied -> SUCCEEDS', async function () {
    var handlers = captureHandlers(USER_ID);
    var createResult = await handlers.create_task({ text: 'Plain task to become biweekly', date: '2026-08-03', time: '9:00 AM' });
    var createBody = JSON.parse(createResult.content[0].text);

    var result = await handlers.update_task({
      id: createBody.id,
      recurring: true,
      recur: { type: 'biweekly', days: 'M' },
      recurStart: '2026-08-03'
    });

    expect(result.isError).toBeFalsy();
    var row = await db('task_masters').where('id', createBody.id).first();
    expect(row.recurring).toBe(1);
    expect(String(row.recur_start).slice(0, 10)).toBe('2026-08-03');
  });

  test('update_task: non-anchor-dependent recur (weekly) with NO recurStart -> unaffected', async function () {
    var handlers = captureHandlers(USER_ID);
    var createResult = await handlers.create_task({ text: 'Plain task to become weekly', date: '2026-08-03', time: '9:00 AM' });
    var createBody = JSON.parse(createResult.content[0].text);

    var result = await handlers.update_task({
      id: createBody.id,
      recurring: true,
      recur: { type: 'weekly', days: 'M' }
    });

    expect(result.isError).toBeFalsy();
  });

  test('update_task: edit unrelated field (dur) with no recur touched at all -> unaffected (no recurStart requirement triggered)', async function () {
    var handlers = captureHandlers(USER_ID);
    var createResult = await handlers.create_task({ text: 'Plain task', date: '2026-08-03', time: '9:00 AM' });
    var createBody = JSON.parse(createResult.content[0].text);

    var result = await handlers.update_task({ id: createBody.id, dur: 45 });

    expect(result.isError).toBeFalsy();
  });

  // ── batch_update_tasks (harrison WARN-2: must not be a back-door around
  // update_task's new requirement — a caller could otherwise dodge the guard
  // by wrapping the same single update in a 1-item batch) ──

  test('batch_update_tasks: item sets recur to biweekly with NO recurStart -> 400 for the whole batch, row UNCHANGED (was: silently accepted — the exact bypass harrison flagged)', async function () {
    var handlers = captureHandlers(USER_ID);
    var createResult = await handlers.create_task({ text: 'Plain task to become biweekly via batch', date: '2026-08-03', time: '9:00 AM' });
    var createBody = JSON.parse(createResult.content[0].text);

    var result = await handlers.batch_update_tasks({
      updates: [{ id: createBody.id, recurring: true, recur: { type: 'biweekly', days: 'M' } }]
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(createBody.id + ': Validation error: ' + REQUIRED_MSG);
    var row = await db('task_masters').where('id', createBody.id).first();
    expect(row.recurring).toBe(0);
  });

  test('batch_update_tasks: item sets recur to biweekly WITH recurStart supplied -> SUCCEEDS', async function () {
    var handlers = captureHandlers(USER_ID);
    var createResult = await handlers.create_task({ text: 'Plain task to become biweekly via batch', date: '2026-08-03', time: '9:00 AM' });
    var createBody = JSON.parse(createResult.content[0].text);

    var result = await handlers.batch_update_tasks({
      updates: [{ id: createBody.id, recurring: true, recur: { type: 'biweekly', days: 'M' }, recurStart: '2026-08-03' }]
    });

    expect(result.isError).toBeFalsy();
    var row = await db('task_masters').where('id', createBody.id).first();
    expect(row.recurring).toBe(1);
    expect(String(row.recur_start).slice(0, 10)).toBe('2026-08-03');
  });

  test('batch_update_tasks: non-anchor-dependent recur (weekly) with NO recurStart -> unaffected', async function () {
    var handlers = captureHandlers(USER_ID);
    var createResult = await handlers.create_task({ text: 'Plain task to become weekly via batch', date: '2026-08-03', time: '9:00 AM' });
    var createBody = JSON.parse(createResult.content[0].text);

    var result = await handlers.batch_update_tasks({
      updates: [{ id: createBody.id, recurring: true, recur: { type: 'weekly', days: 'M' } }]
    });

    expect(result.isError).toBeFalsy();
  });

});

// ── Schema-level proof (harrison WARN-3): the field must actually be SERVED,
// not just threaded through by the handler body. No DB required — this is a
// pure zod-shape check against the real schema objects `registerTaskTools`
// hands the MCP SDK. ──────────────────────────────────────────────────────
describe('MCP taskInputFields — recurStart is actually EXPOSED on the served schema (not just handler-threaded)', function () {

  test('create_task schema: z.object(shape).parse() keeps recurStart (would be silently stripped if removed from taskInputFields)', function () {
    var schemas = captureSchemas(USER_ID);
    var parsed = z.object(schemas.create_task).parse({ text: 'x', recurStart: '2026-08-17' });
    expect(parsed.recurStart).toBe('2026-08-17');
  });

  test('create_tasks schema: the per-item shape inside the tasks array keeps recurStart', function () {
    var schemas = captureSchemas(USER_ID);
    var parsed = z.object(schemas.create_tasks).parse({
      tasks: [{ text: 'x', recurStart: '2026-08-17' }]
    });
    expect(parsed.tasks[0].recurStart).toBe('2026-08-17');
  });

  test('update_task schema: z.object(shape).parse() keeps recurStart', function () {
    var schemas = captureSchemas(USER_ID);
    var parsed = z.object(schemas.update_task).parse({ id: 'x', recurStart: '2026-08-17' });
    expect(parsed.recurStart).toBe('2026-08-17');
  });

  test('batch_update_tasks schema: the per-item shape inside updates keeps recurStart', function () {
    var schemas = captureSchemas(USER_ID);
    var parsed = z.object(schemas.batch_update_tasks).parse({
      updates: [{ id: 'x', recurStart: '2026-08-17' }]
    });
    expect(parsed.updates[0].recurStart).toBe('2026-08-17');
  });

});
