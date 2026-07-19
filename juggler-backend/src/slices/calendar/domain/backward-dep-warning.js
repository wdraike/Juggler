/**
 * backward-dep-warning.js — pure backward-dependency warning for cal-sync's
 * pull branch, carved from controllers/cal-sync.controller.js (999.2062,
 * residual [backward-dep-warning]).
 *
 * When a calendar edit pulls a task's scheduled_at to BEFORE a task it depends
 * on, the pull still happens (calendar wins) — but the sync_history detail
 * carries a warning naming the first violated dependency, in dependsOn order.
 *
 * Decisions in, effects out: string in, string out; the logSyncAction effect
 * and the taskUpdates.push stay at the call site.
 *
 * @param {Object} ctx
 *   @param {string|null} ctx.scheduledAt pulled scheduled_at (pullFields.scheduled_at)
 *   @param {Array|*}     ctx.dependsOn   the task's dependency id list
 *   @param {Object}      ctx.tasksById   id → task row for this sync run
 * @returns {string} warning text, or '' when no dependency is violated.
 */

'use strict';

function computeBackwardDepWarning(ctx) {
  var backwardDepWarning = '';
  if (ctx.scheduledAt && Array.isArray(ctx.dependsOn) && ctx.dependsOn.length > 0) {
    var newScheduledMs = new Date(ctx.scheduledAt).getTime();
    for (var bdi = 0; bdi < ctx.dependsOn.length; bdi++) {
      var depId = ctx.dependsOn[bdi];
      var depTask = ctx.tasksById[depId];
      if (depTask && depTask._scheduled_at) {
        var depMs = new Date(depTask._scheduled_at).getTime();
        if (newScheduledMs < depMs) {
          backwardDepWarning = 'Task promoted to before dependency ' + depId;
          break;
        }
      }
    }
  }
  return backwardDepWarning;
}

module.exports = { computeBackwardDepWarning: computeBackwardDepWarning };
