/**
 * juggy3 — RED regression tests for W2/R-OD2 and W3/R-OD3 overdue predicate bugs.
 *
 * Pure unit tests on rowToTask (taskMappers.js) with injected nowInfo.
 * No DB, no scheduler setup required — entirely deterministic.
 *
 * ── W2 / R-OD2 — "Fix Slider window" ────────────────────────────────────────
 * Bug: a non-recurring flexible task (placement_mode='time_blocks', recurring=0,
 * deadline=NULL) placed TODAY with a derived implied_deadline in the PAST is
 * shown as overdue. implied_deadline is a scheduler artifact, not a user
 * commitment — it must NOT trigger overdue for a flexible non-recurring task.
 *
 * Root cause (taskMappers.js:381, line ref at 877d173 HEAD):
 *   hasHardCommitment = !!(deadline || implied_deadline || FIXED || isPlacedRecurringInstance)
 *   → TRUE because implied_deadline is set.
 *   Supersede guard (line 412): _placedDateKey='2026-06-30' <= todayKey='2026-06-30' → fires
 *   → dueKey = implied_deadline = '2026-06-28'
 *   dueKey < todayKey → overdue:true   ← BUG
 *
 * Expected post-fix: hasHardCommitment must gate on "is the implied_deadline a
 * genuine user-backed commitment?" — for non-recurring non-FIXED with no user
 * deadline, implied_deadline should not count. (SPEC R-OD2 / AC2a)
 *
 * Live repro (INTAKE-BRIEF): t1780998670238pry3 'Fix Slider window', recurring=0,
 *   time_blocks, deadline=NULL, date=2026-06-30 (today), overdue=0,
 *   implied_deadline=2026-06-28 → read-model returns overdue:true.
 *
 * ── W3 / R-OD3 — "Exercise" (RULING 2026-06-30: OVERDUE IS CORRECT) ────────
 * David ruling (2026-06-30, "Keep overdue — revert Exercise fix"): a RECURRING
 * instance whose derived implied_deadline (recurrence-period boundary marker) is
 * in the past IS overdue, even when placed today. The R50.6 catch-up contract is
 * KEPT. The original W3 today-placed stale-suppression was REVERTED.
 * Exercise being shown overdue is CORRECT behavior, not a bug to fix.
 *
 * Net coherent rule post-ruling:
 *   implied_deadline confers overdue ONLY for recurring_instance (R-OD2 kept);
 *   a past implied_deadline on a recurring instance is overdue regardless of
 *   today-placement (R-OD3 reverted to original, R50.6 preserved).
 *
 * Code path (current production — R-OD2 applied, R-OD3 reverted):
 *   _isRecurringInstance = true → hasHardCommitment = true
 *   _placedDateKey='2026-06-30' <= todayKey='2026-06-30' → fires
 *   → dueKey = implied_deadline = '2026-06-28'
 *   dueKey < todayKey → overdue:true   ← CORRECT (R50.6 catch-up kept)
 *
 * Live repro (INTAKE-BRIEF): 'Exercise' master 019d5dfa-..., recur weekly/TPC4,
 *   time_window, time_flex=90, instance occ758 date=2026-06-30 (today), overdue=0,
 *   implied_deadline=2026-06-28 (past, < placed date) → overdue:true (EXPECTED).
 *
 * ── Regression guards ────────────────────────────────────────────────────────
 * AC2b: non-recurring task with genuine user-set deadline in the past → overdue:true
 * AC2c: FIXED non-recurring task with past scheduled slot → overdue:true
 * AC3b: TPC instance with BOTH placement AND implied_deadline in the past → overdue:true
 * AC3c: 999.810 — future-placed instance with stale implied_deadline → overdue:false
 *
 * ── Traceability ─────────────────────────────────────────────────────────────
 * SPEC: .planning/kermit/juggy3/SPEC.md — R-OD2 / R-OD3
 * TRACEABILITY: .planning/kermit/juggy3/TRACEABILITY.md — R-OD2 / R-OD3
 *
 * Run (pure unit, no DB needed — can run without test-bed):
 *   cd juggler/juggler-backend && \
 *   DB_PORT=3407 npx jest --testPathPattern="taskMappers-overdue-juggy3" --runInBand
 *
 * Or via test-bed (standard integration harness):
 *   cd test-bed && make test-juggler  (picks up via testMatch pattern)
 */
'use strict';

// taskMappers.js is pure (no DB / express / SDK requires).
// No jest.mock needed — import directly.
const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');

const TZ = 'America/New_York';

// Fixed now-context: 2026-06-30, 10:00 AM EDT (600 mins).
// Matches the live prod date from INTAKE-BRIEF so test dates are realistic.
// Injected as the 5th arg to rowToTask — makes the predicate deterministic
// regardless of wall-clock at test-run time.
const NOW_INFO = { todayKey: '2026-06-30', nowMins: 600 };

/**
 * Minimal base row matching tasks_v column shape.
 * Defaults: no commitment (no deadline / no implied_deadline / anytime / not FIXED),
 * active status, placed today, not recurring.
 * Mirrors the baseRow in rowToTaskOverdue.test.js (same spec contract).
 */
function baseRow(overrides) {
  return Object.assign({
    id: 'test-id',
    text: 'Test Task',
    task_type: 'task',
    scheduled_at: '2026-06-30 14:00:00', // UTC (10:00 AM EDT) — placed today
    date: '2026-06-30',                   // today
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
    recurring: 0,
    time_remaining: null,
    time_flex: null,
    flex_when: 0,
    split: 0,
    split_min: null,
    split_ordinal: null,
    split_total: null,
    split_group: null,
    occurrence_ordinal: null,
    recur: null,
    source_id: null,
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
    start_after_at: null,
    tz: null,
    weather_precip: null, weather_cloud: null,
    weather_temp_min: null, weather_temp_max: null,
    weather_temp_unit: null,
    weather_humidity_min: null, weather_humidity_max: null,
    slack_mins: null,
    unscheduled: 0,
    created_at: null,
    updated_at: null,
    completed_at: null,
    master_id: null,
    msft_event_id: null, apple_event_id: null,
    apple_calendar_name: null, cal_sync_origin: null, cal_event_url: null,
    cal_locked: 0,
    end_date: null,
    rolling_anchor: null,
    unplaced_reason: null,
    unplaced_detail: null
  }, overrides);
}

// ══════════════════════════════════════════════════════════════════════════════
// W2 / R-OD2 — "Fix Slider window"
// Non-recurring flexible (time_blocks) task placed today with past implied_deadline
// and no user deadline.
// ══════════════════════════════════════════════════════════════════════════════
describe('W2/R-OD2 — non-recurring flexible task: implied_deadline must NOT trigger overdue', () => {

  // ── AC2a (PRIMARY RED) ────────────────────────────────────────────────────
  /**
   * AC2a: non-recurring time_blocks task placed today with a past derived
   * implied_deadline and no user deadline → overdue MUST be false.
   *
   * Live repro: 'Fix Slider window' — time_blocks, recurring=0, deadline=NULL,
   *   date=2026-06-30 (today), implied_deadline=2026-06-28 (2 days ago).
   *
   * Current code path (taskMappers.js:381):
   *   hasHardCommitment = !!(implied_deadline='2026-06-28') → TRUE
   *   supersede guard (line 412): _placedDateKey='2026-06-30' <= todayKey='2026-06-30' → fires
   *   → dueKey = '2026-06-28'
   *   dueKey < todayKey → returns true (BUG)
   *
   * @expect FAIL pre-fix (RED) — returns overdue:true. Must return false post-fix.
   */
  it('AC2a: non-recurring time_blocks placed today + past derived implied_deadline + no user deadline → overdue:false (RED pre-fix)', () => {
    const row = baseRow({
      task_type: 'task',
      recurring: 0,
      placement_mode: 'time_blocks',
      deadline: null,          // no user deadline
      implied_deadline: '2026-06-28', // past derived artifact — NOT a user commitment
      overdue: 0,
      scheduled_at: '2026-06-30 14:00:00', // today
      date: '2026-06-30'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // RED: pre-fix returns true (hasHardCommitment fires on implied_deadline).
    // Post-fix: flexible non-recurring task must never be overdue from derived implied_deadline.
    expect(task.overdue).toBe(false);
  });

  /**
   * AC2a variant: unplaced row (scheduled_at=null, only date set).
   * The predicate uses row.date for _placedDateKey when scheduled_at is absent.
   * Same bug path — _placedDateKey='2026-06-30' <= todayKey → dueKey=implied_deadline.
   *
   * @expect FAIL pre-fix (RED).
   */
  it('AC2a (unplaced variant): non-recurring time_blocks with date=today + past implied_deadline → overdue:false (RED pre-fix)', () => {
    const row = baseRow({
      task_type: 'task',
      recurring: 0,
      placement_mode: 'time_blocks',
      deadline: null,
      implied_deadline: '2026-06-28',
      overdue: 0,
      scheduled_at: null,  // unplaced — _placedDateKey derives from row.date
      date: '2026-06-30'   // today
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // RED: same path — row.date='2026-06-30' <= todayKey → dueKey fires.
    expect(task.overdue).toBe(false);
  });

  /**
   * AC2a variant: time_window placement mode (non-FIXED flexible).
   * Confirms the fix applies to all flexible placement modes, not only time_blocks.
   *
   * @expect FAIL pre-fix (RED).
   */
  it('AC2a (time_window variant): non-recurring time_window placed today + past implied_deadline → overdue:false (RED pre-fix)', () => {
    const row = baseRow({
      task_type: 'task',
      recurring: 0,
      placement_mode: 'time_window',
      deadline: null,
      implied_deadline: '2026-06-28',
      overdue: 0,
      scheduled_at: '2026-06-30 14:00:00',
      date: '2026-06-30'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ── AC2a-past — W2-isolating test (GREEN post-fix, RED if W2-only reverted) ──
  /**
   * AC2a-past (W2 isolation): non-recurring flexible task placed in the PAST
   * (scheduled date < today, NOT today) with a past implied_deadline and no user
   * deadline → overdue MUST be false.
   *
   * This test isolates the W2 gate (`_isRecurringInstance && impliedDeadlineISO`
   * in hasHardCommitment). The W3 stale-artifact guard (`_isStaleImpliedDeadline`)
   * does NOT fire here because `_isPlacedToday` requires `_placedDateKey === todayKey`
   * — a past-placed task does not satisfy that condition.
   *
   * Therefore this test FAILS when ONLY the W2 gate is reverted (but W3 is intact):
   *   Pre-W2-fix path:
   *     hasHardCommitment = !!(impliedDeadlineISO='2026-06-26') → TRUE
   *     _placedDateKey = '2026-06-28' <= todayKey='2026-06-30' → enters implied_deadline block
   *     _isPlacedToday = ('2026-06-28' === '2026-06-30') → false
   *     _isStaleImpliedDeadline = false → W3 does NOT suppress
   *     dueKey = '2026-06-26' < todayKey → returns overdue:true (test FAILS = RED)
   *   Post-W2-fix path:
   *     _isRecurringInstance = false → hasHardCommitment = false → early return false (GREEN)
   *
   * Run: npx jest --testPathPattern="taskMappers-overdue-juggy3" --runInBand
   *   GREEN post-fix. To verify RED: temporarily revert `_isRecurringInstance &&` in
   *   hasHardCommitment (taskMappers.js:386), run — this test FAILS; restore from backup.
   *
   * Covers: R-OD2 / AC2a (past-placed sub-case)
   *
   * @expect GREEN post-fix. FAIL if W2 gate reverted with W3 intact.
   */
  it('AC2a-past (W2-isolating): non-recurring time_blocks placed in the PAST + past implied_deadline → overdue:false', () => {
    const row = baseRow({
      task_type: 'task',
      recurring: 0,
      placement_mode: 'time_blocks',
      deadline: null,           // no user deadline
      implied_deadline: '2026-06-26', // past derived artifact — 4 days ago
      overdue: 0,
      scheduled_at: '2026-06-28 14:00:00', // 2 days ago — PAST placed date
      date: '2026-06-28'                   // past (NOT today)
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // W3 stale-guard does NOT fire (placed date is past, not today).
    // Only the W2 gate (hasHardCommitment excludes implied_deadline for non-recurring)
    // prevents overdue here. Reverting W2 → overdue:true (test flips RED).
    expect(task.overdue).toBe(false);
  });

  // ── AC2b — regression guard (GREEN both) ─────────────────────────────────
  /**
   * AC2b: non-recurring task with a genuine user-set deadline in the past → STILL overdue:true.
   * The fix must not suppress overdue when the user explicitly set a deadline.
   * deadline (user-set) is authoritative — dueKey comes from deadline, not implied_deadline.
   *
   * @expect GREEN both pre-fix and post-fix.
   */
  it('AC2b (regression guard): non-recurring time_blocks with past user-set deadline → overdue:true', () => {
    const row = baseRow({
      task_type: 'task',
      recurring: 0,
      placement_mode: 'time_blocks',
      deadline: '2026-06-28',  // user-set deadline 2 days ago
      implied_deadline: null,
      overdue: 0,
      scheduled_at: '2026-06-30 14:00:00',
      date: '2026-06-30'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // GREEN: user deadline is authoritative — overdue:true unchanged by fix.
    expect(task.overdue).toBe(true);
  });

  // ── AC2c — regression guard (GREEN both) ─────────────────────────────────
  /**
   * AC2c: FIXED non-recurring task with past scheduled slot → STILL overdue:true.
   * FIXED placement is always a hard commitment; the fix must not change FIXED behavior.
   * dueKey comes from the scheduled slot (utcToLocal), not implied_deadline.
   *
   * scheduled_at='2026-06-28 14:00:00' UTC = 2026-06-28 10:00 AM EDT (2 days ago).
   *
   * @expect GREEN both pre-fix and post-fix.
   */
  it('AC2c (regression guard): FIXED non-recurring task with past scheduled slot → overdue:true', () => {
    const row = baseRow({
      task_type: 'task',
      recurring: 0,
      placement_mode: 'fixed',
      deadline: null,
      implied_deadline: null,
      overdue: 0,
      scheduled_at: '2026-06-28 14:00:00', // UTC: 2026-06-28 10:00 AM EDT (past)
      date: '2026-06-28'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // GREEN: FIXED slot in the past → overdue:true. Not affected by the W2 fix.
    expect(task.overdue).toBe(true);
  });

  /**
   * AC2c variant: FIXED + past implied_deadline present → still overdue:true from slot.
   * Confirms FIXED wins over any implied_deadline handling.
   *
   * @expect GREEN both pre-fix and post-fix.
   */
  it('AC2c (FIXED+impl_deadline variant): FIXED past slot + past implied_deadline → overdue:true (FIXED slot wins)', () => {
    const row = baseRow({
      task_type: 'task',
      recurring: 0,
      placement_mode: 'fixed',
      deadline: null,
      implied_deadline: '2026-06-27',
      overdue: 0,
      scheduled_at: '2026-06-28 14:00:00',
      date: '2026-06-28'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // GREEN: FIXED slot drives overdue — implied_deadline is irrelevant for FIXED tasks.
    expect(task.overdue).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// W3 / R-OD3 — "Exercise"
// Weekly-TPC recurring_instance placed today with stale past implied_deadline
// (earlier than the placed date = stale cycle-boundary artifact).
// ══════════════════════════════════════════════════════════════════════════════
describe('W3/R-OD3 — recurring instance: past implied_deadline IS overdue even when placed today (R50.6 catch-up; David ruling 2026-06-30)', () => {

  // ── AC3a (REGRESSION GUARD — David ruling 2026-06-30) ───────────────────
  /**
   * AC3a (regression guard): weekly-TPC recurring_instance placed today with
   * past implied_deadline → overdue MUST be true.
   *
   * David ruling 2026-06-30 ("Keep overdue — revert Exercise fix"):
   * recurring + past implied_deadline = overdue even when placed today.
   * R50.6 catch-up contract is KEPT. The W3 stale-suppression was REVERTED.
   *
   * This test was previously AC3a (RED pre-fix, asserting false). After the
   * ruling it is a REGRESSION GUARD: ensures the R50.6 catch-up path is never
   * accidentally suppressed for recurring instances placed today.
   *
   * Code path (current production):
   *   _isRecurringInstance = true → hasHardCommitment = true
   *   _placedDateKey='2026-06-30' <= todayKey='2026-06-30' → fires
   *   → dueKey = implied_deadline = '2026-06-28'
   *   dueKey < todayKey → returns true (CORRECT)
   *
   * Real DB wire form: recur stored as JSON string (knex dateStrings mode).
   *
   * @expect GREEN — overdue:true (R50.6 catch-up; R-OD3 ruling)
   */
  it('AC3a (regression guard): weekly-TPC instance placed today + past implied_deadline → overdue:true (R50.6 catch-up; David ruling 2026-06-30)', () => {
    const row = baseRow({
      task_type: 'recurring_instance',
      recurring: 1,
      // Real DB wire form: recur stored as JSON string (not parsed object).
      // dateStrings mode from knex means this is the actual shape tasks_v returns.
      recur: JSON.stringify({ type: 'weekly', timesPerCycle: 4, days: 'MTWRSFU' }),
      placement_mode: 'time_window',
      time_flex: 90,
      deadline: null,
      implied_deadline: '2026-06-28', // past implied_deadline: genuine R50.6 overdue signal
      overdue: 0,
      scheduled_at: '2026-06-30 14:00:00', // today
      date: '2026-06-30'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // REGRESSION GUARD: recurring + past implied_deadline = overdue even when placed today.
    // Any code change that makes this false VIOLATES the R-OD3 ruling + R50.6 catch-up.
    expect(task.overdue).toBe(true);
  });

  /**
   * AC3a variant (recur as parsed object — non-wire form, regression guard).
   * Verifies R50.6 catch-up also applies when recur is already parsed
   * (e.g. in-memory scheduler path). rowToTask handles both via safeParseJSON.
   *
   * David ruling 2026-06-30: recurring + past implied_deadline = overdue even today.
   *
   * @expect GREEN — overdue:true (R50.6 catch-up; R-OD3 ruling)
   */
  it('AC3a (recur as object, regression guard): weekly-TPC placed today + past implied_deadline → overdue:true (R50.6 catch-up; David ruling 2026-06-30)', () => {
    const row = baseRow({
      task_type: 'recurring_instance',
      recurring: 1,
      recur: { type: 'weekly', timesPerCycle: 4, days: 'MTWRSFU' }, // parsed object
      placement_mode: 'time_window',
      time_flex: 90,
      deadline: null,
      implied_deadline: '2026-06-28',
      overdue: 0,
      scheduled_at: '2026-06-30 14:00:00',
      date: '2026-06-30'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // REGRESSION GUARD: recurring + past implied_deadline = overdue even when placed today.
    // Covers both JSON-string (wire form) and parsed-object (in-memory) recur shapes.
    expect(task.overdue).toBe(true);
  });

  /**
   * AC3a variant (implied_deadline same day as today, < placed_date is impossible
   * here — implied_deadline = TODAY = placed_date). When the two are EQUAL the task
   * is exactly at its cycle boundary, so overdue=true IS correct. This is a boundary
   * test to ensure the fix doesn't over-suppress.
   *
   * implied_deadline=today AND placed_date=today: cycle boundary day = today → overdue:true.
   * This is the CORRECT behaviour — the instance is at its limit.
   *
   * @expect GREEN both pre-fix and post-fix (cycle-boundary day → overdue).
   */
  it('AC3a-boundary: weekly-TPC placed today + implied_deadline=TODAY → overdue:false (boundary day not yet breached)', () => {
    const row = baseRow({
      task_type: 'recurring_instance',
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', timesPerCycle: 4, days: 'MTWRSFU' }),
      placement_mode: 'time_window',
      time_flex: 90,
      deadline: null,
      implied_deadline: '2026-06-30', // same as today = placed date → boundary day itself
      overdue: 0,
      scheduled_at: '2026-06-30 14:00:00',
      date: '2026-06-30'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // GREEN: implied_deadline=todayKey → dueKey=todayKey → dueKey < todayKey is false.
    // Non-daily non-FIXED → no intra-day threshold → returns false.
    // Overdue fires only when dueKey < todayKey (i.e. the day AFTER the boundary).
    expect(task.overdue).toBe(false);
  });

  // ── AC3b — regression guard (GREEN both) ─────────────────────────────────
  /**
   * AC3b: TPC instance with BOTH placement AND implied_deadline genuinely in the past
   * (relative to today) → STILL overdue:true. Do not blanket-suppress cycle breaches.
   *
   * Scenario: placed=2026-06-28 (2 days ago), implied_deadline=2026-06-26 (past).
   * The placed date IS in the past (< today), so this is a genuine cycle breach.
   *
   * Pre-fix behaviour:
   *   _placedDateKey='2026-06-28' <= todayKey='2026-06-30' → TRUE → dueKey='2026-06-26'
   *   dueKey < todayKey → overdue:true ✓
   *
   * The fix discriminator must check "placed_date >= today" (not-in-past):
   *   placed_date='2026-06-28' < today → NOT suppressed → remains overdue:true.
   *
   * @expect GREEN both pre-fix and post-fix.
   */
  it('AC3b (regression guard): TPC instance with past placement AND past implied_deadline → overdue:true (genuine breach)', () => {
    const row = baseRow({
      task_type: 'recurring_instance',
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', timesPerCycle: 4, days: 'MTWRSFU' }),
      placement_mode: 'time_window',
      time_flex: 90,
      deadline: null,
      implied_deadline: '2026-06-26', // past AND earlier than placed date
      overdue: 0,
      scheduled_at: '2026-06-28 14:00:00', // 2 days ago
      date: '2026-06-28'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // GREEN: both dates past — genuine overdue scenario (real cycle breach).
    // Fix must NOT suppress this case (placed_date < today → not protected by the guard).
    expect(task.overdue).toBe(true);
  });

  /**
   * AC3b variant: past placement, implied_deadline > placement but still past today.
   * Confirms a non-stale-relative-to-placed but still-past implied_deadline is overdue.
   *
   * placed=2026-06-27 (3 days ago), implied_deadline=2026-06-29 (1 day ago, > placed).
   * dueKey='2026-06-29' < todayKey='2026-06-30' → overdue:true.
   *
   * @expect GREEN both pre-fix and post-fix.
   */
  it('AC3b variant: past placement + implied_deadline past but > placed_date → overdue:true', () => {
    const row = baseRow({
      task_type: 'recurring_instance',
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', timesPerCycle: 4, days: 'MTWRSFU' }),
      placement_mode: 'time_window',
      time_flex: 90,
      deadline: null,
      implied_deadline: '2026-06-29', // past (< today) but NEWER than placed
      overdue: 0,
      scheduled_at: '2026-06-27 14:00:00', // 3 days ago
      date: '2026-06-27'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // GREEN: implied_deadline past → overdue:true. Fix doesn't touch this path
    // (placed_date < today → not protected by today-placement guard).
    expect(task.overdue).toBe(true);
  });

  // ── AC3c — 999.810 regression guard (GREEN both) ─────────────────────────
  /**
   * AC3c: 999.810 regression — strictly-future-placed instance with stale
   * implied_deadline → overdue:false. Pre-existing fix (8924d0c) must not regress.
   *
   * Future placement: scheduled_at='2026-07-02' (2 days from today).
   * _placedDateKey='2026-07-02' > todayKey='2026-06-30' → supersede guard does NOT fire
   * → dueKey stays null → returns false.
   * This path is GREEN on current code and must remain GREEN post-fix.
   *
   * @expect GREEN both pre-fix and post-fix (999.810 fix preserved).
   */
  it('AC3c (999.810 regression guard): future-placed TPC instance + stale implied_deadline → overdue:false', () => {
    const row = baseRow({
      task_type: 'recurring_instance',
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', timesPerCycle: 4, days: 'MTWRSFU' }),
      placement_mode: 'time_window',
      time_flex: 90,
      deadline: null,
      implied_deadline: '2026-06-28', // stale past artifact
      overdue: 0,
      scheduled_at: '2026-07-02 14:00:00', // FUTURE (2 days from now)
      date: '2026-07-02'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // GREEN: 999.810 supersede guard fires (_placedDateKey > todayKey) → dueKey=null → false.
    // Both pre-fix and post-fix: future placement is already protected.
    expect(task.overdue).toBe(false);
  });

  /**
   * AC3c variant: tomorrow placement (= today+1) with stale implied_deadline.
   * Ensures AC3c covers the immediately-adjacent future case.
   *
   * @expect GREEN both pre-fix and post-fix.
   */
  it('AC3c variant: tomorrow-placed TPC instance + stale implied_deadline → overdue:false', () => {
    const row = baseRow({
      task_type: 'recurring_instance',
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', timesPerCycle: 4, days: 'MTWRSFU' }),
      placement_mode: 'time_window',
      time_flex: 90,
      deadline: null,
      implied_deadline: '2026-06-28', // stale past
      overdue: 0,
      scheduled_at: '2026-07-01 14:00:00', // tomorrow
      date: '2026-07-01'
    });
    const task = rowToTask(row, TZ, null, null, NOW_INFO);
    // GREEN: _placedDateKey='2026-07-01' > todayKey='2026-06-30' → guard fires → dueKey=null → false.
    expect(task.overdue).toBe(false);
  });
});
