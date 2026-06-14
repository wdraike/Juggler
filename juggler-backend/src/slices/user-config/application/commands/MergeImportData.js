/**
 * MergeImportData — application command use-case (two-mode import, Wave 1 / W2).
 *
 * The NON-DESTRUCTIVE ("merge") import. Where ImportData (the legacy REPLACE-only
 * importer) wipes the user's config + tasks and re-inserts, MergeImportData is
 * ADDITIVE only: it NEVER calls clearUserConfigTables and NEVER wipes tasks. It
 * appends the imported tasks / projects / locations / tools to whatever the user
 * already has, fabricating unique keys on collision (NEVER skipping an imported row,
 * NEVER overwriting an existing one). The whole merge runs inside ONE
 * repo.runInTransaction, preserving the same atomic boundary ImportData has
 * (INVARIANT C-TX).
 *
 * ── COLLISION HANDLING (fabricate-unique, never skip/overwrite) ───────────────
 *   • Tasks (keyed by id): existing task ids are read within the trx
 *     (`listTaskIds(trxRepo, userId)` → task_masters.id). For each imported task
 *     whose id already exists (or collides with an id already used earlier in THIS
 *     import), a fabricated NEW unique id is assigned (`<id>-imported-<n>`, bumping
 *     n until unique against BOTH existing ids and ids already used this import) and
 *     the task is inserted as a NEW row. Existing task rows are untouched. Such
 *     re-keyed tasks are counted as `tasksRekeyed`.
 *   • Projects / locations / tools (keyed by NAME per user): existing names are read
 *     within the trx (getProjects/getLocations/getTools). For an imported name that
 *     collides, it is renamed to "<name> (2)", "<name> (3)", … until unique (against
 *     existing names AND names already used this import) and APPENDED as a NEW row.
 *     Existing rows untouched. Append uses the bulk insert methods
 *     (insertProjects/insertLocations/insertTools — these do NOT delete) with
 *     sort_order computed AFTER the current max so the new rows land after the
 *     user's existing entries.
 *
 * ── KEEP-MINE SETTINGS (hard product rule — Brain decision #59583) ────────────
 *   In merge mode the use-case writes NO singleton config
 *   (toolMatrix/timeBlocks/locSchedules.../locScheduleDefaults/locScheduleOverrides/
 *   hourLocationOverrides/preferences/gridZoom/…) and NO statuses. The user's
 *   existing user_config rows are left ENTIRELY untouched. The import's settings
 *   values are intentionally ignored — "keep mine".
 *
 * ── NO NEW FALLBACKS ──────────────────────────────────────────────────────────
 *   The only `|| <default>` defaults are the legacy ImportData array/icon defaults,
 *   carried verbatim for the additive rows. No new silent substitution is added.
 *
 * @typedef {Object} MergeImportDataDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {(trxRepo: *, userId: string) => Promise<string[]>} listTaskIds  reads the
 *   user's EXISTING task ids within the trx (task_masters.id) — injected, because
 *   the task tables live outside the ConfigRepositoryPort (mirrors how ImportData's
 *   wipeTasks/insertTask are injected from the task slice's tasks-write).
 * @property {(trxRepo: *, row: Object) => Promise<void>} insertTask  per-task insert
 *   within the trx (legacy tasks-write.insertTask) — injected.
 * @property {(t: Object, userId: string, tz: string, statuses?: Object) => Object} buildTaskRow
 *   the v7-task → DB-row mapper (same one ImportData uses) — injected.
 */

'use strict';

/** @param {MergeImportDataDeps} deps */
function MergeImportData(deps) {
  if (!deps || !deps.repo || !deps.listTaskIds || !deps.insertTask || !deps.buildTaskRow) {
    throw new Error('MergeImportData: { repo, listTaskIds, insertTask, buildTaskRow } are required');
  }
  this.repo = deps.repo;
  this.listTaskIds = deps.listTaskIds;
  this.insertTask = deps.insertTask;
  this.buildTaskRow = deps.buildTaskRow;
}

// Fabricate a unique task id from the original, avoiding both the existing-id set
// and the set of ids already used in this import. Never returns a colliding id.
function fabricateTaskId(originalId, usedSet) {
  var n = 1;
  var candidate;
  do {
    candidate = originalId + '-imported-' + n;
    n++;
  } while (usedSet[candidate]);
  return candidate;
}

// Fabricate a unique name from the original via the "<name> (k)" suffix, avoiding
// both existing names and names already used in this import.
function fabricateName(originalName, usedSet) {
  var k = 2;
  var candidate;
  do {
    candidate = originalName + ' (' + k + ')';
    k++;
  } while (usedSet[candidate]);
  return candidate;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {*} input.data       the v7 import body.
 * @param {string} [input.timezoneHeader]  raw x-timezone header.
 * @returns {Promise<{ status: number, body: Object }>}
 */
MergeImportData.prototype.execute = async function execute(input) {
  var self = this;
  var userId = input.userId;
  var tz = input.timezoneHeader || 'America/New_York';
  var data = input.data;

  // Shape guard — mirror ImportData's legacy guard (the application layer still owns
  // the "Invalid import data" message; merge mode keeps the same contract).
  if (!data || !data.extraTasks) {
    return { status: 400, body: { error: 'Invalid import data — expected v7 format with extraTasks' } };
  }

  // Extract the ADDITIVE sources (defaults verbatim from ImportData). Note: the
  // KEEP-MINE settings (statuses/toolMatrix/timeBlocks/locSchedules.../preferences/
  // gridZoom/…) are deliberately NOT extracted — merge mode never writes them.
  var tasks = data.extraTasks || [];
  var locations = data.locations || [];
  var tools = data.tools || [];
  var explicitProjects = data.projects || [];

  // dedupe tasks by id (last wins) — same as ImportData (an import body can repeat
  // an id; the last definition wins before collision handling).
  var deduped = new Map();
  for (var ti = 0; ti < tasks.length; ti++) {
    deduped.set(tasks[ti].id, tasks[ti]);
  }
  var uniqueTasks = Array.from(deduped.values());

  // merge explicit + extracted project names (same derivation as ImportData) — the
  // set of project NAMES the import wants to add.
  var explicitNames = new Set(explicitProjects.map(function (p) { return p.name; }));
  var extractedNames = new Set();
  uniqueTasks.forEach(function (t) {
    if (t.project && !explicitNames.has(t.project)) extractedNames.add(t.project);
  });
  var mergedProjects = explicitProjects.concat(
    Array.from(extractedNames).map(function (name) { return { name: name, color: null, icon: null }; })
  );

  // Counters (items ACTUALLY added).
  var counts = {
    tasks: 0,
    duplicatesRemoved: tasks.length - uniqueTasks.length,
    tasksRekeyed: 0,
    locations: 0,
    tools: 0,
    projects: 0
  };

  await this.repo.runInTransaction(async function (trxRepo) {
    // ── TASKS (additive; re-key colliding ids) ────────────────────────────────
    var existingIds = await self.listTaskIds(trxRepo, userId);
    var usedTaskIds = {};
    existingIds.forEach(function (id) { usedTaskIds[id] = true; });

    for (var i = 0; i < uniqueTasks.length; i++) {
      var t = uniqueTasks[i];
      var rekeyed = false;
      var newId = t.id;
      if (usedTaskIds[t.id]) {
        newId = fabricateTaskId(t.id, usedTaskIds);
        rekeyed = true;
      }
      usedTaskIds[newId] = true;
      // build the row, then override the id so a re-keyed task inserts as a NEW row.
      var row = self.buildTaskRow(t, userId, tz, {});
      row.id = newId;
      await self.insertTask(trxRepo, row);
      counts.tasks++;
      if (rekeyed) counts.tasksRekeyed++;
    }

    // ── PROJECTS (additive; rename colliding NAMES; append after current max) ──
    if (mergedProjects.length > 0) {
      var existingProjects = await trxRepo.getProjects(userId);
      var usedProjectNames = {};
      var maxProjectSort = -1;
      existingProjects.forEach(function (p) {
        usedProjectNames[p.name] = true;
        if (p.sort_order != null && p.sort_order > maxProjectSort) maxProjectSort = p.sort_order;
      });
      var projectRows = mergedProjects.map(function (p, idx) {
        var name = p.name;
        if (usedProjectNames[name]) name = fabricateName(p.name, usedProjectNames);
        usedProjectNames[name] = true;
        return {
          user_id: userId,
          name: name,
          color: p.color || null,
          icon: p.icon || null,
          sort_order: maxProjectSort + 1 + idx
        };
      });
      await trxRepo.insertProjects(userId, projectRows);
      counts.projects = projectRows.length;
    }

    // ── LOCATIONS (additive; rename colliding NAMES; append after current max) ─
    if (locations.length > 0) {
      var existingLocations = await trxRepo.getLocations(userId);
      var usedLocationNames = {};
      var maxLocationSort = -1;
      existingLocations.forEach(function (l) {
        usedLocationNames[l.name] = true;
        if (l.sort_order != null && l.sort_order > maxLocationSort) maxLocationSort = l.sort_order;
      });
      var locationRows = locations.map(function (l, idx) {
        var name = l.name;
        if (usedLocationNames[name]) name = fabricateName(l.name, usedLocationNames);
        usedLocationNames[name] = true;
        return {
          user_id: userId,
          location_id: l.id,
          name: name,
          icon: l.icon || '',
          sort_order: maxLocationSort + 1 + idx
        };
      });
      await trxRepo.insertLocations(userId, locationRows);
      counts.locations = locationRows.length;
    }

    // ── TOOLS (additive; rename colliding NAMES; append after current max) ─────
    if (tools.length > 0) {
      var existingTools = await trxRepo.getTools(userId);
      var usedToolNames = {};
      var maxToolSort = -1;
      existingTools.forEach(function (tl) {
        usedToolNames[tl.name] = true;
        if (tl.sort_order != null && tl.sort_order > maxToolSort) maxToolSort = tl.sort_order;
      });
      var toolRows = tools.map(function (tl, idx) {
        var name = tl.name;
        if (usedToolNames[name]) name = fabricateName(tl.name, usedToolNames);
        usedToolNames[name] = true;
        return {
          user_id: userId,
          tool_id: tl.id,
          name: name,
          icon: tl.icon || '',
          sort_order: maxToolSort + 1 + idx
        };
      });
      await trxRepo.insertTools(userId, toolRows);
      counts.tools = toolRows.length;
    }

    // KEEP-MINE: intentionally NO config / statuses write here (Brain decision #59583).
  });

  return {
    status: 200,
    body: {
      message: 'Merge import successful',
      mode: 'merge',
      counts: counts
    }
  };
};

module.exports = MergeImportData;
