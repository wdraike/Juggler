/**
 * GeocodePort — the driven-port contract for forward + reverse geocoding.
 * Authoritative interface for the weather slice's place-name resolution.
 *
 * Derived from the legacy controller:
 *   - forward: `exports.geocode` proxies the Open-Meteo geocoding API for a
 *     name query and returns `{ lat, lon, displayName }`, where displayName is
 *     `[name, admin1, country].filter(Boolean).join(', ')`. Returns "not found"
 *     when the upstream yields zero results.
 *   - reverse: `reverseGeocodeDisplayName(lat, lon)` proxies Nominatim and
 *     returns a `displayName` string assembled as
 *     `[city, state].filter(Boolean).join(', ') || data.display_name || ''`.
 *
 * Contract only (W1) — JSDoc `@typedef` plus a throw-not-implemented base,
 * mirroring CalendarPort. The reverse-geocode CACHING concern (Redis / in-memory,
 * 24h TTL, `rgeo:<latGrid>:<lonGrid>` key) is NOT part of this port — it belongs
 * to WeatherCacheRepositoryPort. This port models only the upstream lookups.
 *
 * BEHAVIOR-PRESERVING (W1): an adapter MUST preserve the legacy displayName
 * assembly (filter(Boolean) + comma-join) and the reverse-geocode fallback chain
 * to `data.display_name` then `''`, and MUST send the Nominatim `User-Agent`
 * header the usage policy requires.
 *
 * @typedef {Object} GeocodePort
 *
 * @property {(query: string) => Promise<{lat: number, lon: number, displayName: string}>} forwardGeocode
 *   Resolve a free-text place name to coordinates + a display name. The query is
 *   trimmed; an empty query is rejected by the caller (HTTP 400 in the legacy
 *   controller). Rejects with a not-found condition when the upstream returns no
 *   results (legacy: HTTP 404). displayName = `[name, admin1, country]
 *   .filter(Boolean).join(', ')`.
 *
 * @property {(point: GeoPoint) => Promise<string>} reverseGeocode
 *   Resolve a coordinate to a human display name (city, state). Implementations
 *   send the legacy Nominatim request (with the required User-Agent) and assemble
 *   `[city, state].filter(Boolean).join(', ') || data.display_name || ''`.
 *   NOTE: this is the un-cached upstream lookup. Cache read/write is the caller's
 *   responsibility via WeatherCacheRepositoryPort.
 */

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function GeocodePort() {}

/**
 * @param {string} query
 * @returns {Promise<{lat: number, lon: number, displayName: string}>}
 */
GeocodePort.prototype.forwardGeocode = function forwardGeocode(_query) {
  throw new Error('GeocodePort.forwardGeocode not implemented');
};

/**
 * @param {GeoPoint} point
 * @returns {Promise<string>}
 */
GeocodePort.prototype.reverseGeocode = function reverseGeocode(_point) {
  throw new Error('GeocodePort.reverseGeocode not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy GeocodePort.
 * @type {ReadonlyArray<string>}
 */
var GEOCODE_PORT_METHODS = Object.freeze([
  'forwardGeocode',
  'reverseGeocode'
]);

module.exports = GeocodePort;
module.exports.GeocodePort = GeocodePort;
module.exports.GEOCODE_PORT_METHODS = GEOCODE_PORT_METHODS;
