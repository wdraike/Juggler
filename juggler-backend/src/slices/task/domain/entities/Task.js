/**
 * Task — the task aggregate's identity + a thin invariant wrapper around the API
 * task object that `rowToTask` produces (Phase H3 / W2).
 *
 * PURE: zero infra requires. This entity does NOT re-map or re-shape the task —
 * the byte-identical row↔API transform lives in `../mappers/taskMappers.js` and
 * stays the single source of truth for that shape (B6). Task is a typed identity
 * carrier the application/repository layers pass around instead of a bare object,
 * with the one invariant the whole system already assumes: a task HAS an id.
 *
 * The full field set is intentionally NOT enumerated as constructor params (the
 * API shape has ~60 fields and is owned by the mapper). Task wraps the mapper's
 * output object verbatim and exposes identity + a couple of characterized
 * classifiers, so adopting the entity changes no payload.
 *
 * BEHAVIOR-PRESERVING: {@link Task.fromApi} stores the API object as-is;
 * {@link Task#toApi} returns it unchanged. No defaulting, no coercion — anything
 * else would diverge from the golden-master payload.
 */

'use strict';

var TaskId = require('../value-objects/TaskId');
var TaskTypeTerm = require('../value-objects/TaskTypeTerm');

/**
 * @param {Object} props The API task object (as produced by `rowToTask`). Must
 *   carry a non-empty string `id`.
 * @throws {Error} if `props` is missing or `props.id` is not a non-empty string.
 */
function Task(props) {
  if (!props || typeof props !== 'object') {
    throw new Error('Task requires a props object');
  }
  // Identity invariant — delegates the non-empty-string rule to TaskId.
  this.id = new TaskId(props.id);
  // Carry the API shape verbatim (the mapper owns it). Frozen shallow copy so the
  // entity is immutable without mutating the caller's object.
  this.props = Object.freeze(Object.assign({}, props));
  Object.freeze(this);
}

/** @returns {string} the raw task id string. */
Task.prototype.idValue = function idValue() {
  return this.id.value;
};

/**
 * The raw `taskType` string the mapper emitted (snake_case DB value, e.g. 'task',
 * 'recurring_instance', 'recurring_template'). Unchanged from the API payload.
 * @returns {?string}
 */
Task.prototype.taskType = function taskType() {
  return this.props.taskType;
};

/**
 * The S7 scheduler classification (a TaskTypeTerm), or null for a
 * recurring_template blueprint. Characterized derivation — see TaskTypeTerm.fromRow.
 * Derived from the API shape's discriminators (taskType / splitTotal / dependsOn).
 * @returns {?TaskTypeTerm}
 */
Task.prototype.s7Term = function s7Term() {
  return TaskTypeTerm.fromRow({
    task_type: this.props.taskType,
    split_total: this.props.splitTotal,
    depends_on: this.props.dependsOn
  });
};

/** @returns {boolean} whether this is a (non-split) recurring instance or split chunk. */
Task.prototype.isRecurringInstance = function isRecurringInstance() {
  return this.props.taskType === 'recurring_instance';
};

/** @returns {boolean} whether this is a recurrence-template blueprint. */
Task.prototype.isTemplate = function isTemplate() {
  return this.props.taskType === 'recurring_template';
};

/** @returns {Object} the API task object, verbatim (byte-identical to input). */
Task.prototype.toApi = function toApi() {
  return this.props;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
Task.prototype.equals = function equals(other) {
  return other instanceof Task && other.id.equals(this.id);
};

/**
 * Build a Task from an API task object (the `rowToTask` output shape).
 * @param {Object} apiTask
 * @returns {Task}
 */
Task.fromApi = function fromApi(apiTask) {
  if (apiTask instanceof Task) return apiTask;
  return new Task(apiTask);
};

module.exports = Task;
