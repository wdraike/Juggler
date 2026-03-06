/**
 * TimelineView — horizontal timeline for a single day.
 * Wraps HorizontalTimeline in a scrollable container with the same
 * header chrome as DayView (date, location, progress, template picker).
 */

import React, { useRef, useEffect } from 'react';
import HorizontalTimeline from '../schedule/HorizontalTimeline';
import { getTheme } from '../../theme/colors';
import { MONTH_NAMES, DAY_NAMES_FULL, DAY_NAMES } from '../../state/constants';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';

export default function TimelineView({ selectedDate, selectedDateKey, placements, statuses, directions, onStatusChange, onExpand, onCreate, gridZoom, darkMode, schedCfg, nowMins, isToday, onGridDrop, locSchedules, onUpdateLocScheduleOverrides, allTasks, onBatchHabitsDone, locations, onHourLocationOverride, blockedTaskIds, onZoomChange, isMobile, onMarkerDrag }) {
  var theme = getTheme(darkMode);
  var scrollRef = useRef(null);
  var loc = getLocationForDatePure(selectedDateKey, schedCfg);

  // Template override state
  var dayName = DAY_NAMES[selectedDate.getDay()];
  var defaultTemplate = (schedCfg.locScheduleDefaults || {})[dayName] || 'weekday';
  var overrideTemplate = (schedCfg.locScheduleOverrides || {})[selectedDateKey];
  var activeTemplate = overrideTemplate || defaultTemplate;
  var isOverridden = !!overrideTemplate;
  var templateEntries = locSchedules ? Object.entries(locSchedules) : [];

  var handleTemplateChange = function(e) {
    var val = e.target.value;
    var overrides = Object.assign({}, schedCfg.locScheduleOverrides || {});
    if (val === defaultTemplate) {
      delete overrides[selectedDateKey];
    } else {
      overrides[selectedDateKey] = val;
    }
    if (onUpdateLocScheduleOverrides) onUpdateLocScheduleOverrides(overrides);
  };

  // Auto-scroll to now on mount
  useEffect(function() {
    if (scrollRef.current && isToday) {
      var scrollTo = Math.max(0, ((nowMins - 360) / 60) * (gridZoom < 100 ? 100 : gridZoom) - 100);
      scrollRef.current.scrollLeft = scrollTo;
    }
  }, [selectedDateKey]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Fixed header */}
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid ' + theme.border, background: theme.bg, flexShrink: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: theme.text }}>
          {DAY_NAMES_FULL[selectedDate.getDay()]}, {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getDate()}
        </div>
        <div style={{ fontSize: 12, color: theme.textMuted }}>
          {loc.icon} {loc.name}
        </div>
        {/* Progress bar */}
        {(function() {
          var dayTasks = placements.map(function(p) { return p.task; });
          var total = dayTasks.filter(function(t) { return (statuses[t.id] || '') !== 'cancel' && (statuses[t.id] || '') !== 'skip'; }).length;
          var done = dayTasks.filter(function(t) { return statuses[t.id] === 'done'; }).length;
          var doneDur = dayTasks.filter(function(t) { return statuses[t.id] === 'done'; }).reduce(function(s, t) { return s + (t.dur || 0); }, 0);
          var totalDur = dayTasks.reduce(function(s, t) { return s + (t.dur || 0); }, 0);
          var pct = total > 0 ? Math.round(done / total * 100) : 0;
          return (
            <div title={done + ' of ' + total + ' tasks done (' + Math.round(doneDur / 60 * 10) / 10 + 'h / ' + Math.round(totalDur / 60 * 10) / 10 + 'h)'} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: theme.textMuted }}>
              <div style={{ width: 60, height: 5, background: theme.bgTertiary, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#10B981' : '#3B82F6', borderRadius: 3 }} />
              </div>
              <span>{done}/{total}</span>
              <span>({Math.round(doneDur / 60 * 10) / 10}h / {Math.round(totalDur / 60 * 10) / 10}h)</span>
            </div>
          );
        })()}
        {/* Batch mark habits done */}
        {onBatchHabitsDone && (function() {
          var habitTasks = (allTasks || []).filter(function(t) { return t.habit && t.date === selectedDateKey && (statuses[t.id] || '') !== 'done'; });
          return habitTasks.length > 0 ? (
            <button onClick={function() { onBatchHabitsDone(selectedDateKey); }}
              title={'Mark ' + habitTasks.length + ' habits done'}
              style={{
                border: '1px solid #10B981', borderRadius: 8, padding: '2px 8px',
                background: '#10B98115', color: '#10B981', fontSize: 11,
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600
              }}>
              {'\u2713'}hab ({habitTasks.length})
            </button>
          ) : null;
        })()}
        {templateEntries.length > 0 && (
          <select
            value={activeTemplate}
            onChange={handleTemplateChange}
            title={isOverridden ? 'Schedule template (overridden for this date)' : 'Schedule template (day default: ' + defaultTemplate + ')'}
            style={{
              fontSize: 11, padding: '2px 4px', borderRadius: 4, cursor: 'pointer',
              background: isOverridden ? '#3B82F620' : (darkMode ? '#1E293B' : '#F8FAFC'),
              color: isOverridden ? '#3B82F6' : theme.textMuted,
              border: '1px solid ' + (isOverridden ? '#3B82F6' : theme.border),
              outline: 'none', marginLeft: 4
            }}
          >
            {templateEntries.map(function(entry) {
              var id = entry[0], tmpl = entry[1];
              return (
                <option key={id} value={id}>
                  {(tmpl.icon || '') + ' ' + tmpl.name + (id === defaultTemplate ? ' (default)' : '')}
                </option>
              );
            })}
          </select>
        )}
      </div>
      {/* Scrollable horizontal area */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', minHeight: 0 }} ref={scrollRef}>
        <HorizontalTimeline
          dateKey={selectedDateKey}
          placements={placements}
          statuses={statuses}
          directions={directions}
          onStatusChange={onStatusChange}
          onExpand={onExpand}
          gridZoom={gridZoom}
          darkMode={darkMode}
          schedCfg={schedCfg}
          nowMins={nowMins}
          isToday={isToday}
          onGridDrop={onGridDrop}
          locations={locations}
          onHourLocationOverride={onHourLocationOverride}
          blockedTaskIds={blockedTaskIds}
          onZoomChange={onZoomChange}
          isMobile={isMobile}
          onMarkerDrag={onMarkerDrag}
        />
      </div>
    </div>
  );
}
