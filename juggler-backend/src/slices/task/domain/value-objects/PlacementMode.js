/**
 * PlacementMode — closed-enum value object over the `placement_mode` column.
 *
 * CHARACTERIZED (W2), NOT assumed: the accepted set is the EXACT values of
 * `src/lib/placementModes.js`'s `PLACEMENT_MODES`, which the controller already
 * treats as the closed set (`validateTaskInput` does
 * `Object.values(PLACEMENT_MODES).indexOf(body.placementMode) < 0 → reject`).
 * Verified against:
 *   - src/lib/placementModes.js — values match the DB ENUM exactly (migration
 *     20260518000100 placement_mode_enum_redesign):
 *       reminder, all_day, fixed, time_window, time_blocks, anytime
 *   - the W1 golden-master "400 on invalid placementMode" test (rejects
 *     'NOT_VALID') and the take-ownership path that writes placement_mode='anytime'.
 *
 * NULL HANDLING (behavior-preserving): the column is nullable. `rowToTask` emits
 * `placementMode: row.placement_mode` verbatim (so `null` round-trips as `null`),
 * and `taskToRow` only writes `placement_mode` when `task.placementMode !==
 * undefined`. This VO models the NON-NULL accepted values; the application layer
 * uses {@link PlacementMode.isValid} to mirror `validateTaskInput`'s guard, which
 * only runs when `body.placementMode !== undefined`. The mappers are unchanged —
 * they do not wrap placement_mode in this VO — so no mapper output changes.
 *
 * S7 CONTRACT: PlacementMode is a closed enum that rejects unknown terms, exactly
 * as the S7 contract requires. Its canonical set is the placement-mode set
 * (characterized), distinct from the S7 task-type terms (see TaskTypeTerm.js).
 */

'use strict';

var placementLib = require('../../../../lib/placementModes');

// Closed set — characterized from PLACEMENT_MODES (== DB ENUM). Frozen copy so
// the VO owns an immutable canonical list.
var VALUES = Object.freeze(Object.values(placementLib.PLACEMENT_MODES));

/**
 * @param {string} value One of the canonical placement-mode strings.
 * @throws {Error} if `value` is not an accepted placement mode (null/undefined
 *   are NOT accepted by the constructor — callers that allow "no placement mode"
 *   must guard with {@link PlacementMode.isValid} or skip construction, mirroring
 *   `validateTaskInput`'s `!== undefined` guard).
 */
function PlacementMode(value) {
  if (VALUES.indexOf(value) === -1) {
    throw new Error(
      'PlacementMode must be one of [' + VALUES.map(function(v) { return "'" + v + "'"; }).join(', ') +
      '], got: ' + JSON.stringify(value)
    );
  }
  this.value = value;
  Object.freeze(this);
}

/**
 * The canonical accepted values (closed set).
 * @type {ReadonlyArray<string>}
 */
PlacementMode.VALUES = VALUES;

/**
 * True iff `value` is an accepted placement mode (does not throw). Mirrors
 * `validateTaskInput`'s `Object.values(PLACEMENT_MODES).indexOf(...) >= 0` check.
 * @param {*} value
 * @returns {boolean}
 */
PlacementMode.isValid = function isValid(value) {
  return VALUES.indexOf(value) !== -1;
};

/** @returns {string} the raw placement-mode string. */
PlacementMode.prototype.toString = function toString() {
  return this.value;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
PlacementMode.prototype.equals = function equals(other) {
  return other instanceof PlacementMode && other.value === this.value;
};

/**
 * Factory. Returns the input unchanged if it is already a PlacementMode.
 * @param {(PlacementMode|string)} value
 * @returns {PlacementMode}
 */
PlacementMode.from = function from(value) {
  if (value instanceof PlacementMode) return value;
  return new PlacementMode(value);
};

module.exports = PlacementMode;
