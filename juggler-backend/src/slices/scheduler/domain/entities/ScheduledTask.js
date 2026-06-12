/**
 * ScheduledTask — one committed placement of a task on a specific day/slot.
 *
 * This is the named, characterized projection of the placement "entry" objects the
 * scheduler pushes into `dayPlacements[dateKey]` (`unifiedScheduleV2.js`):
 *   { task, start, dur, locked, travelBefore, travelAfter, _placementReason, ... }
 *
 * BEHAVIOR-PRESERVING: the legacy loops still build and store bare entry objects
 * (the golden-master pins their exact shape). ScheduledTask is a read-model wrapper
 * the domain (`ScoreEngine`, `ConflictResolver`, callers) can use to reason about a
 * placement without depending on the raw object literal. `fromEntry`/`toEntry`
 * round-trip the legacy shape with NO field changes.
 */

'use strict';

/**
 * @param {Object} spec
 * @param {Object} spec.task the task object placed
 * @param {string} spec.dateKey ISO date-key the placement lives on
 * @param {number} spec.start minute-of-day start
 * @param {number} spec.dur duration in minutes
 * @param {boolean} [spec.locked] immovable placement (fixed/pinned/forced)
 * @param {number} [spec.travelBefore] travel-buffer minutes before
 * @param {number} [spec.travelAfter] travel-buffer minutes after
 * @param {?number} [spec.splitPart] 1-based split-chunk ordinal, when split
 */
function ScheduledTask(spec) {
  spec = spec || {};
  this.task = spec.task;
  this.dateKey = spec.dateKey;
  this.start = spec.start;
  this.dur = spec.dur;
  this.locked = !!spec.locked;
  this.travelBefore = spec.travelBefore || 0;
  this.travelAfter = spec.travelAfter || 0;
  this.splitPart = spec.splitPart != null ? spec.splitPart : null;
  Object.freeze(this);
}

/** @returns {number} exclusive end minute-of-day (start + dur). */
ScheduledTask.prototype.end = function end() {
  return this.start + this.dur;
};

/** @returns {string} the placed task's id (or null). */
ScheduledTask.prototype.taskId = function taskId() {
  return this.task ? this.task.id : null;
};

/**
 * Does this placement's footprint overlap a `[start, start+dur)` slot on the SAME
 * day? Mirrors the half-open overlap test used in `tryPlaceAtTime`'s conflict
 * check: `p.start < start + dur && p.start + p.dur > start`.
 * @param {number} start
 * @param {number} dur
 * @returns {boolean}
 */
ScheduledTask.prototype.overlapsSlot = function overlapsSlot(start, dur) {
  return this.start < start + dur && this.start + this.dur > start;
};

/**
 * Build a ScheduledTask from a legacy `dayPlacements` entry + its date-key.
 * @param {Object} entry the legacy placement entry
 * @param {string} dateKey the day it was stored under
 * @returns {ScheduledTask}
 */
ScheduledTask.fromEntry = function fromEntry(entry, dateKey) {
  return new ScheduledTask({
    task: entry.task,
    dateKey: dateKey,
    start: entry.start,
    dur: entry.dur,
    locked: entry.locked,
    travelBefore: entry.travelBefore,
    travelAfter: entry.travelAfter,
    splitPart: entry.splitPart
  });
};

module.exports = ScheduledTask;
