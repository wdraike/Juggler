/**
 * 999.895 — MCP terminal-requires-schedule guard regression test
 *
 * jug-mcp-facade AFTER-state (David RULING, 2026-07-07, exception a / 999.1216):
 * the original 999.895 reject-based guard (terminalScheduleBlock, removed from
 * tasks.js by the WI-2 facade migration) is REPLACED by facade.updateTaskStatus's
 * D-B snap-then-write behavior (parity with HTTP — UpdateTaskStatus.js:147-160).
 * A terminal status write on an UNSCHEDULED non-rolling task NO LONGER rejects —
 * it SUCCEEDS and snaps `scheduled_at` to now() as part of the same write. This
 * file pinned the BEFORE state (reject) through WI-2; R1/R5 are now re-authored
 * to pin the AFTER state (snap-then-write success). R2/R3/R4/R4b/R5b are
 * untouched — those scenarios were never part of the ruled exception and must
 * stay green exactly as before.
 *
 * Requirements (AFTER migration):
 *   R1  set_task_status({id, status:'done'|'skip'|'cancel'}) on UNSCHEDULED
 *       non-rolling task → result.isError falsy, DB status becomes the
 *       requested terminal status, DB scheduled_at is SNAPPED to ~now (was
 *       null before the call) — the D-B snap-then-write behavior.
 *
 *   R2  set_task_status({id, status:'done'}) on SCHEDULED task → success (no
 *       isError), DB status becomes 'done'. Unaffected by the ruling (guard
 *       only ever fired when scheduled_at was null); still green.
 *
 *   R3  set_task_status({id, status:''}) on UNSCHEDULED task → success.
 *       Non-terminal statuses must never be blocked. Still green.
 *
 *   R4  set_task_status({id, status:'done'}) on a SCHEDULED ROLLING-recurring
 *       instance → success (rolling exempt, scheduled_at NOT re-snapped —
 *       already had a value). Still green.
 *
 *   R4b set_task_status({id, status:'done'}) on an UNSCHEDULED ROLLING-recurring
 *       instance → the rolling exemption in facade.updateTaskStatus's
 *       `_isRollingInstance` check means _snapUnscheduledToNow is FALSE for
 *       rolling instances (unlike R1's non-rolling case) — the DB CHECK
 *       constraint chk_task_instances_terminal_scheduled still fires because
 *       scheduled_at stays null. Still green (still rejects, via the DB layer
 *       not the app layer — the discriminating assertion is unchanged: no
 *       app-guard "without a scheduled time" text).
 *
 *   R5  update_task(id, {status:'done'}) on UNSCHEDULED non-rolling task with NO
 *       date/scheduledAt in the call → result.isError falsy, DB status becomes
 *       'done', DB scheduled_at is SNAPPED to ~now (update_task routes any
 *       `status` field through facade.updateTaskStatus per the RULED exception).
 *       update_task(id, {status:'done', date:'12/1'}) → success (scheduling in
 *       same call). Still green (date wins over the snap — scheduled_at reflects
 *       the supplied date, not "now").
 *
 * Test-bed: MySQL on 3407 (juggler_sweep_test). Requires test-bed up.
 * Isolation: unique USER_ID prefix; full teardown in afterAll.
 * Run: DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass
 *      DB_NAME=juggler_sweep_test NODE_ENV=test
 *      npx jest tests/mcp-terminal-schedule-guard.test.js --runInBand --forceExit
 *
 * Traceability: .planning/kermit/999.895/TRACEABILITY.md BUG row (BEFORE state);
 *               .planning/kermit/jug-mcp-facade/TRACEABILITY.md B-7 (AFTER state)
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

// ── "snapped to now" assertion helper ──────────────────────────────────────────
// knexfile.js connection uses timezone:'+00:00' + dateStrings:true — DB values are
// UTC wall-clock strings with NO 'Z'/offset suffix. `new Date(dbString)` in Node
// mis-parses that as LOCAL time (the documented dateStrings/new Date() misparse
// trap), producing a spurious multi-hour "diff" whenever the process TZ isn't UTC.
// Do the comparison IN MySQL (TIMESTAMPDIFF against UTC_TIMESTAMP()) instead of
// re-parsing the string in JS, so the assertion is TZ-independent.
async function secondsSinceSnappedToNow(table, id) {
  var row = await db(table).where('id', id)
    .select(db.raw('ABS(TIMESTAMPDIFF(SECOND, scheduled_at, UTC_TIMESTAMP())) as diff_seconds'))
    .first();
  return row ? Number(row.diff_seconds) : null;
}

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
// R1 — set_task_status: terminal status on UNSCHEDULED non-rolling
//      → D-B snap-then-write (AFTER state, David RULING 2026-07-07, exception a)
// ═══════════════════════════════════════════════════════════════════════════════
//
// AFTER migration: facade.updateTaskStatus's _snapUnscheduledToNow branch fires
// (non-rolling, no existing/incoming schedule) — the write SUCCEEDS and
// scheduled_at is snapped to new Date() as part of the SAME write, instead of
// being rejected. Pinning both the response AND the DB row so a future revert
// of the ruling flips both assertions loudly.
//
// TELLY FIX (order-independence, BASE-TESTING §5): each response+DB pair is
// ONE atomic test, not split call/DB-check pairs — under `jest --randomize`
// (jest-circus randomizes execution order WITHIN a file, not just across
// files) a "call the handler" test and its separate "check the DB" test can
// run OUT of the written order, since they share fixtures seeded once in
// beforeAll with no ordering guarantee between sibling `it()` blocks. Merging
// removes the possibility entirely rather than relying on execution order.

describe('R1 — set_task_status: terminal on unscheduled non-rolling task → snap-then-write', () => {

  it('R1a: set_task_status done → isError falsy, no reject text; DB status becomes \'done\' AND scheduled_at is snapped to ~now (was null)', async () => {
    var result = await handlers['set_task_status']({ id: UNSCHEDULED_DONE_ID, status: 'done' });

    expect(result.isError).toBeFalsy();
    var text = result.content[0].text;
    expect(text).not.toMatch(/without a scheduled time/i);

    var row = await db('task_instances')
      .where({ id: UNSCHEDULED_DONE_ID, user_id: USER_ID }).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('done');
    expect(row.scheduled_at).not.toBeNull();
    // "snapped to now" — within a generous window of the test run (MySQL-side
    // comparison, TZ-independent — see secondsSinceSnappedToNow header comment).
    var diffSeconds = await secondsSinceSnappedToNow('task_instances', UNSCHEDULED_DONE_ID);
    expect(diffSeconds).toBeLessThan(60);
  });

  it('R1b: set_task_status skip → isError falsy, no reject text; DB status becomes \'skip\' AND scheduled_at is snapped to ~now', async () => {
    var result = await handlers['set_task_status']({ id: UNSCHEDULED_SKIP_ID, status: 'skip' });

    expect(result.isError).toBeFalsy();
    var text = result.content[0].text;
    expect(text).not.toMatch(/without a scheduled time/i);

    var row = await db('task_instances')
      .where({ id: UNSCHEDULED_SKIP_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('skip');
    expect(row.scheduled_at).not.toBeNull();
    var diffSeconds = await secondsSinceSnappedToNow('task_instances', UNSCHEDULED_SKIP_ID);
    expect(diffSeconds).toBeLessThan(60);
  });

  it('R1c: set_task_status cancel → isError falsy, no reject text; DB status becomes \'cancel\' AND scheduled_at is snapped to ~now', async () => {
    var result = await handlers['set_task_status']({ id: UNSCHEDULED_CANCEL_ID, status: 'cancel' });

    expect(result.isError).toBeFalsy();
    var text = result.content[0].text;
    expect(text).not.toMatch(/without a scheduled time/i);

    var row = await db('task_instances')
      .where({ id: UNSCHEDULED_CANCEL_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('cancel');
    expect(row.scheduled_at).not.toBeNull();
    var diffSeconds = await secondsSinceSnappedToNow('task_instances', UNSCHEDULED_CANCEL_ID);
    expect(diffSeconds).toBeLessThan(60);
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
// Passes now and after fix. Non-terminal statuses ('') are never restricted.

describe('R3 — set_task_status: non-terminal on unscheduled task → always succeeds', () => {

  it('R3a: set_task_status empty-string on unscheduled -> no isError, DB status = empty', async () => {
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
//   willBeScheduled = false                 → does NOT exit early
//   masterId = ROLLING_MASTER_ID            → set (instance.master_id via tasks_v)
//   isRollingMaster(master) = true          → recur.type='rolling'
//   _isRollingInstance = true (UpdateTaskStatus.js:152)
//   _snapUnscheduledToNow = false (UpdateTaskStatus.js:162 — rolling instances are
//     exempted from the snap; scheduled_at is left null, unlike R1's non-rolling case)
//   repo.updateTaskById writes status='done' with scheduled_at STILL null
//     → DB CHECK constraint chk_task_instances_terminal_scheduled fires
//     → the write's promise REJECTS (UpdateTaskStatus.execute has no try/catch around
//       this call, and tasks.js's set_task_status handler has no try/catch around the
//       facade call either — the raw DB error propagates OUT of the MCP handler as a
//       thrown/rejected error, NOT an { isError: true } response envelope)
//   → the row is left UNCHANGED (status stays '', scheduled_at stays null) — the failed
//     UPDATE does not partially apply
//
// (999.895's original app-level terminalScheduleBlock guard — and its "without a
// scheduled time" message — was REMOVED ENTIRELY by the WI-2 facade migration (see file
// header, and tasks.js:46/454 for the only remaining, non-executable comment references).
// No live code path can produce that string anymore, so a not.toMatch of it is
// unconditionally true post-migration and pins nothing — zoe-jug-mcp-facade-r4b-vacuous-
// post-migration (2026-07-08).)
//
// AFTER-state expected observable (confirmed via direct DB-level repro, 2026-07-08):
// caughtError is truthy (the handler call throws — it is NOT a normal isError:true
// response); caughtError.code === 'ER_CHECK_CONSTRAINT_VIOLATED'; caughtError.message
// matches /chk_task_instances_terminal_scheduled/; the DB row is UNCHANGED (status stays
// '', scheduled_at stays null) — proving the APP-level rolling exemption fired (no
// isError:true "without a scheduled time" 400 was returned) while the DB-level invariant
// still correctly held.
//
// Mutation contract: if the rolling exemption is removed/neutered (_isRollingInstance
// forced false), _snapUnscheduledToNow becomes true — the write instead SNAPS
// scheduled_at to now and SUCCEEDS (no thrown error; row.status becomes 'done',
// scheduled_at becomes non-null) — R4b fails RED (no caughtError, row mutated,
// status !== ''). Restore → R4b passes GREEN.

describe('R4b — set_task_status: terminal on UNSCHEDULED rolling instance → exemption exercised', () => {

  it('R4b: set_task_status done on UNSCHEDULED rolling instance → app-level rolling exemption fires (no isError guard-reject), DB CHECK constraint rejects the unsnapped write, row unchanged', async () => {
    // willBeScheduled=false, masterId=ROLLING_MASTER_ID, isRollingMaster=true →
    // _isRollingInstance=true → _snapUnscheduledToNow=false (UpdateTaskStatus.js:152/162):
    // the APP-level rolling exemption fires (no 400/isError guard-reject — that code path
    // was removed by the WI-2 migration). scheduled_at is therefore left null and the
    // subsequent repo.updateTaskById write violates the DB CHECK constraint
    // chk_task_instances_terminal_scheduled, which REJECTS the promise (no try/catch
    // anywhere between the repo call and the MCP handler — see header) rather than
    // returning an { isError: true } response.
    var result;
    var caughtError;
    try {
      result = await handlers['set_task_status']({ id: ROLLING_UNSC_INST_ID, status: 'done' });
    } catch (err) {
      caughtError = err;
    }

    // Discriminates the app-level exemption from the (removed) app-level guard: a thrown
    // DB-layer error, not a normal { isError: true } response.
    expect(result).toBeUndefined();
    expect(caughtError).toBeTruthy();
    expect(caughtError.code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
    expect(caughtError.message).toMatch(/chk_task_instances_terminal_scheduled/);

    // Discriminates a genuinely-rejected write from a partially-applied one: the failed
    // UPDATE must not have mutated the row (also proves this is NOT the old app guard,
    // which never attempted the write at all — same observable end-state, different path).
    var row = await db('task_instances')
      .where({ id: ROLLING_UNSC_INST_ID, user_id: USER_ID }).first();
    expect(row.status).toBe('');
    expect(row.scheduled_at).toBeNull();
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// R5 — update_task: terminal status + no scheduling info
//      → D-B snap-then-write (AFTER state, David RULING 2026-07-07, exception a)
// ═══════════════════════════════════════════════════════════════════════════════
//
// AFTER migration: update_task routes any `status` field through
// facade.updateTaskStatus (tasks.js:383-392) — the SAME D-B snap-then-write
// behavior as R1 applies here too. Allow-with-date (R5b) is unaffected: date
// wins over the snap because it's part of the facade.updateTask call that
// runs FIRST (tasks.js:373-382), so by the time facade.updateTaskStatus runs,
// scheduled_at is already non-null and _snapUnscheduledToNow does not fire.

describe('R5 — update_task: terminal status with no scheduling info → snap-then-write', () => {

  it('R5a: update_task status:done on unscheduled, no date → isError falsy, no reject text; DB status becomes \'done\' AND scheduled_at is snapped to ~now (was null)', async () => {
    var result = await handlers['update_task']({ id: UPD_UNSCHEDULED_ID, status: 'done' });

    expect(result.isError).toBeFalsy();
    var text = result.content[0].text;
    expect(text).not.toMatch(/without a scheduled time/i);

    var row = await db('task_instances')
      .where({ id: UPD_UNSCHEDULED_ID, user_id: USER_ID }).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('done');
    expect(row.scheduled_at).not.toBeNull();
    var diffSeconds = await secondsSinceSnappedToNow('task_instances', UPD_UNSCHEDULED_ID);
    expect(diffSeconds).toBeLessThan(60);
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
