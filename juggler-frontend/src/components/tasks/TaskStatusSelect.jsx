/**
 * TaskStatusSelect — dropdown for task status
 */

import React from 'react';
import { STATUS_OPTIONS } from '../../state/constants';

export default function TaskStatusSelect({ value, onChange, darkMode, isMobile }) {
  var current = STATUS_OPTIONS.find(s => s.value === (value || '')) || STATUS_OPTIONS[0];
  var bg = darkMode ? current.bgDark : current.bg;
  var color = darkMode ? current.colorDark : current.color;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        title={current.tip}
        style={{
          appearance: 'none', border: 'none', borderRadius: 4,
          padding: isMobile ? '6px 10px' : '2px 6px',
          fontSize: isMobile ? 18 : 14, cursor: 'pointer',
          background: bg, color: color,
          fontFamily: 'inherit', fontWeight: 600, textAlign: 'center',
          minWidth: isMobile ? 44 : 28
        }}
      >
        {STATUS_OPTIONS.map(s => (
          <option key={s.value} value={s.value}>{s.label} {s.tip}</option>
        ))}
      </select>
    </div>
  );
}
