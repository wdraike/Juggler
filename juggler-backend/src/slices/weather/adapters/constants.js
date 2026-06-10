/**
 * Weather-slice adapter constants.
 *
 * Centralizes the magic numbers + upstream URLs lifted out of
 * `src/controllers/weather.controller.js` (W2) so the adapters reference a
 * single named source instead of inlining literals. Values are byte-identical
 * to the legacy controller; the ONE new value is EXTERNAL_CALL_TIMEOUT_MS (B6),
 * the AbortController budget for the outbound provider/geocode fetches — a
 * NEW-behavior carve-out approved for this leg (REFACTOR mode, B6).
 */

'use strict';

// Upstream endpoints — verbatim from weather.controller.js.
var OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
var OPEN_METEO_GEOCODE_URL  = 'https://geocoding-api.open-meteo.com/v1/search';
var NOMINATIM_REVERSE_URL   = 'https://nominatim.openstreetmap.org/reverse';

// Forecast cache TTL — 1 hour (legacy `CACHE_TTL_MS = 60 * 60 * 1000`).
var CACHE_TTL_MS = 60 * 60 * 1000;

// Reverse-geocode cache TTL — 24 hours, in seconds for the Redis SET EX
// (legacy `REVERSE_GEOCODE_TTL_S = 24 * 60 * 60`).
var REVERSE_GEOCODE_TTL_S = 24 * 60 * 60;

// Nominatim usage-policy User-Agent — verbatim from the legacy reverse-geocode
// fetch header.
var NOMINATIM_USER_AGENT = 'Juggler/1.0 (task-scheduling-app)';

// B6 (NEW BEHAVIOR): AbortController budget for outbound forecast/geocode HTTP
// calls. The legacy controller issued a bare `fetch()` with no timeout, so a
// hung upstream could stall the request indefinitely. The adapters wrap the
// fetch in an AbortController that aborts after this many milliseconds and the
// adapter rejects. Named here (no magic number, no `||` fallback) so the budget
// is a single tunable source. 8s comfortably exceeds Open-Meteo's typical
// sub-second response while bounding worst-case hang time.
var EXTERNAL_CALL_TIMEOUT_MS = 8000;

module.exports = {
  OPEN_METEO_FORECAST_URL: OPEN_METEO_FORECAST_URL,
  OPEN_METEO_GEOCODE_URL: OPEN_METEO_GEOCODE_URL,
  NOMINATIM_REVERSE_URL: NOMINATIM_REVERSE_URL,
  CACHE_TTL_MS: CACHE_TTL_MS,
  REVERSE_GEOCODE_TTL_S: REVERSE_GEOCODE_TTL_S,
  NOMINATIM_USER_AGENT: NOMINATIM_USER_AGENT,
  EXTERNAL_CALL_TIMEOUT_MS: EXTERNAL_CALL_TIMEOUT_MS
};
