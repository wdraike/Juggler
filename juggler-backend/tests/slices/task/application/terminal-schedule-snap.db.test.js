/**
 * sched-audit D-B — terminal-requires-schedule guard must SNAP not REJECT on the
 * unscheduled lane.
 *
 * DAVID RULING D-B: unscheduled tasks are resolvable in place — done/skip/cancel
 * work directly, completion stamps now. abby's backend-gap finding
 * (L5-DOCS-CHANGELOG.md): the TERMINAL_REQUIRES_SCHEDULE guard in
 * UpdateTaskStatus.js:144-157 still 400s a terminal-status write on
 * scheduled_at=NULL rows unless recur.type==='rolling'. A plain one-off or a
 * daily/weekly recurring instance in the unscheduled lane shows an enabled
 * Done/Skip/Cancel button that fails server-side with
 * SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS.
 *
 * ── WHY the guard exists (git archaeology) ───────────────────────────────────
 * Migration 20260527213906_add_terminal_scheduled_at_constraint.js added
 * `chk_task_instances_terminal_scheduled` on task_instances:
 *   CHECK (status NOT IN ('done','skip','cancel','missed') OR scheduled_at IS NOT NULL)
 * — a DB-level data-integrity invariant for the cal-history/purge-cron views
 * (terminal rows must carry a placement timestamp). The app-level
 * TERMINAL_REQUIRES_SCHEDULE guard in UpdateTaskStatus.js was added to turn a
 * raw MySQL CHECK-violation 500 into a clean 400 BEFORE the write — but it
 * REJECTS instead of resolving, and the snap-to-now logic later in the same
 * function (lines 182-193, "Future-done: snap scheduled_at to now") only fires
 * when `existing.scheduled_at` is already set (a future placement) — it never
 * fires for the truly-unscheduled case, so there was never a way to satisfy
 * the guard for an unscheduled row from the terminal-write path itself.
 *
 * The invariant the guard legitimately protects is NOT "terminal writes on
 * unscheduled rows must be rejected" — it is "terminal rows must END UP with a
 * non-null scheduled_at" (the DB CHECK constraint, still enforced independent
 * of the app). Per D-B, the correct fix is snap-then-write: when scheduled_at
 * is null and the caller does not supply one, snap it to now() and proceed,
 * for BOTH plain one-offs and non-rolling (daily/weekly) recurring instances.
 * The existing rolling-instance exemption (scheduled by the scheduler; already
 * has a scheduled_at in the normal case) must keep working unchanged.
 *
 * ── Coverage ──────────────────────────────────────────────────────────────────
 *   1/2/3 — plain unscheduled one-off + daily-recurring unscheduled instance,
 *           status in {done, skip, cancel} → RED now (400
 *           SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS); expected GREEN behavior:
 *           200, scheduled_at snapped to ~now, completed_at set.
 *   4      — control: rolling-recurrence instance that ALREADY has a
 *           scheduled_at (the normal production shape — the scheduler placed
 *           it) stays allowed AND its scheduled_at is left UNCHANGED (no
 *           spurious re-snap of an already-valid placement).
 *   5      — control: the DB CHECK constraint chk_task_instances_terminal_scheduled
 *           is still live and independently rejects a NULL-scheduled_at terminal
 *           write that bypasses the use-case entirely — this is the invariant
 *           the fix must satisfy (snap before write), not relitigate.
 *
 * Test-bed: MySQL on 3407 (juggler_test), via the real KnexTaskRepository (W5
 * DB-backed harness pattern — tests/slices/task/application/commands.db.test.js).
 * Isolation: unique USER_ID; full teardown in afterAll + beforeEach.
 *
 * Traceability: .planning/kermit/sched-audit/TRACEABILITY.md D-B row.
 */

'use strict';

process.env.NODE_ENV = 'test';

var { assertDbAvailable } = require('../../../helpers/requireDB');
var KnexTaskRepository = require('../../../../src/slices/task/adapters/KnexTaskRepository');
var UpdateTaskStatus = require('../../../../src/slices/task/application/commands/UpdateTaskStatus');
var tasksWrite = require('../../../../src/lib/tasks-write');
var { isRollingMaster } = require('../../../../src/lib/rolling-anchor');
var { scheduledAtToISO } = require('../../../../src/slices/task/domain/mappers/taskMappers');
var H = require('./_helpers');
var { z } = require('zod');

var knex = require('knex')(require('../../../../knexfile.js').test);
var USER = 'sa-db-guard-user';

var statusUpdateSchema = z.object({
  status: z.enum(['', 'done', 'wip', 'cancel', 'skip', 'pause', 'disabled']),
  completedAt: z.string().optional(),
  time_remaining: z.number().optional()
}).passthrough();

function repo() { return new KnexTaskRepository({ db: knex }); }

// Real production wiring for loadMaster/isRollingMaster (facade.js:516/93); fakes
// for the raw-table side-effect collaborators the use-case injects but this guard
// does not exercise (mirrors the established W5 DB-backed pattern in
// commands.db.test.js — real ports, faked non-port collaborators).
function makeUc(overrides) {
  var r = repo();
  return new UpdateTaskStatus(H.baseDeps(Object.assign({
    repo: r,
    cache: H.makeCacheFake(),
    events: H.makeEventsSpy(),
    enqueueScheduleRun: H.makeTriggerSpy(),
    statusUpdateSchema: statusUpdateSchema,
    materializeRcInstance: function () { return Promise.resolve(null); },
    handleTemplatePause: function () { return Promise.resolve({}); },
    loadMaster: function (masterId, userId) { return r.getMasterById(masterId, userId); },
    isRollingMaster: isRollingMaster,
    applyRollingAnchor: function () { return Promise.resolve(); },
    loadSplitSiblings: function () { return Promise.resolve([]); },
    triggerCalSync: { sync: function () {} },
    reactivateDoneFrozen: function () { return Promise.resolve(); }
  }, overrides || {})));
}

function baseRow(id, overrides) {
  return Object.assign({
    id: id,
    user_id: USER,
    task_type: 'task',
    text: 'D-B guard fixture ' + id,
    status: '',
    scheduled_at: null,
    dur: 30,
    pri: 'P3',
    created_at: new Date(),
    updated_at: new Date()
  }, overrides || {});
}

async function seedOneOff(id) {
  await tasksWrite.insertTask(knex, baseRow(id));
}

async function seedDailyRecurringInstance(masterId, instId) {
  await tasksWrite.insertTask(knex, baseRow(masterId, {
    task_type: 'recurring_template',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily' })
  }));
  await tasksWrite.insertTask(knex, baseRow(instId, {
    task_type: 'recurring_instance',
    source_id: masterId,
    scheduled_at: null,
    unscheduled: 1
  }));
}

async function seedRollingScheduledInstance(masterId, instId, scheduledAt) {
  await tasksWrite.insertTask(knex, baseRow(masterId, {
    task_type: 'recurring_template',
    recurring: 1,
    recur: JSON.stringify({ type: 'rolling' })
  }));
  await tasksWrite.insertTask(knex, baseRow(instId, {
    task_type: 'recurring_instance',
    source_id: masterId,
    scheduled_at: scheduledAt
  }));
}

async function fetchInstance(id) {
  return knex('task_instances').where({ id: id, user_id: USER }).first();
}

async function cleanupAll() {
  await knex('task_instances').where('user_id', USER).del();
  await knex('task_masters').where('user_id', USER).del();
  await knex('users').where('id', USER).del();
}

beforeAll(async function () {
  await assertDbAvailable();
  await cleanupAll();
  await knex('users').insert({
    id: USER, email: USER + '@sa.test', name: USER, timezone: 'America/New_York',
    created_at: new Date(), updated_at: new Date()
  });
}, 20000);

afterAll(async function () {
  await cleanupAll();
  await knex.destroy();
});

afterEach(async function () {
  // Each test uses its own unique ids; no interdependence, but keep the tables
  // clean between tests so a failed assertion in one never masks another.
  await knex('task_instances').where('user_id', USER).del();
  await knex('task_masters').where('user_id', USER).del();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1/2/3 — RED: unscheduled one-off + unscheduled daily-recurring instance,
// terminal status in {done, skip, cancel} → must SNAP + SUCCEED, not 400.
// ═══════════════════════════════════════════════════════════════════════════

describe.each([
  ['plain unscheduled one-off (scheduled_at=NULL)', 'oneoff'],
  ['daily recurring instance (unscheduled=1, scheduled_at=NULL — juggy4 overdue-lane shape)', 'daily']
])('D-B: %s + terminal status → snap-then-write', function (_label, shape) {

  test.each(['done', 'skip', 'cancel'])('status=%s → 200 (SUCCESS), scheduled_at snapped to ~now, completed_at set — RED now (400)', async function (status) {
    var id = 'sa-' + shape + '-' + status;
    var masterId = 'sa-' + shape + '-' + status + '-master';

    if (shape === 'oneoff') {
      await seedOneOff(id);
    } else {
      await seedDailyRecurringInstance(masterId, id);
    }

    var before = Date.now();
    var uc = makeUc();
    var out = await uc.execute({ id: id, userId: USER, body: { status: status } });
    var after = Date.now();

    // RED on current code: out.status === 400, out.body.code ===
    // 'SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS'. Expected GREEN behavior:
    expect(out.status).toBe(200);
    expect(out.body.task.status).toBe(status);

    var row = await fetchInstance(id);
    expect(row.status).toBe(status);
    // The invariant the DB CHECK constraint enforces: scheduled_at is NEVER
    // null on a terminal row. The fix must SNAP it to ~now, not merely allow
    // the write (which the DB would reject anyway — see control 5 below).
    expect(row.scheduled_at).toBeTruthy();
    // telly fix (leg sched-audit 2026-07-03, bert REFER db-guard-3): the
    // knexfile `test` connection uses dateStrings:true — row.scheduled_at
    // is a tz-less "YYYY-MM-DD HH:MM:SS" string. A naive `new Date(row.scheduled_at)`
    // parses it as LOCAL time (the documented juggler dateStrings/new-Date
    // misparse trap — see project memory), skewing the comparison by the
    // host's UTC offset. Use the project's own UTC-safe reparse helper
    // (taskMappers.scheduledAtToISO, the same "append Z" pattern control
    // test 4 in this file already documents) instead of round-tripping
    // through a bare `new Date()`.
    var snappedAt = new Date(scheduledAtToISO(row.scheduled_at)).getTime();
    expect(snappedAt).toBeGreaterThanOrEqual(before - 5000);
    expect(snappedAt).toBeLessThanOrEqual(after + 5000);

    // completed_at stamped on the non-terminal → terminal transition
    // (isTerminalStatus covers done/cancel/skip/pause — UpdateTaskStatus.js:164).
    expect(row.completed_at).toBeTruthy();
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — control: rolling-recurrence instance that ALREADY HAS a scheduled_at
// (normal production shape) stays allowed, and its scheduled_at must NOT be
// spuriously re-snapped — regression guard for the existing rolling exemption
// (UpdateTaskStatus.js:150-153) plus the new unconditional-snap fix.
// ═══════════════════════════════════════════════════════════════════════════

describe('D-B control: rolling recurrence instance WITH scheduled_at already set', function () {

  test('status=done on a SCHEDULED rolling instance → 200, scheduled_at UNCHANGED, completed_at set', async function () {
    var masterId = 'sa-rolling-sched-master';
    var id = 'sa-rolling-sched-inst';
    var originalScheduledAt = '2026-06-01 15:00:00';
    await seedRollingScheduledInstance(masterId, id, originalScheduledAt);

    var uc = makeUc();
    var out = await uc.execute({ id: id, userId: USER, body: { status: 'done' } });

    expect(out.status).toBe(200);
    expect(out.body.task.status).toBe('done');

    var row = await fetchInstance(id);
    expect(row.status).toBe('done');
    expect(row.completed_at).toBeTruthy();
    // Must NOT be re-snapped to now — the original scheduler-placed timestamp
    // is preserved (this instance is not future-scheduled relative to the
    // fixed date used here, so the existing "future-done" snap branch
    // (UpdateTaskStatus.js:190-192) also does not fire).
    // NB: knexfile `test` connection uses dateStrings:true — row.scheduled_at
    // comes back as the raw DB string already, in DB-local wall-clock form.
    // Compare it directly; do NOT round-trip through `new Date()` (that parses
    // a tz-less string as LOCAL time and re-serializing via toISOString() would
    // silently shift by the host's UTC offset — the documented juggler
    // dateStrings/new Date() misparse trap).
    expect(String(row.scheduled_at)).toBe(originalScheduledAt);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 5 — control: the DB CHECK constraint the app guard exists to front-run is
// still live. Proves the guard's LEGITIMATE job (terminal rows must end up
// with a non-null scheduled_at) is a real, independently-enforced invariant —
// so the correct fix is snap-then-write, never a bare removal of the guard.
// ═══════════════════════════════════════════════════════════════════════════

describe('D-B control: chk_task_instances_terminal_scheduled DB CHECK constraint', function () {

  test('a raw UPDATE writing status=done with scheduled_at still NULL is rejected by the DB', async function () {
    var id = 'sa-control-constraint';
    await seedOneOff(id);

    await expect(
      knex('task_instances').where({ id: id, user_id: USER }).update({ status: 'done' })
    ).rejects.toThrow(/constraint|chk_task_instances_terminal_scheduled/i);

    // Row must be unchanged (the constraint violation rolled back the write).
    var row = await fetchInstance(id);
    expect(row.status).toBe('');
  });

});
