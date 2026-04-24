# GCal sync soak test — #33

Structured bidirectional soak for juggler ↔ Google Calendar. User executes
each step in the UI + on GCal; I monitor the backend log + diff the ledger
between steps and report observable signals.

## Baseline (taken 2026-04-24 after cleanup)

| surface | state |
|---|---|
| GCal events in 4/24–5/24 window | 193 |
| `cal_sync_ledger` rows — active (gcal) | 387 |
| `cal_sync_ledger` rows — error (gcal) | 0 |
| `cal_sync_ledger` rows — deleted_local (gcal) | 42,056 (high; watch for new churn) |
| `cal_sync_ledger` rows — deleted_remote (gcal) | 3,175 |
| 1:1 pairing (in-window events ↔ active ledger) | 100% |

Snapshot this baseline before each test run so deltas are measurable.

```sql
-- Run before a test: record current counts
SELECT provider, status, COUNT(*) FROM cal_sync_ledger
WHERE user_id = '<uid>' AND provider = 'gcal' GROUP BY status;
-- Run after: diff the rows
```

## Log watch

Tail these in parallel during every test:

```bash
# All sync + scheduler lines
tail -f /tmp/juggler-backend.log | grep -E "GCAL|SCHED-QUEUE|SCHED\]|error|Error"
# Ledger transitions
watch -n 5 "/opt/digikam/lib/mariadb/bin/mysql -h127.0.0.1 -P3307 -uroot juggler -N -e \"
SELECT status, COUNT(*) FROM cal_sync_ledger
WHERE user_id='019d29f9-9ef9-74eb-af2d-0418237d0bd9' AND provider='gcal' GROUP BY status\""
```

## Test matrix

For each row: execute the action, wait ~15 s for the sync cycle to complete,
then record observed result. `Expected` columns describe what a correct
implementation should do; `Observed` gets filled in during the run.

### A. Juggler → GCal (push)

Create/update/delete tasks in juggler, verify GCal reflects them.

| # | Action | Expected on GCal | Expected in ledger | Notes |
|---|---|---|---|---|
| A1 | Create a one-off task for tomorrow, 10am, dur=45 | New event appears on GCal at same slot, title matches | 1 new row, status=active, provider_event_id set | Most basic path |
| A2 | Update title of A1 | Event title on GCal updates | `last_pushed_hash` changes; same row | **Known title-drift bug** — may fail |
| A3 | Reschedule A1 to next day 2pm | Event on GCal moves date+time | Same row, still active, `event_start` updated | |
| A4 | Change duration of A1 from 45 → 90 | Event end time pushed on GCal | Same row | |
| A5 | Mark A1 status='done' in juggler | Event stays (so history is visible), or removed per policy | Row transitions to `deleted_local`? or stays active? | Clarify policy |
| A6 | Delete A1 via UI | Event removed from GCal | Row → `deleted_local` | Standard delete |
| A7 | Add `url` field to a task | Event description on GCal includes link | `last_pushed_hash` changes | Tests new URL surface |
| A8 | Create a recurring daily task for 5 days | 5 events on GCal, same title, each day | 5 active ledger rows, one per instance | Tests recurring expansion push |
| A9 | Mark one occurrence of A8 `skip` | That occurrence removed from GCal; other 4 stay | Skipped row → `deleted_local`; others active | |
| A10 | Rename the recurring master (A8) | All remaining events on GCal update titles | All remaining rows get new `last_pushed_hash` | **Regression test** for the title-drift bug |
| A11 | Change a task's timezone | Event on GCal has correct local time | Row's `event_start` matches new UTC | |
| A12 | Split task (dur=180, splitMin=60 → 3 chunks) | 3 events on GCal for the same task | 3 rows? 1 row? (clarify: does ledger track per-chunk or per-master?) | Check behavior |
| A13 | Add travel_before=20, travel_after=10 to a task | Event start on GCal stays; maybe `extendedProperties` include buffer? | | Reality check on how buffers surface |

### B. GCal → Juggler (pull)

Create/update/delete events on GCal, verify juggler reflects them.

| # | Action | Expected in juggler | Expected in ledger | Notes |
|---|---|---|---|---|
| B1 | Create a new event on GCal for tomorrow | Juggler imports as a task (or flags it for import?) | New row with `origin='gcal'` (if imported) | Clarify: does juggler pull non-juggler events? |
| B2 | Manually move a juggler-created event to a new time on GCal | Juggler's task scheduled_at follows (or flags as drift?) | `last_pulled_hash` changes | Tests conflict resolution |
| B3 | Manually delete a juggler-created event on GCal | Juggler shows the task as unscheduled (or flags?) | Row → `deleted_remote` | |
| B4 | Manually edit the title of a juggler-created event on GCal | Juggler task title updates (or preserves juggler's version?) | Conflict policy check | |
| B5 | Decline a juggler-created event on GCal | Juggler reflects status (or ignores?) | | |

### C. Conflict / race

| # | Action | Expected | Notes |
|---|---|---|---|
| C1 | Edit task in juggler + edit same GCal event within 10 s | Last-write-wins, loser preserved in error_detail? | Tests `last_pushed_hash` / `last_pulled_hash` tiebreak |
| C2 | Delete on GCal + edit in juggler before next sync | Juggler re-creates the event (task still lives) OR accepts delete | Policy question |
| C3 | Rapid-fire: create 10 tasks in 30 seconds | All 10 land on GCal; no 429/403 errors | Watches rate-limit behavior |
| C4 | Go offline → make 3 edits → come back online | All 3 propagate to GCal in order | Tests the write-queue |

### D. Over-run stability (the actual soak)

Ambient use for ~30 minutes. Watch for:

- `deleted_local` count increasing when nothing was intentionally deleted
  → churn bug (events being created then deleted on every sync)
- `active` count oscillating (+1 / −1 / +1 pattern on consecutive runs)
- Any rows going to `error` status
- Any orphan events appearing on GCal (events with no matching active ledger)
- Any ledger-active rows pointing to events that disappeared from GCal
  without status change

Snapshot counts at: start, +10 min, +20 min, +30 min. Flag any trend.

## Monitoring helper

Paste this into a terminal to get a one-line status ping every 30 s:

```bash
while :; do
  /opt/digikam/lib/mariadb/bin/mysql -h127.0.0.1 -P3307 -uroot juggler -N -B -e "
    SELECT NOW(), status, COUNT(*) FROM cal_sync_ledger
    WHERE user_id='019d29f9-9ef9-74eb-af2d-0418237d0bd9' AND provider='gcal'
    GROUP BY status ORDER BY status"
  echo '---'
  sleep 30
done
```

## Output format

As each row runs, report to me: step number, observed result, any log
lines that caught your eye, and any ledger-count delta from the prior
snapshot. I'll correlate against backend logs and flag bugs as we go.
Anything that fails gets a separate issue or goes onto the #33 list.

## Known-or-suspected issues going in (from audit)

- **Title drift**: `Take morning prescriptions` GCal events persist under
  an old title; the corresponding juggler task is now `Take Morning
  Medications`. Covered by A2 + A10.
- **High `deleted_local` history** (42,056 rows): may reflect churn from
  past recurring-reconcile behavior. Watch in section D.
- **No per-provider sync-health telemetry surfaced** — everything's in the
  DB. Consider a view / endpoint after the soak if this test makes it
  painful to audit.
