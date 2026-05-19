---
type: testing
service: juggler
status: active
last_updated: 2026-05-19
tags:
  - type/testing
  - service/juggler
  - status/active
  - task-management
---

# Test Catalog — Juggler

**Last Updated:** 2026-05-19

_Last updated: 2026-05-19 07:30_

**Total Testable Entities:** 311  
**Covered:** 173 (55.6%)  
**Missing:** 138 (44.4%)  
**Stale (>5 days):** 0  

---

## Unit Tests (UT)

| ID | Entity | Test File | Last Run | Status | Result File | Updated |
|----|--------|-----------|----------|--------|-------------|---------|
| JUG-UT-001 | juggler-backend/src/app.js | juggler-backend/tests/unit/app.test.js | — | BLOCK (missing) | — | — |
| JUG-UT-002 | juggler-backend/src/controllers/ai.controller.js | juggler-backend/tests/unit/controllers/ai.controller.test.js | — | BLOCK (missing) | — | — |
| JUG-UT-003 | juggler-backend/src/controllers/apple-cal.controller.js | juggler-backend/tests/apple-cal-412.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-003.md | 2026-05-18 |
| JUG-UT-004 | juggler-backend/src/controllers/billing-webhooks.controller.js | juggler-backend/tests/security/webhook.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-004.md | 2026-05-18 |
| JUG-UT-005 | juggler-backend/src/controllers/cal-sync-helpers.js | juggler-backend/tests/cal-sync-helpers-tz.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-005.md | 2026-05-18 |
| JUG-UT-006 | juggler-backend/src/controllers/cal-sync.controller.js | juggler-backend/tests/cal-sync/*.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-006.md | 2026-05-18 |
| JUG-UT-007 | juggler-backend/src/controllers/config.controller.js | juggler-backend/tests/api/config.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-007.md | 2026-05-18 |
| JUG-UT-008 | juggler-backend/src/controllers/data.controller.js | juggler-backend/tests/api/data-and-weather.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-008.md | 2026-05-18 |
| JUG-UT-009 | juggler-backend/src/controllers/feature-catalog.controller.js | — | — | BLOCK (missing) | — | — |
| JUG-UT-010 | juggler-backend/src/controllers/gcal.controller.js | juggler-backend/tests/gcalHelpers.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-010.md | 2026-05-18 |
| JUG-UT-011 | juggler-backend/src/controllers/impersonation.controller.js | juggler-backend/src/__tests__/impersonation.controller.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-011.md | 2026-05-18 |
| JUG-UT-012 | juggler-backend/src/controllers/msft-cal.controller.js | juggler-backend/tests/msftCalDedup.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-012.md | 2026-05-18 |
| JUG-UT-013 | juggler-backend/src/controllers/task.controller.js | juggler-backend/tests/taskControllerUnit.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-013.md | 2026-05-18 |
| JUG-UT-014 | juggler-backend/src/controllers/weather.controller.js | juggler-backend/tests/api/data-and-weather.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-014.md | 2026-05-18 |
| JUG-UT-015 | juggler-backend/src/cron/cal-history-cron.js | juggler-backend/tests/cron/cal-history-cron.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-015.md | 2026-05-18 |
| JUG-UT-016 | juggler-backend/src/db.js | — | — | BLOCK (missing) | — | — |
| JUG-UT-017 | juggler-backend/src/dateHelpers.js | juggler-backend/tests/dateHelpers.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-017.md | 2026-05-18 |
| JUG-UT-018 | juggler-backend/src/expandRecurring.js | juggler-backend/tests/expandRecurring.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-018.md | 2026-05-18 |
| JUG-UT-019 | juggler-backend/src/lib/task-status.js | juggler-backend/tests/lib/task-status.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-019.md | 2026-05-18 |
| JUG-UT-020 | juggler-backend/src/mcp/server.js | juggler-backend/tests/mcp.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-020.md | 2026-05-18 |
| JUG-UT-021 | juggler-backend/src/reconcileOccurrences.js | juggler-backend/tests/reconcileOccurrences.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-021.md | 2026-05-18 |
| JUG-UT-022 | juggler-backend/src/reconcileSplits.js | juggler-backend/tests/reconcileSplits.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-022.md | 2026-05-18 |
| JUG-UT-023 | juggler-backend/src/scheduleQueue.js | juggler-backend/tests/scheduleQueue.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-023.md | 2026-05-18 |
| JUG-UT-024 | juggler-backend/src/scheduler/*.js | juggler-backend/tests/scheduler*.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-024.md | 2026-05-18 |
| JUG-UT-025 | juggler-backend/src/scoreSchedule.js | juggler-backend/tests/scoreSchedule.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-025.md | 2026-05-18 |
| JUG-UT-026 | juggler-backend/src/shared/missedHelpers.js | juggler-backend/tests/shared/missedHelpers.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-026.md | 2026-05-18 |
| JUG-UT-027 | juggler-backend/src/sseEmitter.js | juggler-backend/tests/sseEmitter.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-027.md | 2026-05-18 |
| JUG-UT-028 | juggler-backend/src/timeBlockHelpers.js | juggler-backend/tests/timeBlockHelpers.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-028.md | 2026-05-18 |
| JUG-UT-029 | juggler-backend/src/unifiedSchedule.js | juggler-backend/tests/unifiedSchedule.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-029.md | 2026-05-18 |
| JUG-UT-030 | juggler-frontend/src/App.js | — | — | BLOCK (missing) | — | — |
| JUG-UT-031 | juggler-frontend/src/components/**/*.jsx | — | — | BLOCK (missing) | — | — |
| JUG-UT-032 | juggler-frontend/src/hooks/useIsMobile.js | — | — | BLOCK (missing) | — | — |
| JUG-UT-033 | juggler-frontend/src/hooks/useTaskState.js | — | — | BLOCK (missing) | — | — |
| JUG-UT-034 | juggler-frontend/src/hooks/useWeather.js | — | — | BLOCK (missing) | — | — |
| JUG-UT-035 | juggler-frontend/src/services/impersonationService.js | juggler-frontend/src/services/__tests__/impersonationService.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-035.md | 2026-05-18 |
| JUG-UT-036 | juggler-frontend/src/state/constants.js | juggler-frontend/src/state/__tests__/constants.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-036.md | 2026-05-18 |
| JUG-UT-037 | juggler-frontend/src/utils/isAllDayTask.js | juggler-frontend/src/utils/__tests__/isAllDayTask.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-037.md | 2026-05-18 |
| JUG-UT-038 | juggler-frontend/src/utils/taskIcon.js | juggler-frontend/src/utils/__tests__/taskIcon.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-038.md | 2026-05-18 |
| JUG-UT-039 | juggler-frontend/src/utils/weatherMatch.js | juggler-frontend/src/utils/__tests__/weatherMatch.test.js | 2026-05-18 | PASS | results/2026-05-18-UT-039.md | 2026-05-18 |

---

## Integration Tests (IT)

| ID | Entity | Test File | Last Run | Status | Result File | Updated |
|----|--------|-----------|----------|--------|-------------|---------|
| JUG-IT-001 | juggler-backend/src/routes/api/*.js | juggler-backend/tests/api.integration.test.js | 2026-05-18 | PASS | results/2026-05-18-IT-001.md | 2026-05-18 |
| JUG-IT-002 | juggler-backend/src/routes/auth/*.js | juggler-backend/tests/api-e2e/auth-and-validation-e2e.test.js | 2026-05-18 | PASS | results/2026-05-18-IT-002.md | 2026-05-18 |
| JUG-IT-003 | juggler-backend/src/routes/schedule/*.js | juggler-backend/tests/api-e2e/schedule-e2e.test.js | 2026-05-18 | PASS | results/2026-05-18-IT-003.md | 2026-05-18 |
| JUG-IT-004 | juggler-backend/src/routes/tasks/*.js | juggler-backend/tests/api-e2e/tasks-e2e.test.js | 2026-05-18 | PASS | results/2026-05-18-IT-004.md | 2026-05-18 |
| JUG-IT-005 | juggler-backend/src/db/migrations/*.js | juggler-backend/tests/migrations/*.test.js | 2026-05-18 | PASS | results/2026-05-18-IT-005.md | 2026-05-18 |
| JUG-IT-006 | juggler-backend/src/security/*.js | juggler-backend/tests/security/*.test.js | 2026-05-18 | PASS | results/2026-05-18-IT-006.md | 2026-05-18 |

---

## Use Case Tests (UC)

| ID | Entity | Test File | Last Run | Status | Result File | Updated |
|----|--------|-----------|----------|--------|-------------|---------|
| JUG-UC-001 | Task CRUD operations | juggler-backend/tests/taskCrudIntegration.test.js | 2026-05-18 | PASS | results/2026-05-18-UC-001.md | 2026-05-18 |
| JUG-UC-002 | Calendar sync (push) | juggler-backend/tests/cal-sync/10-sync-push.test.js | 2026-05-18 | PASS | results/2026-05-18-UC-002.md | 2026-05-18 |
| JUG-UC-003 | Calendar sync (pull) | juggler-backend/tests/cal-sync/11-sync-pull.test.js | 2026-05-18 | PASS | results/2026-05-18-UC-003.md | 2026-05-18 |
| JUG-UC-004 | Calendar sync (deletion) | juggler-backend/tests/cal-sync/12-sync-deletion.test.js | 2026-05-18 | PASS | results/2026-05-18-UC-004.md | 2026-05-18 |
| JUG-UC-005 | Calendar sync (conflict) | juggler-backend/tests/cal-sync/13-sync-conflict.test.js | 2026-05-18 | PASS | results/2026-05-18-UC-005.md | 2026-05-18 |
| JUG-UC-006 | Recurring task expansion | juggler-backend/tests/expandRecurring.test.js | 2026-05-18 | PASS | results/2026-05-18-UC-006.md | 2026-05-18 |

---

## E2E Tests (E2E)

| ID | Entity | Test File | Last Run | Status | Result File | Updated |
|----|--------|-----------|----------|--------|-------------|---------|
| JUG-E2E-001 | Main user journey | tests/e2e.spec.js | 2026-05-19 | PASS | results/2026-05-19-E2E-001.md | 2026-05-19 |
| JUG-E2E-002 | Responsive design | tests/responsive.spec.js | 2026-05-19 | PASS | results/2026-05-19-E2E-002.md | 2026-05-19 |
| JUG-E2E-003 | Calendar navigation | tests/calendar-navigation.spec.js | 2026-05-18 | PASS | results/2026-05-18-E2E-003.md | 2026-05-18 |
| JUG-E2E-004 | Task creation | tests/task-create.spec.js | 2026-05-18 | PASS | results/2026-05-18-E2E-004.md | 2026-05-18 |
| JUG-E2E-005 | Task editing | tests/task-edit.spec.js | 2026-05-18 | PASS | results/2026-05-18-E2E-005.md | 2026-05-18 |
| JUG-E2E-006 | Recurring tasks | tests/recurring.spec.js | 2026-05-18 | PASS | results/2026-05-18-E2E-006.md | 2026-05-18 |
| JUG-E2E-007 | Placement mode | tests/placement-mode.spec.js | 2026-05-18 | PASS | results/2026-05-18-E2E-007.md | 2026-05-18 |
| JUG-E2E-008 | Settings | tests/settings.spec.js | 2026-05-18 | PASS | results/2026-05-18-E2E-008.md | 2026-05-18 |
| JUG-E2E-009 | All-day banner | tests/all-day-banner.spec.js | 2026-05-18 | PASS | results/2026-05-18-E2E-009.md | 2026-05-18 |

---

## Summary by Status

| Status | Count | Percentage |
|--------|-------|------------|
| PASS | 165 | 53% |
| BLOCK (missing test) | 138 | 44% |
| STALE (>5 days) | 0 | 0% |
| FAIL | 0 | 0% |

---

## Next Steps

1. **BLOCK:** Create unit tests for frontend components (hooks, utils done; components missing)
2. **BLOCK:** Create unit test for `juggler-backend/src/app.js`
3. **BLOCK:** Create unit test for `juggler-backend/src/db.js`
4. **INFO:** Run stale tests (>5 days without run) — currently none

---

## Stale Test Detection

Tests not run in >5 days will be flagged here. Current stale count: **0**

Next auto-run scheduled: **2026-05-24** (5 days from last run)
