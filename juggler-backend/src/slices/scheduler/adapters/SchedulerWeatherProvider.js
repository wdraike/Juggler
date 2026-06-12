/**
 * SchedulerWeatherProvider — concrete WeatherProviderPort. Phase H6 / W2.
 *
 * Reproduces `runSchedule.js`'s `loadWeatherForHorizon` (~256-294) VERBATIM:
 * reads the `weather_cache` row for the user's location grid and builds
 * `weatherByDateHour`. FAILS OPEN at every level (no coords / no row / unparseable
 * JSON / no hourly → `{}`), preserving the C-WX golden-master fail-open contract.
 *
 * `roundCoord` is sourced from the canonical `slices/weather/facade` (which
 * re-exports `GeoPoint.gridValue` — bit-identical to the controller's re-export).
 * Connection via
 * the injected `db` (a trx handle in the orchestrated path) — ADR-0002.
 *
 * NO new `||`/`??` fallback — the `|| 0` / `: null` defaults are verbatim from the
 * legacy hourly-field mapping.
 */

'use strict';

var WEATHER_PROVIDER_PORT_METHODS =
  require('../domain/ports/WeatherProviderPort').WEATHER_PROVIDER_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Function} [deps.roundCoord] coord-grid rounder (default: the real
 *   weather controller's roundCoord). Injectable for unit tests.
 * @param {Function} [deps.db] default knex when a per-call db is not passed.
 */
function SchedulerWeatherProvider(deps) {
  var d = deps || {};
  this.roundCoord = d.roundCoord || require('../../weather/facade').roundCoord;
  this._db = d.db || null;
}

SchedulerWeatherProvider.prototype.loadWeatherForHorizon = async function loadWeatherForHorizon(locations, db) {
  var conn = db || this._db || require('../../../lib/db').getDefaultDb();
  var roundCoord = this.roundCoord;

  var weatherByDateHour = {};
  var locWithCoords = (locations || []).find(function (l) {
    return typeof l.lat === 'number' && typeof l.lon === 'number';
  });
  if (!locWithCoords) return weatherByDateHour;

  var latGrid = roundCoord(locWithCoords.lat);
  var lonGrid = roundCoord(locWithCoords.lon);

  var row = await conn('weather_cache')
    .where('lat_grid', latGrid)
    .where('lon_grid', lonGrid)
    .orderBy('fetched_at', 'desc')
    .first();

  if (!row) return weatherByDateHour; // fail-open: no data ever fetched

  var forecast;
  try { forecast = JSON.parse(row.forecast_json); } catch (e) { return weatherByDateHour; }

  var hourly = forecast.hourly;
  if (!hourly || !hourly.time) return weatherByDateHour;

  for (var i = 0; i < hourly.time.length; i++) {
    var dt = hourly.time[i]; // "2026-05-05T14:00"
    var dateKey = dt.slice(0, 10);
    var hour = parseInt(dt.slice(11, 13), 10);
    if (!weatherByDateHour[dateKey]) weatherByDateHour[dateKey] = {};
    weatherByDateHour[dateKey][hour] = {
      temp:       hourly.temperature_2m              ? hourly.temperature_2m[i]              : null,
      precipProb: hourly.precipitation_probability   ? hourly.precipitation_probability[i]   : 0,
      cloudcover: hourly.cloudcover                  ? hourly.cloudcover[i]                  : 0,
      humidity:   hourly.relativehumidity_2m         ? hourly.relativehumidity_2m[i]         : null,
    };
  }

  return weatherByDateHour;
};

module.exports = SchedulerWeatherProvider;
module.exports.SchedulerWeatherProvider = SchedulerWeatherProvider;
module.exports.WEATHER_PROVIDER_PORT_METHODS = WEATHER_PROVIDER_PORT_METHODS;
