/**
 * Scheduler slice — module exports (Phase H6 / W4).
 *
 * Re-exports the facade so consumers/tests can use either shape:
 *
 *   // namespaced
 *   const { scheduler } = require('./slices/scheduler');
 *   const res = await scheduler.runScheduleAndPersist(userId, undefined, opts);
 *
 *   // direct named
 *   const { deriveSchedulePlacements, RunScheduleCommand } = require('./slices/scheduler');
 *
 * No logic lives here — it is a flat re-export of facade.js (mirrors
 * slices/task/index.js + slices/weather/index.js).
 */

'use strict';

var facade = require('./facade');

module.exports = Object.assign({ scheduler: facade }, facade);
