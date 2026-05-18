/**
 * Placement mode constants.
 *
 * Values match the `task_masters.placement_mode` ENUM column exactly.
 * See migration 20260518000100 (placement_mode_enum_redesign).
 *
 * Removed in this redesign (D-01 through D-04):
 *   MARKER            → renamed to REMINDER
 *   FLEXIBLE          → split into ANYTIME / TIME_WINDOW / TIME_BLOCKS
 *   PINNED_DATE       → dropped (was reserved, never implemented)
 *   RECURRING_RIGID   → dropped (recurrence is orthogonal; use `recurring` flag)
 *   RECURRING_WINDOW  → dropped (recurrence is orthogonal; use `recurring` flag)
 *   RECURRING_FLEXIBLE→ dropped (recurrence is orthogonal; use `recurring` flag)
 */
var PLACEMENT_MODES = {
  REMINDER:    'reminder',
  ALL_DAY:     'all_day',
  FIXED:       'fixed',
  TIME_WINDOW: 'time_window',
  TIME_BLOCKS: 'time_blocks',
  ANYTIME:     'anytime',
};

module.exports = { PLACEMENT_MODES };
