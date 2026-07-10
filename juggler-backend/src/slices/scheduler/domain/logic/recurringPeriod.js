/**
 * recurringPeriod.js — recurrence-period boundary classification (R50.0).
 *
 * 999.1198 (JUG-REQUIRE-CYCLES-X11): moved VERBATIM from scheduler/runSchedule.js
 * (which re-exports both functions unchanged) so slices/task/facade can compute
 * a recurring instance's implied deadline WITHOUT lazy-requiring runSchedule —
 * that lazy require papered over the cycle
 *   task facade → runSchedule → SchedulerTaskProvider → task facade.
 * Pure classification + delegation to the ruled SSOT; no DB, no scheduler state.
 *
 * R50.0 — the recurrence-PERIOD boundary is a recurring instance's IMPLIED
 * deadline (recurring instances carry no explicit `deadline`). It is the value the
 * overdue/missed logic acts on:
 *   - Day-locked instance (timesPerCycle ≥ selected days, or no TPC) → end of its
 *     OCCURRENCE DAY: the deadline is the next day (cycle = 1).
 *   - Flexible-TPC instance (timesPerCycle < selected days → it may roam within the
 *     cycle) → end of its CYCLE: occurrence + cycleLen. It is NOT missed until the
 *     whole cycle has passed (it could still be completed on a later cycle day).
 * recurringPeriodEndKey returns the dateKey of the FIRST day past the period
 * (instance is live through periodEnd−1, missed ON periodEnd). Null when not
 * recurring or no occurrence date. (The separate timeFlex placement window is
 * applied by the caller alongside this.)
 */

'use strict';

var _ConstraintSolver = require('./ConstraintSolver');
var recurringCycleDays = _ConstraintSolver.recurringCycleDays;

var expandRecurringShared = require('juggler-shared/scheduler/expandRecurring');
var dateHelpers = require('../../../../scheduler/dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;

// Flexible-TPC classification — the SINGLE source shared by recurringPeriodEndKey
// (deadline) and runSchedule's persist-loop roam guard (999.848). A flexible-TPC
// instance (timesPerCycle < selected days) may roam to ANY allowed day within its
// cycle; every other recurring is day-locked. The `r.days || 'MTWRF'` / `r.monthDays ||
// [1,15]` shape-defaults are NOT data fallbacks — they are byte-identical to
// unifiedScheduleV2's isFlexibleTpc, so a missing field is a malformed recur whose
// default only affects classification (never corrupts data). Unrecognised types
// (incl. `interval`) → selectedDays 1 → never flexible → day-locked.
function isFlexibleTpcRecur(recur) {
  var r = recur;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_e) { return false; } }
  if (!r || !r.timesPerCycle || r.timesPerCycle <= 0) return false;
  var selectedDays;
  if (r.type === 'daily') selectedDays = 7;
  else if (r.type === 'weekly' || r.type === 'biweekly') {
    var days = r.days || 'MTWRF';
    selectedDays = (typeof days === 'object' && !Array.isArray(days)) ? Object.keys(days).length
      : (typeof days === 'string' ? days.length : 0);
  } else if (r.type === 'monthly') { selectedDays = (r.monthDays || [1, 15]).length; }
  else { selectedDays = 1; }
  return r.timesPerCycle < selectedDays;
}

// Rolling interval in days — 999.1185: delegated to the shared SSOT in
// shared/scheduler/expandRecurring.js (was a mirrored local copy; the
// 'mirrors' drift risk is gone). A rolling instance is NOT day-locked
// (dayReq='any'); its window IS the interval, so its period boundary =
// occ + interval.
var rollingIntervalDays = expandRecurringShared.rollingIntervalDays;

// 999.1191: the period-boundary DATE MATH lives in ONE place —
// shared/scheduler/missedHelpers.js computeRecurringDeadlineKey (the ruled SSOT,
// cycle buckets). This function only classifies (rolling / flexible-TPC /
// day-locked → cycleDays) and converts the SSOT's inclusive last-in-period day
// to the exclusive "first day PAST the period" form used throughout runSchedule.
// No recurStart is passed, so the bucket math is anchored at the occurrence
// (k=0) — byte-identical to the previous inline `occ + cycleDays` computation.
var missedHelpers = require('juggler-shared/scheduler/missedHelpers');
function recurringPeriodEndKey(recur, occurrenceDateKey) {
  var r = recur;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_e) { r = null; } }
  var isRolling = !!(r && r.type === 'rolling');
  var isFlexible = !isRolling && isFlexibleTpcRecur(recur);
  var cycleDays = 1; // day-locked default: deadline = end of the occurrence day
  if (isRolling) {
    // Rolling: window = the recurrence interval (R5). Not day-locked.
    cycleDays = rollingIntervalDays(r);
  } else if (isFlexible) { // flexible-TPC → roams within the cycle
    cycleDays = recurringCycleDays(recur) || 1;
  }
  var lastDayKey = missedHelpers.computeRecurringDeadlineKey({
    occurrenceDate: occurrenceDateKey,
    isDayLocked: !isRolling && !isFlexible,
    isRolling: isRolling,
    cycleDays: cycleDays
  });
  if (!lastDayKey) return null;
  var end = parseDate(lastDayKey);
  end.setDate(end.getDate() + 1); // exclusive boundary: first day PAST the period
  return formatDateKey(end);
}

module.exports = {
  isFlexibleTpcRecur: isFlexibleTpcRecur,
  recurringPeriodEndKey: recurringPeriodEndKey
};
