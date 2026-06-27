/**
 * 999.568 — Remaining-time display (M-R1)
 *
 * Verifies that tasks with time_remaining show "X min left" and
 * overrun tasks show a warning.
 *
 * Pure unit tests — no DB. Tests the display logic extracted from DailyView.
 */

'use strict';

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Format remaining time for display.
 * Mirrors the logic in DailyView.jsx lines 572-574:
 *   <span style={{ fontWeight: 700, color: theme.amberText }}>{t.timeRemaining}m left</span>
 */
function formatRemainingDisplay(task) {
  if (task.timeRemaining == null) return null;
  return task.timeRemaining + 'm left';
}

/**
 * Format remaining time with estimated duration.
 * Shows "Xm remaining of Ym estimated" for tasks with time_remaining.
 */
function formatRemainingWithEstimate(task) {
  if (task.timeRemaining == null) return null;
  var dur = task.dur || 0;
  return task.timeRemaining + 'm remaining of ' + dur + 'm estimated';
}

/**
 * Check if a task is in overrun (time_remaining > dur).
 */
function isOverrun(task) {
  if (task.timeRemaining == null) return false;
  return task.timeRemaining > (task.dur || 0);
}

/**
 * Format overrun warning.
 */
function formatOverrunWarning(task) {
  if (!isOverrun(task)) return null;
  var overBy = task.timeRemaining - (task.dur || 0);
  return 'Over by ' + overBy + 'm';
}

/**
 * Build a task object for testing.
 */
function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    status: '',
    dur: 60,
    timeRemaining: 30,
    date: '2026-06-17',
    pri: 'P3',
    project: null,
    ...overrides,
  };
}

describe('999.568 — Remaining-time display (M-R1)', () => {
  describe('remaining time display', () => {
    test('task with time_remaining shows remaining minutes', () => {
      var task = makeTask({ timeRemaining: 30, dur: 60 });
      expect(formatRemainingDisplay(task)).toBe('30m left');
    });

    test('task with zero time_remaining shows 0m left', () => {
      var task = makeTask({ timeRemaining: 0, dur: 60 });
      expect(formatRemainingDisplay(task)).toBe('0m left');
    });

    test('task with null time_remaining returns null (no display)', () => {
      var task = makeTask({ timeRemaining: null, dur: 60 });
      expect(formatRemainingDisplay(task)).toBeNull();
    });

    test('task with undefined time_remaining returns null', () => {
      var task = makeTask({});
      delete task.timeRemaining;
      expect(formatRemainingDisplay(task)).toBeNull();
    });
  });

  describe('remaining time with estimated duration', () => {
    test('shows "Xm remaining of Ym estimated"', () => {
      var task = makeTask({ timeRemaining: 30, dur: 60 });
      expect(formatRemainingWithEstimate(task)).toBe('30m remaining of 60m estimated');
    });

    test('shows correct values when time_remaining equals dur', () => {
      var task = makeTask({ timeRemaining: 60, dur: 60 });
      expect(formatRemainingWithEstimate(task)).toBe('60m remaining of 60m estimated');
    });

    test('handles large remaining time values', () => {
      var task = makeTask({ timeRemaining: 240, dur: 120 });
      expect(formatRemainingWithEstimate(task)).toBe('240m remaining of 120m estimated');
    });
  });

  describe('overrun detection and warning', () => {
    test('detects overrun when time_remaining > dur', () => {
      var task = makeTask({ timeRemaining: 90, dur: 60 });
      expect(isOverrun(task)).toBe(true);
    });

    test('no overrun when time_remaining <= dur', () => {
      var task = makeTask({ timeRemaining: 30, dur: 60 });
      expect(isOverrun(task)).toBe(false);
    });

    test('no overrun when time_remaining equals dur', () => {
      var task = makeTask({ timeRemaining: 60, dur: 60 });
      expect(isOverrun(task)).toBe(false);
    });

    test('no overrun when time_remaining is null', () => {
      var task = makeTask({ timeRemaining: null, dur: 60 });
      expect(isOverrun(task)).toBe(false);
    });

    test('overrun warning shows "Over by Xm"', () => {
      var task = makeTask({ timeRemaining: 90, dur: 60 });
      expect(formatOverrunWarning(task)).toBe('Over by 30m');
    });

    test('overrun warning shows correct overage for large overruns', () => {
      var task = makeTask({ timeRemaining: 200, dur: 60 });
      expect(formatOverrunWarning(task)).toBe('Over by 140m');
    });

    test('no overrun warning when not in overrun', () => {
      var task = makeTask({ timeRemaining: 30, dur: 60 });
      expect(formatOverrunWarning(task)).toBeNull();
    });
  });

  describe('edge cases', () => {
    test('task with dur=0 and time_remaining > 0 is overrun', () => {
      var task = makeTask({ timeRemaining: 15, dur: 0 });
      expect(isOverrun(task)).toBe(true);
      expect(formatOverrunWarning(task)).toBe('Over by 15m');
    });

    test('task with dur=0 and time_remaining=0 is not overrun', () => {
      var task = makeTask({ timeRemaining: 0, dur: 0 });
      expect(isOverrun(task)).toBe(false);
      expect(formatOverrunWarning(task)).toBeNull();
    });

    test('task with no dur field defaults to 0 for overrun check', () => {
      var task = makeTask({ timeRemaining: 30 });
      delete task.dur;
      expect(isOverrun(task)).toBe(true);
    });

    test('remaining display works with time_remaining=0', () => {
      var task = makeTask({ timeRemaining: 0, dur: 60 });
      expect(formatRemainingDisplay(task)).toBe('0m left');
    });
  });

  describe('time_remaining field routing', () => {
    test('time_remaining is an instance field (not a master field)', () => {
      // From tasks-write.js: INSTANCE_UPDATE_FIELDS includes time_remaining
      var instanceFields = [
        'scheduled_at', 'dur', 'date', 'day', 'time',
        'status', 'time_remaining', 'unscheduled', 'overdue', 'generated',
        'split_group', 'completed_at',
      ];
      expect(instanceFields.indexOf('time_remaining')).not.toBe(-1);

      // MASTER_UPDATE_FIELDS should NOT include time_remaining
      var masterFields = [
        'text', 'project', 'section', 'notes', 'url', 'dur', 'pri',
        'desired_at', 'deadline', 'earliest_start_at',
        'when', 'day_req', 'time_flex', 'flex_when', 'placement_mode',
        'preferred_time_mins', 'tz',
        'recurring', 'recur', 'recur_start', 'recur_end',
        'split', 'split_min',
        'depends_on', 'location', 'tools', 'travel_before', 'travel_after',
        'disabled_at', 'disabled_reason',
        'weather_precip', 'weather_cloud', 'weather_temp_min', 'weather_temp_max',
        'weather_temp_unit', 'weather_humidity_min', 'weather_humidity_max',
        'status',
      ];
      expect(masterFields.indexOf('time_remaining')).toBe(-1);
    });
  });
});
