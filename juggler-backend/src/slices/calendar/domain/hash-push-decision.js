/**
 * hash-push-decision.js — pure "juggler-origin push / pull / skip routing"
 * use-case for cal-sync's sync().
 *
 * 999.1025 increment 10 (EIGHTH EXTRACTION SEAM): carves the top-level routing of
 * the juggler-origin, non-ingest branch out of the per-ledger loop in
 * controllers/cal-sync.controller.js — the hash-based push-skip matrix. Decisions
 * in, effects out: no DB, no HTTP, no provider clients. Given a fully-resolved
 * context it returns WHICH branch fires, the freshly-computed push hash, and the
 * log descriptor(s) the controller must replay for the pure branches.
 *
 * WHAT IT DECIDES (pinned byte-for-byte by W4 golden axes A push/idempotence,
 * C bidirectional, D terminal, K marker-flip-while-missing):
 *   - MERGED FOLLOWER (a chunk absorbed into a contiguous run): action
 *     'skip-merged' — its event is torn down in Phase 3's splitDeleteQueue, so
 *     patching it here would only waste an API call. Checked FIRST, before the
 *     hash is even relevant. Emits a 'skipped' log.
 *   - task changed, event stable → 'push': re-assert the task over its event.
 *     No log (the push effect is silent). newHash carried for last_pushed_hash.
 *   - task changed AND event modified externally → 'external-edit': BOTH sides
 *     moved; the caller delegates to decideExternalEditSync (inc. 7) for the
 *     conflict resolution. Empty logs (that decision owns them).
 *   - task stable, event modified externally, task NOT terminal → 'pull': accept
 *     the calendar edit. Empty logs (the promoted/pulled log's newValues depend
 *     on _buildPullFields output at the call site).
 *   - task stable, event modified externally, task terminal → 'push-terminal-
 *     conflict': terminal tasks are immutable; re-assert the correct date over
 *     the calendar's move. Emits a conflict_juggler log.
 *   - neither changed → 'skip'. Emits a 'skipped' log.
 *
 * taskHash is INJECTED (not imported) so this module stays free of the
 * controllers/cal-sync-helpers dependency — same discipline as
 * decideMissingEventSync (inc. 3). isEventModifiedExternally is a pure sibling
 * predicate (inc. 6), imported directly.
 *
 * EFFECT SPLIT (justified): 'push' and 'push-terminal-conflict' request the SAME
 * push effect at the call site (pendingEventUpdates + pStats.pushed), differing
 * only in the log — which is why push-terminal-conflict carries a fully-formed
 * conflict_juggler descriptor while push carries none. 'external-edit' and 'pull'
 * hand the whole branch (decision + effect + log) back to the caller, so their
 * logs array is empty here.
 *
 * @param {Object} ctx
 *   @param {Object}   ctx.task              resolved task row (id/text/status)
 *   @param {Object}   ctx.event             provider event (lastModified/_etag)
 *   @param {Object}   ctx.ledger            sync ledger row (last_pushed_hash,
 *                                           provider_event_id, last_modified_at,
 *                                           provider_etag)
 *   @param {string}   ctx.pid               provider id ('gcal'|'msft'|'apple')
 *   @param {boolean}  ctx.isMergedFollower  !!mergedFollowers[task.id], by caller
 *   @param {boolean}  ctx.isTaskTerminal    isTerminalStatus(task.status), by caller
 *   @param {Function} ctx.taskHash          injected pure task-hash helper
 *   @param {Object}   ctx.calendarLabels    { pid: label } for sync_history rows
 * @returns {{
 *   action: 'skip-merged'|'push'|'external-edit'|'pull'|'push-terminal-conflict'|'skip',
 *   newHash: string,
 *   logs: Array<{provider:string, action:string, opts:Object}>
 * }}
 */
'use strict';

var { isEventModifiedExternally } = require('./event-modified-predicate');

function decideHashPushSync(ctx) {
  var task = ctx.task;
  var event = ctx.event;
  var ledger = ctx.ledger;
  var pid = ctx.pid;
  var calendarLabels = ctx.calendarLabels;

  // Hash-based skip: push only when the task's push-relevant fields actually
  // differ from what the ledger says we last sent. taskHash covers
  // text/date/time/dur/status/when/project/marker (cal-sync-helpers.js);
  // injected so this module stays DB/controller-free.
  var newHash = ctx.taskHash(task);

  function skippedLog() {
    return {
      provider: pid,
      action: 'skipped',
      opts: {
        taskId: task ? task.id : null,
        taskText: task ? task.text : null,
        eventId: ledger ? ledger.provider_event_id : null,
        calendarName: calendarLabels[pid] || null
      }
    };
  }

  // Merged follower: its event is queued for delete in Phase 3's splitDeleteQueue,
  // so patching it first wastes an API call. Checked before the hash matters.
  if (ctx.isMergedFollower) {
    return { action: 'skip-merged', newHash: newHash, logs: [skippedLog()] };
  }

  var taskChanged = (newHash !== ledger.last_pushed_hash);
  var eventModifiedExternally = isEventModifiedExternally(event, ledger);

  if (taskChanged && !eventModifiedExternally) {
    // Task changed, event stable → push (existing behaviour).
    return { action: 'push', newHash: newHash, logs: [] };
  }
  if (taskChanged && eventModifiedExternally) {
    // Both changed — the caller delegates to decideExternalEditSync (inc. 7).
    return { action: 'external-edit', newHash: newHash, logs: [] };
  }
  if (!taskChanged && eventModifiedExternally && !ctx.isTaskTerminal) {
    // Event changed, task stable, not terminal → pull. The promoted/pulled log's
    // newValues depend on _buildPullFields output (call site), so no log here.
    return { action: 'pull', newHash: newHash, logs: [] };
  }
  if (!taskChanged && eventModifiedExternally && ctx.isTaskTerminal) {
    // Calendar moved a completed task's event → push the correct date back.
    // Terminal tasks are immutable; the calendar edit is rejected.
    return {
      action: 'push-terminal-conflict',
      newHash: newHash,
      logs: [{
        provider: pid,
        action: 'conflict_juggler',
        opts: {
          taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
          detail: 'Calendar moved completed task — pushed correct date back (terminal tasks are immutable)',
          calendarName: calendarLabels[pid] || null
        }
      }]
    };
  }
  // Neither changed → skip (existing behaviour).
  return { action: 'skip', newHash: newHash, logs: [skippedLog()] };
}

module.exports = { decideHashPushSync: decideHashPushSync };
