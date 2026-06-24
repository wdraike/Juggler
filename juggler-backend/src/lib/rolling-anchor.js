/**
 * Shared helpers for the rolling-cadence recurring task anchor update logic.
 * Used by task.controller.js, cal-history-cron.js, and mcp/tools/tasks.js.
 */

var { isTerminalStatus } = require('./task-status');

/**
 * Returns true if the given task_masters row uses recur.type = 'rolling'.
 * @param {Object} masterRow - row from task_masters (recur is JSON string or object)
 */
function isRollingMaster(masterRow) {
  if (!masterRow || !masterRow.recur) return false;
  try {
    var recur = typeof masterRow.recur === 'string'
      ? JSON.parse(masterRow.recur)
      : masterRow.recur;
    return recur && recur.type === 'rolling';
  } catch (_e) {
    return false;
  }
}

/**
 * Compute the new rolling_anchor for a terminal status event.
 *
 * Rules:
 *   done   → completionDate (the ACTUAL day it was marked done, in the user's tz) so a
 *            LATE completion pushes the next occurrence out from when it was really done.
 *            Falls back to instanceDate when completionDate is not supplied. (David
 *            2026-06-24 "Option B": anchor to actual completion, not the schedule.)
 *   skip   → instanceDate (skip is NOT a completion — keep the scheduled-date reanchor)
 *   missed → instanceDate + 1 day (soft nudge)
 *   cancel → null (no anchor change)
 *
 * Guard: never move the anchor backwards — if the chosen date < currentAnchor, return
 * null (stale/duplicate event).
 *
 * @param {string} status - 'done' | 'skip' | 'missed' | 'cancel'
 * @param {string} instanceDate - ISO date 'YYYY-MM-DD' of the instance (scheduled day)
 * @param {string|null} currentAnchor - current rolling_anchor from task_masters
 * @param {string} [completionDate] - ISO date 'YYYY-MM-DD' the task was actually marked
 *        done (today in the user's tz). Used for `done`; ignored for skip/missed.
 * @returns {string|null} new anchor ISO date, or null if no update needed
 */
function computeRollingAnchor(status, instanceDate, currentAnchor, completionDate) {
  if (!instanceDate) return null;
  if (status === 'cancel') return null;
  if (!isTerminalStatus(status)) return null;

  var candidate;
  if (status === 'done') {
    candidate = completionDate || instanceDate;
  } else if (status === 'skip') {
    candidate = instanceDate;
  } else {
    // missed: +1 day from the scheduled day
    var d = new Date(instanceDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    candidate = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  // Guard: never move the anchor backwards (stale/duplicate event).
  if (currentAnchor && candidate < currentAnchor) return null;
  return candidate;
}

module.exports = { isRollingMaster, computeRollingAnchor };
