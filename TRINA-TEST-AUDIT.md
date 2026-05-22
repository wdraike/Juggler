# TRINA-TEST-AUDIT — Juggler Test Suite
**Audit Date:** 2026-05-20
**Auditor:** Trina (adversarial test quality review)
**Scope:** juggler-backend + juggler-frontend, all test tiers (unit, integration, E2E, Playwright)
**No prior Tina/Big Bird artifacts found** — this is a ground-up read of the codebase.

---

## Executive Summary

1. **The main production scheduler (`unifiedScheduleV2.js`, 1,805 lines) is tested extensively in several files — but the largest "deep coverage" test file (`schedulerDeepCoverage.test.js`) silently tests the deprecated v1 (`unifiedSchedule.js`), not the production code.** Bugs specific to v2 could be invisible to this test suite.

2. **`task-write-queue.js` — the coalesce/flush engine that serialises all writes while calendar sync or scheduling holds the lock — has zero unit tests for its core `coalesceEntries()` function.** A regression there silently drops or double-applies task mutations for any user who triggers a sync while actively editing.

3. **The billing webhook `enforceDowngradeLimits` path (200+ lines, real DB transactions, cal-sync ledger manipulation) has no real-DB integration tests.** All downgrade tests run against a mocked DB chain that never validates SQL correctness, JOIN ordering, or transaction isolation.

4. **The entire frontend is almost entirely untested at the component level.** Views, hooks, the `taskReducer`, `App.js`, `AuthProvider`, drag-drop, `useTaskState`, `useUndo`, and every layout component have zero tests. 19 frontend tests exist across ~90 source files.

5. **Feature-gate middleware (`feature-gate.js`) — the gatekeeper for plan limits, usage tracking, and `requireFeature` guards on AI and calendar endpoints — has no dedicated unit tests.** It is only exercised indirectly, and the `checkAndIncrement` race condition (double-counts under concurrent requests) is untested.

---

## Test File Inventory

### Backend — juggler-backend (143 test files total)

| Area | Test Files | Notes |
|------|-----------|-------|
| Scheduler (unit, pure) | schedulerRules.test.js, schedulerScenarios.test.js, schedulerDeepCoverage.test.js, schedulerTimeSimulation.test.js, schedulerSupplyDemand.test.js, unifiedSchedule.test.js | See GAP-1: deepCoverage uses v1 |
| Scheduler (integration, real DB) | schedulerIntegration.test.js, runScheduleIntegration.test.js, schedulerPersistIntegration.test.js, schedulePlacementsIntegration.test.js, schedulerScenarios (some DB), mcpOverdueRegression.integration.test.js | Good real-DB coverage |
| Task CRUD | taskCrudIntegration.test.js, taskCrudIntegration2.test.js, taskControllerUnit.test.js, taskMapping.test.js, taskPipeline.test.js, taskStateTransitions.test.js, tasksWriteHelper.test.js, tasksWriteBulk.integration.test.js | Solid |
| Task state machine | api/status-guard.test.js, api/task-state-machine.test.js, lib/task-status.test.js | Good |
| MCP tools | mcp.test.js, mcpOverdueRegression.integration.test.js | See GAP-3 |
| Calendar sync | cal-sync/ 01–23 + 99, apple-cal-*.test.js, cal-sync-helpers-tz.test.js, msftCalDedup.test.js, gcalHelpers.test.js, deleteCalendarLinked.integration.test.js, fkCascadeDetach.integration.test.js | Very broad |
| SSE / real-time | sseEmitter.test.js | See GAP-8 |
| Schedule queue / claiming | scheduleQueue.test.js, scheduleQueueClaiming.test.js | Good |
| Task write queue | — | **NO TESTS** (GAP-2) |
| Sync lock / startup | syncLockStartup.test.js | Good |
| Security | security/probes.test.js, security/rate-limits.test.js, security/webhook.test.js, security/write-rate-limit.test.js | Good |
| AI command | api/ai-command.test.js, aiRateLimiter.test.js | Good |
| AI usage tracking | unit/ai-usage-flusher.test.js, unit/ai-usage-queue.test.js | Good |
| Billing webhooks | security/webhook.test.js (signature only), disabledStatus.test.js (mock DB) | See GAP-4 |
| Feature gate | — | **NO TESTS** (GAP-5) |
| API routes (supertest + mock DB) | api/tasks.test.js, api/config.test.js, api/locations.test.js, api/projects.test.js, api/schedule-routes.test.js, api/data-and-weather.test.js, api/oauth-providers.test.js, api/misc-routes.test.js, api/cal-sync-meta.test.js, api/reactivation-reset.test.js | Broad but all mock-DB |
| E2E (real Express + real DB) | api-e2e/tasks-e2e.test.js, api-e2e/auth-and-validation-e2e.test.js, api-e2e/schedule-e2e.test.js | Very good |
| Migrations | migrations/20260509000100.test.js, migrations/20260518000100.test.js | Good |
| Cron | cron/cal-history-cron.test.js | Present |
| DB module | unit/db.test.js | Present |
| Scheduler internals | unit/schedulerSession.test.js, unit/scoreSchedule.test.js, unit/derivePlacementMode.test.js, unit/placement-mode-migration.test.js, unit/expandToAllInstanceIds.test.js | Good |
| Helpers | dateHelpers.test.js, dependencyHelpers.test.js, timeBlockHelpers.test.js, gcalHelpers.test.js, expandRecurring.test.js, reconcileOccurrences.test.js, reconcileSplits.test.js, scoreSchedule.test.js, disabledStatus.test.js, viewShape.integration.test.js, db/missed-status-migration.test.js, shared/missedHelpers.test.js, scheduler/past-window-missed.test.js | Solid |

### Frontend — juggler-frontend (19 test files)

| Area | Test Files | Source Files Untested |
|------|-----------|----------------------|
| Task form | TaskEditForm.integration.test.jsx (3 tests), TaskCard.overflow.test.jsx, TaskDetailHeader.test.jsx, CollapsibleSection.test.jsx | TaskEditForm.jsx (mostly render tests), TaskCard.jsx, QuickAddTask.jsx |
| Task sections | DependsOnSection.test.jsx, MetaSection.test.jsx, ToolsSection.test.jsx, WeatherSection.test.jsx, WhenSection.test.jsx, WhereSection.test.jsx | All present |
| Views | allDayBanner.test.jsx, weekViewAllDay.test.jsx | **DailyView, DayView, WeekView, ThreeDayView, ListView, PriorityView, CalendarView, TimelineView, SCurveView, ConflictsView, DependencyView** — ALL UNTESTED |
| Admin | ImpersonationBanner.test.jsx, ImpersonationPage.test.jsx | SchedulerDebug.js, SchedulerStepper.jsx — untested |
| State | constants.test.js | **taskReducer.js — UNTESTED** |
| Services | impersonationService.test.js | apiClient.js — untested |
| Utils | taskIcon.test.js, weatherMatch.test.js, isAllDayTask.test.js | timezone.js, weatherIcons.js — untested |
| Hooks | — | **ALL hooks untested**: useTaskState, useUndo, useDragDrop, useConfig, useKeyboardShortcuts, useWeather, usePlanInfo, useTimezone, useIsCompact, useIsMobile |
| Layout | — | AppLayout, HeaderBar, NavigationBar, WeekStrip, ToastNotification — ALL untested |
| Auth | — | AuthProvider, LoginPage — untested |
| Billing UI | — | DisabledItemsPanel, UpgradePrompt — untested |
| Features | — | CalSyncPanel, AiCommandPanel, RecurringDeleteDialog, ConfirmDialog — untested |
| Scheduler (frontend) | — | expandRecurring.js, generateRecurring.js, effectivePriority.js — untested |

### Playwright E2E (juggler/tests/)

| Spec | What it covers |
|------|---------------|
| e2e.spec.js | App load, view switching, settings open, export open |
| task-create.spec.js | QuickAddTask form fill, TaskEditForm full fields |
| task-edit.spec.js | Edit task text, status change |
| calendar-navigation.spec.js | Week/date navigation |
| settings.spec.js | Settings panel open/close |
| placement-mode.spec.js | Placement mode toggle |
| recurring.spec.js | Recurring task creation |
| all-day-banner.spec.js | All-day banner rendering |
| responsive.spec.js | Viewport resize |

---

## Gap Inventory

### CRITICAL

#### GAP-1: schedulerDeepCoverage.test.js tests the wrong scheduler (v1, not v2)
**File:** `/juggler-backend/tests/schedulerDeepCoverage.test.js` line 8
**Evidence:** `var unifiedSchedule = require('../src/scheduler/unifiedSchedule');` — this is the v1 file. Production `runSchedule.js` line 12 uses `unifiedScheduleV2`. The v1 file still exists on disk but is not the production path.
**What it means:** 19 named tests covering dependency chains, split tasks, pull-forward/dampening, overflow, and scoring describe v1 behaviour. Any regression introduced in v2's 1,805-line rewrite will not be caught by this file. The v1 and v2 APIs are different enough that test results are not transferable.
**Risk:** Silent regression in any of the covered scenarios (multi-day chains, split chunks, overflow relaxation) goes undetected in CI.

#### GAP-2: task-write-queue.js coalesce/flush logic has zero tests
**File:** `/juggler-backend/src/lib/task-write-queue.js`
**Evidence:** `grep -rn "coalesceEntries\|_doFlush" tests/` returns zero hits in test files. `coalesceEntries` at line 123 is a 47-line pure function with complex merging logic (create+delete = no-op, multiple updates merge, delete cancels prior create). `_doFlush` at line 213 handles datetime rehydration, transaction ordering, SSE broadcast, cache invalidation, and schedule re-enqueue. Neither is tested.
**Risk:** Mutation ordering bugs (e.g., create+delete on the same task should no-op but doesn't), lost updates under concurrent edits, and datetime corruption (ISO strings not rehydrated to Date objects) are all undetectable. This is the path every user hits during calendar sync.

#### GAP-3: MCP tool tests test the wrong abstraction layer — no actual MCP transport tested
**File:** `/juggler-backend/tests/mcp.test.js`
**Evidence:** The file header explicitly admits it: "Since MCP tools register on McpServer (which requires transport), these tests exercise the same code paths at the function level." The test imports `rowToTask, taskToRow, validateTaskInput` directly from `task.controller` and calls `tasksWrite` helpers directly. The MCP tool dispatch, schema validation (Zod), `list_tasks` filter logic, `update_task` delta routing, `delete_task`, `create_tasks` (batch), and placement_mode inference in the batch path are not exercised via the actual MCP tool interface.
**Risk:** A bug in the Zod schema for `create_task`, a validation gap in `update_task`'s delta check, or a routing issue in `server.js` tool dispatch would be invisible. The placement_mode regression from Phase 19 was caught by a separate file (`mcpOverdueRegression.integration.test.js`) that *does* use `runScheduleAndPersist` — but only for the date-only case. The MCP `update_task` placement inference is not tested at all.

#### GAP-4: enforceDowngradeLimits has no real-DB integration test
**File:** `/juggler-backend/src/controllers/billing-webhooks.controller.js` lines 23–158
**Evidence:** All `enforceDowngradeLimits` tests in `disabledStatus.test.js` run against a mock DB chain (lines 40–41: `const mockDb = createChainMock()`). The real function executes a `db.transaction()` with multi-step queries involving `tasks_v`, `task_masters`, `task_instances`, and `cal_sync_ledger`, ordering matters (recurring templates before tasks), and it issues `tasksWrite.updateInstancesWhere` + `tasksWrite.updateTasksWhere` calls chained against the transaction object. The mock chain returns pre-canned values and never validates SQL logic.
**Risk:** A downgrade event could silently fail to disable excess tasks (leaving the user over-limit), disable the wrong tasks (newest-first ordering is only verified by mock), or corrupt `cal_sync_ledger` state. Given this fires at user subscription transitions, a bug is a billing integrity issue.

---

### HIGH

#### GAP-5: feature-gate.js middleware (requireFeature, checkUsageLimit) has no dedicated tests
**File:** `/juggler-backend/src/middleware/feature-gate.js`
**Evidence:** `grep -rn "requireFeature\|checkUsageLimit\|feature-gate" tests/` finds references only in mock declarations (tests that stub the middleware out). The `checkUsageLimit` function at line 153 runs `checkAndIncrement` — a MySQL `INSERT ... ON DUPLICATE KEY UPDATE` pattern. The `requireFeature` function at line 60 uses `getNestedValue` for dotted path resolution. Neither is unit-tested. The `logFeatureEvent` DB write (line 22) is never tested.
**Risk:** A path resolution bug in `requireFeature('ai.natural_language_commands')` could unlock premium features for free users or block them for paying users. The concurrent `checkAndIncrement` race (two simultaneous requests both passing the limit check before either increments) is untested and is a real concern on GCP Cloud Run multi-instance deploys.

#### GAP-6: taskReducer.js (frontend state) has zero tests
**File:** `/juggler-frontend/src/state/taskReducer.js`
**Evidence:** `find src/state/__tests__` only finds `constants.test.js`. `taskReducer.js` implements `_dirtyTaskIds` tracking, `INIT` with dirty-field re-application, `UPDATE_TASK` partial merge, `REVERT_TASK`, and `MARK_DIRTY`. These are complex enough to have their own bugs — particularly the dirty-field re-application in `INIT` which prevents round-trip overwrites during concurrent MCP edits.
**Risk:** Dirty state corruption causes the frontend to silently overwrite MCP or GCal changes on the next task list refresh. There is no test that would catch a regression in dirty-field tracking.

#### GAP-7: All 10+ frontend hooks are untested
**Files:** `/juggler-frontend/src/hooks/` — useTaskState.js, useUndo.js, useDragDrop.js, useConfig.js, useKeyboardShortcuts.js, useWeather.js, usePlanInfo.js, useTimezone.js, useIsCompact.js, useIsMobile.js
**Evidence:** `find src/hooks -name "*.test.*"` returns nothing.
**Risk:** `useTaskState` manages SSE reconnection, task polling, optimistic updates, and auth logout triggers. `useUndo` manages the undo stack. Bugs in either are invisible. `useWeather` makes external API calls; no test covers the error path (weather service down, malformed response).

#### GAP-8: SSE emitter tests miss multiple critical paths
**File:** `/juggler-backend/tests/sseEmitter.test.js`
**Evidence:** The test covers Redis publish (happy path), local fallback when Redis is `status: 'connecting'`, and publish failure fallback. What it does NOT cover:
- `addClient` called with `null` userId (crash path: `clients[null]`)
- Cleanup on connection close: does `unsubscribe` get called when the last client disconnects?
- Multi-user isolation: publishing to user A does not deliver to user B
- `getStats()` return shape
- The `subscriber.on('end')` reconnection path (`subscriber = null` → next `getSubscriber()` creates a fresh instance)
**Risk:** The subscriber reconnection path (`subscriber = null` on `end` event) is exercised by the module but not tested — if the subscriber silently fails to re-subscribe after a Redis restart, all SSE events for all users are lost until the process restarts.

#### GAP-9: gemini-tracked-call.js has no tests
**File:** `/juggler-backend/src/services/gemini-tracked-call.js`
**Evidence:** `grep -rn "trackedGeminiCall" tests/` finds it only as a mock target (`jest.mock('../../src/services/gemini-tracked-call')`). The real function wraps Gemini API calls and records usage via `enqueue()` in the `finally` block — meaning it fires even on error. No test verifies that token counts are recorded on success, that error flags are set on failure, or that `latencyMs` is correctly computed.
**Risk:** Silent regression in usage tracking means billing data is corrupted at the source, invisibly.

#### GAP-10: MCP batch create_task (create_tasks) placement_mode inference is untested
**File:** `/juggler-backend/src/mcp/tools/tasks.js` lines 198–202
**Evidence:** `mcpOverdueRegression.integration.test.js` tests the single-task `create_task` placement_mode fix from Phase 19. The `create_tasks` batch tool applies the same inference in a per-item loop (lines 199–202), but there is no test for the batch path. The batch path also sets `splitDefault` from `user_config` — that read is not tested either.
**Risk:** A regression in the batch path (e.g. placement_mode inference skipped for items beyond index 0) would send all batch-created all-day tasks through the overdue path, exactly reproducing the D-04 bug for any user using the batch MCP tool.

---

### MEDIUM

#### GAP-11: Chain deadline backpropagation is documented as OPEN in v2 and has no test asserting the gap
**File:** `/juggler-backend/src/scheduler/unifiedScheduleV2.js` line 19 (comment)
**Evidence:** The v2 header explicitly flags: "Chain deadline backprop: OPEN — user-provided deadline only; predecessor tasks in a dep chain are not given an earlier deadline derived from their successor's deadline." There is no test asserting this limitation exists (a test that *expects* the incorrect scheduling and would fail if the feature were accidentally added incompletely). The gap could cause a chain of tasks to miss a hard deadline with no warning.
**Risk:** A dependency chain where task C has a deadline but tasks A → B → C do not will have A and B freely scheduled past C's deadline with no constraint violation detected.

#### GAP-12: Webhook signature test does not test replay attacks with valid-but-reused signatures
**File:** `/juggler-backend/tests/security/webhook.test.js`
**Evidence:** The test covers stale timestamp rejection (>10 min old) but does NOT cover: (a) a signature that is valid and fresh but has already been processed (replay within the 10-min window), (b) a request where `user_id` is missing from the body, (c) the `subscription.downgrade_applied` path with `to_planId` not matching any known plan.
**Risk:** An attacker replaying a captured `subscription.created` webhook within 10 minutes could repeatedly trigger plan cache invalidation. More critically, a `downgrade_applied` webhook without a valid `to_planId` silently no-ops (no error, `planFeatures` is null) without any alerting.

#### GAP-13: Rate limit integration tests only check headers, not actual enforcement
**File:** `/juggler-backend/tests/security/rate-limits.test.js`
**Evidence:** Every test in this file checks `getRateLimitMax(res.headers)` — the declared limit from the `RateLimit-Limit` header. No test actually sends N+1 requests and verifies a 429 response. The write-rate-limit test file does test actual rejection, but the `api-e2e` rate limiter smoke test (auth-and-validation-e2e.test.js line 225) explicitly accepts both `saw429 = true` and `saw429 = false` as valid outcomes — it literally tests nothing.
**Risk:** A misconfigured rate limiter that declares the correct limit header but never actually rejects requests would pass all existing tests.

#### GAP-14: Frontend task section components test only render/presence, not behaviour
**Files:** `/juggler-frontend/src/components/tasks/sections/__tests__/` (6 files)
**Evidence:** A sample check of `WhenSection.test.jsx` and `WeatherSection.test.jsx` shows tests that render the component and assert element presence with `toBeInTheDocument()`. None of the section tests: fire a change event and assert the parent's `onUpdate` callback is called with the correct payload; test invalid input rejection; or test the empty-state (no date set, no weather constraints).
**Risk:** A regression in how `WhenSection` constructs the update payload (date format, timezone handling, placement_mode flag) would not be caught by the existing tests.

#### GAP-15: Playwright E2E specs use mocked API throughout — no test exercises a real API error path
**Files:** `/juggler/tests/*.spec.js`
**Evidence:** All Playwright specs use `page.route('**/api/**', ...)` to stub responses. There is no spec that simulates an API failure (500, network down) and verifies the frontend shows an error state rather than crashing. `ErrorBoundary.jsx` exists but is never exercised by any test.
**Risk:** An unhandled promise rejection in any view component causes a blank screen in production. No test would catch it.

#### GAP-16: unifiedScheduleV2 marker handling is documented as incomplete and has minimal test coverage
**File:** `unifiedScheduleV2.js` line 29 (comment), `/juggler-backend/tests/schedulerRules.test.js`
**Evidence:** The v2 comment states markers WITHOUT anchorMin "fall through to the slack-sorted queue with dur=0" and there is "no dedicated all-day marker rendering path." A search of schedulerRules and schedulerScenarios for `marker` tests finds only basic marker cases. The "time-unset marker" edge case (marker with no anchorMin) has no test asserting what actually happens to it.

---

### LOW

#### GAP-17: Frontend scheduler utilities (expandRecurring.js, generateRecurring.js, effectivePriority.js) have no frontend tests
**Files:** `/juggler-frontend/src/scheduler/`
**Evidence:** `find juggler-frontend/src/scheduler -name "*.test.*"` returns nothing. These are pure functions — `expandRecurring` in particular duplicates shared backend logic, but the frontend copy (used for optimistic UI updates) could drift from the backend version.

#### GAP-18: data.controller.js and weather.controller.js have no dedicated unit tests
**Files:** `/juggler-backend/src/controllers/data.controller.js`, `weather.controller.js`
**Evidence:** `api/data-and-weather.test.js` exists but uses a mock DB chain and only checks status codes, not response shape or error paths (e.g. weather API timeout).

#### GAP-19: calendar-limit.js and entity-limits.js middleware have no dedicated tests
**Files:** `/juggler-backend/src/middleware/calendar-limit.js`, `entity-limits.js`
**Evidence:** Both are only tested indirectly through mock bypass in route tests. The calendar provider limit logic (max_providers check) is never tested with a user at exactly the limit attempting to add one more.

#### GAP-20: feature-catalog.controller.js and feature-events table writes have no tests
**File:** `/juggler-backend/src/controllers/feature-catalog.controller.js`
**Evidence:** `find tests -name "*.test.js" | xargs grep -l "feature-catalog"` returns nothing. Feature events are written by feature-gate.js on every gated operation but the table is never queried in any test to verify the writes.

---

## Shallow / Misleading Tests

### S-1: schedulerDeepCoverage.test.js — wrong module (CRITICAL overlap with GAP-1)
**File:** `tests/schedulerDeepCoverage.test.js` line 8
Tests 19 scenarios against v1 (`unifiedSchedule.js`). These are not meaningless — v1 is still on disk — but they give false confidence that the production scheduler (v2) has been tested for dependency chains, split tasks, and overflow. The file name says "deep coverage" and implies production coverage. It does not deliver that for v2.

### S-2: mcp.test.js — "Calendar-synced task guards" tests test nothing meaningful
**File:** `tests/mcp.test.js` lines 208–218
```js
test('validateTaskInput allows status on synced tasks', () => {
  expect(validateTaskInput({ status: 'done' })).toEqual([]);
});
```
The comment in the test itself says: "The guard is in the controller/MCP layer, not validateTaskInput — this test verifies validateTaskInput doesn't block status changes." This test does not test the calendar-sync guard (which is the named concern). It tests that `validateTaskInput` permits `status: 'done'` — trivially true and already covered by the `validateTaskInput` suite above it. Two tests in this describe block test nothing related to calendar sync.

### S-3: auth-and-validation-e2e.test.js rate limiter "smoke test" — tests nothing
**File:** `tests/api-e2e/auth-and-validation-e2e.test.js` lines 225–244
```js
expect(typeof saw429).toBe('boolean');
```
This assertion passes whether the rate limiter works or not. `typeof true === 'boolean'` and `typeof false === 'boolean'` are both `true`. The comment says "both outcomes are valid" — which means the test has no assertion about actual rate limiting. It is a 20-line test with exactly zero value.

### S-4: SSE emitter fallback test — setUp/tearDown order creates false Redis path
**File:** `tests/sseEmitter.test.js` lines 172–199 (third test in local fallback suite)
The test calls `jest.resetModules()` and `jest.unmock('ioredis')` at line 174, then immediately re-mocks ioredis with `jest.doMock()`. This pattern creates a new module instance (`sseEmitter2`) inside the `beforeEach`-configured test context. The warnSpy was set up in `beforeEach` but `sseEmitter2` is a fresh module instance that creates its own `console.warn` binding. The assertion `warnSpy.mock.calls.length > warnCountBefore` relies on `console.warn` being globally intercepted, which it is (spy is on `console.warn`), but the test is fragile and the async `setTimeout(fn, 150)` resolution is a timing dependency that could cause flakiness in CI.

### S-5: disabledStatus.test.js enforceDowngradeLimits — mock DB never validates ordering
**File:** `tests/disabledStatus.test.js` lines 362–484
The `enforceDowngradeLimits` tests use a mock DB chain. The function's correctness depends on: (1) recurring templates being disabled before tasks, (2) newest-first ordering, (3) dependency re-linking before disabling. The mock chain accepts any calls in any order and returns pre-set values. A test that seeds 5 tasks and verifies the right 2 were disabled (by ID) cannot do that here because the mock just returns the first `.select()` result regardless of `.orderBy()` calls.

### S-6: TaskEditForm.integration.test.jsx — 3 render tests, zero interaction tests
**File:** `juggler-frontend/src/components/tasks/__tests__/TaskEditForm.integration.test.jsx`
Three tests: render title display, section expanded by default, and clicking toggle collapses. None of them call `onUpdate` and verify the payload. A bug where saving a task sends `dur: undefined` instead of `dur: 30` would not be caught. The file is named "integration" but contains only render assertions.

---

## Recommendations for Tina

Priority order for test additions:

1. **CRITICAL — Write a unit test for `coalesceEntries()` in `task-write-queue.js`.** Pure function, no DB needed. Cover: create+delete=no-op, multiple updates merge, delete after create, empty input, single item. Add an integration test for `_doFlush` using the real test DB.

2. **CRITICAL — Fix schedulerDeepCoverage.test.js to test `unifiedScheduleV2`.** Change line 8: `require('../src/scheduler/unifiedSchedule')` → `require('../src/scheduler/unifiedScheduleV2')`. Audit which test cases still pass and fix/update failing ones.

3. **HIGH — Write real-DB integration tests for `enforceDowngradeLimits`.** Seed users with 5 tasks against a plan limit of 3. Verify exactly which 2 tasks were disabled (by ID, verifying newest-first), that `cal_sync_ledger` rows were updated, and that no active tasks above the limit remain.

4. **HIGH — Write unit tests for `coalesceEntries` in `task-write-queue.js`** (same as #1 above — listed separately because it should be done in one sitting).

5. **HIGH — Write a unit test for `feature-gate.js`**: `requireFeature` path resolution with dotted keys, `requireFeature` blocking at limit=false, `checkUsageLimit` with unlimited plan (should always allow), `checkUsageLimit` with a limit of 1 (second call should 429), and the error path (DB failure → next() called, not 500).

6. **HIGH — Test `taskReducer.js`**: INIT with dirty fields, UPDATE_TASK partial merge, REVERT_TASK, MARK_DIRTY, and the dirty-re-apply-on-INIT race path.

7. **MEDIUM — Add a meaningful rate limiter test**: Send 1001 requests to `/api/tasks` and assert the 1001st gets a 429. Use a low-limit test route or temporarily set a limit via environment variable.

8. **MEDIUM — Delete or rename `rate-limiter smoke test`** in auth-and-validation-e2e.test.js (line 225). Replace it with an actual test or remove it. Its current form provides false assurance.

9. **MEDIUM — Add MCP tool-layer tests** that call the registered tool handlers through the actual tool dispatch (not via direct function calls). At minimum: `create_task` with `date` only (verifies placement_mode=all_day), `create_task` with `date+time` (verifies placement_mode=fixed), `update_task` with status change on a calendar-synced task, and `list_tasks` with various filter combinations.

10. **LOW — Add hook tests** for `useTaskState` (SSE reconnection, optimistic update, auth logout on 401), `useUndo` (push/pop/clear), and `useWeather` (error path when weather API returns 500).

---

*Trina does not fix tests. She documents and delegates. Fix list goes to Tina.*
