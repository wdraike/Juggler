/**
 * mcp-update-task-nonatomic-partial-failure-characterization.db.test.js
 *
 * 999.1570 (SUPERSEDES ernie E3 / David ruling 2026-07-07, scooter INBOX ISO
 * 2026-07-07T19:40:00Z): update_task used to issue TWO independent,
 * separately-committed facade calls when both non-status fields AND a
 * `status` field were present in the same call — facade.updateTask
 * (non-status fields) ran FIRST and committed, THEN facade.updateTaskStatus
 * (the status transition) ran SEPARATELY. If the status transition failed,
 * the non-status field change from the FIRST call was already persisted — a
 * genuine non-atomic partial-write window the single-path pre-migration
 * write did not have. That was accepted as a known tradeoff at the time; this
 * ticket closes it: both facade calls now run inside ONE transaction
 * (facade.updateTaskAndStatus), so a failure in either half rolls back both.
 * The D-B ordering (non-status fields land BEFORE the status transition is
 * evaluated) is unchanged — see facade.js's updateTaskAndStatus header.
 *
 * Scenario: update_task on a recurring_template with BOTH a non-status field
 * (notes) and an invalid status transition (recurring templates can only be
 * paused/unpaused — UpdateTaskStatus.js:123-126) in the SAME call.
 * Expected (PINNED, post-999.1570): the overall call returns isError:true
 * (the status half is rejected) AND the notes field change is ROLLED BACK
 * with it — neither half applies.
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

describe('MCP update_task — composed one-transaction update+status (999.1570 fix, was ACCEPTED tradeoff ernie E3)', function () {

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

  test('ATOMIC ROLLBACK PIN (999.1570): notes field change is ROLLED BACK when the combined call returns isError:true (status transition rejected)', async function () {
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

    // ...and (999.1570) the non-status field change from the FIRST step is
    // ROLLED BACK along with it — both use-cases now share ONE transaction
    // (facade.updateTaskAndStatus), so a rejected status half undoes the
    // notes write too. This is the load-bearing atomicity pin: notes reverts
    // to its PRE-call value, not the attempted change.
    var row = await db('task_masters').where('id', tmplId).first();
    expect(row.notes).toBe('original notes');
    // The status half did NOT apply — still the pre-call value.
    expect(row.status).toBe('');
  });

  test('ORDERING PRESERVED (999.1570, D-B ruling): a valid non-status field lands BEFORE the status transition is evaluated, inside the SAME transaction', async function () {
    var now = new Date();
    var taskId = 'mcp-nonatomic-order-' + Date.now();
    // Seeded with NO scheduled_at — a terminal status write on an unscheduled
    // row would normally snap scheduled_at to "now" (D-B snap-then-write).
    // Supplying `date`+`time` in the SAME update_task call must land FIRST
    // (facade.updateTask, inside the shared trx) so facade.updateTaskStatus's
    // re-fetch of `existing` (same trx, sees its own uncommitted write) finds
    // a scheduled_at already set and does NOT snap to "now" instead.
    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'ordering test', notes: 'x',
      dur: 30, pri: 'P3', recurring: 0, status: '', created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      scheduled_at: null, created_at: now, updated_at: now
    });

    var handlers = captureHandlers(USER_ID);
    // PAST date deliberately (harrison 999.1570 W2): 'done' on a FUTURE
    // scheduled_at snaps to now, and 'done' on a still-unscheduled row ALSO
    // snaps to now — either way "year is 2026" would pass whether or not
    // step 1's write landed. A PAST supplied date fires no snap, so the exact
    // instant below is only reachable if step 1's date/time write committed.
    var result = await handlers.update_task({ id: taskId, date: '7/1', time: '3:00pm', status: 'done' });

    expect(result.isError).toBeFalsy();
    var instRow = await db('task_instances').where('id', taskId).first();
    expect(instRow.status).toBe('done');
    // EXACT instant: 2026-07-01 3:00pm America/New_York = 19:00 UTC.
    // Discriminating: a lost step-1 write yields a snap-to-now (July 14+)
    // instant instead. Compare the RAW stored string — dateStrings:true hands
    // back a tz-less string and new Date() would re-parse it as LOCAL (the
    // repo's documented +4h misparse trap).
    expect(instRow.scheduled_at).not.toBeNull();
    expect(String(instRow.scheduled_at).slice(0, 19)).toBe('2026-07-01 19:00:00');
  });

  test('NESTED TRANSACTION (999.1570): UpdateTask complex-path (time-only edit) runs its own repo.runInTransaction as a SAVEPOINT inside the composed transaction', async function () {
    var now = new Date();
    var taskId = 'mcp-nonatomic-complex-' + Date.now();
    // time-only (no date/scheduledAt) forces UpdateTask's COMPLEX PATH
    // (tasks.js needsComplexPath: body.time set, body.date/scheduledAt not) —
    // that path opens its OWN repo.runInTransaction for recurCleanup. When
    // this runs inside updateTaskAndStatus's outer transaction, knex resolves
    // the nested call as a SAVEPOINT on the same connection, not a
    // deadlocked/second connection — both the time change and the status
    // change must land together.
    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'complex-path nested-trx test', notes: 'x',
      dur: 30, pri: 'P3', recurring: 0, status: '', created_at: now, updated_at: now
    });
    // PAST scheduled_at deliberately (harrison 999.1570 W3): a FUTURE row's
    // 'done' snaps scheduled_at to now, which would satisfy a mere
    // "changed from the old value" assertion even if the nested-savepoint
    // time write rolled back. Past row → no snap → only the complex path's
    // committed time edit can produce the exact instant asserted below.
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      scheduled_at: new Date('2026-07-01T19:00:00Z'),
      created_at: now, updated_at: now
    });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.update_task({ id: taskId, time: '4:00 PM', status: 'done' });

    expect(result.isError).toBeFalsy();
    var instRow = await db('task_instances').where('id', taskId).first();
    expect(instRow.status).toBe('done');
    // EXACT instant: existing date 2026-07-01, new time 4:00 PM
    // America/New_York = 20:00 UTC — proof the complex path's nested
    // transaction (savepoint) committed the time change, not just the
    // status half. Raw-string compare (dateStrings +4h misparse trap).
    expect(String(instRow.scheduled_at).slice(0, 19)).toBe('2026-07-01 20:00:00');
  });

  test('TRX-THREADED ANCHOR (999.1570 harrison BLOCK-1): template-field edit + done on a rolling recurring instance completes in one call — anchor write joins the composed transaction instead of deadlocking on the base pool', async function () {
    var now = new Date();
    var masterId = 'mcp-nonatomic-roll-' + Date.now();
    var instId = masterId + '-1';
    // Rolling master with a stale anchor: 'done' projects next_start forward
    // to the completion day (computeRollingAnchor). notes is a TEMPLATE_FIELD,
    // so step 1 routes it to the MASTER row via updateTaskById(source_id) —
    // X-locking task_masters inside the composed trx. Pre-fix, step 2's
    // applyRollingAnchor then wrote the SAME master row on the BASE POOL and
    // blocked on our own uncommitted lock until innodb_lock_wait_timeout.
    await db('task_masters').insert({
      id: masterId, user_id: USER_ID, text: 'rolling anchor trx test', notes: 'original notes',
      dur: 30, pri: 'P3', recurring: 1, status: '',
      recur: JSON.stringify({ type: 'rolling', interval: 7 }),
      next_start: '2026-07-10', recur_start: '2026-01-01',
      tz: 'America/New_York', created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: instId, master_id: masterId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      date: '2026-07-10', scheduled_at: new Date('2026-07-10T14:00:00Z'),
      created_at: now, updated_at: now
    });

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.update_task({ id: instId, notes: 'CHANGED with done', status: 'done' });

    expect(result.isError).toBeFalsy();
    // All three writes committed together: template field on the master,
    // status on the instance, and the anchor projection on the master.
    var masterRow = await db('task_masters').where('id', masterId).first();
    expect(masterRow.notes).toBe('CHANGED with done');
    var instRow = await db('task_instances').where('id', instId).first();
    expect(instRow.status).toBe('done');
    // done anchors to the COMPLETION day (today in the user's tz), which is
    // >= the stale 2026-07-10 anchor — so next_start must have advanced.
    var todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    expect(String(masterRow.next_start).slice(0, 10)).toBe(todayKey);
  }, 20000); // regression mode = lock-wait hang; fail fast, not at innodb's ~50s

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
