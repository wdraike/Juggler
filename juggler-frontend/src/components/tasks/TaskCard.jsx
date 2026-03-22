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
import { parseDate } from '../../scheduler/dateHelpers';

export default function TaskCard({ task, status, onStatusChange, onExpand, darkMode, showDate, draggable, isBlocked, isMobile, allTasks, statuses }) {
  var theme = getTheme(darkMode);
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';
  var isMarker = !!task.marker;
  var borderColor = isMarker ? '#4338CA' : priColor;
  var durLabel = task.dur ? (task.dur >= 60 ? Math.round(task.dur / 60 * 10) / 10 + 'h' : task.dur + 'm') : '';
  var isPastDue = !isDone && task.due && (function() { var d = parseDate(task.due); var t = new Date(); t.setHours(0,0,0,0); return d && d < t; })();

  return (
    <div
      draggable={draggable || false}
      onDragStart={draggable ? function(e) { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      onClick={function() { if (onExpand) onExpand(task.id); }}
      style={{
        borderRadius: 6, cursor: 'pointer', overflow: 'hidden',
        background: theme.bgCard,
        border: '1px ' + (isMarker ? 'dotted' : (task.habit ? 'dashed' : 'solid')) + ' ' + (isDone ? theme.border : borderColor + '40'),
        borderLeft: '3px solid ' + borderColor,
        opacity: isDone ? 0.5 : (isMarker ? 0.7 : 1),
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
            background: theme.projectBadgeBg,
            color: theme.projectBadgeText,
            borderRadius: 3, padding: '1px 5px'
          }}>
            {task.project}
          </span>
        )}
        {durLabel && (
          <span style={{
            fontSize: 10, flexShrink: 0, fontWeight: 600,
            color: theme.badgeText,
            background: theme.badgeBg,
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
            <StatusToggle value={status} onChange={function(val) { onStatusChange(task.id, val); }} darkMode={darkMode} isMobile={isMobile} />
          </span>
        )}
        <div style={{ flex: 1 }} />
        {showDate && task.date && task.date !== 'TBD' && (
          <span style={{
            fontSize: 9, fontWeight: 600,
            color: theme.badgeText,
            background: theme.badgeBg,
            borderRadius: 3, padding: '1px 4px'
          }}>
            {task.date}
          </span>
        )}
        {task.time && (
          <span style={{ fontSize: 9, color: theme.badgeText }}>
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
            color: isPastDue ? '#FDFAF5' : theme.amberText,
            background: isPastDue ? theme.error : theme.amberBg,
            borderRadius: 3, padding: '1px 4px'
          }}>
            {isPastDue ? 'OVERDUE ' : 'Due '}{task.due}
          </span>
        )}
        {isMarker && (
          <span style={{
            fontSize: 9, fontWeight: 600,
            background: theme.purpleBg,
            color: theme.purpleText,
            borderRadius: 3, padding: '1px 4px'
          }}>
            {'\u25C7'} reminder
          </span>
        )}
        {task._whenRelaxed && (
          <span style={{
            fontSize: 9, fontWeight: 600,
            background: theme.amberBg,
            color: theme.amberText,
            borderRadius: 3, padding: '1px 4px'
          }}>
            {'~'} flexed
          </span>
        )}
        {isBlocked && <span style={{ color: theme.redText, fontSize: 10, fontWeight: 600 }}>{'\uD83D\uDEAB'} blocked</span>}
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
            color: theme.amberText,
            background: theme.amberBg,
            borderRadius: 3, padding: '1px 5px'
          }}>
            {task.timeRemaining}m left
          </span>
        )}
      </div>

      {/* Blocker row: show overdue undone deps with quick-complete buttons */}
      {isBlocked && allTasks && statuses && task.dependsOn && task.dependsOn.length > 0 && (function() {
        var today = new Date(); today.setHours(0,0,0,0);
        var blockers = task.dependsOn.map(function(depId) {
          var s = statuses[depId] || '';
          if (s === 'done') return null;
          var dep = allTasks.find(function(t) { return t.id === depId; });
          if (!dep) return { id: depId, text: depId };
          var depDate = dep.date && dep.date !== 'TBD' ? parseDate(dep.date) : null;
          var depDue = dep.due ? parseDate(dep.due) : null;
          if ((depDate && depDate < today) || (depDue && depDue < today)) return dep;
          return null;
        }).filter(Boolean);
        if (blockers.length === 0) return null;
        return (
          <div style={{
            marginTop: 4, paddingTop: 4, borderTop: '1px dashed ' + theme.borderLight,
            fontSize: isMobile ? 11 : 10, color: theme.textMuted,
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4
          }}>
            <span style={{ fontWeight: 600, color: theme.redText, flexShrink: 0 }}>Overdue dep:</span>
            {blockers.map(function(dep) {
              return (
                <span key={dep.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <span
                    onClick={function(e) { e.stopPropagation(); if (onExpand) onExpand(dep.id); }}
                    style={{
                      cursor: 'pointer', fontWeight: 600,
                      color: theme.projectBadgeText,
                      textDecoration: 'underline', textDecorationStyle: 'dotted'
                    }}
                  >
                    {dep.text}
                  </span>
                  {onStatusChange && (
                    <button
                      onClick={function(e) {
                        e.stopPropagation();
                        onStatusChange(dep.id, 'done');
                      }}
                      style={{
                        fontSize: isMobile ? 10 : 9, fontWeight: 600, padding: '0 5px', borderRadius: 3,
                        border: '1px solid ' + theme.greenBorder,
                        background: theme.greenBg,
                        color: theme.greenText,
                        cursor: 'pointer', fontFamily: 'inherit', lineHeight: '16px'
                      }}
                      title={'Mark "' + dep.text + '" as done'}
                    >
                      Done
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
