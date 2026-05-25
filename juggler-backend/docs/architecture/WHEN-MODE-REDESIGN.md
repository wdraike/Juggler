---
type: design
service: juggler
status: active
last_updated: 2026-05-25
tags:
  - type/design
  - service/juggler
  - status/active
  - scheduler
  - task-management
  - placement-mode
  - architecture-decision
---

# When-Mode Simplification — Architecture Decision Record

**Last Updated:** 2026-05-25

## Summary

The dual-axis immovability system (`date_pinned` + `rigid`) has been removed. `placement_mode = 'fixed'` is now the sole signal that a task is immovable. `fixed` is user-selectable from the mode picker alongside Anytime, Time Window, Time Blocks, and All Day.

---

## What Changed

### Removed from the database

| Column | Table | Replacement |
|--------|-------|-------------|
| `date_pinned` | `task_instances` | `placement_mode = 'fixed'` |
| `rigid` | `task_masters` | `placement_mode = 'fixed'` |
| `prev_when` | `task_masters` | None — drag-to-fixed is now undone via a normal PATCH |

Migration files have been created but **not yet executed**:

- `AUDIT-date_pinned-mismatch.sql` — query to verify zero mismatched rows before dropping
- `20260526000000_drop_pinned_and_rigid_columns.js` — Knex migration that drops all three columns

**Execution prerequisite:** Run the audit SQL first. It must return 0 rows before the migration is safe to apply.

### Removed from the API

- `POST /tasks/:id/unpin` — endpoint removed from routes and controller. There is nothing to unpin; changing mode is done via a normal `PATCH /tasks/:id`.
- `body._dragPin` flag — the drag-to-fixed code path that set `date_pinned = 1` and wrote `prev_when` is gone. Drag now sends `PATCH { placementMode: 'fixed', date, time }`.

### Removed from calendar adapters

`date_pinned = 1` writes have been removed from:

- `gcal` sync adapter
- `msft` sync adapter
- `apple` sync adapter
- `cal-sync.controller.js`

Calendar-synced events still receive `placement_mode = 'fixed'` from the sync adapters — only the redundant `date_pinned` write was dropped.

### Removed from MCP

- `datePinned` Zod schema field removed from `juggler-mcp/`
- Auto-set of `datePinned` on task creation removed

### Frontend changes

- Pin/Pinned toggle removed from `WhenSection.jsx`
- Float/Fixed rigid toggle removed from `WhenSection.jsx` and `TaskEditForm.jsx`
- Fixed button added as 5th option in the mode selector
- Recurring + Fixed: not supported — `WhenSection` shows a "not available" message with the four valid mode buttons as the exit path
- Client-side validation: Fixed requires both date and time set before save

---

## Why

The prior system had two independent columns that both influenced immovability:

- `date_pinned = 1` locked the task to a specific date but allowed time to float within the day
- `rigid = true` locked the time but not necessarily the date
- Calendar-synced tasks received both, making `when = 'fixed'` the actual scheduler trigger

This created three different ways a task could be "fixed," none of which was authoritative on its own. The `_dragPin` flag and `prev_when` snapshot added a third code path for a fourth behavioral variant. The result was:

- Four places where immovability state could be set (scheduler, controller `_dragPin` path, controller unpin path, calendar adapters)
- Two separate UI toggles (Pin toggle + Float/Fixed toggle) that partially overlapped
- `unpin` endpoint that had to parse three different `prev_when` formats (JSON, colon-prefix, bare string)

`placement_mode` was already the authoritative scheduler signal. Making it the sole signal eliminates the redundancy and the synchronization bugs that came with maintaining multiple sources of truth.

---

## `isFixed` Formula (frontend only)

```js
isFixed = placementMode === 'fixed' && isCalManaged
```

`isCalManaged` is true when the task has a `gcal_event_id`, `msft_event_id`, or `apple_event_id`.

Only calendar-managed fixed tasks lock the scheduling-mode UI controls. Juggler-native tasks in `fixed` mode display normally and can be changed to any other mode via a normal PATCH.

---

## Drag-to-Fixed

Before this change, drag-and-drop sent `PATCH { _dragPin: true, date, time }`, which triggered a separate code path that wrote `date_pinned = 1` and saved `prev_when`.

After this change, drag-and-drop sends:

```json
PATCH /tasks/:id
{ "placementMode": "fixed", "date": "5/26", "time": "2:30 PM" }
```

This is processed identically to any other mode change. To undo a drag, the user selects a different mode from the picker, which sends another normal PATCH.

---

## Recurring + Fixed

Recurring tasks cannot use `fixed` mode. If a user attempts to set a recurring task to `fixed`, `WhenSection.jsx` shows a "not available" message and renders the four valid mode buttons (Anytime, Time Window, Time Blocks, All Day) as the exit path. No server-side enforcement is needed because the UI prevents the combination from being submitted.

---

## Fixed-Mode Validation

`placement_mode = 'fixed'` requires both `date` and `time`. The server returns 400 if either is absent. This is enforced in:

- `POST /tasks` (UC-1)
- `PATCH /tasks/:id` (UC-2)
- `PATCH /tasks/batch` (UC-6, per task)

---

## Migration Status

| File | Status |
|------|--------|
| `AUDIT-date_pinned-mismatch.sql` | Created — run before migration |
| `20260526000000_drop_pinned_and_rigid_columns.js` | Created — pending execution |
| Application code | Updated — no live reads or writes to `date_pinned`, `rigid`, or `prev_when` |

The application no longer reads or writes any of the three removed columns. The migration can be executed once the audit SQL confirms zero mismatched rows. No maintenance window is required — the service is not yet serving real users.

---

## Related Documents

- `docs/architecture/TASK-PROPERTIES.md` — properties table updated; `date_pinned`, `rigid` marked removed
- `docs/architecture/SCHEDULER-UI-STATE-MAP.md` — dual-axis section replaced with single-axis; derivation rules updated; UI controls section updated
- `docs/architecture/SCHEDULER.md` — Phase 0 description updated; persist section updated
- `docs/use-cases/task.controller.md` — UC-2 `_dragPin` subpath removed; UC-3 marked removed; UC-1/UC-6 fixed-mode validation added

---

## Status

Accepted — 2026-05-25. Migration (column drop) pending.

---

## Consequences

- `prev_when` undo history is lost; drag-to-fixed is a one-way operation (user changes mode via normal PATCH to undo)
- Drag now requires the client to supply full `date` + `time` (not just a slot name)
- Data migration required before column drop: tasks with `date_pinned=1` but `placement_mode != 'fixed'` must be corrected
- `guardFixedCalendarWhen` must be maintained to prevent calendar-sync tasks from losing `placement_mode='fixed'` via normal PATCH
- Recurring + Fixed is not supported; `WhenSection` enforces this constraint in the UI
