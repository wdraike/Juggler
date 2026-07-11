/**
 * Shared helpers for the rolling-cadence recurring task anchor update logic.
 * Used by task.controller.js, cal-history-cron.js, and mcp/tools/tasks.js.
 *
 * The anchor is stored in task_masters.next_start (the single unified anchor
 * column). The legacy rolling_anchor column has been dropped.
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
 * Compute the new anchor (stored in task_masters.next_start) for a terminal
 * status event on a rolling master.
 *
 * Rules:
 *   done   → completionDate (the ACTUAL day it was marked done, in the user's tz) so a
 *            LATE completion pushes the next occurrence out from when it was really done.
 *            Falls back to instanceDate when completionDate is not supplied. (David
 *            2026-06-24 "Option B": anchor to actual completion, not the schedule.)
 *   skip   → instanceDate (skip is NOT a completion — keep the scheduled-date reanchor)
 *   cancel → null (no anchor change)
 *
 * Guard: never move the anchor backwards — if the chosen date < currentAnchor, return
 * null (stale/duplicate event).
 *
 * @param {string} status - 'done' | 'skip' | 'cancel'
 * @param {string} instanceDate - ISO date 'YYYY-MM-DD' of the instance (scheduled day)
 * @param {string|null} currentAnchor - current anchor (task_masters.next_start)
 * @param {string} [completionDate] - ISO date 'YYYY-MM-DD' the task was actually marked
 *        done (today in the user's tz). Used for `done`; ignored for skip/cancel.
 * @returns {string|null} new anchor ISO date, or null if no update needed
 */
function computeRollingAnchor(status, instanceDate, currentAnchor, completionDate) {
  if (!instanceDate) return null;
  if (status === 'cancel') return null;
  if (!isTerminalStatus(status)) return null;

  var candidate;
  if (status === 'done') {
    candidate = completionDate || instanceDate;
  } else {
    // skip: anchor to the scheduled day
    candidate = instanceDate;
  }

  // Guard: never move the anchor backwards (stale/duplicate event).
  if (currentAnchor && candidate < currentAnchor) return null;
  return candidate;
}

/**
 * Statuses whose terminal event projects a recurrence anchor forward
 * (999.1098 — single source for every anchor-projection call site: the HTTP
 * status path (UpdateTaskStatus), both batch paths (facade lockedBatchUpdate /
 * batchUpdateTxn via applyRecurrenceAnchors), and MCP (routes through the
 * facade)).
 *
 * Ruling 2026-07-06 (resolves 999.844): cancelled AND missed are BOTH
 * terminal; 'missed' reanchors to the instance date like skip (999.1411 pins
 * in rollingAnchor.test.js / schedulerScenarios.test.js), while 'cancel'
 * does NOT count (computeRollingAnchor/computeNextOccurrenceAnchor return
 * null for it).
 *
 * This gate is LOAD-BEARING, not an optimization: TERMINAL_STATUSES (shared/
 * task-status.js) also contains 'pause' and 'cancelled', which the compute
 * functions' own isTerminalStatus() guard would wrongly treat as an
 * anchor-advancing event — only the explicit cancel check inside them blocks
 * 'cancel', not 'pause'/'cancelled'. Callers must gate on THIS list before
 * invoking the projection.
 */
var ANCHOR_PROJECTION_STATUSES = Object.freeze(['done', 'skip', 'missed']);

module.exports = { isRollingMaster, computeRollingAnchor, ANCHOR_PROJECTION_STATUSES };
