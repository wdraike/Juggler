# Schedule/Sync Redesign

## Problem

After running the scheduler and syncing to calendars, Strive and GCal diverge. A 7-day audit shows:
- 32/61 tasks match perfectly
- 25 time mismatches (ranging from 30 min to 24 hours off)
- 3 duration mismatches
- 1 missing event
- 2 orphan events on GCal

The drift is not random — it's the predictable outcome of three systems fighting over the same data.

## Root Cause

### Three systems, overlapping ownership, no referee

**System A — Scheduler** (`runSchedule.js`)
- Source of truth for: where tasks *should* be placed
- Writes: `tasks.scheduled_at`, `tasks.dur`, `user_config.schedule_cache`
- Skips: tasks with `when=fixed`, `date_pinned=1`, `marker=true`, `taskType=recurring_template`

**System B — Calendar Sync** (`cal-sync.controller.js`)
- Source of truth for: what calendars show
- Writes: `tasks.scheduled_at`, `tasks.dur`, `tasks.when`, `tasks.{gcal,msft,apple}_event_id`, `tasks.date_pinned`, `tasks.prev_when`, `cal_sync_ledger`
- Promotes tasks to `when=fixed` when it thinks the user moved an event

**System C — Task CRUD** (`task.controller.js`)
- Writes `scheduled_at`, `dur`, `when` — from API calls, without coordination

### The feedback loop that causes drift

1. Scheduler places task at 9:00 AM → writes `scheduled_at`, cache
2. Sync pushes event to GCal at 9:00 AM → sets `gcal_event_id`, ledger hash
3. Next sync fetches event. Event comes back with `startDateTime` that hashes slightly differently from what was pushed (timezone precision, Graph API round-trip, etc.) — `eventChanged=true`
4. Sync calls `applyEventToTaskFields()` → promotes task to `when=fixed`, sets `prev_when`
5. Scheduler on next run: skips the task because `when=fixed`. Can't move it. Can't update `dur`.
6. User makes a change in Strive → `scheduled_at` updates, but task is `fixed` so scheduler won't re-place
7. Sync detects `taskChanged` → pushes new time to GCal → loop continues

After N syncs, hundreds of tasks are pinned as `fixed`, the scheduler can barely move anything, and the cache (which the frontend reads) diverges from both the DB and the calendar.

### Secondary issues found during investigation

- **Event ID ternary bug**: `eventIdCol === 'gcal_event_id' ? 'gcalEventId' : 'msftEventId'` mapped Apple event IDs into `msftEventId`, blocking 17 tasks from ever pushing to MSFT. (Fixed in this branch.)
- **Duration divergence**: Scheduler places split tasks with per-slot durations (30min each) but DB stores total (180min). Sync sometimes read one, sometimes the other.
- **Orphan events never cleaned up**: When a recurring instance was regenerated with a new ID (pre-stable-ID era, or edge cases), old events accumulated. 1,891 orphans in one account. (Delete-on-sync behavior added.)
- **Hash drift from round-trip**: Task hash is timezone-local (`"9:00 AM"`), event hash is UTC ISO. Same task can hash differently depending on the TZ of the sync process.

## Design Principles

### 1. One writer per field

| Field | Authoritative Writer | Notes |
|-------|---------------------|-------|
| `tasks.scheduled_at` | **Scheduler only** | Task CRUD can write it only for `when=fixed` tasks. Sync never writes it. |
| `tasks.dur` | **Scheduler only** | Based on placement. Sync never pulls it from external events. |
| `tasks.when` | **Task CRUD only** | Sync never promotes tasks to `fixed`. |
| `tasks.date_pinned` | **Task CRUD only** | Sync never sets it. |
| `tasks.gcal_event_id` (and msft/apple) | **Sync only** | |
| `cal_sync_ledger.*` | **Sync only** | |
| `user_config.schedule_cache` | **Scheduler only** | |

### 2. Sync is a mirror, not a negotiator

The calendar is a **reflection** of Strive's schedule, not an input to it. Events pulled from calendars become new tasks (one-time ingest), but *existing* Strive tasks are never modified by events.

**Consequence**: The promotion-to-fixed logic is deleted. If the user moves an event on their phone's calendar app, that move is lost on the next sync (the Strive time is re-pushed). Users who need to move tasks do it in Strive, not on the calendar.

This is a deliberate trade-off. The current "bidirectional" behavior sounds nice but creates the feedback loop that causes drift. Users will experience one-way sync (Strive → calendar) and can always re-ingest events they add in the calendar.

Exception: **Ingest-only mode** (per-calendar setting). Events from an ingest-only calendar always win and their tasks are always `when=fixed`. This is the existing semantics; it stays.

### 3. Sync push is deterministic

Every sync run, for every task with `scheduled_at` in the window:
1. If no `gcal_event_id` → create event, store ID
2. If has `gcal_event_id` and event exists on GCal → PATCH with current task state (always — don't hash-compare on task side)
3. If has `gcal_event_id` but event missing on GCal → miss counter (existing behavior)
4. If task has no ledger entry but has event ID → create ledger (recovery)

No hash comparison on the push side. Hashes are only used for *pull* (did the user edit the event externally in a full-sync calendar? — not relevant if we're dropping that capability, but keep the logic for future).

**Cost**: every sync PATCHes every event. With batch update (50/batch GCal, 20/batch MSFT) and ~500 tasks, this is 10-25 batch calls, ~2-5 seconds. Acceptable given the reliability benefit.

### 4. Scheduler writes everything it knows

Currently the scheduler has a "minimal-diff" optimization that skips writes when `scheduled_at` hasn't changed. Replace with: **write `scheduled_at`, `dur`, and `unscheduled=NULL` for every placed task, every run.** Bulk CASE update handles 200/batch so cost is negligible.

This eliminates stale-DB situations where the cache has the correct time but the task row doesn't.

## Implementation Plan

### Phase 1: Single-writer enforcement (the big one)

**File: `cal-sync.controller.js`**

Remove everything that mutates `tasks` except `gcal_event_id` / `msft_event_id` / `apple_event_id`:

- Remove `applyEventToTaskFields()` calls for existing tasks in Phase 2 (lines ~436-500). Keep it only for pulling NEW tasks in Phase 3b.
- Delete the promotion-to-fixed logic entirely from all three adapters (`gcal.adapter.js` lines 164-194, `msft.adapter.js` lines 235-267, `apple.adapter.js` lines 227-252).
- Remove `prev_when` writes.
- In Phase 2, for existing linked tasks: always push task → event via batch update. No hash comparison, no conflict resolution.
- Keep ingest-only mode exception: for ingest-only providers, always pull event → task (existing behavior).

**File: `runSchedule.js`**

- Line 287: remove the `if (dateChanged || timeChanged || durChanged)` guard. Write `scheduled_at` and `dur` for every placed task.
- Line 294: remove the minimal-diff check. Always push to `pendingUpdates`.

**File: `task.controller.js`** — unchanged.

### Phase 2: Simplify ledger

With no bidirectional sync, the ledger becomes a simple task↔event mapping:

- `last_pushed_hash`, `last_pulled_hash` — no longer used, can be removed (or left null)
- `task_updated_at`, `last_modified_at` — no longer used
- Keep: `user_id, provider, task_id, provider_event_id, origin, status, miss_count, event_summary, event_start, event_end, synced_at`

Write a migration to drop the unused columns, or just leave them nullable (lower risk).

### Phase 3: Fix the edge cases

- **Duplicate recurring instance cleanup** — one-time script (already written, ran once)
- **Orphan event cleanup** — already runs on every sync (new behavior from this branch)
- **Reset all `when=fixed` tasks that have `prev_when`** — one-time script (already ran)
- **Sync window** — confirm 14 days back + 60 days forward is right

### Phase 4: Observability

Add to the sync response:
- Count of tasks scanned per provider
- Count of events scanned per provider
- Count of pushes / pulls / deletes / errors per phase
- Per-task error list with taskId + error message

Add a `/api/cal/audit` endpoint that returns the same comparison this conversation ran manually:
- For each task: expected time on GCal vs actual time, time diff, duration diff, missing/orphan flag

## Migration / Rollout

1. **Branch** — do Phase 1 in a branch
2. **Test** — the existing 121-test suite covers the scenarios. Update tests that expect promotion behavior to expect one-way push instead. Some will need to be deleted entirely (conflict resolution, promotion, etc.).
3. **One-time cleanup on the real DB**:
   - Reset all tasks with `when=fixed` AND `prev_when IS NOT NULL` back to `prev_when`, clear `prev_when`
   - Run scheduler once
   - Run full sync once (now deterministic, pushes every event)
   - Run audit endpoint, verify <5% drift
4. **Monitor** — audit endpoint for a week. Drift should stay near zero.

## What gets worse

- Users who drag events on their phone's GCal app will see the change revert next sync. Document this. Add a "sync from calendar" manual action for one-off ingests.
- Every sync writes ~500 batch PATCHes instead of 50 (when most events are unchanged). Still fast but more API quota.

## What gets better

- Strive is authoritative. Drift is impossible by design.
- Scheduler runs freely. Nothing pins tasks except the user's explicit `when=fixed`.
- Debugging is simple: if GCal differs from Strive, run sync.
- Test scenarios are far simpler (no conflict resolution logic to test).

## Critical files

| File | Changes |
|------|---------|
| `src/controllers/cal-sync.controller.js` | Remove Phase 2 pull/promote; push-only in batch |
| `src/lib/cal-adapters/gcal.adapter.js` | Remove promotion logic in `applyEventToTaskFields` |
| `src/lib/cal-adapters/msft.adapter.js` | Same |
| `src/lib/cal-adapters/apple.adapter.js` | Same |
| `src/scheduler/runSchedule.js` | Remove minimal-diff; always write `scheduled_at`, `dur` |
| `src/routes/cal-sync.routes.js` | Add `/audit` endpoint |
| `tests/cal-sync/13-sync-conflict.test.js` | Delete (no more conflict resolution) |
| `tests/cal-sync/14-sync-promotion.test.js` | Delete (no more promotion) |
| `tests/cal-sync/15-sync-ingest.test.js` | Keep — ingest-only still exists |
| `tests/cal-sync/audit.test.js` | New — exercises `/audit` endpoint |

## Verification

1. Run tests: `NODE_ENV=test npx jest tests/cal-sync/ --runInBand`
2. One-time cleanup on real DB (scripts described above)
3. Run scheduler + sync + audit in sequence
4. Assert: `audit.mismatches.length === 0` (or document the small number that are legitimate)
5. Let it run for a week, check drift daily

## Open questions

- **Apple Calendar as write target**: Apple CalDAV has no batch API and is slower. If users connect Apple as full-sync (not ingest-only), every sync run does sequential PATCHes. Needs perf testing with real account. Acceptable to keep Apple as ingest-only default.
- **Manual "re-ingest from calendar" button**: Nice-to-have UX for users who want to occasionally sync events they added externally. Not critical for v1.
- **MSFT HTTP 403 on batch update**: The 115 errors per sync on pulled events (events we don't own). In the new design, we never try to update pulled events (one-way sync means we don't track them as bidirectional). So these errors go away.
