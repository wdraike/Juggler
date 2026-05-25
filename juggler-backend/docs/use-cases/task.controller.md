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
3. If `placementMode === 'fixed'`: validate that both `date` and `time` are present. Returns 400 if either is absent.
4. Insert into `task_masters` and `task_instances`. Emit SSE event. Enqueue scheduler run.

**Key invariant:** `placementMode` supplied by the client is authoritative. The server only overrides it for `all_day` tasks.

---

## UC-2: Update Task

**Trigger:** `PATCH /tasks/:id`

**Drag-and-drop:** Drag-to-fixed no longer uses a special flag. The frontend sends a normal PATCH with `{ placementMode: 'fixed', date, time }`. The controller processes it identically to any other mode change. There is no `_dragPin` body flag and no `prev_when` snapshot — undoing a drag is done via a subsequent PATCH that sets a different `placementMode`.

**Calendar-managed guard (`guardFixedCalendarWhen`):**
- Tasks linked to a calendar event (`gcal_event_id`, `msft_event_id`, or `apple_event_id`) may not have their `placement_mode` changed away from `'fixed'` via a normal PATCH. The guard checks `row.placement_mode` directly: if the incoming value is not `'fixed'`, the guard deletes `row.placement_mode` from the write so the calendar-assigned mode is preserved. Pass `opts.allowUnfix = true` to bypass (used by admin paths).

**Fixed-mode validation:** If `placementMode === 'fixed'` is in the PATCH body, both `date` and `time` must also be present. Returns 400 if either is absent.

**Output:** Updated task row, SSE event, scheduler enqueue. Cache invalidated via `cache.invalidateTasks`.

---

## UC-3: Unpin Task — REMOVED

**Endpoint `POST /tasks/:id/unpin` has been removed** as part of the When-mode simplification.

The `date_pinned` column and `prev_when` snapshot mechanism no longer exist. There is nothing to unpin. To move a task away from `fixed` mode, the user sends a normal PATCH with the desired `placementMode` (e.g. `anytime`, `time_window`, `time_blocks`, or `all_day`). Calendar-managed tasks cannot have their mode changed away from `'fixed'` via PATCH (see `guardFixedCalendarWhen` in UC-2).

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

Applies the same update logic as UC-2 to multiple tasks in a single request. Each task is validated independently; partial success is allowed (failed rows are reported, others commit). The `guardFixedCalendarWhen` check and fixed-mode date+time validation (see UC-2) apply per task in the batch.

---

## Placement Mode Reference

| `placement_mode` | Scheduler behavior | User-selectable |
|---|---|---|
| `anytime` | Scheduler places freely | Yes |
| `time_window` | Near preferred time ± flex | Yes |
| `time_blocks` | Named windows (morning / lunch / etc.) | Yes |
| `all_day` | No time placement | Yes |
| `fixed` | Immovable — requires date + time | Yes (user-selectable; also set by calendar sync) |
| `reminder` | System/marker mode | No |

`isFixed` (frontend-only derived value): `placementMode === 'fixed' && isCalManaged`. Only calendar-linked tasks with `placementMode='fixed'` lock the scheduling-mode UI controls. Juggler-native tasks in `fixed` mode display normally and can be changed to any other mode via a normal PATCH.
