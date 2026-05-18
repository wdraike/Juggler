---
phase: 11
plan: "01"
subsystem: scheduler, controllers, mcp
tags: [rigid-removal, placementMode, migration, cleanup]
dependency_graph:
  requires: []
  provides: [rigid-free-js-layer]
  affects: [runSchedule.js, cal-sync.controller.js, data.controller.js, task.controller.js, register-plans.js, feature-catalog.controller.js, juggler-mcp/index.js]
tech_stack:
  added: []
  patterns: [placementMode === 'fixed' for fixed-placement checks]
key_files:
  modified:
    - juggler-backend/src/scheduler/runSchedule.js
    - juggler-backend/src/controllers/cal-sync.controller.js
    - juggler-backend/src/controllers/data.controller.js
    - juggler-backend/src/controllers/task.controller.js
    - juggler-backend/src/scripts/register-plans.js
    - juggler-backend/src/controllers/feature-catalog.controller.js
    - juggler-mcp/index.js
    - juggler-backend/tests/taskMapping.test.js
    - juggler-backend/docs/TASK-PROPERTIES.md
decisions:
  - feature-catalog.controller.js key updated from tasks.rigid to tasks.placementMode to stay in sync with register-plans.js feature flag rename
  - SCHEDULER.md conceptual uses of "rigid" as an English adjective left unchanged (not code property references)
metrics:
  duration: "~25 minutes"
  completed: "2026-05-18"
  tasks_completed: 3
  files_changed: 9
---

# Phase 11 Plan 01: Replace rigid with placementMode checks across all JS — Summary

Removed every JavaScript read and write of the `rigid` boolean property, replacing with direct `placementMode === 'fixed'` checks. After plan 02 drops the `rigid` virtual column from the DB view, any remaining JS reading `task.rigid` would receive `undefined` and silently break.

## What Was Done

All six plan-specified files plus one auto-fixed file (`feature-catalog.controller.js`) have zero `rigid` references. Historical DB migration files retain `rigid` column references (correct — the column still exists until plan 02 drops it).

## Files Changed

| File | Change |
|------|--------|
| `juggler-backend/src/scheduler/runSchedule.js` | (1) Chunk copy block: `rigid: master.rigid` → `placementMode: master.placementMode`. (2) Recurring-skip guard: `original.rigid` → `original.placementMode === 'fixed'` with inline comment pointing to PLACEMENT_MODES.FIXED |
| `juggler-backend/src/controllers/cal-sync.controller.js` | Conflict-resolution block: replaced `(task.when\|\|'').indexOf('fixed')>=0 \|\| task.rigid` with `task.placementMode === 'fixed'`; changed `var` to `const` |
| `juggler-backend/src/controllers/data.controller.js` | Export row: `rigid: t.rigid ? 1 : 0` → `placementMode: t.placementMode` |
| `juggler-backend/src/controllers/task.controller.js` | `rowToTask`: removed `rigid: !!row.rigid` entirely |
| `juggler-backend/src/scripts/register-plans.js` | All 5 plan feature blocks: `tasks: { rigid: true }` → `tasks: { placementMode: 'fixed' }` |
| `juggler-backend/src/controllers/feature-catalog.controller.js` | Feature catalog key: `tasks.rigid` → `tasks.placementMode`; type `boolean` → `string`; default value `true` → `'fixed'` (auto-fix: keeps feature key in sync with register-plans.js) |
| `juggler-mcp/index.js` | All 4 zod schema blocks: `rigid: z.boolean().optional()` → `placementMode: z.string().optional()` |
| `juggler-backend/tests/taskMapping.test.js` | Updated `expect(task.rigid).toBe(false)` to `expect(task.placementMode).toBe('anytime')` |
| `juggler-backend/docs/TASK-PROPERTIES.md` | Marked `rigid` row as removed; added note to use `placement_mode === 'fixed'` |

## Test Results

- `taskMapping.test.js`: 8/8 pass (fixed stale `task.rigid` assertion)
- Full suite: same pre-existing failures as before this plan — all `rigid`-related assertions now pass
- Pre-existing failures (unrelated to this change): schedulerIntegration (DB not migrated locally), scheduleQueue, cal-sync MSFT/Apple adapter tests (ECONNREFUSED — no local DB), task-state-machine, taskPipeline

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical sync] Updated feature-catalog.controller.js key**
- **Found during:** Task 2 broad grep
- **Issue:** After renaming `tasks: { rigid: true }` to `tasks: { placementMode: 'fixed' }` in register-plans.js, the corresponding feature catalog key `tasks.rigid` would be orphaned — no plan entry would ever match it
- **Fix:** Updated `feature-catalog.controller.js` key from `tasks.rigid` to `tasks.placementMode`, type from `boolean` to `string`, default value from `true` to `'fixed'`
- **Files modified:** `juggler-backend/src/controllers/feature-catalog.controller.js`
- **Commit:** c4aa5e3

## Commit

`c4aa5e3` — feat(11-01): replace rigid with placementMode checks across all JS

## Self-Check: PASSED
- All 9 modified files confirmed present
- Commit c4aa5e3 verified in git log
- Final grep: 0 `.rigid` references in src (excluding migrations) and juggler-mcp/index.js
