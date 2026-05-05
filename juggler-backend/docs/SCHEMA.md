# Juggler Schema Reference

Purpose and lifecycle of the non-obvious tables in the Juggler DB. Covers the **Bucket 1** questions from `juggler/Issues.txt`.

Schema is Knex migrations in `src/db/migrations/`. The current task model is the two-table split (`task_masters` + `task_instances`) introduced in `20260415010000` — the legacy `tasks` table has been dropped (`20260415010900`). Code reads through the `tasks_v` view for backward compatibility.

---

## Tables

- [task_masters](#task_masters) — user intent for a logical task
- [task_instances](#task_instances) — scheduler-placed occurrences
- [cal_sync_ledger](#cal_sync_ledger) — current bi-directional sync state per task/event
- [sync_history](#sync_history) — append-only audit log of sync actions
- [user_calendars](#user_calendars) — enabled calendars per provider per user
- [schedule_queue](#schedule_queue) — debounce trigger for scheduler runs
- [task_write_queue](#task_write_queue) — durable buffer for writes arriving under lock
- [feature_events](#feature_events) — feature-gate analytics log
- [weather_cache](#weather_cache) — hourly forecast cache keyed by rounded coordinates
- [ai_command_log](#ai_command_log) — per-user daily AI command quota tracking

---

## `task_masters`

**Purpose.** One row per logical task. Holds the user-provided settings: text, project, priority, duration, scheduling intent, recurrence rules, dependencies. Never touched by the scheduler except through mutation.

### Fields called out in Issues.txt

#### `section` (#10)

String column. Meant to be a sub-grouping under `project` (e.g., project "Kitchen Remodel" / section "Demo"). Currently **not surfaced in the task edit UI** (`juggler-frontend/src/components/tasks/TaskEditForm.jsx` has no section control) — it is only populated by the import/export text parser in `ImportExportPanel.jsx` (which extracts `Section: X` from descriptions) and is listed in `NON_SCHEDULING_FIELDS` in `src/lib/task-write-queue.js:52` so mutations to it bypass the scheduler lock. It plays no role in placement. Effectively a dead column until the UI exposes it.

#### `url` (#4, added 2026-04-26)

Optional `VARCHAR(2000)` pointing at an external resource (email thread, doc, GitHub issue, etc.). Surfaced as a clickable 🔗 icon on the task card and the task detail form. Non-scheduling field — stored and displayed only. Migration: `20260426000400_add_url_to_task_masters`.

#### `preferred_time_mins` (#14)

Integer minutes-from-midnight in the user's local timezone. 0 = midnight, 720 = 12:00 PM, 420 = 7:00 AM. Added by migration `20260406400000_add_preferred_time_mins` to replace the previous overload of `scheduled_at` as a time anchor for recurring templates.

Read by `src/scheduler/unifiedSchedule.js` and `hillClimb.js`. Drives **Time Window mode** for recurring tasks: scheduler places the instance at `preferred_time_mins ± time_flex`. When `preferredTimeMins == null` the recurring task is treated as flexible. Also used by `runSchedule.js:566` to seed the first split chunk's preferred time.

Non-tz-dependent by design — no conversion needed at read time.

#### `placement_mode` (#13, completed 2026-05-01)

`ENUM` — stored column (not virtual). Scheduler reads it directly. `marker` and `rigid` columns are dropped from `task_masters`; views expose computed boolean equivalents for backward compatibility.

Values: `marker`, `fixed`, `pinned_date`, `recurring_rigid`, `recurring_window`, `recurring_flexible`, `flexible`.

The column was originally added as a VIRTUAL GENERATED column in migration `20260426000300_add_placement_mode` (derived on-read from `marker`, `rigid`, and `when`). Migration `20260501000000` (Phase 4) converted it to a STORED column and dropped `marker` and `rigid` from `task_masters`. The write-path now derives `placement_mode` via `derivePlacementMode()` and writes it directly. Views (`tasks_v` etc.) reconstruct computed `marker` and `rigid` boolean columns via CASE expressions for any code that hasn't migrated to reading `placement_mode` directly.

`pinned_date` is reserved for a future mode (date-locked, time-flexible) not surfaced in the UI yet.

Instance-level `date_pinned` overrides the master's mode at placement time — an instance with `date_pinned = 1` is placed like `fixed` regardless of its master's mode.

#### `desired_at` (#11, consolidated 2026-04-26)

Nullable `DATETIME` holding the user's original intent — the time at which they wanted the task placed, preserved across scheduler moves so the UI can show "Moved: 9:00 AM → 10:30 AM."

Previously paired with a separate `desired_date` `DATE` column to express day-only intent (because a DATETIME can't otherwise distinguish "on this day, any time" from "at midnight"). Migration `20260426000200_drop_desired_date` collapsed the two: day-only intents are now stored as **local noon of that day** to avoid timezone slip at day boundaries. The user's `tz` column disambiguates on read.

Scheduler does not read this field — it's purely for UI intent-display.

---

## `task_instances`

**Purpose.** Scheduler-placed occurrences linked to a master via `master_id`. One row per placement: N=1 for a one-shot, N>=1 for recurring and split chunks. Compound key within a master: `(occurrence_ordinal, split_ordinal)` (unique index `uq_instance_ordinals`).

### Fields called out in Issues.txt

#### `occurrence_ordinal` (#16 — "very large values")

Intended range: `1..N` where N is the count of placed occurrences for the master. The insert trigger in migration `20260415010400` assigns it as `MAX(occurrence_ordinal) + 1` for each new recurring instance under a given master. Because the trigger never recycles numbers and because expired/old instances aren't pruned, this value grows monotonically for long-lived recurring templates — so values in the thousands are expected for a daily habit that has been running for years.

**Decision (2026-04-27, closes #16 and #25):** Monotonic growth is expected and correct. The ordinal encodes "Nth ever occurrence" — an immutable audit identity that recycling or capping would break. UUIDv7 was considered as a replacement (#25) but rejected: ordinals carry cardinality semantics that an opaque UUID cannot express, and migrating 97 call-sites carried high cascade risk. UUIDv7 is already used for `task_instances.id` (opaque PK) where it is appropriate. For ordinals, keep the current monotonic scheme.

#### `generated` (#20)

Boolean. Added by migration `20260415010400_add_generated_to_instances`. Marks **auto-expanded placeholder instances** that the scheduler produces in-memory for recurring masters so that it can compute placements for the next N windows without needing real DB rows yet. A `generated = 1` row:

- Is filtered out of scheduler output writes (`runSchedule.js:838, 1108, 1161`) — it never persists as a scheduled placement unless the user interacts with it.
- Can't be moved to a different day during hill-climb (`hillClimb.js:567, 585`) — its date is a floor.
- Is carried through insert/update triggers so `tasks_v` reflects the state (`20260415010400` lines 67, 97, 132, 161).

In short: a scaffolding flag. `generated = 0` for any row the user sees as "real."

#### Text `date` / `day` / `time` columns (#17, #18, #19)

- `date VARCHAR(10)` — `M/D` format local cache
- `day VARCHAR(3)` — `Mon`/`Tue`/etc.
- `time VARCHAR(20)` — `9:00 AM` format

All three are **derived local-timezone caches** recomputed from `scheduled_at` on each write. They exist because much legacy frontend code reads them directly instead of recomputing from UTC. Bucket 2 (#17–19) will convert these to proper `DATE` / `TIME` types or delete them and compute on the fly in views.

---

## `cal_sync_ledger`

**Purpose.** One row per (task, provider_event) pairing representing the **current** bi-directional sync state. Unified across providers — the legacy `gcal_sync_ledger` and `msft_cal_sync_ledger` tables were merged here in migration `20260315000000`. Paired with `sync_history` (which holds the per-run audit trail) — the ledger is state, history is log.

Created by `20260315000000_unified_cal_sync_ledger` with columns added later for `calendar_id` (`20260415000000`), `miss_count` (`20260402100000`), and `error_detail` (`20260416000000`).

### Fields called out in Issues.txt

#### `calendar_id` (#1)

Intended for **multi-calendar awareness**: a user may have several calendars per provider, each holding different events. Added in `20260415000000_create_user_calendars` on the theory that each ledger entry should record which calendar the event lives on.

**Current reality:** the column exists but is **not populated by any insert site**. `src/controllers/cal-sync.controller.js` never sets it on any of the ~10 `ledgerInserts.push(...)` call-sites, and only the Apple adapter (`src/lib/cal-adapters/apple.adapter.js`) even knows which calendar an event came from at the ingest level. GCal/MSFT sync still treats the user's primary calendar as the one-and-only target.

This is a known gap — addressing it requires:
1. Every adapter tagging ingested events with their source calendar URL/ID.
2. Every ledger insert/update carrying `calendar_id` through.
3. Disambiguating lookups by `(user_id, provider, calendar_id, provider_event_id)` instead of `(user_id, provider, provider_event_id)`.

Until then, `calendar_id` is decorative.

#### `task_id` nullable (#2)

`task_id` is null when the ledger row represents a **provider event that has no matching Juggler task**. This happens in two documented paths in `cal-sync.controller.js`:

1. **Past events** (`cal-sync.controller.js:925-942`). When the pull phase discovers a provider event whose start is before `todayStart`, it writes a ledger row with `task_id: null, origin: '<provider>', status: 'active'` — purely as a "seen it, don't re-ingest" bookkeeping marker. No task is created because past events aren't actionable.

2. **Error ledger rows** (`cal-sync.controller.js:813-820`). When a retry of an event push fails persistently, the code writes a row with `task_id: <original task id>, status: 'error'` so the next sync run knows to skip it — but if the task was subsequently deleted, the FK-less column can become stale and is tolerated as null after cleanup.

Design intent: the null is a valid "seen, not imported" marker, not an error state. Consumers of the table should treat `task_id IS NULL` as "event-only row."

---

## `sync_history`

**Purpose.** Append-only audit log of every sync **action** performed during a sync run, one row per action. Companion to `cal_sync_ledger` (which is current state). Lets you answer: *what did the sync do on Tuesday at 3pm?*

Created by `20260412000000_create_sync_history`. Columns: `sync_run_id` (UUID — all rows from one `POST /cal-sync/run` share this), `provider`, `action` (`pushed`, `pulled`, `deleted_local`, `deleted_remote`, `created`, `error`), `task_id`, `task_text`, `event_id`, `old_values`, `new_values`, `detail`, `created_at`.

Written by `logSyncAction()` helper in `cal-sync.controller.js:71-81` (called ~9 places during a sync run). All rows for a run are buffered into `historyInserts[]` and written in a single transaction at `cal-sync.controller.js:1249`.

Read by `cal-sync.controller.js:1411` to power the sync history UI (`GET /cal-sync/history`).

---

## `user_calendars`

**Purpose.** Registry of enabled calendars per user per provider. Enables multi-calendar selection (e.g., user has personal + work Google calendars and chooses which to sync).

Created by `20260415000000_create_user_calendars`. Columns: `user_id`, `provider`, `calendar_id` (URL for Apple, ID for GCal/MSFT), `display_name`, `enabled`, `sync_direction` (`full` or `ingest`), timestamps. Unique on `(user_id, provider, calendar_id)`.

### Current reality (#22)

Only **Apple** uses this table today:

- `src/lib/cal-adapters/apple.adapter.js` reads enabled rows and iterates over them to list events across all selected CalDAV calendars.
- `src/controllers/apple-cal.controller.js` provides the full CRUD API used by the Apple connection settings UI.

**Gcal and Msft do not use `user_calendars`.** They read/write OAuth tokens from columns directly on the `users` table (e.g., `users.gcal_access_token`, `users.msft_refresh_token`) and operate against the provider's primary calendar only.

`sync_direction` semantics:
- `full` = pull **and** push
- `ingest` = pull-only (events appear as tasks, but Juggler tasks aren't written back)

Backfill: on migration, existing Apple selections (single `users.apple_cal_calendar_url`) were migrated into rows with `sync_direction = 'full'`.

To extend multi-calendar to GCal/MSFT, the work is (a) token storage needs to move or be shared across rows for a provider, and (b) both adapters need to iterate `user_calendars` entries instead of assuming a single primary.

---

## `schedule_queue`

**Purpose.** Lightweight DB-backed debounce queue for scheduler runs. One row per mutation that *could* require re-scheduling. The poll loop in `src/scheduler/scheduleQueue.js` reads the queue, waits for a quiet period (2 s, `DEBOUNCE_MS`), then sweeps all rows and runs the scheduler once.

Created by `20260413000000_create_schedule_queue`. Columns: `user_id`, `source` (free-form string identifying the mutation — e.g., `task-update`, `cal-sync`), `created_at`. No task_id; the queue is per-user, not per-task.

### Lifecycle (#7)

1. Any controller that mutates scheduling-relevant state calls `enqueueScheduleRun(userId, source)` in `src/scheduler/scheduleQueue.js:57`.
2. The call inserts a row and flips an in-memory `dirty[userId]` flag.
3. A background poll loop (1 s, `POLL_MS`) inspects dirty users. For each, it reads the newest `created_at` for that user:
   - If younger than `DEBOUNCE_MS`, it waits (debounce — another write might be imminent).
   - If older, it deletes **all rows up to `snapshotTime`** for that user (`scheduleQueue.js:121-124`), acquires the per-user lock, flushes the `task_write_queue`, runs the scheduler, and emits `schedule:changed` via SSE.
4. On startup, `scheduleQueue.js:198-201` does a one-time scan of both queues to mark orphan users as dirty so crash-survived work gets picked up.

Entries don't have any meaning individually. Only `MAX(created_at)` per user matters (for debouncing) and the row count (for knowing "is there pending work?"). Sweeping is unconditional.

---

## `task_write_queue`

**Purpose.** Durable coalescing buffer for task writes that arrive **while the per-user sync lock is held** (e.g., during a running scheduler pass or cal-sync pass). Without it, concurrent mutations would need to either block on the lock or risk being lost; with it, they're queued, coalesced, and flushed atomically when the lock releases.

Created by `20260414000000_create_task_write_queue`. Columns: `user_id`, `task_id`, `operation` (`create`/`update`/`delete`), `fields` (JSON row fragment pre-converted by `tasksToRow`), `source`, `created_at`.

### Lifecycle (#21)

1. A mutation endpoint classifies the row's fields via `splitFields()` in `src/lib/task-write-queue.js:62`:
   - **Non-scheduling fields** (`text`, `notes`, `project`, `section`, `gcal_event_id`, `msft_event_id`, `tz`, `updated_at`) go straight to the tasks table — safe under lock because they don't perturb scheduling.
   - **Scheduling-relevant fields** (everything else) are queued via `enqueueWrite()` (`task-write-queue.js:97`).
2. When the per-user lock releases, the lock-release hook calls `flushQueueInLock()` which:
   - Reads all queue rows for the user ordered by `created_at` ASC.
   - Coalesces them per task_id (multiple updates → last-write-wins merge; `create` then `delete` → no-op; etc.) via `coalesceEntries()`.
   - Applies the coalesced ops in one transaction.
   - Deletes the flushed rows (`task-write-queue.js:278`).
   - Enqueues a `schedule_queue` row so the scheduler sees the new state.
3. On startup, `scheduleQueue.js:200` also scans this queue to mark users dirty so pending writes survive crashes.

Fields column stores the **pre-converted DB row fragment** (not an API payload), so flushing is just a SQL write — no further transformation needed.

---

## `feature_events`

**Purpose.** Analytics log for feature-gate interactions. Records every time a user hits a gated feature (allowed, blocked, limit-checked) so we can see what users are trying to use at what rate and on what plan.

Created by `20260322000000_create_feature_events`, extended by `20260322200000_enhance_feature_events` to add `plan_id`, `endpoint`, `ip_address`, `request_id` for longitudinal analysis.

### Lifecycle (#3)

1. `src/middleware/feature-gate.js` wraps any gated route. Each of `requireFeature`, `requireFeatureIncludes`, and `checkUsageLimit` logs a row via `logFeatureEvent()` (`feature-gate.js:19-37`). Event types include `blocked`, `allowed`, `limit_hit`, etc.
2. `src/routes/feature-events.routes.js` exposes read endpoints for dashboards: raw event list + aggregated rollups (`feature-events.routes.js:51, 62`).

Writes are **fire-and-forget** — the insert `.catch()` only logs, never fails the request. So an unavailable DB doesn't break gating, and we tolerate occasional drops.

Not consumed by the scheduler or sync systems. Pure observability.

---

## Interaction Map — Sync Run (#8)

End-to-end of `POST /cal-sync/run` for a user with one cal-sync-running provider:

```
Request → cal-sync.controller.js
  │
  ├─ acquire per-user lock (sync_locks table)
  │
  ├─ Phase 1: Gather
  │     ├─ validate OAuth tokens
  │     └─ fetch events from each provider (GCal/MSFT call API; Apple iterates user_calendars)
  │
  ├─ Phase 2: Diff (in memory — no DB writes yet)
  │     ├─ read cal_sync_ledger for this user+provider (current state)
  │     ├─ read tasks_v for user's tasks
  │     └─ buffer changes into:
  │           taskUpdates[], taskInserts[], taskDeletes[]
  │           ledgerUpdates[], ledgerInserts[]
  │           historyInserts[]   ← one per action via logSyncAction()
  │
  ├─ Phase 3: Push (API calls to providers)
  │     └─ every push produces a ledgerInsert + logSyncAction('pushed', …)
  │
  ├─ Phase 4: Write (single transaction)
  │     ├─ tasks ← taskUpdates/Inserts/Deletes  (triggers fan out to task_masters/task_instances)
  │     ├─ cal_sync_ledger ← ledgerUpdates/Inserts
  │     ├─ sync_history ← historyInserts (append-only)
  │     └─ any scheduling-relevant writes that arrived during the run
  │         landed in task_write_queue — drained now by flushQueueInLock()
  │
  └─ release lock → scheduleQueue.enqueueScheduleRun(userId, 'cal-sync')
         │
         └─ poll loop picks up, debounces, runs scheduler,
            emits SSE 'schedule:changed'
```

Key invariants:
- `cal_sync_ledger` is the **source of truth for current sync state**. `sync_history` is write-only audit.
- `user_calendars` is read during Phase 1 by Apple only today; GCal/MSFT would read it if/when multi-cal lands.
- `task_write_queue` is the pressure-relief valve that makes lock-holding safe — mutations arriving mid-sync don't block or drop, they queue.
- `schedule_queue` is the **trigger** for scheduler runs but carries no semantics — it's a debounce buffer.

---

## `weather_cache`

**Purpose.** Backend-side cache for Open-Meteo hourly forecasts. The scheduler reads from this table to evaluate weather constraints on candidate time slots — it can't make live HTTP calls mid-placement, so forecasts must be pre-loaded. Frontend calls `/api/weather`, which checks this cache before going upstream.

Created by migration `20260505002000_create_weather_cache`.

```sql
CREATE TABLE weather_cache (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lat_grid     DECIMAL(5,2) NOT NULL,
  lon_grid     DECIMAL(5,2) NOT NULL,
  fetched_at   DATETIME NOT NULL,
  expires_at   DATETIME NOT NULL,
  forecast_json MEDIUMTEXT NOT NULL,
  INDEX idx_weather_cache_coords_exp (lat_grid, lon_grid, expires_at)
) COLLATE utf8mb4_unicode_ci;
```

### Cache key

Coordinates are rounded to 1 decimal place (`ROUND(lat, 1)`, `ROUND(lon, 1)`) before lookup — approximately a 10 km grid. This prevents near-identical coordinates from generating redundant rows (e.g., 40.712 and 40.714 both round to 40.7).

### TTL

1 hour. On cache hit (any row with `expires_at > NOW()` for the same grid cell), the cached JSON is returned without an upstream fetch. On miss, Open-Meteo is queried for 14 days of hourly data, stored, and `expires_at = NOW() + 1 HOUR`.

### `forecast_json` structure

Raw Open-Meteo hourly response. Backend parses it into `weatherByDateHour[dateKey][hourOfDay]` before passing to the scheduler:
```json
{
  "hourly": {
    "time":                     ["2026-05-05T00:00", ...],
    "temperature_2m":           [18.4, ...],
    "precipitation_probability": [5, ...],
    "precipitation":            [0.0, ...],
    "cloudcover":               [12, ...],
    "weathercode":              [1, ...]
  }
}
```

### Location source

The active location for a scheduling day is resolved via `getLocationForDate(dateKey, schedCfg)`. That location's `lat`/`lon` fields (stored in `user_config.locations[]`) are the cache lookup key. If a location has no coordinates, the weather constraint is skipped for that slot (fail-open).

---

## `ai_command_log`

**Purpose.** Per-user daily AI command quota tracking. Each row records one AI command attempt. The controller counts rows in the last 24 hours per user before allowing a Gemini call.

Created by migration `20260505001000_create_ai_command_log`.

```sql
CREATE TABLE ai_command_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ai_command_log_user_time (user_id, created_at)
);
```

### Quota enforcement

`checkAndLogDailyQuota(userId)` in `ai.controller.js`:
1. Counts rows where `created_at >= NOW() - INTERVAL 24 HOUR` for the user
2. If `count >= 50` → return `{ allowed: false }` → 429
3. Otherwise → insert a row (pessimistic, counts the attempt regardless of Gemini outcome) → return `{ allowed: true }`

Route-level `express-rate-limit` enforces 2 requests/minute independently.

---

## `task_masters` — weather condition columns

Added by migration `20260505002000_create_weather_cache` (Phase 1 of weather integration):

```sql
ALTER TABLE task_masters
  ADD COLUMN weather_precip    ENUM('any','wet_ok','light_ok','dry_only') NOT NULL DEFAULT 'any',
  ADD COLUMN weather_cloud     ENUM('any','overcast_ok','partly_ok','clear') NOT NULL DEFAULT 'any',
  ADD COLUMN weather_temp_min  SMALLINT NULL,
  ADD COLUMN weather_temp_max  SMALLINT NULL,
  ADD COLUMN weather_temp_unit CHAR(1) NULL;
```

All default to `any`/null — existing tasks are completely unaffected. Weather conditions live on `task_masters` only. Recurring instances inherit them via the standard template-merge in `rowToTask`; individual instances cannot override.

The `tasks_v` view must expose all five columns. See `WEATHER-INTEGRATION.md` for enum semantics, scheduler integration, and UI spec.

### `user_config` additions (location lat/lon + temperature unit)

The `user_config` JSON blob in the `users` table gains two additions for weather:

**Location objects** — each entry in `user_config.locations[]` gains optional `lat`/`lon` fields:
```json
{ "id": "home", "name": "Home", "icon": "🏠", "lat": 40.71, "lon": -74.01 }
```
These are populated via the location editor's geocode lookup or "Locate me" button.

**Temperature unit** — `user_config.temperature_unit: 'C' | 'F'` (default `'F'`). Controls display in calendar weather badges and is passed as a query param to Open-Meteo so `temperature_2m` arrives in the requested unit.

---

## Followups flagged during this review

These are not authoritative changes — they're observations to consider when triaging Buckets 2 and 3:

1. **`cal_sync_ledger.calendar_id` is unused.** Either populate it everywhere or drop the column.
2. **`user_calendars` is Apple-only.** Either generalize or rename to signal its scope.
3. **`section` is a dead field in the edit UI.** Decide whether to expose it, remove it, or keep it for import-only use.
4. **`occurrence_ordinal` is monotonic with no cap.** Confirmed expected behavior — closed 2026-04-27 (see #16/#25 note above).
5. **Text-cached `date`/`day`/`time` on `task_instances`.** Derived — convert to computed columns or drop + compute in views.
