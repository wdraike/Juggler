---
phase: 12
plan: "02"
subsystem: juggler-backend/db
tags: [migration, schema, cleanup, views]
dependency_graph:
  requires: [12-01]
  provides: [clean-task_masters-schema]
  affects: [task_masters, tasks_v, tasks_with_sync_v]
tech_stack:
  added: []
  patterns: [idempotent-DDL-via-schema-inspection, no-transaction-DDL-MySQL]
key_files:
  created:
    - juggler-backend/src/db/migrations/20260518000300_drop_preferred_time_column.js
  modified:
    - .planning/ROADMAP.md
decisions:
  - "No transaction wrapper: MySQL DDL auto-commits; knex.transaction() with DDL throws knex #805 warning and produces unpredictable rollback behavior"
  - "Idempotent column drop via SHOW COLUMNS inspection rather than DROP COLUMN IF EXISTS (not supported in MySQL 8.0.44-google)"
  - "View SQL copied verbatim from 20260518000200 — preferred_time never appeared in views, only preferred_time_mins"
metrics:
  duration: "~16 minutes"
  completed: "2026-05-18"
  tasks_completed: 2
  files_changed: 2
---

# Phase 12 Plan 02: Drop preferred_time Column from task_masters Summary

Drops the `preferred_time` boolean column from `task_masters` and rebuilds both views. Schema is now clean: only `preferred_time_mins` (the canonical int field) remains.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Write migration 20260518000300 | 30fb020 | juggler-backend/src/db/migrations/20260518000300_drop_preferred_time_column.js |
| 2 | Run tests + mark ROADMAP Complete | 30fb020 | .planning/ROADMAP.md |

## Verification Results

```
preferred_time gone:          PASS  (SHOW COLUMNS returns 0 rows)
preferred_time_mins intact:   PASS  (SHOW COLUMNS returns 1 row)
tasks_v queryable:            PASS
tasks_with_sync_v queryable:  PASS
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] No transaction wrapper (MySQL DDL constraint)**
- **Found during:** Task 1
- **Issue:** Plan specified `knex.transaction(async (trx) => { ... })` wrapper, but MySQL DDL (ALTER TABLE, CREATE/DROP VIEW) issues an implicit COMMIT and cannot participate in transactions. Wrapping DDL in a knex transaction triggers knex issue #805 and makes the migration unpredictable.
- **Fix:** Removed transaction wrapper; steps execute sequentially at the top level of `exports.up`.
- **Files modified:** 20260518000300_drop_preferred_time_column.js
- **Commit:** 30fb020

**2. [Rule 1 - Bug] Idempotent column drop (dev DB already clean)**
- **Found during:** Task 1
- **Issue:** Dev DB already had `preferred_time` absent (column was cleaned manually or by a prior migration attempt). `ALTER TABLE task_masters DROP COLUMN preferred_time` fails with "Can't DROP 'preferred_time'; check that column/key exists".
- **Fix:** Added `SHOW COLUMNS FROM task_masters LIKE 'preferred_time'` guard before the ALTER TABLE. `DROP COLUMN IF EXISTS` syntax was tried first but MySQL 8.0.44-google rejected it (syntax error), so schema inspection was used instead.
- **Files modified:** 20260518000300_drop_preferred_time_column.js
- **Commit:** 30fb020

## Test Results

Pre-existing failures (confirmed by running test suite without migration): schedulerIntegration, taskPipeline (1 test re: preferred_time_mins scheduling logic), cal-sync adapter suites (require external services). No new failures introduced by this migration.

## Known Stubs

None.

## Threat Flags

None — migration removes a column, introduces no new surface.

## Self-Check: PASSED

- [x] Migration file exists: juggler-backend/src/db/migrations/20260518000300_drop_preferred_time_column.js
- [x] Commit 30fb020 exists in git log
- [x] ROADMAP.md phase 12 Status: Complete
- [x] DB verification: all 4 checks PASS
