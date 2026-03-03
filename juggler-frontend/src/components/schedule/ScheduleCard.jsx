/**
 * ScheduleCard — fixed-height card that fills available width.
 * Row 1: priority dot + title + duration + project badge
 * Row 2: status toggles + location + blocked + priority badge
 */

import React from 'react';
import { PRI_COLORS, locIcon } from '../../state/constants';
import { getTheme } from '../../theme/colors';
import StatusToggle from './StatusToggle';

export default function ScheduleCard({ item, status, onStatusChange, onExpand, darkMode, isBlocked, isMobile, layoutMode }) {
  var theme = getTheme(darkMode);
  var task = item.task;
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';
  var compact = layoutMode === 'compact';
  var durLabel = task.dur >= 60 ? Math.round(task.dur / 60 * 10) / 10 + 'h' : task.dur + 'm';
  var statusIcon = status === 'done' ? '\u2713' : status === 'wip' ? '\u231B' : status === 'cancel' ? '\u2715' : status === 'skip' ? '\u21ED' : null;

  return (
    <div
      draggable
      onDragStart={function(e) { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onExpand}
      style={{
        width: '100%', height: '100%',
        borderRadius: 6, overflow: 'hidden',
        background: isDone ? (darkMode ? '#1E293B' : '#F8FAFC') : (darkMode ? '#1E293B' : '#FFFFFF'),
        border: '1px ' + (task.habit ? 'dashed' : 'solid') + ' ' + (isDone ? theme.border : priColor + '40'),
        borderLeft: '3px solid ' + priColor,
        cursor: 'pointer', opacity: isDone ? 0.5 : 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: compact ? '3px 6px' : '4px 8px',
        boxShadow: '0 1px 3px ' + theme.shadow,
        boxSizing: 'border-box'
      }}
    >
      {/* Row 1: title + duration + project */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: compact ? 10 : (isMobile ? 11 : 12), lineHeight: 1.2
      }}>
        <span style={{
          flex: 1, fontWeight: 600, color: theme.text,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          textDecoration: isDone ? 'line-through' : 'none'
        }}>
          {task.text}
        </span>
        {task.project && (
          <span style={{
            fontSize: 9, flexShrink: 0, fontWeight: 600,
            background: darkMode ? '#1E3A5F' : '#DBEAFE',
            color: darkMode ? '#93C5FD' : '#1E40AF',
            borderRadius: 3, padding: '0 4px'
          }}>
            {task.project}
          </span>
        )}
        <span style={{
          fontSize: compact ? 8 : 10, flexShrink: 0, fontWeight: 600,
          color: darkMode ? '#94A3B8' : '#64748B',
          background: darkMode ? '#334155' : '#F1F5F9',
          borderRadius: 3, padding: '1px 4px'
        }}>
          {durLabel}
        </span>
      </div>

      {/* Row 2: status + metadata */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: compact ? 1 : 3 }}>
        {compact ? (
          <span style={{ fontSize: 10, color: darkMode ? '#94A3B8' : '#475569', fontWeight: 700, display: 'flex', gap: 3, alignItems: 'center' }}>
            {statusIcon && <span>{statusIcon}</span>}
            {isBlocked && <span style={{ color: '#EF4444' }}>{'\uD83D\uDEAB'}</span>}
          </span>
        ) : (
          <>
            {onStatusChange && <StatusToggle value={status} onChange={onStatusChange} darkMode={darkMode} isMobile={isMobile} />}
            <div style={{ flex: 1 }} />
            {task.location && task.location.length > 0 && (function() {
              var icons = task.location.map(function(lid) { return locIcon(lid); }).filter(Boolean);
              return icons.length > 0 ? <span style={{ fontSize: 10 }}>{icons.join(' ')}</span> : null;
            })()}
            {isBlocked && <span style={{ color: '#EF4444', fontSize: 11 }}>{'\uD83D\uDEAB'}</span>}
            {task.pri && (
              <span style={{
                fontSize: 9, fontWeight: 700,
                color: priColor,
                background: priColor + '18',
                borderRadius: 3, padding: '0 3px'
              }}>
                {task.pri}
              </span>
            )}
            {status === 'wip' && task.timeRemaining != null && (
              <span style={{ fontSize: 9, fontWeight: 700, color: darkMode ? '#FCD34D' : '#B45309' }}>
                {task.timeRemaining}m left
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
