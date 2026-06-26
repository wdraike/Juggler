/**
 * 999.895 — MCP terminal-requires-schedule guard regression test
 *
 * Covers: BUG 999.895 — set_task_status and update_task in src/mcp/tools/tasks.js
 * bypass the terminal-requires-schedule guard present on the HTTP path
 * (UpdateTaskStatus.js:147-160). This suite FAILS on pre-fix code (R1/R5 RED)
 * and will turn fully green after bert applies the guard.
 *
 * Requirements:
 *   R1  set_task_status({id, status:'done'|'skip'|'cancel'}) on UNSCHEDULED
 *       non-rolling task → result.isError===true, text contains "without a
 *       scheduled time", DB status unchanged.
 *       RED now: handler has no guard. DB check constraint
 *       chk_task_instances_terminal_scheduled prevents the write (terminal
 *       status requires scheduled_at IS NOT NULL), so the handler throws a
 *       raw MySQL error rather than returning isError:true. After the fix the
 *       guard fires BEFORE the DB write and returns isError:true cleanly.
 *
 *   R2  set_task_status({id, status:'done'}) on SCHEDULED task → success (no
 *       isError), DB status becomes 'done'. Passes now and after fix (guard
 *       only fires when scheduled_at is null).
 *
 *   R3  set_task_status({id, status:'wip'|''}) on UNSCHEDULED task → success.
 *       Non-terminal statuses must never be blocked. Passes now and after fix.
 *
 *   R4  set_task_status({id, status:'done'}) on a SCHEDULED ROLLING-recurring
 *       instance → success (rolling exempt). Passes now and after fix. Rolling
 *       instances normally have scheduled_at set (placed by the scheduler); the
 *       relevant exemption to preserve is that the fix must NOT over-block rolling
 *       instances that already have scheduling info. Uses scheduled_at non-null to
 *       satisfy chk_task_instances_terminal_scheduled (the DB-level constraint that
 *       independently enforces terminal-requires-schedule; the app guard and the DB
 *       constraint both enforce this invariant, each at its own layer).
 *
 *   R5  update_task(id, {status:'done'}) on UNSCHEDULED non-rolling task with NO
 *       date/scheduledAt in the call → result.isError===true, text contains
 *       "without a scheduled time", DB status unchanged.
 *       RED now: handler has no guard. DB check constraint fires and the handler
 *       throws a raw MySQL error rather than returning isError:true. After the fix
 *       the guard fires before the DB write.
 *       update_task(id, {status:'done', date:'12/1'}) → success (scheduling in
 *       same call exempts). Passes now (no guard); must still pass after fix.
 *
 * Test-bed: MySQL on 3407 (juggler_sweep_test). Requires test-bed up.
 * Isolation: unique USER_ID prefix; full teardown in afterAll.
 * Run: DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass
 *      DB_NAME=juggler_sweep_test NODE_ENV=test
 *      npx jest tests/mcp-terminal-schedule-guard.test.js --runInBand --forceExit
 *
 * Traceability: .planning/kermit/999.895/TRACEABILITY.md BUG row
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var tasksWrite = require('../src/lib/tasks-write');
var { captureHandlers } = require('./helpers/mcp');
var { assertDbAvailable } = require('./helpers/requireDB');

// ── Suite-scoped constants ────────────────────────────────────────────────────

var USER_ID = 'mcp-guard-895-test';
// Static IDs — prefixed so cleanup is unambiguous; no random suffix needed because
// afterAll deletes all rows for USER_ID.
var UNSCHEDULED_DONE_ID   = 'g895-unsc-done';
var UNSCHEDULED_SKIP_ID   = 'g895-unsc-skip';
var UNSCHEDULED_CANCEL_ID = 'g895-unsc-cancel';
var SCHEDULED_ID          = 'g895-sched';
var WIP_UNSCHEDULED_ID    = 'g895-wip';
var ROLLING_MASTER_ID     = 'g895-roll-master';
var ROLLING_INST_ID       = 'g895-roll-inst';
var ROLLING_UNSC_INST_ID  = 'g895-roll-unsc';
var UPD_UNSCHEDULED_ID    = 'g895-upd-unsc';
var UPD_WITH_DATE_ID      = 'g895-upd-dated';

// ── Captured handlers (one per userId; shared across all tests) ───────────────
var handlers;

// ── Seed helper ───────────────────────────────────────────────────────────────

function baseTask(id, overrides) {
  return Object.assign({
    id: id,
    user_id: USER_ID,
    task_type: 'task',
    text: 'Guard test task ' + id,
    status: '',
    scheduled_at: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    dur: 30,
    pri: 'P3',
    recurring: 0,
    location: '[]',
    tools: '[]',
    depends_on: '[]'
  }, overrides);
}

// ── Teardown helper ───────────────────────────────────────────────────────────

async function cleanup() {
  // Delete instances before masters (FK: task_instances.master_id → task_masters.id).
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await assertDbAvailable();
  await cleanup(); // wipe any leftovers from a previous run

  // Seed user — handlers query db('users') for timezone; default is 'America/New_York'
  // when absent, but seed explicitly to avoid any null-tz edge case.
  await db('users').insert({
    id: USER_ID,
    email: 'guard895@test.invalid',
    timezone: 'America/New_York',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  // R1: three unscheduled non-rolling tasks (one per terminal status: done/skip/cancel).
  await tasksWrite.insertTask(db, baseTask(UNSCHEDULED_DONE_ID));
  await tasksWrite.insertTask(db, baseTask(UNSCHEDULED_SKIP_ID));
  await tasksWrite.insertTask(db, baseTask(UNSCHEDULED_CANCEL_ID));

  // R2: scheduled task (scheduled_at in the future so no side effects from runSchedule).
  await tasksWrite.insertTask(db, baseTask(SCHEDULED_ID, {
    scheduled_at: '2026-12-01 15:00:00'
  }));

  // R3: another unscheduled task for the non-terminal status assertions.
  await tasksWrite.insertTask(db, baseTask(WIP_UNSCHEDULED_ID));

  // R4: rolling recurring master + a SCHEDULED instance.
  //
  // isRollingMaster (src/lib/rolling-anchor.js) checks recur.type === 'rolling'.
  // The master must have recurring=1; insertTask for task_type:'recurring_template'
  // sets recurring=1 automatically (tasks-write.js:176).
  //
  // The instance row references the master via source_id. insertTask for
  // task_type:'recurring_instance' inserts only into task_instances and sets
  // master_id=source_id (tasks-write.js:184-192). tasks_v exposes master_id on the
  // instance row, which is what set_task_status uses to load and check the master.
  //
  // We use scheduled_at='2026-07-01 15:00:00' because the DB CHECK constraint
  // chk_task_instances_terminal_scheduled enforces (status NOT IN terminal OR
  // scheduled_at IS NOT NULL) independently of the app-level guard. Rolling instances
  // in production normally have scheduled_at set (the scheduler places them). The
  // R4 exemption we preserve is: the FIX must not add a new app-level block that
  // prevents rolling instances from being marked terminal even when scheduled.
  await tasksWrite.insertTask(db, baseTask(ROLLING_MASTER_ID, {
    task_type: 'recurring_template',
    recurring: 1,
    recur: JSON.stringify({ type: 'rolling' })
  }));
  await tasksWrite.insertTask(db, baseTask(ROLLING_INST_ID, {
    task_type: 'recurring_instance',
    source_id: ROLLING_MASTER_ID,
    scheduled_at: '2026-07-01 15:00:00'  // normal production state: scheduler placed
  }));

  // R4b: UNSCHEDULED rolling instance — exercises the master_id→isRollingMaster branch.
  // scheduled_at=null → willBeScheduled=false → guard reaches masterId check →
  // isRollingMaster=true → returns null (app guard exempted). DB CHECK constraint then
  // fires (terminal + null scheduled_at). This is the discriminating fixture zoe's mutation
  // proved was missing: zoe deleted the entire exemption block and R4 still passed because
  // R4's scheduled_at caused an early return at `if (willBeScheduled) return null;`.
  await tasksWrite.insertTask(db, baseTask(ROLLING_UNSC_INST_ID, {
    task_type: 'recurring_instance',
    source_id: ROLLING_MASTER_ID
    // scheduled_at defaults to null via baseTask()
  }));

  // R5: two unscheduled tasks — one for the reject-path, one for the allow-with-date path.
  await tasksWrite.insertTask(db, baseTask(UPD_UNSCHEDULED_ID));
  await tasksWrite.insertTask(db, baseTask(UPD_WITH_DATE_ID));

  // Capture real MCP handlers for USER_ID (shared across the suite).
  handlers = captureHandlers(USER_ID);
}, 20000);

afterAll(async () => {
  await cleanup();
  await db.destroy();
});

// ═══════════════════════════════════════════════════════════════════════════════
// R1 — set_task_status: terminal status on UNSCHEDULED non-rolling → reject
// ═══════════════════════════════════════════════════════════════════════════════
//
// RED on pre-fix code: no guard exists; handler writes the terminal status and
// returns success. These tests will FAIL until the guard is added.

describe('R1 — set_task_status: terminal on unscheduled non-rolling task', () => {

  it('R1a: set_task_status done → isError true + "without a scheduled time"', async () => {
    var result = await handlers['set_task_status']({ id: UNSCHEDULED_DONE_ID, status: 'done' });

    // RED on current code: result.isError is undefined (handler returns success, no guard).
    expect(result.isError).toBe(true);
    var text = result.content[0].text;
    expect(text).toMatch(/without a scheduled time/i);
  });

  it('R1a DB: status in DB is unchanged (still \'\') after rejected done', async () => {
    // RED on current code: handler wrote 'done' to the instance row.
    var row = await db('task_instances')
      .where({ id: UNSCHEDULED_DONE_ID, user_id: USER_ID }).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('');
  });

  it('R1b: set_task_status skip → isError true + "without a scheduled time"', async () => {
    var result = await handlers['set_task_status']({ id: UNSCHEDULED_SKIP_ID, status: 'skip' });

    expect(result.isError).toBe(true);
    var text = result.content[0].text;
    expect(text).toMatch(/without a scheduled time/i);
  });

  it('R1b DB: status in DB is unchanged after rejected skip', async () => {
    var row = await db('task_instances')
      .where({ id: UNSCHEDULED_SKIP_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('');
  });

  it('R1c: set_task_status cancel → isError true + "without a scheduled time"', async () => {
    var result = await handlers['set_task_status']({ id: UNSCHEDULED_CANCEL_ID, status: 'cancel' });

    expect(result.isError).toBe(true);
    var text = result.content[0].text;
    expect(text).toMatch(/without a scheduled time/i);
  });

  it('R1c DB: status in DB is unchanged after rejected cancel', async () => {
    var row = await db('task_instances')
      .where({ id: UNSCHEDULED_CANCEL_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('');
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// R2 — set_task_status: terminal on SCHEDULED task → success (guard must not fire)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Passes now and after fix. The guard only fires when scheduled_at is null.
// A scheduled task (scheduled_at non-null) must always succeed.

describe('R2 — set_task_status: terminal on SCHEDULED task → success', () => {

  it('R2: set_task_status done on scheduled task → no isError, DB status = done', async () => {
    var result = await handlers['set_task_status']({ id: SCHEDULED_ID, status: 'done' });

    // Must not be blocked — the task has a scheduled_at.
    expect(result.isError).toBeFalsy();

    var row = await db('task_instances')
      .where({ id: SCHEDULED_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('done');
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// R3 — set_task_status: non-terminal on unscheduled → success (guard must not fire)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Passes now and after fix. Non-terminal statuses (wip, '') are never restricted.

describe('R3 — set_task_status: non-terminal on unscheduled task → always succeeds', () => {

  it('R3a: set_task_status wip on unscheduled → no isError, DB status = wip', async () => {
    var result = await handlers['set_task_status']({ id: WIP_UNSCHEDULED_ID, status: 'wip' });

    expect(result.isError).toBeFalsy();

    var row = await db('task_instances')
      .where({ id: WIP_UNSCHEDULED_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('wip');
  });

  it('R3b: set_task_status empty-string on unscheduled → no isError, DB status = \'\'', async () => {
    // Resets the task back to active (idempotent; also tests the '' path through the guard).
    var result = await handlers['set_task_status']({ id: WIP_UNSCHEDULED_ID, status: '' });

    expect(result.isError).toBeFalsy();

    var row = await db('task_instances')
      .where({ id: WIP_UNSCHEDULED_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('');
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// R4 — set_task_status: terminal on SCHEDULED ROLLING instance → not blocked by fix
// ═══════════════════════════════════════════════════════════════════════════════
//
// Rolling-recurring instances that have scheduled_at set (normal production state)
// must never be blocked by the MCP terminal-requires-schedule guard. This passes
// now (no guard at all) and MUST still pass after the fix.
//
// The DB-level constraint chk_task_instances_terminal_scheduled enforces the
// terminal-requires-schedule invariant independently. The app-level guard being
// added in the fix must NOT block the rolling instance path (HTTP-path parity:
// UpdateTaskStatus.js:150-153 exempts rolling instances from the APP-level check).
//
// isRollingMaster predicate (rolling-anchor.js:12-22): recur.type === 'rolling'.
// The handler reads existing.master_id || existing.source_id, loads the master, and
// calls isRollingMaster — the same lookup already wired for rolling-anchor updates.

describe('R4 — set_task_status: terminal on SCHEDULED rolling instance → not blocked', () => {

  it('R4: set_task_status done on scheduled rolling instance → no isError', async () => {
    var result = await handlers['set_task_status']({ id: ROLLING_INST_ID, status: 'done' });

    // Rolling instances with scheduling info must succeed both pre-fix (no guard)
    // and post-fix (fix must not over-block rolling instances).
    expect(result.isError).toBeFalsy();

    var row = await db('task_instances')
      .where({ id: ROLLING_INST_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('done');
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// R4b — set_task_status: terminal on UNSCHEDULED rolling instance → exemption branch
// ═══════════════════════════════════════════════════════════════════════════════
//
// DISCRIMINATING TEST for the masterId→isRollingMaster exemption inside
// terminalScheduleBlock (src/mcp/tools/tasks.js:79-82).
//
// zoe mutation-proved R4 is a false-green: the R4 instance has scheduled_at set, so
// terminalScheduleBlock returns null at `if (willBeScheduled) return null;` BEFORE
// reaching the masterId→isRollingMaster check. Deleting the entire exemption block
// left all 13 tests green — the exemption branch was wholly unprotected.
//
// R4b fixes this by seeding an UNSCHEDULED rolling instance (scheduled_at=null):
//   willBeScheduled = false            → does NOT exit early
//   masterId = ROLLING_MASTER_ID       → set (instance.master_id via tasks_v)
//   isRollingMaster(master) = true     → recur.type='rolling'
//   terminalScheduleBlock returns null → app guard exempted (rolling path)
//   updateTaskById writes terminal + null scheduled_at → DB CHECK constraint fires
//
// Expected: the error/result text does NOT contain "without a scheduled time"
// (that phrase is the app-guard message; the DB constraint produces a different error).
// This proves the exemption fired, not the app guard.
//
// Mutation contract: if the exemption block is removed/neutered, terminalScheduleBlock
// returns the block message → result.isError=true, text="Cannot mark task done without
// a scheduled time" → R4b fails (RED). Restore → R4b passes (GREEN).

describe('R4b — set_task_status: terminal on UNSCHEDULED rolling instance → exemption exercised', () => {

  it('R4b: set_task_status done on UNSCHEDULED rolling instance → app guard does NOT fire', async () => {
    // willBeScheduled=false, masterId=ROLLING_MASTER_ID, isRollingMaster=true →
    // terminalScheduleBlock returns null (exempted). The DB CHECK constraint then fires
    // because terminal + null scheduled_at. The discriminating assertion: whatever error
    // or result occurs, it must NOT be the app-guard "without a scheduled time" message.
    var result;
    var caughtError;
    try {
      result = await handlers['set_task_status']({ id: ROLLING_UNSC_INST_ID, status: 'done' });
    } catch (err) {
      caughtError = err;
    }

    if (caughtError) {
      // Handler threw — expect DB constraint error, NOT the app-guard message.
      expect(caughtError.message).not.toMatch(/without a scheduled time/i);
    } else {
      // Handler returned a result — text must NOT be the app-guard message.
      var text = result.content[0].text;
      expect(text).not.toMatch(/without a scheduled time/i);
    }
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// R5 — update_task: terminal status + no scheduling info → reject
// ═══════════════════════════════════════════════════════════════════════════════
//
// RED on pre-fix code: no guard in update_task; handler writes 'done' and succeeds.
// After fix: reject when status is terminal AND neither the existing row nor the
// update call provides scheduling info. Allow when date/scheduledAt is in the call
// (scheduling-in-same-call exemption, matching HTTP-path semantics).

describe('R5 — update_task: terminal status with no scheduling info → reject', () => {

  it('R5a: update_task status:done on unscheduled, no date → isError + "without a scheduled time"', async () => {
    var result = await handlers['update_task']({ id: UPD_UNSCHEDULED_ID, status: 'done' });

    // RED on current code: result.isError is undefined (no guard; handler writes 'done').
    expect(result.isError).toBe(true);
    var text = result.content[0].text;
    expect(text).toMatch(/without a scheduled time/i);
  });

  it('R5a DB: status in DB is unchanged after rejected update_task', async () => {
    // RED on current code: handler wrote 'done' to the instance row.
    var row = await db('task_instances')
      .where({ id: UPD_UNSCHEDULED_ID, user_id: USER_ID }).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('');
  });

  it('R5b: update_task status:done + date:\'12/1\' in same call → success (scheduling-in-call exemption)', async () => {
    // Providing a date in the same update call schedules and completes the task together.
    // The guard must NOT block this: the task is being scheduled simultaneously.
    // Passes now (no guard) and must still pass after fix.
    var result = await handlers['update_task']({ id: UPD_WITH_DATE_ID, status: 'done', date: '12/1' });

    expect(result.isError).toBeFalsy();

    var row = await db('task_instances')
      .where({ id: UPD_WITH_DATE_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('done');
  });

});
