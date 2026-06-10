/**
 * TakeOwnership — application command use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `takeOwnership` HTTP handler (task.controller.js ~2394)
 * step-for-step. Detaches a provider-origin task from its calendar link so
 * Juggler owns the schedule:
 *
 *   1. read (repo.fetchTaskWithEventIds) → 404.
 *   2. transaction: mark active ledger rows deleted_local (raw cal_sync_ledger
 *      update — outside the repo port → injected `detachLedger`), then clear event
 *      ids + recompute `when` + set placement_mode='anytime' via
 *      repo.updateTaskById (guard intentionally bypassed — the cal link was just
 *      removed in the same transaction).
 *   3. invalidate, srcMap re-read, enqueueScheduleRun (SOLE trigger), 200.
 *
 * ── T-TX ── runs inside repo.runInTransaction.
 * ── P1 ── the repo.updateTaskById omits updated_at (repo stamps new Date()); the
 *   legacy passed trx.fn.now() — corrected here. The ledger `synced_at` is written
 *   by the injected `detachLedger` collaborator (cal_sync_ledger is outside this
 *   repo's P1 scope, exactly as KnexTaskRepository documents).
 * ── S4/S6 ── enqueueScheduleRun is the SOLE trigger (no event publish here).
 * ── NO NEW FALLBACKS ── the `when` recomputation + `task.when || ''` preserved.
 *
 * @typedef {Object} TakeOwnershipDeps  (see constructor required list)
 */

'use strict';

/** @param {TakeOwnershipDeps} deps */
function TakeOwnership(deps) {
  var required = ['repo', 'cache', 'enqueueScheduleRun', 'mappers', 'detachLedger', 'placementModes'];
  for (var i = 0; i < required.length; i++) {
    if (!deps || deps[required[i]] === undefined || deps[required[i]] === null) {
      throw new Error('TakeOwnership: missing dependency "' + required[i] + '"');
    }
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.mappers = deps.mappers;
  this.detachLedger = deps.detachLedger;
  this.PLACEMENT_MODES = deps.placementModes;
}

/**
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.userId
 * @returns {Promise<{ status: number, body: Object }>}
 */
TakeOwnership.prototype.execute = async function execute(input) {
  var id = input.id;
  var userId = input.userId;
  var PLACEMENT_MODES = this.PLACEMENT_MODES;
  var self = this;

  var task = await this.repo.fetchTaskWithEventIds(id, userId);
  if (!task) return { status: 404, body: { error: 'Task not found' } };

  await this.repo.runInTransaction(async function (trxRepo) {
    // mark all active ledger rows deleted_local (raw cal_sync_ledger — injected).
    await self.detachLedger({ trxRepo: trxRepo, id: id, userId: userId });

    // clear event ids + recompute when + placement_mode=anytime (handler L2407-2418)
    var clearFields = {};
    if (task.gcal_event_id) clearFields.gcal_event_id = null;
    if (task.msft_event_id) clearFields.msft_event_id = null;
    if (task.apple_event_id) clearFields.apple_event_id = null;
    var currentWhen = task.when || '';
    var newWhen = currentWhen.split(',').map(function (t) { return t.trim(); }).filter(Boolean).join(',');
    clearFields.when = newWhen;
    clearFields.placement_mode = PLACEMENT_MODES.ANYTIME;
    await trxRepo.updateTaskById(id, clearFields, userId);
  });

  await this.cache.invalidateTasks(userId);
  var templateRows = await this.repo.getRecurringTemplateRows(userId);
  var srcMap = this.mappers.buildSourceMap(templateRows);
  var updated = await this.repo.fetchTaskWithEventIds(id, userId);
  this.enqueueScheduleRun(userId, 'api:takeOwnership', [id]);
  return { status: 200, body: { task: this.mappers.rowToTask(updated, null, srcMap) } };
};

module.exports = TakeOwnership;
