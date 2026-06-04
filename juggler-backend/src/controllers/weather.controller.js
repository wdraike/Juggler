/**
 * Weather controller — proxy for Open-Meteo API with DB-backed cache
 *
 * Endpoints:
 *   GET /api/weather?lat=X&lon=Y[&unit=F]
 *     Returns 14-day hourly forecast. Checks weather_cache first (1-hour TTL).
 *     On cache miss, fetches from Open-Meteo and stores result.
 *     Responds with { hourly, hourly_units, cachedAt, expiresAt, refreshed? }
 *
 *   GET /api/weather/geocode?q=...
 *     Proxies Open-Meteo geocoding API. Returns { lat, lon, displayName }.
 *     No caching — only called during location setup.
 *
 *   GET /api/weather/reverse-geocode?lat=X&lon=Y
 *     Proxies Nominatim reverse geocoding. Returns { displayName }.
 *     Cached in Redis (or in-memory fallback) for 24 hours, keyed on 0.1°
 *     rounded lat/lon grid — same resolution as the forecast cache.
 */

const getDb = () => require('../db');
const redis = require('../lib/redis');

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL  = 'https://geocoding-api.open-meteo.com/v1/search';
const NOMINATIM_REVERSE_URL   = 'https://nominatim.openstreetmap.org/reverse';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Reverse geocode cache: city/state labels change rarely; 24h TTL is safe.
const REVERSE_GEOCODE_TTL_S = 24 * 60 * 60;  // seconds (for Redis SET EX)

// In-memory fallback for when Redis is unavailable. Only written when redis.set
// returns falsy. Pruned hourly so expired entries don't accumulate indefinitely.
var _reverseGeocodeMemCache = {};
setInterval(function() {
  var now = Date.now();
  Object.keys(_reverseGeocodeMemCache).forEach(function(k) {
    if (_reverseGeocodeMemCache[k].expiresAt <= now) delete _reverseGeocodeMemCache[k];
  });
}, 60 * 60 * 1000).unref();

function roundCoord(v) {
  return Math.round(parseFloat(v) * 10) / 10;
}

// All cached forecasts are stored in Fahrenheit. The scheduler and all
// internal weather decisions assume F. Frontend converts F → C at the
// display layer based on user's temp_unit_pref. See migration
// 20260509000400_normalize_weather_temp_to_fahrenheit.js.
async function fetchFromOpenMeteo(lat, lon) {
  var url = OPEN_METEO_FORECAST_URL +
    '?latitude=' + lat +
    '&longitude=' + lon +
    '&hourly=temperature_2m,precipitation_probability,precipitation,cloudcover,weathercode,relativehumidity_2m' +
    '&forecast_days=14' +
    '&temperature_unit=fahrenheit' +
    '&timezone=auto';
  var resp = await fetch(url);
  if (!resp.ok) throw new Error('Open-Meteo returned ' + resp.status);
  return resp.json();
}

exports.getForecast = async (req, res) => {
  try {
    var lat = parseFloat(req.query.lat);
    var lon = parseFloat(req.query.lon);
    var cacheOnly = req.query.cacheOnly === '1';

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }

    var latGrid = roundCoord(lat);
    var lonGrid = roundCoord(lon);
    var now = new Date();

    // Cache lookup
    var cached = await getDb()('weather_cache')
      .where('lat_grid', latGrid)
      .where('lon_grid', lonGrid)
      .where('expires_at', '>', now)
      .orderBy('fetched_at', 'desc')
      .first();

    if (cached) {
      var data = JSON.parse(cached.forecast_json);
      return res.json({
        hourly: data.hourly,
        hourly_units: data.hourly_units,
        cachedAt: cached.fetched_at,
        expiresAt: cached.expires_at
      });
    }

    if (cacheOnly) {
      return res.json({ miss: true });
    }

    // Cache miss — fetch from Open-Meteo (always Fahrenheit)
    var forecast = await fetchFromOpenMeteo(latGrid, lonGrid);
    var fetchedAt = new Date();
    var expiresAt = new Date(fetchedAt.getTime() + CACHE_TTL_MS);

    await getDb()('weather_cache').insert({
      lat_grid: latGrid,
      lon_grid: lonGrid,
      fetched_at: fetchedAt,
      expires_at: expiresAt,
      forecast_json: JSON.stringify(forecast)
    });

    // Delete stale rows for this grid cell — fire-and-forget so the response
    // is not held while the cleanup DELETE runs against the cache table.
    getDb()('weather_cache')
      .where('lat_grid', latGrid)
      .where('lon_grid', lonGrid)
      .where('expires_at', '<=', now)
      .delete()
      .catch(function(e) { logger.warn('[weather] stale cache cleanup failed:', e.message); });

    res.json({
      hourly: forecast.hourly,
      hourly_units: forecast.hourly_units,
      cachedAt: fetchedAt,
      expiresAt: expiresAt,
      refreshed: true
    });
  } catch (err) {
    logger.error('Weather forecast error:', err.message);
    res.status(500).json({ error: err.message || 'Weather fetch failed' });
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

    var latGrid = roundCoord(req.body.lat);
    var lonGrid = roundCoord(req.body.lon);
    var fetchedAt = new Date();
    var expiresAt = new Date(fetchedAt.getTime() + CACHE_TTL_MS);
    var forecast = { hourly: req.body.hourly, hourly_units: req.body.hourly_units || {} };

    await getDb()('weather_cache').insert({
      lat_grid: latGrid,
      lon_grid: lonGrid,
      fetched_at: fetchedAt,
      expires_at: expiresAt,
      forecast_json: JSON.stringify(forecast)
    });

    // Delete stale rows for this grid cell — fire-and-forget (same pattern as getForecast)
    getDb()('weather_cache')
      .where('lat_grid', latGrid)
      .where('lon_grid', lonGrid)
      .where('expires_at', '<=', fetchedAt)
      .delete()
      .catch(function(e) { logger.warn('[weather] stale cache cleanup failed:', e.message); });

    res.json({ cachedAt: fetchedAt, expiresAt });
  } catch (err) {
    logger.error('Weather ingest error:', err.message);
    res.status(500).json({ error: err.message || 'Ingest failed' });
  }
};

exports.geocode = async (req, res) => {
  try {
    var q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q is required' });

    var url = OPEN_METEO_GEOCODE_URL + '?name=' + encodeURIComponent(q) + '&count=1&language=en&format=json';
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('Geocoding API returned ' + resp.status);
    var data = await resp.json();

    var results = data.results;
    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    var r = results[0];
    var displayName = [r.name, r.admin1, r.country].filter(Boolean).join(', ');

    res.json({ lat: r.latitude, lon: r.longitude, displayName });
  } catch (err) {
    logger.error('Geocode error:', err.message);
    res.status(500).json({ error: err.message || 'Geocode failed' });
  }
};

async function reverseGeocodeDisplayName(lat, lon) {
  // 0.1° rounding collapses nearby requests to the same cache entry.
  var cacheKey = 'rgeo:' + roundCoord(lat) + ':' + roundCoord(lon);

  var cached = await redis.get(cacheKey);
  // cached.displayName !== undefined guards against a corrupt/null-valued entry
  if (cached && cached.displayName !== undefined) return cached.displayName;

  var memEntry = _reverseGeocodeMemCache[cacheKey];
  if (memEntry && memEntry.expiresAt > Date.now()) return memEntry.value;

  var url = NOMINATIM_REVERSE_URL + '?lat=' + lat + '&lon=' + lon + '&format=json&zoom=10';
  var resp = await fetch(url, {
    headers: { 'User-Agent': 'Juggler/1.0 (task-scheduling-app)' }
  });
  if (!resp.ok) throw new Error('Nominatim returned ' + resp.status);
  var data = await resp.json();
  var addr = data.address || {};
  var city = addr.city || addr.town || addr.village || addr.county || '';
  var state = addr.state || addr.region || '';
  var displayName = [city, state].filter(Boolean).join(', ') || data.display_name || '';

  var stored = await redis.set(cacheKey, { displayName }, REVERSE_GEOCODE_TTL_S).catch(function() { return null; });
  if (!stored) {
    _reverseGeocodeMemCache[cacheKey] = { value: displayName, expiresAt: Date.now() + REVERSE_GEOCODE_TTL_S * 1000 };
  }

  return displayName;
}

exports.reverseGeocodeDisplayName = reverseGeocodeDisplayName;
exports.roundCoord = roundCoord;

exports.reverseGeocode = async (req, res) => {
  try {
    var lat = parseFloat(req.query.lat);
    var lon = parseFloat(req.query.lon);
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }
    var displayName = await reverseGeocodeDisplayName(lat, lon);
    res.json({ displayName });
  } catch (err) {
    logger.error('Reverse geocode error:', err.message);
    res.status(500).json({ error: err.message || 'Reverse geocode failed' });
  }
};
