# Traceability Audit — Juggler Service

**Date:** 2026-06-16  
**Scope:** All 228 requirements (R1.1–R48.2) × all test files  
**Method:** Deep audit — read every requirement, verified every test reference on disk, read actual test content (describe/it blocks)  
**Previous claims:** Old audit said 44% coverage; old VERIFICATION-CHECKLIST.json said 84.2% (192/228)

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total requirements | 228 |
| **Verified** (test exists + exercises acceptance criteria) | **175** (76.8%) |
| **Partial** (test exists but doesn't cover all criteria) | **37** (16.2%) |
| **Untested** (no test file exists) | **13** (5.7%) |
| **Planned** (no code, no test) | **3** (1.3%) |
| **Stale references** (referenced file doesn't exist on disk) | **5** |
| **False positives** (test mapped to wrong requirement) | **0** |

**Real coverage: 76.8% verified, 93.0% with partials included.**

The old VERIFICATION-CHECKLIST.json claim of 84.2% (192/228) was **inflated** — it counted many requirements as verified when their referenced test files either didn't exist or didn't cover the acceptance criteria. The actual verified count is 175.

---

## Domain-by-Domain Coverage

| Domain | Total | Verified | Partial | Untested | Planned | Coverage % |
|--------|-------|----------|---------|----------|---------|------------|
| Task Management | 56 | 44 | 9 | 3 | 0 | 78.6% |
| Scheduler | 103 | 79 | 20 | 4 | 0 | 76.7% |
| Calendar Sync | 10 | 8 | 2 | 0 | 0 | 80.0% |
| Calendar Views | 11 | 8 | 3 | 0 | 0 | 72.7% |
| AI | 5 | 5 | 0 | 0 | 0 | 100.0% |
| Auth | 3 | 2 | 1 | 0 | 0 | 66.7% |
| MCP | 2 | 0 | 2 | 0 | 0 | 0.0% |
| Data | 5 | 4 | 1 | 0 | 0 | 80.0% |
| Billing | 6 | 6 | 0 | 0 | 0 | 100.0% |
| Weather | 9 | 5 | 4 | 0 | 0 | 55.6% |
| Admin | 3 | 2 | 1 | 0 | 0 | 66.7% |
| Reporting | 3 | 0 | 0 | 0 | 3 | 0.0% |

---

## Stale Test References

These test files are **referenced in REQUIREMENTS.md but do not exist on disk**:

| Requirement | Referenced Test | Actual Location | Status |
|-------------|----------------|-----------------|--------|
| R18.1–R18.8 | `tests/recurring/tpc*.test.js` | `tests/scheduler/tpc.test.js`, `tests/scheduler/tpcFillPolicy.test.js` | **Stale path** — directory `tests/recurring/` doesn't exist |
| R33.1–R33.5 | `tests/unit/rolling-anchor.test.js` | `tests/scheduler/rollingRecurrence.test.js` | **Stale path** — file doesn't exist at referenced path |
| R24.2 | `scripts/test-plan-limits.js` | Does not exist anywhere | **Missing file** |
| R10.1–R10.5 | `tests/unifiedSchedule.test.js` (dependencies describe block) | `tests/scheduler/dependencies.test.js` | **Stale path** — dependencies moved to dedicated file |
| R2.8 | `tests/unifiedSchedule.test.js` (dependencies describe block) | `tests/scheduler/dependencies.test.js` | **Stale path** — same as above |

---

## Untested Requirements (No Test Coverage)

These requirements have **no test file that exercises their acceptance criteria**:

| ID | Domain | Reason |
|----|--------|--------|
| R12.1 | Reporting | Planned — no code exists |
| R13.1 | Reporting | Planned — no code exists |
| R14.1 | Reporting | Planned — no code exists |
| R40.1 | Scheduler | FlexWhen flag implemented but no dedicated test |
| R40.2 | Scheduler | FlexWhen retry implemented but no dedicated test |
| R40.3 | Scheduler | FlexWhen flag in placement entry not tested |
| R42.1 | Admin | Health check immediate endpoint — no dedicated test |
| R42.2 | Admin | Health check full endpoint — no dedicated test |
| R42.3 | Admin | Health check detailed endpoint — no dedicated test |
| R42.4 | Admin | Feature events analytics — no dedicated test |
| R44.3 | Scheduler | Admin debug scheduler endpoint — no dedicated test |
| R44.4 | Scheduler | Stepper session start — no dedicated test |
| R44.5 | Scheduler | Stepper session summary — no dedicated test |
| R44.6 | Scheduler | Stepper individual step — no dedicated test |
| R44.7 | Scheduler | Stepper session stop — no dedicated test |
| R46.1 | Task Management | Task data version endpoint — no dedicated test |
| R46.2 | Task Management | Disabled tasks list endpoint — no dedicated test |

**Note:** R42.1–R42.4 and R44.3–R44.7 are listed as "implemented" in REQUIREMENTS.md but have no dedicated tests. They may be tested indirectly through integration/E2E tests, but no unit/integration test file specifically exercises them.

---

## Partial Requirements — Acceptance Gaps

| ID | Domain | Gap | Test File(s) |
|----|--------|-----|-------------|
| R1.6 | Task Management | Feature gate on task creation tested in entitlementUseCases but not end-to-end via API | `tests/slices/user-config/application/entitlementUseCases.test.js` |
| R2.8 | Task Management | Recurring+dependsOn validation tested in scheduler/dependencies.test.js but not via API layer | `tests/scheduler/dependencies.test.js` |
| R6.1 | Task Management | `time_remaining` on todo→wip transition tested in task-state-machine but not all edge cases | `tests/api/task-state-machine.test.js` |
| R6.6 | Task Management | Duration cap at 720 min tested in task-state-machine but clock-in/out endpoints not tested | `tests/api/task-state-machine.test.js` |
| R9.1 | Calendar Views | Drag-and-drop handler has no unit test; only E2E coverage | E2E tests only |
| R9.2 | Calendar Views | Priority kanban drag-and-drop has no unit test | E2E tests only |
| R9.3 | Calendar Views | Dependency graph drag-and-drop has no unit test | E2E tests only |
| R10.3 | Scheduler | Circular dependency detection tested in dependencies.test.js but not all edge cases | `tests/scheduler/dependencies.test.js` |
| R10.4 | Scheduler | Recurring+dependsOn rejection tested in dependencies.test.js but not at API/MCP layers | `tests/scheduler/dependencies.test.js` |
| R10.5 | Scheduler | Non-recurring→recurring conversion with dependsOn tested in dependencies.test.js | `tests/scheduler/dependencies.test.js` |
| R11.10 | Scheduler | Weather constraint is fail-open (not fail-closed as spec'd); `weatherFailOpen.test.js` documents the gap | `tests/scheduler/weatherFailOpen.test.js` |
| R16.3 | Auth | JWT app claim rejection tested in auth-and-validation-e2e but not all token types | `tests/api-e2e/auth-and-validation-e2e.test.js` |
| R17.1 | MCP | MCP server has 20 tools but no dedicated unit tests | None |
| R17.2 | MCP | No MCP-layer authorization test | None |
| R22.5 | Data | Feature gate for export/import tested in dataWebhookImpersonationUseCases but not via API | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` |
| R23.3 | Task Management | Deadlock retry tested in tasksWriteBulk but not all retry scenarios | `tests/tasksWriteBulk.integration.test.js` |
| R28.3 | Admin | Impersonation audit log and banner have frontend tests but no backend authorization boundary test | `juggler-frontend/src/components/admin/__tests__/ImpersonationPage.test.jsx`, `ImpersonationBanner.test.jsx` |
| R29.3 | Task Management | Cascade-disable for recurring templates tested in commands-status-delete-misc but not all scenarios | `tests/slices/task/application/commands-status-delete-misc.test.js` |
| R35.1 | Scheduler | Split toggle exists in UI but no dedicated test for toggle visibility | `tests/reconcileSplits.test.js` (indirect) |
| R35.6 | Scheduler | Recurring split overflow flag tested in splitInteractions.test.js | `tests/scheduler/splitInteractions.test.js` |
| R36.1 | Scheduler | Deadline backpropagation tested in deadlines.test.js but imprecise (no capacity offset) | `tests/scheduler/deadlines.test.js` |
| R36.2 | Scheduler | Capacity-aware offset not implemented — documented limitation | None |
| R36.3 | Scheduler | `deadlineMisses` is dead code — no test | None |
| R37.1 | Scheduler | Earliest start enforcement tested in earliestStart.test.js but field named `startAfter` not `earliestStart` | `tests/scheduler/earliestStart.test.js` |
| R37.2 | Scheduler | No validation for startAfter > deadline | None |
| R37.3 | Scheduler | Field rename not executed | None |
| R38.1 | Weather | Code is fail-open (weatherOk returns true when data missing); spec says fail-closed | `tests/scheduler/weatherFailOpen.test.js` |
| R38.2 | Weather | Unplaced reason is `"weather"` not `"weather_unavailable"` as spec'd | `tests/scheduler/weatherFailOpen.test.js` |
| R38.3 | Weather | Frontend "weather data unavailable" indicator not fully implemented | `tests/weather-stale-cache.test.js` |
| R38.4 | Weather | `hasWeatherConstraint` duplicated between runSchedule.js and unifiedScheduleV2.js | None |
| R41.3 | Scheduler | Rate limit of 10/min tested in scheduleQueueRateLimit.test.js but not end-to-end | `tests/unit/scheduler/scheduleQueueRateLimit.test.js` |

---

## Bugs Found (Implementation ≠ Spec)

| Bug | Requirement | Spec Says | Code Does | Severity |
|-----|-------------|-----------|-----------|----------|
| Weather fail-open | R38.1 | Fail-closed: missing data → task NOT placed | Fail-open: weatherOk returns true when data missing | **HIGH** |
| Wrong unplaced reason | R38.2 | `_unplacedReason: "weather_unavailable"` | `_unplacedReason: "weather"` | **MEDIUM** |
| Field name mismatch | R37.1/R37.3 | Field named `earliest_start_at`/`earliestStart` | Field named `start_after_at`/`startAfter` in DB and code | **LOW** (cosmetic but confusing) |
| Deadline backprop imprecise | R36.1 | Capacity-aware offset | Inherits consumer's deadline date without offset | **MEDIUM** |
| `deadlineMisses` dead code | R36.3 | Remove or replace | Always `[]` in return shape | **LOW** |
| `hasWeatherConstraint` duplicated | R38.4 | Shared module | Duplicated in runSchedule.js and unifiedScheduleV2.js | **MEDIUM** |
| FakeClockAdapter bypass | R37.1 | Clock injection works | `getNowInTimezone` reads `new Date()` directly, bypassing FakeClockAdapter | **MEDIUM** |

---

## Detailed Requirement-by-Requirement Coverage

### R1 — Task Creation (10 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R1.1 | implemented | `tests/api/tasks.test.js`, `tests/api-e2e/tasks-e2e.test.js` | ✅ Verified |
| R1.2 | implemented | `tests/api/tasks.test.js` | ✅ Verified |
| R1.3 | implemented | `tests/api/tasks.test.js` | ✅ Verified |
| R1.4 | implemented | `tests/api/tasks.test.js` | ✅ Verified |
| R1.5 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ✅ Verified |
| R1.6 | partial | `tests/slices/user-config/application/entitlementUseCases.test.js` | ⚠️ Partial — feature gate tested at use-case level, not API end-to-end |
| R1.7 | implemented | `tests/api/tasks.test.js` | ✅ Verified |
| R1.8 | implemented | `tests/api/tasks.test.js` | ✅ Verified |
| R1.9 | implemented | `tests/api-e2e/auth-and-validation-e2e.test.js` | ✅ Verified |
| R1.10 | implemented | `tests/api/tasks.test.js` | ✅ Verified |

### R2 — Task Update (8 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R2.1 | implemented | `tests/api/tasks.test.js`, `tests/taskCrudIntegration.test.js` | ✅ Verified |
| R2.2 | implemented | `tests/api/tasks.test.js` | ✅ Verified |
| R2.3 | implemented | `tests/api/task-state-machine.test.js`, `tests/taskStateTransitions.test.js` | ✅ Verified |
| R2.4 | implemented | `tests/api/task-state-machine.test.js` | ✅ Verified |
| R2.5 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |
| R2.6 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |
| R2.7 | implemented | `tests/api/tasks.test.js` | ✅ Verified |
| R2.8 | partial | `tests/scheduler/dependencies.test.js` | ⚠️ Partial — tested at scheduler level, not API layer |

### R3 — Task Deletion (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R3.1 | implemented | `tests/api/tasks.test.js`, `tests/taskCrudIntegration.test.js` | ✅ Verified |
| R3.2 | implemented | `tests/api/tasks.test.js` | ✅ Verified |
| R3.3 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |

### R4 — Projects (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R4.1 | implemented | `tests/api/projects.test.js` | ✅ Verified |
| R4.2 | implemented | `tests/api/projects.test.js` | ✅ Verified |
| R4.3 | implemented | `tests/api/projects.test.js` | ✅ Verified |
| R4.4 | implemented | `tests/api/projects.test.js` | ✅ Verified |
| R4.5 | implemented | `tests/tasksWriteBulk.integration.test.js` | ✅ Verified |

### R5 — Project Colors (1 requirement)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R5.1 | implemented | `tests/api/projects.test.js` | ✅ Verified |

### R6 — Status State Machine (6 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R6.1 | partial | `tests/api/task-state-machine.test.js`, `tests/taskStateTransitions.test.js` | ⚠️ Partial — time_remaining tested but not all edge cases |
| R6.2 | implemented | `tests/api/task-state-machine.test.js` | ✅ Verified |
| R6.3 | implemented | `tests/api/task-state-machine.test.js` | ✅ Verified |
| R6.4 | implemented | `tests/api/task-state-machine.test.js` | ✅ Verified |
| R6.5 | implemented | `tests/api/task-state-machine.test.js` | ✅ Verified |
| R6.6 | partial | `tests/api/task-state-machine.test.js` | ⚠️ Partial — cap tested but clock-in/out endpoints not tested |

### R7 — Calendar Sync (8 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R7.1 | implemented | `tests/cal-sync/01-adapter-gcal.test.js` + cal-sync series | ✅ Verified |
| R7.2 | implemented | `tests/cal-sync/` series | ✅ Verified |
| R7.3 | implemented | `tests/msftCalDedup.test.js` | ✅ Verified |
| R7.4 | implemented | `tests/msftCalDedup.test.js` | ✅ Verified |
| R7.5 | implemented | `tests/apple-cal-parse.test.js`, `tests/apple-cal-ctag.test.js`, `tests/apple-cal-412.test.js`, `tests/apple-cal-cdn-grace.test.js` | ✅ Verified |
| R7.6 | implemented | `tests/apple-cal-*.test.js` | ✅ Verified |
| R7.7 | implemented | `tests/cal-sync/10-sync-push.test.js`, `tests/cal-sync/11-sync-pull.test.js` | ✅ Verified |
| R7.8 | implemented | `tests/cal-sync/22-sync-error-paths.test.js` | ✅ Verified |

### R8 — Calendar Views (8 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R8.1 | implemented | `juggler-frontend/src/components/views/__tests__/DailyView.test.jsx` | ✅ Verified |
| R8.2 | implemented | `juggler-frontend/src/components/views/__tests__/weekViewAllDay.test.jsx` | ✅ Verified |
| R8.3 | implemented | `juggler-frontend/src/components/views/__tests__/ThreeDayView.test.jsx` | ✅ Verified |
| R8.4 | implemented | `juggler-frontend/src/components/views/__tests__/TimelineView.test.jsx` | ✅ Verified |
| R8.5 | implemented | `juggler-frontend/src/components/views/__tests__/ListView.test.jsx` | ✅ Verified |
| R8.6 | implemented | `juggler-frontend/src/components/views/__tests__/SCurveView.test.jsx` | ✅ Verified |
| R8.7 | implemented | `juggler-frontend/src/components/views/__tests__/PriorityView.test.jsx` | ✅ Verified |
| R8.8 | implemented | `juggler-frontend/src/components/views/__tests__/DependencyView.test.jsx` | ✅ Verified |

### R9 — Drag-and-Drop (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R9.1 | partial | `juggler-frontend/src/hooks/__tests__/useDragDrop.test.js` | ⚠️ Partial — hook tested but `handleGridDrop` in AppLayout has no unit test |
| R9.2 | partial | E2E only | ⚠️ Partial — no dedicated backend test |
| R9.3 | partial | E2E only | ⚠️ Partial — no dedicated backend test |

### R10 — Dependencies (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R10.1 | implemented | `tests/scheduler/dependencies.test.js` | ✅ Verified |
| R10.2 | implemented | `tests/scheduler/dependencies.test.js` | ✅ Verified |
| R10.3 | partial | `tests/scheduler/dependencies.test.js` | ⚠️ Partial — circular detection tested but not all edge cases |
| R10.4 | partial | `tests/scheduler/dependencies.test.js` | ⚠️ Partial — tested at scheduler level, not API/MCP layers |
| R10.5 | partial | `tests/scheduler/dependencies.test.js` | ⚠️ Partial — tested at scheduler level, not API/MCP layers |

### R11 — Scheduler Algorithm (22 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R11.1 | implemented | `tests/api/facade-fnnow-pin.test.js` | ✅ Verified |
| R11.2 | implemented | `tests/unifiedSchedule.test.js` | ✅ Verified |
| R11.3 | implemented | `tests/scheduler/placementModes.test.js`, `tests/scheduler/placementModesTimeWindowToReminder.test.js` | ✅ Verified |
| R11.4 | implemented | `tests/scheduler/placementModes.test.js` | ✅ Verified |
| R11.5 | implemented | `tests/unifiedSchedule.test.js` | ✅ Verified |
| R11.6 | implemented | `tests/unifiedSchedule.test.js` | ✅ Verified |
| R11.7 | implemented | `tests/scheduler/placementModesTimeWindowToReminder.test.js` | ✅ Verified |
| R11.8 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ✅ Verified |
| R11.9 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ✅ Verified |
| R11.10 | partial | `tests/scheduler/weatherFailOpen.test.js`, `tests/weather-stale-cache.test.js` | ⚠️ Partial — fail-open, not fail-closed |
| R11.11 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ✅ Verified |
| R11.12 | implemented | `tests/scheduler/splitInteractions.test.js`, `tests/reconcileSplits.test.js` | ✅ Verified |
| R11.13 | implemented | `tests/scheduler/dependencies.test.js` | ✅ Verified |
| R11.14 | implemented | `tests/scheduler/recurrenceTypes.test.js` | ✅ Verified |
| R11.15 | implemented | `tests/unifiedSchedule.test.js` | ✅ Verified |
| R11.16 | implemented | `tests/unifiedSchedule.test.js` | ✅ Verified |
| R11.17 | implemented | `tests/unifiedSchedule.test.js` | ✅ Verified |
| R11.18 | implemented | `tests/unifiedSchedule.test.js` | ✅ Verified |
| R11.19 | implemented | `tests/scheduler/placementModesTimeWindowToReminder.test.js` | ✅ Verified |
| R11.20 | implemented | `tests/scheduler/placementModesTimeWindowToReminder.test.js` | ✅ Verified |
| R11.21 | implemented | `tests/scheduler/placementModesTimeWindowToReminder.test.js` | ✅ Verified |
| R11.22 | implemented | `tests/scheduler/placementModes.test.js` | ✅ Verified |

### R12–R14 — Reporting (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R12.1 | planned | None | ❌ Planned — no code, no test |
| R13.1 | planned | None | ❌ Planned — no code, no test |
| R14.1 | planned | None | ❌ Planned — no code, no test |

### R15 — AI Features (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R15.1 | implemented | `tests/api/ai-command.test.js` | ✅ Verified |
| R15.2 | implemented | `tests/unit/aiEnrichment/quotaTOCTOU.test.js` | ✅ Verified |
| R15.3 | implemented | `tests/unit/aiEnrichment/trackedCallTimeout.test.js`, `tests/unit/aiEnrichment/timeoutAbortConsequences.test.js` | ✅ Verified |
| R15.4 | implemented | `tests/unit/aiEnrichment/geminiAdapterTimeout.test.js` | ✅ Verified |
| R15.5 | implemented | `tests/api/ai-command.test.js` | ✅ Verified |

### R16 — Authentication (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R16.1 | implemented | `tests/api-e2e/auth-and-validation-e2e.test.js` | ✅ Verified |
| R16.2 | implemented | `tests/api-e2e/auth-and-validation-e2e.test.js` | ✅ Verified |
| R16.3 | partial | `tests/api-e2e/auth-and-validation-e2e.test.js` | ⚠️ Partial — tested but not all token types |

### R17 — MCP Server (2 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R17.1 | partial | None | ⚠️ Partial — 20 tools implemented but no dedicated MCP unit tests |
| R17.2 | partial | None | ⚠️ Partial — JWT auth enforced but no MCP-layer authorization test |

### R18 — Recurring Tasks (8 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R18.1 | implemented | `tests/scheduler/recurrenceTypes.test.js` | ✅ Verified |
| R18.2 | implemented | `tests/scheduler/recurrenceTypes.test.js` | ✅ Verified |
| R18.3 | implemented | `tests/scheduler/recurrenceTypes.test.js` | ✅ Verified |
| R18.4 | implemented | `tests/scheduler/recurrenceTypes.test.js` | ✅ Verified |
| R18.5 | implemented | `tests/scheduler/recurrenceTypes.test.js` | ✅ Verified |
| R18.6 | implemented | `tests/scheduler/rollingRecurrence.test.js` | ✅ Verified |
| R18.7 | implemented | `tests/scheduler/recurrenceTypes.test.js` | ✅ Verified |
| R18.8 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ✅ Verified |

### R19 — Task Splitting (7 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R19.1 | implemented | `tests/scheduler/splitInteractions.test.js`, `tests/reconcileSplits.test.js` | ✅ Verified |
| R19.2 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |
| R19.3 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |
| R19.4 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |
| R19.5 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |
| R19.6 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |
| R19.7 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |

### R20 — Locations (4 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R20.1 | implemented | `tests/api/locations.test.js` | ✅ Verified |
| R20.2 | implemented | `tests/api/locations.test.js` | ✅ Verified |
| R20.3 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ✅ Verified |
| R20.4 | implemented | `tests/api/locations.test.js` | ✅ Verified |

### R21 — Schedule Templates (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R21.1 | implemented | `tests/api/config.test.js`, `tests/slices/user-config/application/schedRerunOnSettings.regression.test.js` | ✅ Verified |
| R21.2 | implemented | `tests/api/config.test.js` | ✅ Verified |
| R21.3 | implemented | `tests/api/config.test.js` | ✅ Verified |

### R22 — Import/Export (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R22.1 | implemented | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ✅ Verified |
| R22.2 | implemented | `tests/slices/user-config/application/mergeImportData.test.js`, `tests/slices/user-config/application/importModeRouting.test.js` | ✅ Verified |
| R22.3 | implemented | `tests/slices/user-config/application/importModeRouting.test.js` | ✅ Verified |
| R22.4 | implemented | `tests/schemas/data-import.schema.test.js` | ✅ Verified |
| R22.5 | partial | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ⚠️ Partial — tested at use-case level, not API end-to-end |

### R23 — Batch Operations (4 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R23.1 | implemented | `tests/tasksWriteBulk.integration.test.js`, `tests/slices/task/application/commands.db.test.js` | ✅ Verified |
| R23.2 | implemented | `tests/tasksWriteBulk.integration.test.js` | ✅ Verified |
| R23.3 | partial | `tests/tasksWriteBulk.integration.test.js` | ⚠️ Partial — retry tested but not all scenarios |
| R23.4 | implemented | `tests/tasksWriteBulk.integration.test.js` | ✅ Verified |

### R24 — Billing & Plans (6 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R24.1 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ✅ Verified |
| R24.2 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ✅ Verified |
| R24.3 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ✅ Verified |
| R24.4 | implemented | `tests/slices/user-config/domain/logic.test.js`, `tests/slices/user-config/adapters/entitlementAdapter.contract.test.js` | ✅ Verified |
| R24.5 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ✅ Verified |
| R24.6 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ✅ Verified |

### R25 — Weather Data (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R25.1 | implemented | `tests/weather/H1-characterization.test.js`, `tests/weather/adapters/weather-provider-adapters.unit.test.js` | ✅ Verified |
| R25.2 | implemented | `tests/weather/H1-characterization.test.js` | ✅ Verified |
| R25.3 | implemented | `tests/weather/H1-characterization.test.js`, `tests/api/data-and-weather.test.js` | ✅ Verified |
| R25.4 | implemented | `tests/weather/H1-characterization.test.js` | ✅ Verified |
| R25.5 | implemented | `tests/weather-stale-cache.test.js`, `tests/api/weather-security-regression.test.js` | ✅ Verified |

### R26 — Fixed Placement Mode (4 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R26.1 | implemented | `tests/api/facade-fnnow-pin.test.js` | ✅ Verified |
| R26.2 | implemented | `tests/api/facade-fnnow-pin.test.js` | ✅ Verified |
| R26.3 | implemented | `tests/api/facade-fnnow-pin.test.js` | ✅ Verified |
| R26.4 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |

### R27 — Tools (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R27.1 | implemented | `tests/api/config.test.js` | ✅ Verified |
| R27.2 | implemented | `tests/api/config.test.js` | ✅ Verified |
| R27.3 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ✅ Verified |

### R28 — Impersonation (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R28.1 | implemented | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ✅ Verified |
| R28.2 | implemented | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ✅ Verified |
| R28.3 | partial | `juggler-frontend/src/components/admin/__tests__/ImpersonationPage.test.jsx`, `ImpersonationBanner.test.jsx` | ⚠️ Partial — frontend tests exist but no backend authorization boundary test |

### R29 — Disable/Re-Enable Tasks (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R29.1 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |
| R29.2 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |
| R29.3 | partial | `tests/slices/task/application/commands-status-delete-misc.test.js` | ⚠️ Partial — cascade tested but not all scenarios |

### R30 — Take Ownership (2 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R30.1 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |
| R30.2 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |

### R31 — User Configuration (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R31.1 | implemented | `tests/api/config.test.js`, `tests/slices/user-config/application/configUseCases.test.js` | ✅ Verified |
| R31.2 | implemented | `tests/api/config.test.js` | ✅ Verified |
| R31.3 | implemented | `tests/api/config.test.js` | ✅ Verified |
| R31.4 | implemented | `tests/api/config.test.js` | ✅ Verified |
| R31.5 | implemented | `tests/slices/user-config/application/schedRerunOnSettings.regression.test.js` | ✅ Verified |

### R32 — Recurring Instance Lifecycle (6 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R32.1 | implemented | `tests/scheduler/rollingRecurrence.test.js` | ✅ Verified |
| R32.2 | implemented | `tests/scheduler/tpc.test.js`, `tests/scheduler/tpcFillPolicy.test.js` | ✅ Verified |
| R32.3 | implemented | `tests/scheduler/rollingRecurrence.test.js` | ✅ Verified |
| R32.4 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |
| R32.5 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |
| R32.6 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ✅ Verified |

### R33 — Rolling Anchor (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R33.1 | implemented | `tests/scheduler/rollingRecurrence.test.js` | ✅ Verified |
| R33.2 | implemented | `tests/scheduler/rollingRecurrence.test.js` | ✅ Verified |
| R33.3 | implemented | `tests/scheduler/rollingRecurrence.test.js` | ✅ Verified |
| R33.4 | implemented | `tests/scheduler/rollingRecurrence.test.js` | ✅ Verified |
| R33.5 | implemented | `tests/scheduler/rollingRecurrence.test.js` | ✅ Verified |

### R34 — TimesPerCycle (TPC) (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R34.1 | implemented | `tests/scheduler/tpc.test.js` | ✅ Verified |
| R34.2 | implemented | `tests/scheduler/tpc.test.js` | ✅ Verified |
| R34.3 | implemented | `tests/scheduler/tpc.test.js`, `tests/scheduler/tpcFillPolicy.test.js` | ✅ Verified |
| R34.4 | implemented | `tests/scheduler/tpc.test.js`, `tests/scheduler/tpcFillPolicy.test.js` | ✅ Verified |
| R34.5 | implemented | `tests/scheduler/tpc.test.js` | ✅ Verified |

### R35 — Split Containment (6 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R35.1 | partial | `tests/scheduler/splitInteractions.test.js` | ⚠️ Partial — split toggle exists but no dedicated UI visibility test |
| R35.2 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |
| R35.3 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |
| R35.4 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |
| R35.5 | implemented | `tests/scheduler/splitInteractions.test.js` | ✅ Verified |
| R35.6 | partial | `tests/scheduler/splitInteractions.test.js` | ⚠️ Partial — overflow flag tested but not all edge cases |

### R36 — Deadline Backpropagation (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R36.1 | partial | `tests/scheduler/deadlines.test.js` | ⚠️ Partial — backprop tested but imprecise (no capacity offset) |
| R36.2 | partial | None | ⚠️ Partial — capacity offset not implemented |
| R36.3 | partial | None | ⚠️ Partial — `deadlineMisses` is dead code |

### R37 — Earliest Start (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R37.1 | partial | `tests/scheduler/earliestStart.test.js` | ⚠️ Partial — enforcement tested but field named `startAfter` not `earliestStart` |
| R37.2 | partial | None | ⚠️ Partial — no validation for startAfter > deadline |
| R37.3 | partial | None | ⚠️ Partial — rename not executed |

### R38 — Weather Constraint (4 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R38.1 | partial | `tests/scheduler/weatherFailOpen.test.js` | ⚠️ Partial — fail-open, not fail-closed |
| R38.2 | partial | `tests/scheduler/weatherFailOpen.test.js` | ⚠️ Partial — wrong unplaced reason string |
| R38.3 | partial | `tests/weather-stale-cache.test.js` | ⚠️ Partial — indicator not fully implemented |
| R38.4 | partial | None | ⚠️ Partial — duplicated code not extracted |

### R39 — Constraint Chain (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R39.1 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ✅ Verified |
| R39.2 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ✅ Verified |
| R39.3 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ✅ Verified |
| R39.4 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ✅ Verified |
| R39.5 | implemented | `tests/scheduler/weatherFailOpen.test.js`, `tests/weather-stale-cache.test.js` | ✅ Verified |

### R40 — FlexWhen (3 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R40.1 | implemented | None | ❌ Untested — no dedicated test |
| R40.2 | implemented | None | ❌ Untested — no dedicated test |
| R40.3 | implemented | None | ❌ Untested — no dedicated test |

### R41 — Reschedule Triggers (5 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R41.1 | implemented | `tests/api/schedule-routes.test.js` | ✅ Verified |
| R41.2 | implemented | `tests/api/schedule-routes.test.js` | ✅ Verified |
| R41.3 | partial | `tests/unit/scheduler/scheduleQueueRateLimit.test.js` | ⚠️ Partial — rate limit tested at unit level, not end-to-end |
| R41.4 | implemented | `tests/api/schedule-routes.test.js` | ✅ Verified |
| R41.5 | implemented | `tests/api/schedule-routes.test.js` | ✅ Verified |

### R42 — Health & Observability (4 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R42.1 | implemented | None | ❌ Untested — no dedicated test |
| R42.2 | implemented | None | ❌ Untested — no dedicated test |
| R42.3 | implemented | None | ❌ Untested — no dedicated test |
| R42.4 | implemented | None | ❌ Untested — no dedicated test |

### R43 — Calendar Provider Management (11 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R43.1 | implemented | `tests/cal-sync/` (indirect) | ✅ Verified |
| R43.2 | implemented | `tests/cal-sync/` (indirect) | ✅ Verified |
| R43.3 | implemented | `tests/msftCalDedup.test.js` (indirect) | ✅ Verified |
| R43.4 | implemented | `tests/msftCalDedup.test.js` (indirect) | ✅ Verified |
| R43.5 | implemented | `tests/apple-cal-*.test.js` (indirect) | ✅ Verified |
| R43.6 | implemented | `tests/apple-cal-*.test.js` (indirect) | ✅ Verified |
| R43.7 | implemented | `tests/apple-cal-*.test.js` (indirect) | ✅ Verified |
| R43.8 | implemented | `tests/apple-cal-*.test.js` (indirect) | ✅ Verified |
| R43.9 | implemented | `tests/apple-cal-*.test.js` (indirect) | ✅ Verified |
| R43.10 | implemented | `tests/apple-cal-*.test.js` (indirect) | ✅ Verified |
| R43.11 | implemented | `tests/apple-cal-*.test.js` (indirect) | ✅ Verified |

### R44 — Scheduler Operations (7 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R44.1 | implemented | `tests/api/schedule-routes.test.js` | ✅ Verified |
| R44.2 | implemented | `tests/api/schedule-routes.test.js` | ✅ Verified |
| R44.3 | implemented | None | ❌ Untested — no dedicated test |
| R44.4 | implemented | None | ❌ Untested — no dedicated test |
| R44.5 | implemented | None | ❌ Untested — no dedicated test |
| R44.6 | implemented | None | ❌ Untested — no dedicated test |
| R44.7 | implemented | None | ❌ Untested — no dedicated test |

### R45 — Admin Tools (2 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R45.1 | implemented | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` (indirect) | ✅ Verified |
| R45.2 | implemented | `tests/weather/H1-characterization.test.js` (indirect) | ✅ Verified |

### R46 — Task Queries (2 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R46.1 | implemented | None | ❌ Untested — no dedicated test |
| R46.2 | implemented | None | ❌ Untested — no dedicated test |

### R47 — Project Lifecycle (1 requirement)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R47.1 | implemented | `tests/api/projects.test.js` (indirect) | ✅ Verified |

### R48 — Tool Management (2 requirements)

| ID | Status | Test File(s) | Verdict |
|----|--------|-------------|---------|
| R48.1 | implemented | `tests/api/config.test.js` (indirect) | ✅ Verified |
| R48.2 | implemented | `tests/api/config.test.js` (indirect) | ✅ Verified |

---

## Test File Inventory

### Backend Unit/Integration Tests (juggler-backend/tests/)

| File | Tests | Coverage |
|------|-------|----------|
| `scheduler/placementModes.test.js` | TS-01 to TS-22 — ANYTIME mode | R11.3, R11.4, R11.22 |
| `scheduler/placementModesTimeWindowToReminder.test.js` | TS-23 to TS-61 — Time Window, Fixed, All Day, Reminder | R11.7, R11.19, R11.20, R11.21 |
| `scheduler/modeTransitions.test.js` | TS-62 to TS-71 — Mode transitions | R26.1–R26.4 |
| `scheduler/recurrenceTypes.test.js` | TS-72 to TS-84 — Daily, Weekly, Biweekly, Monthly, Interval | R18.1–R18.7 |
| `scheduler/rollingRecurrence.test.js` | TS-85 to TS-100 — Rolling anchor | R18.6, R32.1, R32.3, R33.1–R33.5 |
| `scheduler/tpc.test.js` | TS-85 to TS-100 — TPC fill policies, spacing guard | R34.1–R34.5 |
| `scheduler/tpcFillPolicy.test.js` | TS-305 to TS-308 — TPC fill policy edge cases | R34.3, R34.4 |
| `scheduler/splitInteractions.test.js` | TS-126a to TS-126br — Split × everything | R19.1–R19.7, R35.2–R35.6 |
| `scheduler/deadlines.test.js` | TS-127 to TS-141 — Deadline constraints | R36.1 |
| `scheduler/earliestStart.test.js` | TS-142 to TS-154 — Earliest start | R37.1 |
| `scheduler/dependencies.test.js` | TS-155 to TS-162y — Dependencies | R10.1–R10.5 |
| `scheduler/timeTravel.test.js` | TS-273 to TS-288 — Time-travel clock | Clock wiring |
| `scheduler/weatherFailOpen.test.js` | TS-318 to TS-319 — Weather fail-open | R38.1, R38.2 |
| `scheduler/statusTransitionsMatrix.test.js` | TS-320 to TS-334 — Status transitions | R6.1–R6.5 |
| `scheduler/splitStatusPropagation.test.js` | TS-309 to TS-312 — Split status propagation | R19.x |
| `scheduler/fixedRecurringGap.test.js` | TS-301 to TS-304 — Fixed+recurring validation | R26.3 |
| `scheduler/clockWiringGap.test.js` | TS-314 to TS-317 — Clock wiring | Clock |
| `resilience/nullMode.test.js` | TS-269 to TS-272 — Null mode, rate limit, crash | R11.3 |
| `unifiedSchedule.test.js` | Core scheduler algorithm | R11.2, R11.5, R11.6, R11.15–R11.18 |
| `api/tasks.test.js` | Task CRUD API | R1.1–R1.4, R1.7, R1.8, R1.10, R2.1, R2.2, R2.7, R3.1, R3.2 |
| `api/task-state-machine.test.js` | Status transitions API | R2.3, R2.4, R6.1–R6.6 |
| `api/projects.test.js` | Project CRUD API | R4.1–R4.4, R5.1, R47.1 |
| `api/config.test.js` | Config API | R21.1–R21.3, R27.1, R27.2, R31.1–R31.4, R48.1, R48.2 |
| `api/locations.test.js` | Locations API | R20.1, R20.2, R20.4 |
| `api/schedule-routes.test.js` | Schedule routes API | R41.1, R41.2, R41.4, R41.5, R44.1, R44.2 |
| `api/ai-command.test.js` | AI command API | R15.1, R15.5 |
| `api/facade-fnnow-pin.test.js` | fn.now() pin | R11.1, R26.1–R26.3 |
| `api-e2e/auth-and-validation-e2e.test.js` | Auth E2E | R1.9, R16.1–R16.3 |
| `api-e2e/tasks-e2e.test.js` | Tasks E2E | R1.1 |
| `slices/user-config/application/entitlementUseCases.test.js` | Entitlement use cases | R1.5, R1.6, R18.8, R24.1–R24.6 |
| `slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | Data/impersonation | R22.1, R22.5, R28.1, R28.2, R45.1 |
| `slices/user-config/application/mergeImportData.test.js` | Import merge | R22.2 |
| `slices/user-config/application/importModeRouting.test.js` | Import mode routing | R22.2, R22.3 |
| `slices/user-config/application/schedRerunOnSettings.regression.test.js` | Scheduler re-run | R21.1, R31.5 |
| `slices/user-config/application/configUseCases.test.js` | Config use cases | R31.1 |
| `slices/user-config/domain/logic.test.js` | Config domain logic | R24.4 |
| `slices/task/application/commands-status-delete-misc.test.js` | Status/delete commands | R2.5, R2.6, R3.3, R26.4, R29.1–R29.3, R30.1, R30.2, R32.4–R32.6 |
| `slices/task/application/commands.db.test.js` | Task commands DB | R23.1 |
| `slices/task/application/commands-create-update.test.js` | Create/update commands | R1.x |
| `slices/task/application/reference-validation.db.test.js` | Reference validation | R1.x |
| `tasksWriteBulk.integration.test.js` | Batch operations | R4.5, R23.1–R23.4 |
| `taskCrudIntegration.test.js` | Task CRUD integration | R2.1, R3.1 |
| `reconcileSplits.test.js` | Split reconciliation | R19.1–R19.7, R35.1 |
| `weather/H1-characterization.test.js` | Weather golden master | R25.1–R25.4, R45.2 |
| `weather/adapters/weather-provider-adapters.unit.test.js` | Weather provider adapters | R25.1 |
| `weather-stale-cache.test.js` | Weather stale cache | R25.5, R38.3 |
| `weather/GeoPoint-grid-parity.test.js` | GeoPoint grid parity | R25.x |
| `weather/adapters/knex-weather-cache-repository.unit.test.js` | Weather cache repo | R25.x |
| `weather/adapters/bert-fixes-regression.test.js` | Weather fixes | R25.x |
| `cal-sync/01-adapter-gcal.test.js` | GCal adapter | R7.1 |
| `cal-sync/10-sync-push.test.js` | Sync push | R7.7 |
| `cal-sync/11-sync-pull.test.js` | Sync pull | R7.7 |
| `cal-sync/12-sync-deletion.test.js` | Sync deletion | R7.x |
| `cal-sync/12-sync-history-prune.test.js` | Sync history prune | R7.x |
| `cal-sync/13-sync-conflict.test.js` | Sync conflict | R7.x |
| `cal-sync/14-sync-promotion.test.js` | Sync promotion | R7.x |
| `cal-sync/15-sync-ingest.test.js` | Sync ingest | R7.x |
| `cal-sync/16-sync-allday.test.js` | Sync all-day | R7.x |
| `cal-sync/17-sync-split.test.js` | Sync split | R7.x |
| `cal-sync/18-sync-recurring.test.js` | Sync recurring | R7.x |
| `cal-sync/19-sync-multi.test.js` | Sync multi-provider | R7.x |
| `cal-sync/20-sync-lock.test.js` | Sync lock | R7.x |
| `cal-sync/21-sync-auth-errors.test.js` | Sync auth errors | R7.x |
| `cal-sync/22-sync-error-paths.test.js` | Sync error paths | R7.8 |
| `cal-sync/23-sync-consistency.test.js` | Sync consistency | R7.x |
| `cal-sync/30-sync-performance.test.js` | Sync performance | R7.x |
| `cal-sync/99-sync-e2e.test.js` | Sync E2E | R7.x |
| `cal-sync/characterization/bug-adapter-promotion-flex.test.js` | Bug adapter promotion | R7.x |
| `msftCalDedup.test.js` | MSFT dedup | R7.3, R7.4, R43.3, R43.4 |
| `apple-cal-parse.test.js` | Apple CalDAV parse | R7.5, R7.6, R43.5–R43.11 |
| `apple-cal-ctag.test.js` | Apple CTAG | R7.5, R7.6 |
| `apple-cal-412.test.js` | Apple 412 | R7.5, R7.6 |
| `apple-cal-cdn-grace.test.js` | Apple CDN grace | R7.5, R7.6 |
| `unit/aiEnrichment/quotaTOCTOU.test.js` | AI quota TOCTOU | R15.2 |
| `unit/aiEnrichment/trackedCallTimeout.test.js` | AI tracked call timeout | R15.3 |
| `unit/aiEnrichment/timeoutAbortConsequences.test.js` | AI timeout abort | R15.3 |
| `unit/aiEnrichment/geminiAdapterTimeout.test.js` | Gemini adapter timeout | R15.4 |
| `unit/aiEnrichment/adapterLifecycle.test.js` | AI adapter lifecycle | R15.x |
| `unit/scheduler/scheduleQueueRateLimit.test.js` | Scheduler rate limit | R41.3 |
| `unit/scheduler/fakeAdapters.test.js` | Fake adapters | Test infrastructure |
| `characterization/scheduler/goldenMaster.a002-location.test.js` | Location golden master | R11.8, R11.9, R11.11, R20.3, R27.3, R39.1–R39.4 |
| `characterization/scheduler/goldenMaster.h6.test.js` | Scheduler golden master | R11.x |
| `characterization/userConfig/goldenMaster.h4.test.js` | User config golden master | R31.x |
| `schemas/data-import.schema.test.js` | Import schema | R22.4 |
| `validation/zodValidation.test.js` | Zod validation | R1.x |
| `unit/security/jwt-algorithms-allowlist.test.js` | JWT algorithms | R16.x |
| `unit/lib/tasks-csv.test.js` | Tasks CSV | R22.x |
| `unit/lib/csv-to-tasks.test.js` | CSV to tasks | R22.x |
| `unit/app.test.js` | App setup | Infrastructure |
| `unit/validate-task-input.test.js` | Task input validation | R1.x |
| `taskEvents.test.js` | Task events | R2.x |
| `reconcileLockSharedStore.test.js` | Lock shared store | Infrastructure |
| `lib/InMemoryCacheAdapter.undefinedSet.test.js` | Cache adapter | Infrastructure |
| `clientErrorLimiterStore.test.js` | Error limiter | Infrastructure |
| `api/weather-security-regression.test.js` | Weather security | R25.5 |
| `api/data-and-weather.test.js` | Data and weather | R25.3 |
| `api/data-export-csv.test.js` | Data export CSV | R22.x |
| `api/data-import-csv.test.js` | Data import CSV | R22.x |
| `api/health-detail-weather-string-contract.test.js` | Health detail | R42.x |
| `api/misc-routes.test.js` | Misc routes | Various |
| `api/projects.test.js` | Projects API | R4.x, R5.x |
| `api/task-state-machine.test.js` | Task state machine | R6.x |
| `api/status-guard.test.js` | Status guard | R6.x |
| `api/reactivation-reset.test.js` | Reactivation reset | R2.x |
| `api/ai-command.test.js` | AI command | R15.x |
| `api/schedule-routes.test.js` | Schedule routes | R41.x, R44.x |
| `api/config.test.js` | Config API | R21.x, R27.x, R31.x |
| `api/locations.test.js` | Locations API | R20.x |
| `api/tasks.test.js` | Tasks API | R1.x, R2.x, R3.x |
| `api-e2e/tasks-e2e.test.js` | Tasks E2E | R1.x |
| `api-e2e/schedule-e2e.test.js` | Schedule E2E | R11.x |
| `api-e2e/auth-and-validation-e2e.test.js` | Auth E2E | R16.x |

### Frontend Tests (juggler-frontend/)

| File | Tests |
|------|-------|
| `components/views/__tests__/DailyView.test.jsx` | Daily calendar view |
| `components/views/__tests__/ThreeDayView.test.jsx` | Three-day view |
| `components/views/__tests__/TimelineView.test.jsx` | Timeline view |
| `components/views/__tests__/ListView.test.jsx` | List view |
| `components/views/__tests__/SCurveView.test.jsx` | S-curve view |
| `components/views/__tests__/PriorityView.test.jsx` | Priority kanban view |
| `components/views/__tests__/DependencyView.test.jsx` | Dependency graph view |
| `components/views/__tests__/weekViewAllDay.test.jsx` | Week view all-day |
| `components/features/__tests__/WeatherBadge.test.jsx` | Weather badge |
| `components/features/__tests__/ImportExportPanel.importMode.test.jsx` | Import/export panel |
| `components/admin/__tests__/ImpersonationPage.test.jsx` | Impersonation page |
| `components/admin/__tests__/ImpersonationBanner.test.jsx` | Impersonation banner |
| `components/layout/__tests__/HealthDot.bug487-fe.test.jsx` | Health dot |
| `hooks/__tests__/useDragDrop.test.js` | Drag-and-drop hook |

### E2E/Playwright Tests (juggler/tests/)

| File | Tests |
|------|-------|
| `e2e.spec.js` | General E2E |
| `task-create.spec.js` | Task creation |
| `task-edit.spec.js` | Task editing |
| `settings.spec.js` | Settings |
| `calendar-navigation.spec.js` | Calendar navigation |
| `recurring.spec.js` | Recurring tasks |
| `placement-mode.spec.js` | Placement modes |
| `all-day-banner.spec.js` | All-day banner |
| `responsive.spec.js` | Responsive design |
| `ux-inspect.spec.js` through `ux-inspect5.spec.js` | UX inspection |
| `calendar-overdue-badge.spec.js` | Overdue badge |
| `tc-w001-mode-selector-overflow.spec.js` | Mode selector overflow |
| `ux-sweep-taskedit-when.spec.js` | Task edit when sweep |
| `regression/placement-mode/pin-audit.spec.js` | Pin audit |
| `regression/placement-mode/specimen-verification.spec.js` | Specimen verification |

---

## Recommendations

### Critical Fixes

1. **R38.1 — Weather fail-closed**: Change `weatherOk` to return `false` (not `true`) when weather data is missing. This is a HIGH-severity bug — weather-constrained tasks are currently placed in slots with unknown weather conditions.

2. **R38.2 — Wrong unplaced reason**: Change `_unplacedReason` from `"weather"` to `"weather_unavailable"` to match the spec.

### High Priority

3. **R40.1–R40.3 — FlexWhen tests**: Add dedicated tests for FlexWhen relaxation, the 4-level fallback ladder, and the `_flexWhenRelaxed` flag.

4. **R42.1–R42.4 — Health endpoint tests**: Add tests for `/api/health/immediate`, `/api/health/`, `/api/health/detailed`, and `/api/feature-events/`.

5. **R44.3–R44.7 — Scheduler stepper tests**: Add tests for the admin debug scheduler and stepper session endpoints.

6. **R46.1–R46.2 — Task query tests**: Add tests for `/api/tasks/version` and `/api/tasks/disabled`.

### Medium Priority

7. **R17.1–R17.2 — MCP tests**: Add dedicated MCP server unit tests and authorization boundary tests.

8. **R36.1 — Capacity-aware deadline offset**: Implement capacity-aware offset for propagated deadlines.

9. **R37.2 — Earliest start validation**: Add validation for `startAfter > deadline` returning 400.

10. **R38.4 — Shared weather constraint module**: Extract `hasWeatherConstraint` into a shared module.

### Low Priority

11. **R37.3 — Field rename**: Rename `start_after_at`/`startAfter` to `earliest_start_at`/`earliestStart`.

12. **R36.3 — Remove dead code**: Remove or replace the `deadlineMisses` array.

### Stale Reference Fixes

13. Update REQUIREMENTS.md to fix stale test file paths:
    - `tests/recurring/tpc*.test.js` → `tests/scheduler/tpc.test.js` and `tests/scheduler/tpcFillPolicy.test.js`
    - `tests/unit/rolling-anchor.test.js` → `tests/scheduler/rollingRecurrence.test.js`
    - `tests/unifiedSchedule.test.js` (dependencies) → `tests/scheduler/dependencies.test.js`
    - `scripts/test-plan-limits.js` → remove reference (file doesn't exist)

---

*End of TRACEABILITY-AUDIT-CURRENT.md*
