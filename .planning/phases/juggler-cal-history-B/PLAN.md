# JUGGLER: Calendar History Phase B - Frontend Status Refactor

**Phase:** B (Frontend Status Refactor)
**Status:** PLANNING
**Generated:** 2026-06-02
**Scope:** juggler-frontend
**Dependencies:** juggler-cal-history-A (completed)

## Overview

This plan covers the frontend implementation of Juggler Calendar History Phase B, focusing on two key areas:
1. Extension of STATUS_OPTIONS to include history-related statuses
2. Refactoring of isTerminalStatus usage across all 6 calendar views

## STATUS_OPTIONS Extension

### Current Status Options
The existing STATUS_OPTIONS array in `juggler-frontend/src/state/constants.js` currently includes:
- Empty (default)
- done
- wip
- cancel
- skip
- missed
- pause

### New History-Related Statuses (Phase B)
Two new statuses will be added to support calendar history functionality:

1. **archived** (`\uD83D\uDDC1`)
   - Value: `"archived"`
   - Label: File Cabinet emoji
   - Background: `#E5E7EB` (light gray)
   - Text Color: `#6B7280` (dark gray)
   - Tip: "Archived — moved to history"
   - Purpose: Tasks moved to historical archive

2. **restored** (`\u267B`)
   - Value: `"restored"`
   - Label: Recycling symbol
   - Background: `#DBEAFE` (light blue)
   - Text Color: `#1E40AF` (dark blue)
   - Tip: "Restored — brought back from history"
   - Purpose: Tasks restored from historical archive

### Implementation Details

**File:** `juggler-frontend/src/state/constants.js`

```javascript
// Lines 26-29: Add new history statuses after pause
{ value: "pause", label: "\u23F8", bg: "#E0E7FF", bgDark: "#1E1B4B", color: "#4338CA", colorDark: "#A5B4FC", tip: "Pause — temporarily inactive" },
// juggler-cal-history Plan B: new history-related statuses
{ value: "archived", label: "\uD83D\uDDC1", bg: "#E5E7EB", bgDark: "#374151", color: "#6B7280", colorDark: "#9CA3AF", tip: "Archived — moved to history" },
{ value: "restored", label: "\u267B", bg: "#DBEAFE", bgDark: "#1E3A8A", color: "#1E40AF", colorDark: "#93C5FD", tip: "Restored — brought back from history" },
];
```

**Line 32:** Add faded opacity constant for past terminal-state tasks
```javascript
// juggler-cal-history Plan B: faded opacity for past terminal-state tasks (D-10).
export const PAST_OPACITY = 0.60;
```

**Line 154:** Re-export isTerminalStatus from shared library
```javascript
// Import isTerminalStatus from shared lib/task-status.js
export { isTerminalStatus };
```

## isTerminalStatus Refactor Across 6 Views

### Shared Task Status Library
The `isTerminalStatus` function is defined in `juggler-frontend/src/shared/task-status.js` and includes the new history statuses in its TERMINAL_STATUSES array:

```javascript
const TERMINAL_STATUSES = Object.freeze([
  TaskStatus.DONE,
  TaskStatus.CANCEL,
  TaskStatus.SKIP,
  TaskStatus.PAUSE,
  TaskStatus.MISSED,
  TaskStatus.ARCHIVED,    // New for Phase B
  TaskStatus.RESTORED     // New for Phase B
]);
```

### Views Requiring Refactor
All 6 calendar views need to be updated to import `isTerminalStatus` from the shared library instead of local implementations:

1. **CalendarView.jsx** (`juggler-frontend/src/components/views/CalendarView.jsx`)
   - Location: D-05
   - Current: Local isTerminalStatus implementation
   - Change: Import from `'../shared/task-status'`

2. **DayView.jsx** (`juggler-frontend/src/components/views/DayView.jsx`)
   - Location: D-11
   - Current: Local isTerminalStatus implementation
   - Change: Import from `'../shared/task-status'`

3. **WeekView.jsx** (`juggler-frontend/src/components/views/WeekView.jsx`)
   - Current: Local isTerminalStatus implementation
   - Change: Import from `'../shared/task-status'`

4. **ThreeDayView.jsx** (`juggler-frontend/src/components/views/ThreeDayView.jsx`)
   - Current: Local isTerminalStatus implementation
   - Change: Import from `'../shared/task-status'`

5. **DailyView.jsx** (`juggler-frontend/src/components/views/DailyView.jsx`)
   - Current: Local isTerminalStatus implementation
   - Change: Import from `'../shared/task-status'`

6. **AllDayBanner.jsx** (`juggler-frontend/src/components/views/AllDayBanner.jsx`)
   - Location: D-14
   - Current: Local isTerminalStatus implementation
   - Change: Import from `'../shared/task-status'`

### Implementation Pattern
For each view, replace:
```javascript
// OLD: Local implementation
function isTerminalStatus(status) {
  return ['done', 'cancel', 'skip', 'pause', 'missed'].includes(status);
}
```

With:
```javascript
// NEW: Import from shared library
import { isTerminalStatus } from '../shared/task-status';
```

## Testing Requirements

### Unit Tests
- Update `juggler-frontend/src/state/__tests__/constants.test.js` to verify new STATUS_OPTIONS entries
- Add tests for new status values in task-status library tests
- Verify STATUS_MAP includes new statuses

### Integration Tests
- Test rendering of archived/restored tasks in all 6 calendar views
- Verify terminal status detection works correctly with new statuses
- Test opacity application for past terminal-state tasks

### Visual Regression
- Screenshot comparison for calendar views with history statuses
- Verify emoji rendering across browsers
- Test dark mode color schemes

## Acceptance Criteria

- [x] PLAN.md exists in `.planning/phases/juggler-cal-history-B/`
- [x] PLAN includes STATUS_OPTIONS export changes
- [x] PLAN lists all 6 views that need isTerminalStatus refactor
- [x] PLAN references D-05/D-11/D-14 (frontend locations)

## Files Modified

1. `juggler-frontend/src/state/constants.js` - STATUS_OPTIONS extension
2. `juggler-frontend/src/shared/task-status.js` - TERMINAL_STATUSES update
3. `juggler-frontend/src/components/views/CalendarView.jsx` - Import refactor
4. `juggler-frontend/src/components/views/DayView.jsx` - Import refactor
5. `juggler-frontend/src/components/views/WeekView.jsx` - Import refactor
6. `juggler-frontend/src/components/views/ThreeDayView.jsx` - Import refactor
7. `juggler-frontend/src/components/views/DailyView.jsx` - Import refactor
8. `juggler-frontend/src/components/views/AllDayBanner.jsx` - Import refactor

## Dependencies

- juggler-cal-history-A (database schema changes for history tracking)
- Shared task-status library must be available
- React testing library for unit tests

## Risks & Mitigations

**Risk:** Emoji rendering inconsistencies across browsers
**Mitigation:** Use Unicode escape sequences and test on multiple browsers

**Risk:** Import conflicts in views that already have isTerminalStatus
**Mitigation:** Remove local implementations before adding shared import

**Risk:** Terminal status logic changes affecting scheduling
**Mitigation:** Comprehensive unit tests for isTerminalStatus function

## Timeline

- STATUS_OPTIONS extension: 2 hours
- Shared library updates: 1 hour
- View refactoring (6 views): 4 hours
- Testing: 3 hours
- Total: 10 hours

## References

- D-05: CalendarView.jsx location
- D-11: DayView.jsx location  
- D-14: AllDayBanner.jsx location
- ROADMAP.md line ~7: juggler-cal-history-B phase definition