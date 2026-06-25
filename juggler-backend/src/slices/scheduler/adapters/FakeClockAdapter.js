/**
 * FakeClockAdapter — test-double ClockPort. Phase H6 / W2.
 *
 * A controllable, deterministic clock for testing. Implements the full ClockPort
 * interface plus time-travel helpers (advance, tick, skipDays, setTime, reset).
 *
 * Usage:
 *   var clock = new FakeClockAdapter();
 *   clock.now()           // current fake time
 *   clock.advance(3600000) // jump forward 1 hour
 *   clock.tick()          // jump forward 1 minute
 *   clock.skipDays(1)     // jump forward 1 day
 *   clock.setTime(new Date('2026-01-01T00:00:00Z')) // set to specific time
 *   clock.reset()         // return to real time
 *
 * The adapter maintains an internal `_now` that starts at the real process clock
 * but can be advanced, set, or reset. `dbNow()` returns the same fake time as
 * `now()` (no separate DB clock simulation), making it deterministic for tests.
 */

'use strict';

var CLOCK_PORT_METHODS = require('../domain/ports/ClockPort').CLOCK_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Date} [deps.startTime] initial time (default: real `new Date()`).
 */
function FakeClockAdapter(deps) {
  var d = deps || {};
  this._now = d.startTime ? new Date(d.startTime) : new Date();
  this._realNow = null; // filled on first reset()
}

FakeClockAdapter.prototype.now = function now() {
  return new Date(this._now);
};

FakeClockAdapter.prototype.dbNow = async function dbNow(/* db */) {
  // For tests, dbNow returns the same fake time as now() — deterministic.
  // In real usage, MysqlClockAdapter reads SELECT NOW(3) from MySQL.
  return new Date(this._now);
};

FakeClockAdapter.prototype.advance = function advance(milliseconds) {
  this._now = new Date(this._now.getTime() + milliseconds);
  return this;
};

FakeClockAdapter.prototype.tick = function tick() {
  return this.advance(60 * 1000); // 1 minute in milliseconds
};

FakeClockAdapter.prototype.skipHours = function skipHours(hours) {
  return this.advance(hours * 60 * 60 * 1000); // hours → milliseconds
};

FakeClockAdapter.prototype.skipDays = function skipDays(days) {
  return this.advance(days * 24 * 60 * 60 * 1000); // days → milliseconds
};

FakeClockAdapter.prototype.setTime = function setTime(date) {
  this._now = new Date(date);
  return this;
};

FakeClockAdapter.prototype.reset = function reset() {
  if (!this._realNow) {
    this._realNow = new Date();
  }
  this._now = new Date(this._realNow);
  return this;
};

module.exports = FakeClockAdapter;
module.exports.FakeClockAdapter = FakeClockAdapter;
module.exports.CLOCK_PORT_METHODS = CLOCK_PORT_METHODS;