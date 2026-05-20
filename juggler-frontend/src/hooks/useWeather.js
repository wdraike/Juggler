/**
 * useWeather — fetches 14-day hourly forecast from /api/weather
 *
 * Picks the first location that has lat/lon, then falls back to browser
 * geolocation. If neither is available, weather is silently disabled.
 *
 * Internal storage and the backend cache are ALWAYS in Fahrenheit. The
 * `temperatureUnit` arg only controls display conversion at parse time —
 * scheduler and stored task constraints live in F regardless of what the
 * user sees on screen.
 *
 * Returns:
 *   weatherByDate[dateKey] = { high, low, precipPct, code, humidityAvg, hourly[] }
 *   where hourly[i] = { hour, temp, precipProb, cloudcover, code, humidity }
 *   (temps already converted to the user's display unit)
 */

import { useState, useEffect, useRef } from 'react';
import apiClient from '../services/apiClient';

var OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

function fToDisplay(f, unit) {
  if (f == null) return f;
  if (unit === 'C') return Math.round(((f - 32) * 5) / 9 * 10) / 10;
  return f;
}

function parseWeather(data, unit) {
  var { time, temperature_2m, precipitation_probability, cloudcover, weathercode, relativehumidity_2m } = data.hourly;
  var byDate = {};

  for (var i = 0; i < time.length; i++) {
    var dt = time[i]; // "2026-05-05T14:00"
    var dateKey = dt.slice(0, 10);
    var hour = parseInt(dt.slice(11, 13), 10);

    if (!byDate[dateKey]) {
      byDate[dateKey] = { high: -Infinity, low: Infinity, precipPct: 0, code: 0, humiditySum: 0, humidityCount: 0, hourly: [] };
    }

    var d = byDate[dateKey];
    // Backend cache is always F; convert to display unit here.
    var temp = fToDisplay(temperature_2m[i], unit);
    var precip = precipitation_probability[i] || 0;
    var code = weathercode[i] || 0;
    var humidity = relativehumidity_2m ? (relativehumidity_2m[i] || 0) : 0;

    if (temp > d.high) d.high = temp;
    if (temp < d.low) d.low = temp;
    if (precip > d.precipPct) d.precipPct = precip;
    if (code > d.code) d.code = code;
    d.humiditySum += humidity;
    d.humidityCount += 1;

    d.hourly.push({ hour, temp, precipProb: precip, cloudcover: cloudcover[i] || 0, code, humidity });
  }

  Object.keys(byDate).forEach(function(k) {
    var d = byDate[k];
    if (d.high === -Infinity) d.high = null;
    if (d.low === Infinity) d.low = null;
    d.humidityAvg = d.humidityCount > 0 ? Math.round(d.humiditySum / d.humidityCount) : null;
    delete d.humiditySum;
    delete d.humidityCount;
  });

  return byDate;
}

var REFRESH_INTERVAL_MS = 55 * 60 * 1000; // 55 min — keeps backend cache (1h TTL) always fresh

export default function useWeather(locations, temperatureUnit) {
  var [weatherByDate, setWeatherByDate] = useState({});
  var [refreshed, setRefreshed] = useState(false);
  var locationFetchedRef = useRef(null);
  var lastFetchAtRef = useRef(0);
  var browserCoordsRef = useRef(null);
  var [refreshTick, setRefreshTick] = useState(0);

  // Periodic refresh: bump refreshTick every 55 min while tab is visible.
  // Also re-fetches on tab focus if last fetch is > 55 min old.
  useEffect(function() {
    var timer = setInterval(function() {
      if (document.visibilityState === 'hidden') return;
      locationFetchedRef.current = null;
      setRefreshTick(function(t) { return t + 1; });
    }, REFRESH_INTERVAL_MS);

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastFetchAtRef.current > REFRESH_INTERVAL_MS) {
          locationFetchedRef.current = null;
          setRefreshTick(function(t) { return t + 1; });
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return function() {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(function() {
    var cancelled = false;
    var displayUnit = temperatureUnit === 'C' ? 'C' : 'F';

    async function fetchWeather(lat, lon) {
      try {
        // 1. Check backend cache first (no external call). Backend always returns F.
        var cacheResp = await apiClient.get('/weather', { params: { lat, lon, cacheOnly: 1 } });
        if (!cancelled && cacheResp.data && cacheResp.data.hourly) {
          setWeatherByDate(parseWeather(cacheResp.data, displayUnit));
          lastFetchAtRef.current = Date.now();
          return;
        }

        // 2. Cache miss — fetch Open-Meteo directly from browser (distributed IPs).
        // Always pull Fahrenheit so the ingest payload matches the canonical cache unit.
        var omUrl = OPEN_METEO_FORECAST_URL +
          '?latitude=' + lat + '&longitude=' + lon +
          '&hourly=temperature_2m,precipitation_probability,precipitation,cloudcover,weathercode,relativehumidity_2m' +
          '&forecast_days=14&temperature_unit=fahrenheit&timezone=auto';
        var omResp = await fetch(omUrl);
        if (omResp.ok) {
          var forecast = await omResp.json();
          if (cancelled) return;
          apiClient.post('/weather/ingest', { lat, lon, hourly: forecast.hourly, hourly_units: forecast.hourly_units }).catch(function() {});
          setWeatherByDate(parseWeather(forecast, displayUnit));
          lastFetchAtRef.current = Date.now();
          return;
        }
      } catch (err) {
        // fall through to backend fetch
      }

      // 3. Fallback — backend fetches Open-Meteo server-side (always F).
      try {
        var resp = await apiClient.get('/weather', { params: { lat, lon } });
        if (cancelled) return;
        setWeatherByDate(parseWeather(resp.data, displayUnit));
        lastFetchAtRef.current = Date.now();
        if (resp.data.refreshed) setRefreshed(true);
      } catch (err) {
        // Fail silently — weather is non-critical
      }
    }

    // Find first location with lat/lon
    var locWithCoords = (locations || []).find(function(l) {
      return typeof l.lat === 'number' && typeof l.lon === 'number';
    });

    if (locWithCoords) {
      var key = locWithCoords.lat + ',' + locWithCoords.lon;
      if (locationFetchedRef.current !== key) {
        locationFetchedRef.current = key;
        fetchWeather(locWithCoords.lat, locWithCoords.lon);
      }
      return function() { cancelled = true; };
    }

    // Fallback: browser geolocation
    if (!navigator.geolocation) return;
    // Refresh path: re-fetch using cached coords without re-querying position
    if (locationFetchedRef.current === null && browserCoordsRef.current) {
      locationFetchedRef.current = 'browser';
      fetchWeather(browserCoordsRef.current.lat, browserCoordsRef.current.lon);
      return function() { cancelled = true; };
    }
    if (locationFetchedRef.current === 'browser') return;

    navigator.geolocation.getCurrentPosition(
      function(pos) {
        if (cancelled) return;
        locationFetchedRef.current = 'browser';
        browserCoordsRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        fetchWeather(pos.coords.latitude, pos.coords.longitude);
      },
      function() { /* user denied — weather silently disabled */ }
    );

    return function() { cancelled = true; };
  }, [locations, temperatureUnit, refreshTick]);

  return { weatherByDate, refreshed };
}
