/**
 * Schedule — aggregate root for a computed schedule.
 *
 * Wraps the scheduler's output contract (`unifiedScheduleV2.js` return value):
 *   { dayPlacements, unplaced, score, slackByTaskId, warnings, placedCount, ... }
 *
 * BEHAVIOR-PRESERVING: this is a read-model over the existing output shape. The
 * scheduler still returns a plain object literal (the golden-master pins every
 * field bit-for-bit); `Schedule.fromResult` adapts that literal so the domain and
 * callers can navigate placements without coupling to the raw map. `toResult`
 * returns the wrapped object unchanged.
 *
 * The aggregate exposes read helpers (`placementsOn`, `allPlacements`,
 * `isPlaced`, `isUnplaced`) that mirror the test harness's own accessors so domain
 * unit tests can assert against the same vocabulary the golden-master uses.
 */

'use strict';

var ScheduledTask = require('./ScheduledTask');

/**
 * @param {Object} result the scheduler output object
 */
function Schedule(result) {
  this._result = result || {};
  this.dayPlacements = this._result.dayPlacements || {};
  this.unplaced = this._result.unplaced || [];
  this.score = this._result.score || null;
  this.slackByTaskId = this._result.slackByTaskId || {};
  this.warnings = this._result.warnings || [];
}

/**
 * Placements on a given day, as ScheduledTask read-models (insertion order
 * preserved — the golden-master relies on insertion == pass order).
 * @param {string} dateKey
 * @returns {ScheduledTask[]}
 */
Schedule.prototype.placementsOn = function placementsOn(dateKey) {
  var entries = this.dayPlacements[dateKey] || [];
  var out = [];
  for (var i = 0; i < entries.length; i++) {
    if (entries[i] && entries[i].task) {
      out.push(ScheduledTask.fromEntry(entries[i], dateKey));
    }
  }
  return out;
};

/**
 * All placements across every day, flattened to ScheduledTask read-models.
 * @returns {ScheduledTask[]}
 */
Schedule.prototype.allPlacements = function allPlacements() {
  var self = this;
  var out = [];
  Object.keys(this.dayPlacements).forEach(function(dk) {
    (self.dayPlacements[dk] || []).forEach(function(p) {
      if (p && p.task) out.push(ScheduledTask.fromEntry(p, dk));
    });
  });
  return out;
};

/**
 * Every placement of `taskId` across all days (a split task has many).
 * @param {string} taskId
 * @returns {ScheduledTask[]}
 */
Schedule.prototype.placementsOf = function placementsOf(taskId) {
  return this.allPlacements().filter(function(st) { return st.taskId() === taskId; });
};

/**
 * @param {string} taskId
 * @returns {boolean} whether `taskId` has at least one placement.
 */
Schedule.prototype.isPlaced = function isPlaced(taskId) {
  return this.placementsOf(taskId).length > 0;
};

/**
 * @param {string} taskId
 * @returns {boolean} whether `taskId` is in the unplaced list.
 */
Schedule.prototype.isUnplaced = function isUnplaced(taskId) {
  return (this.unplaced || []).some(function(t) { return t && t.id === taskId; });
};

/** @returns {Object} the underlying scheduler result object, unchanged. */
Schedule.prototype.toResult = function toResult() {
  return this._result;
};

/**
 * Factory from a scheduler result object.
 * @param {Object} result
 * @returns {Schedule}
 */
Schedule.fromResult = function fromResult(result) {
  return new Schedule(result);
};

module.exports = Schedule;
