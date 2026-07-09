---
type: design
service: juggler
status: active
last_updated: 2026-07-09
tags:
  - type/design
  - service/juggler
  - status/active
  - task-management
  - scheduler
---

# Task & Habit State Matrix

**Last Updated:** 2026-07-09

> **Update (juggler-recur-lifecycle-redesign, W7, 2026-07-09, SPEC AC9).** FR-1 through FR-7
> shipped this leg touch four areas of this doc: the reopen transition now has a date-gate
> (FR-2, § Status Transitions / § Modal button disabling), the future-day completion block now
> carves out rolling masters (FR-3, § Completion date rules), the template-delete cascade text
> was corrected — it was never accurate, see § Habit Template — and material schedule-edit
> reconciliation (FR-4/FR-5) plus the shared confirm-modal primitive (FR-7) are newly documented
> under § Habit Template. See each section below for detail.

> **Correction (sched-audit L1, REG-04, 2026-07-02).** The `pause` transition below previously said
> pause "deletes future instances". Verified live: `facade.js` `handleTemplatePause` (999.590 ruling)
> sets `status='pause'` on open future instances — it does **not** delete them; `unpause` restores
> `status=''`. `expandRecurring`'s `sources` filter separately skips templates with `status`
> `pause`/`disabled`/`cancelled` so no *new* instances generate while paused, which is where the
> "no future instances appear" impression likely came from. `SCHEDULER-SPEC.md` `[B-TERM.6]` already
> documents the corrected keep-not-delete behavior; this doc was the one still drifted.

> Complete reference for how every combination of task type, scheduling mode,
> and user action maps to UI controls and scheduler behavior.

## Task Types

| Type | DB `task_type` | Visible | Schedulable | Draggable |
|------|---------------|---------|-------------|-----------|
| Regular task | `task` | Yes | Yes | Yes |
| Fixed event | `task` (when=fixed) | Yes | No (immutable) | Yes (updates time) |
| Marker | `task` (marker=true) | Yes | No (non-blocking) | Yes (time only) |
| Habit template | `habit_template` | No (hidden) | No (blueprint) | No |
| Habit instance | `habit_instance` | Yes | Yes | Yes |

## Status Transitions

```
"" (open) ──┬──→ done    (terminal — snaps scheduled_at to now)
            ├──→ wip     (in progress — uses timeRemaining for dur)
            ├──→ skip    (terminal — snaps scheduled_at to now)
            ├──→ cancel  (terminal — snaps scheduled_at to now)
            └──→ pause   (template only — cascades status='pause' to open future instances, kept not deleted; 999.590)

wip ────────┬──→ done
            ├──→ "" (reopen)
            └──→ skip / cancel

done/skip/cancel/pause ──→ "" (reopen — explicit reactivation of an already-settled instance,
                            999.1181 "terminal != irreversible")
                            see "Reopen date-gate (FR-2)" below

disabled ───┬──→ "" (via re-enable endpoint, checks plan limits)
            └──→ (no other transitions — frozen)

overdue ──── (not a status — computed-on-read flag, R50.6)
              past-due + incomplete → pinned at due date, flagged overdue
              scheduler excludes from placement, calendar shows overdue badge
```

**Reopen date-gate (FR-2, 2026-07-09).** Reactivation is REJECTED (backend, HTTP 400
`REOPEN_DATE_GATE`, `UpdateTaskStatus.js`) and the "" (reopen) control is disabled (frontend,
`StatusToggle.jsx`/`TaskDetailHeader.jsx`, gated on an `instanceDate` prop vs. today) when the
instance's `date < today`. Same-day reactivation (`date == today`) still works, and instances
with no `date` are unaffected. This gate is ADDITIVE to the VALID_TRANSITIONS rule above — it
does not change which statuses may transition to "", only whether a past-dated instance may. It
does **not** affect the separate client-snapshot **undo** mechanism (ruling #3,
`juggler-ui-scheduler-rulings-2026-07-06`), which has no date check and is always allowed.

## Task Action Buttons (StatusToggle)

Status buttons are rendered by `StatusToggle` (`juggler-frontend/src/components/schedule/StatusToggle.jsx`) as a row of icon buttons driven by the `ALL_STATUSES` array (`StatusToggle.jsx:13–21`). The row shows status changes only — Delete is NOT in this row (see Delete below).

| Button | `value` | `systemOnly` | Nature | Initiator |
|--------|---------|-------------|--------|-----------|
| **Start** | `wip` (`StatusToggle.jsx:16`) | `false` | User-initiated write action | User click |

### Delete

Delete is a destructive data operation, not a status change. It is NOT rendered in the StatusToggle button row on calendar cards. Delete lives in the `TaskDetailHeader` (expanded edit form, `TaskDetailHeader.jsx:30-41`) where destructive actions are visually separated from non-destructive status buttons. Cancel (status='cancel', R32) covers "I don't want this" and keeps the row — it stays in the status row.

**Scope matters.** A single non-recurring task's delete is a hard row removal (R3). A recurring
**series** delete is a different operation with a different postcondition — see § Habit Template
below for the corrected soft-cancel-everything cascade and the new `cal_locked` delete gate
(FR-6, 2026-07-09). Both single-task delete and series delete now confirm through the shared
`ConfirmModal` primitive (FR-7, 2026-07-09) — see § Habit Template.

### Start

Clicking calls `onChange('wip')` (`StatusToggle.jsx:71`), wired through `onStatusChange` (`TaskCard.jsx:123`, `ScheduleCard.jsx:189`) to `apiClient.put('/tasks/:id/status', { status: 'wip' })` (`useTaskState.js:225`). `wip` is in `VALID_STATUSES` (`UpdateTaskStatus.js:50`); the `"" → wip` transition also populates `time_remaining` from the estimate (`UpdateTaskStatus.js:173–175`). `wip` means "in progress" (`shared/task-status.js:16`).

**Visibility:** shown for all task types except `recurring_template` — templates are restricted to Open/Pause only (`StatusToggle.jsx:54–56`). Never disabled by the `disableTerminal` guard, which covers only `done/cancel/skip/pause` (`StatusToggle.jsx:45,79`); Start is always clickable when shown.

### Modal button disabling

Status buttons are modal — only valid transitions are enabled. The `VALID_TRANSITIONS` map in `StatusToggle.jsx` (and a parallel map in `TaskDetailHeader.jsx`) encodes the state matrix:

- The current status's own button is always disabled (no self-transition).
- From "" (open): done, wip, skip, cancel, pause are enabled.
- From wip: done, "" (reopen), skip, cancel are enabled.
- From terminal (done/cancel/skip/pause): only "" (reopen) is enabled — no terminal-to-terminal transitions.
- **Reopen date-gate (FR-2, 2026-07-09):** when the above rule enables "" (reopen) from a terminal status, it is additionally disabled if the instance's `date < today` — same-day reactivation stays enabled. This is checked in addition to, not instead of, the VALID_TRANSITIONS rule above.

Invalid buttons render at 45% opacity with `cursor: not-allowed` and a tooltip reading "Current status" (for the active one) or the button label.

## Scheduling Constraint Precedence

**Preferred time + placement window TRUMPS time window tags.**

When a habit has a preferred time (e.g., 7:00 AM) and a placement window (e.g., ±60m), the scheduler uses `[time - flex, time + flex]` as the ONLY constraint. The `when` block tags (morning, afternoon, etc.) are ignored. This prevents conflicts where a "morning" block (6am-12pm) could drift a 7am breakfast to 11am.

| Has preferred time? | Has placement window? | Constraint used |
|---------------------|-----------------------|-----------------|
| Yes | Yes | `[time - flex, time + flex]` only |
| Yes | No (null) | `[time - 60m, time + 60m]` (default ±60m) |
| No | N/A | `when` block tags (morning, afternoon, etc.) |

## Internal: `habit` Flag
The `habit` field is an internal boolean auto-derived from recurrence:
- `recur !== null` → `habit = true` (recurring task)
- `recur === null` → `habit = false` (one-off task)

The UI never shows a "Habit" toggle. Recurrence is the only user-facing control.
The `habit` flag gates scheduler behaviors (flex windows, overdue detection, template inheritance, Phase 0/5 handling).

## Recurring Task Scheduling Modes

### Mode 1: Time Window (preferred time ± flex)
**When to use:** Habit has a specific time of day (breakfast at 7am, lunch at noon, evening meds at 6pm)

**Detection:** User selects "Time window" mode in the form (sets preferred time + ± window)

| Setting | Value | Source |
|---------|-------|--------|
| when | Single tag (e.g., `"morning"`) | User selects |
| time | Preferred time (e.g., `"7:00 AM"`) | User enters |
| timeFlex | ±N minutes (e.g., 60) | User selects from Placement window |
| rigid | `false` (scheduler can adjust within flex) | Auto-derived |
| flexWhen | `false` | Auto-derived (strict to single block) |

**UI Controls Shown:**
- ✅ Preferred time? toggle (YES selected)
- ✅ ⏰ Time input (time-only, no date)
- ✅ ± Placement window selector
- ✅ 🔁 Recurrence
- ✅ Days (from recurrence)
- ✅ Duration
- ✅ 📅 Scheduled (read-only, shows scheduler's placement)
- ❌ Time window (auto = window-based)
- ❌ Day requirement (auto from recurrence)
- ❌ Date field (hidden — recurrence drives dates)
- ❌ Date pinned (hidden)
- ❌ Block windows (hidden — single tag is the window)
- ❌ Flex toggle (hidden)

**Scheduler Behavior:**
1. Flex window = `[preferredTime - flex, preferredTime + flex]`
2. If flex window has room → place within it
3. If flex window is full → **skip this day** (not drift to 11am)
4. If flex window entirely in the past → **flag as overdue** (unplaced, pinned at due date)
5. Never falls back to broad when-window

**Examples:**
| Habit | when | time | timeFlex | Scheduler places |
|-------|------|------|----------|-----------------|
| Eat Breakfast | morning | 7:00 AM | 60 | 6:00–8:00 AM window |
| Lunch | lunch | 12:00 PM | 30 | 11:30 AM–12:30 PM window |
| Evening Meds | evening | 6:00 PM | null (→60) | 5:00–7:00 PM window |
| Exercise | evening | — (none) | null | Anywhere in evening block |

---

### Mode 2: Time Blocks (flexible placement in selected blocks)
**When to use:** Habit can go in any of several time blocks (apply for jobs, clean bathroom, etc.)

**Detection:** User selects "Time blocks" mode in the form (picks block windows)

| Setting | Value | Source |
|---------|-------|--------|
| when | Multi tags (e.g., `"morning,afternoon,evening"`) or `""` | User selects blocks |
| time | Not meaningful (set by scheduler) | Hidden |
| timeFlex | Not used (blocks define windows) | Hidden |
| rigid | `false` | Auto-derived |
| flexWhen | User choice | User toggles Strict/Flex |

**UI Controls Shown:**
- ✅ Preferred time? toggle (NO selected)
- ✅ Block window buttons (Morning, Lunch, Afternoon, etc.)
- ✅ Strict / Flex toggle
- ✅ 🔁 Recurrence
- ✅ Days (from recurrence)
- ✅ Duration
- ✅ Split OK + Min block
- ✅ 📅 Scheduled (read-only)
- ❌ Time input (hidden — no preferred time)
- ❌ Placement window (hidden — blocks define windows)
- ❌ Time window (auto = window-based)
- ❌ Day requirement (auto from recurrence)
- ❌ Date field (hidden)

**Scheduler Behavior:**
1. Place in earliest available slot within selected blocks
2. Priority ordering: P1 habits before P3 habits
3. If `flexWhen`: retry with "anytime" windows if blocks are full
4. If `!flexWhen` (strict): unplaced if blocks are full
5. No preferred-time flex window (no `timeFlex` constraint)

**Examples:**
| Habit | when | flexWhen | Scheduler places |
|-------|------|----------|-----------------|
| Apply for Jobs | morning,lunch,afternoon,evening,night | true | Earliest open slot anywhere |
| Resume Optimizer | morning,lunch,afternoon,evening,night | true | Earliest open slot anywhere |
| Clean Bathroom | morning,biz,lunch,afternoon,evening | false | Earliest in listed blocks only |

---

## Regular Task Scheduling Modes

### Anytime (when = "" or "anytime")
- Scheduler picks best slot by priority and date
- No block or time constraint

### Window-based (when = "morning,afternoon")
- Scheduler places within selected blocks
- Flex toggle: retry outside blocks if full

### Fixed (when = "fixed")
- Anchored at exact date+time
- Scheduler never moves it
- Not reset on scheduler runs

### All-day (when = "allday")
- Spans full day, not on time grid
- No time, duration, split, or travel fields

---

## Fixed–Recurring XOR Invariant

A task may use `placement_mode = 'fixed'` OR have `recurring = true`, but **never both** (leg 999.867, commit `60a9e81`).

The **illegal state** is `placement_mode === 'fixed'` AND `recurring` truthy. Any write in that state is **rejected** by the backend with the machine-readable error code `invalid_combination` (HTTP 400 / MCP validation error); nothing is persisted — there is no silent coercion.

**Enforcing code:** `isFixedRecurringConflict(opts)` in `src/slices/task/domain/validation/taskValidation.js:98` — the single source of the XOR decision, called by all four write chokepoints:

| Path | Location | Result |
|------|----------|--------|
| Create / general validation | `validateTaskInput` → `taskValidation.js:329` | `['invalid_combination']` |
| HTTP `PUT /api/tasks/:id` | `UpdateTask.execute` → `UpdateTask.js:151–152` | HTTP 400 `{ error: 'invalid_combination' }` |
| MCP `update_task` | `src/mcp/tools/tasks.js:283–284` | `Validation error: invalid_combination` (isError) |
| Bulk `ImportData` | `ImportData.js:122–123` | HTTP 400 `{ error: 'invalid_combination' }` (validated before the destructive transaction) |

> See also: `TASK-PROPERTIES.md` — Fixed–Recurring Exclusion (XOR invariant) for the full invariant definition, flip-handling semantics, and property-table cross-references.

---

## Drag-to-Pin State Machine

### Regular Task (when ≠ fixed)
```
[scheduler-controlled]
    │
    ├── user drags ──→ [PINNED]
    │                   when = 'fixed'
    │                   prev_when = original when
    │                   date_pinned = true
    │                   📌 badge shown
    │                      │
    │                      ├── user clicks Unpin ──→ [scheduler-controlled]
    │                      │   when = prev_when
    │                      │   prev_when = null
    │                      │   date_pinned = false
    │                      │
    │                      └── scheduler run ──→ stays [PINNED]
    │                          (when=fixed → exempt from reset)
    │
    └── user edits date/time in form ──→ [date_pinned = true]
        scheduler can still move TIME (not date)
```

### Fixed Task (when = fixed, no prev_when)
```
[fixed] ── user drags ──→ [fixed at new time]
           (no state change, just scheduled_at update)
           (no prev_when stored — was always fixed)
```

### Habit Instance
```
[template-derived]
    │ (generated by scheduler from habit_template)
    │
    ├── user drags ──→ [PINNED INSTANCE]
    │                   when = 'fixed' (on instance row, not template)
    │                   prev_when = original when
    │                   date_pinned = true
    │                   📌 badge + "pinned (this day only)"
    │                      │
    │                      ├── user clicks "Reset to template" ──→ [DELETED]
    │                      │   instance row deleted from DB
    │                      │   next scheduler run regenerates from template
    │                      │   → back to [template-derived]
    │                      │
    │                      └── scheduler run ──→ stays [PINNED]
    │                          (when=fixed → exempt)
    │
    └── user marks done/skip/cancel ──→ [terminal]
        scheduled_at snapped to now
        instance preserved in DB (not regenerated)
```

**Completion date rules for recurring instances:**

| Instance date | Recur type | User action | Allowed? |
|---------------|------------|-------------|----------|
| Today (any time) | any | Mark done | ✅ Yes — completing early on the same calendar day is normal |
| Future day | pattern (daily/weekly/monthly/interval/biweekly/etc. — anything except `rolling`) | Mark done | ❌ No — UI blocks with warning; use skip or cancel instead |
| Future day | **`rolling`** (`recur.type === 'rolling'`) | Mark done | ✅ **Yes (FR-3, 2026-07-09).** Real use case: complete early — e.g. wash the car ahead of schedule. Rolling masters have no fixed pattern date to protect. |
| Past day | any | Mark done | ✅ Yes — overdue instance, CompletionTimePicker offered |

**Corrected, 2026-07-09 (FR-3).** This block previously applied to ALL recur types; it is now
lifted specifically for `recur.type === 'rolling'` masters, unchanged for every other recur type.
The guard is `evaluateFutureCompletionGuard(task, today)`
(`juggler-frontend/src/utils/futureCompletionGuard.js`, extracted this leg from
`AppLayout.jsx`'s `handleStatusChange`), which uses the same ISO date key comparison as before
(`taskDateKey > nowDayKey`, where today's key is never greater than itself) **and** blocks only
when `isFuture && !isRolling`.

### Habit Template
```
[blueprint — not visible on calendar]
    │
    ├── user edits a NON-material field (weather_precip, weather_cloud, weather_temp_*, pri,
    │   notes, project, section, url, tools, location) ──→ propagates to all open instances,
    │   no instance pruning/reconciliation (FR-5, 2026-07-09)
    │
    ├── user edits a MATERIAL field (recur.type, recur.days, recur.every, recur.intervalDays,
    │   recur.monthDays, recur.timesPerCycle, split, split_min, dur, placement_mode) ──→
    │   triggers material schedule-edit reconciliation (FR-4/FR-5, 2026-07-09 — see below):
    │   `done` instances untouched; `skip`/`cancel` instances pruned; open instances
    │   pruned/fabricated to the new cycle target, effective immediately
    │
    ├── user pauses ──→ cascades status='pause' to open future instances (kept, not deleted; 999.590)
    ├── user unpauses ──→ restores instances to status=''; scheduler resumes generating new ones
    └── user deletes (series) ──→ soft-cancels everything; see "Delete (series) — corrected" below
```

**Delete (series) — corrected, 2026-07-09 (FR-6 / R55 / 999.844).** The diagram's previous text
here ("cascade: delete open instances, orphan completed ones") was **never accurate** — verified
against the actual `cascadeRecurringDelete` (`facade.js:673-741`) code, not merely re-derived.
Ground truth, unchanged by this leg: **nothing is ever hard-deleted.** Non-terminal (open)
instances are soft-cancelled (`status='cancelled'`); terminal instances
(`done`/`cancel`/`skip`/`pause`) are kept verbatim; the master itself is soft-cancelled
(`status='cancelled'`). **New this leg:** the delete is blocked (HTTP 403,
`CAL_LOCKED_DELETE_BLOCKED`) before any mutation if any instance in the series has `cal_locked`
set (`findCalLockedSeriesInstance` in `facade.js`, wired into `DeleteTask.js`) — the user must
resolve the calendar lock first. Both single-task delete and series delete confirm via the
shared `ConfirmModal` primitive (FR-7, see below).

### Material Schedule-Edit Reconciliation (FR-4 / FR-5, 2026-07-09)

Editing a recurring master's **material** fields — `recur.type`, `recur.days`, `recur.every`,
`recur.intervalDays`, `recur.monthDays`, `recur.timesPerCycle`, `split`, `split_min`, `dur`, or
`placement_mode` — triggers reconciliation of that master's existing instances, with **immediate
effect** (including the in-progress cycle):

| Instance status | Effect |
|------------------|--------|
| `done` | Never touched |
| `skip` / `cancel` | Pruned (removed) |
| open (non-terminal) | Reconciled to the new cycle target: `remaining_needed = new_timesPerCycle − done_this_cycle`. Surplus pruned furthest-date-first; deficit fabricated. |

Order of operations: the reconciliation computes the in-progress cycle relative to today →
prunes/reconciles → refabricates forward from that point (`reconcileMaterialEdit`, `facade.js`,
reusing `getStableEpoch`/`enumerateBookedDatesInCycle` from `shared/scheduler/expandRecurring.js`
rather than reimplementing the cycle math). This does not itself write `task_masters.next_start`
— see § Recurring Master Anchor below; the next terminal-status write or scheduler run corrects
the anchor per the normal FR-1 triggers.

Editing a **non-material** field (`weather_precip`, `weather_cloud`, `weather_temp_*`, `pri`,
`notes`, `project`, `section`, `url`, `tools`, `location`) applies silently — no pruning or
reconciliation (AC6).

### Recurring Master Anchor (`next_start`)

**Unified, 2026-07-09 (FR-1).** `task_masters.next_start` is now the canonical **read** anchor
(the first non-terminal instance date for that master) — `getAnchor()` reads `next_start` only.
It supersedes the two previously-separate anchor columns, `rolling_anchor` and
`next_occurrence_anchor`, on the read path. For this leg the **write** path dual-writes:
`applyRollingAnchor` writes `next_start` in the same update alongside continuing to write both
legacy columns (34 pre-existing test files depend on those legacy writes; ceasing them is a
separate, deferred follow-on — not this leg's scope). `next_start` advances monotonically (never
regresses) on: (a) a terminal-status write to one of the master's instances — recomputed from
that instance's own date; (b) a scheduler run's first step, for every **non-rolling** master
whose `next_start` is stale (`< today`) — advanced to the first pattern date `>= today`. Rolling
masters are exempt from (b): no anchor exists until first completion.

> This doc covers the anchor only as it bears on instance/status lifecycle. The
> scheduler-facing mechanism (read/write call sites, the monotonic-guard SQL, and the dual-write
> follow-on) belongs in `SCHEDULER-SPEC.md` — **not updated by this leg**; flagged here as a
> separate documentation follow-up.

### Shared Confirm-Modal Primitive (FR-7, 2026-07-09)

All destructive/irreversible actions requiring confirmation — single-task delete, recurring
series delete, and the material-edit removal warning above — now confirm through one shared
`ConfirmModal` component (`juggler-frontend/src/components/common/ConfirmModal.jsx`), replacing
several previously-inconsistent one-off dialogs (closes backlog 999.1228/999.1229). The
series-delete dialog (`RecurringDeleteDialog.jsx`) uses `ConfirmModal`'s optional tertiary-button
slot for "Skip this instance" alongside "Delete entire series"; both delete dialogs disable
Confirm (`confirmDisabled`) and show a `blockedMessage` when the `cal_locked` delete gate (above)
rejects the action.

---

## Field Visibility Matrix

### Habits

| Field | Preferred Time (single when) | Flexible (multi when) |
|-------|-----------------------------|-----------------------|
| Preferred time? toggle | ✅ YES selected | ✅ NO selected |
| ⏰ Time input | ✅ (time-only) | ❌ hidden |
| ± Placement window | ✅ | ❌ hidden |
| Block windows | ❌ hidden | ✅ |
| Strict/Flex toggle | ❌ hidden | ✅ |
| 📅 Time window | ❌ hidden (auto) | ❌ hidden (auto) |
| Day requirement | ❌ hidden (from recurrence) | ❌ hidden (from recurrence) |
| Date / Time input | ❌ hidden | ❌ hidden |
| Date pinned | ❌ hidden | ❌ hidden |
| 🔁 Recurrence | ✅ | ✅ |
| Recurrence days | ✅ | ✅ |
| ⏱ Duration | ✅ | ✅ |
| 📊 Remaining | ✅ (if not create) | ✅ (if not create) |
| ✂ Split OK | ✅ | ✅ |
| 🚗 Travel before/after | ✅ | ✅ |
| 📍 Location / Tools | ✅ | ✅ |
| 📅 Start/Discontinue | ✅ | ✅ |
| 📅 Scheduled (read-only) | ✅ (instance only) | ✅ (instance only) |
| 📌 Unpin button | ✅ (if drag-pinned) | ✅ (if drag-pinned) |
| Due / Start after | ❌ hidden (habits) | ❌ hidden (habits) |

### Regular Tasks

| Field | Anytime | Window-based | Fixed | All-day |
|-------|---------|-------------|-------|---------|
| 📅 Date / Time | ✅ datetime-local | ✅ datetime-local | ✅ datetime-local | ✅ date-only |
| 📌 Pin/Unpin | ✅ (if pinned) | ✅ (if pinned) | N/A (always fixed) | ❌ |
| 📅 Time window | ✅ all options | ✅ all options | ✅ all options | ✅ all options |
| Day requirement | ✅ | ✅ | ❌ (grayed) | ❌ |
| ⏱ Duration | ✅ | ✅ | ✅ | ❌ |
| ✂ Split OK | ✅ | ✅ | ❌ | ❌ |
| 📅 Due | ✅ | ✅ | ❌ (grayed) | ✅ |
| ⏳ Start after | ✅ | ✅ | ❌ (grayed) | ✅ |
| 🔁 Recurrence | ✅ | ✅ | ✅ ¹ | ✅ |
| 🚗 Travel | ✅ | ✅ | ✅ | ❌ |
| 📍 Location / Tools | ✅ | ✅ | ✅ | ✅ |
| Placement window | ❌ (not a habit) | ❌ | ❌ | ❌ |

> ¹ **Backend XOR invariant (leg 999.867):** The server rejects any write with `placement_mode = 'fixed'` AND `recurring = true`, returning `{ error: 'invalid_combination' }` (HTTP 400 / MCP validation error) — nothing is persisted. Whether the UI currently suppresses the Recurrence control under Fixed mode has **not** been verified by leg 999.867, which is backend enforcement only. If the control is accessible and the combination is submitted, it will fail server-side. See [Fixed–Recurring XOR Invariant](#fixedrecurring-xor-invariant).

---

## Scheduler Phase Handling by Type

| Phase | Fixed | Rigid Habit | Preferred-Time Habit | Flexible Habit | Regular Task |
|-------|-------|-------------|---------------------|----------------|-------------|
| 0: Fixed items | ✅ placed at exact time | — | — | — | — |
| 0: Rigid habits | — | ✅ placed at when-block start | — | — | — |
| 1: Deadlines + habits | — | — | ✅ placed in flex window | ✅ placed in when-blocks by priority | ✅ deadline tasks late-placed |
| 2: Flexible tasks | — | — | — | — | ✅ early-placed by priority |
| 2.5: Compaction | — | — | — | — | ✅ priority swaps |
| 3: Pull-forward | — | — | — | — | ✅ deadline tasks pulled earlier |
| 4: Relaxation | — | — | — | ✅ flexWhen retry | ✅ flexWhen retry |
| 4.5: Overflow | — | — | — | ✅ ±7 days | ✅ ±7 days |
| 5: Habit rescue | — | — | — | ✅ bump non-habit to make room | — |
| 5.5: Packing | ✅ exempt | ✅ exempt | ✅ participates | ✅ participates | ✅ participates |
| 6: Hill climb | ✅ exempt | ✅ exempt | ✅ within flex | ✅ within when-blocks | ✅ swap/shift |
| Reset on next run | ❌ never | ❌ never | ✅ (unless drag-pinned) | ✅ (unless drag-pinned) | ✅ (unless drag-pinned or fixed) |

---

## Overdue / Unplaced Handling

| Scenario | Behavior | User sees |
|----------|----------|-----------|
| Preferred-time habit, flex window passed | Flagged overdue, not placed | "Preferred window (6–8 AM) has passed" in unplaced list |
| Preferred-time habit, flex window full | Skipped on that day, not drifted | "Flex window full" in unplaced list |
| Flexible habit, all blocks full | Unplaced | "All [block] slots full" + suggestions |
| Flexible habit, flexWhen + all blocks full | Placed via relaxation (anytime) | Placed with `_whenRelaxed` flag |
| Regular task, no capacity | Unplaced | Diagnostic + suggestions |
| Drag-pinned task | Never unplaced (fixed mode) | Stays at pinned time |
| Rigid habit, slot blocked | Force-placed with `_conflict` | Shown in overlap column, warning badge |

---

## Data Issues Found

| Habit | Issue | Fix |
|-------|-------|-----|
| ht_apply (Apply for Jobs) | `rigid: true` but has multi-when (all blocks) — rigid is wrong for a flexible work habit | Set `rigid: false` |
| ht_resume (Resume Optimizer) | `rigid: true` but has multi-when (all blocks) — same issue | Set `rigid: false` |
| ht_breakfast (Eat Breakfast) | `rigid: false` but should behave as preferred-time mode — no explicit `time_flex` set | Working correctly with new single-when detection |
| ht_meds (Morning Prescriptions) | `rigid: false`, `time_flex: 120` (±2hr) — works correctly | No change needed |
| ht_exercise (Exercise) | `rigid: false`, single when `evening` — detected as preferred-time mode | Verify user intent (may want flexible) |
