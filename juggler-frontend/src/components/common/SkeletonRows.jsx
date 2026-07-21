/**
 * SkeletonRows (999.2121) — shared brand skeleton list rows for panel/list
 * loading states, per the "Loading & Busy-State Standard": parchment tones on
 * light themes, faint-gold-on-charcoal on dark; aria-busy region with an
 * sr-only role=status label; shimmer off under prefers-reduced-motion.
 * The replacement for `Loading` spinners in content regions (the spinner
 * stays sanctioned only inside buttons / tiny inline affordances).
 */

import React from 'react';

function isDarkBg(bg) {
  if (typeof bg !== 'string' || bg[0] !== '#' || bg.length < 7) return true;
  var r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

export default function SkeletonRows({ rows, rowHeight, label, theme, style }) {
  var n = rows || 4;
  var dark = isDarkBg(theme && (theme.bgSecondary || theme.bg));
  var base = dark ? 'rgba(255, 255, 255, 0.08)' : '#E8E0D0';
  var shimmer = dark ? 'rgba(200, 148, 42, 0.10)' : 'rgba(253, 250, 245, 0.65)';

  return (
    <div aria-busy="true" style={Object.assign({ display: 'flex', flexDirection: 'column', gap: 10 }, style)}>
      {Array.from({ length: n }, function (_, i) {
        return (
          <div
            key={i}
            data-testid="skeleton-row"
            className="skel-row"
            style={{
              position: 'relative', overflow: 'hidden', borderRadius: 2,
              background: base, height: rowHeight || 44,
              width: i === n - 1 ? '70%' : '100%'
            }}
          />
        );
      })}
      <span role="status" style={{
        position: 'absolute', width: 1, height: 1, overflow: 'hidden',
        clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap'
      }}>
        {label || 'Loading…'}
      </span>
      <style>{
        '.skel-row::after {' +
        "  content: '';" +
        '  position: absolute; inset: 0;' +
        '  transform: translateX(-100%);' +
        '  background: linear-gradient(90deg, transparent, ' + shimmer + ', transparent);' +
        '  animation: skel-row-shimmer 1.6s ease-in-out infinite;' +
        '}' +
        '@keyframes skel-row-shimmer { 100% { transform: translateX(100%); } }' +
        '@media (prefers-reduced-motion: reduce) { .skel-row::after { animation: none; } }'
      }</style>
    </div>
  );
}
