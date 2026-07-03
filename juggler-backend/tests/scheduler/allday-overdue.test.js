/**
 * allday-overdue — RED tests (999.1083, M-1 ruling: all-day overdue at midnight).
 *
 * Pure unit tests on rowToTask (taskMappers.js), injected nowInfo — no DB, no
 * scheduler setup. Written BEFORE the ALL_DAY branch exists in the
 * computed-on-read overdue IIFE (taskMappers.js:348-506, hasHardCommitment gate) —
 * AC-1/AC-3/tz-edge below are expected RED against current HEAD; AC-2/AC-4/AC-5
 * are regression pins (already true today because ALL_DAY currently falls through
 * to overdue:false unconditionally) that must STAY green once the branch lands.
 *
 * ── Spec (SPEC.md FR-1 / FR-2, brain:101837 M-1 / M-5) ───────────────────────
 * dueKey = row.end_date (local ISO, multiday) ∥ scheduled_at-local-date (single
 * day) ∥ row.date (DATE column, when scheduled_at is null). overdue:true when
 * dueKey < todayKey. Midnight boundary ONLY — day===today is never overdue
 * regardless of nowMins (no intra-day threshold for all-day items). Terminal
 * status / disabled / dateless all_day rows stay suppressed exactly as today.
 *
 * ── Traceability ──────────────────────────────────────────────────────────────
 * SPEC: .planning/kermit/allday-overdue/SPEC.md — FR-1, FR-2, AC-1..AC-6
 * TRACEABILITY: .planning/kermit/allday-overdue/TRACEABILITY.md — FR-1, FR-2
 *
 * Run (pure unit, no DB needed):
 *   cd juggler/juggler-backend && npx jest --testPathPattern="allday-overdue" --runInBand
 */
'use strict';

// taskMappers.js is pure (no DB / express / SDK requires) — import directly,
// same as tests/scheduler/taskMappers-overdue-juggy3.test.js.
const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');

const TZ = 'America/New_York';
// Fixed now-context: 2026-06-21, 10:00 AM EDT (600 mins).
const NOW_INFO = { todayKey: '2026-06-21', nowMins: 600 };

// Full row fixture (mirrors tests/rowToTaskOverdue.test.js baseRow shape so
// rowToTask never dereferences an undefined field) — defaults to an
// unscheduled, non-terminal, non-recurring all_day row with NO date resolvable
// (AC-5 default) so each test only overrides what it needs to exercise.
function baseAllDayRow(overrides) {
  return Object.assign({
    id: 'ad-1',
    text: 'All-day task',
    task_type: 'task',
    scheduled_at: null,
    date: null,
    end_date: null,
    time: null,
    status: '',
    dur: null,
    pri: 'P2',
    project: null,
    section: null,
    notes: null,
    url: null,
    deadline: null,
    implied_deadline: null,
    placement_mode: 'all_day',
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
    rolling_anchor: null
  }, overrides);
}

describe('rowToTask — ALL_DAY computed-on-read overdue (999.1083, M-1)', function() {

  // ─── AC-1: day = yesterday, status='' → overdue:true ───────────────────────
  // RED against current HEAD: ALL_DAY is not yet in the hasHardCommitment gate
  // (taskMappers.js:390-391), so today this returns false.
  it('AC-1: all_day row, single-day scheduled_at YESTERDAY, status="" → overdue:true', function() {
    // scheduled_at 2026-06-20 14:00:00 UTC = 2026-06-20 10:00 AM EDT (yesterday).
    var row = baseAllDayRow({ scheduled_at: '2026-06-20 14:00:00', date: '2026-06-20' });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ─── AC-2: day = today, ANY nowMins (incl. 23:59) → overdue:false ──────────
  // Midnight-boundary-only: no intra-day overdue for all-day items even at the
  // last minute of the day. Already false pre-fix (regression pin for post-fix).
  it('AC-2: all_day row, scheduled_at TODAY, nowMins=600 → overdue:false', function() {
    // 2026-06-21 22:00:00 UTC = 2026-06-21 6:00 PM EDT (today).
    var row = baseAllDayRow({ scheduled_at: '2026-06-21 22:00:00', date: '2026-06-21' });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  it('AC-2: all_day row, scheduled_at TODAY, nowMins=1439 (23:59) → overdue:false (no intra-day)', function() {
    var row = baseAllDayRow({ scheduled_at: '2026-06-21 22:00:00', date: '2026-06-21' });
    var task = rowToTask(row, TZ, null, null, { todayKey: '2026-06-21', nowMins: 1439 });
    expect(task.overdue).toBe(false);
  });

  // ─── AC-3: multiday all_day (row.end_date set) ──────────────────────────────
  it('AC-3: multiday all_day, end_date=YESTERDAY → overdue:true', function() {
    var row = baseAllDayRow({ date: '2026-06-18', end_date: '2026-06-20' });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  it('AC-3: multiday all_day, end_date=TODAY → overdue:false', function() {
    var row = baseAllDayRow({ date: '2026-06-19', end_date: '2026-06-21' });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  it('AC-3: multiday all_day, end_date=FUTURE → overdue:false', function() {
    var row = baseAllDayRow({ date: '2026-06-19', end_date: '2026-06-25' });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── AC-4: past day + terminal/disabled status → overdue:false ─────────────
  // (suppression happens BEFORE the hasHardCommitment gate — already green
  // pre-fix; pinned here so the new ALL_DAY branch can never bypass it.)
  ['done', 'skip', 'cancel'].forEach(function(st) {
    it('AC-4: all_day row, past day, status="' + st + '" → overdue:false (terminal suppression)', function() {
      var row = baseAllDayRow({ scheduled_at: '2026-06-19 14:00:00', date: '2026-06-19', status: st });
      var task = rowToTask(row, TZ, null, null, NOW_INFO);
      expect(task.overdue).toBe(false);
    });
  });

  it('AC-4: all_day row, past day, status="disabled" → overdue:false (B1 suppression)', function() {
    var row = baseAllDayRow({ scheduled_at: '2026-06-19 14:00:00', date: '2026-06-19', status: 'disabled' });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── AC-5: no resolvable date → overdue:false (never guess a due day) ───────
  it('AC-5: all_day row, no scheduled_at, no date, no end_date (TBD/null) → overdue:false', function() {
    var row = baseAllDayRow({ scheduled_at: null, date: null, end_date: null });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  it('AC-5: all_day row with date="TBD", no scheduled_at → overdue:false', function() {
    var row = baseAllDayRow({ scheduled_at: null, date: 'TBD', end_date: null });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── TZ edge: scheduled_at UTC maps to a DIFFERENT local calendar day ───────
  // 2026-06-21 03:00:00 UTC = 2026-06-20 11:00 PM EDT — the UTC calendar date is
  // "today" (06-21) but the LOCAL day is yesterday (06-20). The dueKey MUST be
  // derived from the local day, not the raw UTC date column, or this task would
  // wrongly read overdue:false (or even crash the boundary the other way).
  it('TZ edge: scheduled_at UTC-today/local-yesterday (2026-06-21T03:00Z = 06-20 11PM EDT) → overdue:true', function() {
    var row = baseAllDayRow({ scheduled_at: '2026-06-21 03:00:00', date: '2026-06-20' });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // Inverse: scheduled_at UTC calendar day is TOMORROW but local day is TODAY
  // (2026-06-22 02:00:00 UTC = 2026-06-21 10:00 PM EDT) → must NOT be overdue
  // (midnight boundary only; local day is still today).
  it('TZ edge: scheduled_at UTC-tomorrow/local-today (2026-06-22T02:00Z = 06-21 10PM EDT) → overdue:false', function() {
    var row = baseAllDayRow({ scheduled_at: '2026-06-22 02:00:00', date: '2026-06-21' });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

});
