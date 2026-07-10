/**
 * RunSchedulerDebug — application query use-case (999.1196).
 *
 * Extracted VERBATIM from schedule.routes.js POST /debug: loads the user's
 * tasks_v rows via this endpoint's OWN filter (`.whereNot('status',
 * 'disabled')` — NOT the same working-set filter as the live scheduler's
 * SchedulerTaskProvider.loadSchedulableRows, so this is its own load, not a
 * reuse of that adapter), loads scheduler config, maps rows -> scheduler task
 * objects, and runs the pure unifiedScheduleV2 core with `_debug: true`
 * (phase snapshots) for the admin stepper/debug UI.
 *
 * @typedef {Object} RunSchedulerDebugDeps
 * @property {(userId: string) => Promise<Array<Object>>} loadTasks
 * @property {(userId: string) => Promise<Object>} loadConfig
 * @property {(row: Object, timezone: string, srcMap: Object) => Object} rowToTask
 * @property {Function} unifiedSchedule
 */

'use strict';

function RunSchedulerDebug(deps) {
  this._loadTasks = deps.loadTasks;
  this._loadConfig = deps.loadConfig;
  this._rowToTask = deps.rowToTask;
  this._unifiedSchedule = deps.unifiedSchedule;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {string} input.timezone
 * @param {string} input.todayKey
 * @param {number} input.nowMins
 * @returns {Promise<Object>} the debug response body (schedule.routes.js shape)
 */
RunSchedulerDebug.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var timezone = input.timezone;
  var todayKey = input.todayKey;
  var nowMins = input.nowMins;

  var tasks = await this._loadTasks(userId);

  var schedCfg = await this._loadConfig(userId);
  schedCfg.timezone = timezone;
  schedCfg._debug = true; // Enable phase snapshots

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });

  // Build source map for recurring template inheritance
  var srcMap = {};
  tasks.forEach(function(t) {
    if (t.task_type === 'recurring_template' || (!t.generated && t.recur)) {
      srcMap[t.id] = t;
    }
  });

  var rowToTask = this._rowToTask;
  var mapped = tasks.map(function(r) { return rowToTask(r, timezone, srcMap); });

  var result = this._unifiedSchedule(mapped, statuses, todayKey, nowMins, schedCfg);

  return {
    success: true,
    todayKey: todayKey,
    nowMins: nowMins,
    timezone: timezone,
    taskCount: mapped.length,
    placedCount: result.placedCount,
    unplacedCount: result.unplaced.length,
    score: result.score,
    warnings: result.warnings,
    phaseSnapshots: result.phaseSnapshots || [],
  };
};

module.exports = RunSchedulerDebug;
