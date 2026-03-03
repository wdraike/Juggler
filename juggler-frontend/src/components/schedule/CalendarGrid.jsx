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

import React, { useRef, useEffect, useMemo, useState } from 'react';
import { GRID_START, GRID_END, GRID_HOURS_COUNT, PRI_COLORS, locBgTint, locIcon } from '../../state/constants';
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
var CARD_H = 52;        // fixed card height — enough for title + status row
var CARD_H_M = 64;      // taller on mobile for wrapped titles
var CARD_H_COMPACT = 40;
var CARD_GAP = 4;
var CONN_ZONE = 24;     // space between marker and card for bezier connector
var CONN_ZONE_M = 12;
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

    // ideal: center card on marker midpoint
    var idealY = markerMidY - cardH / 2;

    // pick the slot with lowest candidate Y
    var bestSide = sides[0], bestCol = 0, bestY = Infinity;
    sides.forEach(function(side) {
      for (var c = 0; c < nCols; c++) {
        var y = Math.max(idealY, bottoms[side + '_' + c] + gap);
        if (y < bestY) {
          bestY = y; bestSide = side; bestCol = c;
        }
      }
    });

    bottoms[bestSide + '_' + bestCol] = bestY + cardH;

    result.push({
      item: item, side: bestSide, col: bestCol,
      markerY: markerY, markerH: markerH, markerMidY: markerMidY,
      cardY: bestY, cardMidY: bestY + cardH / 2
    });
  }
  return result;
}

export default function CalendarGrid({
  dateKey, placements, statuses, directions, onStatusChange, onExpand,
  gridZoom, darkMode, schedCfg, nowMins, isToday, onGridDrop, locations, onHourLocationOverride, blockedTaskIds,
  onZoomChange, isMobile, layoutMode
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
  var leftCardLeft = 4;
  var leftCardRight = stripX - dm.MARKER_W - dm.CONN;
  var leftCardW = mobileFullWidth ? 0 : (leftCardRight - leftCardLeft);
  var rightCardLeft = stripX + dm.STRIP_W + dm.MARKER_W + dm.CONN;
  var rightCardW = cw - rightCardLeft - 4;

  // Determine columns per side based on available width
  var colsPerSide = mobileFullWidth ? 1 : ((leftCardW > 250 && mode === 'full' && !isMobile) ? 2 : 1);
  var subColW_left = colsPerSide > 0 ? leftCardW / colsPerSide : 0;
  var subColW_right = rightCardW / colsPerSide;
  var colGap = colsPerSide > 1 ? 2 : 0;

  var blocks = getBlocksForDate(dateKey, schedCfg.timeBlocks);
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

  var blockStartsByHour = {};
  blocks.forEach(function(bl) { var h = Math.floor(bl.start / 60); if (h >= GRID_START && h <= GRID_END) blockStartsByHour[h] = bl; });

  return (
    <div ref={elRef} style={{ position: 'relative', height: totalH, minHeight: totalH, touchAction: 'pan-y', overflow: 'hidden' }}
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
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: stripX, width: dm.STRIP_W, zIndex: 10, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, marginLeft: -0.5, background: theme.border, opacity: 0.35 }} />
        {Array.from({ length: GRID_HOURS_COUNT }, function(_, i) {
          var hour = GRID_START + i;
          var locId = resolveLocationId(dateKey, hour, schedCfg, blocks);
          var bs = blockStartsByHour[hour];
          return (
            <div key={i}
              onClick={onHourLocationOverride && locations ? function(e) {
                e.stopPropagation();
                var ids = locations.map(function(l) { return l.id; });
                onHourLocationOverride(dateKey, hour, ids[(ids.indexOf(locId) + 1) % ids.length]);
              } : undefined}
              style={{ position: 'absolute', top: i * hourHeight, left: 0, width: '100%', textAlign: 'center', pointerEvents: onHourLocationOverride ? 'auto' : 'none', cursor: onHourLocationOverride ? 'pointer' : 'default' }}
            >
              <div style={{ fontSize: mode === 'mini' ? 7 : (mode === 'compact' ? 8 : (isMobile ? 9 : 11)), color: theme.textMuted, userSelect: 'none', lineHeight: 1.2, marginTop: 1 }}>
                {formatHour(hour)}
              </div>
              {mode !== 'mini' && locIcon(locId) && <div style={{ fontSize: 8, color: theme.textMuted, opacity: 0.6 }}>{locIcon(locId)}</div>}
              {bs && mode === 'full' && <div style={{ fontSize: 7, color: bs.color || theme.textMuted, opacity: 0.6 }}>{bs.icon}</div>}
            </div>
          );
        })}
      </div>

      {/* Now indicator */}
      {isToday && nowMins >= GRID_START * 60 && nowMins <= GRID_END * 60 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: ((nowMins - GRID_START * 60) / 60) * hourHeight, height: 2, background: '#EF4444', zIndex: 50, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: stripMid - 4, top: -3, width: 8, height: 8, borderRadius: '50%', background: '#EF4444' }} />
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
                {/* Duration-proportional marker */}
                <div style={{
                  position: 'absolute', left: mLeft, top: e.markerY,
                  width: dm.MARKER_W, height: e.markerH,
                  borderRadius: 3, background: pc, opacity: 0.65,
                  zIndex: 15, pointerEvents: 'none'
                }} />
                {/* Fixed-height card */}
                <div style={{
                  position: 'absolute', left: cLeft, top: e.cardY,
                  width: cW, height: dm.CARD_H, zIndex: 20
                }}>
                  <ScheduleCard
                    item={e.item}
                    status={statuses[e.item.task.id] || ''}
                    onStatusChange={function(val) { onStatusChange(e.item.task.id, val); }}
                    onExpand={function() { onExpand(e.item.task.id); }}
                    darkMode={darkMode}
                    isBlocked={blockedTaskIds && blockedTaskIds.has(e.item.task.id)}
                    isMobile={isMobile}
                    layoutMode={mode}
                    cardHeight={dm.CARD_H}
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
              <div style={{ position: 'absolute', left: stripX + dm.STRIP_W + 4, top: my - 2, zIndex: 30, background: darkMode ? '#1E293B' : '#FFFFFF', border: '1px solid ' + pc + '60', borderRadius: 6, padding: '4px 8px', fontSize: 10, color: theme.text, whiteSpace: 'nowrap', boxShadow: '0 2px 8px ' + theme.shadow, cursor: 'pointer', maxWidth: 'calc(100% - ' + (stripX + dm.STRIP_W + 12) + 'px)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
