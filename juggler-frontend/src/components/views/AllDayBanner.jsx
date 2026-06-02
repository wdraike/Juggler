/**
 * AllDayBanner — shared all-day task banner for DayView, DailyView,
 * WeekView, and ThreeDayView.
 *
 * Renders a muted full-width banner row above the timed CalendarGrid.
 * Returns null when there are no all-day items for the given dateKey.
 *
 * Supports multiday all-day tasks: shows tasks where dateKey falls within
 * the task's date range [date, endDate].
 *
 * Props:
 *   allTasks   — full task list (filtered internally by dateKey + isAllDayTask)
 *   dateKey    — ISO date string (e.g. "2026-05-18")
 *   statuses   — { [taskId]: statusString } map
 *   onExpand   — fn(taskId) called on chip click
 *   darkMode   — bool
 *   isPastDay  — bool (default false); when true + done, applies PAST_OPACITY
 */

import React from 'react';
import { getTheme } from '../../theme/colors';
import { PAST_OPACITY } from '../../state/constants';
import { isTerminalStatus } from '../../shared/task-status';
import { isAllDayTask } from '../../utils/isAllDayTask';

/**
 * Check if a dateKey falls within a task's date range.
 * For single-day tasks: dateKey must equal task.date.
 * For multiday tasks: dateKey must be within [task.date, task.endDate].
 */
function isInDateRange(task, dateKey) {
  if (!task.date) return false;
  // Multiday all-day task: check if dateKey is within the range
  if (task.endDate) {
    return dateKey >= task.date && dateKey <= task.endDate;
  }
  // Single-day task: exact match
  return task.date === dateKey;
}

export default function AllDayBanner({ allTasks, dateKey, statuses, onExpand, darkMode, isPastDay }) {
  var theme = getTheme(darkMode);

  var items = (allTasks || []).filter(function (t) {
    return isAllDayTask(t) && isInDateRange(t, dateKey);
  });

  if (items.length === 0) return null;

  function isFixed(t) {
    return t.placementMode === 'fixed' || t.placement_mode === 'fixed';
  }

  return (
    <div
      data-testid="all-day-banner"
      style={{ padding: '4px 12px', borderBottom: '1px solid ' + theme.border, flexShrink: 0 }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, color: theme.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        All Day
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {items.map(function (t) {
          var st = statuses[t.id] || '';
          var isDone = isTerminalStatus(st);
          var fixed = isFixed(t);
          return (
            <div
              key={t.id}
              data-testid="all-day-chip"
              onClick={function () { if (onExpand) onExpand(t.id); }}
              style={{
                padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                background: isDone ? theme.badgeBg : theme.projectBadgeBg,
                color: isDone ? theme.textMuted : theme.projectBadgeText,
                border: '1px solid ' + (isDone ? theme.border : theme.projectBadgeText + '40'),
                opacity: (isDone && isPastDay) ? PAST_OPACITY : (isDone ? 0.5 : 1),
                textDecoration: isDone ? 'line-through' : 'none'
              }}
            >
              {st === 'done' && <span style={{ fontSize: 9, marginRight: 2 }}>{'✓'}</span>}
              {st === 'skip' && <span style={{ fontSize: 9, marginRight: 2 }}>{'⏭'}</span>}
              {st === 'cancel' && <span style={{ fontSize: 9, marginRight: 2 }}>{'✗'}</span>}
              {st === 'missed' && <span style={{ fontSize: 9, marginRight: 2 }}>{'⚠'}</span>}
              {fixed && <span style={{ fontSize: 9, marginRight: 2 }}>{'📌'}</span>}
              {t.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
