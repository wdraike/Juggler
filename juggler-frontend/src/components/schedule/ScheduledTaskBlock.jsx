/**
 * ScheduledTaskBlock — absolute-positioned task block in calendar grid
 */

import React from 'react';
import { GRID_START, PRI_COLORS, STATUS_MAP, locIcon, WHEN_TAG_ICONS, isTerminalStatus } from '../../state/constants';
import { parseWhen } from '../../scheduler/timeBlockHelpers';
import TaskStatusSelect from '../tasks/TaskStatusSelect';
import { getTheme } from '../../theme/colors';

export default function ScheduledTaskBlock({ item, status, gridZoom, gutter, hasBubbles, onStatusChange, onExpand, darkMode, isBlocked, isMobile }) {
  var theme = getTheme(darkMode);
  var task = item.task;
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';
  var top = ((item.start - GRID_START * 60) / 60) * gridZoom;
  var height = Math.max((item.dur / 60) * gridZoom - 2, 18);
  var GUTTER = gutter || (isMobile ? 40 : 72);
  var cols = item.cols || 1;
  // When bubbles exist, blocks get the left 50%; otherwise blocks get 60%
  var regionPct = hasBubbles ? 50 : 60;
  var colWidth = regionPct / cols;

  var statusInfo = STATUS_MAP[status] || STATUS_MAP[''];

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onExpand}
      style={{
        position: 'absolute',
        top: top,
        left: `calc(${GUTTER}px + ${(item.col || 0) * colWidth}%)`,
        width: `calc(${colWidth}% - 4px)`,
        height: height,
        borderRadius: 6,
        padding: '2px 6px',
        cursor: 'pointer',
        background: isDone ? theme.badgeBg : theme.bgCard,
        border: `1px ${task.recurring ? 'dashed' : 'solid'} ${isDone ? theme.border : priColor}`,
        borderLeft: `3px solid ${priColor}`,
        overflow: 'hidden',
        opacity: isDone ? 0.5 : 1,
        zIndex: item.locked ? 10 : 20,
        fontSize: isMobile ? 10 : 11,
        lineHeight: 1.3,
        transition: 'box-shadow 0.15s',
        boxShadow: `0 1px 3px ${theme.shadow}`
      }}
    >
      <div style={{
        fontWeight: 600, color: theme.text,
        textDecoration: isDone ? 'line-through' : 'none',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        display: 'flex', alignItems: 'center', gap: 3
      }}>
        {onStatusChange && (
          <span onClick={e => e.stopPropagation()} style={{ flexShrink: 0, fontSize: 10 }}>
            <TaskStatusSelect value={status} onChange={onStatusChange} darkMode={darkMode} />
          </span>
        )}
        {task.location?.length > 0 && (function() { var ic = task.location.map(lid => locIcon(lid)).filter(Boolean); return ic.length > 0 ? <span style={{ fontSize: 9, marginRight: 2 }}>{ic.join('')}</span> : null; })()}
        {task.prevWhen != null && <span title="Pinned by drag — click to unpin" style={{ fontSize: 9, flexShrink: 0 }}>{'\uD83D\uDCCC'}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.text}</span>
      </div>
      {height > 24 && (
        <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 1 }}>
          {task.project && <span>{task.project} </span>}
          {item.splitPart && <span>Part {item.splitPart}/{item.splitTotal} </span>}
          {task.dur}m
          {status === 'wip' && task.timeRemaining != null && <span style={{ color: theme.amberText, fontWeight: 600 }}> {task.timeRemaining}m left</span>}
          {isBlocked && <span style={{ color: theme.redText }}> &#x1F6AB;</span>}
          {task.location?.length > 0 && (function() { var ic = task.location.map(lid => locIcon(lid)).filter(Boolean); return ic.length > 0 ? <span> {ic.join('')}</span> : null; })()}
          {task.when && task.when !== 'anytime' && <span> {parseWhen(task.when).map(t => WHEN_TAG_ICONS[t] || '').join('')}</span>}
        </div>
      )}
    </div>
  );
}
