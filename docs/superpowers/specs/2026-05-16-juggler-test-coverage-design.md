# Juggler Test Coverage Initiative — Design Spec

**Date:** 2026-05-16  
**Status:** Approved  
**Scope:** Full test coverage audit, gap-fill, and verification for the juggler service

---

## 1. Context

`juggler-backend/docs/TEST-USE-CASES.md` maps 165 use cases across 8 layers to test files.
Current state before this initiative:

| Status | Count | Meaning |
|--------|-------|---------|
| COVERED | 83 | Test exists and passes |
| FIX | 15 | Test exists but failing |
| PLANNED | 50 | Test path defined, not yet written |
| GAP | 17 | No coverage, not yet planned |

The doc was last updated before 21 recent cal-sync commits. Research agents will validate
and supplement it before execution begins.

---

## 2. Architecture

```
Phase 1 — Research Audit (4 parallel agents)
├── R1: Route inventory (Express routers vs API test files)
├── R2: Scheduler paths (all scheduler code branches vs test files)
├── R3: Frontend/UI use cases (components/views vs Playwright specs)
└── R4: Cal-sync edge cases (adapters + recent commits vs cal-sync tests)
         ↓ merge → updated TEST-USE-CASES.md + gap delta report

Phase 2 — Fix Failing Tests (15 FIX + any new failures found)
Phase 3 — Backend PLANNED Tests (31 items, pure Jest)
Phase 4 — Playwright UI Specs (19 items, Chromium, port 3001)
Phase 5 — GAP Routes (17 known + research delta, new tests + code fixes)
Phase 6 — Full Suite Verification (report per file, human sign-off)
```

All phase artifacts live in `juggler/.planning/phases/`.

---

## 3. Research Agent Domains

| Agent | Domain | Primary Source Files | Checked Against |
|-------|--------|---------------------|-----------------|
| R1 | Routes / API | `src/routes/*.js`, `src/controllers/*.js` | `tests/api/`, `tests/api-e2e/`, `tests/security/` |
| R2 | Scheduler | `src/scheduler/*.js`, `shared/scheduler/*.js` | `tests/scheduler*/`, `tests/unit/schedulerSession*`, `tests/schedulerRules*` |
| R3 | Frontend / UI | `juggler-frontend/src/components/**`, `juggler-frontend/src/views/**` | `juggler/tests/*.spec.js`, `juggler-frontend/src/**/__tests__/` |
| R4 | Cal-sync | `src/services/cal-sync/`, `src/adapters/`, `src/services/apple-*` | `tests/cal-sync/`, git log since TEST-USE-CASES.md written |

Each agent outputs a structured gap report appended to `TEST-USE-CASES.md` or as a
`gap-delta-RN.md` file in `.planning/phases/juggler-test-coverage-p1-research/`.

Gap report row shape:
```
{ id, domain, file_path, gap_type, proposed_test_file, priority: high|med|low }
```

---

## 4. Phase Breakdown

### Phase 1 — Research Audit
- **Agents:** 4 parallel (R1–R4), read-only
- **Output:** Updated `TEST-USE-CASES.md` + `gap-delta.md` in phase dir
- **Gate:** All 4 agents complete + delta doc committed

### Phase 2 — Fix Failing Tests
- **Input:** 15 FIX items from TEST-USE-CASES.md + any new failures found by R1–R4
- **Work:** Repair broken assertions, fix mock shapes, fix code bugs exposed
- **Gate:** All repaired files pass `npm test --testPathPattern=<file>`

### Phase 3 — Backend PLANNED Tests
- **Input:** 31 PLANNED items (scheduler session, task state machine, API routes, credential utils)
- **Constraint:** Pure Jest — no running server required; use mock DB / supertest patterns
- **Gate:** `cd juggler-backend && npm test` exits 0

### Phase 4 — Playwright UI Specs
- **Input:** 19 PLANNED UI items across 5 spec files
- **Constraint:** Requires `juggler-frontend` running on port 3002; use auth bypass pattern
- **Spec files:** `task-create.spec.js`, `task-edit.spec.js`, `recurring.spec.js`, `calendar-navigation.spec.js`, `settings.spec.js`
- **Auth pattern:** Intercept `/api/auth/refresh` + `/api/auth/me` per existing `e2e.spec.js`
- **Gate:** `npx playwright test` exits 0 on Chromium

### Phase 5 — GAP Routes + Code Fixes
- **Input:** 17 known GAPs (AP-70 to AP-77 + CS-11 to CS-15) + research delta from Phase 1
- **Work:** Write new test files for each gap route; fix code bugs uncovered
- **Code fix rule:** Bug found → fixed in same phase commit, not deferred
- **Gate:** New test files pass; full suite still green

### Phase 6 — Full Suite Verification
- **Run:** Full `npm test` (backend) + `npx playwright test` (E2E)
- **Report:** Per-file pass/fail table written to `.planning/phases/juggler-test-coverage-p6-verify/REPORT.md`
- **Coverage target:** ≥95% of TEST-USE-CASES.md rows at COVERED status
- **Gate:** Human sign-off on REPORT.md

---

## 5. Known Constraints

- **DB requirement:** Integration tests (Phases 2, 3, 5) require test DB on port 3308 (Docker). Tests self-skip if DB unavailable — Phase 6 must run with DB up.
- **Cal-sync credentials:** Tests in `tests/cal-sync/` self-skip without OAuth tokens in `.env.test`. Phase 5 GAP tests for CS-11/CS-12 follow same skip-if-absent pattern.
- **Playwright port:** Frontend must be on port 3002 (Playwright config default `baseURL`). Override via `PLAYWRIGHT_BASE_URL` or `FRONTEND_URL` env vars.
- **Jest maxWorkers=1:** All backend tests run single-threaded. No parallel test execution.
- **Apple calendar:** Do NOT use Family Calendar for Apple CalDAV tests. Use `TEST_APPLE_CALENDAR_URL` from `.env.test`.

---

## 6. Done Criteria

| Layer | Criterion |
|-------|-----------|
| Backend | `cd juggler-backend && npm test` exits 0; credential-gated cal-sync skips are expected and acceptable |
| Playwright | `npx playwright test` exits 0, all spec files pass Chromium |
| Coverage | ≥95% of TEST-USE-CASES.md rows at COVERED |
| Code quality | No new `TODO` / `FIXME` left in test files; no test that always passes vacuously |
| Bugs | Every code bug found by a test fixed in same phase, committed atomically |

---

## 7. Files Modified / Created

| Path | Action |
|------|--------|
| `juggler-backend/docs/TEST-USE-CASES.md` | Updated by R1–R4 research agents |
| `.planning/phases/juggler-test-coverage-p1-research/` | Research phase artifacts |
| `.planning/phases/juggler-test-coverage-p2-fix/PLAN.md` | Fix phase plan |
| `.planning/phases/juggler-test-coverage-p3-backend/PLAN.md` | Backend planned tests plan |
| `.planning/phases/juggler-test-coverage-p4-playwright/PLAN.md` | UI specs plan |
| `.planning/phases/juggler-test-coverage-p5-gaps/PLAN.md` | GAP routes plan |
| `.planning/phases/juggler-test-coverage-p6-verify/PLAN.md` | Verification plan |
| `juggler-backend/tests/unit/schedulerSession.test.js` | Created (Phase 3) |
| `juggler-backend/tests/api/tasks.test.js` | Created (Phase 3) |
| `juggler-backend/tests/api/task-state-machine.test.js` | Created (Phase 3) |
| `juggler-backend/tests/api/data-import-export.test.js` | Created (Phase 5) |
| `juggler-backend/tests/api/ai-command.test.js` | Created (Phase 5) |
| `juggler-backend/tests/api/weather.test.js` | Created (Phase 5) |
| `juggler/tests/task-create.spec.js` | Created/expanded (Phase 4) |
| `juggler/tests/task-edit.spec.js` | Created/expanded (Phase 4) |
| `juggler/tests/recurring.spec.js` | Created/expanded (Phase 4) |
| `juggler/tests/calendar-navigation.spec.js` | Created/expanded (Phase 4) |
| `juggler/tests/settings.spec.js` | Created/expanded (Phase 4) |
