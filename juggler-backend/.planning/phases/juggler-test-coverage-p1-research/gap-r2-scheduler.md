# R2: Scheduler Coverage Gap Report

## schedulerSession.js
Exists: yes
Exported functions: `startSession`, `getSession`, `getStep`, `getSummary`, `stopSession`, `_computeStep`, `_computeSummary`

---

## File-by-file exported function inventory

### `src/scheduler/unifiedScheduleV2.js`
Single export: `unifiedScheduleV2` (the main scheduler entry point).
All internal helpers (`effectiveDuration`, `buildItems`, `parseDayReq`, `recurringCycleDays`, `findEarliestSlot`, `findLatestSlot`, `computeSlack`, `tryPlaceQueued`, `placeSplitInline`, `compareItems`, etc.) are module-private — not exported.

### `src/scheduler/runSchedule.js`
Exported: `runScheduleAndPersist`, `getSchedulePlacements`, `computeWindowCloseUtc`
Internal (not exported): `runSchedulerWithShadow`, `getNowInTimezone`

### `src/scheduler/reconcileOccurrences.js`
Exported: `buildExistingGroups`, `matchOccurrences`

### `src/scheduler/dependencyHelpers.js`
Re-exports from `shared/scheduler/dependencyHelpers.js`:
`getTaskDeps`, `getDepsStatus`, `topoSortTasks`, `getDependents`

### `src/scheduler/scheduleQueue.js`
Exported (public): `enqueueScheduleRun`, `stopPollLoop`, `getLastError`
Exported (internal/test): `_internal.tryClaim`, `_internal.releaseClaim`, `_internal.CLAIM_TTL_SECONDS`, `_internal.INSTANCE_ID`
Internal (not exported): `processUser`, `pollLoop`, `sweep` (timer-started at module load)

### `src/scheduler/schedulerSession.js`
Exported: `startSession`, `getSession`, `getStep`, `getSummary`, `stopSession`, `_computeStep`, `_computeSummary`
Internal (not exported): `sweep` (timer-started at module load), `newSessionId`

### `src/scheduler/scoreSchedule.js`
Single export: `scoreSchedule`
Internal (not exported): `parseDateKey`, `priWeight`

### `src/scheduler/constants.js`
Data-only exports: `PRI_RANK`, `TASK_DEFAULTS`, `DAY_NAMES`, `GRID_START`, `GRID_END`, `DEFAULT_TOOLS`, `DEFAULT_TOOL_MATRIX`, `DEFAULT_WEEKDAY_BLOCKS`, `DEFAULT_WEEKEND_BLOCKS`, `DEFAULT_TIME_BLOCKS`, `DEFAULT_TIMEZONE`, `SCHEDULER_VERSION`, `RECUR_EXPAND_DAYS`. No functions.

### Shared scheduler helpers (re-exported via thin wrappers in `src/scheduler/`)
- `dateHelpers.js` → `shared/scheduler/dateHelpers.js`: `inferYear`, `parseDate`, `formatDateKey`, `isoToDateKey`, `getWeekStart`, `isSameDay`, `parseTimeToMinutes`, `toTime24`, `fromTime24`, `toDateISO`, `fromDateISO`, `formatHour`, `getDayName`, `localToUtc`, `utcToLocal`, `isValidTimezone`, `safeTimezone`, `formatMinutesToTime`, `formatMinutesToTimeDb`
- `timeBlockHelpers.js` → `shared/scheduler/timeBlockHelpers.js`: `cloneBlocks`, `getBlocksForDate`, `getBlocksForDay`, `buildWindowsFromBlocks`, `getUniqueTags`, `getBlockAtMinute`, `isBizHour`, `parseWhen`, `hasWhen`, `getWhenWindows`
- `locationHelpers.js` → `shared/scheduler/locationHelpers.js`: `migrateTask`, `resolveLocationId`, `getLocObj`, `resolveDayLocation`, `canTaskRun`, `canTaskRunAtMin`, `getLocationForDatePure`, `getLocationForHourPure`, `isTaskBlockedPure`

---

## Untested exported functions

| Function | File | Gap type |
|----------|------|----------|
| `stopPollLoop` | `scheduleQueue.js` | Zero direct test coverage — only appears as a jest.fn() mock stub in other test files (schedule-routes, config, etc.); the real function body (clearInterval) is never exercised |
| `getLastError` | `scheduleQueue.js` | Zero direct test coverage — only mocked, never called on the real module |
| `processUser` (internal, not exported but core logic) | `scheduleQueue.js` | Zero coverage — all scheduleQueue.test.js tests are skipped (describe.skip); scheduleQueueClaiming.test.js only exercises tryClaim/releaseClaim |
| `pollLoop` (internal, not exported) | `scheduleQueue.js` | Zero coverage — same reason |
| `startSession` | `schedulerSession.js` | Zero direct coverage — mocked as jest.fn() in schedule-routes.test.js; DB-backed path never exercised; listed as PLANNED (SC-50) |
| `getStep` | `schedulerSession.js` | Zero direct coverage — mocked in schedule-routes.test.js; DB path not exercised; listed as PLANNED (SC-51/SC-52) |
| `getSummary` | `schedulerSession.js` | Zero direct coverage — mocked in schedule-routes.test.js; DB path not exercised; listed as PLANNED (SC-53) |
| `guardFixedCalendarWhen` | `task.controller.js` (used by scheduler path, exported) | Zero test coverage — listed as PLANNED (SM-03) but test file `derivePlacementMode.test.js` does not currently test it |
| `applySplitDefault` | `task.controller.js` (used by scheduler path, exported) | Zero test coverage — listed as GAP (SM-04), no plan assigned |
| `parseDayReq` (internal) | `unifiedScheduleV2.js` | Module-private, not exported. Exercised indirectly via `unifiedScheduleV2` through schedulerRules.test.js Group 11 and schedulerDeepCoverage UC-2.6/UC-2.7, but no isolated unit test. Listed as PLANNED (SC-14), incorrectly targeted at `schedulerSession.test.js` (that test file has no parseDayReq tests) |
| `recurringCycleDays` (internal) | `unifiedScheduleV2.js` | Module-private, not exported. Exercised indirectly via `unifiedScheduleV2`. Listed as PLANNED (SC-15), same mismatch — targeted at `schedulerSession.test.js` which has no coverage of it |

### Functions with coverage confirmed

| Function | File | Covered by |
|----------|------|------------|
| `unifiedScheduleV2` | `unifiedScheduleV2.js` | `schedulerRules.test.js` (Groups 1–61), `schedulerDeepCoverage.test.js`, `schedulerScenarios.test.js`, `schedulerTimeSimulation.test.js` |
| `runScheduleAndPersist` | `runSchedule.js` | `runScheduleIntegration.test.js` |
| `getSchedulePlacements` | `runSchedule.js` | `schedulePlacementsIntegration.test.js` |
| `computeWindowCloseUtc` | `runSchedule.js` | `tests/scheduler/past-window-missed.test.js` |
| `buildExistingGroups` | `reconcileOccurrences.js` | `reconcileOccurrences.test.js` |
| `matchOccurrences` | `reconcileOccurrences.js` | `reconcileOccurrences.test.js` |
| `getTaskDeps` | `dependencyHelpers.js` | `dependencyHelpers.test.js` |
| `getDepsStatus` | `dependencyHelpers.js` | `dependencyHelpers.test.js` |
| `topoSortTasks` | `dependencyHelpers.js` | `dependencyHelpers.test.js` |
| `getDependents` | `dependencyHelpers.js` | `dependencyHelpers.test.js` |
| `enqueueScheduleRun` | `scheduleQueue.js` | `scheduleQueue.test.js` (all tests skipped); exercised indirectly via integration tests (runScheduleIntegration) |
| `tryClaim` (via `_internal`) | `scheduleQueue.js` | `scheduleQueueClaiming.test.js` (DB-conditional) |
| `releaseClaim` (via `_internal`) | `scheduleQueue.js` | `scheduleQueueClaiming.test.js` (DB-conditional) |
| `scoreSchedule` | `scoreSchedule.js` | `scoreSchedule.test.js` (top-level); `tests/unit/scoreSchedule.test.js` |
| `_computeStep` | `schedulerSession.js` | `tests/unit/schedulerSession.test.js` |
| `_computeSummary` | `schedulerSession.js` | `tests/unit/schedulerSession.test.js` |
| `getSession` | `schedulerSession.js` | `tests/unit/schedulerSession.test.js` (mock-DB, null + found cases) |
| `stopSession` | `schedulerSession.js` | `tests/unit/schedulerSession.test.js` (mock-DB) |

---

## PLANNED items still outstanding (from TEST-USE-CASES.md §1)

| ID | Description | Target test file | Notes |
|----|-------------|-----------------|-------|
| SC-14 | `parseDayReq`: any / weekday / weekend / M,W,F / Sa / unrecognized | `tests/unit/schedulerSession.test.js` | File exists but has NO parseDayReq tests — target file is wrong; parseDayReq is private to unifiedScheduleV2 and would need export or indirect test |
| SC-15 | `recurringCycleDays`: daily / weekly / biweekly / monthly / interval | `tests/unit/schedulerSession.test.js` | Same issue — file exists but no tests; function is private |
| SC-20 | Score: deadline miss penalty (isolation test) | `tests/unit/scoreSchedule.test.js` | File exists and tests this — STATUS should be COVERED |
| SC-21 | Score: priority waste penalty | `tests/unit/scoreSchedule.test.js` | File exists and tests priority drift — STATUS should be COVERED |
| SC-22 | Score: fragmentation penalty | `tests/unit/scoreSchedule.test.js` | File exists and tests fragmentation — STATUS should be COVERED |
| SC-36 | Dependency ordering persisted to DB | `schedulerPersistIntegration.test.js` | Not yet written |
| SC-37 | Split chunk scheduling persisted to DB | `schedulerPersistIntegration.test.js` | Not yet written |
| SC-50 | `startSession`: creates session, returns sessionId | `tests/unit/schedulerSession.test.js` | Not tested; file exists but only tests _computeStep/_computeSummary/getSession/stopSession |
| SC-51 | `getSession`: returns session state | `tests/unit/schedulerSession.test.js` | Partially covered (mock-DB null + found) — missing TTL extension verification |
| SC-52 | `_computeStep`: returns step data for index | `tests/unit/schedulerSession.test.js` | COVERED (5 tests in file) |
| SC-53 | `_computeSummary`: returns wave summary | `tests/unit/schedulerSession.test.js` | COVERED (5 tests in file) |
| SC-54 | `stopSession`: cleans up session state | `tests/unit/schedulerSession.test.js` | COVERED (1 test) |
| SM-03 | `guardFixedCalendarWhen` — calendar event `when=fixed` protection | `tests/unit/derivePlacementMode.test.js` | File exists but has zero guardFixedCalendarWhen tests |
| SM-04 | `applySplitDefault` — split minimum default applied | — | GAP — no plan, no test file |

---

## Additional gap: scheduleQueue.test.js fully skipped

`tests/scheduleQueue.test.js` wraps all 6 tests in `describe.skip(...)`. The comment explains this is because timing is coupled to the real poll loop (DEBOUNCE_MS=2000, POLL_MS=1000). None of the following behaviors have runnable tests:
- `enqueueScheduleRun` triggering a scheduler run
- Multi-user independence
- Error containment in processUser
- Lock contention retry (3 attempts)
- Successful retry after failed claim

This is a structural gap — the public API of the queue module is formally untested outside integration scenarios.

---

## Summary

- Total exported functions audited across all `src/scheduler/` files: 26 (counting `_internal.*` separately from the 3 main scheduleQueue exports; not counting constants which has no functions; not counting the shared/ helpers which have their own tests)
- Functions with meaningful test coverage: 18
- Functions with zero or only-mocked test coverage: 8
  - `stopPollLoop` (scheduleQueue)
  - `getLastError` (scheduleQueue)
  - `processUser` / `pollLoop` (scheduleQueue — internal, not exported, but represent the bulk of queue logic)
  - `startSession` (schedulerSession — DB path)
  - `getStep` (schedulerSession — DB path)
  - `getSummary` (schedulerSession — DB path)
  - `guardFixedCalendarWhen` (task.controller, scheduler-path function)
  - `applySplitDefault` (task.controller, scheduler-path function)
- PLANNED items in TEST-USE-CASES.md that are actually COVERED by existing unit tests (status stale): SC-20, SC-21, SC-22, SC-52, SC-53, SC-54
- PLANNED items with target-file mismatch: SC-14, SC-15 (assigned to schedulerSession.test.js, which has no such tests and cannot easily add them because the functions are private to unifiedScheduleV2)
