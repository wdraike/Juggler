/**
 * Unit tests for computeIsPastDue — exported from runSchedule.js (999.671).
 *
 * computeIsPastDue is the single gate that prevents floating tasks (no deadline,
 * overdue=0) from being flagged as past-due in the synthesis loop. Both
 * production call sites (:1825 and :2202) call this helper, so ONE unit test
 * of the helper pins BOTH sites.
 *
 * Covers: BUG-671
 * Layer: unit (pure function — no DB, no server)
 */

'use strict';

var { computeIsPastDue } = require('../src/scheduler/runSchedule');

// Fixed timeInfo: today is 2026-06-16, nowMins=600 (10:00 AM)
var TIME_INFO = { todayKey: '2026-06-16', nowMins: 600 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function task(overrides) {
  return Object.assign({ deadline: null, overdue: 0, date: null, time: null }, overrides);
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------
describe('computeIsPastDue — BUG-671 floating-exclusion gate', function() {

  // computeIsPastDue returns the raw JS && chain result, which is 0/null/false
  // (all falsy) for the false cases and true for the true cases.  Production code
  // uses it as a truthy/falsy boolean, so we mirror that with toBeFalsy/toBeTruthy.

  // 1. The primary fix: floating + past date → falsy (was the bug — returned true)
  it('floating (deadline:null, overdue:0) + past date → falsy', function() {
    var t = task({ date: '2026-06-10', time: '09:00 AM' });
    var scheduledMins = 9 * 60; // 540, before nowMins=600, past date
    expect(computeIsPastDue(t, scheduledMins, TIME_INFO)).toBeFalsy();
  });

  // 2. Floating + today before now → falsy (no firm commitment even if time passed)
  it('floating (deadline:null, overdue:0) + today before nowMins → falsy', function() {
    var t = task({ date: '2026-06-16', time: '09:00 AM' });
    var scheduledMins = 540; // 9 AM < nowMins=600
    expect(computeIsPastDue(t, scheduledMins, TIME_INFO)).toBeFalsy();
  });

  // 3. Deadline-bearing + past date → truthy (deadline task IS past-due)
  it('deadline-bearing (deadline set, overdue:0) + past date → truthy', function() {
    var t = task({ deadline: '2026-06-10', overdue: 0, date: '2026-06-10', time: '09:00 AM' });
    var scheduledMins = 540;
    expect(computeIsPastDue(t, scheduledMins, TIME_INFO)).toBeTruthy();
  });

  // 4. Already-overdue (DB flag overdue:1) + past date → truthy (respects DB flag)
  it('already-overdue (overdue:1) + past date → truthy', function() {
    var t = task({ deadline: null, overdue: 1, date: '2026-06-10', time: '09:00 AM' });
    var scheduledMins = 540;
    expect(computeIsPastDue(t, scheduledMins, TIME_INFO)).toBeTruthy();
  });

  // 5. Future date (even with deadline) → falsy
  it('deadline-bearing + future date → falsy', function() {
    var t = task({ deadline: '2026-06-20', overdue: 0, date: '2026-06-20', time: '09:00 AM' });
    var scheduledMins = 540;
    expect(computeIsPastDue(t, scheduledMins, TIME_INFO)).toBeFalsy();
  });

  // 6. date null → falsy (guard)
  it('date null → falsy', function() {
    var t = task({ deadline: '2026-06-10', overdue: 0, date: null, time: '09:00 AM' });
    var scheduledMins = 540;
    expect(computeIsPastDue(t, scheduledMins, TIME_INFO)).toBeFalsy();
  });

  // 7. date 'TBD' → falsy (guard)
  it("date 'TBD' → falsy", function() {
    var t = task({ deadline: '2026-06-10', overdue: 0, date: 'TBD', time: '09:00 AM' });
    var scheduledMins = 540;
    expect(computeIsPastDue(t, scheduledMins, TIME_INFO)).toBeFalsy();
  });

  // 8. scheduledMins null → falsy (guard — task has no time, can't be past-due)
  it('scheduledMins null → falsy', function() {
    var t = task({ deadline: '2026-06-10', overdue: 0, date: '2026-06-10' });
    expect(computeIsPastDue(t, null, TIME_INFO)).toBeFalsy();
  });

});
