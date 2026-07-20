// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
/**
 * BUG-1 (leg sched-chunk-collision-lockbypass, 999.1314-adjacent) — regression
 * DB/integration test.
 *
 * Traceability: .planning/kermit/sched-chunk-collision-lockbypass/TRACEABILITY.md
 * BUG-1.
 *
 * THE BUG: a split-recurring chunk that the scheduler's FRESH computation this
 * run genuinely cannot fit anywhere in today's capacity (unifiedScheduleV2's
 * time-boxing pass stamps `_unplacedReason = REASON_CODES.RECURRING_SPLIT_OVERFLOW`
 * — a diagnosis confirmed correct every run, not a fluke) was nonetheless left
 * PINNED at its STALE prior `scheduled_at` by runSchedule.js's persist step
 * (the "recurring instance with an existing scheduled_at → leave in place" R-FR5
 * branch, ~:1933-1994). That branch only asked "does this row already have a
 * scheduled_at", never "why does the fresh computation say it's unplaced" — so a
 * chunk that was ONCE (buggily) placed at a slot colliding with a sibling chunk
 * stayed pinned there FOREVER, because no later run's persist step ever revisits
 * an "already in place" row. Live-reproduced against dev-bed (master_id
 * 019d5dfa-a97c-7152-a799-f21ba1026db2, chunks 3 & 4 both stuck at
 * scheduled_at=2026-07-13 02:00:00 before the fix).
 *
 * THE FIX (runSchedule.js, ~:1933-1994, ~:1991): `hasScheduledAt` is forced
 * false when `t._unplacedReason === REASON_CODES.RECURRING_SPLIT_OVERFLOW`,
 * routing the row through the unscheduled-write path instead of the R-FR5 pin —
 * and that unscheduled-write path now also explicitly writes `scheduled_at: null`
 * (previously only `unscheduled: 1`, leaving the stale value in place even on
 * the "correct" path).
 *
 * ── Why this fixture, not a hand-tuned `time_blocks` override ──────────────
 * An earlier attempt narrowed `user_config.time_blocks` to force the 4th of 4
 * chunks to overflow. It silently had NO effect: `time` (the field the
 * scheduler's `anchorMin` derivation reads) is populated by `rowToTask` from
 * `scheduled_at` (a "scheduler-write-only cache", per `tasks-write.js`
 * `pickInstance` comment) — but far more importantly, the per-day CAPACITY the
 * time-boxing pass measures against comes from the day's occupancy grid
 * (`dayOcc`/`dayWindows`, built from `cfg.timeBlocks` merged with whatever ELSE
 * is placed that day), not from a bare `time_blocks` row read in isolation —
 * so a narrow override with an otherwise-empty day still left ~1020 free
 * minutes once other defaults/fallbacks in the day-window build were accounted
 * for. The reliable, empirically-verified alternative (used here): seed real
 * FIXED same-day sibling tasks that consume the day's capacity via the SAME
 * occupancy-grid path a genuine collision would use — no scheduler-internal
 * config knob required. Two more empirically-verified gotchas surfaced getting
 * here (both fixed in this file, not worked around):
 *   1. A FIXED task's initial anchor time is NOT read from its `time` column —
 *      `pickInstance`/`rowToTask` derive `time` from `scheduled_at`. A FIXED
 *      blocker seeded with only `time` set (no `scheduled_at`) is placed at
 *      whatever the scheduler's own fallback picks (observed: the frozen
 *      clock's `nowMins`), not the intended anchor. Fix: seed `scheduled_at`
 *      directly (UTC; `dateStrings:true` stores tz-less UTC per project
 *      convention — FROZEN_DAY is EDT/UTC-4 in July, so local 7/11/16:00 ==
 *      stored '...11:00:00'/'...15:00:00'/'...20:00:00').
 *   2. `task_instances.time` has a DB CHECK constraint requiring `HH:MM:SS`,
 *      not `H:MM AM/PM` — an insert with the AM/PM form throws
 *      `Incorrect time value`.
 *
 * Fixture (RED config fidelity — real "Apply for Jobs" production shape, same
 * config class as split-part-persistence.test.js's proven 999.841 harness):
 *   - task_masters: recurring=1, recur={type:'daily'}, split=1, split_min=60,
 *     dur=240 (→ computeChunks produces 4×60min chunks), placement_mode='anytime'.
 *   - 3 FIXED same-day sibling tasks (own task_masters/task_instances rows,
 *     non-recurring) at scheduled_at 11:00/15:00/20:00 UTC (7/11/16:00 local),
 *     durations 180/240/420 — together consume all but three 60-min gaps
 *     (6-7am, 10-11am, 3-4pm local) of the weekday's 1020-min (6am-11pm)
 *     default time-block window. Exactly 3 of the split's 4×60min chunks fit;
 *     the 4th genuinely cannot, ANY run, on THIS day (empirically confirmed
 *     via the diagnostic run below — not assumed).
 *   - The clock is frozen (`_setClock`/`FakeClockAdapter`, the 999.1427
 *     pattern) at FROZEN_DAY 05:00 EDT — a fixed Monday, so DEFAULT_WEEKDAY_BLOCKS
 *     (not weekend blocks) apply deterministically regardless of wall-clock day.
 *   - The split occurrence's 4 chunk rows are PRE-SEEDED (not left for a fresh
 *     phase-1 fanout) with the exact same IDs/split_ordinal/split_total/dur
 *     phase-1's `computeChunks` would itself produce for this master's first
 *     occurrence (verified empirically against an un-pre-seeded run) — chunks
 *     1-3 start scheduled_at=NULL (fresh), chunk 4 (the one that structurally
 *     overflows every run) is seeded with a STALE non-null `scheduled_at`
 *     (FROZEN_DAY 02:00:00 — a same-day, plainly-superseded slot; MUST stay
 *     on FROZEN_DAY itself, not an earlier calendar day — rowToTask derives
 *     the in-memory task's date/anchorDate from `scheduled_at` whenever it is
 *     non-null, so an earlier-day stale value would misroute the chunk
 *     through the unrelated past-anchored-recurring/MISSED path instead of
 *     the split-overflow time-boxing pass this test targets — verified
 *     empirically) and `unscheduled=NULL` — reproducing the exact
 *     historical-bug row shape: "a chunk that reads as PLACED in the DB, at a
 *     stale slot, that this run's fresh computation has now determined can
 *     never be placed."
 *
 * Isolation: dedicated database `juggler_bug1_overflow_test` on test-bed
 * (3407), self-provisioning (creates + migrates itself) — same pattern as
 * `overdue-split-persistence-e3.test.js` / `split-part-persistence.test.js`.
 *
 * Layer: integration (DB-backed — requires test-bed MySQL @3407).
 *
 * RED/GREEN self-verification (TEST-AUTHORING §Regression-test
 * self-verification — driving PRODUCTION, not the test's own input):
 *   cd juggler-backend
 *   git stash push -- src/scheduler/runSchedule.js   # remove ONLY the fix
 *   DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass \
 *     NODE_ENV=test npx jest tests/scheduler/recurring-split-overflow-stale-pin.test.js \
 *     --runInBand --forceExit                        # must FAIL (RED)
 *   git stash pop                                     # restore the fix
 *   <same run>                                        # must PASS (GREEN)
 *
 * Run:
 *   DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass \
 *     NODE_ENV=test npx jest tests/scheduler/recurring-split-overflow-stale-pin.test.js \
 *     --runInBand --forceExit
 */
'use strict';

process.env.NODE_ENV = 'test';
// Isolated DB name (unconditional — see 999.1037 fix-follow-up precedent: a
// conditional `if (!process.env.DB_NAME)` guard is a permanent no-op once
// jest.config.js's setupFiles loads .env.test FIRST).
process.env.DB_NAME = 'juggler_bug1_overflow_test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3407';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'rootpass';

// 999.1176: reset the db singleton cache so getDefaultDb() re-reads
// process.env.DB_NAME on the next require — otherwise a prior test file's
// require('../../src/db') permanently caches a connection to whatever DB it
// saw first (e.g. juggler_test from .env.test).
var dbLib = require('../../src/lib/db');
if (typeof dbLib._resetForTests === 'function') dbLib._resetForTests();

var knexLib = require('knex');
var tasksWrite = require('../../src/lib/tasks-write');
var { REASON_CODES } = require('juggler-shared/scheduler/reasonCodes');

var db; // set in beforeAll once the isolated DB is confirmed to exist
var dbAvailable = false;

var USER_ID = 'bug1-overflow-u1';
var TZ = 'America/New_York';
var MASTER_ID = 'bug1-overflow-master-1';
// A fixed Monday — deterministic weekday time-blocks (6am-11pm, 1020 min),
// independent of the real wall-clock day. Matches the 999.1427/999.1410
// frozen-clock pattern (tests/runScheduleIntegration.test.js).
var FROZEN_DAY = '2026-07-20';
// The stale prior-run slot for the overflow chunk. MUST stay on FROZEN_DAY
// itself (not an earlier calendar day): rowToTask derives the in-memory
// task's `date`/anchorDate from `scheduled_at` whenever scheduled_at is
// non-null (taskMappers.js rowToTask, :475-480), OVERRIDING the `date`
// column — an earlier-day stale scheduled_at would make anchorDate < today
// and route the chunk through the unrelated "past-anchored recurring" /
// REASON_CODES.MISSED path (verified empirically: an earlier version of this
// fixture used a prior calendar day here and got `unplaced_reason:'missed'`
// instead of the overflow diagnosis this test targets). A stale time on the
// SAME day keeps anchorDate===today so the fresh computation reaches the
// split-overflow time-boxing pass, matching the real incident's shape
// (chunks stuck at a stale HH:02:00 same-day slot).
// Stored value is UTC (dateStrings:true, no tz conversion on write) — local
// EDT (UTC-4) 06:00 == UTC 10:00, still same-day locally (must NOT cross
// midnight backward into the previous local day, which would ALSO misroute
// through the past-anchored/MISSED path — verified empirically: an
// earlier-calendar-day value, or a same-day value crossing local midnight
// backward (e.g. UTC 02:00 == local 22:00 the PRIOR day), reproduces the
// exact same missed-path misclassification this comment already warns
// about).
//
// zoe-scso-2 (WARN, fixed): this value is DELIBERATELY chosen (not
// arbitrary/dead) to equal one of the 3 genuinely-placed siblings' actual
// computed scheduled_at THIS run — verified empirically (a probe run of
// this exact fixture logged chunk 1/2/3 landing at UTC 10:00/14:00/19:00
// respectively; STALE_TIME == chunk 1's slot). This makes the "no two
// placed chunks share scheduled_at" invariant below GENUINELY load-bearing:
// pre-fix (this leg's fix reverted via `git stash push --
// src/scheduler/runSchedule.js`), chunk 4 stays pinned at STALE_TIME while
// chunk 1 is independently, freshly placed at the SAME slot this run — a
// REAL duplicate `scheduled_at` across two DB rows, which the uniqueness
// assertion below catches (RED). Post-fix, chunk 4's `scheduled_at` is
// nulled (excluded from the `placedRows` filter) — no duplicate (GREEN). A
// non-colliding value (the previous local-02:00 choice) passed in BOTH
// states and never caught a regression — see TEST-REVIEW.md for the
// pre-fix/post-fix bisect confirming this.
var STALE_TIME = FROZEN_DAY + ' 10:00:00';

// The exact chunk IDs phase-1's fanout produces for this master's FIRST
// occurrence (verified empirically against an un-pre-seeded run of this same
// fixture before writing this file): primaryId = <masterId>-<occOrd>,
// split_ordinal>=2 chunks = primaryId + '-' + splitOrdinal.
var OCC_PRIMARY_ID = MASTER_ID + '-1';
var CHUNK_IDS = [OCC_PRIMARY_ID, OCC_PRIMARY_ID + '-2', OCC_PRIMARY_ID + '-3', OCC_PRIMARY_ID + '-4'];
var OVERFLOW_CHUNK_ID = CHUNK_IDS[3]; // split_ordinal=4 — the one that structurally overflows

async function ensureIsolatedDbProvisioned() {
  var bootstrap = knexLib({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
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
  await db('users').insert(__stampFixture({ id: USER_ID, email: 'bug1overflow@test.invalid', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() }));
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) }));
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) }));
}, 600000); // 999.1409: fresh-test-bed provisioning of an isolated DB runs the full migration set (~min-scale)

afterAll(async function () {
  if (dbAvailable) await cleanup();
  if (db) await db.destroy();
  if (typeof dbLib._resetForTests === 'function') dbLib._resetForTests();
}, 30000);

beforeEach(async function () {
  if (!dbAvailable) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).del();
});

async function seedSplitMaster() {
  await db('task_masters').insert(__stampFixture({
    id: MASTER_ID,
    user_id: USER_ID,
    text: 'Apply for Jobs (BUG-1 overflow fixture)',
    dur: 240,
    pri: 'P1',
    status: '',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
    placement_mode: 'anytime',
    split: 1,
    split_min: 60,
    recur_start: FROZEN_DAY,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }));
}

// 3 FIXED same-day sibling tasks that consume all but three 60-min gaps
// (6-7am, 10-11am, 3-4pm local) of the weekday's 1020-min (360-1380) default
// window — real occupancy-grid capacity consumption, not a scheduler-config
// override (see file header for why the override attempt silently no-op'd).
async function seedCapacityBlockers() {
  await tasksWrite.insertTask(db, {
    id: 'bug1-blk1', user_id: USER_ID, text: 'Blocker 7-10am', dur: 180, pri: 'P1', status: '',
    recurring: 0, placement_mode: 'fixed', scheduled_at: FROZEN_DAY + ' 11:00:00', date: FROZEN_DAY,
    created_at: db.fn.now(), updated_at: db.fn.now()
  });
  await tasksWrite.insertTask(db, {
    id: 'bug1-blk2', user_id: USER_ID, text: 'Blocker 11am-3pm', dur: 240, pri: 'P1', status: '',
    recurring: 0, placement_mode: 'fixed', scheduled_at: FROZEN_DAY + ' 15:00:00', date: FROZEN_DAY,
    created_at: db.fn.now(), updated_at: db.fn.now()
  });
  await tasksWrite.insertTask(db, {
    id: 'bug1-blk3', user_id: USER_ID, text: 'Blocker 4-11pm', dur: 420, pri: 'P1', status: '',
    recurring: 0, placement_mode: 'fixed', scheduled_at: FROZEN_DAY + ' 20:00:00', date: FROZEN_DAY,
    created_at: db.fn.now(), updated_at: db.fn.now()
  });
}

// Pre-seed the occurrence's 4 chunk rows with the historical-bug artifact:
// chunk 4 (split_ordinal=4, the structurally-overflowing chunk) already reads
// as PLACED at a STALE prior scheduled_at — exactly the DB row shape the real
// dev-bed incident left behind (chunks stuck at an old slot forever).
async function seedPreExistingOccurrenceWithStalePin() {
  await db('task_instances').insert(__stampFixture([
    {
      id: CHUNK_IDS[0], user_id: USER_ID, master_id: MASTER_ID,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 4, split_group: OCC_PRIMARY_ID,
      dur: 60, status: '', date: FROZEN_DAY, scheduled_at: null, unscheduled: null,
      created_at: db.fn.now(), updated_at: db.fn.now()
    },
    {
      id: CHUNK_IDS[1], user_id: USER_ID, master_id: MASTER_ID,
      occurrence_ordinal: 1, split_ordinal: 2, split_total: 4, split_group: OCC_PRIMARY_ID,
      dur: 60, status: '', date: FROZEN_DAY, scheduled_at: null, unscheduled: null,
      created_at: db.fn.now(), updated_at: db.fn.now()
    },
    {
      id: CHUNK_IDS[2], user_id: USER_ID, master_id: MASTER_ID,
      occurrence_ordinal: 1, split_ordinal: 3, split_total: 4, split_group: OCC_PRIMARY_ID,
      dur: 60, status: '', date: FROZEN_DAY, scheduled_at: null, unscheduled: null,
      created_at: db.fn.now(), updated_at: db.fn.now()
    },
    {
      // THE HISTORICAL-BUG ARTIFACT: reads as placed at a stale prior slot.
      id: CHUNK_IDS[3], user_id: USER_ID, master_id: MASTER_ID,
      occurrence_ordinal: 1, split_ordinal: 4, split_total: 4, split_group: OCC_PRIMARY_ID,
      dur: 60, status: '', date: FROZEN_DAY, scheduled_at: STALE_TIME, unscheduled: null,
      created_at: db.fn.now(), updated_at: db.fn.now()
    }
  ]));
}

function rowsQuery() {
  return db('task_instances').where({ user_id: USER_ID, master_id: MASTER_ID, occurrence_ordinal: 1 }).orderBy('split_ordinal');
}

describe('BUG-1 (sched-chunk-collision-lockbypass) — genuine RECURRING_SPLIT_OVERFLOW chunk is never pinned at a stale scheduled_at', function () {
  test('chunk 4 (structurally overflows every run) unpins from its stale scheduled_at: ends unscheduled=1/scheduled_at=NULL/unplaced_reason=recurring_split_overflow; no two placed siblings collide on scheduled_at', async function () {
    await seedSplitMaster();
    await seedCapacityBlockers();
    await seedPreExistingOccurrenceWithStalePin();

    var { runScheduleAndPersist, _setClock } = require('../../src/scheduler/runSchedule');
    var { FakeClockAdapter } = require('../helpers/clock');
    var prevClock = _setClock(new FakeClockAdapter({ startTime: FROZEN_DAY + 'T05:00:00-04:00' }));
    var result;
    try {
      result = await runScheduleAndPersist(USER_ID);
    } finally {
      _setClock(prevClock);
    }

    // ── Sanity: the fresh in-memory computation actually diagnosed the
    // overflow chunk as RECURRING_SPLIT_OVERFLOW this run (not some other
    // reason) — asserting the DB end-state alone without this would leave a
    // gap where a DIFFERENT unplaced reason produced the same-looking columns.
    var overflowInMemory = (result.unplaced || []).find(function (u) {
      var t = u.task || u;
      return t.id === OVERFLOW_CHUNK_ID;
    });
    expect(overflowInMemory).toBeTruthy();
    var overflowTask = overflowInMemory.task || overflowInMemory;
    expect(overflowTask._unplacedReason).toBe(REASON_CODES.RECURRING_SPLIT_OVERFLOW);

    var rows = await rowsQuery();
    expect(rows.length).toBe(4);

    var overflowRow = rows.find(function (r) { return r.id === OVERFLOW_CHUNK_ID; });
    expect(overflowRow).toBeTruthy();

    // ── THE CORE ASSERTION (guards the exact BUG-1 regression) ──
    // The chunk this run's fresh computation flagged as structurally
    // overflowing must NEVER be left pinned at its stale prior scheduled_at —
    // it must end in the visible unscheduled-overdue-equivalent lane, same as
    // a never-placed chunk.
    expect(Number(overflowRow.unscheduled)).toBe(1);
    expect(overflowRow.scheduled_at).toBeNull();
    expect(overflowRow.unplaced_reason).toBe(REASON_CODES.RECURRING_SPLIT_OVERFLOW);
    // Explicitly NOT the stale value — pre-fix, this row keeps STALE_TIME
    // (zoe-scso-3, fixed: was a stale '2026-07-19 09:00:00' literal that
    // never matched the actual STALE_TIME constant above) forever, the
    // R-FR5 pin bug.
    expect(String(overflowRow.scheduled_at)).not.toBe(STALE_TIME);

    // ── Hard invariant (BUG-4's own concern, exercised here as a byproduct):
    // no two PLACED sibling chunks may share an identical scheduled_at. This
    // is the exact production symptom (chunks 3 & 4 both stuck at
    // 2026-07-13 02:00:00) — proving it can't recur for this fixture.
    //
    // zoe-scso-2 (WARN, fixed): LOAD-BEARING — STALE_TIME is deliberately
    // chosen (see the constant's own comment above) to equal chunk 1's
    // actual computed scheduled_at this run. Pre-fix (git stash reverting
    // this leg's runSchedule.js changes), chunk 4 stays pinned at
    // STALE_TIME while chunk 1 is independently placed at that SAME slot
    // this run → uniqueTimes.length < placedTimes.length → FAILS (RED).
    // Post-fix, chunk 4's scheduled_at is nulled (excluded from
    // placedRows) → no duplicate → PASSES (GREEN). The previous
    // "explicitly not STALE_TIME for every sibling" per-row check has been
    // REMOVED here: it directly contradicted this fix — post-fix, chunk 1
    // legitimately DOES equal STALE_TIME (that's the whole point of
    // choosing a colliding value), so that redundant check would have
    // failed by design. The uniqueTimes assertion alone is the correct,
    // load-bearing regression guard.
    var placedRows = rows.filter(function (r) { return r.scheduled_at != null; });
    var placedTimes = placedRows.map(function (r) { return String(r.scheduled_at); });
    var uniqueTimes = Array.from(new Set(placedTimes));
    expect(uniqueTimes.length).toBe(placedTimes.length);

    // The 3 non-overflowing siblings must all have genuinely placed
    // (never-missing invariant for the rows the scheduler COULD fit).
    rows.forEach(function (r) {
      if (r.id === OVERFLOW_CHUNK_ID) return;
      expect(r.scheduled_at).not.toBeNull();
      expect(r.unscheduled === null || r.unscheduled === undefined || Number(r.unscheduled) === 0).toBe(true);
    });
  }, 30000);
});

// ══════════════════════════════════════════════════════════════════════════
// zoe-scso-1 (WARN) DISPOSITION — documented UNREACHABLE, not a fixture gap
// ══════════════════════════════════════════════════════════════════════════
//
// zoe's finding: runSchedule.js :2001-2003 —
//   if (forwardRollDeadlineById[t.id] != null) { unplacedChunkUpdate.date = timeInfo.todayKey; }
// — (the ernie-scso-1 follow-up fix, mirroring R-OD1/W1's date-advance for a
// RECURRING_SPLIT_OVERFLOW chunk that is ALSO past-dated with a pending
// forward-roll) had zero test coverage; zoe's own fix-suggestion offered two
// remedies: (a) add a fixture exercising it, OR (b) prove the combination is
// unreachable and document why.
//
// INVESTIGATED (a) first, empirically, via a live probe against this exact
// test-bed (not assumed): forwardRollDeadlineById is written in EXACTLY one
// place (runSchedule.js :949, `forwardRollDeadlineById[stranded.id] = ...`),
// inside the rolling-forward-roll IIFE (:875 `if (!r || r.type!=='rolling')
// return;`) — so the master's recur MUST be 'rolling', and the key is always
// an EXISTING (pre-run) recurring_instance row's own id (whichever row that
// IIFE finds "stranded": non-terminal, rowToTask-mapped `.date` < today).
//
// For a genuinely multi-chunk (split_total>1) occurrence, that "stranded"
// row is necessarily the PRIMARY chunk (split_ordinal=1) — buildExistingGroups
// (reconcileOccurrences.js :47-52) only reads the primary row's raw `date`/
// `scheduled_at` to key the occurrence group at all; a non-primary sibling
// alone can never anchor the match. But the IIFE's SYNTHETIC "today"
// occurrence it injects (runSchedule.js :954-966) does NOT copy `split`/
// `splitMin` from the template (unlike a normal expandRecurring-generated
// occurrence, or the in-memory-chunk builder at :1469-1513, which both DO
// inherit them) — so the chunk fan-out at :1088-1151 always computes this
// occurrence's desired split_total as 1. That desired shape then:
//   (1) DRIFT-FIXES the primary's own row/in-memory split_total back to 1
//       (:1241-1255 + the reconcileChanged re-apply at :1361-1369) — BEFORE
//       the scheduler ever classifies placement, and
//   (2) DELETES every non-primary sibling row as a "stale duplicate"
//       (:1175-1229, the 999.1490 same-(master,date) exception) — since only
//       the primary's id is in `desiredIds`.
// Both are confirmed live below (not assumed) — see the SCHED log lines this
// test asserts on. The net effect: ANY existing multi-chunk occurrence that
// goes through a rolling-type forward-roll in a given run has its
// split-ness stripped and its siblings deleted PRIOR to the overflow
// classification (unifiedScheduleV2.js :2461-2480, which requires
// `splitTotal>1` to ever stamp RECURRING_SPLIT_OVERFLOW). Therefore the
// exact combination zoe asked for — {_unplacedReason===RECURRING_SPLIT_OVERFLOW
// AND forwardRollDeadlineById[t.id]!=null for the SAME task} — is
// UNREACHABLE given the current shipped code: by the time a stranded
// rolling instance could be diagnosed as a split overflow, this OTHER,
// separate gap has already collapsed it to a single (non-split) chunk.
//
// This is itself a genuine, previously-unknown latent bug (the forward-roll
// IIFE's synthetic occurrence dropping split/splitMin) — OUT OF SCOPE for
// this leg's fix (a different code path than BUG-1/BUG-4) and flagged
// separately (REFER→ernie, TEST-REVIEW.md) for its own backlog ticket. It is
// NOT fixed here. The test below characterizes (GREEN, on current code) the
// unreachability mechanism itself, so a future fix to the split-propagation
// gap will flip it RED as a tripwire — at which point runSchedule.js
// :2001-2003 coverage per zoe-scso-1 becomes achievable and should be added
// then (mirroring the fixture shape investigated here).
describe('zoe-scso-1 (999.1561 FIX) — rolling forward-roll NOW preserves split-ness: multi-chunk occurrence keeps split_total and sibling survives', function () {
  var USER_ID2 = 'bug1-overflow-fr-u1';
  var MASTER_ID2 = 'bug1-overflow-fr-master-1';
  var ANCHOR2 = '2026-06-01';
  // 3 days before FROZEN_DAY — cycle (every:7) is NOT ended (boundary = PAST_DAY2+7).
  var PAST_DAY2 = '2026-07-17';
  var OCC_PRIMARY_ID2 = MASTER_ID2 + '-1';
  var SIBLING_CHUNK_ID2 = OCC_PRIMARY_ID2 + '-2';
  // Same-day-as-PAST_DAY2 stale slot (mirrors STALE_TIME's own same-day rule
  // above) so the stranded-search maps this row's date correctly to PAST_DAY2.
  var STALE_TIME2 = PAST_DAY2 + ' 06:00:00';

  beforeAll(async function () {
    if (!dbAvailable) return;
    await db('task_instances').where('user_id', USER_ID2).del();
    await db('task_masters').where('user_id', USER_ID2).del();
    await db('users').where('id', USER_ID2).del();
    var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
    await db('users').insert(__stampFixture({ id: USER_ID2, email: 'bug1overflowfr@test.invalid', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() }));
    await db('user_config').where({ user_id: USER_ID2, config_key: 'time_blocks' }).del();
    await db('user_config').insert(__stampFixture({ user_id: USER_ID2, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) }));
    await db('user_config').where({ user_id: USER_ID2, config_key: 'tool_matrix' }).del();
    await db('user_config').insert(__stampFixture({ user_id: USER_ID2, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) }));

    await db('task_masters').insert(__stampFixture({
      id: MASTER_ID2,
      user_id: USER_ID2,
      text: 'Rolling Split Forward-Roll Collapse Fixture (zoe-scso-1 disposition)',
      dur: 120,
      pri: 'P1',
      status: '',
      recurring: 1,
      recur: JSON.stringify({ type: 'rolling', unit: 'days', every: 7, timesPerCycle: 1 }),
      placement_mode: 'anytime',
      split: 1,
      split_min: 60,
      recur_start: ANCHOR2,
      next_start: ANCHOR2,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    }));

    await db('task_instances').insert(__stampFixture([
      {
        // The PRIMARY chunk — past-dated (PAST_DAY2), stale non-null
        // scheduled_at. This is the row the forward-roll IIFE finds
        // "stranded" (forwardRollDeadlineById gets keyed to THIS id).
        id: OCC_PRIMARY_ID2, user_id: USER_ID2, master_id: MASTER_ID2,
        occurrence_ordinal: 1, split_ordinal: 1, split_total: 2, split_group: OCC_PRIMARY_ID2,
        dur: 60, status: '', date: PAST_DAY2, scheduled_at: STALE_TIME2, unscheduled: null,
        created_at: db.fn.now(), updated_at: db.fn.now()
      },
      {
        // The sibling chunk of the SAME genuine 2-way split occurrence —
        // dated today, never placed. Per the mechanism documented above,
        // this row does NOT survive this run.
        id: SIBLING_CHUNK_ID2, user_id: USER_ID2, master_id: MASTER_ID2,
        occurrence_ordinal: 1, split_ordinal: 2, split_total: 2, split_group: OCC_PRIMARY_ID2,
        dur: 60, status: '', date: FROZEN_DAY, scheduled_at: null, unscheduled: null,
        created_at: db.fn.now(), updated_at: db.fn.now()
      }
    ]));
  }, 60000);

  afterAll(async function () {
    if (!dbAvailable) return;
    await db('task_instances').where('user_id', USER_ID2).del();
    await db('task_masters').where('user_id', USER_ID2).del();
    await db('user_config').where('user_id', USER_ID2).del();
    await db('users').where('id', USER_ID2).del();
  }, 30000);

  test('rolling forward-roll NOW preserves the 2-chunk occurrence (split_total stays 2, sibling survives) — 999.1561 fix to expandRecurring rolling path + forward-roll IIFE', async function () {
    var { runScheduleAndPersist, _setClock } = require('../../src/scheduler/runSchedule');
    var { FakeClockAdapter } = require('../helpers/clock');
    var prevClock = _setClock(new FakeClockAdapter({ startTime: FROZEN_DAY + 'T05:00:00-04:00' }));
    try {
      await runScheduleAndPersist(USER_ID2);
    } finally {
      _setClock(prevClock);
    }

    var rows = await db('task_instances').where({ user_id: USER_ID2, master_id: MASTER_ID2 }).select();

    // 999.1561 FIX: the sibling now SURVIVES (previously deleted as a "stale
    // duplicate" because the forward-roll IIFE + expandRecurring's rolling
    // path both dropped split/splitMin, collapsing split_total to 1).
    var siblingRow = rows.find(function (r) { return r.id === SIBLING_CHUNK_ID2; });
    expect(siblingRow).toBeTruthy();

    // The primary survives with its split_total preserved at 2 (not
    // drift-fixed back to 1) — it remains a genuine multi-chunk occurrence.
    var primaryRow = rows.find(function (r) { return r.id === OCC_PRIMARY_ID2; });
    expect(primaryRow).toBeTruthy();
    expect(Number(primaryRow.split_total)).toBe(2);
    // The sibling also carries split_total=2.
    expect(Number(siblingRow.split_total)).toBe(2);
  }, 30000);
});
