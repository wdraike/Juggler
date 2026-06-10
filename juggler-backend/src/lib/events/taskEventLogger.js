/**
 * taskEventLogger — BENIGN subscriber seam on the shared lib-events EventBus.
 *
 * H2/W3 (ADR-0001): registers debug-level logging subscribers for
 * task.created / task.updated / task.completed so that:
 *   1. lib/events has a live subscriber (importer count > 0, no longer "dead").
 *   2. The subscribe seam that phase H6 will reuse (when the scheduler is
 *      rewired to subscribe to task-mutation events) demonstrably exists.
 *
 * BINDING CONSTRAINTS (invariants S4/S6): this subscriber is BENIGN. It only
 * logs. It MUST NOT trigger the scheduler — it never imports or calls
 * enqueueScheduleRun / scheduleQueue, and introduces no path by which event
 * delivery re-enters the write or scheduling pipeline. The sole scheduler
 * trigger remains the existing direct enqueueScheduleRun call in
 * task.controller.js.
 *
 * Self-registers on require() and is idempotent (guards against double
 * subscription under repeated requires / test reloads).
 *
 * @module lib/events/taskEventLogger
 */

const { getEventBus, EventTypes } = require('./index');
const { createLogger } = require('@raike/lib-logger');

const logger = createLogger('lib.events.taskEventLogger');

let registered = false;
let unsubscribers = [];

/**
 * Register the benign logging subscribers. Idempotent.
 * @returns {Function[]} the unsubscribe functions (also retained internally)
 */
function register() {
  if (registered) return unsubscribers;
  const eventBus = getEventBus();

  const log = (label) => (payload) => {
    // Benign: debug log only. No scheduler, no DB, no re-publish.
    logger.debug('[task-event] ' + label, {
      taskId: payload && payload.taskId,
      userId: payload && payload.userId,
      status: payload && payload.status,
    });
  };

  unsubscribers = [
    eventBus.subscribe(EventTypes.TASK_CREATED, log('created'), { id: 'taskEventLogger:created' }),
    eventBus.subscribe(EventTypes.TASK_UPDATED, log('updated'), { id: 'taskEventLogger:updated' }),
    eventBus.subscribe(EventTypes.TASK_COMPLETED, log('completed'), { id: 'taskEventLogger:completed' }),
  ];

  registered = true;
  return unsubscribers;
}

/**
 * Tear down the subscribers. Primarily for tests.
 */
function unregister() {
  unsubscribers.forEach((fn) => { try { fn(); } catch { /* noop */ } });
  unsubscribers = [];
  registered = false;
}

// Self-register on require so wiring it once at startup (app.js) activates it.
register();

module.exports = { register, unregister };
