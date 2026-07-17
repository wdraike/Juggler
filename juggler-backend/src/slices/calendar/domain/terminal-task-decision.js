/**
 * terminal-task-decision.js — pure terminal-status use-case for cal-sync's sync().
 *
 * 999.1025 increment 4 (SECOND EXTRACTION SEAM): carves the terminal-status
 * branch out of the impure lib/cal-sync-helpers.js `handleTerminalTaskSync`
 * (which awaited adapter.deleteEvent) into a PURE decision function — decisions
 * in, effects out. No DB, no HTTP, no provider clients: given a fully-resolved
 * context it returns a plain descriptor of what the controller must do. The
 * deleteEvent/throttle effect (and its 404/410 swallow) now lives at the call
 * site (cal-sync.controller.js), matching the sibling delete blocks there.
 *
 * Covers (pinned byte-for-byte by W4 axes D / D2 / T, test-bed only):
 *   - done × calCompletedBehavior=update → repush (checkmark path): action 'update'
 *   - done × calCompletedBehavior=delete → delete the event (999.1455): action 'delete'
 *   - any non-done terminal status (cancel/skip/missed/…) → always delete
 *   - guards: only juggler-origin, live-event, terminal, push-mode tasks act
 *
 * DELETE TARGET (preserved EXACTLY): `event._url || ledger.provider_event_id`.
 * Apple juggler-origin rows store the CalDAV URL in provider_event_id (axis Q),
 * but createEvent surfaces a distinct `_url`, so the delete must target the URL,
 * not the VEVENT UID (axis T). The `||` is characterized — do NOT change it.
 *
 * @param {Object} ctx
 *   @param {Object}  ctx.task                 resolved task row (may be null)
 *   @param {Object}  ctx.event                provider event (may be null)
 *   @param {Object}  ctx.ledger               the sync ledger row
 *   @param {string}  ctx.calCompletedBehavior 'update' | 'delete' | 'keep' (guarded upstream)
 *   @param {boolean} ctx.isIngestOnly         true = pull-only provider (never mutates)
 *   @param {string}  ctx.JUGGLER_ORIGIN       the 'juggler' origin sentinel
 *   @param {string}  ctx.eventIdColumn        adapter.getEventIdColumn() — column to clear
 * @returns {{
 *   action: 'delete'|'update'|'none',
 *   deleteTarget: (string|null),
 *   taskUpdates: Array<{id:*, fields:Object}>,
 *   ledgerUpdates: Array<{id:*, fields:Object}>,
 *   logs: Array<{provider:string, action:string, opts:Object}>,
 *   statsDelta: {deleted_local:number}
 * }} decision descriptor. action 'delete' → caller awaits deleteEvent(deleteTarget)
 *    then applies the mutations and skips the rest of this ledger iteration;
 *    'update' → fall through to the regular push (✓ prefix + transparency);
 *    'none' → guard did not match, fall through unchanged.
 */
'use strict';

var { isTerminalStatus } = require('../../../lib/task-status');

function decideTerminalTaskSync(ctx) {
  var task = ctx.task;
  var event = ctx.event;
  var ledger = ctx.ledger;
  var calCompletedBehavior = ctx.calCompletedBehavior;
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

  // ── moved verbatim from lib/cal-sync-helpers.js handleTerminalTaskSync ─────
  // Only handle terminal tasks originating from Juggler, with a live event, in
  // push mode. (isIngestOnly here is the boolean result — the 999.1455 fix.)
  if (!task || !event || ledger.origin !== JUGGLER_ORIGIN || isIngestOnly) {
    return result('none');
  }
  if (!isTerminalStatus(task.status)) {
    return result('none');
  }

  // done + behavior=update → keep the event and repush (checkmark prefix +
  // transparency). Everything else terminal → delete the calendar event.
  var shouldDelete = calCompletedBehavior === 'delete' || task.status !== 'done';
  if (!shouldDelete) {
    // 'update' mode for done tasks: caller falls through to the regular push.
    return result('update');
  }

  // PRESERVE EXACTLY (axis T): target the CalDAV URL when present, else the
  // provider_event_id stored on the ledger. Do NOT change the `||`.
  var deleteTarget = event._url || ledger.provider_event_id;

  // Clear the provider-specific event-id column from the task and mark the
  // ledger row deleted_local. (The deleteEvent effect is applied by the caller.)
  var idFields = {};
  idFields[eventIdColumn] = null;
  taskUpdates.push({ id: task.id, fields: idFields });
  ledgerUpdates.push({ id: ledger.id, fields: { status: 'deleted_local', provider_event_id: null } });
  statsDelta.deleted_local = 1;

  return result('delete', deleteTarget);
}

module.exports = { decideTerminalTaskSync: decideTerminalTaskSync };
