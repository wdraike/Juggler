/**
 * mcp-batch-update-tasks-anchor-gap-characterization.db.test.js
 *
 * jug-mcp-facade — characterization_target #2 (Intake Brief, batch_update_tasks
 * half) + risk_flag "batch_update_tasks GAP".
 *
 * Sibling of mcp-set-task-status-anchor-wiring.db.test.js (999.1100 pattern),
 * extended per this leg's Intake Brief to batch_update_tasks — which the
 * brief identifies (verified by reading tasks.js:585-796 in full) as
 * currently having NO applyRollingAnchor-equivalent call in either its
 * locked-path or transaction-path branches, unlike facade.js's
 * lockedBatchUpdate/batchUpdateTxn (which both call applyRollingAnchor on a
 * done/skip transition — "BUG1, leg sched-anchor-split-bugs" fix comment)
 * and unlike MCP's OWN set_task_status (which DOES call the anchor logic,
 * per mcp-set-task-status-anchor-wiring.db.test.js).
 *
 * AFTER-state (David RULING, 2020-01-07, exception c / bug-fix-by-migration):
 * batch_update_tasks now routes through facade's lockedBatchUpdate/
 * batchUpdateTxn, which already call applyRollingAnchor on a done/skip
 * transition — the anchor GAP this file pinned as the BEFORE state (through
 * WI-2) has closed as a side effect of the migration (no adapter code was
 * needed). This file is re-authored below to pin the anchor NOW ADVANCING,
 * mirroring mcp-set-task-status-anchor-wiring.db.test.js's shape (same
 * scenarios: rolling-master-done -> next_start, weekly-master-skip ->
 * next_start) — proving acceptance criterion (9) of the leg.
 *
 * REWRITTEN (juggler-anchor-column-cleanup W5, 2020-01-11): `rolling_anchor` /
 * `next_occurrence_anchor` dropped from task_masters; both branches now write
 * the single unified `next_start` column. Seed/assertions retargeted.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-batch-anchor-gap-001';

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

async function seedRollingMasterAndInstance(tmplId, instId, instanceDate, scheduledAt) {
  var now = new Date();
  await db('task_masters').insert({
    id: tmplId, user_id: USER_ID, text: 'rolling master — batch anchor gap test', dur: 30, pri: 'P3',
    recurring: 1, status: '', recur: JSON.stringify({ type: 'rolling', window: 7 }),
    recur_start: '2026-01-01', next_start: null,
    tz: 'America/New_York', created_at: now, updated_at: now
  });
  await db('task_instances').insert({
    id: instId, master_id: tmplId, user_id: USER_ID, status: '',
    occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
    date: instanceDate, scheduled_at: scheduledAt, created_at: now, updated_at: now
  });
}

async function seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt) {
  var now = new Date();
  await db('task_masters').insert({
    id: tmplId, user_id: USER_ID, text: 'weekly master — batch anchor gap test', dur: 30, pri: 'P3',
    recurring: 1, status: '', recur: JSON.stringify({ type: 'weekly', days: 'W' }),
    recur_start: '2026-01-01', next_start: null,
    tz: 'America/New_York', created_at: now, updated_at: now
  });
  await db('task_instances').insert({
    id: instId, master_id: tmplId, user_id: USER_ID, status: '',
    occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
    date: instanceDate, scheduled_at: scheduledAt, created_at: now, updated_at: now
  });
}

describe('MCP batch_update_tasks — rolling/next-occurrence anchor projection (AFTER state — gap closed)', function () {

  beforeAll(async function () {
    // setSystemTime WITHOUT useFakeTimers — avoids hangs in async/retry code
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    await assertDbAvailable();
    var existing = await db('users').where('id', USER_ID).first();
    if (!existing) {
      await db('users').insert({
        id: USER_ID, email: 'mcp-batch-anchor-gap@test.invalid', name: 'MCP batch anchor gap test',
        timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
      });
    }
  });

  afterEach(async function () {
    jest.useRealTimers();
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
  });

  afterAll(async function () {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  });

  test('AFTER: batch-completing a rolling master via batch_update_tasks DOES advance next_start to today', async function () {
    var tmplId = 'mcp-batch-roll-tmpl-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2020-01-08';
    var scheduledAt = new Date('2020-01-08T10:00:00Z');

    await seedRollingMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.batch_update_tasks({ updates: [{ id: instId, status: 'done' }] });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(body.updated).toBe(1);

    var master = await db('task_masters').where('id', tmplId).first();
    // AFTER migration: identical outcome to single-tool set_task_status for the
    // same scenario (see mcp-set-task-status-anchor-wiring.db.test.js "rolling
    // master: done writes next_start = today") — the anchor GAP closed as a
    // side effect of routing through facade's batchUpdateTxn/lockedBatchUpdate,
    // which already call applyRollingAnchor. done -> anchors to completionDate.
    var { getNowInTimezone } = require('../../shared/scheduler/getNowInTimezone');
    var expectedToday = getNowInTimezone('America/New_York').todayKey;
    expect(master.next_start).not.toBeNull();
    expect(String(master.next_start).slice(0, 10)).toBe(expectedToday);
  });

  test('AFTER: batch-skipping a pattern-recur (weekly) master via batch_update_tasks DOES advance next_start', async function () {
    var tmplId = 'mcp-batch-wk-tmpl-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2020-01-08'; // Wednesday
    var scheduledAt = new Date('2020-01-08T10:00:00Z');

    await seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.batch_update_tasks({ updates: [{ id: instId, status: 'skip' }] });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(body.updated).toBe(1);

    var master = await db('task_masters').where('id', tmplId).first();
    // AFTER migration: identical outcome to single-tool set_task_status for the
    // same scenario (see mcp-set-task-status-anchor-wiring.db.test.js
    // "pattern-recur master: skip advances next_start") — next
    // Wednesday after 2020-01-08 is 2020-01-15.
    expect(master.next_start).not.toBeNull();
    expect(String(master.next_start).slice(0, 10)).toBe('2020-01-15');

    // Sanity: the instance status DID change (proves the test actually
    // exercised the write path, not a total no-op).
    var inst = await db('task_instances').where('id', instId).first();
    expect(inst.status).toBe('skip');
  });
});
