/**
 * ExportData — application query use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `exportData` handler (data.controller.js:213-271)
 * step-for-step. The CONFIG-table reads (locations/tools/projects/user_config) go
 * through the W3 ConfigRepositoryPort; the TASK read + the row→task mapping stay
 * with the task slice and enter as INJECTED collaborators (`fetchTasks` +
 * `rowToTask`) — exactly the seam the legacy handler used (it `require`d
 * task.controller's fetchTasksWithEventIds + rowToTask).
 *
 * ── STEP-FOR-STEP (matches the handler) ──────────────────────────────────────
 *   1. tz = timezoneHeader || 'America/New_York' (preserved verbatim).
 *   2. Promise.all([ fetchTasks(userId, orderByCreatedAsc),
 *                    repo.getLocations, repo.getTools, repo.getProjects,
 *                    repo.getConfigRows ]).
 *   3. map task rows via rowToTask(r, tz); build the statuses map (only truthy status).
 *   4. build the config map (JSON.parse each config_value when a string — the
 *      legacy export parse, data.controller.js:240-243; NOTE this is the
 *      no-try/catch JSON.parse, NOT getAllConfig's guarded parse — preserved as-is).
 *   5. shape the v7 export body with all the prefs `|| <default>` fallbacks verbatim.
 *
 * The route-layer requireFeature('data.export') gate (golden-master H2-3) stays in
 * the W6 route middleware — it is enforced by GateFeature, NOT here.
 *
 * ── NO NEW FALLBACKS ── every `||` default is preserved verbatim from the handler.
 *
 * @typedef {Object} ExportDataDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {(userId: string, orderBy: Function) => Promise<Object[]>} fetchTasks
 *   the task slice's task read (legacy fetchTasksWithEventIds) — injected.
 * @property {(row: Object, tz: string) => Object} rowToTask  the task mapper — injected.
 * @property {() => string} [now]  ISO timestamp source (injected for determinism;
 *   defaults to new Date().toISOString()).
 */

'use strict';

/** @param {ExportDataDeps} deps */
function ExportData(deps) {
  if (!deps || !deps.repo || !deps.fetchTasks || !deps.rowToTask) {
    throw new Error('ExportData: { repo, fetchTasks, rowToTask } are required');
  }
  this.repo = deps.repo;
  this.fetchTasks = deps.fetchTasks;
  this.rowToTask = deps.rowToTask;
  this._now = deps.now || function () { return new Date().toISOString(); };
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {string} [input.timezoneHeader]  raw `x-timezone` header.
 * @returns {Promise<{ status: number, body: Object }>}
 */
ExportData.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var tz = input.timezoneHeader || 'America/New_York';
  var rowToTask = this.rowToTask;

  var results = await Promise.all([
    this.fetchTasks(userId, function (q) { q.orderBy('created_at', 'asc'); }),
    this.repo.getLocations(userId),
    this.repo.getTools(userId),
    this.repo.getProjects(userId),
    this.repo.getConfigRows(userId)
  ]);

  var taskRows = results[0];
  var locationRows = results[1];
  var toolRows = results[2];
  var projectRows = results[3];
  var configRows = results[4];

  var tasks = taskRows.map(function (r) { return rowToTask(r, tz); });
  var statuses = {};
  tasks.forEach(function (t) { if (t.status) statuses[t.id] = t.status; });

  var config = {};
  configRows.forEach(function (row) {
    config[row.config_key] = typeof row.config_value === 'string'
      ? JSON.parse(row.config_value) : row.config_value;
  });

  var prefs = config.preferences || {};

  var body = {
    v7: true,
    extraTasks: tasks,
    statuses: statuses,
    locations: locationRows.map(function (l) { return { id: l.location_id, name: l.name, icon: l.icon }; }),
    tools: toolRows.map(function (t) { return { id: t.tool_id, name: t.name, icon: t.icon }; }),
    projects: projectRows.map(function (p) { return { id: p.id, name: p.name, color: p.color, icon: p.icon }; }),
    toolMatrix: config.tool_matrix || {},
    timeBlocks: config.time_blocks || {},
    locSchedules: config.loc_schedules || {},
    locScheduleDefaults: config.loc_schedule_defaults || {},
    locScheduleOverrides: config.loc_schedule_overrides || {},
    hourLocationOverrides: config.hour_location_overrides || {},
    gridZoom: prefs.gridZoom || 60,
    splitDefault: prefs.splitDefault || false,
    splitMinDefault: prefs.splitMinDefault || 15,
    schedFloor: prefs.schedFloor || 480,
    schedCeiling: prefs.schedCeiling || 1380,
    updated: this._now()
  };
  return { status: 200, body: body };
};

module.exports = ExportData;
