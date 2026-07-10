/**
 * scheduleTrigger.js — the mutation→schedule trigger seam (ScheduleTriggerPort).
 *
 * 999.1198 (JUG-REQUIRE-CYCLES-X11): slices/task/facade and lib/task-write-queue
 * used to require scheduler/scheduleQueue (top-level and mid-function lazy
 * respectively) for `enqueueScheduleRun`, closing the require cycles
 *   task facade → scheduleQueue → scheduler facade → runSchedule → task facade
 *   task-write-queue → scheduleQueue → task-write-queue.
 * This module INVERTS that edge: it is a dependency-free registry that
 * scheduler/scheduleQueue populates at ITS load time (see the
 * registerScheduleTrigger call at the bottom of scheduleQueue.js). Producers of
 * schedule runs (the task facade, the write-queue flush) depend only on this
 * seam; nothing here requires scheduleQueue back.
 *
 * Wiring guarantee: every production entrypoint loads scheduleQueue before any
 * mutation can fire (server.js requires it directly; routes/controllers/jobs
 * require it too), so the trigger is always registered in a running app.
 *
 * Unregistered contract: enqueueScheduleRun is a fire-and-forget trigger whose
 * callers ignore its return value. If no trigger has been registered (possible
 * only in isolated unit tests that load the facade without scheduleQueue —
 * previously those tests' jest mocks of scheduleQueue absorbed the call), the
 * call LOUDLY logs an error and performs no work. This mirrors the legacy
 * fire-and-forget contract; it is not a silent data fallback — no schedule
 * state is substituted, and production always has a registered trigger.
 */

'use strict';

var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('scheduleTrigger');

var _enqueueScheduleRun = null;

/**
 * Register the real trigger implementation. Called by scheduler/scheduleQueue
 * at module load; tests may register a stub.
 * @param {Function} fn (userId, source, options) → Promise
 */
function registerScheduleTrigger(fn) {
  _enqueueScheduleRun = fn;
}

/**
 * Enqueue a schedule run via the registered trigger (fire-and-forget seam).
 * Same signature/return as scheduleQueue.enqueueScheduleRun when registered.
 */
function enqueueScheduleRun(userId, source, options) {
  if (!_enqueueScheduleRun) {
    logger.error('[SCHED-TRIGGER] no schedule trigger registered — schedule run NOT enqueued '
      + '(scheduler/scheduleQueue was never loaded) userId=' + userId + ' source=' + (source || 'unknown'));
    return Promise.resolve();
  }
  return _enqueueScheduleRun(userId, source, options);
}

module.exports = {
  registerScheduleTrigger: registerScheduleTrigger,
  enqueueScheduleRun: enqueueScheduleRun
};
