/**
 * CalendarGrid — reusable time grid (6am-11pm) for day/multi-day views
 */

import React, { useRef, useEffect } from 'react';
import { GRID_START, GRID_END, GRID_HOURS_COUNT, locBgTint, locIcon } from '../../state/constants';
import { formatHour } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';
import { resolveLocationId } from '../../scheduler/locationHelpers';
import { getBlocksForDate } from '../../scheduler/timeBlockHelpers';
import ScheduledTaskBlock from './ScheduledTaskBlock';

export default function CalendarGrid({
  dateKey, placements, statuses, directions, onStatusChange, onExpand,
  gridZoom, darkMode, schedCfg, nowMins, isToday, onGridDrop, locations, onHourLocationOverride, blockedTaskIds,
  onZoomChange
}) {
  var theme = getTheme(darkMode);
  var hourHeight = gridZoom || 60;
  var totalHeight = GRID_HOURS_COUNT * hourHeight;
  var blocks = getBlocksForDate(dateKey, schedCfg.timeBlocks);
  var gridRef = useRef(null);
  var pinchRef = useRef({ startDist: 0, startZoom: 0 });
  var zoomRef = useRef(gridZoom);
  zoomRef.current = gridZoom;
  var onZoomRef = useRef(onZoomChange);
  onZoomRef.current = onZoomChange;

  // Native touch + wheel listeners (must be non-passive to preventDefault)
  useEffect(function() {
    var el = gridRef.current;
    if (!el) return;

    function handleTouchStart(e) {
      if (e.touches.length === 2 && onZoomRef.current) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current.startDist = Math.hypot(dx, dy);
        pinchRef.current.startZoom = zoomRef.current || 60;
      }
    }

    function handleTouchMove(e) {
      if (e.touches.length === 2 && onZoomRef.current && pinchRef.current.startDist > 0) {
        e.preventDefault();
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.hypot(dx, dy);
        var scale = dist / pinchRef.current.startDist;
        var newZoom = Math.round(Math.min(180, Math.max(20, pinchRef.current.startZoom * scale)));
        onZoomRef.current(newZoom);
      }
    }

    function handleTouchEnd() {
      pinchRef.current.startDist = 0;
    }

    function handleWheel(e) {
      if ((e.ctrlKey || e.metaKey) && onZoomRef.current) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? -4 : 4;
        var current = zoomRef.current || 60;
        var newZoom = Math.round(Math.min(180, Math.max(20, current + delta)));
        onZoomRef.current(newZoom);
      }
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: false });
    return function() {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Map block starts to hours for boundary labels
  var blockStartsByHour = {};
  blocks.forEach(function(b) {
    var h = Math.floor(b.start / 60);
    if (h >= GRID_START && h <= GRID_END) blockStartsByHour[h] = b;
  });

  return (
    <div ref={gridRef} style={{ position: 'relative', height: totalHeight, minHeight: totalHeight, touchAction: 'pan-y' }}
      onDragOver={onGridDrop ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }) : undefined}
      onDrop={onGridDrop ? (e => onGridDrop(e, dateKey)) : undefined}
    >
      {/* Hour lines */}
      {Array.from({ length: GRID_HOURS_COUNT }, (_, i) => {
        var hour = GRID_START + i;
        var locId = resolveLocationId(dateKey, hour, schedCfg, blocks);
        var blockStart = blockStartsByHour[hour];
        return (
          <div key={i} style={{
            position: 'absolute', top: i * hourHeight, left: 0, right: 0,
            height: hourHeight, borderBottom: `1px solid ${theme.border}`,
            background: locBgTint(locId)
          }}>
            <div
              onClick={onHourLocationOverride && locations ? (e => {
                e.stopPropagation();
                var locIds = locations.map(l => l.id);
                var idx = locIds.indexOf(locId);
                var nextLoc = locIds[(idx + 1) % locIds.length];
                onHourLocationOverride(dateKey, hour, nextLoc);
              }) : undefined}
              style={{
                position: 'absolute', left: 8, top: 2, fontSize: 12,
                color: theme.textMuted, userSelect: 'none', lineHeight: 1.3,
                cursor: onHourLocationOverride ? 'pointer' : 'default'
              }}
            >
              {formatHour(hour)}
              <div style={{ fontSize: 10, marginTop: -1 }}>{locIcon(locId)}</div>
            </div>
            {blockStart && (
              <div style={{
                position: 'absolute', left: 8, bottom: 2, fontSize: 10,
                color: blockStart.color || theme.textMuted, userSelect: 'none',
                whiteSpace: 'nowrap', opacity: 0.8
              }}>
                {blockStart.icon} {blockStart.name}
              </div>
            )}
          </div>
        );
      })}

      {/* Now indicator */}
      {isToday && nowMins >= GRID_START * 60 && nowMins <= GRID_END * 60 && (
        <div style={{
          position: 'absolute', left: 68, right: 0,
          top: ((nowMins - GRID_START * 60) / 60) * hourHeight,
          height: 2, background: '#EF4444', zIndex: 50,
          pointerEvents: 'none'
        }}>
          <div style={{
            position: 'absolute', left: -4, top: -3, width: 8, height: 8,
            borderRadius: '50%', background: '#EF4444'
          }} />
        </div>
      )}

      {/* Task blocks */}
      {(placements || []).map(item => (
        <ScheduledTaskBlock
          key={item.key || item.task.id}
          item={item}
          status={statuses[item.task.id] || ''}
          direction={directions?.[item.task.id]}
          gridZoom={hourHeight}
          onStatusChange={val => onStatusChange(item.task.id, val)}
          onExpand={() => onExpand(item.task.id)}
          darkMode={darkMode}
          isBlocked={blockedTaskIds && blockedTaskIds.has(item.task.id)}
        />
      ))}
    </div>
  );
}
