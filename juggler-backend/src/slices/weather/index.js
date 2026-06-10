/**
 * Weather slice — module exports (Wave 3 / W3).
 *
 * Re-exports the facade so consumers/tests can use either shape:
 *
 *   // namespaced
 *   const { weather } = require('./slices/weather');
 *   const fc = await weather.getForecast(lat, lon);
 *
 *   // direct named
 *   const { roundCoord, MockWeatherProvider } = require('./slices/weather');
 *
 * No logic lives here — it is a flat re-export of facade.js (mirrors
 * slices/calendar/index.js).
 */

'use strict';

var facade = require('./facade');

module.exports = Object.assign({ weather: facade }, facade);
