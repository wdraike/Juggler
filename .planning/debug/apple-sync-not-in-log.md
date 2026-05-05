---
slug: apple-sync-not-in-log
status: root_cause_found
trigger: Apple CalDAV sync is completely absent from the sync log — not even an error row
goal: find_and_fix
created: 2026-05-04
---

## Symptoms

1. Apple CalDAV sync is completely absent from the sync log — not even an error row appears
2. Google sync shows up in the log; Apple does not
3. Two Apple calendars are enabled (Family Shared + Calendar), neither produces a log entry
4. isConnected() returns true (apple_cal_username, apple_cal_password, apple_cal_calendar_url all present)
5. Apple adapter IS registered in cal-adapters/index.js
6. sync_history table exists but does NOT have a 'started_at' column (query with that column failed)

## Investigation Findings

1. apple_cal_password is stored as a properly-formed AES-256-GCM JSON blob {iv, tag, ct} — decryption succeeds
2. CREDENTIAL_ENCRYPTION_KEY is set correctly in .env (64-char hex)
3. createClient() (tsdav createDAVClient) makes a real HTTP request to caldav.icloud.com and SUCCEEDS — returns a valid client
4. adapter.listEvents() for Apple SUCCEEDS — returns 17 events from the two enabled calendars
5. Apple has 455,765 rows in sync_history historically — more than GCal (221K)
6. Apple appeared in runs ed2153c3 (22:21) with action=deleted_local and 3a0e9006 (22:19) with action=pushed
7. The 6 most recent sync runs (22:23 onward) show only gcal and msft — Apple is absent
8. GCal pulls 90-116 events per run (ingest-only, always writes rows). Apple has no such guaranteed activity.
9. cal_sync_ledger has 4,218 Apple rows with last_pushed_hash set — all steady-state
10. logSyncAction() is only called when an action occurs: push, pull, conflict, delete, error — NEVER for quiet "no change" syncs
11. There is NO per-provider "sync_ran" summary row written to sync_history

## Root Cause

Apple sync IS working end-to-end. The bug is a visibility gap in the sync_history write strategy:

`logSyncAction()` is only called when something changes. For a fully-in-sync Apple calendar where all 4218 ledger hashes match (steady state), Apple processes its ledger loop silently and contributes zero rows to `sync_history`. The sync log UI then shows zero rows for Apple in those runs, making it appear Apple was skipped entirely.

GCal and MSFT appear in every run because they are ingest-only providers that continually pull calendar events as Juggler tasks — they always have "pulled" rows. Apple in full-sync mode only logs when a task changes or a new event arrives.

## Fix

Add a per-provider `sync_ran` summary row to `sync_history` at the end of each sync run, for every provider that was in `validAdapters` (passed Phase 1 token validation). This gives the user visibility that Apple was checked even when nothing changed.

Location to add: in `cal-sync.controller.js` just before the write phase transaction commits `historyInserts`. After the main ledger/push loops complete, for each provider in `providerIds`, if no `historyInserts` rows exist for that provider yet, push a synthetic `sync_ran` row.

## Current Focus

hypothesis: CONFIRMED — Apple sync is working but produces no sync_history rows during steady-state (hash-match) syncs
next_action: Add sync_ran summary rows per provider to make quiet syncs visible in the log

## Evidence

- timestamp: 2026-05-04T22:30:00Z
  type: db_query
  finding: Apple has 455,765 sync_history rows historically; GCal has 221,753
- timestamp: 2026-05-04T22:30:00Z
  type: db_query
  finding: 8 most recent runs all missing Apple; runs before that show Apple with pushed/deleted_local
- timestamp: 2026-05-04T22:30:00Z
  type: code_trace
  finding: logSyncAction() called ONLY for push/pull/conflict/delete/error — no "quiet sync" row
- timestamp: 2026-05-04T22:30:00Z
  type: live_test
  finding: createClient() succeeds; listEvents() returns 17 events — Apple connection is healthy
- timestamp: 2026-05-04T22:30:00Z
  type: db_query
  finding: cal_sync_ledger has 4,218 Apple rows (active, juggler origin) — all with hashes set

## Resolution

root_cause: Apple sync is working correctly but sync_history only records activity rows (push/pull/error/delete). When all Apple tasks are steady-state (hash matches), zero rows are written for Apple, making it invisible in the log UI. GCal/MSFT always appear because they are ingest-only and pull calendar events as tasks on every run.
fix: Add a per-provider 'sync_ran' summary row to sync_history for every provider that completed Phase 1 (in validAdapters), even if it had no actionable changes. This closes the visibility gap without changing sync behavior.
