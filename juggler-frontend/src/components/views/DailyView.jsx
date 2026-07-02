/**
 * DailyView — daily calendar with hour rows, reactive task cards,
 * drag-and-drop rescheduling, pinch/wheel zoom, and location-tinted rows.
 *
 * Split (999.965 JUG-PERF-FE-GOD-COMPONENTS): pure helpers moved to
 * dailyViewHelpers.js, and the FixedPopup/TaskBlock/UnschedEntry/GhostBlock
 * sub-components moved to their own sibling files. This file is now a thin
 * orchestrator — no behavior change (see TRACEABILITY.md B1-B7).
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { getTheme } from '../../theme/colors';
import { GRID_START, GRID_END, MONTH_NAMES, DAY_NAMES_FULL, DAY_NAMES, locIcon, LOC_TINT, locBgTint } from '../../state/constants';
import { isTerminalStatus } from '../../shared/task-status';
import { formatHour, formatDateKey, parseDate } from '../../scheduler/dateHelpers';
import { getBlocksForDate } from '../../scheduler/timeBlockHelpers';
import { resolveLocationId, getLocationForDatePure } from '../../scheduler/locationHelpers';
import WeatherBadge from '../features/WeatherBadge';
import { weatherIconUrl } from '../../utils/weatherIcons';
import AllDayBanner from './AllDayBanner';
import { isAllDayTask } from '../../utils/isAllDayTask';
import { computeColumns, weatherCodeLabel, minsToTime, MIN_BLOCK_H } from './dailyViewHelpers';
import TaskBlock from './DailyViewTaskBlock';
import UnschedEntry from './DailyViewUnschedEntry';
import GhostBlock from './DailyViewGhostBlock';

export { computeColumns } from './dailyViewHelpers';

var MIN_PX_PER_HOUR = 30;
var MAX_PX_PER_HOUR = 240;

/* ── Main DailyView ── */
export default function DailyView({
  selectedDate, selectedDateKey, placements, statuses, onStatusChange,
  onExpand, darkMode, schedCfg, nowMins, isToday, allTasks, unplaced,
  filter, blockedTaskIds, unplacedIds, pastDueIds, fixedIds, isMobile,
  onUpdate, onDelete, showToast, locations, onHourLocationOverride,
  locSchedules, onUpdateLocScheduleOverrides, onUpdateLocScheduleDefaults, onBatchRecurringsDone,
  weatherByDate
}) {
  var theme = getTheme(darkMode);
  var scrollRef = useRef(null);
  var loc = getLocationForDatePure(selectedDateKey, schedCfg);
  var isPast = selectedDate < new Date(new Date().setHours(0, 0, 0, 0));

  // Schedule template state
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

  // Continuous zoom via pinch/wheel, with preset buttons as shortcuts
  var [hourHeight, setHourHeight] = useState(function () {
    var saved = parseInt(localStorage.getItem('juggler-daily-zoom-px'), 10);
    if (saved >= MIN_PX_PER_HOUR && saved <= MAX_PX_PER_HOUR) return saved;
    return 60;
  });

  var setZoomPersist = useCallback(function (px) {
    var clamped = Math.max(MIN_PX_PER_HOUR, Math.min(MAX_PX_PER_HOUR, Math.round(px)));
    setHourHeight(clamped);
    try { localStorage.setItem('juggler-daily-zoom-px', String(clamped)); } catch (e) {}
  }, []);

  var totalHours = GRID_END - GRID_START + 1;
  var gridHeight = totalHours * hourHeight;

  // Sub-hour gridlines based on zoom
  var subDiv = hourHeight >= 160 ? 4 : hourHeight >= 90 ? 2 : 1;

  // Location menu state
  var [locMenuHour, setLocMenuHour] = useState(null);
  var [dvHoveredHour, setDvHoveredHour] = useState(null);
  var [dvHoveredPos, setDvHoveredPos] = useState(null);

  // Pinch zoom
  useEffect(function () {
    var el = scrollRef.current;
    if (!el) return;
    var startDist = null;
    var startZoom = null;

    function onTouchStart(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        startDist = Math.hypot(dx, dy);
        startZoom = hourHeight;
      }
    }
    function onTouchMove(e) {
      if (e.touches.length === 2 && startDist) {
        e.preventDefault();
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.hypot(dx, dy);
        var newZoom = Math.round(startZoom * (dist / startDist));
        setZoomPersist(newZoom);
      }
    }
    function onTouchEnd() { startDist = null; startZoom = null; }

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return function () {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [hourHeight, setZoomPersist]);

  // Wheel zoom (Ctrl/Cmd + wheel)
  useEffect(function () {
    var el = scrollRef.current;
    if (!el) return;
    function onWheel(e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? -8 : 8;
        setZoomPersist(hourHeight + delta);
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return function () { el.removeEventListener('wheel', onWheel); };
  }, [hourHeight, setZoomPersist]);

  // Scroll to current time on mount / date change
  useEffect(function () {
    if (scrollRef.current && isToday) {
      var scrollTo = Math.max(0, ((nowMins - GRID_START * 60) / 60) * hourHeight - 100);
      scrollRef.current.scrollTop = scrollTo;
    }
  }, [selectedDateKey, hourHeight]);

  var blocks = useMemo(function () {
    return getBlocksForDate(selectedDateKey, schedCfg) || [];
  }, [selectedDateKey, schedCfg]);

  // Pre-compute location per hour
  var hourLocations = useMemo(function () {
    var map = {};
    for (var h = GRID_START; h <= GRID_END; h++) {
      map[h] = resolveLocationId(selectedDateKey, h, schedCfg, blocks);
    }
    return map;
  }, [selectedDateKey, schedCfg, blocks]);

  // Pre-compute hourly weather map for today
  var hourlyByHour = useMemo(function () {
    var day = weatherByDate && weatherByDate[selectedDateKey];
    if (!day || !day.hourly) return {};
    var map = {};
    day.hourly.forEach(function (e) { map[e.hour] = e; });
    return map;
  }, [weatherByDate, selectedDateKey]);

  // Status filter
  // Past days: terminal statuses are historical records and always visible under 'open'.
  var matchesFilter = useCallback(function (taskId) {
    if (!filter || filter === 'all') return true;
    var st = statuses[taskId] || '';
    if (filter === 'open') {
      if (isPast && isTerminalStatus(st)) return true;
      return !isTerminalStatus(st);
    }
    if (filter === 'action') return st === '';
    if (filter === 'done') return st === 'done';
    if (filter === 'pause') return st === 'pause';
    if (filter === 'pastdue') return pastDueIds && pastDueIds.has(taskId);
    if (filter === 'fixed') return fixedIds && fixedIds.has(taskId);
    if (filter === 'blocked') return blockedTaskIds && blockedTaskIds.has(taskId);
    if (filter === 'unplaced') return unplacedIds && unplacedIds.has(taskId);
    return true;
  }, [filter, statuses, blockedTaskIds, unplacedIds, pastDueIds, fixedIds, isPast, isTerminalStatus]);

  // The calendar time-grid is DECOUPLED from the open/done LIST filter (999.882):
  // it shows what actually happened in each slot — every lifecycle state
  // (open/wip/done/skip/started/cancelled/pause) — regardless of which
  // status filter is applied to the task LIST. The list filter still filters the
  // unscheduled task list below (via `matchesFilter`); it must NOT hide a placed
  // task's block from the grid. Terminal blocks render styled/dimmed + status
  // icon (see TaskBlock). A placement only needs a parseable start to appear.
  var allScheduled = useMemo(function () {
    return (placements || []).filter(function (p) {
      return p.start != null;
    }).sort(function (a, b) { return a.start - b.start; });
  }, [placements]);

  var unscheduled = useMemo(function () {
    var scheduledIds = {};
    // Track (sourceId, date) occurrences and HOW MANY chunks of each are
    // already placed. sched-audit REG-45/F4: a sibling row should only be
    // hidden as a "duplicate view of an already-covered occurrence" once the
    // placed chunk count fully covers the occurrence (>= splitTotal, default 1
    // for non-split duplicate task_instance rows) — an incomplete unplaced
    // chunk of a PARTIALLY-placed split must still surface in the lane.
    var scheduledByOccurrence = {};
    (placements || []).forEach(function (p) {
      if (!p.task) return;
      scheduledIds[p.task.id] = true;
      if (p.task.sourceId) {
        scheduledIds[p.task.sourceId] = true;
        var dk = p.task.date || selectedDateKey;
        var occKey = p.task.sourceId + '|' + dk;
        scheduledByOccurrence[occKey] = (scheduledByOccurrence[occKey] || 0) + 1;
      }
    });
    function occurrenceFullyCovered(t, dateKey) {
      if (!t.sourceId) return false;
      var placedCount = scheduledByOccurrence[t.sourceId + '|' + (dateKey || '')] || 0;
      if (placedCount === 0) return false;
      var total = t.splitTotal || 1;
      return placedCount >= total;
    }
    var raw = (allTasks || []).filter(function (t) {
      if (t.date !== selectedDateKey || scheduledIds[t.id]) return false;
      // All-day tasks rendered in the all-day banner above the grid.
      if (isAllDayTask(t)) return false;
      // Recurring template (blueprint) doesn't belong here. `generated`
      // in-memory chunks also don't — only real DB rows do.
      if (t.taskType === 'recurring_template' || t.generated) return false;
      // If another row for this occurrence is already FULLY placed, hide
      // this one — it's a duplicate view of the same occurrence (either
      // a remaining split chunk or a stray task_instance row). A partially
      // placed split's unplaced sibling is NOT hidden (REG-45/F4).
      if (occurrenceFullyCovered(t, t.date)) return false;
      // Only hide terminal statuses when filter is not 'all'
      var st = statuses[t.id] || '';
      if (isTerminalStatus(st) && filter !== 'all' && filter !== 'done' && filter !== st) return false;
      return matchesFilter(t.id);
    });
    // Merge in scheduler-reported unplaced items for this date. Missed
    // recurring instances (flex window passed, user hasn't marked done)
    // live in `unplaced` without a matching DB row in `allTasks` — the
    // deferred-insert pipeline only persists chunks that actually got
    // placed. Without this merge they never surface in the Unscheduled
    // list, and the user can't check them off from here.
    var rawIds = {};
    raw.forEach(function (t) { rawIds[t.id] = true; });
    (unplaced || []).forEach(function (u) {
      if (!u || !u.id || rawIds[u.id]) return;
      if (scheduledIds[u.id]) return;
      if (u.taskType === 'recurring_template') return;
      // Only show unplaced items whose intended date is the day being viewed.
      // u.date may be M/D (from rowToTask) or ISO — normalize before comparing.
      var uDate = u.date || u._candidateDate;
      if (uDate && uDate !== selectedDateKey) {
        var parsed = parseDate(uDate);
        if (!parsed || formatDateKey(parsed) !== selectedDateKey) return;
      }
      if (occurrenceFullyCovered(u, uDate)) return;
      var st = statuses[u.id] || '';
      if (isTerminalStatus(st) && filter !== 'all' && filter !== 'done' && filter !== st) return;
      if (!matchesFilter(u.id)) return;
      raw.push(u);
      rawIds[u.id] = true;
    });
    // Dedupe remaining rows by occurrence so N unplaced chunks of one
    // recurring split task show as a single entry with a count.
    var groups = {};
    var order = [];
    raw.forEach(function (t) {
      var key = t.splitGroup || (t.sourceId ? t.sourceId + '|' + (t.date || '') : t.id);
      if (!groups[key]) { groups[key] = { task: t, count: 0 }; order.push(key); }
      groups[key].count += 1;
    });
    return order.map(function (k) {
      var g = groups[k];
      return g.count > 1 ? Object.assign({}, g.task, { _unplacedChunkCount: g.count }) : g.task;
    });
  }, [allTasks, unplaced, selectedDateKey, placements, statuses, matchesFilter, filter]);

  // Ghost placements: unscheduled tasks that have a desiredAt, shown in the
  // time grid at their intended position with a striped "couldn't schedule" style.
  var ghostPlacements = useMemo(function () {
    return unscheduled.filter(function (t) {
      return !!t.desiredAt;
    }).map(function (t) {
      var d = new Date(t.desiredAt);
      var localMins = d.getHours() * 60 + d.getMinutes();
      if (localMins < GRID_START * 60 || localMins >= GRID_END * 60) return null;
      return { task: t, start: localMins, dur: t.dur || 30 };
    }).filter(Boolean);
  }, [unscheduled]);

  var nowY = isToday ? ((nowMins - GRID_START * 60) / 60) * hourHeight : null;

  // Gutter: time label + small location icon
  var GUTTER_W = isMobile ? 52 : 60;
  var canDrag = !!onUpdate;

  // Drag-over indicator
  var [dragOverY, setDragOverY] = useState(null);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid ' + theme.border,
        background: theme.bg, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'
      }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: theme.text }}>
          {DAY_NAMES_FULL[selectedDate.getDay()]}, {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getDate()}
        </div>
        <div style={{ fontSize: 12, color: theme.textMuted }}>
          {loc.icon} {loc.name}
        </div>
        {weatherByDate && weatherByDate[selectedDateKey] && (
          <WeatherBadge weatherDay={weatherByDate[selectedDateKey]} showLow darkMode={darkMode} />
        )}
        {/* Schedule template selector */}
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
              {templateEntries.map(function (entry) {
                var id = entry[0], tmpl = entry[1];
                return (
                  <option key={id} value={id}>
                    {tmpl.icon || ''} {tmpl.name}{id === defaultTemplate ? ' (default)' : ''}
                  </option>
                );
              })}
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
        <div style={{ flex: 1 }} />
        {/* Zoom presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {[
            { label: '15m', px: 200 },
            { label: '30m', px: 120 },
            { label: '1h', px: 60 },
          ].map(function (z) {
            var active = Math.abs(hourHeight - z.px) < 10;
            return (
              <button key={z.label}
                onClick={function () { setZoomPersist(z.px); }}
                style={{
                  border: '1px solid ' + (active ? theme.accent : theme.border),
                  borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
                  background: active ? theme.accent + '20' : 'transparent',
                  color: active ? theme.accent : theme.textMuted,
                  fontSize: 10, fontWeight: active ? 600 : 400, fontFamily: 'inherit'
                }}
                title={'Zoom: ' + z.label + ' increments'}
              >
                {z.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* All-day events banner */}
      <AllDayBanner
        allTasks={allTasks}
        dateKey={selectedDateKey}
        statuses={statuses}
        onExpand={onExpand}
        darkMode={darkMode}
        isPastDay={isPast}
      />

            {/* Scrollable hour grid */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}
        onClick={locMenuHour !== null ? function () { setLocMenuHour(null); } : undefined}
        onDragOver={onUpdate ? function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var gridEl = e.currentTarget.querySelector('[data-grid-area]');
          if (gridEl) {
            var gridRect = gridEl.getBoundingClientRect();
            var yPx = e.clientY - gridRect.top;
            var totalMin = GRID_START * 60 + (yPx / hourHeight) * 60;
            totalMin = Math.round(totalMin / 5) * 5;
            setDragOverY(((totalMin - GRID_START * 60) / 60) * hourHeight);
          }
        } : undefined}
        onDragLeave={function () { setDragOverY(null); }}
        onDrop={onUpdate ? function (e) {
          setDragOverY(null);
          e.preventDefault();
          var taskId = e.dataTransfer.getData('text/plain');
          if (!taskId) return;
          var gridEl = e.currentTarget.querySelector('[data-grid-area]');
          if (!gridEl) return;
          var gridRect = gridEl.getBoundingClientRect();
          var yPx = e.clientY - gridRect.top;
          var totalMin = GRID_START * 60 + (yPx / hourHeight) * 60;
          totalMin = Math.round(totalMin / 5) * 5;
          var hr = Math.floor(totalMin / 60);
          var mn = totalMin % 60;
          var ap = hr >= 12 ? 'PM' : 'AM';
          var h12 = hr > 12 ? hr - 12 : (hr === 0 ? 12 : hr);
          var newTime = h12 + ':' + (mn < 10 ? '0' : '') + mn + ' ' + ap;
          var fields = { time: newTime };
          var task = (allTasks || []).find(function (t) { return t.id === taskId; });
          if (task && task.date !== selectedDateKey) fields.date = selectedDateKey;
          // sched-audit REG-44/F3 — must check the result before toasting: onUpdate
          // (useTaskState's updateTask) resolves `true` on success but a truthy
          // SERVER-MESSAGE STRING on rejection (e.g. calLocked 403), so only `=== true`
          // counts as success. A rejection must not show the false "Moved" success
          // toast; the optimistic state itself is rolled back inside updateTask.
          Promise.resolve(onUpdate(taskId, fields)).then(function (result) {
            if (result === true) {
              if (showToast) showToast('Moved to ' + newTime, 'success');
            } else if (typeof result === 'string' && showToast) {
              // sched-audit L3 ernie WARN-1 — onUpdate (AppLayout's handleUpdateTask)
              // already shows its own generic 'Save failed' error toast when the
              // update resolves `false`; only show OUR toast for the `string`
              // (specific server-message) case, which handleUpdateTask does NOT
              // toast for, to avoid a double error toast for one failed drag.
              showToast(result, 'error');
            }
          }).catch(function () {
            if (showToast) showToast('Could not move task', 'error');
          });
        } : undefined}
      >
        <div data-grid-area="1" style={{ position: 'relative', height: gridHeight, margin: isMobile ? '0 4px' : '0 12px' }}>

          {/* Location-tinted hour row backgrounds (like CalendarGrid) */}
          {Array.from({ length: totalHours }, function (_, i) {
            var hour = GRID_START + i;
            var locId = hourLocations[hour];
            return (
              <div key={'bg-' + i} style={{
                position: 'absolute', top: i * hourHeight, left: 0, right: 0,
                height: hourHeight, borderBottom: '1px solid ' + theme.gridLine,
                background: locBgTint(locId)
              }} />
            );
          })}

          {/* Time block accent bands */}
          {blocks.map(function (b, i) {
            var top = ((b.start - GRID_START * 60) / 60) * hourHeight;
            var h = ((b.end - b.start) / 60) * hourHeight;
            if (top < 0 || top >= gridHeight) return null;
            return (
              <div key={'blk-' + i} style={{
                position: 'absolute', top: top, left: 0, width: 3, height: h,
                background: (b.color || '#4338CA') + '60',
                borderRadius: '0 2px 2px 0',
                pointerEvents: 'none', zIndex: 1
              }} />
            );
          })}

          {/* Hour labels + location icon strip */}
          {Array.from({ length: totalHours }, function (_, i) {
            var hour = GRID_START + i;
            var y = i * hourHeight;
            var locId = hourLocations[hour];
            var locColor = LOC_TINT[locId] || '#4338CA';
            var locIconStr = locIcon(locId);
            var dvHw = hourlyByHour[hour];

            var lines = [
              <div key={hour} style={{ position: 'absolute', top: y, left: 0, right: 0, pointerEvents: 'none', zIndex: 2 }}>
                {/* Gutter-width hover target — keeps pointer events off the task strip so DayView's CalendarGrid can receive events */}
                <div style={{ position: 'absolute', top: 0, left: 0, width: GUTTER_W, height: hourHeight, pointerEvents: dvHw ? 'auto' : 'none' }}
                  onMouseEnter={dvHw ? function(e) { setDvHoveredHour(hour); setDvHoveredPos({ x: e.clientX, y: e.clientY }); } : undefined}
                  onMouseMove={dvHw ? function(e) { setDvHoveredPos({ x: e.clientX, y: e.clientY }); } : undefined}
                  onMouseLeave={dvHw ? function() { setDvHoveredHour(null); setDvHoveredPos(null); } : undefined}
                />
                {/* Time label */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, width: GUTTER_W - 20,
                  textAlign: 'right', paddingRight: 4,
                  fontSize: isMobile ? 9 : 10, color: theme.textMuted,
                  lineHeight: '1', transform: 'translateY(-5px)'
                }}>
                  {formatHour(hour)}
                </div>
                {/* Location icon — clickable for override */}
                <div
                  style={{
                    position: 'absolute', top: -1, left: GUTTER_W - 18, width: 16, height: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: isMobile ? 10 : 11,
                    borderRadius: '50%', background: locBgTint(locId, '25'),
                    cursor: onHourLocationOverride ? 'pointer' : 'default',
                    pointerEvents: onHourLocationOverride ? 'auto' : 'none',
                    transform: 'translateY(-3px)',
                    opacity: 0.85
                  }}
                  title={locId ? locId + ' — click to change' : 'Set location'}
                  onClick={onHourLocationOverride && locations ? function (e) {
                    e.stopPropagation();
                    setLocMenuHour(locMenuHour === hour ? null : hour);
                  } : undefined}
                >
                  {locIconStr || '\u00B7'}
                </div>
                {/* Hourly weather indicator */}
                {dvHw && (function () {
                  var unit = (schedCfg && schedCfg.temperatureUnit) || 'F';
                  return (
                    <div style={{
                      position: 'absolute', top: 10, left: 0, width: GUTTER_W,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
                      fontSize: 8, color: theme.textMuted, opacity: 0.8,
                      lineHeight: 1.2, userSelect: 'none', pointerEvents: 'none'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <img src={weatherIconUrl(dvHw.code)} alt="" width={10} height={10} style={{ verticalAlign: 'middle', display: 'inline-block' }} />
                        <span>{Math.round(dvHw.temp)}°{unit}</span>
                      </div>
                    </div>
                  );
                })()}
                {/* Precip bar — thin strip at gutter right edge */}
                {dvHw && dvHw.precipProb >= 5 && (function() {
                  var code = dvHw.code || 0;
                  var color = (code >= 66 && code <= 67) ? '#9b59b6' : (code >= 71 && code <= 86) ? '#c8d8f0' : '#1e90ff';
                  return (
                    <div style={{
                      position: 'absolute', top: 0, left: GUTTER_W, width: 3,
                      height: hourHeight, opacity: dvHw.precipProb / 100,
                      background: color, pointerEvents: 'none', zIndex: 3
                    }} />
                  );
                })()}
                {/* Location override menu — portal to body so it's above task tiles */}
                {locMenuHour === hour && onHourLocationOverride && locations && (function () {
                  var gridEl = scrollRef.current && scrollRef.current.querySelector('[data-grid-area]');
                  if (!gridEl) return null;
                  var gridRect = gridEl.getBoundingClientRect();
                  var menuTop = gridRect.top + (i * hourHeight) - 4;
                  var menuLeft = gridRect.left + (isMobile ? 4 : 12) + GUTTER_W + 2;
                  return ReactDOM.createPortal(
                    <div style={{
                      position: 'fixed', left: menuLeft, top: menuTop, zIndex: 10000,
                      pointerEvents: 'auto',
                      background: theme.bgCard,
                      border: '1px solid ' + theme.border,
                      borderRadius: 2, padding: 4,
                      boxShadow: '0 4px 12px ' + theme.shadow,
                      display: 'flex', flexDirection: 'column', gap: 2,
                      whiteSpace: 'nowrap'
                    }}>
                      {locations.map(function (loc) {
                        var isActive = loc.id === locId;
                        var tint = LOC_TINT[loc.id] || '#4338CA';
                        return (
                          <button key={loc.id}
                            onClick={function (ev) {
                              ev.stopPropagation();
                              onHourLocationOverride(selectedDateKey, hour, loc.id);
                              setLocMenuHour(null);
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '3px 8px', borderRadius: 2, cursor: 'pointer',
                              fontSize: 11, fontFamily: 'inherit', fontWeight: isActive ? 600 : 400,
                              background: isActive ? locBgTint(loc.id, '20') : 'transparent',
                              color: isActive ? tint : theme.text,
                              border: isActive ? ('2px solid ' + tint) : '1px solid transparent',
                              textAlign: 'left'
                            }}
                          >
                            {locIcon(loc.id)} {loc.name}
                          </button>
                        );
                      })}
                    </div>,
                    document.body
                  );
                })()}
              </div>
            ];

            // Sub-hour lines
            if (subDiv > 1) {
              for (var s = 1; s < subDiv; s++) {
                var subY = y + (s / subDiv) * hourHeight;
                var subMin = s * (60 / subDiv);
                lines.push(
                  <div key={hour + '-' + s} style={{ position: 'absolute', top: subY, left: 0, right: 0, pointerEvents: 'none' }}>
                    {subDiv <= 2 && (
                      <div style={{
                        position: 'absolute', top: 0, left: 0, width: GUTTER_W - 20,
                        textAlign: 'right', paddingRight: 4,
                        fontSize: isMobile ? 8 : 9, color: theme.textMuted + '80',
                        lineHeight: '1', transform: 'translateY(-4px)'
                      }}>
                        :{String(subMin).padStart(2, '0')}
                      </div>
                    )}
                    <div style={{
                      position: 'absolute', top: 0, left: GUTTER_W, right: 0,
                      borderTop: '1px dashed ' + theme.gridLineSub, height: 0
                    }} />
                  </div>
                );
              }
            }
            return lines;
          })}

          {/* Drop indicator line */}
          {dragOverY != null && (
            <div style={{
              position: 'absolute', top: dragOverY, left: GUTTER_W, right: 0,
              height: 2, background: theme.accent, zIndex: 35, borderRadius: 1,
              pointerEvents: 'none'
            }}>
              <div style={{
                position: 'absolute', left: -4, top: -3, width: 8, height: 8,
                background: theme.accent, borderRadius: '50%'
              }} />
              <div style={{
                position: 'absolute', left: 12, top: -8, fontSize: 9,
                color: theme.accent, fontWeight: 600, background: theme.bg,
                padding: '0 4px', borderRadius: 3
              }}>
                {minsToTime(GRID_START * 60 + (dragOverY / hourHeight) * 60)}
              </div>
            </div>
          )}

          {/* Now marker */}
          {nowY != null && nowY >= 0 && nowY <= gridHeight && (
            <div style={{
              position: 'absolute', top: nowY, left: GUTTER_W, right: 0,
              height: 2, background: theme.redText, zIndex: 30, borderRadius: 1
            }}>
              <div style={{
                position: 'absolute', left: -4, top: -3, width: 8, height: 8,
                background: theme.redText, borderRadius: '50%'
              }} />
            </div>
          )}

          {/* Task blocks */}
          {computeColumns(allScheduled, hourHeight).map(function (layout) {
            var taskId = layout.p.task.id;
            return (
              <TaskBlock
                key={taskId + (layout.p.splitPart || '')}
                item={layout.p}
                status={statuses[taskId] || ''}
                top={layout.top}
                height={layout.height}
                col={layout.col}
                totalCols={layout.totalCols}
                onExpand={onExpand}
                onStatusChange={onStatusChange ? function (val) { onStatusChange(taskId, val); } : null}
                onDelete={onDelete}
                theme={theme}
                darkMode={darkMode}
                isMobile={isMobile}
                isBlocked={blockedTaskIds && blockedTaskIds.has(taskId)}
                canDrag={canDrag}
                gutterW={GUTTER_W}
                hourHeight={hourHeight}
                weatherDay={weatherByDate && weatherByDate[selectedDateKey]}
              />
            );
          })}

          {/* Ghost blocks — unscheduled tasks shown at their intended desiredAt time */}
          {ghostPlacements.map(function (gp) {
            var gTop = ((gp.start - GRID_START * 60) / 60) * hourHeight;
            var gHeight = Math.max((gp.dur / 60) * hourHeight, MIN_BLOCK_H);
            return (
              <GhostBlock
                key={'ghost-' + gp.task.id}
                task={gp.task}
                top={gTop}
                height={gHeight}
                startMins={gp.start}
                gutterW={GUTTER_W}
                onExpand={onExpand}
                theme={theme}
                isMobile={isMobile}
              />
            );
          })}
        </div>

        {/* Unscheduled tasks */}
        {unscheduled.length > 0 && (
          <div style={{ padding: isMobile ? '8px 4px' : '8px 12px', borderTop: '1px solid ' + theme.border }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: theme.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Unscheduled
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {unscheduled.map(function (t) {
                return (
                  <UnschedEntry
                    key={t.id}
                    task={t}
                    status={statuses[t.id] || ''}
                    onExpand={onExpand}
                    onStatusChange={onStatusChange ? function (val) { onStatusChange(t.id, val); } : null}
                    onDelete={onDelete}
                    theme={theme}
                    darkMode={darkMode}
                    isMobile={isMobile}
                    canDrag={canDrag}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
      {/* Weather hover popup — portal so it's never clipped */}
      {dvHoveredHour !== null && dvHoveredPos && hourlyByHour[dvHoveredHour] && ReactDOM.createPortal((function() {
        var hw = hourlyByHour[dvHoveredHour];
        var unit = (schedCfg && schedCfg.temperatureUnit) || 'F';
        var popW = 150;
        var putRight = dvHoveredPos.x + 14 + popW < window.innerWidth;
        var popLeft = putRight ? dvHoveredPos.x + 14 : dvHoveredPos.x - 14 - popW;
        var popTop = Math.min(dvHoveredPos.y - 10, window.innerHeight - 220);
        return (
          <div style={{ position: 'fixed', top: popTop, left: popLeft, zIndex: 9999, background: theme.bgCard, border: '1px solid ' + theme.border, borderRadius: 6, padding: '8px 10px', width: popW, textAlign: 'left', boxShadow: '0 4px 16px rgba(0,0,0,0.3)', pointerEvents: 'none', fontSize: 10, color: theme.text, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, marginBottom: 2, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><img src={weatherIconUrl(hw.code)} alt="" width={14} height={14} style={{ verticalAlign: 'middle' }} />{weatherCodeLabel(hw.code)}</div>
            {hw.temp != null && <div>🌡 {Math.round(hw.temp)}°{unit}</div>}
            {hw.precipProb > 0 && <div>🌧 {hw.precipProb}% precip</div>}
            {hw.cloudcover != null && <div>☁ {hw.cloudcover}% cloud</div>}
            {hw.humidity > 0 && <div>💧 {hw.humidity}% RH</div>}
          </div>
        );
      })(), document.body)}
    </div>
  );
}
