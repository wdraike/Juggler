/**
 * BUG3 (W3) — RED repro, leg sched-anchor-split-bugs.
 *
 * Traceability: .planning/kermit/sched-anchor-split-bugs/TRACEABILITY.md BUG3.
 *
 * Kermit's hypothesis: `implied_deadline` widens unboundedly for a stuck
 * rolling-type instance because taskMappers.js's `rowToTask` only reads
 * `row.start_after_at` into `earliestStart`, never `row.earliest_start` (the
 * column added by migration 20260624120000_add_earliest_start_to_task_instances.js
 * — task_masters never had this rename; task_instances does). runSchedule.js's
 * stable-anchor recompute (:1805-1837) reads `original.earliestStart` (built via
 * `mappers.rowToTask`, :685/:1333) expecting the SOFT floor persisted at
 * materialization (:1432 `earliest_start: occDate`) to come back — but it never
 * does, so `_impliedAnchor = original.earliestStart || newDate` (:1820) always
 * falls through to `newDate` (the CURRENT run's placement date) for every
 * recurring instance, and `recurringPeriodEndKey(recur, _impliedAnchor)` (:1821)
 * recomputes a NEW cycle-boundary window anchored to TODAY on every run instead
 * of the stable original occurrence anchor.
 *
 * CONFIRMED by reading both sides of the wiring:
 *   - taskMappers.js:464-471 — the ONLY assignment to `earliestStart` reads
 *     `row.start_after_at`; `row.earliest_start` is never referenced anywhere in
 *     the file (grep confirms zero other hits).
 *   - runSchedule.js:685 / :1333 — `allTasks = taskRows.map(r => rowToTask(r, ...))`
 *     is the SAME rowToTask, so `original.earliestStart` (used at :1820) is
 *     always null for a recurring instance regardless of what
 *     `task_instances.earliest_start` holds in the DB.
 *
 * Test 1 (root cause, pure unit on rowToTask): a row with
 * `earliest_start='2026-06-10'` set must map to `task.earliestStart ===
 * '2026-06-10'`. RED: it comes back null.
 *
 * Test 2 (consequence, replicates runSchedule.js:1819-1821 verbatim using the
 * REAL exported `recurringPeriodEndKey`): simulates 3 scheduler passes on a
 * stuck (never-completing) rolling instance where `newDate` drifts forward each
 * pass (the task keeps getting re-placed/rolled without completing) while the
 * DB-seeded `earliest_start` stays fixed. The CURRENT (buggy) anchor selection
 * `original.earliestStart || newDate` — with `original` built via the real
 * `rowToTask` — produces a DIFFERENT, ever-later `implied_deadline` on every
 * pass (unbounded widening). RED: the 3 computed values are not equal /
 * monotonically increasing, instead of staying pinned to
 * earliest_start + intervalDays.
 *
 * Run (pure unit, no DB needed):
 *   cd juggler/juggler-backend && \
 *   NODE_ENV=test npx jest --testPathPattern="bug-anchor-earliest-start-w3" --runInBand
 */
'use strict';

const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');
const { recurringPeriodEndKey } = require('../../src/scheduler/runSchedule');

const TZ = 'America/New_York';
const NOW_INFO = { todayKey: '2026-06-30', nowMins: 600 };

/**
 * Minimal base row matching tasks_v column shape for a recurring_instance,
 * mirrors taskMappers-overdue-juggy3.test.js's baseRow (same spec contract),
 * plus the `earliest_start` column added by migration 20260624120000.
 */
function baseRollingInstanceRow(overrides) {
  return Object.assign({
    id: 'inst-bug3',
    text: 'Stuck rolling task',
    task_type: 'recurring_instance',
    scheduled_at: null,
    date: '2026-06-20',
    time: null,
    status: '',
    dur: 30,
    pri: 'P2',
    project: null,
    section: null,
    notes: null,
    url: null,
    deadline: null,
    implied_deadline: null,
    placement_mode: 'anytime',
    overdue: 0,
    recurring: 1,
    time_remaining: null,
    time_flex: null,
    flex_when: 0,
    split: 0,
    split_min: null,
    split_ordinal: null,
    split_total: null,
    split_group: null,
    occurrence_ordinal: null,
    recur: JSON.stringify({ type: 'rolling', intervalDays: 7, timesPerCycle: 3 }),
    source_id: 'master-bug3',
    generated: 0,
    gcal_event_id: null,
    depends_on: null,
    location: null,
    tools: null,
    when: null,
    day_req: null,
    marker: 0,
    preferred_time_mins: null,
    travel_before: null,
    travel_after: null,
    desired_at: null,
    disabled_at: null,
    disabled_reason: null,
    start_after_at: null,   // task_masters-only column — never set on an instance row
    earliest_start: null,   // 999-migration 20260624120000 column — set per-test below
    tz: null,
    weather_precip: null, weather_cloud: null,
    weather_temp_min: null, weather_temp_max: null,
    weather_temp_unit: null,
    weather_humidity_min: null, weather_humidity_max: null,
    slack_mins: null,
    unscheduled: 1,
    created_at: null,
    updated_at: null,
    completed_at: null,
    master_id: 'master-bug3',
    msft_event_id: null, apple_event_id: null,
    apple_calendar_name: null, cal_sync_origin: null, cal_event_url: null,
    cal_locked: 0,
    end_date: null,
    rolling_anchor: null,
    unplaced_reason: null,
    unplaced_detail: null
  }, overrides);
}

describe('BUG3 (W3) root cause: rowToTask never maps row.earliest_start', () => {
  it('a row with earliest_start set must surface it as task.earliestStart — CURRENTLY FAILS (comes back null)', () => {
    const row = baseRollingInstanceRow({ earliest_start: '2026-06-10' });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // RED: taskMappers.js:467 only branches on row.start_after_at (null here,
    // a task_masters-only column) — row.earliest_start is never read, so
    // task.earliestStart comes back null instead of '2026-06-10'.
    expect(task.earliestStart).toBe('2026-06-10');
  });

  it('control: start_after_at (the pre-existing mapped column) still maps correctly (must not regress)', () => {
    const row = baseRollingInstanceRow({ start_after_at: '2026-06-05', earliest_start: null });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.earliestStart).toBe('2026-06-05');
  });
});

describe('BUG3 (W3) consequence: implied_deadline widens unboundedly across successive scheduler passes for a stuck rolling instance', () => {
  /**
   * Replicates runSchedule.js:1819-1821 verbatim:
   *   if (original.recurring && original.recur) {
   *     var _impliedAnchor = original.earliestStart || newDate;
   *     var _recomputedDeadline = recurringPeriodEndKey(original.recur, _impliedAnchor);
   *   }
   * `original` here is built via the REAL rowToTask (same as runSchedule.js:685
   * `allTasks = taskRows.map(r => rowToTask(r, ...))`), so this exercises the
   * actual production wiring gap, not a re-implementation.
   */
  function computeImpliedDeadlineForPass(row, newDate) {
    const original = rowToTask(row, TZ, null, null, NOW_INFO);
    const _impliedAnchor = original.earliestStart || newDate;
    return recurringPeriodEndKey(original.recur, _impliedAnchor);
  }

  it('3 simulated passes (task never completes, newDate drifts forward each run): implied_deadline should stay STABLE (anchored to the seeded earliest_start), not grow every pass — CURRENTLY FAILS', () => {
    // Seeded once at materialization (runSchedule.js:1432 `earliest_start: occDate`)
    // and never touched again by the (buggy) recompute.
    const EARLIEST_START = '2026-06-10';
    const row = baseRollingInstanceRow({ earliest_start: EARLIEST_START });

    // The task is stuck (status='' forever) and keeps getting re-placed on a
    // later day each run (roam / forward-drift) — newDate advances each pass.
    const pass1 = computeImpliedDeadlineForPass(row, '2026-06-20');
    const pass2 = computeImpliedDeadlineForPass(row, '2026-06-25');
    const pass3 = computeImpliedDeadlineForPass(row, '2026-06-30');

    // DESIRED: the cycle window (rolling, intervalDays=7) is anchored to the
    // STABLE earliest_start, not the drifting placement date — every pass
    // should compute the SAME implied_deadline, '2026-06-17'
    // (EARLIEST_START + 7 days).
    // RED today (documents the actual bug pre-fix, for the record — NOT an
    // assertion in this regression test, just context for whoever reads the
    // failure): because original.earliestStart is always null (Test 1 above),
    // _impliedAnchor falls through to newDate every pass, so the 3 computed
    // deadlines actually come back as newDate+7 each time (2026-06-27,
    // 2026-07-02, 2026-07-07) — different and strictly increasing across
    // passes, not stable. Once BUG3 is fixed (rowToTask maps earliest_start),
    // all three assertions below go GREEN because _impliedAnchor is pinned to
    // EARLIEST_START on every pass.
    const STABLE_EXPECTED = recurringPeriodEndKey(JSON.parse(row.recur), EARLIEST_START);
    expect(pass1).toBe(STABLE_EXPECTED);
    expect(pass2).toBe(STABLE_EXPECTED);
    expect(pass3).toBe(STABLE_EXPECTED);
  });
});
