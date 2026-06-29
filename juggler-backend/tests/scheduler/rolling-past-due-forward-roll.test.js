/**
 * RED regression tests — rolling-past-due-forward-roll — bugfix — 2026-06-29
 *
 * Bug: Past-due active rolling recurring instances (day_req=any, date < today,
 * status='', cycle NOT ended) are stranded at their past date with overdue=0
 * instead of being forward-rolled to the earliest valid today/future slot with
 * overdue=1.
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
    rollingAnchor: ANCHOR,
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
    status: '',
    overdue: 0
    // occurrence_ordinal: auto-assigned by createTask
    // implied_deadline: intentionally absent — key to clean AC6 RED
  }, extra || {}));
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
   * AC1-A: stored overdue must be 1 after scheduler run.
   * RED on current code: Phase 9 is short-circuited at runSchedule.js:1971
   * (placementByTaskId[t.id] is set by pastAnchoredPreQueue), so overdue is never
   * written. DB row stays at overdue=0.
   *
   * @expect FAIL pre-fix — overdue stays 0.
   */
  it('AC1-A: instance overdue=1 stored in DB after scheduler run', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // AC5
    // RED: pre-fix, inst.overdue = 0; this assertion fails.
    expect(inst.overdue).toBe(1);
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
   * AC6-A: rowToTask on post-run instance row reports overdue:true.
   *
   * Pre-fix analysis:
   *   - inst.overdue = 0 (stored, not set by scheduler — Phase 9 skipped)
   *   - inst.implied_deadline = null (never written for stranded rolling instance)
   *   - row.task_type = 'recurring_instance' (injected for accurate mapper call)
   *   - recur.type = 'rolling' → _isDailyRecur = false → isPlacedRecurringInstance = false
   *   - hasHardCommitment = false (no deadline, no implied_deadline, not FIXED, not daily)
   *   - rowToTask computed path: hasHardCommitment=false → returns false
   *
   * Post-fix: scheduler writes overdue=1 (and implied_deadline for new future slot)
   *   → stored flag short-circuits: rowToTask returns true.
   *
   * @expect FAIL pre-fix — rowToTask returns false (hasHardCommitment=false, overdue=0).
   */
  it('AC6-A: rowToTask on post-run instance reports overdue:true', async () => {
    const rawRow = await db('task_instances').where({ id: instance.id }).first();
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
    // RED: pre-fix, overdue=0 stored + no implied_deadline → hasHardCommitment=false
    // → rowToTask returns false. This assertion fails.
    expect(task.overdue).toBe(true);
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
   * AC1-B: stored overdue must be 1.
   * RED on current code: same Phase 9 short-circuit path.
   *
   * @expect FAIL pre-fix — overdue stays 0.
   */
  it('AC1-B: instance overdue=1 stored in DB after scheduler run', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // AC5
    // RED: pre-fix, inst.overdue = 0.
    expect(inst.overdue).toBe(1);
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
      // No rollingAnchor (daily tasks are day-locked, not rolling-anchored)
      // No dayReq override (daily uses type-derived day-lock R32.7)
    });
    // Stranded daily instance at 3 days ago with a real scheduled_at placement
    instance = await createTask({
      master_id: master.id,
      date: PAST_3,
      scheduled_at: PAST_3 + 'T08:00:00Z',
      status: '',
      overdue: 0
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
describe('AC4+AC5 — rolling cycle ended: overdue=1, instance NOT pushed to next cycle (GREEN: cycle-ended path correct)', () => {
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
   * AC4: Cycle-ended rolling instance must have overdue=1.
   * The cycle window (today-10)..(today-3) is fully past. No slot remains.
   * The pre-existing cycle-ended handler (NOT this leg's fix) already writes overdue=1.
   * Both pre-fix and post-fix: overdue=1 is written by the pre-existing path.
   * zoe pre-fix HEAD proof: AC4 PASSED on pre-fix code — the cycle-ended overdue path
   * predates this fix entirely.
   *
   * @expect PASS on both pre-fix and post-fix — cycle-ended overdue path is pre-existing.
   */
  it('AC4: cycle-ended rolling instance gets overdue=1 in DB (GREEN both — characterization of pre-existing cycle-ended overdue path)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // AC5
    // GREEN both: pre-existing cycle-ended path writes overdue=1; not a new behavior from this leg's fix.
    // zoe pre-fix HEAD proof: AC4 PASSED on pre-fix code (overdue=1 already written by cycle-ended handler).
    expect(inst.overdue).toBe(1);
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
   * AC4+characterization: Verify the scheduler's cycle-ended handling creates at most the
   * expected set of active rows. Current code correctly produces:
   *   [0] original occurrence: date=PAST_10, overdue=1 (pinned)
   *   [1] new future occurrence: occurrence_ordinal=2, date >= today (next period)
   * The original instance must NOT be MOVED into the future (only pinned overdue).
   * The new future occurrence is CORRECT scheduling of the next period — not a bug.
   *
   * This test characterizes the cycle-ended steady state and guards against a fix
   * accidentally moving the pinned occurrence or creating spurious extra rows.
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
    expect(orig.overdue).toBe(1);    // marked overdue (cycle-ended path)
    // Any additional active rows must be in the FUTURE (new periods, not the stuck one moved)
    const others = activeInst.filter(r => r.id !== instance.id);
    others.forEach(r => {
      // New occurrences must be at today or future — not another stranded past occurrence
      expect(r.date >= TODAY).toBe(true);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DEFECT-1 — OVERDUE DURABILITY ACROSS RUNS (ernie BLOCK-1 / cookie WARN-1)
//
// Mechanism: KnexScheduleRepository.writeChanged (runSchedule.js:130) hardcodes
// overdue:0 in the scheduled_at batch path for all writes:
//   updateFields = { unscheduled: null, overdue: 0, ... }
// Additionally, the 8.6 sweep (runSchedule.js:1966-1975) pushes overdue:0 for
// any placed task whose raw DB row had overdue=1:
//   taskRows.forEach(r => { if (!r.overdue) return; if (unplacedIds[r.id]) return;
//     pendingUpdates.push({ id:r.id, dbUpdate:{ overdue:0 } }); })
//
// On the FIRST scheduler run, the R-FR1 path (lines 1702-1727) writes overdue=1
// when _preReconDate != null (reconcile moved the instance from past to today).
// On the SECOND run, _preReconDate is null (no reconcile move needed — instance
// is already at today), so R-FR1 doesn't fire. But the 8.6 sweep DOES fire:
//   - taskRows loaded fresh from DB has overdue=1 for the placed instance
//   - instance is placed (not in unplacedIds)
//   - sweep pushes overdue:0
//   - Result: overdue cleared back to 0 on every subsequent run
//
// Test: run scheduler TWICE. After the first run (bert's fix) overdue=1 is set.
// After the second run, assert overdue STILL = 1. RED: second run resets it to 0.
// ══════════════════════════════════════════════════════════════════════════════
describe('DEFECT-1 — overdue durability: second scheduler run must NOT reset overdue=1 (RED pre-fix)', () => {
  let master, instance;

  beforeAll(async () => {
    await setupTestDB();
    master = await createRollingMaster('Durability Task', {
      type: 'rolling', unit: 'days', every: 7, timesPerCycle: 1
    });
    instance = await createStrandedInstance(master.id, PAST_3);
    // First run: bert's fix (R-FR1 path) writes overdue=1 for the stranded instance
    // that reconcile moves from PAST_3 → TODAY. After this run, DB has overdue=1.
    await runScheduler([], {}, TODAY, 480, { persist: true });
    // Second run (durability run): the instance is now at TODAY with overdue=1 in DB.
    // No reconcile move needed this time (_preReconDate=null) → R-FR1 doesn't fire.
    // RED pre-fix: 8.6 sweep (line 1966-1975) detects placed task with overdue=1 in
    // raw DB row → pushes { overdue:0 }. Batch path (line 130) also hardcodes overdue:0
    // for all scheduled_at writes (_flagOf(undefined)=0 ≠ _flagOf(1)=1 → write fires).
    await runScheduler([], {}, TODAY, 480, { persist: true });
  });
  afterAll(teardownTestDB);

  /**
   * DEFECT-1: overdue=1 must survive the second scheduler run.
   *
   * Root causes:
   *   - runSchedule.js:130 hardcodes overdue:0 in writeChanged batch path
   *   - runSchedule.js:1966-1975 8.6 sweep clears overdue for all placed tasks
   *     that had overdue=1 in DB at run start
   *
   * @expect FAIL pre-fix (Defect-1) — overdue reset to 0 on second run.
   */
  it('DEFECT-1: overdue=1 preserved after second scheduler run (second-run durability)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy();
    // RED: pre-fix (Defect-1), inst.overdue = 0
    // (8.6 sweep or writeChanged batch path clears it).
    expect(inst.overdue).toBe(1);
  });

  /**
   * DEFECT-1: NEVER-MISSING — instance must still exist after both runs.
   */
  it('DEFECT-1: instance row still exists after second scheduler run (NEVER-MISSING)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).not.toBeNull();
    expect(inst).not.toBeUndefined();
  });
});

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
   * DEFECT-3: overdue=1 must be stored when no valid slot exists within the cycle (R-FR5).
   *
   * §8 PATH A pre-condition: instance has scheduled_at (PAST_3+'T17:00:00Z' from seed)
   * AND reconcile moved it in-memory to TODAY but no slot found → §8 fires → PATH A
   * (hasScheduledAt=true) → returns early → overdue not written.
   *
   * @expect FAIL pre-fix (Defect-3) — inst.overdue = 0 (§8 PATH A exits without write).
   */
  it('DEFECT-3: overdue=1 stored when no slot found in cycle (R-FR5 — RED pre-fix)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING
    // RED: pre-fix (Defect-3), inst.overdue = 0 (§8 PATH A returns early, no overdue write).
    expect(inst.overdue).toBe(1);
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
//   Master B: rolling, intervalDays=30, rollingAnchor=TODAY-5.
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
      rollingAnchor: ANCHOR_B
    });

    // instanceB: future pending instance for Master B at TODAY+2.
    // Random id (ti-<hex>) is NOT in desiredIds (no desired occurrence for Master B).
    // Future date (TODAY+2 > today) + within expandEnd → goes into toDeleteIds → reconcileChanged=true.
    instanceB = await createTask({
      master_id: masterB.id,
      date: FUTURE_B,
      scheduled_at: FUTURE_B + 'T17:00:00Z',
      status: '',
      overdue: 0
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
   * ERNIE-WARN-1 (a): forward-rolled instance lands at TODAY or later with overdue=1.
   *
   * Post-fix (forwardRollDeadlineById map present): deadline = NEXT_CYCLE_A-1 preserved
   * after rebuild; window = [TODAY, NEXT_CYCLE_A-1]; lands at TODAY ✓.
   *
   * Pre-fix (no map): deadline collapses to TODAY after rebuild; window = [TODAY, TODAY];
   * still lands at TODAY when TODAY has open slots (test-bed default) ✓. Would be RED
   * pre-fix only when TODAY is fully booked: §8 PATH A strands instance at PAST_3 with
   * overdue=0 — window collapse failure is not reproducible in a typical test-bed.
   *
   * @expect PASS on both pre-fix and post-fix in test-bed (open slots today).
   *   Pins bert's forwardRollDeadlineById fix against future regressions.
   */
  it('ERNIE-WARN-1 (a): Master A forward-rolled to TODAY or later with overdue=1 despite reconcileChanged', async () => {
    const inst = await db('task_instances').where({ id: instanceA.id }).first();
    expect(inst).toBeTruthy(); // NEVER-MISSING (c)
    // Lower bound: must have been forward-rolled past PAST_3.
    expect(inst.date >= TODAY).toBe(true);
    // R-FR1: overdue=1 written via _preReconDate path (fires before or after rebuild).
    expect(inst.overdue).toBe(1);
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
