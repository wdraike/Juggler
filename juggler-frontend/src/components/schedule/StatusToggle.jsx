/**
 * StatusToggle — row of icon buttons for task status
 * High-contrast in both light and dark modes
 */

import React from 'react';

var ALL_STATUSES = [
  { value: '',       icon: '\u25CB', label: 'Open',   activeBg: '#F5F0E8', activeBgDark: '#2C2B28', color: '#5C5A55', colorDark: '#B0A898' },
  { value: 'done',   icon: '\u2713', label: 'Done',   activeBg: '#D1FAE5', activeBgDark: '#0A3622', color: '#2D6A4F', colorDark: '#6EE7B7' },
  { value: 'wip',    icon: '\u231B', label: 'WIP',    activeBg: '#FEF3C7', activeBgDark: '#3A2A08', color: '#9E6B3B', colorDark: '#E8C878' },
  { value: 'cancel', icon: '\u2715', label: 'Cancel', activeBg: '#FEE2E2', activeBgDark: '#3A0A10', color: '#8B2635', colorDark: '#FCA5A5' },
  { value: 'skip',   icon: '\u21ED', label: 'Skip',   activeBg: '#E8E0D0', activeBgDark: '#2C2B28', color: '#5C5A55', colorDark: '#B0A898' },
  { value: 'pause',  icon: '\u23F8', label: 'Pause',  activeBg: '#E0E7FF', activeBgDark: '#1E1B4B', color: '#4338CA', colorDark: '#A5B4FC' },
];

function DeleteButton({ onDelete, size, fontSize, darkMode, compact, isMobile }) {
  var [confirming, setConfirming] = React.useState(false);
  React.useEffect(function() {
    if (!confirming) return;
    var timer = setTimeout(function() { setConfirming(false); }, 3000);
    return function() { clearTimeout(timer); };
  }, [confirming]);
  return (
    <button
      onClick={function(e) {
        e.stopPropagation();
        if (confirming) { onDelete(); setConfirming(false); }
        else { setConfirming(true); }
      }}
      title={confirming ? 'Click again to confirm delete' : 'Delete'}
      style={{
        width: confirming ? (compact ? 36 : (isMobile ? 56 : 44)) : size,
        height: size, borderRadius: 4,
        border: '1px solid ' + (confirming ? (darkMode ? '#FCA5A5' : '#8B2635') : (darkMode ? '#475569' : '#94A3B8')),
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: confirming ? (compact ? 7 : (isMobile ? 10 : 9)) : fontSize,
        fontWeight: 700, padding: 0,
        background: confirming ? (darkMode ? '#3A0A10' : '#FEE2E2') : (darkMode ? '#1E293B' : '#F5F0E8'),
        color: confirming ? (darkMode ? '#FCA5A5' : '#8B2635') : (darkMode ? '#64748B' : '#6B7280'),
        transition: 'all 0.15s',
        flexShrink: 0
      }}
    >{confirming ? 'Delete?' : '\uD83D\uDDD1'}</button>
  );
}

export default React.memo(function StatusToggle({ value, onChange, onDelete, darkMode, compact, isMobile, taskType }) {
  var size = compact ? 16 : (isMobile ? 28 : 22);
  var fontSize = compact ? 8 : (isMobile ? 14 : 12);

  // Filter statuses based on task type
  var statuses = ALL_STATUSES;
  if (taskType === 'recurring_template') {
    // Templates can only be paused or unpaused
    statuses = ALL_STATUSES.filter(function(s) { return s.value === '' || s.value === 'pause'; });
  } else if (taskType === 'recurring_instance') {
    // Instances can't be paused — pause is template-level
    statuses = ALL_STATUSES.filter(function(s) { return s.value !== 'pause'; });
  }

  return (
    <div style={{ display: 'flex', gap: compact ? 1 : 3, alignItems: 'center' }}>
      {statuses.map(function(s) {
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
      {onDelete && <DeleteButton onDelete={onDelete} size={size} fontSize={fontSize} darkMode={darkMode} compact={compact} isMobile={isMobile} />}
    </div>
  );
})
