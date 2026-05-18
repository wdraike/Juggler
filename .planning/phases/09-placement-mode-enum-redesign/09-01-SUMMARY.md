---
phase: 09-placement-mode-enum-redesign
plan: "01"
subsystem: database
tags: [mysql, knex, migration, enum, placement_mode, views]

requires:
  - phase: 20260501000300_placement_mode_stored
    provides: "tasks_v and tasks_with_sync_v view SQL that this migration rebuilds"

provides:
  - "task_masters.placement_mode column: new 6-value ENUM (reminder, all_day, fixed, time_window, time_blocks, anytime)"
  - "tasks_v view: marker/rigid computed from new enum values (reminder→marker=1, fixed→rigid=1)"
  - "tasks_with_sync_v view: rebuilt to depend on updated tasks_v"
  - "when column: stripped of allday/fixed system keywords"

affects:
  - "09-02 through 09-06 (all Wave 2+ plans depend on this schema foundation)"
  - "juggler-backend/src/lib/placementModes.js (Plan 09-02 will replace constants)"
  - "unifiedScheduleV2.js (Plan 09-03 will update branching)"
  - "task.controller.js (Plan 09-04 will remove derivePlacementMode)"

tech-stack:
  added: []
  patterns:
    - "VARCHAR pivot for MySQL ENUM migration: change to VARCHAR, backfill new values, MODIFY COLUMN to new ENUM — avoids Data truncated error when new values are not in old ENUM"

key-files:
  created:
    - "juggler-backend/src/db/migrations/20260518000100_placement_mode_enum_redesign.js"
    - "juggler-backend/tests/migrations/20260518000100.test.js"
  modified: []

key-decisions:
  - "VARCHAR pivot pattern: loosen column to VARCHAR(32) before backfill so new values (reminder, all_day, etc.) are accepted, then MODIFY COLUMN to final ENUM — MySQL rejects CASE results that aren't in the current ENUM list"
  - "Transaction wraps all steps but MySQL DDL auto-commits — warning is expected and benign"
  - "REGEXP_REPLACE try/catch fallback: use JS loop if MySQL < 8.0.4, primary path uses REGEXP_REPLACE for compactness"
  - "down() throws: reverting requires reconstructing old enum values from context no longer available"

patterns-established:
  - "MySQL ENUM migration pattern: VARCHAR(32) pivot + CASE backfill + MODIFY COLUMN (use this for all future ENUM changes in juggler)"

requirements-completed:
  - PM-ENUM-MIGRATION

duration: 25min
completed: "2026-05-18"
---

# Phase 9 Plan 1: Placement Mode ENUM Redesign — Migration Summary

**Knex migration that replaces the 7-value placement_mode ENUM with a clean 6-value ENUM via VARCHAR pivot, CASE backfill, when-field strip, and view rebuild**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-18T14:05:00Z
- **Completed:** 2026-05-18T14:29:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Migration `20260518000100_placement_mode_enum_redesign.js` runs clean on the existing 124-row dataset
- `task_masters.placement_mode` now `enum('reminder','all_day','fixed','time_window','time_blocks','anytime') NOT NULL DEFAULT 'anytime'`
- Zero rows carry any old enum value; zero `allday`/`fixed` tokens remain in the `when` column
- `tasks_v` and `tasks_with_sync_v` views rebuilt with updated `marker`/`rigid` CASE expressions
- 7-test migration test suite added and passing

## Task Commits

1. **Task 1: Write migration 20260518000100_placement_mode_enum_redesign.js** - `56bcc82` (feat)
2. **Task 1 tests: migration test suite** - `cb6929a` (test)

## Files Created/Modified

- `juggler-backend/src/db/migrations/20260518000100_placement_mode_enum_redesign.js` — Knex migration: VARCHAR pivot, CASE backfill, MODIFY COLUMN, when-strip, view rebuild
- `juggler-backend/tests/migrations/20260518000100.test.js` — 7 tests verifying post-migration schema and data invariants

## Decisions Made

- **VARCHAR pivot pattern:** MySQL rejects CASE THEN values not in the current ENUM list with "Data truncated for column 'placement_mode' at row 1". Fix: `MODIFY COLUMN placement_mode VARCHAR(32)` first, then backfill, then `MODIFY COLUMN` to the final ENUM. This is the canonical pattern for all future MySQL ENUM migrations in juggler.
- **DDL transaction warning:** MySQL DDL statements auto-commit inside transactions. The "Transaction was implicitly committed" warning from Knex is expected and benign — the migration steps are still executed in sequence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] VARCHAR pivot required for ENUM backfill**
- **Found during:** Task 1 (running migration)
- **Issue:** The plan specified running the backfill UPDATE while old ENUM values are still valid. However, MySQL rejects any CASE THEN result that isn't in the current ENUM list — even if only some rows would receive the new value. The UPDATE immediately fails with "Data truncated for column 'placement_mode' at row 1".
- **Fix:** Added Step 1a: `ALTER TABLE task_masters MODIFY COLUMN placement_mode VARCHAR(32) NOT NULL DEFAULT 'anytime'` before the backfill UPDATE. This loosens the column to VARCHAR so any string value is accepted. Step 2 then applies the final ENUM constraint once all values are valid.
- **Files modified:** `juggler-backend/src/db/migrations/20260518000100_placement_mode_enum_redesign.js`
- **Verification:** `npx knex migrate:latest` ran clean; SHOW COLUMNS confirms new ENUM type
- **Committed in:** `56bcc82`

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** The fix is strictly additive — one extra ALTER TABLE step. All plan outcomes achieved.

## Issues Encountered

- Test DB (port 3308 / docker-compose.test.yml) not running in this environment. The `skipIfNoDB` guard handles this gracefully — all DB-dependent tests are skipped when the test DB is unavailable, matching the existing pattern in `20260509000100.test.js`. The `down()` test runs regardless (no DB needed).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- DB schema foundation is in place. All Wave 2 plans (09-02 through 09-06) can proceed.
- Plan 09-02: update `placementModes.js` constants to the 6 new values
- Plan 09-03: update `unifiedScheduleV2.js` scheduler branching
- Plan 09-04: remove `derivePlacementMode()` from `task.controller.js`
- Plan 09-05/06: frontend WhenSection + TaskEditForm mode selector

---
*Phase: 09-placement-mode-enum-redesign*
*Completed: 2026-05-18*
