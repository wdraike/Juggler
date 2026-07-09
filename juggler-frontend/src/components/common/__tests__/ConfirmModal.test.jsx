/**
 * ConfirmModal — shared confirm-modal primitive (FR-7/AC8, SPEC.md juggler-recur-lifecycle-redesign)
 *
 * telly step 0 (mode=new): component does not exist yet at
 * src/components/common/ConfirmModal.jsx — this suite is the RED half of TDD.
 *
 * Conventions modeled on the existing one-off dialogs this component is meant to retrofit/replace
 * (FR-7: "Retrofit existing inconsistent confirmations onto it: single-task delete, recurring-delete"):
 *   - src/components/features/ConfirmDialog.jsx        — overlay div (fixed, onClick=onCancel) +
 *     centered card (onClick stopPropagation) + message + Cancel/Confirm button pair, themed via
 *     getTheme(darkMode), isMobile full-screen variant. message/onConfirm/onCancel/darkMode/isMobile prop names.
 *   - src/components/features/RecurringDeleteDialog.jsx — same overlay/card shell, adds a bold
 *     header line above the body (here: `title`).
 *   - Neither existing dialog implements Escape-to-close. The app's actual Escape-closes-modal a11y
 *     precedent lives in src/components/features/ImportExportPanel.jsx:485-492 (a
 *     `window.addEventListener('keydown', onKey, true)` guard checking `ev.key === 'Escape'`), proven
 *     in src/components/features/__tests__/ImportExportPanel.importMode.test.jsx via
 *     `fireEvent.keyDown(window, { key: 'Escape' })`. ConfirmModal is expected to adopt that pattern
 *     (not invent a new one) since it is the new shared primitive for every destructive confirmation.
 *   - Test style (render/getByText/queryByText, `container.firstChild` for the "renders nothing"
 *     case) matches src/components/features/__tests__/WeatherBadge.test.jsx.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmModal from '../ConfirmModal';

function renderModal(overrides) {
  var onConfirm = jest.fn();
  var onCancel = jest.fn();
  var props = Object.assign(
    {
      open: true,
      title: 'Delete recurring series?',
      message: 'This will remove all future instances.',
      onConfirm: onConfirm,
      onCancel: onCancel,
    },
    overrides
  );
  var utils = render(<ConfirmModal {...props} />);
  return Object.assign({ onConfirm: onConfirm, onCancel: onCancel }, utils);
}

describe('ConfirmModal', function() {
  it('renders nothing when open={false}', function() {
    var onConfirm = jest.fn();
    var onCancel = jest.fn();
    var { container } = render(
      <ConfirmModal
        open={false}
        title="Delete recurring series?"
        message="This will remove all future instances."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a dialog with title, body content, Confirm and Cancel buttons when open={true}', function() {
    renderModal();
    expect(screen.getByText('Delete recurring series?')).toBeInTheDocument();
    expect(screen.getByText('This will remove all future instances.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('accepts children as the body-content area instead of a message/body prop', function() {
    var onConfirm = jest.fn();
    var onCancel = jest.fn();
    render(
      <ConfirmModal open title="Remove 1 slot this week?" onConfirm={onConfirm} onCancel={onCancel}>
        <span>1 of 3 done this week {'→'} new target 2 {'→'} 1 remaining slot removed today</span>
      </ConfirmModal>
    );
    expect(
      screen.getByText('1 of 3 done this week → new target 2 → 1 remaining slot removed today')
    ).toBeInTheDocument();
  });

  it('clicking Confirm calls the onConfirm callback', function() {
    var utils = renderModal();
    fireEvent.click(screen.getByText('Confirm'));
    expect(utils.onConfirm).toHaveBeenCalledTimes(1);
    expect(utils.onCancel).not.toHaveBeenCalled();
  });

  it('clicking Cancel calls the onCancel callback', function() {
    var utils = renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(utils.onCancel).toHaveBeenCalledTimes(1);
    expect(utils.onConfirm).not.toHaveBeenCalled();
  });

  it('pressing Escape calls onCancel (app a11y precedent: ImportExportPanel.jsx:485-492)', function() {
    var utils = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(utils.onCancel).toHaveBeenCalledTimes(1);
    expect(utils.onConfirm).not.toHaveBeenCalled();
  });

  it('supports confirmLabel/cancelLabel overrides for reuse across destructive actions', function() {
    var onConfirm = jest.fn();
    var onCancel = jest.fn();
    render(
      <ConfirmModal
        open
        title="Delete this series?"
        message="Past completions are kept; future instances are removed."
        confirmLabel="Delete series"
        cancelLabel="Keep it"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(screen.getByText('Delete series')).toBeInTheDocument();
    expect(screen.getByText('Keep it')).toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Delete series'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // --- tertiary action slot (telly W6-tristate retrofit; resolves TELLY-W6-REVIEW.md BLOCK) ---
  // Kermit's ruling: ConfirmModal gains an OPTIONAL third action slot -- `tertiaryLabel`/
  // `onTertiary` -- rendered as a third button alongside Confirm/Cancel ONLY when BOTH props
  // are supplied; omitted entirely otherwise, so the existing single-task-delete consumer
  // (ConfirmDialog.jsx, W6, binary) is completely unaffected. First real consumer:
  // RecurringDeleteDialog's skip-instance action (see RecurringDeleteDialog.test.jsx for the
  // full tri-state mapping + rationale). RED: the extension does not exist yet.

  it('renders a third button when both tertiaryLabel and onTertiary are provided', function() {
    render(
      <ConfirmModal
        open
        title="Delete this recurring task?"
        message="Choose how to handle this recurring task."
        tertiaryLabel="Skip this instance"
        onTertiary={jest.fn()}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getByText('Skip this instance')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('omits the third button when tertiaryLabel is provided without onTertiary (binary fallback)', function() {
    render(
      <ConfirmModal
        open
        title="Delete?"
        message="Sure?"
        tertiaryLabel="Skip this instance"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.queryByText('Skip this instance')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('omits the third button when onTertiary is provided without tertiaryLabel (binary fallback)', function() {
    render(
      <ConfirmModal
        open
        title="Delete?"
        message="Sure?"
        onTertiary={jest.fn()}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('omits the third button entirely when neither tertiaryLabel nor onTertiary is provided (existing binary behavior unaffected -- guards the W4 single-task-delete consumer)', function() {
    renderModal();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('clicking the tertiary button calls onTertiary and neither onConfirm nor onCancel', function() {
    var onTertiary = jest.fn();
    var onConfirm = jest.fn();
    var onCancel = jest.fn();
    render(
      <ConfirmModal
        open
        title="Delete this recurring task?"
        message="Choose how to handle this recurring task."
        tertiaryLabel="Skip this instance"
        onTertiary={onTertiary}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByText('Skip this instance'));
    expect(onTertiary).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('traps Tab across THREE buttons when the tertiary slot is present (Cancel -> Tertiary -> Confirm -> wraps to Cancel), re-verifying the W4 focus-trap fix is not silently broken by the extension', function() {
    render(
      <ConfirmModal
        open
        title="Delete this recurring task?"
        message="Choose how to handle this recurring task."
        tertiaryLabel="Skip this instance"
        onTertiary={jest.fn()}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    var cancelBtn = screen.getByText('Cancel');
    var tertiaryBtn = screen.getByText('Skip this instance');
    var confirmBtn = screen.getByText('Confirm');

    // Initial focus is still Cancel -- unchanged from binary behavior (W4 precedent).
    expect(cancelBtn).toHaveFocus();

    // Tab: Cancel -> Tertiary (the newly-inserted middle button)
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(tertiaryBtn).toHaveFocus();

    // Tab: Tertiary -> Confirm
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(confirmBtn).toHaveFocus();

    // Tab wraps around: Confirm -> Cancel (the first focusable)
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(cancelBtn).toHaveFocus();

    // Shift+Tab from Cancel wraps to Confirm (the last focusable)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(confirmBtn).toHaveFocus();
  });

  // --- bert characterization tests (bird-001 BLOCK fix: focus-trap/initial-focus/focus-restore) ---
  // Added by bert as minimal proof the fix works, per the bert/telly boundary — telly owns full
  // test-inventory coverage for this component (see bird-005 REFER→telly).

  it('[bert] moves focus to the Cancel button on open (ARIA APG modal pattern; matches ImportExportPanel.jsx:485-492 precedent)', function() {
    renderModal();
    expect(screen.getByText('Cancel')).toHaveFocus();
  });

  it('[bert] traps Tab within the dialog: Tab from Confirm wraps to Cancel, Shift+Tab from Cancel wraps to Confirm', function() {
    renderModal();
    var cancelBtn = screen.getByText('Cancel');
    var confirmBtn = screen.getByText('Confirm');

    // Shift+Tab from the initially-focused Cancel button wraps to Confirm (the last focusable).
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(confirmBtn).toHaveFocus();

    // Tab from Confirm wraps back around to Cancel (the first focusable).
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(cancelBtn).toHaveFocus();
  });

  it('[bert] restores focus to the previously-focused element when the dialog closes', function() {
    var trigger = document.createElement('button');
    trigger.textContent = 'Open dialog';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    var onConfirm = jest.fn();
    var onCancel = jest.fn();
    var { rerender } = render(
      <ConfirmModal open title="Delete?" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />
    );
    expect(screen.getByText('Cancel')).toHaveFocus();

    rerender(
      <ConfirmModal open={false} title="Delete?" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />
    );
    expect(trigger).toHaveFocus();

    document.body.removeChild(trigger);
  });

  it('[bert] wires aria-labelledby/aria-describedby on the dialog to the title/message ids (bird-002 WARN fix)', function() {
    renderModal();
    var dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-modal-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'confirm-modal-desc');
    expect(document.getElementById('confirm-modal-title')).toHaveTextContent('Delete recurring series?');
    expect(document.getElementById('confirm-modal-desc')).toHaveTextContent(
      'This will remove all future instances.'
    );
  });
});
