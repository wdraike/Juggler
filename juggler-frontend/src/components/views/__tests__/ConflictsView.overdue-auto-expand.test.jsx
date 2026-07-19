/**
 * 999.1077 (R6, David 2026-07-19) — overdue pileup visibility.
 *
 * Ruling R6 (BINDING, resolves the NEEDS-DAVID design question):
 *   "Issues section auto-expands when overdue count > 0 (count visible),
 *   collapses back when cleared. No new banner UI. Badge behavior unchanged."
 *
 * Scope: the Overdue sub-section inside ConflictsView (the "Issues" tab).
 * ConflictsView defaults `collapsed.overdue = true` (line ~38) so a pileup of
 * overdue items pinned to PAST dates (never shown on today's DailyView, which
 * renders only selectedDateKey) was invisible unless the user manually
 * expanded the section. This test locks the auto-expand/auto-collapse
 * transition behavior:
 *
 *   - 0→N (including "N at mount", treated as a transition from an unknown/
 *     empty prior state): section auto-expands.
 *   - N→0 (cleared): section auto-collapses.
 *   - A user's explicit re-collapse DURING a nonzero-count session is
 *     respected — a further N1→N2 count change (both > 0) must NOT re-force
 *     the section back open. Only a fresh 0→N transition re-triggers
 *     auto-expand.
 *
 * No DB, no network, no wall-clock (todayDate fixed). Mocks TaskCard/
 * WeatherBadge per the existing ConflictsView.test.jsx convention (paths
 * relative to this file, not the SUT).
 */

import React from 'react';
// user-event is not installed in this repo (see HealthDot.bug487-fe.test.jsx) — use fireEvent.
import { render, screen, fireEvent } from '@testing-library/react';
import ConflictsView from '../ConflictsView';

jest.mock('../../tasks/TaskCard', () => {
  return function MockTaskCard({ task }) {
    return <div data-testid="task-card" data-task-id={task && task.id}>{task && task.text}</div>;
  };
});

jest.mock('../../features/WeatherBadge', () => {
  return function MockWeatherBadge() { return null; };
});

var FIXED_TODAY = new Date('2026-06-20T00:00:00.000Z');
FIXED_TODAY.setHours(0, 0, 0, 0);

function overdueTask(id) {
  return { id: id, text: 'Overdue task ' + id, overdue: true };
}

function makeProps(overrides) {
  return Object.assign({
    allTasks: [],
    statuses: {},
    unplaced: [],
    backlog: [],
    schedulerWarnings: [],
    onStatusChange: () => {},
    onExpand: () => {},
    onUpdateTask: null,
    onDelete: null,
    darkMode: false,
    isMobile: false,
    todayDate: FIXED_TODAY,
    weatherByDate: null
  }, overrides);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

test('mounting with overdue count > 0 auto-expands the Overdue section (no manual toggle, no seeded localStorage)', () => {
  render(<ConflictsView {...makeProps({ allTasks: [overdueTask('t1')] })} />);

  // Section is open: the task card renders without any click.
  expect(screen.getByTestId('task-card')).toHaveAttribute('data-task-id', 't1');
});

test('overdue count clearing (N→0) collapses the section back', () => {
  var { rerender } = render(<ConflictsView {...makeProps({ allTasks: [overdueTask('t1')] })} />);
  expect(screen.getByTestId('task-card')).toBeInTheDocument();

  rerender(<ConflictsView {...makeProps({ allTasks: [] })} />);

  expect(screen.queryByTestId('task-card')).not.toBeInTheDocument();
  // Collapsed section shows the (0) badge, not the "All clear" empty-state copy
  // (which only renders when the section is open).
  expect(screen.queryByText(/All clear — nothing is overdue\./)).not.toBeInTheDocument();
});

test('a subsequent 0→N transition after clearing re-expands the section', () => {
  var { rerender } = render(<ConflictsView {...makeProps({ allTasks: [overdueTask('t1')] })} />);
  expect(screen.getByTestId('task-card')).toBeInTheDocument();

  rerender(<ConflictsView {...makeProps({ allTasks: [] })} />);
  expect(screen.queryByTestId('task-card')).not.toBeInTheDocument();

  rerender(<ConflictsView {...makeProps({ allTasks: [overdueTask('t2')] })} />);
  expect(screen.getByTestId('task-card')).toHaveAttribute('data-task-id', 't2');

  // sanity: the button still toggles manually too
  fireEvent.click(screen.getByRole('button', { name: /Overdue/ }));
  expect(screen.queryByTestId('task-card')).not.toBeInTheDocument();
});

test('a user re-collapse DURING a nonzero session is respected across a further N1→N2 change (not fought by auto-expand)', () => {
  var { rerender } = render(<ConflictsView {...makeProps({ allTasks: [overdueTask('t1')] })} />);
  expect(screen.getByTestId('task-card')).toBeInTheDocument();

  // User explicitly collapses while count is still 1 (nonzero).
  fireEvent.click(screen.getByRole('button', { name: /Overdue/ }));
  expect(screen.queryByTestId('task-card')).not.toBeInTheDocument();

  // Count changes 1→2 — still nonzero, NOT a 0→N transition — must stay collapsed.
  rerender(<ConflictsView {...makeProps({ allTasks: [overdueTask('t1'), overdueTask('t2')] })} />);
  expect(screen.queryByTestId('task-card')).not.toBeInTheDocument();
});
