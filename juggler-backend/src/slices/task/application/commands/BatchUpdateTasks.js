/**
 * BatchUpdateTasks — application command use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `batchUpdateTasks` HTTP handler (task.controller.js ~1955)
 * step-for-step:
 *
 *   1. zod batchUpdateSchema.safeParse (injected) → 400.
 *   2. array guards (empty → 400; > 2000 → 400).
 *   3. per-item validateTaskInput (pure) → 400 'Update item <i> (<id>): ...'.
 *   4. lock check (injected isLocked): if locked → injected `lockedBatchUpdate`
 *      collaborator (the legacy locked block: preload existing + ledger origins,
 *      split scheduling/non-scheduling, direct-write non-scheduling, queue
 *      scheduling). Returns { updatedCount, queuedCount, idsToCheck, calSyncGuard? }.
 *      A calSyncGuard → 403. Then invalidate + enqueueScheduleRun(skipEmit/
 *      skipScheduler) → { updated, queued }.
 *   5. unlocked: a MAX_RETRIES deadlock-retry loop around
 *      repo.runInTransaction(injected `batchUpdateTxn`) — the legacy transactional
 *      per-item routing (template/instance split, recur cleanup, anchor routing).
 *      Returns { updatedCount, anySchedulingInBatch }; a thrown calSyncGuard → 403;
 *      ER_LOCK_DEADLOCK retries with backoff; else rethrow.
 *      Then invalidate + enqueueScheduleRun(skipScheduler) → { updated }.
 *
 * ── S4/S6 ── enqueueScheduleRun is the SOLE trigger (no event publish in this
 * handler). ── T-TX ── unlocked path runs inside repo.runInTransaction.
 * ── P1 ── all updated_at stamping is the repo's (new Date()), not fn.now().
 * ── NO NEW FALLBACKS ── preserved verbatim.
 *
 * The per-item transactional routing + the locked-path body touch tables the repo
 * port does not model (tasks_with_sync_v, cal_sync_ledger preloads; recur cleanup)
 * → injected collaborators, the legacy blocks lifted verbatim, wired by W6.
 *
 * @typedef {Object} BatchUpdateTasksDeps  (see constructor required list)
 */

'use strict';

var MAX_RETRIES = 3;

/** @param {BatchUpdateTasksDeps} deps */
function BatchUpdateTasks(deps) {
  var required = ['repo', 'cache', 'enqueueScheduleRun', 'validation',
    'batchUpdateSchema', 'safeTimezone', 'isLocked', 'lockedBatchUpdate',
    'batchUpdateTxn', 'sleep'];
  for (var i = 0; i < required.length; i++) {
    if (!deps || deps[required[i]] === undefined || deps[required[i]] === null) {
      throw new Error('BatchUpdateTasks: missing dependency "' + required[i] + '"');
    }
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.validation = deps.validation;
  this.batchUpdateSchema = deps.batchUpdateSchema;
  this.safeTimezone = deps.safeTimezone;
  this.isLocked = deps.isLocked;
  this.lockedBatchUpdate = deps.lockedBatchUpdate;
  this.batchUpdateTxn = deps.batchUpdateTxn;
  this.sleep = deps.sleep;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {Object} input.body  `{ updates: [...] }`.
 * @param {string} [input.timezoneHeader]
 * @returns {Promise<{ status: number, body: Object }>}
 */
BatchUpdateTasks.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var body = input.body;
  var self = this;

  // 1. zod (handler L1956-1957)
  var batchUpdateParsed = this.batchUpdateSchema.safeParse(body);
  if (!batchUpdateParsed.success) {
    return { status: 400, body: { error: 'Invalid batch payload', details: batchUpdateParsed.error.issues } };
  }

  var updates = body.updates;
  // 2. array guards (handler L1960-1966)
  if (!Array.isArray(updates) || updates.length === 0) {
    return { status: 400, body: { error: 'Updates array required' } };
  }
  if (updates.length > 2000) {
    return { status: 400, body: { error: 'Batch limited to 2000 items' } };
  }

  // 3. per-item validate (handler L1968-1978)
  for (var bvi = 0; bvi < updates.length; bvi++) {
    var bvItem = updates[bvi];
    if (!bvItem || !bvItem.id) continue;
    var bvFields = {};
    Object.keys(bvItem).forEach(function (k) { if (k !== 'id') bvFields[k] = bvItem[k]; });
    var bvErrs = this.validation.validateTaskInput(bvFields);
    if (bvErrs.length > 0) {
      return { status: 400, body: { error: 'Update item ' + bvi + ' (' + bvItem.id + '): ' + bvErrs.join('; ') } };
    }
  }

  var tz = this.safeTimezone(input.timezoneHeader);

  // 4. lock check (handler L1988-2061)
  var locked = await this.isLocked(userId);
  if (locked) {
    var lockedResult = await this.lockedBatchUpdate({ userId: userId, updates: updates, tz: tz, repo: this.repo });
    if (lockedResult.calSyncGuard) {
      return { status: 403, body: lockedResult.calSyncGuard };
    }
    await this.cache.invalidateTasks(userId);
    this.enqueueScheduleRun(userId, 'api:batchUpdateTasks', lockedResult.idsToCheck, {
      skipEmit: lockedResult.queuedCount > 0,
      skipScheduler: lockedResult.queuedCount === 0
    });
    return { status: 200, body: { updated: lockedResult.updatedCount, queued: lockedResult.queuedCount } };
  }

  // 5. unlocked: deadlock-retry loop (handler L2063-2252)
  var updatedCount = 0;
  var anySchedulingInBatch = false;
  for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      var txnResult = await this.repo.runInTransaction(function (trxRepo) {
        return self.batchUpdateTxn({ trxRepo: trxRepo, userId: userId, updates: updates, tz: tz });
      });
      updatedCount = txnResult.updatedCount;
      anySchedulingInBatch = txnResult.anySchedulingInBatch;
      break;
    } catch (err) {
      if (err.calSyncGuard) {
        return { status: 403, body: err.calSyncGuard };
      }
      if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
        await this.sleep(200 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }

  await this.cache.invalidateTasks(userId);
  this.enqueueScheduleRun(userId, 'api:batchUpdateTasks',
    updates.map(function (u) { return u.id; }).filter(Boolean),
    { skipScheduler: !anySchedulingInBatch });
  return { status: 200, body: { updated: updatedCount } };
};

module.exports = BatchUpdateTasks;
module.exports.MAX_RETRIES = MAX_RETRIES;
