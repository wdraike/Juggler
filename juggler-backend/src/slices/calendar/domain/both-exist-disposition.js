/**
 * both-exist-disposition.js — pure pre-dispatch disposition for cal-sync's sync().
 *
 * 999.1025 increment 11 (CLOSING carve): pulls the two remaining inline decision
 * guards at the TOP of the "both exist" branch of the per-ledger sync loop out of
 * cal-sync.controller.js into a PURE decision function — decisions in, effects out.
 * No DB, no HTTP, no provider clients: given a fully-resolved context it returns a
 * plain descriptor of what the controller must do BEFORE the origin-based
 * push/pull routing (decideHashPushSync / decideProviderOriginPull) runs.
 *
 * Two formerly-inline guards, evaluated in the original order:
 *   (1) Recurring template with a live event → action 'skip'. Templates must
 *       never live on a calendar. Unconditional (no origin/ingest guard —
 *       matches the original first-in-block check). No effect.
 *   (2) Unscheduled juggler-origin task, push mode → action 'delete'. An
 *       unscheduled task (the scheduler could not place it) must not occupy a
 *       slot on an external calendar, so its event is deleted. Only for events we
 *       own (origin=juggler) and never in ingest-only (read-only) mode.
 *   (3) Anything else → action 'proceed'. Caller falls through to the origin
 *       push/pull routing unchanged.
 *
 * The delete EFFECT (deleteEvent/throttle + its 404/410 swallow) is applied by the
 * controller through the SHARED applyTerminalDelete applier — byte-identical to the
 * sibling terminal / past-cleanup delete blocks. The descriptor's mutation buffers
 * and delete target are shaped EXACTLY like decideTerminalTaskSync so the same
 * applier can be reused.
 *
 * DELETE TARGET (preserved EXACTLY): `event._url || ledger.provider_event_id`.
 * Apple juggler-origin rows store the CalDAV URL in provider_event_id, but
 * createEvent surfaces a distinct `_url`, so the delete must target the URL when
 * present. The `||` is characterized (W4 axis T family) — do NOT change it.
 *
 * @param {Object} ctx
 *   @param {Object}  ctx.task          resolved task row (caller guarantees present)
 *   @param {Object}  ctx.event         provider event (caller guarantees present)
 *   @param {Object}  ctx.ledger        the sync ledger row
 *   @param {boolean} ctx.isIngestOnly  true = pull-only provider (never mutates)
 *   @param {string}  ctx.JUGGLER_ORIGIN the 'juggler' origin sentinel
 *   @param {string}  ctx.eventIdColumn adapter.getEventIdColumn() — column to clear
 * @returns {{
 *   action: 'skip'|'delete'|'proceed',
 *   deleteTarget: (string|null),
 *   taskUpdates: Array<{id:*, fields:Object}>,
 *   ledgerUpdates: Array<{id:*, fields:Object}>,
 *   logs: Array<{provider:string, action:string, opts:Object}>,
 *   statsDelta: {deleted_local:number}
 * }} decision descriptor. action 'skip' → caller `continue`s (no effect); 'delete'
 *    → caller applies the delete via applyTerminalDelete then `continue`s;
 *    'proceed' → caller falls through to the origin push/pull routing.
 */
'use strict';

function decideBothExistDisposition(ctx) {
  var task = ctx.task;
  var event = ctx.event;
  var ledger = ctx.ledger;
  var isIngestOnly = ctx.isIngestOnly;
  var JUGGLER_ORIGIN = ctx.JUGGLER_ORIGIN;
  var eventIdColumn = ctx.eventIdColumn;

  // ── effect buffers (decisions in, effects out) ────────────────────────────
  var taskUpdates = [];
  var ledgerUpdates = [];
  var logs = [];
  var statsDelta = { deleted_local: 0 };

  function result(action, deleteTarget) {
    return {
      action: action,
      deleteTarget: (typeof deleteTarget === 'undefined') ? null : deleteTarget,
      taskUpdates: taskUpdates,
      ledgerUpdates: ledgerUpdates,
      logs: logs,
      statsDelta: statsDelta
    };
  }

  // Caller invokes this only when both task and event exist; guard defensively.
  if (!task || !event) {
    return result('proceed');
  }

  // (1) Recurring templates must never live on a calendar — skip unconditionally
  // (no origin/ingest guard; matches the original first-in-block check). No effect.
  if (task.taskType === 'recurring_template') {
    return result('skip');
  }

  // (2) Unscheduled juggler task with a live event → delete the event. Only for
  // juggler-origin events we own, and never in ingest-only (read-only) mode.
  if (task.unscheduled && ledger.origin === JUGGLER_ORIGIN && !isIngestOnly) {
    // PRESERVE EXACTLY: target the CalDAV URL when present, else the
    // provider_event_id stored on the ledger. Do NOT change the `||`.
    var deleteTarget = event._url || ledger.provider_event_id;

    var idFields = {};
    idFields[eventIdColumn] = null;
    taskUpdates.push({ id: task.id, fields: idFields });
    ledgerUpdates.push({ id: ledger.id, fields: { status: 'deleted_local', provider_event_id: null } });
    statsDelta.deleted_local = 1;

    return result('delete', deleteTarget);
  }

  // (3) Fall through to the origin-based push/pull routing.
  return result('proceed');
}

module.exports = { decideBothExistDisposition: decideBothExistDisposition };
