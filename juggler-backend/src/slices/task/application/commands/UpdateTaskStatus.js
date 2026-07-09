/**
 * UpdateTaskStatus — application command use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `updateTaskStatus` HTTP handler (task.controller.js ~1611)
 * step-for-step — the FULL status-transition orchestration, including the
 * done/complete path (the WBS `CompleteTask` command delegates here with
 * status='done', exactly as the handler routes 'done' through the same body).
 *
 * Branches reproduced:
 *   - zod statusUpdateSchema.safeParse (injected) → 400.
 *   - VALID_STATUSES guard → 400 (invalid status, incl. removed 'missed').
 *   - rc_<sourceId>_<digits> on-demand materialization (repo.insertTask of the
 *     instance row) when the generated instance has no DB row yet.
 *   - 404 / disabled-403.
 *   - recurring_template: pause/unpause with cascade to instances (999.590).
 *   - terminal-requires-schedule guard (rolling-instance exemption via injected
 *     `loadMaster`) — D-B (sched-audit): snap-then-write, not reject. An
 *     unscheduled non-rolling terminal write snaps `scheduled_at` to now and
 *     proceeds (200); rolling instances are exempted unchanged.
 *   - status update build (completed_at, done scheduled_at preservation, terminal
 *     reactivation done_frozen, cancel/skip future snap-to-now) — all timestamp
 *     stamping is left to the repo (P1 new Date()).
 *   - rolling-anchor projection (injected `applyRollingAnchor`).
 *   - split-chunk sibling propagation (injected `loadSplitSiblings` + repo writes).
 *   - skip/cancel outbound cal-sync trigger (injected `triggerCalSync`).
 *   - re-read, srcMap, invalidate, enqueueScheduleRun (SOLE trigger, S4/S6),
 *     publishTaskCompleted('done') / publishTaskUpdated (else).
 *
 * ── S4/S6 ── enqueueScheduleRun is the SOLE scheduler trigger — a direct call
 * after the write; the event publish is decoupled (no self-trigger, no cascade).
 * The cal-sync trigger is a SEPARATE subsystem (cal-sync.controller), not the
 * scheduler — preserved verbatim and fire-and-forget.
 *
 * ── P1 ── the use-case never passes db.fn.now(); it builds `update` WITHOUT
 * updated_at/completed_at-as-fn.now() and lets the repo stamp new Date(). Where
 * the legacy set completed_at = fn.now() it now sets a JS Date (new Date());
 * scheduled_at custom/snap values are JS Dates.
 *
 * The raw-table side effects the repo port does not model (task_masters
 * rolling-anchor, cal_sync_ledger reactivation/cleanup, template-pause instance
 * deletion, split-sibling lookup, cal-sync trigger) are INJECTED collaborators —
 * the legacy blocks lifted verbatim, wired by W6.
 *
 * @typedef {Object} UpdateTaskStatusDeps  (see constructor required list)
 */

'use strict';

var assertDeps = require('../_assertDeps');
var { getNowInTimezone } = require('juggler-shared/scheduler/getNowInTimezone');

var TERMINAL_REQUIRES_SCHEDULE = ['done', 'skip', 'cancel'];
var VALID_STATUSES = ['', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled'];

/** @param {UpdateTaskStatusDeps} deps */
function UpdateTaskStatus(deps) {
  var required = ['repo', 'cache', 'events', 'enqueueScheduleRun', 'mappers',
    'statusUpdateSchema', 'safeTimezone', 'dateHelpers', 'isTerminalStatus',
    'materializeRcInstance', 'handleTemplatePause', 'loadMaster', 'isRollingMaster',
    'applyRollingAnchor', 'loadSplitSiblings', 'triggerCalSync', 'reactivateDoneFrozen',
    'recordAction'];
  assertDeps('UpdateTaskStatus', deps, required);
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.events = deps.events;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.mappers = deps.mappers;
  this.statusUpdateSchema = deps.statusUpdateSchema;
  this.safeTimezone = deps.safeTimezone;
  this.dateHelpers = deps.dateHelpers;
  this.isTerminalStatus = deps.isTerminalStatus;
  this.materializeRcInstance = deps.materializeRcInstance;
  this.handleTemplatePause = deps.handleTemplatePause;
  this.loadMaster = deps.loadMaster;
  this.isRollingMaster = deps.isRollingMaster;
  this.applyRollingAnchor = deps.applyRollingAnchor;
  this.loadSplitSiblings = deps.loadSplitSiblings;
  this.triggerCalSync = deps.triggerCalSync;
  this.reactivateDoneFrozen = deps.reactivateDoneFrozen;
  this.recordAction = deps.recordAction;
  this.logger = deps.logger || { error: function () {} };
}

/**
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.userId
 * @param {Object} input.body  `{ status, completedAt?, direction? }`.
 * @param {string} [input.timezoneHeader]
 * @returns {Promise<{ status: number, body: Object }>}
 */
UpdateTaskStatus.prototype.execute = async function execute(input) {
  var id = input.id;
  var userId = input.userId;
  var body = input.body;
  var isTerminalStatus = this.isTerminalStatus;

  // zod (handler L1612-1613)
  var statusParsed = this.statusUpdateSchema.safeParse(body);
  if (!statusParsed.success) {
    return { status: 400, body: { error: 'Invalid status', details: statusParsed.error.issues } };
  }

  var tz = this.safeTimezone(input.timezoneHeader);
  var status = body.status;

  if (status !== undefined && VALID_STATUSES.indexOf(status) === -1) {
    return { status: 400, body: { error: 'Invalid status. Valid values: ' + VALID_STATUSES.join(', ') } };
  }

  var existing = await this.repo.fetchTaskWithEventIds(id, userId);

  // rc_ on-demand materialization (handler L1639-1669) — delegated (raw insert
  // through repo, but the date-parsing + source read is the legacy block).
  if (!existing && id.startsWith('rc_')) {
    existing = await this.materializeRcInstance({ id: id, userId: userId, tz: tz, repo: this.repo });
  }

  if (!existing) return { status: 404, body: { error: 'Task not found' } };
  if (existing.status === 'disabled') {
    return { status: 403, body: { error: 'This item is disabled. Use the re-enable endpoint to restore it.', code: 'TASK_DISABLED' } };
  }

  // recurring_template: pause/unpause — cascade to instances (999.590)
  if (existing.task_type === 'recurring_template') {
    if (status !== 'pause' && status !== '') {
      return { status: 400, body: { error: 'Recurring templates can only be paused or unpaused' } };
    }
    await this.repo.updateTaskById(id, { status: status || '' }, userId);
    var cascadeResult = await this.handleTemplatePause({ id: id, userId: userId, status: status, repo: this.repo });
    var tmplRows = await this.repo.getRecurringTemplateRows(userId);
    var srcMapT = this.mappers.buildSourceMap(tmplRows);
    await this.cache.invalidateTasks(userId);
    var cascadedIds = (cascadeResult.pausedIds || []).concat(cascadeResult.unpausedIds || []);
    this.enqueueScheduleRun(userId, 'api:updateTaskStatus:template', [id].concat(cascadedIds));
    var updatedTemplate = await this.repo.fetchTaskWithEventIds(id, userId);
    return {
      status: 200,
      body: {
        task: this.mappers.rowToTask(updatedTemplate, null, srcMapT),
        instancesPaused: cascadeResult.pausedCount || 0,
        instancesUnpaused: cascadeResult.unpausedCount || 0
      }
    };
  }

  // terminal-requires-schedule guard w/ rolling exemption (handler L1723-1742)
  var _rollingMasterRow = null;
  var _instanceMasterId = existing.master_id || existing.source_id;
  if (_instanceMasterId && TERMINAL_REQUIRES_SCHEDULE.indexOf(status) !== -1 && !existing.scheduled_at) {
    _rollingMasterRow = await this.loadMaster(_instanceMasterId, userId);
  }
  var _isRollingInstance = _rollingMasterRow && this.isRollingMaster(_rollingMasterRow);

  // D-B (sched-audit): the invariant this guard fronts is the live DB CHECK
  // chk_task_instances_terminal_scheduled ("a terminal row must carry a
  // non-null scheduled_at") — not "reject the write". Snap-then-write: an
  // unscheduled one-off / non-rolling-recurring-instance / split-chunk row
  // gets `scheduled_at` snapped to now (applied to `update` below) instead of
  // being rejected with 400. Rolling instances keep the existing exemption
  // UNCHANGED (the scheduler is expected to have already placed them; do not
  // snap or re-derive their scheduling here).
  var _snapUnscheduledToNow = TERMINAL_REQUIRES_SCHEDULE.indexOf(status) !== -1 && !existing.scheduled_at && !body.scheduledAt && !_isRollingInstance;

  // build update (handler L1744-1784) — P1: no fn.now(); repo stamps updated_at.
  var update = { status: status || '' };
  var isIngested = existing.cal_sync_origin && existing.cal_sync_origin !== 'juggler';
  var isFutureScheduled = existing.scheduled_at && new Date(existing.scheduled_at) > new Date();

  if (_snapUnscheduledToNow) {
    update.scheduled_at = new Date();
  }

  if (isTerminalStatus(status) && !isTerminalStatus(existing.status)) {
    update.completed_at = new Date();
  } else if (status === '' && isTerminalStatus(existing.status)) {
    update.completed_at = null;
  }

  // 999.586: On todo→done transition, populate time_remaining with estimated
  // duration (dur) when the caller doesn't supply an explicit value.
  // 999.910: Reject negative time_remaining on ANY status transition (not just done).
  if (body.time_remaining != null && body.time_remaining < 0) {
    return { status: 400, body: { error: 'time_remaining must be non-negative' } };
  }
  if (status === 'done' && existing.status !== 'done') {
    if (body.time_remaining != null) {
      update.time_remaining = body.time_remaining;
    }
  }

  if (status === 'done' && !isIngested) {
    var completedAt = body.completedAt;
    if (completedAt && completedAt !== 'now' && completedAt !== 'scheduled') {
      var customDate = new Date(completedAt);
      update.scheduled_at = customDate > new Date() ? new Date() : customDate;
    }
    // Future-done: snap scheduled_at to now so the user can mark a future
    // task as done without leaving a stale future placement.
    if (existing.scheduled_at && new Date(existing.scheduled_at) > new Date()) {
      update.scheduled_at = new Date();
    }
  }

  // terminal → non-terminal reactivation: FR-2/AC3 reopen date gate, then
  // done_frozen → active (handler L1774-1778).
  //
  // FR-2 (SPEC juggler-recur-lifecycle-redesign): explicit reactivation of an
  // already-settled instance is blocked when the instance's `date` is in the
  // past (< today, in the user's own timezone). Same-day reactivation stays
  // allowed. This gate applies ONLY to this explicit-reactivation code path —
  // client-snapshot undo (UndoTask.js) writes via repo.updateTaskById directly
  // and never reaches this branch (verified: UndoTask.js does not call
  // UpdateTaskStatus.execute), so undo is structurally unaffected by design,
  // with no special-case bypass needed here.
  if (existing && isTerminalStatus(existing.status) && !isTerminalStatus(status)) {
    var _instanceDateKey = existing.date ? String(existing.date).slice(0, 10) : null;
    if (_instanceDateKey) {
      var _todayKeyForReopenGate = getNowInTimezone(tz).todayKey;
      if (_instanceDateKey < _todayKeyForReopenGate) {
        return {
          status: 400,
          body: {
            error: 'This instance can no longer be reactivated — its date has passed. Use undo if the status change was just made.',
            code: 'REOPEN_DATE_GATE'
          }
        };
      }
    }
    await this.reactivateDoneFrozen({ id: id, userId: userId });
  }

  if ((status === 'cancel' || status === 'skip') && isFutureScheduled && !isIngested) {
    update.scheduled_at = new Date();
  }

  // ── 999.681: Record action for undo BEFORE persisting the change ──
  var beforeSnapshot = {
    status: existing.status || '',
    completed_at: existing.completed_at || null,
    time_remaining: existing.time_remaining != null ? existing.time_remaining : null
  };
  var afterSnapshot = {
    status: update.status != null ? update.status : existing.status,
    completed_at: update.completed_at !== undefined ? update.completed_at : (existing.completed_at || null),
    time_remaining: update.time_remaining !== undefined ? update.time_remaining : (existing.time_remaining != null ? existing.time_remaining : null)
  };
  await this.recordAction.execute({
    taskId: id,
    userId: userId,
    actionType: 'status_change',
    before: beforeSnapshot,
    after: afterSnapshot
  });

  await this.repo.updateTaskById(id, update, userId);

  // rolling-anchor projection (handler L1789-1808) — delegated.
  var _anchorMasterId = existing.master_id || existing.source_id;
  if (_anchorMasterId && ['done', 'skip'].includes(status)) {
    await this.applyRollingAnchor({
      masterId: _anchorMasterId,
      userId: userId,
      status: status,
      existing: existing,
      preloadedMaster: _rollingMasterRow
    });
  }

  // split-chunk sibling propagation (handler L1816-1826) — same `update` payload.
  var siblingIds = [];
  if (Number(existing.split_total) > 1 && existing.source_id != null && existing.occurrence_ordinal != null) {
    var siblings = await this.loadSplitSiblings({
      userId: userId,
      masterId: existing.source_id,
      occurrenceOrdinal: existing.occurrence_ordinal,
      excludeId: id
    });
    for (var si = 0; si < siblings.length; si++) {
      siblingIds.push(siblings[si].id);
      await this.repo.updateTaskById(siblings[si].id, update, userId);
    }
  }

  // skip/cancel outbound cal-sync trigger (handler L1841-1855) — fire-and-forget.
  var hasCalLink = !!(existing.gcal_event_id || existing.msft_event_id || existing.apple_event_id);
  if ((status === 'skip' || status === 'cancel') && hasCalLink) {
    Promise.resolve(this.triggerCalSync.sync({ userId: userId }))
      .catch(this.logger.error.bind(this.logger));
  }

  var updated = await this.repo.fetchTaskWithEventIds(id, userId);
  // Null-safety: the row was present at `existing` (404-guarded above) but the
  // re-read can come back empty if the row was concurrently removed. Treat a
  // missing re-read as not-found rather than dereferencing null in rowToTask.
  if (!updated) return { status: 404, body: { error: 'Task not found' } };
  var tmplRows2 = await this.repo.getRecurringTemplateRows(userId);
  var srcMap = this.mappers.buildSourceMap(tmplRows2);
  await this.cache.invalidateTasks(userId);
  this.enqueueScheduleRun(userId, 'api:updateTaskStatus', [id].concat(siblingIds));
  if (status === 'done') {
    this.events.publishTaskCompleted({ id: id, userId: userId, status: updated && updated.status });
  } else {
    this.events.publishTaskUpdated({ id: id, userId: userId, status: updated && updated.status });
  }
  return {
    status: 200,
    body: { task: this.mappers.rowToTask(updated, null, srcMap), siblingsUpdated: siblingIds.length }
  };
};

module.exports = UpdateTaskStatus;
module.exports.TERMINAL_REQUIRES_SCHEDULE = TERMINAL_REQUIRES_SCHEDULE;
module.exports.VALID_STATUSES = VALID_STATUSES;
