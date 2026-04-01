/**
 * DailyView — daily calendar with hour rows, reactive task cards,
 * drag-and-drop rescheduling, pinch/wheel zoom, and location-tinted rows.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { getTheme } from '../../theme/colors';
import { GRID_START, GRID_END, PRI_COLORS, STATUS_MAP, MONTH_NAMES, DAY_NAMES_FULL, DAY_NAMES, locIcon, LOC_TINT, locBgTint, DEFAULT_LOCATIONS } from '../../state/constants';
import { formatHour, formatDateKey } from '../../scheduler/dateHelpers';
import { getBlocksForDate } from '../../scheduler/timeBlockHelpers';
import { resolveLocationId, getLocationForDatePure } from '../../scheduler/locationHelpers';
import StatusToggle from '../schedule/StatusToggle';

var MIN_PX_PER_HOUR = 30;
var MAX_PX_PER_HOUR = 240;

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

/* ── Task nature → background tint ── */
function tileBg(task, darkMode, hover, theme) {
  // Reminder events — subtle purple/violet
  if (task.marker) {
    if (darkMode) return hover ? '#4338CA30' : '#4338CA1C';
    return hover ? '#EEF2FF20' : '#EEF2FF12';
  }
  // Fixed/rigid tasks — subtle amber/orange
  if (task.fixed || task.rigid || (task.when && task.when.indexOf('fixed') >= 0)) {
    if (darkMode) return hover ? '#9E6B3B30' : '#9E6B3B1C';
    return hover ? '#FEF3C720' : '#FEF3C712';
  }
  // Habits — subtle teal
  if (task.habit) {
    if (darkMode) return hover ? '#0D948830' : '#0D94881C';
    return hover ? '#CCFBF120' : '#CCFBF112';
  }
  // Default flexible — very subtle neutral
  return theme.bgCard;
}

/* ── Popup card rendered via portal ── */
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

  var posStyle = fitsBelow
    ? { top: anchorRect.bottom + 2 }
    : { bottom: viewH - anchorRect.top + 2 };

  var popup = (
    <div style={Object.assign({
      position: 'fixed', zIndex: 9999,
      left: left,
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
      {t.due && (
        <div style={{ marginTop: 2, fontSize: 10, color: theme.amberText }}>
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

/* ── Overlap layout: assign columns + enforce minimum block height ── */
var MIN_BLOCK_H = 22;
var BLOCK_GAP = 2;

function computeColumns(placements, hourHeight) {
  // Minimum visual duration in minutes — ensures MIN_BLOCK_H blocks
  // are treated as overlapping during clustering
  var minVisualMin = hourHeight > 0 ? (MIN_BLOCK_H / hourHeight) * 60 : 0;

  var items = placements.map(function (p) {
    var s = p.start;
    var e = p.end || s + (p.dur || (p.task ? p.task.dur || 30 : 30));
    var visualEnd = Math.max(e, s + minVisualMin);
    return { p: p, start: s, end: e, visualEnd: visualEnd };
  }).sort(function (a, b) { return a.start - b.start || a.end - b.end; });

  var clusters = [];
  var cur = null;
  for (var i = 0; i < items.length; i++) {
    if (!cur || items[i].start >= cur.end) {
      cur = { items: [items[i]], end: items[i].visualEnd };
      clusters.push(cur);
    } else {
      cur.items.push(items[i]);
      if (items[i].visualEnd > cur.end) cur.end = items[i].visualEnd;
    }
  }

  var result = [];
  clusters.forEach(function (cluster) {
    var cols = [];
    cluster.items.forEach(function (it) {
      var placed = false;
      for (var c = 0; c < cols.length; c++) {
        if (it.start >= cols[c]) {
          cols[c] = it.visualEnd;
          it.col = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        it.col = cols.length;
        cols.push(it.visualEnd);
      }
    });
    var totalCols = cols.length;

    var colBottoms = {};
    cluster.items.forEach(function (it) {
      var naturalTop = ((it.start - GRID_START * 60) / 60) * hourHeight;
      var naturalH = Math.max(((it.end - it.start) / 60) * hourHeight, MIN_BLOCK_H);
      var colKey = it.col;
      var top = naturalTop;
      if (colBottoms[colKey] != null && colBottoms[colKey] + BLOCK_GAP > top) {
        top = colBottoms[colKey] + BLOCK_GAP;
      }
      colBottoms[colKey] = top + naturalH;
      result.push({ p: it.p, top: top, height: naturalH, col: it.col, totalCols: totalCols });
    });
  });

  return result;
}

/* ── Reactive task block — shows more info as height increases ── */
function TaskBlock({ item, status, top, height, col, totalCols, onExpand, onStatusChange, theme, darkMode, isMobile, isBlocked, canDrag, gutterW, hourHeight }) {
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

  var gutterRight = 8;
  var colWidth = totalCols > 1 ? 'calc((100% - ' + gutterW + 'px - ' + gutterRight + 'px) / ' + totalCols + ')' : undefined;
  var colLeft = totalCols > 1
    ? 'calc(' + gutterW + 'px + ' + col + ' * (100% - ' + gutterW + 'px - ' + gutterRight + 'px) / ' + totalCols + ')'
    : gutterW;

  var locIcons = (t.location || []).map(function (l) { return locIcon(l); }).filter(Boolean);
  var isFixed = t.fixed || t.rigid || (t.when && t.when.indexOf('fixed') >= 0);
  var isMarker = !!t.marker;
  var isWhenRelaxed = !!item._whenRelaxed;

  // Reactive detail levels based on block pixel height
  var showTime = height >= 28;
  var showProjectDur = height >= 42;
  var showStatus = height >= 58;
  var showMeta = height >= 74;
  var showNotes = height >= 96;

  return (
    <div
      draggable={!!canDrag}
      onDragStart={canDrag ? function (e) { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      style={{
        position: 'absolute', top: top,
        left: colLeft, width: colWidth || undefined,
        right: totalCols > 1 ? undefined : gutterRight,
        height: Math.max(height, 18), zIndex: show ? 20 : 10
      }}
    >
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
          border: '1px ' + (isMarker ? 'dotted' : (t.habit ? 'dashed' : 'solid')) + ' ' + (isDone ? theme.border : (isMarker ? '#4338CA40' : priColor + '30')),
          borderLeftWidth: 3, borderLeftColor: isWhenRelaxed ? '#C8942A' : (isMarker ? '#4338CA' : priColor),
          borderRadius: 5,
          background: tileBg(t, darkMode, show, theme),
          padding: height >= 42 ? '3px 6px' : '2px 6px',
          cursor: canDrag ? 'grab' : 'pointer',
          overflow: 'hidden',
          outline: show ? '2px solid ' + theme.accent : 'none',
          outlineOffset: -1,
          boxShadow: '0 1px 3px ' + theme.shadow,
          transition: 'background 0.1s, box-shadow 0.1s',
          opacity: isDone ? 0.5 : (isMarker ? 0.65 : 1)
        }}
      >
        {/* Row 1: Always show title */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: isMobile ? 10 : 11, fontWeight: 600,
          color: isDone ? theme.textMuted : theme.text,
          textDecoration: isDone ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          lineHeight: 1.3
        }}>
          {isBlocked && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\uD83D\uDEAB'}</span>}
          {isMarker && <span style={{ fontSize: 9, flexShrink: 0, opacity: 0.7 }}>{'\u25C7'}</span>}
          {isFixed && !isMarker && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\uD83D\uDCCC'}</span>}
          {status === 'done' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2713'}</span>}
          {status === 'skip' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u23ED'}</span>}
          {status === 'cancel' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2717'}</span>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.text}</span>
        </div>

        {/* Row 2: Time + project + duration (height >= 28) */}
        {showTime && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, marginTop: 1,
            fontSize: 9, color: theme.textMuted, overflow: 'hidden'
          }}>
            {item.start != null && (
              <span style={{ flexShrink: 0 }}>{minsToTime(item.start)}{item.end != null ? '\u2013' + minsToTime(item.end) : ''}</span>
            )}
            {showProjectDur && t.project && (
              <span style={{
                fontSize: 8, fontWeight: 600, flexShrink: 0,
                background: theme.projectBadgeBg,
                color: theme.projectBadgeText,
                borderRadius: 3, padding: '0 4px'
              }}>
                {t.project}
              </span>
            )}
            {showProjectDur && t.dur > 0 && (
              <span style={{
                fontSize: 8, flexShrink: 0, fontWeight: 600,
                color: theme.badgeText,
                background: theme.badgeBg,
                borderRadius: 3, padding: '0 4px'
              }}>
                {durLabel(t.dur)}
              </span>
            )}
            {showProjectDur && t.pri && (
              <span style={{ fontSize: 8, fontWeight: 700, color: priColor, flexShrink: 0 }}>
                {t.pri}
              </span>
            )}
          </div>
        )}

        {/* Row 3: Status toggles + location + due (height >= 58) */}
        {showStatus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            {onStatusChange && (
              <span onClick={function (e) { e.stopPropagation(); }}>
                <StatusToggle value={status} onChange={onStatusChange} darkMode={darkMode} compact />
              </span>
            )}
            <div style={{ flex: 1 }} />
            {locIcons.length > 0 && <span style={{ fontSize: 9 }}>{locIcons.join(' ')}</span>}
            {t.due && (
              <span style={{
                fontSize: 8, fontWeight: 600,
                color: theme.amberText,
                background: theme.amberBg,
                borderRadius: 3, padding: '0 4px'
              }}>
                Due {t.due}
              </span>
            )}
          </div>
        )}

        {/* Row 4: Extra meta — habit, split, when (height >= 74) */}
        {showMeta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1, fontSize: 8, color: theme.textMuted, overflow: 'hidden' }}>
            {t.habit && <span>{'\uD83D\uDD01'} habit</span>}
            {item.splitPart && <span>Part {item.splitPart}/{item.splitTotal}</span>}
            {isWhenRelaxed && <span style={{ color: '#C8942A', fontWeight: 600 }}>{'~'} flexed</span>}
            {t.when && t.when !== 'anytime' && !isWhenRelaxed && <span>{t.when}</span>}
            {status === 'wip' && t.timeRemaining != null && (
              <span style={{ fontWeight: 700, color: theme.amberText }}>
                {t.timeRemaining}m left
              </span>
            )}
          </div>
        )}

        {/* Row 5: Notes snippet (height >= 96) */}
        {showNotes && t.notes && (
          <div style={{
            marginTop: 2, fontSize: 8, color: theme.textMuted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            borderTop: '1px solid ' + theme.border + '60', paddingTop: 2
          }}>
            {t.notes.length > 60 ? t.notes.slice(0, 60) + '...' : t.notes}
          </div>
        )}
      </div>
      {show && <FixedPopup anchorRect={anchorRect} item={item} status={status} theme={theme} darkMode={darkMode} />}
      {/* Travel buffer zones — hatched strips above/below the task card */}
      {item.travelBefore > 0 && hourHeight > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0,
          height: (item.travelBefore / 60) * hourHeight,
          background: 'repeating-linear-gradient(45deg, transparent, transparent 3px, ' + priColor + '18 3px, ' + priColor + '18 5px)',
          borderRadius: '4px 4px 0 0',
          borderLeft: '3px solid ' + priColor + '40',
          pointerEvents: 'none'
        }} />
      )}
      {item.travelAfter > 0 && hourHeight > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          height: (item.travelAfter / 60) * hourHeight,
          background: 'repeating-linear-gradient(45deg, transparent, transparent 3px, ' + priColor + '18 3px, ' + priColor + '18 5px)',
          borderRadius: '0 0 4px 4px',
          borderLeft: '3px solid ' + priColor + '40',
          pointerEvents: 'none'
        }} />
      )}
    </div>
  );
}

/* ── Unscheduled task entry ── */
function UnschedEntry({ task, status, onExpand, onStatusChange, theme, darkMode, isMobile, canDrag }) {
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';
  var [show, setShow] = useState(false);
  var ref = useRef(null);
  var [anchorRect, setAnchorRect] = useState(null);

  var updateRect = useCallback(function () {
    if (ref.current) setAnchorRect(ref.current.getBoundingClientRect());
  }, []);

  return (
    <div
      draggable={!!canDrag}
      onDragStart={canDrag ? function (e) { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
    >
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
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: isMobile ? 10 : 11, padding: '4px 6px', borderRadius: 4,
          borderLeft: '3px solid ' + priColor,
          background: tileBg(task, darkMode, show, theme),
          color: isDone ? theme.textMuted : theme.text,
          textDecoration: isDone ? 'line-through' : 'none',
          cursor: canDrag ? 'grab' : 'pointer',
          outline: show ? '2px solid ' + theme.accent : 'none',
          outlineOffset: -1, transition: 'background 0.1s',
          border: '1px ' + (task.habit ? 'dashed' : 'solid') + ' ' + (isDone ? theme.border : priColor + '30'),
          borderLeftWidth: 3, borderLeftColor: priColor,
          boxShadow: '0 1px 2px ' + theme.shadow,
          opacity: isDone ? 0.5 : 1
        }}
      >
        {(task.fixed || task.rigid) && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\uD83D\uDCCC'}</span>}
        {task.habit && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\uD83D\uDD01'}</span>}
        {status === 'done' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2713'}</span>}
        {status === 'skip' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u23ED'}</span>}
        {status === 'cancel' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2717'}</span>}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.text}</span>
        {task.dur > 0 && <span style={{ fontSize: 9, color: theme.textMuted, flexShrink: 0 }}>{durLabel(task.dur)}</span>}
        {task.pri && <span style={{ fontSize: 8, fontWeight: 700, color: priColor, flexShrink: 0 }}>{task.pri}</span>}
        {onStatusChange && (
          <span onClick={function (e) { e.stopPropagation(); }}>
            <StatusToggle value={status} onChange={onStatusChange} darkMode={darkMode} compact />
          </span>
        )}
      </div>
      {show && <FixedPopup anchorRect={anchorRect} item={{ task: task, start: null, end: null }} status={status} theme={theme} darkMode={darkMode} />}
    </div>
  );
}

/* ── Main DailyView ── */
export default function DailyView({
  selectedDate, selectedDateKey, placements, statuses, onStatusChange,
  onExpand, darkMode, schedCfg, nowMins, isToday, allTasks,
  filter, blockedTaskIds, unplacedIds, pastDueIds, fixedIds, isMobile,
  onUpdate, showToast, locations, onHourLocationOverride,
  locSchedules, onUpdateLocScheduleOverrides, onUpdateLocScheduleDefaults, onBatchHabitsDone
}) {
  var theme = getTheme(darkMode);
  var scrollRef = useRef(null);
  var loc = getLocationForDatePure(selectedDateKey, schedCfg);

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

  // Status filter
  var matchesFilter = useCallback(function (taskId) {
    if (!filter || filter === 'all') return true;
    var st = statuses[taskId] || '';
    if (filter === 'open') return st !== 'done' && st !== 'cancel' && st !== 'skip';
    if (filter === 'action') return st === '' || st === 'wip';
    if (filter === 'done') return st === 'done';
    if (filter === 'wip') return st === 'wip';
    if (filter === 'pastdue') return pastDueIds && pastDueIds.has(taskId);
    if (filter === 'fixed') return fixedIds && fixedIds.has(taskId);
    if (filter === 'blocked') return blockedTaskIds && blockedTaskIds.has(taskId);
    if (filter === 'unplaced') return unplacedIds && unplacedIds.has(taskId);
    return true;
  }, [filter, statuses, blockedTaskIds, unplacedIds, pastDueIds, fixedIds]);

  var allScheduled = useMemo(function () {
    return (placements || []).filter(function (p) {
      if (p.start == null) return false;
      var st = statuses[p.task.id] || '';
      // Only hide done/cancelled/skipped when filter is not 'all'
      if ((st === 'done' || st === 'cancel' || st === 'skip') && filter !== 'all' && filter !== 'done' && filter !== st) return false;
      return matchesFilter(p.task.id);
    }).sort(function (a, b) { return a.start - b.start; });
  }, [placements, statuses, matchesFilter, filter]);

  // Separate reminder events from regular tasks — reminders don't participate in column layout
  var scheduled = useMemo(function () {
    return allScheduled.filter(function (p) { return !p.task.marker; });
  }, [allScheduled]);
  var markers = useMemo(function () {
    return allScheduled.filter(function (p) { return !!p.task.marker; });
  }, [allScheduled]);

  var unscheduled = useMemo(function () {
    var scheduledIds = {};
    (placements || []).forEach(function (p) { scheduledIds[p.task.id] = true; });
    // Also mark source templates as "scheduled" if any of their instances are placed
    (placements || []).forEach(function (p) {
      if (p.task && p.task.sourceId) scheduledIds[p.task.sourceId] = true;
    });
    return (allTasks || []).filter(function (t) {
      if (t.date !== selectedDateKey || scheduledIds[t.id]) return false;
      // Hide habit templates and generated instances — only the scheduler places these
      if (t.taskType === 'habit_template' || t.generated) return false;
      // Only hide done/cancelled/skipped when filter is not 'all'
      var st = statuses[t.id] || '';
      if ((st === 'done' || st === 'cancel' || st === 'skip') && filter !== 'all' && filter !== 'done' && filter !== st) return false;
      return matchesFilter(t.id);
    });
  }, [allTasks, selectedDateKey, placements, statuses, matchesFilter]);

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
        {/* Progress */}
        {(function () {
          var dayTasks = allScheduled.map(function (p) { return p.task; });
          var total = dayTasks.filter(function (t) { var s = statuses[t.id] || ''; return s !== 'cancel' && s !== 'skip'; }).length;
          var done = dayTasks.filter(function (t) { return statuses[t.id] === 'done'; }).length;
          var doneDur = dayTasks.filter(function (t) { return statuses[t.id] === 'done'; }).reduce(function (s, t) { return s + (t.dur || 0); }, 0);
          var totalDur = dayTasks.reduce(function (s, t) { return s + (t.dur || 0); }, 0);
          var pct = total > 0 ? Math.round(done / total * 100) : 0;
          return (
            <div title={done + ' of ' + total + ' tasks done (' + Math.round(doneDur / 60 * 10) / 10 + 'h / ' + Math.round(totalDur / 60 * 10) / 10 + 'h)'} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: theme.textMuted }}>
              <div style={{ width: 60, height: 5, background: theme.bgTertiary, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#2D6A4F' : '#2E4A7A', borderRadius: 3 }} />
              </div>
              <span>{done}/{total}</span>
              <span>({Math.round(doneDur / 60 * 10) / 10}h / {Math.round(totalDur / 60 * 10) / 10}h)</span>
            </div>
          );
        })()}
        {/* Batch mark habits done */}
        {onBatchHabitsDone && (function () {
          var habitTasks = (allTasks || []).filter(function (t) { return t.habit && t.date === selectedDateKey && (statuses[t.id] || '') !== 'done'; });
          return habitTasks.length > 0 ? (
            <button onClick={function () { onBatchHabitsDone(selectedDateKey); }}
              title={'Mark ' + habitTasks.length + ' habits done'}
              style={{
                border: '1px solid #2D6A4F', borderRadius: 8, padding: '2px 8px',
                background: '#2D6A4F15', color: '#2D6A4F', fontSize: 11,
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600
              }}>
              {'\u2713'}hab ({habitTasks.length})
            </button>
          ) : null;
        })()}
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
          onUpdate(taskId, fields);
          if (showToast) showToast('Moved to ' + newTime, 'success');
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
                height: hourHeight, borderBottom: '1px solid ' + theme.border,
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

            var lines = [
              <div key={hour} style={{ position: 'absolute', top: y, left: 0, right: 0, pointerEvents: 'none', zIndex: 2 }}>
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
                  title={locId ? locId + ' \u2014 click to change' : 'Set location'}
                  onClick={onHourLocationOverride && locations ? function (e) {
                    e.stopPropagation();
                    setLocMenuHour(locMenuHour === hour ? null : hour);
                  } : undefined}
                >
                  {locIconStr || '\u00B7'}
                </div>
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
                      borderTop: '1px dashed ' + theme.border + '50', height: 0
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
          {computeColumns(scheduled, hourHeight).map(function (layout) {
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
                theme={theme}
                darkMode={darkMode}
                isMobile={isMobile}
                isBlocked={blockedTaskIds && blockedTaskIds.has(taskId)}
                canDrag={canDrag}
                gutterW={GUTTER_W}
                hourHeight={hourHeight}
              />
            );
          })}

          {/* Reminder event overlays — rendered full-width, don't affect task column layout */}
          {markers.map(function (p) {
            var mTop = ((p.start - GRID_START * 60) / 60) * hourHeight;
            var mDur = p.end ? p.end - p.start : (p.task.dur || 30);
            var mHeight = Math.max((mDur / 60) * hourHeight, MIN_BLOCK_H);
            return (
              <TaskBlock
                key={'m-' + p.task.id}
                item={p}
                status={statuses[p.task.id] || ''}
                top={mTop}
                height={mHeight}
                col={0}
                totalCols={1}
                onExpand={onExpand}
                onStatusChange={onStatusChange ? function (val) { onStatusChange(p.task.id, val); } : null}
                theme={theme}
                darkMode={darkMode}
                isMobile={isMobile}
                isBlocked={false}
                canDrag={canDrag}
                gutterW={GUTTER_W}
                hourHeight={hourHeight}
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
    </div>
  );
}
