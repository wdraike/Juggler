/**
 * ImportData — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `importData` handler (data.controller.js:17-207)
 * step-for-step. The CONFIG-table wipe + bulk inserts go through the W3
 * ConfigRepositoryPort (within ONE transaction); the TASK wipe + task row insert
 * stay with the task slice and enter as INJECTED collaborators (`wipeTasks` +
 * `insertTask` + `buildTaskRow`) — the legacy handler `require`d tasksWrite +
 * dateHelpers for exactly that. The whole import runs inside repo.runInTransaction,
 * preserving the legacy atomic `getDb().transaction(...)` boundary (INVARIANT C-TX).
 *
 * ── STEP-FOR-STEP (matches the handler) ──────────────────────────────────────
 *   1. !data || !data.extraTasks → 400 'Invalid import data …'.
 *   2. confirm !== 'delete_all' → 400 'Import will DELETE all existing …' (the SOLE
 *      destructive guard — golden-master H2-elmoB2a/b; there is NO requireFeature
 *      gate, preserved as-is).
 *   3. extract the arrays/prefs with their `|| <default>` defaults (verbatim).
 *   4. dedupe tasks by id (last wins); merge explicit + extracted project names.
 *   5. runInTransaction:
 *        a. trxRepo.clearUserConfigTables(userId)  (user_config/tools/locations/projects wipe).
 *        b. wipeTasks(trxRepo, userId)              (the task wipe — injected).
 *        c. for each unique task: insertTask(trxRepo, buildTaskRow(t, userId, tz)).
 *        d. trxRepo.insertLocations / insertTools / insertProjects / insertConfigRows
 *           (the config bulk inserts — only when the source array is non-empty, as
 *           the legacy guarded each insert).
 *   6. respond 200 { message, counts: { tasks, duplicatesRemoved, locations, tools, projects } }.
 *
 * ── NO NEW FALLBACKS ── every `|| []` / `|| {}` / `|| <num>` default is preserved
 * verbatim from the handler.
 *
 * @typedef {Object} ImportDataDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {(trxRepo: *, userId: string) => Promise<void>} wipeTasks  the task wipe
 *   (legacy tasksWrite.deleteTasksWhere within the trx) — injected.
 * @property {(trxRepo: *, row: Object) => Promise<void>} insertTask  the per-task
 *   insert (legacy tasksWrite.insertTask within the trx) — injected.
 * @property {(t: Object, userId: string, tz: string) => Object} buildTaskRow  the
 *   v7-task → DB-row mapper (legacy inline map + localToUtc/toDateISO date helpers)
 *   — injected (it depends on the task slice's date helpers, outside this slice).
 */

'use strict';

var taskValidation = require('../../../task/domain/validation/taskValidation');

/** @param {ImportDataDeps} deps */
function ImportData(deps) {
  if (!deps || !deps.repo || !deps.wipeTasks || !deps.insertTask || !deps.buildTaskRow) {
    throw new Error('ImportData: { repo, wipeTasks, insertTask, buildTaskRow } are required');
  }
  this.repo = deps.repo;
  this.wipeTasks = deps.wipeTasks;
  this.insertTask = deps.insertTask;
  this.buildTaskRow = deps.buildTaskRow;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {*} input.data       the request body (v7 import shape).
 * @param {string} input.confirm  the ?confirm query value.
 * @param {string} [input.timezoneHeader]  raw x-timezone header.
 * @returns {Promise<{ status: number, body: Object }>}
 */
ImportData.prototype.execute = async function execute(input) {
  var self = this;
  var userId = input.userId;
  var tz = input.timezoneHeader || 'America/New_York';
  var data = input.data;

  // 1. shape guard (handler L23-25)
  if (!data || !data.extraTasks) {
    return { status: 400, body: { error: 'Invalid import data — expected v7 format with extraTasks' } };
  }
  // 2. destructive confirmation guard (handler L27-29) — the SOLE destructive guard.
  if (input.confirm !== 'delete_all') {
    return { status: 400, body: { error: 'Import will DELETE all existing tasks, config, and projects. Pass ?confirm=delete_all to proceed.' } };
  }

  // 3. extract (handler L31-48) — defaults verbatim.
  var tasks = data.extraTasks || [];
  var statuses = data.statuses || {};
  var locations = data.locations || [];
  var tools = data.tools || [];
  var toolMatrix = data.toolMatrix || {};
  var locSchedules = data.locSchedules || {};
  var locScheduleDefaults = data.locScheduleDefaults || {};
  var locScheduleOverrides = data.locScheduleOverrides || {};
  var hourLocationOverrides = data.hourLocationOverrides || {};
  var timeBlocks = data.timeBlocks || {};
  var explicitProjects = data.projects || [];
  var preferences = {
    gridZoom: data.gridZoom || 60,
    splitDefault: data.splitDefault || false,
    splitMinDefault: data.splitMinDefault || 15,
    schedFloor: data.schedFloor || 480,
    schedCeiling: data.schedCeiling || 1380
  };

  // 4. dedupe tasks by id — keep last (handler L50-55)
  var deduped = new Map();
  for (var ti = 0; ti < tasks.length; ti++) {
    deduped.set(tasks[ti].id, tasks[ti]);
  }
  var uniqueTasks = Array.from(deduped.values());

  // merge explicit + extracted project names (handler L57-65)
  var explicitNames = new Set(explicitProjects.map(function (p) { return p.name; }));
  var extractedNames = new Set();
  uniqueTasks.forEach(function (t) {
    if (t.project && !explicitNames.has(t.project)) extractedNames.add(t.project);
  });
  var mergedProjects = explicitProjects.concat(
    Array.from(extractedNames).map(function (name) { return { name: name, color: null, icon: null }; })
  );

  // 4b. 999.867: fixed+recurring XOR enforcement — validate before the destructive
  // transaction. Import tasks are full create-shaped objects (API field names), so
  // the same-request isFixedRecurringConflict check suffices (no merge with existing needed).
  for (var xvi = 0; xvi < uniqueTasks.length; xvi++) {
    var _xt = uniqueTasks[xvi];
    if (taskValidation.isFixedRecurringConflict({ placementMode: _xt.placementMode, recurring: _xt.recurring })) {
      return { status: 400, body: { error: 'invalid_combination' } };
    }
  }

  // 5. transaction (handler L68-191) — config via repo, tasks via injected.
  await this.repo.runInTransaction(async function (trxRepo) {
    // a. wipe config tables (handler L70-73)
    await trxRepo.clearUserConfigTables(userId);
    // b. wipe tasks (handler L74-75)
    await self.wipeTasks(trxRepo, userId);

    // c. import tasks (handler L77-132)
    if (uniqueTasks.length > 0) {
      var taskRows = uniqueTasks.map(function (t) { return self.buildTaskRow(t, userId, tz, statuses); });
      for (var i = 0; i < taskRows.length; i++) {
        await self.insertTask(trxRepo, taskRows[i]);
      }
    }

    // d. config bulk inserts — each guarded on a non-empty source (handler L134-190).
    if (locations.length > 0) {
      await trxRepo.insertLocations(userId, locations.map(function (l, i) {
        return { user_id: userId, location_id: l.id, name: l.name, icon: l.icon || '', sort_order: i };
      }));
    }
    if (tools.length > 0) {
      await trxRepo.insertTools(userId, tools.map(function (t, i) {
        return { user_id: userId, tool_id: t.id, name: t.name, icon: t.icon || '', sort_order: i };
      }));
    }
    if (mergedProjects.length > 0) {
      await trxRepo.insertProjects(userId, mergedProjects.map(function (p, i) {
        return { user_id: userId, name: p.name, color: p.color || null, icon: p.icon || null, sort_order: i };
      }));
    }
    var configs = [
      { key: 'tool_matrix', value: toolMatrix },
      { key: 'time_blocks', value: timeBlocks },
      { key: 'loc_schedules', value: locSchedules },
      { key: 'loc_schedule_defaults', value: locScheduleDefaults },
      { key: 'loc_schedule_overrides', value: locScheduleOverrides },
      { key: 'hour_location_overrides', value: hourLocationOverrides },
      { key: 'preferences', value: preferences }
    ];
    await trxRepo.insertConfigRows(userId, configs.map(function (c) {
      return { user_id: userId, config_key: c.key, config_value: JSON.stringify(c.value) };
    }));
  });

  // 6. response (handler L193-202)
  // One scheduleAfter directive for the whole import — all schedule-affecting keys
  // (tool_matrix, time_blocks, loc_schedules, locations, etc.) were written atomically
  // in the transaction above. Exactly one trigger, never one per config key (BUG-3 / 999.464).
  return {
    status: 200,
    body: {
      message: 'Import successful',
      counts: {
        tasks: uniqueTasks.length,
        duplicatesRemoved: tasks.length - uniqueTasks.length,
        locations: locations.length,
        tools: tools.length,
        projects: mergedProjects.length
      }
    },
    scheduleAfter: { userId: userId, source: 'config:import' }
  };
};

module.exports = ImportData;
