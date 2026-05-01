/**
 * Write-path for the master/instance task model. All application code
 * mutating tasks goes through this module.
 *
 * Row-shape contract:
 *   The `row` / `changes` object uses the same column names the former
 *   `tasks` table exposed (what `taskToRow()` in task.controller produces).
 *   This module routes those fields to master vs instance internally.
 *
 * Identity rules:
 *   - task_type = 'recurring_template' OR (recurring=1 AND task_type != 'recurring_instance')
 *       -> master row only. master.id = row.id. No instance.
 *   - task_type = 'recurring_instance'
 *       -> instance row only. instance.id = row.id. master_id = row.source_id.
 *          occurrence_ordinal = MAX(occurrence_ordinal for that master) + 1.
 *   - everything else ('task', '', null, 'generated')
 *       -> master + instance (both share row.id). ordinal (1, 1, 1).
 */

var { PLACEMENT_MODES } = require('./placementModes');

var MASTER_FIELDS = [
  'id', 'user_id', 'text', 'project', 'section', 'notes', 'url',
  'dur', 'pri',
  'desired_at', 'deadline', 'start_after_at',
  'when', 'day_req', 'time_flex', 'flex_when', 'placement_mode',
  'preferred_time_mins', 'tz', 'prev_when',
  'recurring', 'recur', 'recur_start', 'recur_end',
  'split', 'split_min',
  'depends_on', 'location', 'tools', 'travel_before', 'travel_after',
  'disabled_at', 'disabled_reason',
  // status lives on BOTH master and instance: master.status carries
  // template-level lifecycle ('pause'); instance.status carries per-occurrence
  // state (done/wip/skip/''). insertTask + updateTaskById write both so the
  // value is visible regardless of which row class the consumer reads.
  'status',
  'created_at', 'updated_at'
];

// Fields that live on task_instances. `dur` lives on both — copied from
// master at insert, can be overridden per-chunk once splits are real rows.
var INSTANCE_FIELDS = [
  'id', 'master_id', 'user_id',
  'occurrence_ordinal', 'split_ordinal', 'split_total',
  'scheduled_at', 'dur',
  'date_pinned',
  'status', 'time_remaining', 'unscheduled', 'overdue', 'generated',
  'created_at', 'updated_at'
];

// Fields in the `tasks`-shape row that update MASTER only (template fields).
var MASTER_UPDATE_FIELDS = [
  'text', 'project', 'section', 'notes', 'url', 'dur', 'pri',
  'desired_at', 'deadline', 'start_after_at',
  'when', 'day_req', 'time_flex', 'flex_when', 'placement_mode',
  'preferred_time_mins', 'tz', 'prev_when',
  'recurring', 'recur', 'recur_start', 'recur_end',
  'split', 'split_min',
  'depends_on', 'location', 'tools', 'travel_before', 'travel_after',
  'disabled_at', 'disabled_reason',
  // status: also a master-level field (template lifecycle); see MASTER_FIELDS comment
  'status'
];

// Fields in the `tasks`-shape row that update INSTANCE only (placement fields).
var INSTANCE_UPDATE_FIELDS = [
  'scheduled_at', 'dur', 'date_pinned',
  'date', 'day', 'time',
  'status', 'time_remaining', 'unscheduled', 'overdue', 'generated',
  'split_group'
];

function isTemplate(row) {
  if (!row) return false;
  if (row.task_type === 'recurring_template') return true;
  if (row.recurring && row.task_type !== 'recurring_instance') return true;
  return false;
}

function isInstance(row) {
  return row && row.task_type === 'recurring_instance';
}

function pickMaster(row, id) {
  var out = {};
  MASTER_FIELDS.forEach(function(f) {
    if (row[f] !== undefined) out[f] = row[f];
  });
  out.id = id;
  // Apply trigger-style defaults
  if (out.dur == null) out.dur = 30;
  if (!out.pri) out.pri = 'P3';
  if (out.status == null) out.status = '';
  out.flex_when = out.flex_when ? 1 : 0;
  out.recurring = out.recurring ? 1 : 0;
  return out;
}

function pickInstance(row, id, masterId, occOrdinal) {
  var out = {
    id: id,
    master_id: masterId,
    user_id: row.user_id,
    occurrence_ordinal: occOrdinal,
    split_ordinal: row.split_ordinal != null ? row.split_ordinal : 1,
    split_total: row.split_total != null ? row.split_total : 1,
    scheduled_at: row.scheduled_at || null,
    dur: row.dur != null ? row.dur : 30,
    date_pinned: row.date_pinned ? 1 : 0,
    status: row.status != null ? row.status : '',
    time_remaining: row.time_remaining != null ? row.time_remaining : null,
    unscheduled: row.unscheduled != null ? row.unscheduled : null,
    overdue: row.overdue != null ? row.overdue : 0,
    generated: row.generated ? 1 : 0
  };
  // Derived local-tz caches — written by the scheduler when placing chunks
  if (row.date !== undefined) out.date = row.date;
  if (row.day !== undefined) out.day = row.day;
  if (row.time !== undefined) out.time = row.time;
  if (row.split_group !== undefined) out.split_group = row.split_group;
  if (row.created_at !== undefined) out.created_at = row.created_at;
  if (row.updated_at !== undefined) out.updated_at = row.updated_at;
  return out;
}

function splitUpdateFields(changes) {
  var master = {};
  var instance = {};
  Object.keys(changes).forEach(function(k) {
    if (MASTER_UPDATE_FIELDS.indexOf(k) >= 0) master[k] = changes[k];
    if (INSTANCE_UPDATE_FIELDS.indexOf(k) >= 0) instance[k] = changes[k];
  });
  // updated_at and user_id mirror to both if present
  if (changes.updated_at !== undefined) {
    master.updated_at = changes.updated_at;
    instance.updated_at = changes.updated_at;
  }
  return { master: master, instance: instance };
}

/**
 * INSERT a task. `row` uses the legacy tasks column shape (what taskToRow
 * produces). Classification:
 *   - recurring_template (or legacy recurring=1 non-instance) -> master only
 *   - recurring_instance -> instance only (master_id = source_id, ordinal = MAX+1)
 *   - everything else -> master + instance (both share row.id)
 */
async function insertTask(dbOrTrx, row) {
  if (isTemplate(row)) {
    var masterRow = pickMaster(row, row.id);
    // Guarantee recurring=1 — templates must be visible in tasks_v WHERE recurring=1.
    // A task classified as template via task_type='recurring_template' alone (without
    // recurring:true in the body) would get recurring=0 from pickMaster and disappear
    // from the view, causing fetchTaskWithEventIds to return null.
    masterRow.recurring = 1;
    await dbOrTrx('task_masters').insert(masterRow);
    return;
  }
  if (isInstance(row)) {
    if (!row.source_id) {
      throw new Error('recurring_instance insert requires source_id');
    }
    var existing = await dbOrTrx('task_instances')
      .where('master_id', row.source_id)
      .max('occurrence_ordinal as max')
      .first();
    var nextOrd = (existing && existing.max ? Number(existing.max) : 0) + 1;
    await dbOrTrx('task_instances').insert(
      pickInstance(row, row.id, row.source_id, nextOrd)
    );
    return;
  }
  // Non-recurring: master + instance share row.id
  await dbOrTrx('task_masters').insert(pickMaster(row, row.id));
  await dbOrTrx('task_instances').insert(pickInstance(row, row.id, row.id, 1));
}

/**
 * UPDATE a task by id. `changes` uses the legacy tasks column shape; fields
 * are routed to master or instance based on which table owns them.
 * Pass `userId` for tenancy safety.
 *
 * Returns { masterUpdated, instanceUpdated } — row counts per table.
 */
async function updateTaskById(dbOrTrx, id, changes, userId) {
  var split = splitUpdateFields(changes);
  var masterUpdated = 0;
  var instanceUpdated = 0;
  var mWhere = { id: id };
  var iWhere = { id: id };
  if (userId) { mWhere.user_id = userId; iWhere.user_id = userId; }

  if (Object.keys(split.master).length > 0) {
    masterUpdated = await dbOrTrx('task_masters').where(mWhere).update(split.master);
  }
  if (Object.keys(split.instance).length > 0) {
    instanceUpdated = await dbOrTrx('task_instances').where(iWhere).update(split.instance);
  }
  return { masterUpdated: masterUpdated, instanceUpdated: instanceUpdated };
}

/**
 * DELETE a task by id (and optionally user_id for tenancy safety).
 * Works for masters, instances, or shared-id rows: deletes from both tables.
 * Master deletion cascades via FK to any instances sharing master_id.
 */
async function deleteTaskById(dbOrTrx, id, userId) {
  var instWhere = { id: id };
  if (userId) instWhere.user_id = userId;
  var instDeleted = await dbOrTrx('task_instances').where(instWhere).del();

  var masterWhere = { id: id };
  if (userId) masterWhere.user_id = userId;
  var masterDeleted = await dbOrTrx('task_masters').where(masterWhere).del();

  return { instanceDeleted: instDeleted, masterDeleted: masterDeleted };
}

/**
 * Batch INSERT for many tasks in one call. Replaces the per-row MAX(ordinal)+1
 * pattern with one MAX query per recurring source_id and one bulk INSERT per table.
 *
 * Accepts the same row shape as insertTask. Internally classifies each row as
 * template / recurring_instance / non-recurring and writes them in three batches:
 *   1. master rows (templates + non-recurring) into task_masters.
 *   2. instance rows for non-recurring (master_id = id, ordinal 1) into task_instances.
 *   3. instance rows for recurring_instance, with ordinals assigned per master_id
 *      after a single MAX-per-master lookup.
 *
 * Critical for scheduler hot path (recurring expansion of ~56 instances per template).
 */
async function insertTasksBatch(dbOrTrx, rows) {
  if (!rows || rows.length === 0) return;

  var masterRows = [];
  var instanceRowsNonRecurring = [];
  var recurringInstanceInputs = [];

  rows.forEach(function(row) {
    if (isTemplate(row)) {
      masterRows.push(pickMaster(row, row.id));
    } else if (isInstance(row)) {
      if (!row.source_id) {
        throw new Error('insertTasksBatch: recurring_instance row requires source_id (id=' + row.id + ')');
      }
      recurringInstanceInputs.push(row);
    } else {
      // Non-recurring: shared id pair
      masterRows.push(pickMaster(row, row.id));
      instanceRowsNonRecurring.push(pickInstance(row, row.id, row.id, 1));
    }
  });

  // Look up MAX(occurrence_ordinal) per distinct source_id, in one query.
  var sourceIds = recurringInstanceInputs
    .map(function(r) { return r.source_id; })
    .filter(function(v, i, arr) { return arr.indexOf(v) === i; });

  var maxByMaster = {};
  if (sourceIds.length > 0) {
    var rowsAgg = await dbOrTrx('task_instances')
      .whereIn('master_id', sourceIds)
      .select('master_id')
      .max('occurrence_ordinal as max_ord')
      .groupBy('master_id');
    rowsAgg.forEach(function(r) { maxByMaster[r.master_id] = Number(r.max_ord) || 0; });
  }
  // Source ids with zero existing instances (no row in the aggregate) start at 0.

  // Assign per-source incrementing ordinals while preserving input order.
  // Caller may supply r.occurrence_ordinal explicitly (used when inserting
  // multiple split chunks that must share one ordinal per occurrence).
  var nextByMaster = {};
  var recurringInstanceRows = recurringInstanceInputs.map(function(r) {
    var sid = r.source_id;
    var ord;
    if (r.occurrence_ordinal != null) {
      ord = r.occurrence_ordinal;
    } else {
      if (nextByMaster[sid] === undefined) nextByMaster[sid] = (maxByMaster[sid] || 0);
      nextByMaster[sid] += 1;
      ord = nextByMaster[sid];
    }
    return pickInstance(r, r.id, sid, ord);
  });

  if (masterRows.length > 0) {
    await dbOrTrx('task_masters').insert(masterRows);
  }
  var allInstanceRows = instanceRowsNonRecurring.concat(recurringInstanceRows);
  if (allInstanceRows.length > 0) {
    await dbOrTrx('task_instances').insert(allInstanceRows);
  }
}

/**
 * Per-user "__archived__" master used to host completed instances of
 * a deleted recurring template. Creates the archival master lazily on first
 * use. Returns its id.
 *
 * Why: prior to this, the FK ON DELETE SET NULL would orphan completed
 * instances with master_id=NULL, and the view's LEFT JOIN would return
 * NULL for text/pri/project — a poor user experience. Re-parenting to an
 * archival master gives those rows consistent non-null fields.
 */
var ARCHIVED_TEXT = '[Archived]';
async function getOrCreateArchivedMasterId(dbOrTrx, userId) {
  requireUserId(userId, 'getOrCreateArchivedMasterId');
  // Convention: archival master id = '__archived__:<userId>'. Idempotent lookup.
  var archivedId = '__archived__:' + userId;
  var existing = await dbOrTrx('task_masters').where('id', archivedId).first();
  if (existing) return archivedId;
  await dbOrTrx('task_masters').insert({
    id: archivedId,
    user_id: userId,
    text: ARCHIVED_TEXT,
    pri: 'P4',
    recurring: 0,
    flex_when: 0, placement_mode: PLACEMENT_MODES.FLEXIBLE,
    dur: 30,
    created_at: dbOrTrx.fn.now(),
    updated_at: dbOrTrx.fn.now()
  });
  return archivedId;
}

/**
 * Re-parent a list of instance ids to the user's archival master.
 * Assigns new sequential occurrence_ordinals starting after the current
 * MAX so the unique (master_id, occurrence_ordinal, split_ordinal) constraint
 * is preserved.
 */
async function archiveInstances(dbOrTrx, userId, instanceIds) {
  requireUserId(userId, 'archiveInstances');
  if (!instanceIds || instanceIds.length === 0) return 0;
  var archivedId = await getOrCreateArchivedMasterId(dbOrTrx, userId);
  var maxRow = await dbOrTrx('task_instances')
    .where('master_id', archivedId)
    .max('occurrence_ordinal as max_ord')
    .first();
  var nextOrd = (maxRow && maxRow.max_ord ? Number(maxRow.max_ord) : 0) + 1;
  // Per-row updates because each gets a unique new ordinal. For 100s of
  // archived rows this is O(N) writes — acceptable for a one-time-per-delete cost.
  for (var i = 0; i < instanceIds.length; i++) {
    await dbOrTrx('task_instances')
      .where({ id: instanceIds[i], user_id: userId })
      .update({
        master_id: archivedId,
        occurrence_ordinal: nextOrd + i,
        updated_at: dbOrTrx.fn.now()
      });
  }
  return instanceIds.length;
}

function requireUserId(userId, fn) {
  if (!userId || typeof userId !== 'string') {
    throw new Error(fn + ': userId is required (tenancy safety). Got: ' + JSON.stringify(userId));
  }
}

/**
 * Bulk UPDATE via a where-builder callback, with field routing.
 * `applyWhere` is applied to the knex builder for BOTH tables on top of
 * an enforced `.where('user_id', userId)` filter the helper adds itself.
 *
 * Signature: updateTasksWhere(dbOrTrx, userId, applyWhere, changes)
 *
 * For updates whose filter references instance-only columns (e.g. `master_id`,
 * `status`), use `updateInstancesWhere` instead.
 */
async function updateTasksWhere(dbOrTrx, userId, applyWhere, changes) {
  requireUserId(userId, 'updateTasksWhere');
  var split = splitUpdateFields(changes);
  var masterUpdated = 0;
  var instanceUpdated = 0;
  // Skip the instance-side update if the only "change" is updated_at —
  // in that case no real instance state changed, and the caller's where
  // filter may reference master-only columns (e.g. `project`) that would
  // error against task_instances.
  var instanceKeys = Object.keys(split.instance);
  var instanceHasRealChange = instanceKeys.some(function(k) { return k !== 'updated_at'; });
  // Same bail-out on the master side. The scheduler's persist path only
  // mutates instance-side columns (scheduled_at / date / time / unscheduled /
  // dur). Its batched UPDATE arrives here with master keys == only
  // updated_at. Running the master UPDATE in that case is a pure round-trip
  // cost — cache-staleness detection already picks up the instance-side
  // updated_at bump via the tasks_v UNION.
  var masterKeys = Object.keys(split.master);
  var masterHasRealChange = masterKeys.some(function(k) { return k !== 'updated_at'; });
  if (masterHasRealChange) {
    masterUpdated = await applyWhere(dbOrTrx('task_masters').where('user_id', userId)).update(split.master);
  }
  if (instanceHasRealChange) {
    instanceUpdated = await applyWhere(dbOrTrx('task_instances').where('user_id', userId)).update(split.instance);
  }
  return { masterUpdated: masterUpdated, instanceUpdated: instanceUpdated };
}

/**
 * Bulk DELETE via a where-builder callback. Helper enforces user_id filter.
 *
 * Signature: deleteTasksWhere(dbOrTrx, userId, applyWhere)
 */
async function deleteTasksWhere(dbOrTrx, userId, applyWhere) {
  requireUserId(userId, 'deleteTasksWhere');
  var instanceDeleted = await applyWhere(dbOrTrx('task_instances').where('user_id', userId)).del();
  var masterDeleted = await applyWhere(dbOrTrx('task_masters').where('user_id', userId)).del();
  return { instanceDeleted: instanceDeleted, masterDeleted: masterDeleted };
}

/**
 * Delete only the instance rows matching a filter. Helper enforces user_id.
 *
 * Signature: deleteInstancesWhere(dbOrTrx, userId, applyWhere)
 */
async function deleteInstancesWhere(dbOrTrx, userId, applyWhere) {
  requireUserId(userId, 'deleteInstancesWhere');
  return await applyWhere(dbOrTrx('task_instances').where('user_id', userId)).del();
}

/**
 * Update only the instance rows matching a filter. Helper enforces user_id
 * and applies field routing (only INSTANCE_UPDATE_FIELDS are written).
 *
 * Signature: updateInstancesWhere(dbOrTrx, userId, applyWhere, changes)
 */
async function updateInstancesWhere(dbOrTrx, userId, applyWhere, changes) {
  requireUserId(userId, 'updateInstancesWhere');
  var split = splitUpdateFields(changes);
  if (Object.keys(split.instance).length === 0) return 0;
  return await applyWhere(dbOrTrx('task_instances').where('user_id', userId)).update(split.instance);
}

module.exports = {
  insertTask: insertTask,
  insertTasksBatch: insertTasksBatch,
  archiveInstances: archiveInstances,
  updateTaskById: updateTaskById,
  deleteTaskById: deleteTaskById,
  updateTasksWhere: updateTasksWhere,
  deleteTasksWhere: deleteTasksWhere,
  deleteInstancesWhere: deleteInstancesWhere,
  updateInstancesWhere: updateInstancesWhere,
  // Exposed for tests; not part of the public API surface.
  splitUpdateFields: splitUpdateFields,
  isTemplate: isTemplate,
  isInstance: isInstance
};
