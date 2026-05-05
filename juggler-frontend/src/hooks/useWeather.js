/**
 * useWeather — fetches 14-day hourly forecast from /api/weather
 *
 * Picks the first location that has lat/lon, then falls back to browser
 * geolocation. If neither is available, weather is silently disabled.
 *
 * Returns:
 *   weatherByDate[dateKey] = { high, low, precipPct, code, humidityAvg, hourly[] }
 *   where hourly[i] = { hour, temp, precipProb, cloudcover, code, humidity }
 */

import { useState, useEffect, useRef } from 'react';
import apiClient from '../services/apiClient';

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
    var temp = temperature_2m[i];
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

  // Round temperatures to 1 decimal
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

export default function useWeather(locations, temperatureUnit) {
  var [weatherByDate, setWeatherByDate] = useState({});
  var [refreshed, setRefreshed] = useState(false);
  var locationFetchedRef = useRef(null);

  useEffect(function() {
    var cancelled = false;
    var unit = temperatureUnit || 'F';

    async function fetchWeather(lat, lon) {
      try {
        var resp = await apiClient.get('/weather', { params: { lat, lon, unit } });
        if (cancelled) return;
        var parsed = parseWeather(resp.data, unit);
        setWeatherByDate(parsed);
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
    if (locationFetchedRef.current === 'browser') return;

    navigator.geolocation.getCurrentPosition(
      function(pos) {
        if (cancelled) return;
        locationFetchedRef.current = 'browser';
        fetchWeather(pos.coords.latitude, pos.coords.longitude);
      },
      function() { /* user denied — weather silently disabled */ }
    );

    return function() { cancelled = true; };
  }, [locations, temperatureUnit]);

  return { weatherByDate, refreshed };
}
