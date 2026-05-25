---
type: use-case
service: juggler
status: active
last_updated: 2026-05-25
tags:
  - type/use-case
  - service/juggler
  - status/active
  - tasks
  - placement-mode
---

# Task Controller — Use Cases

**Last Updated:** 2026-05-25

Source: `src/controllers/task.controller.js`
See also: `docs/architecture/TASK-PROPERTIES.md`, `docs/architecture/SCHEDULER.md`, `src/lib/placementModes.js`

---

## UC-1: Create Task

**Trigger:** `POST /tasks`

**Flow:**
1. Validate body via `taskCreateSchema`.
2. Derive placement mode: `all_day` if `isAllDay`, otherwise the caller-supplied `placementMode` (defaults to `anytime`). The server does NOT auto-set `fixed` based on the presence of a time value — the user sets mode explicitly.
3. Insert into `task_masters` and `task_instances`. Emit SSE event. Enqueue scheduler run.

**Key invariant:** `placementMode` supplied by the client is authoritative. The server only overrides it for `all_day` tasks.

---

## UC-2: Update Task

**Trigger:** `PATCH /tasks/:id`

**Drag-pin subpath (`body._dragPin === true`):**
1. Encodes pre-drag state as `prev_when = JSON.stringify({ mode: placementMode, when })` before overwriting. Guard: only writes `prev_when` if the task is not already pinned (`!existing.date_pinned`) — preserves the original snapshot through re-drags.
2. Sets `date_pinned = 1`, updates `date` and `time` from the dropped position.

**Calendar-managed guard (`guardFixedCalendarWhen`):**
- Tasks linked to a calendar event (`gcal_event_id`, `msft_event_id`, or `apple_event_id`) may not have their `placement_mode` cleared via a normal PATCH. The guard deletes `row.placement_mode` from the write if it is not `'fixed'`. Pass `opts.allowUnfix = true` to bypass (used by unpin and admin paths).

**Output:** Updated task row, SSE event, scheduler enqueue. Cache invalidated via `cache.invalidateTasks`.

---

## UC-3: Unpin Task

**Trigger:** `POST /tasks/:id/unpin`

**Purpose:** Clears the drag-pin lock (`date_pinned`) and restores the prior `placement_mode` and `when` values.

**Flow:**
1. Fetch task + calendar event IDs. Block if the task is calendar-managed (cannot unpin a calendar event; user must edit via calendar provider).
2. Parse `prev_when` to restore prior state. Three-branch parser:
   - **JSON format** (`prev_when` starts with `{`): `{ mode, when }` — used for tasks pinned after 2026-05-25. Validates `mode` against `PLACEMENT_MODES` enum; falls back to `anytime` if invalid or key is absent.
   - **Colon format** (`prev_when` starts with `mode:`): legacy transitional format, same semantics as JSON.
   - **Bare string** (legacy): comma-separated block tags (e.g. `'morning,lunch'`). All-block → `time_blocks`. Otherwise → `anytime`.
3. Write: `date_pinned = 0`, `placement_mode = restoredMode`, `when = restoredWhen`, `prev_when = null`.
4. Invalidate Redis cache. Enqueue scheduler run.

**Key invariant:** After unpin, `placement_mode` always reflects what the user had before the drag. A task that was in `time_window` mode before being drag-pinned is restored to `time_window`, not silently demoted to `anytime`.

---

## UC-4: Delete Task

**Trigger:** `DELETE /tasks/:id`

**Cascade modes (via `query.cascade`):**
- `recurring` — deletes all open (non-terminal) recurring instances of the template; keeps terminal instances with `source_id` cleared.
- `chain` — deletes all chain members downstream of the deleted task.
- No cascade — deletes the task only.

**Calendar cleanup:** If the task has calendar event IDs, pushes a delete to the provider before removing from the DB.

---

## UC-5: Update Task Status

**Trigger:** `PATCH /tasks/:id/status`

**Special cases:**
- `done` — stamps `scheduled_at` to now if the task had a future scheduled time.
- `pause` / `''` (unpause) — only valid on `recurring_template` tasks. Pausing deletes all future open instances.
- Terminal status on a `recurring_template` → 400.

---

## UC-6: Batch Update Tasks

**Trigger:** `PATCH /tasks/batch`

Applies the same update logic as UC-2 to multiple tasks in a single request. Each task is validated independently; partial success is allowed (failed rows are reported, others commit).

---

## Placement Mode Reference

| `placement_mode` | Scheduler behavior | User-selectable |
|---|---|---|
| `anytime` | Scheduler places freely | Yes |
| `time_window` | Near preferred time ± flex | Yes |
| `time_blocks` | Named windows (morning / lunch / etc.) | Yes |
| `all_day` | No time placement | Yes |
| `fixed` | Immovable — requires date + time | Yes (calendar-managed tasks only via sync) |
| `reminder` | System/marker mode | No |

`isFixed` (frontend-only derived value): `!!datePinned || (placementMode === 'fixed' && isCalManaged)`. Only calendar-linked tasks with `placementMode='fixed'` lock the scheduling UI. Juggler-native tasks with a stale `placement_mode='fixed'` (e.g. after unpin) do NOT lock.
