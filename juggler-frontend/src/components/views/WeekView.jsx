/**
 * WeekView — 7-column calendar
 */

import React from 'react';
import CalendarGrid from '../schedule/CalendarGrid';
import { getTheme } from '../../theme/colors';
import { DAY_NAMES } from '../../state/constants';
import { formatDateKey, getWeekStart } from '../../scheduler/dateHelpers';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';

export default function WeekView({ selectedDate, dayPlacements, statuses, directions, onStatusChange, onExpand, gridZoom, darkMode, schedCfg, nowMins, onGridDrop, blockedTaskIds, onZoomChange, isMobile }) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(new Date());
  var weekStart = getWeekStart(selectedDate);

  var days = Array.from({ length: 7 }, (_, i) => {
    var d = new Date(weekStart);
    d.setDate(d.getDate() + i);
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
              flex: 1, padding: '4px 4px', fontSize: 10, fontWeight: 600, color: theme.text,
              borderBottom: `1px solid ${theme.border}`,
              borderRight: i < 6 ? `1px solid ${theme.border}` : 'none',
              textAlign: 'center',
              background: d.isToday ? theme.accent + '15' : theme.bg
            }}>
              {DAY_NAMES[d.date.getDay()]} {d.date.getDate()} {loc.icon}
            </div>
          );
        })}
      </div>
      {/* Scrollable grid area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'auto', minWidth: isMobile ? 700 : undefined, minHeight: 0 }}>
        {days.map((d, i) => (
          <div key={d.key} style={{ flex: 1, borderRight: i < 6 ? `1px solid ${theme.border}` : 'none', minWidth: 0 }}>
            <CalendarGrid
              dateKey={d.key}
              placements={dayPlacements[d.key] || []}
              statuses={statuses}
              directions={directions}
              onStatusChange={onStatusChange}
              onExpand={onExpand}
              gridZoom={Math.max(gridZoom * 0.6, 30)}
              darkMode={darkMode}
              schedCfg={schedCfg}
              nowMins={nowMins}
              isToday={d.isToday}
              onGridDrop={onGridDrop}
              blockedTaskIds={blockedTaskIds}
              onZoomChange={onZoomChange}
              isMobile={isMobile}
              layoutMode="mini"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
