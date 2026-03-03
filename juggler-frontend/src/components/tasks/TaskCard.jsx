/**
 * TaskCard — card for list/priority/conflicts views
 * Styled to match ScheduleCard from calendar view:
 *   Row 1: title + project badge + duration badge
 *   Row 2: status toggle buttons + spacer + metadata badges
 */

import React from 'react';
import { PRI_COLORS, locIcon } from '../../state/constants';
import { getTheme } from '../../theme/colors';
import StatusToggle from '../schedule/StatusToggle';

export default function TaskCard({ task, status, direction, onStatusChange, onExpand, darkMode, showDate, draggable, isBlocked, isMobile }) {
  var theme = getTheme(darkMode);
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';
  var durLabel = task.dur ? (task.dur >= 60 ? Math.round(task.dur / 60 * 10) / 10 + 'h' : task.dur + 'm') : '';

  return (
    <div
      draggable={draggable || false}
      onDragStart={draggable ? function(e) { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      onClick={function() { if (onExpand) onExpand(task.id); }}
      style={{
        borderRadius: 6, cursor: 'pointer', overflow: 'hidden',
        background: isDone ? (darkMode ? '#1E293B' : '#F8FAFC') : (darkMode ? '#1E293B' : '#FFFFFF'),
        border: '1px ' + (task.habit ? 'dashed' : 'solid') + ' ' + (isDone ? theme.border : priColor + '40'),
        borderLeft: '3px solid ' + priColor,
        opacity: isDone ? 0.5 : 1,
        padding: isMobile ? '8px 10px' : '6px 10px',
        boxShadow: '0 1px 3px ' + theme.shadow,
        transition: 'box-shadow 0.15s'
      }}
    >
      {/* Row 1: title + project + duration */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: isMobile ? 13 : 12, lineHeight: 1.3
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
            borderRadius: 3, padding: '1px 5px'
          }}>
            {task.project}
          </span>
        )}
        {durLabel && (
          <span style={{
            fontSize: 10, flexShrink: 0, fontWeight: 600,
            color: darkMode ? '#94A3B8' : '#64748B',
            background: darkMode ? '#334155' : '#F1F5F9',
            borderRadius: 3, padding: '1px 5px'
          }}>
            {durLabel}
          </span>
        )}
      </div>

      {/* Row 2: status toggles + metadata */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        {onStatusChange && (
          <span onClick={function(e) { e.stopPropagation(); }}>
            <StatusToggle value={status} onChange={onStatusChange} darkMode={darkMode} isMobile={isMobile} />
          </span>
        )}
        <div style={{ flex: 1 }} />
        {showDate && task.date && task.date !== 'TBD' && (
          <span style={{
            fontSize: 9, fontWeight: 600,
            color: darkMode ? '#94A3B8' : '#64748B',
            background: darkMode ? '#334155' : '#F1F5F9',
            borderRadius: 3, padding: '1px 4px'
          }}>
            {task.date}
          </span>
        )}
        {task.time && (
          <span style={{ fontSize: 9, color: darkMode ? '#94A3B8' : '#64748B' }}>
            {task.time}
          </span>
        )}
        {task.location && task.location.length > 0 && (function() {
          var icons = task.location.map(function(lid) { return locIcon(lid); }).filter(Boolean);
          return icons.length > 0 ? <span style={{ fontSize: 10 }}>{icons.join(' ')}</span> : null;
        })()}
        {task.due && (
          <span style={{
            fontSize: 9, fontWeight: 600,
            color: darkMode ? '#FCD34D' : '#B45309',
            background: darkMode ? '#422006' : '#FEF3C7',
            borderRadius: 3, padding: '1px 4px'
          }}>
            Due {task.due}
          </span>
        )}
        {isBlocked && <span style={{ color: '#EF4444', fontSize: 11 }}>{'\uD83D\uDEAB'}</span>}
        {task.pri && (
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: priColor,
            background: priColor + '18',
            borderRadius: 3, padding: '0 4px'
          }}>
            {task.pri}
          </span>
        )}
        {status === 'wip' && task.timeRemaining != null && (
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: darkMode ? '#FCD34D' : '#B45309',
            background: darkMode ? '#422006' : '#FEF3C7',
            borderRadius: 3, padding: '1px 5px'
          }}>
            {task.timeRemaining}m left
          </span>
        )}
        {status === 'other' && direction && (
          <span style={{ fontSize: 9, color: darkMode ? '#C4B5FD' : '#7C3AED', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {'\u2192'} {direction}
          </span>
        )}
      </div>
    </div>
  );
}
