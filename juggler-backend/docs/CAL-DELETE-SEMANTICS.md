# Calendar-event deletion semantics — split & recurring tasks (999.680)

_Specced 2026-06-18. **Product decision (W. David Raike): "delete future instances only."**
This documents the chosen semantics for what happens to provider calendar events when a
split or recurring task is deleted, and reconciles the decision against existing code._

## Decision

When a recurring or split task is deleted, **remove the calendar events for the current and
all future (still-pending) pieces only**. Already-elapsed pieces — instances/chunks that are
`done`, `cancel`, or `skip` — keep their calendar events as a historical record. The series
template (and its event, if any) is removed.

This is the **`this_and_future`** delete scope, not `series` (delete-everything) or `instance`
(delete-one-only).

## How events are removed (mechanism)

Juggler never calls a provider `deleteEvent` synchronously from the delete path. Instead the
delete transaction marks the `cal_sync_ledger` rows for the affected tasks as
`status = 'deleted_local'` (clearing `task_id`, stamping `synced_at`). The next sync push
reconciles those `deleted_local` rows by removing the corresponding events from Google /
Microsoft / Apple. Retained pieces keep their `active` ledger rows, so their events survive.

## Recurring tasks — already implemented

`thisAndFutureDelete` (`src/slices/task/facade.js:668`) implements the decision exactly:

- Fetches all instances of the template from `tasks_with_sync_v`.
- **Pending set** = the current instance **plus** every instance whose status is **not**
  `done` / `cancel` / `skip`. These are hard-deleted and their `active` ledger rows flipped to
  `deleted_local` (`facade.js:696`) → their cal events are removed on the next sync.
- **Kept set** = the completed/past instances. Untouched — cal events retained.
- The template master is deleted; if it carried an event, its ledger row is also flipped to
  `deleted_local` (`facade.js:721`).

Entry point: `DeleteTask.execute` with `scope = 'this_and_future'`
(`src/slices/task/application/commands/DeleteTask.js:166`). `scope = 'series'` remains the
explicit "delete the whole series including past events" escape hatch; `scope = 'instance'`
deletes exactly one piece.

## Split tasks

A split task is **one logical task** whose chunks are instance rows sharing a master
(distinguished by `split_ordinal` / `split_group`). The same future-only rule applies via the
pending-vs-terminal filter:

- Deleting a split task removes the chunks that are still pending (current + future) and flips
  their ledger rows to `deleted_local`; chunks already marked `done`/`cancel`/`skip` are
  retained with their events intact.
- Deleting a **single** chunk (`scope = 'instance'`) removes only that chunk's event.

No code change is required for split tasks beyond what `thisAndFutureDelete` / `standardDelete`
already do — the pending filter is status-based, so it treats split chunks and recurring
instances uniformly.

## Provider-origin & ingest guards (unchanged)

Independent of split/recurring scope:

- **Ingest-only mode:** a calendar-linked task cannot be deleted in ingest mode
  (`INGEST_DELETE_BLOCKED`, `DeleteTask.js:98`) — delete it from the calendar instead.
- **Provider-origin:** a task that originated from a provider ledger row is blocked from
  non-series delete (`PROVIDER_ORIGIN_DELETE_BLOCKED`, `DeleteTask.js:113`).

## Bottom line

The decision ("delete future instances only") is the **current behavior** for recurring tasks
via the `this_and_future` scope, and applies uniformly to split chunks through the same
status-based pending filter. No behavioral change is needed; this document is the spec of
record. Callers should pass `scope = 'this_and_future'` for the default delete affordance on
split/recurring tasks, reserving `series` for an explicit "remove everything including history"
action.
