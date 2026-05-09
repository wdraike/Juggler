---
status: resolved
trigger: "the whole afternoon is not completely unsync'd. its a mess dude"
created: 2026-05-09T16:34:00Z
updated: 2026-05-09T17:08:00Z
resolved: 2026-05-09T17:08:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: |
    "Afternoon mess" is six concurrent issues, not one. Confirmed root causes per issue:
    (1) MSFT pull loop — `cal_sync_ledger.last_modified_at` is MySQL `timestamp` (zero fractional precision); MSFT Graph `lastModifiedDateTime` carries microseconds. Round-trip truncates to seconds, so `evModMs > recordedModMs` (controller.js:819) is permanently true. Re-pulls every sync, clobbers scheduler placements.
    (2) GCal "Invalid start time" on `t17779818405595wnz` — non-recurring single instance; DB scheduled_at=2026-05-09 20:00 EDT dur=30 (timed); active gcal+msft ledger rows stuck on `event_all_day=1, event_start=2026-05-08`. Push payload mismatches ledger shape → 400 every sync.
    (3) Apply for Jobs split chunk -32032 — all 3 providers' active rows stale at `event_start=2026-05-09T06:30Z` while DB rescheduled to 13:00; `miss_count=2` → next miss = MISS_THRESHOLD = ledger row deleted as gone.
    (4) Lunch -31329 — past_recurring_cleanup correctly removed it; not a bug.
    (5) Eat Dinner -31622 — 2 stale `apple` rows in `deleted_local` status; cosmetic, ignored by sync.
    (6) Apple LAST-MODIFIED — `apple-cal-api.js:137-138` does extract it via ical.js, but all apple ledger rows have `last_modified_at=null`. Either iCloud VEVENTs omit LAST-MODIFIED in current responses, or the rows predate working extraction. Either way the conflict-detection short-circuit at controller.js:815 (`event.lastModified && ledger.last_modified_at`) means Apple external edits are never detected.
  confirming_evidence:
    - "DATE_FORMAT(last_modified_at, '%f') returns .000000 for every cal_sync_ledger row → column has no fractional precision; column type confirmed `timestamp` (not `timestamp(6)`)"
    - "MSFT adapter emits microsecond lastModifiedDateTime; GCal `event.updated` is millisecond `.000Z` (round-trips losslessly through second-precision storage); differential evidence: post-fix sync runs 12:24:40 vs 12:34:14, gcal/apple converged pulled→skipped, MSFT stayed pulled both runs"
    - "controller.js:1136-1138 push-side comment acknowledges the same fractional false-positive and works around it with +30s for pushes; pull/skip path at line 819 was never patched"
    - "t17779818405595wnz ledger: 6 rows; active gcal+msft `event_all_day=1, event_start=2026-05-08`; active apple `event_start=2026-05-10T00:00:00 timed`; DB task scheduled_at=2026-05-09 20:00 EDT dur=30 non-recurring; gcal returns 400 'Invalid start time' on every push"
    - "Apply for Jobs -32032 ledger: 3 active rows (gcal/msft/apple) all `event_start=2026-05-09T06:30Z, miss_count=2`; DB now `scheduled_at=13:00`; MISS_THRESHOLD=3 → one more sync without a hit and provider deletes the row"
    - "apple-cal-api.js:137-138 extracts last-modified via vevent.getFirstPropertyValue('last-modified'); apple.adapter.js:165 passes through; yet 100% of apple ledger rows have last_modified_at=null → iCloud VEVENTs lack LAST-MODIFIED in observed responses"
  falsification_test: |
    Per issue:
    (1) Apply migration to widen column to timestamp(6); run sync twice. If MSFT events still pulled on run 2 → hypothesis wrong, upstream lastModifiedDateTime jittering.
    (2) Reset gcal+msft ledger rows for t17779818405595wnz (delete or set event_all_day=0, event_start=null); run sync; expect 400 to disappear and event to recreate cleanly.
    (3) Force ledger reset for -32032 (set event_id=null on active rows or mark replaced); run sync; expect re-create at 13:00.
    (6) Tail the parsed apple events for one calendar with a known recently-edited event; check whether `event.lastModified` is non-null. If still null, confirm iCloud doesn't emit LAST-MODIFIED and we need a workaround (use ETag or DTSTAMP).
  fix_rationale: |
    (1) Direct fix at root cause: comparison logic is correct, storage precision is wrong. Knex migration `timestamp(6)`. Adding tolerance windows would mask legitimate sub-second edits.
    (2) Ledger inconsistency, not code bug. Manual reset of 2 rows is lowest-risk path. (Optional follow-up: detect timed vs all_day mismatch in push path and force ledger correction.)
    (3) Same shape — ledger drifted from DB after reschedule. Manual reset to force re-create. Self-heal won't trigger because event_id still resolves.
    (4) No action.
    (5) Cosmetic; can sweep with periodic cleanup later.
    (6) Out of scope for the immediate "afternoon mess" but should be tracked. Likely needs DTSTAMP fallback or ETag-based change detection for Apple.
  blind_spots: |
    - Whether MSFT lastModifiedDateTime is *itself* deterministic across reads. If MSFT returns slightly different microseconds on each fetch (server-side touch), even timestamp(6) won't help. Verification step covers this.
    - Whether other ledger writes (push path lines 1449/1485/1542/1632/1661/1696/1754/1808) need the same precision fix or are already shielded by the +30s/+2s drift.
    - apple LAST-MODIFIED null may also affect non-iCloud CalDAV servers (Fastmail, NextCloud) — out of scope but worth noting.
  next_action: Present remediation plan to user, bucketed self-healing / manual cleanup / code fix; await selection before applying.

## Symptoms

expected: After 26h sync stall is fixed (varchar(20) → varchar(64) on sync_history.action), the next user-triggered sync should reconcile each afternoon task by picking the newer of (DB updated_at, provider event last-edited) and propagating that state to all providers. Specifically: GCal Lunch (externally edited 5/8 16:57Z) vs DB 12:00 (scheduler placement, updated_at 5/9 14:48Z) → DB wins → push DB 12:00 over GCal. Apple Exercise stale 11:15 → DB wins → push DB current → Apple.
actual: User reports "the whole afternoon is not completely unsync'd. its a mess dude" — POST-fix sync ran but state across providers is still mismatched for today's afternoon window (12:00-18:00 EDT). Investigation revealed sync had been silently looping for days: identical MSFT and (during stall) GCal events were "pulled" every 2-3 minutes for hours, with the scheduler's placements being repeatedly overwritten by stale provider event_start values.
errors:
  - "GCal 400 Invalid start time" recurring on task t17779818405595wnz (Purchase/prepare gift/activity for Anna) every sync since 5/8 07:49 — caused by ledger event_all_day=1 + event_start=2026-05-08 mismatch with DB scheduled_at=2026-05-09 20:00.
  - Pre-fix MySQL "Data too long for column 'action'" — RESOLVED via migration 20260509000500.
reproduction: Click sync repeatedly. Watch sync_history. Same MSFT events appear with action='pulled' every run despite no actual user edit on MSFT side.
started: At least 2026-05-07 evening (run feda4432 at 20:44:33). Possibly earlier — pull loop pre-existed the 5/8 stall.

## Eliminated

- hypothesis: sync_history.action varchar(20) too narrow for 'past_recurring_cleanup'
  evidence: Confirmed root cause of 26h stall; migration 20260509000500 widened to varchar(64) and applied successfully (Batch 161). Backend reloaded. Trace at /tmp/juggler-calsync-debug.log confirmed 43 of 550 historyInserts per run had the offending action.
  timestamp: 2026-05-09T16:30:00Z

- hypothesis: Conflict resolution picked the wrong winner for Lunch (12:00 vs 12:30)
  evidence: DB Lunch -31329 now shows scheduled_at=12:30 EDT, updated_at=12:33:43 today. GCal lastModified was 5/8 16:57. The newer-wins logic correctly pulled GCal 12:30 into DB. So Lunch is at 12:30 by design. The "12:00 expected" in the original brief was based on stale assumption.
  timestamp: 2026-05-09T16:48:00Z

- hypothesis: past_recurring_cleanup orphaned valid Lunch ledger
  evidence: Lunch -31329 scheduled 12:30 EDT, current time 12:34 EDT. The instance is technically past at sync time. Cleanup is correct. Tomorrow's Lunch (-31330) at 12:30 will sync clean. Not a bug.
  timestamp: 2026-05-09T16:48:00Z

- hypothesis: Apply for Jobs -32032 needs manual ledger reset (Option A)
  evidence: At apply time, all 6 ledger rows for task_id `019d5dfa-a97c-7152-a799-f21ba1026db2-32032-4` are already `status='deleted_local'` with `miss_count=0`. The active rows captured at 16:49 (miss_count=2) crossed MISS_THRESHOLD between investigation and remediation, so the system already self-resolved. Sync will recreate cleanly from DB on next run; no manual SQL required.
  timestamp: 2026-05-09T17:05:00Z

## Evidence

- timestamp: 2026-05-09T16:30:00Z
  checked: pre-fix trace at /tmp/juggler-calsync-debug.log
  found: per-run buffers ~180 taskUpdates, ~30 ledgerInserts, ~550 historyInserts, ~43 with action='past_recurring_cleanup' (22 chars > varchar(20))
  implication: Every cal-sync write phase trx rolled back for 26 hours.

- timestamp: 2026-05-09T16:30:00Z
  checked: schema sync_history.action column post-migration
  found: column is varchar(64)
  implication: Action overflow no longer blocks writes.

- timestamp: 2026-05-09T16:42:00Z
  checked: sync_history grouped by action+provider since 2026-05-09 00:00:00
  found: msft pulled=123, gcal pulled=108, apple pulled=0 (apple last_modified_at always null), msft skipped=221, gcal skipped=207, conflict_juggler totals 90 (mostly terminal-task-immutable on ✓ rows), only 4 actual pushes total today
  implication: Heavy pull asymmetry indicates DB is being clobbered by provider state every sync, not real user edits.

- timestamp: 2026-05-09T16:45:00Z
  checked: history for 5 looping tasks (Apply for Jobs -32032, Lunch -31329, Exercise -746, Brainstorm Mother's Day, Eat Dinner -31622) since 2026-05-07
  found: Same 5 tasks "pulled" every 2-3 minutes from 5/7 20:44 through 5/8 08:46 (varchar overflow stall blocks rest), then "pulled" again on the two post-fix runs today (12:24:40 and 12:34:14). Pattern matches a deterministic re-pull, not real user edits at sub-2-minute cadence.
  implication: Either (a) ledger is never updating last_modified_at after pull (write rolled back?), or (b) the comparison evModMs > recordedModMs is broken in a way that survives lossless writes.

- timestamp: 2026-05-09T16:47:00Z
  checked: cal_sync_ledger.last_modified_at column type and stored values via DATE_FORMAT(... , '%f')
  found: column is `timestamp` (zero fractional precision); DATE_FORMAT shows `.000000` for all rows across all providers
  implication: All sub-second precision is lost on write. MSFT lastModifiedDateTime carries microseconds (e.g. `.123456Z`); GCal `event.updated` carries milliseconds (`.000Z`). Truncating loses MSFT precision but is lossless for GCal. Confirms hypothesis.

- timestamp: 2026-05-09T16:47:30Z
  checked: cal-sync.controller.js:1139 push path comment
  found: "// +30s: provider server timestamps often lag our push by several seconds (Apple CalDAV is especially slow). Using +2s caused false eventModifiedExternally detections on the following sync."
  implication: Maintainer already discovered fractional-second false-positive on push path and worked around it. Pull/skip path (line 973) was not patched. Same root cause applies.

- timestamp: 2026-05-09T16:48:00Z
  checked: post-fix sync runs today (52bba307 at 12:24:40 and cc5d1494 at 12:34:14) for the same 5 tasks
  found: GCal+Apple converged from "pulled/conflict_juggler" → "skipped" between run 1 and run 2 (precision-lossless). MSFT remained "pulled" on both runs (precision-lossy).
  implication: Differential evidence isolates the bug to MSFT precision handling specifically.

- timestamp: 2026-05-09T16:49:00Z
  checked: 47 active ledger rows for Apply for Jobs master 019d5dfa-a97c-7152-a799-f21ba1026db2
  found: Today's split chunk -32032 has miss_count=2 on all 3 providers with stale event_start=2026-05-09T06:30 (from May 6 push) — task DB now scheduled_at=13:00. miss_count=2 means provider returns no event for this id over 2 syncs. Other split chunks (-32033..-32056 future, -31958/-32009/-32017/-32023/-32024 future) all miss=0, healthy.
  implication: Apply for Jobs -32032 split chunk was rescheduled in DB on 5/8, but the calendar event at 06:30 is gone (likely user deleted it on the calendar, or sync error nuked the event_id). Not self-healing — needs a forced ledger reset to trigger re-create.

- timestamp: 2026-05-09T16:49:30Z
  checked: ledger for t17779818405595wnz (Purchase/prepare gift/activity, gcal 400 Invalid start time)
  found: 6 ledger rows. Active gcal+msft rows have event_all_day=1, event_start=2026-05-08 (date only). Active apple row has event_start=2026-05-10T00:00:00 (timed). DB task is non-recurring single instance scheduled_at=2026-05-09 20:00 EDT, dur=30. Push attempts new (timed) value, gcal/msft ledger thinks it's all_day → upsert payload mismatch → 400 Invalid start time.
  implication: Ledger was set to all_day=1 by an earlier event-creation path; subsequent rescheduling task retains all_day=1 in ledger → 400 forever. Self-heal won't happen — needs ledger rows for this task to be flipped to all_day=0 OR the events to be deleted/recreated on the calendar.

- timestamp: 2026-05-09T16:49:45Z
  checked: apple LAST-MODIFIED extraction chain
  found: apple-cal-api.js:137-138 calls vevent.getFirstPropertyValue('last-modified') and formats via formatICALDateTime; apple.adapter.js:165 passes through `event.lastModified || null`. Wiring is correct. Yet 100% of apple ledger rows have last_modified_at=null.
  implication: iCloud CalDAV VEVENT responses do not contain LAST-MODIFIED property in observed traffic, OR the rows predate the working extraction. Either way: detection at controller.js:815 short-circuits to false for all apple events. Apple external edits silently lost on next sync. Out of scope for "afternoon mess" — track separately.

- timestamp: 2026-05-09T17:02:00Z
  checked: post-migration column type via information_schema.columns
  found: COLUMN_TYPE='timestamp(6)', DATETIME_PRECISION=6
  implication: Migration 20260509001000 applied successfully (Batch 162); the precision-truncation root cause is removed at the storage layer.

- timestamp: 2026-05-09T17:03:00Z
  checked: ledger state for 019d5dfa-a97c-7152-a799-f21ba1026db2-32032-4 immediately before SQL #3
  found: 6 rows, all status='deleted_local', miss_count=0, provider_event_id=null
  implication: Active rows captured at 16:49 (miss_count=2) crossed MISS_THRESHOLD=3 between investigation and remediation. Self-healed. SQL #3 unnecessary; sync will recreate from DB on next run.

- timestamp: 2026-05-09T17:04:00Z
  checked: ledger state for t17779818405595wnz immediately before SQL #2
  found: gcal active row event_all_day=1 event_start=2026-05-08 provider_event_id=7ocgda0v6r7nt087qer7cdbr5g; msft active row event_all_day=1 event_start=2026-05-08T00:00:00.000000Z provider_event_id=AQMkADAw...; apple active row event_all_day=0 event_start=2026-05-10T00:00:00 (correct shape)
  implication: Confirms #2 hypothesis — gcal+msft active rows stuck in all-day shape. Cleanup target identified, apple row preserved.

- timestamp: 2026-05-09T17:05:00Z
  checked: post-cleanup ledger state for t17779818405595wnz
  found: 1 active row (apple, timed, 2026-05-10T00:00:00); gcal+msft active rows deleted (2 rows removed).
  implication: GCal and MSFT will receive a fresh CREATE on the next sync at the correct DB scheduled_at; no more "Invalid start time" 400.

## Resolution

root_cause: Six concurrent issues. Primary: `cal_sync_ledger.last_modified_at` is MySQL `timestamp` (zero fractional-second precision) but MSFT Graph returns microsecond-precision `lastModifiedDateTime`. MySQL silently truncates fractional seconds on write. The comparison `evModMs > recordedModMs` (cal-sync.controller.js:819) is then permanently true on MSFT → events re-pulled every 2-3 minutes → user's scheduler placements clobbered. Secondary issues: ledger drift on two specific tasks, two cosmetic stale rows, and Apple LAST-MODIFIED absence.

fix:
  bucket_self_healing:
    - "(4) Lunch -31329 past_recurring_cleanup — already correct, no action."
    - "(5) Eat Dinner -31622 two stale apple `deleted_local` rows — cosmetic, ignored by sync. Optional sweep later."
  bucket_manual_db_cleanup:
    - issue: "(2) GCal/MSFT 400 Invalid start time on t17779818405595wnz — APPLIED 17:05Z"
      sql: |
        DELETE FROM cal_sync_ledger
         WHERE task_id = 't17779818405595wnz'
           AND provider IN ('gcal','msft')
           AND status = 'active';
      result: "2 rows deleted; apple row preserved. Next sync will CREATE fresh gcal+msft events."
      risk: "Calendar may have orphaned all-day events from 5/8 — user should manually delete them on Google/Outlook calendar to avoid duplicates after re-create."
    - issue: "(3) Apply for Jobs -32032 ledger drift — NO-OP, self-resolved"
      sql: |
        # Skipped: state had moved to status='deleted_local' across all 6 rows by the time
        # remediation ran. MISS_THRESHOLD=3 deleted the active rows between debug capture and apply.
      result: "No SQL run. Sync will re-create from DB on next run."
  bucket_code_fix:
    - issue: "(1) MSFT pull loop — fractional-second truncation — APPLIED 17:02Z (Batch 162)"
      file: "juggler-backend/src/db/migrations/20260509001000_widen_last_modified_at_precision.js"
      result: "Column verified TIMESTAMP(6), DATETIME_PRECISION=6. Defensive FOREIGN_KEY_CHECKS toggle (matches 20260509000500 pattern) avoided collation FK errors."
      verification: "Run sync twice in <30s. Expect MSFT events transition pulled→skipped between run 1 and run 2 (matching gcal). Tail sync_history WHERE provider='msft' AND action='pulled' — count should drop to ~zero on idle."
    - issue: "(6) Apple LAST-MODIFIED missing — DEFERRED to todo"
      todo: ".planning/todos/pending/2026-05-09-apple-last-modified-not-extracted.md"
      result: "Filed. ETag-based change detection is the recommended workaround. Severity: medium."

verification: After applying code fix + DB cleanup: run sync twice in quick succession. Expect (a) MSFT events pulled→skipped between runs, (b) miss_count=2 row for -32032 transitions to status='replaced' or new active row created, (c) t17779818405595wnz no longer logs 400 errors. Tail /tmp/juggler-calsync-debug.log to confirm.

files_changed:
  - juggler-backend/src/db/migrations/20260509001000_widen_last_modified_at_precision.js (NEW — applied as Batch 162 at 17:02Z)
  - .planning/todos/pending/2026-05-09-apple-last-modified-not-extracted.md (NEW — issue #6 deferred)

## Wrap-Up Summary

**Bugs found (6):**
1. **MSFT pull loop** — `cal_sync_ledger.last_modified_at` was `TIMESTAMP` (second precision); MSFT lastModifiedDateTime is microsecond — truncation made `evMod > recordedMod` permanently true → pull every sync. **Primary root cause of "afternoon mess".**
2. **GCal/MSFT 400 on t17779818405595wnz** — ledger active rows stuck all-day=1, event_start=2026-05-08 vs DB timed scheduled_at=2026-05-09 20:00 → push payload mismatch → 400 every sync.
3. **Apply for Jobs -32032 ledger drift** — active rows event_start=2026-05-09T06:30Z while DB rescheduled to 13:00; miss_count climbing toward MISS_THRESHOLD.
4. **Lunch -31329 past_recurring_cleanup** — not a bug; correct behavior. No action.
5. **Eat Dinner -31622 stale apple `deleted_local` rows** — cosmetic; ignored by sync. Optional sweep later.
6. **Apple LAST-MODIFIED never populated** — 100% of apple ledger rows have `last_modified_at=NULL`; iCloud VEVENTs don't emit it in observed traffic. Apple external edits silently lost.

**Fixes shipped today:**
- Migration `20260509001000_widen_last_modified_at_precision.js` — `last_modified_at` widened to `TIMESTAMP(6)` (Batch 162). Verified via `information_schema.columns`. (#1)
- SQL: `DELETE FROM cal_sync_ledger WHERE task_id='t17779818405595wnz' AND provider IN ('gcal','msft') AND status='active'` — 2 rows deleted; apple row preserved. (#2)

**No-ops / self-healed:**
- #3 self-resolved via MISS_THRESHOLD between debug capture and apply (all 32032-4 rows now `deleted_local`).
- #4, #5 not actionable.

**Deferred todos:**
- `.planning/todos/pending/2026-05-09-apple-last-modified-not-extracted.md` (#6, severity medium, ETag-based detection recommended).

**Files touched:**
- `juggler-backend/src/db/migrations/20260509001000_widen_last_modified_at_precision.js` (NEW)
- `.planning/todos/pending/2026-05-09-apple-last-modified-not-extracted.md` (NEW)
- `cal_sync_ledger` rows (2 deleted)

**Verification gate (pending user action):**
Click sync twice in <30 seconds. Expect MSFT events transition `pulled`→`skipped` between run 1 and run 2 (matching the GCal pattern from this morning's runs). If MSFT still shows `pulled` on run 2, the upstream `lastModifiedDateTime` is jittering server-side and a tolerance window is needed in addition to the precision fix.
