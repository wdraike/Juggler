/**
 * OpenMeteoWeatherAdapter — concrete WeatherProviderPort implementation
 * (WEATHER_PROVIDER_PORT_METHODS) backed by the Open-Meteo forecast API.
 *
 * Hexagonal slice (Wave 2 / W2): the forecast fetch is lifted VERBATIM out of
 * `src/controllers/weather.controller.js`'s `fetchFromOpenMeteo(lat, lon)`. The
 * URL, query params (hourly fields, `forecast_days=14`,
 * `temperature_unit=fahrenheit`, `timezone=auto`), the non-OK status check
 * (`throw new Error('Open-Meteo returned ' + status)`), and the parsed
 * `{ hourly, hourly_units }` payload are byte-identical to the legacy code on
 * the happy path. The controller is NOT yet repointed (that is W3); this module
 * only ADDS the adapter.
 *
 * fetchForecast(point) takes a GeoPoint and uses its GRID coordinates
 * (latGrid/lonGrid) — matching the legacy `fetchFromOpenMeteo(latGrid, lonGrid)`
 * call site — then resolves a WeatherConstraint carrying the payload.
 *
 * B6 (NEW BEHAVIOR): the bare legacy `fetch(url)` is replaced with
 * fetchWithTimeout, which arms an AbortController and rejects if the upstream
 * hangs past EXTERNAL_CALL_TIMEOUT_MS. Happy-path output is unchanged.
 *
 * `fetchImpl` / `timeoutMs` are injectable for unit tests (default: global fetch
 * + the named slice constant). Mirrors the InMemory/Knex adapters' DI style.
 */

'use strict';

var GeoPoint = require('../domain/value-objects/GeoPoint');
var WeatherConstraint = require('../domain/entities/WeatherConstraint');
var fetchWithTimeout = require('./fetchWithTimeout');
var constants = require('./constants');

var WEATHER_PROVIDER_PORT_METHODS = require('../domain/ports/WeatherProviderPort')
  .WEATHER_PROVIDER_PORT_METHODS;

/**
 * Build the Open-Meteo forecast URL exactly as the legacy controller did.
 * @param {(number|string)} lat grid latitude
 * @param {(number|string)} lon grid longitude
 * @returns {string}
 */
function buildForecastUrl(lat, lon) {
  return constants.OPEN_METEO_FORECAST_URL +
    '?latitude=' + lat +
    '&longitude=' + lon +
    '&hourly=temperature_2m,precipitation_probability,precipitation,cloudcover,weathercode,relativehumidity_2m' +
    '&forecast_days=14' +
    '&temperature_unit=fahrenheit' +
    '&timezone=auto';
}

/**
 * @param {Object} [deps]
 * @param {Function} [deps.fetchImpl] fetch impl (default: global fetch).
 * @param {number} [deps.timeoutMs] B6 abort budget (default: EXTERNAL_CALL_TIMEOUT_MS).
 */
function OpenMeteoWeatherAdapter(deps) {
  var d = deps || {};
  this._fetchImpl = (d.fetchImpl != null) ? d.fetchImpl : null;
  this._timeoutMs = (d.timeoutMs != null) ? d.timeoutMs : constants.EXTERNAL_CALL_TIMEOUT_MS;
}

/**
 * Fetch a 14-day hourly Fahrenheit forecast for the grid cell of `point`.
 * @param {GeoPoint} point
 * @returns {Promise<WeatherConstraint>}
 */
OpenMeteoWeatherAdapter.prototype.fetchForecast = async function fetchForecast(point) {
  var p = GeoPoint.from(point);
  var url = buildForecastUrl(p.latGrid(), p.lonGrid());

  // B6: AbortController-wrapped fetch. fetchImpl defaults to the global fetch
  // (resolved inside fetchWithTimeout when not injected).
  var resp = await fetchWithTimeout(url, undefined, {
    timeoutMs: this._timeoutMs,
    fetchImpl: this._fetchImpl != null ? this._fetchImpl : undefined
  });

  // Verbatim legacy non-OK check.
  if (!resp.ok) throw new Error('Open-Meteo returned ' + resp.status);

  var data = await resp.json();
  // Carry the raw { hourly, hourly_units } payload into the domain entity. The
  // payload shape is preserved verbatim — see WeatherConstraint.fromForecastJson.
  return WeatherConstraint.fromForecastJson(data);
};

// Expose the URL builder for unit-test URL assertions (golden param checks).
OpenMeteoWeatherAdapter.buildForecastUrl = buildForecastUrl;
OpenMeteoWeatherAdapter.WEATHER_PROVIDER_PORT_METHODS = WEATHER_PROVIDER_PORT_METHODS;

module.exports = OpenMeteoWeatherAdapter;
