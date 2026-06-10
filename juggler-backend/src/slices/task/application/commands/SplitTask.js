/**
 * SplitTask — application command use-case (Phase H3 / W5; WBS-named command, S7).
 *
 * There is NO dedicated "split" HTTP handler in the legacy controller (verified:
 * task.routes.js has no /split route). In juggler, "split" is a PROPERTY of a task
 * (`split` / `split_min` columns), applied through the create/update path; the
 * actual SPLIT-CHUNK rows (task_type='recurring_instance' with split_total > 1,
 * S7 term "split chunk") are generated downstream by the SCHEDULER from a
 * split-enabled task — NOT by a task-controller handler. SplitTask therefore is
 * the behavior-preserving command that marks a task split-enabled and routes it
 * through the SAME create/update orchestration (so validation, the split-min
 * cross-field check, same-day placement, and the S7 term derivation are all the
 * already-characterized paths — no new behavior).
 *
 * It sets `split: true` (and `splitMin` when supplied) on the body and delegates
 * to the injected CreateTask (new task) or UpdateTask (existing task) use-case.
 * This keeps the S7 "split chunk" term + same-day placement EXACTLY as the domain
 * + scheduler already produce them (W2 mappers preserve split_ordinal/split_total/
 * split_group; the scheduler places chunks same-day) — SplitTask adds no placement
 * logic of its own.
 *
 * @typedef {Object} SplitTaskDeps
 * @property {{execute: Function}} createTask  a CreateTask instance.
 * @property {{execute: Function}} updateTask  an UpdateTask instance.
 */

'use strict';

/** @param {SplitTaskDeps} deps */
function SplitTask(deps) {
  if (!deps || !deps.createTask || typeof deps.createTask.execute !== 'function'
      || !deps.updateTask || typeof deps.updateTask.execute !== 'function') {
    throw new Error('SplitTask: { createTask, updateTask } (use-case instances) are required');
  }
  this.createTask = deps.createTask;
  this.updateTask = deps.updateTask;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {Object} input.body  the task body; `split` is forced true, `splitMin`
 *   carried through if present.
 * @param {string} [input.id]  when present → UpdateTask (existing task); else
 *   CreateTask (new split-enabled task).
 * @param {string} [input.timezoneHeader]
 * @returns {Promise<{ status: number, body: Object }>}
 */
SplitTask.prototype.execute = function execute(input) {
  var body = Object.assign({}, input.body || {});
  body.split = true;
  // splitMin is carried through verbatim if the caller supplied one; otherwise the
  // create/update path applies the user's split default exactly as today.
  if (input.id) {
    return this.updateTask.execute({
      id: input.id,
      userId: input.userId,
      body: body,
      timezoneHeader: input.timezoneHeader
    });
  }
  return this.createTask.execute({
    userId: input.userId,
    body: body,
    timezoneHeader: input.timezoneHeader
  });
};

module.exports = SplitTask;
