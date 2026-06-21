'use strict';
/**
 * rowToTaskOverdue — unit tests for the W4 computed-on-read overdue predicate
 * in rowToTask (taskMappers.js:315, R50.6).
 *
 * Strategy: inject a fixed nowInfo param so the predicate is deterministic.
 * "Today" is 2026-06-21, nowMins=600 (10:00 AM).
 *
 * Covers all wrong-for-naive cases (SPEC.md binding contract):
 *   1. Past materialized implied_deadline + row.overdue=0 → overdue:true
 *   2. Past hard deadline + row.overdue=0           → overdue:true
 *   3. Stored flag row.overdue=1, no other due      → overdue:true (short-circuit)
 *   4. Floating / no deadline / no implied_deadline → overdue:false
 *   5. Terminal status (done/skip/cancel/missed/paused/disabled) → overdue:false
 *   6. FIXED placement + scheduled_at in the past   → overdue:true
 *   7. Recurring with no implied_deadline           → overdue:false (no due)
 *   8. Future deadline                              → overdue:false
 *   9. Same-day ANYTIME (no hard commitment)        → overdue:false
 *  10. Split chunk: implied_deadline per-occurrence (occDate+1 for day-locked)
 */

// Mock DB — taskMappers via task.controller route
jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  return mock;
});

const { rowToTask } = require('../src/controllers/task.controller');

const TZ = 'America/New_York';
// Fixed now: 2026-06-21, 10:00 AM (600 mins)
const NOW_INFO = { todayKey: '2026-06-21', nowMins: 600 };

// Minimal base row — no hard commitment, active status
function baseRow(overrides) {
  return Object.assign({
    id: 'test-id',
    text: 'Test',
    task_type: 'task',
    scheduled_at: '2026-06-21 14:00:00', // UTC (10AM EDT)
    date: null,
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
    rolling_anchor: null
  }, overrides);
}

describe('rowToTask — W4 computed-on-read overdue (R50.6)', function() {

  // ─── 1. Past materialized implied_deadline + row.overdue=0 → overdue:true ───
  it('past implied_deadline + row.overdue=0 → overdue:true', function() {
    var row = baseRow({ implied_deadline: '2026-06-20', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ─── 2. Past hard deadline + row.overdue=0 → overdue:true ──────────────────
  it('past hard deadline + row.overdue=0 → overdue:true', function() {
    var row = baseRow({ deadline: '2026-06-19', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ─── 3. Stored flag row.overdue=1 (no other due) → overdue:true ─────────────
  it('stored row.overdue=1 → overdue:true (short-circuit)', function() {
    var row = baseRow({ overdue: 1, deadline: null, implied_deadline: null });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ─── 4. Floating / no hard commitment → overdue:false ───────────────────────
  it('floating (no deadline, no implied_deadline, anytime) → overdue:false', function() {
    var row = baseRow({ deadline: null, implied_deadline: null, placement_mode: 'anytime', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  it('floating with null placement_mode → overdue:false', function() {
    var row = baseRow({ deadline: null, implied_deadline: null, placement_mode: null, overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── 5. Terminal status → overdue:false ─────────────────────────────────────
  // TaskStatus.TERMINAL = ['done', 'cancel', 'skip', 'pause', 'missed']
  var terminalStatuses = ['done', 'skip', 'cancel', 'missed', 'pause'];
  terminalStatuses.forEach(function(st) {
    it('terminal status "' + st + '" with past implied_deadline → overdue:false', function() {
      var row = baseRow({ status: st, implied_deadline: '2026-06-19', overdue: 0 });
      var task = rowToTask(row, TZ, null, null, NOW_INFO);
      expect(task.overdue).toBe(false);
    });
  });

  // ─── 5b. Disabled status → overdue:false (B1 fix) ───────────────────────────
  // 'disabled' is NOT in TERMINAL_STATUSES (intentional — it behaves differently
  // in other scheduler paths) but must still suppress the computed-overdue path.
  it('disabled status with past deadline + row.overdue=0 → overdue:false (B1)', function() {
    var row = baseRow({ status: 'disabled', deadline: '2026-06-19', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  it('disabled status with past implied_deadline + row.overdue=0 → overdue:false (B1)', function() {
    var row = baseRow({ status: 'disabled', implied_deadline: '2026-06-19', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── 6. FIXED placement + past scheduled_at → overdue:true ──────────────────
  it('FIXED placement + scheduled_at in the past → overdue:true', function() {
    // scheduled_at: 2026-06-20 14:00 UTC = 2026-06-20 10:00 AM EDT (past)
    var row = baseRow({
      placement_mode: 'fixed',
      scheduled_at: '2026-06-20 14:00:00',
      deadline: null,
      implied_deadline: null,
      overdue: 0
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ─── 6b. FIXED + future scheduled_at → overdue:false ────────────────────────
  it('FIXED placement + scheduled_at in the future → overdue:false', function() {
    // scheduled_at: 2026-06-22 14:00 UTC = tomorrow
    var row = baseRow({
      placement_mode: 'fixed',
      scheduled_at: '2026-06-22 14:00:00',
      deadline: null,
      implied_deadline: null,
      overdue: 0
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── 6c. FIXED + scheduled_at = TODAY before NOW_INFO.nowMins → overdue:true ──
  // Pins the same-day-time-passed branch (taskMappers.js:388):
  //   dueKey === todayKey && scheduledMins !== null && scheduledMins < nowMins → true
  //
  // NOW_INFO: todayKey='2026-06-21', nowMins=600 (10:00 AM EDT).
  // 08:00 EDT = 12:00 UTC → scheduled_at='2026-06-21 12:00:00'.
  // dueKey = '2026-06-21' (= todayKey). scheduledMins = 8*60 = 480 < 600 → overdue:TRUE.
  // This is the marquee R50.6 case: a FIXED event earlier TODAY whose time has passed
  // shows overdue without a scheduler run.
  it('FIXED placement + same-day scheduled_at BEFORE now (08:00 < 10:00 EDT) → overdue:true (same-day branch)', function() {
    var row = baseRow({
      placement_mode: 'fixed',
      scheduled_at: '2026-06-21 12:00:00', // 08:00 AM EDT (UTC-4), before nowMins=600
      deadline: null,
      implied_deadline: null,
      overdue: 0
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ─── 6d. FIXED + scheduled_at = TODAY after NOW_INFO.nowMins → overdue:false ──
  // Proves the same-day branch is NOT firing when time has NOT yet passed:
  //   dueKey === todayKey && scheduledMins >= nowMins → falls through to return false.
  //
  // 14:00 EDT = 18:00 UTC → scheduled_at='2026-06-21 18:00:00'.
  // dueKey = '2026-06-21' (= todayKey). scheduledMins = 14*60 = 840 >= 600 → overdue:FALSE.
  it('FIXED placement + same-day scheduled_at AFTER now (14:00 > 10:00 EDT) → overdue:false (same-day branch not firing)', function() {
    var row = baseRow({
      placement_mode: 'fixed',
      scheduled_at: '2026-06-21 18:00:00', // 14:00 PM EDT (UTC-4), after nowMins=600
      deadline: null,
      implied_deadline: null,
      overdue: 0
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── 7. Recurring with no implied_deadline → overdue:false ──────────────────
  it('recurring_instance with no implied_deadline and no deadline → overdue:false', function() {
    var row = baseRow({
      task_type: 'recurring_instance',
      recurring: 1,
      source_id: 'master-1',
      implied_deadline: null,
      deadline: null,
      overdue: 0
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── 8. Future deadline → overdue:false ─────────────────────────────────────
  it('future deadline + row.overdue=0 → overdue:false', function() {
    var row = baseRow({ deadline: '2026-06-30', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── 9. Same-day ANYTIME, no hard commitment → overdue:false ────────────────
  it('same-day ANYTIME (no deadline, no implied_deadline) → overdue:false', function() {
    var row = baseRow({
      placement_mode: 'anytime',
      deadline: null,
      implied_deadline: null,
      overdue: 0
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── 10. Split chunk: per-occurrence implied_deadline ───────────────────────
  it('split chunk with past per-occurrence implied_deadline → overdue:true', function() {
    var row = baseRow({
      task_type: 'recurring_instance',
      implied_deadline: '2026-06-20', // occDate+1 for day-locked
      deadline: null,
      overdue: 0,
      split_ordinal: 1,
      split_total: 2,
      split_group: 'grp-abc'
    });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(true);
  });

  // ─── 11. Future implied_deadline → overdue:false ────────────────────────────
  it('future implied_deadline + row.overdue=0 → overdue:false', function() {
    var row = baseRow({ implied_deadline: '2026-06-30', overdue: 0 });
    var task = rowToTask(row, TZ, null, null, NOW_INFO);
    expect(task.overdue).toBe(false);
  });

  // ─── 12. No nowInfo supplied: default must not throw ────────────────────────
  it('rowToTask without nowInfo param does not throw and returns a boolean overdue', function() {
    var row = baseRow({ deadline: '2026-01-01', overdue: 0 });
    var task;
    expect(function() { task = rowToTask(row, TZ); }).not.toThrow();
    expect(typeof task.overdue).toBe('boolean');
  });

});
