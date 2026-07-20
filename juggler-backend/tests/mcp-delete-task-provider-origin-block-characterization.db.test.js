/**
 * mcp-delete-task-provider-origin-block-characterization.db.test.js
 *
 * jug-mcp-facade — David RULING (4th ruled exception, 2020-01-07, scooter
 * INBOX ISO 2020-01-07T19:20:00Z): extends the settled D-08 provider-origin
 * delete block to MCP. delete_task now 403s
 * (code: PROVIDER_ORIGIN_DELETE_BLOCKED) on a calendar-synced task that
 * originated from an external provider (Google/Outlook/Apple) — matching the
 * HTTP DELETE /api/tasks/:id path. The OLD MCP delete_task path had NO such
 * block (resolves ernie's E4 finding).
 *
 * facade.deleteTask routes through DeleteTask.js, which checks
 * findProviderLedgerRow(userId, id) — an active cal_sync_ledger row with
 * origin != 'juggler' — BEFORE any delete branch runs, whenever scope is not
 * 'series' (MCP's delete_task tool exposes no scope/cascade param, so scope
 * is always '', i.e. never 'series' — the block always applies).
 *
 * Contrast: a task with origin='juggler' (pushed FROM Juggler TO a calendar,
 * not ingested FROM one) is NOT provider-born and must still delete normally
 * (soft-cancel, per the exception-b AFTER state) — this file also pins that
 * negative case so the block is proven to key off ORIGIN, not mere presence
 * of a cal_sync_ledger row.
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-del-provider-block-001';

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

async function seedUser() {
  var existing = await db('users').where('id', USER_ID).first();
  if (!existing) {
    await db('users').insert({
      id: USER_ID, email: 'mcp-del-provider-block@test.invalid', name: 'MCP delete provider-origin block',
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    });
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

async function seedTaskWithLedger(taskId, ledgerOverrides) {
  var now = new Date();
  await db('task_masters').insert({
    id: taskId, user_id: USER_ID, text: 'Provider-origin block test task', dur: 30, pri: 'P3',
    recurring: 0, status: '', created_at: now, updated_at: now
  });
  await db('task_instances').insert({
    id: taskId, master_id: taskId, user_id: USER_ID, status: '',
    occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
    created_at: now, updated_at: now
  });
  await db('cal_sync_ledger').insert(Object.assign({
    user_id: USER_ID, task_id: taskId, provider: 'gcal', origin: 'gcal',
    status: 'active', provider_event_id: 'gcal-evt-' + Date.now(),
    created_at: now, synced_at: now
  }, ledgerOverrides || {}));
}

describe('MCP delete_task — provider-origin delete block (AFTER state, David RULING exception d)', function () {

  beforeAll(async function () {
    // setSystemTime WITHOUT useFakeTimers — avoids hangs in async/retry code
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    await assertDbAvailable();
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
    await seedUser();
  }, 15000);

  afterEach(async function () {
    jest.useRealTimers();
    await clearUserTasks();
  });

  afterAll(async function () {
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
  }, 10000);

  test('calendar-BORN task (origin=gcal, active ledger row) -> 403 PROVIDER_ORIGIN_DELETE_BLOCKED, row UNCHANGED (was: no block pre-migration)', async function () {
    var taskId = 'mcp-del-provblock-' + Date.now();
    await seedTaskWithLedger(taskId, { provider: 'gcal', origin: 'gcal' });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.delete_task({ id: taskId });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Error: This task came from Google Calendar. To remove it, delete it from Google Calendar directly.'
    );

    // Row is completely unaffected — the block fires BEFORE any delete branch.
    var row = await db('task_instances').where('id', taskId).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('');
    var ledgerRow = await db('cal_sync_ledger').where({ user_id: USER_ID, task_id: taskId }).first();
    expect(ledgerRow).toBeTruthy();
    expect(ledgerRow.status).toBe('active');
  });

  test('Outlook-origin task (origin=msft) -> 403, provider-specific text ("Microsoft Calendar")', async function () {
    var taskId = 'mcp-del-provblock-msft-' + Date.now();
    await seedTaskWithLedger(taskId, { provider: 'msft', origin: 'msft' });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.delete_task({ id: taskId });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Error: This task came from Microsoft Calendar. To remove it, delete it from Microsoft Calendar directly.'
    );
  });

  test('CONTRAST: origin=juggler (task pushed TO a calendar, not ingested FROM one) is NOT provider-blocked -> soft-cancels normally', async function () {
    var taskId = 'mcp-del-provblock-juggler-origin-' + Date.now();
    await seedTaskWithLedger(taskId, { provider: 'gcal', origin: 'juggler' });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.delete_task({ id: taskId });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(body).toEqual({ deleted: true, id: taskId });

    var row = await db('task_instances').where('id', taskId).first();
    expect(row.status).toBe('cancelled'); // R55 soft-cancel, exception b
  });

  test('CONTRAST: an inactive (already deleted_local) provider ledger row does NOT block -> soft-cancels normally', async function () {
    var taskId = 'mcp-del-provblock-inactive-' + Date.now();
    await seedTaskWithLedger(taskId, { provider: 'gcal', origin: 'gcal', status: 'deleted_local' });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.delete_task({ id: taskId });

    expect(result.isError).toBeFalsy();
    var row = await db('task_instances').where('id', taskId).first();
    expect(row.status).toBe('cancelled');
  });

});
