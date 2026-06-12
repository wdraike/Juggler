/**
 * scoreSchedule — compute a quality score for a proposed schedule.
 *
 * Lower score = better. 0 = perfect.
 *
 * H6 W1: the scoring algorithm now lives in the pure domain core
 * (`src/slices/scheduler/domain/logic/ScoreEngine.js`). This module is a thin,
 * behavior-identical DELEGATOR kept at the legacy path so existing consumers
 * (`unifiedScheduleV2.js`, the C-SCORE golden-master) need no import changes.
 * The output is byte-for-byte identical to ScoreEngine.score.
 *
 * @param {Object} dayPlacements  { dateKey: [ { task, start, dur, ...} ] }
 * @param {Array}  unplaced       Array of task objects that could not be placed
 * @param {Array}  allTasks       All task objects that were considered
 * @returns {{ total: number, breakdown: Object, details: Array }}
 */

var ScoreEngine = require('../slices/scheduler/domain/logic/ScoreEngine');

function scoreSchedule(dayPlacements, unplaced, allTasks) {
  return ScoreEngine.score(dayPlacements, unplaced, allTasks);
}

module.exports = scoreSchedule;
