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
 */

const db = require('../db');

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL  = 'https://geocoding-api.open-meteo.com/v1/search';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function roundCoord(v) {
  return Math.round(parseFloat(v) * 10) / 10;
}

async function fetchFromOpenMeteo(lat, lon, unit) {
  var tempUnit = (unit === 'F' || unit === 'fahrenheit') ? 'fahrenheit' : 'celsius';
  var url = OPEN_METEO_FORECAST_URL +
    '?latitude=' + lat +
    '&longitude=' + lon +
    '&hourly=temperature_2m,precipitation_probability,precipitation,cloudcover,weathercode' +
    '&forecast_days=14' +
    '&temperature_unit=' + tempUnit +
    '&timezone=auto';
  var resp = await fetch(url);
  if (!resp.ok) throw new Error('Open-Meteo returned ' + resp.status);
  return resp.json();
}

exports.getForecast = async (req, res) => {
  try {
    var lat = parseFloat(req.query.lat);
    var lon = parseFloat(req.query.lon);
    var unit = (req.query.unit || 'C').toUpperCase();

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }

    var latGrid = roundCoord(lat);
    var lonGrid = roundCoord(lon);
    var now = new Date();

    // Cache lookup
    var cached = await db('weather_cache')
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

    // Cache miss — fetch from Open-Meteo
    var forecast = await fetchFromOpenMeteo(latGrid, lonGrid, unit);
    var fetchedAt = new Date();
    var expiresAt = new Date(fetchedAt.getTime() + CACHE_TTL_MS);

    await db('weather_cache').insert({
      lat_grid: latGrid,
      lon_grid: lonGrid,
      fetched_at: fetchedAt,
      expires_at: expiresAt,
      forecast_json: JSON.stringify(forecast)
    });

    // Delete stale rows for this grid cell
    await db('weather_cache')
      .where('lat_grid', latGrid)
      .where('lon_grid', lonGrid)
      .where('expires_at', '<=', now)
      .delete();

    res.json({
      hourly: forecast.hourly,
      hourly_units: forecast.hourly_units,
      cachedAt: fetchedAt,
      expiresAt: expiresAt,
      refreshed: true
    });
  } catch (err) {
    console.error('Weather forecast error:', err.message);
    res.status(500).json({ error: err.message || 'Weather fetch failed' });
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
    console.error('Geocode error:', err.message);
    res.status(500).json({ error: err.message || 'Geocode failed' });
  }
};
