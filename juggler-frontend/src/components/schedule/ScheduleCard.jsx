/**
 * ScheduleCard — fixed-height card that fills available width.
 * Row 1: priority dot + title + duration + project badge
 * Row 2: status toggles + location + blocked + priority badge
 */

import React from 'react';
import './ScheduleCard.css';
import { PRI_COLORS, locIcon, WHEN_TAG_ICONS, DEFAULT_TOOLS, isTerminalStatus, PAST_OPACITY, STATUS_MAP } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';
import { getTaskIcon } from '../../utils/taskIcon';
import { checkWeatherMatch, hasWeatherRestrictions } from '../../utils/weatherMatch';
import { parseWhen } from '../../scheduler/timeBlockHelpers';
import { isTaskOverdue } from '../../utils/overdue';
import StatusToggle from './StatusToggle';
import { formatMinsCompact } from '../../utils/timezone';

var TOOL_ICON_MAP = {};
DEFAULT_TOOLS.forEach(function(t) { TOOL_ICON_MAP[t.id] = t.icon; });

// 999.1232: grid-cell card — shared compact dialect ('3:30p', was '3:30pm').
function formatStartTime(mins) {
  return formatMinsCompact(mins);
}

export default React.memo(function ScheduleCard({ item, status, splitProgress, onStatusChange, onDelete, onExpand, darkMode, isBlocked, isMobile, layoutMode, cardHeight, weatherDay }) {
  var theme = getTheme(darkMode);
  var task = item.task;
  var weatherResult = hasWeatherRestrictions(task) ? checkWeatherMatch(task, weatherDay) : null;
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = isTerminalStatus(status);
  var isCompletedLook = isDone;
  // juggler-cal-history Plan E — past-fade (D-10).
  var scTodayKey = formatDateKey(new Date());
  var scIsPast = !!task.scheduledAt && formatDateKey(new Date(task.scheduledAt)) < scTodayKey;
  var h = cardHeight != null ? cardHeight : 52;
  var size = h < 28 ? 'xs'
           : h < 48 ? 'sm'
           : h < 80 ? 'md'
           : 'lg';
  var compact = size === 'xs' || size === 'sm';
  var showDetails = size === 'lg';
  // Overdue: delegate to the SSOT predicate (utils/overdue.js) so this view
  // never disagrees with Calendar/Issues on whether a task is overdue.
  var isOverdue = isTaskOverdue(task, isDone);
  var containerStyle = React.useMemo(function() {
    var baseBorder = '1px ' + (task.recurring ? 'dashed' : 'solid') + ' ' + (isCompletedLook ? theme.border : priColor + '40');
    return {
      width: '100%', height: '100%', borderRadius: 6, overflow: 'hidden',
      background: theme.bgCard,
      border: isOverdue ? ('2px solid ' + theme.error) : baseBorder,
      borderLeft: isOverdue ? ('3px solid ' + theme.error) : ('3px solid ' + priColor),
      cursor: 'pointer', opacity: (isCompletedLook && scIsPast) ? PAST_OPACITY : (isCompletedLook ? 0.5 : 1),
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      boxShadow: '0 1px 3px ' + theme.shadow, boxSizing: 'border-box',
      position: 'relative'
    };
  }, [theme, task.recurring, isCompletedLook, scIsPast, priColor, isOverdue]);
  var durLabel = item.splitTotal > 1
    ? item.dur + ' of ' + task.dur + 'm'
    : (task.dur >= 60 ? Math.round(task.dur / 60 * 10) / 10 + 'h' : task.dur + 'm');
  // 999.1231: icon comes from the canonical descriptor table \u2014 the old inline
  // chain here was a third fork and rendered NOTHING for backend-set statuses
  // (missed/cancelled). Open ('') has no icon on the card.
  var statusIcon = (status && STATUS_MAP[status] && STATUS_MAP[status].icon) || null;
  var startLabel = item.start != null ? formatStartTime(item.start) : null;
  var typeBadges = [];
  if (task.recurring) typeBadges.push({ icon: '\uD83D\uDD01', title: 'Recurring — recurring daily task' });
  if (task.placementMode === 'fixed' || task.placement_mode === 'fixed') typeBadges.push({ icon: '\uD83D\uDCCC', title: 'Fixed — locked to set date and time, scheduler won\u2019t move it' });
  if (item.splitTotal > 1) typeBadges.push({ icon: '\u2702\uFE0F', title: 'Split — broken into ' + item.splitTotal + ' chunks' });

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
    // Overdue cards must always surface a reason, even on compact (non-'lg') cards
    // where the details block below is skipped — a bare badge with no context
    // leaves the user unable to tell why it's overdue.
    if (isOverdue && !showDetails) {
      var overdueReason = task.deadline || task.date;
      if (overdueReason) d.push('\uD83D\uDCC5 ' + overdueReason);
    }
    if (showDetails) {
      // timeRange is now shown inline in Row 2; no need to repeat in details.
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
      if (task.deadline && (task.deadline !== task.date || isOverdue)) d.push('\uD83D\uDCC5 deadline ' + task.deadline);
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
      className="sc-root"
      data-size={size}
      data-mobile={isMobile ? '1' : undefined}
      style={containerStyle}
    >
      {isOverdue && (
        <div style={{
          position: 'absolute', top: -1, left: -1,
          background: theme.error, color: '#FDFAF5',
          fontSize: 9, fontWeight: 700, padding: '1px 5px',
          borderRadius: '5px 0 5px 0', letterSpacing: 0.3,
          zIndex: 2, pointerEvents: 'none'
        }} title="This task's scheduled window has passed — mark done/skip or reschedule.">
          {'\u26A0'} OVERDUE
        </div>
      )}
      {/* Row 1: title + duration + project */}
      <div className="sc-row1" style={{
        display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.2
      }}>
        <span style={{
          flex: 1, minWidth: 0, fontWeight: 600, color: theme.text,
          overflow: 'hidden', textDecoration: isCompletedLook ? 'line-through' : 'none',
          ...(isMobile && !compact ? {
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            whiteSpace: 'normal', lineHeight: 1.3
          } : {
            whiteSpace: 'nowrap', textOverflow: 'ellipsis'
          })
        }}>
          {(function(){ var ic = getTaskIcon(task.text); return ic ? <span style={{marginRight:2,flexShrink:0}}>{ic}</span> : null; })()}{task.text}
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
        <span className="sc-dur-badge" style={{
          flexShrink: 0, fontWeight: 600,
          color: theme.badgeText,
          background: theme.badgeBg,
          borderRadius: 3, padding: '1px 4px'
        }}>
          {durLabel}
        </span>
        {weatherResult && (
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}
            title={weatherResult.ok === false ? weatherResult.reason : 'Forecast OK for this task'}>
            <span style={{ fontSize: 11, filter: weatherResult.ok ? 'drop-shadow(0 0 2px #2D9E6B88)' : 'none' }}>⛅</span>
            {weatherResult.ok === false && (
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#e05252', textShadow: '0 0 3px #1a1a1a', lineHeight: 1, pointerEvents: 'none' }}>⊘</span>
            )}
          </span>
        )}
      </div>

      {/* Row 2: status + start time + type badges + metadata */}
      <div className="sc-row2" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {compact ? (
          <span style={{ fontSize: 10, color: theme.badgeText, fontWeight: 700, display: 'flex', gap: 3, alignItems: 'center' }}>
            {statusIcon && <span>{statusIcon}</span>}
            {timeRange && <span style={{ fontSize: 9, fontWeight: 600, color: theme.textMuted, flexShrink: 0, whiteSpace: 'nowrap' }}>{timeRange}</span>}
            {isBlocked && <span style={{ color: theme.redText }} title="Blocked — waiting on incomplete dependencies">{'\uD83D\uDEAB'}</span>}
          </span>
        ) : (
          <>
            {onStatusChange && <StatusToggle value={status} onChange={onStatusChange} onDelete={onDelete} darkMode={darkMode} isMobile={isMobile} disableTerminal={!item.task.scheduledAt} />}
            {/* 999.1220: merged split card — done is chunk-only, so surface
                per-chunk progress ("1/3 done"); a done tap advances the next
                incomplete chunk. */}
            {splitProgress && splitProgress.total > 1 && (
              <span title={'Split progress — ' + splitProgress.done + ' of ' + splitProgress.total + ' chunks done; the ✓ button completes the next incomplete chunk'}
                style={{ fontSize: 9, fontWeight: 700, flexShrink: 0, color: theme.badgeText, background: theme.badgeBg, borderRadius: 3, padding: '0 3px' }}>
                {splitProgress.done + '/' + splitProgress.total + ' done'}
              </span>
            )}
            {timeRange && <span style={{ fontSize: 9, fontWeight: 600, color: theme.textMuted, flexShrink: 0 }}>{timeRange}</span>}
            <div style={{ flex: 1 }} />
            {typeBadges.length > 0 && (
              <span style={{ fontSize: 9, display: 'flex', gap: 1, alignItems: 'center' }}>
                {typeBadges.map(function(b, i) { return <span key={i} title={b.title}>{b.icon}</span>; })}
              </span>
            )}
            {task.url && /^https?:\/\//i.test(task.url) && (
              <a href={task.url} target="_blank" rel="noopener noreferrer"
                onClick={function(e) { e.stopPropagation(); }}
                title={'Open link: ' + task.url}
                style={{ fontSize: 10, textDecoration: 'none', color: theme.accent, cursor: 'pointer' }}>
                {'🔗'}
              </a>
            )}
            {task.location && task.location.length > 0 && (function() {
              var icons = task.location.map(function(lid) { return locIcon(lid); }).filter(Boolean);
              return icons.length > 0 ? <span style={{ fontSize: 10 }}>{icons.join(' ')}</span> : null;
            })()}
            {isBlocked && <span style={{ color: theme.redText, fontSize: 11 }} title="Blocked — waiting on incomplete dependencies">{'\uD83D\uDEAB'}</span>}
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
            {task.timeRemaining != null && (
              <span style={{ fontSize: 9, fontWeight: 700, color: theme.amberText }}>
                {task.timeRemaining}m left
              </span>
            )}
          </>
        )}
      </div>

      {/* Row 3: notes / due / details */}
      {details.length > 0 && (
        <div className="sc-details-row" style={{
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
