// src/components/schedule/__tests__/StatusToggle.test.jsx
//
// SPEC (juggler-recur-lifecycle-redesign) FR-2/AC3 — UI half of the reopen date
// gate (backend half already shipped in W2, UpdateTaskStatus.js REOPEN_DATE_GATE).
// AC3: "Attempting to reactivate ("") a terminal instance with date < today is
// rejected (backend) and the control is disabled in the UI (frontend); same-day
// reactivation still works."
//
// StatusToggle currently has NO knowledge of the instance's own calendar date —
// its VALID_TRANSITIONS-driven disabling (docs/architecture/TASK-STATE-MATRIX.md:78-87,
// "Modal button disabling") only looks at CURRENT STATUS. These tests assert the
// intended contract: a new `instanceDate` prop (YYYY-MM-DD, the terminal instance's
// own date — same convention as `evaluateFutureCompletionGuard`'s task.date /
// formatDateKey pairing in src/utils/futureCompletionGuard.js) must additionally
// gate the reopen ("") button. RED until W6 wires this into StatusToggle.jsx.
import React from 'react';
import { render, screen } from '@testing-library/react';
import StatusToggle from '../StatusToggle';
import { formatDateKey } from '../../../scheduler/dateHelpers';

function dateKeyOffsetFromToday(days) {
  var d = new Date();
  d.setDate(d.getDate() + days);
  return formatDateKey(d);
}

var TODAY_KEY = dateKeyOffsetFromToday(0);
var YESTERDAY_KEY = dateKeyOffsetFromToday(-1);

describe('StatusToggle — reopen date gate (FR-2/AC3 UI half)', () => {
  it('disables the reopen ("") button when the terminal instance date is before today', () => {
    render(
      <StatusToggle
        value="done"
        instanceDate={YESTERDAY_KEY}
        onChange={() => {}}
        darkMode={false}
      />
    );
    var reopenBtn = screen.getByTitle('Open');
    expect(reopenBtn).toBeDisabled();
    expect(reopenBtn).toHaveStyle({ cursor: 'not-allowed', opacity: 0.45 });
  });

  it('keeps the reopen ("") button enabled when the terminal instance date is today (same-day carve-out)', () => {
    render(
      <StatusToggle
        value="done"
        instanceDate={TODAY_KEY}
        onChange={() => {}}
        darkMode={false}
      />
    );
    var reopenBtn = screen.getByTitle('Open');
    expect(reopenBtn).not.toBeDisabled();
    expect(reopenBtn).toHaveStyle({ cursor: 'pointer', opacity: 1 });
  });

  it('disables the reopen ("") button from any past-dated terminal status, not just done (e.g. cancel)', () => {
    render(
      <StatusToggle
        value="cancel"
        instanceDate={YESTERDAY_KEY}
        onChange={() => {}}
        darkMode={false}
      />
    );
    var reopenBtn = screen.getByTitle('Open');
    expect(reopenBtn).toBeDisabled();
  });

  it('clicking a disabled past-dated reopen button never calls onChange', () => {
    var onChange = jest.fn();
    render(
      <StatusToggle
        value="done"
        instanceDate={YESTERDAY_KEY}
        onChange={onChange}
        darkMode={false}
      />
    );
    var reopenBtn = screen.getByTitle('Open');
    reopenBtn.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('back-compat: omitting instanceDate entirely leaves reopen enabled (existing callers unaffected until wired)', () => {
    render(
      <StatusToggle
        value="done"
        onChange={() => {}}
        darkMode={false}
      />
    );
    var reopenBtn = screen.getByTitle('Open');
    expect(reopenBtn).not.toBeDisabled();
  });
});
