# Juggler — Open Plans

Source of truth for in-progress and backlog work. See `Issues.txt` for the item-level list.
Last updated: 2026-04-27

> **Caveat:** Items below were planned Apr 13–16 unless noted. Verify current code state before starting any item — check git log and grep for the relevant symbols first.

## Status summary

| Plan | Status |
|------|--------|
| Scheduler redesign — recurring/split chunks as persistent rows (5 phases) | 🔴 Active plan, not yet started — `reconcile-splits.js` exists but not wired to production |
| Calendar Sync Reliability (retry/backoff, lock timeout, frontend retry countdown) | ⬜ Not started |
| CalSyncPanel — Connected Apple Calendars display + per-calendar controls | ⬜ Not started |
| Scheduler docs update (`SCHEDULER-PRIORITY-REDESIGN.md` is stale) | ⬜ Not started |
| GCal Anomaly Verifier Script | ⬜ Not started |

---

## 🔴 ACTIVE — Scheduler Redesign (recurring/split tasks)

Three-way mismatch: `reconcile` persists split-chunk rows as separate `task_instances` rows (good); `placement` chunks tasks again at runtime in memory, ignoring the per-chunk DB rows; `persist` writes `scheduled_at` by primary task id only. Net: `split_ordinal >= 2` rows exist but are never placed.

**Target model (agreed):**
- Horizon: fixed 56 days
- Instance rows are per-chunk-per-occurrence-day; each carries its own `start_after_at`/`due_at`
- Every instance is a standalone placeable task at scheduler time
- Merge-back after placement: adjacent same-master chunks on the same day fold into lowest-ordinal survivor
- Unscheduled preserves `scheduled_at` — frontend shows it as proposed time, not null
- SSE emits final diff (add/change/remove) with full row content

**Phases:**

1. **Phase 1 — Reconcile rewrite:** Replace `reconcile-splits.js` + fold into `runSchedule.js`. For each master in 56-day window, compute occurrences × chunks, upsert rows with deterministic IDs (`masterId-YYYYMMDD-chunkN`). Derive placement bracket (`start_after_at`, `due_at`) in-memory from `(master.recur, occurrence_ordinal, occurrence_date)`. No schema change.
2. **Phase 2 — Placement:** Delete runtime split logic from `unifiedSchedule.js:311-348`. Pool builds one item per DB row; each row's `start_after_at`/`due_at`/`dur` describe the placeable unit. Key persist by `p.task.id` (the row id, not master id).
3. **Phase 3 — Merge-back:** After placement, before commit — group placed rows by `(master_id, local date)`, walk adjacent pairs, fold consecutive chunks by extending `dur` and marking siblings for delete. Idempotent.
4. **Phase 4 — Unscheduled preservation:** When marking row unscheduled, set `unscheduled=1` but do NOT null `scheduled_at`. Frontend uses `unscheduled=1` as "not on calendar"; uses `scheduled_at` as proposed time for unscheduled lane sort.
5. **Phase 5 — SSE contract:** Extend patch-based SSE to `added` (full row content). Frontend reducer: `UPSERT_TASKS` on added, `PATCH_TASKS` on changed, `REMOVE_TASKS` on removed. Stop fetching after `schedule:changed`.

**Critical files:** `src/scheduler/runSchedule.js`, `src/scheduler/unifiedScheduleV2.js`, `src/lib/reconcile-splits.js` (fold then delete), `src/scheduler/scheduleQueue.js`, `src/hooks/useTaskState.js` (frontend), `tests/schedulerScenarios.test.js`, `tests/schedulerDeepCoverage.test.js`

**Verification per phase:** (1) Apply for Jobs → exactly 2 chunks × 56 days = 112 rows after one run; `start_after_at`/`due_at` set correctly; (2) split_ordinal=2 rows get `scheduled_at` populated; (3) merged days show one row with expanded `dur`; (4) unscheduled rows keep proposed time; (5) frontend network tab shows no `/api/tasks/<id>` bursts after scheduler run.

---

## ⬜ Calendar Sync Reliability

Third-party calendar syncs fail silently. Root causes: (1) silent error swallowing, (2) no retry/backoff for API rate limits, (3) tokens validated too late in flow, (4) frontend gives up on lock contention.

**Backend `cal-sync.controller.js`:**
- Wrap all source adapter calls in try/catch and log the full error + stack (currently swallowed at ~line 289)
- On GCal `429` / `rateLimitExceeded`: retry with exponential backoff (1s, 2s, 4s), max 3 attempts, then mark sync `error` with message "Rate limited by Google Calendar"
- Move token validation before the main sync lock acquisition (currently validated inside the lock — if token refresh fails, lock is held until timeout)
- Add `syncTimeout` guard: if sync run exceeds 5 minutes, abort and release lock

**Frontend `CalSyncPanel.jsx`:**
- On `sync_lock_conflict` SSE event (~line 380), retry after 30s instead of showing "Sync already in progress" and giving up
- Show retry countdown in the progress display
- On error events, display the error message from SSE payload (currently shows generic "Sync failed")

**Verify:** trigger sync while another sync is running → frontend shows countdown and retries. Simulate rate limit response → backend retries and completes. Token expiry mid-sync → clean error, not timeout.

---

## ⬜ CalSyncPanel — Connected Apple Calendars Display

When `appleConnected` is true, the panel only shows global sync mode/frequency controls — doesn't show which Apple calendars are connected or allow disconnecting individual ones.

**Frontend `CalSyncPanel.jsx`:**
- On mount (in existing `useEffect`), if `appleConnected`, call `GET /apple-cal/calendars` → populate `connectedAppleCalendars` state
- Replace connected section (lines 519-562) with a calendar list:
  - Each row: `[calendar name] [sync direction select] [disable button]`
  - Sync direction select: calls `PUT /apple-cal/calendars/:id` inline; if no calendars remain enabled, set `appleConnected = false`
  - Below list: auto-sync frequency selector + "Disconnect all" button
  - Remove global sync mode dropdown — direction is now per-calendar
- "Manage calendars" link re-triggers `handleAppleConnect` to re-discover (adds new calendars)

**Backend `cal-sync.controller.js`:**
- Enhance `emitProgress` calls to include `provider` and `calendar` fields
- Update calls at fetch phase, ledger check, and push phase to name the specific provider/calendar being processed

**Frontend progress display (lines 671-685):** when `provider` field is present in progress event, show it in bold; when `calendar` is present, show calendar name. Keep percentage bar.

**Verify:** connect 2+ Apple calendars; each appears in list with name + sync direction; change direction → persists; disable one → disappears. Trigger sync → progress shows "Fetching Apple Calendar (Work)..."

---

## ⬜ Scheduler Docs Update

`juggler-backend/docs/SCHEDULER-PRIORITY-REDESIGN.md` still says "priority is the primary sort criterion" — contradicts the corrected algorithm where deadlines are primary and priority is a tie-breaker.

**Rewrite `SCHEDULER-PRIORITY-REDESIGN.md`:**
- Move from "Draft" to "Current design"
- Leading principles: deadlines drive the schedule; priority is tie-breaker; past-due tasks = due today + promoted to P1
- 10-step outline covering load, classify, placement (4 sub-phases), cleanup, persist, notify, guard rails, triggers, safety
- Deep-dives on §4b (recurring placement per frequency type) and §4c (global backward sweep: chain graph construction, `target_finish`, tie-break hierarchy, per-member forward pull)
- Explicit "What changes from prior doc" callouts: priority-as-primary → deadlines-primary; per-chain → global sweep; uniform forward shift → per-member topological pull

**Add to `SCHEDULER-TEST-CASES.md`:** priority-as-tie-break, past-due promotion, pinned eviction, global sweep ordering, diamond-DAG forward pull

**Mark `SCHEDULER-DEPENDENCY-REDESIGN.md` superseded** — one-line note at top

---

## ⬜ GCal Anomaly Verifier Script

The existing `scripts/verify-cal-sync.js` operates against the pre-refactor `task.gcal_event_id` column model (stale). Need a new read-only script that walks live state and reports four drift classes.

**New `juggler-backend/scripts/verify-cal-anomalies-gcal.js`** (read-only, no writes):

| Class | Definition |
|-------|-----------|
| **A. Broken pair** | Active ledger row's `provider_event_id` missing from GCal listing in-window |
| **B. Orphan event** | GCal event not in any active ledger row AND stamped "Synced from Raike & Sons" |
| **C. Stale task ref** | Active ledger row's `task_id` doesn't resolve to a tasks row (or soft-deleted) |
| **D. Duplicate ledger** | Same `task_id` in >1 active ledger row for `provider='gcal'` |

**Inputs:** single user via `db('users').first()`. Window default `[-30d, +60d]`. Optional `--start`/`--end` overrides; `--json` flag.

**Implementation:** pull active ledger rows + live GCal events (via `gcalAdapter.listEvents`) + tasks in parallel; cross-reference; print report with per-anomaly detail. `exit 0` = clean, `exit 1` = anomalies found.

**Reuse (do not modify):** `src/lib/cal-adapters/gcal.adapter.js` for `getValidAccessToken` + `listEvents`; `scripts/verify-cal-sync.js:191-200` for stamp-detection logic; `src/db/index.js`.

**Verify:** baseline run against live dev data; spot-test each detector fires correctly (manual delete one GCal event → class A +1, etc.). Confirm `cal_sync_ledger` row count unchanged after run (truly read-only).
