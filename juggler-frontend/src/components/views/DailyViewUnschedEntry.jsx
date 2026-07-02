/**
 * DailyViewUnschedEntry — the unscheduled task row (UnschedEntry) extracted
 * verbatim from DailyView.jsx (999.965 JUG-PERF-FE-GOD-COMPONENTS split,
 * WBS W4). No logic changes — see TRACEABILITY.md B4.
 */

import React, { useState, useRef } from 'react';
import { PRI_COLORS, PAST_OPACITY } from '../../state/constants';
import { isTerminalStatus } from '../../shared/task-status';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { getTaskIcon } from '../../utils/taskIcon';
import { isTaskOverdue } from '../../utils/overdue';
import StatusToggle from '../schedule/StatusToggle';
import UnplacedReason from './UnplacedReason';
import FixedPopup from './DailyViewPopup';
import { durLabel, tileBg, getStatusReason } from './dailyViewHelpers';

/* ── Unscheduled task entry ── */
export default function UnschedEntry({ task, status, onExpand, onStatusChange, onDelete, theme, darkMode, isMobile, canDrag }) {
  var priColor = PRI_COLORS[task.pri] || PRI_COLORS.P3;
  var isDone = isTerminalStatus(status);
  // sched-audit REG-43/F2 — single source of truth for "is this overdue?" (utils/overdue.js),
  // mirrors DailyViewTaskBlock.jsx's OVERDUE badge so the two lists never disagree.
  var isOverdue = isTaskOverdue(task, isDone);
  // juggler-cal-history Plan E — past-fade (D-10).
  var ueTodayKey = formatDateKey(new Date());
  var ueIsPast = !!task.scheduledAt && formatDateKey(new Date(task.scheduledAt)) < ueTodayKey;
  var [show, setShow] = useState(false);
  var ref = useRef(null);
  var [mousePos, setMousePos] = useState(null);
  var [cardRect, setCardRect] = useState(null);

  return (
    <div
      draggable={!!canDrag && !task.calLocked}
      onDragStart={(canDrag && !task.calLocked) ? function (e) { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
    >
      <div
        ref={ref}
        tabIndex={0} role="button"
        onClick={function () { onExpand(task.id); }}
        onMouseEnter={function(e) { setShow(true); setMousePos({ x: e.clientX, y: e.clientY }); if (ref.current) setCardRect(ref.current.getBoundingClientRect()); }}
        onMouseMove={function(e) { setMousePos({ x: e.clientX, y: e.clientY }); }}
        onMouseLeave={function() { setShow(false); setMousePos(null); setCardRect(null); }}
        onFocus={function() { setShow(true); if (ref.current) { var r = ref.current.getBoundingClientRect(); setMousePos({ x: r.left + r.width/2, y: r.top }); setCardRect(r); } }}
        onBlur={function() { setShow(false); setMousePos(null); setCardRect(null); }}
        onKeyDown={function (e) { if (e.key === 'Enter') onExpand(task.id); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: isMobile ? 10 : 11, padding: '4px 6px', borderRadius: 4,
          borderLeft: '3px solid ' + priColor,
          background: tileBg(task, darkMode, show, theme),
          color: isDone ? theme.textMuted : theme.text,
          textDecoration: isDone ? 'line-through' : 'none',
          // sched-audit L3 bird WARN-2 — cursor must reflect actual drag
          // gating: draggable is `!!canDrag && !task.calLocked` (below), so the
          // cursor affordance has to check calLocked too, not just canDrag.
          cursor: task.calLocked ? 'not-allowed' : (canDrag ? 'grab' : 'pointer'),
          outline: show ? '2px solid ' + theme.accent : 'none',
          outlineOffset: -1, transition: 'background 0.1s',
          // sched-audit L3 bird WARN-1 — mirror DailyViewTaskBlock's whole-tile
          // overdue border treatment here so the lane scans the same way as the
          // grid (a small inline badge alone lost the "whole-tile reads red"
          // at-a-glance signal).
          border: isOverdue
            ? ('1px solid ' + theme.error)
            : ('1px ' + (task.recurring ? 'dashed' : 'solid') + ' ' + (isDone ? theme.border : priColor + '30')),
          borderLeftWidth: 3, borderLeftColor: isOverdue ? theme.error : priColor,
          boxShadow: '0 1px 2px ' + theme.shadow,
          opacity: (isDone && ueIsPast) ? PAST_OPACITY : (isDone ? 0.5 : 1)
        }}
      >
        {(task.fixed || task.rigid || task.placementMode === 'fixed' || task.placement_mode === 'fixed') && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\uD83D\uDCCC'}</span>}
        {task.recurring && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\uD83D\uDD01'}</span>}
        {status === 'done' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2713'}</span>}
        {status === 'skip' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u23ED'}</span>}
        {status === 'cancel' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2717'}</span>}
        {status === 'cancelled' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2717'}</span>}
        {status === 'pause' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u23F8'}</span>}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(function(){ var ic = getTaskIcon(task.text); return ic ? <span style={{marginRight:2,flexShrink:0}}>{ic}</span> : null; })()}{task.text}
          {task._unplacedChunkCount > 1 && (
            <span style={{ fontSize: 9, color: theme.textMuted, marginLeft: 6 }}>
              ({task._unplacedChunkCount} chunks unplaced)
            </span>
          )}
        </span>
        {task.dur > 0 && <span style={{ fontSize: 9, color: theme.textMuted, flexShrink: 0 }}>{durLabel(task.dur)}</span>}
        {task.pri && <span style={{ fontSize: 8, fontWeight: 700, color: priColor, flexShrink: 0 }}>{task.pri}</span>}
        {task.calLocked && <span role="img" aria-label="Calendar-locked — cannot be dragged" title="Calendar-locked — cannot be dragged" style={{ fontSize: 10, flexShrink: 0 }}>{'🔒'}</span>}
        {isOverdue && (
          <span
            title="This task's scheduled window has passed — mark done/skip or reschedule."
            style={{
              fontSize: 8, fontWeight: 700, color: '#FDFAF5', background: theme.error,
              borderRadius: 3, padding: '0 4px', flexShrink: 0, whiteSpace: 'nowrap'
            }}
          >
            {'⚠'} OVERDUE
          </span>
        )}
        {onStatusChange && (
          <span onClick={function (e) { e.stopPropagation(); }}>
            {/* sched-audit D-B (REG-42/F1): unscheduled-lane rows ARE resolvable in
                place — no disableTerminal here (see StatusToggle.jsx guard comment). */}
            <StatusToggle value={status} onChange={onStatusChange} onDelete={onDelete ? function() { onDelete(task.id); } : null} darkMode={darkMode} compact hitSlop />
          </span>
        )}
      </div>
      {show && <FixedPopup mousePos={mousePos} item={{ task: task, start: null, end: null }} status={status} theme={theme} darkMode={darkMode} cardRect={cardRect} completedAt={task?.completedAt} statusReason={getStatusReason(task, status)} />}
      {/* Why this task is unscheduled — shown anywhere a task is surfaced as unscheduled. */}
      {!isDone && <UnplacedReason task={task} theme={theme} />}
    </div>
  );
}
