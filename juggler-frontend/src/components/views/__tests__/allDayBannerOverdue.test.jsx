/**
 * allDayBannerOverdue.test.jsx — RED tests (999.1083, M-1 / SPEC FR-3, AC-7).
 *
 * AllDayBanner chip for an overdue, non-terminal all_day task must render a
 * visible overdue affordance, driven by the frontend single source of truth
 * `utils/overdue.js` (isTaskOverdue(task, isDone)) — NOT a re-derivation of the
 * overdue predicate in the component. Written BEFORE AllDayBanner.jsx wires
 * this in — expected RED against current HEAD (no data-overdue attribute, no
 * red styling exists yet on the chip).
 *
 * Contract this test pins for the implementer (bert):
 *   - chip gets `data-overdue="true"` AND a red-ish affordance (border/color
 *     drawn from the app's existing theme.redBorder / theme.redText — the
 *     ConflictsView.jsx precedent, see AllDayBanner.jsx JSDoc / SPEC FR-3)
 *     when isTaskOverdue(task, isDone) is true.
 *   - a done/skip/cancel chip is UNCHANGED even if task.overdue is true
 *     (isDone gates it off — FR-2/SPEC "Done/skip/cancel chips unchanged").
 *   - a non-overdue chip is UNCHANGED.
 *
 * Uses the REAL theme module (not mocked) so the red-affordance assertion pins
 * the actual production color value, not a value this test invented — a
 * collapse-to-constant / dropped-styling mutation in the implementation would
 * flip these assertions (TEST-AUTHORING.md §Golden-master, "pin CHANGED
 * derived/output VALUES, not their presence").
 *
 * Traceability: SPEC.md FR-3 / AC-7; TRACEABILITY.md FR-3 row.
 * Run: cd juggler/juggler-frontend && npx react-scripts test allDayBannerOverdue --watchAll=false
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import AllDayBanner from '../AllDayBanner';
import { getTheme } from '../../../theme/colors';

var theme = getTheme(false); // light mode — matches darkMode={false} below

function renderChip(task, statuses) {
  render(
    <AllDayBanner
      allTasks={[task]}
      dateKey={task.date}
      statuses={statuses || {}}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  return screen.getByTestId('all-day-chip');
}

describe('AllDayBanner — overdue chip affordance (999.1083, AC-7)', function() {

  it('AC-7: overdue, non-terminal all_day chip gets data-overdue="true"', function() {
    var task = { id: 'od-1', text: 'Overdue all-day thing', placementMode: 'all_day', date: '2026-06-20', overdue: true };
    var chip = renderChip(task, { 'od-1': '' });
    expect(chip.getAttribute('data-overdue')).toBe('true');
  });

  it('AC-7: overdue, non-terminal all_day chip renders the real theme red affordance (border)', function() {
    var task = { id: 'od-2', text: 'Overdue all-day thing 2', placementMode: 'all_day', date: '2026-06-20', overdue: true };
    var chip = renderChip(task, { 'od-2': '' });
    // Pin the ACTUAL production red color, not an invented one — mutation-sensitive:
    // collapsing the color branch to the default border would flip this.
    expect(chip.style.border).toEqual(expect.stringContaining(theme.redBorder));
  });

  it('AC-7: overdue, non-terminal all_day chip color uses theme.redText', function() {
    var task = { id: 'od-3', text: 'Overdue all-day thing 3', placementMode: 'all_day', date: '2026-06-20', overdue: true };
    var chip = renderChip(task, { 'od-3': '' });
    expect(chip.style.color).toEqual(theme.redText);
  });

  it('AC-7: done chip with task.overdue=true is UNCHANGED (no red affordance, isDone gates it off)', function() {
    var task = { id: 'od-4', text: 'Done overdue-flagged thing', placementMode: 'all_day', date: '2026-06-20', overdue: true };
    var chip = renderChip(task, { 'od-4': 'done' });
    expect(chip.getAttribute('data-overdue')).not.toBe('true');
    expect(chip.style.color).not.toEqual(theme.redText);
    expect(chip.style.border).toEqual(expect.not.stringContaining(theme.redBorder));
  });

  it('AC-7: non-overdue chip (task.overdue=false) is UNCHANGED (no red affordance)', function() {
    var task = { id: 'od-5', text: 'Fine all-day thing', placementMode: 'all_day', date: '2026-06-20', overdue: false };
    var chip = renderChip(task, { 'od-5': '' });
    expect(chip.getAttribute('data-overdue')).not.toBe('true');
    expect(chip.style.color).not.toEqual(theme.redText);
  });

  it('AC-7: non-overdue chip (task.overdue undefined) is UNCHANGED (no red affordance)', function() {
    var task = { id: 'od-6', text: 'No overdue flag at all', placementMode: 'all_day', date: '2026-06-20' };
    var chip = renderChip(task, { 'od-6': '' });
    expect(chip.getAttribute('data-overdue')).not.toBe('true');
    expect(chip.style.color).not.toEqual(theme.redText);
  });

});
