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
/**
 * Date-key half of computeRecurringDeadline — the single implementation of the
 * period-boundary date math (999.1191). Returns the LAST in-period local day
 * ('YYYY-MM-DD'), inclusive, or null when occurrenceDate is missing/invalid.
 *
 * This is the SSOT the scheduler's `recurringPeriodEndKey` (runSchedule.js)
 * also routes through — it converts the inclusive last day to its exclusive
 * "first day PAST the period" form. Do not fork this math again.
 *
 * Extra params over computeRecurringDeadline:
 * @param {boolean} [params.isRolling]  rolling recurrence — the window IS the
 *        interval, anchored at the OCCURRENCE (the rolling anchor advances on
 *        each terminal event, so recurStart cycle-bucketing does not apply):
 *        last in-period day = occurrence + cycleDays - 1.
 *        `occurrenceDate` may also be a Date here (scheduler call sites).
 */
function computeRecurringDeadlineKey(params) {
  var p = params || {};
  if (!p.occurrenceDate) return null;
  var occDate = dateHelpers.parseDate(p.occurrenceDate);
  if (!occDate) return null;

  var cycleDays = Number(p.cycleDays) || 0;

  // Rolling: occurrence-anchored interval window (see jsdoc above).
  if (p.isRolling && cycleDays >= 1) {
    var lastRoll = new Date(occDate.getTime());
    lastRoll.setDate(lastRoll.getDate() + (cycleDays - 1));
    return dateHelpers.formatDateKey(lastRoll);
  }

  // Flexible/TPC: extend the deadline to the end of the cycle the occurrence
  // falls in. Day-locked (or no natural cycle) keeps the occurrence day.
  if (!p.isDayLocked && cycleDays > 1) {
    var anchorKey = (p.recurStart && typeof p.recurStart === 'string') ? p.recurStart : p.occurrenceDate;
    var anchor = dateHelpers.parseDate(anchorKey);
    if (anchor) {
      var msPerDay = 24 * 60 * 60 * 1000;
      var daysFromAnchor = Math.floor((occDate.getTime() - anchor.getTime()) / msPerDay);
      // k = which cycle bucket the occurrence is in (floor toward the anchor,
      // correct for occurrences on/after the anchor — the only valid case).
      var k = Math.floor(daysFromAnchor / cycleDays);
      if (k < 0) k = 0; // occurrence before anchor (shouldn't happen) → first cycle
      var lastDay = new Date(anchor.getTime());
      lastDay.setDate(lastDay.getDate() + k * cycleDays + (cycleDays - 1));
      return dateHelpers.formatDateKey(lastDay);
    }
    // recurStart supplied but unparseable → keep the occurrence day (unchanged
    // from the original inline math: bucket only when the anchor parses).
  }

  return dateHelpers.formatDateKey(occDate);
}

function computeRecurringDeadline(params, timezone) {
  var p = params || {};
  var occ = p.occurrenceDate;
  if (!occ || typeof occ !== 'string') return null;

  var deadlineDateKey = computeRecurringDeadlineKey(p);
  if (!deadlineDateKey) return null;

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
//
// getMissedResolutionWindow DELETED — 999.1191. Confirmed dead: only referenced
// by the fully describe.skip'd tests/shared/missedHelpers.test.js (removed
// alongside) and docs. Verified via repo-wide grep 2026-07-09.

module.exports = {
  computeRecurringDeadline,
  computeRecurringDeadlineKey
};
