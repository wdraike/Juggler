/**
 * TimeWindow — value object for a half-open minute-of-day interval [start, end).
 *
 * The scheduler's eligibility/placement loops represent every schedulable span as
 * a `[start, end]` pair of minutes-from-midnight (see `eligibleWindows`,
 * `findEarliestSlot`, `capacityInRange` in `unifiedScheduleV2.js`). This VO gives
 * that pair a named, validated, immutable home without changing the wire shape —
 * the legacy loops still pass bare `[s, e]` arrays, so no algorithm output moves.
 *
 * CHARACTERIZED (H6 W1): `length`/`overlap` reproduce the exact arithmetic the
 * scheduler already uses:
 *   - capacity sums `(e - s)` per window (`capacityInRange`)
 *   - overlap is `Math.max(0, min(ends) - max(starts))` (`overlapWithEligibleWindows`)
 *
 * Half-open semantics: a task of duration `d` fits at `s` iff `s + d <= end`,
 * matching `for (s = ...; s + item.dur <= winEnd; ...)` in `findEarliestSlot`.
 */

'use strict';

/**
 * @param {number} start minute-of-day (inclusive), 0..1440
 * @param {number} end   minute-of-day (exclusive), >= start
 * @throws {Error} if start/end are not finite numbers or end < start
 */
function TimeWindow(start, end) {
  if (typeof start !== 'number' || typeof end !== 'number' ||
      !isFinite(start) || !isFinite(end)) {
    throw new Error('TimeWindow start/end must be finite numbers, got: ' +
      JSON.stringify(start) + ', ' + JSON.stringify(end));
  }
  if (end < start) {
    throw new Error('TimeWindow end (' + end + ') must be >= start (' + start + ')');
  }
  this.start = start;
  this.end = end;
  Object.freeze(this);
}

/** @returns {number} window length in minutes (matches `(e - s)`). */
TimeWindow.prototype.length = function length() {
  return this.end - this.start;
};

/**
 * @param {number} dur duration in minutes
 * @param {number} [at] candidate start (defaults to this.start)
 * @returns {boolean} whether a `dur`-minute task fits (half-open: at+dur <= end)
 */
TimeWindow.prototype.canFit = function canFit(dur, at) {
  var s = at == null ? this.start : at;
  return s >= this.start && s + dur <= this.end;
};

/**
 * Overlap length (minutes) between this window and another window or [s,e] slot.
 * BYTE-IDENTICAL to `overlapWithEligibleWindows`'s per-window arithmetic.
 * @param {(TimeWindow|{start:number,end:number})} other
 * @returns {number} overlap minutes (0 when disjoint)
 */
TimeWindow.prototype.overlap = function overlap(other) {
  var oStart = Math.max(this.start, other.start);
  var oEnd = Math.min(this.end, other.end);
  return oEnd > oStart ? (oEnd - oStart) : 0;
};

/**
 * Factory from a bare `[start, end]` pair (the shape the scheduler loops use).
 * @param {[number, number]} pair
 * @returns {TimeWindow}
 */
TimeWindow.fromPair = function fromPair(pair) {
  return new TimeWindow(pair[0], pair[1]);
};

/** @returns {[number, number]} the bare pair shape used by the placement loops. */
TimeWindow.prototype.toPair = function toPair() {
  return [this.start, this.end];
};

/**
 * @param {*} other
 * @returns {boolean}
 */
TimeWindow.prototype.equals = function equals(other) {
  return other instanceof TimeWindow &&
    other.start === this.start && other.end === this.end;
};

module.exports = TimeWindow;
