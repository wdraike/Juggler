/**
 * DeleteTask — application command use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `deleteTask` HTTP handler (task.controller.js ~1377)
 * step-for-step. Branches (with 999.680 delete scope support):
 *
 *   1. read (repo.fetchTaskWithEventIds) → 404.
 *   2. ingest-only block: calendar-linked + ingest mode → 403 INGEST_DELETE_BLOCKED
 *      (cal_sync_settings read is outside the repo port → injected `loadCalSyncSettings`).
 *   3. provider-origin block (non-cascade): an active non-juggler ledger row → 403
 *      PROVIDER_ORIGIN_DELETE_BLOCKED (injected `findProviderLedgerRow`).
 *   4. cascade=recurring / scope=series: a transaction that deletes the template +
 *      ALL instances, cleans the ledger. The raw-table block is injected as
 *      `cascadeRecurringDelete`; it returns { deletedCount, keptCount, templateId,
 *      pendingIds, keptIds } for the response + broadcast.
 *   5. scope=instance: for a recurring_instance, do a standard single-task delete
 *      (delete just that instance row). For a template, same as standard single-task.
 *   6. scope=this_and_future: for recurring templates, deletes the current instance
 *      + all future (unscheduled / status='') instances, plus the template itself.
 *      Completed/past instances are kept. Injected as `thisAndFutureDelete`.
 *   7. recurring_instance soft-skip (no scope): repo.updateTaskById(status='skip').
 *   8. standard single-task delete (no scope, non-recurring): a transaction with
 *      dependency-fixup + ledger cleanup + repo.deleteTaskById (injected
 *      `standardDelete`).
 *
 * ── S4/S6 ── every branch ends with the DIRECT enqueueScheduleRun trigger (no
 * event publish in this handler — deleteTask never published; nothing to decouple).
 *
 * ── T-TX ── cascade + standard + this-and-future delete run inside
 * `repo.runInTransaction(...)`.
 * ── P1 ── soft-skip update omits updated_at (repo stamps new Date()).
 * ── NO NEW FALLBACKS ── preserved verbatim.
 *
 * @typedef {Object} DeleteTaskDeps  (see constructor required list)
 */

'use strict';

var assertDeps = require('../_assertDeps');

/** @param {DeleteTaskDeps} deps */
function DeleteTask(deps) {
  var required = ['repo', 'cache', 'enqueueScheduleRun', 'loadCalSyncSettings',
    'findProviderLedgerRow', 'cascadeRecurringDelete', 'standardDelete',
    'thisAndFutureDelete'];
  assertDeps('DeleteTask', deps, required);
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.loadCalSyncSettings = deps.loadCalSyncSettings;
  this.findProviderLedgerRow = deps.findProviderLedgerRow;
  this.cascadeRecurringDelete = deps.cascadeRecurringDelete;
  this.standardDelete = deps.standardDelete;
  this.thisAndFutureDelete = deps.thisAndFutureDelete;
  this.PROVIDER_NAMES = { gcal: 'Google Calendar', msft: 'Microsoft Calendar', apple: 'Apple Calendar' };
}

/**
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.userId
 * @param {string} [input.cascade]  req.query.cascade (legacy).
 * @param {string} [input.scope]    req.query.scope: 'instance' | 'series' | 'this_and_future'.
 * @returns {Promise<{ status: number, body: Object }>}
 */
DeleteTask.prototype.execute = async function execute(input) {
  var id = input.id;
  var userId = input.userId;
  var cascade = input.cascade || '';
  var scope = input.scope || '';

  // Normalize: cascade=recurring (legacy) maps to scope=series
  if (!scope && cascade === 'recurring') {
    scope = 'series';
  }

  // Validate scope values
  var validScopes = ['instance', 'series', 'this_and_future'];
  if (scope && validScopes.indexOf(scope) === -1) {
    return { status: 400, body: { error: 'Invalid scope. Use instance, series, or this_and_future.' } };
  }

  var task = await this.repo.fetchTaskWithEventIds(id, userId);
  if (!task) return { status: 404, body: { error: 'Task not found' } };

  // When scope=instance is specified for a recurring_instance, skip the soft-skip
  // and do a hard delete instead (delete just this one instance).
  // For non-recurring tasks, scope makes no difference — single delete.
  var _isRecurringTemplate = task.task_type === 'recurring_template' || (task.recurring && task.task_type !== 'recurring_instance');
  var isRecurringInstance = task.task_type === 'recurring_instance';

  // ingest-only block (handler L1386-1401) — skip for scope=instance (just deleting one row)
  var skipIngestCheck = scope === 'instance';
  if (!skipIngestCheck && (task.gcal_event_id || task.msft_event_id)) {
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
  var isSeriesDelete = scope === 'series';
  if (!isSeriesDelete) {
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

  // ── scope=series (replaces legacy cascade=recurring) ──────────────────────
  if (scope === 'series') {
    var templateId = id;
    if (isRecurringInstance) {
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
        message: 'Recurring series deleted',
        templateId: templateId,
        deletedInstances: result.deletedCount,
        keptInstances: result.keptCount
      }
    };
  }

  // ── scope=instance ────────────────────────────────────────────────────────
  // For any task type: delete just that single row (no cascade).
  // For recurring_instance: hard-delete the instance instead of soft-skip.
  // For recurring template: like standard delete but without the recurring cascade.
  // For non-recurring: same as standard delete.
  if (scope === 'instance') {
    await this.repo.runInTransaction(async function (trxRepo) {
      await this.standardDelete({ trxRepo: trxRepo, userId: userId, id: id, task: task });
    }.bind(this));
    await this.cache.invalidateTasks(userId);
    this.enqueueScheduleRun(userId, 'api:deleteTask:instance', [id]);
    return { status: 200, body: { message: 'Instance deleted', id: id } };
  }

  // ── scope=this_and_future ────────────────────────────────────────────────
  // For recurring templates: delete current instance + all future (pending) instances + template.
  // Completed/past instances are kept.
  if (scope === 'this_and_future') {
    var tplId = id;
    if (isRecurringInstance) {
      tplId = task.source_id || id;
    }
    var tfResult = await this.repo.runInTransaction(async function (trxRepo) {
      return this.thisAndFutureDelete({ trxRepo: trxRepo, userId: userId, id: id, templateId: tplId, task: task });
    }.bind(this));
    await this.cache.invalidateTasks(userId);
    this.enqueueScheduleRun(userId, 'api:deleteTask:thisAndFuture',
      [tplId].concat(tfResult.pendingIds || []).concat(tfResult.keptIds || []));
    return {
      status: 200,
      body: {
        message: 'This and future instances deleted',
        templateId: tplId,
        deletedInstances: tfResult.deletedCount,
        keptInstances: tfResult.keptCount
      }
    };
  }

  // ── No explicit scope: legacy behavior ────────────────────────────────────
  // recurring_instance soft-skip (handler L1520-1528)
  if (isRecurringInstance) {
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
