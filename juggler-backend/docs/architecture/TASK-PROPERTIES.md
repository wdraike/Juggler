---
type: design
service: juggler
status: active
last_updated: 2026-06-26
tags:
  - type/design
  - service/juggler
  - status/active
  - task-management
  - scheduler
  - recurrence
---

# Task Properties — Scheduler Reference

**Last Updated:** 2026-06-26

How every property on a task object affects scheduling.

## Scheduling Modes

A task's scheduling constraint is set directly via the `placement_mode` column. The scheduler branches on this value first, before any phase-based placement logic.

| Mode | Value | Scheduler treatment |
|------|-------|---------------------|
| **Reminder** | `'reminder'` | Calendar marker. `dur=0`. Coexists with other tasks at same minute. No time-grid occupancy. |
| **All Day** | `'all_day'` | Spans full day. Excluded from time-grid placement entirely (early return in buildItems). |
| **Fixed** | `'fixed'` | Immovable at exact time (from `time` field). Blocks the slot. Sole immovability signal — `date_pinned` and `rigid` columns have been removed. Requires both `date` and `time`; server returns 400 if either is absent. User-selectable from the mode picker (5th option alongside Anytime / Time Window / Time Blocks / All Day). |
| **Time Window** | `'time_window'` | Placed within ±timeFlex minutes of `preferredTimeMins`. Falls back to when-tags if window is degenerate. |
| **Time Blocks** | `'time_blocks'` | Constrained to user-named `when` tag windows only (e.g. `morning`, `lunch`, `evening`). Uses `flexWhen` for retry. |
| **Anytime** | `'anytime'` | No constraint. Placed wherever fits by priority/slack order. |

> **Recurrence is orthogonal to placement mode** for every mode *except* `fixed`. Any mode other than `fixed` may be recurring (`reminder`, `all_day`, `time_window`, `time_blocks`, `anytime`). Setting `placement_mode = 'fixed'` while `recurring` is truthy is an **illegal combination** rejected by the backend — see [Fixed–Recurring Exclusion (XOR invariant)](#fixedrecurring-exclusion-xor-invariant) below. Use the `recurring` flag to check if a task is recurring; do not infer recurrence from `placement_mode`.

### Fixed–Recurring Exclusion (XOR invariant)

A task is **either** fixed **or** recurring — never both (leg 999.867, commit `60a9e81`).

- **Fixed** means `placement_mode === 'fixed'`.
- **Recurring** means the `recurring` flag is truthy (equivalently, `task_type` is `recurring_template` or `recurring_instance`).
- The **illegal state** is precisely `placement_mode === 'fixed'` AND `recurring` truthy.

**Enforcing code:** `isFixedRecurringConflict(opts)` in `src/slices/task/domain/validation/taskValidation.js:98`

```js
function isFixedRecurringConflict(opts) {
  return opts.placementMode === 'fixed' && !!opts.recurring;
}
```

This helper is the **sole source** of the XOR decision. Every enforcement path delegates to it — no inlined literal.

**Violation outcome:** the write is **rejected** with the machine-readable error code `invalid_combination` (HTTP 400 / MCP validation error). Nothing is persisted; there is no silent coercion.

**Enforcement chokepoints** (all call the helper):

| Path | Location | Result on violation |
|------|----------|---------------------|
| Create / general validation | `validateTaskInput` → `taskValidation.js:329` | returns `['invalid_combination']` |
| HTTP `PUT /api/tasks/:id` | `UpdateTask.execute` → `src/slices/task/application/commands/UpdateTask.js:151–152` | `{ status: 400, body: { error: 'invalid_combination' } }` |
| MCP `update_task` | `src/mcp/tools/tasks.js:283–284` | `Validation error: invalid_combination` (isError) |
| Bulk `ImportData` | `src/slices/user-config/application/commands/ImportData.js:122–123` | `{ status: 400, body: { error: 'invalid_combination' } }` (validated before the destructive transaction) |

**Flip handling:** the HTTP-update and MCP-update paths evaluate the rule against the **effective merged** `{placementMode, recurring}` — incoming body merged over the existing row, by key presence — so a flip is caught in either direction: setting `placement_mode = 'fixed'` on an already-recurring task, OR setting `recurring = true` on an already-fixed task.

> See also: [`recurring`](#recurrence) in the Recurrence property table; `placement_mode` in [When & Where](#when--where-placement-constraints).

## Status Effects

| Status | Enters Pool? | Scheduled? | Other Effects |
|--------|-------------|-----------|---------------|
| `""` (empty) | Yes | Yes | Normal scheduling |
| `wip` | Yes | Yes | Uses `timeRemaining` instead of `dur` |
| `done` | No | No | Frozen. Dependencies on this task are considered met. |
| `cancel` | No | No | Frozen. Dependencies considered met. |
| `skip` | No | No | Frozen. Auto-set for past recurring outside flex window. |
| `pause` | No | No | Frozen. Template-level only (recurring master paused). |
| `disabled` | No | No | Frozen. Set by system (e.g., plan limits). |

## Properties by Category

### Identity (not used in placement logic)

| Property | DB | JS | Type | Set By |
|----------|-----|-----|------|--------|
| ID | `id` | `id` | string | System |
| Text | `text` | `text` | string | User |
| Project | `project` | `project` | string | User |
| Section | `section` | `section` | string | User |
| Notes | `notes` | `notes` | text | User |
| Task Type | `task_type` | `taskType` | `task`, `recurring_template`, `recurring_instance` | System |

### Duration & Effective Time

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Duration | `dur` | `dur` | int (minutes), valid range **5–480** | User | How much time the task occupies. Unit is minutes. Valid range enforced by the REST API: min 5, max 480 (authority: `src/schemas/task.schema.js` `taskUpdateSchema`, PUT /api/tasks/:id). The task-sidebar "Duration (min)" field is free-typeable; values outside 5–480 are clamped to the nearest bound on blur with an amber notice. **Cross-layer note (David follow-up):** the hexagonal task facade (`src/slices/task/facade.js`) enforces min=1 max=1440, the MCP tool definition is unbounded, and an older doc cited 720m — all four caps disagree and should be reconciled into a single authoritative limit. |
| Time Remaining | `time_remaining` | `timeRemaining` | int or null | User | If set (WIP tasks), overrides `dur`. `effectiveDur = timeRemaining ?? dur`. |
| Split | `split` | `split` | bool | User | If true + `splitMin > 0`, task can be broken into chunks across slots. |
| Split Min | `split_min` | `splitMin` | int (minutes) | User | Minimum chunk size for in-scheduler splitting. |
| Split Ordinal | `split_ordinal` | `splitOrdinal` | int | System | Which chunk this is (1..N). Pre-chunked rows won't be re-split. |
| Split Total | `split_total` | `splitTotal` | int | System | Total chunks in this occurrence. |
| Split Group | `split_group` | `splitGroup` | string or null | System | Links chunks of the same occurrence for merge-back. |

### When & Where (placement constraints)

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Placement Mode | `placement_mode` | `placementMode` | enum (see Scheduling Modes table) | User/System | Primary scheduling constraint and sole immovability signal. Written by the UI directly. `fixed` is now user-selectable from the mode picker — not just calendar-sync assigned. Requires `date` + `time` when set to `fixed`; server returns 400 if either is absent. Never derived server-side outside of `derivePlacementMode`. |
| When | `when` | `when` | string | User | Comma-separated user-defined time block tags (e.g. `morning`, `lunch`, `evening`). Empty = all windows. Must NOT contain `'allday'` or `'fixed'` — these are now expressed via `placement_mode`. |
| Day Req | `day_req` | `dayReq` | string | User | `any`, `weekday`, `weekend`, or comma-separated days (`M,W,F`). Checked via `canPlaceOnDate()`. |
| ~~Rigid~~ | ~~`rigid`~~ | ~~`rigid`~~ | ~~bool~~ | ~~removed~~ | Removed in When-mode simplification. The scheduler reads fixed-placement intent solely from `placement_mode === 'fixed'`. Migration file `20260526000000_drop_pinned_and_rigid_columns.js` drops this column (pending execution). Do not use `rigid`. |
| Flex When | `flex_when` | `flexWhen` | bool | User | If true and unplaced after Phase 3, retries with "anytime" windows. |
| Time Flex | `time_flex` | `timeFlex` | int (minutes) | User | ± window around `preferredTimeMins` for recurring. Default 60m. Also controls past-recurring flex window for auto-skip. |
| Preferred Time | `preferred_time_mins` | `preferredTimeMins` | int (mins from midnight) | User | Anchor time for time-window and time-blocks recurring modes. 420 = 7:00 AM. |
| Location | `location` | `location` | JSON array | User | Task can only place in slots where location supports its requirements. |
| Tools | `tools` | `tools` | JSON array | User | Location must have all required tools available. |
| Travel Before | `travel_before` | `travelBefore` | int (minutes) | User | Reserved buffer before task start. Only first chunk of a split. |
| Travel After | `travel_after` | `travelAfter` | int (minutes) | User | Reserved buffer after task end. Only last chunk of a split. |

### Deadlines & Floors

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Deadline | `deadline` | `deadline` | date | User | Hard upper bound. Tasks with deadline enter constrained pool (Phase 2). Slack computed against this. Past-due = placed ASAP with P1 boost. |
| Start After | `start_after_at` | `startAfter` | date | User | Hard lower bound. Task won't place before this date. |
| Depends On | `depends_on` | `dependsOn` | JSON array of IDs | User | Task waits until all deps are placed. Done/cancelled deps are considered met. Circular deps auto-broken. |

### Pinning & Anchoring

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| ~~Date Pinned~~ | ~~`date_pinned`~~ | ~~`datePinned`~~ | ~~bool~~ | ~~removed~~ | Removed in When-mode simplification. Immovability is now expressed exclusively via `placement_mode = 'fixed'`. Migration file `20260526000000_drop_pinned_and_rigid_columns.js` drops this column (pending execution). |
| Date (cached) | `date` | `date` | string (M/D) | Scheduler | Derived from `scheduled_at`. Non-anchored tasks get date reset to today each run. |
| Day (cached) | `day` | `day` | string | Scheduler | Derived from `scheduled_at`. |
| Time (cached) | `time` | `time` | string (h:mm AM) | Scheduler | Derived from `scheduled_at`. |
| Scheduled At | `scheduled_at` | `scheduledAt` | datetime UTC | Scheduler | THE source of truth for placement. Written by scheduler, read by frontend. |
| Unscheduled | `unscheduled` | `unscheduled` | bool | Scheduler | Set when task can't be placed. Preserves last `scheduled_at` for "was supposed to be at" display. |

### Recurrence

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Recurring | `recurring` | `recurring` | bool | User | Routes to Phase 0/1 instead of Phase 2/3. Instances get floor+ceiling on occurrence day. |
| Recur Config | `recur` | `recur` | JSON | User | `{type, days, every, unit, timesPerCycle, monthDays, intervalDays}`. Drives `expandRecurring` instance generation and flex window computation. `type` is required when `recur` is present. For `rolling` and `interval` types, `every` (positive integer) and `unit` (`days`/`weeks`/`months`) control the repeat interval. `intervalDays` is a legacy alias for rolling tasks; `every`+`unit` is preferred. |
| Recur Start | `recur_start` | `recurStart` | date | User | Earliest date for instance generation. |
| Recur End | `recur_end` | `recurEnd` | date | User | Latest date for instance generation. |
| Source ID | `source_id` | `sourceId` | string | System | For instances: points to master. Used for field inheritance and chunk grouping. |
| Generated | `generated` | `generated` | bool | System | Instance was scheduler-generated. Treated as user-anchored (date preserved). |
| Occurrence Ordinal | `occurrence_ordinal` | `occurrenceOrdinal` | int | System | Which occurrence of the recurring task (1..N). |
| Marker | `marker` | `marker` | bool | User | Non-blocking reminder. Shown on calendar, doesn't consume time. Expressed as `placement_mode = 'reminder'` in the DB. The `marker` computed column in `tasks_v` is `CASE WHEN placement_mode = 'reminder' THEN 1 ELSE 0 END`. Set via the ◇ Reminder toggle in `TaskDetailHeader.jsx` (button, `onMarkerChange`) / `TaskEditForm.jsx` (`handleMarkerChange` maps to `placementMode`). |

#### Recurrence Types (`recur.type`)

| Type | Description | Required `recur` fields |
|------|-------------|-------------------------|
| `daily` | One instance per day | — |
| `weekly` | One or more specific days of the week | `days` (array of day names) |
| `biweekly` | Every other week on specific days | `days`, `recurStart` |
| `monthly` | Specific day(s) of the month | `monthDays` (array of ints) |
| `interval` | Fixed cadence every N days/weeks/months from `recurStart` | `every` (positive int), `unit` (`days`/`weeks`/`months`), `recurStart` |
| `rolling` | Re-anchors to last completion; next occurrence is N days/weeks/months after the task is marked done | `every` (positive int), `unit` (`days`/`weeks`/`months`). Legacy: `intervalDays` (int days) accepted as fallback when `every`/`unit` absent. |
| `none` | Non-recurring placeholder (recur object present but inactive) | — |

**Validation rules enforced by `validateTaskInput`:**
- `recur.type` is required when a `recur` object is supplied; null or empty string is rejected with `'Recurrence type is required when recur object is provided'`.
- For `rolling` and `interval`: if `every` is present it must be a positive integer; non-integer and values < 1 are rejected.
- For `rolling` and `interval`: if `unit` is present it must be `'days'`, `'weeks'`, or `'months'`; any other value is rejected.
- `intervalDays` on `rolling` tasks is still accepted by `expandRecurring` as a backward-compatible fallback when `every`/`unit` are absent, but new callers should use `every`+`unit`.

### Priority

| Property | DB | JS | Type | Set By | Scheduler Effect |
|----------|-----|-----|------|--------|-----------------|
| Priority | `pri` | `pri` | string | User | `P1` (highest) through `P4` (lowest). Default `P3`. Tiebreaker in all phases — never the primary sort. Past-due tasks get boosted to P1. |

### Weather Conditions (hard constraints — see WEATHER-INTEGRATION.md)

Weather conditions are optional. All default to `any`/null, meaning no constraint. A task with any non-`any` condition will only be placed in a time slot whose hourly forecast satisfies all conditions. If no qualifying slot exists → task goes unscheduled with `reason: 'weather'`.

| Property | DB | JS | Type | Default | Scheduler Effect |
|----------|-----|-----|------|---------|-----------------|
| Precip Tolerance | `weather_precip` | `weatherPrecip` | enum | `any` | `dry_only` (≤20%), `light_ok` (≤50%), `wet_ok` (any), `any` (skip check). Checked against hourly `precipitation_probability`. |
| Sky Cover | `weather_cloud` | `weatherCloud` | enum | `any` | `clear` (≤25%), `partly_ok` (≤60%), `overcast_ok` (any), `any` (skip check). Checked against hourly `cloudcover`. |
| Temp Min | `weather_temp_min` | `weatherTempMin` | int or null | null | Slot temperature must be ≥ this value. Null = no lower bound. |
| Temp Max | `weather_temp_max` | `weatherTempMax` | int or null | null | Slot temperature must be ≤ this value. Null = no upper bound. |
| Temp Unit | `weather_temp_unit` | `weatherTempUnit` | `'C'` / `'F'` / null | null | Unit for temp_min/max. Null = inherit from user setting at display time. |

**Fail-open rule:** If the scheduler has no weather data for a candidate slot (location has no coordinates, or cache miss), the weather constraint is skipped and placement proceeds normally. Weather never blocks a task when data is unavailable.

**Template inheritance:** Weather conditions live on `task_masters`. Recurring instances inherit them via the standard template-merge in `rowToTask`. Individual instances cannot override.

### Scheduler-Set Flags (transient, per-run)

| Property | Type | When Set |
|----------|------|----------|
| `_pastDue` | bool | Task whose deadline has passed |
| `_originalDue` | string | Original deadline date before past-due remap |
| `_unplacedReason` | string | Why task couldn't be placed: `missed`, `capacity_conflict`, `past_due_no_capacity`, `impossible_window`, `partial_split`, `spacing`, `weather` |
| `_unplacedDetail` | string | Human-readable explanation |
| `_suggestions` | array | Suggested fixes for the user |
| `_conflict` | bool | Rigid recurring force-placed over another task |
| `_whenRelaxed` | bool | Placed via flexWhen fallback (Phase 4) |
| `_placementReason` | string | Why task landed where it did |
| `_fauxDeadline` | string | Inherited deadline from dependency chain |
| `_candidateDate` | string | Target date from expandRecurring (for ordinal IDs) |
