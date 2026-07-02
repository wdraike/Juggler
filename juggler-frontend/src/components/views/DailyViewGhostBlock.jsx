/**
 * DailyViewGhostBlock — the unscheduled-but-desired-time ghost tile
 * (GhostBlock) extracted verbatim from DailyView.jsx (999.965
 * JUG-PERF-FE-GOD-COMPONENTS split, WBS W4). No logic changes — see
 * TRACEABILITY.md B5.
 */

import React from 'react';
import { PRI_COLORS } from '../../state/constants';
import { getTaskIcon } from '../../utils/taskIcon';
import { minsToTime, durLabel } from './dailyViewHelpers';

/* ── Ghost block — unscheduled task shown at its intended desiredAt time ── */
export default function GhostBlock({ task, top, height, startMins, gutterW, onExpand, theme, isMobile }) {
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  return (
    <div
      style={{
        position: 'absolute',
        top: top,
        height: Math.max(height, 18),
        left: gutterW,
        right: 0,
        zIndex: 8,
        pointerEvents: 'auto',
        cursor: 'pointer',
        opacity: 0.5,
        borderLeft: '3px dashed ' + priColor,
        border: '1px dashed ' + priColor + '70',
        borderLeftWidth: 3,
        borderLeftColor: priColor,
        borderRadius: 4,
        padding: '2px 6px',
        background: 'repeating-linear-gradient(45deg,' + priColor + '0C,' + priColor + '0C 4px,transparent 4px,transparent 8px)',
        display: 'flex', alignItems: 'flex-start', gap: 4, overflow: 'hidden',
        boxSizing: 'border-box'
      }}
      onClick={function () { onExpand(task.id); }}
      title={'Couldn\'t schedule — intended ' + minsToTime(startMins)}
    >
      <span style={{ fontSize: 9, flexShrink: 0, color: priColor }}>⚠</span>
      <span style={{ fontSize: isMobile ? 9 : 10, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {(function(){ var ic = getTaskIcon(task.text); return ic ? <span style={{marginRight:2,flexShrink:0}}>{ic}</span> : null; })()}{task.text}
      </span>
      {task.dur > 0 && <span style={{ fontSize: 8, color: theme.textMuted, flexShrink: 0 }}>{durLabel(task.dur)}</span>}
    </div>
  );
}
