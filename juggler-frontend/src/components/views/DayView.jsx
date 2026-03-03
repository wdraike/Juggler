/**
 * DayView — single day calendar grid
 */

import React, { useRef, useEffect } from 'react';
import CalendarGrid from '../schedule/CalendarGrid';
import { getTheme } from '../../theme/colors';
import { MONTH_NAMES, DAY_NAMES_FULL, DAY_NAMES } from '../../state/constants';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';

export default function DayView({ selectedDate, selectedDateKey, placements, statuses, directions, onStatusChange, onExpand, onCreate, gridZoom, darkMode, schedCfg, nowMins, isToday, onGridDrop, locSchedules, onUpdateLocScheduleOverrides, allTasks, onBatchHabitsDone, locations, onHourLocationOverride, blockedTaskIds, onZoomChange, isMobile }) {
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

  useEffect(() => {
    if (scrollRef.current && isToday) {
      var scrollTo = Math.max(0, ((nowMins - 360) / 60) * gridZoom - 100);
      scrollRef.current.scrollTop = scrollTo;
    }
  }, [selectedDateKey]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Fixed header — outside scroll area so cards never overlap it */}
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderBottom: `1px solid ${theme.border}`, background: theme.bg, flexShrink: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: theme.text }}>
          {DAY_NAMES_FULL[selectedDate.getDay()]}, {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getDate()}
        </div>
        <div style={{ fontSize: 12, color: theme.textMuted }}>
          {loc.icon} {loc.name}
        </div>
        {/* Progress bar for the day */}
        {(() => {
          var dayTasks = placements.map(p => p.task);
          var total = dayTasks.filter(t => (statuses[t.id] || '') !== 'cancel' && (statuses[t.id] || '') !== 'skip').length;
          var done = dayTasks.filter(t => statuses[t.id] === 'done').length;
          var doneDur = dayTasks.filter(t => statuses[t.id] === 'done').reduce((s, t) => s + (t.dur || 0), 0);
          var totalDur = dayTasks.reduce((s, t) => s + (t.dur || 0), 0);
          var pct = total > 0 ? Math.round(done / total * 100) : 0;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: theme.textMuted }}>
              <div style={{ width: 60, height: 5, background: theme.bgTertiary, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#10B981' : '#3B82F6', borderRadius: 3 }} />
              </div>
              <span>{done}/{total}</span>
              <span>({Math.round(doneDur / 60 * 10) / 10}h / {Math.round(totalDur / 60 * 10) / 10}h)</span>
            </div>
          );
        })()}
        {/* Batch mark habits done */}
        {onBatchHabitsDone && (() => {
          var habitTasks = (allTasks || []).filter(t => t.habit && t.date === selectedDateKey && (statuses[t.id] || '') !== 'done');
          return habitTasks.length > 0 ? (
            <button onClick={() => onBatchHabitsDone(selectedDateKey)}
              title={'Mark ' + habitTasks.length + ' habits done'}
              style={{
                border: '1px solid #10B981', borderRadius: 8, padding: '2px 8px',
                background: '#10B98115', color: '#10B981', fontSize: 11,
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600
              }}>
              &#x2713;hab ({habitTasks.length})
            </button>
          ) : null;
        })()}
        {templateEntries.length > 0 && (
          <select
            value={activeTemplate}
            onChange={handleTemplateChange}
            style={{
              fontSize: 11, padding: '2px 4px', borderRadius: 4, cursor: 'pointer',
              background: isOverridden ? '#3B82F620' : (darkMode ? '#1E293B' : '#F8FAFC'),
              color: isOverridden ? '#3B82F6' : theme.textMuted,
              border: `1px solid ${isOverridden ? '#3B82F6' : theme.border}`,
              outline: 'none', marginLeft: 4
            }}
          >
            {templateEntries.map(([id, tmpl]) => (
              <option key={id} value={id}>
                {tmpl.icon || ''} {tmpl.name}{id === defaultTemplate ? ' (default)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
      {/* All-day events banner — also outside scroll */}
      {(() => {
        var allDayTasks = (allTasks || []).filter(t => t.date === selectedDateKey && (t.when === 'allday' || (!t.time && (t.dur === 0 || t.dur === null))));
        if (allDayTasks.length === 0) return null;
        return (
          <div style={{ padding: '4px 12px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: theme.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>All Day</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {allDayTasks.map(t => {
                var st = statuses[t.id] || '';
                var isDone = st === 'done' || st === 'cancel' || st === 'skip';
                return (
                  <div key={t.id} onClick={() => onExpand(t.id)}
                    style={{
                      padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                      background: isDone ? (darkMode ? '#1E293B' : '#F1F5F9') : (darkMode ? '#1E3A5F' : '#DBEAFE'),
                      color: isDone ? theme.textMuted : (darkMode ? '#93C5FD' : '#1E40AF'),
                      border: '1px solid ' + (isDone ? theme.border : (darkMode ? '#3B82F640' : '#93C5FD')),
                      opacity: isDone ? 0.5 : 1,
                      textDecoration: isDone ? 'line-through' : 'none'
                    }}>
                    {t.text}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {/* Scrollable grid area */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }} ref={scrollRef}>
        <div style={{ padding: isMobile ? '0 4px' : '0 12px' }}>
          <CalendarGrid
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
          />
        </div>
      </div>
    </div>
  );
}
