/**
 * mcp-update-task-nonatomic-partial-failure-characterization.db.test.js
 *
 * jug-mcp-facade — ernie E3 (WARN, accepted tradeoff, David RULING 2026-07-07,
 * scooter INBOX ISO 2026-07-07T19:40:00Z): update_task issues TWO
 * independent, separately-committed facade calls when both non-status fields
 * AND a `status` field are present in the same call — facade.updateTask
 * (non-status fields) runs FIRST and commits, THEN facade.updateTaskStatus
 * (the status transition) runs SEPARATELY. If the status transition fails,
 * the non-status field change from the FIRST call is already persisted —
 * a genuine non-atomic partial-write window the single-path pre-migration
 * write did not have (the old code built one combined `update` object and
 * wrote it in a single query).
 *
 * David ruled: ACCEPT as a known, TESTED tradeoff rather than fix to full
 * atomicity (low-frequency edge case; avoids a bigger atomicity redesign
 * inside an already-large leg). telly pins the EXACT partial-failure
 * behavior here so it is documented, not silent.
 *
 * Scenario: update_task on a recurring_template with BOTH a non-status field
 * (notes) and an invalid status transition (recurring templates can only be
 * paused/unpaused — UpdateTaskStatus.js:123-126) in the SAME call.
 * Expected (and PINNED): the notes field IS persisted (facade.updateTask
 * committed first), but the overall call still returns isError:true (the
 * second facade.updateTaskStatus call failed) — status is NOT changed.
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-nonatomic-001';

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
      id: USER_ID, email: 'mcp-nonatomic@test.invalid', name: 'MCP non-atomic update_task test',
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    });
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

describe('MCP update_task — non-atomic two-facade-call partial-failure (ACCEPTED tradeoff, ernie E3)', function () {

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

  test('PARTIAL FAILURE PIN: notes field change PERSISTS even though the combined call returns isError:true (status transition rejected)', async function () {
    var now = new Date();
    var tmplId = 'mcp-nonatomic-tmpl-' + Date.now();
    await db('task_masters').insert({
      id: tmplId, user_id: USER_ID, text: 'non-atomic test template', notes: 'original notes',
      dur: 30, pri: 'P3', recurring: 1, status: '',
      recur: JSON.stringify({ type: 'weekly', days: 'M' }), recur_start: '2026-01-01',
      tz: 'America/New_York', created_at: now, updated_at: now
    });

    var handlers = captureHandlers(USER_ID);
    // Both a non-status field (notes) AND an invalid status transition
    // (recurring templates can only be paused/unpaused — 'done' is rejected)
    // in the SAME update_task call.
    var result = await handlers.update_task({ id: tmplId, notes: 'CHANGED by first facade call', status: 'done' });

    // The overall call fails (the status half failed)...
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Validation error: Recurring templates can only be paused or unpaused');

    // ...but the non-status field change from the FIRST (already-committed)
    // facade.updateTask call is PERSISTED — this is the load-bearing
    // partial-failure pin. A future atomicity fix should FLIP this
    // assertion (notes reverting to 'original notes'), not silently regress
    // an assumption of atomicity nobody tested.
    var row = await db('task_masters').where('id', tmplId).first();
    expect(row.notes).toBe('CHANGED by first facade call');
    // The status half did NOT apply — still the pre-call value.
    expect(row.status).toBe('');
  });

  test('CONTRAST: when the status transition SUCCEEDS, both halves land together (the common, non-degenerate case)', async function () {
    var now = new Date();
    var taskId = 'mcp-nonatomic-ok-' + Date.now();
    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'non-atomic success case', notes: 'original',
      dur: 30, pri: 'P3', recurring: 0, status: '', created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      scheduled_at: new Date('2026-08-01T15:00:00Z'),
      created_at: now, updated_at: now
    });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.update_task({ id: taskId, notes: 'both halves land', status: 'done' });

    expect(result.isError).toBeFalsy();
    var masterRow = await db('task_masters').where('id', taskId).first();
    expect(masterRow.notes).toBe('both halves land');
    var instRow = await db('task_instances').where('id', taskId).first();
    expect(instRow.status).toBe('done');
  });

});
