/**
 * Recurring task expansion — re-exports from shared module
 */

const shared = require('juggler-shared/scheduler/expandRecurring');

export const expandRecurring = shared.expandRecurring;
export const isAnchorDependentRecur = shared.isAnchorDependentRecur;
// 999.1110: pattern-walk used to validate/snap the editable "Next Cycle
// Starts" anchor to a date the master's own recur pattern allows — the SAME
// predicate (matchesRecurrenceDay) the expansion loop and the backend's
// next-occurrence-anchor.js use.
export const nextMatchingDate = shared.nextMatchingDate;
