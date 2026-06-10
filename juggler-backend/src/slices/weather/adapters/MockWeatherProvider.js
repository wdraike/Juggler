/**
 * MockWeatherProvider — a deterministic, dependency-free test double that
 * implements WeatherProviderPort (WEATHER_PROVIDER_PORT_METHODS) and, for
 * convenience, the GeocodePort surface (GEOCODE_PORT_METHODS). It serves the
 * weather slice's fixtures the way InMemoryCalendarAdapter serves the calendar
 * slice: no network, no DB, no real API keys.
 *
 * Construction modes:
 *   new MockWeatherProvider()                  → returns an empty forecast.
 *   new MockWeatherProvider({ forecast })      → always returns this forecast.
 *   new MockWeatherProvider({ forecastFor })   → forecastFor(point) → payload,
 *                                                 for per-grid-cell goldens.
 *
 * Forecasts may be supplied as a raw `{ hourly, hourly_units }` payload or a
 * WeatherConstraint; both are coerced via WeatherConstraint.from /
 * fromForecastJson so callers always receive a WeatherConstraint (matching the
 * real OpenMeteoWeatherAdapter return type).
 *
 * Geocode doubles (`forwardGeocode` / `reverseGeocode`) resolve from injected
 * maps so a test can stub place-name lookups deterministically. They are part of
 * GEOCODE_PORT_METHODS but live here as a convenience double (mirroring how the
 * InMemory calendar adapter bundles test-support helpers).
 */

'use strict';

var GeoPoint = require('../domain/value-objects/GeoPoint');
var WeatherConstraint = require('../domain/entities/WeatherConstraint');

var WEATHER_PROVIDER_PORT_METHODS = require('../domain/ports/WeatherProviderPort')
  .WEATHER_PROVIDER_PORT_METHODS;
var GEOCODE_PORT_METHODS = require('../domain/ports/GeocodePort').GEOCODE_PORT_METHODS;

function toConstraint(value) {
  if (value == null) return new WeatherConstraint({});
  if (value instanceof WeatherConstraint) return value;
  // Accept the raw { hourly, hourly_units } payload shape.
  return WeatherConstraint.fromForecastJson(value);
}

/**
 * @param {Object} [opts]
 * @param {(Object|WeatherConstraint)} [opts.forecast] fixed forecast for every point.
 * @param {(point: GeoPoint) => (Object|WeatherConstraint)} [opts.forecastFor]
 *   per-point forecast resolver (takes precedence over `forecast`).
 * @param {Object<string, {lat:number, lon:number, displayName:string}>} [opts.forwardMap]
 *   query → forward-geocode result.
 * @param {Object<string, string>} [opts.reverseMap]
 *   GeoPoint.reverseGeocodeCacheKey() → reverse display name.
 */
function MockWeatherProvider(opts) {
  var o = opts || {};
  this._forecast = (o.forecast != null) ? toConstraint(o.forecast) : null;
  this._forecastFor = (typeof o.forecastFor === 'function') ? o.forecastFor : null;
  this._forwardMap = o.forwardMap || {};
  this._reverseMap = o.reverseMap || {};
  // Recorded calls so tests can assert the provider was invoked with the
  // expected grid point.
  this.calls = { fetchForecast: [], forwardGeocode: [], reverseGeocode: [] };
}

/**
 * @param {GeoPoint} point
 * @returns {Promise<WeatherConstraint>}
 */
MockWeatherProvider.prototype.fetchForecast = async function fetchForecast(point) {
  var p = GeoPoint.from(point);
  this.calls.fetchForecast.push(p);
  if (this._forecastFor) return toConstraint(this._forecastFor(p));
  if (this._forecast) return this._forecast;
  return new WeatherConstraint({});
};

/**
 * @param {string} query
 * @returns {Promise<{lat:number, lon:number, displayName:string}>}
 */
MockWeatherProvider.prototype.forwardGeocode = async function forwardGeocode(query) {
  this.calls.forwardGeocode.push(query);
  var hit = this._forwardMap[query];
  if (!hit) {
    var err = new Error('Location not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return hit;
};

/**
 * @param {GeoPoint} point
 * @returns {Promise<string>}
 */
MockWeatherProvider.prototype.reverseGeocode = async function reverseGeocode(point) {
  var p = GeoPoint.from(point);
  this.calls.reverseGeocode.push(p);
  var key = p.reverseGeocodeCacheKey();
  // Explicit presence check (no `||` fallback): an entry mapped to '' is a valid
  // deterministic answer and must pass through unchanged.
  return Object.prototype.hasOwnProperty.call(this._reverseMap, key)
    ? this._reverseMap[key]
    : '';
};

MockWeatherProvider.WEATHER_PROVIDER_PORT_METHODS = WEATHER_PROVIDER_PORT_METHODS;
MockWeatherProvider.GEOCODE_PORT_METHODS = GEOCODE_PORT_METHODS;

module.exports = MockWeatherProvider;
