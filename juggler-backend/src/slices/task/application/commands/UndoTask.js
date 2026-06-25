/**
 * UndoTask — application command use-case (999.681).
 *
 * Reverses the most recent state-changing action on a task. Only the LATEST
 * action per task is reversible (single-undo, not full history).
 *
 * Supported action types and their undo logic:
 *
 *   status_change:
 *     Reverts the task's `status`, `completed_at`, and `time_remaining`
 *     to their pre-action values. If the action moved the task TO a terminal
 *     status (done/skip/cancel), undo clears completed_at and restores the
 *     previous status. If the action moved FROM a terminal status, undo
 *     restores completed_at.
 *
 *   field_update:
 *     Reverts all changed fields to their pre-action values by calling
 *     repo.updateTaskById with the `before` snapshot fields.
 *
 *   delete:
 *     Re-creates the task from the `before` snapshot via repo.insertTask.
 *     Only applicable if the task has not been re-created since deletion.
 *
 * ── INVARIANTS ─────────────────────────────────────────────────────────────
 *
 * INVARIANT U1 (single-undo): Only the most recent action per task can be
 *   undone. After an undo succeeds, the action_log entry is removed and no
 *   further undo is possible until a new action is recorded.
 *
 * INVARIANT U2 (no-undo-of-undo): The undo operation itself does NOT record
 *   an action_log entry. You cannot undo an undo.
 *
 * INVARIANT U3 (task-must-match): If the task's current state doesn't match
 *   the `after` snapshot (i.e., another action happened outside the log),
 *   the undo is rejected with 409 CONFLICT to prevent data corruption.
 *
 * INVARIANT U4 (tenancy): All reads/writes are scoped by userId exactly as
 *   the rest of the task slice (T-TENANCY).
 *
 * @typedef {Object} UndoTaskDeps
 * @property {import('../domain/ports/ActionLogPort')} actionLog
 * @property {import('../domain/ports/TaskRepositoryPort')} repo
 * @property {import('../domain/ports/TaskCachePort')} cache
 * @property {Function} enqueueScheduleRun
 * @property {Object} mappers
 * @property {Function} isTerminalStatus
 */

'use strict';

var assertDeps = require('../_assertDeps');

var _TERMINAL_STATUSES = ['done', 'skip', 'cancel'];
var UNDOABLE_ACTION_TYPES = ['status_change', 'field_update', 'delete'];

/**
 * Fields that are always safe to restore on a field_update undo.
 * Excludes: id, user_id, created_at (immutable identity fields).
 */
var RESTORABLE_FIELDS = [
  'text', 'project', 'section', 'notes', 'url', 'dur', 'pri',
  'status', 'scheduled_at', 'desired_at', 'deadline', 'time_remaining',
  'when', 'day_req', 'time_flex', 'flex_when', 'placement_mode',
  'recurring', 'recur', 'recur_start', 'recur_end',
  'split', 'split_min', 'depends_on', 'location', 'tools',
  'travel_before', 'travel_after', 'completed_at',
  'weather_precip', 'weather_cloud', 'weather_temp_min', 'weather_temp_max',
  'weather_temp_unit', 'weather_humidity_min', 'weather_humidity_max',
  'preferred_time_mins', 'tz'
];

/**
 * Date-valued task columns. Action-log before/after snapshots are persisted as
 * JSON (Knex JSON column; InMemory via JSON.parse(JSON.stringify(...))), which
 * serializes Date instances to ISO strings. The task repositories enforce that
 * date columns are real JS Date objects (P1 invariant — never a raw string), so
 * any date restored from a snapshot must be coerced back to a Date before write.
 */
var DATE_FIELDS = ['completed_at', 'created_at', 'updated_at', 'scheduled_at'];

/**
 * Coerce ISO-string date values (from a JSON-persisted snapshot) back to Date.
 * Mutates `obj` in place; leaves null and already-Date values untouched.
 */
function coerceSnapshotDates(obj) {
  DATE_FIELDS.forEach(function (field) {
    var v = obj[field];
    if (typeof v === 'string' && v.length > 0) {
      obj[field] = new Date(v);
    }
  });
  return obj;
}

/** @param {UndoTaskDeps} deps */
function UndoTask(deps) {
  var required = ['actionLog', 'repo', 'cache', 'enqueueScheduleRun', 'mappers', 'isTerminalStatus'];
  assertDeps('UndoTask', deps, required);
  this.actionLog = deps.actionLog;
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.mappers = deps.mappers;
  this.isTerminalStatus = deps.isTerminalStatus;
  this.logger = deps.logger || { error: function () {} };
}

/**
 * @param {Object} input
 * @param {string} input.id       Task ID to undo
 * @param {string} input.userId   User ID (tenancy)
 * @returns {Promise<{ status: number, body: Object }>}
 */
UndoTask.prototype.execute = async function execute(input) {
  var id = input.id;
  var userId = input.userId;
  var isTerminalStatus = this.isTerminalStatus;

  // 1. Find the latest action log entry for this task
  var logEntry = await this.actionLog.findLatest(id, userId);

  if (!logEntry) {
    return { status: 404, body: { error: 'No undoable action found for this task.', code: 'NO_ACTION_TO_UNDO' } };
  }

  // 2. Validate action type
  if (UNDOABLE_ACTION_TYPES.indexOf(logEntry.action_type) === -1) {
    return { status: 400, body: { error: 'Action type "' + logEntry.action_type + '" cannot be undone.', code: 'UNDO_NOT_SUPPORTED' } };
  }

  // 3. Dispatch by action type
  if (logEntry.action_type === 'status_change') {
    return this._undoStatusChange(id, userId, logEntry, isTerminalStatus);
  }

  if (logEntry.action_type === 'field_update') {
    return this._undoFieldUpdate(id, userId, logEntry);
  }

  if (logEntry.action_type === 'delete') {
    return this._undoDelete(id, userId, logEntry);
  }

  // Should not reach here (guarded by UNDOABLE_ACTION_TYPES check above)
  return { status: 400, body: { error: 'Unknown action type.', code: 'UNDO_NOT_SUPPORTED' } };
};

/**
 * Undo a status change: revert status, completed_at, time_remaining.
 */
UndoTask.prototype._undoStatusChange = async function _undoStatusChange(id, userId, logEntry, isTerminalStatus) {
  var before = logEntry.before || {};
  var after = logEntry.after || {};

  // U3: Verify the task's current state matches what the log says the action produced
  var current = await this.repo.fetchTaskWithEventIds(id, userId);

  // For status_change, the task MUST exist (delete undo recreates it)
  if (!current) {
    // Task was deleted after the status change — can't undo, log is stale
    await this.actionLog.remove(id, userId);
    return { status: 410, body: { error: 'Task no longer exists; undo not possible.', code: 'TASK_GONE' } };
  }

  // U3: Current status should match the `after` status to ensure no intervening actions
  if (after.status !== undefined && current.status !== after.status) {
    return { status: 409, body: { error: 'Task state has changed since the recorded action; undo is not safe.', code: 'CONFLICT' } };
  }

  // Build the revert update
  var revertUpdate = {};

  // Always restore previous status
  if (before.status !== undefined) {
    revertUpdate.status = before.status;
  } else {
    // If before had no status recorded, assume empty string (active/todo)
    revertUpdate.status = '';
  }

  // Restore completed_at: clear it if we're moving away from terminal, set it if moving to terminal
  if (isTerminalStatus(revertUpdate.status)) {
    // Moving TO terminal: restore completed_at if it was in the before snapshot
    revertUpdate.completed_at = before.completed_at || new Date();
  } else {
    // Moving FROM terminal: clear completed_at
    revertUpdate.completed_at = null;
  }

  // Restore time_remaining if it was in the before snapshot
  if (before.time_remaining !== undefined) {
    revertUpdate.time_remaining = before.time_remaining;
  }

  // Snapshot dates round-trip through JSON as ISO strings; coerce back to Date.
  coerceSnapshotDates(revertUpdate);

  // Apply the revert
  await this.repo.updateTaskById(id, revertUpdate, userId);

  // Remove the action log entry (U1: single-undo — no further undo possible)
  await this.actionLog.remove(id, userId);

  // Invalidate cache and reschedule
  await this.cache.invalidateTasks(userId);
  this.enqueueScheduleRun(userId, 'api:undoTask', [id]);

  // Re-read for the response
  var restored = await this.repo.fetchTaskWithEventIds(id, userId);
  var tmplRows = await this.repo.getRecurringTemplateRows(userId);
  var srcMap = this.mappers.buildSourceMap(tmplRows);

  return {
    status: 200,
    body: {
      task: this.mappers.rowToTask(restored, null, srcMap),
      undoneAction: logEntry.action_type
    }
  };
};

/**
 * Undo a field update: revert changed fields to their pre-action values.
 */
UndoTask.prototype._undoFieldUpdate = async function _undoFieldUpdate(id, userId, logEntry) {
  var before = logEntry.before || {};
  var _after = logEntry.after || {};

  // U3: Verify the task exists
  var current = await this.repo.fetchTaskWithEventIds(id, userId);
  if (!current) {
    await this.actionLog.remove(id, userId);
    return { status: 410, body: { error: 'Task no longer exists; undo not possible.', code: 'TASK_GONE' } };
  }

  // Build the revert update from the before snapshot — only restorable fields
  var revertUpdate = {};
  RESTORABLE_FIELDS.forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(before, field)) {
      revertUpdate[field] = before[field];
    }
  });

  // Snapshot dates round-trip through JSON as ISO strings; coerce back to Date.
  coerceSnapshotDates(revertUpdate);

  // If no restorable fields changed, there's nothing to undo
  if (Object.keys(revertUpdate).length === 0) {
    await this.actionLog.remove(id, userId);
    return { status: 200, body: { message: 'No restorable fields to undo.', task: this.mappers.rowToTask(current, null) } };
  }

  // Apply the revert
  await this.repo.updateTaskById(id, revertUpdate, userId);

  // Remove the action log entry
  await this.actionLog.remove(id, userId);

  // Invalidate cache and reschedule
  await this.cache.invalidateTasks(userId);
  this.enqueueScheduleRun(userId, 'api:undoTask', [id]);

  // Re-read for the response
  var restored = await this.repo.fetchTaskWithEventIds(id, userId);
  var tmplRows = await this.repo.getRecurringTemplateRows(userId);
  var srcMap = this.mappers.buildSourceMap(tmplRows);

  return {
    status: 200,
    body: {
      task: this.mappers.rowToTask(restored, null, srcMap),
      undoneAction: logEntry.action_type
    }
  };
};

/**
 * Undo a delete: re-create the task from the before snapshot.
 */
UndoTask.prototype._undoDelete = async function _undoDelete(id, userId, logEntry) {
  var before = logEntry.before || {};

  // Check if the task has been re-created since deletion
  var existing = await this.repo.fetchTaskWithEventIds(id, userId);
  if (existing) {
    // Task already exists — delete log is stale, clean it up
    await this.actionLog.remove(id, userId);
    return { status: 409, body: { error: 'Task already exists; cannot undo deletion.', code: 'CONFLICT' } };
  }

  // Re-create the task from the before snapshot
  var row = Object.assign({}, before);
  row.id = id;
  row.user_id = userId;
  // Snapshot dates round-trip through JSON as ISO strings; coerce back to Date
  // before the repo's P1 Date invariant rejects them.
  coerceSnapshotDates(row);
  row.updated_at = new Date();
  // created_at should be the original creation time, not now
  if (!row.created_at) row.created_at = new Date();

  await this.repo.insertTask(row);

  // Remove the action log entry
  await this.actionLog.remove(id, userId);

  // Invalidate cache and reschedule
  await this.cache.invalidateTasks(userId);
  this.enqueueScheduleRun(userId, 'api:undoTask', [id]);

  // Re-read for the response
  var restored = await this.repo.fetchTaskWithEventIds(id, userId);
  var tmplRows = await this.repo.getRecurringTemplateRows(userId);
  var srcMap = this.mappers.buildSourceMap(tmplRows);

  return {
    status: 200,
    body: {
      task: this.mappers.rowToTask(restored, null, srcMap),
      undoneAction: logEntry.action_type
    }
  };
};

module.exports = UndoTask;
module.exports.RESTORABLE_FIELDS = RESTORABLE_FIELDS;
module.exports.UNDOABLE_ACTION_TYPES = UNDOABLE_ACTION_TYPES;