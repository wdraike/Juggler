/**
 * User-config slice — module exports (Phase H4 / W6).
 *
 * Re-exports the facade so consumers/tests can use either shape:
 *
 *   // namespaced
 *   const { userConfig } = require('./slices/user-config');
 *   const res = await userConfig.getAllConfig({ userId });
 *
 *   // direct named
 *   const { KnexConfigRepository } = require('./slices/user-config');
 *
 * No logic lives here — it is a flat re-export of facade.js (mirrors
 * slices/task/index.js + slices/weather/index.js).
 */

'use strict';

var facade = require('./facade');

module.exports = Object.assign({ userConfig: facade }, facade);
