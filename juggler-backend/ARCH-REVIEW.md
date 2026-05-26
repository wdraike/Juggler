# Architecture Review — Juggler "When" Mode Simplification (Design Mode)
## Date: 2026-05-25 | Scope: Scheduling mode redesign (pre-implementation)

---

## Executive Summary

The proposed simplification from the current hybrid `datePinned`/`placement_mode` dual-signal system to a single `placement_mode` enum is architecturally sound and reduces complexity. Three BLOCK-level issues must be resolved before implementation begins: (1) `runSchedule.js` branches on `datePinned` at five distinct sites that are not yet covered by `placement_mode==='fixed'`; (2) all three cal adapters write `date_pinned=1` on ingest and that write-path must be coordinated with the column removal; (3) `guardFixedCalendarWhen` currently guards `date_pinned` clearing, not `placement_mode` clearing — it must be retargeted before `date_pinned` is removed. Four WARN-level issues exist around migration data correctness, drag-drop API surface, validation completeness, and a UI dead-code removal.

---

## Findings

### BLOCK-1: `runSchedule.js` branches on `datePinned` at five sites not covered by `placement_mode==='fixed'`

**Evidence:** Lines 1198, 1242, 1324, 1476–1478, and 2113 in `runSchedule.js`.

The scheduler write-back loop (Phase 9, line ~1192) has this guard:
```js
if (original.datePinned) {
  // only sync dur, never move date/time
  continue;
}
```
And again at line 1476 (past-task normalization):
```js
if (t.datePinned) return;
if (t.datePinned) return;   // duplicate — dead code already, but both must go
```
And at line 2113 (past recurring check):
```js
if (isPast && t.datePinned) return;
```

`placement_mode==='fixed'` is checked separately at line 1223:
```js
if (original.recurring && original.placementMode === PLACEMENT_MODES.FIXED && !dateChanged) continue;
```
This covers the **recurring-rigid** case but NOT the non-recurring pinned case. If `datePinned` is removed and `placement_mode` is not written to `fixed` for these tasks, the scheduler will start moving tasks it should leave alone.

**Required action:** Before removing `datePinned`, rewrite each `datePinned` branch in `runSchedule.js` to read `task.placementMode === PLACEMENT_MODES.FIXED` instead (or add a migration that sets `placement_mode='fixed'` on all rows where `date_pinned=1`, which is the data migration required anyway — see BLOCK-3).

---

### BLOCK-2: All three cal adapters write `date_pinned=1` on ingest — removal is a coordinated three-file change

**Evidence:** `gcal.adapter.js` line 182/265, `msft.adapter.js` line 244, `apple.adapter.js` line 244 — all contain:
```js
fields.placement_mode = PLACEMENT_MODES.FIXED;
if (dateChanged) fields.date_pinned = 1;
```

`cal-sync.controller.js` line 1867 also writes `date_pinned: 1` directly on new-task creation from calendar ingest.

If `date_pinned` is dropped from the schema without removing these writes, every ingest will throw a column-not-found error and break calendar sync. This is not a "zero out at app layer first" situation — the writes must be removed atomically with or before the schema drop.

**Required action:** Remove all `date_pinned` write-paths from all four locations (three adapters + controller) as a single coordinated change. The replacement signal is already in place (`placement_mode=FIXED` already written alongside it).

---

### BLOCK-3: `guardFixedCalendarWhen` guards `date_pinned` clearing, not `placement_mode` — it loses its effect after column removal

**Evidence:** `task.controller.js` lines 607–616:
```js
function guardFixedCalendarWhen(row, guardTarget, opts) {
  var isCalLinked = !!(guardTarget.gcal_event_id || guardTarget.msft_event_id || guardTarget.apple_event_id);
  if (!isCalLinked) return;
  // Prevent clearing date_pinned on calendar-linked tasks
  if (row.date_pinned === 0 || row.date_pinned === false) {
    delete row.date_pinned;
  }
}
```

This guard currently prevents clients from clearing `date_pinned=0` on calendar-linked tasks. After `date_pinned` is removed, this guard becomes a no-op. The equivalent protection needed is: prevent clearing `placement_mode` from `fixed` on calendar-linked tasks without `_allowUnfix`. This guard is called at six sites in `task.controller.js` and is the sole barrier against clients accidentally un-fixing calendar-synced tasks.

**Required action:** Before removing `date_pinned`, extend `guardFixedCalendarWhen` to also protect `placement_mode`: if the task is cal-linked and `row.placement_mode` would change away from `fixed`, delete `row.placement_mode` from the update (same pattern as current). Rename to `guardCalendarLinkedTask` to reflect the broader scope.

---

### WARN-1: Migration risk — data correctness of `date_pinned=1` rows before column drop

**Evidence:** Recent migrations (20260523000100, 20260525000100) already cleaned up tasks where `placement_mode='fixed'` was incorrectly set on juggler-native tasks with no user-intent constraints. However, the converse question — rows with `date_pinned=1` but `placement_mode` NOT `fixed` — has not been audited.

The proposed migration strategy must include a pre-drop audit:
```sql
SELECT COUNT(*) FROM task_instances
WHERE date_pinned = 1
  AND master_id IN (
    SELECT id FROM task_masters WHERE placement_mode != 'fixed'
  );
```
Any count > 0 means tasks are date-pinned but in `anytime`/`time_blocks`/`time_window` mode — the scheduler would stop respecting their pin once `datePinned` is removed. These must be corrected to `placement_mode='fixed'` (with date+time set) or have `date_pinned` zeroed in the master before column drop.

**Required action:** Run this audit query and add a migration that corrects any mismatched rows before `DROP COLUMN date_pinned`.

---

### WARN-2: Drag-and-drop sets `date_pinned=1` via `_dragPin` — needs replacement signal and `prev_when` coordinated removal

**Evidence:** `task.controller.js` line 1117–1119:
```js
if (req.body._dragPin) {
  row.date_pinned = 1;
}
```
And line 1177: `prev_when` is explicitly kept on the instance for drag-pins (not routed to template).

The `unpinTask` endpoint (line ~2383) restores `prev_when`, clears `date_pinned=0`, and infers `placement_mode` from the restored when-block.

**Design decision required for implementation:** When drag sets `placement_mode='fixed'` instead:
- The drop time becomes the task's `time` + `date` and `placement_mode='fixed'`.
- Unpin becomes: client calls a task update setting `placementMode` back to whatever mode the user wants (likely `anytime`). The `unpinTask` endpoint can either be repurposed to do this, or removed and replaced by a normal PATCH to `placementMode`.
- `prev_when` on `task_masters` is safe to drop: its only consumer is `unpinTask` restore logic (line 2408). Once unpin is replaced by normal mode-select, `prev_when` has no reader. Confirm no other code reads `prevWhen` before dropping.

**Required action:** Audit all reads of `prevWhen`/`prev_when` across the codebase and confirm they are exclusively in `unpinTask`. Then plan `unpinTask` repurposing/removal alongside `prev_when` column drop in one coordinated migration.

---

### WARN-3: `fixed` mode becoming user-selectable — validation guard exists but is incomplete

**Evidence:** `task.controller.js` lines 831–837 already have:
```js
if (body.placementMode === 'fixed') {
  // ...
  errors.push('placementMode "fixed" requires a date, time, or scheduledAt');
}
```

However, `task.controller.js` line 863–870 has a **server-side backstop** that auto-sets `placement_mode=FIXED` when a time is written without an explicit mode:
```js
if (timeWasSet && row.placement_mode === undefined) {
  row.placement_mode = PLACEMENT_MODES.FIXED;
}
```
This implicit promotion is the behavior being replaced by explicit user mode selection. After the redesign, this line should not promote `fixed` — it should be removed or gated so it only fires for calendar-ingest paths, not user edits. Otherwise a user who types a time while in `time_window` mode will silently get promoted to `fixed`.

**Required action:** Remove (or gate to cal-sync-only) the implicit `timeWasSet → placement_mode=FIXED` promotion in `task.controller.js`. The explicit validation guard is correct; the implicit backstop conflicts with the new design intent.

---

### WARN-4: `rigid` field still rendered in `WhenSection.jsx` despite scheduler removal

**Evidence:** `WhenSection.jsx` lines 162, 304–305, 351, 462 still render a "Fixed / Float" toggle driven by the `rigid` prop. Per the proposal and per TASK-PROPERTIES.md (phase 11), `rigid` was already removed from the scheduler. It is dead UI that will confuse the new 5-mode selector design.

**Required action:** Remove `rigid` prop and "Fixed/Float" toggle from `WhenSection.jsx` before the new mode selector is built. Also remove the `datePinned` pin/unpin button UI (lines 252–256) once drag-drop is wired to set `placement_mode='fixed'` instead.

---

## Question-by-Question Answers

### Q1: DB migration strategy for `date_pinned` and `prev_when`

**`date_pinned` (on `task_instances`, many rows):** Do NOT zero-and-ignore at the app layer first — the column is read by `runSchedule.js` at five sites and by `buildItems` in `unifiedScheduleV2.js` (line 317: `var pinned = !!t.datePinned`). App-layer ignoring without code changes just means the old behavior continues. The correct sequence is:
1. Data migration: `UPDATE task_instances SET date_pinned=0 WHERE master_id IN (SELECT id FROM task_masters WHERE placement_mode != 'fixed')` — normalizes mismatches.
2. Code migration: replace all `datePinned` branches with `placementMode==='fixed'` checks. This is the real work.
3. Remove all `date_pinned=1` writes (adapters + controller).
4. Schema migration: `ALTER TABLE task_instances DROP COLUMN date_pinned`.

The column is `TINYINT(1)` (boolean). On a large `task_instances` table, `DROP COLUMN` requires an in-place DDL change — MySQL 8 supports instant `DROP COLUMN` for non-indexed columns. Verify `date_pinned` has no index before dropping (the 20260307000000_add_composite_indexes migration should be checked).

**`prev_when` (on `task_masters`):** Safe to drop after confirming all reads are exclusively in `unpinTask`. `task_masters` is the smaller of the two tables. Standard `DROP COLUMN` with no blocker.

---

### Q2: Scheduler impact of replacing `datePinned` with `placement_mode='fixed'`

`unifiedScheduleV2.js` uses `datePinned` in exactly one place: `buildItems` line 317:
```js
var pinned = !!t.datePinned;
```
This sets `item.isPinned`, which is then used:
- Line 469: `isPinned: pinned` on the item object
- Line 693: `if ((item.isFixedWhen || item.isPinned) && warnings)` — overlap warning for pinned tasks
- Line 857: `if ((item.isPinned && !item.isRecurring) || ...)` — date-locks non-recurring pinned tasks in `findEarliestSlot`
- Line 1379: `isImmovable = ... || item.isPinned || ...` — routes to the tryPlaceAtTime immovable path

The critical question: is `placement_mode==='fixed'` already sufficient at each of these sites?

- Line 315: `var fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring` — this IS already set for non-recurring fixed.
- Line 475: `isRigid: pm === PLACEMENT_MODES.FIXED` — set for both recurring and non-recurring.
- Line 1379: `isImmovable = ... (item.isFixedWhen && item.anchorMin != null) || isRigidWithAnchor` — `isFixedWhen` is `fixed` on non-recurring items; `isRigidWithAnchor` covers recurring+fixed. Both require `anchorMin != null`.

**Gap found:** A non-recurring task with `placement_mode='fixed'` but NO `time` set (anchorMin=null) falls through to the queue (`isImmovable=false`), but a `datePinned=1` task with no time also falls through the same way (isPinned routes to `findEarliestSlot` date-lock at line 857, not tryPlaceAtTime). So behaviour is equivalent for that edge case.

**Conclusion:** Stopping writes of `date_pinned=1` and relying solely on `placement_mode='fixed'` is safe in the scheduler, provided `runSchedule.js`'s five `datePinned` branches are also updated.

---

### Q3: Calendar sync impact

All three adapters already write `placement_mode=FIXED` alongside `date_pinned=1`. The `cal-sync.controller.js` already checks `task.placementMode === PLACEMENT_MODES.FIXED` at line 869 for the push-wins logic. `guardFixedCalendarWhen` is the one gap (BLOCK-3 above). Removing `date_pinned=1` writes from adapters with no other changes will not break any sync behavior — the `placement_mode` signal is already authoritative.

---

### Q4: Drag-and-drop impact

The drag endpoint is `PATCH /api/tasks/:id` with `_dragPin=true` in the body. No separate drag controller exists — it runs through the main `updateTask` handler. The handler currently: sets `date_pinned=1` (line 1118) and saves `prev_when` on the instance (line 1177).

API changes needed for the new design:
- Client sends: `{ placementMode: 'fixed', date: '<dropped-date>', time: '<dropped-time>' }` — no `_dragPin` flag needed.
- Server removes the `_dragPin` conditional block entirely.
- `unpinTask` (`PUT /api/tasks/:id/unpin`) becomes: `PATCH /api/tasks/:id` with `{ placementMode: 'anytime' }` (or whatever mode the user had). The dedicated unpin endpoint can be deprecated.
- `prev_when` is not written.

No new endpoint is needed. The existing PATCH handler already accepts `placementMode` as a field (line 181 in the allowed fields list and line 586 for the write-path).

---

### Q5: Fixed mode validation architecture

The validation guard at line 831 already exists and returns a 400. Two additions needed:

1. **Client-side:** The new Fixed mode UI must collect date + time before allowing save — the server-side guard catches it but a client-side gate gives immediate feedback.

2. **Server-side implicit promotion removal:** Remove the `timeWasSet → placement_mode=FIXED` auto-promote at lines 869–871 in `task.controller.js`. After the redesign, mode is always explicitly user-set; the server should never auto-promote. Cal-sync paths (which are not user edits) already set `placement_mode` explicitly, so they don't rely on this backstop.

---

### Q6: Existing data risk — `date_pinned=1` with `placement_mode != 'fixed'`

This is a real risk. The 20260518 enum redesign migration backfilled `placement_mode` from the legacy `when='fixed'` token, but `date_pinned` was set independently (e.g. by drag-drop, by date-setting logic at lines 863–864/1107–1108 of task.controller.js). A task dragged to a date gets `date_pinned=1` but its `placement_mode` stays `anytime`. These would break after column removal.

The audit query (WARN-1 above) must be run. Based on the two recent stale-fixed cleanup migrations (20260523, 20260525), it is clear this data hygiene has been a recurring issue — the audit is non-optional.

---

## Summary Counts

| Severity | Count | Items |
|----------|-------|-------|
| BLOCK | 3 | BLOCK-1 (runSchedule datePinned branches), BLOCK-2 (adapter write-paths), BLOCK-3 (guardFixedCalendarWhen retarget) |
| WARN | 4 | WARN-1 (data audit), WARN-2 (drag-drop API + prev_when), WARN-3 (implicit fixed promotion), WARN-4 (rigid UI dead code) |

---

## Recommended Implementation Sequence

1. **Run data audit** (WARN-1) — count mismatched rows before writing any code.
2. **Extend `guardFixedCalendarWhen`** to also guard `placement_mode` (BLOCK-3) — this is a safe prep-step with no user-visible change.
3. **Rewrite `runSchedule.js` datePinned branches** to use `placementMode==='fixed'` (BLOCK-1).
4. **Remove `date_pinned=1` write-paths** from all three adapters and `cal-sync.controller.js` (BLOCK-2).
5. **Remove implicit `timeWasSet → FIXED` promotion** in `task.controller.js` (WARN-3).
6. **Migrate drag-drop** to use `placementMode:'fixed'` + date/time; deprecate `_dragPin` flag (WARN-2).
7. **Data migration** to correct mismatched rows, then `DROP COLUMN date_pinned`, `DROP COLUMN prev_when`.
8. **Remove rigid UI** from `WhenSection.jsx` (WARN-4).
9. **Build the new 5-mode selector** in the UI.

Steps 1–4 can be done before any UI work and are independently safe to ship.

---

---

# Pre-Commit Review — When-mode Simplification: Migration + Architecture
## Date: 2026-05-26 | Scope: `20260526000000_drop_pinned_and_rigid_columns.js`, `AUDIT-date_pinned-mismatch.sql`, scheduler/controller read+write paths

---

## Executive Summary

The prior design-mode BLOCKs 1, 2, and 3 are all resolved in the current implementation. The scheduler now reads only `placement_mode`; the cal adapters no longer write `date_pinned`; `guardFixedCalendarWhen` now guards `placement_mode` rather than `date_pinned`. The schema migration's DDL is structurally correct — column targets are right, view rebuilds drop only the removed columns, UNION branch column counts are symmetric. However, the pre-migration audit SQL file contains a critical wrong-table bug that would silently return 0 even when mismatches exist, and five active application-layer `date_pinned` write-paths remain that will throw column-not-found errors the moment the migration runs. Three BLOCK-level issues must be fixed before this migration can be executed.

---

## Migration File: `20260526000000_drop_pinned_and_rigid_columns.js`

### DDL Correctness

**PASS** — Column targets are correct: `date_pinned` is dropped from `task_instances` (confirmed as the table where the column lives, per `20260415010000_create_task_masters_and_instances.js`); `prev_when` and `rigid` are dropped from `task_masters` (confirmed correct). The prior design-mode review noted that `rigid` had already been removed from the scheduler — this migration completes the cleanup.

**PASS** — No index cleanup required: no index on `date_pinned` exists in any migration (the 20260307 composite-indexes migration only touches `tasks`, not `task_instances`). No index on `rigid` exists. MySQL 8 instant DDL applies, so the `DROP COLUMN` operations will not require a full table copy.

**PASS** — View drop/recreate order: views are dropped before the table `ALTER` (Step 1 before Step 2), so MySQL will not reject the column drop due to dependent view references.

**PASS** — View UNION column-count parity: both the template branch and the instance branch of the `tasks_v` UNION now contain the same number of columns, with neither `date_pinned` nor `prev_when`. Verified by comparing against the prior `20260519000100_restore_weather_columns_to_tasks_v.js` view.

**PASS** — Collation: string literals and NULL casts in the new `tasks_v` definition use explicit `COLLATE utf8mb4_unicode_ci`, consistent with the project collation rule.

**PASS** — Architectural single-signal: the new `tasks_v` exposes `placement_mode` and no longer exposes `date_pinned`. Consumers that previously read `t.datePinned` now uniformly read `t.placementMode === 'fixed'`. Verified in `runSchedule.js` (all five prior `datePinned` branches now use `PLACEMENT_MODES.FIXED`) and `unifiedScheduleV2.js` (no remaining `datePinned` reads; `rigid` item property is now derived as `t.placementMode === PLACEMENT_MODES.FIXED` at line 663).

**PASS** — Rollback: `exports.down` throws intentionally. This is correct for a destructive column-drop migration where re-adding the column without its historical data would create a corrupt state. The error message is clear.

**PASS** — `guardFixedCalendarWhen` (was BLOCK-3): the function now correctly guards `placement_mode` instead of `date_pinned`. Evidence: `task.controller.js` lines 605–615 — the guard deletes `row.placement_mode` when the update would change it away from `'fixed'` on a cal-linked task. The `date_pinned` field no longer appears anywhere in the guard body.

**PASS** — Cal adapters (was BLOCK-2): all three adapters (`gcal.adapter.js`, `msft.adapter.js`, `apple.adapter.js`) no longer write `date_pinned`. The `applyEventToTaskFields` function in each sets only `placement_mode`. Verified by grep — zero `date_pinned` hits in any adapter file.

**PASS** — `PUT /:id/unpin` route: the endpoint does not exist in `task.routes.js`. Mode change is exclusively via `PATCH /api/tasks/:id`. Confirmed.

**PASS** — `timeWasSet → FIXED` implicit promotion (was WARN-3): removed from both `createTask` (line 867) and `updateTask` (line 1095) paths. The backstop now only fires for `allDay=true` → `ALL_DAY` mode, which is correct and intentional.

---

## BLOCK Findings

### BLOCK-A: Audit SQL queries wrong table — `date_pinned` does not exist on `task_masters`

**File:** `juggler-backend/src/db/migrations/AUDIT-date_pinned-mismatch.sql`

**Evidence:**
```sql
-- Step 1
SELECT COUNT(*) FROM task_masters
WHERE date_pinned = 1 AND placement_mode NOT IN ('fixed', 'reminder');

-- Step 2
UPDATE task_masters
SET placement_mode = 'fixed'
WHERE date_pinned = 1
  AND placement_mode NOT IN ('fixed', 'reminder')
  AND (time IS NOT NULL OR scheduled_at IS NOT NULL);
```

`date_pinned` is a column on `task_instances`, not `task_masters`. `task_masters` has never had a `date_pinned` column (confirmed across all migrations from schema creation through present). Running Step 1 against production MySQL will throw `ERROR 1054 (42S22): Unknown column 'date_pinned' in 'where clause'` — or, if the database engine silently errors, it will return 0, giving a false all-clear. Either outcome is dangerous: the first aborts the audit before it runs; the second gives the operator false confidence that no mismatches exist, leading them to execute the column-drop against unaudited data.

Additionally, Step 2's `time IS NOT NULL OR scheduled_at IS NOT NULL` references `time` and `scheduled_at` which also do not exist on `task_masters` — those are `task_instances` columns. The entire correction UPDATE would fail.

The correct query targets `task_instances` with a join to `task_masters` for the `placement_mode` check:
```sql
-- Step 1: Correct audit
SELECT COUNT(*) FROM task_instances i
JOIN task_masters m ON m.id = i.master_id
WHERE i.date_pinned = 1
  AND m.placement_mode NOT IN ('fixed', 'reminder');

-- Step 2: Correct remediation
UPDATE task_masters m
JOIN task_instances i ON i.master_id = m.id
SET m.placement_mode = 'fixed'
WHERE i.date_pinned = 1
  AND m.placement_mode NOT IN ('fixed', 'reminder')
  AND (i.time IS NOT NULL OR i.scheduled_at IS NOT NULL);
```

Note: the `UPDATE` sets `placement_mode` on `task_masters` (correct — that is where the column lives), but must JOIN from `task_instances` to find the `date_pinned=1` rows.

**Required action:** Fix `AUDIT-date_pinned-mismatch.sql` to target `task_instances` for the audit SELECT and for the JOIN in the UPDATE. Do not run the migration until the fixed audit script returns 0 rows.

---

### BLOCK-B: Five active `date_pinned` write-paths remain in application code — column-drop will break them

**Files and lines:**

1. `juggler-backend/src/scheduler/runSchedule.js:1241` — writes `date_pinned: 0` in the per-task scheduled-placement DB update object.
2. `juggler-backend/src/scheduler/runSchedule.js:1551` — writes `date_pinned: 0` in the batch-update `updateFields` object used for the CASE expression bulk write.
3. `juggler-backend/src/lib/reconcile-splits.js:143` — writes `date_pinned: template ? template.date_pinned : 0` when inserting new split chunks.
4. `juggler-backend/src/controllers/task.controller.js:1219` — writes `date_pinned: 0` when creating an initial instance row inside a recurring-template create transaction.
5. `juggler-backend/src/lib/tasks-write.js:48,71,115` — `INSTANCE_FIELDS` includes `'date_pinned'`; `INSTANCE_UPDATE_FIELDS` includes `'date_pinned'`; `pickInstance()` constructs `date_pinned: row.date_pinned ? 1 : 0` on every instance insert.

All five write paths will throw a MySQL `Unknown column 'date_pinned'` error the moment the migration runs. Items 1 and 2 are in the scheduler's hot path — every scheduling run for every user will fail. Item 3 breaks split-task generation. Items 4 and 5 break task creation.

The cal adapters (BLOCK-2 from the design-mode review) are already clean — no `date_pinned` writes remain there. But these five application-layer paths were not cleaned up and will cause immediate production failures.

**Required action:** Before executing the migration, remove `date_pinned` from all five write sites:
- `runSchedule.js:1241` — remove `date_pinned: 0` from `dbUpdate` object.
- `runSchedule.js:1551` — remove `date_pinned: 0` from `updateFields` object.
- `reconcile-splits.js:143` — remove the `date_pinned` key from the insert object.
- `task.controller.js:1219` — remove `date_pinned: 0` from the instance upsert object.
- `tasks-write.js:48` — remove `'date_pinned'` from `INSTANCE_FIELDS`.
- `tasks-write.js:71` — remove `'date_pinned'` from `INSTANCE_UPDATE_FIELDS`.
- `tasks-write.js:115` — remove the `date_pinned: row.date_pinned ? 1 : 0` line from `pickInstance()`.

---

### BLOCK-C: `prev_when` in `MASTER_FIELDS` and `MASTER_UPDATE_FIELDS` will cause column-not-found on task creates/updates after the migration

**File:** `juggler-backend/src/lib/tasks-write.js:27,58`

```js
var MASTER_FIELDS = [
  ...
  'preferred_time_mins', 'tz', 'prev_when',
  ...
];

var MASTER_UPDATE_FIELDS = [
  ...
  'preferred_time_mins', 'tz', 'prev_when',
  ...
];
```

`prev_when` is in both field-routing arrays. When a task is created or updated and `prev_when` is present in the incoming `row` (or when `pickMaster` constructs the master insert object), it will be included in the SQL write to `task_masters`. After `prev_when` is dropped from `task_masters`, any write that includes this field will throw `Unknown column 'prev_when'`.

The field is not sent by the API (no client sets `prevWhen` — confirmed by grep showing only stale field-list entries). But the routing arrays enumerate it, which means any object that passes through `tasks-write.js` will include it in the DB write if the caller ever sets it. The risk window is open the moment the column is dropped.

**Required action:** Remove `'prev_when'` from both `MASTER_FIELDS` (line 27) and `MASTER_UPDATE_FIELDS` (line 58) in `tasks-write.js` before executing the migration.

---

## WARN Findings

### WARN-A: Frontend `ScheduleCard.jsx` still reads `task.datePinned` for the pin badge

**File:** `juggler-frontend/src/components/schedule/ScheduleCard.jsx:68`

```js
if (task.datePinned) typeBadges.push({ icon: '...', title: 'Date pinned — stays on this date...' });
```

`rowToTask` no longer emits `datePinned` (confirmed — the field is absent from the return object). This line will silently never fire after the migration. The badge is dead UI but causes no runtime error.

The `rigid` read on line 70 (`task.rigid || task.fixed || task.placementMode === 'fixed'`) will also always return false for `task.rigid` since `rigid` is not in the API response — but `task.placementMode === 'fixed'` still works correctly.

**Required action:** Remove the `task.datePinned` branch from `ScheduleCard.jsx:68`. Clean up the `task.rigid` sub-expression from line 70 (it is dead since `rowToTask` never emits `rigid`; the `task.placementMode === 'fixed'` check alone is sufficient).

### WARN-B: `rigid` prop wired through `TaskEditForm.jsx` and `WhenSection.jsx` — dead code from column drop

**Files:** `juggler-frontend/src/components/tasks/TaskEditForm.jsx:155,276,333,375,446`, `WhenSection.jsx:162,350,512`

`rigid` state is initialized from `task.rigid` which the API no longer emits (always `undefined`). The prop is threaded through to `WhenSection` where it gates `timeFlex` select rendering. This is dead code — `rigid` is always `false`/`undefined` — but it adds noise and could confuse future readers.

This was WARN-4 in the design-mode review. It still exists.

**Required action:** Remove `rigid` state from `TaskEditForm.jsx` and the `onRigidChange` prop from `WhenSection.jsx`. The timeFlex selector should be driven by `placementMode` directly.

### WARN-C: Stale comment in `cal-sync.controller.js:116`

**File:** `juggler-backend/src/controllers/cal-sync.controller.js:116`

The comment still reads: `"Promotion logic (placement_mode=fixed, date_pinned, marker clearing) lives in applyEventToTaskFields."` The `date_pinned` reference is stale — `applyEventToTaskFields` no longer touches `date_pinned`.

**Required action:** Update the comment to remove the `date_pinned` reference.

---

## Prior Design-Mode BLOCKs — Status

| Prior Finding | Status | Evidence |
|---------------|--------|----------|
| BLOCK-1: `runSchedule.js` datePinned branches | RESOLVED | All five prior `datePinned` read sites now use `PLACEMENT_MODES.FIXED`. New BLOCK-B covers residual write-path issue. |
| BLOCK-2: Cal adapter `date_pinned=1` writes | RESOLVED | All three adapters' `applyEventToTaskFields` functions no longer write `date_pinned`. |
| BLOCK-3: `guardFixedCalendarWhen` guards wrong field | RESOLVED | Guard now deletes `row.placement_mode` when task is cal-linked. |
| WARN-1: Audit query correctness | SUPERSEDED by BLOCK-A | The audit SQL exists but targets the wrong table. |
| WARN-2: `_dragPin` / `prev_when` / `unpinTask` | RESOLVED | No `_dragPin` code in controller, no `PUT /:id/unpin` route, `prev_when` only survives in field lists (see BLOCK-C). |
| WARN-3: Implicit `timeWasSet → FIXED` promotion | RESOLVED | Removed from both create and update paths. |
| WARN-4: `rigid` UI dead code | PERSISTS as WARN-B | `rigid` still wired in `TaskEditForm` and `WhenSection`. |

---

## Summary Counts

| Severity | Count | Items |
|----------|-------|-------|
| BLOCK | 3 | BLOCK-A (audit SQL wrong table), BLOCK-B (5 active date_pinned writes), BLOCK-C (prev_when in MASTER_FIELDS/MASTER_UPDATE_FIELDS) |
| WARN | 3 | WARN-A (ScheduleCard datePinned badge), WARN-B (rigid prop dead code), WARN-C (stale comment) |

**Verdict: BLOCK**

Do not execute the migration until BLOCK-A, BLOCK-B, and BLOCK-C are resolved. Execution with any of these three present will either corrupt the audit result (BLOCK-A) or cause immediate runtime failures across the scheduler, task creation, and split reconciliation (BLOCK-B and BLOCK-C).
