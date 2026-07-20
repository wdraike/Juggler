// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * reopen_date_gate_fr2.regression.test.js
 *
 * Traceability: juggler-recur-lifecycle-redesign SPEC.md FR-2 (Reopen vs undo) / AC3.
 *
 * "Explicit reactivation of an already-settled instance (999.1181's 'terminal !=
 * irreversible') is now blocked when the instance's date < today. Terminal-and-
 * today stays reactivatable. ... undo (the existing client-snapshot mechanism)
 * is unaffected by this gate."
 *
 * Current code (verified by direct read, src/slices/task/application/commands/
 * UpdateTaskStatus.js:204-207): the "terminal -> non-terminal reactivation" block
 * unconditionally calls `reactivateDoneFrozen` with NO date check at all — ANY
 * terminal instance, regardless of how stale its `date` is, can be reactivated by
 * writing status=''. This test's reactivation-blocked case is expected to RED.
 *
 * 999.1227: the server-side 999.681 undo subsystem (UndoTask/RecordAction/
 * action_log) was DELETED — it had zero callers. Undo is the client snapshot
 * mechanism (frontend useUndo.js), which restores field state via the batch
 * task-save path and never reaches this gate. The former "DISCOVERY: undo
 * bypasses UpdateTaskStatus" regression test was removed with the subsystem.
 *
 * Uses the same `facade` direct-call convention as
 * tests/deletetask-scope-instance-characterization.db.test.js.
 *
 * Run: cd juggler/juggler-backend && npx jest --testPathPattern="reopen_date_gate_fr2" --runInBand
 * (requires test-bed MySQL @3407)
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'fr2-reopen-gate-001';

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
var tasksWrite = require('../src/lib/tasks-write');

async function seedUser() {
  var existing = await db('users').where('id', USER_ID).first();
  if (!existing) {
    await db('users').insert(__stampFixture({
      id: USER_ID,
      email: 'fr2-reopen-gate@test.invalid',
      name: 'FR-2 reopen date gate test',
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

function pastDateKey(daysAgo) {
  var d = new Date(); d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// One-off task: master+instance share the same id (tasks-write.js identity
// rules — task_type 'task' with recurring=0 writes BOTH rows).
async function seedOneOffTerminalTask(id, dateKey, status) {
  var now = new Date();
  await tasksWrite.insertTask(db, {
    id: id, user_id: USER_ID, task_type: 'task', text: 'FR-2 reopen gate test task',
    dur: 30, pri: 'P3', recurring: 0, status: status,
    scheduled_at: new Date(dateKey + 'T10:00:00'),
    created_at: now, updated_at: now
  });
  // The instance row's `date` column drives FR-2's "date < today" check —
  // seed it directly since insertTask's shared row shape doesn't set it.
  await db('task_instances').where('id', id).update({ date: dateKey, completed_at: now });
}

describe('FR-2/AC3 — reopen date gate (blocks stale reactivation) vs undo (unaffected)', function () {

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
    await db.destroy();
  }, 10000);

  test('explicit reactivation ("") of a terminal instance with date < today is REJECTED', async function () {
    var id = 'fr2-past-' + Date.now();
    await seedOneOffTerminalTask(id, pastDateKey(3), 'done');

    var result = await facade.updateTaskStatus({
      id: id, userId: USER_ID, body: { status: '' }, timezoneHeader: 'America/New_York'
    });

    // RED (current code): UpdateTaskStatus.js:205-207 has no date check at all —
    // this currently returns 200 and flips status back to '' unconditionally.
    expect(result.status).not.toBe(200);
    expect(result.status).toBe(400);

    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('done'); // must remain terminal — the reactivation must not have applied
  });

  test('same-day terminal-to-open reactivation is STILL ALLOWED (unchanged behavior)', async function () {
    var id = 'fr2-today-' + Date.now();
    await seedOneOffTerminalTask(id, todayKey(), 'done');

    var result = await facade.updateTaskStatus({
      id: id, userId: USER_ID, body: { status: '' }, timezoneHeader: 'America/New_York'
    });

    expect(result.status).toBe(200);
    var row = await db('task_instances').where('id', id).first();
    expect(row.status).toBe('');
  });

  // 999.1227 delete-undo round trip: DELETE soft-cancels (R55 — row kept,
  // status='cancelled'), and the frontend's "Task deleted — Undo" restores it
  // through the EXPLICIT reactivation path (PUT status '' → UpdateTaskStatus
  // terminal → non-terminal branch). Same-day: allowed. This is the server half
  // of the delete-undo contract; the terminal guard stays unweakened.
  test('999.1227: delete → soft-cancel → explicit un-cancel round trip restores the task', async function () {
    var id = 'fr2-delundo-' + Date.now();
    await seedOneOffTerminalTask(id, todayKey(), '');
    await db('task_instances').where('id', id).update({ completed_at: null });

    var delResult = await facade.deleteTask({ id: id, userId: USER_ID, scope: 'instance' });
    expect(delResult.status).toBe(200);
    var cancelled = await db('task_instances').where('id', id).first();
    expect(cancelled).toBeTruthy();                  // R55: row kept, not hard-deleted
    expect(cancelled.status).toBe('cancelled');      // soft-cancel

    var undoResult = await facade.updateTaskStatus({
      id: id, userId: USER_ID, body: { status: '' }, timezoneHeader: 'America/New_York'
    });
    expect(undoResult.status).toBe(200);
    var restored = await db('task_instances').where('id', id).first();
    expect(restored.status).toBe('');                // back to open
  });
});
