/**
 * TaskEventPort — driven-port contract for publishing task-lifecycle events
 * (Phase H3 — defined in W3, IMPLEMENTED in W4 by `EventBusTaskEvents` over
 * lib/events; formalizes the H2 `lib/events/taskEvents` publisher seam).
 *
 * Models the H2 publisher exactly (ADR-0001 — lib-events is the task event bus):
 * three publish methods that emit `task.created` / `task.updated` /
 * `task.completed` (`EventTypes.TASK_CREATED/UPDATED/COMPLETED`) on the shared
 * EventBus singleton after a successful task write.
 *
 * ── BINDING INVARIANTS (ADR-0001 + S4/S6) ────────────────────────────────────
 *
 * INVARIANT E-1 (PUBLISHER ONLY — never triggers the scheduler, S4/S6):
 *   This port PUBLISHES task events. It MUST NOT import or call
 *   `enqueueScheduleRun` / `scheduleQueue`, and publishing MUST NOT trigger or
 *   cascade a schedule run. The direct `enqueueScheduleRun` facade call remains
 *   the SOLE scheduler trigger through H3–H5; the scheduler subscribing to these
 *   events is H6, explicitly out of this leg. Decoupled by construction: emitting
 *   an event has no edge to the schedule trigger.
 *
 * INVARIANT E-2 (fire-and-forget, error-isolated):
 *   A publish MUST NOT throw into — or alter — the task write response. The H2
 *   publisher wraps publish in try/catch and returns null on failure; the W4
 *   adapter preserves this. No `|| default` is introduced.
 *
 * INVARIANT E-3 (minimal serializable payload):
 *   Payloads carry MINIMAL, SERIALIZABLE task identity only — `{ taskId, userId,
 *   status, timestamp }` (timestamp a JS epoch number). No Knex objects, no
 *   `Date.fn` handles, no non-serializable values. Pinned by the W1 golden-master
 *   Surface-7 serialization assertions.
 *
 * Contract only (W3) — JSDoc `@typedef` + throw-not-implemented base.
 *
 * @typedef {Object} TaskEventPort
 *
 * @property {(task: {id: string, userId: string, status?: string}) => *} publishTaskCreated
 *   Publish `TASK_CREATED`. No-op (returns null) if `task.id`/`task.userId` is
 *   nullish — matches the H2 publisher guard. (Legacy: `taskEvents.publishTaskCreated`.)
 *
 * @property {(task: {id: string, userId: string, status?: string}) => *} publishTaskUpdated
 *   Publish `TASK_UPDATED`. Same nullish guard. (Legacy: `taskEvents.publishTaskUpdated`.)
 *
 * @property {(task: {id: string, userId: string, status?: string}) => *} publishTaskCompleted
 *   Publish `TASK_COMPLETED` (status defaults to 'done' when absent — H2 parity).
 *   Same nullish guard. (Legacy: `taskEvents.publishTaskCompleted`.)
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses (W4 `EventBusTaskEvents`) MUST override
 * every method.
 * @constructor
 */
function TaskEventPort() {}

TaskEventPort.prototype.publishTaskCreated = function publishTaskCreated(_task) {
  throw new Error('TaskEventPort.publishTaskCreated not implemented');
};

TaskEventPort.prototype.publishTaskUpdated = function publishTaskUpdated(_task) {
  throw new Error('TaskEventPort.publishTaskUpdated not implemented');
};

TaskEventPort.prototype.publishTaskCompleted = function publishTaskCompleted(_task) {
  throw new Error('TaskEventPort.publishTaskCompleted not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy TaskEventPort.
 * @type {ReadonlyArray<string>}
 */
var TASK_EVENT_PORT_METHODS = Object.freeze([
  'publishTaskCreated',
  'publishTaskUpdated',
  'publishTaskCompleted'
]);

module.exports = TaskEventPort;
module.exports.TaskEventPort = TaskEventPort;
module.exports.TASK_EVENT_PORT_METHODS = TASK_EVENT_PORT_METHODS;
