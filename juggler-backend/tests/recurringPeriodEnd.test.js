/**
 * R50.0 — recurringPeriodEndKey: a recurring instance's IMPLIED deadline is its
 * recurrence-PERIOD boundary. Day-locked → end of occurrence day (occurrence + 1);
 * flexible-TPC (timesPerCycle < selected days, so it may roam within the cycle) →
 * end of cycle (occurrence + cycleLen). Exported from runSchedule.js.
 *
 * Pure unit — no DB, no clock.
 */
'use strict';

var { recurringPeriodEndKey } = require('../src/scheduler/runSchedule');

var OCC = '2026-06-15'; // Monday

describe('recurringPeriodEndKey — R50.0 implied recurrence deadline', function() {
  it('daily, no timesPerCycle → day-locked → end of occurrence day (+1)', function() {
    expect(recurringPeriodEndKey({ type: 'daily', days: 'MTWRFSU' }, OCC)).toBe('2026-06-16');
  });

  it('weekly, no timesPerCycle → day-locked → +1', function() {
    expect(recurringPeriodEndKey({ type: 'weekly', days: 'MWF' }, OCC)).toBe('2026-06-16');
  });

  it('weekly, timesPerCycle=3 of 7 selected days → flexible → end of cycle (+7)', function() {
    // 3 picks < 7 eligible days → roams within the week → deadline = end of week.
    expect(recurringPeriodEndKey({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 }, OCC)).toBe('2026-06-22');
  });

  it('weekly, timesPerCycle=7 of 7 selected → NOT flexible (every day picked) → +1', function() {
    expect(recurringPeriodEndKey({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 7 }, OCC)).toBe('2026-06-16');
  });

  it('biweekly, timesPerCycle=1 of 5 days → flexible → end of 14-day cycle', function() {
    expect(recurringPeriodEndKey({ type: 'biweekly', days: 'MTWRF', timesPerCycle: 1 }, OCC)).toBe('2026-06-29');
  });

  it('monthly, timesPerCycle=1 of 2 monthDays → flexible → end of 30-day cycle', function() {
    expect(recurringPeriodEndKey({ type: 'monthly', monthDays: [1, 15], timesPerCycle: 1 }, OCC)).toBe('2026-07-15');
  });

  it('recur as JSON string → parsed', function() {
    expect(recurringPeriodEndKey(JSON.stringify({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 }), OCC)).toBe('2026-06-22');
  });

  it('null recur → day-locked default (+1)', function() {
    expect(recurringPeriodEndKey(null, OCC)).toBe('2026-06-16');
  });

  it('no occurrence date → null', function() {
    expect(recurringPeriodEndKey({ type: 'daily' }, null)).toBeNull();
  });
});
