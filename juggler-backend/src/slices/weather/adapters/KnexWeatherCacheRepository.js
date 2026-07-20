/**
 * KnexWeatherCacheRepository — concrete WeatherCacheRepositoryPort implementation
 * (WEATHER_CACHE_REPOSITORY_PORT_METHODS). Backs two caches lifted out of
 * `src/controllers/weather.controller.js` + `src/scheduler/runSchedule.js`:
 *
 *   1. FORECAST cache — the `weather_cache` table (lat_grid, lon_grid,
 *      fetched_at, expires_at, forecast_json).
 *   2. REVERSE-GEOCODE cache — Redis (24h TTL) with an in-memory fallback,
 *      keyed `rgeo:<latGrid>:<lonGrid>` (GeoPoint.reverseGeocodeCacheKey()).
 *
 * Hexagonal slice (Wave 2 / W2): read/write logic is lifted verbatim. The
 * controller is NOT yet repointed (W3); this module only ADDS the adapter.
 *
 * ── BINDING INVARIANTS (WeatherCacheRepositoryPort) ─────────────────────────
 *
 * W-1 (timestamps via `new Date()`, NEVER `db.fn.now()`): every timestamp
 *   written to weather_cache (fetched_at, expires_at) is a JS Date. A
 *   `db.fn.now()` raw embedded in the insert object is a Knex builder that fails
 *   circular-JSON serialization when the row's forecast_json round-trips
 *   (hard cache-write failure, 2026-05-12). The legacy controller already does
 *   this correctly (`var fetchedAt = new Date()`); preserved here. There is
 *   intentionally ZERO `db.fn.now()` reference in this file.
 *
 * W-2 (NO expires_at fail-open filter on the scheduler load path):
 *   `getForecastForScheduler` returns the latest row for the grid cell REGARDLESS
 *   of expiry — stale rows ARE returned (staleness fix 8a130b4). Mirrors
 *   loadWeatherForHorizon in runSchedule.js, which queries weather_cache with
 *   only `.orderBy('fetched_at','desc')` and no expires_at filter. The API read
 *   path (`getFreshForecast`) is the OPPOSITE — it MUST filter `expires_at > now`.
 *   Do not "fix" this asymmetry.
 *
 * Dependencies (db / redis / clock / mem-cache) are injectable so the unit test
 * runs with a stub builder + stub redis and no live DB/Redis.
 */

'use strict';

var GeoPoint = require('../domain/value-objects/GeoPoint');
var WeatherConstraint = require('../domain/entities/WeatherConstraint');
var stampInsert = require('../../../lib/audit-context').stampInsert; // 999.1576 inc.4

var WEATHER_CACHE_REPOSITORY_PORT_METHODS =
  require('../domain/ports/WeatherCacheRepositoryPort').WEATHER_CACHE_REPOSITORY_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Function} [deps.db] Knex instance (default: lib/db's shared
 *   singleton via getDefaultDb() — the single pool src/db.js also re-exports).
 * @param {Object} [deps.redis] redis lib (default: src/lib/redis).
 * @param {Object} [deps.memCache] in-memory fallback store (default: a fresh {}).
 */
function KnexWeatherCacheRepository(deps) {
  var d = deps || {};
  this.db = d.db || require('../../../lib/db').getDefaultDb();
  this.redis = d.redis || require('../../../lib/redis');
  // In-memory fallback for reverse-geocode when Redis is unavailable. Matches
  // the legacy controller's `_reverseGeocodeMemCache` object.
  this._memCache = d.memCache || {};
}

// ── FORECAST cache ──────────────────────────────────────────────────────────

/**
 * API read path. Latest cached forecast for the grid cell ONLY IF still fresh
 * (`expires_at > now`); null on miss/stale. Mirrors the legacy getForecast
 * lookup (with `.orderBy('fetched_at','desc')`).
 *
 * @param {GeoPoint} point
 * @param {Date} now
 * @returns {Promise<?WeatherConstraint>}
 */
KnexWeatherCacheRepository.prototype.getFreshForecast = function getFreshForecast(point, now) {
  var p = GeoPoint.from(point);
  return this.db('weather_cache')
    .where('lat_grid', p.latGrid())
    .where('lon_grid', p.lonGrid())
    .where('expires_at', '>', now)
    .orderBy('fetched_at', 'desc')
    .first()
    .then(function (row) {
      if (!row) return null;
      var data = JSON.parse(row.forecast_json);
      return WeatherConstraint.fromForecastJson(data, {
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at
      });
    });
};

/**
 * SCHEDULER read path. Latest cached forecast for the grid cell REGARDLESS of
 * expiry — INVARIANT W-2: stale rows ARE returned. Null only when no row exists.
 * Mirrors loadWeatherForHorizon (no expires_at filter).
 *
 * @param {GeoPoint} point
 * @returns {Promise<?WeatherConstraint>}
 */
KnexWeatherCacheRepository.prototype.getForecastForScheduler = function getForecastForScheduler(point) {
  var p = GeoPoint.from(point);
  // INVARIANT W-2: deliberately NO .where('expires_at', ...) here.
  return this.db('weather_cache')
    .where('lat_grid', p.latGrid())
    .where('lon_grid', p.lonGrid())
    .orderBy('fetched_at', 'desc')
    .first()
    .then(function (row) {
      if (!row) return null;
      var data = JSON.parse(row.forecast_json);
      return WeatherConstraint.fromForecastJson(data, {
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at
      });
    });
};

/**
 * Insert a forecast row for the grid cell. INVARIANT W-1: `fetchedAt`/`expiresAt`
 * MUST be JS Dates (the caller passes them; we assert + never substitute a raw
 * NOW()). Stores `forecast_json` = forecast.toForecastJson().
 *
 * @param {GeoPoint} point
 * @param {WeatherConstraint} forecast
 * @param {Date} fetchedAt MUST be a JS Date (W-1).
 * @param {Date} expiresAt MUST be a JS Date (W-1).
 * @returns {Promise<void>}
 */
KnexWeatherCacheRepository.prototype.putForecast = function putForecast(point, forecast, fetchedAt, expiresAt) {
  var p = GeoPoint.from(point);
  var fc = WeatherConstraint.from(forecast);
  // W-1: write JS Dates, never db.fn.now(). The port contract requires the
  // caller to supply Dates; guard so a stray string/raw is caught loudly here
  // rather than corrupting the cache.
  if (!(fetchedAt instanceof Date) || !(expiresAt instanceof Date)) {
    throw new TypeError('KnexWeatherCacheRepository.putForecast: fetchedAt/expiresAt must be JS Date (INVARIANT W-1)');
  }
  return this.db('weather_cache')
    .insert(stampInsert({
      lat_grid: p.latGrid(),
      lon_grid: p.lonGrid(),
      fetched_at: fetchedAt,
      expires_at: expiresAt,
      forecast_json: JSON.stringify(fc.toForecastJson())
    }))
    .then(function () {});
};

/**
 * Delete rows for the grid cell whose `expires_at <= olderThan`. Legacy uses
 * this fire-and-forget after a fresh insert. Best-effort: implementations should
 * not let its failure surface to the caller (legacy logs + swallows). We resolve
 * void on success; a rejecting DB is the caller's to swallow (matching the
 * legacy `.catch()` at the call site), so we do NOT swallow here to keep the
 * adapter honest — the W3 facade wires the fire-and-forget `.catch`.
 *
 * @param {GeoPoint} point
 * @param {Date} olderThan
 * @returns {Promise<void>}
 */
KnexWeatherCacheRepository.prototype.deleteStaleForecasts = function deleteStaleForecasts(point, olderThan) {
  var p = GeoPoint.from(point);
  return this.db('weather_cache')
    .where('lat_grid', p.latGrid())
    .where('lon_grid', p.lonGrid())
    .where('expires_at', '<=', olderThan)
    .delete()
    .then(function () {});
};

// ── REVERSE-GEOCODE cache ───────────────────────────────────────────────────

/**
 * Read the cached reverse-geocode display name for the grid cell. Checks Redis
 * first, then the in-memory fallback (matching the legacy order). Null on miss.
 *
 * @param {GeoPoint} point
 * @returns {Promise<?string>}
 */
KnexWeatherCacheRepository.prototype.getReverseGeocode = function getReverseGeocode(point) {
  var p = GeoPoint.from(point);
  var cacheKey = p.reverseGeocodeCacheKey();
  var memCache = this._memCache;

  return this.redis.get(cacheKey).then(function (cached) {
    // Legacy guard: `cached.displayName !== undefined` rejects a corrupt/
    // null-valued entry. Preserved verbatim.
    if (cached && cached.displayName !== undefined) return cached.displayName;

    var memEntry = memCache[cacheKey];
    if (memEntry && memEntry.expiresAt > Date.now()) return memEntry.value;
    // WARN-1 fix: evict the expired entry on read so _memCache does not grow
    // unbounded when Redis is down. Restores legacy active-prune parity via
    // delete-on-expired-miss (simpler than re-introducing a setInterval sweep;
    // each expired key is removed the first time it is looked up after TTL).
    if (memEntry) delete memCache[cacheKey];

    return null;
  });
};

/**
 * Cache a reverse-geocode display name for the grid cell with the given TTL.
 * Writes Redis; on a falsy Redis result, falls back to the in-memory cache
 * (matching legacy behavior). MUST NOT throw on Redis failure.
 *
 * @param {GeoPoint} point
 * @param {string} displayName
 * @param {number} ttlSeconds
 * @returns {Promise<void>}
 */
KnexWeatherCacheRepository.prototype.putReverseGeocode = function putReverseGeocode(point, displayName, ttlSeconds) {
  var p = GeoPoint.from(point);
  var cacheKey = p.reverseGeocodeCacheKey();
  var memCache = this._memCache;

  return this.redis.set(cacheKey, { displayName: displayName }, ttlSeconds)
    .catch(function () { return null; })
    .then(function (stored) {
      if (!stored) {
        // W-1-adjacent: in-memory expiry is a JS millisecond clock value, not a
        // DB timestamp — matches the legacy `Date.now() + ttl * 1000`.
        memCache[cacheKey] = {
          value: displayName,
          expiresAt: Date.now() + ttlSeconds * 1000
        };
      }
    });
};

KnexWeatherCacheRepository.WEATHER_CACHE_REPOSITORY_PORT_METHODS =
  WEATHER_CACHE_REPOSITORY_PORT_METHODS;

module.exports = KnexWeatherCacheRepository;
