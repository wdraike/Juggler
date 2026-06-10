/**
 * TaskId — value object wrapping a task's primary-key identity.
 *
 * Task ids in juggler are UUIDv7 strings (see `task.controller.js`:
 * `if (!row.id) row.id = uuidv7();`) but generated recurring instances use a
 * structured synthetic id of the form `rc_<sourceId>_<dateDigits>` (see the
 * scheduler's instance generation). Both are opaque non-empty strings as far as
 * the domain is concerned, so this VO does NOT validate the format — it only
 * enforces the one invariant the persistence + API layers already rely on: an id
 * is a non-empty string. (The controller never coerces a task id; it stores and
 * returns whatever string identity the row carries.)
 *
 * BEHAVIOR-PRESERVING (W2): construction is the only place identity is asserted.
 * The legacy controller carries `row.id` verbatim into `rowToTask`'s output
 * (`id: row.id`) and `taskToRow` only sets `row.id` when `task.id !== undefined`.
 * This VO is an OPTIONAL convenience for the application/repository layers — the
 * mappers continue to pass the raw string id through unchanged (they do not wrap
 * it), so no mapper output changes. Mirrors the EventId / ProviderType VO style.
 */

'use strict';

/**
 * @param {string} value The task id (a non-empty string: UUIDv7 or a synthetic
 *   `rc_<sourceId>_<dateDigits>` instance id).
 * @throws {Error} if `value` is not a non-empty string.
 */
function TaskId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('TaskId must be a non-empty string, got: ' + String(value));
  }
  this.value = value;
  Object.freeze(this);
}

/**
 * The raw string id (round-trips to the DB `id` column and the API `id` field).
 * @returns {string}
 */
TaskId.prototype.toString = function toString() {
  return this.value;
};

/**
 * Value equality on the underlying string.
 * @param {*} other
 * @returns {boolean}
 */
TaskId.prototype.equals = function equals(other) {
  return other instanceof TaskId && other.value === this.value;
};

/**
 * Factory. Returns the input unchanged if it is already a TaskId.
 * @param {(TaskId|string)} value
 * @returns {TaskId}
 */
TaskId.from = function from(value) {
  if (value instanceof TaskId) return value;
  return new TaskId(value);
};

module.exports = TaskId;
