/**
 * push-eligibility.js — pure "should this task be pushed as a NEW event?"
 * predicate for cal-sync's sync() Phase 3a.
 *
 * 999.1025 increment 10 (NINTH EXTRACTION SEAM): carves the per-task filter that
 * builds the unledgered-task push queue out of the loop in
 * controllers/cal-sync.controller.js. Decisions in, effects out: no DB, no HTTP.
 * Given a task and the run's resolved Set/window state it returns a single
 * boolean — the pushQueue.push effect stays at the call site.
 *
 * WHAT IT DECIDES — the task is push-eligible ONLY when NONE of these skip
 * conditions hold (each mirrors a `continue` in the original loop, in order;
 * pinned by W4 golden axes A push-only + N split-chunk choreography):
 *   1. already processed this run (processedTaskIds) — skip.
 *   2. already has an active ledger row (ledgeredTaskIds) — skip; the ledgered
 *      branch (Phase 2) owns it.
 *   3. a merged follower (its slot is covered by the leader's expanded event) — skip.
 *   4. terminal-or-disabled status (done/cancel/skip/pause/disabled) — skip. Note
 *      this is the LITERAL five-status list, which ADDS 'disabled' to the four
 *      isTerminalStatus() states; preserved verbatim, NOT swapped for the helper.
 *   5. recurring_template (templates never live on calendars) — skip.
 *   6. unscheduled (the scheduler couldn't place it) — skip.
 *   7. no date, or no time AND not an all-day task — skip (nothing to schedule).
 *   8. already carries this provider's event id, UNLESS just cleared for split
 *      replacement (splitReplacedIds) — skip; it isn't a NEW event.
 *   9. scheduled instant before todayStart or after windowEnd — skip (out of the
 *      sync window). The _scheduled_at parse (Date passthrough, else tz-less
 *      string → UTC via `.replace(' ','T')+'Z'`) is preserved exactly.
 *
 * The provider event-id column → camelCase property mapping
 * (gcal_event_id→gcalEventId, msft_event_id→msftEventId, else appleEventId) is
 * resolved from ctx.eventIdCol, byte-identical to the call site.
 *
 * @param {Object} ctx
 *   @param {Object}   ctx.task              candidate task row
 *   @param {Set}      ctx.processedTaskIds  ids already handled this run
 *   @param {Set}      ctx.ledgeredTaskIds   ids with an active ledger row
 *   @param {Object}   ctx.mergedFollowers   { taskId: true } absorbed followers
 *   @param {Set}      ctx.splitReplacedIds  ids whose stale event id was cleared
 *   @param {string}   ctx.eventIdCol        pAdapter.getEventIdColumn() result
 *   @param {Date}     ctx.todayStart        sync-window lower bound
 *   @param {Date}     ctx.windowEnd         sync-window upper bound
 * @returns {boolean} true iff the task should be added to the push queue.
 */
'use strict';

var { isAllDayTaskBackend } = require('../../../lib/isAllDayTaskBackend');

function isTaskPushEligible(ctx) {
  var task = ctx.task;

  if (ctx.processedTaskIds.has(task.id)) return false;
  if (ctx.ledgeredTaskIds.has(task.id)) return false;
  // Followers in a merged-chunks run: their time slot is covered by the leader's
  // expanded event; don't push a separate event.
  if (ctx.mergedFollowers[task.id]) return false;

  var taskStatus = task.status || '';
  if (taskStatus === 'done' || taskStatus === 'cancel' || taskStatus === 'skip' || taskStatus === 'pause' || taskStatus === 'disabled') return false;

  if (task.taskType === 'recurring_template') return false;
  if (task.unscheduled) return false;
  if (!task.date) return false;
  if (!task.time && !isAllDayTaskBackend(task)) return false;

  // Skip tasks with existing event IDs — unless they were just cleared for split replacement.
  var eventIdCol = ctx.eventIdCol;
  var existingEvId = task[(eventIdCol === 'gcal_event_id' ? 'gcalEventId' : eventIdCol === 'msft_event_id' ? 'msftEventId' : 'appleEventId')];
  if (existingEvId && !ctx.splitReplacedIds.has(task.id)) return false;

  var taskSA = task._scheduled_at instanceof Date ? task._scheduled_at : new Date(String(task._scheduled_at).replace(' ', 'T') + 'Z');
  if (taskSA < ctx.todayStart) return false;
  if (taskSA > ctx.windowEnd) return false;

  return true;
}

module.exports = { isTaskPushEligible: isTaskPushEligible };
