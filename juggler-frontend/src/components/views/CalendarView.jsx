/**
 * CalendarView — plain month calendar
 * Task entries show just the name; hover or tab-focus shows a detail popup card.
 */

import React, { useState, useMemo, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { getTheme } from '../../theme/colors';
import { DAY_NAMES, MONTH_NAMES, PRI_COLORS, STATUS_MAP, locIcon } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';

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

/* ── Popup card rendered via portal directly below/above anchor ── */
function FixedPopup({ anchorRect, item, status, theme, darkMode }) {
  var t = item.task;
  var priColor = PRI_COLORS[t.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';
  var statusObj = STATUS_MAP[status || ''];
  var locIcons = (t.location || []).map(function (l) { return locIcon(l); }).filter(Boolean);

  if (!anchorRect) return null;

  var viewW = window.innerWidth;
  var viewH = window.innerHeight;
  var popW = 240;
  var fitsBelow = anchorRect.bottom + 120 < viewH;

  var left = Math.min(anchorRect.left, viewW - popW - 8);
  left = Math.max(8, left);

  var posStyle = fitsBelow
    ? { top: anchorRect.bottom + 2 }
    : { bottom: viewH - anchorRect.top + 2 };

  var popup = (
    <div style={Object.assign({
      position: 'fixed', zIndex: 9999, left: left,
      background: darkMode ? '#1E293B' : '#FFF',
      border: '1px solid ' + theme.border,
      borderLeft: '3px solid ' + priColor,
      borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,' + (darkMode ? '0.5' : '0.18') + ')',
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
            background: darkMode ? '#1E3A5F' : '#DBEAFE',
            color: darkMode ? '#93C5FD' : '#1E40AF',
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
      {t.due && (
        <div style={{ marginTop: 2, fontSize: 10, color: darkMode ? '#FCD34D' : '#B45309' }}>
          Due {t.due}
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
    </div>
  );

  return ReactDOM.createPortal(popup, document.body);
}

/* ── Single task entry in a day cell ── */
function TaskEntry({ item, status, onExpand, onDragStart, theme, darkMode, isMobile }) {
  var t = item.task;
  var priColor = PRI_COLORS[t.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';
  var [show, setShow] = useState(false);
  var entryRef = useRef(null);
  var [anchorRect, setAnchorRect] = useState(null);

  var updateRect = useCallback(function () {
    if (entryRef.current) setAnchorRect(entryRef.current.getBoundingClientRect());
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={entryRef}
        tabIndex={0}
        role="button"
        draggable
        onDragStart={function (e) { e.stopPropagation(); onDragStart(e, t.id); }}
        onClick={function (e) { e.stopPropagation(); onExpand(t.id); }}
        onMouseEnter={function () { setShow(true); updateRect(); }}
        onMouseLeave={function () { setShow(false); }}
        onFocus={function () { setShow(true); updateRect(); }}
        onBlur={function () { setShow(false); }}
        onKeyDown={function (e) { if (e.key === 'Enter') { e.stopPropagation(); onExpand(t.id); } }}
        style={{
          fontSize: isMobile ? 9 : 10,
          padding: isMobile ? '1px 3px' : '2px 4px',
          borderRadius: 3,
          borderLeft: '3px solid ' + priColor,
          background: show ? priColor + '22' : priColor + '10',
          color: isDone ? theme.textMuted : theme.text,
          textDecoration: isDone ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          cursor: 'pointer', lineHeight: 1.4,
          outline: show ? '2px solid ' + theme.accent : 'none',
          outlineOffset: -1,
          transition: 'background 0.1s'
        }}
      >
        {t.text}
      </div>
      {show && <FixedPopup anchorRect={anchorRect} item={item} status={status} theme={theme} darkMode={darkMode} />}
    </div>
  );
}

/* ── Main CalendarView ── */
export default function CalendarView({
  selectedDate, dayPlacements, statuses, tasksByDate,
  onExpand, setDayOffset, today, darkMode, onDateDrop, isMobile
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
        return { task: t, start: pl ? pl.start : null, end: pl ? pl.end : null };
      }).sort(function (a, b) {
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

  var maxVisible = isMobile ? 3 : 5;
  var rows = [];
  for (var r = 0; r < cells.length; r += 7) rows.push(cells.slice(r, r + 7));

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 6 : 12, display: 'flex', flexDirection: 'column' }}>
      {/* Month header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 8 }}>
        <button onClick={function () { setMonthOffset(function (o) { return o - 1; }); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: theme.text, fontSize: 18, padding: '4px 8px', fontFamily: 'inherit' }}
          title="Previous month">&lsaquo;</button>
        <span style={{ fontSize: isMobile ? 16 : 18, fontWeight: 600, color: theme.text, minWidth: 140, textAlign: 'center' }}>
          {MONTH_NAMES[month]} {year}
        </span>
        <button onClick={function () { setMonthOffset(function (o) { return o + 1; }); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: theme.text, fontSize: 18, padding: '4px 8px', fontFamily: 'inherit' }}
          title="Next month">&rsaquo;</button>
        {monthOffset !== 0 && (
          <button onClick={function () { setMonthOffset(0); }}
            style={{ border: '1px solid ' + theme.border, borderRadius: 6, background: 'transparent', cursor: 'pointer', color: theme.textMuted, fontSize: 11, padding: '2px 8px', fontFamily: 'inherit' }}
            title="Back to current month">Today</button>
        )}
      </div>

      {/* Day-of-week header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {DAY_NAMES.map(function (dn, i) {
          return (
            <div key={dn} style={{
              textAlign: 'center', fontSize: isMobile ? 10 : 12, fontWeight: 600,
              color: (i === 0 || i === 6) ? theme.accent : theme.textMuted,
              padding: '4px 0'
            }}>{dn}</div>
          );
        })}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {rows.map(function (row, ri) {
          return (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, flex: 1, minHeight: isMobile ? 70 : 110 }}>
              {row.map(function (cell, ci) {
                var key = formatDateKey(cell.date);
                var isToday = key === todayKey;
                var items = dayData[key] || [];
                var doneCount = items.filter(function (it) { return (statuses[it.task.id] || '') === 'done'; }).length;

                return (
                  <div key={ci}
                    onClick={function () {
                      setDayOffset(Math.round((cell.date - today) / 86400000));
                      setMonthOffset(0);
                    }}
                    onDragOver={onDateDrop ? function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
                    onDrop={onDateDrop ? function (e) { e.stopPropagation(); onDateDrop(e, key); } : undefined}
                    style={{
                      border: '1px solid ' + (isToday ? theme.accent : theme.border),
                      borderRadius: 4, padding: isMobile ? 3 : 4,
                      cursor: 'pointer',
                      background: isToday ? theme.accent + '0C' : (!cell.inMonth ? (theme.bgTertiary || theme.bgSecondary) : theme.card),
                      opacity: cell.inMonth ? 1 : 0.5,
                      overflow: 'visible', position: 'relative',
                      display: 'flex', flexDirection: 'column'
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
                        lineHeight: 1
                      }}>
                        {cell.day === 1 && !isToday ? MONTH_NAMES[cell.date.getMonth()] + ' ' + cell.day : cell.day}
                      </span>
                      {items.length > 0 && (
                        <span style={{ fontSize: 9, color: theme.textMuted }}>{doneCount}/{items.length}</span>
                      )}
                    </div>

                    {/* Task entries */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, overflow: 'visible' }}>
                      {items.slice(0, maxVisible).map(function (it) {
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
                          />
                        );
                      })}
                      {items.length > maxVisible && (
                        <div style={{ fontSize: isMobile ? 8 : 9, color: theme.textMuted, paddingLeft: 4 }}>
                          +{items.length - maxVisible} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
