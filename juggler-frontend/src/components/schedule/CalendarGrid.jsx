/**
 * CalendarGrid — centered timeline with hour labels, fixed-height cards
 * staggered on both sides, SVG bezier connectors from markers to cards.
 *
 * Markers = duration-proportional on the timeline.
 * Cards = fixed height, distributed across up to 4 columns (2 per side)
 * so they never overlap and vertical space is used efficiently.
 *
 * On mobile: timeline strip pinned to left edge, all cards in a single
 * column on the right for maximum card width.
 */

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { GRID_START, GRID_END, GRID_HOURS_COUNT, PRI_COLORS, LOC_TINT, locBgTint, locIcon } from '../../state/constants';
import { formatHour } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';
import { resolveLocationId } from '../../scheduler/locationHelpers';
import { getBlocksForDate } from '../../scheduler/timeBlockHelpers';
import ScheduleCard from './ScheduleCard';

// Dimensions
var STRIP_W = 44;       // center strip holding hour labels
var STRIP_W_M = 32;
var STRIP_W_COMPACT = 32;
var STRIP_W_MINI = 24;
var MARKER_W = 10;
var MARKER_W_M = 8;
var CARD_H = 68;        // fixed card height — title + status + details row
var CARD_H_M = 78;      // taller on mobile for wrapped titles
var CARD_H_COMPACT = 40;
var CARD_GAP = 4;
var CONN_ZONE = 36;     // space between marker and card for bezier connector
var CONN_ZONE_M = 24;
var CONN_ZONE_COMPACT = 14;

function getDims(mode, isMobile) {
  if (mode === 'mini') return { STRIP_W: STRIP_W_MINI, MARKER_W: isMobile ? 6 : 7, CARD_H: 0, CARD_GAP: 0, CONN: 0 };
  if (mode === 'compact') return { STRIP_W: STRIP_W_COMPACT, MARKER_W: isMobile ? MARKER_W_M : MARKER_W, CARD_H: CARD_H_COMPACT, CARD_GAP: isMobile ? 3 : CARD_GAP, CONN: CONN_ZONE_COMPACT };
  return { STRIP_W: isMobile ? STRIP_W_M : STRIP_W, MARKER_W: isMobile ? MARKER_W_M : MARKER_W, CARD_H: isMobile ? CARD_H_M : CARD_H, CARD_GAP: CARD_GAP, CONN: isMobile ? CONN_ZONE_M : CONN_ZONE };
}

// Multi-column stagger: cards distributed across colsPerSide columns on each
// side, picking whichever slot is closest to the ideal Y (centered on marker).
// rightOnly = true → all cards placed on the right side (mobile single-column)
function computeLayout(placements, hourHeight, cardH, gap, colsPerSide, rightOnly) {
  var nCols = colsPerSide || 1;
  var sorted = (placements || []).slice().sort(function(a, b) { return a.start - b.start; });
  var result = [];

  // Marker overlap lanes: tasks that share a time range get narrowed,
  // side-by-side markers so none are hidden behind each other.
  // Standard greedy algorithm: assign each item to the first free column;
  // within a cluster (transitively overlapping items) every item sees the
  // cluster's total column count.
  var markerLane = {};  // id → column index
  var markerCols = {};  // id → total columns in cluster
  (function() {
    var cluster = [];
    var clusterEnd = -Infinity;
    var colEnds = [];
    function flush() {
      var n = colEnds.length;
      for (var k = 0; k < cluster.length; k++) markerCols[cluster[k]] = n;
      cluster = [];
      colEnds = [];
    }
    for (var i = 0; i < sorted.length; i++) {
      var it = sorted[i];
      var id = it.key || (it.task && it.task.id) || i;
      var s = it.start;
      var e = it.start + (it.dur || 30);
      if (s >= clusterEnd) flush();
      var col = -1;
      for (var c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= s) { col = c; break; }
      }
      if (col === -1) { col = colEnds.length; colEnds.push(e); }
      else colEnds[col] = e;
      markerLane[id] = col;
      cluster.push(id);
      if (e > clusterEnd) clusterEnd = e;
    }
    flush();
  })();

  var sides = rightOnly ? ['right'] : ['left', 'right'];

  // Track bottom Y of each slot
  var bottoms = {};
  sides.forEach(function(side) {
    for (var c = 0; c < nCols; c++) {
      bottoms[side + '_' + c] = -Infinity;
    }
  });

  for (var i = 0; i < sorted.length; i++) {
    var item = sorted[i];
    var markerY = ((item.start - GRID_START * 60) / 60) * hourHeight;
    var durMin = item.dur || 30;
    var markerH = Math.max(4, (durMin / 60) * hourHeight);
    var markerMidY = markerY + markerH / 2;

    // ideal: center card on marker midpoint, but keep below top padding
    var topPad = Math.max(cardH * 0.5, 20);
    var idealY = Math.max(markerMidY - cardH / 2, topPad);

    // alternate left/right; single card or rightOnly → always right
    var bestSide = rightOnly ? 'right' : (sorted.length === 1 ? 'right' : sides[i % sides.length]);
    var bestCol = 0;
    var bestY = Math.max(idealY, bottoms[bestSide + '_' + bestCol] + gap);

    bottoms[bestSide + '_' + bestCol] = bestY + cardH;

    var itemId = item.key || (item.task && item.task.id) || i;
    result.push({
      item: item, side: bestSide, col: bestCol,
      markerY: markerY, markerH: markerH, markerMidY: markerMidY,
      markerLane: markerLane[itemId] || 0,
      markerCols: markerCols[itemId] || 1,
      cardY: bestY, cardMidY: bestY + cardH / 2
    });
  }
  return result;
}

export default function CalendarGrid({
  dateKey, placements, statuses, onStatusChange, onDelete, onExpand,
  gridZoom, darkMode, schedCfg, nowMins, isToday, onGridDrop, locations, onHourLocationOverride, blockedTaskIds,
  onZoomChange, isMobile, layoutMode, onMarkerDrag, weatherDay
}) {
  var mode = layoutMode || 'full';
  var dm = getDims(mode, isMobile);
  var theme = getTheme(darkMode);
  var baseHourHeight = gridZoom || 60;

  // On mobile, enforce a minimum zoom so taller cards have room to spread
  if (isMobile && mode !== 'mini' && baseHourHeight < 80) baseHourHeight = 80;

  // Mobile full-width mode: strip on left, all cards on right
  var mobileFullWidth = isMobile && mode === 'full';

  // measure container
  var elRef = useRef(null);
  var [cw, setCw] = useState(600);
  useEffect(function() {
    function m() { if (elRef.current) setCw(elRef.current.offsetWidth); }
    m();
    var ro = new ResizeObserver(m);
    if (elRef.current) ro.observe(elRef.current);
    return function() { ro.disconnect(); };
  }, []);

  // positions
  var stripX = mobileFullWidth ? 2 : Math.floor((cw - dm.STRIP_W) / 2);
  var stripMid = stripX + dm.STRIP_W / 2;

  // cards fill from connector edge to container edge
  var edgePad = isMobile ? 6 : 8;
  var leftCardLeft = edgePad;
  var leftCardRight = stripX - dm.MARKER_W - dm.CONN;
  var leftCardW = mobileFullWidth ? 0 : (leftCardRight - leftCardLeft);
  var rightCardLeft = stripX + dm.STRIP_W + dm.MARKER_W + dm.CONN;
  var rightCardW = cw - rightCardLeft - edgePad;

  // Single column per side — alternating left/right gives each side ~n/2 cards
  var colsPerSide = 1;
  var subColW_left = leftCardW;
  var subColW_right = rightCardW;
  var colGap = 0;

  var blocks = getBlocksForDate(dateKey, schedCfg.timeBlocks, schedCfg);
  var pinchRef = useRef({ startDist: 0, startZoom: 0 });
  var zoomRef = useRef(gridZoom); zoomRef.current = gridZoom;
  var onZoomRef = useRef(onZoomChange); onZoomRef.current = onZoomChange;

  // Layout computation with auto-scaling for mobile single-column.
  // When cards stack vertically and extend past the grid, increase hourHeight
  // so the timeline stretches and cards stay near their time markers.
  var layoutResult = useMemo(function() {
    if (mode === 'mini') return { items: [], hourHeight: baseHourHeight };

    var h = baseHourHeight;
    var result = computeLayout(placements, h, dm.CARD_H, dm.CARD_GAP, colsPerSide, mobileFullWidth);

    // Auto-scale: if cards overflow the grid, bump hourHeight so they fit
    if (mobileFullWidth && result.length > 1) {
      var maxBot = 0;
      for (var i = 0; i < result.length; i++) {
        var b = result[i].cardY + dm.CARD_H;
        if (b > maxBot) maxBot = b;
      }
      var gridH = GRID_HOURS_COUNT * h;
      if (maxBot > gridH) {
        // Scale up with a small buffer so cards aren't right at the edge
        h = Math.min(Math.ceil((maxBot + dm.CARD_H) / GRID_HOURS_COUNT), 180);
        result = computeLayout(placements, h, dm.CARD_H, dm.CARD_GAP, colsPerSide, mobileFullWidth);
      }
    }

    return { items: result, hourHeight: h };
  }, [placements, baseHourHeight, mode, dm.CARD_H, dm.CARD_GAP, colsPerSide, mobileFullWidth]);

  var layout = layoutResult.items;
  var hourHeight = layoutResult.hourHeight;

  var miniMarkers = useMemo(function() {
    if (mode !== 'mini') return [];
    return (placements || []).slice().sort(function(a, b) { return a.start - b.start; });
  }, [placements, mode]);

  var [expandedMiniId, setExpandedMiniId] = useState(null);
  var [locMenuHour, setLocMenuHour] = useState(null);

  // total height
  var gridH = GRID_HOURS_COUNT * hourHeight;
  var maxBot = 0;
  for (var i = 0; i < layout.length; i++) {
    var b = layout[i].cardY + dm.CARD_H;
    if (b > maxBot) maxBot = b;
  }
  var totalH = Math.max(gridH, maxBot + 8);

  // pinch/wheel zoom
  useEffect(function() {
    var el = elRef.current; if (!el) return;
    function ts(e) {
      if (e.touches.length === 2 && onZoomRef.current) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = { startDist: Math.hypot(dx, dy), startZoom: zoomRef.current || 60 };
      }
    }
    function tm(e) {
      if (e.touches.length === 2 && onZoomRef.current && pinchRef.current.startDist > 0) {
        e.preventDefault();
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        onZoomRef.current(Math.round(Math.min(180, Math.max(20, pinchRef.current.startZoom * Math.hypot(dx, dy) / pinchRef.current.startDist))));
      }
    }
    function te() { pinchRef.current.startDist = 0; }
    function wh(e) {
      if ((e.ctrlKey || e.metaKey) && onZoomRef.current) {
        e.preventDefault();
        onZoomRef.current(Math.round(Math.min(180, Math.max(20, (zoomRef.current || 60) + (e.deltaY > 0 ? -4 : 4)))));
      }
    }
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te, { passive: true });
    el.addEventListener('wheel', wh, { passive: false });
    return function() { el.removeEventListener('touchstart', ts); el.removeEventListener('touchmove', tm); el.removeEventListener('touchend', te); el.removeEventListener('wheel', wh); };
  }, []);

  // --- Marker drag state ---
  var [dragState, setDragState] = useState(null); // { taskId, startY, origStart, currentMins }
  var dragRef = useRef(null); // mutable for mousemove perf
  var gridElRef = elRef; // alias for clarity in handlers

  var markerDragStart = useCallback(function(e, taskId, origStart) {
    if (!onMarkerDrag) return;
    e.preventDefault();
    e.stopPropagation();
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    var state = { taskId: taskId, startClientY: clientY, origStart: origStart, currentMins: origStart };
    dragRef.current = state;
    setDragState(state);

    function onMove(ev) {
      var cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      var dy = cy - dragRef.current.startClientY;
      var deltaMins = (dy / hourHeight) * 60;
      var newMins = Math.round((dragRef.current.origStart + deltaMins) / 5) * 5;
      // Clamp to grid range
      newMins = Math.max(GRID_START * 60, Math.min(GRID_END * 60 - 5, newMins));
      if (newMins !== dragRef.current.currentMins) {
        dragRef.current = Object.assign({}, dragRef.current, { currentMins: newMins });
        setDragState(Object.assign({}, dragRef.current));
      }
    }
    function onEnd() {
      var final = dragRef.current;
      if (final && final.currentMins !== final.origStart) {
        onMarkerDrag(final.taskId, final.currentMins);
      }
      dragRef.current = null;
      setDragState(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }, [onMarkerDrag, hourHeight]);

  // Format minutes to time label for drag preview
  function formatDragTime(totalMins) {
    var h = Math.floor(totalMins / 60);
    var m = totalMins % 60;
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }

  var blockStartsByHour = {};
  blocks.forEach(function(bl) { var h = Math.floor(bl.start / 60); if (h >= GRID_START && h <= GRID_END) blockStartsByHour[h] = bl; });

  // Map each hour to its block (for gutter when/where labels)
  var blockByHour = {};
  blocks.forEach(function(bl) {
    var startH = Math.floor(bl.start / 60);
    var endH = Math.ceil(bl.end / 60);
    for (var h = Math.max(startH, GRID_START); h < Math.min(endH, GRID_END + 1); h++) {
      blockByHour[h] = bl;
    }
  });

  return (
    <div ref={elRef} style={{ position: 'relative', height: totalH, minHeight: totalH, touchAction: 'pan-y', overflow: 'hidden', userSelect: dragState ? 'none' : undefined, cursor: dragState ? 'grabbing' : undefined }}
      onClick={locMenuHour !== null ? function() { setLocMenuHour(null); } : undefined}
      onDragOver={onGridDrop ? function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
      onDrop={onGridDrop ? function(e) { onGridDrop(e, dateKey); } : undefined}
    >
      {/* Hour grid lines */}
      {Array.from({ length: GRID_HOURS_COUNT }, function(_, i) {
        var hour = GRID_START + i;
        var locId = resolveLocationId(dateKey, hour, schedCfg, blocks);
        return <div key={i} style={{
          position: 'absolute', top: i * hourHeight, left: 0, right: 0,
          height: hourHeight, borderBottom: '1px solid ' + theme.border,
          background: locBgTint(locId)
        }} />;
      })}

      {/* Center strip */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: stripX, width: dm.STRIP_W, zIndex: locMenuHour !== null ? 30 : 10, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, marginLeft: -0.5, background: theme.border, opacity: 0.35 }} />
        {Array.from({ length: GRID_HOURS_COUNT }, function(_, i) {
          var hour = GRID_START + i;
          var locId = resolveLocationId(dateKey, hour, schedCfg, blocks);
          var bs = blockStartsByHour[hour];
          return (
            <div key={i}
              onClick={onHourLocationOverride && locations ? function(e) {
                e.stopPropagation();
                setLocMenuHour(locMenuHour === hour ? null : hour);
              } : undefined}
              title={onHourLocationOverride ? 'Click to change location for ' + formatHour(hour) : undefined}
              style={{ position: 'absolute', top: i * hourHeight, left: 0, width: '100%', textAlign: 'center', pointerEvents: onHourLocationOverride ? 'auto' : 'none', cursor: onHourLocationOverride ? 'pointer' : 'default' }}
            >
              <div style={{ fontSize: mode === 'mini' ? 7 : (mode === 'compact' ? 8 : (isMobile ? 9 : 11)), color: theme.textMuted, userSelect: 'none', lineHeight: 1.2, marginTop: 1 }}>
                {formatHour(hour)}
              </div>
              {mode !== 'mini' && locIcon(locId) && (
                <div style={{
                  width: isMobile ? 18 : 22, height: isMobile ? 18 : 22,
                  borderRadius: '50%', background: locBgTint(locId, '25'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: isMobile ? 12 : 14, opacity: 0.9, margin: '1px auto 0'
                }}>{locIcon(locId)}</div>
              )}
              {bs && mode === 'full' && <div style={{ fontSize: 7, color: bs.color || theme.textMuted, opacity: 0.6 }}>{bs.icon}</div>}
              {mode !== 'mini' && (function() {
                var bl = blockByHour[hour];
                if (!bl) return null;
                var blStartH = Math.floor(bl.start / 60);
                var isFirst = hour === Math.max(blStartH, GRID_START);
                if (!isFirst) return null;
                var label = bl.name || bl.tag || '';
                if (!label) return null;
                return (
                  <div style={{
                    fontSize: isMobile ? 7 : 8, color: bl.color || theme.textMuted,
                    opacity: 0.7, fontWeight: 600, lineHeight: 1.1,
                    marginTop: 1, userSelect: 'none',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    maxWidth: dm.STRIP_W - 4
                  }} title={label}>
                    {label}
                  </div>
                );
              })()}
              {locMenuHour === hour && locations && (function() {
                var anchor = elRef.current;
                if (!anchor) return null;
                var gridRect = anchor.getBoundingClientRect();
                var menuTop = gridRect.top + (i * hourHeight) + 18;
                var menuLeft = gridRect.left + stripX + dm.STRIP_W + 4;
                return ReactDOM.createPortal(
                  <div style={{
                    position: 'fixed', left: menuLeft, top: menuTop,
                    zIndex: 10000, pointerEvents: 'auto',
                    background: theme.bgCard,
                    border: '1px solid ' + theme.border,
                    borderRadius: 2, padding: 4,
                    boxShadow: '0 4px 12px ' + theme.shadow,
                    display: 'flex', flexDirection: 'column', gap: 2,
                    whiteSpace: 'nowrap'
                  }}>
                    {locations.map(function(loc) {
                      var isActive = loc.id === locId;
                      var tint = LOC_TINT[loc.id] || '#8B5CF6';
                      return (
                        <button key={loc.id}
                          onClick={function(ev) {
                            ev.stopPropagation();
                            onHourLocationOverride(dateKey, hour, loc.id);
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
          );
        })}
      </div>

      {/* Now indicator */}
      {isToday && nowMins >= GRID_START * 60 && nowMins <= GRID_END * 60 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: ((nowMins - GRID_START * 60) / 60) * hourHeight, height: 2, background: theme.redText, zIndex: 50, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: stripMid - 4, top: -3, width: 8, height: 8, borderRadius: '50%', background: theme.redText }} />
        </div>
      )}

      {/* FULL / COMPACT: connectors + markers + cards */}
      {mode !== 'mini' && cw > 0 && (
        <>
          {/* SVG connectors */}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: cw, height: totalH, pointerEvents: 'none', zIndex: 12 }}>
            {layout.map(function(e) {
              var pc = PRI_COLORS[e.item.task.pri] || PRI_COLORS.P3;
              var sy = e.markerMidY, ey = e.cardMidY;
              var sx, ex, mx;
              if (e.side === 'right') {
                sx = stripX + dm.STRIP_W + dm.MARKER_W;
                ex = rightCardLeft + e.col * subColW_right;
                mx = sx + (ex - sx) * 0.5;
              } else {
                sx = stripX - dm.MARKER_W;
                ex = leftCardLeft + (e.col + 1) * subColW_left - colGap;
                mx = ex + (sx - ex) * 0.5;
              }
              return <path key={'cn_' + (e.item.key || e.item.task.id)}
                d={'M '+sx+' '+sy+' C '+mx+' '+sy+', '+mx+' '+ey+', '+ex+' '+ey}
                fill="none" stroke={pc} strokeWidth={1.5} opacity={0.45} />;
            })}
          </svg>

          {layout.map(function(e) {
            var pc = PRI_COLORS[e.item.task.pri] || PRI_COLORS.P3;
            var mLeft = e.side === 'left' ? (stripX - dm.MARKER_W) : (stripX + dm.STRIP_W);
            var cLeft, cW;
            if (e.side === 'left') {
              cLeft = leftCardLeft + e.col * subColW_left;
              cW = subColW_left - colGap;
            } else {
              cLeft = rightCardLeft + e.col * subColW_right;
              cW = subColW_right - colGap;
            }
            cW = Math.max(cW, 40);

            return (
              <React.Fragment key={e.item.key || e.item.task.id}>
                {/* Horizontal bar connecting markers behind the strip —
                    only drawn for lane 0 of a cluster so overlapping halos
                    don't mush colors together. */}
                {(e.markerLane || 0) === 0 && (
                  <div style={{
                    position: 'absolute', left: stripX - dm.MARKER_W,
                    top: (dragState && dragState.taskId === e.item.task.id) ? ((dragState.currentMins - GRID_START * 60) / 60) * hourHeight : e.markerY,
                    width: dm.STRIP_W + dm.MARKER_W * 2, height: e.markerH,
                    background: pc, opacity: 0.08, borderRadius: 3,
                    zIndex: 5, pointerEvents: 'none'
                  }} />
                )}
                {/* Duration-proportional markers on both sides of strip — draggable */}
                {(function() {
                  var isDragging = dragState && dragState.taskId === e.item.task.id;
                  var markerTop = isDragging ? ((dragState.currentMins - GRID_START * 60) / 60) * hourHeight : e.markerY;
                  // When multiple tasks overlap in time, split each marker bar
                  // into N side-by-side lanes so none is hidden.
                  var lanes = e.markerCols || 1;
                  var lane = e.markerLane || 0;
                  var laneW = dm.MARKER_W / lanes;
                  var laneOffsetL = lane * laneW;             // leftmost lane closest to strip
                  var laneOffsetR = (lanes - 1 - lane) * laneW; // on right side, mirror so lane 0 is closest to strip
                  var markerStyle = {
                    position: 'absolute', top: markerTop,
                    width: laneW, height: e.markerH,
                    borderRadius: lanes > 1 ? 2 : 3, background: pc,
                    opacity: isDragging ? 0.9 : 0.65,
                    zIndex: isDragging ? 55 : 15,
                    cursor: onMarkerDrag ? 'grab' : 'default',
                    transition: isDragging ? 'none' : undefined,
                    boxShadow: isDragging ? '0 2px 8px ' + theme.shadow : undefined
                  };
                  var onDown = onMarkerDrag ? function(ev) { markerDragStart(ev, e.item.task.id, e.item.start); } : undefined;
                  return (
                    <>
                      <div style={Object.assign({}, markerStyle, { left: stripX - dm.MARKER_W + laneOffsetL })}
                        onMouseDown={onDown} onTouchStart={onDown} />
                      <div style={Object.assign({}, markerStyle, { left: stripX + dm.STRIP_W + laneOffsetR })}
                        onMouseDown={onDown} onTouchStart={onDown} />
                      {isDragging && (
                        <div style={{
                          position: 'absolute',
                          left: stripX + dm.STRIP_W + dm.MARKER_W + 6,
                          top: markerTop - 10,
                          background: theme.bgCard,
                          border: '2px solid ' + pc,
                          borderRadius: 6, padding: '2px 8px',
                          fontSize: 11, fontWeight: 700, color: pc,
                          zIndex: 60, pointerEvents: 'none',
                          whiteSpace: 'nowrap',
                          boxShadow: '0 2px 8px ' + theme.shadow
                        }}>
                          {formatDragTime(dragState.currentMins)}
                        </div>
                      )}
                    </>
                  );
                })()}
                {/* Fixed-height card */}
                <div style={{
                  position: 'absolute', left: cLeft, top: e.cardY,
                  width: cW, height: dm.CARD_H, zIndex: 20
                }}>
                  <ScheduleCard
                    item={e.item}
                    status={statuses[e.item.task.id] || ''}
                    onStatusChange={function(val) { onStatusChange(e.item.task.id, val); }}
                onDelete={onDelete ? function() { onDelete(e.item.task.id); } : null}
                    onExpand={function() { onExpand(e.item.task.id); }}
                    darkMode={darkMode}
                    isBlocked={blockedTaskIds && blockedTaskIds.has(e.item.task.id)}
                    isMobile={isMobile}
                    layoutMode={mode}
                    cardHeight={dm.CARD_H}
                    weatherDay={weatherDay}
                  />
                </div>
              </React.Fragment>
            );
          })}
        </>
      )}

      {/* MINI: markers only */}
      {mode === 'mini' && miniMarkers.map(function(item, idx) {
        var pc = PRI_COLORS[item.task.pri] || PRI_COLORS.P3;
        var my = ((item.start - GRID_START * 60) / 60) * hourHeight;
        var mh = Math.max(3, ((item.dur || 30) / 60) * hourHeight);
        var ml = (idx % 2 === 0) ? (stripX - dm.MARKER_W - 1) : (stripX + dm.STRIP_W + 1);
        var exp = expandedMiniId === item.task.id;
        var done = (statuses[item.task.id] || '') === 'done' || (statuses[item.task.id] || '') === 'cancel' || (statuses[item.task.id] || '') === 'skip';
        return (
          <React.Fragment key={item.key || item.task.id}>
            <div onClick={function() { if (exp) { setExpandedMiniId(null); onExpand(item.task.id); } else setExpandedMiniId(item.task.id); }}
              style={{ position: 'absolute', left: ml, top: my, width: dm.MARKER_W, height: mh, borderRadius: 2, background: pc, opacity: done ? 0.3 : 0.75, zIndex: 15, cursor: 'pointer' }}
              title={item.task.text + ' (' + item.dur + 'm)'} />
            {exp && (
              <div style={{ position: 'absolute', left: stripX + dm.STRIP_W + 4, top: my - 2, zIndex: 30, background: theme.bgCard, border: '1px solid ' + pc + '60', borderRadius: 6, padding: '4px 8px', fontSize: 10, color: theme.text, whiteSpace: 'nowrap', boxShadow: '0 2px 8px ' + theme.shadow, cursor: 'pointer', maxWidth: 'calc(100% - ' + (stripX + dm.STRIP_W + 12) + 'px)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: pc, marginRight: 4, verticalAlign: 'middle' }} />
                {item.task.text}
                <span style={{ color: theme.textMuted, marginLeft: 4 }}>{item.dur}m</span>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
