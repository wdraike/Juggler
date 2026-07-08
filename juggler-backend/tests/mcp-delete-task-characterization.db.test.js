/**
 * mcp-delete-task-characterization.db.test.js
 *
 * jug-mcp-facade — characterization_target #4 (Intake Brief) + #1 (delete_task
 * slice of the tasks.js real-DB characterization ask).
 *
 * AFTER-state (David RULING, 2026-07-07, exception b): MCP's `delete_task`
 * tool now routes through `facade.deleteTask` (src/mcp/tools/tasks.js:448),
 * which already R55 soft-cancels (`standardDelete` -> `twrite.softCancelById`,
 * commit 6ca3762) instead of the pre-migration `tasksWrite.deleteTaskById`
 * direct hard `.del()`. This file pinned the BEFORE state (hard-delete)
 * through WI-2; the two pins that flip (row-presence, ledger provider_event_id)
 * are re-authored below to pin the AFTER state. The other two tests
 * (not-found string, depends_on rewiring) were never expected to change and
 * stayed green throughout — untouched.
 *
 * Also pins (per ernie-e11 / bert finding #8 — facade's OWN pre-existing
 * behavior, NOT introduced by this adapter, tracked separately, not blocking):
 *   - cal_sync_ledger.provider_event_id is RETAINED (not nulled) by
 *     facade.js's standardDelete — a genuine facade-vs-old-MCP divergence.
 *     status/task_id ARE cleared exactly as before.
 *
 * Pins (unaffected by the ruling, still in scope):
 *   - not-found error string: 'Error: Task not found'
 *   - response envelope: { deleted: true, id }
 *   - dependents' depends_on IS rewired to drop the deleted id (facade's
 *     standardDelete performs the identical dependency-fixup query)
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-del-char-001';

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
      id: USER_ID, email: 'mcp-del-char@test.invalid', name: 'MCP delete_task characterization',
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    });
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

describe('MCP delete_task — AFTER-migration R55 soft-cancel behavior pin', function () {

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

  test('R55 SOFT-CANCELS: rows PRESENT (status=cancelled) in task_instances AND task_masters post-call (AFTER state — was hard-delete pre-migration, David RULING exception b)', async function () {
    var now = new Date();
    var taskId = 'mcp-del-solo-' + Date.now();

    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'Solo task to delete', dur: 30, pri: 'P3',
      recurring: 0, status: '', created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      created_at: now, updated_at: now
    });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.delete_task({ id: taskId });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    // Pinned response envelope: reconstructed to {deleted:true,id} regardless
    // of which internal facade branch fired (facade itself returns a
    // scope-specific `message` field, not this shape).
    expect(body).toEqual({ deleted: true, id: taskId });

    // Load-bearing: rows are KEPT, status='cancelled' (R55 soft-cancel via
    // facade.deleteTask -> standardDelete -> twrite.softCancelById), NOT
    // physically removed. This is the pin that flipped when the migration
    // routed delete_task through facade.deleteTask.
    var instRow = await db('task_instances').where('id', taskId).first();
    var masterRow = await db('task_masters').where('id', taskId).first();
    expect(instRow).toBeTruthy();
    expect(instRow.status).toBe('cancelled');
    expect(masterRow).toBeTruthy();
    expect(masterRow.status).toBe('cancelled');
  });

  test('not-found error: unknown id -> isError true, "Error: Task not found"', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.delete_task({ id: 'does-not-exist-' + Date.now() });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: Task not found');
  });

  test('dependents\' depends_on IS rewired to drop the deleted id (unaffected by the soft-cancel ruling)', async function () {
    var now = new Date();
    var idA = 'mcp-del-depA-' + Date.now();
    var idB = 'mcp-del-depB-' + Date.now();

    await db('task_masters').insert([
      { id: idA, user_id: USER_ID, text: 'A', dur: 30, pri: 'P3', recurring: 0, status: '',
        depends_on: null, created_at: now, updated_at: now },
      { id: idB, user_id: USER_ID, text: 'B depends on A', dur: 30, pri: 'P3', recurring: 0,
        status: '', depends_on: JSON.stringify([idA]), created_at: now, updated_at: now }
    ]);
    await db('task_instances').insert([
      { id: idA, master_id: idA, user_id: USER_ID, status: '', occurrence_ordinal: 1,
        split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now },
      { id: idB, master_id: idB, user_id: USER_ID, status: '', occurrence_ordinal: 1,
        split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now }
    ]);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.delete_task({ id: idA });
    expect(result.isError).toBeFalsy();

    var rowB = await db('task_masters').where('id', idB).first();
    var depsB = typeof rowB.depends_on === 'string' ? JSON.parse(rowB.depends_on || '[]') : (rowB.depends_on || []);
    expect(depsB).not.toContain(idA);
  });

  test('calendar-linked task: cal_sync_ledger row soft-transitions to deleted_local AND the task row itself is ALSO soft-cancelled (not hard-deleted, AFTER state)', async function () {
    var now = new Date();
    var taskId = 'mcp-del-cal-' + Date.now();

    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'GCal-linked task', dur: 30, pri: 'P3',
      recurring: 0, status: '', created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      created_at: now, updated_at: now
    });
    // gcal_event_id is DERIVED on tasks_with_sync_v from cal_sync_ledger.provider_event_id
    // (join on task_id + provider='gcal') — it is not a column on task_instances itself.
    var providerEventId = 'gcal-evt-' + Date.now();
    var insertedIds = await db('cal_sync_ledger').insert({
      user_id: USER_ID, task_id: taskId, provider: 'gcal', origin: 'juggler',
      status: 'active', provider_event_id: providerEventId,
      created_at: now, synced_at: now
    });
    var ledgerId = insertedIds[0];

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.delete_task({ id: taskId });
    expect(result.isError).toBeFalsy();

    // Query by the auto-increment PK ('provider_event_id' cannot be used as
    // the post-call lookup key once nulled — but see below, it is NOT nulled).
    var ledgerRow = await db('cal_sync_ledger').where('id', ledgerId).first();
    expect(ledgerRow).toBeTruthy(); // ledger row PERSISTS (soft transition)
    expect(ledgerRow.status).toBe('deleted_local');
    expect(ledgerRow.task_id).toBeNull();
    // ernie-e11 / bert finding #8: facade.js's standardDelete() only clears
    // status/task_id — it does NOT null provider_event_id (unlike the old
    // pre-migration MCP delete, which nulled all four ledger fields). This is
    // facade's OWN pre-existing behavior (same code path HTTP DELETE already
    // uses), not introduced by this adapter; tracked separately (not blocking
    // this leg). Pin the ACTUAL retained value, not the old expectation.
    expect(ledgerRow.provider_event_id).toBe(providerEventId);

    // The task row itself is now SOFT-cancelled (R55), not hard-deleted — the
    // core AFTER-state pin for exception b.
    var taskRow = await db('task_instances').where('id', taskId).first();
    expect(taskRow).toBeTruthy();
    expect(taskRow.status).toBe('cancelled');
  });
});
