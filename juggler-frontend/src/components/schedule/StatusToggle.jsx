/**
 * StatusToggle — row of icon buttons for task status
 * High-contrast in both light and dark modes
 */

import React from 'react';
import { TERMINAL_STATUSES } from '../../shared/task-status';

// Labels are imperative verbs — they describe the ACTION clicking the button
// performs, not the state the task ends up in. Keeps the UI consistent
// ("Complete this task") instead of mixing past-participles ("Done", "Cancelled")
// with imperatives ("Cancel", "Pause").
var ALL_STATUSES = [
  { value: '',       icon: '\u25CB', label: 'Open',     activeBg: '#F5F0E8', activeBgDark: '#2C2B28', color: '#5C5A55', colorDark: '#B0A898' },
  { value: 'done',   icon: '\u2713', label: 'Complete', activeBg: '#D1FAE5', activeBgDark: '#0A3622', color: '#2D6A4F', colorDark: '#6EE7B7' },
  { value: 'wip',    icon: '\u231B', label: 'Start',    activeBg: '#FEF3C7', activeBgDark: '#3A2A08', color: '#9E6B3B', colorDark: '#E8C878' },
  { value: 'cancel', icon: '\u2715', label: 'Cancel',   activeBg: '#FEE2E2', activeBgDark: '#3A0A10', color: '#8B2635', colorDark: '#FCA5A5' },
  { value: 'skip',   icon: '\u21ED', label: 'Skip',     activeBg: '#F1F5F9', activeBgDark: '#1E293B', color: '#475569', colorDark: '#94A3B8' },
  { value: 'pause',  icon: '\u23F8', label: 'Pause',    activeBg: '#E0E7FF', activeBgDark: '#1E1B4B', color: '#4338CA', colorDark: '#A5B4FC' },
];

// Valid status transitions. A button is disabled if the transition from the
// current status to the button's status is not in this map. A status always
// maps to the set of statuses it can transition TO (not including itself).
//   "" (open) → done, wip, skip, cancel, pause
//   wip       → done, "" (reopen), skip, cancel
//   terminal  → "" (reopen only)
var VALID_TRANSITIONS = {
  '':      { 'done': 1, 'wip': 1, 'skip': 1, 'cancel': 1, 'pause': 1 },
  'wip':   { 'done': 1, '': 1, 'skip': 1, 'cancel': 1 },
  'done':  { '': 1 },
  'cancel': { '': 1 },
  'skip':  { '': 1 },
  'pause': { '': 1 },
};

function canTransitionTo(current, target) {
  var map = VALID_TRANSITIONS[current || ''];
  return !!(map && map[target]);
}

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

export default React.memo(function StatusToggle({ value, onChange, onDelete, darkMode, compact, isMobile, taskType, disableTerminal, hitSlop }) {
  var size = compact ? 16 : (isMobile ? 28 : 22);
  var fontSize = compact ? 8 : (isMobile ? 14 : 12);
  // sched-audit L3 bird WARN-4 — the compact (16px) button is below WCAG 2.2
  // SC 2.5.8's 24x24 CSS px minimum target size. `hitSlop` is opt-in per call
  // site (currently only DailyViewUnschedEntry's lane row, newly made a live
  // interactive target by F1) — it wraps each button in an invisible ≥24x24
  // hit-area without changing the button's own visual size, so every OTHER
  // StatusToggle call site (grid tile, TaskDetailHeader, etc.) renders
  // pixel-identical to before.
  var slopSize = 24;

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
        var isDisabled = isCurrent || noTransition || needsSchedule;
        var button = (
          <button
            onClick={function(e) { e.stopPropagation(); if (!isDisabled) onChange(s.value); }}
            disabled={isDisabled}
            title={isCurrent ? 'Current status' : needsSchedule ? 'Schedule task before resolving' : s.label}
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
              background: active ? (darkMode ? s.activeBgDark : s.activeBg) : (darkMode ? '#1E293B' : '#F5F0E8'),
              color: active ? (darkMode ? s.colorDark : s.color) : (darkMode ? '#64748B' : '#6B7280'),
              opacity: isDisabled ? 0.45 : 1,
              transition: 'background 0.1s, color 0.1s, border-color 0.1s',
              flexShrink: 0
            }}
          >
            {s.icon}
          </button>
        );
        if (!hitSlop) return React.cloneElement(button, { key: s.value || 'open' });
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
