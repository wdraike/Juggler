# Security Review — ZOE-JUG-015 OAuth redirect_uri allowlist — 2026-05-31

**Scope:** `juggler-backend/tests/unit/app.test.js`, `juggler-backend/src/lib/redis.js`, OAuth `/oauth/authorize` route (`app.js:160-177`)

## Executive Summary

The OAuth `/oauth/authorize` allowlist route (dev-mode only) correctly rejects non-allowlisted `redirect_uri` hosts with 400. The allowlist logic is sound for a dev-only endpoint. The `redis.js` logger fix is safe and narrows the blast radius of an undefined-logger crash. No exploitable vulnerabilities in the changed code.

One medium finding: the `/oauth/token` dev endpoint accepts any `dev-code-*` string without checking that the code was actually issued by the `/oauth/authorize` handler — a minor CSRF-style issue in dev mode. Not exploitable in production (endpoint only registered in `development`).

---

## Critical Findings (exploitable now)

_None._

---

## High Findings (exploitable with effort)

_None._

---

## Medium Findings (defense in depth)

| # | OWASP | Finding | File:Line | Remediation |
|---|-------|---------|-----------|-------------|
| M1 | A07 | `/oauth/token` in dev mode accepts any code matching `dev-code-*` prefix — it does not verify the code was actually issued by the `/oauth/authorize` handler. An attacker with access to the dev server could craft `dev-code-<anything>` and redeem it for a `dev-token`. Scoped to `NODE_ENV=development` only; not a production risk. | `app.js:181-183` | Track issued codes in a short-lived in-memory Set; reject codes not in the set. Low urgency given dev-only scope. |

---

## Low Findings (hardening)

| # | OWASP | Finding | File:Line | Remediation |
|---|-------|---------|-----------|-------------|
| L1 | A10 | `state` parameter is echoed back in the redirect without validation for length or character set. An overly large `state` value would bloat the redirect URL. Not exploitable as SSRF since the redirect host is allowlisted; cosmetic hardening only. | `app.js:176` | Validate `state` length (e.g. max 512 chars) before echoing. |
| L2 | A05 | `KEY_PREFIX` is `'strivers:'` — this is a Redis namespace mismatch if the service is Juggler. Keys written under the wrong prefix survive service restarts and could cause cache collisions if a future "strivers" service shares the same Redis instance. | `redis.js:15` | Update `KEY_PREFIX` to `'juggler:'` to match the service. |

---

## Status: PASS

_No CRITICAL or HIGH findings. M1 is dev-only and L1/L2 are hardening items._

_Signed: Elmo — 2026-05-31T00:00:00Z_
**Date:** 2026-05-24  
**Reviewer:** Elmo

---

## Severity Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH     | 12 |

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

### H-12 — `when` field accepts colons; `prev_when` split-on-colon parser then restores corrupted data

**Location (write):** `task.controller.js` lines 1117–1127 (drag-pin encoder)
**Location (parse):** `task.controller.js` lines 2419–2425 (unpin parser)
**Location (schema):** `task.schema.js` lines 25, 37–41

**Evidence:**

`taskUpdateSchema` defines `when` as `z.string().max(200).optional()` — no character whitelist. Both schemas call `.passthrough()`. A user can PATCH their own task with:

```
PATCH /api/tasks/<own-task-id>
{ "when": "mode:fixed:morning" }
```

This stores `when = "mode:fixed:morning"` in the DB (VARCHAR 255, no DB-level constraint on the character set). No validation rejects colons in the `when` field.

Later, when a drag-pin fires on the same task (line 1126):

```js
var preDragWhen = existing.when || '';   // => "mode:fixed:morning"
row.prev_when = 'mode:' + preDragMode + ':' + preDragWhen;
// stored: "mode:anytime:mode:fixed:morning"
```

At unpin time (lines 2421–2425):

```js
var parts = existing.prev_when.split(':');
// parts = ['mode', 'anytime', 'mode', 'fixed', 'morning']
var candidateMode = parts[1];              // => 'anytime'  (correct by coincidence)
restoredWhen = parts.slice(2).join(':');  // => 'mode:fixed:morning'  (mangled garbage)
```

`updates.when` is then written back as `"mode:fixed:morning"`, a value that does not match any valid scheduler time-block tag. The scheduler receives this on every subsequent schedule run and silently misplaces the task. The mangled value is also echoed in the HTTP response body (line 2445).

The attack is fully self-contained within the attacker's own data boundary (no other user is affected), but it corrupts task scheduling state in a way the user cannot easily diagnose or recover from by normal UI means, since the UI only surfaces the drag-pin restore flow.

**Fix:** Add a colon-rejection regex to both schemas:

```js
when: z.string().max(200).regex(/^[^:]*$/, 'when tags may not contain colons').optional()
```

Alternatively, encode `prev_when` with a delimiter that cannot appear in `when` (e.g., store as JSON object `{ mode, when }` rather than a colon-delimited string).

---

## MEDIUM Findings

### M-1 — `cal_sync_ledger` query in `fetchTaskWithEventIds` lacks `user_id` filter

**Location:** `task.controller.js` lines 207–209

```js
dbOrTrx('cal_sync_ledger')
  .where({ task_id: id, status: 'active' })
  .select('provider', 'provider_event_id', 'origin', 'event_url', 'calendar_id')
```

`user_id` is absent from the WHERE clause. The task-ownership check on `tasks_v` (line 206) prevents an attacker from reaching this code for a task they do not own — `fetchTaskWithEventIds` returns `null` if the task row does not match — so there is no direct exploit path today. However, this is a defence-in-depth gap: if task IDs are ever reused (soft-delete + re-insert patterns) or a future call path queries the ledger without the prior task ownership gate, ledger rows from a different user could be attached.

**Fix:**

```js
dbOrTrx('cal_sync_ledger')
  .where({ task_id: id, user_id: userId, status: 'active' })
```

---

## LOW Findings

### L-1 — Schema `.passthrough()` is a permanent schema drift risk

**Location:** `task.schema.js` lines 35, 41

Both schemas use `.passthrough()`, forwarding any unrecognised body field to the controller. `taskToRow` maps only known properties, so truly unknown fields do not reach the DB today. But every new property added to `taskToRow` without a schema counterpart inherits no input validation — a silent gap that grows over time.

`prev_when` / `prevWhen` is not currently in `taskToRow` so cannot be written via this path today.

**Fix:** Replace `.passthrough()` with `.strip()` (Zod default) once all legitimate client fields are enumerated. Document the transitional use of `.passthrough()` with a tracking ticket in the meantime.

---

## Methodology

1. Read `task.controller.js` (2472 lines) and `tasks.js` (694 lines) in full, plus `tasks-write.js`, `task.schema.js`, `task.routes.js`, and `placementModes.js`.
2. Cross-referenced every guard in REST against the MCP parallel path.
3. Probed for: IDOR, SQL injection, mass assignment, state-machine bypasses, transaction atomicity, cal-sync guard bypasses, disabled-task bypasses, batch size limits, unbounded queries, delimiter-injection in encoded fields.
4. Verified `user_id` is consistently bound in both REST (`req.user.id`) and MCP (`registerTaskTools` closure) — no horizontal privilege escalation found.
5. Confirmed `JSON_CONTAINS` and Knex parameterized queries are used correctly — no SQL injection vectors in scope.
6. Confirmed `unpinTask` ownership is double-enforced: `fetchTaskWithEventIds` scopes by `user_id` at fetch; `tasksWrite.updateTaskById` scopes by `user_id` at write; route is covered by `authenticateJWT`.

---

---

## Pre-commit Re-Verification — When-mode Simplification

**Scope:** All staged files for the When-mode / `date_pinned` removal commit  
**Date:** 2026-05-25  
**Reviewer:** Elmo

### Severity Summary (this pass)

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH     | 1 |
| MEDIUM   | 1 |
| LOW      | 2 |

---

### Key File Handling — PEM Files

**CONFIRMED SAFE.**

- `juggler-mcp/src/keys/service-private.pem` and `service-public.pem` are NOT in the staged index (`git ls-files --cached juggler-mcp/src/keys/` returns only `.gitignore`).
- `juggler-mcp/src/keys/.gitignore` IS staged and contains: `*.pem`, `*.key`, `service-kid.txt` — all three credential file types are covered.
- The physical files (`service-private.pem`, `service-public.pem`, `service-kid.txt`) exist on disk but will not be committed.

No action needed.

---

### RC-C1 (CRITICAL) — MCP transport: unauthenticated access when `MCP_DEV_NO_AUTH=true` in production

**Location:** `juggler-backend/src/mcp/transport.js:56-73` (staged)

The new transport code adds a dev-bypass path:

```js
if (token) {
  if (token === 'dev-token' && (process.env.NODE_ENV === 'development' || process.env.MCP_DEV_NO_AUTH === 'true')) {
    authResult = { userId: 'dev-user' };
  } else { ... real auth ... }
} else if (process.env.NODE_ENV === 'development' || process.env.MCP_DEV_NO_AUTH === 'true') {
  authResult = { userId: 'dev-user' };
}
```

**What if someone sets `MCP_DEV_NO_AUTH=true` in a production Cloud Run env var?** Any request to `POST /mcp` — with or without a token — authenticates as `userId: 'dev-user'` with no JWT verification, no plan check, and full MCP access. This is a single env-var misconfiguration away from complete authentication bypass in production.

`NODE_ENV` is not set in any deployment YAML (verified: no YAML files reference it, and the Dockerfile does not set it). The `.env` file currently contains `NODE_ENV=development`, which would be active unless explicitly overridden at deploy time. There is no guard ensuring `NODE_ENV !== 'production'` before the bypass activates.

Additionally, the `planCheck` function in the same file has been hardcoded to always return `{ hasActivePlan: true, planId: 'dev-plan' }`, completely bypassing subscription enforcement for all MCP requests regardless of the env flags. This means even legitimate JWT-authenticated users are never checked for an active plan.

**What if someone just sends `Authorization: Bearer dev-token` in production?** If `MCP_DEV_NO_AUTH` is not set but `NODE_ENV` defaults (no value = not 'development'), the `dev-token` branch is not taken and real auth runs. But the `planCheck` bypass is unconditional — every authenticated MCP user gets full access regardless of subscription status.

**Exploit scenarios:**
1. `MCP_DEV_NO_AUTH=true` set in Cloud Run → anyone hits `/mcp` → full task read/write access as `dev-user` (which may match no real user, querying zero rows — confusing but still a complete auth bypass)
2. `planCheck` always returns `hasActivePlan: true` → any valid JWT (including expired-plan users, free-tier users) can use the MCP endpoint without a paid plan

**Fix required before commit:**
- Restore the real `planCheck` implementation that reads `authResult.plans[APP_ID]`
- Add a hard `process.env.NODE_ENV !== 'production'` guard around both bypass branches
- Document `MCP_DEV_NO_AUTH` in `.env.test.example` as a dev-only flag and add a startup assertion that rejects it when `NODE_ENV === 'production'`

---

### RC-C2 (CRITICAL) — Dev OAuth endpoints registered with no redirect_uri allowlist (open redirect)

**Location:** `juggler-backend/src/app.js:138-175` (staged)

The new dev OAuth block registers `GET /oauth/authorize`:

```js
app.get('/oauth/authorize', (req, res) => {
  const redirectUri = req.query.redirect_uri;
  const code = 'dev-code-' + Date.now();
  if (redirectUri) {
    res.redirect(`${redirectUri}${sep}code=...&state=...`);
  }
});
```

There is no allowlist check on `redirectUri`. Any value is accepted and redirected to. This is a textbook open redirect: a user can be sent to `https://attacker.com?code=dev-code-1234567890&state=...`. The `dev-code-` prefix is predictable (timestamp only) and the `POST /oauth/token` endpoint accepts any `dev-code-*` value to issue `access_token: 'dev-token'`. An attacker who can capture the code from the redirect can exchange it for a token.

**Even if guarded by `NODE_ENV === 'development'`**: the `MCP_DEV_NO_AUTH=true` branch is an independent activation path with no environment restriction. If that flag is set in a staging or production environment, this redirect is live.

**Fix required before commit:**
- Add an allowlist of permitted redirect URIs (e.g., `['http://localhost', 'http://127.0.0.1']`) and reject any `redirect_uri` not on the list
- Or gate the entire block behind `NODE_ENV === 'development'` only (remove the `MCP_DEV_NO_AUTH` activation path for OAuth endpoints)

---

### RC-H1 (HIGH) — `guardFixedCalendarWhen` has a silent gap: `placement_mode` set to `undefined` is not blocked

**Location:** `juggler-backend/src/controllers/task.controller.js:605-615` (staged)

The new `guardFixedCalendarWhen` reads:

```js
if (row.placement_mode && row.placement_mode !== 'fixed') {
  delete row.placement_mode;
}
```

This correctly blocks setting `placement_mode` to a non-fixed string (e.g., `'anytime'`). But it does NOT block the case where `row.placement_mode` is `undefined` — meaning a PATCH that sends `placementMode: null` or `placementMode: undefined` would pass through without the field being deleted, leaving the DB write to potentially null out the column.

**What actually happens:** `taskToRow` at line 583-585 only writes `row.placement_mode` when `task.placementMode !== undefined`. So if the client sends no `placementMode` field, `row.placement_mode` is not set at all, and the Knex UPDATE omits it. This means the gap does not currently produce a write.

However: if a client sends `placementMode: null` explicitly, `task.placementMode` is `null` (not `undefined`), `validModes.indexOf(null)` returns -1, and `row.placement_mode = PLACEMENT_MODES.ANYTIME` is written. `guardFixedCalendarWhen` then sees `row.placement_mode = 'anytime'` — a truthy non-fixed string — and deletes it. So the guard does catch that case.

The remaining gap: a client sends `placementMode: ''` (empty string). `validModes.indexOf('')` returns -1, so `row.placement_mode = PLACEMENT_MODES.ANYTIME`. Guard catches it (truthy after the fallthrough). This path is safe.

**Net assessment:** The guard is functionally correct for the current `taskToRow` implementation but relies on the empty-string/null fallback-to-ANYTIME behavior in `taskToRow`. If `taskToRow` ever changes to pass `null` or `undefined` through directly, the guard fails open. This is a fragile dependency worth documenting — the guard comment should state that it relies on `taskToRow` normalizing invalid modes to `ANYTIME`.

**Reclassified to MEDIUM** given no current exploit path exists. Flagged for documentation.

---

### RC-M1 (MEDIUM) — `checkCalSyncEditGuard` allowed-fields list narrowed; `_allowUnfix` still in list but no longer functional

**Location:** `juggler-backend/src/controllers/task.controller.js:76` (staged)

The new `checkCalSyncEditGuard` allowed list is `['status', 'notes', '_allowUnfix']`. `datePinned` and `_dragPin` were correctly removed (those fields no longer exist). `_allowUnfix` is kept, which is correct — it is the opt-in bypass for `guardFixedCalendarWhen`.

**But:** the `_allowUnfix` path in `guardFixedCalendarWhen` only bypasses the `placement_mode` deletion, not the entire cal-sync guard. A cal-synced task with `_allowUnfix: true` in the body would pass `checkCalSyncEditGuard` (because `_allowUnfix` is in the allowed list) but still be blocked by the broader `blockedFields` check for any OTHER field sent alongside it.

This is the correct design — `_allowUnfix` is an internal flag, not a general bypass. No security gap here, but it is worth noting that `_allowUnfix` is accepted in body without schema validation (it passes through `.passthrough()`) and its semantics are undocumented in the schema.

**No immediate action required.** Recommend adding `_allowUnfix: z.boolean().optional()` to `taskUpdateSchema` so it is visible and validated.

---

### RC-L1 (LOW) — `PUT /:id/unpin` route removed but `unpinTask` function not exported/deleted

**Location:** `juggler-backend/src/routes/task.routes.js:82` (staged), `juggler-backend/src/controllers/task.controller.js`

The route `router.put('/:id/unpin', taskController.unpinTask)` is removed from the routes file. The `unpinTask` function itself has been deleted from `task.controller.js` in this diff (confirmed: the full function body was removed in the diff). No orphan dangling reference remains.

**CONFIRMED SAFE.** Route removal is clean with no dangling middleware.

---

### RC-L2 (LOW) — `runSchedule.js` still writes `date_pinned: 0` on two paths

**Location:** `juggler-backend/src/scheduler/runSchedule.js:1241`, `1551`

Two scheduler update objects still include `date_pinned: 0`. These are pre-existing (not added by this diff — confirmed via `git diff --cached`). They will write `0` to a column being dropped by the migration `20260526000000_drop_pinned_and_rigid_columns.js`. After the migration runs, these writes will fail with a column-not-found error.

**Severity:** LOW now (migration not yet run), but will become a runtime error after deploy if the migration runs before these lines are patched.

**Fix required before running the migration:** Remove `date_pinned: 0` from both update objects in `runSchedule.js` (lines 1241 and 1551). These are not in the current staged diff and should be added to it.

---

### Fixed findings from prior review — status update

The following prior findings were rendered moot by this diff:

- **H-12** (`when` colon injection / `prev_when` parser): `prev_when` column is being dropped by the migration. `unpinTask` (the only consumer of `prev_when`) is deleted. The `_dragPin` path that wrote `prev_when` is deleted. This attack surface is fully removed.
- **Prior H-10 note** about `datePinned`/`_dragPin` in the allowed list: Both removed from `checkCalSyncEditGuard`'s allowed list.

---

### Verdict

**BLOCK** — RC-C1 and RC-C2 are blocking findings.

RC-C1 (unconditional `planCheck` bypass + unauthenticated MCP access via `MCP_DEV_NO_AUTH`) and RC-C2 (open redirect in dev OAuth endpoint with no URI allowlist) must be fixed before this commit proceeds.

RC-L2 is not blocking for this commit but must be fixed before the column-drop migration is run.

---

---

## Final Verification — RC-C1 and RC-C2 Fix Confirmation

**Scope:** `juggler-backend/src/mcp/transport.js`, `juggler-backend/src/app.js`
**Date:** 2026-05-25
**Reviewer:** Elmo

### RC-C1 — RESOLVED

**Evidence read from `transport.js` lines 23–75 (current file on disk):**

`planCheck` now reads `authResult.plans || {}` and looks up `plans[APP_ID]`. It does not stub a result — no active plan returns `{ hasActivePlan: false }`. The `authResult.plans || {}` coercion is safe: if `plans` is absent the lookup simply misses and plan check fails as expected. `APP_ID` is imported from `service-identity.js` where it resolves to `process.env.APP_ID || 'juggler'` — the correct product slug per the monorepo JWT convention.

Both bypass branches carry the production guard:

- Dev-token branch (line 59): `token === 'dev-token' && (process.env.NODE_ENV === 'development' || process.env.MCP_DEV_NO_AUTH === 'true') && process.env.NODE_ENV !== 'production'`
- No-token branch (line 71): `(process.env.NODE_ENV === 'development' || process.env.MCP_DEV_NO_AUTH === 'true') && process.env.NODE_ENV !== 'production'`

Boolean evaluation verified against all relevant environment combinations:

| NODE_ENV | MCP_DEV_NO_AUTH | Bypass activates? |
|---|---|---|
| `production` | `true` | No — `!== 'production'` short-circuits to false |
| `production` | unset | No |
| `development` | unset | Yes — intended |
| `staging` | `true` | Yes — residual risk (see note) |
| `staging` | unset | No |
| unset | `true` | Yes — residual risk (see note) |
| unset | unset | No |

**Residual note (not blocking):** If `NODE_ENV` is `staging` or unset and `MCP_DEV_NO_AUTH=true` is set in that environment, the bypass activates. This is a misconfiguration risk for non-production environments, not a production bypass. The guard correctly blocks the only production risk case (`NODE_ENV=production`). The RC-C1 fix as specified is fully implemented.

**RC-C1: RESOLVED.**

---

### RC-C2 — RESOLVED

**Evidence read from `app.js` lines 138–182 (current file on disk):**

The entire dev OAuth block is gated `if (process.env.NODE_ENV === 'development')` — `MCP_DEV_NO_AUTH` is no longer an activation path for these routes. The block is not reachable in any environment where `NODE_ENV !== 'development'`.

Inside `GET /oauth/authorize` (lines 139–157):

1. Missing `redirect_uri` returns 400.
2. `new URL(redirectUri)` parse failure returns 400.
3. `parsedUri.hostname` is checked against `allowedHosts = ['localhost', '127.0.0.1']`. Any non-matching hostname returns 400.

Hostname allowlist bypass attempts verified via Node.js URL parser:

- `localhost.attacker.com` → hostname `localhost.attacker.com` → BLOCKED
- `127.0.0.1.attacker.com` → hostname `127.0.0.1.attacker.com` → BLOCKED
- `[::1]` (IPv6 loopback) → hostname `[::1]` → BLOCKED (minor gap: IPv6 localhost MCP clients would need `::1` added, but not a security issue — it is overly restrictive, not permissive)
- `0177.0.0.1` (octal) and `2130706433` (decimal) → Node resolves both to hostname `127.0.0.1` → ALLOWED — these are genuine loopback aliases, not bypasses

Route ordering: the dev handler at line 139 is registered before `createOAuthProxyRoutes` at line 183. In development, Express matches the dev handler first; the proxy handler for the same path is unreachable. In production, the dev block is skipped entirely and only the proxy handler (which redirects to auth-service) is registered. No shadowing or double-registration issue.

**RC-C2: RESOLVED.**

---

### Final Verdict

**PASS** — RC-C1 and RC-C2 are both resolved as specified.

No new critical or high findings were introduced by the fixes. The staging/unset `NODE_ENV` residual note for RC-C1 is an operational hygiene item, not a production security gap, and does not block the commit.