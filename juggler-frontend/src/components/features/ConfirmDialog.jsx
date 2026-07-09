/**
 * ConfirmDialog — modal replacement for window.confirm
 *
 * Retrofit onto the shared ConfirmModal primitive (FR-7/AC8, SPEC.md
 * juggler-recur-lifecycle-redesign; closes backlog 999.1229). Preserves the existing
 * message/onConfirm/onCancel/darkMode/isMobile/zIndex prop contract for its caller
 * (AppLayout.jsx's "Unified delete confirmation" block) — a pure internal retrofit.
 *
 * `title` (bert bird-w6-001 BLOCK fix): the pre-retrofit ConfirmDialog never rendered
 * a heading either (verified via `git show HEAD`), so there is no prior wording to
 * restore — but the retrofit onto ConfirmModal's `aria-labelledby={titleId}` mechanism
 * means a title-less dialog has NO accessible name at all (WCAG 4.1.2). Both live
 * callers (AppLayout.jsx's single-task delete branch, DisabledItemsPanel.jsx) use this
 * component only for delete confirmations, so "Delete task?" is a correct default
 * accessible name; an explicit `title` prop is still accepted for a future caller
 * that needs a different heading.
 *
 * `blocked`/`blockedMessage` (telly's design call, TELLY-W6-REVIEW.md): kept here as a
 * harmless, currently-unused capability — the REAL cal_locked 403 gate is series-delete
 * only and now lives on RecurringDeleteDialog (bert bird-w6-002 BLOCK fix). If blocked
 * is ever set here without blockedMessage, an approved generic fallback string is shown
 * rather than silently disabling Confirm with no explanation (bird-w6-007 WARN fix).
 */

import React from 'react';
import ConfirmModal from '../common/ConfirmModal';

export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, blocked, blockedMessage, darkMode, isMobile, zIndex }) {
  return (
    <ConfirmModal
      open
      title={title || 'Delete task?'}
      // 999.1229: name the destructive verb on the affirmative button — a generic
      // "Confirm" next to Cancel is a classic mis-click. Every live caller is a
      // delete confirmation, so 'Delete' is the correct default; non-delete
      // callers (e.g. AnnotationCanvas's clear) pass their own verb.
      confirmLabel={confirmLabel || 'Delete'}
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmDisabled={!!blocked}
      darkMode={darkMode}
      isMobile={isMobile}
      zIndex={zIndex}
    >
      <div>
        <div>{message}</div>
        {blocked && (
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600 }}>
            {blockedMessage || 'This action is currently unavailable.'}
          </div>
        )}
      </div>
    </ConfirmModal>
  );
}
