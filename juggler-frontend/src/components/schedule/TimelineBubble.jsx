/**
 * TimelineBubble — small task rendered as a bubble on the timeline centerline
 * Positioned inside a container where 50% = centerline
 */

import React from 'react';
import { PRI_COLORS } from '../../state/constants';
import TaskStatusSelect from '../tasks/TaskStatusSelect';
import { getTheme } from '../../theme/colors';

var DOT_SIZE = 6;

export default function TimelineBubble({ item, status, side, topPx, onStatusChange, onExpand, darkMode, isBlocked, isMobile }) {
  var theme = getTheme(darkMode);
  var task = item.task;
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = status === 'done' || status === 'cancel' || status === 'skip';

  var STEM_LEN = isMobile ? 12 : 24;
  var BUBBLE_W = isMobile ? 80 : 120;
  var BUBBLE_H = 32;

  // All positions use calc(50% +/- offset) so centerline = 50% of container
  var dotLeft = 'calc(50% - ' + (DOT_SIZE / 2) + 'px)';

  var stemLeft = side === 'left'
    ? 'calc(50% - ' + (STEM_LEN + DOT_SIZE / 2) + 'px)'
    : 'calc(50% + ' + (DOT_SIZE / 2) + 'px)';

  var bubbleLeft = side === 'left'
    ? 'calc(50% - ' + (STEM_LEN + BUBBLE_W + DOT_SIZE / 2) + 'px)'
    : 'calc(50% + ' + (DOT_SIZE / 2 + STEM_LEN) + 'px)';

  return (
    <div style={{ position: 'absolute', top: topPx, left: 0, right: 0, height: BUBBLE_H, zIndex: 30, pointerEvents: 'none' }}>
      {/* Dot on centerline */}
      <div style={{
        position: 'absolute',
        left: dotLeft,
        top: BUBBLE_H / 2 - DOT_SIZE / 2,
        width: DOT_SIZE, height: DOT_SIZE,
        borderRadius: '50%',
        background: priColor,
        pointerEvents: 'none'
      }} />

      {/* Stem */}
      <div style={{
        position: 'absolute',
        left: stemLeft,
        top: BUBBLE_H / 2 - 1,
        width: STEM_LEN,
        height: 2,
        background: priColor,
        opacity: 0.5,
        pointerEvents: 'none'
      }} />

      {/* Bubble card */}
      <div
        draggable
        onDragStart={e => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; }}
        onClick={onExpand}
        style={{
          position: 'absolute',
          left: bubbleLeft,
          top: 0,
          width: BUBBLE_W,
          height: BUBBLE_H,
          borderRadius: 8,
          background: isDone ? theme.badgeBg : theme.bgCard,
          border: '1px ' + (task.habit ? 'dashed' : 'solid') + ' ' + (isDone ? theme.border : priColor),
          borderLeft: side === 'left' ? undefined : '3px solid ' + priColor,
          borderRight: side === 'right' ? undefined : '3px solid ' + priColor,
          opacity: isDone ? 0.5 : 1,
          boxShadow: '0 1px 4px ' + theme.shadow,
          cursor: 'pointer',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          padding: '0 6px',
          fontSize: isMobile ? 9 : 10,
          lineHeight: 1.3,
          pointerEvents: 'auto'
        }}
      >
        {onStatusChange && (
          <span onClick={e => e.stopPropagation()} style={{ flexShrink: 0, fontSize: 9 }}>
            <TaskStatusSelect value={status} onChange={onStatusChange} darkMode={darkMode} />
          </span>
        )}
        <span style={{
          flex: 1, fontWeight: 600, color: theme.text,
          textDecoration: isDone ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          marginLeft: 3
        }}>
          {task.text}
        </span>
        <span style={{ flexShrink: 0, fontSize: 8, color: theme.textMuted, marginLeft: 3 }}>
          {task.dur}m
          {task.project && <span> {task.project}</span>}
          {isBlocked && <span style={{ color: theme.redText }}> &#x1F6AB;</span>}
        </span>
      </div>
    </div>
  );
}
