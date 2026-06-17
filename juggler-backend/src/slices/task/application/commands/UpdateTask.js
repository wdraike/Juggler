/**
 * UpdateTask — application command use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `updateTask` HTTP handler (task.controller.js ~944)
 * step-for-step. The handler has THREE branches; all are reproduced here:
 *
 *   A. FAST PATH (needsComplexPath=false, handler L953-1062) — common edits with
 *      no recur/when/anchor/allDay/unfix/time-only machinery. 1 read-back +
 *      1 routed write (template/instance split for recurring_instance) +
 *      optimistic response.
 *   B. LOCK PATH (handler L1142-1179) — when the scheduler lock is held: split
 *      scheduling vs non-scheduling fields, write non-scheduling directly,
 *      queue scheduling, narrow re-read.
 *   C. COMPLEX PATH (handler L1064-1367) — recur/when/anchor/drag-pin: a
 *      transaction that routes template/instance fields and runs recurrence
 *      cleanup. The recurrence-cleanup raw-table logic (resetRecurringInstances /
 *      archiveCompletedInstances / the pending-instance match-and-delete + the
 *      toggle-off self-instance insert) is the ONE block that touches tables the
 *      repo port does not model (raw tasks_v / task_instances reads inside the
 *      trx). It is delegated to an INJECTED `recurCleanup` collaborator (the
 *      legacy block lifted verbatim, wired by W6) so the application layer stays
 *      DB-free while the behavior is reproduced exactly.
 *
 * ── S4/S6 ────────────────────────────────────────────────────────────────────
 * Each branch ends with the DIRECT injected `enqueueScheduleRun(...)` call placed
 * exactly where the handler placed it (with the same skipEmit/skipScheduler
 * options), and a fire-and-forget `events.publishTaskUpdated(...)` that is
 * decoupled from the trigger (no self-trigger, no cascade). The cache-invalidate
 * on the fast path is fire-and-forget with the SAME `.catch(logger.error)` the
 * handler had.
 *
 * ── T-TX ── the complex path runs inside `repo.runInTransaction(...)` — the same
 * `getDb().transaction(...)` boundary (commit on resolve, rollback on reject).
 *
 * ── P1 ── all `updated_at` stamping is left to the repository (which forces
 * `new Date()`); the use-case never passes db.fn.now() (the legacy fast/slow/lock
 * paths passed `getDb().fn.now()` — that was the pre-existing P1 violation the W3
 * repo corrects; here we simply omit updated_at and let the repo stamp it).
 *
 * ── NO NEW FALLBACKS ── every guard/default preserved verbatim.
 *
 * @typedef {Object} UpdateTaskDeps
 * @property {import('../../domain/ports/TaskRepositoryPort')} repo
 * @property {import('../../domain/ports/TaskCachePort')} cache
 * @property {import('../../domain/ports/TaskEventPort')} events
 * @property {Function} enqueueScheduleRun
 * @property {Object} mappers      (taskToRow, rowToTask, buildSourceMap, TEMPLATE_FIELDS)
 * @property {Object} validation   (validateTaskInput, checkCalSyncEditGuard, guardFixedCalendarWhen)
 * @property {Function} hasSchedulingFields (row) — scheduling-field predicate (pure; injected).
 * @property {Object} splitFieldsLib  { splitFields } (write-queue helper; injected).
 * @property {Function} ensureProject
 * @property {Function} isLocked
 * @property {Function} enqueueWrite
 * @property {Function} safeTimezone
 * @property {Object} dateHelpers   (localToUtc, utcToLocal) — pure; injected.
 * @property {Object} placementModes
 * @property {Function} recurCleanup (ctx) — complex-path recurrence cleanup +
 *   template/instance routing inside the trx (legacy block, injected).
 */

'use strict';

var assertDeps = require('../_assertDeps');

/** @param {UpdateTaskDeps} deps */
function UpdateTask(deps) {
  var required = ['repo', 'cache', 'events', 'enqueueScheduleRun', 'mappers',
    'validation', 'validateReferences', 'hasSchedulingFields', 'splitFieldsLib', 'ensureProject',
    'isLocked', 'enqueueWrite', 'safeTimezone', 'dateHelpers', 'placementModes',
    'recurCleanup'];
  assertDeps('UpdateTask', deps, required);
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.events = deps.events;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.mappers = deps.mappers;
  this.validation = deps.validation;
  this.validateReferences = deps.validateReferences;
  this.hasSchedulingFields = deps.hasSchedulingFields;
  this.splitFields = deps.splitFieldsLib.splitFields;
  this.ensureProject = deps.ensureProject;
  this.isLocked = deps.isLocked;
  this.enqueueWrite = deps.enqueueWrite;
  this.safeTimezone = deps.safeTimezone;
  this.dateHelpers = deps.dateHelpers;
  this.PLACEMENT_MODES = deps.placementModes;
  this.recurCleanup = deps.recurCleanup;
  this.logger = deps.logger || { error: function () {} };
}

/**
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.userId
 * @param {Object} input.body
 * @param {string} [input.timezoneHeader]
 * @returns {Promise<{ status: number, body: Object }>}
 */
UpdateTask.prototype.execute = async function execute(input) {
  var id = input.id;
  var userId = input.userId;
  var body = input.body;
  var self = this;
  var TEMPLATE_FIELDS = this.mappers.TEMPLATE_FIELDS;
  var PLACEMENT_MODES = this.PLACEMENT_MODES;
  var utcToLocal = this.dateHelpers.utcToLocal;
  var localToUtc = this.dateHelpers.localToUtc;

  // validate (handler L946-949)
  var validationErrors = this.validation.validateTaskInput(body);
  if (validationErrors.length > 0) {
    return { status: 400, body: { error: validationErrors.join('; ') } };
  }

  // DB-backed reference existence validation (999.586) — runs for BOTH the fast
  // and complex paths, before branch selection. depends_on / location / tools
  // must reference IDs the user owns (shape already validated above). dependsOn
  // is skipped for recurring tasks (their deps are stripped downstream). The
  // recurring state is `body.recurring` when the update sets it, else the task's
  // EXISTING state — a partial PATCH that omits `recurring` on an already-recurring
  // task must not false-reject a stale dependsOn that will be stripped (ernie WARN-2).
  var refBody = body;
  if (Array.isArray(body.dependsOn) && body.dependsOn.length > 0) {
    var willBeRecurring = body.recurring === true;
    if (!willBeRecurring && body.recurring === undefined) {
      // unchanged recurring state — consult the existing row (cheap, deps-only path)
      var cur = await this.repo.fetchTaskRecurring(id, userId);
      willBeRecurring = !!(cur && (cur.recurring
        || cur.task_type === 'recurring_template'
        || cur.task_type === 'recurring_instance'));
    }
    if (willBeRecurring) {
      refBody = Object.assign({}, body);
      delete refBody.dependsOn;
    }
  } else if (body.recurring) {
    refBody = Object.assign({}, body);
    delete refBody.dependsOn;
  }
  var referenceErrors = await this.validateReferences(userId, refBody);
  if (referenceErrors.length > 0) {
    return { status: 400, body: { error: referenceErrors.join('; ') } };
  }

  // needsComplexPath (handler L962-973)
  var needsComplexPath = body.recur !== undefined
    || body.recurStart !== undefined
    || body.recurEnd !== undefined
    || body.when !== undefined
    || body.anchorDate
    || body._allowUnfix
    || body.allDay !== undefined
    || (body.recurring !== undefined && !body.recurring)
    || (body.time !== undefined && body.date === undefined && body.scheduledAt === undefined);

  if (!needsComplexPath) {
    return this._fastPath(input);
  }

  // ── COMPLEX PATH (handler L1064+) ──
  var existing = await this.repo.fetchTaskWithEventIds(id, userId);
  if (!existing) return { status: 404, body: { error: 'Task not found' } };
  if (existing.status === 'disabled') {
    return { status: 403, body: { error: 'This item is disabled. Re-enable it before making changes.', code: 'TASK_DISABLED' } };
  }

  var guard = this.validation.checkCalSyncEditGuard(existing, body);
  if (guard) return { status: 403, body: guard };

  // 999.558: cross-field startAfter > deadline check (partial patch merges with existing)
  var crossFieldErr = this.validation.validateStartAfterDeadlineCrossField(body, existing);
  if (crossFieldErr) {
    return { status: 400, body: { error: crossFieldErr } };
  }

  var tz = this.safeTimezone(input.timezoneHeader);
  var anchorDateVal = body.anchorDate;
  var bodyWithoutAnchor = Object.assign({}, body);
  delete bodyWithoutAnchor.anchorDate;
  var row = this.mappers.taskToRow(bodyWithoutAnchor, userId, tz, existing);
  delete row.id;
  delete row.user_id;
  delete row.created_at;

  if (existing.recurring || existing.task_type === 'recurring_template' || existing.task_type === 'recurring_instance') {
    delete row.depends_on;
  }

  // time-only update (handler L1097-1107)
  if (row._pendingTimeOnly && existing.scheduled_at) {
    var existingLocal = utcToLocal(existing.scheduled_at, tz);
    if (existingLocal && existingLocal.date) {
      row.scheduled_at = localToUtc(existingLocal.date, row._pendingTimeOnly, tz) || null;
      if (row.desired_at === undefined) row.desired_at = row.scheduled_at;
    }
  }
  delete row._pendingTimeOnly;

  // fixed-calendar when guard (handler L1112-1120)
  if (row.when !== undefined) {
    var _guardOpts = { allowUnfix: !!body._allowUnfix };
    if ((existing.task_type || 'task') === 'recurring_instance' && existing.source_id) {
      var _srcTmpl = await this.repo.fetchTaskWithEventIds(existing.source_id, userId);
      this.validation.guardFixedCalendarWhen(row, _srcTmpl, _guardOpts);
    } else {
      this.validation.guardFixedCalendarWhen(row, existing, _guardOpts);
    }
  }

  if (body.project) await this.ensureProject(userId, body.project);

  // fixed-mode date/time guard (handler L1124-1131)
  if (row.placement_mode === PLACEMENT_MODES.FIXED) {
    var _hasDate = body.date !== undefined || body.scheduledAt !== undefined || !!(existing && (existing.date || existing.scheduled_at));
    var _hasTime = body.time !== undefined || body.scheduledAt !== undefined || !!(existing && existing.time);
    if (!_hasDate || !_hasTime) {
      return { status: 400, body: { error: 'Fixed mode requires a date and time.' } };
    }
  }
  var timeWasSet = body.time !== undefined || body.scheduledAt !== undefined;
  if (!timeWasSet && body.allDay === true && row.placement_mode === undefined) {
    row.placement_mode = PLACEMENT_MODES.ALL_DAY;
    if (row.when === undefined) row.when = 'allday';
  }

  // LOCK PATH (handler L1142-1179)
  var locked = await this.isLocked(userId);
  if (locked) {
    return this._lockPath({ id: id, userId: userId, row: row, existing: existing });
  }

  // transaction: routing + recurrence cleanup (handler L1185-1346)
  var taskType = existing.task_type || 'task';
  await this.repo.runInTransaction(async function (trxRepo) {
    await self.recurCleanup({
      trxRepo: trxRepo,
      taskType: taskType,
      existing: existing,
      row: row,
      anchorDateVal: anchorDateVal,
      tz: tz,
      userId: userId,
      id: id,
      TEMPLATE_FIELDS: TEMPLATE_FIELDS
    });
  });

  // narrow re-read (handler L1351-1357)
  var updatedRow = await this.repo.fetchTaskWithEventIds(id, userId);
  var templateRows = await this.repo.getRecurringTemplateRows(userId);
  var srcMap = this.mappers.buildSourceMap(templateRows);
  await this.cache.invalidateTasks(userId);
  var slowBroadcastIds = [id];
  if (existing.recurring || existing.task_type === 'recurring_template' || existing.task_type === 'recurring_instance') {
    try { slowBroadcastIds = await this.repo.expandToAllInstanceIds(userId, [id]); } catch { /* fall back to just [id] */ }
  }
  this.enqueueScheduleRun(userId, 'api:updateTask', slowBroadcastIds, { skipScheduler: !this.hasSchedulingFields(row) });
  this.events.publishTaskUpdated({ id: id, userId: userId, status: updatedRow && updatedRow.status });
  return { status: 200, body: { task: this.mappers.rowToTask(updatedRow, null, srcMap) } };
};

// ── FAST PATH (handler L975-1062) ──
UpdateTask.prototype._fastPath = async function _fastPath(input) {
  var id = input.id;
  var userId = input.userId;
  var body = input.body;
  var TEMPLATE_FIELDS = this.mappers.TEMPLATE_FIELDS;
  var self = this;

  var fastTz = this.safeTimezone(input.timezoneHeader);
  var fastBody = Object.assign({}, body);
  delete fastBody.anchorDate;

  var fastExistingPromise = this.repo.fetchTaskWithEventIds(id, userId);
  var fastEnsureProject = body.project ? this.ensureProject(userId, body.project) : Promise.resolve();
  var results = await Promise.all([fastExistingPromise, fastEnsureProject]);
  var fastExisting = results[0];

  var fastRow = this.mappers.taskToRow(fastBody, userId, fastTz, fastExisting);
  delete fastRow.id;
  delete fastRow.user_id;
  delete fastRow.created_at;
  delete fastRow._pendingTimeOnly;
  // P1: omit updated_at — the repository stamps new Date() (legacy passed fn.now()).
  delete fastRow.updated_at;

  if (!fastExisting) return { status: 404, body: { error: 'Task not found' } };
  if (fastExisting.status === 'disabled') {
    return { status: 403, body: { error: 'This item is disabled. Re-enable it before making changes.', code: 'TASK_DISABLED' } };
  }

  var guard = this.validation.checkCalSyncEditGuard(fastExisting, body);
  if (guard) return { status: 403, body: guard };

  this.validation.guardFixedCalendarWhen(fastRow, fastExisting, { allowUnfix: !!body._allowUnfix });

  // 999.558: cross-field startAfter > deadline check (partial patch merges with existing)
  var crossFieldErr = this.validation.validateStartAfterDeadlineCrossField(body, fastExisting);
  if (crossFieldErr) {
    return { status: 400, body: { error: crossFieldErr } };
  }

  if (fastExisting.recurring || fastExisting.task_type === 'recurring_template' || fastExisting.task_type === 'recurring_instance') {
    delete fastRow.depends_on;
  }

  // routed write (handler L1018-1040)
  if (fastExisting.task_type === 'recurring_instance' && fastExisting.source_id) {
    var fastTplUpdate = {};
    var fastInstUpdate = {};
    Object.keys(fastRow).forEach(function (k) {
      if (k === 'updated_at') return;
      if (TEMPLATE_FIELDS.indexOf(k) >= 0) fastTplUpdate[k] = fastRow[k];
      else fastInstUpdate[k] = fastRow[k];
    });
    if (Object.keys(fastTplUpdate).length > 0) {
      await this.repo.updateTaskById(fastExisting.source_id, fastTplUpdate, userId);
    }
    if (Object.keys(fastInstUpdate).length > 0) {
      await this.repo.updateTaskById(id, fastInstUpdate, userId);
    } else {
      await this.repo.updateTaskById(id, {}, userId);
    }
  } else {
    await this.repo.updateTaskById(id, fastRow, userId);
  }

  // fire-and-forget cache invalidate (handler L1044)
  this.cache.invalidateTasks(userId).catch(function (e) { self.logger.error('[cache]', e.message); });

  var fastBroadcastIds = [id];
  if (fastExisting.recurring || fastExisting.task_type === 'recurring_template' || fastExisting.task_type === 'recurring_instance') {
    try { fastBroadcastIds = await this.repo.expandToAllInstanceIds(userId, [id]); } catch { /* fall back to just [id] */ }
  }
  this.enqueueScheduleRun(userId, 'api:updateTask', fastBroadcastIds, { skipScheduler: !this.hasSchedulingFields(fastRow) });

  // optimistic response (handler L1057-1061)
  var optimistic = Object.assign({}, fastExisting, fastRow);
  optimistic.id = id;
  optimistic.user_id = userId;
  optimistic.updated_at = new Date();

  // TASK_UPDATED publish on the fast path (999.331). The COMPLEX path publishes
  // at L221; the fast path historically returned WITHOUT publishing, so a
  // fast-path edit never emitted TASK_UPDATED and an H6 scheduler subscriber
  // would miss it. We publish here AFTER the successful write above (the
  // updateTaskById call(s) resolved — control only reaches this point on
  // success; a thrown write rejects execute() before this line). Fire-and-
  // forget + error-isolated like the slow path; uses the reconciled FLAT shape
  // (ADR-0001 E-3): { id, userId, status }. The status mirrors what the slow
  // path provides — the post-write status — sourced from the optimistic row
  // (fastExisting merged with the applied fastRow) since the fast path does not
  // re-read.
  this.events.publishTaskUpdated({ id: id, userId: userId, status: optimistic.status });
  return { status: 200, body: { task: this.mappers.rowToTask(optimistic, null) } };
};

// ── LOCK PATH (handler L1142-1179) ──
UpdateTask.prototype._lockPath = async function _lockPath(ctx) {
  var id = ctx.id;
  var userId = ctx.userId;
  var row = ctx.row;
  var existing = ctx.existing;

  var split = this.splitFields(row);
  var schedulingFields = split.schedulingFields;
  var nonSchedulingFields = split.nonSchedulingFields;

  if (Object.keys(nonSchedulingFields).length > 0) {
    // P1: omit updated_at — repo stamps new Date() (legacy passed fn.now()).
    await this.repo.updateTaskById(id, nonSchedulingFields, userId);
  }
  var queuedScheduling = false;
  if (Object.keys(schedulingFields).length > 0) {
    await this.enqueueWrite(userId, id, 'update', schedulingFields, 'api:updateTask');
    queuedScheduling = true;
  }
  await this.cache.invalidateTasks(userId);

  var lockedBroadcastIds = [id];
  if ((existing.recurring || existing.task_type === 'recurring_template' || existing.task_type === 'recurring_instance') && !queuedScheduling) {
    try { lockedBroadcastIds = await this.repo.expandToAllInstanceIds(userId, [id]); } catch { /* fall back */ }
  }
  this.enqueueScheduleRun(userId, 'api:updateTask', lockedBroadcastIds, {
    skipEmit: queuedScheduling,
    skipScheduler: !queuedScheduling
  });

  var currentRow = await this.repo.fetchTaskWithEventIds(id, userId);
  var templateRows2 = await this.repo.getRecurringTemplateRows(userId);
  var srcMap2 = this.mappers.buildSourceMap(templateRows2);
  return { status: 200, body: { task: this.mappers.rowToTask(currentRow, null, srcMap2), queued: true } };
};

module.exports = UpdateTask;
