/**
 * Weather slice facade — Wave 3 / W3.
 *
 * The single public API the weather controller imports. It WIRES the W2 adapters
 * (OpenMeteoWeatherAdapter provider, NominatimGeocodeAdapter geocode,
 * KnexWeatherCacheRepository cache) and exposes the operations the legacy
 * `weather.controller.js` performed — getForecast, ingest, geocode,
 * reverseGeocode, reverseGeocodeDisplayName — plus the grid helper
 * (GeoPoint.gridValue, re-exported as `roundCoord`).
 *
 * REFACTOR mode — NO BEHAVIOR CHANGE. The orchestration here is the SAME
 * step-sequence the legacy controller ran, moved out of the HTTP handler so the
 * controller can become thin:
 *
 *   getForecast(lat, lon, { cacheOnly }) — fresh cache lookup (expires_at > now),
 *     on miss fetch from Open-Meteo, insert the fresh row, fire-and-forget the
 *     stale-row cleanup (DELETE expires_at <= the ORIGINAL `now` — same stale
 *     timestamp the legacy code reused), and return the response payload shape.
 *   ingest(body) — validate (caller passes pre-validated body fields), insert the
 *     ingested forecast, fire-and-forget stale cleanup (DELETE expires_at <=
 *     fetchedAt — matching the legacy ingest cleanup bound).
 *   geocode(query) — forward geocode (Open-Meteo), { lat, lon, displayName }.
 *   reverseGeocode(lat, lon) / reverseGeocodeDisplayName(lat, lon) — Redis/mem
 *     cached reverse geocode (Nominatim upstream).
 *
 * Aggregation/wiring only — the per-step logic lives in the W2 adapters. The two
 * cache-cleanup `.catch()` fire-and-forget wrappers are the SAME wrappers the
 * legacy controller had at its call sites (see KnexWeatherCacheRepository's
 * deleteStaleForecasts doc: "the W3 facade wires the fire-and-forget .catch").
 *
 * Behavioral invariants preserved verbatim:
 *   - W-1: fetchedAt/expiresAt are JS `new Date()` values, never db.fn.now().
 *   - getForecast stale-cleanup uses the ORIGINAL `now` (captured before the
 *     fetch), exactly as the legacy controller did.
 *   - reverse-geocode upstream uses RAW lat/lon in the URL; only the cache KEY
 *     uses the 0.1° grid.
 *   - reverse-geocode TTL = REVERSE_GEOCODE_TTL_S; forecast TTL = CACHE_TTL_MS.
 */

'use strict';

var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('weather.facade');

var constants = require('./adapters/constants');

var GeoPoint = require('./domain/value-objects/GeoPoint');
var WeatherConstraint = require('./domain/entities/WeatherConstraint');
var WeatherProviderPort = require('./domain/ports/WeatherProviderPort');
var GeocodePort = require('./domain/ports/GeocodePort');
var WeatherCacheRepositoryPort = require('./domain/ports/WeatherCacheRepositoryPort');

var OpenMeteoWeatherAdapter = require('./adapters/OpenMeteoWeatherAdapter');
var NominatimGeocodeAdapter = require('./adapters/NominatimGeocodeAdapter');
var MockWeatherProvider = require('./adapters/MockWeatherProvider');
var KnexWeatherCacheRepository = require('./adapters/KnexWeatherCacheRepository');

// ── default wiring (production adapters) ─────────────────────────────
// The cache repository owns the in-memory reverse-geocode fallback store, so the
// facade holds a single repository instance (one shared mem-cache) — matching the
// legacy controller's single module-level `_reverseGeocodeMemCache`.
var _provider = new OpenMeteoWeatherAdapter();
var _geocoder = new NominatimGeocodeAdapter();
var _cacheRepo = new KnexWeatherCacheRepository();

/**
 * Grid helper — bit-identical re-export of GeoPoint.gridValue (== legacy
 * roundCoord). Drives the forecast cache key, the reverse-geocode cache key, AND
 * the scheduler weather-match (runSchedule.js:263-264). MUST stay bit-identical.
 * @type {(v: (number|string)) => number}
 */
var roundCoord = GeoPoint.gridValue;

/**
 * API forecast read+refresh path — verbatim orchestration of the legacy
 * `exports.getForecast` body (sans HTTP req/res concerns).
 *
 * @param {(number|string)} lat raw latitude
 * @param {(number|string)} lon raw longitude
 * @param {{cacheOnly?: boolean}} [opts]
 * @returns {Promise<Object>} the response payload:
 *   - cache HIT  → { hourly, hourly_units, cachedAt, expiresAt }
 *   - cacheOnly miss → { miss: true }
 *   - cache MISS → { hourly, hourly_units, cachedAt, expiresAt, refreshed: true }
 */
async function getForecast(lat, lon, opts) {
  var cacheOnly = !!(opts && opts.cacheOnly);
  var point = new GeoPoint(lat, lon);
  // Legacy captured `now` ONCE up front and reused it for both the freshness
  // lookup and the stale-cleanup bound. Preserve that single timestamp.
  var now = new Date();

  // Cache lookup — fresh only (expires_at > now).
  var cached = await _cacheRepo.getFreshForecast(point, now);
  if (cached) {
    return {
      hourly: cached.hourly,
      hourly_units: cached.hourlyUnits,
      cachedAt: cached.fetchedAt,
      expiresAt: cached.expiresAt
    };
  }

  if (cacheOnly) {
    return { miss: true };
  }

  // Cache miss — fetch from Open-Meteo (always Fahrenheit).
  var forecast = await _provider.fetchForecast(point);
  var fetchedAt = new Date();
  var expiresAt = new Date(fetchedAt.getTime() + constants.CACHE_TTL_MS);

  await _cacheRepo.putForecast(point, forecast, fetchedAt, expiresAt);

  // Delete stale rows for this grid cell — fire-and-forget so the response is
  // not held while the cleanup DELETE runs. Uses the ORIGINAL `now` bound,
  // matching the legacy controller.
  _cacheRepo.deleteStaleForecasts(point, now)
    .catch(function (e) { logger.warn('[weather] stale cache cleanup failed:', e.message); });

  return {
    hourly: forecast.hourly,
    hourly_units: forecast.hourlyUnits,
    cachedAt: fetchedAt,
    expiresAt: expiresAt,
    refreshed: true
  };
}

/**
 * Ingest a client-supplied forecast — verbatim orchestration of the legacy
 * `exports.ingest` body (validation stays in the controller; the caller passes
 * the already-validated `lat`, `lon`, `hourly`, `hourly_units`).
 *
 * @param {{lat:(number|string), lon:(number|string), hourly:Object, hourly_units?:Object}} body
 * @returns {Promise<{cachedAt: Date, expiresAt: Date}>}
 */
async function ingest(body) {
  var point = new GeoPoint(body.lat, body.lon);
  var fetchedAt = new Date();
  var expiresAt = new Date(fetchedAt.getTime() + constants.CACHE_TTL_MS);
  // Legacy: `{ hourly: req.body.hourly, hourly_units: req.body.hourly_units || {} }`
  // — WeatherConstraint.fromForecastJson reproduces the `|| {}` default for
  // hourly_units (characterized, not a new fallback).
  var forecast = WeatherConstraint.fromForecastJson({
    hourly: body.hourly,
    hourly_units: body.hourly_units
  });

  await _cacheRepo.putForecast(point, forecast, fetchedAt, expiresAt);

  // Delete stale rows — fire-and-forget. Legacy ingest cleanup bound is
  // `expires_at <= fetchedAt` (NOT a separately-captured `now`).
  _cacheRepo.deleteStaleForecasts(point, fetchedAt)
    .catch(function (e) { logger.warn('[weather] stale cache cleanup failed:', e.message); });

  return { cachedAt: fetchedAt, expiresAt: expiresAt };
}

/**
 * Forward geocode a free-text place name — delegates to the geocode adapter.
 * The adapter throws an Error with `.code === 'NOT_FOUND'` on empty results
 * (the controller maps that to a 404). { lat, lon, displayName } on success.
 *
 * @param {string} query
 * @returns {Promise<{lat:number, lon:number, displayName:string}>}
 */
function geocode(query) {
  return _geocoder.forwardGeocode(query);
}

/**
 * Reverse geocode a coordinate to a city/state display name, with the Redis +
 * in-memory cache layered in front of the Nominatim upstream — verbatim
 * orchestration of the legacy `reverseGeocodeDisplayName`.
 *
 * The cache READS/WRITES live in KnexWeatherCacheRepository; the upstream lookup
 * lives in NominatimGeocodeAdapter. This wires them in the legacy order:
 *   cache get → (hit) return; (miss) upstream → cache put → return.
 *
 * @param {(number|string)} lat raw latitude (RAW used upstream; grid used as key)
 * @param {(number|string)} lon raw longitude
 * @returns {Promise<string>}
 */
async function reverseGeocodeDisplayName(lat, lon) {
  var point = new GeoPoint(lat, lon);

  var cached = await _cacheRepo.getReverseGeocode(point);
  if (cached != null) return cached;

  var displayName = await _geocoder.reverseGeocode(point);

  await _cacheRepo.putReverseGeocode(point, displayName, constants.REVERSE_GEOCODE_TTL_S);

  return displayName;
}

/**
 * Reverse geocode wrapper returning the response payload shape ({ displayName }).
 * @param {(number|string)} lat
 * @param {(number|string)} lon
 * @returns {Promise<{displayName: string}>}
 */
async function reverseGeocode(lat, lon) {
  var displayName = await reverseGeocodeDisplayName(lat, lon);
  return { displayName: displayName };
}

module.exports = {
  // operations the controller delegates to
  getForecast: getForecast,
  ingest: ingest,
  geocode: geocode,
  reverseGeocode: reverseGeocode,
  reverseGeocodeDisplayName: reverseGeocodeDisplayName,

  // grid helper external consumers need (== legacy roundCoord, bit-identical)
  roundCoord: roundCoord,
  gridValue: GeoPoint.gridValue,

  // domain value objects / entity / ports
  GeoPoint: GeoPoint,
  WeatherConstraint: WeatherConstraint,
  WeatherProviderPort: WeatherProviderPort,
  GeocodePort: GeocodePort,
  WeatherCacheRepositoryPort: WeatherCacheRepositoryPort,

  // adapter implementations (named exports; mirror calendar facade)
  OpenMeteoWeatherAdapter: OpenMeteoWeatherAdapter,
  NominatimGeocodeAdapter: NominatimGeocodeAdapter,
  MockWeatherProvider: MockWeatherProvider,
  KnexWeatherCacheRepository: KnexWeatherCacheRepository,
};
