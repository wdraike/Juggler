/**
 * Priority — closed-enum value object over a task's priority tier.
 *
 * CHARACTERIZED (H6 W1), NOT assumed: the accepted set and their numeric weights
 * are the EXACT contents of `src/scheduler/constants.js`'s `PRI_RANK`, which the
 * legacy scheduler (`unifiedScheduleV2.js`, `scoreSchedule.js`) already treats as
 * the closed priority set. Verified against:
 *   - src/slices/scheduler/domain/constants.js  PRI_RANK = { P1: 100, P2: 80, P3: 50, P4: 20 }
 *   - unifiedScheduleV2.js `normalizePri` (default 'P3' for unknown/blank input)
 *   - the H6 golden-master CORE/S1 fixtures (P1/P2/P3 tiers, default P3).
 *
 * BEHAVIOR-PRESERVING: `Priority.normalize` reproduces `normalizePri` byte-for-byte
 * (same regexes, same 'P3' default) and `Priority.rank` reproduces `priWeight`'s
 * `PRI_RANK[pri] || PRI_RANK['P3']` lookup. The scheduler delegates to these so the
 * single source of truth lives here; no comparator output changes.
 *
 * S7 PARALLEL: Priority is a closed enum that rejects unknown terms (via the
 * constructor) exactly as the S7 contract requires; the canonical set is the
 * priority set (characterized from PRI_RANK).
 */

'use strict';

var PRI_RANK = require('../constants').PRI_RANK;

// Closed set — characterized from PRI_RANK keys (P1..P4). Frozen copy so the VO
// owns an immutable canonical list.
var VALUES = Object.freeze(Object.keys(PRI_RANK));

/**
 * @param {string} value One of the canonical priority strings (P1..P4).
 * @throws {Error} if `value` is not an accepted priority tier.
 */
function Priority(value) {
  if (VALUES.indexOf(value) === -1) {
    throw new Error(
      'Priority must be one of [' + VALUES.map(function(v) { return "'" + v + "'"; }).join(', ') +
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
Priority.VALUES = VALUES;

/** The default tier for blank/unknown input (matches `normalizePri`). */
Priority.DEFAULT = 'P3';

/**
 * True iff `value` is an accepted priority tier (does not throw).
 * @param {*} value
 * @returns {boolean}
 */
Priority.isValid = function isValid(value) {
  return VALUES.indexOf(value) !== -1;
};

/**
 * Normalize an arbitrary priority-ish input to a canonical tier string.
 * BYTE-IDENTICAL port of `unifiedScheduleV2.normalizePri`: blank → 'P3';
 * 'P1'..'P4' (case-insensitive, trimmed) pass through; bare '1'..'4' → 'P'+n;
 * everything else → 'P3'.
 * @param {*} p
 * @returns {string} canonical tier (P1..P4)
 */
Priority.normalize = function normalize(p) {
  if (!p) return 'P3';
  var s = String(p).trim().toUpperCase();
  if (/^P[1-4]$/.test(s)) return s;
  if (/^[1-4]$/.test(s)) return 'P' + s;
  return 'P3';
};

/**
 * Numeric weight for a (canonical or raw) priority. Higher = more important.
 * BYTE-IDENTICAL port of `scoreSchedule.priWeight`: `PRI_RANK[pri] || PRI_RANK['P3']`.
 * @param {string} pri
 * @returns {number}
 */
Priority.rank = function rank(pri) {
  return PRI_RANK[pri] || PRI_RANK['P3'];
};

/** @returns {string} the raw priority string. */
Priority.prototype.toString = function toString() {
  return this.value;
};

/** @returns {number} this priority's numeric rank. */
Priority.prototype.rank = function rank() {
  return PRI_RANK[this.value] || PRI_RANK['P3'];
};

/**
 * @param {*} other
 * @returns {boolean}
 */
Priority.prototype.equals = function equals(other) {
  return other instanceof Priority && other.value === this.value;
};

/**
 * Factory. Normalizes raw input through `Priority.normalize`, then constructs.
 * Returns the input unchanged if it is already a Priority.
 * @param {(Priority|string)} value
 * @returns {Priority}
 */
Priority.from = function from(value) {
  if (value instanceof Priority) return value;
  return new Priority(Priority.normalize(value));
};

module.exports = Priority;
