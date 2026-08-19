/**
 * 999.15816 — Deadline DATETIME: time-of-day on the deadline column.
 *
 * Ruling (David 2026-08-18): widen task_masters.deadline from DATE to DATETIME.
 * A time component must survive a round trip through taskMappers.js, and
 * computeOverdueForRow gains an intra-day threshold on the deadline branch
 * when a non-midnight time is present.
 *
 * Layer: unit — pure function, no DB, no network, no wall-clock.
 * DETERMINISM: nowInfo injected; no Date.now(), no Math.random(), no I/O.
 */

'use strict';

process.env.NODE_ENV = 'test';

var mappers = require('../../../src/slices/task/domain/mappers/taskMappers');
var rowToTask = mappers.rowToTask;
var taskToRow = mappers.taskToRow;
var computeOverdueForRow = mappers.computeOverdueForRow;

var TZ = 'America/New_York';

// ── Row factory ──────────────────────────────────────────────────────────────

function makeBaseRow(overrides) {
  return Object.assign({
    id: 'test-dl-datetime-001', master_id: 'test-dl-datetime-001',
    task_type: 'task', text: 'Test', status: '',
    scheduled_at: null, desired_at: null, tz: null, dur: 30, time_remaining: null,
    pri: 'P3', project: null, section: null, notes: null, url: null,
    deadline: null, implied_deadline: null, earliest_start: null,
    start_after_at: null, location: '[]', tools: '[]',
    when: null, day_req: null, recurring: 0, time_flex: null,
    split: null, split_min: null, split_total: null, split_ordinal: null, split_group: null,
    recur: null, source_id: null, generated: 0,
    gcal_event_id: null, msft_event_id: null, apple_event_id: null,
    apple_calendar_name: null, cal_sync_origin: null, cal_event_url: null,
    depends_on: '[]', date_pinned: 0, marker: 0, flex_when: 0, prev_when: null,
    travel_before: null, travel_after: null, preferred_time_mins: null,
    unscheduled: null, overdue: null, slack_mins: null,
    recur_start: null, recur_end: null, placement_mode: null,
    disabled_at: null, disabled_reason: null, occurrence_ordinal: null,
    completed_at: null, end_date: null, next_start: null,
    created_at: '2026-08-19 00:00:00', updated_at: '2026-08-19 00:00:00',
    date: null
  }, overrides);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('999.15816 — deadline DATETIME round trip', function() {

  describe('rowToTask — deadline with time', function() {

    it('preserves a DATETIME deadline with a non-midnight time', function() {
      // A DATETIME value from MySQL: '2026-08-25 14:30:00'
      var row = makeBaseRow({ deadline: '2026-08-25 14:30:00' });
      var task = rowToTask(row, TZ);
      // The time component must survive — not just '2026-08-25'
      expect(task.deadline).toMatch(/2026-08-25/);
      expect(task.deadline).toContain('14:30');
    });

    it('preserves a DATETIME deadline at midnight as date-only', function() {
      // Midnight DATETIME (coerced from old DATE values): '2026-08-25 00:00:00'
      var row = makeBaseRow({ deadline: '2026-08-25 00:00:00' });
      var task = rowToTask(row, TZ);
      // Midnight should be treated as date-only (no time component)
      expect(task.deadline).toBe('2026-08-25');
    });

    it('preserves a plain DATE deadline as date-only (backward compat)', function() {
      var row = makeBaseRow({ deadline: '2026-08-25' });
      var task = rowToTask(row, TZ);
      expect(task.deadline).toBe('2026-08-25');
    });

    it('returns null for null deadline', function() {
      var row = makeBaseRow({ deadline: null });
      var task = rowToTask(row, TZ);
      expect(task.deadline).toBeNull();
    });
  });

  describe('taskToRow — deadline with time', function() {

    it('writes a deadline with time as a DATETIME string', function() {
      var task = { deadline: '2026-08-25T14:30:00' };
      var row = taskToRow(task, 'user-1', TZ);
      // Must preserve the time component, not strip to date-only
      expect(String(row.deadline)).toContain('14:30');
    });

    it('writes a date-only deadline as date-only (backward compat)', function() {
      var task = { deadline: '2026-08-25' };
      var row = taskToRow(task, 'user-1', TZ);
      expect(row.deadline).toBe('2026-08-25');
    });

    it('writes null deadline as null', function() {
      var task = { deadline: null };
      var row = taskToRow(task, 'user-1', TZ);
      expect(row.deadline).toBeNull();
    });
  });
});

describe('999.15816 — computeOverdueForRow intra-day deadline', function() {

  // nowInfo: { todayKey: 'YYYY-MM-DD', nowMins: number }
  // Aug 25 2026 is a Tuesday (EDT, UTC-4)

  it('is NOT overdue before the deadline time on the deadline day', function() {
    var row = makeBaseRow({
      deadline: '2026-08-25 14:30:00',
      status: '',
      placement_mode: null
    });
    // Now is 13:00 (before 14:30) on the deadline day
    var nowInfo = { todayKey: '2026-08-25', nowMins: 13 * 60 };
    expect(computeOverdueForRow(row, TZ, nowInfo)).toBe(false);
  });

  it('IS overdue after the deadline time on the deadline day', function() {
    var row = makeBaseRow({
      deadline: '2026-08-25 14:30:00',
      status: '',
      placement_mode: null
    });
    // Now is 15:00 (after 14:30) on the deadline day
    var nowInfo = { todayKey: '2026-08-25', nowMins: 15 * 60 };
    expect(computeOverdueForRow(row, TZ, nowInfo)).toBe(true);
  });

  it('IS overdue exactly AT the deadline time', function() {
    var row = makeBaseRow({
      deadline: '2026-08-25 14:30:00',
      status: '',
      placement_mode: null
    });
    // Now is exactly 14:30 on the deadline day
    var nowInfo = { todayKey: '2026-08-25', nowMins: 14 * 60 + 30 };
    expect(computeOverdueForRow(row, TZ, nowInfo)).toBe(true);
  });

  it('date-only deadline is NOT overdue during the day (end-of-day semantics)', function() {
    var row = makeBaseRow({
      deadline: '2026-08-25',  // date-only, no time
      status: '',
      placement_mode: null
    });
    // Now is 23:00 on the deadline day — still not overdue (end-of-day)
    var nowInfo = { todayKey: '2026-08-25', nowMins: 23 * 60 };
    expect(computeOverdueForRow(row, TZ, nowInfo)).toBe(false);
  });

  it('date-only deadline IS overdue the day after', function() {
    var row = makeBaseRow({
      deadline: '2026-08-25',
      status: '',
      placement_mode: null
    });
    var nowInfo = { todayKey: '2026-08-26', nowMins: 9 * 60 };
    expect(computeOverdueForRow(row, TZ, nowInfo)).toBe(true);
  });

  it('deadline in the past is overdue regardless of time', function() {
    var row = makeBaseRow({
      deadline: '2026-08-20 08:00:00',
      status: '',
      placement_mode: null
    });
    var nowInfo = { todayKey: '2026-08-25', nowMins: 9 * 60 };
    expect(computeOverdueForRow(row, TZ, nowInfo)).toBe(true);
  });

  it('terminal status is never overdue even with a timed deadline', function() {
    var row = makeBaseRow({
      deadline: '2026-08-25 14:30:00',
      status: 'done',
      placement_mode: null
    });
    var nowInfo = { todayKey: '2026-08-25', nowMins: 15 * 60 };
    expect(computeOverdueForRow(row, TZ, nowInfo)).toBe(false);
  });
});
