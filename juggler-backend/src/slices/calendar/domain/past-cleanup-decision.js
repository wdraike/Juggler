/**
 * past-cleanup-decision.js — pure "past non-done juggler-origin cleanup"
 * use-case for cal-sync's sync().
 *
 * 999.1025 increment 5 (THIRD EXTRACTION SEAM): carves the "past non-done
 * juggler-origin cleanup" branch out of the per-ledger loop in
 * controllers/cal-sync.controller.js into a PURE decision function — decisions
 * in, effects out. No DB, no HTTP, no provider clients: given a fully-resolved
 * context it returns a plain descriptor of what the controller must do.
 *
 * WHAT IT DECIDES: a still-live provider event whose juggler-origin task has
 * slipped into the past without being finished must have its calendar event
 * deleted, so the external calendar matches Juggler's UI (which hides past-time
 * slots). Boundary depends on task type:
 *   - recurring_instance → boundary is `now` (today's past-time slots are cleaned
 *     once their window has passed — keeps the calendar consistent with the UI).
 *   - one-off / chain     → boundary is `todayStart` (previous-day boundary only,
 *     so a task still in progress doesn't lose its calendar event mid-session).
 * Only past tasks that are NOT 'done' and NOT 'skip' act (those two are owned by
 * the terminal-status path / kept intentionally).
 *
 * EFFECT REUSE (justified): the delete EFFECT this decision requests is
 * byte-identical to the terminal-delete path — same deleteTarget shape
 * (`event._url || ledger.provider_event_id`), same taskUpdates (clear the
 * provider event-id column), same ledgerUpdates (deleted_local +
 * provider_event_id null), same statsDelta.deleted_local = 1, same 404/410
 * swallow. The controller therefore applies it through the SHARED
 * `applyTerminalDelete` applier rather than a second copy. The descriptor shape
 * mirrors decideTerminalTaskSync's exactly so the applier consumes either
 * unchanged. (This branch emits NO sync_history log — matching the original
 * block, which had no logSyncAction call — so there is no `logs` buffer.)
 *
 * DELETE TARGET (preserved EXACTLY): `event._url || ledger.provider_event_id`.
 * Apple juggler-origin rows store the CalDAV URL in provider_event_id, but
 * createEvent surfaces a distinct `_url`, so the delete must target the URL
 * (axis T / R dual-key). The `||` is characterized — do NOT change it.
 *
 * @param {Object} ctx
 *   @param {Object}  ctx.task            resolved task row (may be null)
 *   @param {Object}  ctx.event           provider event (may be null)
 *   @param {Object}  ctx.ledger          the sync ledger row
 *   @param {Date}    ctx.now             sync clock (boundary for recurring_instance)
 *   @param {Date}    ctx.todayStart      user's local-midnight (boundary for one-off/chain)
 *   @param {boolean} ctx.isIngestOnly    true = pull-only provider (never mutates)
 *   @param {string}  ctx.JUGGLER_ORIGIN  the 'juggler' origin sentinel
 *   @param {string}  ctx.eventIdColumn   adapter.getEventIdColumn() — column to clear
 * @returns {{
 *   action: 'delete'|'none',
 *   deleteTarget: (string|null),
 *   taskUpdates: Array<{id:*, fields:Object}>,
 *   ledgerUpdates: Array<{id:*, fields:Object}>,
 *   statsDelta: {deleted_local:number}
 * }} decision descriptor. action 'delete' → caller applyTerminalDelete(deleteTarget)
 *    then applies the mutations and skips the rest of this ledger iteration;
 *    'none' → guard did not match, fall through unchanged.
 */
'use strict';

function decidePastCleanupSync(ctx) {
  var task = ctx.task;
  var event = ctx.event;
  var ledger = ctx.ledger;
  var now = ctx.now;
  var todayStart = ctx.todayStart;
  var isIngestOnly = ctx.isIngestOnly;
  var JUGGLER_ORIGIN = ctx.JUGGLER_ORIGIN;
  var eventIdColumn = ctx.eventIdColumn;

  // ── effect buffers (decisions in, effects out) ────────────────────────────
  var taskUpdates = [];
  var ledgerUpdates = [];
  var statsDelta = { deleted_local: 0 };

  function result(action, deleteTarget) {
    return {
      action: action,
      deleteTarget: (typeof deleteTarget === 'undefined') ? null : deleteTarget,
      taskUpdates: taskUpdates,
      ledgerUpdates: ledgerUpdates,
      statsDelta: statsDelta
    };
  }

  // ── moved verbatim from cal-sync.controller.js "Past non-done juggler-origin
  //    cleanup" block ────────────────────────────────────────────────────────
  // Guards: only a juggler-origin, live-event, placed task in push mode acts.
  if (!task || !event || ledger.origin !== JUGGLER_ORIGIN || !task._scheduled_at || isIngestOnly) {
    return result('none');
  }

  var taskScheduledAt = task._scheduled_at instanceof Date
    ? task._scheduled_at
    : new Date(String(task._scheduled_at).replace(' ', 'T') + 'Z');
  // recurring instances clean up today's past-time slots (boundary = now); one-off
  // and chain tasks only clean previous days (boundary = todayStart).
  var pastBoundary = task.taskType === 'recurring_instance' ? now : todayStart;
  var taskIsPast = taskScheduledAt < pastBoundary;
  var taskNotDone = task.status !== 'done' && task.status !== 'skip';

  if (!(taskIsPast && taskNotDone)) {
    return result('none');
  }

  // PRESERVE EXACTLY (axis T/R): target the CalDAV URL when present, else the
  // provider_event_id stored on the ledger. Do NOT change the `||`.
  var deleteTarget = event._url || ledger.provider_event_id;

  var idFields = {};
  idFields[eventIdColumn] = null;
  taskUpdates.push({ id: task.id, fields: idFields });
  ledgerUpdates.push({ id: ledger.id, fields: { status: 'deleted_local', provider_event_id: null } });
  statsDelta.deleted_local = 1;

  return result('delete', deleteTarget);
}

module.exports = { decidePastCleanupSync: decidePastCleanupSync };
