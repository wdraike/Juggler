/**
 * Task slice — module exports (Phase H3 / W6).
 *
 * Re-exports the facade so consumers/tests can use either shape:
 *
 *   // namespaced
 *   const { task } = require('./slices/task');
 *   const res = await task.createTask({ userId, body });
 *
 *   // direct named
 *   const { rowToTask, KnexTaskRepository } = require('./slices/task');
 *
 * No logic lives here — it is a flat re-export of facade.js (mirrors
 * slices/weather/index.js + slices/calendar/index.js).
 */

'use strict';

var facade = require('./facade');

module.exports = Object.assign({ task: facade }, facade);
