/**
 * ThreeDayView — 3-column calendar
 */

import React from 'react';
import CalendarGrid from '../schedule/CalendarGrid';
import { getTheme } from '../../theme/colors';
import { DAY_NAMES, MONTH_NAMES } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';

export default function ThreeDayView({ selectedDate, dayPlacements, statuses, onStatusChange, onDelete, onExpand, gridZoom, darkMode, schedCfg, nowMins, onGridDrop, blockedTaskIds, onZoomChange, isMobile, onMarkerDrag }) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(new Date());

  var days = [-1, 0, 1].map(offset => {
    var d = new Date(selectedDate);
    d.setDate(d.getDate() + offset);
    var key = formatDateKey(d);
    return { date: d, key, isToday: key === todayKey };
  });

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
      {/* Fixed day headers — outside scroll */}
      <div style={{ display: 'flex', flexShrink: 0 }}>
        {days.map((d, i) => {
          var loc = getLocationForDatePure(d.key, schedCfg);
          return (
            <div key={d.key} style={{
              flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 600, color: theme.text,
              borderBottom: `1px solid ${theme.border}`,
              borderRight: i < 2 ? `1px solid ${theme.border}` : 'none',
              background: d.isToday ? theme.accent + '15' : theme.bg
            }}>
              {DAY_NAMES[d.date.getDay()]} {d.date.getDate()} <span style={{ fontSize: 10, color: theme.textMuted }}>{loc.icon}</span>
            </div>
          );
        })}
      </div>
      {/* Scrollable grid area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'auto', minWidth: isMobile ? 600 : undefined, minHeight: 0 }}>
        {days.map((d, i) => (
          <div key={d.key} style={{ flex: 1, borderRight: i < 2 ? `1px solid ${theme.border}` : 'none', minWidth: 0 }}>
            <CalendarGrid
              dateKey={d.key}
              placements={dayPlacements[d.key] || []}
              statuses={statuses}

              onStatusChange={onStatusChange} onDelete={onDelete}
              onExpand={onExpand}
              gridZoom={gridZoom}
              darkMode={darkMode}
              schedCfg={schedCfg}
              nowMins={nowMins}
              isToday={d.isToday}
              onGridDrop={onGridDrop}
              blockedTaskIds={blockedTaskIds}
              onZoomChange={onZoomChange}
              isMobile={isMobile}
              layoutMode="compact"
              onMarkerDrag={onMarkerDrag}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
