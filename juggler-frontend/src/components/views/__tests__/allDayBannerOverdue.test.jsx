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
 * Also pins (added 2026-07-04, zoe-001 regression guard): the '⚠' glyph span
 * that pairs the color-only overdue affordance with a non-color WCAG 1.4.1
 * channel (bird-001, UX-REVIEW BLOCK) is present when isOverdue is true and
 * absent for done/non-overdue/unflagged chips — zoe's Mutation E proved this
 * glyph had zero prior regression coverage (26/26 banner tests stayed green
 * with the glyph span deleted entirely).
 *
 * Traceability: SPEC.md FR-3 / AC-7; TRACEABILITY.md FR-3 row.
 * Run: cd juggler/juggler-frontend && npx react-scripts test allDayBannerOverdue --watchAll=false
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import AllDayBanner from '../AllDayBanner';
import { getTheme } from '../../../theme/colors';

var theme = getTheme(false); // light mode — matches darkMode={false} below

/**
 * jsdom's CSSOM (the `cssstyle` package) normalizes every inline `color`
 * value it stores through its own serializer: `el.style.color` is ALWAYS
 * read back in `rgb(r, g, b)` form, never as the literal hex string that
 * was assigned — this matches real-browser CSSOM behavior, not a jsdom
 * quirk (see node_modules/cssstyle/lib/properties/color.js). A raw
 * `toEqual(theme.redText)` comparison against a hex constant can therefore
 * never pass, regardless of whether the implementation is correct.
 *
 * Deriving the expected `rgb()` string FROM theme.redText (rather than
 * hardcoding a literal 'rgb(139, 38, 53)') keeps the assertion
 * mutation-sensitive: if AllDayBanner ever wired the wrong theme color for
 * the overdue affordance, this derived expectation would still catch it,
 * because it recomputes from the same production theme constant the
 * component consumes. (bert refer: fe-color-border-cssom-normalization,
 * BERT-LOG.md finding #4 — 2026-07-04.)
 */
function hexToRgb(hex) {
  var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) { throw new Error('hexToRgb: expected a 6-digit hex color, got: ' + hex); }
  return 'rgb(' + parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16) + ')';
}

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
    // Compare on the DOM-normalized form: cssstyle lowercases the whole
    // `border` shorthand value on read-back, so a mixed-case hex substring
    // check must lowercase both sides (theme.redBorder is mixed-case here
    // by coincidence with the actual chosen value, but the normalization
    // rule holds regardless of casing).
    expect(chip.style.border.toLowerCase()).toEqual(expect.stringContaining(theme.redBorder.toLowerCase()));
  });

  it('AC-7: overdue, non-terminal all_day chip color uses theme.redText', function() {
    var task = { id: 'od-3', text: 'Overdue all-day thing 3', placementMode: 'all_day', date: '2026-06-20', overdue: true };
    var chip = renderChip(task, { 'od-3': '' });
    // Compare against the CSSOM-normalized rgb() form (see hexToRgb doc
    // comment above) — a raw hex comparison can never match jsdom's
    // serialized `.style.color`.
    expect(chip.style.color).toEqual(hexToRgb(theme.redText));
  });

  it('AC-7: done chip with task.overdue=true is UNCHANGED (no red affordance, isDone gates it off)', function() {
    var task = { id: 'od-4', text: 'Done overdue-flagged thing', placementMode: 'all_day', date: '2026-06-20', overdue: true };
    var chip = renderChip(task, { 'od-4': 'done' });
    expect(chip.getAttribute('data-overdue')).not.toBe('true');
    // Same DOM-normalized-form rule applies to the negative assertions: a
    // raw `.not.toEqual(theme.redText)` against a hex string would ALWAYS
    // pass (a normalized 'rgb(...)' string never string-equals a hex
    // string), making the check tautological — it could never catch a
    // done chip that incorrectly rendered red. Normalizing both sides
    // makes this a real assertion again.
    expect(chip.style.color).not.toEqual(hexToRgb(theme.redText));
    expect(chip.style.border.toLowerCase()).toEqual(expect.not.stringContaining(theme.redBorder.toLowerCase()));
  });

  it('AC-7: non-overdue chip (task.overdue=false) is UNCHANGED (no red affordance)', function() {
    var task = { id: 'od-5', text: 'Fine all-day thing', placementMode: 'all_day', date: '2026-06-20', overdue: false };
    var chip = renderChip(task, { 'od-5': '' });
    expect(chip.getAttribute('data-overdue')).not.toBe('true');
    expect(chip.style.color).not.toEqual(hexToRgb(theme.redText));
  });

  it('AC-7: non-overdue chip (task.overdue undefined) is UNCHANGED (no red affordance)', function() {
    var task = { id: 'od-6', text: 'No overdue flag at all', placementMode: 'all_day', date: '2026-06-20' };
    var chip = renderChip(task, { 'od-6': '' });
    expect(chip.getAttribute('data-overdue')).not.toBe('true');
    expect(chip.style.color).not.toEqual(hexToRgb(theme.redText));
  });

  // --- zoe-001 regression guard (ZOE-REVIEW.md WARN, 2026-07-04) -----------
  // bird-001 (UX-REVIEW BLOCK) required pairing the color-only overdue
  // affordance with the same '⚠' glyph every sibling overdue affordance uses
  // (WCAG 1.4.1 — color must not be the only channel conveying overdue state).
  // bird marked bird-001 RESOLVED on a static source re-read of the glyph
  // span (AllDayBanner.jsx:100); zoe's Mutation E proved that resolution had
  // ZERO regression coverage — deleting the glyph span left all 26 banner
  // tests green. These tests close that gap: they assert the glyph's
  // PRESENCE when isOverdue is true and its ABSENCE otherwise, matching the
  // isOverdue gating exactly (isDone gates isOverdue off per AC-4/FR-2).
  it('AC-7 / zoe-001: overdue, non-terminal all_day chip renders the WCAG "⚠" glyph', function() {
    var task = { id: 'od-7', text: 'Overdue all-day thing 7', placementMode: 'all_day', date: '2026-06-20', overdue: true };
    var chip = renderChip(task, { 'od-7': '' });
    expect(within(chip).getByText('⚠')).toBeInTheDocument();
  });

  it('AC-7 / zoe-001: done chip with task.overdue=true does NOT render the "⚠" glyph (isDone gates isOverdue off)', function() {
    var task = { id: 'od-8', text: 'Done overdue-flagged thing 2', placementMode: 'all_day', date: '2026-06-20', overdue: true };
    var chip = renderChip(task, { 'od-8': 'done' });
    expect(within(chip).queryByText('⚠')).not.toBeInTheDocument();
  });

  it('AC-7 / zoe-001: non-overdue chip (task.overdue=false) does NOT render the "⚠" glyph', function() {
    var task = { id: 'od-9', text: 'Fine all-day thing 2', placementMode: 'all_day', date: '2026-06-20', overdue: false };
    var chip = renderChip(task, { 'od-9': '' });
    expect(within(chip).queryByText('⚠')).not.toBeInTheDocument();
  });

  it('AC-7 / zoe-001: non-overdue chip (task.overdue undefined) does NOT render the "⚠" glyph', function() {
    var task = { id: 'od-10', text: 'No overdue flag at all 2', placementMode: 'all_day', date: '2026-06-20' };
    var chip = renderChip(task, { 'od-10': '' });
    expect(within(chip).queryByText('⚠')).not.toBeInTheDocument();
  });

});
