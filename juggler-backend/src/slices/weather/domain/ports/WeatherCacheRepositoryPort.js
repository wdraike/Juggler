/**
 * WeatherCacheRepositoryPort — driven-port contract for persisting cached
 * forecasts and cached reverse-geocode display names. Authoritative interface
 * for the weather slice's caching layer.
 *
 * Two caches, both keyed by the 0.1°-rounded GeoPoint grid (see GeoPoint):
 *
 *   1. FORECAST cache — backed by the `weather_cache` table. Rows hold
 *      `lat_grid`, `lon_grid`, `fetched_at`, `expires_at`, `forecast_json`.
 *      Two distinct READ paths exist and they behave DIFFERENTLY (pinned by the
 *      H1 characterization suite, B5):
 *        - API read (getForecast): returns ONLY fresh rows (`expires_at > now`).
 *        - SCHEDULER read (loadWeatherForHorizon): returns the latest row for the
 *          grid cell REGARDLESS of expiry — stale rows ARE returned.
 *
 *   2. REVERSE-GEOCODE cache — Redis (24h TTL) with an in-memory fallback when
 *      Redis is unavailable, keyed `rgeo:<latGrid>:<lonGrid>`
 *      (GeoPoint.reverseGeocodeCacheKey()).
 *
 * Contract only (W1) — JSDoc `@typedef` plus a throw-not-implemented base,
 * mirroring CalendarPort / SyncStateRepositoryPort.
 *
 * ── BINDING INVARIANTS (implementations MUST honor; not optional) ───────────
 *
 * INVARIANT W-1 (timestamps via new Date(), NEVER db.fn.now()):
 *   All timestamp columns (`fetched_at`, `expires_at`) MUST be written with a JS
 *   `new Date()` value, NEVER an inline Knex `db.fn.now()`. A `db.fn.now()`
 *   reference embedded in an insert/update object is a Knex raw builder that
 *   fails circular-JSON serialization when the row is later JSON-stringified
 *   (forecast_json round-trip), and surfaced as a hard cache-write failure on
 *   2026-05-12. The legacy controller already does this correctly
 *   (`var fetchedAt = new Date()`); the adapter must preserve it.
 *
 * INVARIANT W-2 (NO expires_at fail-open filter on the scheduler load path):
 *   `getForecastForScheduler` MUST NOT apply an `expires_at > now` (or any
 *   expiry) filter. Staleness fix 8a130b4 deliberately returns stale rows here:
 *   if the scheduler filtered on expiry and the cache happened to be stale, the
 *   weather map would come back EMPTY and weather-constrained tasks would
 *   silently fail open to "unscheduled". Returning the latest row even when stale
 *   is the correct, pinned behavior. (The API read path is the opposite — it
 *   MUST filter — see `getFreshForecast`.) Do NOT "fix" this asymmetry.
 *
 * ── end binding invariants ─────────────────────────────────────────────────
 *
 * @typedef {Object} WeatherCacheRepositoryPort
 *
 * @property {(point: GeoPoint, now: Date) => Promise<?WeatherConstraint>} getFreshForecast
 *   API read path. Return the latest cached forecast for the grid cell ONLY IF
 *   it is still fresh (`expires_at > now`); resolve null on miss/stale. Mirrors
 *   the legacy getForecast cache lookup (with `.orderBy('fetched_at','desc')`).
 *
 * @property {(point: GeoPoint) => Promise<?WeatherConstraint>} getForecastForScheduler
 *   SCHEDULER read path. Return the latest cached forecast for the grid cell
 *   REGARDLESS of expiry (stale rows ARE returned — INVARIANT W-2). Resolve null
 *   only when no row exists at all. Mirrors loadWeatherForHorizon.
 *
 * @property {(point: GeoPoint, forecast: WeatherConstraint, fetchedAt: Date, expiresAt: Date) => Promise<void>} putForecast
 *   Insert a forecast row for the grid cell. `fetchedAt`/`expiresAt` MUST be JS
 *   Dates (INVARIANT W-1). Stores `forecast_json` = forecast.toForecastJson().
 *
 * @property {(point: GeoPoint, olderThan: Date) => Promise<void>} deleteStaleForecasts
 *   Delete rows for the grid cell whose `expires_at <= olderThan`. Legacy uses
 *   this fire-and-forget after a fresh insert. Best-effort cleanup; implementations
 *   should not let its failure surface to the caller (legacy logs + swallows).
 *
 * @property {(point: GeoPoint) => Promise<?string>} getReverseGeocode
 *   Read the cached reverse-geocode display name for the grid cell
 *   (`rgeo:<latGrid>:<lonGrid>`). Resolve null on miss. Implementations check
 *   Redis first, then the in-memory fallback (matching the legacy order).
 *
 * @property {(point: GeoPoint, displayName: string, ttlSeconds: number) => Promise<void>} putReverseGeocode
 *   Cache a reverse-geocode display name for the grid cell with the given TTL
 *   (legacy: 24h). Writes Redis; on a falsy Redis result, falls back to the
 *   in-memory cache (matching legacy behavior). MUST NOT throw on Redis failure.
 */

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function WeatherCacheRepositoryPort() {}

/**
 * @param {GeoPoint} point
 * @param {Date} now
 * @returns {Promise<?WeatherConstraint>}
 */
WeatherCacheRepositoryPort.prototype.getFreshForecast = function getFreshForecast(_point, _now) {
  throw new Error('WeatherCacheRepositoryPort.getFreshForecast not implemented');
};

/**
 * @param {GeoPoint} point
 * @returns {Promise<?WeatherConstraint>}
 */
WeatherCacheRepositoryPort.prototype.getForecastForScheduler = function getForecastForScheduler(_point) {
  throw new Error('WeatherCacheRepositoryPort.getForecastForScheduler not implemented');
};

/**
 * @param {GeoPoint} point
 * @param {WeatherConstraint} forecast
 * @param {Date} fetchedAt MUST be a JS Date (INVARIANT W-1).
 * @param {Date} expiresAt MUST be a JS Date (INVARIANT W-1).
 * @returns {Promise<void>}
 */
WeatherCacheRepositoryPort.prototype.putForecast = function putForecast(_point, _forecast, _fetchedAt, _expiresAt) {
  throw new Error('WeatherCacheRepositoryPort.putForecast not implemented');
};

/**
 * @param {GeoPoint} point
 * @param {Date} olderThan
 * @returns {Promise<void>}
 */
WeatherCacheRepositoryPort.prototype.deleteStaleForecasts = function deleteStaleForecasts(_point, _olderThan) {
  throw new Error('WeatherCacheRepositoryPort.deleteStaleForecasts not implemented');
};

/**
 * @param {GeoPoint} point
 * @returns {Promise<?string>}
 */
WeatherCacheRepositoryPort.prototype.getReverseGeocode = function getReverseGeocode(_point) {
  throw new Error('WeatherCacheRepositoryPort.getReverseGeocode not implemented');
};

/**
 * @param {GeoPoint} point
 * @param {string} displayName
 * @param {number} ttlSeconds
 * @returns {Promise<void>}
 */
WeatherCacheRepositoryPort.prototype.putReverseGeocode = function putReverseGeocode(_point, _displayName, _ttlSeconds) {
  throw new Error('WeatherCacheRepositoryPort.putReverseGeocode not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy
 * WeatherCacheRepositoryPort. A contract test asserts adapters conform.
 * @type {ReadonlyArray<string>}
 */
var WEATHER_CACHE_REPOSITORY_PORT_METHODS = Object.freeze([
  'getFreshForecast',
  'getForecastForScheduler',
  'putForecast',
  'deleteStaleForecasts',
  'getReverseGeocode',
  'putReverseGeocode'
]);

module.exports = WeatherCacheRepositoryPort;
module.exports.WeatherCacheRepositoryPort = WeatherCacheRepositoryPort;
module.exports.WEATHER_CACHE_REPOSITORY_PORT_METHODS = WEATHER_CACHE_REPOSITORY_PORT_METHODS;
