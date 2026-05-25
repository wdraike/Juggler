# Code Review — Juggler "When" Scheduling Mode Simplification (Design Consult) — 2026-05-25

## Summary

This is a pre-implementation impact map, not a code-quality gate on existing code. The
planned removal of `datePinned`/`date_pinned`, `rigid`, `prev_when`, and the `unpinTask`
endpoint touches **11 source files in the backend, 8 in the frontend, 3 MCP files, and
every migration that re-declares the tasks view** — approximately 50+ callsites spread
across tightly coupled paths. Two RED FLAGs block a safe single-pass removal.

---

## A. `date_pinned` / `datePinned` Call Sites

### Backend writes
| File | Lines | What it does |
|------|-------|-------------|
| `task.controller.js` | 863-864 | **Create path:** auto-sets `date_pinned=1` when `dateWasSet` and caller omitted it |
| `task.controller.js` | 869-870 | **Create path:** auto-sets `placement_mode='fixed'` when `timeWasSet` and caller omitted it — **item 6 in scope** |
| `task.controller.js` | 961-962 | **Update fast-path:** same auto-pin when date provided |
| `task.controller.js` | 1107-1108 | **Update slow-path:** same auto-pin on create-via-update |
| `task.controller.js` | 1117-1118 | **Drag-pin path (`_dragPin`):** explicitly sets `date_pinned=1` |
| `task.controller.js` | 1245 | **Drag-pin delete:** resets `date_pinned=0` on instance when drag removed |
| `task.controller.js` | 2009-2011, 2153-2155 | Normalize: clearing `date_pinned` without changing `when` → compact `when` value |
| `task.controller.js` | 2415 | `unpinTask`: sets `date_pinned=0`, resets `placement_mode` |
| `task.controller.js` | 2460 | Cal-sync clear path: clears `date_pinned=0` so scheduler can re-place |
| `cal-sync.controller.js` | 1867 | Ingestion sets `date_pinned=1` for timed events, `0` for all-day |
| `mcp/tools/tasks.js` | 138, 198 | Auto-pin in single-create and batch-create MCP paths |
| `mcp/tools/tasks.js` | 284-285 | Auto-pin in update MCP path |
| `tasks-write.js` | 27, 58 | `date_pinned` in the writable-field whitelists (insertTask / updateTask) |

### Backend reads
| File | Line | Usage |
|------|------|-------|
| `task.controller.js` | 451 | `rowToTask` mapper — exposes `datePinned: !!row.date_pinned` to every API caller |
| `task.controller.js` | 530 | `taskToRow` — maps incoming `task.datePinned` → `row.date_pinned` |
| `task.controller.js` | 76, 82 | Ingested-task guard: `datePinned` is one of the five allowed fields for cal-synced tasks |
| `task.controller.js` | 606-614 | `guardFixedCalendarWhen` — blocks clearing `date_pinned` on calendar-linked tasks — **KEEP** |
| `task.controller.js` | 990-993 | Normalize: if clearing `date_pinned` without `when`, compact the `when` value |

### Scheduler reads
| File | Lines | Usage |
|------|-------|-------|
| `unifiedScheduleV2.js` | 316, 471 | `pinned = !!t.datePinned`; stored as `isPinned` on schedule item |
| `unifiedScheduleV2.js` | 692 | `if (item.isFixedWhen || item.isPinned)` — immovable check |
| `unifiedScheduleV2.js` | 857, 1381 | `item.isPinned` used in day-lock and Phase 0 immovable sort |

### Frontend reads
| File | Lines | Usage |
|------|-------|-------|
| `WhenSection.jsx` | 185, 233, 252-256 | Receives `datePinned` prop; renders Pin/Pinned toggle — **REMOVE** |
| `WhenSection.jsx` | 314 | Banner text branch on `datePinned` — **REMOVE** |
| `TaskEditForm.jsx` | 165, 276, 283, 340, 393, 447, 465 | Full state management for `datePinned` |
| `TaskEditForm.jsx` | 428 | `datePinned` in the giant `useEffect` dep array |
| `ScheduleCard.jsx` | 68 | Type badge rendered when `task.datePinned` — **REMOVE** |
| `DailyView.jsx` | 344 | Pin emoji prepended when `t.datePinned` |
| `SchedulerDebug.js` | 83 | Debug row "Date Pinned: Yes" |
| `useTaskState.js` | 67 | `datePinned` in TEMPLATE_PROPS for recurring propagation |

### DB schema
- **`task_masters` table:** `date_pinned BOOLEAN DEFAULT false` (migration `20260415010000`)
- **`tasks` table:** `date_pinned BOOLEAN DEFAULT false` (migration `20260304000000_add_date_pinned.js`)
- **`tasks_v` view:** `date_pinned` projected in every subsequent migration that recreates the view (~15 migrations)
- `recreate-views.js` script also projects `date_pinned`

---

## B. `rigid` Call Sites

### Backend — DB / schema
- `rigid` column defined in `20260301000000_initial_schema.js` (original tasks table) and `20260415010000_create_task_masters_and_instances.js` (task_masters table).
- `20260501000300_placement_mode_stored.js` line 39: `t.dropColumn('rigid')` — **rigid was physically dropped from the `tasks` table in this migration.**
- `task_masters` still has a `rigid` column (no drop migration seen for masters table — needs verification).

### Backend — active code writes to `rigid`
- `task.controller.js` — **0 writes found.** `taskToRow` does not set `row.rigid`. Phase 11 removed it.
- `tasks-write.js` — **0 writes found.** Not in any whitelist.
- `cal-sync.controller.js` — **0 writes found.**
- `mcp/tools/tasks.js` — exposes `rigid` as an accepted schema field (line 47) but traces through `taskToRow` which drops it.

### Backend — reads
- `unifiedScheduleV2.js` line 665: `rigid: t.placementMode === PLACEMENT_MODES.FIXED` — scheduler **re-derives** `rigid` from `placementMode` at runtime (not read from DB). This is the correct post-phase-11 pattern.
- `unifiedScheduleV2.js` lines 9, 26, 90, 312-316, 321, 450, 627, 706, 720, 857, 864, 866, 871, 1355, 1381-1396, 1696, 1705, 1756: uses the re-derived `rigid` concept extensively for recurring fixed task placement.

### Frontend — reads (active UI)
| File | Lines | Usage |
|------|-------|-------|
| `WhenSection.jsx` | 162, 304-306, 351, 462 | Receives `rigid` prop; renders Fixed/Float toggle — **REMOVE** |
| `TaskEditForm.jsx` | 155, 276, 334, 377, 428 | Full `rigid` state + dep array |
| `ScheduleCard.jsx` | 45, 70 | Badge branch on `task.rigid` |
| `DailyView.jsx` | 63, 305, 628 | Color/badge branches on `task.rigid` |
| `AppLayout.jsx` | 598, 624, 654 | Overdue + intraday logic reads `t.rigid` |
| `ImportExportPanel.jsx` | 188, 325, 376 | iCal export writes `X-JUGGLER-RIGID:TRUE`; import reads it back |
| `HelpModal.jsx` | 73 | User-facing copy mentions "non-rigid tasks" |
| `SchedulerDebug.js` | 85 | Debug row branches on `item.rigid` |
| `SchedulerStepper.jsx` | 220, 341 | Debug step display references `rigid` |
| `useTaskState.js` | 66 | `rigid` in TEMPLATE_PROPS |
| `taskReducer.js` | 85 | `rigid` in TEMPLATE_PROPS |

### Tests referencing `rigid`
- `taskPipeline.test.js` lines 58, 186: fixture rows have `rigid: 0`
- `taskMapping.test.js` lines 36, 58, 82, 94, 109, 114, 136, 153: multiple fixtures and assertions
- `taskControllerUnit.test.js` lines 22, 74-75: fixture + assertion that `rigid` is NOT in TEMPLATE_FIELDS
- `schedulerScenarios.test.js`, `schedulerSupplyDemand.test.js`, `schedulerTimeSimulation.test.js`, `expandRecurring.test.js`, `api.integration.test.js`, `taskStateTransitions.test.js`: use the term "rigid recurringTask" as a concept (referring to `placementMode=fixed` recurring tasks) — these are **semantic** uses inside scheduler logic tests, not direct field writes, and must stay or be renamed

---

## C. `prev_when` Call Sites

### Backend writes
| File | Lines | What it does |
|------|-------|-------------|
| `task.controller.js` | 452 | `rowToTask`: maps `row.prev_when` → `prevWhen` |
| `task.controller.js` | 1176-1177 | Drag-pin path: `prev_when` routed to instance not template |
| `task.controller.js` | 2408, 2414 | `unpinTask`: reads `existing.prev_when` to restore `when`; writes `prev_when: null` to clear |
| `tasks-write.js` | 27, 58 | `prev_when` in insert/update whitelists |
| Migrations (triggers) | 20260415010200, 20260415010400, 20260415010600 | MySQL triggers copy `prev_when` from tasks → task_masters/instances |

### Backend reads — scheduler
- `unifiedScheduleV2.js` — **0 reads of `prev_when` or `prevWhen` found.** The scheduler does not use it.

### Test files asserting on `prev_when`
| File | Lines | Nature |
|------|-------|--------|
| `taskPipeline.test.js` | 78, 603-613 | Fixture + 2 tests asserting `task.prevWhen` is exposed from `prev_when` |
| `taskControllerUnit.test.js` | 25 | Fixture row includes `prev_when: null` |
| `schedulerScenarios.test.js` | 113, 630, 638-651 | Fixture + S32/S33 tests using `prevWhen` on pinned/unpinned tasks |
| `taskCrudIntegration.test.js` | 658, 662 | Integration test "restores prev_when and clears date_pinned" |
| `taskCrudIntegration2.test.js` | 310, 322 | Two unpinTask integration tests inserting rows with `prev_when: 'afternoon'` |
| `14-sync-promotion.test.js` | 5 | Comment only — no assertion |
| Migration SQL | `recreate-views.js`, 14 migration files | View SELECT columns — purely passthrough, not asserting |

---

## D. `unpinTask` / `/unpin` Call Sites

### Endpoint definition
- `task.controller.js` lines 2378-2426: `async function unpinTask(req, res)` — reads `existing.prev_when`, builds restore update (sets `when` back, clears `date_pinned=0`, sets `placement_mode` to `anytime`/`time_blocks`), calls `enqueueScheduleRun`.
- `task.controller.js` line 2491: exported in module.exports.
- `task.routes.js` line 82: `router.put('/:id/unpin', taskController.unpinTask)`

### Frontend callers
- `TaskEditForm.jsx` line 447: sends `_allowUnfix: true` in update payload when a `datePinned` task is being un-pinned via the form (does **not** call `/unpin` directly — uses the regular PATCH path with `_allowUnfix`).
- No direct `fetch('/api/tasks/:id/unpin')` call found in frontend source — the frontend uses the form's PATCH path.

### Test files
| File | Lines | Nature |
|------|-------|--------|
| `taskCrudIntegration.test.js` | 654-674 | `describe('unpinTask')` — calls `controller.unpinTask` directly |
| `taskCrudIntegration2.test.js` | 304-329 | Two integration tests: regular unpin + rejected unpin on cal-synced task |
| `api-e2e/tasks-e2e.test.js` | 17, 148-168 | E2E test hitting `PUT /api/tasks/:id/unpin` |
| `tests/task-edit.spec.js` (Playwright) | 146-185 | Playwright flow looks for unpin affordance and clicks it |
| `test-validate-placements.js` | 1299 | Uses `datePinned: false` in a fixture — not an endpoint test |

### MCP
- `mcp/tools/tasks.js` — no call to `/unpin` endpoint; MCP tools handle placement via `datePinned`/`placementMode` fields on create/update directly.

---

## E. Server Auto-Set of `placement_mode='fixed'` — Exact Lines

**`task.controller.js` create path (lines 862-874):**
```
var dateWasSet = req.body.date !== undefined || req.body.scheduledAt !== undefined;
if (dateWasSet && row.date_pinned === undefined) {
  row.date_pinned = 1;                          // ← REMOVE (folded into placement_mode='fixed')
}
var timeWasSet = req.body.time !== undefined || req.body.scheduledAt !== undefined;
if (timeWasSet && row.placement_mode === undefined) {
  row.placement_mode = PLACEMENT_MODES.FIXED;   // ← REMOVE (user picks mode explicitly)
}
if (!timeWasSet && req.body.allDay === true && row.placement_mode === undefined) {
  row.placement_mode = PLACEMENT_MODES.ALL_DAY; // ← KEEP (all-day backstop is still correct)
}
```

**`task.controller.js` update fast-path (lines 961-962):**
```
&& fastRow.date_pinned === undefined) {
  fastRow.date_pinned = 1;                      // ← REMOVE
```

**`task.controller.js` update slow-path (line 1107-1108):**
```
if (dateWasSet && row.date_pinned === undefined) {
  row.date_pinned = 1;                          // ← REMOVE
```

**`task.controller.js` drag-pin path (lines 1117-1118):**
```
if (req.body._dragPin) {
  row.date_pinned = 1;                          // ← becomes row.placement_mode = 'fixed'
```

**MCP `tasks.js` (lines 137-138, 196-198, 283-285):** Three auto-pin blocks that mirror the controller logic — all need the same removal.

---

## F. `derivePlacementMode`

**Status: already removed.** The function does not exist in any `.js` source file in the codebase. `tests/unit/derivePlacementMode.test.js` explicitly documents this: "derivePlacementMode() was removed in plan 09-03. placement_mode is now written ONLY when the client explicitly supplies task.placementMode." The test file itself tests the direct-write path.

**Implication for `rigid`:** The scheduler (`unifiedScheduleV2.js` line 665) already re-derives `rigid` at schedule-item-build time from `placementMode`:
```js
rigid: t.placementMode === PLACEMENT_MODES.FIXED,
```
This means `rigid` is an **internal scheduler concept** (recurring fixed tasks = "rigid recurring"), not a DB field. The removal of the `rigid` UI toggle and field from TaskEditForm does not break the scheduler — the scheduler's internal use of the `rigid` label is fine as long as `placementMode` is correctly set. Rename-in-scheduler is a cosmetic improvement, not a correctness fix.

---

## G. Test Files Requiring Updates

| Test File | Fields to Remove/Update | Nature of Change |
|-----------|------------------------|-----------------|
| `taskPipeline.test.js` | `prev_when: null` fixture (line 78); 2 `prevWhen` assertions (lines 603-613) | Delete `prev_when` fixture field; delete 2 test cases |
| `taskControllerUnit.test.js` | `date_pinned: 0, prev_when: null` fixture (line 25); `rigid: 0` fixture (line 22) | Remove fields from fixture |
| `schedulerScenarios.test.js` | `prev_when: null` fixture (line 113); S32 (lines 638-647) referencing `prevWhen`; S33 (648-651) referencing `datePinned`/`prevWhen` | Delete S32/S33 or rewrite for new model |
| `taskCrudIntegration.test.js` | `describe('unpinTask')` block (lines 654-674) | Delete block or repurpose |
| `taskCrudIntegration2.test.js` | `describe('unpinTask')` block (lines 304-329) with 2 tests inserting `date_pinned`/`prev_when` rows | Delete block |
| `api-e2e/tasks-e2e.test.js` | `PUT /api/tasks/:id/unpin` test (lines 148-168) | Delete or repurpose |
| `task-edit.spec.js` (Playwright) | Unpin affordance flow (lines 146-185) | Delete test or rewrite for new mode-picker flow |
| `taskMapping.test.js` | `rigid: 0` fixtures (lines 36, 82, 114, 136, 153); assertion `row.rigid` is undefined (line 94) | Update fixtures |
| `expandRecurring.test.js` | `rigid: false` fixture (line 10) | Remove field from fixture |
| Scheduler scenario tests (supply/demand, time-sim, state-transitions, api-integration) | Use "rigid recurring" as a semantic concept — **no field assertion** | No change required; terminology is scheduler-internal |

---

## Critical Findings (RED FLAGs — must resolve before implementation)

| # | Finding | Location | Remediation |
|---|---------|----------|-------------|
| RF-1 | **`date_pinned` is the ONLY mechanism keeping the scheduler from moving a drag-pinned task.** If you remove `date_pinned` and fold into `placement_mode='fixed'`, the drag-pin code path (`_dragPin`) must atomically set `placement_mode='fixed'` AND you must verify that `unifiedScheduleV2.js` treats `placementMode=fixed` non-recurring tasks as immovable (it currently uses `isPinned = !!t.datePinned` at line 316 — NOT `placementMode`). If that condition is not updated, removed `date_pinned` means NO tasks are ever immovable after drag. Data corruption cascade. | `unifiedScheduleV2.js:316`; `task.controller.js:1117` | Update scheduler to: `pinned = t.placementMode === 'fixed' && !t.recurring` before touching the controller |
| RF-2 | **`guardFixedCalendarWhen` guards on `row.date_pinned === 0`** (controller line 613). If `date_pinned` is removed from DB and from the update payload, this guard silently becomes a no-op — calendar-linked tasks lose their immovability protection. The function must be rewritten to guard on `placement_mode` change attempts instead. | `task.controller.js:607-616` | Rewrite guard to check `row.placement_mode` being changed away from `fixed` on a cal-linked task |

---

## Warning Findings (fix this sprint)

| # | Finding | Location | Remediation |
|---|---------|----------|-------------|
| W-1 | `rigid` is still in the **MCP schema** as an accepted field (`mcp/tools/tasks.js` line 47). MCP clients (ClimbRS) can send `rigid: true`. `taskToRow` drops it silently, so it's a no-op — but it's a documented API surface that should be explicitly deprecated and removed from the Zod schema to avoid misleading MCP callers. | `mcp/tools/tasks.js:47` | Remove `rigid` from Zod schema; add deprecation note in MCP changelog |
| W-2 | `task_masters` table still has a `rigid` column (migration `20260415010000` line 37). The `tasks` table dropped it in `20260501000300`. The masters table column is a dead schema artifact — it's never written (confirmed by controller grep). Leaving it creates confusion about the canonical schema. | `20260415010000_create_task_masters_and_instances.js:37` | Add migration: `ALTER TABLE task_masters DROP COLUMN rigid` |
| W-3 | `ImportExportPanel.jsx` exports `X-JUGGLER-RIGID:TRUE` and imports it back (lines 188, 325, 376). After removal, exported iCal files will silently lose the `rigid` property on import — no error, no migration path. Users who export then re-import will get different behaviour. | `ImportExportPanel.jsx:188,325,376` | Remove export; on import, map `X-JUGGLER-RIGID=TRUE` → `placementMode: 'fixed'` for one cycle then drop |
| W-4 | `AppLayout.jsx` reads `t.rigid` for intraday-overdue detection (lines 598, 654). After removal, any task that was formerly `rigid` but is now `placementMode='fixed'` will stop triggering the overdue logic unless the read is updated. This is a silent functional regression. | `AppLayout.jsx:598,624,654` | Replace `t.rigid` reads with `t.placementMode === 'fixed'` |
| W-5 | `useTaskState.js` line 66 and `taskReducer.js` line 85 both include `rigid` in TEMPLATE_PROPS for recurring instance propagation. After removal from TaskEditForm, the reducer will still attempt to propagate `rigid` from template → instances. It's harmless (field is undefined) but leaves dead propagation logic. | `useTaskState.js:66`, `taskReducer.js:85` | Remove `rigid` from both TEMPLATE_PROPS arrays |

---

## Recommended Order of Changes

Perform in this sequence to avoid a window where the running system is broken:

1. **Scheduler first (RF-1):** In `unifiedScheduleV2.js`, change `pinned = !!t.datePinned` to `pinned = t.placementMode === PLACEMENT_MODES.FIXED && !t.isRecurring`. This is a pure additive change — `datePinned` still exists, so the old path also still fires. No regression risk.

2. **Guard rewrite (RF-2):** Rewrite `guardFixedCalendarWhen` to check `placement_mode` change rather than `date_pinned=0`. Deploy this before removing `date_pinned` writes.

3. **Backend controller:** Remove the auto-set blocks (items E1-E3 above). Update drag-pin path to set `placement_mode='fixed'` instead of `date_pinned=1`. Remove `unpinTask` endpoint (or convert to a `placement_mode='anytime'` patch). Remove `prev_when` logic from the unpin path. Update the ingested-task allowed-fields guard (currently allows `datePinned`).

4. **MCP tools:** Mirror the same auto-pin removal and field-schema cleanup.

5. **Frontend:** Remove `rigid` toggle, `datePinned` toggle, and `prev_when` state from `WhenSection.jsx` and `TaskEditForm.jsx`. Update `AppLayout.jsx`, `DailyView.jsx`, `ScheduleCard.jsx`, `ImportExportPanel.jsx`, `useTaskState.js`, `taskReducer.js`.

6. **Migration:** Add a migration that drops `prev_when`, drops `date_pinned`, drops `rigid` from `task_masters`, and updates all views to remove those columns. This is last — DB schema change is the hardest to reverse.

7. **Tests:** Update all listed test files after the above steps are verified passing individually.

---

## Conventions to Follow

- **Collation:** Any new migration that recreates the tasks view must specify `COLLATE utf8mb4_unicode_ci` on new columns (per monorepo CLAUDE.md).
- **No auto-derive:** The removal of auto-set `placement_mode='fixed'` must leave the all-day backstop (`req.body.allDay === true`) in place — that is not in scope for removal.
- **`guardFixedCalendarWhen` must stay:** Only its `date_pinned` check changes; the function itself remains as the calendar-immovability guard.
- **Drag-pin is the special case:** Drag sets placement from the UI, so the drag path (`_dragPin`) can and should set `placement_mode='fixed'` directly — this is the correct post-simplification model.
- **Scheduler internal `rigid` label:** The scheduler's concept of "rigid recurring" (= `placementMode=fixed` recurring tasks) can keep the internal variable name `rigid` — it is derived at runtime, not from DB. Renaming is optional cosmetics.

---

## Checklist Status

- [x] Scope determined — full juggler directory grep, all `.js`/`.jsx` files
- [x] `date_pinned` / `datePinned` — 13 write sites, 5 read sites (backend), 8 read sites (frontend), 3 MCP sites documented
- [x] `rigid` — 0 active DB writes, re-derived in scheduler; 11 frontend UI read sites; 2 dead schema artifacts
- [x] `prev_when` — 5 backend write sites, 0 scheduler reads, 6 test files asserting on it
- [x] `unpinTask` endpoint — 1 route, 1 controller function, 0 direct frontend callers (form uses PATCH), 3 test suites
- [x] Auto-set `placement_mode='fixed'` — exact lines (863-874, 961-962, 1107-1108, 1117-1118) documented
- [x] `derivePlacementMode` — already removed in phase 09-03; no action needed
- [x] Test files — 9 test files requiring updates enumerated with line numbers
- [ ] RED FLAG count: **2** (RF-1: scheduler `isPinned` path, RF-2: `guardFixedCalendarWhen` guard)
- [ ] WARNING count: **5** (W-1: MCP schema, W-2: dead `rigid` column in masters, W-3: iCal import/export, W-4: AppLayout overdue, W-5: TEMPLATE_PROPS)
