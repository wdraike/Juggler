# Code Review — Pre-Commit

Files reviewed:
- `juggler-backend/src/controllers/task.controller.js`
- `juggler-backend/src/mcp/tools/tasks.js`
- `juggler-frontend/src/components/tasks/TaskEditForm.jsx`
- `juggler-frontend/src/components/tasks/sections/WhenSection.jsx`

---

## Critical (6)

### C1 — `updateTaskStatus` references undeclared variable `tz` when materializing `rc_` instances
**File:** `task.controller.js:1609`

`updateTaskStatus` never binds `tz` (no `safeTimezone(req.headers['x-timezone'])` call in that function). When a generated recurring instance (`rc_*`) is materialized on demand, `utcToLocal(source.scheduled_at, tz)` and `localToUtc(localDate, srcTime, tz)` are called with `undefined`, producing incorrect or null `scheduled_at`. This corrupts the instance's placement timestamp at the moment of status change.

**Fix:** Add `var tz = safeTimezone(req.headers['x-timezone']);` at the top of `updateTaskStatus`.

---

### C2 — MCP `set_task_status` missing all terminal-status safeguards and side effects
**File:** `tasks.js:365-403`

The MCP tool is a bare `status` + `updated_at` write. It does **not** implement any of the logic present in API `updateTaskStatus`:
- No rejection of user-supplied `missed`.
- No `SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS` guard (done/skip/cancel without `scheduled_at`).
- No `completed_at` write/clear on terminal transitions.
- No rolling-anchor update for rolling masters.
- No split-chunk sibling propagation.
- No reactivation of `done_frozen` ledger rows.
- No outbound cal-sync trigger on skip/cancel.

An MCP client can silently put tasks into invalid states that the web UI/API cannot.

**Fix:** Reuse the full `updateTaskStatus` implementation (or extract a shared helper) in the MCP tool.

---

### C3 — MCP `delete_task` hard-deletes recurring instances and skips provider-origin guard
**File:** `tasks.js:406-466`

Two parity gaps vs. API `deleteTask`:
1. **Missing soft-delete for recurring instances.** The API detects `task_type === 'recurring_instance'` and soft-deletes (`status='skip'`) to prevent deterministic-ID regeneration zombies. The MCP tool performs a physical `deleteTaskById`, so the instance will respawn on the next scheduler run.
2. **Missing provider-origin block (D-08).** The API blocks deletion of tasks whose `cal_sync_ledger.origin != 'juggler'`. The MCP tool only checks `ingest` mode, allowing an MCP client to destroy a provider-owned task that the API explicitly protects.

**Fix:** Mirror the API's `deleteTask` logic: provider-origin guard first, then type-aware delete (soft-skip for instances, cascade for templates, hard delete for one-offs).

---

### C4 — MCP `batch_update_tasks` never calls `guardFixedCalendarWhen`
**File:** `tasks.js:624-686`

The transaction path for `batch_update_tasks` routes template/instance fields correctly but **omits the calendar-fixed guard entirely**. An MCP batch update can silently clear `date_pinned` on calendar-linked tasks, which the API's single `updateTask` and `batchUpdateTasks` both prevent.

**Fix:** Add `guardFixedCalendarWhen(row, existing, { allowUnfix: !!fields._allowUnfix })` in the per-item loop, with the same template-aware routing used in the API.

---

### C5 — Inconsistent validation limits between Zod schemas and `validateTaskInput`
**File:** `task.controller.js:699-813` vs. `1542-1566`

| Field | Zod limit (batch) | Manual validation (single) |
|-------|-------------------|----------------------------|
| `notes` | `max(10000)` | `> 5000` rejected |
| `dur` | `max(1440)` | any positive number allowed |

A single create/update accepts `dur=2000` and `notes=7500`, but batch create/update rejects them. This produces divergent API behavior depending on which endpoint a client uses.

**Fix:** Align `validateTaskInput` with the Zod schema limits (or centralize on a single validator).

---

### C6 — `cal_sync_ledger` update in `updateTaskStatus` is non-transactional
**File:** `task.controller.js:1731-1734`

When reactivating a terminal task, the code flips ledger rows from `done_frozen` to `active` with a standalone `db(...).update(...)` call. The subsequent `tasksWrite.updateTaskById` at line 1743 is not in the same transaction. If the task update fails after the ledger is flipped, the task remains terminal while its ledger is `active`, causing the next sync run to try to push a stale state to the provider.

**Fix:** Wrap both the ledger flip and the task update in a `db.transaction` block.

---

## Warnings (20)

### W1 — MCP `update_task` calendar-sync guard is stricter than API guard
**File:** `tasks.js:257-264`

The tool blocks every field except `status` and `notes` for calendar-linked tasks. The API `checkCalSyncEditGuard` also permits `datePinned`, `_dragPin`, and `_allowUnfix`. MCP clients cannot perform valid drag-pin or unpin operations on synced tasks.

**Fix:** Import and reuse `checkCalSyncEditGuard` instead of reimplementing a narrower rule.

---

### W2 — MCP calendar-sync guard in batch checks event IDs, ignores `origin`
**File:** `tasks.js:544-566`

`batch_update_tasks` uses `!!(gcal_event_id || msft_event_id || apple_event_id)` to detect calendar-synced tasks. Juggler-originated tasks that are synced *outward* have event IDs but `origin='juggler'`, so the API allows full edits. The MCP tool incorrectly blocks them.

**Fix:** Query `cal_sync_ledger.origin` (or import `checkCalSyncEditGuard`) to respect the same `juggler`-origin exemption.

---

### W3 — MCP tools repeatedly use slow `tasks_with_sync_v` for single-row lookups
**Files:** `tasks.js` (multiple locations)

The API bypasses `tasks_with_sync_v` for single-row reads (using `fetchTaskWithEventIds`, documented as ~100 ms vs ~3000 ms). MCP tools hit the heavy view directly in `create_task:161`, `update_task:251`, `set_task_status:375`, `delete_task:414`, `get_task:478`, and `search_tasks:519`. Under load or for users with large ledgers, these calls are orders of magnitude slower.

**Fix:** Switch MCP tools to `fetchTaskWithEventIds` / `fetchTasksWithEventIds` or a scoped MCP helper equivalent.

---

### W4 — Unguarded `JSON.parse` on user-controlled config value
**Files:** `task.controller.js:689-691`, `tasks.js:184-185`

`applySplitDefault` and MCP batch create parse `user_config.config_value` without a `try/catch`. A malformed string (user corruption, partial write, injection) crashes the request with a `SyntaxError`.

**Fix:** Use `safeParseJSON` (already defined in `task.controller.js`) for config values.

---

### W5 — `rowToTask` mutates its input `row` object
**File:** `task.controller.js:320-328`

The terminal-status clamp writes directly to `row.scheduled_at`. Because objects are passed by reference, any caller that reuses the raw row array later (e.g., batch mapping, caching) sees the mutated value.

**Fix:** Clone `row` before mutating, or return a new object for the clamped `scheduled_at`.

---

### W6 — `takeOwnership` updates template fields on the instance row
**File:** `task.controller.js:2425-2428`

For recurring instances, `when` and `date_pinned` are `TEMPLATE_FIELDS`. `takeOwnership` writes them to the instance row, but `rowToTask` always reads them from the template. The template therefore keeps the old calendar-fixed `when`, and the scheduler continues to treat the task as immovable even after ownership is taken.

**Fix:** If `task_type === 'recurring_instance'`, route the `when`/`date_pinned` clear to the source template instead.

---

### W7 — Frontend offers `years` interval unit that the backend rejects
**File:** `WhenSection.jsx:626`

`<option value="years">year(s)</option>` is present in the UI, but `validateTaskInput` only accepts `days`, `weeks`, `months`. Saving an interval with `years` yields a 400 validation error.

**Fix:** Remove the `years` option from the frontend select, or add `years` to `VALID_RECUR_UNITS`.

---

### W8 — Dead/redundant toggle logic in weekend preset button
**File:** `WhenSection.jsx:519`

The `onClick` handler contains `recurDays === 'SU' || recurDays === 'US' ? 'SU' : 'SU'`, which always evaluates to `'SU'`. The ternary does nothing and misleads readers into thinking it toggles.

**Fix:** Simplify to `onRecurDaysChange('SU')`.

---

### W9 — `updateTaskStatus` rolling anchor likely uses `undefined` instance date
**File:** `task.controller.js:1746-1763`

`existing.date` is referenced, but `existing` comes from `fetchTaskWithEventIds`, which returns raw DB rows. `date` is a derived field produced only by `rowToTask`; it does not exist in the raw row. `_instanceDate` therefore becomes `null`, and `computeRollingAnchor` may fall back to a less accurate anchor.

**Fix:** Derive the instance date from `existing.scheduled_at` via `utcToLocal` before computing the anchor.

---

### W10 — `deleteTask` uses heavy `tasks_with_sync_v` for scoped instance lookups
**File:** `task.controller.js:1393-1395`, `1648`

Both cascade delete and template pause query `tasks_with_sync_v` to enumerate instances. The view's full-ledger GROUP BY is unnecessary when the caller already knows the `source_id` and can query `task_instances` directly.

**Fix:** Use `trx('task_instances').where({ master_id: templateId, user_id: ... })` for instance enumeration.

---

### W11 — Silent `.catch` swallowing on ledger updates during destructive deletes
**File:** `task.controller.js:1415-1416`, `1517`

If the `cal_sync_ledger` update fails (connection drop, deadlock), the error is logged and ignored. The code proceeds to delete the task, leaving active ledger rows pointing to a deleted task. The next sync pull may recreate the task from the still-existing provider event.

**Fix:** Let ledger errors propagate and abort the transaction.

---

### W12 — `syncController.sync` called with incomplete mock `req` object
**File:** `task.controller.js:1804-1806`

The fire-and-forget cal-sync trigger constructs a stub `req = { user: { id: req.user.id }, body: {} }`. If `cal-sync.controller.js` ever accesses `req.query`, `req.headers`, or other Express properties without guards, it will throw at runtime.

**Fix:** Pass a more complete mock or extract a shared `enqueueCalSync(userId)` helper that does not rely on Express req/res.

---

### W13 — `require` inside transaction hot path
**File:** `task.controller.js:1226`

`var _dateHelpers = require('../scheduler/dateHelpers');` is executed inside an `else` branch of a template update transaction. Moving it to module top level avoids a synchronous filesystem hit during the transaction.

**Fix:** Hoist the require to the top of the file.

---

### W14 — `buildChangedFields` compares `placementMode` against live prop, not snapshot
**File:** `TaskEditForm.jsx:449`

```javascript
var snapPlacementMode = task ? (task.placementMode || 'anytime') : 'anytime';
if (placementMode !== snapPlacementMode) changed.placementMode = all.placementMode;
```

`snapPlacementMode` reads from the current `task` prop rather than `taskSnapshotRef.current`. If the scheduler/backend changes `placementMode` while the form is open, the snapshot is never updated for that field, and the next save may spuriously include `placementMode` even though the user did not touch it.

**Fix:** Store `placementMode` in `snapshotFromTask` and compare against the snapshot.

---

### W15 — Fast-path `updateTask` optimistic response omits `sourceMap` for recurring instances
**File:** `task.controller.js:1012-1014`

```javascript
return res.json({ task: rowToTask(optimistic, null) });
```

For a recurring instance edit that hits the fast path, `rowToTask` receives no `sourceMap`. The response will show empty template-inherited fields (text, dur, pri, etc.) until the next full fetch.

**Fix:** Build `srcMap` from a quick `tasks_v` template query and pass it to `rowToTask`.

---

### W16 — `task.controller.js` line 524-532: explicit `desiredAt: null` suppresses `scheduledAt` fallback
**File:** `task.controller.js:524-532`

If a caller sends `{ desiredAt: null, scheduledAt: "2026-03-10T14:00:00Z" }`, `taskToRow` sets `desired_at = null` and does **not** copy `scheduled_at` into `desired_at`. This is semantically correct (caller explicitly nulled intent), but it is surprising and can leave `desired_at` null on a fully scheduled task. Downstream consumers may assume `desired_at` is always non-null when `scheduled_at` is present.

**Fix:** Document the precedence rule in the function JSDoc, or decide whether `null` should be treated as "clear" vs "use scheduled".

---

### W17 — `batchUpdateTasks` locked path reuses variable name `idsToCheck` inside block scope
**File:** `task.controller.js:1939`, `1976`

`var idsToCheck` is declared in the outer scope (line 1939) and then again with `var` inside the `if (locked)` block (line 1976). `var` hoisting makes this shadowing confusing and error-prone during refactors.

**Fix:** Rename the inner variable or remove the redundant declaration.

---

### W18 — `createTask` does not handle `_pendingTimeOnly`
**File:** `task.controller.js:816-879`

`taskToRow` sets `row._pendingTimeOnly` when only `time` is provided without `date`. The `createTask` function never reads this key, so a creation request with `time` but no `date` leaves `scheduled_at` undefined. The frontend likely always sends `date` with `time`, but the API contract does not guarantee it.

**Fix:** Either reject `time`-only creates in `validateTaskInput`, or resolve `_pendingTimeOnly` in `createTask` (e.g., default to today).

---

### W19 — `WhenSection` `recurDays` string manipulation uses `replace` without global flag
**File:** `WhenSection.jsx:527`

```javascript
onRecurDaysChange(active ? (recurDays || '').replace(code, '') : (recurDays || '') + code);
```

`String.prototype.replace(string, '')` replaces only the **first** occurrence. Because day codes are single unique characters, this is harmless today. If a code were ever multi-character (e.g., `Sa`), `replace('Sa', '')` would only hit the first one and could leave duplicates.

**Fix:** Use `replaceAll` or `split(...).filter(...).join('')` for robustness.

---

### W20 — `get_task` MCP tool builds source map from all tasks instead of templates only
**File:** `tasks.js:478-479`

```javascript
var rows = await db('tasks_v').where('user_id', userId);
var srcMap = buildSourceMap(rows);
```

`get_task` loads **every** task row for the user into memory just to build a source map for one task. For large users this is an unnecessary memory/CPU spike.

**Fix:** Query only `task_type='recurring_template'` rows (or those with `recurring=1`) to build the map.

---

## Counts

| Severity | Count |
|----------|-------|
| Critical | 6 |
| Warning  | 20 |
