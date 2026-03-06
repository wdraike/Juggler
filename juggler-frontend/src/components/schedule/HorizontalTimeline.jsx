/**
 * HorizontalTimeline — time flows left-to-right, cards above and below
 * the horizontal strip, up to 2 deep on each side.
 *
 * Reuses ScheduleCard for rendering each tile.
 */

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { GRID_START, GRID_END, GRID_HOURS_COUNT, PRI_COLORS, LOC_TINT, locBgTint, locIcon } from '../../state/constants';
import { formatHour } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';
import { resolveLocationId } from '../../scheduler/locationHelpers';
import { getBlocksForDate } from '../../scheduler/timeBlockHelpers';
import ScheduleCard from './ScheduleCard';

// Dimensions
var STRIP_H = 32;         // horizontal strip height
var MARKER_H = 8;         // marker bar height (above/below strip)
var CARD_W = 140;         // card width
var CARD_W_M = 120;       // mobile card width
var CARD_H = 72;          // card height
var CARD_H_M = 78;
var CARD_GAP = 6;         // gap between stacked cards
var CONN_ZONE = 16;       // space between marker and card for connector

function computeHLayout(placements, hourWidth, cardW, cardH, gap) {
  var sorted = (placements || []).slice().sort(function(a, b) { return a.start - b.start; });
  var result = [];

  // Track rightmost edge of each row: above0, above1, below0, below1
  var rowRight = { above_0: -Infinity, above_1: -Infinity, below_0: -Infinity, below_1: -Infinity };

  for (var i = 0; i < sorted.length; i++) {
    var item = sorted[i];
    var markerX = ((item.start - GRID_START * 60) / 60) * hourWidth;
    var durMin = item.dur || 30;
    var markerW = Math.max(4, (durMin / 60) * hourWidth);
    var markerMidX = markerX + markerW / 2;

    // Ideal X: center card on marker midpoint
    var idealX = Math.max(markerMidX - cardW / 2, 4);

    // Alternate above/below
    var side = i % 2 === 0 ? 'above' : 'below';

    // Pick whichever row (0 or 1) the card fits earliest
    var row = 0;
    var bestX = Math.max(idealX, rowRight[side + '_0'] + gap);
    var altX = Math.max(idealX, rowRight[side + '_1'] + gap);
    if (altX < bestX) {
      row = 1;
      bestX = altX;
    }

    rowRight[side + '_' + row] = bestX + cardW;

    result.push({
      item: item, side: side, row: row,
      markerX: markerX, markerW: markerW, markerMidX: markerMidX,
      cardX: bestX, cardMidX: bestX + cardW / 2
    });
  }
  return result;
}

export default function HorizontalTimeline({
  dateKey, placements, statuses, directions, onStatusChange, onExpand,
  gridZoom, darkMode, schedCfg, nowMins, isToday, onGridDrop, locations, onHourLocationOverride, blockedTaskIds,
  onZoomChange, isMobile, onMarkerDrag
}) {
  var theme = getTheme(darkMode);
  var baseHourWidth = gridZoom || 60;
  // Use wider hour widths for horizontal mode to give cards room
  if (baseHourWidth < 100) baseHourWidth = 100;

  var cardW = isMobile ? CARD_W_M : CARD_W;
  var cardH = isMobile ? CARD_H_M : CARD_H;

  var elRef = useRef(null);
  var [ch, setCh] = useState(400);
  useEffect(function() {
    function m() { if (elRef.current) setCh(elRef.current.offsetHeight); }
    m();
    var ro = new ResizeObserver(m);
    if (elRef.current) ro.observe(elRef.current);
    return function() { ro.disconnect(); };
  }, []);

  var blocks = getBlocksForDate(dateKey, schedCfg.timeBlocks, schedCfg);

  // Layout
  var layout = useMemo(function() {
    return computeHLayout(placements, baseHourWidth, cardW, cardH, CARD_GAP);
  }, [placements, baseHourWidth, cardW, cardH]);

  // Total width
  var gridW = GRID_HOURS_COUNT * baseHourWidth;
  var maxRight = 0;
  for (var i = 0; i < layout.length; i++) {
    var r = layout[i].cardX + cardW;
    if (r > maxRight) maxRight = r;
  }
  var totalW = Math.max(gridW, maxRight + 8);

  // Vertical positions
  // Strip is centered vertically; cards go above and below
  var stripY = Math.floor(ch / 2) - STRIP_H / 2;
  // Above cards: row 0 is closest to strip, row 1 is further up
  var aboveRow0Top = stripY - MARKER_H - CONN_ZONE - cardH;
  var aboveRow1Top = aboveRow0Top - CARD_GAP - cardH;
  // Below cards: row 0 is closest to strip, row 1 is further down
  var belowRow0Top = stripY + STRIP_H + MARKER_H + CONN_ZONE;
  var belowRow1Top = belowRow0Top + cardH + CARD_GAP;

  function getCardY(side, row) {
    if (side === 'above') return row === 0 ? aboveRow0Top : aboveRow1Top;
    return row === 0 ? belowRow0Top : belowRow1Top;
  }

  // Pinch/wheel zoom (horizontal)
  var zoomRef = useRef(gridZoom); zoomRef.current = gridZoom;
  var onZoomRef = useRef(onZoomChange); onZoomRef.current = onZoomChange;
  useEffect(function() {
    var el = elRef.current; if (!el) return;
    function wh(e) {
      if ((e.ctrlKey || e.metaKey) && onZoomRef.current) {
        e.preventDefault();
        onZoomRef.current(Math.round(Math.min(300, Math.max(60, (zoomRef.current || 100) + (e.deltaY > 0 ? -6 : 6)))));
      }
    }
    el.addEventListener('wheel', wh, { passive: false });
    return function() { el.removeEventListener('wheel', wh); };
  }, []);

  // Marker drag
  var [dragState, setDragState] = useState(null);
  var dragRef = useRef(null);

  var markerDragStart = useCallback(function(e, taskId, origStart) {
    if (!onMarkerDrag) return;
    e.preventDefault();
    e.stopPropagation();
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var state = { taskId: taskId, startClientX: clientX, origStart: origStart, currentMins: origStart };
    dragRef.current = state;
    setDragState(state);

    function onMove(ev) {
      var cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      var dx = cx - dragRef.current.startClientX;
      var deltaMins = (dx / baseHourWidth) * 60;
      var newMins = Math.round((dragRef.current.origStart + deltaMins) / 5) * 5;
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
  }, [onMarkerDrag, baseHourWidth]);

  function formatDragTime(totalMins) {
    var h = Math.floor(totalMins / 60);
    var m = totalMins % 60;
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }

  return (
    <div ref={elRef} style={{
      position: 'relative', width: totalW, minWidth: totalW,
      height: '100%', minHeight: (cardH * 2 + CARD_GAP) * 2 + STRIP_H + MARKER_H * 2 + CONN_ZONE * 2 + 40,
      touchAction: 'pan-x', overflow: 'hidden',
      userSelect: dragState ? 'none' : undefined,
      cursor: dragState ? 'grabbing' : undefined
    }}
      onDragOver={onGridDrop ? function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
      onDrop={onGridDrop ? function(e) { onGridDrop(e, dateKey); } : undefined}
    >
      {/* Hour columns — vertical grid lines + location tints */}
      {Array.from({ length: GRID_HOURS_COUNT }, function(_, i) {
        var hour = GRID_START + i;
        var locId = resolveLocationId(dateKey, hour, schedCfg, blocks);
        return (
          <div key={i} style={{
            position: 'absolute', left: i * baseHourWidth, top: 0, bottom: 0,
            width: baseHourWidth, borderRight: '1px solid ' + theme.border,
            background: locBgTint(locId), opacity: 0.5
          }} />
        );
      })}

      {/* Horizontal strip (timeline bar) */}
      <div style={{
        position: 'absolute', left: 0, top: stripY,
        width: totalW, height: STRIP_H,
        background: darkMode ? '#1E293B' : '#F1F5F9',
        borderTop: '1px solid ' + theme.border,
        borderBottom: '1px solid ' + theme.border,
        zIndex: 5
      }}>
        {/* Hour labels */}
        {Array.from({ length: GRID_HOURS_COUNT }, function(_, i) {
          var hour = GRID_START + i;
          var locId = resolveLocationId(dateKey, hour, schedCfg, blocks);
          return (
            <div key={i} style={{
              position: 'absolute', left: i * baseHourWidth, top: 0,
              width: baseHourWidth, height: STRIP_H,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              fontSize: isMobile ? 9 : 10, color: theme.textMuted,
              userSelect: 'none', borderRight: '1px solid ' + theme.border + '40'
            }}>
              <span>{formatHour(hour)}</span>
              {locIcon(locId) && <span style={{ fontSize: isMobile ? 10 : 12, opacity: 0.7, lineHeight: 1 }}>{locIcon(locId)}</span>}
            </div>
          );
        })}
      </div>

      {/* Now indicator (vertical line) */}
      {isToday && nowMins >= GRID_START * 60 && nowMins <= GRID_END * 60 && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: ((nowMins - GRID_START * 60) / 60) * baseHourWidth,
          width: 2, background: '#EF4444', zIndex: 50, pointerEvents: 'none'
        }}>
          <div style={{
            position: 'absolute', top: stripY - 4, left: -3,
            width: 8, height: 8, borderRadius: '50%', background: '#EF4444'
          }} />
        </div>
      )}

      {/* SVG connectors */}
      <svg style={{ position: 'absolute', left: 0, top: 0, width: totalW, height: '100%', pointerEvents: 'none', zIndex: 12 }}>
        {layout.map(function(e) {
          var pc = PRI_COLORS[e.item.task.pri] || PRI_COLORS.P3;
          var cardY = getCardY(e.side, e.row);

          // Connector from marker to card
          var sx = e.markerMidX;
          var sy = e.side === 'above' ? (stripY - MARKER_H) : (stripY + STRIP_H + MARKER_H);
          var ex = e.cardMidX;
          var ey = e.side === 'above' ? (cardY + cardH) : cardY;
          var my = sy + (ey - sy) * 0.5;

          return <path key={'cn_' + (e.item.key || e.item.task.id)}
            d={'M ' + sx + ' ' + sy + ' C ' + sx + ' ' + my + ', ' + ex + ' ' + my + ', ' + ex + ' ' + ey}
            fill="none" stroke={pc} strokeWidth={1.5} opacity={0.4} />;
        })}
      </svg>

      {/* Markers + Cards */}
      {layout.map(function(e) {
        var pc = PRI_COLORS[e.item.task.pri] || PRI_COLORS.P3;
        var isDragging = dragState && dragState.taskId === e.item.task.id;
        var mx = isDragging ? ((dragState.currentMins - GRID_START * 60) / 60) * baseHourWidth : e.markerX;

        // Marker on top of strip (above) or bottom of strip (below)
        var markerTop = e.side === 'above' ? (stripY - MARKER_H) : (stripY + STRIP_H);
        var cardY = getCardY(e.side, e.row);

        var onDown = onMarkerDrag ? function(ev) { markerDragStart(ev, e.item.task.id, e.item.start); } : undefined;

        return (
          <React.Fragment key={e.item.key || e.item.task.id}>
            {/* Background bar across strip */}
            <div style={{
              position: 'absolute', left: mx, top: stripY,
              width: e.markerW, height: STRIP_H,
              background: pc, opacity: 0.08, borderRadius: 2,
              zIndex: 6, pointerEvents: 'none'
            }} />
            {/* Marker bar */}
            <div style={{
              position: 'absolute', left: mx, top: markerTop,
              width: e.markerW, height: MARKER_H,
              background: pc, borderRadius: 2,
              opacity: isDragging ? 0.9 : 0.65,
              zIndex: isDragging ? 55 : 15,
              cursor: onMarkerDrag ? 'grab' : 'default',
              transition: isDragging ? 'none' : undefined,
              boxShadow: isDragging ? '0 2px 8px rgba(0,0,0,0.3)' : undefined
            }} onMouseDown={onDown} onTouchStart={onDown} />
            {/* Drag time label */}
            {isDragging && (
              <div style={{
                position: 'absolute', left: mx + e.markerW + 6,
                top: markerTop - 10,
                background: darkMode ? '#1E293B' : '#FFFFFF',
                border: '2px solid ' + pc,
                borderRadius: 6, padding: '2px 8px',
                fontSize: 11, fontWeight: 700, color: pc,
                zIndex: 60, pointerEvents: 'none', whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
              }}>
                {formatDragTime(dragState.currentMins)}
              </div>
            )}
            {/* Card */}
            <div style={{
              position: 'absolute', left: e.cardX, top: cardY,
              width: cardW, height: cardH, zIndex: 20
            }}>
              <ScheduleCard
                item={e.item}
                status={statuses[e.item.task.id] || ''}
                onStatusChange={function(val) { onStatusChange(e.item.task.id, val); }}
                onExpand={function() { onExpand(e.item.task.id); }}
                darkMode={darkMode}
                isBlocked={blockedTaskIds && blockedTaskIds.has(e.item.task.id)}
                isMobile={isMobile}
                cardHeight={cardH}
              />
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
