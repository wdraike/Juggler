/**
 * WeatherProviderPort — the driven-port contract for fetching a forecast from an
 * upstream weather provider (today: Open-Meteo). This is the authoritative
 * interface for the weather slice's forecast source.
 *
 * Derived from the legacy controller's `fetchFromOpenMeteo(lat, lon)`
 * (weather.controller.js), which hits the Open-Meteo forecast API for a 14-day
 * hourly forecast in Fahrenheit and returns the raw `{ hourly, hourly_units }`
 * payload.
 *
 * This file defines the contract via JSDoc `@typedef` plus a throw-not-implemented
 * base class, mirroring CalendarPort. Adapters (W2+) either extend the base or
 * export a plain object exposing the required method set. The exported
 * `WEATHER_PROVIDER_PORT_METHODS` array is the machine-checkable list a contract
 * test asserts every adapter conforms to.
 *
 * BEHAVIOR-PRESERVING (W1): contract only. The legacy provider always requests
 * Fahrenheit, `forecast_days=14`, and `timezone=auto`; an adapter implementing
 * this port MUST preserve those request parameters so cached forecasts stay in
 * the Fahrenheit contract the scheduler and cache assume.
 *
 * @typedef {Object} WeatherProviderPort
 *
 * @property {(point: GeoPoint) => Promise<WeatherConstraint>} fetchForecast
 *   Fetch a 14-day hourly forecast (Fahrenheit) for the given grid point.
 *   Implementations call the upstream API using the point's grid coordinates
 *   (latGrid/lonGrid — matching the legacy `fetchFromOpenMeteo(latGrid, lonGrid)`
 *   call) and resolve a WeatherConstraint carrying the `{ hourly, hourly_units }`
 *   payload. Rejects if the upstream returns a non-OK status (legacy:
 *   `throw new Error('Open-Meteo returned ' + resp.status)`).
 */

/**
 * Throw-not-implemented base. Subclasses MUST override every method. The base
 * exists so a partially-implemented adapter fails loudly at the missing method
 * rather than silently returning undefined.
 * @constructor
 */
function WeatherProviderPort() {}

/**
 * @param {GeoPoint} point
 * @returns {Promise<WeatherConstraint>}
 */
WeatherProviderPort.prototype.fetchForecast = function fetchForecast(_point) {
  throw new Error('WeatherProviderPort.fetchForecast not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy
 * WeatherProviderPort. A contract test asserts adapters conform to this list.
 * @type {ReadonlyArray<string>}
 */
var WEATHER_PROVIDER_PORT_METHODS = Object.freeze([
  'fetchForecast'
]);

module.exports = WeatherProviderPort;
module.exports.WeatherProviderPort = WeatherProviderPort;
module.exports.WEATHER_PROVIDER_PORT_METHODS = WEATHER_PROVIDER_PORT_METHODS;
