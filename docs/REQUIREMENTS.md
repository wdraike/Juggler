---
type: reference
status: active
version: e7ed5c9
Last-updated: 2026-06-12
---

# Requirements — Juggler

_Maintained by docs-sync from the Scooter KG + code. Last synced: 2026-06-12 (commit e7ed5c9ed6a8b425f340ae6d365d97d48fd29c8d)._

> **Scope of this document:** Functional requirements only. Non-functional requirements (performance, security, reliability, scalability, accessibility, observability, compliance) live in `juggler/docs/NFR.md` — this document references NFR sections, never restates them. Per-leg transient deltas live in `.planning/kermit/<leg>/SPEC.md`. The coarse capability summary is in `juggler/docs/PROJECT-BRIEF.md`.

---

## Table of Contents

1. [Functional requirements](#functional-requirements)
2. [Use cases](#use-cases)
3. [Traceability summary](#traceability-summary)

---

## Functional requirements

| ID | Requirement (RFC-2119) | Acceptance criteria | Status | Code (file:sym) | Test(s) | Source |
|----|------------------------|---------------------|--------|-----------------|---------|--------|
| R1 | The system MUST allow authenticated users to create tasks with a text description, priority, duration estimate, and optional deadline. | **Happy:** Given a valid JWT and a well-formed task body, when POST /api/tasks is called, then the task is persisted and returned with the supplied fields. **Unhappy:** Given a body missing the `text` field, when POST /api/tasks is called, then 400 is returned and no task is created. | implemented | `juggler-backend/src/routes/task.routes.js:62` · `juggler-backend/src/slices/task/facade.js` · `juggler-backend/src/schemas/task.schema.js` | `tests/api/tasks.test.js` (AP-09) · `tests/api-e2e/tasks-e2e.test.js` | KG |
| R2 | The system MUST allow authenticated users to update task fields (text, priority, duration, deadline, status, placement mode, and scheduling constraints). | **Happy:** Given a valid JWT and an existing task ID, when PUT /api/tasks/:id is called with changed fields, then only the supplied fields are updated and the response reflects the new state. **Unhappy:** Given a non-existent task ID, when PUT /api/tasks/:id is called, then 404 is returned. | implemented | `juggler-backend/src/routes/task.routes.js:68` · `juggler-backend/src/slices/task/application/commands/UpdateTask.js` | `tests/api/tasks.test.js` · `tests/taskCrudIntegration.test.js` | KG |
| R3 | The system MUST allow authenticated users to delete tasks. | **Happy:** Given a valid JWT and an existing task ID, when DELETE /api/tasks/:id is called, then the task is removed and subsequent GET returns 404. **Unhappy:** Given a non-existent task ID, when DELETE /api/tasks/:id is called, then 404 is returned. | implemented | `juggler-backend/src/routes/task.routes.js:69` · `juggler-backend/src/slices/task/facade.js` | `tests/api/tasks.test.js` (AP-10) · `tests/taskCrudIntegration.test.js` | KG |
| R4 | The system MUST allow users to organize tasks into named projects. | **Happy:** Given a valid JWT, when POST /api/projects is called with a unique project name, then the project is created and appears in GET /api/projects. **Unhappy:** Given a duplicate project name, when POST /api/projects is called, then the request is rejected with an error. | implemented | `juggler-backend/src/routes/project.routes.js:13` · `juggler-backend/src/slices/user-config/application/commands/CreateProject.js` | `tests/api/projects.test.js` | KG |
| R5 | The system MUST allow users to assign a color to projects. | **Happy:** Given a valid JWT and an existing project, when PUT /api/projects/:id is called with a `color` field, then the project's color is updated and returned in subsequent GET /api/projects responses. | implemented | `juggler-backend/src/routes/project.routes.js:17` · `juggler-backend/src/slices/user-config/adapters/KnexConfigRepository.js:233` · `juggler-backend/src/db/migrations/20260301000000_initial_schema.js:61` | `tests/api/projects.test.js` | KG |
| R6 | The system MUST allow users to update a task's status to `wip` and set a `time_remaining` value to track time-in-progress against the original duration estimate. | **Happy:** Given a valid JWT and an existing task, when PUT /api/tasks/:id/status is called with status `wip` and a `time_remaining` value, then the task status and time_remaining are persisted and the scheduler uses `timeRemaining` as `effectiveDur`. **Unhappy:** Given a `time_remaining` value exceeding the task's `dur`, then the scheduler caps effective duration at the stored `dur`. **Note:** Explicit clock-in/clock-out endpoints and dedicated actual-vs-estimated reporting are not implemented — see R17 (planned). | partial | `juggler-backend/src/routes/task.routes.js:65` · `juggler-backend/src/slices/task/application/commands/UpdateTaskStatus.js` · `juggler-backend/src/slices/scheduler/domain/ports/TaskProviderPort.js:41` | `tests/api/task-state-machine.test.js` · `tests/taskStateTransitions.test.js` | KG |
| R7 | The system MUST synchronize tasks with external calendars via iCal/CalDAV, supporting Google Calendar, Microsoft Calendar, and Apple Calendar (CalDAV). | **Happy:** Given a connected calendar provider, when POST /api/cal-sync/sync is called, then local tasks are pushed to the external calendar and external events are pulled to the local task store. **Unhappy:** Given an external provider that returns a non-200, when sync is called, then the sync fails loud, no local task is silently overwritten, and the error is recorded in sync history. | implemented | `juggler-backend/src/routes/cal-sync.routes.js:16` · `juggler-backend/src/routes/gcal.routes.js` · `juggler-backend/src/routes/msft-cal.routes.js` · `juggler-backend/src/routes/apple-cal.routes.js` · `juggler-backend/src/calendar/` | `tests/cal-sync/` (01–23 series) · `tests/apple-cal-*.test.js` | KG |
| R8 | The system MUST visualize tasks alongside calendar events in a time-grid calendar view, rendering both scheduled tasks and synced calendar events in chronological order. | **Happy:** Given tasks with dates/times and synced calendar events, when the user opens the daily calendar view, then tasks and events are rendered on the correct time slots in a time-proportional grid. | implemented | `juggler-frontend/src/components/schedule/CalendarGrid.jsx` · `juggler-frontend/src/components/schedule/HorizontalTimeline.jsx` · `juggler-frontend/src/components/views/DailyView.jsx` | `juggler-frontend/src/components/schedule/` (frontend unit tests) | KG |
| R9 | The system MUST support drag-and-drop rescheduling of tasks on the calendar grid. | **Happy:** Given a task rendered on the calendar grid, when the user drags it and drops it on a different time slot, then the task's `date` and `time` are updated to the drop target and the change is persisted. | implemented | `juggler-frontend/src/components/schedule/CalendarGrid.jsx:366` · `juggler-frontend/src/components/layout/AppLayout.jsx` (`handleGridDrop`) | No dedicated backend test; AppLayout integration test via manual/E2E. Flag: no unit test for `handleGridDrop` logic. | partial |
| R10 | The system MUST manage task dependencies: a task may declare predecessor tasks via `dependsOn`, and the scheduler MUST place a task only after all its predecessors are placed. | **Happy:** Given tasks A→B (B depends on A), when the scheduler runs, then B is scheduled to start after A completes, and A receives a `fauxDeadline` propagated from B's deadline. **Unhappy:** Given a circular dependency in `dependsOn`, when the scheduler runs, then the cycle is detected and the affected tasks are placed on the unscheduled/issues list without corrupting other placements. | implemented | `juggler-backend/src/scheduler/unifiedScheduleV2.js:106,307,437,723` · `juggler-backend/src/scheduler/dependencyHelpers.js` · `shared/scheduler/dependencyHelpers.js` | `tests/unifiedSchedule.test.js` (dependencies describe block) | KG |
| R11 | The system MUST produce a daily schedule by running the scheduler (most-constrained-first algorithm), placing tasks according to severity hierarchy: fixed > overdue > deadline/chain > free. | **Happy:** Given a set of tasks with mixed constraints, when the scheduler runs, then tasks are placed in the order: fixed tasks first, then overdue, then deadline-constrained (sorted by slack), then free tasks. **Unhappy:** Given more work than available capacity, when the scheduler runs, then tasks that cannot fit are placed on the unscheduled/issues list and no task silently loses its placement. | implemented | `juggler-backend/src/scheduler/unifiedScheduleV2.js` · `juggler-backend/src/slices/scheduler/` | `tests/unifiedSchedule.test.js` · `tests/api/schedule-routes.test.js` · `tests/unit/scoreSchedule.test.js` | KG |
| R12 | The system SHOULD generate time reports comparing estimated versus actual time spent per project or task over a date range. | **Happy:** Given completed tasks with `dur` (estimate) and `completed_at`, when a time report is requested, then a breakdown by project shows estimated hours vs hours-in-completed-tasks. **Note:** A dedicated time-report endpoint is not implemented; `completed_at` + `dur` data is available via export (R16). Full reporting UI is not implemented. | planned | No dedicated report route or frontend report view found in codebase as of 2026-06-12. `completed_at` + `dur` fields exist in schema. | No test for time reporting. | KG |
| R13 | The system SHOULD generate project burn-down reports showing remaining work versus time elapsed for a project. | **Happy:** Given tasks in a project with deadlines and durations, when a burn-down report is requested, then a series of remaining-work data points is returned for the project's timeline. | planned | No burn-down route or frontend view found in codebase as of 2026-06-12. | No test for burn-down reports. | KG |
| R14 | The system SHOULD generate capacity planning reports showing available scheduling capacity versus committed task load over a future date range. | **Happy:** Given the user's time blocks and scheduled tasks, when a capacity report is requested, then available minutes per day versus committed task minutes per day is returned for the requested range. | planned | No capacity-planning endpoint or frontend report view found in codebase as of 2026-06-12. Capacity math exists in the scheduler (`capacityInRange`) but is internal. | No test for capacity planning reports. | KG |
| R15 | The system MUST provide AI-driven task suggestions and time estimates via natural language commands, powered by Google GenAI (Gemini). Enrichment is shared globally — one enriched version per task, user overrides stay per-user. | **Happy:** Given a valid JWT, the `ai.natural_language_commands` feature flag, and a daily quota below 50, when POST /api/ai/command is called with a natural-language command string, then the system returns a structured task-operation response (create/update/schedule). **Unhappy:** Given a user who has exhausted the daily quota, when POST /api/ai/command is called, then 429 is returned with a human-readable error. Rate limit: 2 req/min per user. | implemented | `juggler-backend/src/routes/ai.routes.js:30` · `juggler-backend/src/controllers/ai.controller.js:54` · `juggler-backend/src/slices/ai-enrichment/facade.js` · `juggler-backend/src/slices/ai-enrichment/adapters/GeminiAIAdapter.js` | `tests/api/ai-command.test.js` (AP-72a through AP-72g) · `tests/unit/aiEnrichment/` | KG |
| R16 | The system MUST authenticate all user-facing API requests using JWT tokens issued by the shared auth-service (RS256, verified via JWKS). Requests without a valid token MUST be rejected with 401; requests with a valid token for a user not in the `juggler` app list MUST be rejected with 403. | **Happy:** Given a valid RS256 JWT with `juggler` in the `apps` claim, when any protected API endpoint is called, then the request is processed and the response body is returned. **Unhappy (no token):** Given no Authorization header, when a protected endpoint is called, then 401 is returned. **Unhappy (invalid token):** Given an expired or malformed JWT, when a protected endpoint is called, then 401 is returned. **Unhappy (wrong app):** Given a valid JWT without `juggler` in `apps`, when a protected endpoint is called, then 403 is returned. | implemented | `juggler-backend/src/middleware/jwt-auth.js` · `juggler-backend/src/routes/task.routes.js:14` (router.use) | `tests/api-e2e/auth-and-validation-e2e.test.js` (401/403 cases) | KG |
| R17 | The system SHOULD expose an MCP server allowing external MCP clients (e.g. ClimbRS) to perform task and schedule operations via structured tool calls. | **Happy:** Given an authenticated MCP client, when `create_task`, `update_task`, `delete_task`, `list_tasks`, `run_schedule`, `get_schedule`, `get_config`, `export_data`, `sync_calendar`, or project-management tools are called, then the corresponding backend operation is executed and the result is returned as MCP tool output. **Unhappy:** Given an MCP client token for user A, when `list_tasks` is called, then only user A's tasks are returned (not user B's). | implemented | `juggler-mcp/index.js` (20 tool registrations: `list_tasks`, `create_task`, `create_tasks`, `update_task`, `set_task_status`, `delete_task`, `get_task`, `search_tasks`, `batch_update_tasks`, `get_schedule`, `run_schedule`, `get_config`, `list_projects`, `create_project`, `update_project`, `delete_project`, `update_config`, `export_data`, `get_calendar_status`, `sync_calendar`) | No dedicated MCP-server unit tests found; MCP tools delegate to backend API. | partial |

---

## Use cases

Three primary use cases are recorded in the Scooter KG (`has_use_case` facts) and corroborated by `juggler/docs/PROJECT-BRIEF.md §Users`.

### UC-1 — Individual contributor: track tasks and plan sprints

**Actor:** Developer or knowledge worker managing their own workload.

**Goal:** Schedule personal tasks efficiently across working days, track progress, and avoid overcommitment.

**Flow:**
1. User creates tasks (R1) with duration estimates, priorities, and optional deadlines.
2. User organizes tasks into projects (R4), optionally color-coded (R5).
3. User runs the scheduler (R11) — tasks are placed in optimal slots respecting constraints.
4. User views the calendar grid (R8) to see today's plan alongside calendar events.
5. User marks tasks `wip` as they start work, updating `time_remaining` (R6).
6. User marks tasks `done` via status update (R2).
7. User can invoke AI natural-language commands (R15) to bulk-create or reschedule tasks.

**MCP variant:** Same flow via `create_task` / `run_schedule` / `set_task_status` MCP tools (R17).

### UC-2 — Team lead: view workload and monitor progress

**Actor:** Engineering manager or team lead overseeing a small team.

**Goal:** See the overall task backlog, understand scheduling status, and identify blockers.

**Flow:**
1. Lead uses the MCP interface (R17) or the UI to query tasks by project or status.
2. Lead reviews the dependency graph (R10) to identify blocked chains.
3. Lead reassigns tasks via task update (R2), adjusting priorities and deadlines.
4. Lead uses calendar sync (R7) to ensure team events are reflected in the schedule.

**Gap:** Dedicated team-workload view and assignment is not implemented as of 2026-06-12; the above flow is achievable via individual-user flows only.

### UC-3 — Freelancer: billable hours and project estimation

**Actor:** Independent contractor billing clients per hour or per project.

**Goal:** Track time spent on client projects, estimate future work, and produce billing data.

**Flow:**
1. Freelancer creates tasks (R1) per client project with duration estimates.
2. Freelancer marks tasks as `wip` (R6) to record time-in-progress against estimates.
3. Freelancer exports data (R16 export tool / MCP `export_data`) for external billing use.
4. Time reports (R12), burn-down (R13), and capacity planning (R14) would support this flow directly — these requirements are currently `planned`.

**Gap:** Until R12–R14 are implemented, billings-oriented users must post-process the raw export.

---

## Traceability summary

| Status | Count | Requirements |
|--------|-------|--------------|
| `implemented` | 10 | R1, R2, R3, R4, R5, R7, R8, R11, R15, R16 |
| `partial` | 4 | R6, R9, R10, R17 |
| `planned` | 3 | R12, R13, R14 |
| **Total** | **17** | |

### Partial requirements — acceptance gaps

| ID | Gap |
|----|-----|
| R6 | `time_remaining` field and WIP status exist; dedicated clock-in/clock-out endpoints and actual-vs-estimated report are not implemented. The PROJECT-BRIEF description of "clock in/out" and "log actual vs estimated" represents planned capability. |
| R9 | Drag-and-drop handler (`handleGridDrop`) implemented in `AppLayout.jsx` with no unit test; backend `PUT /api/tasks/:id` persists the result, but the drop handler's mapping logic (minutes to time string) has no isolated test coverage. |
| R10 | Dependency placement and `fauxDeadline` propagation are implemented and tested. Circular-dependency detection path has test coverage (`tests/unifiedSchedule.test.js` dependencies block). Marked `partial` because the MCP `create_task` tool exposes `dependsOn` but no dedicated dependency-management API (add/remove single dependency) exists — only full task update. |
| R17 | MCP server exposes 20 tools and is implemented; per-client authorization (user A cannot read user B's tasks) is enforced by the JWT-authenticated backend calls, but there is no dedicated MCP-layer authorization test. |

### Requirements with no tests

| ID | Situation |
|----|-----------|
| R12 | Planned — no code, no test. Not a current gate. |
| R13 | Planned — no code, no test. Not a current gate. |
| R14 | Planned — no code, no test. Not a current gate. |

### NFR cross-references

Non-functional requirements applicable to this service are fully specified in `juggler/docs/NFR.md`:
- Scheduler correctness invariant: `NFR.md §3` (Reliability)
- JWT auth / MCP per-client scope: `NFR.md §2` (Security)
- AI rate limit / quota: `NFR.md §1` (Performance) + implemented as part of R15
- Calendar sync reliability / known bugs: `NFR.md §3` (Reliability)
