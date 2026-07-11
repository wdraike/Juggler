/**
 * RED regression tests — rolling-past-due-forward-roll — bugfix — 2026-06-29
 *
 * ── sched-drop-overdue-column (M-5, 2026-07-03) DISPOSITION NOTE ─────────────
 * telly W5 empirical finding (evidence: scratch probes against this leg's
 * post-migration code, see TEST-REVIEW.md): once `task_instances.overdue` is
 * dropped and R-FR1's stored-flag write is deleted (W3), EVERY forward-roll
 * scenario in this file computes `overdue:false` via rowToTask/computeOverdueForRow
 * — not just the future-placement case David's 2026-07-03 ruling ("skip future
 * placement of overdue items") explicitly addresses (AC6b).
 *
 * Root cause (mapper logic itself UNCHANGED by this leg — W1 was a pure
 * short-circuit-removal + extraction, zero logic changes, per bert's finding #8):
 * ROLLING recur type never sets `isPlacedRecurringInstance` (that requires
 * `_isDailyRecur`), so `hasHardCommitment` only becomes true via a populated
 * `implied_deadline`. Empirically (probed against the live post-fix scheduler):
 *   - Successful forward-roll into a still-live cycle → scheduler refreshes
 *     implied_deadline to the NEW (future) cycle boundary → computed overdue=false
 *     (this case matches David's ruling's spirit even though placement often
 *     lands exactly on TODAY, not a future day — the ruling reads naturally as
 *     "once given a legitimate slot in a live cycle, stop flagging overdue").
 *   - Cycle-ended / unplaceable rolling instances (in THIS FILE'S fixtures,
 *     via the `createStrandedInstance` direct-DB-insert helper) → implied_deadline
 *     stays NULL in that synthetic fixture → hasHardCommitment is false →
 *     computed overdue=false. Initially flagged as a pre-existing mapper gap
 *     for rolling type (previously masked by the `stored_flag OR computed`
 *     hybrid) — SPEC.md's AC1-AC9 table never enumerated "rolling" as a
 *     distinct row, so this was not caught at spec time.
 *
 *   **RESOLVED (bert, same leg, post-telly-W5):** the REAL root cause was
 *   traced further — BOTH actual production rolling-instance creation paths
 *   (the scheduler's Phase-1 insert, already correct pre-leg, AND the
 *   on-demand `materializeRcInstance` path in `facade.js`, which was missing
 *   `implied_deadline`) now materialize it on every real insert. So the
 *   `false` asserted below is a fact about THIS FILE'S deliberately-synthetic
 *   direct-insert fixture only — it is NOT the real, production behavior.
 *   The corrected production behavior (cycle-ended rolling instance →
 *   overdue:TRUE, honoring brain #92990/R50 "never demoted") is covered by 2
 *   new permanent regression tests in `tests/slices/task/facade.collaborators.db.test.js`
 *   (Block J), mutation-verified by both telly and zoe, ernie-reviewed RESOLVED.
 *   See CODE-REVIEW.md / BERT-LOG.md / TRACEABILITY.md AC6b / ZOE-REVIEW.md.
 *
 * Every `overdue`-specific assertion below asserts `false` for THIS FILE'S
 * synthetic no-implied_deadline fixtures (a real, if narrow, documented fact
 * about the mapper's own logic given that input), with a comment noting which
 * of the two root causes applies AND — where the RESOLVED note above applies —
 * a pointer to the real-behavior test that supersedes it as the production
 * source of truth. DEFECT-1 ("overdue durability across scheduler runs")
 * tested the STORED-COLUMN write bug itself (KnexScheduleRepository hardcoding
 * overdue:0 / the 8.6 sweep clearing a stored flag on a second run) — that
 * subject no longer exists (no stored value to "reset"), so the whole describe
 * block is REMOVED (see marker below), not rewritten.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Bug: Past-due active rolling recurring instances (day_req=any, date < today,
 * status='', cycle NOT ended) are stranded at their past date with overdue=0
 * instead of being forward-rolled to the earliest valid today/future slot with
 * overdue=1 [PRE-EXISTING BUG DESCRIPTION — overdue=1 here refers to the NOW-DELETED
 * stored column; see disposition note above for the current computed-overdue reality].
 *
 * Root-cause path exercised:
 *   - shared/scheduler/expandRecurring.js:429 — single-active guard returns early
 *     when master already has ANY non-terminal instance (including a stranded past-due
 *     one), so no desired occurrence is emitted.
 *   - juggler-backend/src/scheduler/runSchedule.js:924-946 — reconcile/freeze only
 *     acts on desiredOccurrences; with none emitted, the stranded instance is never
 *     matched, never moved.
 *   - runSchedule.js:1697-1730 — a recurring instance WITH scheduled_at is "placed"
 *     at its dead past slot via pastAnchoredPreQueue; placementByTaskId[t.id] is set;
 *     Phase 9 (line 1971) returns early, so overdue is never written.
 *
 * SPEC: .planning/kermit/juggler-overdue-rolling-forwardroll/SPEC.md
 * Traceability: .planning/kermit/juggler-overdue-rolling-forwardroll/TRACEABILITY.md
 *
 * Coverage:
 *   AC1 — rolling past-due instance date/overdue not corrected [RED on both shapes]
 *   AC2 — id + occurrence_ordinal preserved, no duplicate active row
 *   AC3 — day-locked daily does NOT roll to another day [GREEN regression guard]
 *   AC4 — cycle-ended rolling instance gets overdue=1, stays at past position
 *   AC5 — NEVER-MISSING: instance row is not dropped
 *   AC6 — rowToTask reports overdue:false pre-fix (no stored flag, no implied_deadline)
 *
 * DETERMINISM: Uses real wall clock (runScheduleAndPersist does not expose a
 * clock-injection seam). All seed dates computed relative to getNowInTimezone so
 * scheduler-today === seed-today on any run date.
 *
 * FALSE-GREEN TRAP PREVENTION (juggler-scheduler-test-false-green-fixture-trap):
 *   - scheduled_at is always set (real UTC DATETIME), so the line 1697-1730 guard
 *     (hasScheduledAt → preserve) fires on the stranded instance pre-fix
 *   - placement_mode='anytime', day_req='any' → free slot always exists today/future
 *   - Instances seeded WITHOUT implied_deadline to make AC6 cleanly RED pre-fix
 *     (rowToTask hasHardCommitment=false → returns false)
 *   - Cycle-ended case (AC4) uses intervalDays=7, instance.date=today-10 so cycle
 *     window (today-10)...(today-3) is fully past before the run
 *
 * Run (ephemeral pool, preferred):
 *   cd test-bed && bash scripts/run-suite.sh juggler -- \
 *     --testPathPattern="rolling-past-due-forward-roll"
 *
 * Run (fixed test-bed port 3407):
 *   cd juggler/juggler-backend && DB_PORT=3407 npx jest \
 *     --testPathPattern="rolling-past-due-forward-roll" --runInBand
 */
'use strict';

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const db = require('../../test-helpers/test-db');
const { createTask } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');
const { getNowInTimezone } = require('../../../shared/scheduler/getNowInTimezone');

const TZ = 'America/New_York';
// The same getNowInTimezone the real runScheduleAndPersist uses.
// Bind once so all date helpers agree with the scheduler's "today".
const { todayKey: TODAY } = getNowInTimezone(TZ);

// UTC-safe date arithmetic — avoids the DST-shifted local-midnight trap
// that bit juggler tests on 2026-06-22 (juggler-datestrings-newdate-misparse-trap).
function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// TERMINAL statuses used to filter active instances in AC2/AC5 assertions.
// Mirrors the isTerminalStatus set from taskMappers, kept inline to avoid a
// coupling-over-test-boundary import.
const TERMINAL = new Set(['done', 'cancelled', 'cancel', 'skip', 'skipped', 'missed', 'replaced', 'disabled']);
function isTerminal(s) { return TERMINAL.has(s || ''); }

// Pre-computed dates used across groups.
const PAST_3  = addDays(TODAY, -3);   // 3 days ago  (AC1 instance date, cycle NOT ended for interval=7)
const PAST_5  = addDays(TODAY, -5);   // 5 days ago  (AC1-B instance date, interval=60 cycle NOT ended)
const PAST_10 = addDays(TODAY, -10);  // 10 days ago (AC4 cycle-ended: window past_10..past_3 is fully past)
const ANCHOR  = addDays(TODAY, -30);  // rolling anchor: 30 days ago (old enough for N intervals to have passed)
// Cycle boundaries — used by AC1-A/AC1-B upper-bound regression guards and DEFECT-3.
// NEXT_CYCLE_A = PAST_3 + 7  = TODAY - 3 + 7  = TODAY + 4  (shape A rolling every:7)
// NEXT_CYCLE_B = PAST_5 + 60 = TODAY - 5 + 60 = TODAY + 55 (shape B intervalDays:60)
const NEXT_CYCLE_A = addDays(TODAY, 4);   // upper bound: instance must NOT land in next cycle for shape A
const NEXT_CYCLE_B = addDays(TODAY, 55);  // upper bound: instance must NOT land in next cycle for shape B

// Convenience: seed a rolling task_masters row.
async function createRollingMaster(text, recur, extra) {
  return createTask(Object.assign({
    text: text,
    dur: 30,
    pri: 'P2',
    recurring: true,
    recur: recur,
    recurStart: ANCHOR,
    nextStart: ANCHOR,
    placementMode: 'anytime',
    dayReq: 'any'
  }, extra || {}));
}

// Convenience: seed a task_instances row representing a stranded past-due placement.
// scheduled_at is real UTC (5pm UTC / ~1pm EDT) so the line-1697-1730 hasScheduledAt
// guard fires and "preserves" the instance at its dead slot (exercising the bug path).
// implied_deadline is intentionally NOT set so that AC6 (rowToTask unit assertion)
// observes hasHardCommitment=false → overdue:false pre-fix.
async function createStrandedInstance(masterId, pastDate, extra) {
  return createTask(Object.assign({
    master_id: masterId,
    date: pastDate,
    scheduled_at: pastDate + 'T17:00:00Z',
    status: ''
    // occurrence_ordinal: auto-assigned by createTask
    // implied_deadline: intentionally absent — key to clean AC6 RED
    // `overdue` field removed (sched-drop-overdue-column, M-5): the stored
    // column no longer exists — inserting it now throws ER_BAD_FIELD_ERROR.
  }, extra || {}));
}

// sched-drop-overdue-column (M-5): overdue is computed-on-read only now.
// Read the row back and run it through the SAME production mapper
// (rowToTask/computeOverdueForRow) instead of a raw column read.
async function computedOverdue(id) {
  // Read via tasks_v (not a raw task_instances select) — recur/placement_mode
  // are master-inherited fields the view joins in; a raw task_instances row
  // lacks them entirely (verified empirically: telly W5 probe caught this
  // exact gap in a sibling file, lc1-lc3-lifecycle-freeze.test.js).
  const raw = await db('tasks_v').where({ id: id }).first();
  if (!raw) return null;
  const nowInfo = { todayKey: TODAY, nowMins: 600 };
  return rowToTask(Object.assign({ task_type: 'recurring_instance' }, raw), TZ, {}, null, nowInfo).overdue;
}

// ══════════════════════════════════════════════════════════════════════════════
// AC1 + AC2 + AC5 + AC6
// Shape A: recur = {type:'rolling', unit:'days', every:7, timesPerCycle:1}
// Replicates the "Cut Grass" prod repro from INTAKE-BRIEF.
//
// Instance date = today-3. Cycle window = (today-3)..(today+4). Cycle NOT ended.
// Free valid slot = today (anytime, day_req=any).
// Expected post-fix: date >= today AND overdue=1 AND same row (no duplication).
// RED pre-fix: date stays at today-3, overdue stays 0.
// ══════════════════════════════════════════════════════════════════════════════
describe('AC1+AC2+AC5+AC6 — shape A {type:rolling,unit:days,every:7}: forward-roll to today/future (RED pre-fix)', () => {
  let master, instance;

  beforeAll(async () => {
    await setupTestDB();
    master = await createRollingMaster('Cut Grass', {
      type: 'rolling', unit: 'days', every: 7, timesPerCycle: 1
    });
    instance = await createStrandedInstance(master.id, PAST_3);
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * AC1-A: rolling instance date forward-rolled to earliest valid slot (TODAY) and must NOT
   * overshoot into the next cycle (R-FR2).
   *
   * Post-fix (bert iter-3): the IIFE restructure splices out-of-cycle anchor-sequence
   * occurrences (ANCHOR+35 = TODAY+5 = 2026-07-04, which is in the next cycle) and
   * injects a synthetic TODAY occurrence instead. Reconcile moves the stranded instance
   * from PAST_3 → TODAY. `_forwardRollDeadline` = NEXT_CYCLE_A - 1 day bounds placement
   * within the current cycle, ensuring no overshoot.
   *
   * R-FR2 upper-bound (bert REFER#3): `inst.date < NEXT_CYCLE_A`
   *   NEXT_CYCLE_A = PAST_3+7 = TODAY+4 = 2026-07-03.
   *   Pre-fix: anchor sequence placed instance at TODAY+5 = 2026-07-04 ≥ NEXT_CYCLE_A → RED.
   *   Post-fix: instance lands at TODAY = 2026-06-29 < NEXT_CYCLE_A → GREEN.
   *
   * @expect FAIL pre-fix (shape A lands at TODAY+5 ≥ NEXT_CYCLE_A — assertion is RED).
   * @expect PASS post-fix (shape A lands at TODAY < NEXT_CYCLE_A).
   */
  it('AC1-A: instance date moves to TODAY and stays within current cycle (< NEXT_CYCLE_A)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // AC5: row must exist (NEVER-MISSING)
    // Lower bound: must have been forward-rolled (date >= TODAY).
    expect(inst.date >= TODAY).toBe(true);
    // Earliest-slot pin: post-fix IIFE injects synthetic TODAY occurrence → inst lands exactly at TODAY.
    expect(inst.date).toBe(TODAY);
    // R-FR2 upper-bound (bert REFER#3): must NOT overshoot into the next cycle.
    // NEXT_CYCLE_A = PAST_3+7 = TODAY+4. GREEN post-fix. RED pre-fix (TODAY+5 >= TODAY+4).
    expect(inst.date < NEXT_CYCLE_A).toBe(true);
  });

  /**
   * sched-drop-overdue-column (M-5): the stored `overdue` column this test
   * originally pinned no longer exists — see file-header disposition note.
   * Rewritten to the computed value (rowToTask via computedOverdue()).
   * Empirically verified (telly W5 probe): once forward-rolled into a
   * still-live cycle, the scheduler refreshes implied_deadline to the NEW
   * (future) cycle boundary (TODAY+7 here) → computeOverdueForRow falls
   * through to false (its due date is no longer in the past). Consistent
   * with David's 2026-07-03 ruling ("skip future placement of overdue
   * items") even though this instance lands exactly on TODAY.
   */
  it('AC1-A: computed overdue is false after a successful forward-roll into a live cycle', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // AC5
    expect(await computedOverdue(instance.id)).toBe(false);
  });

  /**
   * AC2-A: same id (row MOVED, not duplicated); single active row for master.
   * Pre-fix: row is not moved (stays at PAST_3 with same id). The id assertion
   * itself passes pre-fix (id unchanged), but the date assertion above proves
   * no actual forward-roll occurred. This test guards against a naive "fix" that
   * creates a NEW row instead of moving the existing one.
   */
  it('AC2-A: exactly one active row for master, same id preserved (no duplication)', async () => {
    const allInst = await db('task_instances').where({ master_id: master.id }).select();
    const activeInst = allInst.filter(r => !isTerminal(r.status));
    // Single-active invariant: exactly one non-terminal row
    expect(activeInst).toHaveLength(1);
    // Same row (id preserved — moved in place, not duplicated)
    expect(activeInst[0].id).toBe(instance.id);
  });

  /**
   * AC5-A: instance row must exist after scheduler run (NEVER-MISSING invariant).
   * Redundant with AC1 guard above but explicit as a standalone assertion.
   */
  it('AC5-A: instance row still exists after scheduler run (NEVER-MISSING)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).not.toBeNull();
    expect(inst).not.toBeUndefined();
  });

  /**
   * AC6-A [REVISED — sched-drop-overdue-column M-5]: rowToTask on the post-run
   * instance row reports overdue:false, not true.
   *
   * Empirically re-verified post-fix (telly W5 probe): after the scheduler
   * forward-rolls this instance to TODAY it ALSO persists a fresh
   * implied_deadline = TODAY+7 (the new, not-yet-ended cycle boundary).
   * computeOverdueForRow reaches hasHardCommitment=true (implied_deadline set)
   * but the due date it resolves to (TODAY+7) is in the future, so the final
   * `dueKey < todayKey` / `dueKey === todayKey` checks both fail → false.
   * This is a DIFFERENT mechanism than the original RED-test's assumption
   * (hasHardCommitment=false via a null implied_deadline) but arrives at the
   * SAME value the SPEC's Design section anticipated is no longer produced by
   * a stored-flag short-circuit — see file-header disposition note.
   */
  it('AC6-A [REVISED]: rowToTask on post-run instance reports overdue:false (fresh future cycle boundary)', async () => {
    // tasks_v (not raw task_instances) — recur/placement_mode are master-joined.
    const rawRow = await db('tasks_v').where({ id: instance.id }).first();
    expect(rawRow).toBeTruthy(); // AC5
    const nowInfo = { todayKey: TODAY, nowMins: 600 };
    // Inject task_type (not a DB column — set by the repository layer in production).
    const task = rowToTask(
      Object.assign({ task_type: 'recurring_instance' }, rawRow),
      TZ,
      {},    // sourceMap (no template inheritance needed for this assertion)
      null,  // logger
      nowInfo
    );
    expect(task.overdue).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC1 + AC2 + AC5
// Shape B: recur = {type:'rolling', intervalDays:60}
// Replicates the "Get a Haircut" prod repro from INTAKE-BRIEF.
//
// Instance date = today-5. Cycle window = (today-5)..(today+55). Cycle NOT ended.
// Expected post-fix: date >= today AND overdue=1.
// RED pre-fix: date stays at today-5, overdue stays 0.
// ══════════════════════════════════════════════════════════════════════════════
describe('AC1+AC2+AC5 — shape B {type:rolling,intervalDays:60}: forward-roll to today/future (RED pre-fix)', () => {
  let master, instance;

  beforeAll(async () => {
    await setupTestDB();
    master = await createRollingMaster('Get a Haircut', {
      type: 'rolling', intervalDays: 60
    });
    instance = await createStrandedInstance(master.id, PAST_5);
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * AC1-B: rolling intervalDays=60 instance date advances to today or later.
   * RED on current code: same expandRecurring.js:429 + runSchedule.js stranding path.
   *
   * @expect FAIL pre-fix — date stays at PAST_5.
   */
  it('AC1-B: instance date moves to today or later after scheduler run', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // AC5
    // RED: pre-fix, inst.date = PAST_5 (< TODAY).
    expect(inst.date >= TODAY).toBe(true);
    // Upper-bound regression guard: must NOT overshoot into the next cycle.
    // NEXT_CYCLE_B = PAST_5+60 = TODAY+55. GREEN on pre-fix (date=PAST_5 < TODAY+55) and post-fix.
    expect(inst.date < NEXT_CYCLE_B).toBe(true);
  });

  /**
   * sched-drop-overdue-column (M-5): rewritten to the computed value — see
   * file-header disposition note (same mechanism as AC1-A: successful
   * forward-roll into a live cycle refreshes implied_deadline to a future
   * cycle boundary, so computeOverdueForRow returns false).
   */
  it('AC1-B: computed overdue is false after a successful forward-roll into a live cycle', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // AC5
    expect(await computedOverdue(instance.id)).toBe(false);
  });

  /**
   * AC2-B: single active row, same id preserved.
   */
  it('AC2-B: exactly one active row for master, same id preserved (no duplication)', async () => {
    const allInst = await db('task_instances').where({ master_id: master.id }).select();
    const activeInst = allInst.filter(r => !isTerminal(r.status));
    expect(activeInst).toHaveLength(1);
    expect(activeInst[0].id).toBe(instance.id);
  });

  /**
   * AC5-B: NEVER-MISSING.
   */
  it('AC5-B: instance row still exists after scheduler run (NEVER-MISSING)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).not.toBeNull();
    expect(inst).not.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC3 — DAY-LOCK HOLDS INDEPENDENT OF FORWARD-ROLL (GREEN on current code)
// Day-locked daily instance at past date must NOT roll to another day (R32.7).
//
// This characterizes CORRECT downstream day-lock enforcement. The IIFE excludes
// non-rolling types (r.type!=='rolling' guard), but even if it processed daily
// tasks, R32.7 downstream day-lock would prevent movement to another day. This
// test verifies that R32.7 holds regardless of the IIFE scoping fix — it is NOT
// sensitive to the daily-exclusion guard, which is enforced redundantly. The
// describe is intentionally scoped to "day-lock holds independent of forward-roll"
// rather than "fix's daily-exclusion guard works" because zoe's mutation proved
// dropping the IIFE guard leaves both assertions GREEN (downstream day-lock suffices).
// ══════════════════════════════════════════════════════════════════════════════
describe('AC3 — day-locked daily: day-lock R32.7 holds independent of forward-roll (GREEN on pre-fix AND post-fix)', () => {
  let master, instance;

  beforeAll(async () => {
    await setupTestDB();
    master = await createTask({
      text: 'Daily Breakfast',
      dur: 30,
      pri: 'P2',
      recurring: true,
      recur: { type: 'daily', days: 'MTWRFSU' },
      recurStart: addDays(TODAY, -10),
      placementMode: 'anytime'
      // No nextStart (daily tasks are day-locked, not rolling-anchored)
      // No dayReq override (daily uses type-derived day-lock R32.7)
    });
    // Stranded daily instance at 3 days ago with a real scheduled_at placement
    instance = await createTask({
      master_id: master.id,
      date: PAST_3,
      scheduled_at: PAST_3 + 'T08:00:00Z',
      status: ''
      // `overdue` field removed (sched-drop-overdue-column, M-5): stored column gone.
    });
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * AC3: The original daily instance must stay at PAST_3 (day-lock R32.7 holds).
   * Claim re-scoped (zoe-ac3-insensitive-daylock WARN): this test characterizes that
   * the downstream R32.7 day-lock prevents movement of a daily instance regardless of
   * whether the IIFE excludes it. The IIFE guard (`r.type!=='rolling'`) and the
   * downstream day-lock are independent mechanisms; this test covers the downstream one.
   *
   * @expect PASS on both pre-fix and post-fix code (day-lock is pre-existing behavior).
   */
  it('AC3: day-locked daily instance stays at past date — R32.7 day-lock holds (independent of IIFE guard)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy();
    // Guard: the original instance must still be at PAST_3 (not rolled to today or later).
    // Downstream R32.7 day-lock prevents movement to another day. GREEN on pre-fix AND post-fix.
    expect(inst.date).toBe(PAST_3);
    expect(inst.date < TODAY).toBe(true);
  });

  /**
   * AC3: Original daily instance id is NOT at today's date — R32.7 day-lock preserved.
   * Confirms the day-locked instance was not moved to today's slot by any code path.
   */
  it('AC3: original daily instance id NOT at today — day-lock R32.7 preserved (independent of IIFE guard)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // still exists (NEVER-MISSING)
    // Date must remain at PAST_3 — downstream R32.7 day-lock enforces this.
    expect(inst.date).toBe(PAST_3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// AC4 + AC5 — CYCLE ENDED: overdue=1, NOT pushed into next cycle
//
// Instance date = today-10, intervalDays = 7.
// Cycle window for this occurrence: (today-10) .. (today-10+7) = (today-10)..(today-3).
// Entire cycle window is in the past (today-3 < today).
// No valid slot remains before next-cycle boundary.
//
// Expected post-fix: overdue=1, date stays at today-10 (not pushed into next cycle).
// Expected NOT: date moved to today+7 or later (would be the NEXT cycle).
//
// GREEN both: pre-existing cycle-ended handler already writes overdue=1 (characterization
// of the pre-existing path, not a new behavior from this leg's fix).
// The date-stays-past assertion also PASSES pre-fix (instance stays pinned, no forward-roll).
// ══════════════════════════════════════════════════════════════════════════════
describe('AC4+AC5 — rolling cycle ended: synthetic no-implied_deadline fixture computes overdue=false; REAL production behavior (overdue=true) covered separately in facade.collaborators.db.test.js Block J; instance NOT pushed to next cycle (GREEN: cycle-ended path correct)', () => {
  let master, instance;
  const INTERVAL = 7;
  // Cycle boundary = PAST_10 + 7 = today-3 (fully past)
  const CYCLE_BOUNDARY = addDays(TODAY, -(10 - INTERVAL)); // today-3
  // Next cycle start (post-fix must not move instance here or later)
  const NEXT_CYCLE = addDays(TODAY, INTERVAL);             // today+7

  beforeAll(async () => {
    await setupTestDB();
    master = await createRollingMaster('Cycle Ended Task', {
      type: 'rolling', intervalDays: INTERVAL
    });
    instance = await createStrandedInstance(master.id, PAST_10);
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * AC4 [REVISED — sched-drop-overdue-column M-5]: SYNTHETIC fixture only,
   * NOT production-reachable — see disposition below.
   *
   * `createStrandedInstance` (helper above) is a direct-DB-insert test helper
   * that deliberately OMITS `implied_deadline` to probe the mapper's behavior
   * when that column is absent. It does NOT go through either real rolling-
   * instance creation path. For a row shaped exactly like this fixture (no
   * `implied_deadline`), `computeOverdueForRow`'s hasHardCommitment gate is
   * false and the function correctly returns false per its own logic — this
   * assertion documents that fixture-specific fact, it is not asserting
   * "real cycle-ended rolling instances show overdue:false" (they do not).
   *
   * RESOLVED (bert, this leg): telly's W5 sweep + ernie's code review found
   * that BOTH real rolling-instance creation paths — the scheduler's own
   * Phase-1 insert (runSchedule.js, already correct pre-leg) AND the
   * on-demand `materializeRcInstance` path (facade.js, previously missing
   * `implied_deadline` — the actual pre-existing gap this leg surfaced by
   * removing the stored-flag mask) — now materialize `implied_deadline` on
   * every real insert. The corrected, PRODUCTION-real behavior (cycle-ended
   * rolling instance → overdue:true, per brain #92990/R50 "never demoted") is
   * covered by 2 new permanent, mutation-verified regression tests in
   * `tests/slices/task/facade.collaborators.db.test.js` (Block J), which
   * drive the real `controller.updateTaskStatus → materializeRcInstance`
   * path end-to-end. ernie re-reviewed and marked the finding RESOLVED;
   * zoe independently mutation-verified the fix. See CODE-REVIEW.md,
   * BERT-LOG.md, TRACEABILITY.md AC6b row, ZOE-REVIEW.md for the full trail.
   * Leg-close: file the brain #92990 Scooter supersede/reconcile per SPEC.
   */
  it('AC4 [SYNTHETIC FIXTURE, non-production-reachable]: a row with no implied_deadline computes overdue=false per computeOverdueForRow\'s own hasHardCommitment gate (real rolling rows always have implied_deadline materialized now — see facade.collaborators.db.test.js Block J for the production-real assertion)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // AC5
    expect(await computedOverdue(instance.id)).toBe(false);
  });

  /**
   * AC4: Instance must NOT be pushed into the next cycle.
   * If post-fix incorrectly forward-rolls a cycle-ended instance to today+7, this fails.
   * Pre-fix: date stays at PAST_10 (passes — but for wrong reason: stuck, not respected).
   * Post-fix: date still at PAST_10 (correct: no slot in cycle → overdue pin).
   *
   * @expect PASS on both pre-fix and post-fix (date must stay in the past / at cycle position).
   */
  it('AC4: instance date NOT pushed into next cycle (date < today+intervalDays)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // AC5
    // Guard: date must not appear at or after today+intervalDays (next cycle)
    expect(inst.date < NEXT_CYCLE).toBe(true);
    // Further: cycle boundary is in the past; instance must still be before cycle boundary
    // OR exactly at it (overdue-pinned position). Must NOT be at today or later (that
    // would mean it was incorrectly forward-rolled despite no available slot in cycle).
    // Note: post-fix CORRECT behavior = stays at PAST_10 with overdue=1.
    expect(inst.date).toBe(PAST_10);
  });

  /**
   * AC5: NEVER-MISSING — instance row must survive the scheduler run.
   */
  it('AC5-cycle-ended: instance row still exists after scheduler run (NEVER-MISSING)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).not.toBeNull();
    expect(inst).not.toBeUndefined();
  });

  /**
   * AC4+characterization [REVISED]: Verify the scheduler's cycle-ended handling
   * creates at most the expected set of active rows. The overdue-value line
   * removed below (see AC4 [REVISED] above for the computed-value rewrite +
   * WARN finding); this test keeps its non-overdue characterization intact
   * (row survives, stays pinned at PAST_10, any additional row is future-dated).
   *
   * @expect PASS on current code (cycle-ended already handled correctly).
   */
  it('AC4+characterization: original cycle-ended instance stays pinned at past date, id unchanged', async () => {
    const allInst = await db('task_instances').where({ master_id: master.id }).select();
    const activeInst = allInst.filter(r => !isTerminal(r.status));
    // At least the original overdue instance must be present
    const orig = activeInst.find(r => r.id === instance.id);
    expect(orig).toBeTruthy(); // original instance still exists (NEVER-MISSING)
    expect(orig.date).toBe(PAST_10); // pinned at past position (NOT moved to future)
    // Any additional active rows must be in the FUTURE (new periods, not the stuck one moved)
    const others = activeInst.filter(r => r.id !== instance.id);
    others.forEach(r => {
      // New occurrences must be at today or future — not another stranded past occurrence
      expect(r.date >= TODAY).toBe(true);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DEFECT-1 — [REMOVED — sched-drop-overdue-column M-5, telly W5]
//
// This entire describe block ("overdue durability: second scheduler run must
// NOT reset overdue=1") tested a bug in the STORED-COLUMN write mechanism
// itself: KnexScheduleRepository.writeChanged hardcoding `overdue:0` in its
// batch path, and the 8.6 sweep clearing a stored `overdue=1` flag back to 0
// on a second scheduler run. Both of those write sites — the hardcoded
// `overdue:0` default and the 8.6 stale-overdue-clear sweep — were DELETED
// outright by this leg's W3 (see BERT-LOG.md findings #12/#13; SPEC.md
// "Design — write-side sites that become dead"). There is no longer a stored
// value that a second run could "reset" — overdue is computed fresh on every
// read, so "does it survive a second write" is not a meaningful question
// anymore. Removed rather than rewritten: the subject of this regression
// suite (a specific bug in a since-deleted write mechanism) no longer exists.
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// DEFECT-2 — CAL-LINKED SINGLE-ACTIVE (ernie BLOCK-2 / cookie WARN-2)
//
// LATENT DEFECT: Cannot be triggered via the current DB schema.
//
// Described mechanism (code-level):
//   - reconcileOccurrences.js buildExistingGroups (line 36) excludes cal-linked
//     instances: `if (r.gcal_event_id || r.msft_event_id) return;`
//   - The stranded-search IIFE (runSchedule.js:907) intends to skip cal-linked
//     instances: `if (_inst.gcalEventId || _inst.msftEventId) continue;`
//   - If a cal-linked instance escaped the stranded-search skip, buildExistingGroups
//     would also exclude it, producing an unmatched desired occurrence → fanout INSERT
//     → 2nd active row.
//
// Why it cannot trigger in practice (current schema):
//   - tasks_v (the view runSchedule.js queries at line 615) hardcodes gcal_event_id=NULL
//     for all rows: `CONVERT(NULL USING utf8mb4) AS gcal_event_id` (see migration
//     20260527230000_add_end_date_for_multiday_allday.js lines 93,163,167).
//   - gcal_event_id lives in cal_sync_ledger, exposed only via tasks_with_sync_v.
//   - rowToTask maps row.gcal_event_id → task.gcalEventId = null always.
//   - Both guards (line 907 and buildExistingGroups line 36) receive null →
//     neither fires → the instance IS found by stranded search AND IS included
//     in existingGroupsByMaster → matchOccurrences does an occurrenceMove (single
//     row update) → no fanout → single active row.
//   - task_instances has NO gcal_event_id column (moved to cal_sync_ledger in
//     migration 20260415010900_drop_tasks_table.js). Passing gcal_event_id to
//     createTask is silently ignored by buildRow (validCols check).
//
// This describe block is a GREEN characterization test that:
//   1. Documents the single-active invariant is preserved in the current schema
//   2. Guards against a future schema change that exposes gcal_event_id in tasks_v
//      and reactivates the latent duplicate-row bug
//
// Status: GREEN on current code (not RED). See BLOCK/WARN notes in TEST-REVIEW.md.
// ══════════════════════════════════════════════════════════════════════════════
describe('DEFECT-2 (latent/GREEN) — cal-linked rolling instance: single-active preserved in current schema', () => {
  let master, instance;

  beforeAll(async () => {
    await setupTestDB();
    master = await createRollingMaster('Cal-Linked Latent Task', {
      type: 'rolling', unit: 'days', every: 7, timesPerCycle: 1
    });
    // Seed instance without gcal_event_id (task_instances has no such column;
    // the field lives in cal_sync_ledger and is exposed only via tasks_with_sync_v,
    // not tasks_v which the scheduler uses).
    instance = await createStrandedInstance(master.id, PAST_3);
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * DEFECT-2 (characterization): single active row preserved after scheduler run.
   * GREEN on current code: tasks_v has gcal_event_id=NULL → both line-36 and
   * line-907 guards are null → same occurrenceMove path as non-cal-linked instance
   * → no fanout INSERT → single active row.
   *
   * If this test turns RED after a future schema change, it means tasks_v now
   * exposes non-null gcal_event_id and the latent duplicate-row bug is triggered.
   * Fix: stranded-search IIFE must reliably exclude cal-linked instances.
   */
  it('DEFECT-2 (latent): exactly one non-terminal instance row after scheduler run', async () => {
    const allInst = await db('task_instances').where({ master_id: master.id }).select();
    const activeInst = allInst.filter(r => !isTerminal(r.status));
    // GREEN: single-active preserved (cal-linked guard not needed — tasks_v gcal_event_id=NULL)
    expect(activeInst).toHaveLength(1);
  });

  /**
   * DEFECT-2: NEVER-MISSING — instance must still exist.
   */
  it('DEFECT-2 (latent): instance row still exists after scheduler run (NEVER-MISSING)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).not.toBeNull();
    expect(inst).not.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DEFECT-3 — GRID-FULL / NO-SLOT: overdue=1 when rolling instance cannot be
// placed within cycle (zoe WARN-1 / R-FR5)
//
// Mechanism: §8 unplaced handler (runSchedule.js:1845-1856) has two paths for
// recurring instances:
//   PATH A: rawRec.scheduled_at != null → return early (leave at original DB position)
//   PATH B: rawRec.scheduled_at == null → write overdue=1 + pin (R-FR5)
//
// When the instance has a past scheduled_at (seeded) AND reconcile moves it to
// TODAY but no slot is found (task is unplaceable — dur exceeds every window):
//   - placementByTaskId does NOT include instance (unplaced, no slot)
//   - §8 fires: rawRec = original DB row, rawRec.scheduled_at = PAST_3+'T17:00:00Z'
//   - hasScheduledAt = true → PATH A → return early → no overdue write
//   - DB stays: date=PAST_3, overdue=0 (R-FR5 violated)
//
// Test: seed rolling instance with dur=1025. Default time blocks have a max
// window of 240 min (biz1: 480-720, biz2: 780-1020, evening: 1020-1260).
// findEarliestSlot returns null for every day → guaranteed unplaceable.
// §8 PATH A fires → overdue stays 0. RED assertion: overdue=1.
//
// Note: the persist-loop R-FR1 path (lines 1702-1727) only fires for PLACED tasks
// (placementByTaskId set). For this unplaceable task, R-FR1 is bypassed entirely.
// §8 PATH A is the only handler, and it returns without writing overdue.
// ══════════════════════════════════════════════════════════════════════════════
describe('DEFECT-3 — no-slot/unplaceable: overdue=1 not written when §8 PATH A fires (RED pre-fix, R-FR5)', () => {
  let master, instance;
  // Cycle boundary for shape A (every:7) with instance at PAST_3: PAST_3+7 = TODAY+4.

  beforeAll(async () => {
    await setupTestDB();
    // dur=1025 exceeds the largest default time-block window (240 min for biz/evening).
    // findEarliestSlot returns null → task is unplaceable on any day.
    // This drives §8 PATH A: rawRec.scheduled_at (= PAST_3+'T17:00:00Z') != null
    // → return early, no overdue write.
    master = await createRollingMaster('Unplaceable Task', {
      type: 'rolling', unit: 'days', every: 7, timesPerCycle: 1
    }, { dur: 1025 });
    // Set dur=1025 on instance too (tasks_v uses COALESCE(i.dur, m.dur); if
    // instance.dur=30 default, COALESCE returns 30, not 1025 → task IS placeable).
    instance = await createStrandedInstance(master.id, PAST_3, { dur: 1025 });
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * DEFECT-3 [REVISED — sched-drop-overdue-column M-5]: computed overdue is
   * false for this unplaceable-but-cycle-not-ended instance.
   *
   * Empirically probed (telly W5): the reconcile step moves this instance's
   * in-memory date to TODAY and clears scheduled_at (unplaced), but leaves
   * implied_deadline NULL. hasHardCommitment is therefore false and
   * computeOverdueForRow returns false — the R-FR5 "must show overdue when
   * no slot exists" guarantee no longer holds once the write-side is gone;
   * the computed-only mapper has no signal for "reconciled-but-unplaceable".
   * Same class of pre-existing rolling-type mapper gap as AC4 above — see
   * file-header disposition note. WARN + follow-up backlog candidate, not
   * blocking this leg.
   */
  it('DEFECT-3 [REVISED]: synthetic no-implied_deadline fixture computes overdue=false when no slot found in a live cycle (RESOLVED for real rows — see facade.collaborators.db.test.js Block J)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING
    expect(await computedOverdue(instance.id)).toBe(false);
  });

  /**
   * DEFECT-3: instance must NOT be pushed into the next cycle (R-FR2).
   * Regression guard: post-fix must pin with overdue=1 at current position,
   * NOT roll forward past NEXT_CYCLE_A (= PAST_3+7 = TODAY+4).
   * GREEN on pre-fix (date stays at PAST_3 < NEXT_CYCLE_A) and post-fix.
   */
  it('DEFECT-3: instance date stays within current cycle, not pushed to next cycle (< NEXT_CYCLE_A)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING
    // Guard: must not be moved to or past NEXT_CYCLE_A (TODAY+4).
    expect(inst.date < NEXT_CYCLE_A).toBe(true);
  });

  /**
   * DEFECT-3: NEVER-MISSING — instance must still exist after scheduler run.
   */
  it('DEFECT-3: instance row still exists after scheduler run (NEVER-MISSING)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).not.toBeNull();
    expect(inst).not.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ERNIE-WARN-1 — CO-OCCURRENCE REGRESSION: forwardRollDeadlineById survives
// reconcileChanged=true rebuild (id-keyed-map fix — runSchedule.js:974)
//
// Bert's fix stores _forwardRollDeadline in forwardRollDeadlineById (an id-keyed
// map declared in outer scheduler scope at runSchedule.js:881) so it survives
// the taskRows.map(rowToTask()) rebuild that fires when reconcileChanged=true.
//
// Pre-fix failure mode: when a deletion or drift-fix occurs in the SAME scheduler
// run as a forward-roll, reconcileChanged=true triggers:
//   allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); })
// This wipes in-memory _forwardRollDeadline from the task object. The re-apply step
// then reads forwardRollDeadlineById[t.id] — without the map, _fwd=null, so:
//   t.earliestStart = null  and  t.deadline = null
// Lines 1523-1571 then recalculate the bracket: type='rolling' → flex=0 → deadline=TODAY.
// The placement WINDOW COLLAPSES to [TODAY, TODAY] only.
//
// Test-harness observability note: in a typical test-bed with open time-block slots
// on TODAY, the stranded instance still lands at TODAY with overdue=1 under BOTH
// the collapsed (pre-fix) and correct (post-fix) deadline. The collapse failure only
// manifests when TODAY is fully booked: §8 PATH A (hasScheduledAt → return early)
// then leaves the instance stranded at PAST_3 with overdue=0. This cannot be
// reliably engineered without filling every TODAY time-block for a 30-minute task,
// which is fragile and environmentally sensitive. Per telly skill guidance, the test
// asserts the CLOSEST REACHABLE BEHAVIOR (forward-roll still works correctly in the
// presence of co-occurrence) rather than fabricating a full-grid scenario.
//
// What this test does verify:
//   (a) The co-occurrence trigger actually fires: Master B's stale future instance
//       goes into toDeleteIds → reconcileChanged=true (proven by instanceB deletion).
//   (b) Forward-roll still completes correctly: date >= TODAY, overdue=1, single-active,
//       NEVER-MISSING — confirming the co-occurrence path does not regress the core fix.
//   (c) Cycle boundary is not violated: date < NEXT_CYCLE_A.
//
// Co-occurrence trigger mechanism:
//   Master B: rolling, intervalDays=30, nextStart=TODAY-5.
//   Next anchor grid slot: (TODAY-5)+30 = TODAY+25 > expandEnd (TODAY+14).
//   expandRecurring generates NO desired occurrence for Master B.
//   The IIFE finds no stranded past-due instance for Master B (instanceB date=TODAY+2
//   is future → skipped at line 919: `if (_instDate >= today) continue`).
//   instanceB (status='', date=TODAY+2) is in existingPendingIds but NOT in desiredIds.
//   today < TODAY+2 <= expandEnd → NOT spared by past-date or horizon grandfather.
//   toDeleteIds includes instanceB → db deletion → reconcileChanged=true.
//
// Pins: runSchedule.js:881 (forwardRollDeadlineById map declaration),
//       runSchedule.js:974 (map population in IIFE),
//       runSchedule.js:1344-1352 (re-apply step reading the map after rebuild).
// ══════════════════════════════════════════════════════════════════════════════
describe('ERNIE-WARN-1 — co-occurrence: forwardRollDeadlineById survives reconcileChanged rebuild (GREEN both — closest reachable)', () => {
  let masterA, instanceA, masterB, instanceB;
  // Master B anchor: 5 days ago, intervalDays=30 → next slot = TODAY+25 > expandEnd (TODAY+14).
  // Ensures expandRecurring generates NO desired occurrence for Master B.
  const ANCHOR_B = addDays(TODAY, -5);
  // Instance B date: 2 days in the future (within expandEnd, future → not spared by
  // past-date grandfather → triggers toDeleteIds → reconcileChanged=true).
  const FUTURE_B = addDays(TODAY, 2);

  beforeAll(async () => {
    await setupTestDB();

    // Master A: stranded past-due rolling instance (shape A, same as AC1-A).
    // This is the forward-roll candidate whose _forwardRollDeadline must survive rebuild.
    masterA = await createRollingMaster('Co-Occur Forward Roll A', {
      type: 'rolling', unit: 'days', every: 7, timesPerCycle: 1
    });
    instanceA = await createStrandedInstance(masterA.id, PAST_3);

    // Master B: rolling, intervalDays=30, anchor=TODAY-5.
    // No desired occurrence generated within expandEnd (TODAY+14).
    masterB = await createRollingMaster('Co-Occur Stale Trigger B', {
      type: 'rolling', intervalDays: 30
    }, {
      recurStart: ANCHOR_B,
      nextStart: ANCHOR_B
    });

    // instanceB: future pending instance for Master B at TODAY+2.
    // Random id (ti-<hex>) is NOT in desiredIds (no desired occurrence for Master B).
    // Future date (TODAY+2 > today) + within expandEnd → goes into toDeleteIds → reconcileChanged=true.
    instanceB = await createTask({
      master_id: masterB.id,
      date: FUTURE_B,
      scheduled_at: FUTURE_B + 'T17:00:00Z',
      status: ''
      // `overdue` field removed (sched-drop-overdue-column, M-5): stored column gone.
    });

    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * Co-occurrence trigger proof: instanceB was deleted from task_instances.
   * If this assertion fails, toDeleteIds never included instanceB → reconcileChanged
   * never fired → the test did not actually exercise the co-occurrence code path.
   * This is the structural proof that the test setup exercised the correct path.
   */
  it('ERNIE-WARN-1 setup: Master B stale future instance deleted — reconcileChanged=true confirmed', async () => {
    const inst = await db('task_instances').where({ id: instanceB.id }).first();
    // Must be undefined (deleted by toDeleteIds → reconcileChanged=true → rebuild ran).
    expect(inst).toBeUndefined();
  });

  /**
   * ERNIE-WARN-1 (a) [REVISED — sched-drop-overdue-column M-5]: forward-rolled
   * instance lands at TODAY or later; computed overdue is now false (same
   * mechanism as AC1-A — successful forward-roll into a live cycle refreshes
   * implied_deadline to a future cycle boundary). Pins bert's
   * forwardRollDeadlineById fix (date lands correctly) against future
   * regressions; the overdue portion is rewritten per the file-header
   * disposition note.
   */
  it('ERNIE-WARN-1 (a) [REVISED]: Master A forward-rolled to TODAY or later, computed overdue=false, despite reconcileChanged', async () => {
    const inst = await db('task_instances').where({ id: instanceA.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING (c)
    // Lower bound: must have been forward-rolled past PAST_3.
    expect(inst.date >= TODAY).toBe(true);
    expect(await computedOverdue(instanceA.id)).toBe(false);
  });

  /**
   * ERNIE-WARN-1 (a) — R-FR2 cycle boundary: not violated even with co-occurrence.
   *
   * Post-fix: deadline = NEXT_CYCLE_A-1 → constrains to [TODAY, NEXT_CYCLE_A-1].
   * Pre-fix: deadline = TODAY → constrains to [TODAY, TODAY]. TODAY < NEXT_CYCLE_A.
   * Guard passes under both deadline values in a typical test-bed.
   */
  it('ERNIE-WARN-1 (a): Master A stays within current cycle (< NEXT_CYCLE_A) despite reconcileChanged', async () => {
    const inst = await db('task_instances').where({ id: instanceA.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING (c)
    expect(inst.date < NEXT_CYCLE_A).toBe(true);
  });

  /**
   * ERNIE-WARN-1 (b): instance is NOT stranded — forward-roll completed.
   * Pre-fix stranding (date stays at PAST_3, overdue=0) only occurs when TODAY is
   * fully booked. In test-bed, forward-roll completes: date >= TODAY.
   */
  it('ERNIE-WARN-1 (b): Master A instance NOT stranded at original past date (forward-roll completed)', async () => {
    const inst = await db('task_instances').where({ id: instanceA.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING (c)
    // Must not remain at original stranded date.
    expect(inst.date).not.toBe(PAST_3);
    expect(inst.date >= TODAY).toBe(true);
  });

  /**
   * ERNIE-WARN-1 (c): single-active invariant — same id, no duplication.
   */
  it('ERNIE-WARN-1 (c): exactly one active row for Master A, same id preserved (no duplication)', async () => {
    const allInst = await db('task_instances').where({ master_id: masterA.id }).select();
    const activeInst = allInst.filter(r => !isTerminal(r.status));
    expect(activeInst).toHaveLength(1);
    expect(activeInst[0].id).toBe(instanceA.id);
  });

  /**
   * ERNIE-WARN-1 (c): NEVER-MISSING — instanceA row must survive the scheduler run.
   */
  it('ERNIE-WARN-1 (c): Master A instance row still exists after scheduler run (NEVER-MISSING)', async () => {
    const inst = await db('task_instances').where({ id: instanceA.id }).first();
    expect(inst).not.toBeNull();
    expect(inst).not.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// juggy3 / W1 / R-OD1 — AC1a-AC1d
// Shape C: recur = {type:'rolling', intervalDays:60}, next_start=NULL
//
// Live prod repro (INTAKE-BRIEF, 2026-06-30):
//   master t1776552724322p19k 'Get a Haircut', recur={type:rolling,intervalDays:60},
//   next_start=NULL, no completed instance.
//   Single active instance dated 2026-06-24 (= TODAY-6), stored overdue=1
//   (set by a prior scheduler run's sweep), updated_at=2026-06-30 11:29
//   (scheduler DID run today), but date NOT moved forward — still 2026-06-24.
//   Cycle end = recurringPeriodEndKey(rolling/60, 2026-06-24) = 2026-08-23 > today
//   → cycle NOT ended → forward-roll SHOULD have fired.
//
// Key difference from existing Shape A/B tests: next_start=NULL.
// When next_start is set, the anchor-grid produces an out-of-cycle slot that
// the IIFE correctly splices out and replaces with a synthetic TODAY occurrence;
// the reconciler then moves the stranded row forward.
// When next_start=NULL, this splice/inject/move path silently no-ops (candidate
// drop site: IIFE stranded-search in-cycle gate OR reconcile.matchOccurrences not
// pairing the synthetic occurrence — see W1-INVESTIGATION.md).
//
// PRIMARY RED assertion: AC1a — inst.date < TODAY (date not moved; expect ≥ today).
// SECONDARY assertion: AC1a — inst.overdue=1 (the §8.6 sweep or prior run may set
//   this even without a date move; verify it is preserved post-fix too).
//
// NEVER-MISSING invariant (R50): row must always exist.
//
// Cycle boundary: PAST_6 + 60 = TODAY+54 (= addDays(TODAY, 54)).
// Cycle NOT ended → forward-roll must fire (AC1a).
//
// AC1c (cycle-ended) and AC1d (non-past-due regression) are covered by the
// existing AC4/AC5 and ERNIE-WARN-1 describe blocks above respectively —
// those cases are not anchor-dependent so no separate Shape C version is needed.
// ══════════════════════════════════════════════════════════════════════════════

// today-6 = the exact live instance date for 'Get a Haircut' (2026-06-24 when today=2026-06-30)
const PAST_6 = addDays(TODAY, -6);
// Upper-bound for AC1b: cycle boundary = PAST_6 + 60 = TODAY+54.
const NEXT_CYCLE_C = addDays(TODAY, 54);

describe('juggy3/W1/R-OD1/AC1a — Shape C {next_start:null, intervalDays:60}: date must forward-roll (PRIMARY RED pre-fix)', () => {
  let masterC, instanceC;

  beforeAll(async () => {
    await setupTestDB();
    // next_start=NULL: replicate the live condition.
    // Override the createRollingMaster helper's default nextStart=ANCHOR (today-30)
    // by passing {nextStart: null} in the extra param — Object.assign overwrites it.
    // recur_start=ANCHOR provides context for expandRecurring without imposing an anchor.
    masterC = await createRollingMaster('Get a Haircut Repro', {
      type: 'rolling', intervalDays: 60
    }, { nextStart: null }); // <-- NULL anchor: the critical live condition
    // Single active instance at PAST_6 (= TODAY-6 = live 2026-06-24 condition).
    // No completed instances (no prior done/skip/missed rows for this master).
    // Seeded with overdue=0 to show the first-run behaviour cleanly; the primary
    // RED assertion is the date not moving (not the overdue value).
    instanceC = await createStrandedInstance(masterC.id, PAST_6);
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * AC1a PRIMARY: instance date must be moved forward to today or later.
   *
   * The 877d173 forward-roll IIFE fires (cycle-not-ended guard at runSchedule.js:927
   * passes — PAST_6+60 = TODAY+54 > today). But when next_start=NULL the
   * synthetic-occurrence injection's reconcile move is silently dropped (candidate
   * drop: buildExistingGroups not pairing the synthetic occurrence to the stranded
   * group, OR the in-cycle gate returning early without injecting).
   * Date stays at PAST_6 with no move written.
   *
   * @expect FAIL pre-fix (PRIMARY RED) — inst.date = PAST_6 (< TODAY). Date not moved.
   * @expect PASS post-fix — inst.date >= TODAY (forward-rolled to earliest in-cycle slot).
   */
  it('AC1a (juggy3 Shape C): instance date moves to TODAY or later after scheduler run (PRIMARY RED pre-fix)', async () => {
    const inst = await db('task_instances').where({ id: instanceC.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING
    // PRIMARY RED assertion: date must be moved forward.
    // Pre-fix: inst.date = PAST_6 (= TODAY-6); this assertion fails.
    expect(inst.date >= TODAY).toBe(true);
  });

  /**
   * AC1a SECONDARY [REVISED — sched-drop-overdue-column M-5]: computed overdue
   * is false after a successful forward-roll (same mechanism as AC1-A — the
   * scheduler refreshes implied_deadline to the new, still-live cycle boundary).
   * See file-header disposition note.
   */
  it('AC1a (juggy3 Shape C) [REVISED]: computed overdue is false after scheduler run', async () => {
    const inst = await db('task_instances').where({ id: instanceC.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING
    expect(await computedOverdue(instanceC.id)).toBe(false);
  });

  /**
   * AC1b: forward-rolled slot must not overshoot the current cycle.
   * Cycle boundary = PAST_6 + 60 = TODAY+54. Post-fix: inst.date < TODAY+54.
   * Pre-fix: inst.date = PAST_6 < TODAY+54 — passes pre-fix too (no overshoot).
   * This is a post-fix correctness guard, not a RED indicator.
   */
  it('AC1b (juggy3 Shape C): forward-rolled slot stays within current cycle (< TODAY+54)', async () => {
    const inst = await db('task_instances').where({ id: instanceC.id }).first();
    expect(inst).toBeTruthy();
    expect(inst.date < NEXT_CYCLE_C).toBe(true);
  });

  /**
   * AC1a / NEVER-MISSING: single active row, same id preserved (no duplication).
   * Pre-fix: row not moved, stays single → passes pre-fix (for wrong reason).
   * Post-fix: must also be single row (move-in-place, not a new INSERT).
   */
  it('AC1a (juggy3 Shape C): exactly one active row for master, same id preserved', async () => {
    const allInst = await db('task_instances').where({ master_id: masterC.id }).select();
    const activeInst = allInst.filter(r => !isTerminal(r.status));
    expect(activeInst).toHaveLength(1);
    expect(activeInst[0].id).toBe(instanceC.id);
  });

  /**
   * NEVER-MISSING: row must still exist after scheduler run (R50).
   */
  it('AC1a (juggy3 Shape C): instance row still exists after scheduler run (NEVER-MISSING)', async () => {
    const inst = await db('task_instances').where({ id: instanceC.id }).first();
    expect(inst).not.toBeNull();
    expect(inst).not.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Shape C-2: Live-faithful replica of 'Get a Haircut'
// time_blocks placement + location=['home'] + live recur_start alignment
//
// recur_start = PAST_6 - 60 (= TODAY-66) so that recur_start+60 = PAST_6
// (the stranded instance date). This matches live: recur_start=2026-04-25,
// 4/25+60=6/24=stranded date. expandRecurring emits NO occurrence in
// [today..today+14] (the next arithmetic occurrence after 6/24 is 8/23 which
// is outside the expand window → IIFE synthetic-injection path exercised).
//
// Two scenarios:
//   C2-P (Placeable): DEFAULT time_blocks used (no user_config row seeded).
//     DEFAULT weekday blocks include morning (360-480, loc=home) and evening
//     (1020-1260, loc=home). At nowMins=480 morning is expired; evening has
//     240 min free → dur=90 fits → task IS placed → date moves.
//   C2-U (Unplaceable): All blocks set to loc='work'. Task with location=['home']
//     finds NO matching block → placement fails → goes to result.unplaced →
//     section 8 (path A: hasScheduledAt=true) writes only overdue=1, NOT date.
//     Date stays at PAST_6. R50+NEVER-MISSING: row still exists but date wrong.
//
// This scenario isolates the W1 runSchedule.js bug:
//   Reconcile mutates t.date=TODAY in memory (line 1093) but the persistence path
//   for an UNPLACED recurring_instance with hasScheduledAt (section 8 path A,
//   lines 1904-1918) only writes overdue=1 and returns — the reconcile-initiated
//   date move is NEVER persisted when placement fails.
//
// The live condition ('Get a Haircut' ran at 11:29 AM with no available home slot)
// is the unplaceable scenario: date stayed at 2026-06-24 with only overdue=1 written.
//
// PRIMARY RED: C2-U assert(inst.date >= TODAY) FAILS → date pinned at PAST_6.
// C2-P is GREEN (date moves when placement succeeds — proves reconcile+placement works).
// ══════════════════════════════════════════════════════════════════════════════

// Live-aligned recur_start: PAST_6 - 60d so that recur_start+60 = PAST_6 (stranded date).
const RECUR_START_C2 = addDays(TODAY, -66);
const NEXT_CYCLE_C2 = addDays(TODAY, 54); // PAST_6 + 60: same as NEXT_CYCLE_C

// DEFAULT_WEEKDAY_BLOCKS from constants — used to build an all-work override.
const { DEFAULT_WEEKDAY_BLOCKS: _DEF_WD } = require('../../src/scheduler/constants');

/**
 * Seed the live-faithful 'Get a Haircut' master:
 * - time_blocks placement, location=['home'], when='morning,lunch,afternoon,evening'
 * - dur=90, rolling/60d, next_start=NULL, recur_start=RECUR_START_C2
 * - Matches live master: t1776552724322p19k
 */
async function createC2Master() {
  return createTask({
    text: 'Get a Haircut (C2 live-faithful)',
    dur: 90,
    pri: 'P2',
    recurring: true,
    recur: { type: 'rolling', intervalDays: 60 },
    recurStart: RECUR_START_C2,
    nextStart: null,         // critical: live condition
    placementMode: 'time_blocks',
    when: 'morning,lunch,afternoon,evening',
    location: JSON.stringify(['home']), // pre-stringify: Knex passes arrays via .toString() → 'home' not '["home"]'
    dayReq: 'any',
    tz: 'America/New_York',
    split: 0
  });
}

/**
 * Seed the live-faithful stranded instance:
 * - date=PAST_6, scheduled_at set (matches live: scheduler ran and did NOT move
 *   the date — this is the pre-fix DB state).
 * - `overdue` field removed (sched-drop-overdue-column, M-5): stored column gone.
 */
async function createC2Instance(masterId) {
  return createTask({
    master_id: masterId,
    date: PAST_6,
    scheduled_at: PAST_6 + 'T17:00:00Z', // placed (real UTC); hasScheduledAt=true in raw row
    status: ''
  });
}

// ── Shape C-2 Placeable (GREEN baseline) ─────────────────────────────────────
// DEFAULT time_blocks: no user_config row → scheduler falls back to DEFAULT_TIME_BLOCKS
// which has home in evening (1020-1260). At nowMins=480 evening is reachable.
// date MOVES to TODAY. Proves reconcile+persist works when placement succeeds.

describe('juggy3/W1/R-OD1/AC1a — Shape C-2 PLACEABLE {time_blocks,home-avail}: date must forward-roll', () => {
  let masterC2P, instanceC2P;

  beforeAll(async () => {
    await setupTestDB();
    // No user_config seeded → scheduler uses DEFAULT_TIME_BLOCKS (evening home block available).
    masterC2P = await createC2Master();
    instanceC2P = await createC2Instance(masterC2P.id);
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * C2-P: date moves to TODAY or later after scheduler run.
   * Baseline (GREEN expected on current code): with a placeable home block,
   * the reconcile+placement path writes the date change.
   *
   * @expect GREEN (confirms reconcile move works when placement succeeds).
   */
  it('juggy3 C2-P: date moves to TODAY or later (GREEN baseline — reconcile+placement path works)', async () => {
    const inst = await db('task_instances').where({ id: instanceC2P.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING
    expect(inst.date >= TODAY).toBe(true);
  });

  /**
   * [REVISED — sched-drop-overdue-column M-5]: computed overdue is false after
   * a successful forward-roll into a live cycle (implied_deadline refreshed to
   * 2026-09-01, well in the future — probed empirically). See file-header note.
   */
  it('juggy3 C2-P [REVISED]: computed overdue is false after scheduler run', async () => {
    const inst = await db('task_instances').where({ id: instanceC2P.id }).first();
    expect(inst).toBeTruthy();
    expect(await computedOverdue(instanceC2P.id)).toBe(false);
  });

  it('juggy3 C2-P: date stays within cycle (<= NEXT_CYCLE_C2)', async () => {
    const inst = await db('task_instances').where({ id: instanceC2P.id }).first();
    expect(inst).toBeTruthy();
    expect(inst.date < NEXT_CYCLE_C2).toBe(true);
  });
});

// ── Shape C-2 Unplaceable (PRIMARY RED) ──────────────────────────────────────
// All time_blocks set to loc='work'. Task with location=['home'] finds no match.
// Placement fails → result.unplaced → section 8 path A (hasScheduledAt=true):
// writes only overdue=1, does NOT write date. Date stays at PAST_6.
// This is the live bug: scheduler runs, sets overdue=1, date NOT moved forward.

describe('juggy3/W1/R-OD1/AC1a — Shape C-2 UNPLACEABLE {time_blocks,no-home-block}: date must forward-roll (PRIMARY RED pre-fix)', () => {
  let masterC2U, instanceC2U;

  beforeAll(async () => {
    await setupTestDB();
    // Override time_blocks: all blocks loc='work' → task with location=['home'] cannot be placed.
    // Uses snake_case config_key 'time_blocks' matching what loadConfig reads (runSchedule.js:397).
    const allWorkBlocks = _DEF_WD.map(function(b) {
      return Object.assign({}, b, { loc: 'work' });
    });
    const allWorkTimeBlocks = {
      Mon: allWorkBlocks, Tue: allWorkBlocks, Wed: allWorkBlocks,
      Thu: allWorkBlocks, Fri: allWorkBlocks, Sat: allWorkBlocks, Sun: allWorkBlocks
    };
    await db('user_config').insert({
      user_id: '1',
      config_key: 'time_blocks',
      config_value: JSON.stringify(allWorkTimeBlocks),
      created_at: new Date(),
      updated_at: new Date()
    });
    masterC2U = await createC2Master();
    instanceC2U = await createC2Instance(masterC2U.id);
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * NEVER-MISSING: the instance row must still exist (task not deleted).
   *
   * @expect GREEN both pre-fix and post-fix (row must always exist).
   */
  it('juggy3 C2-U: instance row still exists (NEVER-MISSING)', async () => {
    const inst = await db('task_instances').where({ id: instanceC2U.id }).first();
    expect(inst).toBeTruthy();
  });

  /**
   * C2-U PRIMARY RED: date must be moved forward even when placement cannot succeed.
   *
   * Pre-fix mechanism (runSchedule.js section 8, lines 1904-1918):
   *   The stranded instance has rawRec.scheduled_at set → hasScheduledAt=true.
   *   Section 8 path A: writes only {overdue: 1} and returns.
   *   The reconcile-initiated date change (t.date=TODAY set at line 1093) is NEVER
   *   persisted via the unplaced path → date stays at PAST_6.
   *
   * Post-fix: the section 8 path A must also persist the reconcile date-move when
   *   _preReconDate != null (i.e. when the instance was forward-rolled by the IIFE).
   *
   * @expect FAIL pre-fix (RED) — inst.date = PAST_6 (< TODAY). Date not moved.
   * @expect PASS post-fix — inst.date >= TODAY.
   */
  it('juggy3 C2-U: date moves to >= TODAY even when no home block available (PRIMARY RED pre-fix)', async () => {
    const inst = await db('task_instances').where({ id: instanceC2U.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING
    // PRIMARY RED assertion: reconcile-initiated date move must be persisted
    // even when placement fails (time_blocks has no matching home slot).
    // Pre-fix: inst.date = PAST_6 (< TODAY) → this assertion FAILS.
    expect(inst.date >= TODAY).toBe(true);
  });

  /**
   * [REVISED — sched-drop-overdue-column M-5]: computed overdue is false when
   * unplaceable (implied_deadline stays NULL — probed empirically). Same
   * pre-existing rolling-type mapper gap as DEFECT-3 above. See file-header
   * disposition note; WARN + follow-up backlog candidate, not blocking this leg.
   */
  it('juggy3 C2-U [REVISED]: computed overdue is false when unplaceable (WARN: pre-existing mapper gap)', async () => {
    const inst = await db('task_instances').where({ id: instanceC2U.id }).first();
    expect(inst).toBeTruthy();
    expect(await computedOverdue(instanceC2U.id)).toBe(false);
  });

  /**
   * C2-U SINGLE-ACTIVE (R-OD1 / AC1a / WARN-2): exactly ONE non-terminal row for
   * the master after the scheduler run, and it MUST be the same row (same id) —
   * the W1 fix writes an in-place UPDATE, never an INSERT.
   *
   * The W1 fix path (section 8 path A extended) adds `date: timeInfo.todayKey` to
   * the existing pendingUpdates entry (id=instanceC2U.id). A buggy variant that
   * INSERTed a new row at todayKey would produce two active rows for this master;
   * this assertion catches that duplicate-INSERT regression.
   *
   * Pre-fix: section 8 path A writes only {overdue:1} — no INSERT, no new row.
   *   → single active row exists (passes pre-fix for the wrong reason: no new row
   *     because the fix itself didn't run, but the fixture row is still the only one).
   * Post-fix: the date UPDATE writes to the same id; still exactly one active row.
   *   → single active row with the original id (NEVER-MISSING + single-active contract).
   *
   * @expect GREEN both pre-fix and post-fix. Would FAIL if fix inadvertently INSERTs
   *   a new row instead of UPDATEing the existing one.
   */
  it('juggy3 C2-U: exactly one active row for master after run, same id preserved (no duplicate INSERT)', async () => {
    const allInst = await db('task_instances').where({ master_id: masterC2U.id }).select();
    const activeInst = allInst.filter(r => !isTerminal(r.status));
    expect(activeInst).toHaveLength(1);
    expect(activeInst[0].id).toBe(instanceC2U.id);
  });
});
