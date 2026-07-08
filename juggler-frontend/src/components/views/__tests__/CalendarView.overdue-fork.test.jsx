// src/components/views/__tests__/CalendarView.overdue-fork.test.jsx
/**
 * 999.1224 (JUG-UI-OVERDUE-FLAG-FORK) — AC2 investigation + characterization.
 *
 * CalendarView.jsx:283 copies the scheduler placement's slack-relaxation
 * `_overdue` artifact onto the day-cell `item` object:
 *   if (pl && pl._overdue) item._overdue = true;
 *
 * INVESTIGATION FINDING (telly, this leg — verified by direct read, not
 * assumed): unlike ScheduleCard.jsx, CalendarView's own render path
 * (TaskEntry, line ~186) already computes its overdue badge via the
 * canonical `isTaskOverdue(t, isDone)` — it does NOT read `item._overdue`
 * anywhere in this file (grep-verified: FixedPopup doesn't either). So the
 * `item._overdue = true` write is DEAD CODE for the CURRENT month-grid
 * render — there is no live, user-observable display bug in CalendarView.jsx
 * today for this predicate. This differs from ScheduleCard.jsx, which DOES
 * read item._overdue and IS behaviorally forked (see
 * ScheduleCard.overdue-fork.test.jsx, RED today).
 *
 * This test therefore locks in the CURRENT-CORRECT rendering (both before
 * AND after AC2's dead-code removal must stay GREEN — no fake RED is
 * manufactured here per TEST-AUTHORING's "drive production, don't invert a
 * bug-confirm test" rule). It exists so bert's line-283 deletion (still
 * required — the write is a latent drift risk per the SSOT doc even though
 * currently unread) is verified as a true no-behavior-change cleanup.
 *
 * See also: TEST-REVIEW.md finding CV-1 (WARN, not BLOCK) for the full
 * dead-code evidence trail.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import CalendarView from '../CalendarView';

function noop() {}

function baseProps(overrides) {
  var today = new Date(2026, 5, 15); // June 15 2026 (mid-month, avoids grid edge cases)
  var dateKey = '2026-06-15';
  var task = {
    id: 'cv-task-1',
    text: 'Floating task rendered in month grid',
    pri: 'P3',
    dur: 30,
    recurring: false,
    // canonical SSOT field — NOT a hard commitment.
    overdue: false,
  };
  return Object.assign({
    selectedDate: today,
    today: today,
    darkMode: false,
    isMobile: false,
    onExpand: noop,
    setDayOffset: noop,
    setViewMode: noop,
    onDateDrop: null,
    weatherByDate: null,
    statuses: {},
    tasksByDate: { [dateKey]: [task] },
    // Production shape: the scheduler placement carries the slack-relaxation
    // `_overdue` artifact (unifiedScheduleV2.js: `entry._overdue = true`)
    // even though the task itself is not a real hard commitment.
    dayPlacements: { [dateKey]: [{ task: task, start: 480, end: 510, _overdue: true }] },
  }, overrides);
}

describe('CalendarView month-grid overdue rendering (999.1224 AC2 investigation)', () => {
  test('floating task with a scheduler _overdue=true placement artifact but task.overdue=false renders WITHOUT the overdue warning glyph (already correct — uses isTaskOverdue, not item._overdue)', () => {
    render(<CalendarView {...baseProps()} />);
    // TaskEntry renders the task text; the overdue warning is a leading
    // "⚠" glyph prefixed to the entry only when isOverdue is true.
    var entry = screen.getByText(/Floating task rendered in month grid/);
    expect(entry.textContent).not.toMatch(/⚠/);
  });

  test('a genuinely overdue task (task.overdue=true) DOES render the overdue warning glyph, confirming the render path is driven by isTaskOverdue (task.overdue), not the placement artifact', () => {
    var props = baseProps();
    props.tasksByDate['2026-06-15'][0].overdue = true;
    render(<CalendarView {...props} />);
    var entry = screen.getByText(/Floating task rendered in month grid/);
    expect(entry.textContent).toMatch(/⚠/);
  });
});
