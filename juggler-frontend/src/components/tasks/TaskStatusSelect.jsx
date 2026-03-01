/**
 * TaskStatusSelect — dropdown for task status
 */

import React from 'react';
import { STATUS_OPTIONS } from '../../state/constants';

export default function TaskStatusSelect({ value, onChange, darkMode }) {
  var current = STATUS_OPTIONS.find(s => s.value === (value || '')) || STATUS_OPTIONS[0];

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        title={current.tip}
        style={{
          appearance: 'none', border: 'none', borderRadius: 4,
          padding: '2px 6px', fontSize: 14, cursor: 'pointer',
          background: current.bg, color: current.color,
          fontFamily: 'inherit', fontWeight: 600, textAlign: 'center',
          minWidth: 28
        }}
      >
        {STATUS_OPTIONS.map(s => (
          <option key={s.value} value={s.value}>{s.label} {s.tip}</option>
        ))}
      </select>
    </div>
  );
}
