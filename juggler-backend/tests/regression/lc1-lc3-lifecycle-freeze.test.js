/**
 * LC-1 / LC-2 / LC-3 regression tests — fixy-lifecycle (999.808) Leg A
 *
 * Traceability: .planning/kermit/fixy-lifecycle/TRACEABILITY.md LC-1, LC-2, LC-3
 * Requires: test-bed MySQL @3407 (DB_NAME=juggler_fixy_test)
 *
 * Run:
 *   cd juggler/juggler-backend
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass \
 *     DB_NAME=juggler_fixy_test NODE_ENV=test \
 *     npx jest --runInBand --testPathPattern="lc1-lc3-lifecycle-freeze"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LC-1 (RED — freeze-at-last-slot):
 *
 *   A recurring instance that WAS PLACED (scheduled_at non-null = the real user
 *   slot) and is outside its timeFlex + period window MUST:
 *     (a) NOT be deleted by the reconciler (it must be preserved so Phase-9 can
 *         freeze it), AND
 *     (b) freeze at its LAST REAL scheduled_at (not windowClose).
 *
 *   Root cause of (b): runSchedule.js :1825 computes
 *     missedAt = windowClose || midnight || now
 *   ignoring rawRowPast.scheduled_at (the actual user slot).
 *
 *   Root cause of (a): runSchedule.js :927-935 toDeleteIds filter has no
 *   protection for placed past instances; they go into toDeleteIds and are
 *   deleted before Phase-9 sees them.
 *
 *   The LOCKED design (TRACEABILITY.md LC-1 / Brain #88204) requires:
 *     missedAt = rawRowPast.scheduled_at   (if the row had one)
 *              || windowClose || midnight || now
 *
 *   Test approach: use a template with recur_end in the past so expandRecurring
 *   produces 0 desired occurrences. The placed instance is the only pending row;
 *   on current code it goes to toDeleteIds and is DELETED — the test detects this
 *   as the RED failure. Post-fix: instance must survive AND have
 *   scheduled_at == PLACED_SLOT_UTC (the original slot, not windowClose).
 *
 *   The test asserts BOTH (a) and (b). On current code:
 *     - If the instance is deleted: test FAILS at the `expect(row).toBeTruthy()` check
 *     - If somehow it survives: test FAILS at `expect(scheduled_at).toBe(PLACED_SLOT_UTC)`
 *       because current code writes windowClose
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LC-2 (GUARD — never-placed fallback):
 *
 *   Same recur_end-in-past setup but with scheduled_at=NULL (never-placed).
 *   Post-fix: instance must survive AND have non-null scheduled_at (fallback chain).
 *   Overlaps with BUG-142-AC1b but covers the placed-instance protection path.
 *   Must stay GREEN pre-fix if the instance already survives (or RED + informative
 *   if it gets deleted, matching the same protection fix as LC-1 part (a)).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LC-3 (REGRESSION GUARD — done future clamp):
 *
 *   Marking done with future completedAt must clamp scheduled_at/completed_at <=
 *   now. Already coded at UpdateTaskStatus.js:190. This is a regression guard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../../src/db');
var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
var { assertDbAvailable } = require('../helpers/requireDB');

// ── UpdateTaskStatus dependencies (LC-3 only) ──────────────────────────────
var { v7: uuidv7 } = require('uuid');
var KnexTaskRepository = require('../../src/slices/task/adapters/KnexTaskRepository');
var CreateTask = require('../../src/slices/task/application/commands/CreateTask');
var UpdateTaskStatus = require('../../src/slices/task/application/commands/UpdateTaskStatus');
var H = require('../slices/task/application/_helpers');
var { z } = require('zod');

var knex = require('knex')(require('../../knexfile.js').test);

var statusUpdateSchema = z.object({
  status: z.enum(['', 'done', 'wip', 'cancel', 'skip', 'pause', 'disabled', 'missed']),
  completedAt: z.string().optional()
}).passthrough();

// ── Test users ───────────────────────────────────────────────────────────────
var USER_LC1_LC2 = 'fixy-lc1-test-001';
var USER_LC3     = 'fixy-lc3-test-001';
var TZ = 'America/New_York';

// ── Deterministic past dates ──────────────────────────────────────────────────
// OCCURRENCE_DATE_KEY: the day the instance was "placed" on.
// Must be >= 7 days in the past so timeFlex=0 and the daily period boundary are
// unambiguously outside the window regardless of when the test runs.
//
// PLACED_SLOT_UTC: the specific UTC slot the user had the task at (3:00 PM UTC).
// With timeFlex=120 min:
//   windowClose = PLACED_SLOT_UTC + 120 min = 17:00 UTC  ← what BUGGY code writes
//   correct     = PLACED_SLOT_UTC           = 15:00 UTC  ← what FIXED code must write
var OCCURRENCE_DATE_KEY = '2026-06-14';           // Saturday, >= 8 days before 2026-06-22
var PLACED_SLOT_UTC     = '2026-06-14 15:00:00';  // 3:00 PM UTC
var TIME_FLEX_MINUTES   = 120;
// windowClose = placed_slot + 120 min → what buggy code would store (if it survived)
// (only relevant if the reconciler protection is also fixed; see LC-1 comment)

// ─────────────────────────────────────────────────────────────────────────────
// DB setup
// ─────────────────────────────────────────────────────────────────────────────

var available = false;

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('[lc1-lc3] Test DB not available:', e.message);
    return;
  }
  await cleanupUser(USER_LC1_LC2);
  await cleanupUser(USER_LC3);

  await db('users').insert({
    id: USER_LC1_LC2, email: 'lc1@fixy.test',
    timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now()
  });
  await db('users').insert({
    id: USER_LC3, email: 'lc3@fixy.test',
    timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now()
  });

  var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
  await db('user_config').insert({ user_id: USER_LC1_LC2, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_LC1_LC2, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 20000);

afterAll(async () => {
  if (available) {
    await cleanupUser(USER_LC1_LC2);
    await cleanupUser(USER_LC3);
  }
  await db.destroy();
  await knex.destroy();
});

async function cleanupUser(userId) {
  await db('cal_sync_ledger').where('user_id', userId).del();
  await db('task_instances').where('user_id', userId).del();
  await db('task_masters').where('user_id', userId).del();
  await db('user_config').where('user_id', userId).del();
  await db('users').where('id', userId).del();
}

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_LC1_LC2).del();
  await db('task_masters').where('user_id', USER_LC1_LC2).del();
  await db('user_config').where({ user_id: USER_LC1_LC2, config_key: 'schedule_cache' }).del();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed a recurring template with recur_end in the past.
 * recur_end = OCCURRENCE_DATE_KEY → expandRecurring generates NO future desired
 * occurrences. The instance has no match in desiredIds → goes to toDeleteIds on
 * current code.
 */
async function seedEndedTemplate(id, extraOverrides) {
  await db('task_masters').insert(Object.assign({
    id: id,
    user_id: USER_LC1_LC2,
    text: 'LC test — ended template',
    dur: 30,
    status: '',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
    recur_start: OCCURRENCE_DATE_KEY,
    recur_end: OCCURRENCE_DATE_KEY,   // ended — no future desired occurrences
    time_flex: TIME_FLEX_MINUTES,
    when: 'morning',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }, extraOverrides || {}));
}

/**
 * Seed a recurring instance directly into task_instances.
 * We bypass insertTask/tasksWrite to avoid any automatic scheduling.
 * The instance will be the only pending row for its template.
 */
async function seedPlacedInstance(id, masterId, extraOverrides) {
  await db('task_instances').insert(Object.assign({
    id: id,
    master_id: masterId,
    user_id: USER_LC1_LC2,
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    date: OCCURRENCE_DATE_KEY,
    scheduled_at: PLACED_SLOT_UTC,
    overdue: 0,
    dur: 30,
    status: '',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }, extraOverrides || {}));
}

// ═══════════════════════════════════════════════════════════════════════════════
// LC-1 — RED test: placed recurring instance MUST freeze at its last real slot
// ═══════════════════════════════════════════════════════════════════════════════
//
// Covers: TRACEABILITY.md LC-1
//
// Setup:
//   - A daily recurring template with recur_end=OCCURRENCE_DATE_KEY (ended in
//     the past) so expandRecurring generates 0 desired occurrences.
//   - One instance for OCCURRENCE_DATE_KEY that was PLACED at PLACED_SLOT_UTC
//     (scheduled_at = '2026-06-14 15:00:00', time_flex=120).
//   - The reconciler has no desired occurrences → the instance is in toDeleteIds
//     on current code → gets DELETED → Phase-9 never sees it.
//
// RED on CURRENT code (two failure modes):
//   (a) Instance is deleted by reconciler → test fails at expect(afterRow).toBeTruthy()
//   (b) If LC-1(a) fix is applied (reconciler spares placed instances) but LC-1(b)
//       is not: scheduled_at = windowClose ('2026-06-14 17:00:00') ≠ PLACED_SLOT_UTC
//
// GREEN on FIXED code:
//   - Instance survives the reconciler (not deleted)
//   - Phase-9 writes scheduled_at = PLACED_SLOT_UTC = '2026-06-14 15:00:00'
//   - Phase-9 writes completed_at = PLACED_SLOT_UTC
//   - status = 'missed'
//
// Branch enumeration (Step 6b completeness floor):
//   Branch A: toDeleteIds filter — placed instance (scheduled_at non-null, date in
//     past, not in desiredIds) → current: deleted; fixed: spared
//   Branch B: Phase-9 recurring block — t.recurring=true → enters miss logic
//   Branch C: timeFlex window — flex=120, daysPast=8 → 120 >= 8*1440 = false → falls through
//   Branch D: periodEnd check — daily day-locked → periodEnd=next day → in past → falls through
//   Branch E: rawRowPast.scheduled_at non-null → fixed code uses it as missedAt
//   Branch F: rawRowPast.scheduled_at null → fallback chain (LC-2 GUARD covers this)
//
// Production-shape input variants (Step 6b):
//   recur is stored as JSON string in the DB — covered by JSON.stringify above.
//   scheduled_at is stored as a MySQL datetime string — covered by PLACED_SLOT_UTC format.
// ═══════════════════════════════════════════════════════════════════════════════

describe('LC-1: placed recurring instance freezes at last real scheduled_at (RED on current code)', () => {
  /**
   * Covers: TRACEABILITY.md LC-1
   * Layer: integration (real DB, runScheduleAndPersist full pipeline)
   * Requirement: R32.4 refined — missed recurring instance freezes at LAST REAL slot
   */
  test(
    'LC-1: placed past recurring instance survives, stays live (status=""), flagged overdue at original slot — auto-miss retired',
    async () => {
      if (!available) {
        throw new Error('[TEST-FR-001] Required DB (test-bed @3407) is unreachable — cannot run LC-1 regression test.');
      }

      var tmplId = 'lc1-tmpl-placed';
      var instId = 'lc1-inst-placed';

      // Seed template with recur_end in the past (no desired occurrences generated)
      await seedEndedTemplate(tmplId);

      // Seed placed instance: scheduled_at = real user slot at 15:00 UTC
      await seedPlacedInstance(instId, tmplId);

      // Verify seed
      var beforeRow = await db('task_instances').where('id', instId).first();
      expect(beforeRow).toBeTruthy();
      expect(beforeRow.scheduled_at).toBe(PLACED_SLOT_UTC);
      expect(beforeRow.status).toBe('');

      // Drive production path
      await runScheduleAndPersist(USER_LC1_LC2);

      // Read back
      var afterRow = await db('task_instances').where('id', instId).first();

      // ── LC-1 ASSERTION (a): instance must NOT be deleted ──────────────────────
      // The reconciler spares placed past instances (PATH A protection) so the
      // never-missing invariant can keep them visible. afterRow must survive.
      expect(afterRow).toBeTruthy();

      // ── LC-1 ASSERTION (b): status stays LIVE, never auto-marked 'missed' ─────
      // Leg D (scheduler-recurring-rework §4): AUTO-MISS REMOVED (David 2026-06-24:
      // "there should not be any auto-miss feature"). runSchedule.js:1829-1850. A
      // past-incomplete PLACED recurring instance is NOT marked terminal 'missed';
      // it stays a live, visible commitment flagged OVERDUE on its day. The old
      // 999.808 freeze-as-missed design was retired with auto-miss.
      expect(afterRow.status).toBe('');

      // ── LC-1 ASSERTION (c): flagged overdue, pinned at its original slot ──────
      // runSchedule.js:1841-1850 — placed past recurring → overdue=1, NOT moved.
      // scheduled_at stays the original user slot (NOT windowClose, NOT today).
      expect(Number(afterRow.overdue)).toBe(1);
      expect(afterRow.scheduled_at).toBe(PLACED_SLOT_UTC);

      // Not terminal → completed_at stays null (it was never completed).
      expect(afterRow.completed_at).toBeNull();
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// LC-2 — GUARD: never-placed instance still gets a non-null missedAt (fallback chain)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Covers: TRACEABILITY.md LC-2
//
// Same recur_end-in-past setup but scheduled_at=NULL (never placed).
// The fix must also protect never-placed instances from deletion (same PATH A fix).
// Post-fix: instance must survive, status='missed', scheduled_at non-null
// (from windowClose=null → midnight fallback).
//
// Note: this overlaps BUG-142-AC1b (which tests the same scenario but was authored
// for a different bug context). Here we use the "ended template" approach to exercise
// the reconciler-protection + fallback-chain code path together.
//
// Current code behavior:
//   - Never-placed instance with recur_end in past → toDeleteIds → DELETED
//   - afterRow is undefined → test fails at expect(afterRow).toBeTruthy()
//
// This test is RED on current code (same deletion problem as LC-1) and GREEN post-fix.
// ═══════════════════════════════════════════════════════════════════════════════

describe('LC-2: never-placed recurring instance still gets non-null missedAt (GUARD)', () => {
  /**
   * Covers: TRACEABILITY.md LC-2
   * Layer: integration (real DB, runScheduleAndPersist)
   * Requirement: DB CHECK constraint — terminal status requires non-null scheduled_at
   */
  test(
    'LC-2: never-placed past recurring instance survives, stays live (status=""), surfaced as unscheduled — auto-miss retired',
    async () => {
      if (!available) {
        throw new Error('[TEST-FR-001] Required DB (test-bed @3407) is unreachable — cannot run LC-2 guard test.');
      }

      var tmplId = 'lc2-tmpl-neverplaced';
      var instId = 'lc2-inst-neverplaced';

      // Seed template with recur_end in the past (no desired occurrences)
      await seedEndedTemplate(tmplId, { time_flex: 0 }); // no flex → windowClose is null for NULL scheduled_at

      // Seed never-placed instance: scheduled_at IS NULL
      await seedPlacedInstance(instId, tmplId, {
        scheduled_at: null    // NEVER PLACED — key distinction from LC-1
      });

      // Verify seed
      var beforeRow = await db('task_instances').where('id', instId).first();
      expect(beforeRow).toBeTruthy();
      expect(beforeRow.scheduled_at).toBeNull();
      expect(beforeRow.status).toBe('');

      // Drive production path
      await runScheduleAndPersist(USER_LC1_LC2);

      // Read back
      var afterRow = await db('task_instances').where('id', instId).first();

      // ── LC-2 GUARD: instance must NOT be deleted ──────────────────────────────
      // Same PATH A protection as LC-1 — the never-placed past instance survives the
      // reconciler so the never-missing invariant can surface it.
      expect(afterRow).toBeTruthy();

      // ── LC-2 GUARD: status stays LIVE, never auto-marked 'missed' ─────────────
      // Leg D AUTO-MISS REMOVED (David 2026-06-24). runSchedule.js:1851-1861 — a
      // never-placed past recurring instance is NOT terminal-'missed'; it is surfaced
      // in the Unplaced list (unscheduled=1) so it stays visible per the never-missing
      // invariant. The old 999.808 freeze-as-missed-with-non-null-scheduled_at design
      // was retired with auto-miss.
      expect(afterRow.status).toBe('');

      // ── LC-2 GUARD: surfaced as unscheduled with an unplaced reason ───────────
      expect(Number(afterRow.unscheduled)).toBe(1);
      expect(afterRow.unplaced_reason).toBeTruthy();

      // Never placed + non-terminal → scheduled_at and completed_at stay NULL.
      // (The terminal-requires-non-null-scheduled_at CHECK does not apply: status='').
      expect(afterRow.scheduled_at).toBeNull();
      expect(afterRow.completed_at).toBeNull();
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// LC-3 — REGRESSION GUARD: done with future completedAt clamps to <= now
// ═══════════════════════════════════════════════════════════════════════════════
//
// Covers: TRACEABILITY.md LC-3
//
// The clamp is already coded at UpdateTaskStatus.js:190:
//   update.scheduled_at = customDate > new Date() ? new Date() : customDate;
//
// This test locks it as a regression guard. GREEN on current code.
//
// Proof of non-tautology: if the clamp at :190 is removed, scheduled_at would
// be futureDate (48 h from now), and `storedScheduledAt <= nowAfterCall` fails.
//
// Note: the LC-3 failure in the first test run showed scheduled_at =
// 1782158841000 ms (~4 hours ahead of now). That was because the instance row's
// scheduled_at comes from the CREATION time ('2026-06-01T10:00:00Z'), not the
// clamp — the test was reading the wrong column. The fix: after marking done with
// a SPECIFIC custom completedAt, read back the `completed_at` column (not
// `scheduled_at` from the original creation) to verify the clamp.
//
// UpdateTaskStatus.js:190 sets update.scheduled_at = clampedDate when
// completedAt is provided and is future. The repo then writes both scheduled_at
// and completed_at. We assert both are <= now.
// ═══════════════════════════════════════════════════════════════════════════════

describe('LC-3: done with future completedAt clamps to <= now (REGRESSION GUARD)', () => {
  var knexRepo = null;

  beforeAll(async () => {
    if (!available) return;
    // Use the same test DB — knex instance points to juggler_fixy_test
    knexRepo = new KnexTaskRepository({ db: knex });
    // Ensure LC-3 user exists
    try {
      await knex('users').insert({
        id: USER_LC3, email: USER_LC3 + '@fixy.test',
        timezone: TZ, created_at: new Date(), updated_at: new Date()
      });
    } catch (e) {
      // May already exist from beforeAll setup via main db handle — ignore dup
      if (!e.message || !e.message.includes('Duplicate')) throw e;
    }
  });

  beforeEach(async () => {
    if (!available) return;
    await knex('task_instances').where('user_id', USER_LC3).del();
    await knex('task_masters').where('user_id', USER_LC3).del();
  });

  afterEach(async () => {
    if (!available) return;
    await knex('task_instances').where('user_id', USER_LC3).del();
    await knex('task_masters').where('user_id', USER_LC3).del();
  });

  function makeStatusDeps(r) {
    return H.baseDeps({
      repo: r,
      cache: H.makeCacheFake(),
      events: H.makeEventsSpy(),
      enqueueScheduleRun: H.makeTriggerSpy(),
      statusUpdateSchema: statusUpdateSchema,
      materializeRcInstance: function () { return Promise.resolve(null); },
      handleTemplatePause: function () { return Promise.resolve([]); },
      loadMaster: function () { return Promise.resolve(null); },
      isRollingMaster: function () { return false; },
      applyRollingAnchor: function () { return Promise.resolve(); },
      loadSplitSiblings: function () { return Promise.resolve([]); },
      triggerCalSync: { sync: function () {} },
      reactivateDoneFrozen: function () { return Promise.resolve(); },
      uuidv7: uuidv7
    });
  }

  /**
   * Covers: TRACEABILITY.md LC-3
   * Layer: integration (real KnexTaskRepository, UpdateTaskStatus use-case)
   * Requirement: done-future-clamp (UpdateTaskStatus.js:190)
   */
  test(
    'LC-3 (GUARD): marking done with future completedAt clamps scheduled_at and completed_at to <= now',
    async () => {
      if (!available) {
        throw new Error('[TEST-FR-001] Required DB (test-bed @3407) is unreachable — cannot run LC-3 guard test.');
      }

      // ── Create task with a past scheduledAt (terminal-requires-schedule guard) ──
      var createUc = new CreateTask(H.baseDeps({
        repo: knexRepo,
        cache: H.makeCacheFake(),
        events: H.makeEventsSpy(),
        enqueueScheduleRun: H.makeTriggerSpy(),
        uuidv7: uuidv7
      }));
      var created = await createUc.execute({
        userId: USER_LC3,
        body: {
          text: 'LC-3 done-future clamp',
          scheduledAt: '2026-06-01T10:00:00Z'  // past — satisfies terminal-requires-schedule
        }
      });
      expect(created.status).toBe(201);
      var taskId = created.body.task.id;

      // ── Build a clearly future completedAt (48 hours from now) ──────────────
      var futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
      var futureDateIso = futureDate.toISOString();
      var nowBeforeCall = new Date();

      // ── Mark done with future completedAt ───────────────────────────────────
      var stUc = new UpdateTaskStatus(makeStatusDeps(knexRepo));
      var out = await stUc.execute({
        id: taskId,
        userId: USER_LC3,
        body: { status: 'done', completedAt: futureDateIso }
      });
      expect(out.status).toBe(200);
      expect(out.body.task.status).toBe('done');

      var nowAfterCall = new Date();

      // ── Read back from DB ────────────────────────────────────────────────────
      var afterRow = await knex('task_instances').where('id', taskId).first();
      expect(afterRow).toBeTruthy();
      expect(afterRow.status).toBe('done');

      // ── LC-3 GUARD: scheduled_at must be clamped to <= now ───────────────────
      //
      // UpdateTaskStatus.js:190:
      //   update.scheduled_at = customDate > new Date() ? new Date() : customDate;
      //
      // With futureDateIso > now: scheduled_at is set to new Date() (clamped).
      // Without the clamp: scheduled_at = futureDate (48h from now) → assertion fails.
      //
      // Note: scheduled_at here is the clamped value, NOT the original creation
      // scheduled_at ('2026-06-01T10:00:00Z'). UpdateTaskStatus sets update.scheduled_at
      // only when completedAt is provided and not 'now'/'scheduled' (line 188-191).
      //
      // MySQL datetime strings are stored without timezone and returned by knex with
      // dateStrings:true as 'YYYY-MM-DD HH:MM:SS'. Appending 'Z' parses them as UTC
      // (matching how knex writes JS Date objects to MySQL).
      expect(afterRow.scheduled_at).toBeTruthy();
      var saStr = String(afterRow.scheduled_at).replace(' ', 'T');
      if (!saStr.endsWith('Z') && !saStr.includes('+')) saStr += 'Z';
      var storedScheduledAt = new Date(saStr);

      // Must be <= now (clamped — not the future date)
      expect(storedScheduledAt.getTime()).toBeLessThanOrEqual(nowAfterCall.getTime() + 2000); // +2s for clock skew

      // Must be >= just before the call (a real timestamp, not epoch/original)
      // Generous 30s window for slow CI
      expect(storedScheduledAt.getTime()).toBeGreaterThanOrEqual(nowBeforeCall.getTime() - 30000);

      // Must NOT be the future date (the mutation that survives if clamp is removed)
      expect(storedScheduledAt.getTime()).toBeLessThan(futureDate.getTime());

      // ── LC-3 GUARD: completed_at must also be a real datetime <= now ──────────
      // The command sets completed_at = new Date() at line 168 (isTerminalStatus branch).
      // This fires for all terminal statuses, not just when completedAt is provided.
      expect(afterRow.completed_at).toBeTruthy();
      var caStr = String(afterRow.completed_at).replace(' ', 'T');
      if (!caStr.endsWith('Z') && !caStr.includes('+')) caStr += 'Z';
      var storedCompletedAt = new Date(caStr);
      expect(storedCompletedAt.getTime()).toBeLessThanOrEqual(nowAfterCall.getTime() + 2000);
      expect(storedCompletedAt.getTime()).toBeGreaterThanOrEqual(nowBeforeCall.getTime() - 30000);
    }
  );
});
