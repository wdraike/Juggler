/**
 * ernie-juggy4-E3 — DB/integration coverage for overdue-split-chunk +
 * overdue-recurring-instance PERSISTENCE end-state (leg juggy4).
 *
 * Traceability: .planning/kermit/juggy4/TRACEABILITY.md B1, B2.
 * REFER: ernie-juggy4-E3 (CODE-REVIEW.md :123) — "The RED test [B1/B2's
 * overdue-unscheduled-pinning.test.js] is a pure in-process unit test (no DB)
 * ... does not exercise runSchedule §8 persistence, so the sibling-chunk DB
 * end-state (E1) — the actual NEVER-MISSING surface — is uncovered. A
 * DB/integration test of a 2-chunk overdue split master (asserting both
 * chunk rows end in a visible lane) would have caught E1."
 *
 * WHAT THIS PROVES that the pure-unit B2 test (overdue-unscheduled-pinning.test.js)
 * cannot: unifiedScheduleV2's in-memory `result.unplaced` can correctly list
 * every sibling chunk (as B2 already pins) while a SEPARATE bug in the §8
 * PERSISTENCE write loop (runSchedule.js:1907-1987, the `result.unplaced.forEach`
 * that turns each in-memory unplaced entry into a DB write) still drops a
 * sibling's row on the floor — e.g. an accidental early `return`/`continue` for
 * splitOrdinal>=2, a dedup-by-master-id keyed write, or a batching bug that only
 * flushes the first pendingUpdate per group. That class of bug is INVISIBLE to
 * a pure in-memory unit test (nothing DB-shaped to inspect) and is EXACTLY the
 * layer ernie's E1 finding said was uncovered. This test seeds real
 * task_masters/task_instances rows, runs the REAL runScheduleAndPersist
 * pipeline end-to-end (§8 unplaced-marking, runSchedule.js:1936-1985), and
 * reads back the actual persisted columns AND the real production read-mapper
 * (rowToTask) that turns those columns into the API-visible task shape.
 *
 * ── Ground-truth finding on the literal `overdue` DB column (read this before
 * changing this file's assertions) ──────────────────────────────────────────
 * Empirically verified against the REAL runScheduleAndPersist pipeline (not
 * assumed): for a split/recurring instance chunk that was NEVER previously
 * placed (scheduled_at already NULL going in), runSchedule.js's persistence
 * write for the "moved to Unplaced" case (§9 "Move remaining past-dated
 * tasks", the `t.recurring` branch around :2279-2288, and the Phase-1-
 * pre-inserted-chunk branch at :1980) writes `unscheduled:1` but does NOT
 * write `overdue:1` on the stored column — that column legitimately stays 0
 * for this row shape (confirmed against this leg's actual committed fix, not
 * a stale/pre-fix build). The literal "overdue=1" stored-column write only
 * happens on a DIFFERENT branch: a chunk that HAD a prior scheduled_at
 * (previously placed, now missed) — runSchedule.js:1972 `_noSlotOverdueUpd`.
 * The FUNCTIONAL overdue signal this app actually exposes to callers for the
 * never-placed shape is **computed on read** — `rowToTask()`
 * (taskMappers.js:348-476) ORs the stored flag with a live predicate driven
 * by `implied_deadline` (the recurrence-period boundary Phase 1 materializes
 * on insert) vs. the caller's current `todayKey`. This test asserts BOTH
 * layers honestly: the literal persisted columns (unscheduled=1,
 * scheduled_at=NULL, date pinned — the actual NEVER-MISSING guard) AND the
 * real production-visible overdue value via `rowToTask` (what a GET /tasks
 * caller actually sees) — instead of asserting a stored `overdue=1` this
 * code path does not in fact write, which would be a false/tautological pin.
 *
 * Fixture (RED config fidelity — mirrors the real DB row shape a genuinely
 * overdue split recurring master leaves behind, not the simplified in-memory
 * unit-test shape):
 *   - task_masters: recurring=1, recur={type:'daily'}, split=1, split_min=15,
 *     placement_mode='anytime' (same config class as split-part-persistence.test.js
 *     999.841, the proven DB-backed split-chunk harness).
 *   - task_instances, all anchored on MISSED_DATE (2 days before "today" —
 *     strictly past the daily recurrence's 1-day period boundary, so the
 *     computed-overdue predicate is unambiguously true, not merely inside the
 *     grace window a 1-day-old daily/anytime occurrence gets per R50 window-
 *     less-daily semantics — see taskMappers.js:458-460):
 *       split_ordinal=1, dur=30, status='', scheduled_at=NULL   (incomplete)
 *       split_ordinal=2, dur=45, status='', scheduled_at=NULL   (incomplete)
 *       split_ordinal=3, dur=20, status='done', scheduled_at=<MISSED_DATE 09:00>
 *         (completed — must be left untouched, never resurrected)
 *     `implied_deadline` is seeded to MISSED_DATE+1day on the incomplete rows,
 *     matching exactly what Phase 1 (runSchedule.js ~:1400,
 *     `recurringPeriodEndKey(masterRow.recur, occDate)`) would have
 *     materialized on the row's original insert — a hand-seeded row omitting
 *     this field is NOT the real DB row shape (verified empirically: omitting
 *     it silently drops the computed-overdue predicate to false).
 *   - A second, NON-split overdue recurring instance (own master, daily,
 *     anytime, no split) anchored the same way, to assert J1's persisted
 *     shape independently of the split-chunk grouping question.
 *
 * Isolation: dedicated database `juggler_e3_persistence_test` on test-bed
 * (3407) — NOT the shared `juggler_test` DB other concurrent legs' suites
 * write to (project memory: concurrent re-migrate of a shared *_test DB
 * corrupts globalSetup — testbed-juggler-test-pollution, 2026-06-21). This
 * file is SELF-PROVISIONING: beforeAll creates the database (if absent) and
 * runs migrations against it directly, so it never depends on jest's
 * globalSetup (which only migrates .env.test's DB_NAME=juggler_test) having
 * touched this DB. This is the fix for the pre-existing DB-provisioning gap
 * that currently reds out bug814-runschedule-slowpath-cancelled.test.js /
 * split-part-persistence.test.js (both assume an isolated DB name exists but
 * nothing creates it).
 *
 * Layer: integration (DB-backed — requires test-bed MySQL @3407).
 *
 * Run:
 *   DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass \
 *     NODE_ENV=test npx jest tests/scheduler/overdue-split-persistence-e3.test.js \
 *     --runInBand --forceExit
 */
'use strict';

process.env.NODE_ENV = 'test';
// Isolated DB name (unconditional — see 999.1037 fix-follow-up precedent in
// split-part-persistence.test.js: a conditional `if (!process.env.DB_NAME)`
// guard is a permanent no-op once jest.config.js's setupFiles loads .env.test
// FIRST, so this file would silently share the contended `juggler_test` schema
// with other concurrent legs instead of its own isolated one).
process.env.DB_NAME = 'juggler_e3_persistence_test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3407';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'rootpass';

var knexLib = require('knex');
var { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');

var USER_ID = 'e3-persist-u1';
var TZ = 'America/New_York';
var SPLIT_MASTER_ID = 'e3-split-master-1';
var NONSPLIT_MASTER_ID = 'e3-nonsplit-master-1';

var db; // set in beforeAll once the isolated DB is confirmed to exist
var dbAvailable = false;

function dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return dateKey(d); }

var TODAY = dateKey(new Date());
// Strictly past the daily-recurrence 1-day period boundary (occDate+1day),
// so the computed-overdue predicate is unambiguously true today, not merely
// inside the window-less-daily grace period a 1-day-old occurrence gets.
var MISSED_DATE = daysAgo(2);
var IMPLIED_DEADLINE = daysAgo(1); // = MISSED_DATE + 1 day (daily cycleDays=1)

// ── Self-provisioning: create + migrate the isolated DB before requiring any
// module that opens the shared `src/db` singleton (which caches its knex
// instance on first require, keyed off process.env.DB_NAME set above). ──
async function ensureIsolatedDbProvisioned() {
  var bootstrap = knexLib({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
      // No `database` — connects to the server, not a specific schema, so
      // CREATE DATABASE IF NOT EXISTS works even on a totally fresh instance.
    }
  });
  try {
    await bootstrap.raw('SELECT 1');
  } catch (e) {
    await bootstrap.destroy();
    throw new Error('TEST-FR-001: test-bed MySQL not reachable at ' + process.env.DB_HOST + ':' + process.env.DB_PORT + '. Run: cd test-bed && make up');
  }
  await bootstrap.raw(
    'CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    [process.env.DB_NAME]
  );
  await bootstrap.destroy();

  // Now that the schema exists, bring up the REAL app db singleton (src/db)
  // and run migrations against it — mirrors jest.globalSetup.js's own
  // migrate.latest() call, scoped to this file's isolated DB instead of the
  // shared juggler_test.
  db = require('../../src/db');
  await db.raw('SELECT 1');
  await db.migrate.latest();
}

async function cleanup() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del().catch(function () {});
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeAll(async function () {
  try {
    await ensureIsolatedDbProvisioned();
    dbAvailable = true;
  } catch (e) {
    dbAvailable = false;
    throw e; // fail-loud (TEST-AUTHORING §Regression-test self-verification) — never skip-as-pass
  }
  var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
  await cleanup();
  await db('users').insert({ id: USER_ID, email: 'e3persist@test.invalid', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 180000);

afterAll(async function () {
  if (dbAvailable) await cleanup();
  if (db) await db.destroy();
}, 30000);

beforeEach(async function () {
  if (!dbAvailable) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).del();
});

// Repro config cited per TEST-AUTHORING §RED config fidelity: recurring=1,
// recur={type:'daily'}, split=1, split_min=15, placement_mode='anytime' —
// the same live config class as the proven 999.841 split-part-persistence
// DB harness, anchored on a date the daily recurrence period has strictly
// passed (unambiguously overdue, not merely "unplaced this run").
async function seedOverdueSplitMaster() {
  await db('task_masters').insert({
    id: SPLIT_MASTER_ID,
    user_id: USER_ID,
    text: 'Overdue split task (E3 DB coverage)',
    dur: 75,
    pri: 'P1',
    status: '',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
    placement_mode: 'anytime',
    split: 1,
    split_min: 15,
    recur_start: MISSED_DATE,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  await db('task_instances').insert([
    {
      id: SPLIT_MASTER_ID + '-y-1', user_id: USER_ID, master_id: SPLIT_MASTER_ID,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 3, split_group: SPLIT_MASTER_ID + '-y',
      dur: 30, status: '', date: MISSED_DATE, scheduled_at: null, unscheduled: null, overdue: 0,
      implied_deadline: IMPLIED_DEADLINE,
      created_at: db.fn.now(), updated_at: db.fn.now()
    },
    {
      id: SPLIT_MASTER_ID + '-y-2', user_id: USER_ID, master_id: SPLIT_MASTER_ID,
      occurrence_ordinal: 1, split_ordinal: 2, split_total: 3, split_group: SPLIT_MASTER_ID + '-y',
      dur: 45, status: '', date: MISSED_DATE, scheduled_at: null, unscheduled: null, overdue: 0,
      implied_deadline: IMPLIED_DEADLINE,
      created_at: db.fn.now(), updated_at: db.fn.now()
    },
    {
      // Completed sibling — must be excluded from buildItems entirely
      // (unifiedScheduleV2.js status guard) and left byte-for-byte untouched.
      id: SPLIT_MASTER_ID + '-y-3', user_id: USER_ID, master_id: SPLIT_MASTER_ID,
      occurrence_ordinal: 1, split_ordinal: 3, split_total: 3, split_group: SPLIT_MASTER_ID + '-y',
      dur: 20, status: 'done', date: MISSED_DATE, scheduled_at: MISSED_DATE + ' 09:00:00', unscheduled: null, overdue: 0,
      created_at: db.fn.now(), updated_at: db.fn.now()
    }
  ]);
}

// J1 — non-split overdue recurring instance, same missed-window shape.
async function seedOverdueNonSplitRecurring() {
  await db('task_masters').insert({
    id: NONSPLIT_MASTER_ID,
    user_id: USER_ID,
    text: 'Overdue non-split recurring instance (E3 J1 DB coverage)',
    dur: 30,
    pri: 'P2',
    status: '',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
    placement_mode: 'anytime',
    split: 0,
    recur_start: MISSED_DATE,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
  await db('task_instances').insert({
    id: NONSPLIT_MASTER_ID + '-y-1', user_id: USER_ID, master_id: NONSPLIT_MASTER_ID,
    occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, split_group: null,
    dur: 30, status: '', date: MISSED_DATE, scheduled_at: null, unscheduled: null, overdue: 0,
    implied_deadline: IMPLIED_DEADLINE,
    created_at: db.fn.now(), updated_at: db.fn.now()
  });
}

// Scoped to occurrence_ordinal=1 (the single seeded MISSED_DATE occurrence).
// The master's daily recurrence otherwise expands fresh chunk rows for every
// day in the scheduling horizon (occurrence_ordinal 2, 3, 4, ...) — those are
// a DIFFERENT (non-overdue, today-and-future) occurrence and are irrelevant
// to this test's persistence assertion about the ONE missed occurrence.
function rowsQuery(masterId) {
  return db('tasks_v').where({ user_id: USER_ID, master_id: masterId, occurrence_ordinal: 1 }).orderBy('split_ordinal');
}

var NOW_INFO = { todayKey: TODAY, nowMins: 720 };

function isLimbo(r) {
  var noSchedule = (r.scheduled_at === null || r.scheduled_at === undefined);
  var noUnscheduledFlag = (r.unscheduled === null || r.unscheduled === undefined || Number(r.unscheduled) === 0);
  return noSchedule && noUnscheduledFlag;
}

describe('ernie-juggy4-E3 — overdue split-chunk + recurring-instance PERSISTENCE end-state (DB-backed)', function () {
  test('B1/B2: overdue split master (2 incomplete + 1 completed chunk) — EVERY incomplete chunk row persists NEVER-MISSING; none dropped; completed chunk untouched', async function () {
    await seedOverdueSplitMaster();

    var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
    await runScheduleAndPersist(USER_ID);

    var rows = await rowsQuery(SPLIT_MASTER_ID);

    // All 3 chunk rows must SURVIVE (§8/§9 never hard-deletes an incomplete
    // or completed chunk row) — the exact NEVER-MISSING row-count invariant.
    expect(rows.length).toBe(3);

    var incompleteRows = rows.filter(function (r) { return Number(r.split_ordinal) !== 3; });
    var completedRow = rows.find(function (r) { return Number(r.split_ordinal) === 3; });

    expect(incompleteRows.length).toBe(2);

    // ── THE CORE ASSERTION (this is the guard for an E1-CLASS regression) ──
    // NEVER-MISSING: no incomplete chunk row may end scheduled_at=NULL AND
    // unscheduled=NULL/0 simultaneously (persistence limbo — invisible to
    // both the calendar grid AND the Unplaced lane; the exact violation
    // ernie's E1 finding described). EACH incomplete sibling — not just the
    // first — must independently reach a visible unscheduled-overdue state.
    // A regression that pushes/collapses only one sibling into the visible
    // lane (the ernie-E1 class of bug, replayed at the PERSISTENCE layer
    // instead of the in-memory layer B2 already pins) fails this loop.
    incompleteRows.forEach(function (r) {
      expect(isLimbo(r)).toBe(false);
      expect(Number(r.unscheduled)).toBe(1);
      expect(r.scheduled_at).toBeNull();
      // Pinned to its own anchor date — never rolled forward past the
      // missed occurrence day (R50).
      expect(String(r.date).slice(0, 10)).toBe(MISSED_DATE);
    });

    // Production-visible overdue: the REAL read mapper (rowToTask), not a
    // hand-rolled re-derivation, computed against a fixed now-context. Both
    // incomplete siblings independently read as overdue — not just the first
    // (the same E1-class regression, observed at the API-surface layer).
    incompleteRows.forEach(function (r) {
      var t = rowToTask(r, TZ, null, null, NOW_INFO);
      expect(t.overdue).toBe(true);
      expect(t.unscheduled).toBe(true);
      expect(t.scheduledAt).toBeNull();
      expect(t.date).toBe(MISSED_DATE);
    });

    // Completed chunk (split_ordinal=3): NEVER resurrected into the
    // unscheduled lane, and its placed/completed shape is untouched.
    expect(completedRow).toBeTruthy();
    expect(completedRow.status).toBe('done');
    expect(completedRow.unscheduled === null || completedRow.unscheduled === undefined || Number(completedRow.unscheduled) === 0).toBe(true);
    expect(String(completedRow.scheduled_at)).toContain(MISSED_DATE);
    var completedTask = rowToTask(completedRow, TZ, null, null, NOW_INFO);
    expect(completedTask.overdue).toBe(false); // terminal status suppresses computed-overdue
    expect(completedTask.unscheduled).toBe(false);

    // No duplicate rows for any split_ordinal (each id appears exactly once).
    var ordinals = rows.map(function (r) { return Number(r.split_ordinal); }).sort();
    expect(ordinals).toEqual([1, 2, 3]);
  }, 30000);

  test('J1: overdue non-split recurring instance persists the same unscheduled-overdue shape (scheduled_at=NULL, unscheduled=1, date pinned, never limbo, computed-overdue true)', async function () {
    await seedOverdueNonSplitRecurring();

    var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
    await runScheduleAndPersist(USER_ID);

    var rows = await rowsQuery(NONSPLIT_MASTER_ID);
    expect(rows.length).toBe(1);
    var r = rows[0];

    expect(isLimbo(r)).toBe(false);
    expect(Number(r.unscheduled)).toBe(1);
    expect(r.scheduled_at).toBeNull();
    expect(String(r.date).slice(0, 10)).toBe(MISSED_DATE);

    var t = rowToTask(r, TZ, null, null, NOW_INFO);
    expect(t.overdue).toBe(true);
    expect(t.unscheduled).toBe(true);
    expect(t.scheduledAt).toBeNull();
    expect(t.date).toBe(MISSED_DATE);
  }, 30000);
});
