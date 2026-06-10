/**
 * taskEvents — thin task-lifecycle publisher over the shared lib-events EventBus.
 *
 * H2/W3 (ADR-0001 "adopt lib-events as TaskEventPort bus"): this is the ONE
 * publisher seam that makes lib/events a live importer. It publishes
 * task.created / task.updated / task.completed on the global EventBus
 * singleton after a successful task write.
 *
 * BINDING CONSTRAINTS (ADR-0001 + invariants S4/S6):
 *   - This module MUST NOT trigger the scheduler. It never imports or calls
 *     enqueueScheduleRun / scheduleQueue. The existing direct facade call in
 *     task.controller.js remains the SOLE scheduler trigger (rewiring the
 *     scheduler onto these events is phase H6, explicitly not this phase).
 *   - Publishing is fire-and-forget and error-isolated. EventBus.publish
 *     already wraps each subscriber in try/catch (lib/events/index.js), so a
 *     throwing subscriber cannot break the task write. We add an outer
 *     try/catch as defence-in-depth so a malformed publish (e.g. bad event
 *     type) can never alter the write response either.
 *
 * Payloads are MINIMAL + SERIALIZABLE task identity only (id, userId, status,
 * plus event-specific scalars). No knex objects, no Date.fn handles, no
 * non-serializable values.
 *
 * @module lib/events/taskEvents
 */

const { getEventBus, EventTypes } = require('./index');
const { createLogger } = require('@raike/lib-logger');

const logger = createLogger('lib.events.taskEvents');

/**
 * Resolve the shared singleton EventBus, configured to log subscriber failures
 * through the standard logger. getEventBus() only applies config on first
 * construction, which is fine — the bus is process-wide.
 */
function bus() {
  return getEventBus({
    logger: (level, msg, meta) => {
      const fn = typeof logger[level] === 'function' ? logger[level] : logger.error;
      fn.call(logger, '[taskEvents] ' + msg, meta);
    },
  });
}

/**
 * Publish an event, fully isolated from the caller's write path.
 * Never throws. Returns the EventBus delivery result, or null on failure.
 * @private
 */
function safePublish(eventType, payload) {
  try {
    return bus().publish(eventType, payload);
  } catch (err) {
    // Defence-in-depth: EventBus.publish already isolates per-subscriber
    // errors, but a structural failure (bad event type, etc.) must still
    // never propagate into the task write response.
    logger.error('[taskEvents] publish failed', { eventType, error: err && err.message });
    return null;
  }
}

/**
 * @param {{ id: string, userId: string, status?: string }} task
 */
function publishTaskCreated(task) {
  if (!task || task.id == null || task.userId == null) return null;
  return safePublish(EventTypes.TASK_CREATED, {
    taskId: task.id,
    userId: task.userId,
    status: task.status != null ? String(task.status) : '',
    timestamp: Date.now(),
  });
}

/**
 * @param {{ id: string, userId: string, status?: string }} task
 */
function publishTaskUpdated(task) {
  if (!task || task.id == null || task.userId == null) return null;
  return safePublish(EventTypes.TASK_UPDATED, {
    taskId: task.id,
    userId: task.userId,
    status: task.status != null ? String(task.status) : '',
    timestamp: Date.now(),
  });
}

/**
 * @param {{ id: string, userId: string, status?: string }} task
 */
function publishTaskCompleted(task) {
  if (!task || task.id == null || task.userId == null) return null;
  return safePublish(EventTypes.TASK_COMPLETED, {
    taskId: task.id,
    userId: task.userId,
    status: task.status != null ? String(task.status) : 'done',
    timestamp: Date.now(),
  });
}

module.exports = {
  publishTaskCreated,
  publishTaskUpdated,
  publishTaskCompleted,
};
