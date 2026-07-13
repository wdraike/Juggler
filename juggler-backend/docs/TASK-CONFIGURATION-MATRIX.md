---
type: design
service: juggler
status: active
last_updated: 2026-07-02
tags:
  - type/design
  - service/juggler
  - status/active
  - scheduler
  - task-management
  - ui
---

# Task Configuration Matrix

**Last Updated:** 2026-07-02

> **Correction (leg juggy4, 2026-07-02 — sched-audit L1, REG-02).** The `time_window` row below
> previously claimed a missed flex window resulted in "unplaced + dual-placed with `_overdue`". That
> dual-write is superseded — see `SCHEDULER-RULES.md` §3.1 Phase 4/5 and
> `SCHEDULER-OVERDUE-LADDER.md` § Supersession note for the current unscheduled-overdue contract.

Catalog of every valid task configuration combination and its scheduler behavior.
Derived from `placementModes.js`, `unifiedScheduleV2.js`, `WhenSection.jsx`,
`mcp/tools/tasks.js`, and `task.controller.js`.

---

## Fields

| Field | Type | DB Column | Scheduler Effect | UI Control |
|-------|------|-----------|------------------|------------|
| `placementMode` | enum string | `placement_mode` | Primary routing switch in `buildItems()`. Values: `reminder`, `all_day`, `fixed`, `time_window`, `time_blocks`, `anytime`. | Mode selector buttons (Anytime / Time Window / Time Blocks / All Day) |
| `datePinned` | boolean | `date_pinned` | `isPinned=true` → clamps `earliestIdx=latestIdx=anchorDate` in `findEarliestSlot`. | Pin / Pinned toggle next to date input |
| `rigid` | boolean | `rigid` (derived) | On non-recurring tasks, `rigid=true` drives `placementMode=fixed`. On recurring Time Window, "exact" window sets `rigid=true`. | Float / Fixed toggle (non-recurring); ± Window select (recurring) |
| `recurring` | boolean | `recurring` | Routes through recurring-specific paths: day-locking, TPC roaming, missed-window detection. | Recurrence type dropdown + pattern config |
| `when` | string | `when` | Comma-separated time-block tags (e.g. `morning,lunch`). Ignored in `fixed` and `time_window` modes. | Time-block tag buttons |
| `time` | string | derived from `scheduled_at` | `anchorMin` for fixed/time_window tasks. Ignored for `anytime` unless `preferredTimeMins` is set. | Time input (hh:mm AM/PM) |
| `marker` | boolean | `marker` | `placement_mode = 'reminder'` in DB. `dur=0`, no occupancy, display-only. | Checkbox (non-blocking reminder) |
| `preferredTimeMins` | int | `preferred_time_mins` | Anchor for `time_window` and recurring `fixed` tasks. Minutes from midnight. | Time input converted to mins |
| `timeFlex` | int | `time_flex` | ± window around `preferredTimeMins` for `time_window`. Default 60. | ± Window select (15m … 2hr) |
| `flexWhen` | boolean | `flex_when` | When true, scheduler retries with `anytime` windows if named blocks are full. | Strict / Flex toggle on time blocks |
| `split` | boolean | `split` | Enables inline split placement in scheduler (chunks >= `splitMin`). | Allow split checkbox |
| `splitMin` | int | `split_min` | Minimum chunk size for split tasks. Default 15. | Min chunk input |
| `dayReq` | string | `day_req` | `allowedDows` filter in scheduler. `any`, `weekday`, `weekend`, or day codes. | Day requirement buttons |
| `deadline` | date | `deadline` | Hard upper bound. Finite slack computation. | Deadline date input |
| `startAfter` | date | `start_after_at` | Hard lower bound. Task won't place before this date. | Start-after date input |
| `travelBefore` | int | `travel_before` | Buffer before task. Only first split chunk carries it. | Travel before input |
| `travelAfter` | int | `travel_after` | Buffer after task. Only last split chunk carries it. | Travel after input |

---

## Placement Modes

| Mode | Requires date? | Requires time? | `datePinned` behavior | `rigid` behavior | Scheduler path |
|------|---------------|----------------|----------------------|------------------|----------------|
| `reminder` | Optional | Optional | If date+time provided, immovable at anchor (Phase 0). If no time, falls through to slack queue with `dur=0`. | N/A (no occupancy) | `tryPlaceAtTime` if anchored; else `findEarliestSlot` with `dur=0` |
| `all_day` | Yes | No | Day-locked if `datePinned=true`; otherwise floats across eligible days. | N/A | **Filtered out** of time-grid placement entirely (`buildItems` early return). Rendered as full-day banner in calendar UI only. |
| `fixed` | Yes | Yes | Immovable at exact `anchorDate` + `anchorMin` (Phase 0). `findEarliestSlot` clamped to single day. | N/A — `fixed` IS the rigid state | `tryPlaceAtTime` (Phase 0). Non-recurring fixed = `isFixedWhen=true` (cannot be displaced). Recurring fixed = `isRigid=true` (can be displaced on conflict, then force-placed). |
| `time_window` | Yes | Yes (as `preferredTimeMins`) | Day-locked to `anchorDate`; `datePinned` clamps `earliestIdx=latestIdx`. | `rigid=true` when `timeFlex=0` (exact) → behaves like `fixed` | `isWindowMode=true`. Searches `[windowLo, windowHi]`. If window entirely past today → `isMissedWindow=true` → routed to `unplaced` only (juggy4, 2026-07-02; never dual-placed on the grid). Persistence then applies the two-way split: prior `scheduled_at` set → `overdue=1` pinned on the grid; `scheduled_at` still NULL → `unscheduled=1` (unscheduled-overdue lane). See `unifiedScheduleV2.js:2347-2379`, `runSchedule.js:1907-1987`. |
| `time_blocks` | Optional | No | If `datePinned=true`, clamps to `anchorDate`. If no date, floats across horizon. | N/A | `whenParts` drive `eligibleWindows()` via `getWhenWindows()`. `flexWhen=true` enables retry with `relaxWhen=true`. |
| `anytime` | Optional | No | If `datePinned=true`, clamps to `anchorDate`. If no date, floats across horizon (infinite slack). | N/A | No window constraints. (Former `preferLatestSlot` day-end lane for recurring past-anchorMin REMOVED — 999.1559, ruling 2026-07-12: places earliest; exhausted window → unscheduled.) |

---

## Valid Combinations

| `placementMode` | `datePinned` | `rigid` | `recurring` | `marker` | Scheduler treatment | UI state |
|-----------------|-------------|---------|-------------|----------|---------------------|----------|
| `anytime` | false | false | false | false | No constraints. Infinite slack. Floats across days. | Mode selector active. No time input shown. |
| `anytime` | true | false | false | false | Day-locked to anchorDate. Floats within day's eligible slots. | Mode selector **disabled** (`isFixed` path). Pin toggle active. |
| `time_blocks` | false | false | false | false | Constrained to selected `when` tags. Falls back to `anytime` if `flexWhen=true`. | Mode selector active. Block-tag buttons visible. |
| `time_blocks` | true | false | false | false | Day-locked + block-constrained. | Mode selector **disabled** (`isFixed` path). |
| `time_window` | false | false | false | false | Placed within `preferredTimeMins ± timeFlex`. If window past → missed. | Mode selector active. Time + ± Window inputs shown. |
| `time_window` | true | false | false | false | Day-locked + window-constrained. | Mode selector **disabled** (`isFixed` path). |
| `time_window` | true | true | false | false | Exact time, day-locked. Equivalent to `fixed`. | Mode selector **disabled**. `rigid=true` from "exact" window. |
| `fixed` | true | N/A | false | false | Immovable at exact time. `isFixedWhen=true`. Blocks slot. | Mode selector **disabled** (`isFixed=true`). Float/Fixed toggle shows "Fixed". |
| `all_day` | false | N/A | false | false | Not placed in grid; calendar banner only. | Mode selector active. Start/End/Duration hidden. |
| `all_day` | true | N/A | false | false | Day-locked all-day banner. | Mode selector **disabled** (`isFixed` path). |
| `reminder` | false | N/A | false | false | `dur=0`. If no anchor, placed at earliest slot (no occupancy). | Marker checkbox checked. Scheduling mode section **hidden** (`marker` gate). |
| `reminder` | true | N/A | false | false | `dur=0`. Immovable at anchor if time provided; day-locked if date only. | Marker checked. Mode selector hidden. Pin active. |
| `anytime` | false | false | true | false | Recurring instance, no time preference. Day-locked. If past today → latest slot. | Recurring section active. Three mode buttons (Anytime selected). |
| `anytime` | true | false | true | false | Same as above, but `datePinned` prevents day-roaming (redundant with day-lock). | Recurring section active. No mode-selector disable for recurring. |
| `time_blocks` | false | false | true | false | Recurring + block tags. Day-locked. If past today → latest slot. | Recurring section active. Block-tag buttons visible. |
| `time_blocks` | true | false | true | false | Same + redundant day-lock. | Recurring section active. |
| `all_day` | false | N/A | true | false | Recurring all-day banner. Not placed in time grid. Day-locked. | Recurring section active. All Day button available. |
| `all_day` | true | N/A | true | false | Same + day-lock. | Recurring section active. |
| `time_window` | false | false | true | false | Recurring + flex window. `isWindowMode=true`. Day-locked. | Recurring section active. Time + ± Window shown. |
| `time_window` | true | false | true | false | Same + day-lock. | Recurring section active. |
| `time_window` | true | true | true | false | Recurring + exact time. `rigid=true`, `timeFlex=0`. Behaves like `fixed` recurring. | Recurring section active. "exact" selected in ± Window. |
| `fixed` | true | N/A | true | false | Recurring rigid. `isRigid=true`. Can displace on conflict. If past → force-placed with `_conflict`. | Recurring section active. Mode selector NOT disabled for recurring. |
| `reminder` | false | N/A | true | false | Recurring marker. `dur=0`. Day-locked. No occupancy. | Marker checked. Recurring section hidden (`!marker` gate). |
| `reminder` | true | N/A | true | false | Same + day-lock. | Marker checked. Recurring section hidden. |

---

## Invalid / Locked Combinations

| Combination | Why locked | How to avoid |
|-------------|-----------|--------------|
| `fixed` + `datePinned=false` (non-recurring) | `fixed` requires an anchor time. Without `datePinned`, the scheduler has no date anchor and the UI treats `placementMode=fixed` as `isFixed=true` anyway. | Always set `datePinned=true` when setting `fixed` mode. Backend auto-sets it on create when time is provided. |
| `all_day` + `time` provided | `all_day` tasks have no time-grid presence. Providing a time creates contradictory data. | Backend: selecting All Day in UI clears `time` and `endTime`. API: reject or ignore `time` when `allDay=true`. |
| `time_window` + `preferredTimeMins` outside schedulable day | Window becomes inverted (`windowLo > windowHi`). Scheduler falls back to `when`-tag logic, silently ignoring the preferred time. | Validate `preferredTimeMins` against `GRID_START`/`GRID_END` (default 06:00–23:59) before save. |
| `marker=true` + any scheduling mode | The `marker` checkbox hides the entire scheduling mode section in `WhenSection.jsx`. Users cannot see or change mode while marker is on. | Uncheck marker to access mode controls. |
| Calendar-synced task edits (non-status/non-notes) | `checkCalSyncEditGuard` returns 403 for any field other than `status`, `notes`, `datePinned`, `_dragPin`, `_allowUnfix`. | Edit the event in the source calendar, or call `takeOwnership` to detach from sync. |
| `fixed` recurring + `datePinned=false` | Recurring `fixed` tasks are day-locked via `isDayLocked` regardless of `datePinned`. Omitting `datePinned` does not enable roaming — the recurrence rule already locks the day. | Set `datePinned=true` for clarity; scheduler behavior is identical. |
| `recurring=true` + `dependsOn` provided | Dependencies are stripped at write time for all recurring tasks (template + instance). | Do not set dependencies on recurring tasks. Use one-off chain tasks instead. |
| `split=true` + `marker=true` | Split controls are hidden when `marker` is true (`!marker && !isRecurring` gate). | Split and marker are mutually exclusive in UI. |
| `split=true` + `recurring=true` | Split controls are hidden for recurring tasks in the UI (`!marker && !isRecurring` gate). However, the scheduler **does** support `split` on recurring instances via `placeSplitInline`. | UI does not expose it; use API/MCP if needed. |

---

## Silent Lockout Scenarios

A "silent lockout" occurs when the user sees greyed scheduling controls with no inline explanation of why.

| Scenario | UI symptom | Root cause | User-visible explanation? |
|----------|-----------|------------|---------------------------|
| Calendar-synced task | Mode selector greyed (`isFixed=true`). Pin shows "Pinned". | `placementMode=fixed` + `datePinned=true` set by calendar sync ingest. | Banner: "Calendar-managed — scheduling is set by the source calendar." |
| Drag-pinned task | Mode selector greyed (`isFixed=true`). | `_dragPin` sets `datePinned=true` on drop. | Banner: "Date is pinned — unpin to change scheduling mode." |
| MCP/API-created task with `date`+`time` | Mode selector greyed if loaded in UI. | Backend auto-sets `datePinned=1` and `placementMode=fixed` on create when time provided. | Banner: "Date is pinned — unpin to change scheduling mode." |
| `all_day` selected from UI | Start/End/Duration inputs disappear. | `effectiveMode === 'all_day'` branch removes time inputs. | Clear — UI visibly changes. Not a silent lockout. |
| Recurring `time_window` with `exact` | User cannot click "Float" to loosen; must change ± Window. | Recurring Time Window uses `rigid` from the ± select, not the Float/Fixed toggle. The Float/Fixed toggle is **outside** the recurring section and has no effect on recurring tasks. | **Silent lockout risk**: user may click Float/Fixed toggle and see no effect on a recurring task. |

### Recommended UX fixes for silent lockouts

1. **Calendar-synced tasks**: Add a small banner or tooltip: "Synced from [Provider] — edit in source calendar or Take Ownership."
2. **Auto-pinned tasks**: Show `(auto-pinned)` next to the Pin badge when `datePinned` was set by backend inference, not explicit user action.
3. **Recurring Time Window exact mode**: Disable or hide the Float/Fixed toggle when `isRecurring=true` to prevent confusion.

---

## MCP Auto-Inference Rules

`mcp/tools/tasks.js` applies the following inference **only when the caller omits the field**.

| Input fields present | Inferred `placementMode` | Inferred `datePinned` | Overrideable? |
|----------------------|--------------------------|-----------------------|---------------|
| `time` or `scheduledAt` set | `fixed` | `true` | Yes — explicitly send `placementMode` or `datePinned` to override |
| `date` only (no `time`, no `scheduledAt`) | `all_day` | `true` | Yes — explicitly send `placementMode` or `datePinned` to override |
| Neither `date` nor `time` nor `scheduledAt` | `anytime` | `false` (omitted) | Yes — explicitly send either field |
| `date` + `time` + `placementMode: 'time_window'` | `time_window` (preserved) | `true` | `datePinned` overrideable; `placementMode` respected |
| `date` + `time` + `placementMode: 'time_blocks'` | `time_blocks` (preserved) | `true` | `datePinned` overrideable; `placementMode` respected |
| `recurring=true` + `preferredTimeMins` + `timeFlex=0` | `fixed` (from rigid inference in UI, not MCP) | `true` | Yes — send explicit values |

### Backend create-path inference (`task.controller.js` `createTask`)

| Input | Auto-set DB column | Condition |
|-------|-------------------|-----------|
| `date` or `scheduledAt` present | `date_pinned = 1` | `datePinned` omitted in body |
| `time` or `scheduledAt` present | `placement_mode = 'fixed'` | `placementMode` omitted in body |
| `allDay = true` and no time | `placement_mode = 'all_day'` | `placementMode` omitted in body |

### Backend update-path inference (`task.controller.js` `updateTask`)

| Input | Auto-set DB column | Condition |
|-------|-------------------|-----------|
| `date` or `scheduledAt` present | `date_pinned = 1` | `datePinned` omitted in body |
| `allDay = true` and no time | `placement_mode = 'all_day'` | `placementMode` omitted in body |
| **Note:** Update path does **NOT** infer `fixed` from `time` alone (to avoid clobbering mode on time-only edits). |

### MCP update-path inference (`mcp/tools/tasks.js` `update_task`)

| Input | Auto-set DB column | Condition |
|-------|-------------------|-----------|
| `date` or `time` or `scheduledAt` present | `date_pinned = 1` | `datePinned` omitted in fields |
| No `time`/`scheduledAt`, but `date` present | `placement_mode = 'all_day'` | `placementMode` omitted in fields |
| **Note:** MCP update path does **NOT** infer `fixed` from `time` alone (same reasoning as API update). |

---

## Cross-reference

- **Field glossary & scheduler effects:** `docs/architecture/TASK-PROPERTIES.md`
- **UI control → DB → scheduler pipeline:** `docs/architecture/SCHEDULER-UI-STATE-MAP.md`
- **State transitions (status matrix):** `docs/architecture/TASK-STATE-MATRIX.md`
- **Scheduler implementation:** `src/scheduler/unifiedScheduleV2.js`
- **Placement mode enum:** `src/lib/placementModes.js`
