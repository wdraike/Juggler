# Elmo Security Audit — MCP Task Tool Changes (juggler-backend)

**Scope:** `src/mcp/tools/tasks.js` changes (placementMode enum, datePinned behavior, auto-pin/placement inference)  
**Audited files:**
- `/Users/david/Offline Coding/Raike & Sons /DEV/juggler/juggler-backend/src/mcp/tools/tasks.js`
- `/Users/david/Offline Coding/Raike & Sons /DEV/juggler/juggler-backend/src/controllers/task.controller.js` (`taskToRow`, `validateTaskInput`, `guardFixedCalendarWhen`, `checkCalSyncEditGuard`)
- `/Users/david/Offline Coding/Raike & Sons /DEV/juggler/juggler-backend/src/lib/placementModes.js`

**Date:** 2026-05-24  
**Auditor:** Elmo  
**Classification counts:** CRITICAL 1 | HIGH 2 | MEDIUM 2 | LOW 1

---

## CRITICAL-1 — `batch_update_tasks` has zero calendar-sync guard; any field writable on externally-synced tasks

**Finding:** `update_task` blocks all edits except `status` and `notes` on calendar-synced tasks (lines 257-264). However, `batch_update_tasks` never calls `checkCalSyncEditGuard` and never queries `gcal_event_id` / `msft_event_id` / `apple_event_id` when loading existing rows. It selects only `id, task_type, source_id, scheduled_at` (lines 542-545 and 583-586).

**Attack:** A malicious MCP client sends a `batch_update_tasks` payload targeting a calendar-synced task ID with `datePinned: true`, `placementMode: 'fixed'`, `date: '6/1'`, `time: '9:00 AM'`, etc. The write proceeds unimpeded.

**Impact:**
- `date_pinned` can be set to `1` on calendar-synced tasks, violating their immutability guarantee.
- `placement_mode` can be mutated on calendar-synced tasks.
- Scheduled time can be overwritten on ingest-only calendar events, creating a permanent divergence between Juggler and the external calendar.

**Reproduction:**
1. Identify a task with `gcal_event_id` set.
2. Call `mcp:batch_update_tasks` with `{ "id": "<task-id>", "datePinned": true, "placementMode": "fixed", "date": "6/1", "time": "9:00 AM" }`.
3. Observe the write succeeds and the task is now pinned/fixed in Juggler but unchanged in Google Calendar.

**Remediation:** Add the same `isCalSynced` + `allowedKeys` block used in `update_task` to `batch_update_tasks`, both in the locked path and the transaction path.

---

## HIGH-1 — `placementMode: 'fixed'` with no date/time creates contradictory scheduler input

**Finding:** The Zod enum accepts `placementMode: 'fixed'` independently of `date`/`time`/`scheduledAt`. In `create_task` and `create_tasks`:
- `taskToRow` writes `placement_mode = 'fixed'` if the caller sends it (line 559-561 in task.controller.js).
- The inference backstop (`_timeWasSet && row.placement_mode === undefined`) is skipped when the caller explicitly provides `placementMode`.
- If no date/time is sent, `scheduled_at` remains `null` while `placement_mode` is `'fixed'`.

In `update_task` the same pattern exists: explicit `placementMode: 'fixed'` skips inference and can leave the task without a scheduled time.

**Impact:** The scheduler receives a task claiming fixed placement but lacking an anchor time. This is a contradiction that can trigger scheduler edge-case bugs (infinite loops, unplaced-task pile-up, or assertion failures in `unifiedScheduleV2.js`).

**Attack:** Send `create_task { text: "X", placementMode: "fixed" }` with no date or time. The row is inserted with `placement_mode = 'fixed'` and `scheduled_at = NULL`.

**Remediation:** Add a cross-field validation rule in `validateTaskInput`: if `placementMode === 'fixed'`, then `date` or `time` or `scheduledAt` must be present. Similarly, `all_day` should require `date`.

---

## HIGH-2 — `taskToRow` passes `placement_mode` through unchecked; no secondary validation layer

**Finding:** `taskToRow` (task.controller.js:559-561) does:
```js
if (task.placementMode !== undefined) {
  row.placement_mode = task.placementMode;
}
```
There is no whitelist check, no normalization, and no fallback. The value is injected verbatim into the DB row.

**Implications:**
- The MCP Zod enum is the **only** validation gate. If any future code path (internal batch helper, queue flush, migration script) sets `placementMode` programmatically with a bad value, it reaches the DB unchecked.
- `validateTaskInput` does **not** validate `placementMode` at all, so the REST API path (non-MCP) also lacks enforcement.
- If MySQL strict mode is ever disabled, an invalid enum value could silently truncate to an empty string or the first enum member, corrupting scheduler logic.

**Remediation:** Add a `PLACEMENT_MODES` whitelist check inside `taskToRow` (fallback to `undefined` or throw on invalid value). Also add `placementMode` validation to `validateTaskInput` so both MCP and REST are protected.

---

## MEDIUM-1 — Auto-pin inference in `batch_update_tasks` can pin calendar-synced tasks (when combined with CRITICAL-1)

**Finding:** In the `batch_update_tasks` locked path (lines 561-564) and transaction path (lines 603-606), auto-pin logic runs without a calendar-sync guard:
```js
var _txTimeWasSet = fields.time !== undefined || fields.scheduledAt !== undefined;
if (!_txTimeWasSet && fields.date !== undefined && row.placement_mode === undefined) {
  row.placement_mode = PLACEMENT_MODES.ALL_DAY;
}
```
Because the batch path also lacks the `isCalSynced` check, an update that merely touches `date` on a calendar-synced task will auto-pin it (`date_pinned = 1` is inferred in `taskToRow` when `date` is set and `datePinned` is omitted) and set `placement_mode = 'all_day'`.

**Impact:** Compound of CRITICAL-1; even if the attacker does not explicitly send `datePinned`, the innocent-looking presence of `date` in the batch update triggers the auto-pin + all-day inference on an externally-owned task.

**Remediation:** Fix CRITICAL-1; the batch guard should reject `date`, `time`, `scheduledAt`, `datePinned`, and `placementMode` on calendar-synced tasks before any inference runs.

---

## MEDIUM-2 — Behavioral divergence: API allows `datePinned` on calendar-synced tasks; MCP blocks it entirely

**Finding:** `checkCalSyncEditGuard` in `task.controller.js` (line 76) allows `datePinned` on calendar-synced tasks:
```js
var allowed = ['status', 'notes', 'datePinned', '_dragPin', '_allowUnfix'];
```
But `update_task` in `tasks.js` (line 259) uses a stricter list:
```js
var allowedKeys = ['status', 'notes'];
```

**Impact:** A user can pin/unpin a calendar-synced task via the web UI (API) but the same action is rejected via the MCP client. More importantly, the API's `guardFixedCalendarWhen` only prevents *clearing* `date_pinned` on calendar-linked tasks; it does **not** prevent *setting* it. So the API path permits `date_pinned = 1` on calendar-synced tasks. The MCP path blocks it. This inconsistency means the immutability policy is not uniform across channels.

**Remediation:** Unify the guard. Decide whether `datePinned` should be editable on calendar-synced tasks. If the answer is "no" (which is safer), update `checkCalSyncEditGuard` to remove `datePinned` from the allowed list and ensure `guardFixedCalendarWhen` blocks both setting and clearing. If the answer is "yes", update the MCP guard to match the API.

---

## LOW-1 — `datePinned: false` + `date` creates an un-pinned dated task; scheduler must handle it correctly

**Finding:** When a caller explicitly sends `datePinned: false` alongside `date`/`time`, auto-pin is skipped. The task has `scheduled_at` populated but `date_pinned = 0`.

**Assessment:** This is **by design** ("respects explicit `datePinned` from caller"). It is not an injection or bypass. However, it is a sharp edge: an agent may assume a task with a `date` will stay on that date, but the scheduler is free to move it. If the scheduler or frontend code anywhere assumes `scheduled_at !== null` implies `date_pinned = 1`, this could produce UI flicker or unexpected rescheduling.

**Recommendation:** Document this explicitly in `TASK-PROPERTIES.md` and ensure scheduler tests cover the "dated but un-pinned" case.

---

## Summary

| # | Severity | Finding |
|---|----------|---------|
| 1 | **CRITICAL** | `batch_update_tasks` has no calendar-sync guard — all fields writable on externally-synced tasks, including `date_pinned` |
| 2 | **HIGH** | `placementMode: 'fixed'` accepted without requiring `date`/`time` — creates contradictory scheduler input |
| 3 | **HIGH** | `taskToRow` passes `placement_mode` unchecked — only Zod gate protects it |
| 4 | **MEDIUM** | `batch_update_tasks` auto-pin / all-day inference can silently mutate calendar-synced tasks (compound of #1) |
| 5 | **MEDIUM** | API vs MCP divergence on `datePinned` policy for calendar-synced tasks |
| 6 | **LOW** | `datePinned: false` + `date` edge case — scheduler/frontend must not assume date implies pin |

**Immediate actions recommended:**
1. Add `isCalSynced` guard to `batch_update_tasks` before any field is processed.
2. Add cross-field validation: `placementMode === 'fixed'` must have a date/time; `placementMode === 'all_day'` must have a date.
3. Harden `taskToRow` with a `PLACEMENT_MODES` whitelist fallback.
4. Unify API/MCP calendar-sync `allowedKeys` lists.
