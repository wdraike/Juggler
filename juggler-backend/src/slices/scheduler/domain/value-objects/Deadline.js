/**
 * Deadline — value object over a task's deadline date (ISO `YYYY-MM-DD`).
 *
 * The scheduler compares deadlines as ISO date-keys (string comparison, since
 * `YYYY-MM-DD` sorts lexicographically == chronologically) and as `YYYYMMDD`
 * integers in the scorer. This VO houses both comparison forms without changing
 * the legacy behavior.
 *
 * CHARACTERIZED (H6 W1):
 *   - `toNumber` reproduces `scoreSchedule.parseDateKey` for the ISO branch
 *     (`YYYY-MM-DD` → YYYYMMDD int) — the form the deadline-miss penalty uses.
 *   - `isMissedBy(placedKey)` reproduces the deadline-miss test
 *     `placedNum > deadlineNum` (placed strictly after the deadline day).
 *
 * NULL semantics: a task with no deadline has unconstrained (Infinity) slack in
 * `computeSlack`. This VO models a PRESENT deadline; callers guard absence with
 * `Deadline.isValid` / a null check, mirroring `if (!item.deadlineDate) return Infinity`.
 */

'use strict';

var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @param {string} isoKey deadline date in ISO `YYYY-MM-DD` form
 * @throws {Error} if `isoKey` is not a valid ISO date-key string
 */
function Deadline(isoKey) {
  if (!Deadline.isValid(isoKey)) {
    throw new Error('Deadline must be an ISO YYYY-MM-DD date key, got: ' + JSON.stringify(isoKey));
  }
  this.key = isoKey;
  Object.freeze(this);
}

/**
 * True iff `value` is a well-formed ISO date-key (does not throw).
 * @param {*} value
 * @returns {boolean}
 */
Deadline.isValid = function isValid(value) {
  return typeof value === 'string' && ISO_RE.test(value);
};

/**
 * Convert an ISO date-key to its `YYYYMMDD` integer form. Mirrors the ISO branch
 * of `scoreSchedule.parseDateKey`. Returns null for non-ISO input.
 * @param {string} isoKey
 * @returns {?number}
 */
Deadline.toNumber = function toNumber(isoKey) {
  if (typeof isoKey !== 'string') return null;
  var m = isoKey.match(ISO_RE);
  if (!m) return null;
  return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
};

/** @returns {number} this deadline's `YYYYMMDD` integer form. */
Deadline.prototype.toNumber = function toNumber() {
  return Deadline.toNumber(this.key);
};

/**
 * Was this deadline missed by a placement on `placedKey`?
 * BYTE-IDENTICAL to the scorer's `placedNum > deadlineNum` rule (strictly-after).
 * @param {string} placedKey ISO date-key the task was actually placed on
 * @returns {boolean} true when the placement is strictly after the deadline day
 */
Deadline.prototype.isMissedBy = function isMissedBy(placedKey) {
  var placedNum = Deadline.toNumber(placedKey);
  var deadlineNum = this.toNumber();
  return placedNum != null && deadlineNum != null && placedNum > deadlineNum;
};

/** @returns {string} the raw ISO date-key. */
Deadline.prototype.toString = function toString() {
  return this.key;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
Deadline.prototype.equals = function equals(other) {
  return other instanceof Deadline && other.key === this.key;
};

/**
 * Factory. Returns the input unchanged if it is already a Deadline.
 * @param {(Deadline|string)} value
 * @returns {Deadline}
 */
Deadline.from = function from(value) {
  if (value instanceof Deadline) return value;
  return new Deadline(value);
};

module.exports = Deadline;
