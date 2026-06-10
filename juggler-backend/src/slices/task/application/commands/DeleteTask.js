/**
 * DeleteTask — application command use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `deleteTask` HTTP handler (task.controller.js ~1377)
 * step-for-step. Branches:
 *
 *   1. read (repo.fetchTaskWithEventIds) → 404.
 *   2. ingest-only block: calendar-linked + ingest mode → 403 INGEST_DELETE_BLOCKED
 *      (cal_sync_settings read is outside the repo port → injected `loadCalSyncSettings`).
 *   3. provider-origin block (non-cascade): an active non-juggler ledger row → 403
 *      PROVIDER_ORIGIN_DELETE_BLOCKED (injected `findProviderLedgerRow`).
 *   4. cascade=recurring: a transaction that deletes the template + pending
 *      instances, archives completed ones, cleans the ledger. The raw-table block
 *      (tasks_with_sync_v reads + archiveInstances + ledger updates inside the
 *      trx) is injected as `cascadeRecurringDelete`; it returns { deletedCount,
 *      keptCount, templateId, pendingIds, keptIds } for the response + broadcast.
 *   5. recurring_instance soft-skip: repo.updateTaskById(status='skip').
 *   6. standard single-task delete: a transaction with dependency-fixup +
 *      ledger cleanup + repo.deleteTaskById (injected `standardDelete` for the raw
 *      dependency-fixup + ledger block; the delete itself goes through the repo).
 *
 * ── S4/S6 ── every branch ends with the DIRECT enqueueScheduleRun trigger (no
 * event publish in this handler — deleteTask never published; nothing to decouple).
 *
 * ── T-TX ── cascade + standard delete run inside `repo.runInTransaction(...)`.
 * ── P1 ── soft-skip update omits updated_at (repo stamps new Date()).
 * ── NO NEW FALLBACKS ── preserved verbatim.
 *
 * @typedef {Object} DeleteTaskDeps  (see constructor required list)
 */

'use strict';

/** @param {DeleteTaskDeps} deps */
function DeleteTask(deps) {
  var required = ['repo', 'cache', 'enqueueScheduleRun', 'loadCalSyncSettings',
    'findProviderLedgerRow', 'cascadeRecurringDelete', 'standardDelete'];
  for (var i = 0; i < required.length; i++) {
    if (!deps || deps[required[i]] === undefined || deps[required[i]] === null) {
      throw new Error('DeleteTask: missing dependency "' + required[i] + '"');
    }
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.loadCalSyncSettings = deps.loadCalSyncSettings;
  this.findProviderLedgerRow = deps.findProviderLedgerRow;
  this.cascadeRecurringDelete = deps.cascadeRecurringDelete;
  this.standardDelete = deps.standardDelete;
  this.PROVIDER_NAMES = { gcal: 'Google Calendar', msft: 'Microsoft Calendar', apple: 'Apple Calendar' };
}

/**
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.userId
 * @param {string} [input.cascade]  req.query.cascade.
 * @returns {Promise<{ status: number, body: Object }>}
 */
DeleteTask.prototype.execute = async function execute(input) {
  var id = input.id;
  var userId = input.userId;
  var cascade = input.cascade;

  var task = await this.repo.fetchTaskWithEventIds(id, userId);
  if (!task) return { status: 404, body: { error: 'Task not found' } };

  // ingest-only block (handler L1386-1401)
  if (task.gcal_event_id || task.msft_event_id) {
    var csSettings = await this.loadCalSyncSettings(userId);
    var _isIngest = (task.gcal_event_id && csSettings.gcal && csSettings.gcal.mode === 'ingest')
                 || (task.msft_event_id && csSettings.msft && csSettings.msft.mode === 'ingest');
    if (_isIngest) {
      return {
        status: 403,
        body: {
          error: 'Calendar-linked tasks cannot be deleted in ingest-only mode. Delete the event from your calendar instead.',
          code: 'INGEST_DELETE_BLOCKED'
        }
      };
    }
  }

  // provider-origin block (non-cascade) (handler L1403-1419)
  var isCascadeDelete = cascade === 'recurring';
  if (!isCascadeDelete) {
    var providerLedgerRow = await this.findProviderLedgerRow(userId, id);
    if (providerLedgerRow) {
      var providerName = this.PROVIDER_NAMES[providerLedgerRow.provider] || providerLedgerRow.provider;
      return {
        status: 403,
        body: {
          error: 'This task came from ' + providerName + '. To remove it, delete it from ' + providerName + ' directly.',
          code: 'PROVIDER_ORIGIN_DELETE_BLOCKED',
          provider: providerLedgerRow.provider
        }
      };
    }
  }

  // cascade recurring delete (handler L1421-1509)
  if (cascade === 'recurring') {
    var templateId = id;
    if (task.task_type === 'recurring_instance' || task.source_id) {
      templateId = task.source_id || id;
    }
    var result = await this.repo.runInTransaction(async function (trxRepo) {
      return this.cascadeRecurringDelete({ trxRepo: trxRepo, userId: userId, templateId: templateId });
    }.bind(this));
    await this.cache.invalidateTasks(userId);
    this.enqueueScheduleRun(userId, 'api:deleteTask:cascade',
      [templateId].concat(result.pendingIds || []).concat(result.keptIds || []));
    return {
      status: 200,
      body: {
        message: 'Recurring deleted',
        templateId: templateId,
        deletedInstances: result.deletedCount,
        keptInstances: result.keptCount
      }
    };
  }

  // recurring_instance soft-skip (handler L1520-1528)
  if (task.task_type === 'recurring_instance') {
    await this.repo.updateTaskById(id, { status: 'skip' }, userId);
    await this.cache.invalidateTasks(userId);
    this.enqueueScheduleRun(userId, 'api:deleteTask:softSkip', [id]);
    return { status: 200, body: { message: 'Recurring instance skipped', id: id, softDelete: true } };
  }

  // standard single-task delete (handler L1530-1568)
  await this.repo.runInTransaction(async function (trxRepo) {
    await this.standardDelete({ trxRepo: trxRepo, userId: userId, id: id, task: task });
  }.bind(this));
  await this.cache.invalidateTasks(userId);
  this.enqueueScheduleRun(userId, 'api:deleteTask', [id]);
  return { status: 200, body: { message: 'Task deleted', id: id } };
};

module.exports = DeleteTask;
