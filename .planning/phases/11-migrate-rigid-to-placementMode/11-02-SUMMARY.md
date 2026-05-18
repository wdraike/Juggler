---
phase: 11
plan: "02"
subsystem: database, views, migrations
tags: [rigid-removal, views, migration, knex]
dependency_graph:
  requires: [rigid-free-js-layer]
  provides: [rigid-free-db-view]
  affects: [tasks_v, tasks_with_sync_v]
tech_stack:
  added: []
  patterns: [Knex migration with DROP VIEW + CREATE VIEW in transaction]
key_files:
  created:
    - juggler-backend/src/db/migrations/20260518000200_drop_rigid_from_views.js
decisions:
  - down() throws intentional-regression error — re-adding rigid would regress the migration work
  - tasks_with_sync_v recreated verbatim (minus v.rigid in SELECT) rather than altered, to stay in sync with view baseline
metrics:
  duration: "~15 minutes"
  completed: "2026-05-18"
  tasks_completed: 2
  files_changed: 1
---

# Phase 11 Plan 02: Drop rigid from tasks_v and tasks_with_sync_v views — Summary

Knex migration that removes the `rigid` virtual column from both `tasks_v` and `tasks_with_sync_v`. The `rigid` alias (`CASE WHEN m.placement_mode = 'fixed' THEN 1 ELSE 0 END AS rigid`) appeared in both UNION branches of `tasks_v` and was referenced by name in `tasks_with_sync_v`'s SELECT list. After plan 01 removed all JS consumers, the column was dead weight.

## What Was Done

Created migration `20260518000200_drop_rigid_from_views.js`. The migration:

1. Drops `tasks_with_sync_v` then `tasks_v` (dependency order)
2. Recreates `tasks_v` — both UNION arms stripped of the `rigid` CASE line; trailing commas fixed
3. Recreates `tasks_with_sync_v` — `v.rigid` removed from SELECT list; all other columns preserved
4. Runs entirely in a Knex transaction; `down()` throws an intentional-regression error

## Verification Results

**Rigid column gone:**
```
PASS — rigid column not found in tasks_v
```
(`SELECT rigid FROM tasks_v` throws `Unknown column 'rigid' in 'field list'`)

**Surviving columns intact:**
```
tasks_v columns intact: [
  {"marker":0,"placement_mode":"time_blocks"},
  {"marker":0,"placement_mode":"time_window"},
  {"marker":0,"placement_mode":"time_blocks"}
]
```

**viewShape integration test (7/7):**
```
PASS tests/viewShape.integration.test.js
  tasks_v shape — by row class
    ✓ recurring template row: task_type=recurring_template, scheduled_at=NULL, source_id=NULL
    ✓ non-recurring row: master+instance merged, task_type=task
    ✓ recurring instance: task_type=recurring_instance, source_id=template.id
    ✓ detached instance: master deleted, instance becomes invisible in tasks_v
    ✓ persistent split chunks: split_ordinal 1..N and split_total surface in view
  tasks_with_sync_v — provider event ids from ledger
    ✓ returns gcal_event_id from active ledger entry, msft/apple null if no entry
    ✓ inactive ledger entries do NOT show up in the view
```

## Test Results

Full test suite: no `rigid`-related failures. Zero `rigid` references appear in any failing test output.

Pre-existing failures (unrelated to this plan — identical to plan 01 baseline):
- `schedulerIntegration` — tries to insert old `flexible` enum value; phase-09 migration not applied to local test DB
- `scheduleQueue` — ECONNREFUSED 127.0.0.1:3308 (no local second DB)
- `cal-sync/02-adapter-msft`, `05-adapter-msft-edge`, `06-adapter-apple-edge`, `22-sync-error-paths`, `21-sync-auth-errors`, `23-sync-consistency` — ECONNREFUSED, no local creds
- `api/task-state-machine`, `taskPipeline`, `api/config` — pre-existing environment failures

## Deviations from Plan

None — plan executed exactly as written.

## Commit

`7228528` — feat(11-02): drop rigid from tasks_v and tasks_with_sync_v views

## Self-Check: PASSED
- Migration file confirmed present: `juggler-backend/src/db/migrations/20260518000200_drop_rigid_from_views.js`
- Commit 7228528 verified in git log
- `SELECT rigid FROM tasks_v` confirmed throws Unknown column
- `marker` and `placement_mode` columns confirmed present and returning data
- viewShape integration test: 7/7 pass
