// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * deletetask-scope-instance-characterization.db.test.js
 *
 * jug-mcp-facade — characterization_target #5 (Intake Brief).
 *
 * The Intake Brief (999.1215, "open, functional bug") claims: "facade's OWN
 * DeleteTask.js scope='instance' branch HARD-deletes a recurring instance
 * (DeleteTask.js:86-87 comment: 'skip the soft-skip and do a hard delete
 * instead')" — and characterization_targets #5 asks telly to pin TODAY's
 * hard-delete as the BEFORE state for this branch.
 *
 * TELLY FINDING (verified by direct code read + git blame, not just the
 * comment): this claim is STALE as of the current tree. DeleteTask.js's
 * scope==='instance' branch (L154-161) unconditionally calls
 * `this.standardDelete(...)`, regardless of isRecurringInstance — there is
 * no separate hard-delete branch despite the comment above it (L86-87,
 * dated 2026-06-17 commit 5d3fc5c) still describing one. `standardDelete`
 * itself (facade.js L720-757) was fixed from `twrite.deleteTaskById` to
 * `twrite.softCancelById` in commit 6ca3762 (2026-06-21, R55 no-hard-delete
 * sweep) — a fix that landed AFTER the DeleteTask.js scope='instance' wiring
 * but was never reflected in that stale comment. `git log -L` on both
 * ranges confirms the fix commit and comment-authoring commit as cited.
 *
 * Net effect verified by THIS test (not just static reading): scope='instance'
 * on a recurring_instance TODAY already soft-cancels (status='cancelled', row
 * KEPT) — it does NOT hard-delete. 999.1215 as literally described (citing the
 * stale comment) does not reproduce against current code; the backlog item
 * needs re-verification/closure, not a "fix" in this leg. Flagged as a finding
 * in TELLY-REVIEW.md — Oscar/Kermit should re-triage 999.1215 rather than
 * have bert "fix" already-fixed behavior.
 *
 * This file pins the VERIFIED-CURRENT (BEFORE-migration) behavior so any
 * future change to DeleteTask.js's scope='instance' branch is caught:
 *   - recurring_instance + scope=instance -> soft-cancel (row kept, status=cancelled)
 *   - non-recurring task + scope=instance -> soft-cancel (row kept, status=cancelled)
 *   - response envelope: { status:200, body:{ message:'Instance deleted', id } }
 *   - dependents' depends_on IS rewired (standardDelete's shared depends_on-rewire branch)
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'deltask-scope-inst-001';

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/redis', function () {
  return {
    getClient: jest.fn().mockReturnValue(null),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    invalidateTasks: jest.fn().mockResolvedValue(true),
    invalidateConfig: jest.fn().mockResolvedValue(true)
  };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn() };
});

var facade = require('../src/slices/task/facade');

async function seedUser() {
  var existing = await db('users').where('id', USER_ID).first();
  if (!existing) {
    await db('users').insert(__stampFixture({
      id: USER_ID,
      email: 'deltask-scope-inst@test.invalid',
      name: 'DeleteTask scope=instance characterization',
      timezone: 'America/New_York',
      created_at: new Date(),
      updated_at: new Date()
    }));
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

describe('DeleteTask.execute scope="instance" — CURRENT (pre-migration) behavior pin', function () {

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

  test('recurring_instance + scope=instance SOFT-CANCELS (row KEPT, status=cancelled) — NOT a hard delete', async function () {
    var now = new Date();
    var tmplId = 'del-inst-tmpl-' + Date.now();
    var instId = tmplId + '-ri1';

    await db('task_masters').insert(__stampFixture({
      id: tmplId, user_id: USER_ID, text: 'Recurring template', dur: 30, pri: 'P3',
      recurring: 1, status: '', recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
      created_at: now, updated_at: now
    }));
    await db('task_instances').insert(__stampFixture({
      id: instId, master_id: tmplId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      scheduled_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      created_at: now, updated_at: now
    }));

    var result = await facade.deleteTask({ id: instId, userId: USER_ID, scope: 'instance' });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ message: 'Instance deleted', id: instId });

    // The row PHYSICALLY PERSISTS — this is the load-bearing assertion that
    // contradicts the stale 999.1215 "hard-delete" claim.
    var row = await db('task_instances').where('id', instId).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('cancelled');

    // Template master untouched (only the instance row is targeted by id).
    var master = await db('task_masters').where('id', tmplId).first();
    expect(master).toBeTruthy();
    expect(master.status).toBe('');
  });

  test('non-recurring task + scope=instance SOFT-CANCELS (row KEPT, status=cancelled)', async function () {
    var now = new Date();
    var taskId = 'del-inst-solo-' + Date.now();

    await db('task_masters').insert(__stampFixture({
      id: taskId, user_id: USER_ID, text: 'Solo task', dur: 30, pri: 'P3',
      recurring: 0, status: '', created_at: now, updated_at: now
    }));
    await db('task_instances').insert(__stampFixture({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      created_at: now, updated_at: now
    }));

    var result = await facade.deleteTask({ id: taskId, userId: USER_ID, scope: 'instance' });

    expect(result.status).toBe(200);
    var instRow = await db('task_instances').where('id', taskId).first();
    var masterRow = await db('task_masters').where('id', taskId).first();
    expect(instRow).toBeTruthy();
    expect(instRow.status).toBe('cancelled');
    expect(masterRow).toBeTruthy();
    expect(masterRow.status).toBe('cancelled');
  });

  test('scope=instance still rewires dependents\' depends_on (standardDelete shared branch)', async function () {
    var now = new Date();
    var idA = 'del-inst-depA-' + Date.now();
    var idB = 'del-inst-depB-' + Date.now();

    await db('task_masters').insert(__stampFixture([
      { id: idA, user_id: USER_ID, text: 'A', dur: 30, pri: 'P3', recurring: 0, status: '',
        depends_on: null, created_at: now, updated_at: now },
      { id: idB, user_id: USER_ID, text: 'B (depends on A)', dur: 30, pri: 'P3', recurring: 0,
        status: '', depends_on: JSON.stringify([idA]), created_at: now, updated_at: now }
    ]));
    await db('task_instances').insert(__stampFixture([
      { id: idA, master_id: idA, user_id: USER_ID, status: '', occurrence_ordinal: 1,
        split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now },
      { id: idB, master_id: idB, user_id: USER_ID, status: '', occurrence_ordinal: 1,
        split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now }
    ]));

    var result = await facade.deleteTask({ id: idA, userId: USER_ID, scope: 'instance' });
    expect(result.status).toBe(200);

    var rowB = await db('task_masters').where('id', idB).first();
    var depsB = typeof rowB.depends_on === 'string' ? JSON.parse(rowB.depends_on || '[]') : (rowB.depends_on || []);
    expect(depsB).not.toContain(idA);
  });
});
