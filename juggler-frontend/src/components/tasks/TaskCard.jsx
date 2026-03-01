/**
 * TaskCard — compact card for list/grid views
 */

import React from 'react';
import { PRI_COLORS, locIcon, WHEN_TAG_ICONS } from '../../state/constants';
import { parseWhen } from '../../scheduler/timeBlockHelpers';
import TaskStatusSelect from './TaskStatusSelect';
import { getTheme } from '../../theme/colors';

export default function TaskCard({ task, status, direction, onStatusChange, onExpand, darkMode, showDate, draggable, isBlocked }) {
  var theme = getTheme(darkMode);
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';

  return (
    <div
      draggable={draggable || false}
      onDragStart={draggable ? (e => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; }) : undefined}
      onClick={() => onExpand && onExpand(task.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        borderRadius: 8, cursor: 'pointer', fontSize: 13,
        background: theme.card, border: `1px ${task.habit ? 'dashed' : 'solid'} ${theme.border}`,
        opacity: isDone ? 0.5 : 1, transition: 'background 0.15s',
        borderLeft: `3px solid ${priColor}`
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
        <TaskStatusSelect value={status} onChange={onStatusChange} darkMode={darkMode} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: theme.text, fontWeight: 500,
          textDecoration: isDone ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {task.text}
        </div>
        <div style={{ display: 'flex', gap: 6, fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
          {task.project && <span>{task.project}</span>}
          {showDate && task.date && <span>{task.date}</span>}
          {task.time && <span>{task.time}</span>}
          {task.dur && <span>{task.dur}m</span>}
          {task.due && <span style={{ color: '#F59E0B' }}>Due {task.due}</span>}
          {task.location?.length > 0 && <span>{task.location.map(lid => locIcon(lid)).join('')}</span>}
          {task.when && task.when !== 'anytime' && <span>{parseWhen(task.when).map(t => WHEN_TAG_ICONS[t] || '').join('')}</span>}
          {task.habit && <span>&#x1F504;</span>}
          {task.dependsOn?.length > 0 && <span>&#x1F517;{task.dependsOn.length}</span>}
          {isBlocked && <span title="Blocked by dependencies" style={{ color: '#EF4444' }}>&#x1F6AB;</span>}
        </div>
      </div>

      {status === 'wip' && task.timeRemaining != null && (
        <div style={{
          fontSize: 10, fontWeight: 600, color: '#92400E',
          background: '#FEF3C7', borderRadius: 8, padding: '1px 6px',
          flexShrink: 0
        }}>
          {task.timeRemaining}m left
        </div>
      )}

      {status === 'other' && direction && (
        <div style={{ fontSize: 10, color: '#7C3AED', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          &#x2192; {direction}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: priColor, fontWeight: 700 }}>{task.pri}</div>
        <div style={{ fontSize: 8, color: theme.textMuted, fontFamily: 'monospace', opacity: 0.6 }}>{(task.id || '').slice(0, 8)}</div>
      </div>
    </div>
  );
}
