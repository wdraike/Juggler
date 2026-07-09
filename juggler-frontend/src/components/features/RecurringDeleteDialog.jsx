/**
 * RecurringDeleteDialog — skip-instance vs delete-series confirmation for recurring tasks
 *
 * Retrofit onto the shared ConfirmModal primitive (FR-7/AC8, SPEC.md
 * juggler-recur-lifecycle-redesign; resolves the tri-state-vs-binary BLOCK recorded in
 * TELLY-W6-REVIEW.md via Kermit's ruling — ConfirmModal's optional tertiary slot).
 *
 * Mapping (telly's judgment call, TELLY-W6-TRISTATE-REVIEW.md):
 *   - onCancel       -> ConfirmModal's Cancel slot   (1:1, unchanged semantics/label)
 *   - onDeleteSeries -> ConfirmModal's Confirm slot  (confirmLabel="Delete entire series")
 *   - onSkipInstance -> ConfirmModal's tertiary slot (tertiaryLabel="Skip this instance")
 * DOM/focus order: Cancel, Skip this instance (tertiary), Delete entire series (confirm).
 *
 * `blocked`/`blockedMessage` (bert bird-w6-002 BLOCK fix, moved here from ConfirmDialog):
 * the real cal_locked 403 (DeleteTask.js `CAL_LOCKED_DELETE_BLOCKED`, FR-6/AC7) is gated
 * on `scope==='series'`, which is exactly this dialog's "Delete entire series" action
 * (AppLayout.jsx maps it to `deleteTask(id, { cascade: 'recurring' })` -> scope=series
 * server-side). `confirmDisabled={!!blocked}` disables ONLY the Confirm/series-delete
 * button (ConfirmModal.jsx:136) — the Skip-instance tertiary action is deliberately left
 * unaffected, since skipping one occurrence never touches the cal-linked series gate.
 * If `blocked` is set without `blockedMessage`, an approved generic fallback string is
 * shown rather than silently disabling Confirm with no explanation (bird-w6-007 fix).
 *
 * Per-action icon + one-line consequence subtext (bird-w6-004 WARN fix): restores the
 * pre-retrofit decision-support content (`git show HEAD` on this file) that the
 * ConfirmModal retrofit had dropped, adapted to ConfirmModal's existing slots — the
 * emoji icons move onto the button labels themselves, and the consequence subtext
 * moves into the shared body (`children`) area above the buttons, immediately below
 * the "What would you like to do?" prompt.
 */

import React from 'react';
import ConfirmModal from '../common/ConfirmModal';

export default function RecurringDeleteDialog({
  taskName, onSkipInstance, onDeleteSeries, onCancel, blocked, blockedMessage, darkMode, isMobile
}) {
  return (
    <ConfirmModal
      open
      title={'Delete "' + (taskName || '').slice(0, 50) + '"'}
      tertiaryLabel={'⏭ Skip this instance'}
      onTertiary={onSkipInstance}
      confirmLabel={'🗑 Delete entire series'}
      onConfirm={onDeleteSeries}
      onCancel={onCancel}
      confirmDisabled={!!blocked}
      darkMode={darkMode}
      isMobile={isMobile}
    >
      <div>
        <div>This is a recurring task. What would you like to do?</div>
        <div style={{ fontSize: 11, marginTop: 8 }}>
          Skipping marks this instance done; the series continues.
        </div>
        <div style={{ fontSize: 11, marginTop: 4 }}>
          Deleting the series removes it and all future instances; past instances stay.
        </div>
        {blocked && (
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600 }}>
            {blockedMessage || 'This action is currently unavailable.'}
          </div>
        )}
      </div>
    </ConfirmModal>
  );
}
