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
  - calendar-sync
---

# Juggler — Test Use Cases

**Last Updated:** 2026-05-19

Maps every system use case to its test case(s). Status column reflects current state after the `juggler-test-suite` phase completes.

**Status legend:**
- `COVERED` — test exists and passes before phase starts
- `FIX` — test exists but failing; repaired in a plan (Wave 0)
- `PLANNED` — no test yet; plan file creates it
- `PARTIAL` — test exists but covers only a subset of the use case
- `GAP` — no coverage and not yet planned

**Plan column** references `juggler-test-suite-NN-PLAN.md` for planned items.

---

## 1. Scheduler Use Cases

### 1.1 Core Placement

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| SC-01 | 5 one-off tasks at varying priority/duration placed in correct slots | `schedulerRules.test.js` Groups 1-5 | — | COVERED |
| SC-02 | Deadline chain: task A placed before task B (deadline + dependency) | `schedulerRules.test.js` Group 9 | 02 | FIX |
| SC-03 | Split task: 120-min task fills across multiple 30-min slots | `schedulerRules.test.js` Group 11+ | 02 | FIX |
| SC-04 | Rigid daily recurring placed in morning window only | `schedulerRules.test.js` Groups 9, 10 | — | COVERED |
| SC-05 | Weekly flex recurring with cross-day split allowed | `schedulerRules.test.js` Group 9 | 02 | FIX |
| SC-06 | Pinned calendar event is immovable; other tasks flow around it | `schedulerRules.test.js` Group 12 | — | COVERED |
| SC-07 | Location-constrained tasks: home-only vs. work-only filtering | `schedulerRules.test.js` Group 15 | — | COVERED |
| SC-08 | Most-constrained task scheduled before least-constrained | `schedulerRules.test.js` Group 3 | — | COVERED |
| SC-09 | Severity hierarchy: deadline > dependency > preference | `schedulerRules.test.js` Groups 9-10 | 02 | FIX |
| SC-10 | Recurring instance placed same day as recurrence rule fires (never cross-day) | `schedulerRules.test.js` Groups 9, 19 | — | COVERED |
| SC-11 | Non-daily tpc recurring may split across days | `schedulerRules.test.js` Group 50 | 02 | FIX |
| SC-12 | Preferred-time missed detection (task placed outside desired window) | `schedulerRules.test.js` Group 50 | 02 | FIX |
| SC-13 | Same-day dependency ordering: chain member A before B on same day | `schedulerRules.test.js` Group 9 | 02 | FIX |
| SC-14 | `parseDayReq`: any / weekday / weekend / M,W,F / Sa / unrecognized | `tests/unit/schedulerSession.test.js` | 04 | PLANNED |
| SC-15 | `recurringCycleDays`: daily / weekly / biweekly / monthly / interval | `tests/unit/schedulerSession.test.js` | 04 | PLANNED |
| SC-16 | `effectiveDuration`: cap at 720, `timeRemaining=0` skip, snake_case alias | `schedulerRules.test.js` Group 32/59 | 02 | FIX |

### 1.2 Scheduler Scoring

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| SC-20 | Score: deadline miss penalty | `tests/unit/scoreSchedule.test.js` | 04 | PLANNED |
| SC-21 | Score: priority waste penalty | `tests/unit/scoreSchedule.test.js` | 04 | PLANNED |
| SC-22 | Score: fragmentation penalty | `tests/unit/scoreSchedule.test.js` | 04 | PLANNED |
| SC-23 | Sanity: no duplicate placements | `schedulerRules.test.js` Group 28 | — | COVERED |

### 1.3 Scheduler Integration (real DB)

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| SC-30 | Single task placed — `scheduled_at` written to DB | `runScheduleIntegration.test.js` | — | COVERED |
| SC-31 | Multiple tasks placed, all written | `runScheduleIntegration.test.js` | — | COVERED |
| SC-32 | Fixed/marker tasks not moved on re-run | `runScheduleIntegration.test.js` | — | COVERED |
| SC-33 | Date-pinned tasks keep their date after re-run | `runScheduleIntegration.test.js` | — | COVERED |
| SC-34 | Recurring instances expanded from template | `runScheduleIntegration.test.js` | — | COVERED |
| SC-35 | Status transitions (done/wip) preserved during scheduling | `runScheduleIntegration.test.js` | — | COVERED |
| SC-36 | Dependency ordering persisted to DB | — | 07 | PLANNED |
| SC-37 | Split chunk scheduling persisted to DB | — | 07 | PLANNED |
| SC-38 | Overdue tasks (pending, scheduled_at in past) — seeded via SC-03 scenario | `tests/api/tasks.test.js` | 06 | PLANNED |
| SC-39 | Scheduler queue claiming (multi-worker race) | `scheduleQueueClaiming.test.js` | — | COVERED |
| SC-40 | Past-window missed detection written to DB | `scheduler/past-window-missed.test.js` | — | COVERED |

### 1.4 Scheduler Session (admin stepper)

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| SC-50 | `startSession`: creates session, returns sessionId | `tests/unit/schedulerSession.test.js` | 04 | PLANNED |
| SC-51 | `getSession`: returns session state | `tests/unit/schedulerSession.test.js` | 04 | PLANNED |
| SC-52 | `_computeStep`: returns step data for index | `tests/unit/schedulerSession.test.js` | 04 | PLANNED |
| SC-53 | `_computeSummary`: returns wave summary | `tests/unit/schedulerSession.test.js` | 04 | PLANNED |
| SC-54 | `stopSession`: cleans up session state | `tests/unit/schedulerSession.test.js` | 04 | PLANNED |

---

## 2. Task State Machine Use Cases

State transitions per `docs/TASK-STATE-MATRIX.md`.

### 2.1 Unit / Mock-DB

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| SM-01 | `derivePlacementMode` — all 7 modes: MARKER / FIXED / PINNED_DATE / RECURRING_RIGID / RECURRING_WINDOW / RECURRING_FLEXIBLE / FLEXIBLE | `tests/unit/derivePlacementMode.test.js` | 04 | PLANNED |
| SM-02 | `expandToAllInstanceIds` — template ID expansion, instance ID expansion, dedup | `tests/unit/expandToAllInstanceIds.test.js` | 04 | PLANNED |
| SM-03 | `guardFixedCalendarWhen` — calendar event `when=fixed` protection | `tests/unit/derivePlacementMode.test.js` | 04 | PLANNED |
| SM-04 | `applySplitDefault` — split minimum default applied | — | — | GAP |
| SM-05 | `rowToTask` — `tz=null` API mode + null-safe fields | `taskPipeline.test.js` | 03 | FIX |
| SM-06 | `taskToRow` — `scheduledAt` ISO precedence | `taskPipeline.test.js` | — | COVERED |

### 2.2 Integration (real DB)

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| SM-10 | Create task — master + instance written | `taskCrudIntegration.test.js` | — | COVERED |
| SM-11 | Update task — fields persisted | `taskCrudIntegration.test.js` | — | COVERED |
| SM-12 | Delete task — cascades to instances | `taskCrudIntegration.test.js` | — | COVERED |
| SM-13 | Status → done — `completed_at` set | `taskCrudIntegration.test.js` | — | COVERED |
| SM-14 | Invalid status rejected | `taskCrudIntegration.test.js` | — | COVERED |
| SM-15 | Split sibling propagation on status | `taskCrudIntegration.test.js` | — | COVERED |
| SM-16 | Unpin task | `taskCrudIntegration.test.js` | — | COVERED |
| SM-17 | Batch create tasks | `taskCrudIntegration.test.js` | — | COVERED |
| SM-18 | `wip` → `''` (reopen) transition | `tests/api/task-state-machine.test.js` | 07 | PLANNED |
| SM-19 | `wip` → `done` transition | `tests/api/task-state-machine.test.js` | 07 | PLANNED |
| SM-20 | `skip` then re-create (recurring instance skip) | `tests/api/task-state-machine.test.js` | 07 | PLANNED |
| SM-21 | `pause` on recurring template → instances deleted | `tests/api/task-state-machine.test.js` | 07 | PLANNED |
| SM-22 | `disabled` → re-enable (real DB, not just mock) | `tests/api/task-state-machine.test.js` | 07 | PLANNED |
| SM-23 | `missed` status set by system only (user cannot set) | `tests/api/task-state-machine.test.js` | 07 | PLANNED |
| SM-24 | `allDay` flag round-trip through DB | `tests/api/task-state-machine.test.js` | 07 | PLANNED |
| SM-25 | Terminal-status edge cases (done/skip/cancel idempotency) | `tests/api/task-state-machine.test.js` | 07 | PLANNED |

### 2.3 Disabled / Re-enable (mock-DB, existing)

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| SM-30 | Re-enable disabled recurring — DB call sequence | `disabledStatus.test.js` | 01 | FIX |
| SM-31 | Re-enable at plan limit → 403 | `disabledStatus.test.js` | 01 | FIX |
| SM-32 | Cascade-delete disabled recurring | `disabledStatus.test.js` | 01 | FIX |
| SM-33 | `enforceDowngradeLimits` webhook (billing) | `disabledStatus.test.js` | — | COVERED |

---

## 3. API Route Coverage

Routes from `docs/SCHEMA.md` and `juggler-test-suite-RESEARCH.md §4`.

### 3.1 Tasks API

| ID | Route | Test File | Plan | Status |
|----|-------|-----------|------|--------|
| AP-01 | `GET /api/tasks` | `api.integration.test.js` | — | COVERED |
| AP-02 | `POST /api/tasks` | `api.integration.test.js` | — | COVERED |
| AP-03 | `PUT /api/tasks/:id` | `api.integration.test.js` | — | COVERED |
| AP-04 | `DELETE /api/tasks/:id` | `api.integration.test.js` | — | COVERED |
| AP-05 | `PUT /api/tasks/:id/status` | `tests/api/status-guard.test.js` | — | COVERED |
| AP-06 | `PUT /api/tasks/:id/unpin` | `taskCrudIntegration.test.js` | — | COVERED |
| AP-07 | `POST /api/tasks/batch` — happy path | `tests/api/tasks.test.js` | 06 | PLANNED |
| AP-08 | `POST /api/tasks/batch` — 500-task limit | `api.integration.test.js` | — | COVERED |
| AP-09 | `PUT /api/tasks/batch` | `tests/api/tasks.test.js` | 06 | PLANNED |
| AP-10 | `GET /api/tasks/suggest-icon` | `tests/api/tasks.test.js` | 06 | PLANNED |
| AP-11 | `GET /api/tasks/disabled` | `disabledStatus.test.js` | — | COVERED |
| AP-12 | `POST /api/tasks/:id/re-enable` | `disabledStatus.test.js` | — | COVERED |

### 3.2 Schedule API

| ID | Route | Test File | Plan | Status |
|----|-------|-----------|------|--------|
| AP-20 | `POST /api/schedule/run` | `runScheduleIntegration.test.js` | — | COVERED |
| AP-21 | `GET /api/schedule/placements` | `tests/api/schedule-routes.test.js` | — | COVERED |
| AP-22 | `POST /api/schedule/nudge` | `tests/api/schedule-routes.test.js` | — | COVERED |
| AP-23 | `POST /api/schedule/debug` (admin) | `tests/api/schedule-routes.test.js` | — | COVERED |
| AP-24 | `POST /api/schedule/step/start` (admin) | `tests/api/schedule-routes.test.js` | — | COVERED |
| AP-25 | `GET /api/schedule/step/:id/:step` (admin) | `tests/api/schedule-routes.test.js` | — | COVERED |
| AP-26 | `GET /api/schedule/step/:id/summary` (admin) | `tests/api/schedule-routes.test.js` | — | COVERED |
| AP-27 | `POST /api/schedule/step/:id/stop` (admin) | `tests/api/schedule-routes.test.js` | — | COVERED |

### 3.3 Config / Locations / Projects API

| ID | Route | Test File | Plan | Status |
|----|-------|-----------|------|--------|
| AP-30 | `GET /api/config/` | `tests/api/config.test.js` | — | COVERED |
| AP-31 | `PUT /api/config/:key` — happy path | `tests/api/config.test.js` | — | COVERED |
| AP-32 | `PUT /api/config/time_blocks` — limit validation | `tests/api/config.test.js` | — | COVERED |
| AP-33 | `PUT /api/config/preferences` — schema validation | `tests/api/config.test.js` | — | COVERED |
| AP-34 | `GET /api/locations/` | `tests/api/locations.test.js` | — | COVERED |
| AP-35 | `PUT /api/locations/` | `tests/api/locations.test.js` | — | COVERED |
| AP-36 | `GET /api/projects/` | `tests/api/projects.test.js` | — | COVERED |
| AP-37 | `POST /api/projects/` | `tests/api/projects.test.js` | — | COVERED |
| AP-38 | `PUT /api/projects/reorder` | `tests/api/projects.test.js` | — | COVERED |
| AP-39 | `PUT /api/projects/:id` | `tests/api/projects.test.js` | — | COVERED |
| AP-40 | `DELETE /api/projects/:id` | `tests/api/projects.test.js` | — | COVERED |

### 3.4 Calendar Sync API (meta/management)

| ID | Route | Test File | Plan | Status |
|----|-------|-----------|------|--------|
| AP-50 | `GET /api/cal/has-changes` | `tests/api/cal-sync-meta.test.js` | — | COVERED |
| AP-51 | `GET /api/cal/sync-history` | `tests/api/cal-sync-meta.test.js` | — | COVERED |
| AP-52 | `GET /api/cal/audit` | `tests/api/cal-sync-meta.test.js` | — | COVERED |
| AP-53 | `POST /api/cal/sync` | `cal-sync/99-sync-e2e.test.js` | — | COVERED |
| AP-54 | `GET /api/gcal/status` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-55 | `GET /api/gcal/connect` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-56 | `POST /api/gcal/disconnect` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-57 | `POST /api/gcal/auto-sync` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-58 | `GET /api/msft-cal/status` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-59 | `GET /api/msft-cal/connect` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-60 | `POST /api/msft-cal/disconnect` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-61 | `POST /api/msft-cal/auto-sync` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-62 | `GET /api/apple-cal/status` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-63 | `POST /api/apple-cal/connect` | `tests/api/oauth-providers.test.js` | 06 | PLANNED |
| AP-64 | `POST /api/apple-cal/select-calendars` | `tests/api/oauth-providers.test.js` | 06 | PLANNED |
| AP-65 | `GET /api/apple-cal/calendars` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-66 | `PUT /api/apple-cal/calendars/:id` | `tests/api/oauth-providers.test.js` | 06 | PLANNED |
| AP-67 | `POST /api/apple-cal/disconnect` | `tests/api/oauth-providers.test.js` | — | COVERED |
| AP-68 | `POST /api/apple-cal/auto-sync` | `tests/api/oauth-providers.test.js` | — | COVERED |

### 3.5 Other API Routes

| ID | Route | Test File | Plan | Status |
|----|-------|-----------|------|--------|
| AP-70 | `POST /api/data/import` | `tests/api/data-and-weather.test.js` | — | COVERED |
| AP-71 | `GET /api/data/export` | `tests/api/data-and-weather.test.js` | — | COVERED |
| AP-72 | `POST /api/ai/command` | — | — | GAP |
| AP-73 | `GET /api/weather/geocode` | `tests/api/data-and-weather.test.js` | — | COVERED |
| AP-74 | `GET /api/weather/` (forecast) | `tests/api/data-and-weather.test.js` | — | COVERED |
| AP-75 | `GET /api/my-plan/` | — | — | GAP |
| AP-76 | `POST /api/impersonation/start` (admin) | — | — | GAP |
| AP-77 | `POST /api/impersonation/stop` | — | — | GAP |

---

## 4. Calendar Sync Use Cases

### 4.1 Adapter Unit Tests

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| CS-01 | Apple vEvent build — all ICAL.Time properties present | `apple-cal-412.test.js` | 01 | FIX |
| CS-02 | Apple recurring vEvent expansion (11 time combinations) | `apple-cal-412.test.js` | 01 | FIX |
| CS-03 | MSFT adapter `applyEventToTaskFields` — placementMode returned | `cal-sync/02-adapter-msft.test.js` | 01 | FIX |
| CS-04 | MSFT adapter `applyEventToTaskFields` — transparent event → FLEXIBLE | `cal-sync/02-adapter-msft.test.js` | — | COVERED |
| CS-05 | GCal adapter field mapping | `cal-sync/01-adapter-gcal.test.js` | — | COVERED |

### 4.2 Cal-Sync Integration (credential-dependent, skip-if-absent)

Scenarios in `tests/helpers/seed/scenarios.js` seed the DB row; the actual sync requires OAuth tokens.

| ID | Use Case | Seed Scenario | Test File | Plan | Status |
|----|----------|---------------|-----------|------|--------|
| CS-10 | GCal: seed calendar row, verify sync runs | `gcalCalendar` (CS-01) | `cal-sync/99-sync-e2e.test.js` | — | COVERED |
| CS-11 | MSFT: seed calendar row, verify sync runs | `msftCalendar` (CS-02) | — | — | GAP |
| CS-12 | Apple CalDAV: seed calendar row, verify sync runs | `appleCalendar` (CS-03) | — | — | GAP |
| CS-13 | Apple: miss_count guard (repush loop fix) | — | `apple-cal-soak` scripts | — | MANUAL |
| CS-14 | Multi-provider: no MISS_THRESHOLD interference | — | — | — | GAP |
| CS-15 | Concurrent sync: no duplicate active rows | — | — | — | GAP |

### 4.4 Uncovered Cal-Sync Code Paths (identified 2026-05-16)

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| CS-30 | ETag-based change detection fallback path in `cal-sync.controller.js` | — | — | GAP |
| CS-31 | Provider-origin full-sync pull — new branch in sync controller | — | — | GAP |
| CS-32 | Multi-provider `hasChangesLocal` fix — max of all 3 provider timestamps | — | — | GAP |
| CS-33 | `apple.adapter.getEnabledCalendars` legacy fallback path | — | — | GAP |
| CS-34 | Apple 412 retry paths — `createEvent` + `updateEvent` retry on 412 | — | — | GAP |

### 4.3 Credential Utilities

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| CS-20 | `credential-encrypt` round-trip encrypt/decrypt | `tests/unit/credential-encrypt.test.js` | 04 | PLANNED |
| CS-21 | `credential-encrypt` wrong-key rejection | `tests/unit/credential-encrypt.test.js` | 04 | PLANNED |
| CS-22 | `safeStringify` circular reference handling | `tests/unit/safeStringify.test.js` | 04 | PLANNED |
| CS-23 | `safeStringify` BigInt + undefined fields | `tests/unit/safeStringify.test.js` | 04 | PLANNED |

---

## 5. E2E API Use Cases (HTTP + real middleware + real DB)

True E2E: real Express server, real test DB (port 3308), real JWT (RS256).

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| E2-01 | Create task via HTTP — JWT auth, schema validation, DB write | `tests/api-e2e/tasks-e2e.test.js` | — | COVERED |
| E2-02 | Update task via HTTP — delta write only | `tests/api-e2e/tasks-e2e.test.js` | — | COVERED |
| E2-03 | Delete task via HTTP — cascade verified in DB | `tests/api-e2e/tasks-e2e.test.js` | — | COVERED |
| E2-04 | Invalid JWT → 401 | `tests/api-e2e/auth-and-validation-e2e.test.js` | — | COVERED |
| E2-05 | Missing JWT → 401 | `tests/api-e2e/auth-and-validation-e2e.test.js` | — | COVERED |
| E2-06 | Schema validation rejection (Zod) → 400 | `tests/api-e2e/auth-and-validation-e2e.test.js` | — | COVERED |
| E2-07 | Cross-user isolation — user A cannot read user B tasks | `tests/api-e2e/tasks-e2e.test.js` | — | COVERED |
| E2-08 | Run schedule via HTTP — placements written to DB | `tests/api-e2e/schedule-e2e.test.js` | — | COVERED |
| E2-09 | CORS headers present on preflight | — | — | GAP |
| E2-10 | Rate limiter: 429 after threshold | `tests/api-e2e/auth-and-validation-e2e.test.js` | — | PARTIAL |
| E2-11 | Billing webhook HMAC validation | `disabledStatus.test.js` (partial) | — | PARTIAL |

---

## 6. Screen / UI Use Cases (Playwright)

Port 3002 (from `juggler-frontend/.env`). Auth via route interception pattern.

### 6.1 Task Creation (Flow 1)

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| PW-01 | QuickAddTask inline form — fill + submit, task appears in day view | `tests/task-create.spec.js` | 08 | COVERED |
| PW-02 | TaskEditForm full creation: text, priority, duration, when-window, project | `tests/task-create.spec.js` | 08 | PARTIAL |
| PW-03 | Recurring task creation: toggle + daily/weekly, save | `tests/recurring.spec.js` | 08 | COVERED |
| PW-04 | Task with dependency: dep picker → dep badge visible | `tests/task-create.spec.js` | 08 | PARTIAL |

### 6.2 Task Edit / Sidebar (Flow 2)

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| PW-10 | Click task card → sidebar/edit panel opens | `tests/task-edit.spec.js` | 08 | COVERED |
| PW-11 | Status cycle via StatusToggle: open → wip → done | `tests/task-edit.spec.js` | 08 | COVERED |
| PW-12 | Drag-pin task → 📌 badge appears, Unpin button visible | `tests/task-edit.spec.js` | 08 | PARTIAL |
| PW-13 | Unpin → badge gone | `tests/task-edit.spec.js` | 08 | PARTIAL |
| PW-14 | RecurringDeleteDialog: delete instance vs. template cascade | `tests/recurring.spec.js` | 08 | COVERED |

### 6.3 Calendar Navigation (Flow 3)

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| PW-20 | WeekStrip: click different days, view updates | `tests/calendar-navigation.spec.js` | 08 | PARTIAL |
| PW-21 | View switch: DayView → ThreeDayView → WeekView → CalendarView | `tests/calendar-navigation.spec.js` | 08 | PARTIAL |
| PW-22 | ListView: filter by priority | `tests/calendar-navigation.spec.js` | 08 | PARTIAL |
| PW-23 | PriorityView: tasks grouped by P1-P4 | `tests/calendar-navigation.spec.js` | 08 | GAP |
| PW-24 | DependencyView: dependency graph renders | `tests/calendar-navigation.spec.js` | 08 | GAP |

### 6.4 Settings (Flow 4)

| ID | Use Case | Test File | Plan | Status |
|----|----------|-----------|------|--------|
| PW-30 | SettingsPanel open via gear icon — each of 6 tabs accessible | `tests/settings.spec.js` | 08 | COVERED |
| PW-31 | Locations: add location, save, verify appears | `tests/settings.spec.js` | 08 | PARTIAL |
| PW-32 | Projects: add project, rename, delete | `tests/settings.spec.js` | 08 | PARTIAL |
| PW-33 | Templates (time blocks): add block, change color | `tests/settings.spec.js` | 08 | PARTIAL |
| PW-34 | CalSyncPanel: connect flow visible (mock API) | `tests/settings.spec.js` | 08 | GAP |

---

## 7. Seed Scenario → Test Case Mapping

Seed scenarios in `tests/helpers/seed/scenarios.js` prepare DB state for integration and E2E tests.

| Scenario | ID | Seeds | Primary Consumers |
|----------|----|-------|-------------------|
| `simpleOneOffs` | SC-01 | 5 tasks, varying priority/duration | `runScheduleIntegration.test.js`, `tests/api-e2e/tasks-e2e.test.js` |
| `deadlineChain` | SC-02 | 2-task dependency chain with deadline | `tests/api/task-state-machine.test.js`, `tests/api-e2e/schedule-e2e.test.js` |
| `splitTask` | SC-03 | 120-min task, 4 chunks | `runScheduleIntegration.test.js` |
| `rigidDailyRecurring` | SC-04 | Recurring master (daily, rigid, morning) | `runScheduleIntegration.test.js` |
| `weeklyFlexRecurring` | SC-05 | Recurring master (weekly, flex, split allowed) | `runScheduleIntegration.test.js` |
| `pinnedEvent` | SC-06 | Pinned task at 14:00 | `runScheduleIntegration.test.js` |
| `locationConstrained` | SC-07 | 3 tasks: work-only, home-only, tool-only | `runScheduleIntegration.test.js` |
| `allStatuses` | SM-01 | One task per status (pending/done/skip/cancel/missed) | `tests/api/task-state-machine.test.js` |
| `disabledRecurring` | SM-02 | Disabled recurring template + instances | `tests/api/task-state-machine.test.js` |
| `overdueTasks` | SM-03 | 3 tasks with scheduled_at in the past | `tests/api/tasks.test.js` |
| `gcalCalendar` | CS-01 | GCal user_calendars row (skip if no token) | `cal-sync/99-sync-e2e.test.js` |
| `msftCalendar` | CS-02 | MSFT user_calendars row (skip if no token) | Future MSFT soak test |
| `appleCalendar` | CS-03 | Apple user_calendars row (skip if no creds) | Future Apple soak test |

---

## 8. Coverage Summary by Layer

_Updated 2026-05-16 after research audit (R1–R4). Added PARTIAL column; added §4.4 cal-sync code paths._

| Layer | Total | COVERED | FIX | PLANNED | PARTIAL | GAP |
|-------|-------|---------|-----|---------|---------|-----|
| Scheduler unit | 16 | 8 | 8 | 0 | 0 | 0 |
| Scheduler scoring | 4 | 1 | 0 | 3 | 0 | 0 |
| Scheduler integration | 11 | 9 | 0 | 2 | 0 | 0 |
| Scheduler session | 5 | 0 | 0 | 5 | 0 | 0 |
| Task state machine | 26 | 10 | 4 | 11 | 0 | 1 |
| API routes | 58 | 48 | 0 | 6 | 0 | 4 |
| Cal-sync adapters | 5 | 2 | 3 | 0 | 0 | 0 |
| Cal-sync integration | 6 | 1 | 0 | 0 | 0 | 5 |
| Cal-sync code paths (§4.4) | 5 | 0 | 0 | 0 | 0 | 5 |
| Cal-sync credentials | 4 | 0 | 0 | 4 | 0 | 0 |
| E2E API | 11 | 8 | 0 | 0 | 0 | 3 |
| Screen / Playwright | 19 | 6 | 0 | 0 | 10 | 3 |
| **Total** | **170** | **93** | **15** | **31** | **10** | **21** |

> After `juggler-test-suite` phase executes: **COVERED + FIX + PLANNED = 139 of 170 (82%)**. The 21 GAPs include 5 new cal-sync code paths (CS-30–34), 4 remaining uncovered API routes (AI command, my-plan, impersonation ×2), 3 Playwright views (PW-23/24/34), 5 cal-sync integration scenarios, and CORS + legacy items.
>
> **Note on PARTIAL:** E2-10 (rate limiter) and E2-11 (billing webhook HMAC) have partial test coverage; counted in the GAP column above (E2E layer). Playwright PARTIALs (10 specs) have real tests with shallow assertions — counted in PARTIAL column.
>
> **Note on scheduleQueue:** `scheduleQueue.test.js` wraps all its tests in `describe.skip()` — the queue public API is effectively untested. This is tracked as a new task for Phase 3.

---

## 9. Research Audit Delta (2026-05-16)

### Key findings
- 4 routes (AP-70/71/73/74) already covered by `tests/api/data-and-weather.test.js` — doc was stale
- All 6 Playwright spec files have real tests — §8 coverage summary was stale
- `scheduleQueue.test.js`: all tests in `describe.skip()` — entire queue public API untested
- 5 new cal-sync gaps found (CS-30 to CS-34): ETag path, provider-origin pull, multi-provider hasChangesLocal, apple adapter fallback, Apple 412 retry
- 18 routes undocumented (tools, feature-catalog, billing-webhooks, oauth callbacks, health, weather/reverse-geocode, impersonation/targets, impersonation/log)
- Zero data-testid attributes in frontend — Playwright relies on text/role selectors (fragile)

### Action map
| Finding | Phase |
|---------|-------|
| scheduleQueue describe.skip() | Phase 3 (new task) |
| CS-30 to CS-34 cal-sync gaps | Phase 5 |
| PW-23, PW-24, PW-34 still GAP | Phase 4 augment |
| Undocumented routes | Out of scope for this initiative |
