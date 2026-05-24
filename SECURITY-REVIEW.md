# Security Review — Juggler Calendar-Sync Edit Guard

**Scope:** `juggler-backend/src/controllers/task.controller.js`, `juggler-backend/tests/taskCrudIntegration.test.js`  
**Date:** 2026-05-24  
**Branch:** main (juggler submodule)

---

## Severity Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH     | 1 |
| MEDIUM   | 2 |
| LOW      | 0 |

---

## Findings

### HIGH-1 — batchUpdateTasks bypasses calendar-sync edit guard
**Location:** `task.controller.js` — `batchUpdateTasks` (lines 1890-2170)

The new `checkCalSyncEditGuard` is applied to `updateTask` (fast and complex paths) but is **completely absent** from `batchUpdateTasks`. An authenticated user can batch-update an externally-ingested calendar task with disallowed fields (e.g. `text`, `dur`, `scheduledAt`, `when`) and the server will accept the write.

Compounding factor: `batchUpdateTasks` pre-loads existing rows from `tasks_with_sync_v`, which **does not expose `cal_sync_origin`**. Even if the guard call were added, it would return `null` (permit edit) because `existing.cal_sync_origin` is undefined. The view must include the origin column, or the controller must fetch ledger data separately, before the guard can be enforced in the batch path.

**Impact:** Integrity bypass — externally-ingested tasks can be edited in ways that create drift with the provider calendar.

**Remediation:**
1. Add `cal_sync_origin` to `tasks_with_sync_v` (or have `batchUpdateTasks` bulk-fetch ledger rows, mirroring `fetchTasksWithEventIds`).
2. Invoke `checkCalSyncEditGuard(existing, fields)` for every item in the batch, in both the locked and unlocked paths.
3. Reject the entire batch if any item violates the guard, or filter out offending items and return partial-success metadata.

---

### MEDIUM-1 — updateTaskStatus can mutate scheduled_at on externally-ingested tasks
**Location:** `task.controller.js` — `updateTaskStatus` (lines 1558-1803)

`updateTaskStatus` does not call `checkCalSyncEditGuard`. It is semantically a status-only endpoint, but it can side-effect `scheduled_at`:
- `cancel` / `skip` with a future `scheduled_at` snaps it to `db.fn.now()` (line 1726).
- `done` with a custom `completedAt` overwrites `scheduled_at` to that timestamp (lines 1705-1710).

For an externally-ingested task, the policy is "only status and notes can be changed here." Mutating `scheduled_at` violates that policy and causes calendar drift.

**Remediation:** Apply `checkCalSyncEditGuard` in `updateTaskStatus` when the side-effect touches any field other than `status` (and `completed_at`, which is internal bookkeeping). Alternatively, suppress `scheduled_at` mutations when `existing.cal_sync_origin` is a provider origin.

---

### MEDIUM-2 — unpinTask clears date_pinned on externally-ingested tasks
**Location:** `task.controller.js` — `unpinTask` (lines 2300-2334)

`unpinTask` reads from `tasks_with_sync_v` and unconditionally clears `date_pinned: 0` and rewrites `when`. It never calls `checkCalSyncEditGuard`. For an externally-ingested task, this strips the fixed-calendar pinning that keeps the scheduler from moving the event, directly contradicting the cal-sync guard intent.

**Remediation:** Check `cal_sync_origin` (or use `checkCalSyncEditGuard`) before allowing `unpinTask` on provider-origin tasks. If the task is externally-ingested, return `403 CAL_SYNCED_READONLY`.

---

## Other Observations (No Severity)

- **JWT / Auth bypass:** None identified. All task routes are wrapped by `authenticateJWT` and `resolvePlanFeatures`. `tasksWrite.updateTaskById` consistently filters by `user_id`.
- **Injection risks:** None identified. `taskToRow` is a closed allow-list mapper; arbitrary keys in the request body are dropped before DB writes. Knex parameterizes all `whereIn` and `update` calls.
- **Test gap:** The new integration tests cover `updateTask` fast and complex paths, but there are **zero tests** for `batchUpdateTasks` cal-sync guard behavior. A test that sends a blocked field via `PUT /api/tasks/batch` should fail until the bypass is fixed.
