/**
 * deriveSchedulePlacements — server-side mirror of the frontend
 * juggler-frontend/src/utils/derivePlacements.js, for MCP read consumers.
 *
 * W3 (DB single source): the in-process MCP get_schedule tool no longer reads
 * the schedule_cache via getSchedulePlacements. Instead it derives placements
 * from the SAME task list GET /api/tasks returns (taskFacade.getAllTasks → each
 * task already carries `scheduledAt` ISO string), exactly the way the juggler
 * frontend now does. The schedule_cache WRITE stays as an INTERNAL detail that
 * only cal-sync reads (per-block split placements); it is no longer a read
 * source for placement display.
 *
 * Note on timezone: ListTasks calls rowToTask(row, null, srcMap) — null tz —
 * so task.date and task.time are always null from the facade. We derive
 * date+time from task.scheduledAt (the UTC ISO string on the task object) using
 * the user timezone resolved from options.timezone or the users table.
 *
 * Routing rules (mirror derivePlacements.js exactly):
 *   • t.unscheduled OR (t._unplacedReason && !t.scheduledAt) → unplaced[]
 *   • t.scheduledAt → derive local date+time via utcToLocal; if parseable   → dayPlacements[date]
 *   • t.scheduledAt but unparseable time (start === null) → skipped (data anomaly)
 *   • otherwise (no scheduledAt / plain backlog)           → absent from both
 *
 * Run artifacts (score, changeset) are NOT produced here — this is a pure read
 * derivation, not a scheduler run.
 */

'use strict';

const taskFacade = require('../slices/task/facade');
const db = require('../db');
const dateHelpers = require('./dateHelpers');
var parseTimeToMinutes = dateHelpers.parseTimeToMinutes;
var utcToLocal = dateHelpers.utcToLocal;

var DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Resolve the timezone to use: options.timezone → users table → fallback.
 * @param {string} userId
 * @param {{ timezone?: string }} [options]
 * @returns {Promise<string>}
 */
async function resolveTimezone(userId, options) {
  if (options && options.timezone) return options.timezone;
  try {
    var row = await db('users').where('id', userId).select('timezone').first();
    if (row) return row.timezone; // users.timezone is NOT NULL (migration 20260626000000)
  } catch (_e) { /* fall through */ }
  return DEFAULT_TIMEZONE;
}

/**
 * @param {string} userId
 * @param {{ timezone?: string }} [options]
 * @returns {Promise<{ dayPlacements: Object, unplaced: Array, warnings: Array }>}
 */
async function deriveSchedulePlacements(userId, options) {
  var tz = await resolveTimezone(userId, options);

  // Fetch the user's tasks the SAME way GET /api/tasks does (taskFacade.getAllTasks
  // → ListTasks). Do NOT reimplement rowToTask; reuse the facade verbatim.
  var result = await taskFacade.getAllTasks({ userId: userId, query: {} });
  var tasks = (result && result.body && result.body.tasks) || [];

  var dayPlacements = {};
  var unplaced = [];
  tasks.forEach(function(t) {
    if (!t) return;
    if (t.unscheduled || (t._unplacedReason && !t.scheduledAt)) { unplaced.push(t); return; }
    if (t.scheduledAt) {
      // Derive local date+time from the UTC scheduledAt string. task.scheduledAt is an
      // ISO string ("2026-06-22T13:00:00.000Z"); pass it as a Date object so utcToLocal
      // does not double-append 'Z' (its string branch appends 'Z' expecting MySQL format).
      var saDate = new Date(t.scheduledAt);
      var local = utcToLocal(isNaN(saDate.getTime()) ? null : saDate, tz);
      if (local.date && local.time) {
        var start = parseTimeToMinutes(local.time);
        // Only grid a placement with a parseable start. A placed task always has a
        // parseable "H:MM AM/PM", so null is a data anomaly — skip the grid entry.
        if (start != null) {
          if (!dayPlacements[local.date]) dayPlacements[local.date] = [];
          dayPlacements[local.date].push({ task: t, start: start, end: start + (t.dur || 0) });
        }
      }
    }
  });

  return { dayPlacements: dayPlacements, unplaced: unplaced, warnings: [] };
}

module.exports = { deriveSchedulePlacements };
