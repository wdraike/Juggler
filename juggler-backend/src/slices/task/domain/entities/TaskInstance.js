/**
 * TaskInstance — one materialized occurrence of a recurring template, or a split
 * chunk thereof (Phase H3 / W2). PURE — zero infra requires.
 *
 * CHARACTERIZED from the controller's instance model (`task_instances` rows +
 * `rowToTask`): an instance has its own `id`, points at its template via
 * `source_id` (a.k.a. master), and carries the ordinal fields the golden-master
 * pins — `occurrence_ordinal`, `split_ordinal`, `split_total`, `split_group`
 * (W1 makeRecurringInstanceRow / makeSplitChunkRow). A split chunk is exactly a
 * `recurring_instance` with `split_total > 1` (golden-master line 1373) — this
 * entity folds that discriminator into {@link TaskInstance#isSplitChunk}.
 *
 * Invariants enforced:
 *   - identity: non-empty `id` (via TaskId).
 *   - `sourceId` (template/master id) is a non-empty string when present; an
 *     instance without a source is allowed only as the self-linked one-off case
 *     the controller creates (sourceId may equal id) — so sourceId is OPTIONAL
 *     here and only type-checked when given (matches `rowToTask` carrying
 *     `sourceId: row.source_id` verbatim, including null).
 *
 * No reshaping of the task payload — like Task, it wraps the mapper's API object.
 */

'use strict';

var TaskId = require('../value-objects/TaskId');

/**
 * @param {Object} props The API task object for a recurring instance / split
 *   chunk (as produced by `rowToTask`). Must carry a non-empty string `id`.
 * @throws {Error} if `props` is missing, `id` is not a non-empty string, or
 *   `sourceId` is present but not a non-empty string.
 */
function TaskInstance(props) {
  if (!props || typeof props !== 'object') {
    throw new Error('TaskInstance requires a props object');
  }
  this.id = new TaskId(props.id);
  if (props.sourceId !== undefined && props.sourceId !== null) {
    if (typeof props.sourceId !== 'string' || props.sourceId.length === 0) {
      throw new Error('TaskInstance.sourceId must be a non-empty string when present, got: ' + JSON.stringify(props.sourceId));
    }
  }
  this.props = Object.freeze(Object.assign({}, props));
  Object.freeze(this);
}

/** @returns {string} the raw instance id. */
TaskInstance.prototype.idValue = function idValue() {
  return this.id.value;
};

/** @returns {?string} the template/master id this instance derives from (null if standalone). */
TaskInstance.prototype.sourceId = function sourceId() {
  return this.props.sourceId != null ? this.props.sourceId : null;
};

/**
 * @returns {boolean} whether this instance is a split chunk (split_total > 1).
 *   Uses the SAME `Number(splitTotal) > 1` discriminator as the controller
 *   (rowToTask `isSplitChunk`) and the golden-master.
 */
TaskInstance.prototype.isSplitChunk = function isSplitChunk() {
  return Number(this.props.splitTotal) > 1;
};

/** @returns {?number} the occurrence ordinal (undefined→null passthrough preserved). */
TaskInstance.prototype.occurrenceOrdinal = function occurrenceOrdinal() {
  return this.props.occurrenceOrdinal != null ? this.props.occurrenceOrdinal : null;
};

/** @returns {?number} the split ordinal. */
TaskInstance.prototype.splitOrdinal = function splitOrdinal() {
  return this.props.splitOrdinal != null ? this.props.splitOrdinal : null;
};

/** @returns {?number} how many chunks this occurrence was split into. */
TaskInstance.prototype.splitTotal = function splitTotal() {
  return this.props.splitTotal != null ? this.props.splitTotal : null;
};

/** @returns {?string} the split group key grouping chunks of one occurrence. */
TaskInstance.prototype.splitGroup = function splitGroup() {
  return this.props.splitGroup != null ? this.props.splitGroup : null;
};

/** @returns {Object} the API task object, verbatim. */
TaskInstance.prototype.toApi = function toApi() {
  return this.props;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
TaskInstance.prototype.equals = function equals(other) {
  return other instanceof TaskInstance && other.id.equals(this.id);
};

/**
 * @param {Object} apiTask
 * @returns {TaskInstance}
 */
TaskInstance.fromApi = function fromApi(apiTask) {
  if (apiTask instanceof TaskInstance) return apiTask;
  return new TaskInstance(apiTask);
};

module.exports = TaskInstance;
