/**
 * StatusToggle — row of icon buttons for task status
 * High-contrast in both light and dark modes
 */

import React from 'react';
import { TERMINAL_STATUSES } from '../../shared/task-status';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { STATUS_OPTIONS, canTransitionTo } from '../../state/constants';

// 999.1231: descriptors (glyph/label/tokens) and the transition map both come
// from the canonical table in state/constants.js — this component previously
// forked its own ALL_STATUSES/VALID_TRANSITIONS copies (drifting on skip
// glyph/palette and the open glyph, and TaskDetailHeader forked a third,
// wip-less transition map). Labels are imperative verbs — they describe the
// ACTION clicking the button performs, not the state the task ends up in.
// A button is disabled if canTransitionTo(current, target) is false; terminal
// statuses (incl. backend-set cancelled/missed) allow reopen ("") only.
var ALL_STATUSES = STATUS_OPTIONS;

// juggler-cal-history Plan C — D-15: terminal transitions require scheduled_at.
// Disable done/skip/cancel buttons when the task has no scheduled time. Backend 400 guard
// is the source of truth; this is the UX nicety.
//
// sched-audit D-B (2026-07-02, REG-42/F1): superseded for the Unscheduled-lane row —
// David ruled unscheduled items ARE resolvable in place (the backend now stamps
// completion on scheduled_at=null rows), so DailyViewUnschedEntry no longer passes
// disableTerminal. This flag/guard remains available for callers that still need it
// (e.g. ScheduleCard/TaskCard's own scheduled_at gating is unaffected by this ruling).
var TERMINAL_REQUIRES_SCHEDULE = TERMINAL_STATUSES;

export default React.memo(function StatusToggle({ value, onChange, onDelete, darkMode, compact, isMobile, taskType, disableTerminal, hitSlop, instanceDate }) {
  var size = compact ? 16 : (isMobile ? 28 : 22);
  var fontSize = compact ? 8 : (isMobile ? 14 : 12);
  // sched-audit L3 bird WARN-4 / 999.1230 — the compact (16px) and desktop
  // (22px) buttons are below WCAG 2.2 SC 2.5.8's 24x24 CSS px minimum target
  // size. The invisible ≥24x24 hit-area wrapper is now OPT-OUT (999.1230): all
  // call sites get it by default; pass hitSlop={false} to render the bare
  // button (no caller currently does). The wrapper does not change the
  // button's own visual size.
  var slopSize = 24;
  var useHitSlop = hitSlop !== false;

  // Filter statuses based on task type
  var statuses = ALL_STATUSES;
  if (taskType === 'recurring_template') {
    // Templates can only be paused or unpaused
    statuses = statuses.filter(function(s) { return s.value === '' || s.value === 'pause'; });
  } else if (taskType === 'recurring_instance') {
    // Instances can't be paused — pause is template-level
    statuses = statuses.filter(function(s) { return s.value !== 'pause'; });
  }

  // ponytail: Delete removed from the status-button row. Delete is a destructive
  // data operation (hard row removal, R3), not a status change. Cancel (status='cancel',
  // R32) already covers "I don't want this" and keeps the record. Delete lives in the
  // TaskDetailHeader (expanded edit form) where destructive actions belong, separated
  // from the non-destructive status buttons. The onDelete prop is retained for the
  // TaskDetailHeader path; the compact card row no longer renders it.

  var currentStatus = value || '';

  // FR-2/AC3 (juggler-recur-lifecycle-redesign): explicit reactivation ("reopen") of an
  // already-settled (terminal) instance is blocked when the instance's own date is before
  // today. Same-day reactivation stays allowed. The client-snapshot undo mechanism (ruling
  // #3, juggler-ui-scheduler-rulings-2026-07-06) is a separate code path and unaffected by
  // this gate. `instanceDate` (YYYY-MM-DD, same convention as
  // evaluateFutureCompletionGuard's formatDateKey pairing) is optional for back-compat —
  // existing callers that don't pass it see unchanged (never-gated) behavior.
  var todayKey = formatDateKey(new Date());
  var reopenDateBlocked = !!(
    instanceDate &&
    TERMINAL_STATUSES.indexOf(currentStatus) !== -1 &&
    instanceDate < todayKey
  );

  return (
    <div style={{ display: 'flex', gap: compact ? 1 : 3, alignItems: 'center' }}>
      {statuses.map(function(s) {
        var active = currentStatus === s.value;
        // Disable if: (a) this IS the current status (no self-transition),
        //              (b) the transition is not valid per the state matrix,
        //              (c) terminal target requires scheduled_at and task has none.
        var isCurrent = active;
        var noTransition = !canTransitionTo(currentStatus, s.value);
        var needsSchedule = !!disableTerminal && TERMINAL_REQUIRES_SCHEDULE.indexOf(s.value) !== -1;
        var isReopenDateBlocked = s.value === '' && reopenDateBlocked;
        var isDisabled = isCurrent || noTransition || needsSchedule || isReopenDateBlocked;
        var button = (
          <button
            onClick={function(e) { e.stopPropagation(); if (!isDisabled) onChange(s.value); }}
            disabled={isDisabled}
            title={isCurrent ? 'Current status' : needsSchedule ? 'Schedule task before resolving' : s.label}
            aria-label={s.label}
            aria-pressed={active}
            style={{
              width: size, height: size,
              borderRadius: 4,
              border: active
                ? '1.5px solid ' + (darkMode ? s.colorDark : s.color)
                : '1px solid ' + (darkMode ? '#475569' : '#94A3B8'),
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: fontSize,
              fontWeight: 700,
              padding: 0,
              background: active ? (darkMode ? s.bgDark : s.bg) : (darkMode ? '#1E293B' : '#F5F0E8'),
              color: active ? (darkMode ? s.colorDark : s.color) : (darkMode ? '#64748B' : '#6B7280'),
              opacity: isDisabled ? 0.45 : 1,
              transition: 'background 0.1s, color 0.1s, border-color 0.1s',
              flexShrink: 0
            }}
          >
            {s.icon}
          </button>
        );
        if (!useHitSlop) return React.cloneElement(button, { key: s.value || 'open' });
        return (
          <span
            key={s.value || 'open'}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: slopSize, height: slopSize, flexShrink: 0 }}
          >
            {button}
          </span>
        );
      })}
    </div>
  );
})
