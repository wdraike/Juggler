/**
 * DailyView — plain daily calendar with hour rows
 * Task entries show just the name; hover or tab-focus shows a detail popup card.
 * Zoom control scales from 15-min to 1-hour increments.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { getTheme } from '../../theme/colors';
import { GRID_START, GRID_END, PRI_COLORS, STATUS_MAP, MONTH_NAMES, DAY_NAMES_FULL, locIcon } from '../../state/constants';
import { formatHour, formatDateKey } from '../../scheduler/dateHelpers';
import { getBlocksForDate } from '../../scheduler/timeBlockHelpers';

var ZOOM_LEVELS = [
  { label: '15m', pxPerHour: 200 },
  { label: '30m', pxPerHour: 120 },
  { label: '1h',  pxPerHour: 60 },
];

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

/* ── Popup card rendered via portal, positioned at a given rect ── */
function FixedPopup({ anchorRect, item, status, theme, darkMode }) {
  var t = item.task || item;
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

  // Use top when below, bottom when above — so popup hugs the anchor
  var posStyle = fitsBelow
    ? { top: anchorRect.bottom + 2 }
    : { bottom: viewH - anchorRect.top + 2 };

  var popup = (
    <div style={Object.assign({
      position: 'fixed', zIndex: 9999,
      left: left,
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

/* ── Overlap layout: assign columns to overlapping tasks ── */
function computeColumns(placements, hourHeight) {
  // Each item gets { start, end, top, height, col, totalCols }
  var items = placements.map(function (p) {
    var s = p.start;
    var e = p.end || s + (p.task ? p.task.dur || 30 : 30);
    return { p: p, start: s, end: e };
  }).sort(function (a, b) { return a.start - b.start || a.end - b.end; });

  // Group into clusters of overlapping items
  var clusters = [];
  var cur = null;
  for (var i = 0; i < items.length; i++) {
    if (!cur || items[i].start >= cur.end) {
      cur = { items: [items[i]], end: items[i].end };
      clusters.push(cur);
    } else {
      cur.items.push(items[i]);
      if (items[i].end > cur.end) cur.end = items[i].end;
    }
  }

  var result = [];
  clusters.forEach(function (cluster) {
    // Greedy column assignment within the cluster
    var cols = []; // cols[c] = end time of last item in that column
    cluster.items.forEach(function (it) {
      var placed = false;
      for (var c = 0; c < cols.length; c++) {
        if (it.start >= cols[c]) {
          cols[c] = it.end;
          it.col = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        it.col = cols.length;
        cols.push(it.end);
      }
    });
    var totalCols = cols.length;
    cluster.items.forEach(function (it) {
      var top = ((it.start - GRID_START * 60) / 60) * hourHeight;
      var h = ((it.end - it.start) / 60) * hourHeight;
      result.push({ p: it.p, top: top, height: h, col: it.col, totalCols: totalCols });
    });
  });

  return result;
}

/* ── Single task block on the hour grid ── */
function TaskBlock({ item, status, top, height, col, totalCols, onExpand, theme, darkMode, isMobile }) {
  var t = item.task || item;
  var priColor = PRI_COLORS[t.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';
  var [show, setShow] = useState(false);
  var innerRef = useRef(null);
  var [anchorRect, setAnchorRect] = useState(null);

  var updateRect = useCallback(function () {
    if (innerRef.current) setAnchorRect(innerRef.current.getBoundingClientRect());
  }, []);

  function onEnter() { setShow(true); updateRect(); }
  function onLeave() { setShow(false); }
  function onFocusIn() { setShow(true); updateRect(); }
  function onFocusOut() { setShow(false); }

  var gutterLeft = isMobile ? 56 : 64;
  var gutterRight = 8;
  // Compute column-based left/width
  var colWidth = totalCols > 1 ? 'calc((100% - ' + gutterLeft + 'px - ' + gutterRight + 'px) / ' + totalCols + ')' : undefined;
  var colLeft = totalCols > 1
    ? 'calc(' + gutterLeft + 'px + ' + col + ' * (100% - ' + gutterLeft + 'px - ' + gutterRight + 'px) / ' + totalCols + ')'
    : gutterLeft;

  return (
    <div style={{
      position: 'absolute', top: top,
      left: colLeft, width: colWidth || undefined,
      right: totalCols > 1 ? undefined : gutterRight,
      height: Math.max(height, 18), zIndex: show ? 20 : 10
    }}>
      <div
        ref={innerRef}
        tabIndex={0}
        role="button"
        onClick={function (e) { e.stopPropagation(); onExpand(t.id); }}
        onMouseEnter={onEnter} onMouseLeave={onLeave}
        onFocus={onFocusIn} onBlur={onFocusOut}
        onKeyDown={function (e) { if (e.key === 'Enter') { e.stopPropagation(); onExpand(t.id); } }}
        style={{
          height: '100%', boxSizing: 'border-box',
          borderLeft: '3px solid ' + priColor,
          borderRadius: 4,
          background: show ? priColor + '28' : priColor + '18',
          padding: '2px 6px',
          cursor: 'pointer', overflow: 'hidden',
          outline: show ? '2px solid ' + theme.accent : 'none',
          outlineOffset: -1,
          transition: 'background 0.1s',
          opacity: isDone ? 0.5 : 1
        }}
      >
        <div style={{
          fontSize: isMobile ? 10 : 11, fontWeight: 500,
          color: isDone ? theme.textMuted : theme.text,
          textDecoration: isDone ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          lineHeight: 1.3
        }}>
          {t.text}
        </div>
        {height >= 32 && (
          <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 1 }}>
            {item.start != null ? minsToTime(item.start) : ''}{item.end != null ? ' \u2013 ' + minsToTime(item.end) : ''}
            {t.project ? '  \u00B7 ' + t.project : ''}
          </div>
        )}
      </div>
      {show && <FixedPopup anchorRect={anchorRect} item={item} status={status} theme={theme} darkMode={darkMode} />}
    </div>
  );
}

/* ── Unscheduled task entry ── */
function UnschedEntry({ task, status, onExpand, theme, darkMode, isMobile }) {
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';
  var [show, setShow] = useState(false);
  var ref = useRef(null);
  var [anchorRect, setAnchorRect] = useState(null);

  var updateRect = useCallback(function () {
    if (ref.current) setAnchorRect(ref.current.getBoundingClientRect());
  }, []);

  return (
    <div>
      <div
        ref={ref}
        tabIndex={0} role="button"
        onClick={function () { onExpand(task.id); }}
        onMouseEnter={function () { setShow(true); updateRect(); }}
        onMouseLeave={function () { setShow(false); }}
        onFocus={function () { setShow(true); updateRect(); }}
        onBlur={function () { setShow(false); }}
        onKeyDown={function (e) { if (e.key === 'Enter') onExpand(task.id); }}
        style={{
          fontSize: isMobile ? 10 : 11, padding: '3px 6px', borderRadius: 4,
          borderLeft: '3px solid ' + priColor,
          background: show ? priColor + '22' : priColor + '10',
          color: isDone ? theme.textMuted : theme.text,
          textDecoration: isDone ? 'line-through' : 'none',
          cursor: 'pointer', outline: show ? '2px solid ' + theme.accent : 'none',
          outlineOffset: -1, transition: 'background 0.1s'
        }}
      >
        {task.text}
      </div>
      {show && <FixedPopup anchorRect={anchorRect} item={{ task: task, start: null, end: null }} status={status} theme={theme} darkMode={darkMode} />}
    </div>
  );
}

/* ── Main DailyView ── */
export default function DailyView({
  selectedDate, selectedDateKey, placements, statuses,
  onExpand, darkMode, schedCfg, nowMins, isToday, allTasks, isMobile
}) {
  var theme = getTheme(darkMode);
  var scrollRef = useRef(null);

  // Zoom state — index into ZOOM_LEVELS, persisted
  var [zoomIdx, setZoomIdx] = useState(function () {
    var saved = parseInt(localStorage.getItem('juggler-daily-zoom'), 10);
    return saved >= 0 && saved < ZOOM_LEVELS.length ? saved : 2;
  });
  var setZoomIdxPersist = useCallback(function (i) {
    setZoomIdx(i);
    try { localStorage.setItem('juggler-daily-zoom', String(i)); } catch (e) {}
  }, []);
  var hourHeight = ZOOM_LEVELS[zoomIdx].pxPerHour;
  var totalHours = GRID_END - GRID_START + 1;
  var gridHeight = totalHours * hourHeight;

  // Sub-hour gridlines
  var subDiv = zoomIdx === 0 ? 4 : zoomIdx === 1 ? 2 : 1;

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

  var scheduled = useMemo(function () {
    return (placements || []).filter(function (p) { return p.start != null; }).sort(function (a, b) { return a.start - b.start; });
  }, [placements]);

  var unscheduled = useMemo(function () {
    var scheduledIds = {};
    (placements || []).forEach(function (p) { scheduledIds[p.task.id] = true; });
    return (allTasks || []).filter(function (t) {
      return t.date === selectedDateKey && !scheduledIds[t.id];
    });
  }, [allTasks, selectedDateKey, placements]);

  var nowY = isToday ? ((nowMins - GRID_START * 60) / 60) * hourHeight : null;

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
        {/* Progress */}
        {(function () {
          var total = scheduled.filter(function (p) { var s = statuses[p.task.id] || ''; return s !== 'cancel' && s !== 'skip'; }).length;
          var done = scheduled.filter(function (p) { return statuses[p.task.id] === 'done'; }).length;
          var pct = total > 0 ? Math.round(done / total * 100) : 0;
          if (total === 0) return null;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: theme.textMuted }}>
              <div style={{ width: 60, height: 5, background: theme.bgTertiary, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#10B981' : '#3B82F6', borderRadius: 3 }} />
              </div>
              <span>{done}/{total}</span>
            </div>
          );
        })()}
        <div style={{ flex: 1 }} />
        {/* Zoom control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {ZOOM_LEVELS.map(function (z, i) {
            var active = i === zoomIdx;
            return (
              <button key={z.label}
                onClick={function () { setZoomIdxPersist(i); }}
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

      {/* Scrollable hour grid */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
        <div style={{ position: 'relative', height: gridHeight, margin: isMobile ? '0 4px' : '0 12px' }}>

          {/* Time block background shading */}
          {blocks.map(function (b, i) {
            var top = ((b.start - GRID_START * 60) / 60) * hourHeight;
            var h = ((b.end - b.start) / 60) * hourHeight;
            if (top < 0 || top >= gridHeight) return null;
            return (
              <div key={i} style={{
                position: 'absolute', top: top, left: 0, right: 0, height: h,
                background: (b.color || '#8B5CF6') + '08',
                borderLeft: '2px solid ' + (b.color || '#8B5CF6') + '30',
                pointerEvents: 'none', zIndex: 0
              }} />
            );
          })}

          {/* Hour + sub-hour lines and labels */}
          {Array.from({ length: totalHours }, function (_, i) {
            var hour = GRID_START + i;
            var y = i * hourHeight;
            var lines = [
              <div key={hour} style={{ position: 'absolute', top: y, left: 0, right: 0 }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, width: isMobile ? 48 : 56,
                  textAlign: 'right', paddingRight: 8,
                  fontSize: isMobile ? 9 : 10, color: theme.textMuted,
                  lineHeight: '1', transform: 'translateY(-5px)'
                }}>
                  {formatHour(hour)}
                </div>
                <div style={{
                  position: 'absolute', top: 0, left: isMobile ? 52 : 60, right: 0,
                  borderTop: '1px solid ' + theme.border + '80', height: 0
                }} />
              </div>
            ];
            // Sub-hour lines
            if (subDiv > 1) {
              for (var s = 1; s < subDiv; s++) {
                var subY = y + (s / subDiv) * hourHeight;
                var subMin = s * (60 / subDiv);
                lines.push(
                  <div key={hour + '-' + s} style={{ position: 'absolute', top: subY, left: 0, right: 0 }}>
                    {subDiv <= 2 && (
                      <div style={{
                        position: 'absolute', top: 0, left: 0, width: isMobile ? 48 : 56,
                        textAlign: 'right', paddingRight: 8,
                        fontSize: isMobile ? 8 : 9, color: theme.textMuted + '80',
                        lineHeight: '1', transform: 'translateY(-4px)'
                      }}>
                        :{String(subMin).padStart(2, '0')}
                      </div>
                    )}
                    <div style={{
                      position: 'absolute', top: 0, left: isMobile ? 52 : 60, right: 0,
                      borderTop: '1px dashed ' + theme.border + '50', height: 0
                    }} />
                  </div>
                );
              }
            }
            return lines;
          })}

          {/* Now marker */}
          {nowY != null && nowY >= 0 && nowY <= gridHeight && (
            <div style={{
              position: 'absolute', top: nowY, left: isMobile ? 48 : 56, right: 0,
              height: 2, background: '#EF4444', zIndex: 30, borderRadius: 1
            }}>
              <div style={{
                position: 'absolute', left: -4, top: -3, width: 8, height: 8,
                background: '#EF4444', borderRadius: '50%'
              }} />
            </div>
          )}

          {/* Task blocks — staggered into columns when overlapping */}
          {computeColumns(scheduled, hourHeight).map(function (layout) {
            return (
              <TaskBlock
                key={layout.p.task.id}
                item={layout.p}
                status={statuses[layout.p.task.id] || ''}
                top={layout.top}
                height={layout.height}
                col={layout.col}
                totalCols={layout.totalCols}
                onExpand={onExpand}
                theme={theme}
                darkMode={darkMode}
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
                    theme={theme}
                    darkMode={darkMode}
                    isMobile={isMobile}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
