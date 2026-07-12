# HANDOVER — split-chunk collision resurfaced after the preferLatestSlot fix

**Status:** OPEN — investigation only, no fix applied. Root-cause confidence: LOW.
**Date:** 2026-07-12
**Severity:** scheduler-core, data-corruption class (see juggler/CLAUDE.md caution note)

## What happened

Earlier today (session `juggler-overdue-flex-reschedule`, commit `4bca8523` /
superrepo `c856423f4`), removed an undocumented `preferLatestSlot`/`findLatestSlot`
`relaxWhen:true` fallback rung in `unifiedScheduleV2.js` that force-placed
overdue-today flexible recurring instances at the day's last open slot instead of
routing to unscheduled. Fix was TDD'd, adversarially reviewed by zoe (including a
revert/restore cycle proving the tests genuinely exercised the bug), merged, pushed,
and the backend dev server was restarted (~18:17 today, nodemon picked up the fix).

**Then the same symptom reappeared** — David reported it via a screenshot of the
calendar grid showing 3 separate "Apply for Jobs" OVERDUE cards, two with the
IDENTICAL time (10p–11p). DB query confirmed this is **fresh** data, not stale
pre-fix rows:

```
master_id = 019d5dfa-a97c-7152-a799-f21ba1026db2 (recurring daily, split_total=4,
dur=60, placement_mode='anytime'), user_id 019d29f9-9ef9-74eb-af2d-0418237d0bd9

id: ...80060    ordinal:1  scheduled_at: 2026-07-12 23:15:00 UTC  updated_at: 22:15:20
id: ...80060-2  ordinal:2  scheduled_at: 2026-07-13 01:00:00 UTC  updated_at: 22:15:26
id: ...80060-3  ordinal:3  scheduled_at: 2026-07-13 02:00:00 UTC  updated_at: 22:17:14
id: ...80060-4  ordinal:4  scheduled_at: 2026-07-13 02:00:00 UTC  updated_at: 22:15:20
```

Chunks 3 and 4 share the identical `scheduled_at` (10pm EDT — the day's last slot,
same symptom shape as the already-fixed bug). Chunks 1/2/4 updated within 6s of each
other (22:15:20–22:15:26); chunk 3 updated ~2 minutes later (22:17:14) — strongly
suggesting TWO separate scheduler invocations wrote sibling chunks without seeing
each other's just-committed placement, all **after** the fix + restart.

## Investigation so far (count, this session)

**Confirmed:** two independent callers of `runScheduleAndPersist` exist for the same
user and both key off the same `sync_locks` table (should serialize):
- `juggler-backend/src/routes/schedule.routes.js:46` — `POST /api/schedule/run`,
  wrapped in `withSyncLock`.
- `juggler-backend/src/scheduler/scheduleQueue.js:312-336` (`claimAndRun`) — the
  poll-loop/cal-sync/nudge/MCP path, wrapped in `withLock`.

Both funnel through `acquireLock()` in `juggler-backend/src/lib/sync-lock.js:31-60`.
`dev.log` only survives from 22:22:01 onward (the backend restarted then) — the
actual incident window (22:15:20–22:17:14) is **not** in any retained log, so we
could not directly observe which two callers produced this specific collision.

**Two open, blocking ambiguities** (next investigator should resolve first):

1. **Does the cal-sync trigger path go through the same lock, or bypass it?**
   `sync-lock.js`'s own comment claims it "gates all scheduling-relevant writers:
   the scheduler, cal-sync, and (via task-write-queue) user/MCP task mutations" —
   this was **not verified** against the actual calendar adapter code
   (`GoogleCalendarAdapter.js`/`MicrosoftCalendarAdapter.js`/`AppleCalendarAdapter.js`).
   If cal-sync writes/enqueues on a separate, unguarded path, that's a **lock-bypass
   race** — a new, distinct bug from the one already fixed.

2. **Is there a residual "force-place at last slot" fallback specific to split
   chunks**, separate from the removed `preferLatestSlot`/`relaxWhen:true` rung?
   Both colliding chunks landing on the day's literal last slot (10pm EDT) strongly
   resembles the already-fixed bug's symptom class. If a structurally similar
   fallback exists elsewhere in `runSchedule.js`/`unifiedScheduleV2.js` for
   per-chunk placement that the earlier fix's search didn't cover, this is the
   **same bug resurfacing via a different call site**, not a new one — this
   materially changes the fix scope.

## A separate, distinct bug found along the way (own ticket, not the root cause)

`scheduleQueue.js`'s `claimAndRun` (~line 312-336) calls `runWithLock` and does
**not check its return value**. `withLock` (`sync-lock.js:134-136`) returns `null`
without invoking the callback when the lock is busy — but `claimAndRun` proceeds
unconditionally to `dequeueScheduleRun` (sweeps the queue row) and emits
`schedule:changed` as if the run succeeded, even when `runScheduleAndPersist` never
executed. **Silently drops a needed recompute under lock contention.** Worth its own
backlog item regardless of the collision investigation's outcome.

## Recommended next steps (in order)

1. Trace the cal-sync trigger path (from calendar-sync completion to whatever
   enqueues/invokes a reschedule) and confirm whether it acquires the same
   `sync_locks` row as the two confirmed callers. This is the single highest-value
   next check — it determines whether this is a lock-bypass race or something else.
2. Full-text search `runSchedule.js` + `unifiedScheduleV2.js` for any other
   "last slot" / "end of day" / backward-scan fallback affecting split-chunk
   placement specifically (as opposed to whole-instance placement), since the
   symptom (last-slot collision) matches the already-fixed bug's class.
3. If neither of the above resolves it: reproduce live in **test-bed** (not dev),
   not dev/prod — construct a daily recurring split task (split_total=4, dur=60,
   anytime) and fire two independent triggers for the same user in quick succession
   (e.g. `POST /api/schedule/run` + a cal-sync-enqueued run) with a third-party
   write in flight, and assert no two sibling chunks ever receive an identical
   `scheduled_at`.
4. Fix `claimAndRun`'s null-swallow separately (see above) — unrelated to root
   cause but a real correctness gap.

## Files touched by this investigation (read-only, nothing changed)
- `juggler-backend/src/scheduler/scheduleQueue.js`
- `juggler-backend/src/lib/sync-lock.js`
- `juggler-backend/src/routes/schedule.routes.js`
- `juggler-backend/src/scheduler/runSchedule.js`
- `juggler-backend/src/scheduler/reconcileOccurrences.js`
- `juggler-backend/src/scheduler/unifiedScheduleV2.js`
- `juggler-backend/dev.log` (partial coverage only, 22:22:01+)

## Live data note
The colliding rows (`...80060-3`, `...80060-4`) are still sitting in the dev-bed DB
as of this writing (`unscheduled=NULL`, both placed, both overdue, identical
`scheduled_at`). Not yet corrected — leave as-is for the next investigator to use
as a live repro artifact until a fix is designed; a future scheduler run may
overwrite/reconcile them on its own.
