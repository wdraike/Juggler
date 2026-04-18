/**
 * ScheduleCard — fixed-height card that fills available width.
 * Row 1: priority dot + title + duration + project badge
 * Row 2: status toggles + location + blocked + priority badge
 */

import React from 'react';
import { PRI_COLORS, locIcon, WHEN_TAG_ICONS, DEFAULT_TOOLS, isTerminalStatus } from '../../state/constants';
import { getTheme } from '../../theme/colors';
import { parseWhen } from '../../scheduler/timeBlockHelpers';
import StatusToggle from './StatusToggle';

var TOOL_ICON_MAP = {};
DEFAULT_TOOLS.forEach(function(t) { TOOL_ICON_MAP[t.id] = t.icon; });

function formatStartTime(mins) {
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  var ampm = h >= 12 ? 'pm' : 'am';
  var h12 = h % 12 || 12;
  return h12 + (m > 0 ? ':' + (m < 10 ? '0' : '') + m : '') + ampm;
}

export default React.memo(function ScheduleCard({ item, status, onStatusChange, onDelete, onExpand, darkMode, isBlocked, isMobile, layoutMode, cardHeight }) {
  var theme = getTheme(darkMode);
  var task = item.task;
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = isTerminalStatus(status);
  var compact = layoutMode === 'compact';
  var showDetails = !compact && (cardHeight || 52) >= 60;
  var containerStyle = React.useMemo(function() {
    return {
      width: '100%', height: '100%', borderRadius: 6, overflow: 'hidden',
      background: theme.bgCard,
      border: '1px ' + (task.recurring ? 'dashed' : 'solid') + ' ' + (isDone ? theme.border : priColor + '40'),
      borderLeft: '3px solid ' + priColor,
      cursor: 'pointer', opacity: isDone ? 0.5 : 1,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: compact ? '3px 6px' : (isMobile ? '4px 6px' : '4px 8px'),
      boxShadow: '0 1px 3px ' + theme.shadow, boxSizing: 'border-box'
    };
  }, [theme, task.recurring, isDone, priColor, compact, isMobile]);
  var durLabel = item.splitTotal > 1
    ? item.dur + ' of ' + task.dur + 'm'
    : (task.dur >= 60 ? Math.round(task.dur / 60 * 10) / 10 + 'h' : task.dur + 'm');
  var statusIcon = status === 'done' ? '\u2713' : status === 'wip' ? '\u231B' : status === 'cancel' ? '\u2715' : status === 'skip' ? '\u21ED' : status === 'pause' ? '\u23F8' : null;
  var startLabel = item.start != null ? formatStartTime(item.start) : null;
  var typeBadges = [];
  if (task.datePinned) typeBadges.push({ icon: '\uD83D\uDCCD', title: 'Date pinned \u2014 stays on this date, scheduler adjusts time only' });
  if (task.recurring) typeBadges.push({ icon: '\uD83D\uDD01', title: 'Recurring \u2014 recurring daily task' });
  if (task.rigid || task.fixed) typeBadges.push({ icon: '\uD83D\uDCCC', title: 'Rigid \u2014 locked to set date and time, scheduler won\u2019t move it' });
  if (item.splitTotal > 1) typeBadges.push({ icon: '\u2702\uFE0F', title: 'Split \u2014 broken into ' + item.splitTotal + ' chunks' });

  // Build end time label
  var endLabel = item.start != null ? formatStartTime(item.start + item.dur) : null;
  var timeRange = startLabel && endLabel ? startLabel + '\u2013' + endLabel : null;

  // Build details snippets for row 3 (memoized to avoid recomputation)
  var details = React.useMemo(function() {
    var d = [];
    if (item._moveReason) d.push('\u2192 ' + item._moveReason);
    else if (item.placementReason) d.push(item.placementReason);
    else if (item._placementReason) d.push(item._placementReason);
    if (task.recurring && task.time && startLabel && task.time !== startLabel) {
      d.push('Preferred: ' + task.time);
    }
    if (showDetails) {
      if (timeRange) d.push('\u23F0 ' + timeRange);
      if (task.location && task.location.length > 0) {
        var li = task.location.map(function(lid) { return locIcon(lid); }).filter(Boolean);
        if (li.length > 0) d.push(li.join(' '));
      }
      if (task.when && task.when !== 'anytime') {
        var wp = parseWhen(task.when);
        var wi = wp.map(function(w) { return WHEN_TAG_ICONS[w] || ''; }).filter(Boolean);
        if (wi.length > 0) d.push(wi.join(''));
      }
      if (task.tools && task.tools.length > 0) {
        var ti = task.tools.map(function(tid) { return TOOL_ICON_MAP[tid] || ''; }).filter(Boolean);
        if (ti.length > 0) d.push(ti.join(' '));
      }
      if (task.date) d.push('\uD83D\uDCC6 ' + task.date);
      if (task.deadline && task.deadline !== task.date) d.push('\uD83D\uDCC5 deadline ' + task.deadline);
      if (task.notes) d.push(task.notes.replace(/\n/g, ' ').substring(0, 40));
      if (task.dependsOn && task.dependsOn.length > 0) d.push('\u26D3 ' + task.dependsOn.length + ' dep');
    }
    return d;
  }, [item, task, startLabel, timeRange, showDetails]);

  return (
    <div
      draggable
      onDragStart={function(e) { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onExpand}
      style={containerStyle}
    >
      {/* Row 1: title + duration + project */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: compact ? 10 : (isMobile ? 11 : 12), lineHeight: 1.2
      }}>
        <span style={{
          flex: 1, fontWeight: 600, color: theme.text,
          overflow: 'hidden', textDecoration: isDone ? 'line-through' : 'none',
          ...(isMobile && !compact ? {
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            whiteSpace: 'normal', lineHeight: 1.3
          } : {
            whiteSpace: 'nowrap', textOverflow: 'ellipsis'
          })
        }}>
          {task.text}
        </span>
        {task.project && (
          <span style={{
            fontSize: 9, flexShrink: 0, fontWeight: 600,
            background: theme.projectBadgeBg,
            color: theme.projectBadgeText,
            borderRadius: 3, padding: '0 4px'
          }}>
            {task.project}
          </span>
        )}
        <span style={{
          fontSize: compact ? 8 : 10, flexShrink: 0, fontWeight: 600,
          color: theme.badgeText,
          background: theme.badgeBg,
          borderRadius: 3, padding: '1px 4px'
        }}>
          {durLabel}
        </span>
      </div>

      {/* Row 2: status + start time + type badges + metadata */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: compact ? 1 : 3 }}>
        {compact ? (
          <span style={{ fontSize: 10, color: theme.badgeText, fontWeight: 700, display: 'flex', gap: 3, alignItems: 'center' }}>
            {statusIcon && <span>{statusIcon}</span>}
            {startLabel && <span style={{ fontSize: 9, fontWeight: 600, color: theme.textMuted }}>{startLabel}</span>}
            {isBlocked && <span style={{ color: theme.redText }} title="Blocked \u2014 waiting on incomplete dependencies">{'\uD83D\uDEAB'}</span>}
          </span>
        ) : (
          <>
            {onStatusChange && <StatusToggle value={status} onChange={onStatusChange} onDelete={onDelete} darkMode={darkMode} isMobile={isMobile} />}
            {startLabel && <span style={{ fontSize: 9, fontWeight: 600, color: theme.textMuted }}>{startLabel}</span>}
            <div style={{ flex: 1 }} />
            {typeBadges.length > 0 && (
              <span style={{ fontSize: 9, display: 'flex', gap: 1, alignItems: 'center' }}>
                {typeBadges.map(function(b, i) { return <span key={i} title={b.title}>{b.icon}</span>; })}
              </span>
            )}
            {task.location && task.location.length > 0 && (function() {
              var icons = task.location.map(function(lid) { return locIcon(lid); }).filter(Boolean);
              return icons.length > 0 ? <span style={{ fontSize: 10 }}>{icons.join(' ')}</span> : null;
            })()}
            {isBlocked && <span style={{ color: theme.redText, fontSize: 11 }} title="Blocked \u2014 waiting on incomplete dependencies">{'\uD83D\uDEAB'}</span>}
            {task.pri && (
              <span title={'Priority ' + task.pri} style={{
                fontSize: 9, fontWeight: 700,
                color: priColor,
                background: priColor + '18',
                borderRadius: 3, padding: '0 3px'
              }}>
                {task.pri}
              </span>
            )}
            {status === 'wip' && task.timeRemaining != null && (
              <span style={{ fontSize: 9, fontWeight: 700, color: theme.amberText }}>
                {task.timeRemaining}m left
              </span>
            )}
          </>
        )}
      </div>

      {/* Row 3: notes / due / details */}
      {details.length > 0 && (
        <div style={{
          fontSize: 9, color: theme.textMuted, marginTop: 1,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          lineHeight: 1.3, opacity: 0.75
        }}>
          {details.join(' \u00B7 ')}
        </div>
      )}
    </div>
  );
})
