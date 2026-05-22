# Phase 9: Placement Mode Enum Redesign — Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the current 7-value `placement_mode` ENUM (which conflates recurrence with mode, uses heuristics derived from `when` content, and includes an unimplemented `pinned_date` value) with a clean 6-value ENUM representing only the scheduling constraint — never the recurrence state.

The `when` field today contains both user-defined slot tag names AND special system keywords ('allday', 'fixed'). This is wrong: users can define any tag names, so system keywords embedded in user data create ambiguity. After this phase, `when` contains ONLY user-defined slot tags; all mode information lives in `placement_mode`.

The three scheduling modes (anytime / time_window / time_blocks) apply to ALL task types — one-off, recurring, all_day, fixed. Recurrence is orthogonal and stays in the separate `recurring` flag. The scheduler must branch on `placement_mode` directly, never on `when` content or derived flags.

Out of scope: any UI changes beyond the mode selector and form submission; no new scheduling algorithms; no changes to timeFlex mechanics; no calendar sync changes.

</domain>

<decisions>
## Implementation Decisions

### New ENUM Values (6 total — replaces current 7)

| Value | Meaning | Scheduler treatment |
|-------|---------|---------------------|
| `reminder` | Calendar marker; no time-grid occupancy | dur=0, coexist with other tasks at same minute |
| `all_day` | Spans full day; excluded from time grid | Skip in time-grid placement entirely |
| `fixed` | Immovable at exact time | Never moved; blocks slot |
| `time_window` | Anchored near preferredTimeMins ± timeFlex | Flex around anchor within window |
| `time_blocks` | Constrained to user-named `when` tag windows | Only place within resolved block windows |
| `anytime` | No constraint | Fill wherever fits |

- **D-01:** `pinned_date` DROPPED entirely — was a reserved placeholder, no UI ever set it, no code paths reach it.
- **D-02:** `recurring_rigid`, `recurring_window`, `recurring_flexible` DROPPED — recurrence is orthogonal to mode. The `recurring` flag stays on `task_masters`; any mode can be recurring (e.g. a recurring holiday is `recurring=1, placement_mode='all_day'`).
- **D-03:** `FLEXIBLE` DROPPED — replaced by `anytime`, `time_window`, or `time_blocks` as appropriate.
- **D-04:** `MARKER` renamed to `reminder` — better communicates the semantic (calendar reminder, not a scheduling marker).

### Data Migration

- **D-05:** Migration timestamp: `20260518000100`. Migration name: `placement_mode_enum_redesign`.
- **D-06:** ALTER TABLE must use `MODIFY COLUMN` to change the ENUM definition. MySQL requires specifying the full new list.
- **D-07:** Backfill CASE expression (run BEFORE altering the column so old values are still readable):
  ```sql
  UPDATE task_masters SET placement_mode = CASE
    WHEN marker = 1 OR placement_mode = 'marker'       THEN 'reminder'
    WHEN `when` LIKE '%allday%'                          THEN 'all_day'
    WHEN `when` LIKE '%fixed%'                           THEN 'fixed'
    WHEN preferred_time_mins IS NOT NULL                 THEN 'time_window'
    WHEN `when` IS NOT NULL AND `when` != ''             THEN 'time_blocks'
    ELSE                                                      'anytime'
  END
  ```
  Note: `marker` column no longer exists (dropped in migration 20260501000300) — use `placement_mode = 'marker'` for existing marker rows.
- **D-08:** After backfill, strip 'allday' and 'fixed' tokens from the `when` column:
  ```sql
  UPDATE task_masters SET `when` = TRIM(BOTH ',' FROM REGEXP_REPLACE(REPLACE(REPLACE(`when`, 'allday', ''), 'fixed', ''), ',+', ','))
  WHERE `when` LIKE '%allday%' OR `when` LIKE '%fixed%';
  ```
  If MySQL version doesn't support REGEXP_REPLACE, use application-level cleanup via Knex raw or a JS loop over affected rows.
- **D-09:** Rebuild tasks_v and tasks_with_sync_v views after the ENUM change. The view currently computes backward-compat `marker` (int) and `rigid` (int) columns from `placement_mode`. Update these computed columns to use the new enum values:
  - `marker` virtual column: `CASE WHEN m.placement_mode = 'reminder' THEN 1 ELSE 0 END`
  - `rigid` virtual column: `CASE WHEN m.placement_mode = 'fixed' THEN 1 ELSE 0 END`
  (Previously `rigid` was derived from `recurring_rigid` — after this phase, only `fixed` maps to rigid=1.)

### Backend — Constants and Controller

- **D-10:** `juggler-backend/src/lib/placementModes.js` — replace the PLACEMENT_MODES object with the 6 new values:
  ```js
  { REMINDER:'reminder', ALL_DAY:'all_day', FIXED:'fixed', TIME_WINDOW:'time_window', TIME_BLOCKS:'time_blocks', ANYTIME:'anytime' }
  ```
- **D-11:** `task.controller.js` — Remove `derivePlacementMode()` entirely. This function inspects `when` content (including `when.includes('fixed')`) — exactly the antipattern being fixed.
- **D-12:** `task.controller.js` — Remove `marker` and `rigid` from `PLACEMENT_TRIGGER_FIELDS`. After this phase, `placement_mode` is always written directly by the UI; no server-side derivation.
- **D-13:** `task.controller.js` `taskToRow()` — simplify the placement block: if `task.placementMode` is set, write it directly. Do NOT call `derivePlacementMode()`. The `else` branch (line 568–577) must be removed.
- **D-14:** `task.controller.js` line 837–839 area — the `takeOwnership` action hardcodes `row.placement_mode = PLACEMENT_MODES.FIXED`. Review this: if a task is being taken over, its mode should be preserved, not forced to `fixed`. Remove or change this to preserve existing placement_mode.
- **D-15:** `task.controller.js` `rowToTask()` — the `placementMode` mapping at line 426 uses `row.placement_mode || PLACEMENT_MODES.FLEXIBLE`. Change fallback to `PLACEMENT_MODES.ANYTIME`.

### Backend — Scheduler

- **D-16:** `unifiedScheduleV2.js` — replace all branching on old PLACEMENT_MODES constants with new ones:
  - `PLACEMENT_MODES.MARKER` → `PLACEMENT_MODES.REMINDER` (or string `'reminder'`)
  - `PLACEMENT_MODES.RECURRING_RIGID`, `RECURRING_WINDOW`, `RECURRING_FLEXIBLE` → check `t.recurring` flag directly for "is this a recurring task", and `pm === 'time_window'` / `pm === 'time_blocks'` / `pm === 'anytime'` for mode
  - `PLACEMENT_MODES.FLEXIBLE` → `PLACEMENT_MODES.ANYTIME`
- **D-17:** `unifiedScheduleV2.js` line 300 — remove the `when === 'fixed'` strip: `var when = (t.when === 'fixed' ? '' : (t.when || ''))` → `var when = t.when || ''`. After migration, 'fixed' will never appear in `when`.
- **D-18:** `unifiedScheduleV2.js` line 301-302 — replace `allday` detection from `when` content with `placement_mode` check: `if (pm === PLACEMENT_MODES.ALL_DAY) return;` (instead of `if (allday) return;`).
- **D-19:** `unifiedScheduleV2.js` line 307-309 — `isExplicitRecurringMode` variable becomes unnecessary. Replace: `var recurring = pm === PLACEMENT_MODES.RECURRING_RIGID || ...` → `var recurring = !!t.recurring`.
- **D-20:** `unifiedScheduleV2.js` line 326 — update recurring_rigid/window check: `if (pm === 'time_window' && t.preferredTimeMins != null && anchorMin == null)`.
- **D-21:** `unifiedScheduleV2.js` line 631 — update marker check: `marker: !!(p.task && p.task.placementMode === PLACEMENT_MODES.REMINDER)`.
- **D-22:** `unifiedScheduleV2.js` line 650 — `rigid: t.placementMode === PLACEMENT_MODES.RECURRING_RIGID` → `rigid: t.placementMode === PLACEMENT_MODES.FIXED`. (This feeds the `u.isRigid` check used in lines 1683-1687.)
- **D-23:** Scan the full `unifiedScheduleV2.js` for any remaining references to `recurring_rigid`, `recurring_window`, `recurring_flexible`, `FLEXIBLE`, `MARKER`, `PINNED_DATE` and update them all.

### Frontend — Mode Selection

- **D-24:** `WhenSection.jsx` — the three-button mode selector (anytime / time_window / time_blocks) currently only renders for recurring tasks (lines 350-408). Extend it to non-recurring tasks as well. Non-recurring tasks should have the same three modes; the current non-recurring UI only has "Anytime" + "All Day" buttons (lines 278-348).
- **D-25:** `WhenSection.jsx` — remove inference of mode from `hasPreferredTime` + tag count. Lines 221-222:
  ```js
  var isAnytimeMode = !hasPreferredTime && activeTags.length === 0;
  var isBlocksMode = !hasPreferredTime && activeTags.length > 0;
  ```
  Replace with `placementMode` prop passed from TaskEditForm.
- **D-26:** `WhenSection.jsx` — when the user clicks a mode button, call `onModeChange(mode)` (a new prop) that sets `placementMode` in TaskEditForm state. The mode state must flow DOWN from TaskEditForm, not be inferred in WhenSection.
- **D-27:** `TaskEditForm.jsx` line 358 — `hasPreferredTime` state is used to distinguish `time_window` from `time_blocks` for recurring tasks. After this refactor, `placementMode` state replaces this. Initialize from `task.placementMode` directly.
- **D-28:** `TaskEditForm.jsx` line 485 — `rigid: recurring && hasPreferredTime && time ? false : rigid` — the `rigid` field being sent to the backend is now meaningless (the ENUM column is the source of truth). Remove `rigid` from the submitted patch or keep for backward compat (backend ignores it if `placement_mode` is already set).
- **D-29:** `TaskEditForm.jsx` lines 522-527 — fix the `preferred_time` / `preferred_time_mins` write path:
  - Line 522: `preferredTime: recurring ? hasPreferredTime : undefined` → `preferredTime: placementMode === 'time_window' ? true : (placementMode === 'time_blocks' ? false : undefined)` (or simply stop sending this field — `preferred_time` is now derivable from `placement_mode`).
  - Line 527: `preferredTimeMins: recurring && hasPreferredTime && time` → `preferredTimeMins: placementMode === 'time_window' && time` (remove the `recurring &&` gate).
- **D-30:** `TaskEditForm.jsx` — add `placementMode` to the `buildFields()` output so it's included in patches sent to the backend.
- **D-31:** `TaskEditForm.jsx` — `all_day` and `reminder` modes should be settable from the UI. The current "All Day" button (WhenSection non-recurring UI, line 278-348 area) should set `placement_mode = 'all_day'`. The "Marker" UI control (wherever it is — likely a separate toggle) should set `placement_mode = 'reminder'`.

### Docs

- **D-32:** `juggler-backend/docs/TASK-PROPERTIES.md` — update `placement_mode` documentation to list the 6 new values with their descriptions.
- **D-33:** `juggler-backend/docs/SCHEDULER.md` — update the placement branching section to reflect `placement_mode`-first branching.

### Claude's Discretion

- Migration order: Backfill first (UPDATE with CASE), then MODIFY COLUMN (change ENUM definition), then rebuild views. This avoids MySQL rejecting unknown enum values during the transition.
- The `preferred_time` boolean column in `task_masters` can be left in place — it's now derivable from `placement_mode` and can be removed in a later cleanup migration, but changing it now adds risk without benefit.
- Test strategy: write a unit test that verifies the backfill CASE expression maps all 7 old values to the correct 6 new values, then verify the `when` column is clean after the strip step.
- The `PLACEMENT_TRIGGER_FIELDS` in task.controller.js should retain `when` and `placementMode` but drop `marker`, `rigid`, `recurring` (those are no longer placement triggers).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Placement Mode
- `juggler-backend/src/lib/placementModes.js` — current ENUM constants (to be replaced)
- `juggler-backend/src/db/migrations/20260501000300_placement_mode_stored.js` — last placement_mode migration; contains the current view SQL that must be rebuilt

### Scheduler
- `juggler-backend/src/scheduler/unifiedScheduleV2.js` — main scheduler; all placement branching is here (lines 280-360 for pool categorization, scan for all PLACEMENT_MODES references)
- `juggler-backend/docs/SCHEDULER.md` — scheduler design doc (update after code changes)

### Backend Controller
- `juggler-backend/src/controllers/task.controller.js` — `derivePlacementMode()` (line 103), `PLACEMENT_TRIGGER_FIELDS` (line 30), `taskToRow()` placement block (line 562-578), `rowToTask()` (line 426), `takeOwnership` placement_mode hardcode (line 837-839)

### Frontend
- `juggler-frontend/src/components/tasks/sections/WhenSection.jsx` — mode buttons: non-recurring UI (lines 278-348), recurring 3-button selector (lines 350-408), mode inference (lines 219-222)
- `juggler-frontend/src/components/tasks/TaskEditForm.jsx` — `hasPreferredTime` state (line 358), preferred_time write path (line 522), preferredTimeMins write (line 527), buildFields output (line 543 area)

### Architecture
- `juggler-backend/CLAUDE.md` — scheduler safety rules

</canonical_refs>

<code_context>
## Existing Code Insights

### Migration Strategy
- Latest migration: `20260517000100_add_event_url_to_cal_sync_ledger.js` — new migration timestamp: `20260518000100`
- MySQL ENUM change requires: drop the NOT NULL constraint temporarily, or use `MODIFY COLUMN` with the complete new enum list including all valid values
- The current ENUM: `('marker', 'fixed', 'pinned_date', 'recurring_rigid', 'recurring_window', 'recurring_flexible', 'flexible')`
- New ENUM: `('reminder', 'all_day', 'fixed', 'time_window', 'time_blocks', 'anytime')`
- Migration order: 1) UPDATE backfill (old column values still valid), 2) MODIFY COLUMN (change enum), 3) rebuild views

### View Rebuild Required
The `tasks_v` and `tasks_with_sync_v` views were last rebuilt in migration `20260501000300`. After changing the ENUM, these views must be dropped and recreated. The full SQL for both views is in that migration file and must be updated with the new enum value names.

### Scheduler Impact — Recurring Flag
Critical: the scheduler currently derives `var recurring = pm === PLACEMENT_MODES.RECURRING_RIGID || pm === PLACEMENT_MODES.RECURRING_WINDOW || pm === PLACEMENT_MODES.RECURRING_FLEXIBLE`. After this phase, this must become `var recurring = !!t.recurring`. The `recurring` field is already present on all task objects from `tasks_v`.

### Frontend — Mode Selector Gap
The non-recurring task UI in WhenSection.jsx (lines 278-348) only has "Anytime" and "All Day" buttons. There is no time_window or time_blocks mode selector for one-off tasks. This is the bug: non-recurring tasks in time_window mode currently can't be created via the UI, and existing ones show no mode indicator.

### `derivePlacementMode()` Antipattern
`task.controller.js:103-112` inspects `when.includes('fixed')` to determine placement_mode. This is the root cause: user-defined tag names could include 'fixed' accidentally, causing misclassification. The entire function must be removed.

</code_context>

<specifics>
## Specific Ideas

- For the migration's REGEXP_REPLACE fallback: if MySQL < 8.0.4, use a JS loop in the migration that fetches all rows where `when LIKE '%allday%' OR when LIKE '%fixed%'`, strips the tokens in JS, then writes them back. Knex supports this via a transaction loop.
- The marker toggle in the UI (separate from the mode selector) should be reviewed: it likely sets `marker=1` which now maps to `placement_mode='reminder'`. Confirm the submit path sends `placementMode: 'reminder'` when the marker toggle is on.

</specifics>

<deferred>
## Deferred Ideas

- **Remove `preferred_time` boolean column:** Now derivable from `placement_mode`; leave for a follow-up cleanup migration.
- **Non-recurring time_window UI controls (time input + flex selector):** The fix for line 527 enables writing the value; the actual time-input UI for non-recurring tasks may also need to be shown. This may require additional WhenSection work beyond the mode buttons — assess during implementation.

</deferred>

---

*Phase: 09-placement-mode-enum-redesign*
*Context gathered: 2026-05-18*
