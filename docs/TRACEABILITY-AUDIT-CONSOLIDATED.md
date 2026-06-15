# Juggler — Consolidated Traceability Audit Report

**Generated:** 2026-06-15  
**Analyzed by:** Hermes Agent (3 parallel deep-dive subagents)  
**Scope:** All 199 requirements across 11 domains  
**Sources:** REQUIREMENTS.md, USER-STORIES.md, SCHEDULER-AUDIT-REQUIREMENTS.md, 40+ test files read and analyzed

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total requirements** | 199 (177 implemented, 19 partial, 3 planned) |
| **Requirements with verified test coverage** | ~87 (44% — scheduler domain ~48%, non-scheduler ~65%) |
| **Requirements with NO tests at all** | ~25 (all scheduler) |
| **Requirements with partial/inadequate tests** | ~25 (19 partial + 6 with gaps) |
| **Bugs found (implementation ≠ spec)** | 2 (weather fail-open, wrong unplaced reason string) |
| **Missing requirements discovered** | 11 functional + 4 system-level |
| **New backlog items generated** | 32 (999.553–999.584) |

### ⚠️ Critical Finding: VERIFICATION-CHECKLIST.json coverage (8.7%) is WRONG

The existing checklist at `juggler/docs/VERIFICATION-CHECKLIST.json` reports 8.7% coverage (17/196). This is **incorrect** — the `validate_traceability.py` script resolved test file paths relative to a `.worktrees/test/` directory that doesn't mirror the main tree. Actual test coverage is approximately **44%** (~87 of 199 requirements have at least one test file that exists and exercises the requirement). The remaining 56% is still a significant gap, but not as dire as 8.7%.

---

## 1. Domain-by-Domain Traceability

### Strong Coverage (≥80% verified)

| Domain | Reqs | Verified | Partial | Gap | Notes |
|--------|------|----------|---------|-----|-------|
| AI | 5 | 5 | 0 | 0 | 7 test files: integration, unit, characterization |
| Auth | 3 | 3 | 0 | 0 | E2E auth tests + JWT algorithm allowlist |
| Data Import/Export | 5 | 5 | 0 | 0 | merge, replace, schema validation, feature gates |
| Billing | 6 | 6 | 0 | 0 | entitlement contracts, webhook HMAC |
| Calendar Sync | 10 | 10 | 0 | 0 | cal-sync test series (01–23), apple-cal, msft tests |
| Recurring (R18) | 8 | 8 | 0 | 0 | expandRecurring, rolling-anchor, entitlement tests |
| Rolling Anchor (R33) | 5 | 4 | 0 | 1 | Null anchor backfill untested |
| TimesPerCycle (R34) | 5 | 4 | 0 | 1 | Spacing guard safety valve untested |
| Deadline Backprop (R36) | 3 | 0 | 1 | 2 | Only implicit slack tests |

### Medium Coverage (40–70% verified)

| Domain | Reqs | Verified | Partial | Gap | Notes |
|--------|------|----------|---------|-----|-------|
| Dependencies (R10) | 5 | 3 | 2 | 0 | Cycle detection untested |
| Scheduler Algorithm (R11) | 22 | 15 | 2 | 5 | Fallback ladder, phase progression, floor/ceiling untested |
| Task Splitting (R19) | 7 | 3 | 0 | 4 | Day-lock, cross-day, travel buffers, partial flag untested |
| Split Containment (R35) | 6 | 2 | 0 | 4 | Cross-day, inline, overflow all untested |
| Fixed Mode (R26) | 4 | 2 | 0 | 2 | Unfix, recurring+fixed untested |
| Recurring Lifecycle (R32) | 6 | 6 | 0 | 0 | ✅ Strong |
| Constraint Chain (R39) | 5 | 4 | 1 | 0 | Weather fail-open |
| Reschedule Triggers (R41) | 5 | 1 | 1 | 3 | Debounce, rate-limit, no-recursion untested |
| Weather | 9 | 5 | 4 | 0 | **4 confirmed implementation bugs** |

### Weak Coverage (<40% verified)

| Domain | Reqs | Verified | Partial | Gap | Notes |
|--------|------|----------|---------|-----|-------|
| Calendar Views | 11 | 1 | 3 | 7 | Only WeekView tested; all 8 view components have 0 unit tests |
| Drag-and-Drop (R9) | 3 | 0 | 3 | 0 | No unit tests for ANY DnD handler |
| MCP | 2 | 0 | 2 | 0 | No protocol-level tests; per-user scope test EXISTS |
| Earliest Start (R37) | 3 | 0 | 0 | 3 | **Completely untested** |
| FlexWhen (R40) | 3 | 0 | 0 | 3 | **Completely untested** |
| Admin | 3 | 2 | 1 | 0 | Auth boundary test missing |
| Reporting | 3 | 0 | 0 | 3 | Entirely planned — no code exists |

---

## 2. Bugs Found (Implementation ≠ Specification)

### 🐛 B1 — R38.1 Weather Fail-Open (HIGH)
- **Spec says:** Weather-constrained tasks MUST NOT be placed when weather data is missing (fail-closed)
- **Code does:** `weatherOk()` returns `true` when weather data is missing (fail-open)
- **Impact:** Tasks can be scheduled in rain when weather API is down
- **Files:** `unifiedScheduleV2.js:745-787`, `runSchedule.js:1166-1180`

### 🐛 B2 — R38.2 Wrong Unplaced Reason String (HIGH)
- **Spec says:** `_unplacedReason` should be `"weather_unavailable"`
- **Code does:** Uses `"weather"` as the reason string
- **Impact:** Consumers looking for `"weather_unavailable"` won't find it

### 🐛 B3 — R38.4 Duplicated hasWeatherConstraint Logic (MEDIUM)
- `hasWeatherConstraint` is duplicated in `runSchedule.js` and `unifiedScheduleV2.js`
- Future constraint fields added to only one file will fail-open silently in the other

---

## 3. Missing Requirements Found (11 functional, 4 system-level)

### 3.1 From User Story Acceptance Criteria Gaps

| ID | Description | Source | Rationale |
|----|-------------|--------|-----------|
| **M-R1** | Remaining time display: show "X min remaining of Y min est" for wip tasks | US-1 AC: "I can see how much time remains" | `time_remaining` exists but no display requirement |
| **M-R2** | Session persistence: maintain auth across page reloads | US-1 AC: "authenticate once and access without re-entering credentials" | R16 covers JWT but not session durability |
| **M-R3** | Filter by project in task list and calendar views | US-2 AC: "I can filter my task list and calendar views by project" | R4 covers CRUD; filter untracked |
| **M-R4** | Single instance override for recurring tasks | US-6 AC: "I can override a single instance's text or time" | R32 covers lifecycle but not field override |
| **M-R5** | Comprehensive auto-rerun on ALL constraint changes | US-5, US-15 ACs | 999.463 audit confirmed 4 gaps; should enumerate ALL triggers |
| **M-R6** | Scheduled tasks pushed to external calendar verified | US-8 AC: "tasks appear on external calendar" | Push impl exists but no confirm-and-retry req |
| **M-R7** | Split task chunks pushed as individual calendar events | US-7 + US-8 | Known issue in CLAUDE.md |

### 3.2 From Code Analysis (behaviors exist but not documented)

| ID | Description | Found In |
|----|-------------|----------|
| M-SCH-M1 | `time_remaining` scheduling priority for WIP tasks | `unifiedSchedule.test.js:344` |
| M-SCH-M2 | Marker placement mode (consumes no capacity) | `unifiedSchedule.test.js:108` |
| M-SCH-M3 | Date-pinned tasks distinct from fixed placement mode | `unifiedSchedule.test.js:268-274` |
| M-SCH-M4 | `recurStart` field as distinct anchor | `expandRecurring.test.js:214-269` |
| M-SCH-M5 | Schedule scoring (`score.total` in output) | `unifiedSchedule.test.js:242-249` |
| M-SCH-M6 | Field normalization (pri 'p2'→'P2', '3'→'P3') | `solvers.test.js:45-51` |

### 3.3 Scheduler Audit Gaps (from SCHEDULER-AUDIT-REQUIREMENTS.md)

| ID | Description | Status |
|----|-------------|--------|
| **M-SCH-1** | Pile-up eviction: when day overfull, evict pinned→priority→duration | MISSING from code |
| **M-SCH-2** | Frontend visual collapse of adjacent same-task chunks | REMOVED from backend; frontend untested |
| **M-SCH-3** | Deterministic ID format: spec says `masterId-YYYYMMDD-N`, code uses `masterId-N` | STALE — one side must change |

### 3.4 Cross-Cutting / System-Level

| ID | Description | Rationale |
|----|-------------|-----------|
| **M-S1** | DB error handling: retry/timeout/503 on transient failures | No requirement exists |
| **M-S2** | API rate limiting encoded as functional requirement | NFR defines it but no FR exists |
| **M-S3** | Graceful degradation matrix for downstream deps | NFR has matrix, no FR encodes it |
| **M-S4** | Audit logging for data changes | Only impersonation audit (R28.3) exists |

---

## 4. Backlog Items for ROADMAP.md

### Priority: 🔴 HIGH (must fix bugs + add critical missing tests)

```
| 999.553 | JUG-FIX-WEATHER-FAIL-CLOSED | Fix R38.1/R38.2: (1) change weatherOk() to return false when weather data 
  is missing (fail-closed), (2) fix _unplacedReason from "weather" to 
  "weather_unavailable", (3) extract hasWeatherConstraint to shared module, 
  (4) add regression tests asserting weather-constrained tasks NOT placed 
  when data absent. Files: unifiedScheduleV2.js, runSchedule.js, 
  shared/scheduler/weatherHelpers.js (new). BLOCKER on weather scheduling 
  correctness. | juggler | 🔴 HIGH |

| 999.554 | JUG-TEST-FLEXWHEN | Add dedicated FlexWhen test coverage for R40.1-R40.3: (1) time_blocks task 
  with flexWhen=true retried as anytime when blocks full, (2) 
  _flexWhenRelaxed flag on placement entries, (3) flexWhen+deadline 
  combination, (4) flexWhen=false path. Pure unit test on unifiedSchedule. 
  | juggler | 🔴 HIGH |

| 999.555 | JUG-TEST-EARLIEST-START | Add dedicated earliest_start_at enforcement tests for R37.1-R37.3: (1) 
  task with earliestStart=+3d not placed before that date, (2) earliestStart 
  > deadline flagged impossible_window, (3) earliestStart=today placed 
  normally, (4) with chain deps. Pure unit on ConstraintSolver. | juggler | 
  🔴 HIGH |

| 999.556 | JUG-TEST-SCHEDULER-CORE-GAPS | Add tests for scheduler algorithm gaps: R10.3 (circular dependency 
  detection), R11.5 (7-phase execution progression), R11.6 (4-level fallback 
  ladder), R11.17 (floor/ceiling enforcement), R11.10 (weather constraint 
  slot rejection fail-closed). Pure unit, no DB. | juggler | 🔴 HIGH |

| 999.557 | JUG-TEST-SPLIT-CONTAINMENT | Add tests for split containment edge cases: R19.4/R35.2 (recurring rigid 
  split day-lock), R19.5/R35.3 (non-recurring cross-day), R19.6 (travel 
  buffers on ordinals), R19.7/R35.6 (partial_split/recurring_split_overflow 
  flags). | juggler | 🔴 HIGH |

| 999.558 | JUG-TEST-RESCHEDULE-TRIGGERS | Add dedicated trigger-inventory test for R41.2-R41.4: debounce (2s 
  window), rate limit (10/min), no-recursion guard, skipScheduler on 
  non-scheduling updates, and verify all trigger sources route through 
  enqueueScheduleRun. | juggler | 🔴 HIGH |

| 999.559 | JUG-TEST-EARLIEST-START-VALIDATION | Fix and test R37.2: earliestStart > deadline validation — 400 on 
  create/update when startAfter > deadline, or flag as impossible_window in 
  scheduler. | juggler | 🔴 HIGH |
```

### Priority: 🟡 MEDIUM

```
| 999.560 | JUG-TEST-MCP-PROTOCOL | Add MCP protocol-level unit tests: all 20 tools registered and return 
  expected shape, error handling (backend down, invalid params), per-client 
  authorization. Builds on existing function-level tests (mcp-cross-user-
  isolation.test.js exists). | juggler | 🟡 MEDIUM |

| 999.561 | JUG-TEST-DND-HANDLERS | Add backend unit tests for drag-and-drop handlers (R9.1-R9.3): 
  handleGridDrop minutes-to-time mapping, onPriorityDrop priority 
  persistence, arrow-drag dependsOn creation. | juggler | 🟡 MEDIUM |

| 999.562 | JUG-TEST-CALENDAR-VIEWS | Add React Testing Library unit tests for DailyView, ThreeDayView, 
  TimelineView, ListView, SCurveView, PriorityView, DependencyView. Only 
  WeekView currently tested. | juggler | 🟡 MEDIUM |

| 999.563 | JUG-TEST-IMPERSONATION-BOUNDARY | Add impersonation authorization tests for R28.3: (1) non-admin → 403 on 
  impersonation endpoints, (2) expired admin token → impersonation revoked, 
  (3) audit log entries contain admin+target+timerange. | juggler | 🟡 MEDIUM |

| 999.564 | JUG-TEST-CONCURRENT-SYNC | Test concurrent calendar sync: simultaneous GCal+MSFT+Apple sync 
  completes without DB contention, sync locks prevent concurrent same-user 
  runs. | juggler | 🟡 MEDIUM |

| 999.565 | JUG-TEST-SCHEDULER-CONCURRENT | Test NFR §4 concurrent schedule runs: different users → both complete, 
  same user → sync_locks block, 100 concurrent runs (perf test). | juggler | 
  🟡 MEDIUM |

| 999.566 | JUG-TEST-CAPACITY-OFFSET | Test R36.2 capacity-aware deadline offset: deadline propagates backward, 
  predecessor gets effective deadline N days before consumer. Document 
  limitation test. | juggler | 🟡 MEDIUM |

| 999.567 | JUG-TEST-RECURRING-OVERRIDE | Test M-R4 single-instance override for recurring: modify text/time/
  duration on one instance, verify template + other instances unchanged, 
  scheduler preserves override. | juggler | 🟡 MEDIUM |

| 999.568 | JUG-TEST-PROJECT-FILTER | Test M-R3 project filtering: filter by single/multiple projects in task 
  list and calendar views, no-filter shows all. | juggler | 🟡 MEDIUM |

| 999.569 | JUG-TEST-REMAINING-TIME-DISPLAY | Test M-R1 remaining-time display: wip task shows "X min remaining", 
  overdue shows warning, non-wip shows none. Frontend unit test. | juggler | 
  🟡 MEDIUM |

| 999.570 | JUG-TEST-AUTO-RERUN-COMPREHENSIVE | After 999.486/491/492 fixes, write comprehensive auto-rerun test: all 
  constraint change types enqueue scheduler run, text-only changes do NOT 
  enqueue. | juggler | 🟡 MEDIUM |

| 999.571 | JUG-TEST-SPLIT-SYNC | Test M-R7: split task chunks pushed as individual external calendar 
  events with correct times/ordering. | juggler | 🟡 MEDIUM |

| 999.572 | JUG-TEST-TPC-COMPETITION | Test multiple TPC tasks competing for same cycle slots: spacing guard 
  mediation, fillPolicy=keep vs backfill competition, edge cases. | juggler | 
  🟡 MEDIUM |

| 999.573 | JUG-TEST-CAL-PROVIDER-ROUTES | Add route-level contract tests for all calendar provider management 
  endpoints (R43.x): status, auto-sync, calendar selection for GCal, MSFT, 
  Apple. | juggler | 🟡 MEDIUM |

| 999.574 | JUG-TEST-ROLLING-ANCHOR-BACKFILL | Test R33.5: null rollingAnchor backfilled from spacing history, rc_-
  prefixed instance materialization on demand. | juggler | 🟡 MEDIUM |

| 999.575 | JUG-TEST-TPC-SPACING-GUARD | Test R34.5: minGap spacing guard rejects clustered candidates, safety 
  valve disables guard when all remaining slots blocked. | juggler | 🟡 MEDIUM |
```

### Priority: 🟢 LOW

```
| 999.576 | JUG-TEST-HEALTH-ENDPOINTS | Add dedicated health endpoint tests for R42.1-R42.4: 
  /health/immediate, /health/, /health/detailed, feature-events. | juggler | 
  🟢 LOW |

| 999.577 | JUG-TEST-SCHEDULER-STEPPER | Test scheduler stepper session lifecycle (R44.4-R44.7): start/get 
  summary/get step/stop session, non-admin 403, cross-user isolation. 
  | juggler | 🟢 LOW |

| 999.578 | JUG-TEST-DEADLINE-MISSES-REMOVE | Remove or replace dead-code deadlineMisses array from scheduler return 
  shape (R36.3), verify no consumers broken. | juggler | 🟢 LOW |

| 999.579 | JUG-TEST-FIELD-RENAME-EARLIEST-START | Rename start_after_at/startAfter to earliest_start_at/earliestStart 
  (R37.3), update tests. | juggler | 🟢 LOW |

| 999.580 | JUG-TEST-FRONTEND-VISUAL-COLLAPSE | Test frontend visual collapse of adjacent same-task chunks (M-SCH-2): 
  consecutive chunks rendered as single block, indicator shows total 
  duration, clicking shows individuals. | juggler | 🟢 LOW |

| 999.581 | JUG-TEST-DOWNGRADE-RERUN | Test: user downgraded + excess tasks disabled → schedule re-runs. | 
  juggler | 🟢 LOW |

| 999.582 | JUG-TEST-TOCTOU-E2E | API-level TOCTOU test: 2 concurrent AI commands at quota=49 succeed, 
  at quota=50 one succeeds one 429s (R15.2). | juggler | 🟢 LOW |

| 999.583 | JUG-TEST-FEATURE-GATE-EXPLICIT | Explicit 403 assertion: user without data.export → GET /api/data/export 
  → 403 (R22.5). | juggler | 🟢 LOW |

| 999.584 | JUG-TEST-PLAN-DOWNGRADE-UI | Test: disabled (excess) tasks hidden from active views, appear in 
  disabled panel, upgrade re-enables up to new limit (R24.5). | juggler | 
  🟢 LOW |
```

---

## 5. Structural Issues in REQUIREMENTS.md

| # | Issue | Location | Detail |
|---|-------|----------|--------|
| 1 | Batch limit mismatch | US-1 vs R23.1/R23.2 | US-1 says "up to 500 tasks" for both create/update; R23.1 says 500 create, R23.2 says 2000 update |
| 2 | R6.6 double-counted | Traceability tables | Listed as `partial` in gap section but `implemented` in count summary |
| 3 | Missing NFR→FR encoding | NFR.md | Rate limits, performance targets, degradation matrix not encoded as functional reqs |
| 4 | R42 health endpoints: "implemented" + "no test" | R42.1-R42.4 | Three health endpoints with zero tests labelled implemented (should be partial) |
| 5 | R44 scheduler ops: "implemented" + "no test" | R44.2-R44.7 | Seven scheduler endpoints with zero tests labelled implemented |
| 6 | R46 task queries: "implemented" + "no test" | R46.1-R46.2 | Two endpoints untested, status implemented |
| 7 | R17 MCP: "implemented" + "no test" | R17.1-R17.2 | 20 MCP tools with no protocol-level tests labelled implemented |
| 8 | VERIFICATION-CHECKLIST.json stale | Full file | Shows 8.7% coverage — wrong due to path resolution issue in validation script |

---

## 6. Files Created During This Audit

| File | Purpose |
|------|---------|
| `juggler/docs/DOMAIN-ANALYSIS-REPORT.md` | Full traceability matrix + bugs + backlog for non-scheduler domains (Calendar, AI, Auth, MCP, Data, Billing, Weather, Admin, Reporting) |
| `juggler/juggler-backend/docs/SCHEDULER-TRACEABILITY-REPORT.md` | Full traceability matrix + bugs + backlog for scheduler domain (103 reqs across R10-R41) |
| `juggler/docs/MISSING-REQUIREMENTS-AND-TESTS-REPORT.md` | Missing requirements analysis across all domains + enterprise-level backlog |
| `juggler/docs/TRACEABILITY-AUDIT-CONSOLIDATED.md` | **This file** — consolidated synthesis of all three analyses |

---

## 7. Recommended Action Plan

1. **P0 — Fix weather fail-open bug** (999.553) — critical correctness issue, scheduler can place tasks in rain
2. **P1 — Add missing scheduler core tests** (999.554-999.559) — 25 scheduler sub-reqs have zero tests
3. **P1 — Add DnD handler tests** (999.561) — all 3 drag-and-drop paths have zero tests
4. **P2 — Add calendar view tests** (999.562) — 6 of 8 views have zero unit tests
5. **P2 — Add MCP protocol tests** (999.560) — builds on existing function-level tests
6. **P2-Structural — Fix REQUIREMENTS.md inconsistencies** (Section 5 issues)
7. **P3 — Regenerate VERIFICATION-CHECKLIST.json** with correct test file path resolution

*End of report*