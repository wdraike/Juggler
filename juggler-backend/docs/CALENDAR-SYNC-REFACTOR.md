# Calendar Sync Refactor — Continuation Brief

## What This Is

This document captures the full state of the calendar sync implementation as of 2026-04-12 so a fresh conversation can pick up without losing context.

## Architecture

The sync engine lives at `juggler-backend/src/controllers/cal-sync.controller.js`. It syncs Juggler tasks bidirectionally with Google Calendar and Microsoft Outlook using an adapter pattern.

### Key Files

| File | Role |
|------|------|
| `src/controllers/cal-sync.controller.js` | Main sync engine — 5 phases |
| `src/controllers/cal-sync-helpers.js` | `taskHash`, `jugglerDateToISO`, `isoToJugglerDate` |
| `src/lib/cal-adapters/gcal.adapter.js` | GCal adapter: CRUD, batch, buildEventBody, promotion |
| `src/lib/cal-adapters/msft.adapter.js` | MSFT adapter: same interface |
| `src/lib/cal-adapters/index.js` | Adapter registry, `getConnectedAdapters()` |
| `src/lib/gcal-api.js` | GCal REST wrapper + `batchRequest()` |
| `src/lib/msft-cal-api.js` | MSFT Graph REST wrapper + `batchRequest()` |
| `src/lib/sync-lock.js` | DB-backed per-user lock with heartbeat |
| `src/lib/sse-emitter.js` | SSE event emitter: `emit(userId, event, data)` |
| `src/routes/cal-sync.routes.js` | Routes: POST /sync, GET /has-changes, GET /sync-history |
| `src/scheduler/runSchedule.js` | Scheduler — writes `schedule_cache` to `user_config` |
| `src/server.js` | Startup zombie killer + sync lock auto-clear |
| `src/db/migrations/20260412000000_create_sync_history.js` | sync_history table |
| `juggler-frontend/src/components/features/CalSyncPanel.jsx` | Sync UI: progress bar, history, smart toast |
| `juggler-frontend/src/hooks/useTaskState.js` | SSE listener, exposes `window.__jugglerEventSource` |

### Sync Phases (current)

```
Phase 1: Fetch events from all providers (parallel via Promise.all)
Phase 2: Process existing ledger records (sequential per provider per row)
Phase 3a: Push new tasks to providers (batch create, single DB transaction)
Phase 3b: Pull new events from providers (sequential)
Phase 4: Update last-synced timestamps
Phase 5: Build affected-task-id list, enqueue scheduler, emit SSE, return response
```

### Database Tables

- `cal_sync_ledger` — one row per task per provider, tracks sync state (hashes, event IDs, miss count)
- `sync_history` — append-only audit log per sync action
- `sync_locks` — DB-backed per-user mutex
- `user_config` (key=`schedule_cache`) — scheduler's placement cache (JSON)
- `tasks` — `gcal_event_id`, `msft_event_id` columns link tasks to provider events

## What Works

1. **Promotion logic** — `applyEventToTaskFields(event, tz, currentTask)` in both adapters detects time/date changes and sets `when: 'fixed'`, `date_pinned: 1`, `prev_when`. Bug fix: all-day-to-timed also promotes. Marker clearing when event becomes opaque.

2. **Batch API** — `batchCreateEvents()` and `batchDeleteEvents()` on both adapters. GCal: multipart/mixed batch endpoint, 50/batch. MSFT: JSON $batch endpoint, 20/batch. Verified working with direct test (created 2 events, cleaned up).

3. **Sync history** — `sync_history` table with `sync_run_id`, action types (pushed, pulled, promoted, error, etc.), old/new values JSON. API: `GET /api/cal/sync-history?limit=N&syncRunId=UUID`. Frontend: grouped by run, expandable details.

4. **Progress bar** — SSE `sync:progress` events emitted at each phase with `{ phase, detail, pct }`. Frontend listens via `window.__jugglerEventSource`. Shows progress bar + phase text above Sync Now button.

5. **Hash improvements** — `eventHash` includes `isTransparent` + `isAllDay`. `taskHash` includes `marker`.

6. **Midnight overflow fix** — `buildEventBody` in both adapters uses `new Date(startDate.getTime() + dur * 60000)` instead of minute arithmetic that produced invalid `T24:00:00`.

7. **Status endpoints** — `getStatus` in both controllers no longer calls `refreshAccessToken()`. Just checks if refresh token exists. Instant response.

8. **Lock mechanism** — DB-backed with `NOW()` for all time comparisons (avoids `dateStrings` timezone bug). 30s TTL, 10s heartbeat, 5-min safety cap. Startup auto-clear in `server.js`.

9. **Zombie process killer** — `server.js` uses `lsof -ti :PORT` on startup to kill previous processes on same port (not other services).

10. **Phase 2 optimization** — Skips `cal_sync_ledger` UPDATE when `!taskChanged && !eventChanged`.

11. **Phase 1 parallel** — `Promise.all` for provider event fetches.

12. **Recurring instance text** — Resolved from `source_id` templates (loaded separately since templates have `scheduled_at=NULL`).

13. **Status filter** — Phase 3a skips done/cancel/skip/pause/disabled tasks.

14. **Template filter** — Phase 3a skips `recurring_template` tasks, allows instances.

## What's Broken

### 1. DB Contention (ROOT CAUSE of slowness)

The sync and scheduler both write to the `tasks` table. The scheduler runs via `enqueueScheduleRun()` triggered by SSE events. If the sync triggers a scheduler run (Phase 5) while the sync itself is still writing, they deadlock with `ER_LOCK_WAIT_TIMEOUT`.

Phase 2 does individual DB writes per ledger row (even with the no-change skip, any changed row does `await db('tasks').update(...)` and `await db('cal_sync_ledger').update(...)`).

Phase 3a batch creates do a single transaction for DB writes, but the per-provider loop is sequential — GCal batch completes, writes to DB, then MSFT batch starts.

### 2. Split Tasks Not Creating Individual Calendar Entries

Split tasks (e.g. a 120-min task the scheduler places as 4x30-min blocks) should create 4 calendar events. Three blockers were identified and fixed but not verified:

**Block A (fixed):** `processedTaskIds2` — Phase 2 marks ledgered tasks as processed. Split deletion loop now calls `processedTaskIds2.delete(sTask.id)`.

**Block B (fixed):** `existingEvId` check — Split deletion loop now clears `task[eventIdCol] = null` in DB and in-memory. The `existingEvId` check also has `!splitReplacedIds.has(newTask.id)` bypass.

**Block C (fixed):** `ledgeredTaskIds2` — Split deletion loop calls `ledgeredTaskIds2.delete(sTask.id)`.

**Still untested end-to-end** because every sync attempt hits DB contention.

### 3. Placed Duration Correction

Code was added to read `placedDurations` from the schedule cache and apply to tasks. Also fixed `JSON.parse` on already-parsed objects (`typeof check`). Untested.

## The Agreed-Upon Refactor: In-Memory Sync

The user and I agreed on this approach to eliminate DB contention:

### Design

1. **Load phase** — Load all tasks + ledger + placement cache into memory at sync start
2. **API phase** — Do ALL calendar API work (fetches, creates, updates, deletes) against in-memory data. No DB writes. This is where 95% of the time is spent.
3. **Write phase** — At the end, write ALL changes in ONE transaction:
   - Task event_id updates
   - Ledger inserts/updates
   - Sync history inserts
   - Hash updates
4. **Conflict detection** — If a `tasks:changed` SSE event fires mid-sync (MCP/user edit), compare `updated_at` before writing. If changed, skip that task's update.

### Benefits

- Scheduler can run freely during API phase (sync isn't touching DB)
- No `ER_LOCK_WAIT_TIMEOUT`
- Single transaction at the end is fast (bulk insert)
- Split task expansion works naturally (all in memory)

### Implementation Notes

- The sync controller currently does `await db(...)` scattered throughout Phases 2, 3a, 3b
- Refactor: collect all DB mutations into arrays (`taskUpdates[]`, `ledgerInserts[]`, `ledgerUpdates[]`, `historyInserts[]`)
- At the end: `await db.transaction(async function(trx) { /* bulk write everything */ })`
- The `logSyncAction()` helper should push to an array instead of inserting immediately
- The in-memory task refresh (for cross-provider consistency) already works since it mutates the in-memory `task` object

### What to Watch Out For

- Phase 3b creates new tasks from provider events — these need to be inserted in the final transaction, not during the API phase
- Split task `_part` IDs are synthetic — they don't exist in the `tasks` table, only in the ledger
- The `enqueueScheduleRun` at the end of sync should still fire AFTER the transaction commits
- The `preSyncMaxUpdatedAt` watermark for affected-task detection needs to be captured before the final write

## Other Context

- User timezone: `America/New_York`
- `dateStrings: true` in knex config — timestamps come back as strings without timezone info
- MySQL `timezone: '+00:00'` — all timestamps stored in UTC
- `rowToTask()` in `task.controller.js` converts DB rows to frontend task format
- Recurring instances have empty `text` — resolved from `source_id` template
- The placement cache is stored as JSON in `user_config` but MySQL returns it as a parsed object (not a string)
- `nodemon.json` has `"signal": "SIGKILL"` — immediate kill on restart
- Auto-sync in `AppLayout.jsx` checks `gcalAutoSync && msftCalAutoSync` state — currently both `false` in DB
- The `CalSyncPanel` listens for `sync:progress` SSE via `window.__jugglerEventSource`

## Mutation Decision Table (from original plan)

| # | External Mutation | Behavior |
|---|---|---|
| 1 | Event moved, same day | Promote to `when: 'fixed'` |
| 2 | Event moved, different day | Promote to `when: 'fixed'` + `date_pinned: 1` |
| 3 | Duration changed | Update `dur` |
| 4 | Title changed | Update `text` |
| 5 | Event deleted | 3-miss threshold, then delete task |
| 6 | Made all-day | Set `when: 'allday'` |
| 7 | Made timed (was all-day) | Promote to `when: 'fixed'` |
| 8 | New event from provider | Create task with `when: 'fixed'`, `rigid: 1` |
| 9 | Recurrence changed | Per-instance handling |
| 10 | Transparency changed | Detected via hash, `marker` cleared/set |

Dependency violations from promotion: NOT auto-removed. Scheduler emits `backwardsDep` warning. Conflicts View shows it. User resolves manually.
