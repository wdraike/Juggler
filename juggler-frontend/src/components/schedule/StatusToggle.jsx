/**
 * StatusToggle — row of icon buttons for task status
 * High-contrast in both light and dark modes
 */

import React from 'react';

var STATUSES = [
  { value: '',       icon: '\u25CB', label: 'Open',   activeBg: '#F5F0E8', activeBgDark: '#2C2B28', color: '#5C5A55', colorDark: '#B0A898' },
  { value: 'done',   icon: '\u2713', label: 'Done',   activeBg: '#D1FAE5', activeBgDark: '#0A3622', color: '#2D6A4F', colorDark: '#6EE7B7' },
  { value: 'wip',    icon: '\u231B', label: 'WIP',    activeBg: '#FEF3C7', activeBgDark: '#3A2A08', color: '#9E6B3B', colorDark: '#E8C878' },
  { value: 'cancel', icon: '\u2715', label: 'Cancel', activeBg: '#FEE2E2', activeBgDark: '#3A0A10', color: '#8B2635', colorDark: '#FCA5A5' },
  { value: 'skip',   icon: '\u21ED', label: 'Skip',   activeBg: '#E8E0D0', activeBgDark: '#2C2B28', color: '#5C5A55', colorDark: '#B0A898' },
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
              background: active ? (darkMode ? s.activeBgDark : s.activeBg) : (darkMode ? '#1E293B' : '#F5F0E8'),
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
