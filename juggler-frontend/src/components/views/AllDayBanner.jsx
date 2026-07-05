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
import { isTaskOverdue } from '../../utils/overdue';

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
          var isMultiday = t.endDate && t.date && t.endDate !== t.date;
          var daySpan = isMultiday ? Math.round((new Date(t.endDate + 'T00:00:00') - new Date(t.date + 'T00:00:00')) / 86400000) + 1 : 0;
          // 999.1083 (M-1, SPEC FR-3, AC-7): overdue affordance driven by the
          // frontend single source of truth (utils/overdue.js), same helper
          // DailyViewTaskBlock/DailyViewUnschedEntry/CalendarView already use —
          // never re-derive the overdue predicate here. isDone gates it off so
          // a done/skip/cancel chip is unaffected even if task.overdue is true.
          var isOverdue = isTaskOverdue(t, isDone);
          return (
            <div
              key={t.id}
              data-testid="all-day-chip"
              data-overdue={isOverdue ? 'true' : undefined}
              // bird-002 (UX-REVIEW WARN, WCAG 2.1.1 Keyboard): role/tabIndex/onKeyDown
              // make the chip keyboard-operable — same div-as-button pattern already
              // used by TaskCard.jsx and DailyViewTaskBlock.jsx (Enter/Space -> onExpand).
              role="button"
              tabIndex={0}
              onClick={function () { if (onExpand) onExpand(t.id); }}
              onKeyDown={function (e) { if ((e.key === 'Enter' || e.key === ' ') && onExpand) { e.preventDefault(); onExpand(t.id); } }}
              style={{
                /* bird-003 (UX-REVIEW WARN, WCAG 2.5.8): 5px vertical padding
                   (was 3px) brings the ~20px click target up to >=24px CSS px
                   AA minimum: 5px + ~14.4px line-box (12px * ~1.2) + 5px ~= 24.4px. */
                padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                background: isDone ? theme.badgeBg : (isOverdue ? theme.redBg : (isMultiday ? '#C8942A' + '20' : theme.projectBadgeBg)),
                color: isDone ? theme.textMuted : (isOverdue ? theme.redText : (isMultiday ? '#C8942A' : theme.projectBadgeText)),
                border: '1px solid ' + (isDone ? theme.border : (isOverdue ? theme.redBorder : (isMultiday ? '#C8942A' + '60' : theme.projectBadgeText + '40'))),
                opacity: (isDone && isPastDay) ? PAST_OPACITY : (isDone ? 0.5 : 1),
                textDecoration: isDone ? 'line-through' : 'none'
              }}
            >
              {st === 'done' && <span style={{ fontSize: 9, marginRight: 2 }}>{'✓'}</span>}
              {st === 'skip' && <span style={{ fontSize: 9, marginRight: 2 }}>{'⏭'}</span>}
              {st === 'cancel' && <span style={{ fontSize: 9, marginRight: 2 }}>{'✗'}</span>}
              {fixed && <span style={{ fontSize: 9, marginRight: 2 }}>{'📌'}</span>}
              {/* bird-001 (UX-REVIEW BLOCK): color-only overdue affordance fails
                  WCAG 1.4.1 + SPEC FR-3 'per existing overdue affordances' —
                  pair the red styling with the same '⚠' glyph every sibling
                  overdue affordance uses (DailyViewTaskBlock/DailyViewUnschedEntry
                  '⚠ OVERDUE' badge, CalendarView.jsx:232 '⚠' prefix). */}
              {isOverdue && <span style={{ fontSize: 9, marginRight: 2 }}>{'⚠'}</span>}
              {isMultiday && <span style={{ fontSize: 9, marginRight: 2, fontWeight: 600 }}>{daySpan + 'd'}</span>}
              {t.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
