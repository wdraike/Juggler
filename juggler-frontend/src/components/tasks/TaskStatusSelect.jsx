/**
 * TaskStatusSelect — dropdown for task status
 */

import React from 'react';
import { STATUS_OPTIONS } from '../../state/constants';

// juggler-cal-history Plan C — D-15: terminal transitions require scheduled_at.
// Disable done/skip/cancel options when the task has no scheduled time. Backend 400 guard
// is the source of truth; this is the UX nicety.
var TERMINAL_REQUIRES_SCHEDULE = ['done', 'skip', 'cancel'];

export default function TaskStatusSelect({ value, onChange, darkMode, isMobile, disableTerminal }) {
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
        {STATUS_OPTIONS.map(s => {
          var isGated = !!disableTerminal && TERMINAL_REQUIRES_SCHEDULE.indexOf(s.value) !== -1;
          return (
            <option
              key={s.value}
              value={s.value}
              disabled={isGated}
            >{s.label} {isGated ? s.tip + ' — schedule task first' : s.tip}</option>
          );
        })}
      </select>
    </div>
  );
}
