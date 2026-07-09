/**
 * ConfirmDialog — retrofit onto the shared ConfirmModal primitive
 * (FR-7/AC8, SPEC.md juggler-recur-lifecycle-redesign; closes backlog 999.1229).
 *
 * ConfirmDialog is the single-task-delete confirmation used directly by
 * AppLayout.jsx's "Unified delete confirmation" block (the non-recurring branch,
 * `deleteTask(id)`). AC8 requires it to render through the shared `ConfirmModal`
 * component instead of its own one-off overlay/card JSX, with NO prop-contract
 * change for its existing caller (message/onConfirm/onCancel/darkMode/isMobile/
 * zIndex) — a pure internal retrofit.
 *
 * RED until W6: ConfirmDialog.jsx today hand-rolls its own div (no role="dialog",
 * no aria-labelledby/describedby, no Escape-to-close) instead of delegating to
 * ConfirmModal — every assertion below fails against the current implementation.
 *
 * DESIGN CALL (telly, flagged for Kermit/human — no prior ruling found for this):
 * the cal_locked delete-block (FR-6/AC7, DeleteTask.js `CAL_LOCKED_DELETE_BLOCKED`,
 * 403) is actually gated on `scope==='series'` in the backend — i.e. it fires on
 * RecurringDeleteDialog's "Delete entire series" action, NOT on this single-task
 * ConfirmDialog's plain `deleteTask(id)` path. Testing the blocked-state UX here
 * proves the CAPABILITY at the shared-primitive level (a `blocked`/`blockedMessage`
 * pair: confirm disabled, explanatory message shown, Cancel still works) since
 * ConfirmDialog is the cleanly-retrofittable binary case — but wiring it to the
 * REAL cal_locked 403 response lives on the series-delete call site, which is
 * blocked on the tri-state RecurringDeleteDialog question (see
 * RecurringDeleteDialog.test.jsx / TELLY-W6-REVIEW.md open question). Chose
 * "disabled confirm + explanatory message" over a separate error state because
 * it keeps one dialog shape instead of a mode switch — reasonable default, not
 * a locked ruling.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../ConfirmDialog';

describe('ConfirmDialog — retrofit onto ConfirmModal (FR-7/AC8)', () => {
  it('renders through the shared ConfirmModal primitive (role=dialog, aria wiring)', () => {
    render(
      <ConfirmDialog
        message='Delete "Buy groceries"?'
        onConfirm={() => {}}
        onCancel={() => {}}
        darkMode={false}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete "Buy groceries"?')).toBeInTheDocument();
  });

  it('preserves its existing prop contract: onConfirm/onCancel still fire (no caller change needed in AppLayout.jsx)', () => {
    var onConfirm = jest.fn();
    var onCancel = jest.fn();
    render(
      <ConfirmDialog message="Delete this task?" onConfirm={onConfirm} onCancel={onCancel} darkMode={false} />
    );
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('gains Escape-to-close for free from the retrofit (ConfirmModal a11y precedent, ImportExportPanel.jsx:485-492)', () => {
    var onCancel = jest.fn();
    render(
      <ConfirmDialog message="Delete this task?" onConfirm={() => {}} onCancel={onCancel} darkMode={false} />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('DESIGN CALL — a blocked delete (e.g. cal_locked 403) disables Confirm and shows the block reason, Cancel remains available', () => {
    var onConfirm = jest.fn();
    var onCancel = jest.fn();
    render(
      <ConfirmDialog
        message="Delete this task?"
        blocked
        blockedMessage="This series has a calendar-linked instance. Remove the calendar link before deleting the whole series."
        onConfirm={onConfirm}
        onCancel={onCancel}
        darkMode={false}
      />
    );
    expect(
      screen.getByText(
        'This series has a calendar-linked instance. Remove the calendar link before deleting the whole series.'
      )
    ).toBeInTheDocument();
    var confirmBtn = screen.queryByText('Confirm');
    // Either the Confirm control is disabled, or it is not rendered at all in the
    // blocked state — either satisfies "cannot proceed"; assert whichever the
    // implementation chooses actually prevents the destructive action.
    if (confirmBtn) {
      expect(confirmBtn).toBeDisabled();
      fireEvent.click(confirmBtn);
    }
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
