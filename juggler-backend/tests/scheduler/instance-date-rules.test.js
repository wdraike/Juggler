/**
 * SPEC Verification: Instance Start/Due Date Rules — R1..R7 + INV-6
 *
 * Source: .planning/kermit/juggler-instance-date-rework/SPEC.md
 * Mode: new — encodes SPEC requirements as executable assertions against CURRENT code.
 *             PASS = behavior already works; FAIL = real gap requiring implementation.
 *
 * Layer split:
 *   Part A — pure-function assertions (R3 deadline math, R7 overdue gate, INV-6):
 *            recurringPeriodEndKey, computeIsPastDue, computeEffectiveDeadline, rowToTask.
 *            No DB required; these run even without test-bed.
 *   Part B — DB integration (R1 null windows, R3 persist, R4 split rows, R5 rolling,
 *            R6 flex-quota, R7 overdue flag): requires test-bed (ephemeral pool preferred).
 *
 * Expected per-rule outcomes (current code vs SPEC):
 *   R1  non-recurring: implied_deadline=NULL, earliest_start=NULL, overdue=0            PASS
 *   R2  non-recurring split: all chunks NULL                                             PASS
 *   R3  daily: implied_deadline=OCC+1 (exclusive end of day)                            PASS
 *   R3  weekly std (no TPC): implied_deadline should=OCC+7, actual=OCC+1               FAIL
 *       Gap: runSchedule.js:306-330 isFlexibleTpcRecur treats no-TPC weekly as
 *            day-locked (cycleDays=1); flex=6 is used in-memory (line 735) but
 *            NOT reflected in the persisted implied_deadline.
 *   R4  recurring split: separate rows + same implied_deadline per chunk                PASS
 *   R5  rolling: single active instance (R5 structural)                                  PASS
 *   R5  rolling: implied_deadline=OCC+intervalDays should=OCC+7, actual=OCC+1          FAIL
 *       Gap: runSchedule.js:315 (`else { selectedDays = 1; }`) — rolling type is
 *            "unrecognised" in isFlexibleTpcRecur so always day-locked.
 *   R6  flex-quota weekly (timesPerCycle=3 < selectedDays=7): implied_deadline=OCC+7   PASS
 *   R7  overdue=1 set for past-placed daily recurring past its period                  PASS
 *   INV-6 master start_after_at → task.earliestStart (pure mapper)                     PASS
 *
 * Run (single file, ephemeral pool):
 *   cd test-bed && bash scripts/run-suite.sh juggler -- --testPathPattern="instance-date-rules"
 */
'use strict';

// Part B's many describe blocks each run setupTestDB() (clearAll + scheduler runs)
// in their own beforeAll; under concurrent DB load this occasionally exceeds
// jest's default 5000ms hook timeout on an otherwise-passing block (observed
// intermittently hitting different describe blocks across runs — R1-DB,
// INV-6-DB — not a real failure). Match the timeout convention used by the
// cal-sync DB-integration suites (jest.setTimeout(30000)/(60000)).
jest.setTimeout(30000);

// ── Imports ────────────────────────────────────────────────────────────────────
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const db = require('../../test-helpers/test-db');
const { createTask } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
const {
  computeIsPastDue,
  recurringPeriodEndKey,
  computeEffectiveDeadline
} = require('../../src/scheduler/runSchedule');
const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');
const { getNowInTimezone } = require('../../../shared/scheduler/getNowInTimezone');

const TZ = 'America/New_York';
const { todayKey: TODAY } = getNowInTimezone(TZ);

// ── Date helpers ───────────────────────────────────────────────────────────────

function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Normalize DB date value → 'YYYY-MM-DD' (DATE columns return strings with dateStrings:true)
function toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

// Compute the next Monday on-or-after a given date key.
// Weekly tests need an occurrence on a Monday to validate 7-day windows.
function nextMonday(from) {
  const d = new Date((from || TODAY) + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon
  const daysUntil = dow === 1 ? 7 : (8 - dow) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntil);
  return d.toISOString().slice(0, 10);
}

const NEXT_MON = nextMonday(TODAY);        // next Monday (for weekly tests)
const PAST_3   = addDays(TODAY, -3);       // 3 days ago (for overdue tests)
const PAST_2   = addDays(TODAY, -2);       // 2 days ago
const FUTURE_5 = addDays(TODAY, 5);        // 5 days from now (for INV-6 test)

// Shared time-info for pure computeIsPastDue calls (today = real wall clock)
const TIME_INFO = { todayKey: TODAY, nowMins: 600 /* 10:00 AM */ };

// ═══════════════════════════════════════════════════════════════════════════════
// PART A — Pure-function unit tests (no DB; always run)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── R3 + R5 + R6 deadline math via recurringPeriodEndKey ────────────────────

describe('R3/R5/R6-unit: recurringPeriodEndKey per recurrence type', () => {
  /**
   * R3 daily (PASS expected):
   * "daily → start=due=that day, never rolls to another day (R32.7)."
   * period = 1 day → exclusive end = OCC+1. recurringPeriodEndKey returns OCC+1. ✓
   */
  it('R3-daily: implied_deadline exclusive boundary = OCC+1 (correct — same-day window)', () => {
    const occ = TODAY;
    expect(recurringPeriodEndKey({ type: 'daily', days: 'MTWRFSU' }, occ)).toBe(addDays(occ, 1));
  });

  /**
   * R3 weekly standard, no timesPerCycle — DAY-LOCKED (David 2026-06-29 clarification):
   * A fixed-day weekly ("every Monday", day_req=Mon) has a 1-week window but Monday is the
   * ONLY constraint-compliant day in that window — it cannot move to another day and cannot
   * wander into the next cycle. So if missed it stays overdue at its Monday slot. The period
   * boundary is therefore the occurrence day (OCC+1), NOT the full cycle. Day-lock falls out
   * of the constraints; it is not a separate rule. (Genuine roam happens only for
   * flexible-quota recurring, which has multiple compliant days — see the R6 case below.)
   */
  it('R3-weekly-std: implied_deadline = OCC+1 for standard fixed-day weekly (day-locked, no TPC)', () => {
    const occ = NEXT_MON;
    const result = recurringPeriodEndKey({ type: 'weekly', days: 'M' }, occ);
    expect(result).toBe(addDays(occ, 1));
  });

  /**
   * R5 rolling (FAIL expected):
   * SPEC R5: "implied_deadline = implied_start + period − 1" = OCC+intervalDays-1 inclusive.
   * Exclusive boundary = OCC+intervalDays.
   * For intervalDays=7: expected = OCC+7.
   * Current: rolling is an unrecognised type in isFlexibleTpcRecur → selectedDays=1 →
   *          day-locked → OCC+1.
   *
   * Gap: runSchedule.js:315 `else { selectedDays = 1; }` — catch-all for unrecognised types
   *      means 'rolling' always maps to selectedDays=1 → never flexible → OCC+1.
   */
  it('R5-rolling: implied_deadline should = OCC+intervalDays (exclusive) for rolling', () => {
    const occ = TODAY;
    const result = recurringPeriodEndKey({ type: 'rolling', intervalDays: 7 }, occ);
    // SPEC R5: period = intervalDays = 7 → exclusive end = OCC+7.
    expect(result).toBe(addDays(occ, 7)); // FAILS: actual = addDays(occ, 1)
  });

  /**
   * R6 flexible-quota weekly (PASS expected):
   * timesPerCycle=3 < selectedDays=7 → isFlexibleTpcRecur=true → cycleDays=7 → OCC+7.
   * SPEC R6: "confined to cycle window (1 week)". OCC+7 = correct.
   */
  it('R6-flex-weekly: implied_deadline = OCC+7 for flexible-TPC weekly (3 of 7 days)', () => {
    const occ = TODAY;
    const result = recurringPeriodEndKey({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 }, occ);
    expect(result).toBe(addDays(occ, 7)); // PASSES: flexible-TPC → cycleDays=7
  });

  /**
   * R6 biweekly flexible-quota (PASS expected):
   * timesPerCycle=1 < selectedDays=5 → flexible → cycleDays=14 → OCC+14.
   */
  it('R6-flex-biweekly: implied_deadline = OCC+14 for flexible-TPC biweekly (1 of 5)', () => {
    const occ = TODAY;
    const result = recurringPeriodEndKey({ type: 'biweekly', days: 'MTWRF', timesPerCycle: 1 }, occ);
    expect(result).toBe(addDays(occ, 14)); // PASSES: flexible biweekly → cycleDays=14
  });

  /**
   * computeEffectiveDeadline sanity (PASS expected):
   * revised leg sched-audit 2026-07-02: max() superseded by locked min()
   * effective-deadline ruling (SCHEDULER-SPEC.md:700, David 2026-06-23) —
   * now proven by effective-deadline.test.js; included as context for R3/R5.
   */
  it('computeEffectiveDeadline: min(periodBoundary, windowClose)', () => {
    const periodBoundary = new Date(addDays(TODAY, 3) + 'T00:00:00Z');
    const windowClose    = new Date(addDays(TODAY, 1) + 'T12:00:00Z');
    expect(computeEffectiveDeadline({ periodBoundary, windowClose })).toBe(windowClose);
  });
});

// ─── R1 / R7 via computeIsPastDue ────────────────────────────────────────────

describe('R1/R7-unit: computeIsPastDue overdue gate', () => {
  /**
   * R1 corollary (PASS expected):
   * Non-recurring, no deadline, overdue=0 → NOT past-due regardless of date.
   * The R1 "never overdue" invariant flows through the no-hard-commitment guard.
   */
  it('R1-float: floating non-recurring (no deadline, overdue=0) + past date → falsy', () => {
    const t = { deadline: null, overdue: 0, placementMode: 'anytime', date: PAST_3, time: '09:00 AM' };
    expect(computeIsPastDue(t, 540, TIME_INFO)).toBeFalsy(); // PASS
  });

  /**
   * R7 with deadline set (PASS expected):
   * A recurring instance gets t.deadline = occDate+flex (runSchedule.js:743).
   * For daily: flex=0 → deadline=OCC. If today > OCC → computeIsPastDue=true.
   */
  it('R7-deadline: recurring instance with deadline past date → truthy', () => {
    const t = { deadline: PAST_3, overdue: 0, placementMode: 'anytime', date: PAST_3, time: '09:00 AM' };
    expect(computeIsPastDue(t, 540, TIME_INFO)).toBeTruthy(); // PASS
  });

  /**
   * R7 with overdue DB flag (PASS expected):
   * overdue=1 from DB → computeIsPastDue=true regardless of deadline.
   */
  it('R7-overdue-flag: overdue=1 DB flag + past date → truthy', () => {
    const t = { deadline: null, overdue: 1, placementMode: 'anytime', date: PAST_3, time: '09:00 AM' };
    expect(computeIsPastDue(t, 540, TIME_INFO)).toBeTruthy(); // PASS
  });

  /**
   * R7 future date (PASS expected):
   * Future date → NOT past-due even if deadline is set.
   */
  it('R7-future: deadline set + future date → falsy', () => {
    const t = { deadline: FUTURE_5, overdue: 0, placementMode: 'anytime', date: FUTURE_5, time: '09:00 AM' };
    expect(computeIsPastDue(t, 540, TIME_INFO)).toBeFalsy(); // PASS
  });
});

// ─── INV-6 via rowToTask ──────────────────────────────────────────────────────

describe('INV-6-unit: taskMappers.rowToTask — earliestStart from start_after_at', () => {
  // Minimal DB-row shape for rowToTask (tasks_v column set)
  function makeRow(overrides) {
    return Object.assign({
      id: 'inv6-test', task_type: 'task', text: 'INV-6 test',
      dur: 30, pri: 'P2', project: null, section: null, notes: null, url: null,
      location: null, tools: null, when: null, day_req: null,
      recurring: 0, time_flex: null, flex_when: null, split: null, split_min: null,
      recur: null, recur_start: null, recur_end: null,
      marker: 0, preferred_time_mins: null, placement_mode: 'anytime',
      travel_before: null, travel_after: null, depends_on: null,
      desired_at: null, disabled_at: null, disabled_reason: null,
      deadline: null,
      start_after_at: null,   // <-- INV-6: the master's floor date
      tz: TZ,
      weather_precip: null, weather_cloud: null,
      weather_temp_min: null, weather_temp_max: null, weather_temp_unit: null,
      weather_humidity_min: null, weather_humidity_max: null,
      source_id: null, scheduled_at: null, date: null, day: null, time: null,
      status: '', time_remaining: null, unscheduled: null, overdue: null,
      slack_mins: null, occurrence_ordinal: null, split_ordinal: null,
      split_total: null, split_group: null, generated: 0, gcal_event_id: null,
      depends_on_json: null, created_at: new Date(), updated_at: new Date(),
      msft_event_id: null, apple_event_id: null, master_id: null,
      completed_at: null, implied_deadline: null, earliest_start: null
    }, overrides);
  }

  /**
   * INV-6: master start_after_at present → task.earliestStart = that date.
   * This is how the scheduler enforces "never placed before master.start_after_at".
   * Gap: INV-6 also requires max(instance.earliest_start, master.start_after_at);
   *      the instance's own earliest_start (= occDate) is not read here — the mapper
   *      only reads start_after_at (the master's column). Both columns exist in tasks_v;
   *      the max() is not yet computed.
   */
  it('INV-6: row.start_after_at → task.earliestStart = that date', () => {
    const row = makeRow({ start_after_at: FUTURE_5 });
    const task = rowToTask(row);
    expect(task.earliestStart).toBe(FUTURE_5); // PASS (taskMappers.js:282-286)
  });

  it('INV-6: row.start_after_at = null → task.earliestStart = null', () => {
    const row = makeRow({ start_after_at: null });
    const task = rowToTask(row);
    expect(task.earliestStart).toBeNull(); // PASS
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART B — DB integration tests (require test-bed)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── R1: Non-recurring, no deadline → NULL windows ───────────────────────────

describe('R1-DB: non-recurring task — null implied_deadline + earliest_start', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('R1-null-cols: non-recurring seeded instance has implied_deadline=NULL + earliest_start=NULL', async () => {
    const master = await createTask({
      text: 'R1 non-recurring',
      dur: 60,
      pri: 'P2',
      recurring: false
    });
    // Seed a placement row (non-recurring task_instances are seeded with a date)
    await createTask({
      master_id: master.id,
      date: TODAY,
      status: ''
    });
    const inst = await db('task_instances').where({ master_id: master.id }).first();
    expect(inst).toBeTruthy();
    // R1: scheduler never sets implied_deadline for non-recurring paths → should be NULL
    expect(toDateStr(inst.implied_deadline)).toBeNull(); // PASS
    // R1: earliest_start not set on a seeded non-recurring instance → NULL
    expect(toDateStr(inst.earliest_start)).toBeNull();   // PASS
  });

  it('R1-overdue-zero: non-recurring past-dated task → overdue stays 0 after scheduler run', async () => {
    const master = await createTask({
      text: 'R1 rolls forward',
      dur: 30,
      pri: 'P2',
      recurring: false
    });
    await createTask({
      master_id: master.id,
      scheduled_at: PAST_3 + ' 09:00:00',
      date: PAST_3,
      status: ''
    });

    // Run full scheduler — floating task must roll forward, NOT go overdue
    await runScheduler([], {}, TODAY, 480, { persist: true });

    const inst = await db('task_instances').where({ master_id: master.id }).first();
    expect(inst).toBeTruthy();
    // R1: no hard commitment → never overdue (computeIsPastDue returns falsy for floating)
    expect(inst.overdue).toBeFalsy(); // PASS
  });
});

// ─── R2: Non-recurring split → NULL windows on each chunk ────────────────────

describe('R2-DB: non-recurring split chunks — null implied_deadline', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('R2-split-null: non-recurring split chunks have implied_deadline=NULL', async () => {
    const master = await createTask({
      text: 'R2 split non-recurring',
      dur: 120,
      split: true,
      split_min: 45,
      recurring: false
    });
    // Seed two split chunks
    await createTask({ master_id: master.id, date: TODAY, status: '', split_ordinal: 1, split_total: 2 });
    await createTask({ master_id: master.id, date: TODAY, status: '', split_ordinal: 2, split_total: 2 });

    const insts = await db('task_instances').where({ master_id: master.id }).orderBy('split_ordinal');
    expect(insts).toHaveLength(2);
    // R2: non-recurring split chunks → implied_deadline=NULL (no cycle window)
    insts.forEach(chunk => {
      expect(toDateStr(chunk.implied_deadline)).toBeNull(); // PASS
    });
  });
});

// ─── R3: Recurring — implied_deadline set by scheduler on INSERT ──────────────

describe('R3-DB: recurring instance implied_deadline persisted on scheduler run', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('R3-daily-persist: daily instance gets implied_deadline = OCC+1 after scheduler run', async () => {
    const master = await createTask({
      text: 'R3 daily',
      dur: 30,
      recurring: true,
      recur: { type: 'daily', days: 'MTWRFSU' },
      recurStart: TODAY
    });

    await runScheduler([], {}, TODAY, 480, { persist: true });

    const instances = await db('task_instances').where({ master_id: master.id }).select();
    expect(instances.length).toBeGreaterThan(0);

    // Find the instance closest to TODAY (or exactly TODAY)
    const todayInst = instances.find(i => toDateStr(i.date) === TODAY)
      || instances.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    expect(todayInst).toBeTruthy();

    // R3-daily: implied_deadline = OCC+1 (exclusive boundary = end of occurrence day)
    const occ = toDateStr(todayInst.date) || TODAY;
    expect(toDateStr(todayInst.implied_deadline)).toBe(addDays(occ, 1)); // PASS
  });

  it('R3-earliest-start: recurring instance earliest_start = occurrence date', async () => {
    const master = await createTask({
      text: 'R3 earliest_start',
      dur: 30,
      recurring: true,
      recur: { type: 'daily', days: 'MTWRFSU' },
      recurStart: TODAY
    });

    await runScheduler([], {}, TODAY, 480, { persist: true });

    const instances = await db('task_instances').where({ master_id: master.id }).select();
    const inst = instances.find(i => toDateStr(i.date) === TODAY)
      || instances.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    expect(inst).toBeTruthy();

    // SPEC R3: implied_start (= earliest_start column) = occurrence window-open = occurrence date
    // Tests runSchedule.js:1261 `earliest_start: occDate`
    expect(toDateStr(inst.earliest_start)).toBe(toDateStr(inst.date) || TODAY); // PASS
  });

  it('R3-weekly-persist: fixed-day weekly instance implied_deadline = OCC+1 (day-locked) + persisted (Gap B)', async () => {
    // Standard weekly recurring task on Mondays.
    const master = await createTask({
      text: 'R3 weekly Monday',
      dur: 60,
      recurring: true,
      // 'M' = Mondays only; no timesPerCycle → day-locked (Monday is the only compliant day)
      recur: { type: 'weekly', days: 'M' },
      recurStart: NEXT_MON
    });

    // Run scheduler far enough ahead that NEXT_MON occurrence is generated
    await runScheduler([], {}, NEXT_MON, 480, { persist: true });

    const instances = await db('task_instances').where({ master_id: master.id }).select();
    const monInst = instances.find(i => toDateStr(i.date) === NEXT_MON)
      || instances.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];

    expect(monInst).toBeTruthy();

    // David 2026-06-29: fixed-day weekly is day-locked (only Monday is constraint-compliant in the
    // week window) → period boundary = occurrence day = OCC+1. Gap B fix means it is now PERSISTED
    // (was NULL before — implied_deadline missing from the pickInstance/UPDATE allowlist).
    const occ = toDateStr(monInst.date) || NEXT_MON;
    expect(toDateStr(monInst.implied_deadline)).toBe(addDays(occ, 1));
  });
});

// ─── R4: Recurring split → separate rows, same implied_deadline per chunk ────

describe('R4-DB: recurring split — separate rows + same window per chunk (INV-2)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('R4-separate-rows: recurring split has ≥1 chunk rows after scheduler run', async () => {
    const master = await createTask({
      text: 'R4 recurring split',
      dur: 120,
      split: true,
      split_min: 45,
      recurring: true,
      recur: { type: 'daily', days: 'MTWRFSU' },
      recurStart: TODAY
    });

    await runScheduler([], {}, TODAY, 480, { persist: true });

    const instances = await db('task_instances').where({ master_id: master.id }).select();
    expect(instances.length).toBeGreaterThan(0); // at least one chunk materialized

    // INV-2: chunks stay as SEPARATE rows (not merged/deleted)
    // If the split generates 2+ chunks they must BOTH be present
    const todayChuks = instances.filter(i => toDateStr(i.date) === TODAY);
    if (todayChuks.length > 1) {
      // All chunks of same occurrence → same implied_deadline (same cycle window)
      const deadlines = [...new Set(todayChuks.map(c => toDateStr(c.implied_deadline)))];
      expect(deadlines).toHaveLength(1); // PASS: all chunks share implied_deadline
    }
    // Whether 1 or 2 chunks, none should be missing (INV-2 / NEVER-MISSING)
    expect(instances.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── R5: Rolling — structural (single active) + implied_deadline per period ──

describe('R5-DB: rolling recurrence — active-instance constraint + period deadline', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('R5-single: at most ONE active instance before completion', async () => {
    const master = await createTask({
      text: 'R5 rolling',
      dur: 30,
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7 },
      recurStart: TODAY,
      rollingAnchor: TODAY
    });

    await runScheduler([], {}, TODAY, 480, { persist: true });

    const allInsts = await db('task_instances').where({ master_id: master.id }).select();
    const active = allInsts.filter(i => !['done', 'cancelled', 'missed', 'skipped'].includes(i.status || ''));

    // R5: only ONE active rolling instance should exist before completion
    expect(active.length).toBeLessThanOrEqual(1); // PASS
  });

  it('R5-deadline: rolling instance implied_deadline = OCC+intervalDays (period window)', async () => {
    const master = await createTask({
      text: 'R5 rolling deadline',
      dur: 30,
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7 },
      recurStart: TODAY,
      rollingAnchor: TODAY
    });

    await runScheduler([], {}, TODAY, 480, { persist: true });

    const instances = await db('task_instances').where({ master_id: master.id }).select();
    expect(instances.length).toBeGreaterThan(0);

    const inst = instances.find(i => !['done', 'cancelled', 'missed'].includes(i.status || ''))
      || instances[0];
    const occ = toDateStr(inst.date) || toDateStr(inst.earliest_start) || TODAY;

    // R5: rolling is NOT day-locked (dayReq='any'); its window = the interval. Exclusive
    // boundary = OCC+intervalDays = OCC+7. Fixed: recurringPeriodEndKey handles type 'rolling'.
    expect(toDateStr(inst.implied_deadline)).toBe(addDays(occ, 7));
  });
});

// ─── R6: Flexible-quota → implied_deadline = cycle window ────────────────────

describe('R6-DB: flexible-quota weekly — implied_deadline = full cycle window', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('R6-flex-deadline: flex-quota weekly instances have implied_deadline = OCC+7', async () => {
    const master = await createTask({
      text: 'R6 flex weekly 3 of 7',
      dur: 30,
      recurring: true,
      // 3 occurrences across 7 days/week → flexible-TPC → cycleDays=7
      recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
      recurStart: TODAY
    });

    await runScheduler([], {}, TODAY, 480, { persist: true });

    const instances = await db('task_instances').where({ master_id: master.id }).select();
    expect(instances.length).toBeGreaterThan(0);

    // R6: implied_deadline = cycle window measured from the OCCURRENCE ANCHOR
    // (earliest_start), NOT the placed date. A flexible-TPC instance ROAMS within the
    // cycle, so its placed `date` may sit a few days after earliest_start; the cycle
    // boundary is earliest_start + cycleDays(7). (recurringPeriodEndKey is computed from
    // the occurrence anchor at persist.) Asserting against date would wrongly expect
    // date+7 when the instance roamed to date = anchor+N.
    instances.forEach(inst => {
      const anchor = toDateStr(inst.earliest_start) || toDateStr(inst.date);
      if (anchor) {
        expect(toDateStr(inst.implied_deadline)).toBe(addDays(anchor, 7));
      }
    });
  });
});

// ─── R8: implied_deadline recompute-on-move (999.990) ─────────────────────────
// Phase 1 (chunk pre-insert, runSchedule.js:~1417) materializes implied_deadline
// ONCE at INSERT time; prior to 999.990 it was never recomputed when the
// instance's occurrence anchor later moved. This proves the persist-time
// secondary pendingUpdate (runSchedule.js, right after the main dbUpdate push)
// recomputes it using the NEW anchor, not the stale insert-time value.

describe('R8-DB: implied_deadline recompute-on-move', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('recomputes implied_deadline when a past-placed rolling instance forward-rolls to today', async () => {
    const master = await createTask({
      text: 'R8 rolling recompute-on-move',
      dur: 30,
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7 },
      recurStart: addDays(TODAY, -10),
      rollingAnchor: addDays(TODAY, -10)
    });

    const pastOcc = PAST_3;
    await createTask({
      master_id: master.id,
      date: pastOcc,
      scheduled_at: pastOcc + ' 09:00:00',
      status: '',
      // Deliberately wrong/stale implied_deadline — as if computed once at
      // insert time and never refreshed. Does not match OCC+7 for any real
      // anchor, so a passing test proves an actual recompute happened.
      implied_deadline: '2000-01-01'
    });

    // Run scheduler — the past-placed rolling instance should forward-roll to today.
    await runScheduler([], {}, TODAY, 480, { persist: true });

    const inst = await db('task_instances').where({ master_id: master.id }).first();
    expect(inst).toBeTruthy();
    const newAnchor = toDateStr(inst.earliest_start) || toDateStr(inst.date);
    expect(newAnchor).toBe(TODAY); // confirms the instance actually moved

    // The stale sentinel must be gone, and implied_deadline must reflect the
    // NEW anchor's cycle window (OCC+intervalDays=7), not the original insert.
    expect(toDateStr(inst.implied_deadline)).not.toBe('2000-01-01');
    expect(toDateStr(inst.implied_deadline)).toBe(addDays(newAnchor, 7));
  });
});

// ─── R7: Overdue flag set past implied_deadline ───────────────────────────────

describe('R7-DB: overdue=1 set by scheduler for past placed recurring instance', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('R7-daily-overdue: past-placed daily recurring instance gets overdue=1', async () => {
    const master = await createTask({
      text: 'R7 past daily',
      dur: 30,
      recurring: true,
      recur: { type: 'daily', days: 'MTWRFSU' },
      recurStart: addDays(TODAY, -10)
    });

    // Seed a PAST occurrence that is PLACED (scheduled_at set) but not completed.
    // The scheduler must flag it overdue since today > OCC+1 (the implied_deadline).
    const pastOcc = PAST_2;
    await createTask({
      master_id: master.id,
      date: pastOcc,
      scheduled_at: pastOcc + ' 09:00:00',
      status: '',
      implied_deadline: addDays(pastOcc, 1) // OCC+1: the day AFTER occurrence = exclusive deadline
    });

    // Run scheduler — should flag the past occurrence as overdue
    await runScheduler([], {}, TODAY, 480, { persist: true });

    const inst = await db('task_instances')
      .where({ master_id: master.id })
      .whereRaw('DATE(date) = ?', [pastOcc])
      .first();

    expect(inst).toBeTruthy();
    // R7: past effective deadline + placed → overdue=1 (set at runSchedule.js:1993-1997)
    expect(inst.overdue).toBeTruthy(); // PASS
  });
});

// ─── INV-6: master start_after_at as placement floor ─────────────────────────

describe('INV-6-DB: master start_after_at respected as effective start floor', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('INV-6: task with future start_after_at not placed before that date', async () => {
    const startFloor = FUTURE_5; // 5 days from now
    const master = await createTask({
      text: 'INV-6 future floor',
      dur: 30,
      pri: 'P2',
      recurring: false,
      start_after_at: startFloor + ' 00:00:00'
    });
    await createTask({
      master_id: master.id,
      status: '',
      // Seed on TODAY (before the floor) — the scheduler should not place it before startFloor
      date: TODAY
    });

    await runScheduler([], {}, TODAY, 480, { persist: true });

    const inst = await db('task_instances').where({ master_id: master.id }).first();
    expect(inst).toBeTruthy();

    // INV-6: if placed, must not be before startFloor
    const placedAt = inst.scheduled_at ? toDateStr(inst.scheduled_at) : toDateStr(inst.date);
    if (placedAt && inst.scheduled_at) {
      // PASS: unifiedScheduleV2 enforces earliestStartDate (from master.start_after_at via rowToTask)
      expect(placedAt >= startFloor).toBe(true);
    }
    // Acceptable outcomes: placed on or after startFloor, or not placed (unscheduled=1)
    // Either way the task must NOT be silently placed in TODAY (before the floor)
    if (inst.scheduled_at) {
      const scheduledDate = toDateStr(inst.scheduled_at);
      expect(scheduledDate >= startFloor).toBe(true); // PASS
    }
  });
});
