/**
 * ScoredSchedule — a schedule paired with its quality score.
 *
 * Wraps the `{ total, breakdown, details }` shape `ScoreEngine.score` returns
 * (the byte-identical successor of `scoreSchedule.js`). Lower total = better;
 * 0 = perfect.
 *
 * BEHAVIOR-PRESERVING: `ScoreEngine.score` returns the plain `{total, breakdown,
 * details}` literal the golden-master pins. This entity is an optional read-model
 * over that literal (used by callers/tests that want a named score object); it
 * does not change any scoring output.
 */

'use strict';

/**
 * The breakdown penalty categories, in the fixed key order the scorer emits.
 * @type {ReadonlyArray<string>}
 */
var BREAKDOWN_KEYS = Object.freeze([
  'unplaced', 'deadlineMiss', 'priorityDrift', 'crossDayPri', 'dateDrift', 'fragmentation'
]);

/**
 * @param {Object} score the `{ total, breakdown, details }` object
 */
function ScoredSchedule(score) {
  score = score || {};
  this.total = score.total;
  this.breakdown = score.breakdown || {};
  this.details = score.details || [];
  Object.freeze(this);
}

ScoredSchedule.BREAKDOWN_KEYS = BREAKDOWN_KEYS;

/** @returns {boolean} whether this schedule is penalty-free (total === 0). */
ScoredSchedule.prototype.isPerfect = function isPerfect() {
  return this.total === 0;
};

/**
 * Penalty detail entries of a given type (e.g. 'unplaced', 'deadlineMiss').
 * @param {string} type
 * @returns {Object[]}
 */
ScoredSchedule.prototype.detailsOfType = function detailsOfType(type) {
  return (this.details || []).filter(function(d) { return d && d.type === type; });
};

/**
 * Factory from a raw score object.
 * @param {Object} score
 * @returns {ScoredSchedule}
 */
ScoredSchedule.from = function from(score) {
  return new ScoredSchedule(score);
};

module.exports = ScoredSchedule;
