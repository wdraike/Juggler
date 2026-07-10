# Traceability Matrix — Juggler (requirement → test)

> **GENERATED — do not hand-edit.** Regenerate with
> `node scripts/generate-traceability.js` (from `juggler/`).
> Derived from `docs/REQUIREMENTS.md` (the R-number precedence register —
> each row's **Tests** column is the per-requirement authority) verified
> against the live filesystem. Rot cannot accumulate here: a reference to a
> deleted/renamed test shows up as **STALE** on the next regeneration
> (`--check` exits 1 on any stale ref).
>
> Source: `docs/REQUIREMENTS.md` @ sha256:4b6d9abd60c7

## Summary

| Metric | Count |
|--------|-------|
| Requirement rows parsed | 263 |
| — status `implemented` | 213 |
| — status `implemented (999.1223)` | 1 |
| — status `partial` | 39 |
| — status `planned` | 9 |
| — status `planned (deferred milestone)` | 1 |
| Rows with ≥1 resolving test reference | 225 |
| Rows explicitly marked "No dedicated test" / — | 38 |
| Rows with STALE test references | 0 |
| Sub-table rows without a Tests column (skipped) | 24 |

## Untested requirements (explicit no-test markers)

- **R6.7** (`implemented`) — No dedicated test
- **R8.9** (`implemented`) — No dedicated test
- **R9.1** (`partial`) — No dedicated backend test; AppLayout integration test via manual/E2E. Flag: no unit test for `handleGridDrop` logic.
- **R9.2** (`partial`) — No dedicated backend test; integration test via manual/E2E.
- **R9.3** (`partial`) — No dedicated backend test; integration test via manual/E2E.
- **R12.1** (`planned`) — No test for time reporting.
- **R13.1** (`planned`) — No test for burn-down reports.
- **R14.1** (`planned`) — No test for capacity planning reports.
- **R17.1** (`partial`) — No dedicated MCP-server unit tests; MCP tools delegate to backend API.
- **R17.2** (`partial`) — No dedicated MCP-layer authorization test.
- **R22.6** (`planned`) — No test for export size/pagination.
- **R24.7** (`planned`) — No test for near-limit notification.
- **R32.8** (`planned`) — No test for single-instance override.
- **R36.2** (`partial`) — No test for capacity-offset limitation.
- **R36.3** (`partial`) — No dedicated test.
- **R37.1** (`partial`) — No dedicated test for earliest-start enforcement.
- **R37.2** (`partial`) — No dedicated test for impossible-window detection.
- **R37.3** (`partial`) — No dedicated test.
- **R38.4** (`partial`) — No dedicated test for shared-module extraction.
- **R40.1** (`implemented`) — No dedicated FlexWhen test.
- **R40.2** (`implemented`) — No dedicated FlexWhen test.
- **R40.3** (`implemented`) — No dedicated FlexWhen test.
- **R42.1** (`partial`) — No dedicated test
- **R42.2** (`partial`) — No dedicated test
- **R42.3** (`partial`) — No dedicated test
- **R42.4** (`partial`) — No dedicated test
- **R44.3** (`partial`) — No dedicated test
- **R44.4** (`partial`) — No dedicated test
- **R44.5** (`partial`) — No dedicated test
- **R44.6** (`partial`) — No dedicated test
- **R44.7** (`partial`) — No dedicated test
- **R46.1** (`partial`) — No dedicated test
- **R46.2** (`partial`) — No dedicated test
- **R49.3** (`partial`) — No dedicated test
- **R53** (`planned`) — —
- **R54** (`planned (deferred milestone)`) — —
- **R55** (`planned`) — —
- **R56** (`planned`) — —

## Matrix

### R1 — Task Creation

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R1.1 | implemented | `tests/api/tasks.test.js` · `tests/api-e2e/tasks-e2e.test.js` | ok · ok |
| R1.2 | implemented | `tests/api/tasks.test.js` | ok |
| R1.3 | implemented | `tests/api/tasks.test.js` | ok |
| R1.4 | implemented | `tests/api/tasks.test.js` | ok |
| R1.5 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ok |
| R1.6 | partial | `tests/slices/user-config/application/entitlementUseCases.test.js` | ok |
| R1.7 | implemented | `tests/api/tasks.test.js` | ok |
| R1.8 | implemented | `tests/api/tasks.test.js` | ok |
| R1.9 | implemented | `tests/api-e2e/auth-and-validation-e2e.test.js` | ok |
| R1.10 | implemented | `tests/api/tasks.test.js` | ok |
### R2 — Task Update

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R2.1 | implemented | `tests/api/tasks.test.js` · `tests/taskCrudIntegration.test.js` | ok · ok |
| R2.2 | implemented | `tests/api/tasks.test.js` | ok |
| R2.3 | implemented | `tests/api/task-state-machine.test.js` · `tests/taskStateTransitions.test.js` | ok · ok |
| R2.4 | implemented | `tests/api/task-state-machine.test.js` | ok |
| R2.5 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
| R2.6 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
| R2.7 | implemented | `tests/api/tasks.test.js` | ok |
| R2.8 | implemented | `tests/unifiedSchedule.test.js` | ok |
### R3 — Task Deletion

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R3.1 | implemented | `tests/api/tasks.test.js` · `tests/taskCrudIntegration.test.js` | ok · ok |
| R3.2 | implemented | `tests/api/tasks.test.js` | ok |
| R3.3 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
### R4 — Projects

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R4.1 | implemented | `tests/api/projects.test.js` | ok |
| R4.2 | implemented | `tests/api/projects.test.js` | ok |
| R4.3 | implemented | `tests/api/projects.test.js` | ok |
| R4.4 | implemented | `tests/api/projects.test.js` | ok |
| R4.5 | implemented | `tests/tasksWriteBulk.integration.test.js` | ok |
### R5 — Project Colors

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R5.1 | implemented | `tests/api/projects.test.js` | ok |
### R6 — Status State Machine

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R6.1 | implemented | `tests/api/task-state-machine.test.js` · `tests/taskStateTransitions.test.js` | ok · ok |
| R6.2 | implemented | `tests/api/task-state-machine.test.js` | ok |
| R6.3 | implemented | `tests/api/task-state-machine.test.js` | ok |
| R6.4 | implemented | `tests/api/task-state-machine.test.js` | ok |
| R6.5 | implemented | `tests/api/task-state-machine.test.js` | ok |
| R6.6 | partial | `tests/api/task-state-machine.test.js` | ok |
| R6.7 | implemented | No dedicated test | none |
### R7 — Calendar Sync

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R7.1 | implemented | `tests/cal-sync/` | ok |
| R7.2 | implemented | `tests/cal-sync/` | ok |
| R7.3 | implemented | `tests/msftCalDedup.test.js` | ok |
| R7.4 | implemented | `tests/msftCalDedup.test.js` | ok |
| R7.5 | implemented | `tests/apple-cal-*.test.js` | ok |
| R7.6 | implemented | `tests/apple-cal-*.test.js` | ok |
| R7.7 | implemented | `tests/cal-sync/` | ok |
| R7.8 | implemented | `tests/cal-sync/` | ok |
| R7.9 | partial | `tests/cal-sync/` | ok |
| R7.10 | partial | `tests/cal-sync/` · `tests/msftCalDedup.test.js` | ok · ok |
### R8 — Calendar Views

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R8.1 | implemented | `juggler-frontend/src/components/schedule/` | ok |
| R8.2 | implemented | `juggler-frontend/src/components/views/__tests__/weekViewAllDay.test.jsx` | ok |
| R8.3 | implemented | `juggler-frontend/src/components/schedule/` | ok |
| R8.4 | implemented | `juggler-frontend/src/components/schedule/` | ok |
| R8.5 | implemented | `juggler-frontend/src/components/schedule/` | ok |
| R8.6 | implemented | `juggler-frontend/src/components/schedule/` | ok |
| R8.7 | implemented | `juggler-frontend/src/components/schedule/` | ok |
| R8.8 | implemented | `juggler-frontend/src/components/schedule/` | ok |
| R8.9 | implemented | No dedicated test | none |
### R9 — Drag-and-Drop

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R9.1 | partial | No dedicated backend test; AppLayout integration test via manual/E2E. Flag: no unit test for `handleGridDrop` logic. | none |
| R9.2 | partial | No dedicated backend test; integration test via manual/E2E. | none |
| R9.3 | partial | No dedicated backend test; integration test via manual/E2E. | none |
### R10 — Dependencies

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R10.1 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R10.2 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R10.3 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R10.4 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R10.5 | implemented | `tests/unifiedSchedule.test.js` | ok |
### R11 — Scheduler Algorithm

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R11.1 | implemented | `tests/api/facade-fnnow-pin.test.js` | ok |
| R11.2 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.3 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.4 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.5 | implemented | `tests/unifiedSchedule.test.js` · `tests/scheduler/overdue-unscheduled-pinning.test.js` · `tests/scheduler/roamable-recurring-forward-roll.test.js` | ok · ok · ok |
| R11.6 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.7 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.8 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ok |
| R11.9 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ok |
| R11.10 | partial | `tests/weather/*.test.js` | ok |
| R11.11 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ok |
| R11.12 | implemented | `tests/reconcileSplits.test.js` | ok |
| R11.13 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.14 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.15 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.16 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.17 | implemented (999.1223) | `tests/schedulerDayBounds.test.js` | ok |
| R11.18 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.19 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.20 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.21 | implemented | `tests/unifiedSchedule.test.js` | ok |
| R11.22 | implemented | `tests/unifiedSchedule.test.js` | ok |
### R12 — Time Reports

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R12.1 | planned | No test for time reporting. | none |
### R13 — Burn-Down Reports

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R13.1 | planned | No test for burn-down reports. | none |
### R14 — Capacity Planning Reports

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R14.1 | planned | No test for capacity planning reports. | none |
### R15 — AI Features

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R15.1 | implemented | `tests/api/ai-command.test.js` | ok |
| R15.2 | implemented | `tests/unit/aiEnrichment/` | ok |
| R15.3 | implemented | `tests/unit/aiEnrichment/` | ok |
| R15.4 | implemented | `tests/unit/aiEnrichment/` | ok |
| R15.5 | implemented | `tests/api/ai-command.test.js` | ok |
### R16 — Authentication

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R16.1 | implemented | `tests/api-e2e/auth-and-validation-e2e.test.js` | ok |
| R16.2 | implemented | `tests/api-e2e/auth-and-validation-e2e.test.js` | ok |
| R16.3 | implemented | `tests/api-e2e/auth-and-validation-e2e.test.js` | ok |
| R16.4 | implemented | `juggler-frontend/src/components/auth/__tests__/AuthProvider.test.jsx` | ok |
### R17 — MCP Server

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R17.1 | partial | No dedicated MCP-server unit tests; MCP tools delegate to backend API. | none |
| R17.2 | partial | No dedicated MCP-layer authorization test. | none |
### R18 — Recurring Tasks

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R18.1 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R18.2 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R18.3 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R18.4 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R18.5 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R18.6 | implemented | `tests/rollingAnchor.test.js` | ok |
| R18.7 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R18.8 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ok |
### R19 — Task Splitting

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R19.1 | implemented | `tests/reconcileSplits.test.js` | ok |
| R19.2 | implemented | `tests/reconcileSplits.test.js` | ok |
| R19.3 | implemented | `tests/reconcileSplits.test.js` | ok |
| R19.4 | implemented | `tests/reconcileSplits.test.js` | ok |
| R19.5 | implemented | `tests/reconcileSplits.test.js` | ok |
| R19.6 | implemented | `tests/reconcileSplits.test.js` | ok |
| R19.7 | implemented | `tests/reconcileSplits.test.js` | ok |
### R20 — Locations

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R20.1 | implemented | `tests/api/locations.test.js` | ok |
| R20.2 | implemented | `tests/api/locations.test.js` | ok |
| R20.3 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ok |
| R20.4 | implemented | `tests/api/locations.test.js` | ok |
### R21 — Schedule Templates

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R21.1 | implemented | `tests/api/config.test.js` · `tests/slices/user-config/application/schedRerunOnSettings.regression.test.js` | ok · ok |
| R21.2 | implemented | `tests/api/config.test.js` | ok |
| R21.3 | implemented | `tests/api/config.test.js` | ok |
### R22 — Import/Export

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R22.1 | implemented | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ok |
| R22.2 | implemented | `tests/slices/user-config/application/mergeImportData.test.js` · `tests/slices/user-config/application/importModeRouting.test.js` | ok · ok |
| R22.3 | implemented | `tests/slices/user-config/application/importModeRouting.test.js` | ok |
| R22.4 | implemented | `tests/schemas/data-import.schema.test.js` | ok |
| R22.5 | implemented | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ok |
| R22.6 | planned | No test for export size/pagination. | none |
### R23 — Batch Operations

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R23.1 | implemented | `tests/tasksWriteBulk.integration.test.js` · `tests/slices/task/application/commands.db.test.js` | ok · ok |
| R23.2 | implemented | `tests/tasksWriteBulk.integration.test.js` | ok |
| R23.3 | implemented | `tests/tasksWriteBulk.integration.test.js` | ok |
| R23.4 | implemented | `tests/tasksWriteBulk.integration.test.js` | ok |
### R24 — Billing & Plans

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R24.1 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ok |
| R24.2 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ok |
| R24.3 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ok |
| R24.4 | implemented | `tests/slices/user-config/domain/logic.test.js` · `tests/slices/user-config/adapters/entitlementAdapter.contract.test.js` | ok · ok |
| R24.5 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ok |
| R24.6 | implemented | `tests/slices/user-config/application/entitlementUseCases.test.js` | ok |
| R24.7 | planned | No test for near-limit notification. | none |
### R25 — Weather Data

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R25.1 | implemented | `tests/weather/H1-characterization.test.js` · `tests/weather/adapters/*.test.js` | ok · ok |
| R25.2 | implemented | `tests/weather/H1-characterization.test.js` | ok |
| R25.3 | implemented | `tests/weather/H1-characterization.test.js` · `tests/api/data-and-weather.test.js` | ok · ok |
| R25.4 | implemented | `tests/weather/H1-characterization.test.js` | ok |
| R25.5 | implemented | `tests/weather-stale-cache.test.js` · `tests/api/weather-security-regression.test.js` | ok · ok |
### R26 — Fixed Placement Mode

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R26.1 | implemented | `tests/api/facade-fnnow-pin.test.js` | ok |
| R26.2 | implemented | `tests/api/facade-fnnow-pin.test.js` | ok |
| R26.3 | implemented | `tests/api/facade-fnnow-pin.test.js` | ok |
| R26.4 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
### R27 — Tools

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R27.1 | implemented | `tests/api/config.test.js` | ok |
| R27.2 | implemented | `tests/api/config.test.js` | ok |
| R27.3 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ok |
### R28 — Impersonation

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R28.1 | implemented | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ok |
| R28.2 | implemented | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ok |
| R28.3 | partial | `juggler-frontend/src/components/admin/__tests__/ImpersonationPage.test.jsx` · `juggler-frontend/src/components/admin/__tests__/ImpersonationBanner.test.jsx` | ok · ok |
### R29 — Disable/Re-Enable Tasks

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R29.1 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
| R29.2 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
| R29.3 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
### R30 — Take Ownership

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R30.1 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
| R30.2 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
### R31 — User Configuration

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R31.1 | implemented | `tests/api/config.test.js` · `tests/slices/user-config/application/configUseCases.test.js` | ok · ok |
| R31.2 | implemented | `tests/api/config.test.js` | ok |
| R31.3 | implemented | `tests/api/config.test.js` | ok |
| R31.4 | implemented | `tests/api/config.test.js` | ok |
| R31.5 | implemented | `tests/slices/user-config/application/schedRerunOnSettings.regression.test.js` | ok |
### R32 — Recurring Instance Lifecycle

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R32.1 | implemented | `tests/rollingAnchor.test.js` | ok |
| R32.2 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R32.3 | implemented | `tests/rollingAnchor.test.js` | ok |
| R32.4 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
| R32.5 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
| R32.6 | implemented | `tests/slices/task/application/commands-status-delete-misc.test.js` | ok |
| R32.7 | implemented | `tests/schedulerScenarios.test.js` · `tests/characterization/scheduler/goldenMaster.h6.test.js` | ok · ok |
| R32.8 | planned | No test for single-instance override. | none |
### R33 — Rolling Anchor

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R33.1 | implemented | `tests/rollingAnchor.test.js` | ok |
| R33.2 | implemented | `tests/rollingAnchor.test.js` | ok |
| R33.3 | implemented | `tests/rollingAnchor.test.js` | ok |
| R33.4 | implemented | `tests/rollingAnchor.test.js` | ok |
| R33.5 | implemented | `tests/rollingAnchor.test.js` | ok |
### R34 — TimesPerCycle (TPC)

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R34.1 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R34.2 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R34.3 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R34.4 | implemented | `tests/scheduler/tpc*.test.js` | ok |
| R34.5 | implemented | `tests/scheduler/tpc*.test.js` | ok |
### R35 — Split Containment

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R35.1 | implemented | `tests/reconcileSplits.test.js` | ok |
| R35.2 | implemented | `tests/reconcileSplits.test.js` | ok |
| R35.3 | implemented | `tests/reconcileSplits.test.js` | ok |
| R35.4 | implemented | `tests/reconcileSplits.test.js` | ok |
| R35.5 | implemented | `tests/reconcileSplits.test.js` | ok |
| R35.6 | implemented | `tests/reconcileSplits.test.js` | ok |
| R35.7 | partial | `tests/cal-sync/` | ok |
### R36 — Deadline Backpropagation

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R36.1 | partial | `tests/unifiedSchedule.test.js` | ok |
| R36.2 | partial | No test for capacity-offset limitation. | none |
| R36.3 | partial | No dedicated test. | none |
### R37 — Earliest Start

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R37.1 | partial | No dedicated test for earliest-start enforcement. | none |
| R37.2 | partial | No dedicated test for impossible-window detection. | none |
| R37.3 | partial | No dedicated test. | none |
### R38 — Weather Constraint

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R38.1 | partial | `tests/weather/*.test.js` | ok |
| R38.2 | partial | `tests/weather/*.test.js` | ok |
| R38.3 | partial | `tests/weather-stale-cache.test.js` | ok |
| R38.4 | partial | No dedicated test for shared-module extraction. | none |
| R38.5 | partial | `tests/weather/*.test.js` · `tests/weather-stale-cache.test.js` | ok · ok |
### R39 — Constraint Chain

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R39.1 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ok |
| R39.2 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ok |
| R39.3 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ok |
| R39.4 | implemented | `tests/characterization/scheduler/goldenMaster.a002-location.test.js` | ok |
| R39.5 | implemented | `tests/weather/*.test.js` | ok |
### R40 — FlexWhen

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R40.1 | implemented | No dedicated FlexWhen test. | none |
| R40.2 | implemented | No dedicated FlexWhen test. | none |
| R40.3 | implemented | No dedicated FlexWhen test. | none |
### R41 — Reschedule Triggers

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R41.1 | implemented | `tests/api/schedule-routes.test.js` | ok |
| R41.2 | implemented | `tests/api/schedule-routes.test.js` | ok |
| R41.3 | implemented | `tests/api/schedule-routes.test.js` | ok |
| R41.4 | implemented | `tests/api/schedule-routes.test.js` | ok |
| R41.5 | implemented | `tests/api/schedule-routes.test.js` | ok |
| R41.6 | partial | `tests/slices/user-config/application/schedRerunOnSettings.regression.test.js` | ok |
### R42 — Health & Observability

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R42.1 | partial | No dedicated test | none |
| R42.2 | partial | No dedicated test | none |
| R42.3 | partial | No dedicated test | none |
| R42.4 | partial | No dedicated test | none |
### R43 — Calendar Provider Management

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R43.1 | implemented | `tests/cal-sync/` | ok |
| R43.2 | implemented | `tests/cal-sync/` | ok |
| R43.3 | implemented | `tests/msftCalDedup.test.js` | ok |
| R43.4 | implemented | `tests/msftCalDedup.test.js` | ok |
| R43.5 | implemented | `tests/apple-cal-*.test.js` | ok |
| R43.6 | implemented | `tests/apple-cal-*.test.js` | ok |
| R43.7 | implemented | `tests/apple-cal-*.test.js` | ok |
| R43.8 | implemented | `tests/apple-cal-*.test.js` | ok |
| R43.9 | implemented | `tests/apple-cal-*.test.js` | ok |
| R43.10 | implemented | `tests/apple-cal-*.test.js` | ok |
| R43.11 | implemented | `tests/apple-cal-*.test.js` | ok |
### R44 — Scheduler Operations

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R44.1 | implemented | `tests/api/schedule-routes.test.js` | ok |
| R44.2 | implemented | `tests/api/schedule-routes.test.js` | ok |
| R44.3 | partial | No dedicated test | none |
| R44.4 | partial | No dedicated test | none |
| R44.5 | partial | No dedicated test | none |
| R44.6 | partial | No dedicated test | none |
| R44.7 | partial | No dedicated test | none |
### R45 — Admin Tools

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R45.1 | implemented | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ok |
| R45.2 | implemented | `tests/weather/H1-characterization.test.js` | ok |
### R46 — Task Queries

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R46.1 | partial | No dedicated test | none |
| R46.2 | partial | No dedicated test | none |
### R47 — Project Lifecycle

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R47.1 | implemented | `tests/api/projects.test.js` | ok |
### R48 — Tool Management

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R48.1 | implemented | `tests/api/config.test.js` | ok |
| R48.2 | implemented | `tests/api/config.test.js` | ok |
### R49 — System Resilience & Cross-Cutting

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R49.1 | partial | `tests/tasksWriteBulk.integration.test.js` | ok |
| R49.2 | implemented | `tests/api/ai-command.test.js` · `tests/api/schedule-routes.test.js` | ok · ok |
| R49.3 | partial | No dedicated test | none |
| R49.4 | partial | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | ok |
### R50 — Overdue / Past-Due Item Handling

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R50.0 | implemented | `tests/recurringPeriodEnd.test.js` · `tests/runScheduleIntegration.test.js` · `tests/unit/scheduler/effective-deadline.test.js` · `tests/scheduler/instance-date-rules.test.js` · `tests/scheduler/sched-audit-reg26-roam.test.js` | ok · ok · ok · ok · ok |
| R50.1 | implemented | `tests/schedulerScenarios.test.js` · `tests/computeIsPastDue.test.js` · `tests/scheduler/overdue-unscheduled-pinning.test.js` · `tests/scheduler/sched-audit-da-oneoff.test.js` · `tests/runScheduleIntegration.test.js` | ok · ok · ok · ok · ok |
| R50.2 | implemented | `tests/schedulerScenarios.test.js` | ok |
| R50.3 | implemented | `ConflictsView.test.jsx` | ok |
| R50.4 | implemented | `tests/schedulerScenarios.test.js` | ok |
| R50.5 | implemented | `tests/schedulerScenarios.test.js` | ok |
| R50.6 | implemented | `tests/rowToTaskOverdue.test.js` | ok |
| R50.7 | implemented | `tests/db/20260621000000_implied_deadline.test.js` | ok |
| R50.8 | implemented | `tests/getNowInTimezoneParity.test.js` | ok |
| R50.9 | partial | `juggler-frontend/src/components/views/__tests__/sched-audit-l3.test.jsx` | ok |
| R50.10 | implemented | `tests/scheduler/sched-audit-dc-rigid.test.js` | ok |
| R50.11 | implemented | `tests/scheduler/roamable-recurring-forward-roll.test.js` · `tests/scheduler/sched-audit-reg26-roam.test.js` · `tests/runScheduleIntegration.test.js` | ok · ok · ok |
| R50.12 | implemented | `juggler-backend/tests/scheduler/allday-overdue.test.js` · `juggler-frontend/src/components/views/__tests__/allDayBannerOverdue.test.jsx` · `juggler-frontend/src/scheduler/__tests__/conflictBucketsAllDayOverdue.test.js` | ok · ok · ok |
### R51–R56 — Task Master/Instance Redesign (fabricate-once-persist)

| ID | Status | Tests | Resolution |
|----|--------|-------|------------|
| R51 | implemented | `tests/schedulerRerunIdempotency.test.js` | ok |
| R52 | implemented | `tests/schedulerFrozenInvariant.test.js` | ok |
| R53 | planned | — | none |
| R54 | planned (deferred milestone) | — | none |
| R55 | planned | — | none |
| R56 | planned | — | none |
