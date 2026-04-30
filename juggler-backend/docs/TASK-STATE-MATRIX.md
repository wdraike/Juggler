# Task & Habit State Matrix

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
            └──→ pause   (template only — deletes future instances)

wip ────────┬──→ done
            ├──→ "" (reopen)
            └──→ skip / cancel

disabled ───┬──→ "" (via re-enable endpoint, checks plan limits)
            └──→ (no other transitions — frozen)
```

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
The `habit` flag gates scheduler behaviors (flex windows, missed detection, template inheritance, Phase 0/5 handling).

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
4. If flex window entirely in the past → **mark as missed** (unplaced)
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

| Instance date | User action | Allowed? |
|---------------|-------------|----------|
| Today (any time) | Mark done | ✅ Yes — completing early on the same calendar day is normal |
| Future day | Mark done | ❌ No — UI blocks with warning; use skip or cancel instead |
| Past day | Mark done | ✅ Yes — overdue instance, CompletionTimePicker offered |

The guard in the frontend (`AppLayout.jsx`) enforces this using ISO date key comparison (`taskDateKey > nowDayKey`), where today's key is never greater than itself.

### Habit Template
```
[blueprint — not visible on calendar]
    │
    ├── user edits via form ──→ propagates to all open instances
    ├── user pauses ──→ deletes future open instances
    ├── user unpauses ──→ scheduler regenerates instances
    └── user deletes ──→ cascade: delete open instances, orphan completed ones
```

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
| 🔁 Recurrence | ✅ | ✅ | ✅ | ✅ |
| 🚗 Travel | ✅ | ✅ | ✅ | ❌ |
| 📍 Location / Tools | ✅ | ✅ | ✅ | ✅ |
| Placement window | ❌ (not a habit) | ❌ | ❌ | ❌ |

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

## Missed / Unplaced Handling

| Scenario | Behavior | User sees |
|----------|----------|-----------|
| Preferred-time habit, flex window passed | Marked `missed`, not placed | "Preferred window (6–8 AM) has passed" in unplaced list |
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
