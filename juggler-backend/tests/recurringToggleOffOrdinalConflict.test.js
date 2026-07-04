/**
 * BUG-999.833 — Toggle-off recurring→one-shot 500 on existing (1,1) instance.
 *
 * Regression test (RED before fix, GREEN after).
 *
 * Root cause (two-part):
 *
 *   PART 1 — INSERT IGNORE silently swallows the ordinal duplicate.
 *   facade.js ~L291-309 (recurCleanup, recurring_template toggle-off branch):
 *     resetRecurringInstances() soft-cancels only FUTURE pending instances;
 *     a past/non-pending (done) row at (master_id,1,1) survives.
 *     The code then does INSERT ... .onConflict('id').ignore() which MySQL
 *     compiles to `INSERT IGNORE` — this silently ignores ALL duplicate-key
 *     errors, including uq_instance_ordinals. The new instance row is NOT
 *     inserted; the existing (1,1) row stays in place.
 *
 *   PART 2 — Null re-read → 500.
 *   After the transaction, UpdateTask.js L275 re-reads via
 *   fetchTaskWithEventIds(master_id, userId) which queries tasks_v. But tasks_v
 *   only exposes master rows when recurring=1 (first UNION branch). After
 *   toggle-off the master has recurring=0, so it disappears from that branch.
 *   The instance that SHOULD replace it (id=master_id, recurring=0 → 'task'
 *   via the second UNION branch) was NOT inserted (INSERT IGNORE dropped it).
 *   Result: fetchTaskWithEventIds returns null → rowToTask(null, …) throws
 *   "Cannot read properties of null (reading 'source_id')" → 500.
 *
 * Fix (bert's job): repair the toggle-off instance insert so it survives the
 * ordinal conflict (e.g. by using the EXISTING instance id in the re-read, or
 * by using .onConflict(['master_id','occurrence_ordinal','split_ordinal'])
 * .merge() so the row is upserted with the master's id, or by re-reading via
 * the existing instance id when the master is no longer in tasks_v).
 *
 * Covers:
 *   R32 (instance lifecycle — existing terminal/past instances must be preserved
 *        across a recurrence toggle-off).
 * Traceability: fixy-l3followup-ordinal BUG-999.833 (telly W1 RED→GREEN).
 *
 * Requires: cd test-bed && make up  (test-bed MySQL @3407)
 *   then:  DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass \
 *          NODE_ENV=test DB_NAME=juggler_followups_test \
 *          npx jest tests/recurringToggleOffOrdinalConflict.test.js --runInBand
 */

'use strict';

var db = require('../src/db');
var facade = require('../src/slices/task/facade');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'toggle-off-ordinal-conflict-test-001';
var TZ = 'America/New_York';

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) { return; }
  await cleanup();
  await db('users').insert({
    id: USER_ID,
    email: 'toggleoff-ordinal@test.com',
    timezone: TZ,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}, 20000);

afterAll(async () => {
  if (available) await cleanup();
  await db.destroy();
});

async function cleanup() {
  // cal_sync_ledger.task_id has no FK — must delete explicitly first.
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  // cal_history has ON DELETE CASCADE from task_instances, but delete explicitly for clarity.
  await db('cal_history').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
});

// ─── helpers ────────────────────────────────────────────────────────────────

var MASTER_ID = 'tog-off-master-001';

/**
 * Seed a recurring master row.
 * Note: task_type is NOT a column on task_masters — it is a derived column
 * in tasks_v (always 'recurring_template' when recurring=1).
 */
async function seedMaster() {
  await db('task_masters').insert({
    id: MASTER_ID,
    user_id: USER_ID,
    text: 'Daily standup',
    dur: 30,
    pri: 'P2',
    status: '',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

/**
 * Seed a task_instances row at (master_id=MASTER_ID, occurrence_ordinal=1,
 * split_ordinal=1) with a NON-EMPTY status ('done') and a PAST scheduled_at.
 *
 * NON-EMPTY status ensures resetRecurringInstances() does NOT soft-cancel it
 * (it only soft-cancels future pending status='' rows), so the row survives
 * into the INSERT step and triggers the ordinal-constraint conflict.
 *
 * The instance id intentionally DIFFERS from MASTER_ID — this exposes that
 * .onConflict('id').ignore() does NOT protect against the ordinal unique
 * constraint uq_instance_ordinals(master_id, occurrence_ordinal, split_ordinal).
 * MySQL compiles .onConflict('id').ignore() as INSERT IGNORE which silently
 * swallows ALL duplicate-key errors including the ordinal constraint.
 */
async function seedExistingDoneInstance() {
  await db('task_instances').insert({
    id: 'tog-off-inst-existing-done',   // different from MASTER_ID — the crux of the bug
    master_id: MASTER_ID,
    user_id: USER_ID,
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    dur: 30,
    status: 'done',                      // non-empty → NOT soft-cancelled by resetRecurringInstances
    scheduled_at: '2026-01-15 09:00:00', // well in the past → NOT soft-cancelled by resetRecurringInstances
    // `overdue` field removed (sched-drop-overdue-column, M-5): stored column gone.
    generated: 0,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('BUG-999.833: toggle-off recurring → one-shot ordinal conflict', () => {
  /**
   * RED on unfixed code:
   *   The INSERT IGNORE silently drops the new instance (ordinal conflict with
   *   existing (1,1) done row). The master's recurring is updated to 0, so it
   *   disappears from tasks_v (view only includes recurring=1 masters). The
   *   new instance row (id=MASTER_ID) was not inserted (INSERT IGNORE discarded
   *   it). So fetchTaskWithEventIds(MASTER_ID) returns null. rowToTask(null)
   *   crashes: "Cannot read properties of null (reading 'source_id')".
   *
   * GREEN after fix:
   *   The toggle-off completes and returns a { status: 200 } response.
   *   (The fix must ensure the re-read finds the correct row, whether that is
   *   the existing (1,1) instance or a correctly upserted new row.)
   */
  test('(a) toggle-off completes without throwing when (1,1) instance already exists', async () => {
    if (!available) return;

    await seedMaster();
    await seedExistingDoneInstance();

    // Confirm precondition: the (1,1) instance exists with status 'done'
    var before = await db('task_instances')
      .where({ master_id: MASTER_ID, occurrence_ordinal: 1, split_ordinal: 1, user_id: USER_ID })
      .first();
    expect(before).toBeDefined();
    expect(before.status).toBe('done');

    // ── The toggle-off call ──────────────────────────────────────────────────
    // facade.updateTask({ id, userId, body: { recurring: false }, timezoneHeader })
    //
    // On UNFIXED code this throws:
    //   TypeError: Cannot read properties of null (reading 'source_id')
    //   (rowToTask called with null because master disappeared from tasks_v
    //    after recurring was set to 0, and the INSERT IGNORE silently dropped
    //    the replacement instance row)
    //
    // On FIXED code it returns { status: 200, body: { task: … } }.
    var result;
    var threw = null;
    try {
      result = await facade.updateTask({
        id: MASTER_ID,
        userId: USER_ID,
        body: { recurring: false },
        timezoneHeader: TZ
      });
    } catch (err) {
      threw = err;
    }

    // ASSERT (a): must NOT throw
    // On unfixed code threw.message contains 'source_id' (the null-read crash
    // downstream of the INSERT IGNORE silently swallowing the ordinal conflict).
    if (threw) {
      // Confirm it's the exact bug we're targeting, not an unrelated setup error
      expect(threw.message).toMatch(/source_id|Cannot read properties of null|rowToTask/i);
      // Then fail with a clear message for the bug reporter
      throw new Error(
        'BUG-999.833 CONFIRMED: toggle-off threw on null re-read after INSERT IGNORE ' +
        'silently swallowed uq_instance_ordinals conflict. ' +
        'The recurring master (recurring=0) disappeared from tasks_v; ' +
        'the replacement instance was not inserted (ordinal collision). ' +
        'Original error: ' + threw.message
      );
    }

    // If it didn't throw, status must be a success code (not 5xx)
    expect(result).toBeDefined();
    expect(result.status).toBeLessThan(500);
  }, 30000);

  /**
   * RED on unfixed code: test (a) throws first; this test also throws since
   * the facade crashes before returning.
   *
   * GREEN after fix:
   *   The pre-existing 'done' instance at (1,1) must be PRESERVED — its status
   *   and scheduled_at are UNCHANGED after the toggle-off. R32 invariant: a
   *   toggle-off must not overwrite or delete a terminal/past instance.
   *
   * @regression BUG-999.833
   */
  test('(b) pre-existing (1,1) done instance is PRESERVED after toggle-off (R32)', async () => {
    if (!available) return;

    await seedMaster();
    await seedExistingDoneInstance();

    // Run the toggle-off (throws on unfixed code).
    var threw = null;
    try {
      await facade.updateTask({
        id: MASTER_ID,
        userId: USER_ID,
        body: { recurring: false },
        timezoneHeader: TZ
      });
    } catch (err) {
      threw = err;
      // Re-throw so the runner sees a real failure (not a zero-assertion pass).
      throw new Error(
        'BUG-999.833: toggle-off threw (expected on unfixed code). ' +
        'Fix the INSERT IGNORE ordinal-conflict issue first (test a). ' +
        'Original: ' + (err.message || err.code)
      );
    }

    // ASSERT (b): the original 'done' row must still exist and be untouched.
    var after = await db('task_instances')
      .where({ master_id: MASTER_ID, occurrence_ordinal: 1, split_ordinal: 1, user_id: USER_ID })
      .first();

    expect(after).toBeDefined();
    // Status must still be 'done' — the fix must NOT overwrite the existing instance.
    expect(after.status).toBe('done');
    // scheduled_at must be preserved (not nulled out or changed).
    expect(after.scheduled_at).not.toBeNull();
  }, 30000);
});

// ─────────────────────────────────────────────────────────────────────────────
// FK-path regression (ernie REFER→telly):
//
// ernie observed that the original repro seeds NO cal_history row and NO
// cal_sync_ledger row, so it never exercises the FK path that made an earlier
// `.merge(['id'])` approach unsafe.
//
// INTENT OF TESTS (c)/(d)/(e):
//
//   (c) is a FORWARD-GUARD — it asserts the fix does NOT use a PK-rename
//   (.merge(['id'])) approach that WOULD throw FK-1451 when a cal_history row
//   references the instance. On the CURRENT .onConflict(ordinals).ignore() fix,
//   no rename occurs so the FK is never triggered and (c) passes because the
//   null-read crash is fixed (a/b) AND no PK mutation is attempted.
//   The `isFkError` branch in (c) only fires if a FUTURE change re-introduces a
//   PK-rename approach — that is what (c) guards against.
//
//   (d) and (e) assert the REAL surviving invariants: after toggle-off, the
//   instance id is UNCHANGED (no PK rename occurred) so both the cal_history FK
//   pointer and the cal_sync_ledger task_id pointer remain valid and non-orphaned.
//   These are meaningful assertions that would catch a PK-rename regression even
//   if (c)'s FK throw were somehow suppressed.
//
// FK behaviour recap:
//   cal_history.task_id → FK → task_instances(id) ON DELETE CASCADE, ON UPDATE RESTRICT.
//   If the fix used UPDATE task_instances SET id=MASTER_ID WHERE id=existing_instance_id,
//   MySQL would throw ER_ROW_IS_REFERENCED_2 (errno 1451) due to ON UPDATE RESTRICT.
//
// The CURRENT fix uses `.onConflict(['master_id','occurrence_ordinal','split_ordinal'])
// .ignore()` — NO PK mutation occurs. The existing (1,1) instance keeps its original id.
// The re-read uses fetchOneShottedInstanceId (reads surviving instance by ordinals)
// → fetchTaskWithEventIds(survivingId). Both FK columns stay valid.
//
// Covers: BUG-999.833 FK-path forward-guard (c) + surviving-pointer invariants (d/e)
// Traceability: fixy-l3followup-ordinal BUG-999.833 (telly FK-path extension per ernie REFER)
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-999.833: FK-path regression — cal_history + cal_sync_ledger integrity', () => {
  // The existing instance id used in all FK-path tests (same as existing tests).
  var EXISTING_INST_ID = 'tog-off-inst-existing-done';

  /**
   * Seed a cal_history row whose task_id = the (1,1) instance id.
   *
   * cal_history schema (20260530000000_create_cal_history_schema.js):
   *   id INT AUTO_INCREMENT PK
   *   task_id VARCHAR(100) NOT NULL  — FK → task_instances(id) ON DELETE CASCADE
   *   user_id VARCHAR(36) NOT NULL
   *   scheduled_at DATETIME NOT NULL
   *   status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
   *   ... (completed_at, previous_status, calendar_provider, etc. nullable)
   *
   * Current status enum (20260605010000_fix_cal_history_status_enum.js):
   *   'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'
   */
  async function seedCalHistoryForInstance(instanceId) {
    await db('cal_history').insert({
      task_id: instanceId,
      user_id: USER_ID,
      scheduled_at: '2026-01-15 09:00:00',
      status: 'COMPLETED',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
  }

  /**
   * Seed an ACTIVE cal_sync_ledger row whose task_id = the (1,1) instance id.
   *
   * cal_sync_ledger schema (20260315000000_unified_cal_sync_ledger.js):
   *   id INT AUTO_INCREMENT PK
   *   user_id VARCHAR(36) NOT NULL  — FK → users(id) ON DELETE CASCADE
   *   provider VARCHAR(10) NOT NULL
   *   task_id VARCHAR(100) nullable  — NO FK, plain index
   *   status VARCHAR(20) NOT NULL DEFAULT 'active'
   *   origin VARCHAR(10) NOT NULL DEFAULT 'juggler'
   *   ... (provider_event_id, hashes, event_summary, etc. nullable)
   */
  async function seedCalSyncLedgerForInstance(instanceId) {
    await db('cal_sync_ledger').insert({
      user_id: USER_ID,
      provider: 'gcal',
      task_id: instanceId,
      origin: 'juggler',
      status: 'active',
      created_at: db.fn.now()
    });
  }

  /**
   * (c) Toggle-off SUCCEEDS when cal_history has a row pointing at the (1,1) instance id.
   *
   * FORWARD-GUARD NOTE (zoe annotation 2026-06-22):
   *   This test is a FORWARD-GUARD against a hypothetical future regression where
   *   someone changes the fix to a PK-rename approach (e.g. using `.merge(['id'])` on
   *   the onConflict clause). It does NOT reproduce an ER_ROW_IS_REFERENCED_2 (1451)
   *   error on the CURRENT fix path — on the current fix (`.onConflict(ordinals).ignore()`)
   *   no PK mutation occurs so MySQL never fires the FK guard.
   *
   *   On the CURRENT fix code this test passes because:
   *     (i)  The null-read crash (BUG-999.833) is fixed (tests a/b already cover that), AND
   *     (ii) No PK rename is attempted, so the cal_history FK is never threatened.
   *
   *   If a FUTURE change introduces a PK-rename approach (e.g. `.merge(['id'])` to force
   *   the new row's id to MASTER_ID), MySQL would throw ER_ROW_IS_REFERENCED_2 (errno 1451)
   *   because cal_history.task_id → task_instances(id) ON UPDATE RESTRICT blocks renaming a
   *   PK that an active FK row references. This test would catch that regression: the
   *   `isFkError` branch below would match and fail with a clear FK-REGRESSION message.
   *
   *   The survival assertions in (d) and (e) are the REAL invariants this describe-block
   *   proves: the instance id is unchanged (no PK rename occurred) and the FK/ledger
   *   pointers are not orphaned.
   *
   * Under the CURRENT fix (.onConflict(['master_id','occurrence_ordinal','split_ordinal'])
   * .ignore() + re-read by surviving instance id):
   *   No PK mutation occurs → FK is never triggered → operation succeeds.
   */
  test('(c) toggle-off SUCCEEDS (no FK-1451) when cal_history row references the (1,1) instance', async () => {
    if (!available) return;

    await seedMaster();
    await seedExistingDoneInstance();
    await seedCalHistoryForInstance(EXISTING_INST_ID);

    // Confirm cal_history row was seeded and FK is live.
    var calHistBefore = await db('cal_history')
      .where({ task_id: EXISTING_INST_ID, user_id: USER_ID })
      .first();
    expect(calHistBefore).toBeDefined();
    expect(calHistBefore.task_id).toBe(EXISTING_INST_ID);

    // The toggle-off. Under the bad PK-rename approach this would throw:
    //   ER_ROW_IS_REFERENCED_2 (errno 1451) — MySQL FK blocks UPDATE of PK.
    // Under the current fix it must succeed.
    var threw = null;
    var result;
    try {
      result = await facade.updateTask({
        id: MASTER_ID,
        userId: USER_ID,
        body: { recurring: false },
        timezoneHeader: TZ
      });
    } catch (err) {
      threw = err;
    }

    if (threw) {
      // Identify whether this is the FK-1451 error (PK-rename regression)
      // or the original 999.833 null-read error.
      var msg = threw.message || '';
      var isFkError = /1451|ROW_IS_REFERENCED|foreign key/i.test(msg);
      var isNullRead = /source_id|Cannot read properties of null/i.test(msg);
      if (isFkError) {
        throw new Error(
          'FK-REGRESSION: toggle-off threw MySQL FK 1451 — the fix is mutating the PK ' +
          'of the (1,1) instance (or cascading a delete), triggering the cal_history FK. ' +
          'The correct fix must NOT rename any PK. Original error: ' + msg
        );
      }
      if (isNullRead) {
        throw new Error(
          'BUG-999.833 STILL PRESENT: toggle-off threw null-read on re-read. ' +
          'Original error: ' + msg
        );
      }
      throw new Error('Unexpected error during toggle-off: ' + msg);
    }

    // Must succeed with a 2xx status.
    expect(result).toBeDefined();
    expect(result.status).toBeLessThan(500);
  }, 30000);

  /**
   * (d) After toggle-off, the cal_history row's task_id still points at the
   * UNCHANGED (1,1) instance id — the FK is intact and the row is NOT orphaned.
   *
   * This proves: the fix does not rename the PK of the existing instance.
   * A PK rename (even if it somehow bypassed the FK guard) would either:
   *   - cascade-delete the cal_history row (ON DELETE CASCADE on PK change) → row gone, or
   *   - leave the row with a stale task_id (orphaned FK).
   * With the correct fix, the instance id is UNCHANGED → cal_history FK remains valid.
   */
  test('(d) cal_history FK row intact after toggle-off — task_id still points at unchanged instance id', async () => {
    if (!available) return;

    await seedMaster();
    await seedExistingDoneInstance();
    await seedCalHistoryForInstance(EXISTING_INST_ID);

    // Run toggle-off (must not throw).
    try {
      await facade.updateTask({
        id: MASTER_ID,
        userId: USER_ID,
        body: { recurring: false },
        timezoneHeader: TZ
      });
    } catch (err) {
      throw new Error(
        '(d) Toggle-off threw — fix the toggle-off failure first (test c/a). ' +
        'Original: ' + (err.message || err.code)
      );
    }

    // ASSERT (d1): the (1,1) instance id is UNCHANGED — no PK rename occurred.
    var inst = await db('task_instances')
      .where({ master_id: MASTER_ID, occurrence_ordinal: 1, split_ordinal: 1, user_id: USER_ID })
      .first();
    expect(inst).toBeDefined();
    expect(inst.id).toBe(EXISTING_INST_ID);   // id must NOT have been renamed to MASTER_ID

    // ASSERT (d2): the cal_history row still exists with task_id = EXISTING_INST_ID.
    var calHistAfter = await db('cal_history')
      .where({ task_id: EXISTING_INST_ID, user_id: USER_ID })
      .first();
    expect(calHistAfter).toBeDefined();
    // task_id still points at the surviving instance (FK valid, not orphaned).
    expect(calHistAfter.task_id).toBe(EXISTING_INST_ID);

    // ASSERT (d3): confirm the FK is live by verifying the referenced instance exists.
    var referencedInst = await db('task_instances').where({ id: EXISTING_INST_ID }).first();
    expect(referencedInst).toBeDefined();
  }, 30000);

  /**
   * (e) After toggle-off, the cal_sync_ledger row's task_id still points at the
   * UNCHANGED (1,1) instance id — not nulled or orphaned.
   *
   * cal_sync_ledger.task_id has NO FK constraint (plain index) — it would not throw
   * on a PK rename, but the row would be silently orphaned (task_id pointing at a
   * now-nonexistent instance id). This assertion catches that silent corruption.
   */
  test('(e) cal_sync_ledger row intact after toggle-off — task_id still points at unchanged instance id', async () => {
    if (!available) return;

    await seedMaster();
    await seedExistingDoneInstance();
    await seedCalSyncLedgerForInstance(EXISTING_INST_ID);

    // Run toggle-off (must not throw).
    try {
      await facade.updateTask({
        id: MASTER_ID,
        userId: USER_ID,
        body: { recurring: false },
        timezoneHeader: TZ
      });
    } catch (err) {
      throw new Error(
        '(e) Toggle-off threw — fix the toggle-off failure first (test c/a). ' +
        'Original: ' + (err.message || err.code)
      );
    }

    // ASSERT (e1): the (1,1) instance id is UNCHANGED — no PK rename occurred.
    var inst = await db('task_instances')
      .where({ master_id: MASTER_ID, occurrence_ordinal: 1, split_ordinal: 1, user_id: USER_ID })
      .first();
    expect(inst).toBeDefined();
    expect(inst.id).toBe(EXISTING_INST_ID);   // id must NOT have been renamed

    // ASSERT (e2): the cal_sync_ledger row still exists with task_id = EXISTING_INST_ID.
    var ledgerAfter = await db('cal_sync_ledger')
      .where({ task_id: EXISTING_INST_ID, user_id: USER_ID })
      .first();
    expect(ledgerAfter).toBeDefined();
    // task_id still points at the surviving instance (not orphaned).
    expect(ledgerAfter.task_id).toBe(EXISTING_INST_ID);
    // The ledger row's own status must not have been corrupted by the toggle-off.
    expect(ledgerAfter.status).toBe('active');
  }, 30000);
});
