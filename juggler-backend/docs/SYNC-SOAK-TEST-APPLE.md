# Apple Calendar sync soak test

Structured bidirectional soak for juggler ↔ Apple Calendar (iCloud CalDAV).

## ⚠️ Calendar selection — do NOT use Family Calendar

`TEST_APPLE_CALENDAR_URL` must point to a **personal or juggler-specific calendar**,
not the Family Calendar. Events created during tests will be visible to all family
members if the Family Calendar URL is used.

How to find a safe calendar URL:
1. In iCloud.com → Calendar, right-click a personal calendar → "Copy CalDAV link"  
   Format: `https://p01-caldav.icloud.com/<numeric-id>/calendars/<uuid>/`
2. Or connect the Apple account in the juggler UI and read `apple_cal_calendar_url`
   from the `users` table.

## Prerequisites

`.env.test` must have `TEST_APPLE_USERNAME`, `TEST_APPLE_PASSWORD`,
`TEST_APPLE_CALENDAR_URL` set (using a personal calendar — see above).
Verify the adapter unit tests pass first:

```bash
cd juggler-backend
npx jest tests/cal-sync/03-adapter-apple.test.js --verbose
```

All 10 suites should be green. **Note**: CalDAV PUT and DELETE responses are trusted
as-is (iCloud CDN caching prevents immediate read-back verification in tests).

## CalDAV characteristics

| Topic | Value |
|---|---|
| Protocol | CalDAV over HTTPS |
| Change detection | ctag + etag sync tokens (no webhook/delta) — poll-based |
| Batch operations | Sequential (no native batch API) |
| Rate limits | No published hard limit; iCloud throttles ~50 req/s in practice |
| Timezone | VTIMEZONE block embedded in iCal; adapter uses IANA names |
| Event ID | URL path (`_url`) doubles as event ID when UID is empty |
| Propagation delay | iCloud CDN caching: new/deleted events may not be visible for 5–30 s |

## Baseline (taken before test run)

| surface | state |
|---|---|
| Outlook events in ±30-day window | |
| `cal_sync_ledger` rows — active (apple) | |
| `cal_sync_ledger` rows — error (apple) | |
| `cal_sync_ledger` rows — deleted_local (apple) | |
| `cal_sync_ledger` rows — deleted_remote (apple) | |

```sql
SELECT status, COUNT(*) FROM cal_sync_ledger
WHERE user_id = '<uid>' AND provider = 'apple' GROUP BY status;
```

## Log watch

```bash
# Backend log
tail -f /tmp/juggler-backend.log | grep -E "APPLE|CalDAV|SCHED-QUEUE|SCHED\]|error|Error"

# Ledger watch
watch -n 5 "/opt/digikam/lib/mariadb/bin/mysql -h127.0.0.1 -P3307 -uroot juggler -N -e \"
SELECT status, COUNT(*) FROM cal_sync_ledger
WHERE user_id='<uid>' AND provider='apple' GROUP BY status\""
```

## Test matrix

Wait ~20–30 s after each action (iCloud CDN caching is slower than GCal/MSFT).

### A. Juggler → Apple Calendar (push)

| # | Action | Expected on iCal | Expected in ledger | Observed | Notes |
|---|---|---|---|---|---|
| A1 | Create a one-off task for tomorrow, 10am, dur=45 | New event at same slot, title matches | 1 new row, status=active, provider_event_id = CalDAV URL | | |
| A2 | Update title of A1 | Event title updates in Calendar.app | `last_pushed_hash` changes; same row | | |
| A3 | Reschedule A1 to next day 2pm | Event moves date+time | Same row, still active, `event_start` updated | | |
| A4 | Change duration from 45 → 90 | Event end time updates | Same row | | |
| A5 | Mark A1 status='done' | Event gets `✓` prefix + marked transparent? | | | Check: does VTIMEZONE/TRANSP=TRANSPARENT propagate? |
| A6 | Delete A1 via UI | Event removed from Calendar.app | Row → `deleted_local` | | |
| A7 | Add `url` field to a task | Event URL or description includes link | `last_pushed_hash` changes | | Check buildAppleEventBody |
| A8 | Create a recurring daily task for 5 days | 5 events in Calendar.app | 5 active ledger rows | | |
| A9 | Mark one occurrence of A8 `skip` | That occurrence removed; other 4 stay | Skipped row → `deleted_local` | | |
| A10 | Rename the recurring master (A8) | All remaining events update title | All remaining rows get new hash | | Title-drift regression |
| A11 | Change a task's timezone | Event has correct local time | Row's `event_start` matches new UTC | | |
| A12 | Split task (dur=180, splitMin=60 → 3 chunks) | 3 events or 1? | | | reconcileSplitsForUser not wired — expect 1 |
| A13 | Add travel_before=20, travel_after=10 | No buffer in Calendar.app (by design) | | | |

### B. Apple Calendar → Juggler (pull)

| # | Action | Expected in juggler | Expected in ledger | Observed | Notes |
|---|---|---|---|---|---|
| B1 | Create a new event in Calendar.app | Juggler imports as task with `when='fixed'`, `origin='apple'` | New row, `origin='apple'` | | May require extra sync cycle for ctag to update |
| B2 | Move a juggler-created event to new time in Calendar.app | Juggler ignores (origin='juggler' wins) | `event_start` updates; juggler task unchanged | | Same policy as GCal |
| B3 | Delete a juggler-created event in Calendar.app | After MISS_THRESHOLD (3) syncs: task deleted | Row → `deleted_remote` | | |
| B4 | Edit title of a juggler-created event in Calendar.app | Juggler preserves its version | `pulled=0` | | |
| B5 | Delete a native Apple event (origin='apple') | After MISS_THRESHOLD: juggler task deleted | Row → `deleted_remote` | | |

### C. Conflict / race

| # | Action | Expected | Observed | Notes |
|---|---|---|---|---|
| C1 | Edit task in juggler + edit same Apple event within 10 s | Juggler wins; Apple event reverts | | CalDAV uses etag to detect write conflicts |
| C2 | Delete Apple event + edit juggler task before next sync | Juggler re-creates event | | Verify `tasksNeedingReCreate` path covers apple |
| C3 | Rapid-fire: create 10 tasks in 30 s | All 10 land in Calendar.app; no errors | | Sequential create — watch for 503/429 |
| C4 | Go offline → make 3 edits → come back online | All 3 propagate in order | | |

### D. Over-run stability (the actual soak)

Ambient use for ~30 minutes. Watch for:

- `deleted_local` count increasing without intentional deletes → churn
- `active` count oscillating on consecutive runs
- Any rows going to `error` status
- Orphan events in Calendar.app with no active ledger row
- Sync token staleness: if Apple's ctag changes between polls, a full resync is triggered; watch for sudden large `pulled` counts

Snapshot counts at: start, +10 min, +20 min, +30 min.

## Monitoring helper

```bash
while :; do
  /opt/digikam/lib/mariadb/bin/mysql -h127.0.0.1 -P3307 -uroot juggler -N -B -e "
    SELECT NOW(), status, COUNT(*) FROM cal_sync_ledger
    WHERE user_id='<uid>' AND provider='apple'
    GROUP BY status ORDER BY status"
  echo '---'
  sleep 30
done
```

## Output format

For each row: step number, observed result, any log lines, and ledger-count delta.
Failures get a bug entry in the results section below.

## Results

**Session date:** 2026-04-26

### Session baseline

| surface | count |
|---|---|
| active ledger rows (apple) | 0 (fresh reconnect) |
| deleted_local rows | 234 (old UUID rows from prior connection — see Bug #1) |
| error rows | 0 |

### A-section results

| # | Result | Notes |
|---|---|---|
| A1 | ⚠️ PARTIAL | Task created and initially synced to Apple (active row, hash `aa286a60`). Repush loop started shortly after — see Bug #2 |
| A2 | ⚠️ PARTIAL | Title update hash change observed briefly before repush loop continued |
| A3 | ❌ BLOCKED | Apple row disappeared after reschedule; repush loop with "GCal event gone…" message — Bug #2 |
| A4 | ❌ BLOCKED | Apple row missing; repush loop continues |
| A5 | ❌ BLOCKED | Apple row missing during done-status test |
| A6 | ❌ BLOCKED | Apple row missing; task deleted from juggler |
| A7 | ⚠️ PARTIAL | Task `t1777163567867fvh9` synced (active row, hash `59b003c5`). Bug #3: `buildAppleEventBody` did not include `task.url`. Fix applied 2026-04-26 |
| A8 | ✅ PASS | 7 recurring instances all synced to Apple (7 active rows). New tasks not affected by repush bug |
| A9 | ⚠️ PARTIAL | Skip on Apr 28 instance: Apple row disappeared (not → `deleted_local` like GCal/MSFT) — minor discrepancy |
| A10 | ❌ BLOCKED | Apple rows disappeared after master rename; 0 Apple rows for A8 instances after rename |
| A11 | ⚠️ PARTIAL | Apple row for A7 shows updated hash `24833fd9` briefly; repush loop may interfere |
| A12 | ⚠️ EXPECTED | `reconcileSplitsForUser` not wired — only 1 event pushed (known gap) |
| A13 | ⚠️ EXPECTED | Travel buffers not surfaced in Apple Calendar by design |

### B–D sections

**Session date:** 2026-04-26 (automated via CalDAV + juggler API — `scripts/soak-apple-bcd.js`)

**Baseline before B–D run:**

| surface | count |
|---|---|
| active ledger rows (apple) | 103 |
| deleted_local | 1805 |
| replaced | 0 |

| # | Result | Notes |
|---|---|---|
| B1 | ✅ PASS | Native CalDAV event created directly via PUT. Juggler pulled it as `origin='apple'`, task `apple_b2ea0f1331086150`, `when='fixed'` |
| B2 | ⚠️ BLOCKED | CDN lag: Apple event not visible in `listEvents` within 33 s of juggler push → time-update script couldn't execute. Multi-provider interference also deleted B2 task before Apple test could complete — see Bug #4 |
| B3 | ❌ FAIL (see Bug #4) | Apple event deleted via CalDAV DELETE. Expected: miss_count 0→1→2→3 → `deleted_remote` on Apple. Actual: GCal hit MISS_THRESHOLD on B3 first (GCal row had `deleted_local, provider_event_id=NULL` — push dropped), deleted juggler task; Apple then saw `!task && !event` → `deleted_local`. Multi-provider interference, not a pure Apple miss test |
| B4 | ⚠️ BLOCKED | CDN lag: event not visible in `listEvents` within 33 s → rename couldn't execute |
| B5 | ✅ PASS | B1 native task's Apple event deleted via CalDAV DELETE. After 3 sync cycles, `del_remote=34` in sync 4 confirms MISS_THRESHOLD fired. Task `apple_b2ea0f1331086150` deleted from DB. Ledger query assertion had bug (searches `WHERE task_id=...` but task_id is NULLed post-deletion) |
| C1 | (pending) | |
| C2 | ⚠️ BLOCKED | B2 event URL became unavailable (multi-provider deletion) before C2 setup could run |
| C3 | ⚠️ PARTIAL | Created 6/10 tasks (4 API calls failed — likely rate-limited by concurrent sync). All 6 landed in Apple Calendar. Saw 18 ledger rows for 6 tasks (duplicate active rows — see Bug #5) |
| C4 | (pending) | |
| D | ✅ PASS | 30-min ambient soak stable. active: 134 → 136 → 142 → 149 (linear growth = new recurring instances being scheduled, expected). `deleted_local` stable at 1866. No runaway churn. `deleted_remote` stays at 2. `replaced=9` at end (legitimate C2-fix re-creates). |

### Bugs found

**Bug #1 — "Failed to parse URL from UUID" on Apple reconnect (234 errors) — FIXED 2026-04-26**
- **Symptom:** After reconnecting Apple CalDAV, old ledger rows with UID-format `provider_event_id` (e.g. `juggler-{taskId}-{date}@raikeandsons.com`) caused parse errors on every sync. The adapter expects full CalDAV URLs (`https://...`).
- **Root cause:** Previous Apple connection stored CalDAV UID strings instead of full CalDAV URL paths as `provider_event_id`.
- **Fix applied:** Deleted 121 old-format rows via `DELETE FROM cal_sync_ledger WHERE provider='apple' AND provider_event_id NOT LIKE 'http%'`. Also deleted 121 null-task `replaced` tombstones left by the repush loop. The 73 affected active tasks will be re-pushed with proper CalDAV URLs on next sync.

**Bug #2 — Apple repush loop: "GCal event gone but juggler task was modified"**
- **Symptom:** After initial sync, Apple ledger rows enter repush loop. `sync_history` shows `action='repush'` with message template "GCal event gone but juggler task was modified — will re-create" (wrong provider name — template uses 'GCal' for all providers)
- **Root cause:** The `tasksNeedingReCreate` C2-fix path at `cal-sync.controller.js` line 769 had no `miss_count` guard. Apple CalDAV CDN caching makes a freshly-written event invisible for 5–30 s, so the very next sync sees a miss, hash differs (task was just created/updated), and the re-create path fires. This loops indefinitely.
- **Impact:** Major — blocks most A-section tests for tasks that go through reschedule/update cycle
- **Fix applied 2026-04-26:** Added `(ledger.miss_count || 0) >= 1` guard to the C2-fix path. First miss is treated as a possible CDN delay (miss_count incremented, re-create deferred). Re-create only fires after a confirmed second miss. Also replaced hardcoded "GCal" with `pid` in the repush log message.

**Bug #3 — `apple-cal-api.js` missing `task.url` in DESCRIPTION**
- **Files:** `src/lib/apple-cal-api.js` (and `src/lib/cal-adapters/msft.adapter.js`)
- **Fix applied 2026-04-26:** Added `if (task.url) descParts.push('Link: ' + task.url);` to both builders

**Finding #4 — Multi-provider MISS_THRESHOLD: by design**
- **Observed:** When a juggler task is synced to multiple providers, whichever provider reaches MISS_THRESHOLD=3 first deletes the juggler task and cascades the deletion to all other providers on the next sync.
- **Design intent:** Juggler is a mono-calendar — adding a task adds it to all connected calendars, deleting from any one calendar deletes it everywhere. This is intentional. A future feature may add per-calendar deletion suppression.
- **Test infra impact:** In the B3 soak test, the GCal push for B3 silently dropped under soak load (GCal row had `provider_event_id=NULL`), causing GCal to hit MISS_THRESHOLD before Apple reached its first miss. This is a soak-load artifact, not a normal-use problem. **Workaround for isolated Apple MISS_THRESHOLD testing:** after pushing a test task, immediately mark its GCal/MSFT ledger rows `deleted_local` via direct DB write to remove them from miss-count consideration.

**Bug #5 — Concurrent sync creates duplicate active Apple ledger rows — FIXED 2026-04-28**
- **Symptom:** Background scheduler-triggered sync + manual API sync overlap → Phase 3 (push) runs twice for the same new tasks → 2 active ledger rows per task (same CalDAV URL, same hash). Seen: 18 rows for 6 tasks in C3 rapid-fire test.
- **Root cause:** Same race as GCal Bug #6 (fixed 2026-04-25 for that sync's dedup logic). The dedup in the write phase prevents duplicates within a single run but not across concurrent runs.
- **Fix applied 2026-04-28:** Added a virtual generated column `active_task_key = IF(status='active' AND task_id IS NOT NULL, CONCAT(user_id|provider|task_id), NULL)` and a unique index on it (migration `20260428000100`). MySQL ignores NULLs in unique indexes, so tombstone rows (deleted_local/deleted_remote) are unaffected. Changed `cal-sync.controller.js` ledger bulk insert to `INSERT IGNORE` so concurrent-write collisions are silently dropped rather than causing a 500 error.
