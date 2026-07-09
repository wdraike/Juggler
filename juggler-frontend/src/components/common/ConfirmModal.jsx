/**
 * ConfirmModal — shared confirm-modal primitive (FR-7/AC8, SPEC.md juggler-recur-lifecycle-redesign)
 *
 * The one shared destructive/irreversible-action confirmation component. Retrofits the
 * overlay/card shell + theming conventions from the existing one-off dialogs it is meant to
 * replace (`ConfirmDialog.jsx`, `RecurringDeleteDialog.jsx`), formalizes their implicit
 * "bold header line" as a `title` prop, accepts either a `message` string or free-form
 * `children` as the body content, and adds Escape-to-close per the app's a11y precedent at
 * `ImportExportPanel.jsx:485-492`.
 */

import React, { useEffect, useRef } from 'react';
import { getTheme } from '../../theme/colors';

export default function ConfirmModal({
  open,
  title,
  message,
  children,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
  confirmDisabled,
  tertiaryLabel,
  onTertiary,
  darkMode,
  isMobile,
  zIndex,
}) {
  var theme = getTheme(darkMode);
  var cancelBtnRef = useRef(null);
  var tertiaryBtnRef = useRef(null);
  var confirmBtnRef = useRef(null);
  var previouslyFocusedRef = useRef(null);
  // Tertiary slot (FR-7 tri-state retrofit, TELLY-W6-TRISTATE-REVIEW.md): renders only
  // when BOTH tertiaryLabel and onTertiary are supplied, so the existing binary consumer
  // (ConfirmDialog.jsx) is completely unaffected.
  var hasTertiary = !!(tertiaryLabel && onTertiary);

  useEffect(function() {
    if (!open) return;
    // ARIA APG modal-dialog focus management, matching the app's own cited precedent
    // (ImportExportPanel.jsx:485-492, which focuses its safe/Cancel button on open): remember
    // what had focus before the dialog opened, then move focus onto the Cancel button (the safer
    // default for a destructive-action confirm) so keyboard/AT users land inside the dialog.
    previouslyFocusedRef.current = document.activeElement;
    if (cancelBtnRef.current) cancelBtnRef.current.focus();

    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        onCancel();
        return;
      }
      if (ev.key === 'Tab') {
        // Focus trap: manually cycles Tab/Shift+Tab across Cancel -> Tertiary (when
        // present) -> Confirm, wrapping at both ends, never reaching the page behind the
        // overlay. jsdom's fireEvent.keyDown does not perform real browser tab-order focus
        // movement, so every step (not just the wrap-around edges) is driven explicitly here.
        // tertiaryBtnRef.current is null when the tertiary slot isn't rendered, so
        // filter(Boolean) naturally collapses this back to the original 2-button trap.
        var focusables = [cancelBtnRef.current, tertiaryBtnRef.current, confirmDisabled ? null : confirmBtnRef.current].filter(Boolean);
        if (focusables.length === 0) return;
        var active = document.activeElement;
        var idx = focusables.indexOf(active);
        var currentIdx = idx === -1 ? 0 : idx;
        var delta = ev.shiftKey ? -1 : 1;
        var nextIdx = (currentIdx + delta + focusables.length) % focusables.length;
        ev.preventDefault();
        focusables[nextIdx].focus();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return function() {
      window.removeEventListener('keydown', onKey, true);
      // Restore focus to whatever had it before the dialog opened.
      var toRestore = previouslyFocusedRef.current;
      if (toRestore && typeof toRestore.focus === 'function') {
        toRestore.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  var titleId = title ? 'confirm-modal-title' : undefined;
  var descId = 'confirm-modal-desc';

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: zIndex || 400, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        style={{
          background: theme.bgSecondary, borderRadius: isMobile ? 0 : 12,
          width: isMobile ? '100%' : 360, maxWidth: isMobile ? '100%' : '90vw',
          height: isMobile ? '100%' : undefined,
          padding: 24, boxShadow: isMobile ? 'none' : ('0 8px 32px ' + theme.shadow),
          display: isMobile ? 'flex' : undefined, flexDirection: isMobile ? 'column' : undefined,
          justifyContent: isMobile ? 'center' : undefined
        }}
        onClick={function(e) { e.stopPropagation(); }}
      >
        {title && (
          <div id={titleId} style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 4 }}>
            {title}
          </div>
        )}
        <div id={descId} style={{ fontSize: 14, color: theme.text, marginBottom: 20, lineHeight: 1.5 }}>
          {children != null ? children : message}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button ref={cancelBtnRef} onClick={onCancel} style={{
            border: '1px solid ' + theme.border, borderRadius: 8, padding: '8px 20px',
            background: 'transparent', color: theme.textSecondary, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>{cancelLabel || 'Cancel'}</button>
          {hasTertiary && (
            // bird-w6-003 WARN fix: styled distinct from Cancel/Confirm via the amber
            // warning family. bird-w6-011 BLOCK fix: theme.warning (#C8942A) is only
            // 2.61:1 on bgSecondary in light mode (fails WCAG 1.4.3/1.4.11) — use
            // theme.amberText instead, the codebase's already-darkened, WCAG-AA-safe
            // text variant for this exact brand-gold-on-light-background case (see the
            // theme/colors.js:124 comment); computed 6.85:1 light / 10.03:1 dark on
            // bgSecondary, passing both the 4.5:1 text and 3:1 non-text-border floors.
            <button ref={tertiaryBtnRef} onClick={onTertiary} style={{
              border: '1px solid ' + theme.amberText, borderRadius: 8, padding: '8px 20px',
              background: 'transparent', color: theme.amberText, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit'
            }}>{tertiaryLabel}</button>
          )}
          <button
            ref={confirmBtnRef}
            onClick={confirmDisabled ? undefined : onConfirm}
            disabled={!!confirmDisabled}
            style={{
              border: 'none', borderRadius: 8, padding: '8px 20px',
              background: theme.error, color: '#FDFAF5', fontWeight: 600, fontSize: 13,
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              opacity: confirmDisabled ? 0.5 : 1,
              fontFamily: 'inherit'
            }}>{confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}
