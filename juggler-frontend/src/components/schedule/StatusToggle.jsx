/**
 * StatusToggle — row of icon buttons for task status
 * High-contrast in both light and dark modes
 */

import React from 'react';

var STATUSES = [
  { value: '',       icon: '\u25CB', label: 'Open',   activeBg: '#E5E7EB', activeBgDark: '#374151', color: '#4B5563', colorDark: '#9CA3AF' },
  { value: 'done',   icon: '\u2713', label: 'Done',   activeBg: '#BBF7D0', activeBgDark: '#064E3B', color: '#15803D', colorDark: '#6EE7B7' },
  { value: 'wip',    icon: '\u231B', label: 'WIP',    activeBg: '#FDE68A', activeBgDark: '#78350F', color: '#B45309', colorDark: '#FCD34D' },
  { value: 'cancel', icon: '\u2715', label: 'Cancel', activeBg: '#FECACA', activeBgDark: '#7F1D1D', color: '#DC2626', colorDark: '#FCA5A5' },
  { value: 'skip',   icon: '\u21ED', label: 'Skip',   activeBg: '#E2E8F0', activeBgDark: '#334155', color: '#475569', colorDark: '#94A3B8' },
];

export default function StatusToggle({ value, onChange, darkMode, compact, isMobile }) {
  var size = compact ? 16 : (isMobile ? 28 : 22);
  var fontSize = compact ? 8 : (isMobile ? 14 : 12);

  return (
    <div style={{ display: 'flex', gap: compact ? 1 : 3, alignItems: 'center' }}>
      {STATUSES.map(function(s) {
        var active = (value || '') === s.value;
        return (
          <button
            key={s.value || 'open'}
            onClick={function(e) { e.stopPropagation(); onChange(s.value); }}
            title={s.label}
            style={{
              width: size, height: size,
              borderRadius: 4,
              border: active
                ? '1.5px solid ' + (darkMode ? s.colorDark : s.color)
                : '1px solid ' + (darkMode ? '#475569' : '#94A3B8'),
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: fontSize,
              fontWeight: 700,
              padding: 0,
              background: active ? (darkMode ? s.activeBgDark : s.activeBg) : (darkMode ? '#1E293B' : '#FFFFFF'),
              color: active ? (darkMode ? s.colorDark : s.color) : (darkMode ? '#64748B' : '#6B7280'),
              transition: 'background 0.1s, color 0.1s, border-color 0.1s',
              flexShrink: 0
            }}
          >
            {s.icon}
          </button>
        );
      })}
    </div>
  );
}
