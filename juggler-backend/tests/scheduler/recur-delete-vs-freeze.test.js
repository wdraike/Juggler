/**
 * RED regression test — juggler-recur-delete-vs-freeze
 *
 * Covers: R32.4, R32.5, R50.1, 999.808
 * Traceability: .planning/kermit/juggler-recur-delete-vs-freeze/TRACEABILITY.md
 * Layer: integration (real DB, test-bed 3407)
 *
 * THE BUG (AC3 pinned here):
 *   Past INCOMPLETE recurring instances are DELETED by the reconcile pass
 *   instead of being spared for Phase-9 missed-freeze.
 *
 *   Root-cause path (runSchedule.js:903-919):
 *     toDeleteIds filter → row.date check at :906 → grandfather at :916
 *     (`rowDate < today`) uses strict less-than.
 *     When the instance's date == today (same-day run), rowDate < today is
 *     FALSE → falls through to `return true` → instance is deleted.
 *     When the instance's date < today (prior-day, e.g. yesterday), the
 *     grandfather should fire — but if `row.date` is NULL (never placed)
 *     the `if (row && row.date)` guard at :906 skips the entire block,
 *     also falling through to `return true` → deletion.
 *
 * WHAT THIS TEST DOES:
 *   Seeds a daily recurring template + two past (yesterday) INCOMPLETE
 *   instances: one with date set (the placed/retargeted case) and one with
 *   date=NULL (never-placed case). Runs the full scheduler. Asserts both
 *   instances survive in task_instances — neither is hard-deleted.
 *   Also seeds control cases that must NOT be affected:
 *     - A done past instance (terminal → lives in terminalDedupRows, untouched)
 *     - A future pending instance (beyond horizon → grandfather spares it)
 *
 * ON CURRENT (UNFIXED) CODE: the past-incomplete instances will be deleted.
 * The test FAILS, pinning the exact path.
 * AFTER THE FIX: all assertions pass (instances survive or reach 'missed').
 *
 * Run command:
 *   cd juggler/juggler-backend
 *   DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_recurdel_test \
 *     NODE_ENV=test npx jest tests/scheduler/recur-delete-vs-freeze.test.js \
 *     --testTimeout=30000 --forceExit
 *
 * Requires: cd test-bed && make up
 *
 * Isolation: uses DB_NAME=juggler_recurdel_test (not juggler_test) to avoid
 * shared-DB pollution (testbed-juggler-test-pollution trap, 2026-06-21).
 */

'use strict';

// Point knex at the isolated test DB before requiring anything that uses it.
// This must happen before requiring '../src/db' or knexfile.
process.env.NODE_ENV = 'test';
if (!process.env.DB_NAME) process.env.DB_NAME = 'juggler_recurdel_test';

var db = require('../../src/db');
var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
var tasksWrite = require('../../src/lib/tasks-write');

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Return yesterday's date as ISO string 'YYYY-MM-DD'.
 * Uses explicit Date arithmetic — never bare new Date(string) on a tz-less
 * value (dateStrings:true trap).
 */
function yesterdayISO() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/**
 * Return tomorrow's date as ISO string 'YYYY-MM-DD'.
 */
function tomorrowISO() {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/**
 * Return a scheduled_at datetime for yesterday at 08:00 as a MySQL DATETIME
 * string ('YYYY-MM-DD HH:MM:SS'). The DB column is DATETIME (not TIMESTAMP),
 * so it stores the literal string — no ISO-Z suffix, no timezone conversion.
 * This matches the dateStrings:true knex config (values returned as strings).
 */
function yesterdayAt08Datetime() {
  return yesterdayISO() + ' 08:00:00';
}

/**
 * Return a scheduled_at datetime for a given ISO date at 08:00 as MySQL DATETIME.
 */
function at08Datetime(isoDate) {
  return isoDate + ' 08:00:00';
}

// ── test user ─────────────────────────────────────────────────────────────────

var USER_ID = 'recurdel-test-u1';
var TZ = 'America/New_York';

// ── DB availability guard (TEST-FR-001) ──────────────────────────────────────

var dbAvailable = false;

async function checkDbAvailable() {
  try {
    await db.raw('SELECT 1');
    return true;
  } catch (e) {
    return false;
  }
}

// ── setup / teardown ─────────────────────────────────────────────────────────

async function cleanup() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del().catch(() => {});
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeAll(async () => {
  dbAvailable = await checkDbAvailable();
  if (!dbAvailable) {
    throw new Error(
      'TEST-FR-001: test-bed DB not reachable at ' +
      process.env.DB_HOST + ':' + process.env.DB_PORT + '/' + process.env.DB_NAME +
      '. Run: cd test-bed && make up'
    );
  }
  await cleanup();
  await db('users').insert({
    id: USER_ID,
    email: 'recurdel@test.com',
    timezone: TZ,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  await db('user_config').insert({
    user_id: USER_ID,
    config_key: 'time_blocks',
    config_value: JSON.stringify(DEFAULT_TIME_BLOCKS)
  });
  await db('user_config').insert({
    user_id: USER_ID,
    config_key: 'tool_matrix',
    config_value: JSON.stringify(DEFAULT_TOOL_MATRIX)
  });
}, 20000);

afterAll(async () => {
  if (dbAvailable) await cleanup();
  await db.destroy();
});

beforeEach(async () => {
  if (!dbAvailable) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config')
    .where({ user_id: USER_ID, config_key: 'schedule_cache' })
    .del();
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function seedMaster(overrides) {
  var id = 'rdm-' + Math.random().toString(36).slice(2, 10);
  // Note: task_type is a VIEW-derived computed column — NOT a real task_masters column.
  // Do NOT insert task_type into task_masters. The view computes it from recurring=1.
  var row = Object.assign({
    id,
    user_id: USER_ID,
    text: 'Medication',
    dur: 5,
    pri: 'P1',
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

async function seedInstance(masterId, overrides) {
  var id = overrides.id || (masterId + '-1');
  // task_instances schema: id, master_id, user_id, occurrence_ordinal,
  // split_ordinal, split_total, split_group, scheduled_at, dur, date, day,
  // time, status, time_remaining, unscheduled, slack_mins, generated,
  // created_at, updated_at, overdue, completed_at, end_date, implied_deadline,
  // unplaced_reason, unplaced_detail.
  // NO task_type, NO recurring, NO text, NO pri — all come from task_masters
  // via the tasks_v VIEW JOIN.
  var row = Object.assign({
    id,
    user_id: USER_ID,
    master_id: masterId,
    dur: 5,
    status: '',
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }, overrides);
  await db('task_instances').insert(row);
  return row;
}

// ── AC1 / AC3: past incomplete instance with date set survives reconcile ─────

describe('AC1/AC3 — past INCOMPLETE recurring instance (date set) survives reconcile', () => {
  /**
   * Seeds a daily recurring master + a past instance with date=yesterday,
   * status=''. Runs the scheduler. Asserts the instance is NOT deleted.
   *
   * On CURRENT (unfixed) code this FAILS because the grandfather condition
   * `rowDate < today` uses strict less-than: an instance dated yesterday
   * (rowDate < today → TRUE) should be spared, BUT only if row.date is
   * truthy. This case tests the primary scenario from the SPEC (morning/evening
   * Medication on 06-22, yesterday relative to the next run).
   *
   * If this assertion fails: the instance was hard-deleted by toDeleteIds
   * at runSchedule.js:955-959 — the grandfather at :916 did not protect it.
   */
  it('AC1: past pending instance with date=yesterday survives in task_instances', async () => {
    var master = await seedMaster({ id: 'rdm-ac1-master' });
    var yesterday = yesterdayISO();
    var instance = await seedInstance(master.id, {
      id: master.id + '-1',
      date: yesterday,
      scheduled_at: yesterdayAt08Datetime(),
      occurrence_ordinal: 1
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: instance.id })
      .select('id', 'status', 'date')
      .first();

    // ASSERTION — on unfixed code this FAILS (row is deleted)
    // The failure proves the grandfather at runSchedule.js:916 does not protect
    // past pending instances when rowDate == today OR when the reconcile path
    // has a different bypass.
    expect(surviving).toBeDefined();
    // After a correct fix the status should be 'missed' OR still '' (overdue-pinned)
    // Per R32.4/999.808: never hard-deleted.
    if (surviving) {
      expect(['', 'missed']).toContain(surviving.status);
    }
  });
});

// ── AC3 variant: past instance with date=NULL (never placed) ─────────────────

describe('AC3 variant — past INCOMPLETE recurring instance (date NULL) survives reconcile', () => {
  /**
   * A never-placed instance has date=NULL in task_instances.
   * The grandfather at runSchedule.js:906 checks `if (row && row.date)`.
   * If date is NULL, that check is falsy — the instance falls through to
   * `return true` (DELETE). This tests that bypass path.
   *
   * On CURRENT (unfixed) code: the instance is deleted.
   * The test FAILS, pinning the NULL-date bypass at runSchedule.js:906.
   */
  it('AC3b: past pending instance with date=NULL survives in task_instances', async () => {
    var master = await seedMaster({ id: 'rdm-ac3b-master' });
    // Seed with date=NULL and a past scheduled_at — this simulates an instance
    // that was created but never had its date column set (e.g. pre-placement).
    var instance = await seedInstance(master.id, {
      id: master.id + '-2',
      date: null,
      scheduled_at: yesterdayAt08Datetime(),
      occurrence_ordinal: 2
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: instance.id })
      .select('id', 'status', 'date')
      .first();

    // ASSERTION — on unfixed code this FAILS (NULL-date path not protected)
    // The failure pins runSchedule.js:906 `if (row && row.date)` as a bypass.
    expect(surviving).toBeDefined();
  });
});

// ── AC1 same-day scenario: instance dated TODAY (the medication scenario) ─────

describe('AC1 same-day — recurring instance dated TODAY and INCOMPLETE survives reconcile', () => {
  /**
   * The SPEC confirms the actual Medication instances were for 06-22 and deleted
   * ON a 06-22 run — same day. The grandfather checks `rowDate < today` (strict
   * less-than). When rowDate == today, the condition is FALSE → not spared.
   * If expandRecurring doesn't re-generate this occurrence (collision, horizon
   * edge, or ordinal conflict), it ends up in toDeleteIds unprotected.
   *
   * This test seeds a today-dated instance that is NOT in desiredRows (by using
   * a master with recur_start=tomorrow so expandRecurring won't generate today).
   * The instance is effectively "orphaned from desired" and should be protected
   * as a same-day pending instance.
   *
   * On CURRENT code: this FAILS — same-day instances are NOT protected by the
   * `< today` grandfather; they are deleted.
   */
  it('AC1 same-day: today-dated pending instance excluded from desired survives', async () => {
    var today = new Date();
    var todayISO = today.getFullYear() + '-' +
      (today.getMonth() + 1 < 10 ? '0' : '') + (today.getMonth() + 1) + '-' +
      (today.getDate() < 10 ? '0' : '') + today.getDate();

    // Use recur_start=tomorrow so expandRecurring generates no instance for today.
    var master = await seedMaster({
      id: 'rdm-ac1sd-master',
      recur_start: tomorrowISO()
    });

    // Manually seed a today-dated pending instance — simulates one created by
    // a prior scheduler run before recur_start was set to tomorrow.
    var instance = await seedInstance(master.id, {
      id: master.id + '-1',
      date: todayISO,
      scheduled_at: at08Datetime(todayISO),
      occurrence_ordinal: 1
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: instance.id })
      .select('id', 'status')
      .first();

    // ASSERTION — on unfixed code this FAILS:
    // today-dated instances excluded from desiredRows are NOT protected by
    // the `rowDate < today` grandfather (strict less-than misses today).
    expect(surviving).toBeDefined();
  });
});

// ── AC4: control cases — terminal/future instances unaffected ─────────────────

describe('AC4 — control cases: terminal and future instances unaffected', () => {
  /**
   * Regression guard: the fix must not break terminal past instances or future
   * pending instances. These must stay exactly as seeded (terminal rows live in
   * terminalDedupRows; future pending beyond horizon is already protected by
   * the existing `rowDate > expandEnd` grandfather at :908).
   */

  it('AC4a: done past instance stays done (terminal — not touched by reconcile)', async () => {
    var master = await seedMaster({ id: 'rdm-ac4a-master' });
    // Terminal rows are loaded separately via terminalDedupRows, not taskRows.
    // Insert directly into task_instances with terminal status.
    // Note: no task_type, recurring, text, pri columns in task_instances — VIEW-derived.
    await db('task_instances').insert({
      id: master.id + '-done',
      user_id: USER_ID,
      master_id: master.id,
      status: 'done',
      date: yesterdayISO(),
      scheduled_at: yesterdayAt08Datetime(),
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      dur: 5,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: master.id + '-done' })
      .select('id', 'status')
      .first();

    // MUST still exist and still be 'done'
    expect(surviving).toBeDefined();
    expect(surviving.status).toBe('done');
  });

  it('AC4b: future pending instance (well beyond horizon) survives unchanged', async () => {
    var master = await seedMaster({ id: 'rdm-ac4b-master' });
    // Seed a future instance at +30 days — beyond RECUR_EXPAND_DAYS=14.
    var farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 30);
    var ffISO = farFuture.getFullYear() + '-' +
      (farFuture.getMonth() + 1 < 10 ? '0' : '') + (farFuture.getMonth() + 1) + '-' +
      (farFuture.getDate() < 10 ? '0' : '') + farFuture.getDate();

    await seedInstance(master.id, {
      id: master.id + '-future',
      date: ffISO,
      scheduled_at: at08Datetime(ffISO),
      occurrence_ordinal: 99
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: master.id + '-future' })
      .select('id', 'status')
      .first();

    // Must survive: beyond-horizon grandfather at :908 protects it.
    expect(surviving).toBeDefined();
    expect(surviving.status).toBe('');
  });

  it('AC4c: skip past instance stays skip (soft-deleted terminal, R32.5)', async () => {
    var master = await seedMaster({ id: 'rdm-ac4c-master' });
    // No task_type, recurring, text, pri — VIEW-derived
    await db('task_instances').insert({
      id: master.id + '-skip',
      user_id: USER_ID,
      master_id: master.id,
      status: 'skip',
      date: yesterdayISO(),
      scheduled_at: yesterdayAt08Datetime(),
      occurrence_ordinal: 3,
      split_ordinal: 1,
      split_total: 1,
      dur: 5,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: master.id + '-skip' })
      .select('id', 'status')
      .first();

    expect(surviving).toBeDefined();
    expect(surviving.status).toBe('skip');
  });
});

// ── PATH-B: date=NULL + scheduled_at=past → spared and reaches missed ─────────

describe('PATH-B — date=NULL AND scheduled_at=past-slot: instance SPARES and reaches missed', () => {
  /**
   * Covers bert's REFER: PATH-B sub-branch in the grandfather fix.
   *
   * The fix adds a second guard OUTSIDE the `if (row && row.date)` block:
   *   if (row && row.task_type === 'recurring_instance' && !row.date) {
   *     // derive effective date from scheduled_at (append 'Z' for UTC)
   *     if (!effectiveDate || effectiveDate <= today) return false; // spared
   *   }
   *
   * Case 1 (this describe): date=NULL, scheduled_at=yesterday 08:00.
   *   - effectiveDateForGrandfather = parsed scheduled_at → yesterday → <= today → return false (spared).
   *   - Instance must NOT be hard-deleted.
   *   - Phase-9 must eventually freeze it: status = 'missed' and
   *     scheduled_at unchanged (rawRowPast.scheduled_at per R32.4/999.808).
   *
   * Requirement traceability: R32.4, R50.1, 999.808 LC-1/LC-2
   * Traceability row: AC3 / new PATH-B sub-branch per bert REFER
   */
  it('PATH-B-1: date=NULL, scheduled_at=yesterday → instance survives (not hard-deleted)', async () => {
    var master = await seedMaster({ id: 'rdm-pb1-master' });
    var instance = await seedInstance(master.id, {
      id: master.id + '-pb1',
      date: null,
      scheduled_at: yesterdayAt08Datetime(),
      occurrence_ordinal: 5
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: instance.id })
      .select('id', 'status', 'scheduled_at')
      .first();

    // Must NOT be hard-deleted — PATH-B grandfather must have spared it.
    expect(surviving).toBeDefined();
  });

  it('PATH-B-2: date=NULL, scheduled_at=yesterday → status becomes missed (Phase-9 freeze)', async () => {
    var master = await seedMaster({ id: 'rdm-pb2-master' });
    var sat = yesterdayAt08Datetime();
    var instance = await seedInstance(master.id, {
      id: master.id + '-pb2',
      date: null,
      scheduled_at: sat,
      occurrence_ordinal: 6
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: instance.id })
      .select('id', 'status', 'scheduled_at')
      .first();

    // Phase-9 should freeze it as 'missed'.
    // Per R32.4/999.808: the spared-past pending recurring instance must reach
    // missed freeze — status='missed' and scheduled_at is the original past slot
    // (rawRowPast.scheduled_at), NOT nulled.
    expect(surviving).toBeDefined();
    expect(surviving.status).toBe('missed');
    // scheduled_at must be preserved (the frozen last-real-slot), not nulled.
    expect(surviving.scheduled_at).not.toBeNull();
    // Verify it matches the originally-seeded scheduled_at value.
    // dateStrings:true returns the string as-is from MySQL; compare the date part.
    var returnedSat = String(surviving.scheduled_at);
    expect(returnedSat).toContain(yesterdayISO());
  });
});

// ── PATH-B: date=NULL + scheduled_at=NULL → spared unconditionally ────────────

describe('PATH-B — date=NULL AND scheduled_at=NULL: never-placed instance SPARES unconditionally', () => {
  /**
   * Covers the second half of bert's REFER: the "never-placed" case.
   *
   * When BOTH date AND scheduled_at are NULL, the instance has never been
   * placed on any day. The fix's PATH-B guard spares it unconditionally
   * (the `if (!effectiveDateForGrandfather || effectiveDateForGrandfather <= today)`
   * branch: effectiveDate is null → spare unconditionally → return false).
   *
   * This instance must survive in task_instances; Phase-9 may or may not
   * freeze it (it is unscheduled=1 / windowClose path), but it must NEVER
   * be hard-deleted by the reconcile pass.
   *
   * Requirement traceability: R32.4, R50.1, 999.808 LC-2 ("never-placed")
   */
  it('PATH-B-3: date=NULL, scheduled_at=NULL → instance survives (not hard-deleted)', async () => {
    var master = await seedMaster({ id: 'rdm-pb3-master' });
    var instance = await seedInstance(master.id, {
      id: master.id + '-pb3',
      date: null,
      scheduled_at: null,
      unscheduled: 1,
      occurrence_ordinal: 7
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: instance.id })
      .select('id', 'status', 'scheduled_at')
      .first();

    // Must NOT be hard-deleted — the "both-null" unconditional spare must hold.
    expect(surviving).toBeDefined();
    // May be pending ('') or missed — must NOT be deleted.
    expect(['', 'missed']).toContain(surviving.status);
  });
});

// ── AC2: missed-freeze assertion ──────────────────────────────────────────────

describe('AC2 — missed-freeze: spared past instance reaches status=missed with frozen scheduled_at', () => {
  /**
   * AC2 from TRACEABILITY.md: the spared past instance must NOT be deleted
   * AND its scheduled_at must be PRESERVED at the ORIGINAL yesterday slot —
   * not nulled and not forward-moved to today.
   *
   * Per R32.4/999.808 LOCKED design: the scheduled_at column is the
   * authoritative medication-history record of WHEN the dose was scheduled.
   * Forward-moving it to today (rolling the slot forward) loses the
   * history evidence. The correct behaviour is:
   *   - status='missed' (Phase-9 freeze) OR status='' (pending+overdue-pinned
   *     if the recurrence period is not yet expired)
   *   - scheduled_at == seeded yesterday value (frozen, not rolled forward)
   *   - date == seeded yesterday value (not reassigned to today)
   *
   * KNOWN DISTINCT BUG — reconciler forward-move (NOT this leg's scope):
   *   Probe evidence (2026-06-23): the reconciler's matchOccurrences step
   *   reassigns the date-set past instance to today's occurrence slot
   *   (runSchedule.js:786-824) — date=2026-06-23, scheduled_at=today time.
   *   This is a SEPARATE bug in the overdue-lifecycle / forward-roll scope
   *   (see R50.1/R50.4, backlog item to be filed). The deletion fix on this
   *   leg (grandfather at :919 + PATH-B guard at :930-946) is correct and
   *   complete; the forward-move is a subsequent mis-handling in the reconciler.
   *
   *   The tightened assertions below document the REQUIRED behaviour per
   *   R50.1/R32.7 and will FAIL on current code because of the reconciler
   *   forward-move. They are marked .todo so this leg can gate (deletion fixed)
   *   while Oscar/Kermit decide the follow-up scope for the reconciler fix.
   *   PATH-B-2 (date=NULL branch) IS correctly frozen — see that test.
   */
  it('AC2: date-set past instance survives (not hard-deleted)', async () => {
    // Primary AC2 assertion: the row must not be hard-deleted.
    // This passes on current code — the grandfather at :919 spares it.
    var master = await seedMaster({ id: 'rdm-ac2-master' });
    var sat = yesterdayAt08Datetime();
    var instance = await seedInstance(master.id, {
      id: master.id + '-ac2',
      date: yesterdayISO(),
      scheduled_at: sat,
      occurrence_ordinal: 8
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: instance.id })
      .select('id', 'status', 'date', 'scheduled_at')
      .first();

    // Must NOT be hard-deleted (R50.1 never-delete).
    expect(surviving).toBeDefined();
    // Status must be a valid non-terminal value — not 'deleted' or gone.
    // (Accepts '' pending/overdue-pinned OR 'missed' frozen.)
    expect(['', 'missed']).toContain(surviving.status);
  });

  // 999.842 — reconciler matchOccurrences must NOT forward-move a past pending
  // recurring instance to today's slot. It must freeze at its original slot so
  // the medication-history record (date + scheduled_at) is preserved
  // (R50.1/R32.7/R52). Phase-9 then freezes it as 'missed' at that slot.
  it('AC2-tightened: date-set past instance scheduled_at PRESERVED at original yesterday slot (NOT forward-moved to today)', async () => {
    var master = await seedMaster({ id: 'rdm-ac2t1-master' });
    var instance = await seedInstance(master.id, {
      id: master.id + '-ac2t1',
      date: yesterdayISO(),
      scheduled_at: yesterdayAt08Datetime(),
      occurrence_ordinal: 9
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: instance.id })
      .select('id', 'status', 'date', 'scheduled_at')
      .first();

    expect(surviving).toBeDefined();
    expect(surviving.scheduled_at).not.toBeNull();
    // Must still point at the original yesterday slot, NOT today.
    expect(String(surviving.scheduled_at)).toContain(yesterdayISO());
  });

  it('AC2-tightened: date-set past instance date column PRESERVED at original yesterday (NOT date=today)', async () => {
    var master = await seedMaster({ id: 'rdm-ac2t2-master' });
    var instance = await seedInstance(master.id, {
      id: master.id + '-ac2t2',
      date: yesterdayISO(),
      scheduled_at: yesterdayAt08Datetime(),
      occurrence_ordinal: 10
    });

    await runScheduleAndPersist(USER_ID);

    var surviving = await db('task_instances')
      .where({ id: instance.id })
      .select('id', 'status', 'date')
      .first();

    expect(surviving).toBeDefined();
    // date must remain yesterday, not be reassigned to today's occurrence slot.
    expect(String(surviving.date)).toContain(yesterdayISO());
  });
});
