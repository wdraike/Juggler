/**
 * ThreeDayView — 3-column calendar
 */

import React from 'react';
import CalendarGrid from '../schedule/CalendarGrid';
import { getTheme } from '../../theme/colors';
import { DAY_NAMES, MONTH_NAMES } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';

export default function ThreeDayView({ selectedDate, dayPlacements, statuses, directions, onStatusChange, onExpand, gridZoom, darkMode, schedCfg, nowMins, onGridDrop, blockedTaskIds, onZoomChange }) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(new Date());

  var days = [-1, 0, 1].map(offset => {
    var d = new Date(selectedDate);
    d.setDate(d.getDate() + offset);
    var key = formatDateKey(d);
    return { date: d, key, isToday: key === todayKey };
  });

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'auto' }}>
      {days.map((d, i) => {
        var loc = getLocationForDatePure(d.key, schedCfg);
        return (
          <div key={d.key} style={{ flex: 1, borderRight: i < 2 ? `1px solid ${theme.border}` : 'none', minWidth: 0 }}>
            <div style={{ padding: '6px 8px', fontSize: 12, fontWeight: 600, color: theme.text, borderBottom: `1px solid ${theme.border}`, background: d.isToday ? theme.accent + '15' : 'transparent' }}>
              {DAY_NAMES[d.date.getDay()]} {d.date.getDate()} <span style={{ fontSize: 10, color: theme.textMuted }}>{loc.icon}</span>
            </div>
            <CalendarGrid
              dateKey={d.key}
              placements={dayPlacements[d.key] || []}
              statuses={statuses}
              directions={directions}
              onStatusChange={onStatusChange}
              onExpand={onExpand}
              gridZoom={gridZoom}
              darkMode={darkMode}
              schedCfg={schedCfg}
              nowMins={nowMins}
              isToday={d.isToday}
              onGridDrop={onGridDrop}
              blockedTaskIds={blockedTaskIds}
              onZoomChange={onZoomChange}
            />
          </div>
        );
      })}
    </div>
  );
}
