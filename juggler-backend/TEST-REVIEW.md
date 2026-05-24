# TEST-REVIEW.md — juggler-backend

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
