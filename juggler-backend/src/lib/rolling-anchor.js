/**
 * Shared helpers for the rolling-cadence recurring task anchor update logic.
 * Used by task.controller.js, cal-history-cron.js, and mcp/tools/tasks.js.
 */

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
  } catch (e) {
    return false;
  }
}

/**
 * Compute the new rolling_anchor for a terminal status event.
 *
 * Rules:
 *   done   → instanceDate (anchor from when task was scheduled/done)
 *   skip   → instanceDate (full reanchor from skip date)
 *   missed → instanceDate + 1 day (soft nudge)
 *   cancel → null (no anchor change)
 *
 * Guard: if instanceDate < currentAnchor, return null (stale event, skip).
 *
 * @param {string} status - 'done' | 'skip' | 'missed' | 'cancel'
 * @param {string} instanceDate - ISO date string 'YYYY-MM-DD' of the instance
 * @param {string|null} currentAnchor - current rolling_anchor from task_masters
 * @returns {string|null} new anchor ISO date, or null if no update needed
 */
function computeRollingAnchor(status, instanceDate, currentAnchor) {
  if (!instanceDate) return null;
  if (status === 'cancel') return null;
  if (!['done', 'skip', 'missed'].includes(status)) return null;

  // Guard: stale event
  if (currentAnchor && instanceDate < currentAnchor) return null;

  if (status === 'done' || status === 'skip') {
    return instanceDate;
  }

  // missed: +1 day
  var d = new Date(instanceDate + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

module.exports = { isRollingMaster, computeRollingAnchor };
