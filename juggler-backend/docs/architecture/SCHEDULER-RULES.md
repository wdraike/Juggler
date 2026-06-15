---
type: reference
service: juggler
status: active
last_updated: 2026-06-15
tags:
  - type/reference
  - service/juggler
  - status/active
  - scheduler
  - rules
  - requirements
---

# Scheduler Rules — Canonical Reference

**Last Updated:** 2026-06-15

> Complete, closed-loop rules for the Juggler scheduler. This document is the
> authority for scheduler behavior. Design docs (SCHEDULER.md, TASK-PROPERTIES.md,
> TASK-CONFIGURATION-MATRIX.md, TASK-STATE-MATRIX.md, WEATHER-INTEGRATION.md,
> RECURRING-SPACING-DESIGN.md, SCHEDULER-OVERDUE-LADDER.md, WHEN-MODE-REDESIGN.md)
> provide context and rationale; where they conflict with this document, **this
> document wins**.

---

## Table of Contents

1. [Placement Modes — Mutual Exclusivity & Behavior](#1-placement-modes)
2. [Mode Transition Rules](#2-mode-transition-rules)
3. [Scheduler Phases](#3-scheduler-phases)
4. [Recurring Task Rules](#4-recurring-task-rules)
5. [Recurring Instance Lifecycle](#5-recurring-instance-lifecycle)
6. [Split Task Rules](#6-split-task-rules)
7. [Deadline Rules](#7-deadline-rules)
8. [Earliest-Start Rules (`start_after_at`)](#8-earliest-start-rules)
9. [Weather Rules](#9-weather-rules)
10. [Time Block, Window & Tool Rules](#10-time-block-window--tool-rules)
11. [FlexWhen Rules](#11-flexwhen-rules)
12. [Reschedule Triggers](#12-reschedule-triggers)
13. [Contradictions & Open Issues](#13-contradictions--open-issues)

---

## 1. Placement Modes

### 1.1 Enum — Mutually Exclusive

A task has exactly **one** `placement_mode`. The value is a DB ENUM column
(`migration 20260518000100`). No task may hold two modes simultaneously.

| Mode | DB Value | Requires date? | Requires time? | Occupies grid? | Scheduler can move? |
|------|----------|-----------------|----------------|----------------|---------------------|
| **Anytime** | `anytime` | No | No | Yes | Yes — best slot by priority + date |
| **Time Window** | `time_window` | Yes | Yes (`preferred_time_mins`) | Yes | Within `[preferred - flex, preferred + flex]` only |
| **Time Blocks** | `time_blocks` | No | No | Yes | Within selected `when`-tag blocks only |
| **Fixed** | `fixed` | Yes | Yes | Yes | **Never** — immovable anchor |
| **All Day** | `all_day` | Yes | No | No (banner only) | Day can float if not pinned |
| **Reminder** | `reminder` | No | No | No (`dur=0`) | Yes — earliest eligible slot |

**Source:** `placementModes.js:15-22`, `unifiedScheduleV2.js:244` (default fallback)

### 1.2 Recurrence Is Orthogonal

The `recurring` flag is **independent** of placement_mode. Every mode can be
recurring or non-recurring. The scheduler treats the combination differently:

| Mode + Recurring | Scheduler Behavior | Key Differences from Non-Recurring |
|-------------------|--------------------|------------------------------------|
| `fixed` + recurring | `isRigid=true`; placed at exact time; **can** be force-placed with `_conflict` on overlap | Non-recurring fixed = `isFixedWhen=true` (never displaced). Recurring fixed can be displaced, then force-placed. |
| `anytime` + recurring | Day-locked to occurrence date; if past today → latest slot | Non-recurring anytime floats freely across horizon. |
| `time_window` + recurring | Same flex window logic; day-locked to occurrence date | Same window logic; non-recurring floats across eligible days. |
| `time_blocks` + recurring | Same block-constrained logic; day-locked | Non-recurring can float across days within blocks. |
| `all_day` + recurring | Day-locked banner on occurrence date | Non-recurring banner can float. |
| `reminder` + recurring | `dur=0`, day-locked | Same. |

**Source:** `unifiedScheduleV2.js:230-474` (buildItems), `TASK-STATE-MATRIX.md:68-89`

### 1.3 Invalid Mode Combinations

The following combinations MUST be rejected or prevented:

| Combination | Enforcement | Reason |
|-------------|-------------|--------|
| `fixed` + recurring | **UI blocks** (`WhenSection.jsx` shows "not available") | Recurring instances span multiple days; fixed anchoring contradicts recurrence. |
| `fixed` without date+time | **Backend 400** on create/update | No anchor for immovable placement. |
| `all_day` with time set | **Backend clears time** on save | All-day tasks have no time-grid presence. |
| `time_window` with `preferred_time_mins` outside `GRID_START`–`GRID_END` | **Silent fallback** to `when`-tag logic | Inverted window (`windowLo > windowHi`) produces no valid slots. Needs validation. |
| `reminder` + any scheduling mode section | **UI hides** scheduling controls | Marker checkbox hides entire mode section. |
| `split=true` + `marker=true` | **UI hides** split controls | Split and marker are mutually exclusive. |
| `split=true` + `recurring=true` | **UI hides** split controls for recurring | Scheduler supports it (`placeSplitInline`), but UI does not expose it. API/MCP can set it. |
| `recurring=true` + `dependsOn` | **Backend strips** dependencies at write time | Dependencies on recurring templates make no sense (instances span different days). |

**Source:** `TASK-CONFIGURATION-MATRIX.md:93-106`, `WHEN-MODE-REDESIGN.md:119-122`

### 1.4 Mode-Dependent UI Controls

| Mode | Time Input | ± Flex Window | Block Tags | Strict/Flex Toggle | Duration | Split | Deadline | Start-After |
|------|-----------|---------------|-----------|-------------------|----------|-------|----------|-------------|
| `anytime` | No | No | No | No | Yes | Yes | Yes | Yes |
| `time_window` | Yes | Yes | No | No | Yes | Yes | Yes | Yes |
| `time_blocks` | No | No | Yes | Yes | Yes | Yes | Yes | Yes |
| `fixed` | Yes | No | No | No | Yes | No | No | No |
| `all_day` | No | No | No | No | No | No | Yes | Yes |
| `reminder` | No | No | No | No | No | No | No | No |

**Recurring overrides:** Deadline, start-after, and date-pinned controls are hidden
for recurring tasks (the recurrence rule drives dates). Split is hidden in UI but
supported by scheduler.

**Source:** `TASK-STATE-MATRIX.md:259-300`

---

## 2. Mode Transition Rules

### 2.1 Transition Matrix

A mode change is a normal `PATCH /tasks/:id`. The user selects a different mode
from the picker; the frontend sends the new `placementMode` value.

| From | To | What Happens | Constraints |
|------|----|--------------|-------------|
| Any | `fixed` | Task becomes immovable. Requires date+time. | Backend returns 400 if date or time absent. |
| `fixed` | Any non-fixed | Task re-enters the scheduler queue. | No `prev_when` is stored (removed in WHEN-MODE-REDESIGN). Mode change is one-way from the scheduler's perspective. |
| Any | `time_window` | Requires `preferred_time_mins` + `time_flex`. | If `time_flex=0`, task behaves as `fixed` (`rigid=true`). |
| Any | `all_day` | Time, duration, split, travel cleared. | Backend clears time fields. |
| `time_window` | `time_blocks` | Window constraints replaced by block tags. | `preferred_time_mins` and `time_flex` are ignored (not deleted, but unused). |
| `time_blocks` | `anytime` | Block constraints removed. | `when` field cleared or set to `"anytime"`. |
| Any | `reminder` | `dur=0`, scheduling controls hidden. | Existing duration preserved in DB but not used. |
| Any non-recurring | Any (with `recurring=true`) | UI blocks `fixed` for recurring. | Other modes valid. Dependencies stripped. |

### 2.2 Calendar-Sync Lock

Calendar-synced tasks (`gcal_event_id`, `msft_event_id`, or `apple_event_id`)
are locked to `fixed` mode. The `guardFixedCalendarWhen` middleware prevents
mode changes via normal PATCH. To change mode, the user must first call
`takeOwnership` (R30) to detach the provider link.

**Source:** `WHEN-MODE-REDESIGN.md:96-101`, `TASK-CONFIGURATION-MATRIX.md:101`

### 2.3 Drag-to-Fixed Transition

Drag-and-drop sends `PATCH { placementMode: 'fixed', date, time }`. This is
processed identically to any other mode change. There is no separate `_dragPin`
code path (removed in WHEN-MODE-REDESIGN).

**Source:** `WHEN-MODE-REDESIGN.md:104-115`

---

## 3. Scheduler Phases

The v2 scheduler is a **single-pass** algorithm with logical sections (not v1's
numbered phases). Items are sorted by `(slack asc, pri asc, dur desc, id)`.

### 3.1 Phase Flow

| # | Phase | Items | Behavior | Exempt from Reset? |
|---|-------|-------|----------|---------------------|
| 0 | **Immovables** | `fixed`, rigid-recurring with anchor, markers with anchor | Placed at exact time via `tryPlaceAtTime`. | Yes — never reset |
| 1 | **Queue** (main loop) | All other items, slack-sorted | `tryPlaceQueued` → 4-level fallback ladder | No — reset each run (unless drag-pinned) |
| 2 | **Retry** | Items deferred due to unmet deps | One retry pass after main loop | No |
| 3 | **Missed preferred-time** | Recurring non-TIME_WINDOW with passed flex window | Marked `missed`, unplaced | N/A |
| 4 | **Missed window** | TIME_WINDOW tasks with entirely-past flex window | Dual-placed on grid with `_overdue=true` + unplaced | N/A |
| 5 | **Past-anchored recurring** | Recurring with `anchorDate < today` | Force-placed at original date with `_overdue=true` | N/A |
| 6 | **Rigid forced** | Still-unplaced fixed/rigid items | Force-placed at anchor with `_conflict=true`, `locked=true` | N/A |
| 7 | **Deadline relaxed** | Deadline ≤ today + unmet deps | Placed ignoring deps + deadline as last resort | N/A |

**Source:** `unifiedScheduleV2.js:1172-1778`

### 3.2 Placement Fallback Ladder (tryPlaceQueued)

| Pass | Condition | Effect | Flag Set |
|------|-----------|--------|----------|
| 1 | Always | Normal: respect deadline, `when`, day-locks, dayReq, travel, deps, spacing | — |
| 2 | `slack < 0` | Drop deadline ceiling (`ignoreDeadline`) | `_overdue` |
| 3 | `flexWhen` | Relax `when` to `anytime` | `_whenRelaxed` |
| 4 | `slack < 0 && flexWhen` | Both relaxations | `_overdue` + `_whenRelaxed` |

If all four fail → `unplaced` with `_unplacedReason` + `_unplacedDetail`.

**Source:** `unifiedScheduleV2.js:1037-1079`, `SCHEDULER-OVERDUE-LADDER.md:26-33`

### 3.3 Reset Rules

On each scheduler run:

| Type | Reset? | Why |
|------|--------|-----|
| `fixed` (non-recurring) | **Never** | `isFixedWhen=true` — user-set immovable |
| `fixed` (recurring rigid) | **Never** | `isRigid=true` — always at anchor |
| Drag-pinned (`placement_mode='fixed'` from drag) | **Never** | `when=fixed` → exempt from reset |
| Non-fixed recurring | **Yes** (unless drag-pinned) | Scheduler re-evaluates placement each run |
| Non-fixed regular | **Yes** (unless drag-pinned or fixed) | Scheduler re-evaluates placement each run |

**Source:** `TASK-STATE-MATRIX.md:302-318`

---

## 4. Recurring Task Rules

### 4.1 Recurrence Types

| Type | Required Fields | Cycle Days | TPC Eligible? | Anchor-Dependent? |
|------|----------------|------------|---------------|-------------------|
| `daily` | `recur.type='daily'` | 1 | Yes | No |
| `weekly` | `recur.type='weekly'`, `recur.days` (e.g. `'MTWRF'`) | 7 | Yes | No (unless TPC) |
| `biweekly` | `recur.type='biweekly'`, `recur.days` | 14 | Yes | **Yes** (parity) |
| `monthly` | `recur.type='monthly'`, `recur.monthDays` (e.g. `[1,15]` or `['first','last']`) | 30 | Yes | No (unless TPC) |
| `interval` | `recur.type='interval'`, `recur.every` (int), `recur.unit` ('days'/'weeks'/'months'/'years') | `every * unitDays` | No | **Yes** |
| `rolling` | `recur.type='rolling'`, `recur.intervalDays` OR `recur.every`+`recur.unit` | N/A (arithmetic) | No | **Yes** (mutable anchor) |

**Source:** `expandRecurring.js:295-404`, `ConstraintSolver.js:61-79`

### 4.2 Instance Generation

- **Horizon:** `RECUR_EXPAND_DAYS = 14` days from today (`constants.js:100`)
- **Instance IDs:** `<sourceId>-<ordinal>` (e.g. `uuid-1`, `uuid-2`) (`expandRecurring.js:440-441`)
- **Dedup:** `existingBySourceDate[sourceId|date]` prevents re-creating instances that already exist in DB (`expandRecurring.js:430-474`)
- **Grandfather clause:** Pending instances beyond the 14-day horizon are NOT deleted by the reconciler (`runSchedule.js:833-847`)
- **Paused templates:** Expansion skips templates with `status='pause'` (`expandRecurring.js`, `UpdateTaskStatus.js:122-141`)
- **Disabled templates:** Expansion skips disabled templates
- **`recurEnd`:** Respected — no instances generated past `recurEnd` date (`expandRecurring.js:357-360`)

### 4.3 TimesPerCycle (TPC) Rules

TPC is an **overlay** on daily/weekly/biweekly/monthly types. It is active when
`timesPerCycle < selectedDayCount` (e.g. 3 of 5 weekdays).

| Aspect | Rule |
|--------|------|
| **Pick algorithm** | Target-interval steering: `targetInterval = cycleDays / tpc`. Greedy pick of closest candidate to `lastPlaced + targetInterval`. |
| **Flexible TPC** | `isFlexibleTpc=true` → instance can roam within cycle. NOT day-locked. |
| **Day-req expansion** | TPC instances get `dayReq` expanded to ALL selected day codes (so scheduler can roam). |
| **Spacing guard** | `minGap = max(1, floor(cycleDays * 0.5))`. Candidate days within `minGap` of last placement are rejected. |
| **Spacing history** | Only `done` status counts toward spacing. `skip`/`cancel` do NOT block future placement. |
| **Safety valve** | If spacing guard would block the entire search window, it is ignored (prevents permanently unplaceable occurrences). |

**Fill Policies:**

| Policy | Behavior | When |
|--------|----------|------|
| `keep` (default) | Any `skip` in cycle → `slotsNeeded = 0` (no new picks). Prevents skip-refill oscillation. | Always unless overridden |
| `backfill` | `slotsNeeded = tpc - fulfilledInCycle`. Skip is replaceable. Done/cancel count as fulfilled. | User-selected |

**Source:** `expandRecurring.js:95-293`, `unifiedScheduleV2.js:383-404,881-910`

### 4.4 Rolling Recurrence — Special Rules

| Aspect | Rule |
|--------|------|
| **Anchor source** | `rollingAnchor` on `task_masters` → `recurStart` → `src.date` → `startDate` |
| **Generation** | Arithmetic projection: `anchor + n * intervalDays` (NOT day-by-day iteration) |
| **Backfill** | Rolling templates with null `rollingAnchor` get backfilled from `recurringHistoryByMaster` (latest done date) at scheduler start |
| **Terminal exemption** | Rolling instances can be marked done/skip/cancel **without** a `scheduled_at` (exempt from `TERMINAL_REQUIRES_SCHEDULE`) |
| **On-demand materialization** | `rc_`-prefixed IDs (not yet in DB) are materialized on-the-fly when status is set |

**Source:** `expandRecurring.js:295-343`, `rolling-anchor.js:40-59`, `runSchedule.js:481-506`

---

## 5. Recurring Instance Lifecycle

### 5.1 Status Transitions for Instances

```
"" (pending) ──┬──→ done    (terminal — scheduled_at preserved or custom completedAt)
               ├──→ wip    (in progress — uses timeRemaining for effective duration)
               ├──→ skip   (terminal — scheduled_at snaps to now)
               ├──→ cancel (terminal — scheduled_at snaps to now)
               └──→ missed  (system-applied only — user cannot set directly)
```

### 5.2 Per-Action Behavior

| Action | Instance State | Rolling Anchor | TPC Impact | Spacing History | Terminal Dedup | Cal Sync |
|--------|---------------|----------------|------------|-----------------|----------------|----------|
| **done** | Terminal, `completed_at=now` | Re-anchored to `instanceDate` | Counts as fulfilled | **Yes** — updates `lastByMaster` | Blocks re-expansion on date | Outbound sync if linked |
| **skip** | Terminal, `scheduled_at` snapped to now | Re-anchored to `instanceDate` | `keep`: no new picks in cycle; `backfill`: slot opens | **No** | Blocks re-expansion on date | Outbound sync if linked |
| **cancel** | Terminal, `scheduled_at` snapped to now | **No change** (null) | Counts as fulfilled in `backfill` | **No** | Blocks re-expansion on date | Outbound sync if linked |
| **missed** | System-set, `completed_at=windowClose` | Soft nudge: `instanceDate + 1 day` | Same as skip for fill policy | **No** | Blocks re-expansion on date | No |
| **delete instance** | Soft-skipped (`status='skip'`) | Same as skip | Same as skip | Same as skip | Same as skip | Ledger cleaned |
| **delete template** | Pending→hard deleted; done/cancel/skip→archived | N/A | N/A | N/A | N/A | Ledger cleaned |

### 5.3 Missed Detection — Three Paths

| Source | Trigger | What Gets Marked | Resolution Window |
|--------|---------|-------------------|-------------------|
| **Scheduler v2 missed-window pass** | TIME_WINDOW task's flex window entirely past | Unplaced + dual-placed with `_overdue=true` | Immediate (at run time) |
| **Scheduler v2 missed-preferred-time pass** | Non-TIME_WINDOW recurring with passed preferred time | Unplaced (no dual-place) | Immediate (at run time) |
| **runSchedule Phase 9** | Past recurring instances whose `timeFlex` window expired | `status='missed'` in DB, `scheduled_at=windowClose` | On next scheduler run |
| **cal-history-cron** | 24-hour resolution window after `scheduled_at` | `shouldAutoMarkMissed()` → `status='missed'` | Daily cron, 24h window |

**Source:** `unifiedScheduleV2.js:1581-1628`, `runSchedule.js:1641-1671`, `missedHelpers.js:14-24`

### 5.4 Rolling Anchor Update Logic

`computeRollingAnchor(status, instanceDate, currentAnchor)`:

| Status | New Anchor | Rationale |
|--------|-----------|-----------|
| `done` | `instanceDate` | Last completion is the anchor |
| `skip` | `instanceDate` | Full re-anchor from skip date |
| `missed` | `instanceDate + 1 day` | Soft nudge forward |
| `cancel` | `null` (no change) | User opted out; don't affect cadence |

**Stale guard:** If `instanceDate < currentAnchor`, returns null (skip stale events).

**Source:** `rolling-anchor.js:40-59`

---

## 6. Split Task Rules

### 6.1 Two Split Systems

| Aspect | Recurring Splits | Non-Recurring Splits |
|--------|-----------------|---------------------|
| **When chunks created** | Phase 1 upfront (pre-materialized as DB rows) | Phase 2 inline (`placeSplitInline` on demand) |
| **Chunk computation** | `computeChunks(totalDur, splitMin)` → `Math.ceil(totalDur / splitMin)` chunks | Walks windows in 15-min steps, places chunks >= `splitMin` |
| **Day containment** | Day-locked (rigid) or cycle-capped (flexible TPC) | **Can cross day boundaries** — searches full date range |
| **Travel buffers** | Only `split_ordinal=1` carries `travelBefore`; only last ordinal carries `travelAfter` | Same |
| **Chunk IDs** | Deterministic: `<masterId>-YYYYMMDD[-N]` | Created inline, not pre-materialized |
| **split_group** | Set to `primaryId` when `chunks > 1` | Not used (inline) |
| **time_remaining** | If set on primary row, overrides `dur` for chunk computation | Same |
| **Drift fix** | Existing rows with wrong `(split_ordinal, split_total, dur)` get UPDATEd | `reconcileSplitsForUser` at scheduler start |

### 6.2 Day-Containment Rules

| Task Type | Containment | Rule |
|-----------|-------------|------|
| Recurring + rigid (`isDayLocked=true`) | **Same day only** | `earliestIdx = latestIdx = anchorDate` |
| Recurring + flexible TPC | **Within cycle** | `latestIdx = anchorDate + cycleDays - 1` |
| Recurring + unknown cycle | **Same day only** | Fallback to day-locked |
| Non-recurring | **Cross-day allowed** | Searches `earliestIdx` to `latestIdx` (bounded by deadline/startAfter) |

### 6.3 Split Chunk Minimums

- **`splitMinDefault`**: 15 minutes (`reconcile-splits.js:24`)
- **`splitMin`** is per-task configurable (user setting or API field)
- **No runt chunks**: If remainder < `splitMin` and not the only chunk, it's merged into the previous chunk
- **Partial splits**: If `remaining > 0` after scanning all windows, the task is marked `partial_split` in unplaced

### 6.4 Split + Status Changes

All split chunks sharing the same `occurrence_ordinal` get the same status update
when one chunk is marked done/skip/cancel.

**Source:** `runSchedule.js:577-825`, `unifiedScheduleV2.js:1093-1169`, `reconcile-splits.js:32-50`, `UpdateTaskStatus.js:200-213`

---

## 7. Deadline Rules

### 7.1 Core Rules

| Rule | Behavior | Source |
|------|----------|--------|
| Deadline is a **hard upper bound** | Scheduler caps `latestIdx` at `deadlineDate` | `unifiedScheduleV2.js:802-806` |
| Past-due tasks get **P1 boost + slack=0** | Placed at today's earliest free slot | `SCHEDULER.md:709-715` |
| `ignoreDeadline` (overdue ladder pass 2) | Removes the ceiling; places at first free slot past deadline | `unifiedScheduleV2.js:1038-1044` |
| Fixed tasks are **exempt** from overdue marking | `placementMode === 'fixed'` → skip overdue check | `runSchedule.js:1485` |
| Deadline drives slack computation | `slack = capacityInRange(earliestIdx..deadlineIdx) - dur` | `unifiedScheduleV2.js:542-555` |
| No deadline → `slack = Infinity` | Task sorts after all deadline-constrained items | `unifiedScheduleV2.js:548` |

### 7.2 Chain Deadline Backpropagation

When task B depends on task A, and B has a deadline, A inherits an **effective
deadline** (faux deadline) from B's deadline. This is computed by walking the
dependency chain backward.

**Known gap:** The current implementation inherits the consumer's deadline date
directly without a capacity-aware offset. This can make predecessors appear less
constrained than they actually are.

**Source:** `unifiedScheduleV2.js:1272-1292`

### 7.3 Recurring Instance Deadline Brackets

Recurring instances get auto-generated deadline brackets:

| Recurrence Type | `startAfter` | `deadline` (implicit) |
|----------------|-------------|----------------------|
| Daily | Occurrence date | Occurrence date (same day) |
| Weekly | Occurrence date | Occurrence date + 6 days |
| Monthly | Occurrence date | Occurrence date + 27 days |
| Every N days | Occurrence date | Occurrence date + (N - 1) days |
| TPC split chunks | Occurrence date | Day before next occurrence |

**Source:** `runSchedule.js:516-559,695-714`

### 7.4 `deadlineMisses` Is Dead Code

`unifiedScheduleV2.js:1768` returns `deadlineMisses: []` — this array is never
populated. Remnant from v1. Should be removed or implemented.

---

## 8. Earliest-Start Rules

### 8.1 Renaming: `start_after_at` → `earliest_start_at`

The field name `start_after_at` (DB column) / `startAfter` (API) is misleading.
"Start after" implies the task starts *after* that date, but the actual behavior
is "earliest allowable start date" — the task CAN start **on** that date.

**Recommendation:** Rename to `earliest_start_at` (DB) / `earliestStart` (API).
The old names remain as aliases during migration. This is a docs-only change
for now; code rename is a separate task.

### 8.2 Rules

| Rule | Behavior | Source |
|------|----------|--------|
| `earliestStart` is a **hard lower bound** | Scheduler starts search at `earliestIdx = indexOfDate(dates, startAfterDate)` | `unifiedScheduleV2.js:797-800` |
| Affects slack computation | `earliestIdx` shifts forward, reducing available capacity window | `unifiedScheduleV2.js:546-549` |
| Recurring instances auto-set | `t.startAfter = formatDateKey(occ)` — occurrence date is the floor | `runSchedule.js:554` |
| Split chunks respect it | Same `earliestIdx` logic in `placeSplitInline` | `unifiedScheduleV2.js:1100-1106` |

### 8.3 Validation Gap — `earliestStart > deadline`

If `startAfterDate > deadlineDate`, the search window inverts (`earliestIdx > latestIdx`),
producing zero results. The task **silently goes unplaced** with no specific reason.

**Recommendation:** Add validation on create/update: if `startAfter > deadline`,
return 400 or add a warning flag. In the scheduler, set `_unplacedReason = 'impossible_window'`.

**Source:** `unifiedScheduleV2.js:797-806`

---

## 9. Weather Rules

### 9.1 Constraint Types

| Field | Enum Values | Threshold | Passes When |
|-------|-------------|-----------|-------------|
| `weather_precip` | `any`, `wet_ok`, `light_ok`, `dry_only` | `any`/`wet_ok` = always; `light_ok` = precip ≤ 50%; `dry_only` = precip ≤ 20% | Hourly `precipitation_probability` ≤ threshold |
| `weather_cloud` | `any`, `overcast_ok`, `partly_ok`, `clear` | `any`/`overcast_ok` = always; `partly_ok` = cover ≤ 60%; `clear` = cover ≤ 25% | Hourly `cloudcover` ≤ threshold |
| `weather_temp_min/max` | Nullable int | Open-ended (null = no bound) | `temp ≥ min AND temp ≤ max` |
| `weather_humidity_min/max` | Nullable int | Open-ended (null = no bound) | `humidity ≥ min AND humidity ≤ max` |

### 9.2 Weather Is a Hard Constraint

Weather conditions are in the **same tier** as `when` tags and `location`/`tools`.
A task with `weather_precip: 'dry_only'` will **never** be placed in a slot where
`precipitation_probability > 20%`.

### 9.3 Missing Weather Data — Fail-Open

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| No weather cache for location (no coordinates) | **Fail-open** — constraint skipped for that slot | Location may be indoors; weather should not block |
| Cache miss (stale/expired) | **Fail-open** for that slot; fresh fetch triggered for next run | Avoids blocking all placement on a cache miss |
| Weather API down | **Fail-open** — empty map returned | Degraded mode, not a hard failure |
| Task has no weather constraints | **Short-circuit** — `hasWeatherConstraint()` returns false | Zero overhead for common case |

### 9.4 Detection Parity Risk

`runSchedule.js:1170-1174` duplicates the `hasWeatherConstraint` logic from
`unifiedScheduleV2.js:745-751` inline. If a new constraint field (e.g. humidity)
is added to one but not the other, tasks with that constraint will silently
fail-open.

**Recommendation:** Extract `hasWeatherConstraint` to a shared module. Both
`runSchedule.js` and `unifiedScheduleV2.js` should import it.

### 9.5 Reschedule on Weather Refresh

When the weather cache is refreshed (stale data replaced), the frontend fires
`POST /schedule/run`. Tasks that were placed in now-unsuitable slots may move;
tasks that were unscheduled due to weather may now have valid slots.

**Source:** `WEATHER-INTEGRATION.md:174-189,206-217`, `unifiedScheduleV2.js:745-787`

---

## 10. Time Block, Window & Tool Rules

### 10.1 Resolution Chain

```
1. Date → Day-of-week → Time Blocks (getBlocksForDate)
2. Time Blocks → Windows by tag (buildWindowsFromBlocks)
3. Task.when → Parsed tags → Eligible windows (getWhenWindows)
4. Date + Minute → Location (resolveLocationId)
5. Location → Tool matrix → canTaskRun? (canTaskRunAtMin)
6. Date + Minute → Weather → weatherOk?
7. All pass → Slot is eligible
```

### 10.2 Block Resolution Priority

| Priority | Source | Example |
|----------|--------|---------|
| 1 | `locScheduleOverrides[date]` | "Travel day" override |
| 2 | Day-of-week template | `blocksMap['Mon']` → weekday blocks |
| 3 | Default blocks | `DEFAULT_WEEKDAY_BLOCKS` / `DEFAULT_WEEKEND_BLOCKS` |

### 10.3 Location Resolution Priority

| Priority | Source | Example |
|----------|--------|---------|
| 1 | `hourLocationOverrides[date][hour]` | "At office 1-3pm" |
| 2 | `locScheduleOverrides[date]` → template | "Remote day" |
| 3 | `locScheduleDefaults[dayName]` → template | "Weekday = work template" |
| 4 | Template `hours[minSlot]` or `hours[hour]` | Schedule template hours |
| 5 | Block's `loc` field | `morning.loc = "home"` |
| 6 | Default: `"home"` | Fallback |

### 10.4 `when`-Tag to Window Mapping

| `when` Value | Windows | Notes |
|-------------|---------|-------|
| `""` or `"anytime"` | All blocks → `[[GRID_START, GRID_END]]` | No constraint |
| `"morning"` | Morning block range | Single tag |
| `"morning,afternoon"` | Morning + afternoon ranges | Multi-tag, deduplicated |
| `"biz"` (start ≥ 720) | Business blocks + **afternoon alias** | `biz` blocks starting at noon also match `afternoon` |
| `"fixed"` | N/A — handled by Phase 0 immovable path | No window lookup |

### 10.5 Tool Constraint Rules

| Rule | Behavior |
|------|----------|
| Task requires `tools: ["laptop"]` | Only placed during blocks where the active location has `laptop` in its `toolMatrix` entry |
| Task requires `location: ["work"]` | Only placed during blocks where `resolveLocationId` returns `"work"` |
| Both `tools` and `location` set | **Both** must pass — AND logic |
| No tools, no location | No constraint — can go anywhere |

### 10.6 Preferred Time + Placement Window Precedence

When a recurring task has a preferred time (e.g., 7:00 AM) and a placement window
(e.g., ±60m), the scheduler uses `[time - flex, time + flex]` as the **only**
constraint. The `when` block tags are **ignored** for that task.

| Has preferred time? | Has placement window? | Constraint used |
|---------------------|-----------------------|-----------------|
| Yes | Yes | `[time - flex, time + flex]` only |
| Yes | No (null) | `[time - 60m, time + 60m]` (default ±60m) |
| No | N/A | `when` block tags |

**Source:** `TASK-STATE-MATRIX.md:48-58`, `locationHelpers.js:42-73`, `timeBlockHelpers.js:15-133`

---

## 11. FlexWhen Rules

`flexWhen` is a **boolean flag** that works alongside any placement mode. It is
NOT a mode itself.

| Rule | Behavior |
|------|----------|
| `flexWhen=false` (strict) | If named `when`-blocks are full → task goes unplaced |
| `flexWhen=true` (flex) | If named `when`-blocks are full → retry with `relaxWhen=true` (treat as `anytime`) |
| TIME_WINDOW + flexWhen | `eligibleWindows` with `relaxWhen` ignores `isWindowMode`, falls through to `when`-tag matching |
| Placement flag | `_flexWhenRelaxed = true` on entries placed via relaxWhen |
| Not visible for `time_window` mode | TIME_WINDOW already has its own flex mechanism (`timeFlex`) |

**Source:** `unifiedScheduleV2.js:274,433,490-496,1037-1079`

---

## 12. Reschedule Triggers

### 12.1 Complete Trigger Inventory

All triggers go through `enqueueScheduleRun(userId, source)` from `scheduleQueue.js:94`.

**Debounce:** 2000ms quiet period before scheduler runs.
**Rate limit:** 10 scheduler runs per minute per user.

#### Task Mutations (via facade)

| # | Source String | Trigger |
|---|--------------|---------|
| 1 | `api:createTask` | New task created |
| 2 | `api:updateTask` | Task updated (if scheduling fields changed; `skipScheduler` for non-scheduling fields) |
| 3 | `api:deleteTask` | Task deleted |
| 4 | `api:updateTaskStatus` | Instance status changed |
| 5 | `api:updateTaskStatus:template` | Recurring template status changed |
| 6 | `api:reEnableTask` | Disabled task re-enabled |
| 7 | `api:takeOwnership` | User takes ownership of synced task |
| 8 | `api:batchCreateTasks` | Batch task creation |

#### Config Mutations (via `scheduleAfter` directive)

| # | Source String | Trigger |
|---|--------------|---------|
| 9 | `config:<key>` | SCHED_KEYS config key changed: `hour_location_overrides`, `time_blocks`, `loc_schedules`, `loc_schedule_defaults`, `loc_schedule_overrides`, `tool_matrix`, `preferences`, `schedule_templates`, `template_defaults`, `template_overrides` |
| 10 | `locations:replaced` | Locations list replaced |
| 11 | `import` | Full data import |

#### MCP Tools

| # | Source String | Trigger |
|---|--------------|---------|
| 12 | `mcp:create_task` | MCP task creation |
| 13 | `mcp:update_task` | MCP task update |
| 14 | `mcp:set_task_status` | MCP status change |
| 15 | `mcp:delete_task` | MCP task delete |
| 16 | `mcp:batch_update_tasks` | MCP batch update |
| 17 | (via scheduleAfter) | MCP config update |

#### External Events

| # | Source String | Trigger |
|---|--------------|---------|
| 18 | `cal-sync` | After sync if `pulled > 0 || deleted_local > 0 || deleted_remote > 0` |
| 19 | `startup` | New users without pending queue entries at server start |

#### User-Initiated

| # | Source String | Trigger |
|---|--------------|---------|
| 20 | (direct run) | `POST /api/schedule/run` — manual trigger |
| 21 | `frontend:task-end-nudge` | `POST /api/schedule/nudge` — task end time passed |

#### Frontend Automatic

| # | Trigger | Mechanism |
|---|---------|-----------|
| 22 | Task-end timer fires | `useTaskState.js` — setTimeout for next task end time |
| 23 | Tab becomes visible | `useTaskState.js` — visibilitychange listener (within 15-min staleness) |
| 24 | Periodic nudge | `useTaskState.js` — setInterval every 5 minutes while tab visible |
| 25 | Schedule change re-arm | `useTaskState.js` — after loadPlacements completes |
| 26 | Weather refresh | `AppLayout.jsx` — `weatherRefreshed` SSE → `POST /schedule/run` (once per session) |
| 27 | Initial load | `AppLayout.jsx` — background scheduler run on app load |

### 12.2 What Does NOT Trigger Reschedule

| Event | Why No Trigger |
|-------|---------------|
| lib-events (task event bus) | **Explicitly forbidden** from triggering scheduler (`taskEvents.js:9-13`) |
| Non-scheduling field updates | `skipScheduler: true` flag set for text/notes-only changes |
| Read-only operations | GET requests never trigger scheduling |
| Impersonation start/stop | No scheduling impact |

**Source:** `scheduleQueue.js`, `task.controller.js`, `UpdateConfig.js:49-52`, `useTaskState.js`, `AppLayout.jsx`

---

## 13. Contradictions & Open Issues

### 13.1 Cross-Document Contradictions

| # | Contradiction | Documents Involved | Resolution |
|---|---------------|-------------------|------------|
| C1 | **TASK-CONFIGURATION-MATRIX.md references `datePinned` and `rigid`** as active fields | TASK-CONFIGURATION-MATRIX vs WHEN-MODE-REDESIGN (which removed them) | WHEN-MODE-REDESIGN wins. `datePinned` and `rigid` columns still exist in DB (migration not yet executed) but application code no longer reads/writes them. The matrix should be updated to mark them as deprecated. |
| C2 | **SCHEDULER.md Phase table (0-6) vs v2 single-pass** | SCHEDULER.md describes v1's 6-phase model; v2 uses slack-sorted single pass | v2 phases (§3.1 above) are authoritative. SCHEDULER.md's phase table is a design reference, not current behavior. |
| C3 | **`deadlineMisses` array** is documented in SCHEDULER.md return shape but never populated | SCHEDULER.md vs code (`unifiedScheduleV2.js:1768`) | Dead code. Remove from docs or implement. |
| C4 | **Weather `weather_refresh` source string** documented in WEATHER-INTEGRATION.md vs actual implementation | WEATHER-INTEGRATION.md says `scheduleQueue` with reason `'weather_refresh'`; actual frontend fires `POST /schedule/run` directly | Frontend behavior wins. The docs should be updated. |
| C5 | **TASK-CONFIGURATION-MATRIX.md `rigid` column** shows `rigid=true` for `time_window + exact` recurring, but WHEN-MODE-REDESIGN says `rigid` is removed | TASK-CONFIGURATION-MATRIX vs WHEN-MODE-REDESIGN | `rigid` is derived in the scheduler from `timeFlex=0` but is no longer a stored DB column. The matrix should clarify this is a derived value, not a persisted field. |
| C6 | **SCHEDULER.md says `date_pinned` sets `earliestIdx=latestIdx=anchorDate`**, but v2 uses `placement_mode='fixed'` for this | SCHEDULER.md (v1) vs v2 code | v2 code wins. `placement_mode='fixed'` is the sole signal. `date_pinned` is a UI concern only. |

### 13.2 Missing Requirements (Not in REQUIREMENTS.md)

| # | Missing Requirement | Proposed ID | Priority |
|---|--------------------|-------------|----------|
| M1 | Recurring instance lifecycle rules (done/skip/cancel/missed/delete per recurrence type) | R32 | High |
| M2 | Rolling re-anchoring rules (mutable anchor, backfill, stale guard) | R33 | High |
| M3 | TimesPerCycle (TPC) rules (fill policies, spacing guard, flexible roaming) | R34 | High |
| M4 | Split task containment rules (day boundaries, recurring vs non-recurring, partial splits) | R35 | High |
| M5 | Deadline chain backpropagation and its limitations | R36 | Medium |
| M6 | `earliest_start_at` (renamed from `start_after_at`) validation and impossible-window detection | R37 | Medium |
| M7 | Weather fail-open behavior and detection parity requirement | R38 | Medium |
| M8 | Time block → location → tool → weather resolution chain | R39 | Medium |
| M9 | FlexWhen retry rules and `_whenRelaxed` flag semantics | R40 | Low |
| M10 | Reschedule trigger inventory and debounce/rate-limit rules | R41 | Low |

### 13.3 Weak Requirements (Need Strengthening)

| # | Requirement | Gap | Proposed Fix |
|---|-------------|-----|-------------|
| W1 | R11 (scheduler) | Does not mention placement modes, flexWhen, weather constraints, or the 4-level fallback ladder | Expand acceptance criteria |
| W2 | R18 (recurring) | Does not mention rolling recurrence, TPC, fill policies, or spacing guard | Expand |
| W3 | R19 (splits) | Does not mention day-containment rules, recurring vs non-recurring differences, or partial splits | Expand |
| W4 | R25 (weather) | Does not mention fail-open behavior or the hard-constraint rule | Expand |
| W5 | R26 (fixed/pinned) | Does not distinguish `isFixedWhen` (non-recurring, never displaced) from `isRigid` (recurring, can be force-placed) | Expand |

### 13.4 Open Issues (Need Decision)

| # | Issue | Options | Recommendation |
|---|-------|--------|---------------|
| O1 | `start_after_at` naming | (a) Keep as-is, (b) Rename to `earliest_start_at`, (c) Alias both | **Option B** with migration alias. The current name is actively confusing. |
| O2 | `startAfter > deadline` silent failure | (a) Add backend validation (400), (b) Add scheduler warning flag, (c) Both | **Option C** — validate on create/update AND flag in scheduler. |
| O3 | `datePinned` / `rigid` columns still in DB | (a) Execute pending migration, (b) Keep columns, (c) Drop in next cleanup pass | **Option A** — audit SQL confirms zero mismatched rows. Execute migration. |
| O4 | `deadlineMisses` dead code | (a) Remove, (b) Implement, (c) Leave as-is | **Option A** — remove dead code and doc reference. |
| O5 | Weather detection parity (duplicated `hasWeatherConstraint`) | (a) Extract to shared module, (b) Leave as-is with comment, (c) Add test | **Option A** — extract to shared module, import in both files. |
| O6 | `TIME_BLOCKS` mode indistinguishable from `ANYTIME + when` in scheduler | (a) Add explicit `TIME_BLOCKS` branch, (b) Document equivalence, (c) Remove `TIME_BLOCKS` mode | **Option B** — document the equivalence. The mode exists for UI clarity, not scheduler logic. |
| O7 | `recurring + fixed` blocked by UI only, no server enforcement | (a) Add backend validation, (b) Document as UI-only guard | **Option A** — add backend validation to prevent API/MCP bypass. |
| O8 | Chain deadline backpropagation imprecise | (a) Add capacity-aware offset, (b) Document limitation, (c) Leave as-is | **Option B** — document limitation for now; add capacity-aware offset in a future iteration. |
| O9 | Markers without `anchorMin` have no rendering path | (a) Add all-day marker rendering, (b) Force markers to require time, (c) Document as known gap | **Option C** — document; add rendering path when a use case appears. |
| O10 | `flexWhen` not visible for `time_window` mode | (a) Show flexWhen toggle for time_window, (b) Document why hidden, (c) Add separate "extend window" control | **Option B** — time_window already has `timeFlex`; flexWhen would be redundant. Document this. |

---

*End of SCHEDULER-RULES.md*