# Missing Requirements & Test Gap Analysis — Juggler

**Generated:** 2026-06-15  
**Source documents:** USER-STORIES.md, REQUIREMENTS.md, SCHEDULER-AUDIT-REQUIREMENTS.md, NFR.md, ROADMAP.md  
**Type:** Gap analysis (user story → requirement, requirement → test, domain completeness)

---

## Table of Contents

1. [Missing Functional Requirements (User Story Gaps)](#1-missing-functional-requirements-user-story-gaps)
2. [Missing System-Level / Cross-Cutting Requirements](#2-missing-system-level--cross-cutting-requirements)
3. [Scheduler Audit Gaps (from SCHEDULER-AUDIT-REQUIREMENTS.md)](#3-scheduler-audit-gaps-from-scheduler-audit-requirementsmd)
4. [Requirements with No or Inadequate Tests](#4-requirements-with-no-or-inadequate-tests)
5. [Backlog Inventory (999.x format)](#5-backlog-inventory-999x-format)
6. [Structural Issues in REQUIREMENTS.md Documentation](#6-structural-issues-in-requirementsmd-documentation)

---

## 1. Missing Functional Requirements (User Story Gaps)

Requirements that SHOULD exist based on user story acceptance criteria but have NO corresponding requirement in REQUIREMENTS.md.

### M-R1 — Remaining Time Display

| Field | Value |
|-------|-------|
| **Proposed ID** | M-R1.1 |
| **Domain** | Task Management |
| **Story** | US-1 |
| **Requirement (RFC-2119)** | The system SHOULD display remaining time for an in-progress task against its original estimate in the task detail view and list views. |
| **Acceptance Criteria** | **Happy:** Given a task in `wip` status with `dur: 120` and `time_remaining: 45`, when the user views the task detail, then the display shows "45 min remaining of 120 min estimated." **Unhappy:** Given a task in `wip` with `time_remaining` exceeding `dur` (e.g., `dur: 60`, `time_remaining: 90`), when displayed, then the remaining time is shown with a visual warning (e.g., red text or icon) indicating overrun. |
| **Source** | US-1 AC: "I can see how much time remains on an in-progress task against my original estimate" |
| **Current coverage** | R6.1 allows setting `time_remaining`, R6.6 caps effective duration at 720 — but NO requirement for visual display. `time_remaining` field exists in DB but no UI display requirement. |

### M-R2 — Session Persistence / Silent Token Refresh

| Field | Value |
|-------|-------|
| **Proposed ID** | M-R2.1 |
| **Domain** | Auth |
| **Story** | US-1 |
| **Requirement (RFC-2119)** | The system SHOULD maintain user authentication across page reloads and browser restarts without re-entering credentials, using a refresh-token or session-cookie mechanism. |
| **Acceptance Criteria** | **Happy:** Given an authenticated user, when the user closes the tab and reopens the app, then the user is still authenticated without re-entering credentials. **Unhappy:** Given an expired JWT and a valid refresh token, when the app loads, then the token is silently refreshed and the user remains authenticated. **Unhappy:** Given no valid refresh token, when the app loads, then the user is redirected to the login page. |
| **Source** | US-1 AC: "I can authenticate once and access all task features without re-entering credentials" |
| **Current coverage** | R16.1–R16.3 cover JWT validation — no session persistence requirement exists. |

### M-R3 — Filter by Project

| Field | Value |
|-------|-------|
| **Proposed ID** | M-R3.1 |
| **Domain** | Calendar Views / Task Management |
| **Story** | US-2 |
| **Requirement (RFC-2119)** | The system MUST allow users to filter the task list and all calendar views by one or more projects. |
| **Acceptance Criteria** | **Happy:** Given tasks in projects "Client Work" and "Personal", when the user selects "Client Work" as a filter, then only tasks from "Client Work" are shown in the task list and all calendar views. **Happy:** Given multiple projects selected as filter, when the user views the calendar, then tasks from all selected projects are shown. **Happy:** Given no project filter selected, when the user views the task list, then tasks from all projects are shown. |
| **Source** | US-2 AC: "I can filter my task list and calendar views by project" |
| **Current coverage** | R4.1–R4.5 cover CRUD and reordering of projects. NO requirement for filtering by project. |

### M-R4 — Single Instance Override

| Field | Value |
|-------|-------|
| **Proposed ID** | M-R4.1 |
| **Domain** | Scheduler (Recurring) |
| **Story** | US-6 |
| **Requirement (RFC-2119)** | The system MUST allow overriding the text, time, or duration of a single recurring instance without affecting the recurring template or other instances. |
| **Acceptance Criteria** | **Happy:** Given a recurring weekly task "Team Standup" at 09:00, when the user edits a future instance to change text to "Special Standup" and time to 10:00, then the instance shows the overridden values, the template and other instances remain unchanged. **Unhappy:** Given an overridden instance, when the scheduler next runs, then the overridden values are preserved (the scheduler does not overwrite them). |
| **Source** | US-6 AC: "I can override a single instance's text or time without affecting the rest of the series" |
| **Current coverage** | R32.1–R32.6 cover recurring instance lifecycle (done/skip/cancel/missed). NO requirement for single-instance field override. |

### M-R5 — Scheduler Auto-Rerun on Constraint Changes (Comprehensive)

| Field | Value |
|-------|-------|
| **Proposed ID** | M-R5.1 |
| **Domain** | Scheduler |
| **Story** | US-5, US-15 |
| **Requirement (RFC-2119)** | The system MUST enqueue a scheduler re-run when the user changes: (a) schedule templates (defaults and per-day overrides), (b) locations, (c) tools/tool matrix, (d) imported data, (e) working hours, (f) schedule floor/ceiling, (g) timezone. |
| **Acceptance Criteria** | **Happy:** Given a user with scheduled tasks, when the user changes their location set (adds/removes a location), then the scheduler is re-queued and the schedule is recalculated. **Happy:** Given a user with scheduled tasks, when the user imports data in merge mode, then the scheduler is re-queued. |
| **Source** | US-5 AC: "When I change my working hours or task constraints, the schedule re-runs automatically." US-15 AC: "When I change time-related settings, my schedule re-runs automatically." |
| **Current coverage** | R31.5 covers `time_blocks`, `schedFloor`, `schedCeiling`. **999.463 audit confirmed 4 gaps:** `template_defaults/overrides` (✅ FIXED 999.464), `ImportData` (→ 999.486), `ReplaceLocations` (→ 999.491), `ReplaceTools` (→ 999.492). A comprehensive requirement should enumerate ALL triggers. |

### M-R6 — Scheduled Tasks on External Calendar (Two-Way Sync Verifiability)

| Field | Value |
|-------|-------|
| **Proposed ID** | M-R6.1 |
| **Domain** | Calendar Sync |
| **Story** | US-8 |
| **Requirement (RFC-2119)** | The system MUST verify that after a sync push completes, the external calendar provider's API confirms receipt of the pushed events. |
| **Acceptance Criteria** | **Happy:** Given tasks scheduled by Juggler, when a sync push completes, then each pushed task is confirmed as created/updated on the external provider's API. **Unhappy:** Given a sync push where the external API returns an error for a specific event, when the sync completes, then the error is recorded in sync history with event ID and error details. |
| **Source** | US-8 AC: "My scheduled Juggler tasks appear on my external calendar so colleagues can see when I'm busy" — implies the push actually succeeds |
| **Current coverage** | R7.7 covers push/pull but no explicit requirement for confirm-and-retry on push failure. |

### M-R7 — Split Tasks in External Calendar Sync

| Field | Value |
|-------|-------|
| **Proposed ID** | M-R7.1 |
| **Domain** | Calendar Sync / Scheduler |
| **Story** | US-7, US-8 |
| **Requirement (RFC-2119)** | The system MUST push split task chunks as individual events to external calendars, maintaining their individual timings and ordering. |
| **Acceptance Criteria** | **Happy:** Given a 2-hour task split into 4×30-min chunks, when sync pushes to the external calendar, then 4 separate events appear at their respective times. |
| **Source** | US-7 AC (split chunks exist), US-8 AC (tasks appear on external calendar). CLAUDE.md notes: "split task part sync" is a known remaining issue. |
| **Current coverage** | A known gap documented in CLAUDE.md. No requirement. |

---

## 2. Missing System-Level / Cross-Cutting Requirements

### M-S1 — Database Error Handling

| Field | Value |
|-------|-------|
| **Proposed ID** | M-S1.1 |
| **Domain** | Cross-Cutting |
| **Story** | (system-level) |
| **Requirement (RFC-2119)** | The system MUST gracefully handle transient database connection failures (timeouts, connection pool exhaustion, deadlocks) by retrying the operation (with exponential backoff) or returning a 503 with a human-readable error. |
| **Justification** | No existing requirement for DB failure handling. R42.2 (health check) detects DB down but doesn't specify API behavior during DB failures. |

### M-S2 — Rate Limiting (Functional Requirement)

| Field | Value |
|-------|-------|
| **Proposed ID** | M-S2.1 |
| **Domain** | Cross-Cutting |
| **Story** | (system-level) |
| **Requirement (RFC-2119)** | The system MUST enforce rate limits on all API endpoints as specified in NFR.md §1, returning 429 with `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers. |
| **Justification** | NFR.md describes rate limits but there's no functional requirement encoding them. |

### M-S3 — Graceful Degradation

| Field | Value |
|-------|-------|
| **Proposed ID** | M-S3.1 |
| **Domain** | Cross-Cutting |
| **Story** | (system-level) |
| **Requirement (RFC-2119)** | The system MUST degrade gracefully when downstream dependencies are unavailable, following the degradation matrix in NFR.md §3. |
| **Justification** | NFR has a degradation matrix but no functional requirement encodes it. |

### M-S4 — Audit Logging for Data Changes

| Field | Value |
|-------|-------|
| **Proposed ID** | M-S4.1 |
| **Domain** | Cross-Cutting |
| **Story** | (system-level) |
| **Requirement (RFC-2119)** | The system SHOULD maintain an audit log of significant data changes (task create/update/delete, project changes, config changes) recording user_id, timestamp, action, and before/after state diff. |
| **Justification** | Only impersonation audit logging exists (R28.3). No general data-change audit trail. |

---

## 3. Scheduler Audit Gaps (from SCHEDULER-AUDIT-REQUIREMENTS.md)

### MISSING Requirements (Spec describes, code doesn't implement)

#### M-SCH-1 — Pile-up Eviction

| Field | Value |
|-------|-------|
| **Proposed ID** | M-SCH-1.1 |
| **Domain** | Scheduler |
| **Source** | SCHEDULER-AUDIT-REQUIREMENTS.md GP-3, CL-2 |
| **Status** | MISSING |
| **Requirement (RFC-2119)** | The system MUST implement post-placement pile-up eviction: when a day's occupancy exceeds available minutes, tasks are evicted in order: pinned (de-pinned first), then lowest priority, then shortest duration. |
| **Current behavior** | Code prevents overlaps via occupancy grid. No post-hoc eviction exists. |
| **SCHEDULER.md spec** | §5b describes eviction order that is not implemented. |

#### M-SCH-2 — Frontend Visual Collapse for Adjacent Same-Task Chunks

| Field | Value |
|-------|-------|
| **Proposed ID** | M-SCH-2.1 |
| **Domain** | Scheduler (UI) |
| **Source** | SCHEDULER-AUDIT-REQUIREMENTS.md CL-1 (REMOVED) |
| **Status** | Backend merge-back removed. Frontend "handles visual collapse" per audit. |
| **Requirement (RFC-2119)** | The frontend MUST visually collapse adjacent same-task split chunks into a single calendar block with a visual indicator showing the total duration and number of chunks. |
| **Note** | CL-1 was removed from backend but no requirement verifies the frontend visual collapse works. |

### STALE Requirements (Documentation mismatch with code)

#### M-SCH-3 — Deterministic ID Format

| Field | Value |
|-------|-------|
| **Proposed ID** | M-SCH-3.1 |
| **Source** | SCHEDULER-AUDIT-REQUIREMENTS.md SA-1 |
| **Status** | STALE |
| **Issue** | Spec says `masterId-YYYYMMDD-N`. Code uses ordinal IDs `masterId-N`. Update spec or code. |

---

## 4. Requirements with No or Inadequate Tests

### 4.1 Known Test Gaps Documented in REQUIREMENTS.md

The following requirements have documented test gaps:

| ID | Description | Gap | Priority |
|----|-------------|-----|----------|
| **R40.1–R40.3** | FlexWhen | "No dedicated FlexWhen test" | HIGH |
| **R36.2** | Capacity-aware offset for propagated deadlines | Documented limitation, no test | HIGH |
| **R36.3** | `deadlineMisses` dead code | "No dedicated test" | MEDIUM |
| **R37.1** | Earliest start enforcement | "No dedicated test" | HIGH |
| **R37.2** | Impossible window detection | "No dedicated test" | HIGH |
| **R37.3** | Field rename (start_after_at → earliest_start_at) | "No dedicated test" | LOW |
| **R41.1–R41.5** | Reschedule triggers | "Tested only indirectly" | MEDIUM |
| **R42.1–R42.4** | Health endpoints | "No dedicated test" (3 endpoints) | MEDIUM |
| **R44.2** | Schedule nudge | "No dedicated test" | MEDIUM |
| **R44.3** | Schedule debug endpoint | "No dedicated test" | MEDIUM |
| **R44.4–R44.7** | Scheduler stepper session | "No dedicated test" (4 endpoints) | LOW |
| **R46.1** | Task version endpoint | "No dedicated test" | MEDIUM |
| **R46.2** | Disabled tasks endpoint | "No dedicated test" | MEDIUM |
| **R17.1** | MCP 20 tools | "No dedicated MCP-server unit tests" | HIGH |
| **R17.2** | MCP authorization scope | "No dedicated MCP-layer authorization test" | HIGH |
| **R9.1–R9.3** | Drag-and-drop (3 modes) | "No dedicated backend test" | MEDIUM |
| **R28.3** | Impersonation boundary tests | Missing auth boundary + token expiry tests | MEDIUM |
| **R38.1** | Weather fail-closed | Code is fail-open (weatherOk returns true when data missing) | HIGH |
| **R38.4** | hasWeatherConstraint extraction | No test for shared-module extraction | MEDIUM |
| **R1.6** | Feature gate enforcement | Partial — tested indirectly | MEDIUM |

### 4.2 Test Gaps from Cross-Cutting Analysis

| ID | Description | Gap | Priority |
|----|-------------|-----|----------|
| **M-TC01** | Batch operations at scale | R23.1/R23.2 tested at functional level, no performance boundary test for 500-create/2000-update | MEDIUM |
| **M-TC02** | Schedule idempotency | R11.15 delta writes — tested but no verification that unchanged tasks produce 0 DB writes in isolation | MEDIUM |
| **M-TC03** | Circular dependency detection | R10.3 tested in unifiedSchedule.test.js but unclear if all cycle shapes (A→B→C→A, self-loop A→A) covered | MEDIUM |
| **M-TC04** | DP-3 (pile-up eviction missing) | GP-3/CL-2 marked MISSING — no test because no code exists | HIGH (code gap) |
| **M-TC05** | FR-001 DB-fail loud pattern | 999.431 confirmed most suites convert to hard-fail on missing DB, but full sweep completeness not verified | MEDIUM |
| **M-TC06** | TPC edge cases | R34.5 spacing guard safety valve — test exists but edge cases (multiple TPC tasks competing in same cycle) not covered | MEDIUM |
| **M-TC07** | Multi-day non-recurring split day-boundary crossing | R35.3 — tested in reconcileSplits.test.js but needs combinatorial coverage (3+ days, varying split sizes) | MEDIUM |
| **M-TC08** | Calendar sync: concurrent provider sync | Known issue (DB contention, duplicate active rows). No test for simultaneous GCal+MSFT+Apple sync | MEDIUM |
| **M-TC09** | Weather API failure path | R38.1/38.2 — tested but currently fail-open. Need fail-closed test when weather API is down | HIGH |
| **M-TC10** | Auth token expiry mid-session | No test for 401 on expired JWT mid-API-call flow | MEDIUM |
| **M-TC11** | Scheduler rate limit enforcement | R41.3 — rate limit of 10/min per user — tested but need test for backpressure behavior | MEDIUM |
| **M-TC12** | Concurrent schedule runs | NFR §4 says 100 concurrent runs — no concurrency test | MEDIUM |
| **M-TC13** | Downgrade enforcement: excess items disabled | R24.5 — tested in entitlement tests but need verification that disabled tasks are hidden in UI | LOW |
| **M-TC14** | AI command: concurrent quota exhaustion | 999.415 fixed TOCTOU — but 5-way concurrent test exists only in quotaTOCTOU.test.js; needs end-to-end API-level test | MEDIUM |
| **M-TC15** | Plan downgrade: schedule re-run | When a user is downgraded and excess items are disabled, schedule should re-run — no test | MEDIUM |

---

## 5. Backlog Inventory (999.x format)

All items ready to be added to ROADMAP.md `## Backlog` section.

### Priority Legend: 🔴 HIGH / 🟡 MEDIUM / 🟢 LOW

| Item ID | Title | Service | Priority | Source | Description |
|---------|-------|---------|----------|--------|-------------|
| 999.500 | JUG-TEST-FLEXWHEN | juggler | 🔴 HIGH | R40.1–R40.3 | Add dedicated FlexWhen test covering: (1) time_blocks task with flexWhen=true retried as anytime when blocks full, (2) _flexWhenRelaxed flag on placement entries, (3) flexWhen+deadline combination, (4) flexWhen=False path (no retry). Requires scheduler test with controlled occupancy. |
| 999.501 | JUG-TEST-EARLIEST-START | juggler | 🔴 HIGH | R37.1–R37.3 | Add dedicated earliest-start enforcement tests: (1) task with earliest_start_at=+3 days not placed before that date, (2) earliest_start_at > deadline flagged impossible_window, (3) earliest_start_at = today placed normally, (4) earliest_start_at with chain deps propagates correctly. |
| 999.502 | JUG-TEST-CAPACITY-AWARE-OFFSET | juggler | 🔴 HIGH | R36.2 | Test capacity-aware deadline offset: (1) deadline propagates to predecessor, (2) predecessor requiring N days gets effective deadline N days before consumer's deadline, (3) documented limitation test (no offset → predecessors may appear less constrained). |
| 999.503 | JUG-TEST-WEATHER-FAIL-CLOSED | juggler | 🔴 HIGH | R38.1, R38.2 | Convert weather constraint behavior from fail-open to fail-closed: (1) weather-constrained task with no weather data → NOT placed, flagged "weather_unavailable", (2) weather API returns 5xx → tasks flagged, (3) weather cache stale → tasks flagged, (4) current pass-through path (weatherOk returns true) blocked. |
| 999.504 | JUG-TEST-WEATHER-FLAG-MISMATCH | juggler | 🔴 HIGH | R38.2 | Fix and test: unplaced reason currently "weather" not "weather_unavailable" as specified. Update code + add assertion test. |
| 999.505 | JUG-TEST-MCP-UNIT | juggler | 🔴 HIGH | R17.1, R17.2 | Add dedicated MCP-server unit tests: (1) all 20 tools registered and return expected shape, (2) tool delegation to backend API, (3) error handling (backend down, invalid params), (4) per-client authorization — user A cannot read user B's tasks via MCP. |
| 999.506 | JUG-TEST-PILEUP-EVICTION | juggler | 🔴 HIGH | GP-3, CL-2 | Implement pile-up eviction (code gap) AND test: (1) pinned items dropped first, (2) priority-based eviction, (3) duration-based eviction, (4) evicted tasks flagged unscheduled. |
| 999.507 | JUG-TEST-RESCHEDULE-TRIGGER-INVENTORY | juggler | 🟡 MEDIUM | R41.1–R41.5 | Add dedicated trigger-inventory test verifying ALL trigger sources route through enqueueScheduleRun: task CRUD (each verb), config change (each key type), MCP tool, calendar sync, manual run, frontend nudge, weather refresh, app load. Test each source string is passed correctly. |
| 999.508 | JUG-TEST-HEALTH-ENDPOINT | juggler | 🟡 MEDIUM | R42.1–R42.4 | Add dedicated health endpoint tests: (1) GET /api/health/immediate returns {status:"ok"} with no auth, (2) GET /api/health/ returns DB status, (3) GET /api/health/detailed returns per-service status with auth, (4) 503 when DB is down, (5) feature-events endpoint with valid/invalid service key. |
| 999.509 | JUG-TEST-SCHEDULE-NUDGE | juggler | 🟡 MEDIUM | R44.2 | Test schedule nudge: (1) POST /api/schedule/nudge enqueues run, (2) returns {queued:true}, (3) rate-limited to 10/min, (4) source string is "frontend:task-end-nudge". |
| 999.510 | JUG-TEST-TASK-VERSION-DISABLED | juggler | 🟡 MEDIUM | R46.1, R46.2 | Test: (1) GET /api/tasks/version returns changing identifier on task modification, (2) GET /api/tasks/disabled returns only disabled-status tasks, (3) empty disabled list when no tasks disabled. |
| 999.511 | JUG-TEST-DRAG-DROP-BACKEND | juggler | 🟡 MEDIUM | R9.1–R9.3 | Add backend unit test for drag-and-drop handlers: (1) handleGridDrop maps minutes to time string correctly, (2) onPriorityDrop updates priority and persists, (3) arrow-drag creates dependsOn link. Frontend unit tests exist for rendering but backend persistence path untested. |
| 999.512 | JUG-TEST-IMPERSONATION-BOUNDARY | juggler | 🟡 MEDIUM | R28.3 | Test impersonation authorization: (1) non-admin gets 403 on impersonation endpoints, (2) impersonation is revoked on admin token expiry, (3) impersonation log entries contain admin ID + target ID + timestamp, (4) impersonation banner visible in frontend. |
| 999.513 | JUG-TEST-CONCURRENT-SYNC | juggler | 🟡 MEDIUM | R7.x | Test concurrent calendar sync: (1) simultaneous GCal + MSFT + Apple sync completes without DB contention, (2) duplicate active rows not created (bug #5 fix), (3) sync locks prevent concurrent runs for same user+provider. |
| 999.514 | JUG-TEST-CONCURRENT-SCHEDULE | juggler | 🟡 MEDIUM | NFR §4 | Test concurrent schedule runs: (1) submit 2 schedule runs simultaneously for different users → both complete, (2) concurrent runs for same user blocked by sync_locks, (3) 100 concurrent runs (performance test). |
| 999.515 | JUG-TEST-BATCH-PERFORMANCE | juggler | 🟡 MEDIUM | R23.1, R23.2, NFR §1 | Test batch performance boundaries: (1) batch create 500 tasks completes <30s p95, (2) batch update 2000 tasks completes <60s p95, (3) request with 501 tasks rejected, (4) request with 2001 updates rejected. |
| 999.516 | JUG-TEST-RECURRING-INSTANCE-OVERRIDE | juggler | 🟡 MEDIUM | M-R4 | Test single-instance override: (1) modify text on one recurring instance → template and other instances unchanged, (2) modify time on one instance → preserved through scheduler re-run, (3) modify duration on one instance → scheduler re-run respects the override. |
| 999.517 | JUG-TEST-AUTO-RERUN-LOCATIONS | juggler | 🟡 MEDIUM | 999.463 GAP-3 (→ 999.491) | Test: changing locations enqueues scheduler re-run. Add after ReplaceLocations fix. |
| 999.518 | JUG-TEST-AUTO-RERUN-TOOLS | juggler | 🟡 MEDIUM | 999.463 GAP-4 (→ 999.492) | Test: changing tools/tool matrix enqueues scheduler re-run. Add after ReplaceTools fix. |
| 999.519 | JUG-TEST-AUTO-RERUN-IMPORT | juggler | 🟡 MEDIUM | 999.463 GAP-2 (→ 999.486) | Test: importing data (merge and replace modes) enqueues scheduler re-run. Add after ImportData fix. |
| 999.520 | JUG-TEST-SCHEDULER-STEPPER | juggler | 🟢 LOW | R44.4–R44.7 | Test scheduler stepper session lifecycle: (1) start session → sessionId returned, (2) get summary → aggregate stats, (3) get step by index → step snapshot, (4) stop session → idempotent, (5) non-admin gets 403, (6) session belonging to another user returns 404/403. |
| 999.521 | JUG-TEST-DEADLINE-MISSES-REMOVE | juggler | 🟢 LOW | R36.3 | Remove or replace the dead-code `deadlineMisses` array in scheduler return shape. Verify: (1) current code always returns [] for deadlineMisses, (2) removal doesn't break any consumer, (3) tests updated. |
| 999.522 | JUG-TEST-FIELD-RENAME-EARLIEST-START | juggler | 🟢 LOW | R37.3 | Rename `start_after_at`/`startAfter` to `earliest_start_at`/`earliestStart` in DB and code. Test: (1) old field name rejected on task create/update, (2) new field name accepted, (3) scheduled_at respects earliest start boundary. |
| 999.523 | JUG-TEST-DISPLAY-REMAINING-TIME | juggler | 🟡 MEDIUM | M-R1 | Add frontend unit test for remaining-time display: (1) in-progress task shows "X min remaining of Y min estimated", (2) overdue task (time_remaining > dur) shows visual warning, (3) non-wip task shows no remaining-time indicator. |
| 999.524 | JUG-TEST-PROJECT-FILTER | juggler | 🟡 MEDIUM | M-R3 | Test project filtering: (1) filter by single project in task list, (2) filter by multiple projects, (3) filter by project in calendar views, (4) no filter shows all tasks, (5) filter for nonexistent project shows empty result. |
| 999.525 | JUG-TEST-SCHEDULER-AUTO-RERUN-COMPREHENSIVE | juggler | 🟡 MEDIUM | M-R5 | After 999.486, 999.491, 999.492 fixes, write a comprehensive auto-rerun test: (1) change location → rerun, (2) change tools → rerun, (3) change template defaults → rerun, (4) import data → rerun, (5) text-only change → NO rerun. |
| 999.526 | JUG-TEST-SPLIT-SYNC | juggler | 🟡 MEDIUM | M-R7 | Test split task part sync: (1) split task chunks pushed as individual external calendar events, (2) times/ordering maintained, (3) chunks not re-ordered across sync cycles. |
| 999.527 | JUG-TEST-FRONTEND-VISUAL-COLLAPSE | juggler | 🟢 LOW | M-SCH-2 | Test frontend visual collapse of adjacent same-task chunks: (1) consecutive chunks rendered as single block, (2) visual indicator shows total duration, (3) clicking expanded block shows individual chunks. |
| 999.528 | JUG-TEST-TOCTOU-E2E | juggler | 🟡 MEDIUM | 999.415 | Test AI command quota TOCTOU at API level: (1) 2 concurrent AI commands at quota=49 → both succeed, (2) 2 concurrent at quota=50 → one succeeds one gets 429, (3) verify atomic FOR UPDATE prevents race. |
| 999.529 | JUG-TEST-DOWNGRADE-RERUN | juggler | 🟢 LOW | R24.5, M-SCH | Test: when user is downgraded and excess tasks are disabled, schedule re-runs automatically to recalculate availability. |
| 999.530 | JUG-TEST-TPC-COMPETITION | juggler | 🟡 MEDIUM | R34 | Test multiple TPC tasks competing for the same cycle slots: (1) two TPC tasks with 3/week each in same week → both get their slots, (2) spacing guard mediates competition, (3) fillPolicy=keep vs backfill competition behavior. |
| 999.531 | JUG-TEST-PLAN-DOWNGRADE-UI | juggler | 🟢 LOW | R24.5 | Test: (1) disabled (excess) tasks are hidden from active views, (2) disabled tasks appear in disabled items panel, (3) upgrading re-enables disabled tasks up to new limit. |

---

## 6. Structural Issues in REQUIREMENTS.md Documentation

### 6.1 Inconsistencies Found

| # | Issue | Location | Detail |
|---|-------|----------|--------|
| 1 | **Batch limit mismatch** | US-1 vs R23.1/R23.2 | US-1 says "up to 500 tasks in a single batch operation" for both create AND update. R23.1 says 500 for create, R23.2 says 2000 for update. The user story should be corrected or the requirement is wrong. |
| 2 | **Traceability count discrepancy** | Traceability table vs domain summary | Traceability summary says "206 implemented" but summing per-story counts gives different numbers. R9.1–R9.3 listed as 0 implemented, 3 partial but total counts may not sum correctly between tables. |
| 3 | **Status mismatch in traceability** | R6.6 | Listed as `partial` in traceability gap section (page 584) but counted as `implemented` in the summary count (page 576). R6.6 appears in both lists. |
| 4 | **Missing NFR → functional requirement references** | Various | NFR.md defines rate limits, performance targets, and degradation matrix — none of these are encoded as formal functional requirements in REQUIREMENTS.md. NFRs are cross-referenced but not mapped to specific verifiable acceptance criteria. |
| 5 | **R42 health endpoints have "No dedicated test"** | R42.1–R42.4 | Three health endpoints with zero dedicated test coverage documented, but status marked "implemented" — should be "partial" if untested. |
| 6 | **R44.2–R44.7 scheduler ops have "No dedicated test"** | R44.2–R44.7 | Seven scheduler operational endpoints (nudge, debug, stepper lifecycle) with zero dedicated tests but status "implemented". |
| 7 | **R46.1–R46.2 "No dedicated test"** | R46.1–R46.2 | Two task query endpoints untested, status "implemented". |
| 8 | **R17.1–R17.2 MCP "No dedicated test"** | R17.1–R17.2 | MCP server with 20 tools has no unit test coverage but status "implemented". Tests column says "No dedicated MCP-server unit tests; MCP tools delegate to backend API" — delegation is not sufficient testing. |

### 6.2 Consistency Recommendations

1. **Normalize status labeling**: Requirements that are "implemented" but have "No dedicated test" should be flagged as `partial` in the traceability summary until tests exist.
2. **Fix R6.6 double-counting**: Either resolve the partial status or move it consistently.
3. **Add a "Planned with no code" status**: R12, R13, R14 are marked `planned` but should also note they have no code, no schema backing, and no test.
4. **Encode NFR-derived functional requirements**: The NFR's rate-limiting, performance targets, and degradation matrix should be cross-walked to functional acceptance criteria in the traceability section.

---

*End of Missing Requirements & Test Gap Analysis Report*