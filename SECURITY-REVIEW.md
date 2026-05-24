# Security Review — task.controller.js + MCP tasks.js

**Scope:** `juggler-backend/src/controllers/task.controller.js`, `juggler-backend/src/mcp/tools/tasks.js`  
**Date:** 2026-05-24  
**Reviewer:** Elmo

---

## Severity Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH     | 11 |

---

## CRITICAL Findings

### C-1 — MCP `delete_task` bypasses provider-origin deletion guard (D-08)

**Location:** `juggler-backend/src/mcp/tools/tasks.js:406-467`

REST `deleteTask` has two layers of protection:
1. Ingest-only mode check (`task.gcal_event_id || task.msft_event_id` + config lookup) — blocks deletion of calendar-linked tasks when sync mode is ingest.
2. Provider-origin block (`cal_sync_ledger` `origin != 'juggler'`) — blocks deletion of ANY externally-ingested task regardless of sync mode (D-08 fix).

MCP `delete_task` reimplements only layer 1, and incompletely:
- It checks `task.gcal_event_id || task.msft_event_id` but **omits `apple_event_id`**.
- It **never queries `cal_sync_ledger`**, so layer 2 is completely absent.

**Exploit:** Any externally-ingested task (Google, Microsoft, or Apple Calendar) can be deleted via MCP even though the REST API explicitly forbids it with error code `PROVIDER_ORIGIN_DELETE_BLOCKED`. Apple Calendar tasks are additionally unprotected in ingest mode.

**Fix:** Add the exact `cal_sync_ledger` origin check from REST `deleteTask` (lines 1360-1376) and include `apple_event_id` in the ingest-mode guard.

---

### C-2 — MCP `batch_update_tasks` commits partial batch on validation failure

**Location:** `juggler-backend/src/mcp/tools/tasks.js:624-686`

Inside the Knex transaction callback, a per-item validation failure returns a plain object:

```js
if (!_txHasDate && !_txHasTime && !_txHasScheduledAt && !existing.scheduled_at) {
  return { content: [{ type: 'text', text: 'Validation error: placementMode "fixed" requires ...' }], isError: true };
}
```

Knex treats any non-throw/non-rejection return from a transaction callback as a **commit**. Because the `return` is inside the `for` loop, all prior updates in the batch are persisted before the error is surfaced.

**Exploit:** Send a batch where item 1-4 are valid writes and item 5 fails placementMode validation. Items 1-4 are silently committed; the caller receives an error and may retry, causing double-application.

**Fix:** Throw an Error (or reject) instead of returning. REST `batchUpdateTasks` already does this correctly via `throw _batchErr`.

---

### C-3 — MCP `set_task_status` bypasses entire status state machine

**Location:** `juggler-backend/src/mcp/tools/tasks.js:365-404`

REST `updateTaskStatus` enforces:
- Whitelist (`VALID_STATUSES`)
- `'missed'` is system-only (403)
- Terminal transitions (`done`/`skip`/`cancel`) require `scheduled_at` (400)
- Disabled tasks cannot change status (403, `TASK_DISABLED`)
- Writes / clears `completed_at` on terminal transitions (Plan C D-12)
- Template status restricted to `pause` / `""`

MCP `set_task_status` does **none** of the above. It accepts any string and writes it raw:

```js
var update = { status: status || '', updated_at: db.fn.now() };
await tasksWrite.updateTaskById(db, id, update, userId);
```

**Exploit:** An MCP client can:
- Set `status: 'missed'` (corrupts cron-owned state)
- Mark an unscheduled task `done` (violates D-15 constraint)
- Change a disabled task's status (bypasses `TASK_DISABLED`)
- Mark a recurring template `done` (corrupts expansion logic)
- Skip `completed_at` write, breaking cal-history Plan C

**Fix:** Route MCP status changes through the exact same logic as REST `updateTaskStatus`, or call `updateTaskStatus` internally.

---

## HIGH Findings

### H-1 — MCP `update_task` missing disabled-task guard

**Location:** `juggler-backend/src/mcp/tools/tasks.js:236-363`

REST `updateTask` (both fast and complex paths) returns 403 for `status === 'disabled'` (`TASK_DISABLED`).

MCP `update_task` never checks `existing.status`. Disabled tasks can be edited freely via MCP.

**Fix:** Reject updates on disabled tasks with the same 403 / `TASK_DISABLED` response.

---

### H-2 — MCP `batch_update_tasks` missing disabled-task guard

**Location:** `juggler-backend/src/mcp/tools/tasks.js:526-691`

Same gap as H-1 but in the batch path. The locked-path loop (`qi`) and the transaction-path loop (`i`) both skip tasks without `id` but never skip `status === 'disabled'`.

**Fix:** Add the disabled check before processing each batch item.

---

### H-3 — MCP `create_task` / `create_tasks` allow recurring tasks with dependencies

**Location:** `juggler-backend/src/mcp/tools/tasks.js:116-163`, `166-233`

REST `createTask` strips `depends_on` for recurring tasks:

```js
if (row.recurring || row.task_type === 'recurring_template' || row.task_type === 'recurring_instance') {
  delete row.depends_on;
}
```

MCP `create_task` and `create_tasks` never do this. The scheduler invariant "recurrings cannot have dependencies" is violated, which can corrupt the dependency graph and scheduler output.

**Fix:** Add the same `delete row.depends_on` guard before insert.

---

### H-4 — REST `updateTask` fast path allows non-recurring -> recurring conversion without clearing dependencies

**Location:** `juggler-backend/src/controllers/task.controller.js:884-1015`

`needsComplexPath` only triggers when `req.body.recurring !== undefined && !req.body.recurring` (turning OFF). Turning a non-recurring task into recurring (`recurring: true`) stays on the fast path. The fast path strips `depends_on` only when `fastExisting.recurring` is already true, so the newly-converted recurring task retains its old dependencies.

**Fix:** Add `req.body.recurring === true` to `needsComplexPath`, or strip `depends_on` whenever `row.recurring` is being set to true.

---

### H-5 — MCP `update_task` / `batch_update_tasks` missing recurrence cleanup on instance edits

**Location:** `juggler-backend/src/mcp/tools/tasks.js:236-363`, `526-691`

REST `updateTask` (complex path, lines 1173-1178) calls `resetRecurringInstances` and `archiveCompletedInstances` when `recur` is changed on an instance. MCP `update_task` routes template fields to the source master but **never resets instances**, leaving stale pending instances that no longer match the new recurrence rule.

**Fix:** After writing template fields in MCP `update_task`, check if `templateUpdate.recur !== undefined` and call `resetRecurringInstances` / `archiveCompletedInstances` exactly as REST does.

---

### H-6 — REST `updateTaskStatus` crashes with `ReferenceError: tz is not defined`

**Location:** `juggler-backend/src/controllers/task.controller.js:1595-1624`

When marking a not-yet-materialized `rc_*` instance as done, the code uses `utcToLocal(source.scheduled_at, tz)` and `localToUtc(..., tz)`, but `tz` is **never declared** in `updateTaskStatus`. This throws an unhandled `ReferenceError`, crashing the request (potential DoS if exploited repeatedly).

**Fix:** Declare `var tz = safeTimezone(req.headers['x-timezone']);` at the top of `updateTaskStatus`, or use the request timezone when materializing.

---

### H-7 — MCP `update_task` / `batch_update_tasks` mishandle time-only and date-only updates

**Location:** `juggler-backend/src/mcp/tools/tasks.js:236-363`, `526-691`

REST `updateTask` complex path preserves existing time when only `date` is sent, and combines existing date when only `time` is sent (`_pendingTimeOnly` logic, lines 1049-1060 and 2107-2118). MCP `update_task` and `batch_update_tasks` do not implement either, so:
- `time`-only updates are ignored (`_pendingTimeOnly` is never processed)
- `date`-only updates reset the stored time to midnight UTC

This silently corrupts scheduled times and causes calendar drift.

**Fix:** Port the `_pendingTimeOnly` and date-only preservation logic from REST `updateTask` into MCP update paths.

---

### H-8 — Unbounded result sets in MCP `list_tasks` and `search_tasks`

**Location:** `juggler-backend/src/mcp/tools/tasks.js:75-114`, `488-524`

`list_tasks`: When `date` is provided, the code fetches **all rows** for the user and filters in JS. No hard limit is applied before the DB query.

`search_tasks`: `limit` is `z.number().optional()` with no maximum. A client can request `limit: 999999`.

**Exploit:** A user with many tasks can cause an MCP call to load the entire working set into memory, exhausting DB connection pool and Node heap.

**Fix:** Add a hard `MAX_LIMIT` (e.g., 500) to both tools, and apply `query.limit(MAX_LIMIT)` unconditionally in `list_tasks`.

---

### H-9 — MCP `create_tasks` batch size unbounded

**Location:** `juggler-backend/src/mcp/tools/tasks.js:166-233`

The Zod schema for `create_tasks` does not specify `.max()` on the `tasks` array. The code performs no length check. A malicious or buggy MCP client can submit an arbitrarily large batch, causing a long-running transaction and scheduler enqueue.

REST `batchCreateTasks` limits to 100 via Zod (`batchCreateSchema`).

**Fix:** Add `.max(100)` to the `tasks` array schema and enforce the same limit as REST.

---

### H-10 — MCP `update_task` cal-sync guard weaker than REST and inconsistent

**Location:** `juggler-backend/src/mcp/tools/tasks.js:236-363`, `526-691`

REST `checkCalSyncEditGuard` uses `cal_sync_origin` (from `cal_sync_ledger`) as the authoritative signal and allows `['status', 'notes', 'datePinned', '_dragPin', '_allowUnfix']`.

MCP implements a parallel guard that:
- Checks `existing.gcal_event_id || existing.msft_event_id || existing.apple_event_id` (view-dependent, not ledger origin)
- Only allows `['status', 'notes']` (stricter but inconsistent)
- Omits `_allowUnfix`, meaning calendar-linked tasks **cannot be unpinned via MCP** even when the user explicitly opts in

If `tasks_with_sync_v` ever returns `null` event IDs for an active ledger row (e.g., Apple Calendar edge case, view staleness), the MCP guard fails open while the REST guard still blocks.

**Fix:** Replace the MCP hand-rolled guard with a direct call to `checkCalSyncEditGuard` (already exported from `task.controller.js`).

---

### H-11 — REST `batchCreateTasks` missing `recurStart` requirement for anchor-dependent patterns

**Location:** `juggler-backend/src/controllers/task.controller.js:1827-1898`

`createTask` sets `_requireRecurStartIfAnchor = true` before calling `validateTaskInput`. `batchCreateTasks` only sets `_requireText = true` and omits `_requireRecurStartIfAnchor`. Anchor-dependent recurrence types (`biweekly`, `interval`, `rolling`) can therefore be created without a `recurStart`, causing the scheduler to drift its anchor to "today" on every run.

**Fix:** Add `_requireRecurStartIfAnchor: true` to the `validateTaskInput` call in `batchCreateTasks`.

---

## Methodology

1. Read both files in full (task.controller.js 2472 lines, tasks.js 694 lines).
2. Cross-referenced every guard in REST against the MCP parallel path.
3. Probed for: IDOR, SQL injection, mass assignment, state-machine bypasses, transaction atomicity, cal-sync guard bypasses, disabled-task bypasses, batch size limits, and unbounded queries.
4. Verified that `user_id` is consistently bound in both REST (`req.user.id`) and MCP (`registerTaskTools` closure), so no horizontal privilege escalation was found.
5. Confirmed `JSON_CONTAINS` and Knex parameterized queries are used correctly — no SQL injection vectors in scope.
