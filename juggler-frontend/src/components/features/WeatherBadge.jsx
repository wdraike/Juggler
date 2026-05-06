/**
 * WeatherBadge — inline weather display for calendar view headers
 *
 * Props:
 *   weatherDay  — one entry from weatherByDate (high, low, precipPct, code)
 *   compact     — if true, show icon + high only (for MonthView cells)
 *   showLow     — if true, show high/low (for DayView / ListView)
 *   darkMode    — bool
 *   unit        — 'F' | 'C' (default 'F')
 */

import React from 'react';

function weatherIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

function fmt(temp, unit) {
  if (temp == null) return '—';
  return Math.round(temp) + '°' + (unit || 'F');
}

export default function WeatherBadge({ weatherDay, compact, showLow, darkMode, unit }) {
  if (!weatherDay || weatherDay.high == null) return null;

  var icon = weatherIcon(weatherDay.code || 0);
  var highStr = fmt(weatherDay.high, unit);
  var lowStr = fmt(weatherDay.low, unit);
  var precipPct = weatherDay.precipPct || 0;
  var showPrecip = precipPct >= 30;

  var color = darkMode ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';

  if (compact) {
    return (
      <span style={{ fontSize: 11, color, display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
        <span>{icon}</span>
        <span>{highStr}</span>
        {showPrecip && <span style={{ opacity: 0.75 }}>{precipPct}%</span>}
      </span>
    );
  }

  return (
    <span style={{ fontSize: 11, color, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
      <span>{icon}</span>
      <span>{highStr}</span>
      {showLow && <span style={{ opacity: 0.8 }}>/ {lowStr}</span>}
      {showPrecip && <span style={{ opacity: 0.75 }}>· {precipPct}%</span>}
    </span>
  );
}
