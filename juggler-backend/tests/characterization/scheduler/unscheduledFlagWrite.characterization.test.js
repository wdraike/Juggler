/**
 * B2 (W3a) — runSchedule.js:1273 unscheduled-flag bulk update characterization
 *
 * Leg: 999.941 (juggler scheduler refactor, Oscar STEP 0 — telly pre-refactor baseline)
 * Traceability: .planning/kermit/999.941/TRACEABILITY.md row B2
 *
 * THE REFACTOR TARGET (LANDED — status as of 2026-07-01, zoe ZOE-REVIEW.md WARN #2 fix):
 *   runSchedule.js:1273 previously issued a single bulk
 *     await db('task_instances').whereIn('id', toDeleteIds)
 *       .update({ unscheduled: 1, updated_at: _runScheduleCommand.clockNow() });
 *   against the plain `db` handle (deliberately NOT the reconcile's `trx` — see
 *   the comment at runSchedule.js:1270-1272, preserved) so the safety-net flag
 *   write survives even if the immediately-following delete
 *   (`_runScheduleCommand.deleteTasksWhere(trx, ...)`) rolls back on a lock
 *   timeout. It NOW routes through `_runScheduleCommand.persistDelta(db, ...)`
 *   → `ScheduleRepositoryPort.writeChanged`'s `otherUpdates` bucket — N per-row
 *   `updateTaskById` calls instead of one bulk `whereIn().update()`, still
 *   against `db` (not `trx`), preserving the same rollback-independence
 *   property. Per the WBS acceptance bar, the refactor's obligation was
 *   END-STATE equivalence (same final row state), NOT literal query-shape
 *   identity — the bulk-vs-N-calls divergence is an ACCEPTED, INFO-severity
 *   tradeoff (INTAKE-BRIEF.json risk_flags "PERF/QUERY-COUNT DIVERGENCE";
 *   ernie CODE-REVIEW.md + cookie ARCH-REVIEW.md concurred), with the
 *   consequence (a non-atomic partial-write window) pinned as its own
 *   POST-REFACTOR-ONLY regression test below (see PARTIAL-FAILURE, NOT a
 *   before/after characterization pin).
 *
 * WHAT THIS SUITE PINS:
 *   1. (Primary pin) The row's FINAL STATE after the write — unscheduled=1,
 *      updated_at advanced — is observable ONLY when something prevents the
 *      immediately-following DELETE from also removing the row (in the
 *      unmodified happy path the delete succeeds and the row is gone, which is
 *      itself pinned as a control below). The one case in CURRENT production
 *      code where the flag write's result is independently observable is
 *      EXACTLY the scenario runSchedule.js's own comment describes: the
 *      deletion transaction fails/rolls back. This suite forces that scenario
 *      (via a controlled `RunScheduleCommand.prototype.deleteTasksWhere`
 *      rejection — NOT a code-path mock of the write itself) and asserts the
 *      row state the write produced. Any post-W3a replacement (N per-row
 *      `updateTaskById` calls via `db`, per B3 in behavior_contract) must
 *      reproduce this exact end state under the same forced-failure scenario.
 *   2. (Control / sanity pin) With NO forced failure, the same orphaned
 *      instance is genuinely hard-deleted — proving the fixture really lands
 *      in `toDeleteIds` (runSchedule.js:1189-1234) and isn't silently spared
 *      by one of the grandfather clauses, which would make pin #1 vacuous.
 *   3. (Many-id pin, added post-CODE-REVIEW Finding #5 / ernie REFER→telly)
 *      The SAME forced-rollback scenario as pin #1, but with THREE orphaned
 *      instances in one `toDeleteIds` batch — asserts EVERY row (not just the
 *      first/last) independently gets unscheduled=1 + updated_at advanced.
 *      This matters because W3a routes the batch through a per-row for-loop
 *      (`KnexScheduleRepository.writeChanged`'s otherUpdates path, N calls to
 *      `updateTaskById`) rather than the legacy single bulk `whereIn().update()`
 *      — a bug that only mis-handles e.g. the 2nd+ row in the loop (an
 *      off-by-one, a shared mutable object reused across iterations, etc.)
 *      would pass a single-id suite and only show up with >1 id.
 *   4. (Partial-failure pin, added post-CODE-REVIEW Finding #5) Forces
 *      `tasksWrite.updateTaskById` (the real per-row write fn the otherUpdates
 *      loop calls) to throw on the MIDDLE id of a 3-id batch — NOT a contrived
 *      fault, but the exact atomicity divergence ARCH-REVIEW Finding #4
 *      documents: the legacy bulk `UPDATE ... WHERE id IN (...)` was one
 *      atomic statement (all-or-nothing), while the per-row for-loop has no
 *      try/catch, so a throw partway through the loop leaves a PARTIAL set of
 *      `unscheduled=1` flags. This suite proves that partial-write shape
 *      empirically: the id BEFORE the injected failure is written, the failing
 *      id and every id AFTER it are not (loop aborts on first unhandled
 *      rejection) — end-state proof, not an assumption from reading the loop.
 *   5. (task_masters.updated_at non-interference pin, added post-CODE-REVIEW
 *      Finding #5 / cookie ARCH-REVIEW Finding #1 "harmless 0-row mirror
 *      write") `updateTaskById`'s `splitUpdateFields` mirrors `updated_at` to
 *      BOTH `task_masters` and `task_instances` when present in `changes`
 *      (tasks-write.js:156-159), so each per-row write in the otherUpdates
 *      loop also issues `UPDATE task_masters WHERE id=<instance_id> AND
 *      user_id=... SET updated_at=...`. Because a recurring-instance id never
 *      equals its master's id, that statement matches 0 rows — but this suite
 *      confirms empirically (not by re-reading the code) that the REAL
 *      master row's `updated_at` is byte-identical before/after the reconcile
 *      run, i.e. the mirror write is truly a no-op here and never touches a
 *      row that exists.
 *
 * FIXTURE DESIGN (how an orphaned pending instance reaches toDeleteIds):
 *   A recurring master with `recur_start` set 30 DAYS OUT (beyond the 14-day
 *   RECUR_EXPAND_DAYS horizon) means `expandRecurring` generates ZERO desired
 *   occurrences for this master in the whole reconcile window — verified
 *   directly against shared/scheduler/expandRecurring.js (the anchor gates
 *   generation via `c >= anchor`/`cursor < anchor` checks; a script run
 *   confirmed `expandRecurring([master], today, expandEnd, {})` → `[]` when
 *   recurStart is +30d). This matters because the reconciler
 *   (`reconcile.matchOccurrences`) does NEAREST-DATE matching, not strict-id
 *   matching — an earlier version of this fixture used `recur_start` only
 *   ONE day out, and the reconciler re-targeted (rather than orphaned) the
 *   pending row onto the master's first future occurrence (observed directly:
 *   the row's `date` moved to the master's recur_start date instead of being
 *   deleted). With ZERO desired occurrences for the master, there is no
 *   candidate for the reconciler to match the pending row onto at all — it is
 *   genuinely orphaned.
 *
 *   A pre-existing pending task_instances row dated TOMORROW is therefore not
 *   in `desiredIds`, and is NOT protected by either grandfather clause:
 *     - `rowDate > expandEnd` (beyond-horizon spare) — false, tomorrow is
 *       within the 14-day RECUR_EXPAND_DAYS horizon (only the MASTER's next
 *       occurrence is far out — the ROW's own date is what this grandfather
 *       checks).
 *     - `rowDate <= today && task_type==='recurring_instance'` (past spare)
 *       — false, tomorrow is in the future.
 *   It falls through to `return true` → toDeleteIds. The CONTROL test below
 *   confirms this empirically (row is hard-deleted on unmodified code with no
 *   forced failure) before the PIN test relies on it.
 *
 * Run:
 *   cd juggler/juggler-backend
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test \
 *     NODE_ENV=test npx jest tests/characterization/scheduler/unscheduledFlagWrite.characterization.test.js \
 *     --testTimeout=30000 --forceExit
 *
 * Requires: cd test-bed && make up
 */

'use strict';

process.env.NODE_ENV = 'test';

var testDb = require('../../helpers/testDb');
var { runScheduleAndPersist } = require('../../../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../../src/scheduler/constants');
var RunScheduleCommand = require('../../../src/slices/scheduler/application/RunScheduleCommand');
// Same module instance KnexScheduleRepository.js requires (`require('../../../lib/tasks-write')`
// from src/slices/scheduler/adapters/) — CommonJS caches it, so spying a method here is observed
// by the repository's `this.tasksWrite.updateTaskById(...)` call.
var tasksWrite = require('../../../src/lib/tasks-write');
// 999.1632: anchor fixture "today+N" to the PRODUCT's own clock
// (getNowInTimezone) instead of process-local `new Date()` getters — the
// process TZ (UTC in CI) can disagree with America/New_York's calendar day.
var { dateFromToday } = require('../../helpers/schedulerClock');

var USER_ID = 'unschedflag-test-u1';
var TZ = 'America/New_York';

var db;
var dbAvailable = false;

async function cleanupUser() {
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeAll(async () => {
  dbAvailable = await testDb.isAvailable();
  if (!dbAvailable) {
    throw new Error(
      '[TEST-FR-001] test-bed DB not reachable at ' +
      process.env.DB_HOST + ':' + process.env.DB_PORT + '/' + process.env.DB_NAME +
      '. Run: cd test-bed && make up'
    );
  }
  db = testDb.getDb();
  await cleanupUser();
  await testDb.seedUser({ id: USER_ID, email: 'unschedflag@test.com', name: 'Unsched Flag User', timezone: TZ });
  await db('user_config').insert([
    { user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) },
    { user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) }
  ]);
}, 20000);

afterAll(async () => {
  if (dbAvailable) await cleanupUser();
});

beforeEach(async () => {
  if (!dbAvailable) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  jest.restoreAllMocks();
});

function futureISO(daysAhead) {
  return dateFromToday(daysAhead, TZ);
}

async function seedOrphanMaster(overrides) {
  var id = 'usf-' + Math.random().toString(36).slice(2, 10);
  var row = Object.assign({
    id: id,
    user_id: USER_ID,
    text: 'Orphan recurring',
    dur: 15,
    pri: 'P3',
    status: '',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily' }),
    placement_mode: 'anytime',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }, overrides);
  await db('task_masters').insert(row);
  return row;
}

async function seedOrphanInstance(masterId, overrides) {
  var id = overrides.id || (masterId + '-1');
  var row = Object.assign({
    id: id,
    user_id: USER_ID,
    master_id: masterId,
    dur: 15,
    status: '',
    unscheduled: null,
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }, overrides);
  await db('task_instances').insert(row);
  return row;
}

describe('B2 (W3a) — runSchedule.js:1273 unscheduled-flag write on toDeleteIds', () => {
  it('CONTROL/sanity: with the delete path NOT interfered with, the orphaned instance IS hard-deleted (confirms the fixture really reaches toDeleteIds — else pin #1 below would be vacuous)', async () => {
    var tomorrow = futureISO(1);
    var farFuture = futureISO(30); // beyond the 14-day RECUR_EXPAND_DAYS horizon
    var master = await seedOrphanMaster({ recur_start: farFuture });
    var orphan = await seedOrphanInstance(master.id, {
      id: master.id + '-orphan-ctrl',
      date: tomorrow,
      scheduled_at: tomorrow + ' 08:00:00',
      occurrence_ordinal: 1
    });

    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });

    var row = await db('task_instances').where({ id: orphan.id }).first();
    // SANITY: the row is genuinely gone — proves this fixture reaches the
    // toDeleteIds/delete code path on unmodified code, not spared by a
    // grandfather clause.
    expect(row).toBeUndefined();
  }, 20000);

  it('PIN: the safety-net flag write (unscheduled=1, updated_at advanced) persists even when the subsequent delete fails — proving it commits independently of the surrounding reconcile transaction (runSchedule.js:1270-1273 comment)', async () => {
    var tomorrow = futureISO(1);
    var farFuture = futureISO(30); // beyond the 14-day RECUR_EXPAND_DAYS horizon
    var master = await seedOrphanMaster({ recur_start: farFuture });
    var orphan = await seedOrphanInstance(master.id, {
      id: master.id + '-orphan-pin',
      date: tomorrow,
      scheduled_at: tomorrow + ' 08:00:00',
      occurrence_ordinal: 2
    });

    // Baseline updated_at BEFORE the run (MySQL DATETIME has 1s precision —
    // sleep so a later write is distinguishable from the seed timestamp).
    var before = await db('task_instances').where({ id: orphan.id }).select('unscheduled', 'updated_at').first();
    expect(before.unscheduled).not.toBe(1);
    await new Promise(function (resolve) { setTimeout(resolve, 1100); });

    // Force the surrounding reconcile transaction to fail AFTER the plain-db
    // safety-net update at runSchedule.js:1273 has already executed (that
    // update is issued against `db`, not `trx` — see the comment at
    // runSchedule.js:1270-1272). This reproduces the exact scenario the
    // comment names: "so this persists even if the deletion transaction rolls
    // back on a lock timeout." The mocked error deliberately has no
    // ER_LOCK_DEADLOCK/ER_LOCK_WAIT_TIMEOUT code so runScheduleAndPersist's
    // retry wrapper (runSchedule.js:2532-2538) does not retry — it rethrows
    // immediately.
    var deleteSpy = jest.spyOn(RunScheduleCommand.prototype, 'deleteTasksWhere')
      .mockImplementationOnce(function () {
        return Promise.reject(new Error('SIMULATED_TRX_FAILURE_not_a_deadlock_code'));
      });

    await expect(runScheduleAndPersist(USER_ID, undefined, { timezone: TZ }))
      .rejects.toThrow('SIMULATED_TRX_FAILURE_not_a_deadlock_code');

    expect(deleteSpy).toHaveBeenCalledTimes(1);

    // ── THE PIN ──
    // Even though the surrounding trx (and therefore the delete) failed and
    // rolled back, the row's unscheduled flag write must have committed
    // independently (it was issued against the plain `db` handle).
    var after = await db('task_instances').where({ id: orphan.id }).select('id', 'unscheduled', 'updated_at').first();
    expect(after).toBeDefined();
    expect(after.unscheduled).toBe(1);
    expect(String(after.updated_at)).not.toBe(String(before.updated_at));

    deleteSpy.mockRestore();
  }, 20000);

  it('MANY-ID PIN: with THREE orphaned instances in one toDeleteIds batch and the same forced delete-failure, EVERY row (not just the first/last) independently gets unscheduled=1 + updated_at advanced', async () => {
    var tomorrow = futureISO(1);
    var day2 = futureISO(2);
    var day3 = futureISO(3);
    var farFuture = futureISO(30); // beyond the 14-day RECUR_EXPAND_DAYS horizon
    var master = await seedOrphanMaster({ recur_start: farFuture });
    var orphans = [
      await seedOrphanInstance(master.id, { id: master.id + '-many-1', date: tomorrow, scheduled_at: tomorrow + ' 08:00:00', occurrence_ordinal: 3 }),
      await seedOrphanInstance(master.id, { id: master.id + '-many-2', date: day2, scheduled_at: day2 + ' 08:00:00', occurrence_ordinal: 4 }),
      await seedOrphanInstance(master.id, { id: master.id + '-many-3', date: day3, scheduled_at: day3 + ' 08:00:00', occurrence_ordinal: 5 })
    ];

    var beforeRows = {};
    for (var bi = 0; bi < orphans.length; bi++) {
      var b = await db('task_instances').where({ id: orphans[bi].id }).select('unscheduled', 'updated_at').first();
      expect(b.unscheduled).not.toBe(1);
      beforeRows[orphans[bi].id] = b;
    }
    // MySQL DATETIME has 1s precision — sleep so a later write is distinguishable.
    await new Promise(function (resolve) { setTimeout(resolve, 1100); });

    // Same forced-rollback scenario as the single-id PIN above: the delete
    // transaction fails AFTER the plain-db safety-net writes for ALL THREE
    // ids in this batch have already executed (persistDelta completes the
    // whole otherUpdates loop before deleteTasksWhere is even called).
    var deleteSpy = jest.spyOn(RunScheduleCommand.prototype, 'deleteTasksWhere')
      .mockImplementationOnce(function () {
        return Promise.reject(new Error('SIMULATED_TRX_FAILURE_not_a_deadlock_code'));
      });

    await expect(runScheduleAndPersist(USER_ID, undefined, { timezone: TZ }))
      .rejects.toThrow('SIMULATED_TRX_FAILURE_not_a_deadlock_code');

    expect(deleteSpy).toHaveBeenCalledTimes(1);

    // ── THE PIN — assert EVERY row, not just one ──
    for (var ai = 0; ai < orphans.length; ai++) {
      var id = orphans[ai].id;
      var after = await db('task_instances').where({ id: id }).select('id', 'unscheduled', 'updated_at').first();
      expect(after).toBeDefined();
      expect(after.unscheduled).toBe(1);
      expect(String(after.updated_at)).not.toBe(String(beforeRows[id].updated_at));
    }

    deleteSpy.mockRestore();
  }, 20000);

  // NOT A BEFORE/AFTER CHARACTERIZATION PIN (zoe ZOE-REVIEW.md WARN #1, 2026-07-01):
  // this test only passes on the POST-refactor per-row otherUpdates loop. On the
  // OLD pre-refactor code (a single bulk `whereIn().update()`) it goes RED, because
  // that path never calls `tasksWrite.updateTaskById` at all, so the injected spy
  // never fires and nothing throws. It documents a NEW, accepted (INFO, not
  // BLOCK/WARN — see ernie CODE-REVIEW.md + cookie ARCH-REVIEW.md) behavior
  // divergence introduced BY this refactor: the old bulk statement was atomic
  // (all-or-nothing); the new per-row loop is not, so a mid-loop throw leaves a
  // partial write. Kept as a live regression pin on the new behavior, not as
  // proof the refactor preserved old behavior.
  it('POST-REFACTOR BEHAVIOR (new, not preserved-behavior): a mid-loop throw in the otherUpdates per-row loop leaves a PARTIAL set of unscheduled=1 flags — the id before the injected failure is written, the failing id and every id after it are not (ARCH-REVIEW Finding #4 atomicity divergence, proved end-to-end not assumed from reading the loop)', async () => {
    var tomorrow = futureISO(1);
    var day2 = futureISO(2);
    var day3 = futureISO(3);
    var farFuture = futureISO(30);
    var master = await seedOrphanMaster({ recur_start: farFuture });
    // Ids chosen so lexicographic sort (writeChanged's `pendingUpdates.sort` by
    // id, KnexScheduleRepository.js:103) is deterministic and known: -a < -b < -c.
    var idA = master.id + '-a';
    var idB = master.id + '-b';
    var idC = master.id + '-c';
    var a = await seedOrphanInstance(master.id, { id: idA, date: tomorrow, scheduled_at: tomorrow + ' 08:00:00', occurrence_ordinal: 6 });
    var b = await seedOrphanInstance(master.id, { id: idB, date: day2, scheduled_at: day2 + ' 08:00:00', occurrence_ordinal: 7 });
    var c = await seedOrphanInstance(master.id, { id: idC, date: day3, scheduled_at: day3 + ' 08:00:00', occurrence_ordinal: 8 });

    var beforeA = await db('task_instances').where({ id: idA }).select('unscheduled', 'updated_at').first();
    var beforeB = await db('task_instances').where({ id: idB }).select('unscheduled', 'updated_at').first();
    var beforeC = await db('task_instances').where({ id: idC }).select('unscheduled', 'updated_at').first();
    expect(beforeA.unscheduled).not.toBe(1);
    expect(beforeB.unscheduled).not.toBe(1);
    expect(beforeC.unscheduled).not.toBe(1);
    await new Promise(function (resolve) { setTimeout(resolve, 1100); });

    // Inject the fault at the REAL per-row write fn the otherUpdates loop
    // calls (`this.tasksWrite.updateTaskById`, KnexScheduleRepository.js:187)
    // — not a code-path mock of the whole write. Reject only for the MIDDLE
    // id; every other id falls through to the real implementation, so this
    // is a genuine partial-batch fault, not a full-batch failure.
    var realUpdateTaskById = tasksWrite.updateTaskById;
    var updateSpy = jest.spyOn(tasksWrite, 'updateTaskById').mockImplementation(function (dbOrTrx, id, changes, userId) {
      if (id === idB) {
        return Promise.reject(new Error('SIMULATED_MIDLOOP_FAILURE_row_b'));
      }
      return realUpdateTaskById(dbOrTrx, id, changes, userId);
    });

    await expect(runScheduleAndPersist(USER_ID, undefined, { timezone: TZ }))
      .rejects.toThrow('SIMULATED_MIDLOOP_FAILURE_row_b');

    // idB's rejection happened inside persistDelta, which runs BEFORE
    // deleteTasksWhere is ever reached this run — so none of the 3 orphaned
    // rows were hard-deleted; all 3 must still exist (proves the delete step
    // truly never ran, not just that idB's flag write failed).
    var afterA = await db('task_instances').where({ id: idA }).select('id', 'unscheduled', 'updated_at').first();
    var afterB = await db('task_instances').where({ id: idB }).select('id', 'unscheduled', 'updated_at').first();
    var afterC = await db('task_instances').where({ id: idC }).select('id', 'unscheduled', 'updated_at').first();
    expect(afterA).toBeDefined();
    expect(afterB).toBeDefined();
    expect(afterC).toBeDefined();

    // ── THE PIN — partial write shape ──
    // Sorted order is idA, idB, idC. The loop reaches idA first (write
    // commits), then idB (throws before its own write commits — our mock
    // rejects BEFORE calling the real implementation), then never reaches idC.
    expect(afterA.unscheduled).toBe(1);
    expect(String(afterA.updated_at)).not.toBe(String(beforeA.updated_at));
    expect(afterB.unscheduled).not.toBe(1);
    expect(String(afterB.updated_at)).toBe(String(beforeB.updated_at));
    expect(afterC.unscheduled).not.toBe(1);
    expect(String(afterC.updated_at)).toBe(String(beforeC.updated_at));

    updateSpy.mockRestore();
  }, 20000);

  it('CONFIRM: task_masters.updated_at is NOT touched by this write path — the updated_at mirror to task_masters that updateTaskById issues (tasks-write.js:156-159) matches 0 rows for a recurring-instance id, and the REAL master row is left byte-identical (cookie ARCH-REVIEW Finding #1 "harmless 0-row mirror write")', async () => {
    var tomorrow = futureISO(1);
    var farFuture = futureISO(30);
    var master = await seedOrphanMaster({ recur_start: farFuture });
    await seedOrphanInstance(master.id, { id: master.id + '-orphan-master-check', date: tomorrow, scheduled_at: tomorrow + ' 08:00:00', occurrence_ordinal: 9 });

    var beforeMaster = await db('task_masters').where({ id: master.id }).select('id', 'updated_at').first();
    await new Promise(function (resolve) { setTimeout(resolve, 1100); });

    // No forced failure needed — the mirror-write (if it touched anything)
    // would fire in the CONTROL happy path too, since it happens inside the
    // same otherUpdates loop that writes the instance's unscheduled flag,
    // regardless of whether the subsequent delete later succeeds.
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });

    var afterMaster = await db('task_masters').where({ id: master.id }).select('id', 'updated_at').first();
    expect(afterMaster).toBeDefined();
    expect(String(afterMaster.updated_at)).toBe(String(beforeMaster.updated_at));
  }, 20000);
});
