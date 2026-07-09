/**
 * RecurringDeleteDialog -- RED retrofit onto the extended ConfirmModal tertiary slot
 * (FR-7/AC8, SPEC.md juggler-recur-lifecycle-redesign; resolves the tri-state-vs-binary BLOCK
 * recorded in TELLY-W6-REVIEW.md via Kermit's ruling: ConfirmModal gains an OPTIONAL third
 * action slot -- `tertiaryLabel`/`onTertiary` props -- rendered as a third button alongside the
 * existing Confirm/Cancel when BOTH are supplied, omitted entirely (binary fallback) when not.
 * See ConfirmModal.test.jsx's "tertiary action slot" block for the extension's own RED tests.
 *
 * MAPPING CHOSEN (telly's judgment call, per this leg's dispatch instruction to pick "the most
 * natural mapping given the existing dialog's current labels/order" and cite it):
 *   - onCancel       -> ConfirmModal's Cancel slot   (1:1, unchanged semantics/label)
 *   - onDeleteSeries -> ConfirmModal's Confirm slot  (confirmLabel="Delete entire series")
 *   - onSkipInstance -> ConfirmModal's NEW tertiary slot (tertiaryLabel="Skip this instance")
 *
 * Rationale: ConfirmModal's binary Confirm/Cancel already carries an implicit destructive/safe
 * polarity -- Confirm is styled destructively (theme.error background, bold, white text,
 * ConfirmModal.jsx:119-123) and Cancel is neutral (transparent/bordered) and gets initial focus
 * (the W4 a11y precedent). Of RecurringDeleteDialog's three actions, exactly ONE is actually
 * destructive/irreversible -- "delete entire series" (removes the recurring master + all future
 * instances) -- while "skip this instance" is non-destructive (marks one occurrence skipped;
 * the series continues). Slotting the one destructive action onto Confirm preserves that
 * existing red/destructive styling meaning with zero re-theming; the new tertiary slot absorbs
 * the remaining non-destructive action. This is the minimal-diff extension of the existing
 * two-button semantics (Cancel's initial-focus default and Confirm's destructive styling both
 * stay meaningful), not a re-derivation of them. Chosen DOM order (Cancel, Tertiary, Confirm)
 * mirrors ConfirmModal's own new focus-trap cycle order (see ConfirmModal.test.jsx's 3-button
 * Tab-trap test) -- Cancel first/leftmost (unchanged), Confirm last/rightmost (unchanged),
 * Tertiary inserted in the middle.
 *
 * RED until the ConfirmModal extension AND this component's retrofit are both wired (grover):
 * today RecurringDeleteDialog.jsx (src/components/features/RecurringDeleteDialog.jsx) hand-rolls
 * its own overlay/card divs with no `role="dialog"`, no aria-labelledby/describedby, no
 * Escape-to-close, and renders its three actions in Skip/Delete-series/Cancel DOM order (not the
 * Cancel/Skip/Delete-series order the ConfirmModal retrofit will produce) -- every
 * ConfirmModal-delegation assertion below fails against the CURRENT implementation. The
 * three-action callback-wiring test is expected to keep PASSING throughout (that behavior
 * already exists today and must not regress through the retrofit).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RecurringDeleteDialog from '../RecurringDeleteDialog';

function renderDialog(overrides) {
  var onSkipInstance = jest.fn();
  var onDeleteSeries = jest.fn();
  var onCancel = jest.fn();
  var props = Object.assign(
    {
      taskName: 'Water the plants',
      onSkipInstance: onSkipInstance,
      onDeleteSeries: onDeleteSeries,
      onCancel: onCancel,
      darkMode: false,
    },
    overrides
  );
  var utils = render(<RecurringDeleteDialog {...props} />);
  return Object.assign(
    { onSkipInstance: onSkipInstance, onDeleteSeries: onDeleteSeries, onCancel: onCancel },
    utils
  );
}

describe('RecurringDeleteDialog -- RED retrofit onto ConfirmModal tertiary slot (FR-7/AC8)', function() {
  it('renders through the shared ConfirmModal primitive (role=dialog)', function() {
    renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Water the plants/)).toBeInTheDocument();
  });

  it('preserves the existing three-action callback contract: skip/delete-series/cancel each still fire independently (no caller change needed in AppLayout.jsx)', function() {
    var utils = renderDialog();

    fireEvent.click(screen.getByText(/Skip this instance/));
    expect(utils.onSkipInstance).toHaveBeenCalledTimes(1);
    expect(utils.onDeleteSeries).not.toHaveBeenCalled();
    expect(utils.onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/Delete entire series/));
    expect(utils.onDeleteSeries).toHaveBeenCalledTimes(1);
    expect(utils.onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Cancel'));
    expect(utils.onCancel).toHaveBeenCalledTimes(1);
  });

  it('gains Escape-to-close for free from the retrofit (ConfirmModal a11y precedent, ImportExportPanel.jsx:485-492)', function() {
    var utils = renderDialog();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(utils.onCancel).toHaveBeenCalledTimes(1);
  });

  it('maps its three actions onto ConfirmModal in Cancel, Skip-instance (tertiary), Delete-series (destructive Confirm) DOM order -- not the current Skip/Delete-series/Cancel order', function() {
    renderDialog();
    var buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent('Cancel');
    expect(buttons[1]).toHaveTextContent(/Skip this instance/);
    expect(buttons[2]).toHaveTextContent(/Delete entire series/);
  });
});
