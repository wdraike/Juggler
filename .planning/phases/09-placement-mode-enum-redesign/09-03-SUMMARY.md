---
phase: 09-placement-mode-enum-redesign
plan: 03
subsystem: api
tags: [node, express, placement-mode, task-controller, knex]

# Dependency graph
requires:
  - phase: 09-placement-mode-enum-redesign/09-01
    provides: DB migration — task_masters.placement_mode is 6-value ENUM
  - phase: 09-placement-mode-enum-redesign/09-02
    provides: PLACEMENT_MODES constants updated to 6-value set

provides:
  - "task.controller.js with derivePlacementMode() removed entirely"
  - "taskToRow writes placement_mode only from explicit client-supplied placementMode"
  - "rowToTask falls back to PLACEMENT_MODES.ANYTIME (was FLEXIBLE)"
  - "PLACEMENT_TRIGGER_FIELDS simplified to ['when', 'placementMode']"
  - "No 'fixed' or 'allday' tokens written to the when column from the controller"
  - "takeOwnership dead 'fixed' filter cleaned up"

affects:
  - 09-04
  - 09-05
  - 09-06

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct-write placement: UI supplies placement_mode; server never derives from when-content or legacy flags"
    - "No-derivation policy: absence of task.placementMode leaves row.placement_mode undefined (no fallback derivation)"

key-files:
  created: []
  modified:
    - juggler-backend/src/controllers/task.controller.js
    - juggler-backend/tests/taskMapping.test.js
    - juggler-backend/tests/unit/derivePlacementMode.test.js

key-decisions:
  - "DERIVE-REMOVE-01: derivePlacementMode() deleted entirely — eliminates when.includes('fixed') antipattern where user-defined tag names could cause misclassification"
  - "DIRECT-WRITE-01: placement_mode written only when client supplies task.placementMode; no server-side derivation from when/rigid/marker/recurring"
  - "ANYTIME-FALLBACK-01: rowToTask fallback changed from PLACEMENT_MODES.FLEXIBLE (removed) to PLACEMENT_MODES.ANYTIME"
  - "STRIP-DEAD-CODE-01: All 'strip fixed from when' blocks converted to .filter(Boolean) — 'fixed' no longer stored in when column post-migration"
  - "ALLDAY-MODE-01: allDay backstop now writes placement_mode = ALL_DAY instead of row.when = 'allday'"
  - "TIMED-TASK-01: timed task creation now writes placement_mode = FIXED instead of row.when = 'fixed'"
  - "SCOPE-EXT-01: Extended Task 2 cleanup to cover all 4 'strip fixed from when' paths in update/batch paths (not just the 2 specified in the plan) to satisfy t !== 'fixed' count = 0"

patterns-established:
  - "placement_mode is authoritative: scheduler branches on placement_mode directly, never on when-content"
  - "UI is the source of truth for placement_mode: server accepts and stores, never derives"

requirements-completed:
  - PM-ENUM-CONTROLLER

# Metrics
duration: 45min
completed: 2026-05-18
---

# Phase 09 Plan 03: Controller Placement Mode Redesign Summary

**derivePlacementMode() deleted from task.controller.js; placement_mode now written exclusively from client-supplied placementMode field, ending when-content derivation antipattern**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-18T15:00:00Z
- **Completed:** 2026-05-18T15:45:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Removed `derivePlacementMode()` — the 10-line function that inspected `when.includes('fixed')`, creating the classification bug where user-defined tag names like 'fixed-meeting' caused misclassification
- Simplified `PLACEMENT_TRIGGER_FIELDS` from 6 fields to `['when', 'placementMode']` — removed `marker`, `rigid`, `recurring`, `preferredTimeMins` which were only needed by the deleted derivation path
- Simplified `taskToRow` placement block from 12 lines (with derivation fallback) to 3 lines (direct write only)
- Changed `rowToTask` fallback from `PLACEMENT_MODES.FLEXIBLE` (removed constant) to `PLACEMENT_MODES.ANYTIME`
- Fixed task creation: timed tasks now set `placement_mode = FIXED` directly (no longer writes `when = 'fixed'`)
- Fixed allDay backstop in create/update paths: now sets `placement_mode = ALL_DAY` (no longer writes `when = 'allday'`)
- Cleaned all "strip 'fixed' from when" normalization blocks — converted to `.filter(Boolean)` since 'fixed' is no longer stored in `when` post-migration
- Replaced 9-test `derivePlacementMode.test.js` (6 skipped + 3 active) with 14-test direct-write suite; updated `taskMapping.test.js`; 23/23 tests pass

## Task Commits

1. **Task 1: Remove derivePlacementMode, fix PLACEMENT_TRIGGER_FIELDS, simplify taskToRow** — `995e703` (feat)
2. **Task 2: Fix task-creation when-path and clean takeOwnership dead code** — `995e703` (feat, combined with Task 1)

## Files Created/Modified

- `juggler-backend/src/controllers/task.controller.js` — removed derivePlacementMode(), simplified taskToRow placement block, updated rowToTask fallback, fixed creation paths, cleaned all 'strip fixed' filters
- `juggler-backend/tests/taskMapping.test.js` — updated 4 test assertions to expect undefined placement_mode when placementMode not explicitly supplied; added direct-write verification test
- `juggler-backend/tests/unit/derivePlacementMode.test.js` — replaced entirely: old function-behavior tests → new direct-write placement tests (23 total, 0 skipped)

## Decisions Made

- **DERIVE-REMOVE-01:** Deleted `derivePlacementMode()` entirely per D-11. The function's core antipattern (`when.includes('fixed')`) was the root cause of the bug this phase fixes.
- **DIRECT-WRITE-01:** `taskToRow` now writes `placement_mode` only when `task.placementMode !== undefined`. No fallback derivation. UI must be explicit.
- **SCOPE-EXT-01:** Extended cleanup beyond the two paths specified in Task 2 to cover all four `t !== 'fixed'` occurrences (fast-path update, slow-path update, two batch-update paths). All acceptance criteria require count = 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Extended 't !== fixed' cleanup to 4 additional code paths**
- **Found during:** Task 2 (verification step — `grep -c "t !== 'fixed'"` returned 4, not 0)
- **Issue:** The plan specified 2 locations for cleanup (timeWasCleared path + takeOwnership). Grep found 4 more `t !== 'fixed'` filter predicates in the fast-path update (line 930), and two batch-update paths (batchUpdateTasks loops). All four must be removed to satisfy the Task 2 acceptance criteria (`grep` count must be 0).
- **Fix:** Replaced all four remaining `filter(function(t) { return t && t !== 'fixed'; })` calls with `filter(Boolean)` — preserving the original trim-and-compact intent while removing the dead 'fixed'-specific predicate. Also removed the now-dead `timeWasCleared` block entirely (it checked if any existing `when` tokens matched 'fixed', which can never happen post-migration).
- **Files modified:** `juggler-backend/src/controllers/task.controller.js`
- **Verification:** `grep -c "t !== 'fixed'" src/controllers/task.controller.js` returns 0
- **Committed in:** 995e703

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug/incomplete cleanup)
**Impact on plan:** Required to satisfy plan's own acceptance criteria. No scope creep — all edits are within `task.controller.js`.

## Issues Encountered

- `PLACEMENT_TRIGGER_FIELDS` comment update: The old comment said "require us to re-derive placement_mode" — updated to reflect the new semantics ("cause placement_mode to be written").
- Pre-existing test failures in `schedulerRules`, `schedulerScenarios`, `cal-sync/*`, `security/*` suites are unrelated to this plan — they require live DB/credentials and were failing before these changes (confirmed by REPORT.md: "cal-sync integration: 13 suites — requires live credentials (pre-existing)").

## Known Stubs

None — all placement_mode writes are wired to PLACEMENT_MODES constants.

## Threat Flags

None — no new network endpoints or auth paths introduced. The MySQL ENUM column rejects invalid placement_mode values at the DB layer (T-09-03-01 accepted as DB-gate mitigation per threat model).

## Next Phase Readiness

- `task.controller.js` is fully updated — ready for Plan 09-04 (scheduler unifiedScheduleV2.js updates)
- Plan 09-04 can safely replace all `PLACEMENT_MODES.MARKER/FLEXIBLE/RECURRING_*` references in the scheduler, knowing the controller write-path is already clean

---
*Phase: 09-placement-mode-enum-redesign*
*Completed: 2026-05-18*
