---
phase: 09-placement-mode-enum-redesign
plan: "06"
subsystem: juggler-backend/docs + juggler-backend/tests
tags:
  - docs
  - tests
  - placement-mode
  - migration
dependency_graph:
  requires:
    - 09-03  # controller direct-write (placement_mode written by UI)
    - 09-04  # scheduler enum branching (6-value enum in code)
    - 09-05  # frontend mode selector
  provides:
    - accurate-placement-mode-docs
    - migration-backfill-unit-tests
  affects:
    - juggler-backend/docs/TASK-PROPERTIES.md
    - juggler-backend/docs/SCHEDULER.md
    - juggler-backend/tests/unit/placement-mode-migration.test.js
tech_stack:
  added: []
  patterns:
    - pure-function unit tests mirroring SQL CASE logic
key_files:
  created:
    - juggler-backend/tests/unit/placement-mode-migration.test.js
  modified:
    - juggler-backend/docs/TASK-PROPERTIES.md
    - juggler-backend/docs/SCHEDULER.md
decisions:
  - "Mirrored the SQL CASE expression as a pure JS function (applyBackfill) so tests need no DB"
  - "Mirrored the JS fallback token-strip logic as stripWhenTokens for whitespace-safe testing"
  - "24 test cases: 14 backfill mapping cases + 10 when-strip cases"
metrics:
  duration_seconds: 129
  completed_date: "2026-05-18"
  tasks_completed: 3
  files_changed: 3
---

# Phase 9 Plan 06: Docs & Migration Tests Summary

**One-liner:** Updated TASK-PROPERTIES.md and SCHEDULER.md to reflect the 6-value `placement_mode` enum, and added 24-case unit test that verifies the migration CASE backfill and when-strip logic without a DB connection.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update TASK-PROPERTIES.md — 6-value placement_mode table | 60fcd42 | juggler-backend/docs/TASK-PROPERTIES.md |
| 2 | Update SCHEDULER.md — placement_mode-first branching in section 4a | 091d148 | juggler-backend/docs/SCHEDULER.md |
| 3 | Write unit test for migration backfill and when-strip logic | 340a66d | juggler-backend/tests/unit/placement-mode-migration.test.js |

## What Was Done

### Task 1 — TASK-PROPERTIES.md

- Replaced the old Mode/Trigger/Phase/Behavior table (9 rows including FLEXIBLE, MARKER, RIGID_RECURRING) with a clean 6-row `placement_mode` value table.
- Added a `placement_mode` property row to the "When & Where" section — primary scheduling constraint, written by UI, never server-derived.
- Updated the `When` property row: no longer lists `'fixed'` and `'allday'` as valid tag values; added note that these are expressed via `placement_mode`.
- Updated the `Rigid` property row: notes it is a UI-level toggle within `time_window` mode; scheduler branches on `placement_mode === 'fixed'`, not the `rigid` flag.
- Updated the `Marker` property row: references `placement_mode = 'reminder'` and the `tasks_v` CASE expression.
- Added recurrence-orthogonality note: any mode can be recurring; use the `recurring` flag, not `placement_mode`.

### Task 2 — SCHEDULER.md

- Replaced the 2-bullet "Immovable first" section 4a with a full `placement_mode`-first branching description.
- Each of the 6 new values documented with its `buildItems` treatment.
- Stated that `'fixed'` and `'allday'` tokens are no longer stored in the `when` column after the Phase 9 migration.
- Stated that recurrence is orthogonal to `placement_mode` (`t.recurring` is the flag).
- All old enum names (RECURRING_RIGID, RECURRING_WINDOW, RECURRING_FLEXIBLE, MARKER) removed from the document.

### Task 3 — Unit tests

- `applyBackfill(row)` — pure JS mirror of the SQL CASE expression (priority order 1→6).
- `stripWhenTokens(when)` — mirrors the JS fallback token-strip logic from the migration.
- 14 backfill mapping cases covering all 7 old values → 6 new values.
- 10 when-strip cases covering allday/fixed removal, mixed lists, null input, whitespace.
- All 24 tests pass. No DB connection required.

## Verification Results

```
grep -c "FLEXIBLE|RECURRING_RIGID|..." TASK-PROPERTIES.md → 0  PASS
grep -c "reminder|all_day|time_window|time_blocks|anytime" TASK-PROPERTIES.md → 8  PASS
grep -c "RECURRING_RIGID|RECURRING_WINDOW|RECURRING_FLEXIBLE" SCHEDULER.md → 0  PASS
grep -c "placement_mode" SCHEDULER.md → 9  PASS (required ≥ 6)
jest tests/unit/placement-mode-migration.test.js → 24 passed  PASS
```

## Deviations from Plan

None — plan executed exactly as written. The 24 tests exceed the plan's requirement of 10+ cases (extra coverage added for edge cases: marker priority over allday, whitespace handling, allday+fixed combined strip).

## Known Stubs

None. Documentation is complete and test logic fully mirrors the migration CASE expression.

## Threat Flags

None. Documentation and pure-function test changes introduce no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- `juggler-backend/docs/TASK-PROPERTIES.md` — modified, committed at 60fcd42
- `juggler-backend/docs/SCHEDULER.md` — modified, committed at 091d148
- `juggler-backend/tests/unit/placement-mode-migration.test.js` — created, committed at 340a66d
- All 3 commits confirmed in `git log --oneline -5`
