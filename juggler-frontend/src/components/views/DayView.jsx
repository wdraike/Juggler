/**
 * DayView — single day calendar grid
 */

import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import CalendarGrid from '../schedule/CalendarGrid';
import { getTheme } from '../../theme/colors';
import { MONTH_NAMES, DAY_NAMES_FULL, DAY_NAMES, GRID_START, isTerminalStatus, PAST_OPACITY } from '../../state/constants';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';
import { formatDateKey } from '../../scheduler/dateHelpers';

import WeatherBadge from '../features/WeatherBadge';
import AllDayBanner from './AllDayBanner';

export default function DayView({ selectedDate, selectedDateKey, placements, statuses, onStatusChange, onDelete, onExpand, onCreate, gridZoom, darkMode, schedCfg, nowMins, isToday, onGridDrop, locSchedules, onUpdateLocScheduleOverrides, onUpdateLocScheduleDefaults, allTasks, onBatchRecurringsDone, locations, onHourLocationOverride, blockedTaskIds, unplacedIds, pastDueIds, fixedIds, filter, onZoomChange, isMobile, onMarkerDrag, weatherByDate }) {
  var theme = getTheme(darkMode);
  var scrollRef = useRef(null);
  var loc = getLocationForDatePure(selectedDateKey, schedCfg);
  var isPast = selectedDate < new Date(new Date().setHours(0, 0, 0, 0));

  // Status filter — matches DailyView logic
  // Past days: done/skip/cancel are historical records and always visible under 'open'.
  var matchesFilter = useCallback(function (taskId) {
    if (!filter || filter === 'all') return true;
    var st = statuses[taskId] || '';
    if (filter === 'open') {
      if (isPast && (st === 'done' || st === 'cancel' || st === 'skip' || st === 'missed')) return true;
      return st !== 'done' && st !== 'cancel' && st !== 'skip' && st !== 'pause' && st !== 'missed';
    }
    if (filter === 'action') return st === '' || st === 'wip';
    if (filter === 'done') return st === 'done';
    if (filter === 'wip') return st === 'wip';
    if (filter === 'pause') return st === 'pause';
    if (filter === 'missed') return st === 'missed';
    if (filter === 'pastdue') return pastDueIds && pastDueIds.has(taskId);
    if (filter === 'fixed') return fixedIds && fixedIds.has(taskId);
    if (filter === 'blocked') return blockedTaskIds && blockedTaskIds.has(taskId);
    if (filter === 'unplaced') return unplacedIds && unplacedIds.has(taskId);
    return true;
  }, [filter, statuses, blockedTaskIds, unplacedIds, pastDueIds, fixedIds, isPast]);

  var filteredPlacements = useMemo(function () {
    if (!filter || filter === 'all') return placements;
    return placements.filter(function (p) { return p.task && matchesFilter(p.task.id); });
  }, [placements, filter, matchesFilter]);

  var earlyPlacements = useMemo(function () {
    return filteredPlacements.filter(function (p) { return p.task && p.start < GRID_START * 60; });
  }, [filteredPlacements]);

  var gridPlacements = useMemo(function () {
    if (earlyPlacements.length === 0) return filteredPlacements;
    return filteredPlacements.filter(function (p) { return !(p.task && p.start < GRID_START * 60); });
  }, [filteredPlacements, earlyPlacements]);

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

  var handleSetDefault = function() {
    if (!onUpdateLocScheduleDefaults) return;
    var defs = Object.assign({}, schedCfg.locScheduleDefaults || {});
    defs[dayName] = activeTemplate;
    onUpdateLocScheduleDefaults(defs);
    // Clear the override since it's now the default
    if (isOverridden && onUpdateLocScheduleOverrides) {
      var overrides = Object.assign({}, schedCfg.locScheduleOverrides || {});
      delete overrides[selectedDateKey];
      onUpdateLocScheduleOverrides(overrides);
    }
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
        {weatherByDate && weatherByDate[selectedDateKey] && (
          <WeatherBadge weatherDay={weatherByDate[selectedDateKey]} showLow darkMode={darkMode} />
        )}
        {templateEntries.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <select
              value={activeTemplate}
              onChange={handleTemplateChange}
              title={isOverridden ? 'Schedule template (overridden for this date)' : 'Schedule template (day default: ' + defaultTemplate + ')'}
              style={{
                fontSize: 11, padding: '2px 4px', borderRadius: 4, cursor: 'pointer',
                background: isOverridden ? theme.accent + '20' : theme.bgCard,
                color: isOverridden ? theme.accent : theme.textMuted,
                border: '1px solid ' + (isOverridden ? theme.accent : theme.border),
                outline: 'none'
              }}
            >
              {templateEntries.map(([id, tmpl]) => (
                <option key={id} value={id}>
                  {tmpl.icon || ''} {tmpl.name}{id === defaultTemplate ? ' (default)' : ''}
                </option>
              ))}
            </select>
            {isOverridden && onUpdateLocScheduleDefaults && (
              <button onClick={handleSetDefault}
                title={'Make "' + activeTemplate + '" the default for all ' + DAY_NAMES_FULL[selectedDate.getDay()] + 's'}
                style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                  border: '1px solid ' + theme.border, background: 'transparent',
                  color: theme.textMuted, fontFamily: 'inherit', fontWeight: 600
                }}>
                Set as {dayName} default
              </button>
            )}
          </div>
        )}
      </div>
      {/* All-day events banner — also outside scroll */}
      {(() => {
        var dvTodayKey = formatDateKey(new Date());
        var isPastDay = !!selectedDateKey && selectedDateKey < dvTodayKey;
        return (
          <AllDayBanner
            allTasks={allTasks}
            dateKey={selectedDateKey}
            statuses={statuses}
            onExpand={onExpand}
            darkMode={darkMode}
            isPastDay={isPastDay}
          />
        );
      })()}
      {/* Early-hours banner — tasks scheduled before GRID_START (6 AM) */}
      {earlyPlacements.length > 0 && (() => { var dvTodayKey2 = formatDateKey(new Date()); var isPastDay2 = !!selectedDateKey && selectedDateKey < dvTodayKey2; return (
        <div style={{ padding: '4px 12px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: theme.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Before 6 AM</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {earlyPlacements.map(function(p) {
              var t = p.task;
              var st = statuses[t.id] || '';
              var isDone = isTerminalStatus(st);
              return (
                <div key={t.id} onClick={function() { onExpand(t.id); }}
                  style={{
                    padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                    background: isDone ? theme.badgeBg : theme.bgCard,
                    color: isDone ? theme.textMuted : theme.text,
                    border: '1px solid ' + theme.border,
                    opacity: (isDone && isPastDay2) ? PAST_OPACITY : (isDone ? 0.5 : 1),
                    textDecoration: isDone ? 'line-through' : 'none',
                    display: 'flex', alignItems: 'center', gap: 4
                  }}>
                  {t.time && <span style={{ fontSize: 10, color: theme.textMuted }}>{t.time}</span>}
                  {st === 'done' && <span style={{ fontSize: 9 }}>{'✓'}</span>}
                  {st === 'skip' && <span style={{ fontSize: 9 }}>{'⏭'}</span>}
                  {st === 'cancel' && <span style={{ fontSize: 9 }}>{'✗'}</span>}
                  <span>{t.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      ); })()}
      {/* Scrollable grid area */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, maxWidth: '100%', width: '100%' }} ref={scrollRef}>
        <div style={{ padding: isMobile ? '0 2px' : '0 12px', maxWidth: '100%', boxSizing: 'border-box' }}>
          <CalendarGrid
            dateKey={selectedDateKey}
            placements={gridPlacements}
            statuses={statuses}

            onStatusChange={onStatusChange} onDelete={onDelete}
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
            weatherDay={weatherByDate && weatherByDate[selectedDateKey]}
          />
        </div>
      </div>
    </div>
  );
}
