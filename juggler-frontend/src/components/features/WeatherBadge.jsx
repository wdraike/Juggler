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
import { weatherIconUrl, RAINDROP_URL } from '../../utils/weatherIcons';

function fmt(temp, unit) {
  if (temp == null) return '—';
  return Math.round(temp) + '°' + (unit || 'F');
}

export default function WeatherBadge({ weatherDay, compact, showLow, darkMode, unit }) {
  if (!weatherDay || weatherDay.high == null) return null;

  var iconUrl = weatherIconUrl(weatherDay.code || 0);
  var highStr = fmt(weatherDay.high, unit);
  var lowStr = fmt(weatherDay.low, unit);
  var precipPct = weatherDay.precipPct || 0;
  var showPrecip = precipPct >= 30;

  var color = darkMode ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
  var imgStyle = { verticalAlign: 'middle', display: 'inline-block' };

  if (compact) {
    return (
      <span style={{ fontSize: 11, color, display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
        <img src={iconUrl} alt="" width={14} height={14} style={imgStyle} />
        <span>{highStr}</span>
        {showPrecip && (
          <>
            <img src={RAINDROP_URL} alt="" width={11} height={11} style={imgStyle} />
            <span style={{ opacity: 0.75 }}>{precipPct}%</span>
          </>
        )}
      </span>
    );
  }

  return (
    <span style={{ fontSize: 11, color, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
      <img src={iconUrl} alt="" width={20} height={20} style={imgStyle} />
      <span>{highStr}</span>
      {showLow && <span style={{ opacity: 0.8 }}>/ {lowStr}</span>}
      {showPrecip && (
        <>
          <img src={RAINDROP_URL} alt="" width={14} height={14} style={imgStyle} />
          <span style={{ opacity: 0.75 }}>{precipPct}%</span>
        </>
      )}
    </span>
  );
}
