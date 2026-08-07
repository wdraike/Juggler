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
 * ── 999.5288/999.5291 (LOCK PATH, resolved) ── UpdateTaskStatus now queues
 * status writes under an active sync lock (999.5288), which created a NEW race:
 * "complete X (queued) -> delete X (direct, soft-cancel) -> lock releases ->
 * flush replays the queued {status:'done'} over the cancelled row" resurrects
 * a task the user deleted. Before status writes were queued, both writes were
 * direct and real time ordered them (delete won); queueing broke that.
 *
 * Two DIFFERENT fixes, chosen per branch after tracing what each one actually
 * writes (999.5291 narrowed the original "DeleteTask cannot be queued at all"
 * claim — that only holds for the multi-row branches):
 *
 *   - cascadeRecurringDelete (scope=series), standardDelete (scope=instance
 *     and the no-scope default) and thisAndFutureDelete (scope=this_and_future)
 *     stay DIRECT writes — ledger cleanup, JSON_CONTAINS dependency fixups and
 *     multi-row cascades are not representable in the write-queue's single-row
 *     {operation,fields} replay model (duplicating them into
 *     task-write-queue.js is the Fork-Drift trap; reaching from the queue lib
 *     back into slices/task/facade.js's collaborators would close a NEW
 *     require cycle at an already-capped budget). Each of these branches now
 *     calls `discardQueuedWrites(userId, taskId)` (via `_discardIds`) for
 *     EVERY row it soft-cancelled, AFTER the write lands, so a stale queued
 *     write for that same task can never replay over it.
 *   - The recurring_instance soft-skip branch (no scope) is different: it is
 *     a plain single-row `updateTaskById({status:'skip', scheduled_at})` —
 *     exactly the queue's `update` shape, no ledger, no cascade. It is routed
 *     through the SAME isLocked+splitFields+enqueueWrite idiom
 *     UpdateTaskStatus._writeTaskFields uses (`_writeTaskFields` below),
 *     so it QUEUES (coalescing correctly with any earlier queued write for
 *     the same instance) rather than writing-then-discarding. This also
 *     closes the narrower residual risk 999.5291 flagged (a direct DeleteTask
 *     write still racing the sync's own write-phase transaction while
 *     locked) for this one branch, which discard-after-write cannot.
 *
 * The write-queue's `delete` operation verb stays dead code (999.5291 finding
 * (1)): it hard-deletes, contradicting R55 soft-cancel, and none of the above
 * branches route through it.
 *
 * @typedef {Object} DeleteTaskDeps  (see constructor required list)
 */

'use strict';

var assertDeps = require('../_assertDeps');

/** @param {DeleteTaskDeps} deps */
function DeleteTask(deps) {
  var required = ['repo', 'cache', 'enqueueScheduleRun', 'loadCalSyncSettings',
    'findProviderLedgerRow', 'findCalLockedSeriesInstance', 'cascadeRecurringDelete',
    'standardDelete', 'thisAndFutureDelete',
    // 999.5288/999.5291: discardQueuedWrites guards the direct-write branches;
    // isLocked/enqueueWrite/splitFieldsLib gate the queued soft-skip branch.
    'discardQueuedWrites', 'isLocked', 'enqueueWrite', 'splitFieldsLib'];
  assertDeps('DeleteTask', deps, required);
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.loadCalSyncSettings = deps.loadCalSyncSettings;
  this.findProviderLedgerRow = deps.findProviderLedgerRow;
  this.discardQueuedWrites = deps.discardQueuedWrites;
  this.isLocked = deps.isLocked;
  this.enqueueWrite = deps.enqueueWrite;
  this.splitFields = deps.splitFieldsLib.splitFields;
  // FR-6 (juggler-recur-lifecycle-redesign, series cal_locked delete gate):
  // REQUIRED (FIX bert ernie-w2-callocked-gate-failopen-default, 2026-07-09) —
  // this is a safety gate; a fail-OPEN `|| noop` default here would silently
  // disable the FR-6/AC7 cal_locked delete gate for any future construction
  // that omits the collaborator. No unapproved fallback on a maybe-missing
  // safety-gate dependency (project invariant) — callers MUST supply it
  // explicitly. Production wiring (facade.js) already does; test fixtures
  // updated to pass it explicitly (commands-status-delete-misc.test.js,
  // reschedule-triggers-inventory.test.js).
  this.findCalLockedSeriesInstance = deps.findCalLockedSeriesInstance;
  this.cascadeRecurringDelete = deps.cascadeRecurringDelete;
  this.standardDelete = deps.standardDelete;
  this.thisAndFutureDelete = deps.thisAndFutureDelete;
  this.PROVIDER_NAMES = { gcal: 'Google Calendar', msft: 'Microsoft Calendar', apple: 'Apple Calendar' };
}

/**
 * 999.5288 — discard any queued write for every id one of the direct-write
 * branches (standardDelete/cascadeRecurringDelete/thisAndFutureDelete) just
 * soft-cancelled, so a stale queued status write (e.g. a completion queued
 * before the delete) can never replay over the row after it lands. Called
 * AFTER the branch's direct write, so the discard is ordered after the
 * delete and cannot race ahead of it. Safe/idempotent when nothing was
 * queued (0-row delete) — called unconditionally, not just under an active
 * lock, since a crashed/expired lock can leave stale queue rows behind even
 * once isLocked() reads false.
 * @returns {Promise<void>}
 */
DeleteTask.prototype._discardIds = async function _discardIds(userId, ids) {
  var self = this;
  await Promise.all(ids.map(function (taskId) { return self.discardQueuedWrites(userId, taskId); }));
};

/**
 * 999.5291 — locked-aware row write for the recurring-instance soft-skip
 * branch ONLY (the one DeleteTask branch that is a plain single-row update,
 * the queue's exact shape). Mirrors UpdateTaskStatus._writeTaskFields
 * verbatim: unlocked writes directly (unchanged behavior); locked splits
 * fields and defers scheduling fields via enqueueWrite, applied by
 * task-write-queue.js's flush once the lock releases.
 * @returns {Promise<{queued: boolean}>}
 */
DeleteTask.prototype._writeTaskFields = async function _writeTaskFields(id, userId, fields, source) {
  var locked = await this.isLocked(userId);
  if (!locked) {
    await this.repo.updateTaskById(id, fields, userId);
    return { queued: false };
  }
  var split = this.splitFields(fields);
  if (Object.keys(split.nonSchedulingFields).length > 0) {
    await this.repo.updateTaskById(id, split.nonSchedulingFields, userId);
  }
  if (Object.keys(split.schedulingFields).length > 0) {
    await this.enqueueWrite(userId, id, 'update', split.schedulingFields, source);
    return { queued: true };
  }
  return { queued: false };
};

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

  // When scope=instance is specified for a recurring_instance, standardDelete()
  // soft-cancels just this one instance (R55 — status='cancelled', row kept).
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

    // FR-6 (juggler-recur-lifecycle-redesign): cal_locked delete gate. The
    // provider-origin block above is explicitly skipped for series-delete
    // (isSeriesDelete), so this is the ONLY cal_locked/provider-origin check
    // a series-delete goes through. Blocks the delete BEFORE any mutation if
    // any instance in the series (or the template itself) is calendar-born.
    var lockedInstance = await this.findCalLockedSeriesInstance(userId, templateId);
    if (lockedInstance) {
      return {
        status: 403,
        body: {
          error: 'This series has a calendar-linked instance. Remove the calendar link before deleting the whole series.',
          code: 'CAL_LOCKED_DELETE_BLOCKED'
        }
      };
    }

    var result = await this.repo.runInTransaction(async function (trxRepo) {
      return this.cascadeRecurringDelete({ trxRepo: trxRepo, userId: userId, templateId: templateId });
    }.bind(this));
    // 999.5288: discard any queued write for every row cascadeRecurringDelete
    // just soft-cancelled (pending instances + the template) — see
    // _discardIds header.
    await this._discardIds(userId, (result.pendingIds || []).concat([templateId]));
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
  // For any task type: soft-cancel just that single row (no cascade), via
  // standardDelete() -> twrite.softCancelById (R55 — row kept, status='cancelled').
  // For recurring_instance: soft-cancels just this instance, same as above.
  // For recurring template: like standard delete but without the recurring cascade.
  // For non-recurring: same as standard delete.
  if (scope === 'instance') {
    await this.repo.runInTransaction(async function (trxRepo) {
      await this.standardDelete({ trxRepo: trxRepo, userId: userId, id: id, task: task });
    }.bind(this));
    // 999.5288: see _discardIds header.
    await this.discardQueuedWrites(userId, id);
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
    // 999.5288: discard any queued write for every row thisAndFutureDelete
    // just soft-cancelled (pending/future instances + the template) — see
    // _discardIds header.
    await this._discardIds(userId, (tfResult.pendingIds || []).concat([tplId]));
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
  // 999.1988/999.1989: snap scheduled_at to now if unscheduled — the DB CHECK
  // constraint chk_task_instances_terminal_scheduled rejects status='skip' with
  // NULL scheduled_at (same snap-then-write pattern as UpdateTaskStatus D-B).
  // 999.5291: this is a plain single-row update (the queue's exact shape,
  // unlike this file's other branches) — routed through the SAME
  // isLocked+splitFields+enqueueWrite idiom UpdateTaskStatus uses via
  // _writeTaskFields, so it QUEUES under an active lock instead of writing
  // directly + discarding. See file header for the full reasoning.
  if (isRecurringInstance) {
    var softSkipUpdate = { status: 'skip' };
    if (!task.scheduled_at) {
      softSkipUpdate.scheduled_at = new Date();
    }
    var softSkipWrite = await this._writeTaskFields(id, userId, softSkipUpdate, 'api:deleteTask:softSkip');
    await this.cache.invalidateTasks(userId);
    this.enqueueScheduleRun(userId, 'api:deleteTask:softSkip', [id], { skipEmit: softSkipWrite.queued });
    var softSkipBody = { message: 'Recurring instance skipped', id: id, softDelete: true };
    if (softSkipWrite.queued) softSkipBody.queued = true;
    return { status: 200, body: softSkipBody };
  }

  // standard single-task delete (handler L1530-1568)
  await this.repo.runInTransaction(async function (trxRepo) {
    await this.standardDelete({ trxRepo: trxRepo, userId: userId, id: id, task: task });
  }.bind(this));
  // 999.5288: see _discardIds header.
  await this.discardQueuedWrites(userId, id);
  await this.cache.invalidateTasks(userId);
  this.enqueueScheduleRun(userId, 'api:deleteTask', [id]);
  return { status: 200, body: { message: 'Task deleted', id: id } };
};

module.exports = DeleteTask;
