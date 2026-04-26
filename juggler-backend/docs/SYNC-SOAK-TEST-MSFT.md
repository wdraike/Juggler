# MSFT Calendar sync soak test

Structured bidirectional soak for juggler ↔ Microsoft Calendar (Outlook/Teams).
Mirrors the GCal soak structure — same test matrix, MSFT-specific details noted inline.
Execute each step in the UI + on Outlook; I monitor the backend log + ledger and report
observable signals.

## Prerequisites

`.env.test` must have `TEST_MSFT_REFRESH_TOKEN`, `MICROSOFT_CLIENT_ID`,
`MICROSOFT_CLIENT_SECRET` set. Verify the adapter unit tests pass first:

```bash
cd juggler-backend
npx jest tests/cal-sync/02-adapter-msft.test.js --verbose
```

All 12 suites should be green before starting the soak.

## Baseline (taken before test run)

| surface | state |
|---|---|
| Outlook events in ±30-day window | |
| `cal_sync_ledger` rows — active (msft) | |
| `cal_sync_ledger` rows — error (msft) | |
| `cal_sync_ledger` rows — deleted_local (msft) | |
| `cal_sync_ledger` rows — deleted_remote (msft) | |

Snapshot before each test run:

```sql
SELECT status, COUNT(*) FROM cal_sync_ledger
WHERE user_id = '<uid>' AND provider = 'msft' GROUP BY status;
```

## Log watch

```bash
# Backend log — MSFT sync + scheduler lines
tail -f /tmp/juggler-backend.log | grep -E "MSFT|SCHED-QUEUE|SCHED\]|error|Error"

# Ledger watch
watch -n 5 "/opt/digikam/lib/mariadb/bin/mysql -h127.0.0.1 -P3307 -uroot juggler -N -e \"
SELECT status, COUNT(*) FROM cal_sync_ledger
WHERE user_id='<uid>' AND provider='msft' GROUP BY status\""
```

## Test matrix

Wait ~15 s after each action for the sync cycle to complete.

### A. Juggler → MSFT (push)

| # | Action | Expected on Outlook | Expected in ledger | Observed | Notes |
|---|---|---|---|---|---|
| A1 | Create a one-off task for tomorrow, 10am, dur=45 | New event at same slot, title matches, `showAs=busy` | 1 new row, status=active, provider_event_id set | | |
| A2 | Update title of A1 | Event title updates in Outlook | `last_pushed_hash` changes; same row | | |
| A3 | Reschedule A1 to next day 2pm | Event moves date+time in Outlook | Same row, still active, `event_start` updated | | |
| A4 | Change duration of A1 from 45 → 90 | Event end time pushed in Outlook | Same row | | |
| A5 | Mark A1 status='done' | Event gets `✓` prefix + `showAs=free` (transparent) | Row stays active or transitions? | | Policy: update vs. remove |
| A6 | Delete A1 via UI | Event removed from Outlook | Row → `deleted_local` | | |
| A7 | Add `url` field to a task | Event body in Outlook includes link | `last_pushed_hash` changes | | Check buildMsftEventBody |
| A8 | Create a recurring daily task for 5 days | 5 events in Outlook, same title, each day | 5 active ledger rows | | |
| A9 | Mark one occurrence of A8 `skip` | That occurrence removed from Outlook; other 4 stay | Skipped row → `deleted_local` | | |
| A10 | Rename the recurring master (A8) | All remaining Outlook events update titles | All remaining rows get new hash | | Regression test for title drift |
| A11 | Change a task's timezone | Event in Outlook has correct local time | Row's `event_start` matches new UTC | | MSFT uses Windows tz names internally |
| A12 | Split task (dur=180, splitMin=60 → 3 chunks) | 3 events in Outlook? or 1? | 3 rows or 1? | | Same gap as GCal: reconcileSplitsForUser not wired |
| A13 | Add travel_before=20, travel_after=10 | No buffer surfaced in Outlook (by design) | | | |

### B. MSFT → Juggler (pull)

| # | Action | Expected in juggler | Expected in ledger | Observed | Notes |
|---|---|---|---|---|---|
| B1 | Create a new event in Outlook | Juggler imports as task with `when='fixed'`, `origin='msft'` | New row, `origin='msft'` | | |
| B2 | Move a juggler-created event to new time in Outlook | Juggler ignores (origin='juggler' wins) | `event_start` updates in ledger; juggler task unchanged | | Same policy as GCal |
| B3 | Delete a juggler-created event in Outlook | After MISS_THRESHOLD (3) syncs: task deleted | Row → `deleted_remote` | | |
| B4 | Edit title of a juggler-created event in Outlook | Juggler preserves its version (no pull) | `pulled=0` | | juggler always wins |
| B5 | Decline a juggler-created event (add attendee first, then decline) | Juggler reflects or ignores? | | | MSFT uses `responseStatus` |

### C. Conflict / race

| # | Action | Expected | Observed | Notes |
|---|---|---|---|---|
| C1 | Edit task in juggler + edit same Outlook event within 10 s | Juggler wins; Outlook reverts to juggler's version | | |
| C2 | Delete on Outlook + edit in juggler before next sync | Juggler re-creates event (fix from GCal #C2) | | Verify the `tasksNeedingReCreate` fix covers MSFT |
| C3 | Rapid-fire: create 10 tasks in 30 s | All 10 land in Outlook; no errors | | MSFT Graph throttle is more generous than GCal 600 QPM |
| C4 | Go offline → make 3 edits → come back online | All 3 propagate to Outlook in order | | |

### D. Over-run stability (the actual soak)

Ambient use for ~30 minutes. Watch for:

- `deleted_local` count increasing without intentional deletes → churn
- `active` count oscillating on consecutive runs
- Any rows going to `error` status (Graph API errors)
- Orphan events appearing in Outlook with no matching active ledger
- Delta-link staleness: MSFT delta links expire after 30 days; watch for `410 Gone` errors

Snapshot counts at: start, +10 min, +20 min, +30 min.

## Monitoring helper

```bash
while :; do
  /opt/digikam/lib/mariadb/bin/mysql -h127.0.0.1 -P3307 -uroot juggler -N -B -e "
    SELECT NOW(), status, COUNT(*) FROM cal_sync_ledger
    WHERE user_id='<uid>' AND provider='msft'
    GROUP BY status ORDER BY status"
  echo '---'
  sleep 30
done
```

## MSFT-specific differences vs GCal

| Topic | GCal | MSFT |
|---|---|---|
| Change detection | `nextSyncToken` | Delta link (`@odata.deltaLink`), expires in 30 days |
| Rate limits | 600 QPM (tight) | 10,000 req / 10 min per app (generous) |
| Batch API | Multipart HTTP batch | JSON `$batch` (up to 20 req/call) |
| Timezone field | IANA strings (`America/New_York`) | Windows tz names (`Eastern Standard Time`) |
| Transparent events | `transparency: 'transparent'` | `showAs: 'free'` |
| Time precision | ISO 8601 milliseconds | 7-digit fractional seconds (truncated in adapter) |
| Event ID | Stable string | Stable string |

## Output format

For each row: step number, observed result, any log lines, and ledger-count delta.
Failures get a bug entry in the results section below.

## Results

**Session date:** 2026-04-26

### Session baseline

| surface | count |
|---|---|
| active ledger rows (msft) | 0 (fresh) |
| deleted_local rows | 0 |
| error rows | 0 |

### A-section results

| # | Result | Notes |
|---|---|---|
| A1 | ✅ PASS | Task `t1777162110303wj1v` created Apr 26 10:00 AM EDT, 45 min. MSFT event synced, hash `aa286a60` |
| A2 | ✅ PASS | Title updated → "…Updated Title". Hash `aa286a → f4a020` on MSFT |
| A3 | ✅ PASS | Rescheduled Apr 27 2 PM EDT. MSFT `event_start = 2026-04-27T18:00:00Z`, hash `f4a020 → b45ac7` |
| A4 | ✅ PASS | Duration 45→90 min. End time 2:45→3:30 PM. Hash `b45ac7 → 49a902` |
| A5 | ✅ PASS | Status=done. Hash `49a902 → cba5a8`. Code path: `✓` prefix + `showAs=free` pushed via update mode |
| A6 | ✅ PASS | Task deleted. MSFT ledger → `deleted_local` (task_id=NULL). Calendar event removed by orphan_cleanup on next sync |
| A7 | ✅ PASS (after fix) | URL `https://raike.app/soak-test-a7` synced to MSFT event body as "Link: …" after fixing `buildMsftEventBody` to include `task.url` |
| A8 | ✅ PASS | Recurring daily (Apr 26–May 2). 7 instances created and synced. 7 active ledger rows on MSFT |
| A9 | ✅ PASS | Apr 28 occurrence marked `skip`. MSFT ledger row → `deleted_local`. Other 6 remain active |
| A10 | ✅ PASS | Master renamed → "…— Renamed". All 6 remaining MSFT events updated. Hash changed on all rows |
| A11 | ✅ PASS | Task tz changed to America/Los_Angeles. MSFT `event_start` updated to new UTC offset. Hash changed |
| A12 | ⚠️ EXPECTED | `reconcileSplitsForUser` not wired to cal-sync — only 1 event pushed per split task (known gap) |
| A13 | ⚠️ EXPECTED | Travel buffers not surfaced in MSFT by design |

### B–D sections

| # | Result |
|---|---|
| B1 | (pending) |
| B2 | (pending) |
| B3 | (pending) |
| B4 | (pending) |
| B5 | (pending) |
| C1 | (pending) |
| C2 | (pending) |
| C3 | (pending) |
| C4 | (pending) |
| D | (pending) |

### Bugs found

**Bug #1 — `buildMsftEventBody` / `buildAppleEventBody` missing `task.url`**
- **Files:** `src/lib/cal-adapters/msft.adapter.js`, `src/lib/apple-cal-api.js`
- **Fix applied 2026-04-26:** Added `if (task.url) descParts.push('Link: ' + task.url);` to both builders (matches existing GCal behavior)

**Bug #2 — Apple repush loop on task rescheduled from prior session**
- **Symptom:** Task `t1777162110303wj1v` (and others from prior Apple connection) entered an infinite repush loop after reconnecting Apple. `sync_history` shows repeated `repush` actions with detail "GCal event gone but juggler task was modified — will re-create" (wrong provider name in message template)
- **Root cause:** Old ledger rows stored bare UUIDs as `provider_event_id` instead of full CalDAV URLs. The C2-fix's tasksNeedingReCreate logic triggers on these invalid rows
- **Impact:** Affects reconnected Apple accounts with old ledger data; new tasks sync cleanly (A8 instances all worked)
