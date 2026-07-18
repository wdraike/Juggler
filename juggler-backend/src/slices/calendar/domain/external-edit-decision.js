/**
 * external-edit-decision.js — pure "both changed → conflict resolution" use-case
 * for cal-sync's sync().
 *
 * 999.1025 increment 7 (FOURTH EXTRACTION SEAM): carves the "both the task AND
 * the event changed since our last sync" conflict branch out of the per-ledger
 * loop in controllers/cal-sync.controller.js into a PURE decision function —
 * decisions in, effects out. No DB, no HTTP, no provider clients: given a
 * fully-resolved context it returns which side wins plus the log descriptor(s)
 * the controller must replay.
 *
 * WHAT IT DECIDES (three outcomes, pinned byte-for-byte by the W4 golden master
 * conflict axis):
 *   - fixed OR terminal task  → action 'push-conflict': Juggler always wins —
 *     never pull a calendar edit into a completed/fixed task. Log conflict_juggler
 *     with a "fixed"/"terminal" detail (terminal detail wins the ternary).
 *   - flexible + non-terminal, event newer than the task (isEventNewerThanTask,
 *     the >1000ms last-modified tiebreaker) → action 'pull'. The pull EFFECT
 *     (_buildPullFields → taskUpdates) AND its conflict_provider log stay at the
 *     call site, because the log's `newValues.when` depends on the freshly-built
 *     pull fields — so this decision returns an EMPTY logs array for 'pull'.
 *   - flexible + non-terminal, task newer / tie → action 'push': Juggler pushes
 *     over the calendar edit. Log conflict_juggler "task is newer".
 *
 * EFFECT SPLIT (justified): 'push' and 'push-conflict' request the SAME push
 * effect at the call site (pendingEventUpdates + pStats.pushed) — they differ
 * only in the log detail, which is why both carry a fully-formed log descriptor
 * here. 'pull' requests a different effect the caller owns end-to-end.
 *
 * TIEBREAKER (preserved EXACTLY): the pull-vs-push split is the pure
 * `isEventNewerThanTask` predicate (event.lastModified vs task._updated_at, NO
 * ETag, >1000ms tolerance) — a documented divergence from the external-edit
 * predicate. See event-modified-predicate.js.
 *
 * @param {Object} ctx
 *   @param {Object}  ctx.task            resolved task row (reads id/text/status/
 *                                        placementMode/_updated_at)
 *   @param {Object}  ctx.event           provider event (reads .lastModified)
 *   @param {Object}  ctx.ledger          the sync ledger row (reads provider_event_id)
 *   @param {string}  ctx.pid             provider id ('gcal' | 'msft' | 'apple')
 *   @param {boolean} ctx.isTaskTerminal  isTerminalStatus(task.status), resolved by
 *                                        the caller (shared with sibling branches)
 *   @param {Object}  ctx.calendarLabels  { pid: label } for sync_history rows
 * @returns {{
 *   action: 'push'|'pull'|'push-conflict',
 *   logs: Array<{provider:string, action:string, opts:Object}>
 * }} decision descriptor. action 'pull' → caller builds pull fields, applies the
 *    taskUpdate and logs conflict_provider (logs here is empty); 'push' /
 *    'push-conflict' → caller applies the push effect and replays `logs`.
 */
'use strict';

var { PLACEMENT_MODES } = require('../../../lib/placementModes');
var { isEventNewerThanTask } = require('./event-modified-predicate');

function decideExternalEditSync(ctx) {
  var task = ctx.task;
  var event = ctx.event;
  var ledger = ctx.ledger;
  var pid = ctx.pid;
  var isTaskTerminal = ctx.isTaskTerminal;
  var calendarLabels = ctx.calendarLabels;

  function conflictJugglerLog(detail) {
    return {
      provider: pid,
      action: 'conflict_juggler',
      opts: {
        taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
        detail: detail,
        calendarName: calendarLabels[pid] || null
      }
    };
  }

  // ── moved verbatim from cal-sync.controller.js sync() conflict branch ──────
  // Terminal tasks (done/cancel/skip/pause) always win — never pull a calendar
  // edit into a completed task. Fixed tasks likewise always win.
  var isFixed = task.placementMode === PLACEMENT_MODES.FIXED;
  if (isFixed || isTaskTerminal) {
    return {
      action: 'push-conflict',
      logs: [conflictJugglerLog(
        isTaskTerminal
          ? 'Conflict: terminal task pushed over calendar edit (completed tasks are immutable)'
          : 'Conflict: fixed task pushed over calendar edit'
      )]
    };
  }

  // Last-modified wins (with 1s tolerance — see isEventNewerThanTask).
  if (isEventNewerThanTask(event, task)) {
    // Event newer → pull. The pull fields + conflict_provider log are built at
    // the call site (newValues.when depends on _buildPullFields output).
    return { action: 'pull', logs: [] };
  }

  // Task newer → push.
  return {
    action: 'push',
    logs: [conflictJugglerLog('Conflict: task pushed over calendar edit (task is newer)')]
  };
}

module.exports = { decideExternalEditSync: decideExternalEditSync };
