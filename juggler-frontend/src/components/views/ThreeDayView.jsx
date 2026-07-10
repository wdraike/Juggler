/**
 * ThreeDayView — 3-column calendar
 */

import React from 'react';
import CalendarGrid from '../schedule/CalendarGrid';
import { getTheme } from '../../theme/colors';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { formatDayHeader } from '../../utils/timezone';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';

import WeatherBadge from '../features/WeatherBadge';
import AllDayBanner from './AllDayBanner';
import EmptyState from './EmptyState';

export default function ThreeDayView({ selectedDate, dayPlacements, allTasks, statuses, onStatusChange, onDelete, onExpand, gridZoom, darkMode, schedCfg, nowMins, onGridDrop, blockedTaskIds, onZoomChange, isMobile, onMarkerDrag, weatherByDate }) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(new Date());

  var days = [-1, 0, 1].map(offset => {
    var d = new Date(selectedDate);
    d.setDate(d.getDate() + offset);
    var key = formatDateKey(d);
    return { date: d, key, isToday: key === todayKey };
  });

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      {/* 999.1235: empty-state one-liner instead of a bare grid */}
      {(allTasks || []).length === 0 && (
        <EmptyState theme={theme} hint="No tasks yet — press + in the header to add one and watch it land on the grid." />
      )}
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
              {formatDayHeader(d.date)} <span style={{ fontSize: 10, color: theme.textMuted }}>{loc.icon}</span>
              {weatherByDate && weatherByDate[d.key] && <div style={{ marginTop: 2 }}><WeatherBadge weatherDay={weatherByDate[d.key]} darkMode={darkMode} /></div>}
            </div>
          );
        })}
      </div>
      {/* Scrollable grid area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'auto', minWidth: isMobile ? 600 : undefined, minHeight: 0 }}>
        {days.map((d, i) => (
          <div key={d.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: i < 2 ? `1px solid ${theme.border}` : 'none', minWidth: 0 }}>
            <AllDayBanner
              allTasks={allTasks}
              dateKey={d.key}
              statuses={statuses}
              onExpand={onExpand}
              darkMode={darkMode}
              isPastDay={d.key < todayKey}
            />
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
              weatherDay={weatherByDate && weatherByDate[d.key]}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
