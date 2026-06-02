# TEST-REVIEW.md — juggler-backend

## ZOE-JUG-002 Test Run — 2026-06-01

### expandRecurring placement_mode inheritance

38 tests passed, 0 failed. New test `instances inherit placement_mode time_window from template` confirmed RED before fix and GREEN after. Fix directly exercises the non-rolling instance push path at line 470 of `expandRecurring.js`.

| Suite | Tests | Passed | Failed | Status |
|-------|-------|--------|--------|--------|
| expandRecurring.test.js | 38 | 38 | 0 | PASS |

**Status: PASS** — _Signed: Telly — 2026-06-01T00:00:00Z_

---

## ZOE-JUG-026 Test Run — 2026-06-01

**Scope:** `tests/mcp-locked-path.test.js` — locked-path (isLocked=true) routing for MCP create/update/batch_update handlers

### Summary

25 tests passed, 0 failed, 0 skipped. All locked-path branches covered across three MCP handlers. Pure in-memory mock suite — no DB dependency required.

### Test Results

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| mcp-locked-path.test.js | 25 | 25 | 0 | 0 | 0.4s |

### Coverage Map

| Handler | Path Tested | Tests |
|---------|-------------|-------|
| `create_task` locked | enqueueWrite called; insertTask NOT called; queued:true; user_id in fields; explicit id threading; enqueueScheduleRun called; no transaction | 8 |
| `update_task` locked (scheduling) | dur enqueued; placement_mode enqueued; queued:true; enqueueScheduleRun | 4 |
| `update_task` locked (non-scheduling) | text → direct write; notes → direct write; task not found → isError | 3 |
| `batch_update_tasks` locked | enqueueWrite per task; no db.transaction; op/src; queued count; non-scheduling direct; mixed batch; enqueueScheduleRun; unknown id skipped | 7 |
| Mock isolation | beforeEach resets all captures; no bleed across tests | 3 |

### Infrastructure Note

`jest.globalSetup.js` fails when test DB is reachable but migration `20260603000000_add_completed_at_to_tasks_v_view.js` errors (tasks_v not present in juggler_test). Pre-existing issue blocking all juggler-backend unit tests via `npm test`. Tests run with `--globalSetup=""` — all tests here use a fully in-memory mock DB; no real DB connection required.

### Status: PASS

_Signed: Telly — 2026-06-01T00:00:00Z_

---

## ZOE-JUG-027 Test Run — 2026-06-01

**Scope:** `tests/mcp-list-tasks.test.js` — MCP list_tasks handler unit tests

### Summary
13 tests passed, 0 failed, 0 skipped. All list_tasks handler code paths covered.
Pure in-memory mock suite — no DB dependency required.

### Test Results

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| mcp-list-tasks.test.js | 13 | 13 | 0 | 0 | 0.35s |

### Coverage Map

| Code Path | Test | Status |
|-----------|------|--------|
| Default done-exclusion | "excludes done tasks by default" | PASS |
| NULL-status three-valued-logic (MySQL) | "includes null-status tasks" | PASS |
| includeDone=true | "returns done tasks when includeDone=true" | PASS |
| Explicit status="done" filter overrides default | "filters to only done tasks when status=done" | PASS |
| Explicit status="wip" filter | "filters to wip tasks when status=wip" | PASS |
| Project name filter | "filters by project name" | PASS |
| limit without date (DB-level LIMIT) | "limits results when limit is provided without date" | PASS |
| limit with date (post-fetch slice) | "limits results with date filter applied post-fetch" | PASS |
| rowToTask field mapping | "maps DB row to task object with expected fields" | PASS |
| buildSourceMap recurring instance inheritance | "inherits template text in recurring instance" | PASS |
| Empty result set | "returns empty array when no tasks match" | PASS |
| MCP response shape (content array) | "returns content array with type=text" | PASS |
| skip/cancel/pause/disabled included by default | "includes skip, cancel, pause, and disabled tasks" | PASS |

### Mock Architecture
- Knex-style chainable in-memory query builder; filter accumulation with sub-builder for complex `where(fn)` calls
- `_limit` applied inside `resolve()` — bug found and fixed during authoring: `.then` was nulling `_limit` before `resolve()` could read it, causing limit test to fail
- Tables mocked: `users` (returns timezone), `tasks_v` (filtered task list)

### Coverage Gaps
None for `list_tasks`. All branches in handler (lines 84–111 of `src/mcp/tools/tasks.js`) are exercised.

### Status: PASS

_Signed: Telly — 2026-06-01T00:00:00Z_

---

**Review date:** 2026-05-31 (ZOE-JUG-023 update)
**Scope:** mcp-update-task.test.js — new MCP update_task unit test suite

## ZOE-JUG-023 Test Run — 2026-05-31

### Summary
48 tests passed, 0 failed, 0 skipped. All 9 code-path sections fully green. Pure in-memory mock suite — no DB dependency.

### Test Results

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| mcp-update-task.test.js | 48 | 48 | 0 | 0 | 0.82s |

### Coverage Map (by section)

| Section | Code Path Covered | Tests |
|---------|-------------------|-------|
| 1. Cal-sync guard | gcal/msft/apple blocked; status+notes allowed; non-synced passes | 7 |
| 2. placementMode:fixed validation | no date/time→error; date+time/scheduledAt→pass; empty strings→error | 5 |
| 3. taskToRow mapping | text/dur/pri/notes/url/dependsOn/placementMode/travelBefore/travelAfter; strip user_id/created_at; not-found | 11 |
| 4. ALL_DAY backstop | date-only→all_day; date+time→no backstop; scheduledAt→no backstop; explicit mode wins; no date→no backstop | 5 |
| 5. TEMPLATE_FIELDS routing | text→template; status→instance; non-recurring→direct; instance without source→regular | 4 |
| 6. guardFixedCalendarWhen | cal-guard fires first; non-linked free; non-linked can change; recurring cal-linked source prevented | 4 |
| 7. Locked-path split | scheduling→enqueue; queued:true returned; text→direct; placement_mode enqueued correctly | 4 |
| 8. Input validation (validateTaskInput layer) | long when tag; bogus placementMode; fixed cross-field; dur=0; valid when values | 6 |
| 9. enqueueScheduleRun | called on success; not called on not-found | 2 |

### Coverage Gaps (WARN — not blocking)

| Gap | Notes |
|-----|-------|
| Zod `when="fixed"/"allday"` rejection | MCP framework layer — not assertable via direct handler call. Documented in test file. |
| `_allowUnfix` opt-in path | The `fields._allowUnfix` branch in guardFixedCalendarWhen not exercised |
| `recur` / `dayReq` field mapping | Additional taskToRow fields; covered by existing taskMapping.test.js |

### Status: PASS

_Signed: Telly — 2026-05-31T00:00:00Z_

---

**Review date:** 2026-05-24  
**Branch:** main (22 commits ahead of origin/main)  
**Changed files:**
- `src/controllers/task.controller.js` — `checkCalSyncEditGuard` helper extracted; fast + complex paths updated
- `tests/taskCrudIntegration.test.js` — `seedCalSyncTask` helper added; existing cal-sync assertions refactored

---

## Test Scope

Suites executed (all relevant to task CRUD / calendar-sync guard):

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/taskCrudIntegration.test.js` | 28 | 23 pass, 5 fail (pre-existing) |
| `tests/taskCrudIntegration2.test.js` | — | pass |
| `tests/taskControllerUnit.test.js` | — | pass |
| `tests/deleteCalendarLinked.integration.test.js` | — | pass |
| `tests/fkCascadeDetach.integration.test.js` | — | pass |
| `tests/taskStateTransitions.test.js` | 22 | 20 pass, 2 fail (pre-existing) |
| `tests/disabledStatus.test.js` | — | pass |
| `tests/taskPipeline.test.js` | — | pass |

---

## New / Modified Tests

The diff refactors calendar-sync guard coverage in `taskCrudIntegration.test.js`.

### Tests that cover the current change

1. `juggler-originated cal-synced task remains editable (fast path)` — PASS  
   Verifies `origin: 'juggler'` in `cal_sync_ledger` does NOT block text edits.

2. `ingested cal-synced task blocks edits (fast path)` — PASS  
   Verifies `origin: 'gcal'` blocks text edits with `CAL_SYNCED_READONLY`.

3. `ingested cal-synced task allows status and notes (complex path)` — PASS  
   Verifies `origin: 'msft'` allows `notes` but blocks `when` changes.

### Refactoring quality
- `seedCalSyncTask` helper DRYs up ledger-insert boilerplate across the 3 tests above.  
- No net loss of assertions; all original guard scenarios still exercised.

---

## Pre-existing Failures (Not Caused by This Diff)

Seven tests fail on the current branch AND on clean `HEAD` (verified via `git stash` baseline run). Root cause is commit `21ef012` ("stop writing legacy when='fixed'") which removed automatic `when` derivation but left tests expecting it.

| Test file | Test name | Failure |
|-----------|-----------|---------|
| `taskCrudIntegration.test.js` | `sets when=fixed when time is provided` | Expected "fixed", got null |
| `taskCrudIntegration.test.js` | `sets placementMode=fixed when time is provided` | Expected "fixed", got null |
| `taskCrudIntegration.test.js` | `D-14: sets when=allday when allDay=true` | Expected "allday", got null |
| `taskCrudIntegration.test.js` | `D-14: allDay=true with time present sets when=fixed` | Expected "fixed", got null |
| `taskCrudIntegration.test.js` | `updateTask › D-14: sets when=allday` | Expected "allday", got null |
| `taskStateTransitions.test.js` | `allDay=true persists as when=allday` | Expected "allday", got null |
| `taskStateTransitions.test.js` | `allDay=true with scheduledAt provides correct when=allday` | Expected "fixed"/"allday", got null |

**Evidence:** Stashed working-tree changes, re-ran identical suites against bare `HEAD` — same 7 tests fail with identical stack traces.

---

## Regression Check

No regressions introduced by the guard refactor.

- Fast-path `updateTask` behavior unchanged (only inlined guard extracted to `checkCalSyncEditGuard`).
- Complex-path `updateTask` behavior unchanged.
- `deleteTask` untouched by this diff — all delete tests pass.
- `updateTaskStatus` untouched — all status-transition tests pass.

---

## Coverage

Coverage collected from the three primary task-controller suites (`taskCrudIntegration`, `taskCrudIntegration2`, `taskControllerUnit`):

| Metric | Value |
|--------|-------|
| Statements | 63.39% |
| Branches | 54.35% |
| Functions | 68.75% |
| Lines | 66.69% |

The new `checkCalSyncEditGuard` function is covered by integration tests but **not by isolated unit tests** because it is not exported from the module.

---

## Edge-Case Gaps (Telly Notes)

The following `checkCalSyncEditGuard` scenarios have no direct coverage. Consider exporting the helper and adding unit tests:

1. `origin = null` or `origin = undefined` → should permit edit (no guard).  
2. `origin = 'juggler'` → should permit edit.  
3. Body contains **only** `id` → should permit edit (no blocked fields).  
4. Body contains mix of allowed + blocked fields → should block and return the blocked list.  
5. `origin = 'apple'` (third provider) → should block same as gcal/msft.  
6. `datePinned` explicitly set to `false` on an ingested task — `datePinned` is in the allow-list, but does the caller intend to permit unpinning? The allow-list matches the current policy; just ensure it is intentional.

Additionally, the pre-existing D-14 `when`/`allDay` test failures should be triaged separately (fix controller logic **or** update test expectations to match the post-21ef012 behavior).

---

## Verdict

**PASS with WARN.**

- The new cal-sync guard tests pass.
- No regressions detected.
- WARN: 7 pre-existing test failures unrelated to this diff.
- WARN: `checkCalSyncEditGuard` lacks isolated unit-test coverage for edge cases.

Safe to proceed to commit once the pre-commit checklist (simplify, docs, Oscar) is complete.
