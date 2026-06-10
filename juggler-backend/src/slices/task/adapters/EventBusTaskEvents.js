/**
 * EventBusTaskEvents — TaskEventPort implementation over the H2 lib/events
 * publisher seam (Phase H3 / W4). Formalizes `lib/events/taskEvents` (the H2
 * publisher hooked at `task.controller.js:29`) into the slice's driven port.
 *
 * ── ADR-0001: PUBLISHER ONLY ─────────────────────────────────────────────────
 * This adapter PUBLISHES `task.created` / `task.updated` / `task.completed`
 * (`EventTypes.TASK_CREATED/UPDATED/COMPLETED`) on the shared EventBus singleton
 * after a successful task write. It delegates to the H2 `taskEvents` publisher,
 * so the emitted EventTypes + serializable payloads are IDENTICAL to the H2
 * behavior the W1 golden-master (Surface 7) captured:
 *
 *   payload = { taskId, userId, status, timestamp }
 *     taskId    : String(task.id)        (carried through unchanged)
 *     userId    : task.userId
 *     status    : String(task.status)    ('' when nullish on created/updated;
 *                 'done' default on completed — H2 parity)
 *     timestamp : Date.now()             (JS epoch NUMBER — serializable)
 *
 * Nullish guard (H2 parity): a publish is a no-op (returns null) when
 * `task.id`/`task.userId` is nullish.
 *
 * ── INVARIANT E-1 (S4/S6 — PUBLISHER NEVER TRIGGERS THE SCHEDULER) ───────────
 * This module MUST NOT import or call `enqueueScheduleRun` / `scheduleQueue`,
 * and publishing MUST NOT trigger or cascade a schedule run. The H2 `taskEvents`
 * module it wraps holds this invariant (it imports neither the scheduler queue
 * nor the runner); this adapter adds NO scheduler edge of its own. The direct
 * `enqueueScheduleRun` facade call remains the SOLE scheduler trigger through
 * H3–H5; the scheduler subscribing to these events is H6, out of this leg.
 * Decoupled by construction: emitting an event has zero edge to the schedule
 * trigger.
 *
 * ── INVARIANT E-2 (fire-and-forget, error-isolated) ─────────────────────────
 * A publish MUST NOT throw into — or alter — the task write response. The H2
 * publisher wraps publish in try/catch and returns null on failure; this adapter
 * preserves that. No `|| default` is introduced.
 *
 * ── INVARIANT E-3 (minimal serializable payload) ────────────────────────────
 * Payloads carry minimal serializable task identity only — no Knex objects, no
 * `Date.fn` handles, no non-serializable values. Inherited from the H2 publisher
 * and asserted by the W4 unit suite.
 *
 * @implements {import('../domain/ports/TaskEventPort')}
 */

'use strict';

var TaskEventPort = require('../domain/ports/TaskEventPort');
// Delegate to the H2 publisher seam — the single source of the emitted
// EventTypes + payload shape (ADR-0001). Wrapping (not reimplementing) it
// guarantees the adapter cannot drift from the H2/golden-master behavior, and
// keeps the S4/S6 guarantee: taskEvents imports NO scheduler.
var taskEvents = require('../../../lib/events/taskEvents');

/**
 * @constructor
 * @param {object} [publisher] A task-events publisher exposing
 *   publishTaskCreated/Updated/Completed. Defaults to the H2 lib/events
 *   `taskEvents` module — explicit default, NOT a `||` silent substitution for a
 *   maybe-missing value. Injectable for the W4 unit/contract tests.
 */
function EventBusTaskEvents(publisher) {
  this._publisher = publisher === undefined ? taskEvents : publisher;
}

EventBusTaskEvents.prototype = Object.create(TaskEventPort.prototype);
EventBusTaskEvents.prototype.constructor = EventBusTaskEvents;

/**
 * Publish `TASK_CREATED`. No-op (returns null) if `task.id`/`task.userId` is
 * nullish — matches the H2 publisher guard.
 * @param {{ id: string, userId: string, status?: string }} task
 * @returns {*}
 */
EventBusTaskEvents.prototype.publishTaskCreated = function publishTaskCreated(task) {
  return this._publisher.publishTaskCreated(task);
};

/**
 * Publish `TASK_UPDATED`. Same nullish guard.
 * @param {{ id: string, userId: string, status?: string }} task
 * @returns {*}
 */
EventBusTaskEvents.prototype.publishTaskUpdated = function publishTaskUpdated(task) {
  return this._publisher.publishTaskUpdated(task);
};

/**
 * Publish `TASK_COMPLETED` (status defaults to 'done' when absent — H2 parity).
 * Same nullish guard.
 * @param {{ id: string, userId: string, status?: string }} task
 * @returns {*}
 */
EventBusTaskEvents.prototype.publishTaskCompleted = function publishTaskCompleted(task) {
  return this._publisher.publishTaskCompleted(task);
};

module.exports = EventBusTaskEvents;
module.exports.EventBusTaskEvents = EventBusTaskEvents;
