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
 * ── STEP-FOR-STEP (matches the handler, amended by 999.1603) ─────────────────
 *   1. !data || !data.extraTasks → 400 'Invalid import data …'.
 *   1b. exportFormatVersion NEWER than this server reads → 400 (999.1603; absent
 *       = legacy v7 payload, accepted).
 *   2. confirm !== 'delete_all' → 400 'Import will DELETE all existing …' (the SOLE
 *      destructive guard — golden-master H2-elmoB2a/b; there is NO requireFeature
 *      gate, preserved as-is).
 *   3. extract the arrays/prefs with their `|| <default>` defaults (verbatim);
 *      PLUS the preserve-unless-carried keys (999.1603): scheduleTemplates,
 *      templateDefaults, templateOverrides, calSyncSettings, tempUnitPref are
 *      written ONLY when the payload carries them.
 *   4. dedupe tasks by id (last wins); merge explicit + extracted project names.
 *   5. runInTransaction:
 *        a. read existing user_config rows (for preference-merge + verification),
 *           then trxRepo.clearUserConfigTables(userId, writtenKeys) — SELECTIVE
 *           config wipe (999.1603): only keys being rewritten are deleted; every
 *           other key (templates a legacy payload doesn't carry, etc.) survives.
 *           tools/locations/projects remain a full wipe (v7 replace contract).
 *        b. wipeTasks(trxRepo, userId)              (the task wipe — injected).
 *        c. for each unique task: insertTask(trxRepo, buildTaskRow(t, userId, tz)).
 *        d. trxRepo.insertLocations / insertTools / insertProjects / insertConfigRows
 *           (the config bulk inserts — only when the source array is non-empty, as
 *           the legacy guarded each insert). preferences is MERGED: existing row
 *           ← payload.preferences object ← the 5 v7 top-level scalars (999.1603),
 *           so uncarried subkeys (calCompletedBehavior, …) survive a legacy import.
 *        e. VERIFY (999.1603): re-read user_config in the same trx; every written
 *           key must deep-equal what was written and every preserved key must
 *           deep-equal its pre-import value — any discrepancy throws, rolling the
 *           whole import back (reject, never a half-consistent state).
 *   6. respond 200 { message, counts: { tasks, duplicatesRemoved, locations, tools, projects } }.
 *
 * ── NO NEW FALLBACKS ── every `|| []` / `|| {}` / `|| <num>` default is preserved
 * verbatim from the handler. The 999.1603 preserve-unless-carried keys use
 * explicit `!= null` presence checks, not value fallbacks.
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

var assert = require('assert');
var taskValidation = require('../../../task/domain/validation/taskValidation');
var UserConfig = require('../../domain/entities/UserConfig');

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
  // 1b. version guard (999.1603): reject exports stamped NEWER than this server
  // reads — their shape may carry keys/semantics we would silently drop. Absent
  // stamp = legacy v7 payload, accepted.
  if (data.exportFormatVersion != null) {
    var stampedVersion = Number(data.exportFormatVersion);
    // Non-numeric stamp = malformed payload — reject, don't fail-open as legacy.
    if (!isFinite(stampedVersion) || stampedVersion > UserConfig.EXPORT_FORMAT_VERSION) {
      return { status: 400, body: { error: 'Unsupported export format version ' + data.exportFormatVersion + ' — this server reads versions up to ' + UserConfig.EXPORT_FORMAT_VERSION + '. Update the app before importing this file.' } };
    }
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

  // 3b. preserve-unless-carried keys (999.1603): written ONLY when the payload
  // carries them; otherwise the existing rows survive the (now selective) wipe.
  var carriedConfigs = [];
  if (data.scheduleTemplates != null) carriedConfigs.push({ key: 'schedule_templates', value: data.scheduleTemplates });
  if (data.templateDefaults != null) carriedConfigs.push({ key: 'template_defaults', value: data.templateDefaults });
  if (data.templateOverrides != null) carriedConfigs.push({ key: 'template_overrides', value: data.templateOverrides });
  if (data.calSyncSettings != null) carriedConfigs.push({ key: 'cal_sync_settings', value: data.calSyncSettings });
  if (data.tempUnitPref != null) carriedConfigs.push({ key: 'temp_unit_pref', value: data.tempUnitPref });

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
    // a. read pre-import config (999.1603) — feeds the preferences merge and the
    // post-write verification — then SELECTIVELY wipe: only keys being rewritten
    // are deleted; everything else (templates a legacy payload doesn't carry,
    // cal_sync_settings, temp_unit_pref, …) survives. tools/locations/projects
    // keep the full v7 replace wipe.
    var preRows = await trxRepo.getConfigRows(userId);
    var preConfig = {};
    preRows.forEach(function (row) {
      preConfig[row.config_key] = UserConfig.parseConfigValue(row.config_value);
    });

    // preferences merge (999.1603): existing subkeys ← payload `preferences`
    // object (v8 exports) ← the 5 v7 top-level scalars (always present, legacy
    // contract). Uncarried subkeys like calCompletedBehavior survive.
    var mergedPreferences = Object.assign(
      {},
      (preConfig.preferences && typeof preConfig.preferences === 'object') ? preConfig.preferences : {},
      (data.preferences && typeof data.preferences === 'object') ? data.preferences : {},
      preferences
    );

    var configs = [
      { key: 'tool_matrix', value: toolMatrix },
      { key: 'time_blocks', value: timeBlocks },
      { key: 'loc_schedules', value: locSchedules },
      { key: 'loc_schedule_defaults', value: locScheduleDefaults },
      { key: 'loc_schedule_overrides', value: locScheduleOverrides },
      { key: 'hour_location_overrides', value: hourLocationOverrides },
      { key: 'preferences', value: mergedPreferences }
    ].concat(carriedConfigs);
    var writtenKeys = configs.map(function (c) { return c.key; });

    await trxRepo.clearUserConfigTables(userId, writtenKeys);
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
    await trxRepo.insertConfigRows(userId, configs.map(function (c) {
      return { user_id: userId, config_key: c.key, config_value: JSON.stringify(c.value) };
    }));

    // e. VERIFY (999.1603) — the import must leave user_config exactly at
    // "written keys = payload values, preserved keys = pre-import values".
    // Any discrepancy throws → the whole transaction rolls back (reject, never
    // a half-consistent state). deepStrictEqual because config_value is a JSON
    // column — MySQL normalizes key order, so string comparison would lie.
    var postRows = await trxRepo.getConfigRows(userId);
    var postConfig = {};
    postRows.forEach(function (row) {
      postConfig[row.config_key] = UserConfig.parseConfigValue(row.config_value);
    });
    configs.forEach(function (c) {
      try {
        assert.deepStrictEqual(postConfig[c.key], c.value);
      } catch (e) {
        throw new Error('Import verification failed: written config key "' + c.key + '" does not match the imported value — rolling back');
      }
    });
    Object.keys(preConfig).forEach(function (key) {
      if (writtenKeys.indexOf(key) !== -1) return; // rewritten above
      try {
        assert.deepStrictEqual(postConfig[key], preConfig[key]);
      } catch (e) {
        throw new Error('Import verification failed: preserved config key "' + key + '" was altered by the import — rolling back');
      }
    });
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
