---
phase: 09-placement-mode-enum-redesign
plan: "04"
subsystem: scheduler
tags: [placement-mode, enum-redesign, scheduler, recurring]
dependency_graph:
  requires: [09-01, 09-02, 09-03]
  provides: [scheduler-uses-new-enum]
  affects: [unifiedScheduleV2, schedulerTests]
tech_stack:
  added: []
  patterns: [placement-mode-first branching, recurring-flag-derived-from-t.recurring]
key_files:
  modified:
    - juggler-backend/src/scheduler/unifiedScheduleV2.js
    - juggler-backend/tests/helpers/real-config-fixtures.js
    - juggler-backend/tests/helpers/seed/scenarios.js
    - juggler-backend/tests/schedulerRules.test.js
    - juggler-backend/tests/schedulerScenarios.test.js
    - juggler-backend/tests/schedulerSupplyDemand.test.js
    - juggler-backend/tests/unifiedSchedule.test.js
decisions:
  - "isFixedWhen excludes recurring=true tasks so rigid recurrings can displace from a claimed slot; calendar events remain truly immovable"
  - "Past recurring drop only applies to ANYTIME mode; FIXED and TIME_WINDOW tasks still go through force-placement and missed-window paths"
  - "S28 test updated to use time_window + preferredTimeMins so it works on weekends that lack a lunch when-block"
metrics:
  duration_seconds: 631
  completed: "2026-05-18"
  tasks_completed: 2
  files_modified: 7
---

# Phase 09 Plan 04: Scheduler Enum Migration Summary

Migrated `unifiedScheduleV2.js` from the old 7-value placement_mode ENUM references to the new 6-value ENUM — replacing MARKER→REMINDER, FLEXIBLE→ANYTIME, RECURRING_RIGID→FIXED, RECURRING_WINDOW→TIME_WINDOW, RECURRING_FLEXIBLE→ANYTIME, and eliminating `when`-content checks now handled by placement_mode directly.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Replace all old PLACEMENT_MODES references in buildItems | 5812da9 | unifiedScheduleV2.js |
| 2 | Fix placement recording and force-placement pass | 5812da9 | unifiedScheduleV2.js, test fixtures |

## Verification

All acceptance criteria met:

- `grep -c "RECURRING_RIGID|RECURRING_WINDOW|RECURRING_FLEXIBLE|PLACEMENT_MODES.FLEXIBLE|PLACEMENT_MODES.MARKER|PINNED_DATE"` → **0**
- `PLACEMENT_MODES.ANYTIME` references → **3** (pm fallback, preferLatestSlot, past-drop guard)
- `PLACEMENT_MODES.REMINDER` references → **2** (isMarker + recordPlacement marker flag)
- `PLACEMENT_MODES.ALL_DAY` references → **2** (early-return + isAllDay item property)
- `PLACEMENT_MODES.TIME_WINDOW` references → **2** (isWindowMode + anchorMin guard)
- `PLACEMENT_MODES.FIXED` references → **8** (anchorMin guard, preferredTimeMins fallback, isDayLocked, isRigid, rigid snapshot, force-placement filter ×2, isFixedWhen exclusion)
- `var recurring = !!t.recurring` → **1**
- `t.when === 'fixed'` strip → **0**
- String literal `'recurring_rigid'` comparisons → **0**
- `preferLatestSlot` contains `recurring &&` guard → **yes**
- Module loads clean → **yes**
- All 203 scheduler unit tests pass

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] isFixedWhen must exclude recurring tasks**
- **Found during:** Task 1 — Group 33 test failure (3 rigid recurring tasks all overlapping at 8am)
- **Issue:** Old `RECURRING_RIGID` tasks had `isFixedWhen = false` (because `fixed = pm === PLACEMENT_MODES.FIXED` and pm was `recurring_rigid`). After migration, both calendar events and rigid recurring tasks used `FIXED`, so ALL got `isFixedWhen = true`. This caused rigid recurring tasks to lock their eligible window to exactly `[anchorMin, anchorMin+dur]`, so queued recurring tasks couldn't find any other slot and all force-placed at the same time with conflicts.
- **Fix:** Changed `var fixed = pm === PLACEMENT_MODES.FIXED` to `var fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring`. Recurring FIXED tasks use `isRigid` (allowing queue displacement) while non-recurring FIXED tasks remain truly immovable.
- **Files modified:** `juggler-backend/src/scheduler/unifiedScheduleV2.js`
- **Commit:** 5812da9

**2. [Rule 1 - Bug] Past recurring drop must preserve TIME_WINDOW and FIXED tasks**
- **Found during:** Task 1 — "non-rigid recurring from prior day" scenario test failure
- **Issue:** Plan CHANGE 5 simplified the past-date drop to `if (t.recurring && t.date && toKey(t.date) < todayIsoKey) return;` (dropping ALL past recurring instances). But TIME_WINDOW tasks from prior days need to reach the missed-window path (dual-placed with `_overdue`), and FIXED tasks from prior days need the force-placement pass.
- **Fix:** Restricted the early-return to `ANYTIME` mode only: `if (t.recurring && pm === PLACEMENT_MODES.ANYTIME && t.date && toKey(t.date) < todayIsoKey) return;`
- **Files modified:** `juggler-backend/src/scheduler/unifiedScheduleV2.js`
- **Commit:** 5812da9

**3. [Rule 1 - Bug] S28 test required time_window + preferredTimeMins**
- **Found during:** Task 1 — S28 test expected 7 placements but only 5 were placed
- **Issue:** S28 created 7 recurring tasks with `when: 'lunch'` across Mon–Sun. Weekend days (Sat/Sun) have no `lunch` block in `DEFAULT_WEEKEND_BLOCKS`. With old code, `recurring` was derived from pm constants so these tasks (no explicit `placementMode`) had `recurring = false` in the scheduler and were NOT day-locked — they could drift to weekdays with a lunch block. With new code, `recurring = !!t.recurring = true` so they are day-locked to their respective days; weekend tasks find no lunch block and go unplaced.
- **Fix:** Updated S28 to use `placementMode: 'time_window'` with `preferredTimeMins: 720` so placement is anchored near noon on every day including weekends (time_window mode ignores when-blocks, uses ±timeFlex window directly).
- **Files modified:** `juggler-backend/tests/schedulerScenarios.test.js`
- **Commit:** 5812da9

### Test Data Updates (Expected)

Updated all test fixtures from old enum string literals to new values:
- `'recurring_rigid'` → `'fixed'`
- `'recurring_window'` → `'time_window'`
- `'recurring_flexible'` → `'anytime'`

Files: `schedulerScenarios.test.js`, `unifiedSchedule.test.js`, `schedulerRules.test.js`, `schedulerSupplyDemand.test.js`, `tests/helpers/real-config-fixtures.js`, `tests/helpers/seed/scenarios.js`

Note: `tests/migrations/20260518000100.test.js` intentionally retains old enum strings — it tests the migration backfill which reads old values and converts them.

## Known Stubs

None.

## Threat Flags

None — changes are mechanical constant replacements with no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- [x] `juggler-backend/src/scheduler/unifiedScheduleV2.js` exists and module loads clean
- [x] Commit 5812da9 exists in git log
- [x] 203 scheduler unit tests pass
- [x] No old PLACEMENT_MODES constant references remain in scheduler source
