/**
 * deriveSchedulePlacements — server-side, DB-sourced placement view (W3 / W4).
 *
 * The read-only "current schedule" view (day-by-day placements + unplaced
 * tasks) is now DERIVED from the task read model instead of the deleted
 * `user_config` schedule_cache blob. This is the server equivalent of the
 * juggler frontend's `derivePlacements` (juggler-frontend/src/utils/
 * derivePlacements.js): given the user's tasks exactly as GET /api/tasks
 * returns them, group them into { dayPlacements, unplaced }.
 *
 * Fetch path: calls the SAME use-case GET /api/tasks does (task facade
 * `getAllTasks` → ListTasks → rowToTask), so the task shape is identical to
 * what the frontend derives from — no re-implementation of rowToTask.
 *
 * Routing rules (mirror of the frontend derivePlacements):
 *   • t.unscheduled OR (t._unplacedReason && !t.scheduledAt) → unplaced[]
 *   • t.date && t.time && parseable start (start != null)     → dayPlacements[t.date]
 *   • t.date && t.time but unparseable time (start === null)  → skipped (anomaly)
 *   • otherwise (no date / no time / plain backlog)           → absent from both
 *
 * The old getSchedulePlacements also returned score/warnings/changeset — those
 * were scheduler-RUN artifacts, not part of the read-only placement view, so
 * they are omitted (warnings returned as an empty array for shape parity with
 * the frontend deriver).
 */

'use strict';

var taskFacade = require('../slices/task/facade');
var { parseTimeToMinutes } = require('./dateHelpers');

/**
 * @param {string} userId
 * @param {Object} [options]
 * @param {string} [options.timezone] passed through for parity with the old
 *   getSchedulePlacements signature; GET /api/tasks maps task date/time without
 *   re-converting (rowToTask tz=null), so the derived view uses the task
 *   fields as-is — same as the frontend.
 * @returns {Promise<{ dayPlacements: Object, unplaced: Object[], warnings: Object[] }>}
 */
async function deriveSchedulePlacements(userId, _options) {
  // Fetch tasks the SAME way GET /api/tasks does.
  var result = await taskFacade.getAllTasks({ userId: userId });
  var tasks = (result && result.body && result.body.tasks) || [];

  var dayPlacements = {};
  var unplaced = [];
  tasks.forEach(function (t) {
    if (!t) return;
    if (t.unscheduled || (t._unplacedReason && !t.scheduledAt)) { unplaced.push(t); return; }
    if (t.date && t.time) {
      var start = parseTimeToMinutes(t.time);
      // A null start is a data anomaly for a placed task — skip the grid entry.
      if (start != null) {
        if (!dayPlacements[t.date]) dayPlacements[t.date] = [];
        dayPlacements[t.date].push({ task: t, start: start, end: start + (t.dur || 0) });
      }
    }
  });

  return { dayPlacements: dayPlacements, unplaced: unplaced, warnings: [] };
}

module.exports = { deriveSchedulePlacements: deriveSchedulePlacements };
