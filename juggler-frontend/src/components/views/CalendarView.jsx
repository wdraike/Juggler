/**
 * CalendarView — plain month calendar
 * Task entries show just the name; hover or tab-focus shows a detail popup card.
 */

import React, { useState, useMemo, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { getTheme } from '../../theme/colors';
import { DAY_NAMES, MONTH_NAMES, PRI_COLORS, STATUS_MAP, locIcon, PAST_OPACITY } from '../../state/constants';
import { isTerminalStatus } from '../../shared/task-status';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { isAllDayTask } from '../../utils/isAllDayTask';
import { isTaskOverdue } from '../../utils/overdue';

/* ── Main CalendarView ── */
import WeatherBadge from '../features/WeatherBadge';

function minsToTime(m) {
  var h = Math.floor(m / 60);
  var mm = m % 60;
  var ampm = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return h + (mm ? ':' + String(mm).padStart(2, '0') : '') + ampm;
}

function durLabel(dur) {
  if (!dur) return '';
  return dur >= 60 ? Math.round(dur / 60 * 10) / 10 + 'h' : dur + 'm';
}

// juggler-cal-history Plan E — past-fade + popup helpers (D-10/D-12).
function isTaskPast(item, todayKey) {
  var t = item && item.task;
  if (!t || !t.scheduledAt) return false;
  return formatDateKey(new Date(t.scheduledAt)) < todayKey;
}

function labelForStatus(s) {
  if (s === 'done') return 'Done at';
  if (s === 'skip') return 'Skipped at';
  if (s === 'cancel' || s === 'cancelled') return 'Cancelled at';
  if (s === 'pause') return 'Paused at';
  return 'Resolved at';
}

function formatCompletedAt(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
  var day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return time + ' ' + day;
}

function getStatusReason(t, status) {
  if (!t || !status) return null;

  switch (status) {
    case 'cancel':
      return t.cancelReason ? 'cancelled: ' + t.cancelReason : 'cancelled by user';
    case 'skip':
      return t.skipReason ? 'skipped: ' + t.skipReason : 'skipped for today';
    case 'pause':
      return t.pauseReason ? 'paused: ' + t.pauseReason : 'temporarily paused';
    default:
      return null; // 'done' doesn't typically have automatic reasons
  }
}

/* ── Popup card rendered via portal directly below/above anchor ── */
function FixedPopup({ mousePos, item, status, theme, darkMode, completedAt, statusReason }) {
  var t = item.task;
  var priColor = PRI_COLORS[t.pri] || PRI_COLORS.P3;
  var isDone = isTerminalStatus(status);
  var statusObj = STATUS_MAP[status || ''];
  var locIcons = (t.location || []).map(function (l) { return locIcon(l); }).filter(Boolean);

  if (!mousePos) return null;

  var viewW = window.innerWidth;
  var viewH = window.innerHeight;
  var popW = 240;

  var left = Math.max(8, Math.min(mousePos.x + 14, viewW - popW - 8));
  var posStyle = { top: Math.min(mousePos.y - 10, viewH - 220) };

  var popup = (
    <div style={Object.assign({
      position: 'fixed', zIndex: 9999, left: left,
      background: theme.bgCard,
      border: '1px solid ' + theme.border,
      borderLeft: '3px solid ' + priColor,
      borderRadius: 8,
      boxShadow: '0 8px 24px ' + theme.shadow,
      padding: '8px 10px',
      minWidth: 200, maxWidth: 280,
      pointerEvents: 'none',
      fontSize: 11, lineHeight: 1.4, color: theme.text
    }, posStyle)}>
      <div style={{
        fontWeight: 600, fontSize: 12, marginBottom: 4,
        textDecoration: isDone ? 'line-through' : 'none',
        color: isDone ? theme.textMuted : theme.text
      }}>
        {t.text}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {t.pri && (
          <span style={{ fontSize: 9, fontWeight: 700, color: priColor, background: priColor + '18', borderRadius: 3, padding: '0 4px' }}>
            {t.pri}
          </span>
        )}
        {statusObj && statusObj.value && (
          <span style={{
            fontSize: 9, fontWeight: 600, borderRadius: 3, padding: '0 5px',
            background: darkMode ? statusObj.bgDark : statusObj.bg,
            color: darkMode ? statusObj.colorDark : statusObj.color
          }}>
            {statusObj.label} {statusObj.value}
          </span>
        )}
        {t.project && (
          <span style={{
            fontSize: 9, fontWeight: 600,
            background: theme.projectBadgeBg,
            color: theme.projectBadgeText,
            borderRadius: 3, padding: '1px 5px'
          }}>
            {t.project}
          </span>
        )}
        {t.dur > 0 && (
          <span style={{ fontSize: 9, color: theme.textMuted }}>{durLabel(t.dur)}</span>
        )}
      </div>
      {item.start != null && (
        <div style={{ marginTop: 4, fontSize: 10, color: theme.textMuted }}>
          {minsToTime(item.start)}{item.end != null ? ' \u2013 ' + minsToTime(item.end) : ''}
        </div>
      )}
      {locIcons.length > 0 && (
        <div style={{ marginTop: 2, fontSize: 10 }}>
          {locIcons.join(' ')} <span style={{ color: theme.textMuted }}>{(t.location || []).join(', ')}</span>
        </div>
      )}
      {t.deadline && (
        <div style={{ marginTop: 2, fontSize: 10, color: theme.amberText }}>
          Deadline {t.deadline}
        </div>
      )}
      {t.notes && (
        <div style={{
          marginTop: 4, fontSize: 10, color: theme.textMuted,
          whiteSpace: 'pre-wrap', maxHeight: 48, overflow: 'hidden',
          borderTop: '1px solid ' + theme.border, paddingTop: 4
        }}>
          {t.notes.length > 120 ? t.notes.slice(0, 120) + '...' : t.notes}
        </div>
      )}
      {completedAt && isDone && (
        <div style={{ marginTop: 4, fontSize: 10, color: theme.textMuted, fontStyle: 'italic' }}>
          {labelForStatus(status)} {formatCompletedAt(completedAt)}
        </div>
      )}
      {statusReason && (
        <div style={{ marginTop: 2, fontSize: 10, color: theme.textMuted }}>
          {statusReason}
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(popup, document.body);
}

/* ── Single task entry in a day cell ── */
function TaskEntry({ item, status, onExpand, onDragStart, theme, darkMode, isMobile, todayKey }) {
  var t = item.task;
  var priColor = PRI_COLORS[t.pri] || PRI_COLORS.P3;
  var isDone = isTerminalStatus(status);
  var isMarker = !!t.marker;
  var isAllDay = isAllDayTask(t);
  var isMultiday = isAllDay && t.endDate && t.date && t.endDate !== t.date;
  var daySpan = isMultiday ? Math.round((new Date(t.endDate + 'T00:00:00') - new Date(t.date + 'T00:00:00')) / 86400000) + 1 : 0;
  var isWhenRelaxed = !!item._whenRelaxed;
  var isOverdue = isTaskOverdue(t, isDone);
  var borderColor = isOverdue ? theme.error : (isWhenRelaxed ? '#F59E0B' : (isMarker ? '#8B5CF6' : priColor));
  var [show, setShow] = useState(false);
  var entryRef = useRef(null);
  var [mousePos, setMousePos] = useState(null);

  // juggler-cal-history Plan E — past-fade on past terminal entries (D-10).
  var isPast = isTaskPast(item, todayKey);
  var fadeOpacity = (isDone && isPast) ? PAST_OPACITY : null;
  var statusReason = getStatusReason(t, status);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={entryRef}
        tabIndex={0}
        role="button"
        draggable
        onDragStart={function (e) { e.stopPropagation(); onDragStart(e, t.id); }}
        onClick={function (e) { e.stopPropagation(); onExpand(t.id); }}
        onMouseEnter={function(e) { setShow(true); setMousePos({ x: e.clientX, y: e.clientY }); }}
        onMouseMove={function(e) { if (show) setMousePos({ x: e.clientX, y: e.clientY }); }}
        onMouseLeave={function() { setShow(false); setMousePos(null); }}
        onFocus={function() { setShow(true); if (entryRef.current) { var r = entryRef.current.getBoundingClientRect(); setMousePos({ x: r.left + r.width/2, y: r.top }); } }}
        onBlur={function() { setShow(false); setMousePos(null); }}
        onKeyDown={function (e) { if (e.key === 'Enter') { e.stopPropagation(); onExpand(t.id); } }}
        style={{
          fontSize: isMobile ? 9 : 10,
          padding: isMobile ? '1px 3px' : '2px 4px',
          borderRadius: 3,
          borderLeft: '3px solid ' + borderColor,
          border: '1px ' + (isMarker ? 'dotted' : 'solid') + ' ' + borderColor + (isMarker ? '40' : '00'),
          borderLeftWidth: 3, borderLeftColor: borderColor,
          background: isAllDay ? (show ? '#C8942A' + '30' : '#C8942A' + '18') : (show ? borderColor + '22' : borderColor + '10'),
          color: isDone ? theme.textMuted : theme.text,
          textDecoration: isDone ? 'line-through' : 'none',
          whiteSpace: 'normal', overflow: 'hidden', wordBreak: 'break-word',
          cursor: 'pointer', lineHeight: 1.4,
          outline: show ? '2px solid ' + theme.accent : 'none',
          outlineOffset: -1,
          transition: 'background 0.1s',
          opacity: fadeOpacity != null ? fadeOpacity : (isMarker ? 0.65 : 1)
        }}
      >
        {isAllDay && <span style={{ fontSize: 8, marginRight: 1 }}>{'☀️'}</span>}
        {isMultiday && <span style={{ fontSize: 8, marginRight: 1, fontWeight: 600, color: '#C8942A' }}>{daySpan + 'd'}</span>}
        {isOverdue && <span style={{ fontSize: 8, color: theme.error, fontWeight: 700 }}>{'\u26A0'} </span>}
        {isWhenRelaxed && !isOverdue && <span style={{ fontSize: 8, color: '#F59E0B', fontWeight: 700 }}>{'~'} </span>}
        {isMarker && !isWhenRelaxed && !isOverdue && <span style={{ fontSize: 8, opacity: 0.7 }}>{'\u25C7'} </span>}{t.text}
      </div>
      {show && <FixedPopup mousePos={mousePos} item={item} status={status} theme={theme} darkMode={darkMode} completedAt={t.completedAt} statusReason={statusReason} />}
    </div>
  );
}

export default function CalendarView({
  selectedDate, dayPlacements, statuses, tasksByDate,
  onExpand, setDayOffset, setViewMode, today, darkMode, onDateDrop, isMobile, weatherByDate
}) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(today);

  var [monthOffset, setMonthOffset] = useState(0);
  var viewDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + monthOffset, 1);
  var year = viewDate.getFullYear();
  var month = viewDate.getMonth();

  var startDow = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();

  var cells = useMemo(function () {
    var result = [];
    var prevDays = new Date(year, month, 0).getDate();
    for (var i = startDow - 1; i >= 0; i--) {
      result.push({ day: prevDays - i, inMonth: false, date: new Date(year, month - 1, prevDays - i) });
    }
    for (var d = 1; d <= daysInMonth; d++) {
      result.push({ day: d, inMonth: true, date: new Date(year, month, d) });
    }
    var total = result.length <= 35 ? 35 : 42;
    for (var n = 1; result.length < total; n++) {
      result.push({ day: n, inMonth: false, date: new Date(year, month + 1, n) });
    }
    return result;
  }, [year, month, startDow, daysInMonth]);

  var dayData = useMemo(function () {
    var result = {};
    cells.forEach(function (c) {
      var key = formatDateKey(c.date);
      var tasks = tasksByDate[key] || [];
      var plMap = {};
      (dayPlacements[key] || []).forEach(function (p) { plMap[p.task.id] = p; });
      result[key] = tasks.map(function (t) {
        var pl = plMap[t.id];
        var item = { task: t, start: pl ? pl.start : null, end: pl ? pl.end : null };
        if (pl && pl._whenRelaxed) item._whenRelaxed = true;
        return item;
      }).sort(function (a, b) {
        var aAllDay = !!(a.task.isAllDay || a.task.placementMode === 'all_day' || a.task.placement_mode === 'all_day');
        var bAllDay = !!(b.task.isAllDay || b.task.placementMode === 'all_day' || b.task.placement_mode === 'all_day');
        if (aAllDay && !bAllDay) return -1;
        if (!aAllDay && bAllDay) return 1;
        if (a.start != null && b.start != null) return a.start - b.start;
        if (a.start != null) return -1;
        if (b.start != null) return 1;
        return 0;
      });
    });
    return result;
  }, [cells, tasksByDate, dayPlacements]);

  var handleDragStart = useCallback(function (e, taskId) {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  var rows = [];
  for (var r = 0; r < cells.length; r += 7) rows.push(cells.slice(r, r + 7));

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 6 : 12, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Month header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 8 }}>
        <button onClick={function () { setMonthOffset(function (o) { return o - 1; }); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: theme.text, fontSize: 18, padding: '4px 8px', fontFamily: 'inherit' }}
          title="Previous month" aria-label="Previous month">&lsaquo;</button>
        <h2 style={{
          fontSize: isMobile ? 16 : 18, fontWeight: 600, color: theme.text, minWidth: 140, textAlign: 'center', margin: 0
        }}>
          {MONTH_NAMES[month]} {year}
        </h2>
        <button onClick={function () { setMonthOffset(function (o) { return o + 1; }); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: theme.text, fontSize: 18, padding: '4px 8px', fontFamily: 'inherit' }}
          title="Next month" aria-label="Next month">&rsaquo;</button>
        {monthOffset !== 0 && (
          <button onClick={function () { setMonthOffset(0); setDayOffset(0); }}
            style={{ border: '1px solid ' + theme.border, borderRadius: 6, background: 'transparent', cursor: 'pointer', color: theme.textMuted, fontSize: 11, padding: '2px 8px', fontFamily: 'inherit' }}
            title="Back to today" aria-label="Back to today">Today</button>
        )}
      </div>

      {/* Calendar table — fixed layout forces equal column widths */}
      <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 1, flex: 1 }}>
        <caption style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}>
          {MONTH_NAMES[month]} {year} calendar
        </caption>
        <thead>
          <tr>
            {DAY_NAMES.map(function (dn, i) {
              return (
                <th key={dn} scope="col" style={{
                  textAlign: 'center', fontSize: isMobile ? 10 : 12, fontWeight: 600,
                  color: (i === 0 || i === 6) ? theme.accent : theme.textMuted,
                  padding: '4px 0'
                }}>{dn}</th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(function (row, ri) {
            return (
              <tr key={ri}>
                {row.map(function (cell, ci) {
                  var key = formatDateKey(cell.date);
                  var isToday = key === todayKey;
                  var items = dayData[key] || [];
                  var doneCount = items.filter(function (it) { return (statuses[it.task.id] || '') === 'done'; }).length;

                  return (
                    <td key={ci}
                      onClick={function () {
                        setDayOffset(Math.round((cell.date - today) / 86400000));
                        setMonthOffset(0);
                        if (setViewMode) setViewMode('daily');
                      }}
                      onDragOver={onDateDrop ? function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
                      onDrop={onDateDrop ? function (e) { e.stopPropagation(); onDateDrop(e, key); } : undefined}
                      style={{
                        border: '1px solid ' + (isToday ? theme.accent : theme.border),
                        borderRadius: 4, padding: isMobile ? 3 : 4,
                        cursor: 'pointer',
                        background: isToday ? theme.accent + '0C' : (!cell.inMonth ? (theme.bgTertiary || theme.bgSecondary) : theme.card),
                        opacity: cell.inMonth ? 1 : 0.5,
                        verticalAlign: 'top',
                        height: isMobile ? 70 : 110,
                        overflow: 'hidden', position: 'relative'
                      }}>
                      {/* Day number */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{
                          fontSize: isMobile ? 11 : 13,
                          fontWeight: isToday ? 700 : (cell.day === 1 ? 600 : 400),
                          background: isToday ? theme.accent : 'transparent',
                          color: isToday ? '#FFF' : (!cell.inMonth ? theme.textMuted : theme.text),
                          borderRadius: '50%',
                          width: isMobile ? 20 : 24, height: isMobile ? 20 : 24,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          lineHeight: 1, flexShrink: 0
                        }}>
                          {cell.day === 1 && !isToday ? MONTH_NAMES[cell.date.getMonth()] + ' ' + cell.day : cell.day}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          {weatherByDate && weatherByDate[key] && cell.inMonth && <WeatherBadge weatherDay={weatherByDate[key]} compact darkMode={darkMode} />}
                          {items.length > 0 && (
                            <span style={{ fontSize: 9, color: theme.textMuted, flexShrink: 0 }}>{doneCount}/{items.length}</span>
                          )}
                        </span>
                      </div>

                      {/* Task entries — scrollable within the day cell */}
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: 1,
                        overflowY: 'auto', overflowX: 'hidden',
                        maxHeight: isMobile ? 44 : 80,
                        minWidth: 0
                      }}>
                        {items.map(function (it) {
                          return (
                            <TaskEntry
                              key={it.task.id}
                              item={it}
                              status={statuses[it.task.id] || ''}
                              onExpand={onExpand}
                              onDragStart={handleDragStart}
                              theme={theme}
                              darkMode={darkMode}
                              isMobile={isMobile}
                              todayKey={todayKey}
                            />
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
