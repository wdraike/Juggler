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

## Results (2026-04-25 run)

### Session baseline
| surface | count |
|---|---|
| active ledger rows (gcal) | 192 |
| deleted_local rows | 42,539 |
| error rows | 0 |

### A-section results

| # | Result | Notes |
|---|---|---|
| A1 | ✅ PASS | Task created, GCal event at Apr 26 10:00–10:45am. Auto-sync via fix #3 (`scheduled_at` localization). |
| A2 | ✅ PASS | Title updated. Hash changed `e1a0f44c→5cae29da`. GCal reflected updated title. |
| A3 | ✅ PASS | Rescheduled to Apr 27 2pm. Hash changed `5cae29da→3a6fecc3`. GCal event moved. |
| A4 | ✅ PASS | Duration changed 45→90min. Explicit sync needed (auto-sync did not run). Hash changed `3a6fecc3→52d09fd2`. GCal end time updated to 3:30pm. |
| A5 | ⚠️ POLICY ESTABLISHED (with bugs) | `calCompletedBehavior='update'` (default). Done task gets ✓ prefix + `transparency='transparent'`. **Bug**: "Mark done → Now" updates `scheduled_at` to completion timestamp, which moves the GCal event from its original slot (Apr 27) to today (Apr 25). Ledger stays `active` post-sync. Sync result showed `pushed=1, deleted_remote=0, deleted_local=0` — counters don't reflect done-task update path. |
| A6 | ✅ PASS | Task + ledger row deleted from DB. GCal event was already moved to Apr 25 by A5; orphan cleanup handled. |
| A7 | ✅ PASS (after fix) | URL was missing — fixed `buildEventBody` in `gcal.adapter.js` to add `Link: <url>` line. Forced re-push by clearing `last_pushed_hash`. GCal now shows "Link: https://example.com/soak-test-a7". |
| A8 | ✅ PASS | Recurring daily task created (master `019dc500-decdc065-7000-a000-e70aaa719dd0`, `recurring=1`, `recur={"type":"daily"}`, `deadline=2026-05-02`). Scheduler expanded to 15 instances (Apr 25 – May 9, today+14). All 15 synced to GCal after one rate-limit retry (initial batch of 49 hit GCal's 600 QPM limit). 15 active ledger rows. Note: `deadline` does not bound expansion; `recur_end` is needed for that. **Side-effects**: discovered and fixed scheduler ordinal-collision bug (#4 below); `POST /api/tasks` with `recurring:true` returns 500 (bug #5). |
| A9 | ✅ PASS | Skipped Apr 27 instance via API `PUT status=skip`. Next sync: Apr 27 GCal event deleted; ledger → `deleted_local`. Other 14 instances unaffected. |
| A10 | ✅ PASS | Renamed master to "GCal Soak Test A10 — Renamed" via API. Sync pushed exactly 14 events, 0 errors. All 14 remaining GCal events show new title. **Title-drift regression confirmed fixed.** |
| A11 | ⚠️ INCONCLUSIVE (2 bugs surfaced) | Task created, pushed to GCal (pushed=1). Two ledger rows were created for same task (bug #6). Changed `tz` to `America/Los_Angeles`. Triggered sync — result: `deleted_remote=1`, task deleted from DB. **Root cause**: row A (`as3p8ahuj1csfggo1bipcqsvhc`) had accumulated `miss_count=3` across prior syncs (event was a GCal orphan or duplicate); threshold crossed → task deleted. Row B (`rp7rvk37hlvb9i8feslisfg06g`) event then cleaned from GCal as `deleted_local`. **Design finding**: changing `task.tz` does NOT affect the GCal event; sync controller uses `userRow.timezone` to localize `scheduled_at`, not `task.tz`. Changing only `tz` produces `pushed=0` (hash unchanged). To move a GCal event to a new timezone the caller must also update `scheduled_at`. |
| A12 | ⚠️ PARTIAL — 1 event, not 3 | Task created (`dur=180, split=true, splitMin=60`). Scheduler placed it as a single 180-min block (GCal event `14lelfdtmc233ddu7hprrm7h3g`, 10:00 AM–1:00 PM Apr 28). Only 1 active ledger row; 1 GCal event. **Root cause**: `reconcileSplitsForUser` in `reconcile-splits.js` is not wired into production code path (file says "Not called from production code yet"). Scheduler places split tasks as single locked blocks in the cache; the sync sees only 1 instance row and creates 1 event. **Design gap**: per-chunk calendar sync is documented as the intent but not yet implemented. |
| A13 | ✅ PASS (with design note) | Task created Apr 29 11:00 AM EDT, dur=60, travelBefore=20, travelAfter=10. GCal event: 11:00 AM–noon EDT. Travel buffers are **not surfaced on GCal** — no start-time shift, no description text, no extendedProperties. They are scheduler-internal placement constraints only. **Minor bug**: `travel_before`/`travel_after` in the POST body (snake_case) are silently ignored — only `travelBefore`/`travelAfter` via PUT is accepted. |

### B–D sections
| # | Result |
|---|---|
| B1 | ✅ PASS | Created native GCal event (2:00–3:00 PM EDT Apr 29, `al4170jhet8nrt50avijh4jp7g`). Next sync: `pulled=1`, task `gcal_0eb41024fd6515e5` created in juggler with `when='fixed'`, `scheduled_at=2026-04-29 18:00:00 UTC` (= 2 PM EDT). Ledger `origin='gcal'`. |
| B2 | ⚠️ DIVERGED — GCal change not pulled | Moved A13's GCal event from 11 AM to 3 PM EDT. Next sync: `pulled=0`. Juggler task `scheduled_at` stayed at 15:00 UTC (11 AM EDT). Ledger `event_start` updated to `2026-04-29T15:00:00-04:00` (3 PM) but juggler task unchanged. **Policy observed**: juggler owns `origin='juggler'` events; GCal time moves are silently ignored, not pulled back. If the juggler task changes later, juggler will push its version back to GCal. Until then, GCal and juggler show different times — persistent divergence with no user notification. |
| B3 | ✅ PASS (MISS_THRESHOLD confirmed) | Deleted A13's GCal event manually. Sync 1: `deleted_remote=0`, `miss_count` incremented to 1. Sync 2 (miss_count→2): `deleted_remote=0`. Sync 3 (miss_count→3=MISS_THRESHOLD): `deleted_remote=1`, task deleted from juggler — "Removed (deleted in Google Calendar)". Juggler respects the delete after 3 consecutive missed syncs. **Note**: same MISS_THRESHOLD path applies to both `origin='juggler'` and `origin='gcal'` events. 3-sync delay means ~90+ seconds minimum before juggler reflects a manual GCal delete. |
| B4 | ⚠️ DIVERGED — GCal title change not pulled | Renamed A12's GCal event to "RENAMED ON GCAL". After sync: `pulled=0`. A12's juggler title unchanged ("GCal Soak Test A12 — Split Task"). GCal event title unchanged (not reverted by juggler push-back). Same policy as B2: juggler owns `origin='juggler'` events and does not pull GCal content edits. Title diverges persistently. |
| B5 | ⚪ N/A — organizer cannot decline own event | Attempted `respond_to_event(declined)` on A12's event. GCal API returned unchanged (organizer has no RSVP to decline when there are no attendees). No change in sync. **B5 requires an event with at least one other attendee to exercise RSVP → status reflection.** |
| C1 | ✅ Juggler wins (no conflict record) | Renamed task in juggler ("C1 Task — Juggler Edit"), then renamed same GCal event ("C1 Task — GCal Edit") within ~10 s. Next sync: `pushed=1`. GCal event reverted to juggler's title. `pulled=0`. No conflict record, no `error_detail`. **Policy**: juggler always wins for `origin='juggler'` events — GCal edit silently discarded. |
| C2 | ⚠️ BUG — juggler edit lost on GCal delete | Deleted GCal event for C3 Task #2, then immediately edited the same task in juggler (new title). Next sync: `pushed=0`. The juggler edit went unacknowledged — because the event is missing, the sync enters the `task && !event` miss_count path and skips the push-new path (task is in `ledgeredTaskIds2`). After MISS_THRESHOLD syncs, juggler will delete the task, discarding the user's edit. **Bug**: when `origin='juggler'` event is deleted on GCal AND the juggler task was subsequently edited, juggler should re-create the GCal event (task is still alive and owned by juggler). Currently, the delete wins and the edit is lost. |
| C3 | ✅ PASS | Created 10 tasks in parallel in ~1 second. All 10 pushed to GCal in one sync batch, 0 errors, 0 rate-limit hits. Batch creation handled cleanly by `batchCreateEvents`. |
| C4 | ⚪ Not tested | Requires offline network simulation (disconnect, edit, reconnect). Cannot simulate in current test environment. |
| D | 🟡 2 bugs confirmed, functionally stable | **t=0 (12:24 UTC)** [all-provider]: active=232, deleted_local=42,554, deleted_remote=3,177, error=0. **+10 min (12:35 UTC)** [all-provider]: active=230, deleted_remote=3,179, deleted_local=42,554, error=0. Manual sync: pushed=10 (hash-mismatch updates from scheduler re-placing flexible tasks), errors=0. **+20 min (12:47 UTC, pre-manual-sync)** [all-provider]: active=230, deleted_local=42,558 (+4), deleted_remote=3,179, error=90 (all GCal rate-limit 403s). **+20 min (12:50 UTC, post-manual-sync)** [GCal only]: GCal active=235, deleted_local=42,570 (+16 from t=0), deleted_remote=3,179 (stable), error=84. Manual sync returned pushed=0/pulled=0/skipped=230/errors=[]. **Bug**: 84 new rate-limit error rows were created at 12:52 UTC by a background sync that ran 2 min after the manual sync — errors recur with each background sync burst. **+30 min (12:57 UTC, post-manual-sync)** [GCal only]: GCal active=230 (−5 from +20 min; MISS_THRESHOLD deletions of soak test tasks), deleted_local=42,579 (+9 from +20 min, very stable), deleted_remote=3,179 (unchanged throughout), error=0 (84 rate-limit errors self-cleared within ~10 min as GCal quota reset). Manual sync: pushed=0/pulled=0/skipped=228/errors=[]. **Observation**: all-provider ledger counts (MSFT + iCloud + GCal) are misleading for GCal stability monitoring; `WHERE provider='gcal'` required. deleted_local growth and active oscillation in all-provider numbers are predominantly MSFT/iCloud background syncs, not GCal. GCal deleted_local net delta over 30+ min: +25 rows (negligible). deleted_remote: perfectly stable at 0 change throughout. |

**D section summary (2026-04-25)**: GCal sync is functionally stable over 30 min — no runaway churn, no oscillation, no orphan event accumulation. GCal deleted_local grew by only +25 rows (negligible); deleted_remote was unchanged throughout. Two active bugs: (Bug #6) duplicate active ledger rows can cause premature MISS_THRESHOLD task deletion; (Bug #11) flexible-task push churn drives persistent rate-limit errors in background sync cycles (~84–90 error rows per burst), though these self-clear within ~10 min as the GCal 600 QPM quota resets. Ledger queries require `WHERE provider='gcal'` to isolate GCal stability from concurrent MSFT/iCloud sync activity.

### Bugs found
1. **A5 done-time shift**: Marking a task done with "Now" sets `scheduled_at` to the completion timestamp, which moves the GCal event out of its original slot. Expected: GCal event should stay at original scheduled time (or be removed); it should not silently move.
2. **A7 URL not surfaced**: `buildEventBody` in `gcal.adapter.js` doesn't include `task.url` in the event description. Add `if (task.url) descParts.push('Link: ' + task.url);`. **Fixed.**
3. **A5 counters misleading**: Done-task push counted in `pushed`, not a dedicated counter. Makes it hard to distinguish update-for-done from a real content change.
4. **Scheduler ordinal collision** (`runSchedule.js`): `maxOrdByMaster` was computed from pending rows only. If a done/skip/cancel row holds ordinal N, the next scheduler run re-uses N, hitting the `uq_instance_ordinals` unique constraint and crashing the entire scheduler run with 500. **Fixed**: extended `_p_terminalDedupRows` to select `occurrence_ordinal` and fold terminal ordinals into `maxOrdByMaster` after the pending-row pass.
5. **`POST /api/tasks` returns 500 for recurring tasks**: Creating a task with `recurring: true` via the REST endpoint returns 500. Workaround used: direct DB insert. Needs investigation.
6. **Duplicate active ledger rows**: Two active `cal_sync_ledger` rows can be created for the same task if two sync cycles run in rapid succession before `last_pushed_hash` is committed. One GCal event then becomes an orphan; once it reaches `miss_count = MISS_THRESHOLD (3)`, the task is deleted — even if the second GCal event is still valid. Fix: add a unique constraint or deduplication guard before inserting new ledger rows; or check for existing active rows before creating.
7. **`task.tz` change not reflected in GCal event**: The sync controller derives the event start time from `scheduled_at` localized to `userRow.timezone` — `task.tz` is never consulted. Changing only `task.tz` via PUT produces `pushed=0` (no event update). To move a task to a new timezone wall-clock time, `scheduled_at` must also be updated to the new UTC equivalent.
8. **`travel_before`/`travel_after` snake_case silently dropped in POST body**: `POST /api/tasks` with `travel_before`/`travel_after` (snake_case) leaves those columns NULL. The task write handler only maps `travelBefore`/`travelAfter` (camelCase). Use PUT with camelCase to set them. Additionally, travel buffers are not surfaced in the GCal event body — they are scheduler-internal only.
10. **C2 race: GCal delete + juggler edit → edit is silently lost**: If a juggler-owned GCal event is deleted on GCal while the user edits the task in juggler, the sync enters the `task && !event` miss_count path and never attempts to push the juggler edit. After MISS_THRESHOLD syncs, the task is deleted from juggler. Fix: in the `task && !event` path, if `origin='juggler'` and juggler's task hash has changed since last push, treat as "re-create" rather than "miss" — the task edit signals user intent to keep the task alive.
9. **Split task per-chunk GCal sync not implemented**: `reconcileSplitsForUser` in `reconcile-splits.js` ("Not called from production code yet") is the missing wiring. Until it runs, split tasks produce one GCal event (for the primary chunk) regardless of `splitMin`. The in-memory scheduler placement may split the task, but the DB has only 1 instance row and only 1 GCal event is created.
11. **Flexible-task push churn causes persistent GCal rate-limit errors**: The scheduler re-places flexible tasks on every run, changing `scheduled_at` for many tasks, which invalidates `last_pushed_hash`. Each background sync cycle then accumulates ~10–30+ hash-mismatched pushes. With background syncs running every few minutes, the user hits GCal's 600 QPM quota within ~10 minutes; rate-limit error rows appear in the ledger and persist until at least 10 min passes and quota resets. Fix: (a) debounce background sync triggers so rapid scheduler churn doesn't produce rapid-fire syncs; (b) do not invalidate `last_pushed_hash` for scheduler placement changes if the task is flexible and the actual content (title/notes/etc.) hasn't changed; or (c) add per-user QPM tracking with backoff before hitting the GCal batch API.

---

## Known-or-suspected issues going in (from audit)

- **Title drift**: `Take morning prescriptions` GCal events persist under
  an old title; the corresponding juggler task is now `Take Morning
  Medications`. Covered by A2 + A10.
- **High `deleted_local` history** (42,056 rows): may reflect churn from
  past recurring-reconcile behavior. Watch in section D.
- **No per-provider sync-health telemetry surfaced** — everything's in the
  DB. Consider a view / endpoint after the soak if this test makes it
  painful to audit.
