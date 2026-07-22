/**
 * TaskBoardSkeleton (999.2119) — brand "Loading & Busy-State Standard"
 * skeleton for the task board / calendar grid initial load. Replaces the
 * full-page shared spinner gate in AppLayout: a header strip + 7 day columns
 * of task-card blocks mirroring the loaded grid, so nothing jumps when data
 * lands. Parchment tones on light themes, faint-gold-on-charcoal on dark
 * (brand guide); shimmer disabled under prefers-reduced-motion.
 */

import React from 'react';

function isDarkBg(bg) {
  if (typeof bg !== 'string' || bg[0] !== '#' || bg.length < 7) return true;
  var r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

var BLOCKS_PER_DAY = [3, 2, 4, 2, 3, 2, 2]; // varied heights read as real cards

export default function TaskBoardSkeleton({ theme, isMobile }) {
  // Mobile board is single-column (AppLayout gates layout on useIsMobile) —
  // the placeholder must match or content jumps when data lands (harrison INFO).
  var days = isMobile ? BLOCKS_PER_DAY.slice(0, 1) : BLOCKS_PER_DAY;
  var dark = isDarkBg(theme && theme.bg);
  var base = dark ? 'rgba(255, 255, 255, 0.08)' : '#E8E0D0';
  var shimmer = dark ? 'rgba(200, 148, 42, 0.10)' : 'rgba(253, 250, 245, 0.65)';

  var block = {
    position: 'relative', overflow: 'hidden',
    background: base, borderRadius: 2
  };

  return (
    <>
    <div
      data-testid="board-skeleton"
      aria-busy="true"
      style={{
        minHeight: '100vh', background: (theme && theme.bg) || '#0F1520',
        padding: 16, boxSizing: 'border-box'
      }}
    >
      <div data-testid="board-skeleton-header" className="board-skel" style={Object.assign({}, block, { height: 48, marginBottom: 16 })} />
      <div style={{ display: 'flex', gap: 12 }}>
        {days.map(function (n, day) {
          return (
            <div key={day} data-testid="board-skeleton-day" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="board-skel" style={Object.assign({}, block, { height: 20, width: '60%' })} />
              {Array.from({ length: n }, function (_, i) {
                return (
                  <div
                    key={i}
                    data-testid="board-skeleton-block"
                    className="board-skel"
                    style={Object.assign({}, block, { height: 34 + ((day + i) % 3) * 22 })}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <style>{
        '.board-skel::after {' +
        "  content: '';" +
        '  position: absolute; inset: 0;' +
        '  transform: translateX(-100%);' +
        '  background: linear-gradient(90deg, transparent, ' + shimmer + ', transparent);' +
        '  animation: board-skel-shimmer 1.6s ease-in-out infinite;' +
        '}' +
        '@keyframes board-skel-shimmer { 100% { transform: translateX(100%); } }' +
        '@media (prefers-reduced-motion: reduce) { .board-skel::after { animation: none; } }'
      }</style>
    </div>
    {/* 999.2163: role=status is a SIBLING of the aria-busy region, not nested
        inside it — AT may defer announcements inside a busy region. */}
    <span role="status" style={{
      position: 'absolute', width: 1, height: 1, overflow: 'hidden',
      clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap'
    }}>
      Loading tasks…
    </span>
    </>
  );
}
