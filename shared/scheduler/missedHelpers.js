// Shared helpers for computing missed status

var dateHelpers = require('./dateHelpers');

/**
 * Period-boundary deadline for a recurring occurrence.
 * (juggler recurring-overdue-lifecycle, 2026-06-19 — W. David Raike)
 *
 * A recurring instance's hard deadline is the END of its recurrence PERIOD, not
 * `scheduled_at + timeFlex`. This is the single source of truth both the
 * scheduler (runSchedule Phase 9) and the cal-history cron must route through so
 * a flexible/TPC instance is not marked `missed` before its cycle actually ends.
 *
 *   - Day-locked instance (rigid / non-TPC / fixed) → end of its occurrence DAY.
 *   - Flexible/TPC instance (roams within the cycle) → end of the LAST day of
 *     the cycle that contains the occurrence (cycle anchored to recurStart +
 *     k*cycleDays, matching shared/scheduler/expandRecurring cycle bucketing).
 *
 * Pure + dependency-light: the CALLER classifies (isDayLocked) and supplies
 * cycleDays (recurringCycleDays(recur)); this function only does the date math,
 * so it is identically usable from the backend scheduler and the cron.
 *
 * @param {Object} params
 * @param {string} params.occurrenceDate  occurrence local date, 'YYYY-MM-DD'
 * @param {string} [params.recurStart]    series anchor local date, 'YYYY-MM-DD'
 *                                        (the recur_start column); falls back to
 *                                        occurrenceDate when absent.
 * @param {boolean} params.isDayLocked    true → deadline is the occurrence day.
 * @param {number} [params.cycleDays]     recurrence period in days (7/14/30/…);
 *                                        <=0 or absent → treated as day-locked.
 * @param {string} timezone               IANA tz for the day boundary.
 * @returns {Date|null} UTC instant of the period deadline (23:59 local of the
 *          last in-period day), or null when occurrenceDate is missing/invalid.
 */
function computeRecurringDeadline(params, timezone) {
  var p = params || {};
  var occ = p.occurrenceDate;
  if (!occ || typeof occ !== 'string') return null;

  var deadlineDateKey = occ;

  var cycleDays = Number(p.cycleDays) || 0;
  // Flexible/TPC: extend the deadline to the end of the cycle the occurrence
  // falls in. Day-locked (or no natural cycle) keeps the occurrence day.
  if (!p.isDayLocked && cycleDays > 1) {
    var anchorKey = (p.recurStart && typeof p.recurStart === 'string') ? p.recurStart : occ;
    var anchor = dateHelpers.parseDate(anchorKey);
    var occDate = dateHelpers.parseDate(occ);
    if (anchor && occDate) {
      var msPerDay = 24 * 60 * 60 * 1000;
      var daysFromAnchor = Math.floor((occDate.getTime() - anchor.getTime()) / msPerDay);
      // k = which cycle bucket the occurrence is in (floor toward the anchor,
      // correct for occurrences on/after the anchor — the only valid case).
      var k = Math.floor(daysFromAnchor / cycleDays);
      if (k < 0) k = 0; // occurrence before anchor (shouldn't happen) → first cycle
      var lastDay = new Date(anchor.getTime());
      lastDay.setDate(lastDay.getDate() + k * cycleDays + (cycleDays - 1));
      deadlineDateKey = dateHelpers.formatDateKey(lastDay);
    }
  }

  // End-of-day of the deadline date, in the user's timezone, as a UTC instant.
  return dateHelpers.localToUtc(deadlineDateKey, '11:59 PM', timezone);
}

// isTaskMissed / shouldAutoMarkMissed DELETED — sched-drop-overdue-column / M-5
// (999.1085), executing the standing D1 ruling (brain 101228/97166/101304:
// "delete the legacy 2h/24h isTaskMissed/shouldAutoMarkMissed after verifying
// no live caller"). Their only live caller, cal-history-cron.js's
// markMissedTasks, is itself retired in this leg (its sole purpose was writing
// the now-dropped task_instances.overdue column). Verified via repo-wide grep:
// no other live caller remained (only a dead root-level `test-implementation.js`
// scratch script — removed alongside — and a fully describe.skip'd test file
// that referenced the names in a comment only, not a live import).

function getMissedResolutionWindow(task) {
  if (!task.scheduled_at) return null;
  
  const scheduledTime = new Date(task.scheduled_at);
  return new Date(scheduledTime.getTime() + (24 * 60 * 60 * 1000)); // 24 hours after scheduled time
}

module.exports = {
  computeRecurringDeadline,
  getMissedResolutionWindow
};
