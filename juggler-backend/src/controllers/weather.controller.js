/**
 * Weather controller — THIN HTTP layer over the weather slice facade (W3).
 *
 * Endpoints:
 *   GET /api/weather?lat=X&lon=Y[&cacheOnly=1]
 *     Returns 14-day hourly forecast. Checks weather_cache first (1-hour TTL).
 *     On cache miss, fetches from Open-Meteo and stores result.
 *     Responds with { hourly, hourly_units, cachedAt, expiresAt, refreshed? }.
 *
 *   POST /api/weather/ingest
 *     Validates a client-supplied forecast (validateIngest) then stores it.
 *
 *   GET /api/weather/geocode?q=...
 *     Forward geocode (Open-Meteo). Returns { lat, lon, displayName }.
 *
 *   GET /api/weather/reverse-geocode?lat=X&lon=Y
 *     Reverse geocode (Nominatim), Redis/in-memory cached 24h on the 0.1° grid.
 *
 * REFACTOR (W3): all weather domain orchestration + external I/O (DB cache,
 * Open-Meteo, Nominatim) now live in `src/slices/weather/facade.js`. This module
 * holds ONLY the HTTP req->args mapping, request-body validation (validateIngest),
 * and the response/error mapping. There are ZERO DB-access call sites and ZERO
 * outbound-HTTP call sites here — both moved into the slice adapters (pinned by
 * the H1 B7 AFTER assertions: 0 getDb, 0 fetch).
 *
 * `roundCoord` and `reverseGeocodeDisplayName` are RE-EXPORTED from the slice
 * facade (by reference, bit-identical) so cross-module consumers
 * (scheduler/runSchedule.js, routes/health.routes.js, controllers/config.controller.js)
 * keep resolving without change.
 */

const weather = require('../slices/weather/facade');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('weather.controller');

exports.getForecast = async (req, res) => {
  try {
    var lat = parseFloat(req.query.lat);
    var lon = parseFloat(req.query.lon);
    var cacheOnly = req.query.cacheOnly === '1';

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }

    var result = await weather.getForecast(lat, lon, { cacheOnly: cacheOnly });
    res.json(result);
  } catch (err) {
    logger.error('Weather forecast error:', err.message);
    res.status(500).json({ error: 'Weather fetch failed' });
  }
};

var INGEST_REQUIRED_ARRAYS = ['time', 'temperature_2m', 'precipitation_probability', 'cloudcover', 'weathercode'];
var MAX_INGEST_HOURS = 336; // 14 days × 24h
var TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function validateIngest(body) {
  if (typeof body.lat !== 'number' || body.lat < -90 || body.lat > 90) return 'invalid lat';
  if (typeof body.lon !== 'number' || body.lon < -180 || body.lon > 180) return 'invalid lon';
  var h = body.hourly;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return 'missing hourly';

  var len = null;
  for (var key of INGEST_REQUIRED_ARRAYS) {
    if (!Array.isArray(h[key])) return 'missing hourly.' + key;
    if (len === null) len = h[key].length;
    if (h[key].length !== len) return 'hourly arrays length mismatch';
  }
  if (len > MAX_INGEST_HOURS) return 'hourly array too long (max ' + MAX_INGEST_HOURS + ')';

  for (var i = 0; i < len; i++) {
    if (typeof h.time[i] !== 'string' || !TIME_RE.test(h.time[i])) return 'invalid time[' + i + ']';
    if (typeof h.temperature_2m[i] !== 'number' || h.temperature_2m[i] < -200 || h.temperature_2m[i] > 200) return 'temperature_2m[' + i + '] out of range';
    var pp = h.precipitation_probability[i];
    if (pp != null && (typeof pp !== 'number' || pp < 0 || pp > 100)) return 'precipitation_probability[' + i + '] out of range';
    var cc = h.cloudcover[i];
    if (cc != null && (typeof cc !== 'number' || cc < 0 || cc > 100)) return 'cloudcover[' + i + '] out of range';
    var wc = h.weathercode[i];
    if (wc != null && (typeof wc !== 'number' || wc < 0 || wc > 99)) return 'weathercode[' + i + '] out of range';
    if (h.relativehumidity_2m) {
      var rh = h.relativehumidity_2m[i];
      if (rh != null && (typeof rh !== 'number' || rh < 0 || rh > 100)) return 'relativehumidity_2m[' + i + '] out of range';
    }
    if (h.precipitation) {
      var pr = h.precipitation[i];
      if (pr != null && (typeof pr !== 'number' || pr < 0)) return 'precipitation[' + i + '] out of range';
    }
  }
  return null;
}

exports.ingest = async (req, res) => {
  try {
    var err = validateIngest(req.body);
    if (err) return res.status(400).json({ error: err });

    var result = await weather.ingest(req.body);
    res.json(result);
  } catch (err) {
    logger.error('Weather ingest error:', err.message);
    res.status(500).json({ error: 'Ingest failed' });
  }
};

exports.geocode = async (req, res) => {
  try {
    var q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q is required' });

    var result = await weather.geocode(q);
    res.json(result);
  } catch (err) {
    // The facade's geocode adapter throws `.code === 'NOT_FOUND'` on empty
    // results — map that to the legacy 404, everything else to 500.
    if (err && err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Location not found' });
    }
    logger.error('Geocode error:', err.message);
    res.status(500).json({ error: 'Geocode failed' });
  }
};

exports.reverseGeocode = async (req, res) => {
  try {
    var lat = parseFloat(req.query.lat);
    var lon = parseFloat(req.query.lon);
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }
    var result = await weather.reverseGeocode(lat, lon);
    res.json(result);
  } catch (err) {
    logger.error('Reverse geocode error:', err.message);
    res.status(500).json({ error: 'Reverse geocode failed' });
  }
};

// Re-exports (by reference, bit-identical) so cross-module consumers keep
// resolving through the controller path without change:
//   - roundCoord  → GeoPoint.gridValue (scheduler weather-grid key + health check)
//   - reverseGeocodeDisplayName → facade's cached reverse-geocode (config.controller)
exports.reverseGeocodeDisplayName = weather.reverseGeocodeDisplayName;
exports.roundCoord = weather.roundCoord;
