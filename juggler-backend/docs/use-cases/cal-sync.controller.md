# Cal-Sync Controller — Use Cases

Source: `src/controllers/cal-sync.controller.js`
See also: `docs/CALENDAR-SYNC-REFACTOR.md`, `docs/SYNC-EVENT-TO-TASK-HANDOFF.md`

---

## UC-1: Bidirectional Sync (GCal / MSFT / Apple)

**Trigger:** `POST /sync` with provider token and timezone.

**Flow:**
1. Fetch all provider events for the current year.
2. Diff against `cal_sync_ledger` (tracks last-known provider hash per task).
3. For each changed task/event pair, classify into one of four states:
   - Only task changed → push task data to provider
   - Only event changed → pull event data into task
   - Both changed → conflict resolution (UC-2)
   - Neither changed → no-op

**Output:** Updated `cal_sync_ledger` rows, batched provider event updates, task DB writes.

---

## UC-2: Conflict Resolution

**Trigger:** Both the juggler task and the provider event were modified since the last sync.

**Rule — juggler always wins when:**
- `task.placementMode === PLACEMENT_MODES.FIXED` — fixed-time tasks own their schedule; external edits are rejected.
- Task is terminal (`done` / `cancel` / `skip` / `pause`) — completed work is never overwritten by a calendar edit.

In both cases: push juggler state to provider, log `conflict_juggler`.

**Rule — provider wins otherwise:**
- Pull event fields (title, time, duration) into the task, log `conflict_provider`.
- Re-push updated task to provider to confirm the merged state.

**Key invariant:** `isFixed` is derived solely from `task.placementMode === PLACEMENT_MODES.FIXED`. The legacy `when.indexOf('fixed')` check and `task.rigid` read were removed in phase 11 — `when` no longer carries placement tokens and `rigid` is gone from the view.

---

## UC-3: Ingest-Only Provider Events → Tasks

**Trigger:** Provider event arrives with no matching juggler task.

**Flow:** Creates a new juggler task from the event. Sets `placement_mode` based on event type (all-day, reminder/transparent, or regular).

---

## UC-4: Sync Lock

**Trigger:** Concurrent sync requests for the same user+provider pair.

**Behavior:** Second request bails immediately (`sync-lock`). Prevents duplicate ledger rows and double-push.
