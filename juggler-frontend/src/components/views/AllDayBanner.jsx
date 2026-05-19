/**
 * AllDayBanner — shared all-day task banner for DayView, DailyView,
 * WeekView, and ThreeDayView.
 *
 * Renders a muted full-width banner row above the timed CalendarGrid.
 * Returns null when there are no all-day items for the given dateKey.
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
import { isTerminalStatus, PAST_OPACITY } from '../../state/constants';
import { isAllDayTask } from '../../utils/isAllDayTask';

export default function AllDayBanner({ allTasks, dateKey, statuses, onExpand, darkMode, isPastDay }) {
  var theme = getTheme(darkMode);

  var items = (allTasks || []).filter(function (t) {
    return t.date === dateKey && isAllDayTask(t);
  });

  if (items.length === 0) return null;

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
              {t.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
