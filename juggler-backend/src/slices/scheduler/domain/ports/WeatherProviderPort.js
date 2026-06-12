/**
 * WeatherProviderPort — driven-port contract for the scheduler's weather read
 * (Phase H6 / W2).
 *
 * Weather-constrained tasks (weatherPrecip / weatherCloud / weatherTempMin…) are
 * placed only in slots whose forecast satisfies the constraint. `runSchedule.js`
 * builds `cfg.weatherByDateHour` by reading the `weather_cache` table for the
 * user's location grid (`loadWeatherForHorizon`, runSchedule.js ~257-293) and the
 * pure core's `weatherOk` reads that map. This port is the seam for that read so
 * the W3 command pulls the forecast through a port, not inline knex + the weather
 * controller's `roundCoord`.
 *
 * Contract only (W2) — JSDoc `@typedef` + throw-not-implemented base.
 *
 * ── BINDING INVARIANT (fail-open preserved — C-WX) ───────────────────────────
 * The legacy read FAILS OPEN at every level: no coords → `{}`; no cache row →
 * `{}`; unparseable forecast JSON → `{}`; missing hourly → `{}`. The pure core
 * then treats a missing date/hour as "weather OK" (`if (!weatherByDateHour ||
 * !weatherByDateHour[dateKey]) return true` and `if (!w) return true`). The
 * adapter MUST reproduce this fail-open exactly — it NEVER throws into the
 * scheduler and NEVER substitutes a "block" default. (C-WX golden-master pins
 * fail-open behavior.)
 *
 * @typedef {Object} WeatherProviderPort
 *
 * @property {(locations: Object[], db?: Function) => Promise<Object>} loadWeatherForHorizon
 *   Build `weatherByDateHour` — `{ [dateKey]: { [hour]: {precipProb, cloudcover,
 *   temp, humidity} } }` — from the `weather_cache` row for the first location
 *   with coords. Returns `{}` (fail-open) when there is no usable forecast.
 *   (Legacy: runSchedule.js `loadWeatherForHorizon`.)
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function WeatherProviderPort() {}

WeatherProviderPort.prototype.loadWeatherForHorizon = function loadWeatherForHorizon(_locations, _db) {
  throw new Error('WeatherProviderPort.loadWeatherForHorizon not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy WeatherProviderPort.
 * @type {ReadonlyArray<string>}
 */
var WEATHER_PROVIDER_PORT_METHODS = Object.freeze([
  'loadWeatherForHorizon'
]);

module.exports = WeatherProviderPort;
module.exports.WeatherProviderPort = WeatherProviderPort;
module.exports.WEATHER_PROVIDER_PORT_METHODS = WEATHER_PROVIDER_PORT_METHODS;
