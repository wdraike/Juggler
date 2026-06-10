/**
 * NominatimGeocodeAdapter — concrete GeocodePort implementation
 * (GEOCODE_PORT_METHODS): forward geocode via the Open-Meteo geocoding API and
 * reverse geocode via Nominatim.
 *
 * Hexagonal slice (Wave 2 / W2): logic is lifted VERBATIM out of
 * `src/controllers/weather.controller.js`:
 *   - forward:  `exports.geocode` — Open-Meteo `/v1/search?name=...&count=1&
 *     language=en&format=json`, 404 on empty results, displayName assembled as
 *     `[name, admin1, country].filter(Boolean).join(', ')`, returns
 *     `{ lat, lon, displayName }`.
 *   - reverse:  the UPSTREAM portion of `reverseGeocodeDisplayName` — the
 *     Nominatim `/reverse?lat=..&lon=..&format=json&zoom=10` call with the
 *     required User-Agent header, assembling
 *     `[city, state].filter(Boolean).join(', ') || data.display_name || ''`.
 *     NOTE: caching (Redis / in-memory) is NOT this adapter's concern — per the
 *     GeocodePort contract it belongs to WeatherCacheRepositoryPort. This adapter
 *     models only the upstream lookups.
 *
 * B6 (NEW BEHAVIOR): both outbound fetches are wrapped in fetchWithTimeout — an
 * AbortController that rejects if the upstream hangs past EXTERNAL_CALL_TIMEOUT_MS.
 * Happy-path output is byte-identical to the legacy controller.
 *
 * The controller is NOT yet repointed (W3); this module only ADDS the adapter.
 *
 * `fetchImpl` / `timeoutMs` are injectable for unit tests (default: global fetch
 * + the named slice constant).
 *
 * NOTE on the legacy `|| data.display_name || ''` chain: this is a PRE-EXISTING
 * value-selection in the controller (pick city+state, else the full display_name,
 * else empty), lifted verbatim to preserve behavior. It is not a newly introduced
 * fallback — it is part of the characterized B2/B3 golden output.
 */

'use strict';

var GeoPoint = require('../domain/value-objects/GeoPoint');
var fetchWithTimeout = require('./fetchWithTimeout');
var constants = require('./constants');

var GEOCODE_PORT_METHODS = require('../domain/ports/GeocodePort').GEOCODE_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Function} [deps.fetchImpl] fetch impl (default: global fetch).
 * @param {number} [deps.timeoutMs] B6 abort budget (default: EXTERNAL_CALL_TIMEOUT_MS).
 */
function NominatimGeocodeAdapter(deps) {
  var d = deps || {};
  this._fetchImpl = (d.fetchImpl != null) ? d.fetchImpl : null;
  this._timeoutMs = (d.timeoutMs != null) ? d.timeoutMs : constants.EXTERNAL_CALL_TIMEOUT_MS;
}

NominatimGeocodeAdapter.prototype._fetch = function _fetch(url, options) {
  return fetchWithTimeout(url, options, {
    timeoutMs: this._timeoutMs,
    fetchImpl: this._fetchImpl != null ? this._fetchImpl : undefined
  });
};

/**
 * Forward geocode a free-text place name. Verbatim port of `exports.geocode`.
 * @param {string} query
 * @returns {Promise<{lat: number, lon: number, displayName: string}>}
 */
NominatimGeocodeAdapter.prototype.forwardGeocode = async function forwardGeocode(query) {
  var url = constants.OPEN_METEO_GEOCODE_URL +
    '?name=' + encodeURIComponent(query) + '&count=1&language=en&format=json';

  var resp = await this._fetch(url);
  if (!resp.ok) throw new Error('Geocoding API returned ' + resp.status);
  var data = await resp.json();

  var results = data.results;
  if (!results || results.length === 0) {
    var err = new Error('Location not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  var r = results[0];
  var displayName = [r.name, r.admin1, r.country].filter(Boolean).join(', ');

  return { lat: r.latitude, lon: r.longitude, displayName: displayName };
};

/**
 * Reverse geocode a coordinate to a city/state display name. Verbatim port of
 * the UPSTREAM portion of `reverseGeocodeDisplayName` (no cache).
 * @param {GeoPoint} point
 * @returns {Promise<string>}
 */
NominatimGeocodeAdapter.prototype.reverseGeocode = async function reverseGeocode(point) {
  var p = GeoPoint.from(point);
  // The legacy upstream call uses the RAW lat/lon (not grid-rounded) in the URL;
  // only the cache KEY uses the grid. Preserve that: pass the raw coordinates.
  var url = constants.NOMINATIM_REVERSE_URL +
    '?lat=' + p.lat + '&lon=' + p.lon + '&format=json&zoom=10';

  var resp = await this._fetch(url, {
    headers: { 'User-Agent': constants.NOMINATIM_USER_AGENT }
  });
  if (!resp.ok) throw new Error('Nominatim returned ' + resp.status);
  var data = await resp.json();

  var addr = data.address || {};
  var city = addr.city || addr.town || addr.village || addr.county || '';
  var state = addr.state || addr.region || '';
  // Verbatim legacy value-selection chain (characterized B3 golden).
  var displayName = [city, state].filter(Boolean).join(', ') || data.display_name || '';

  return displayName;
};

NominatimGeocodeAdapter.GEOCODE_PORT_METHODS = GEOCODE_PORT_METHODS;

module.exports = NominatimGeocodeAdapter;
