# Juggler Task Settings — Complete Tree & Testing Scenarios

> Generated: 2026-06-15
> Source: DB schema (migrations), Zod schemas, validation logic, scheduler rules, frontend UI controls

---

## 1. TASK SETTING TREE

Every task in Juggler is a **task_master** (user intent) with zero or more **task_instances** (scheduler-placed occurrences). Settings are split across these two tables plus the `tasks_v` view that joins them.

### 1.1 Identity & Content

```
TASK
├── text              string(1-500)     — Task name (required on create)
├── notes             string(0-5000)    — Free-text notes
├── url               string(0-2048)    — External link (email, doc, issue)
├── project           string(0-100)     — Project name (links to projects table)
├── section           string(255)       — Section within project
└── tz                string(100)       — IANA timezone (e.g. "America/New_York")
```

### 1.2 Duration & Priority

```
DURATION & PRIORITY
├── dur               int(5-480)        — Duration in minutes (default: 30)
├── time_remaining    int|null          — Override dur for WIP tasks (effective dur)
├── pri               enum{P1,P2,P3,P4} — Priority tier (default: P3)
│   └── rank: P1=100, P2=80, P3=50, P4=20
└── marker            boolean           — Non-blocking calendar marker (dur=0, no grid)
```

### 1.3 Placement Mode (Mutually Exclusive — 6 values)

```
PLACEMENT_MODE ──── The core scheduling intent. Exactly one per task.
│
├── anytime          — No date/time constraint. Scheduler picks best slot by priority.
│   ├── Requires: nothing
│   ├── Occupies grid: YES
│   ├── Scheduler can move: YES
│   └── UI shows: duration, split, deadline, start-after
│
├── time_window      — Preferred time ± flex window
│   ├── Requires: preferred_time_mins (minutes from midnight)
│   ├── Optional: time_flex (0-480 min, default 60)
│   ├── Occupies grid: YES
│   ├── Scheduler can move: within [preferred - flex, preferred + flex]
│   └── UI shows: time input, flex slider, duration, split, deadline, start-after
│
├── time_blocks      — Constrained to specific `when`-tag blocks
│   ├── Requires: when (tag names like "morning,biz")
│   ├── Optional: flex_when (boolean — relax to anytime if blocks full)
│   ├── Occupies grid: YES
│   ├── Scheduler can move: within selected blocks
│   └── UI shows: block tags, strict/flex toggle, duration, split, deadline, start-after
│
├── fixed            — Immovable anchor at exact date+time
│   ├── Requires: date (YYYY-MM-DD) AND time (HH:MM)
│   ├── Occupies grid: YES
│   ├── Scheduler can move: NEVER
│   └── UI shows: date picker, time picker, duration (no split, no deadline, no start-after)
│
├── all_day          — Full-day banner, no time-grid presence
│   ├── Requires: date (YYYY-MM-DD)
│   ├── Occupies grid: NO (banner only)
│   ├── Scheduler can move: day can float if not pinned
│   └── UI shows: date picker, deadline, start-after (no time, no duration, no split)
│
└── reminder         — Zero-duration marker, no grid occupancy
    ├── Requires: nothing
    ├── Occupies grid: NO (dur=0)
    ├── Scheduler can move: YES — earliest eligible slot
    └── UI shows: nothing (scheduling controls hidden)
```

### 1.4 Scheduling Constraints

```
SCHEDULING CONSTRAINTS
│
├── deadline (due_at)         — Hard upper bound (YYYY-MM-DD)
│   ├── Caps latestIdx in scheduler search
│   ├── Drives slack computation: slack = capacity(earliest..deadline) - dur
│   ├── No deadline → slack = Infinity (sorts after all constrained items)
│   └── Past-due tasks get P1 boost + slack=0
│
├── start_after_at            — Earliest allowable start date (YYYY-MM-DD)
│   ├── Hard lower bound — scheduler starts search at this date
│   ├── Affects slack: shifts earliestIdx forward
│   └── Recurring instances auto-set to occurrence date
│
├── day_req                   — Day-of-week eligibility
│   ├── "any" (default) — all days
│   ├── "weekday" — Mon-Fri
│   ├── "weekend" — Sat-Sun
│   └── Comma-separated codes: M,T,W,R,F,Sa,Su
│
├── when                      — Time-block tag names (comma-separated)
│   ├── "" or "anytime" — all blocks
│   ├── "morning", "biz", "lunch", "afternoon", "evening", "night"
│   └── Custom user-defined tags
│
├── flex_when                 — Boolean: relax when to anytime if blocks full
│   ├── false (strict) — unplaced if blocks full
│   └── true (flex) — retry with when=anytime
│
├── preferred_time_mins       — Minutes from midnight for time_window mode
│   └── Range: 0-1440 (GRID_START=360 to GRID_END=1380 effective)
│
├── time_flex                 — ± minutes around preferred time (0-480)
│   └── Default: 60 when preferred_time_mins set but flex null
│
├── location                  — Array of location IDs (e.g. ["home","work"])
│   └── AND logic with tools — both must pass
│
├── tools                     — Array of tool IDs (e.g. ["phone","laptop"])
│   └── AND logic with location
│
├── travel_before             — Minutes buffer before task (0-120)
├── travel_after              — Minutes buffer after task (0-120)
│
└── depends_on                — Array of task_master IDs (dependencies)
    └── Chain deadline backpropagation (consumer's deadline → predecessor faux deadline)
```

### 1.5 Weather Constraints

```
WEATHER CONSTRAINTS
├── weather_precip            — Precipitation tolerance
│   ├── "any" (default) — no constraint
│   ├── "wet_ok" — any precipitation OK
│   ├── "light_ok" — precip ≤ 50%
│   └── "dry_only" — precip ≤ 20%
│
├── weather_cloud             — Cloud cover tolerance
│   ├── "any" (default)
│   ├── "overcast_ok" — any cloud OK
│   ├── "partly_ok" — cover ≤ 60%
│   └── "clear" — cover ≤ 25%
│
├── weather_temp_min          — Minimum temperature (-60..150, nullable)
├── weather_temp_max          — Maximum temperature (-60..150, nullable)
├── weather_temp_unit         — "F" or "C" (default: F)
├── weather_humidity_min      — Minimum humidity % (0-100, nullable)
└── weather_humidity_max      — Maximum humidity % (0-100, nullable)
```

### 1.6 Recurrence

```
RECURRENCE (recur JSON object)
│
├── type                      — Recurrence pattern
│   ├── "none" — no recurrence
│   ├── "daily" — every day
│   ├── "weekly" — specific days of week
│   │   └── days: "MTWRF" (day codes)
│   ├── "biweekly" — every 2 weeks on specific days
│   │   └── days: "MWF"
│   ├── "monthly" — specific days of month
│   │   └── monthDays: [1,15] or ["first","last"]
│   ├── "interval" — every N units
│   │   ├── every: positive integer
│   │   └── unit: "days"|"weeks"|"months"
│   └── "rolling" — arithmetic projection from rollingAnchor
│       ├── every: positive integer
│       └── unit: "days"|"weeks"|"months"
│
├── recurring (boolean)       — Is this a recurring template?
├── recur_start               — First occurrence date (YYYY-MM-DD)
├── recur_end                 — Last occurrence date (YYYY-MM-DD, nullable)
│
├── timesPerCycle (TPC)       — Overlay: N occurrences per cycle
│   ├── isFlexibleTpc         — Boolean: can roam within cycle (not day-locked)
│   ├── fillPolicy            — "keep" (default) or "backfill"
│   └── spacing guard: minGap = max(1, floor(cycleDays * 0.5))
│
└── rollingAnchor             — Rolling recurrence anchor (on task_masters)
    ├── Updated on: done → instanceDate, skip → instanceDate
    ├── Not updated on: cancel → null (no change)
    └── Soft nudge on: missed → instanceDate + 1 day
```

### 1.7 Split Configuration

```
SPLIT CONFIGURATION
├── split                     — Boolean: split task across multiple time blocks
├── split_min                 — Minimum chunk duration in minutes (default: 15)
│
├── Per-instance (scheduler-set):
│   ├── split_ordinal         — Chunk number (1..N)
│   ├── split_total           — Total chunks in this occurrence
│   └── split_group           — Group ID for linked chunks
│
├── Recurring splits:
│   ├── Day-locked (rigid) or cycle-capped (flexible TPC)
│   ├── Travel: only ordinal 1 has travelBefore, last ordinal has travelAfter
│   └── Time-boxed: must complete before next recurrence interval
│
└── Non-recurring splits:
    └── Can cross day boundaries
```

### 1.8 Status & Lifecycle

```
STATUS (per instance)
├── "" (empty)       — Active, pending placement
├── "wip"            — In progress (time_remaining overrides dur)
├── "done"           — Completed (terminal)
├── "skip"           — Skipped (terminal, scheduled_at snaps to now)
├── "cancel"         — Cancelled (terminal, scheduled_at snaps to now)
├── "pause"          — Paused template (expansion skipped)
├── "missed"         — System-applied (terminal, completed_at=windowClose)
├── "archived"       — Archived (terminal)
└── "restored"       — Restored from archive

LIFECYCLE FIELDS
├── disabled_at              — When template was disabled
├── disabled_reason          — Why template was disabled
├── completed_at             — When task reached terminal status
├── scheduled_at             — When task was placed by scheduler
├── date_pinned              — User pinned the date (instance-level)
├── original_date            — Pre-pin date (for restore)
├── original_time            — Pre-pin time (for restore)
└── unscheduled              — Flag: task could not be placed
```

### 1.9 Calendar Sync (External Integration)

```
CALENDAR SYNC (via cal_sync_ledger)
├── gcal_event_id            — Google Calendar event ID
├── msft_event_id            — Microsoft Calendar event ID
├── apple_event_id           — Apple Calendar event ID
├── cal_sync_origin          — "juggler" | "gcal" | "msft" | "apple"
│
└── Sync-locked behavior:
    ├── Synced tasks locked to fixed mode
    ├── Only status, notes, and _allowUnfix can be edited
    └── takeOwnership() detaches provider link → mode becomes anytime
```

### 1.10 User Config (Global Settings Affecting All Tasks)

```
USER CONFIG (per user, affects scheduler behavior)
│
├── time_blocks              — Day-of-week block templates
│   ├── Mon..Sun → array of {id, tag, name, start, end, color, icon, loc}
│   └── Default: weekday blocks (6 blocks) / weekend blocks (4 blocks)
│
├── schedule_templates       — Named schedule templates (override time_blocks per date)
│   └── {templateId: {blocks: [{id, tag, name, start, end, color, icon, loc}]}}
│
├── loc_schedules            — Location schedule templates
│   └── {templateId: {hours: {minSlot: locationId}}}
│
├── loc_schedule_defaults    — Default location template per day name
│   └── {Mon: "work", Tue: "work", ..., Sat: "weekend", Sun: "weekend"}
│
├── loc_schedule_overrides   — Date-specific location template overrides
│   └── {"2026-06-15": "travel_day"}
│
├── template_defaults        — Default schedule template per day name
│   └── {Mon: "default", Tue: "default", ..., Sat: "weekend", Sun: "weekend"}
│
├── template_overrides       — Date-specific schedule template overrides
│   └── {"2026-06-15": "holiday"}
│
├── hour_location_overrides  — Hour-level location overrides (highest priority)
│   └── {"2026-06-15": {9: "office", 14: "gym"}}
│
├── tool_matrix              — Location → available tools
│   └── {home: ["phone","personal_pc"], work: ["phone","work_pc","printer"]}
│
├── locations                — Defined locations
│   └── [{id, name, icon, sort_order}]
│
├── tools                    — Defined tools
│   └── [{id, name, icon, sort_order}]
│
├── preferences              — User preferences
│   ├── temperatureUnit: "F"|"C"
│   ├── weekStartsOn: 0-6
│   ├── defaultDuration: 5-480
│   └── timezone: string
│
└── (no separate template_defaults/template_overrides — these are the same
     as loc_schedule_defaults / loc_schedule_overrides in the current codebase)
```

### 1.11 Template Resolution Chain — How Templates Affect Task Scheduling

Templates affect scheduling through **two independent resolution chains** that converge at the slot-eligibility check. Every task's placement is filtered through both chains simultaneously.

#### Chain A: Time Block Resolution (what blocks exist on a given date)

```
getBlocksForDate(dateStr, blocksMap, cfg)
│
├── 1. cfg.locScheduleOverrides[dateStr] exists?
│   └── YES → lookup cfg.scheduleTemplates[templateId].blocks
│       └── Found → use those blocks
│       └── Not found → fall through
│
├── 2. Day-of-week lookup
│   └── blocksMap[dayName] (e.g. blocksMap['Mon'])
│       └── Found → use those blocks
│       └── Not found → []
│
└── 3. Default fallback
    └── blocksMap.Mon || []
```

**Impact on task settings:**
- The blocks returned determine which `when`-tag windows exist for that date
- A "holiday" template with no blocks → all tasks with explicit `when`-tags get zero windows → unplaced
- A "travel day" template with different block hours → `when`-tag windows shift
- The `loc` field on each block feeds into location resolution (Chain B, step 5)

#### Chain B: Location Resolution (where the user is at a given minute)

```
resolveLocationId(dateStr, hourOrMin, cfg, blocks)
│
├── 1. hourLocationOverrides[dateStr][hour]?
│   └── YES → return that location (highest priority)
│
├── 2. locScheduleOverrides[dateStr]?
│   └── YES → templateId = that override
│
├── 3. locScheduleDefaults[dayName]?
│   └── YES → templateId = that default
│
├── 4. Template hours lookup
│   └── cfg.locSchedules[templateId].hours[minSlot]?
│       └── YES → return that location
│   └── cfg.locSchedules[templateId].hours[hour]?
│       └── YES → return that location
│
├── 5. Block's loc field (fallback)
│   └── getBlockAtMinute(blocks, minute).loc?
│       └── YES → return that location
│
└── 6. Default: "home"
```

**Impact on task settings:**
- The resolved location determines whether a task's `location: ["work"]` constraint passes
- The resolved location determines which `toolMatrix` entry is checked for `tools: ["laptop"]`
- A "remote day" template with `hours: {0: "home", ..., 1440: "home"}` → all location constraints resolve to "home"
- An "office day" template with `hours: {480: "work", ..., 1020: "work"}` → location constraints resolve to "work" during biz hours

#### Combined Effect — Slot Eligibility

```
For a given (date, minute) slot, a task is eligible when ALL pass:
│
├── 1. Time blocks exist for this date (Chain A)
├── 2. Task's when-tag matches at least one window from those blocks
├── 3. Resolved location (Chain B) is in task's location array (or location is empty)
├── 4. Resolved location's toolMatrix entry contains all task's required tools
├── 5. Weather constraints pass (if set)
└── 6. Day-of-week constraint passes (day_req)
```

#### Template × Task Setting Interaction Matrix

| Template Change | Affects Task Setting | Effect on Placement |
|----------------|---------------------|-------------------|
| `scheduleTemplates` block hours change | `when`-tag windows | Task may gain/lose eligible slots |
| `scheduleTemplates` block tags change | `when`-tag matching | Task's tag may no longer match any block |
| `scheduleTemplates` block removed | All `when`-tag tasks | No windows → unplaced |
| `locScheduleOverrides` date override | `location`, `tools` | Task may become eligible/ineligible at specific hours |
| `locScheduleDefaults` day default | `location`, `tools` | Same, but for all un-overridden dates |
| `locSchedules` template hours | `location`, `tools` | Location at each hour shifts |
| `hourLocationOverrides` | `location`, `tools` | Overrides everything for that hour |
| `toolMatrix` entry | `tools` | Task may lose required tool at a location |
| `time_blocks` day-of-week blocks | `when`-tag windows | Baseline block availability |

---

## 2. SETTING COMBINATION TREE

This tree shows which settings are **available together** and which combinations are **invalid**.

### 2.1 Mode × Recurrence Matrix

```
                    │ one-off  │ recurring
────────────────────┼──────────┼──────────
anytime             │ ✓        │ ✓ (day-locked to occ date)
time_window         │ ✓        │ ✓ (day-locked + flex window)
time_blocks         │ ✓        │ ✓ (day-locked + block-constrained)
fixed               │ ✓        │ ✗ (UI blocks, no server enforcement — GAP)
all_day             │ ✓        │ ✓ (day-locked banner)
reminder            │ ✓        │ ✓ (dur=0, day-locked)
```

### 2.2 Mode × Feature Availability

```
                    │ anytime │ time_win │ time_blk │ fixed │ all_day │ reminder
────────────────────┼─────────┼──────────┼──────────┼───────┼─────────┼─────────
Time input          │ —       │ ✓        │ —        │ ✓     │ —       │ —
± Flex window       │ —       │ ✓        │ —        │ —     │ —       │ —
Block tags (when)   │ —       │ —        │ ✓        │ —     │ —       │ —
Strict/Flex toggle  │ —       │ —        │ ✓        │ —     │ —       │ —
Duration            │ ✓       │ ✓        │ ✓        │ ✓     │ —       │ —
Split               │ ✓       │ ✓        │ ✓        │ —     │ —       │ —
Deadline            │ ✓       │ ✓        │ ✓        │ —     │ ✓       │ —
Start-after         │ ✓       │ ✓        │ ✓        │ —     │ ✓       │ —
Weather             │ ✓       │ ✓        │ ✓        │ ✓     │ ✓       │ —
Location/Tools      │ ✓       │ ✓        │ ✓        │ ✓     │ ✓       │ —
Travel              │ ✓       │ ✓        │ ✓        │ ✓     │ —       │ —
Dependencies        │ ✓       │ ✓        │ ✓        │ ✓     │ ✓       │ —
```

### 2.3 Recurring × Feature Availability

```
                    │ one-off  │ recurring
────────────────────┼──────────┼──────────
Deadline            │ ✓        │ ✗ (auto-generated brackets)
Start-after         │ ✓        │ ✗ (auto-set to occ date)
Date-pinned         │ ✓        │ ✗ (day-locked by occ date)
Split               │ ✓        │ ✓ (time-boxed)
Dependencies        │ ✓        │ ✗ (backend rejects)
Fixed mode          │ ✓        │ ✗ (UI blocks)
```

### 2.4 Invalid Combinations (Enforced)

```
INVALID COMBINATIONS
├── fixed + recurring              — UI blocks, no server enforcement (GAP O7)
├── fixed without date+time        — Backend 400
├── all_day with time set          — Backend clears time
├── time_window with preferred_time outside GRID_START..GRID_END — Silent fallback (GAP)
├── reminder + scheduling controls — UI hides all scheduling
├── split=true + marker=true       — UI hides split controls
├── recurring=true + dependsOn     — Backend 400
├── startAfter > deadline          — Silent unplaced (GAP O2)
├── calendar-synced + mode change  — guardFixedCalendarWhen blocks
└── recurring + fixed              — UI blocks (no server enforcement)
```

### 2.5 Weather × Mode Compatibility

```
All modes support weather constraints. Weather is a hard constraint:
- Same tier as when-tags, location, and tools
- Missing data → fail-open (BUG: should be fail-closed per R38.1)
- Weather API down → fail-open (degraded mode)
```

---

## 3. TESTING SCENARIOS — FULL VALIDATION

### 3.1 Placement Mode Tests (6 modes × each variant)

#### 3.1.1 Anytime Mode
```
TS-01  Anytime task placed in earliest available slot
TS-02  Anytime task with deadline — placed before deadline
TS-03  Anytime task with start-after — placed on or after start-after
TS-04  Anytime task with both deadline + start-after — placed in window
TS-05  Anytime task with startAfter > deadline — unplaced (impossible window)
TS-06  Anytime task with day_req=weekday — only placed Mon-Fri
TS-07  Anytime task with day_req=weekend — only placed Sat-Sun
TS-08  Anytime task with specific day codes — only placed on those days
TS-09  Anytime task with when=morning — only placed in morning blocks
TS-10  Anytime task with when=morning,afternoon — placed in either
TS-11  Anytime task with flex_when=true — relaxes to anytime when blocks full
TS-12  Anytime task with flex_when=false — unplaced when blocks full
TS-13  Anytime recurring — day-locked to occurrence date
TS-14  Anytime recurring, past occurrence — placed today at latest slot
TS-15  Anytime with location constraint — only placed at matching location blocks
TS-16  Anytime with tool constraint — only placed at blocks with matching tools
TS-17  Anytime with both location+tool — AND logic
TS-18  Anytime with travel_before — buffer respected before placement
TS-19  Anytime with travel_after — buffer respected after placement
TS-20  Anytime with depends_on — placed after dependency
TS-21  Anytime with unmet dependency — deferred to retry pass
TS-22  Anytime with deadline + unmet deps — deadline-relaxed pass (Phase 7)
```

#### 3.1.2 Time Window Mode
```
TS-23  Time window task placed at preferred time
TS-24  Time window task placed at preferred - flex (left edge)
TS-25  Time window task placed at preferred + flex (right edge)
TS-26  Time window task with flex=0 — behaves as fixed (rigid)
TS-27  Time window task with flex=480 — wide window
TS-28  Time window task with preferred_time outside GRID_START..GRID_END — fallback
TS-29  Time window recurring — day-locked + flex window respected
TS-30  Time window recurring, flex window entirely past — missed (dual-place + overdue)
TS-31  Time window with deadline — window constrained by deadline
TS-32  Time window with start-after — window constrained by start-after
TS-33  Time window with both — intersection of all constraints
TS-34  Time window + flexWhen — flexWhen ignored (time_window has own flex)
```

#### 3.1.3 Time Blocks Mode
```
TS-35  Time blocks task placed within selected when-tag blocks
TS-36  Time blocks with flex_when=true — relaxes to anytime when blocks full
TS-37  Time blocks with flex_when=false — unplaced when blocks full
TS-38  Time blocks recurring — day-locked + block-constrained
TS-39  Time blocks with multiple tags — placed in any matching block
TS-40  Time blocks with custom user-defined tags
TS-41  Time blocks with strict mode — never leaves block constraints
```

#### 3.1.4 Fixed Mode
```
TS-42  Fixed task placed at exact date+time — never moved
TS-43  Fixed task created without date — 400 error
TS-44  Fixed task created without time — 400 error
TS-45  Fixed task survives scheduler reset — never reset
TS-46  Fixed recurring — UI blocks (verify 400 if API bypasses)
TS-47  Fixed task with deadline — deadline ignored (fixed is exempt)
TS-48  Fixed task with start-after — start-after ignored
TS-49  Fixed task with split — split not available
TS-50  Drag-to-fixed transition — PATCH placementMode=fixed
TS-51  Fixed → any other mode — task re-enters scheduler queue
```

#### 3.1.5 All Day Mode
```
TS-52  All day task — banner only, no grid occupancy
TS-53  All day task with time set — backend clears time
TS-54  All day recurring — day-locked banner on occurrence date
TS-55  All day with deadline — deadline respected
TS-56  All day with start-after — start-after respected
TS-57  All day with duration — duration ignored (no grid)
```

#### 3.1.6 Reminder Mode
```
TS-58  Reminder — dur=0, no grid occupancy
TS-59  Reminder — scheduling controls hidden in UI
TS-60  Reminder recurring — day-locked, dur=0
TS-61  Reminder — placed at earliest eligible slot
```

### 3.2 Mode Transition Tests

```
TS-62  anytime → fixed: requires date+time, task becomes immovable
TS-63  fixed → anytime: task re-enters scheduler queue
TS-64  anytime → time_window: requires preferred_time_mins
TS-65  time_window → time_blocks: window replaced by block tags
TS-66  time_blocks → anytime: block constraints removed
TS-67  anytime → all_day: time/duration/split/travel cleared
TS-68  anytime → reminder: dur=0, scheduling controls hidden
TS-69  Calendar-synced → mode change: blocked by guardFixedCalendarWhen
TS-70  Calendar-synced → takeOwnership → mode change: allowed
TS-71  Drag-to-fixed: PATCH placementMode=fixed, date, time
```

### 3.3 Recurrence Tests

#### 3.3.1 Recurrence Types
```
TS-72  Daily recurrence — instances generated every day for 14 days
TS-73  Weekly recurrence — instances on specified days (e.g. MWF)
TS-74  Biweekly recurrence — instances every 2 weeks, parity-dependent
TS-75  Monthly recurrence — instances on specified month days
TS-76  Interval recurrence (every N days) — arithmetic projection
TS-77  Interval recurrence (every N weeks) — weekly arithmetic
TS-78  Rolling recurrence — arithmetic from rollingAnchor
TS-79  Recurrence with recurEnd — no instances past end date
TS-80  Recurrence with recurStart — instances start from this date
TS-81  Paused template — expansion skipped
TS-82  Disabled template — expansion skipped
TS-83  Horizon limit (14 days) — instances only generated within horizon
TS-84  Grandfather clause — pending instances beyond horizon NOT deleted
```

#### 3.3.2 Times Per Cycle (TPC)
```
TS-85  TPC with keep fill policy — skip doesn't open slot
TS-86  TPC with backfill fill policy — skip opens slot
TS-87  TPC spacing guard — minGap respected
TS-88  TPC spacing guard safety valve — ignored when blocking all placements
TS-89  TPC flexible (isFlexibleTpc=true) — can roam within cycle
TS-90  TPC non-flexible — day-locked to occurrence date
TS-91  TPC target-interval steering — picks closest to lastPlaced + targetInterval
TS-92  TPC with done status — counts toward spacing history
TS-93  TPC with skip/cancel — does NOT block spacing
```

#### 3.3.3 Rolling Recurrence
```
TS-94  Rolling anchor updated on done — re-anchored to instanceDate
TS-95  Rolling anchor updated on skip — re-anchored to instanceDate
TS-96  Rolling anchor NOT updated on cancel — null (no change)
TS-97  Rolling anchor soft nudge on missed — instanceDate + 1 day
TS-98  Rolling backfill from history — latest done date
TS-99  Rolling on-demand materialization — rc_-prefixed IDs
TS-100 Rolling stale guard — instanceDate < currentAnchor returns null
```

#### 3.3.4 Recurring Instance Lifecycle
```
TS-101 Recurring instance done — terminal, completed_at=now, rolling anchor updated
TS-102 Recurring instance skip — terminal, scheduled_at snaps to now
TS-103 Recurring instance cancel — terminal, rolling anchor NOT updated
TS-104 Recurring instance missed — system-set, completed_at=windowClose
TS-105 Recurring instance delete — soft-skipped (status=skip)
TS-106 Recurring template delete — pending→hard delete, done/cancel/skip→archived
TS-107 Missed detection via scheduler (TIME_WINDOW flex window past)
TS-108 Missed detection via scheduler (non-TIME_WINDOW preferred time past)
TS-109 Missed detection via runSchedule Phase 9
TS-110 Missed detection via cal-history-cron (24h window)
```

### 3.4 Split Task Tests

#### 3.4.1 Non-Recurring Splits
```
TS-111 Split task — chunks created inline across available windows
TS-112 Split task with split_min — chunks respect minimum
TS-113 Split task — no runt chunks (remainder merged)
TS-114 Split task — can cross day boundaries
TS-115 Split task — travel_before only on ordinal 1
TS-116 Split task — travel_after only on last ordinal
TS-117 Split task — partial_split when insufficient windows
TS-118 Split task with deadline — chunks bounded by deadline
TS-119 Split task with start-after — chunks bounded by start-after
```

#### 3.4.2 Recurring Splits
```
TS-120 Recurring split — chunks pre-materialized as DB rows
TS-121 Recurring split — day-locked (rigid) — same day only
TS-122 Recurring split — cycle-capped (flexible TPC) — within cycle
TS-123 Recurring split — time-boxed to recurrence interval
TS-124 Recurring split — recurring_split_overflow when chunks don't fit
TS-125 Recurring split — drift fix at scheduler start
TS-126 Split + status change — done is CHUNK-ONLY (completes only the tapped chunk, one-time AND recurring; 999.1220 ruling 2026-07-06); non-done statuses (skip/cancel) propagate to all chunks in occurrence_ordinal; merged card shows progress ("1/3 done") and a done tap targets the next incomplete chunk
```

#### 3.4.3 Split × Placement Mode Interaction

```
TS-126a Split + anytime — chunks placed in best available slots across days
TS-126b Split + time_window — chunks constrained to preferred time ± flex window
TS-126c Split + time_blocks — chunks constrained to selected when-tag blocks
TS-126d Split + fixed — split not available (UI hides)
TS-126e Split + all_day — split not available (no grid)
TS-126f Split + reminder — split not available (dur=0)
TS-126g Split + time_window + flex=0 — behaves as rigid, all chunks at same time
TS-126h Split + time_blocks + flex_when=true — chunks relax to anytime when blocks full
TS-126i Split + time_blocks + flex_when=false — unplaced when blocks full
```

#### 3.4.4 Split × Template Interaction

```
TS-126j Split task in default blocks — chunks distributed across available windows
TS-126k Template change (blocks removed) → some chunks lose their slots → partial_split
TS-126l Template change (blocks added) → previously partial_split chunks become placeable
TS-126m Template change (block hours shift) → chunks re-distributed to new windows
TS-126n Holiday template (no blocks) → all chunks unplaced
TS-126o Template with single short block → split chunks may not all fit → partial_split
TS-126p Template with many short blocks → chunks distributed across them
```

#### 3.4.5 Split × Location/Template Interaction

```
TS-126q Split task with location=["work"] → chunks only placed during work-location blocks
TS-126r locScheduleOverrides (remote day) → chunks shift to home-location blocks
TS-126s hourLocationOverrides shifts one chunk's location but not another → asymmetric
TS-126t Tool matrix change removes required tool → some chunks become unplaced
TS-126u Split chunks at different locations → each chunk independently validated
```

#### 3.4.6 Split × Weather Interaction

```
TS-126v Split task with weather constraint → each chunk independently weather-checked
TS-126w Weather changes between chunks (morning dry, afternoon rain) → some chunks pass, some fail
TS-126x Weather data missing → fail-open (BUG) → chunks placed in unsuitable weather
TS-126y Weather refresh → some chunks re-placed to different slots
```

#### 3.4.7 Split × Travel Buffer Interaction

```
TS-126z Split task with travel_before=15 → only ordinal 1 has the buffer
TS-126aa Split task with travel_after=15 → only last ordinal has the buffer
TS-126ab Split task with both travel_before + travel_after → ordinal 1 has before, last has after
TS-126ac Split chunks on same day → travel between chunks respected
TS-126ad Split chunks on different days → no inter-chunk travel (different days)
TS-126ae Split + travel + location change → travel time between locations respected
```

#### 3.4.8 Split × Status Change Edge Cases

```
TS-126af Mark one chunk done → ONLY that chunk done; siblings untouched (chunk-only, 999.1220 ruling 2026-07-06 — one-time AND recurring; undo of a done chunk is equally chunk-only)
TS-126ag Mark one chunk skip → all chunks in same occurrence_ordinal get skip
TS-126ah Mark one chunk cancel → all chunks in same occurrence_ordinal get cancel
TS-126ai Mixed statuses across different occurrence_ordinals → independent
TS-126aj Split chunk with time_remaining → overrides dur for that chunk only
TS-126ak Split chunk marked wip → time_remaining starts counting down
TS-126al Split chunk marked done before all chunks placed → remaining chunks still placed
```

#### 3.4.9 Split × Recurring × Template Interaction

```
TS-126bm Recurring split + template change → time-box window shifts → chunks re-evaluated
TS-126bn Recurring split + holiday template → all chunks for that occurrence unplaced
TS-126bo Recurring split + location template change → chunks shift locations across occurrences
TS-126bp Recurring split + tool matrix change → some occurrences' chunks become unplaced
TS-126bq Recurring split + weather change → different occurrences affected differently
TS-126br Recurring split + time advance → crossing recurrence boundary → overflow detection
```

### 3.5 Deadline Tests

```
TS-127 Deadline as hard upper bound — task placed before deadline
TS-128 No deadline — slack=Infinity, sorts after all constrained items
TS-129 Past-due task — P1 boost + slack=0, placed at today's earliest slot
TS-130 ignoreDeadline (overdue ladder pass 2) — removes ceiling
TS-131 Fixed task exempt from overdue marking
TS-132 Deadline drives slack computation
TS-133 Chain deadline backpropagation — predecessor inherits consumer's deadline
TS-134 Recurring instance auto-deadline brackets (daily=same day, weekly=+6d, etc.)
TS-135 deadlineMisses array — dead code (verify empty)
```

#### 3.5.1 Deadline × Template Interaction

```
TS-135a Deadline + template change (blocks removed) → available capacity shrinks → deadline may be missed
TS-135b Deadline + template change (blocks added) → capacity increases → previously missed task fits
TS-135c Deadline + holiday template (no blocks) → zero capacity → task unplaced
TS-135d Deadline + template location change → travel time changes → effective deadline window shifts
TS-135e Deadline + locScheduleOverrides (remote day) → location + tool constraints change → deadline window shifts
TS-135f Deadline + hourLocationOverrides → location shifts at specific hours → deadline window fragments
```

#### 3.5.2 Deadline × Split Interaction

```
TS-135g Split task with deadline — all chunks must finish before deadline
TS-135h Split task with tight deadline → partial_split (insufficient window for all chunks)
TS-135i Split task with deadline on boundary → last chunk placed right at deadline edge
TS-135j Recurring split + auto-deadline bracket → time-box and deadline interact
```

#### 3.5.3 Deadline × Dependency Interaction (expanded)

```
TS-135k Chain of 3 tasks with deadlines — each deadline backpropagated correctly
TS-135l Predecessor misses its deadline → dependent's faux deadline also expired → deadline-relaxed pass
TS-135m Dependent has earlier deadline than predecessor → backpropagation adjusts predecessor window
TS-135n Mixed: some chain members have deadlines, some don't → slack computation varies
TS-135o Split predecessor with deadline → chunks must finish before deadline affects dependent's window
```

#### 3.5.4 Deadline × Weather Interaction

```
TS-135p Deadline + weather constraint → task must find slot within deadline AND pass weather check
TS-135q Weather data missing + deadline approaching → fail-open places task but may be unsuitable
TS-135r Weather API down + deadline imminent → fail-open, task placed weather-blind before deadline expires
TS-135s Weather refresh shrinks eligible slots → deadline may become impossible to meet
```

#### 3.5.5 Deadline × Time-Travel / Clock

```
TS-135t Task with deadline T+1 → clock advances past T+1 → detected as overdue on next scheduler run
TS-135u Task with deadline T+7 → clock advances day by day → slack decreases each day
TS-135v Task with deadline already past at creation → immediate P1 boost + slack=0
TS-135w Clock crosses midnight → todayKey changes → all deadline comparisons shift
TS-135x Deadline on a weekend → day_req=weekday task must find slot before deadline on weekday only
```

### 3.6 Earliest-Start Tests

```
TS-136 start_after as hard lower bound — task placed on or after date
TS-137 start_after affects slack — reduces available capacity
TS-138 Recurring instance auto-set start_after — occurrence date
TS-139 Split chunk respects start_after
TS-140 start_after > deadline — silent unplaced (impossible window)
TS-141 start_after validation on create/update — 400 when > deadline
```

#### 3.6.1 Earliest-Start × Template Interaction

```
TS-141a start_after + template change (blocks removed before start) → unaffected (blocks after start)
TS-141b start_after + template change (blocks removed after start) → reduced capacity after start date
TS-141c start_after + holiday template on start date → no blocks on day task becomes eligible → unplaced
TS-141d start_after + location template → location availability may differ before vs after start date
TS-141e start_after + locScheduleOverrides → location at start date may be incompatible
TS-141f start_after + hourLocationOverrides → location shifts on first eligible day
```

#### 3.6.2 Earliest-Start × Split Interaction

```
TS-141g Split task with start_after — first chunk can only start on or after start date
TS-141h Split task with start_after far in future → chunks placed after start date can cross days
TS-141i Split task with start_after + deadline (valid window) → chunks bounded by both
```

#### 3.6.3 Earliest-Start × Deadline Interaction (cross-field)

```
TS-141j start_after and deadline both set (valid) → task placed within [start_after, deadline]
TS-141k start_after = deadline → task must be placed on exactly that day (single-day window)
TS-141l start_after > deadline → validation error on create (400)
TS-141m start_after > deadline in legacy data → silent unplaced with _unplacedReason='impossible_window'
TS-141n start_after + deadline + template change → window shifts with block availability
```

#### 3.6.4 Earliest-Start × Time-Travel

```
TS-141o start_after = tomorrow → clock advances → task becomes eligible
TS-141p start_after = today → placed immediately on scheduler run
TS-141q start_after in the past → equivalent to no start_after constraint
```

### 3.7 Weather Constraint Tests

```
TS-142 weather_precip=dry_only — only placed when precip ≤ 20%
TS-143 weather_precip=light_ok — only placed when precip ≤ 50%
TS-144 weather_precip=wet_ok — any precip OK
TS-145 weather_cloud=clear — only placed when cloud cover ≤ 25%
TS-146 weather_cloud=partly_ok — only placed when cloud cover ≤ 60%
TS-147 weather_temp_min/max — temperature range respected
TS-148 weather_humidity_min/max — humidity range respected
TS-149 Weather as hard constraint — same tier as when/location/tools
TS-150 Missing weather data — fail-open (BUG: should be fail-closed)
TS-151 Weather API down — fail-open (degraded mode)
TS-152 No weather constraints — short-circuit (zero overhead)
TS-153 Weather cache refresh → reschedule trigger
TS-154 hasWeatherConstraint parity — duplicated in runSchedule + unifiedScheduleV2
```

#### 3.7.1 Weather × Template Interaction

```
TS-154a Weather + template location change → task moves to different location → different weather data used
TS-154b Weather + locScheduleOverrides (remote day) → location is "home" → home weather checked
TS-154c Weather + hourLocationOverrides → location shifts by hour → different weather per hour
TS-154d Weather + tool matrix change → task requires specific tool at location → weather only checked if location valid
TS-154e Template with no blocks → task unplaced, weather irrelevant
```

#### 3.7.2 Weather × Split Interaction

```
TS-154f Split task with weather constraint → each chunk independently weather-checked (TS-126v, expanded here)
TS-154g Weather changes across split chunks (morning dry, afternoon rain) → some chunks pass, some fail
TS-154h Split chunk placed at time with failing weather → chunk re-placed to earlier/later window
TS-154i Weather refresh between split chunk placements → re-evaluation may shift chunks
```

#### 3.7.3 Weather × Dependency Interaction

```
TS-154j Predecessor has weather constraint → placed in weather-OK slot → dependent placed after it
TS-154k Predecessor weather-fails → unplaced → dependent deferred
TS-154l Weather data missing for predecessor but present for dependent → asymmetric fail-open
TS-154m Weather change moves predecessor → dependent's window shifts
```

#### 3.7.4 Weather × Recurrence Interaction

```
TS-154n Recurring task with weather constraint → each instance independently weather-checked
TS-154o Same recurring instance on different days → different weather → different eligibility
TS-154p Weather differs within a recurring cycle → TPC instances may be placed on different days with different weather
TS-154q Weather changes day-to-day → recurring occurrences shift across days
TS-154r Weather data available for some occurrence dates but not others → mixed fail-open/fail-closed
```

#### 3.7.5 Weather × Time-Travel / Clock

```
TS-154s Weather forecast deteriorates as time advances → previously valid slot becomes invalid
TS-154t Weather forecast improves as time advances → previously invalid slot becomes valid
TS-154u Clock advances past weather forecast horizon → forecast data expires → fail-open
TS-154v Weather cache refresh at T+1h → new data differs → task re-evaluated
TS-154w Weather at T=0 (morning) dry → task placed → weather at T+4h (afternoon) rainy → next occurrence affected
TS-154x Simulate different seasons (summer vs winter) → temperature constraints behave differently
```

### 3.8 Dependency Tests

```
TS-155 Task A depends on Task B — A placed after B
TS-156 Chain of 3+ tasks — order respected
TS-157 Unmet dependency — deferred to retry pass
TS-158 Circular dependency — rejected on create/update
TS-159 Dependency on recurring template — rejected (400)
TS-160 Chain deadline backpropagation — predecessor gets faux deadline
TS-161 Dependency + deadline — deadline-relaxed pass (Phase 7)
TS-162 Dependency removed — task re-evaluated independently
```

### 3.8a Dependency × Template Interaction Tests

These tests cover the **combinatorial interaction** between dependencies and user-config templates. Each test exercises a path where a template change cascades through the dependency chain.

#### 3.8a.1 Template Change → Dependency Satisfaction

```
TS-162a Predecessor task placed in default blocks → dependent placed after it
TS-162b Template change (holiday, no blocks) → predecessor unplaced → dependent also unplaced (unmet dep)
TS-162c Template change (blocks restored) → predecessor placed → dependent also placed on next scheduler run
TS-162d Template change shifts predecessor's slot → dependent's available window shifts
TS-162e Template change removes predecessor's slot entirely → predecessor unplaced → dependent deferred to retry pass
```

#### 3.8a.2 Location Template × Dependency

```
TS-162f Predecessor at location A, dependent at location B → travel buffer between them
TS-162g locScheduleOverrides changes predecessor's location → travel buffer changes
TS-162h locScheduleOverrides changes dependent's location → travel buffer changes
TS-162i hourLocationOverrides shifts one task but not the other → asymmetric location change
TS-162j Template change makes predecessor's location incompatible with dependent's tools → dependent unplaced
```

#### 3.8a.3 Template × Dependency × Recurrence

```
TS-162k Non-recurring task depends on recurring instance → template change affects recurring placement → cascade
TS-162l Recurring instance's placement shifts due to template change → dependent's window shifts
TS-162m Template change on a day where recurring instance exists → instance re-placed → dependent re-evaluated
```

#### 3.8a.4 Template × Dependency × Deadline

```
TS-162n Predecessor has deadline, dependent has deadline → template change affects predecessor's slack → faux deadline shifts
TS-162o Template change makes predecessor miss its deadline → dependent's faux deadline also missed
TS-162p Chain deadline backpropagation + template location change → predecessor's effective deadline window shrinks
```

#### 3.8a.5 Template × Dependency × Split

```
TS-162q Split task depends on another task → template change affects predecessor placement → split chunks shift
TS-162r Split task is the predecessor → template change affects split chunk placement → dependent's window shifts
TS-162s Recurring split as dependency target → template change affects time-box → dependent affected
```

#### 3.8a.6 Template × Dependency × Weather

```
TS-162t Predecessor has weather constraint + template location change → weather data for new location may differ
TS-162u Weather API down + template change → predecessor fail-open → dependent placed after potentially unsuitable slot
```

#### 3.8a.7 Template × Dependency × Mode Transitions

```
TS-162v Predecessor is fixed (immovable) + template changes → dependent unaffected (fixed is exempt)
TS-162w Predecessor is time_window + template changes flex window → dependent's window shifts
TS-162x Predecessor is time_blocks + template removes matching blocks → predecessor unplaced → dependent deferred
TS-162y Predecessor mode changes (fixed → anytime) → re-enters scheduler → dependent re-evaluated
```

### 3.9 Scheduler Phase Tests

```
TS-163 Phase 0 (Immovables) — fixed tasks placed at exact time
TS-164 Phase 1 (Queue) — slack-sorted placement
TS-165 Phase 2 (Retry) — deferred deps retried
TS-166 Phase 3 (Missed preferred-time) — recurring non-TIME_WINDOW
TS-167 Phase 4 (Missed window) — TIME_WINDOW entirely past
TS-168 Phase 5 (Past-anchored recurring) — anchorDate < today
TS-169 Phase 6 (Rigid forced) — force-place with _conflict
TS-170 Phase 7 (Deadline relaxed) — ignore deps + deadline
TS-171 Fallback ladder pass 1 — normal placement
TS-172 Fallback ladder pass 2 — ignore deadline (slack < 0)
TS-173 Fallback ladder pass 3 — relax when (flexWhen)
TS-174 Fallback ladder pass 4 — both relaxations
TS-175 All 4 passes fail → unplaced with _unplacedReason
```

### 3.10 Reschedule Trigger Tests

```
TS-176 Create task → scheduler enqueued
TS-177 Update task (scheduling fields) → scheduler enqueued
TS-178 Update task (non-scheduling fields) → skipScheduler=true
TS-179 Delete task → scheduler enqueued
TS-180 Status change → scheduler enqueued
TS-181 Template status change → scheduler enqueued
TS-182 Re-enable task → scheduler enqueued
TS-183 Take ownership → scheduler enqueued
TS-184 Batch create → scheduler enqueued
TS-185 Config change (time_blocks, locations, etc.) → scheduler enqueued
TS-186 MCP create/update/delete → scheduler enqueued
TS-187 Calendar sync (pulled > 0) → scheduler enqueued
TS-188 Manual POST /schedule/run → scheduler runs
TS-189 Task-end nudge → scheduler runs
TS-190 Tab becomes visible → scheduler runs (within 15-min staleness)
TS-191 Periodic nudge (5-min interval) → scheduler runs
TS-192 Weather refresh SSE → scheduler runs
TS-193 Debounce (2000ms) — rapid changes coalesced
TS-194 Rate limit (10/min) — excess runs dropped
```

### 3.11 Calendar Sync Tests

```
TS-195 GCal OAuth connect/disconnect
TS-196 MSFT OAuth connect/disconnect
TS-197 Apple CalDAV connect/disconnect
TS-198 Push sync — task changes pushed to calendar
TS-199 Pull sync — calendar changes pulled to Juggler
TS-200 Sync-locked task — only status/notes editable
TS-201 takeOwnership — detaches provider, mode becomes anytime
TS-202 Sync error — fail loud
TS-203 Concurrent sync — DB contention handling
TS-204 Split task sync — known issue
TS-205 Multi-provider MISS_THRESHOLD interference
TS-206 Concurrent-sync duplicate active rows
```

### 3.12 User Config Tests

```
TS-207 Time blocks override — date-specific overrides respected
TS-208 Location schedule — day-of-week template respected
TS-209 Location override — date-specific override respected
TS-210 Hour location override — hour-level override respected
TS-211 Tool matrix — location→tool mapping respected
TS-212 Preferences — temperatureUnit, weekStartsOn, defaultDuration, timezone
TS-213 Schedule templates — named templates applied
TS-214 Config change → scheduler re-run
```

### 3.13 Template × Task Setting Interaction Tests

These tests cover the **combinatorial interaction** between user-config templates and individual task settings. Each test exercises a specific path through the resolution chains in §1.11.

#### 3.13.1 Time Block Template × Task `when`-tag

```
TS-215 Default weekday blocks + task when=morning → placed in morning block
TS-216 Holiday template (no blocks) + task when=morning → unplaced (no windows)
TS-217 Travel day template (shifted hours) + task when=morning → placed in shifted morning
TS-218 Template with custom tags + task when=custom_tag → placed in custom block
TS-219 Template with custom tags + task when=standard_tag → unplaced (tag not in template)
TS-220 Template change (blocks removed) → existing placed tasks re-evaluated on next scheduler run
TS-221 Template change (blocks added) → previously unplaced tasks become placeable
TS-222 Multiple templates across days + recurring task → different windows each day
```

#### 3.13.2 Location Template × Task `location`/`tools`

```
TS-223 locScheduleDefaults + task location=["work"] → placed during work-location hours
TS-224 locScheduleOverrides (remote day) + task location=["work"] → unplaced (location is "home" all day)
TS-225 locScheduleOverrides (office day) + task location=["home"] → unplaced during office hours
TS-226 hourLocationOverrides + task location=["gym"] → placed only during gym hour
TS-227 locSchedules template hours + task location=["office"] → placed during office hours in template
TS-228 Block loc field fallback + task location=["home"] → placed during home-location blocks
TS-229 All location resolution steps exhausted → default "home" used
TS-230 Template change (location shifts) → existing placed tasks re-evaluated
```

#### 3.13.3 Tool Matrix × Task `tools`

```
TS-231 toolMatrix[work] has "laptop" + task tools=["laptop"] → placed during work-location hours
TS-232 toolMatrix[home] missing "laptop" + task tools=["laptop"] → NOT placed during home-location hours
TS-233 toolMatrix change (tool removed) → existing placed tasks re-evaluated
TS-234 toolMatrix change (tool added) → previously unplaced tasks become placeable
TS-235 Task with both location + tools → AND logic through both chains
```

#### 3.13.4 Combined Template Interactions

```
TS-236 Holiday template (no blocks) + location override → task unplaced regardless of location
TS-237 Travel day template + location override → task placed only where both chains allow
TS-238 Template with no blocks but task when=anytime → placed in default anytime window
TS-239 Template with blocks but no loc field + task location=["work"] → falls through to default "home" → fails
TS-240 Template with blocks + loc field + toolMatrix → full chain exercised
TS-241 Config change triggers scheduler re-run → all template effects re-evaluated
TS-242 Multiple config changes in rapid succession → debounced, single scheduler run
```

#### 3.13.5 Template Edge Cases

```
TS-243 locScheduleOverrides references non-existent templateId → fall through to day-of-week blocks
TS-244 locSchedules references non-existent templateId → fall through to block loc field
TS-245 Template with overlapping blocks → deduplicated windows
TS-246 Template with zero-duration blocks → skipped (e > s check)
TS-247 Template with blocks outside GRID_START..GRID_END → clamped
TS-248 Template change while tasks are in-flight (scheduler running) → next run picks up changes
TS-249 Template with no blocks and no fallback → blocksMap.Mon || [] → empty → all tasks unplaced
TS-250 Template with blocks that have no loc field → all resolve to "home"
```

### 3.14 Edge Cases & Error Handling

```
TS-251 Task text > 500 chars — rejected
TS-252 Notes > 5000 chars — rejected
TS-253 Duration < 5 min — rejected
TS-254 Duration > 480 min — rejected
TS-255 Time flex < 0 or > 480 — rejected
TS-256 Split min > duration — rejected
TS-257 Invalid placement mode — rejected
TS-258 Invalid priority — defaulted to P3
TS-259 Invalid status — rejected
TS-260 Invalid weather_precip — rejected
TS-261 Invalid weather_cloud — rejected
TS-262 Invalid recur type — rejected
TS-263 Invalid recur unit — rejected
TS-264 Invalid day_req — rejected
TS-265 Invalid when tag (> 30 chars) — rejected
TS-266 Invalid deadline format — rejected
TS-267 Invalid start_after format — rejected
TS-268 Empty task text on create — rejected
TS-269 Null placement_mode — handled (defaults to anytime)
TS-270 Concurrent scheduler runs — rate limited
TS-271 Scheduler crash — no data corruption
TS-272 Migration rollback — data preserved
```

### 3.15 Time-Travel / Clock Control Tests

These tests require a **controllable clock** to simulate time progression:

```
TS-273 Task created today → placed today (normal flow)
TS-274 Task created yesterday (simulate time=now+1d) → overdue detection
TS-275 Task with deadline tomorrow → simulate moving past deadline → missed
TS-276 Recurring instance today → simulate next day → next instance generated
TS-277 Rolling anchor test: done today → simulate +N days → next instance at anchor+N
TS-278 Scheduler run at T=0 → simulate T+5min → nudge trigger
TS-279 Task with start_after = tomorrow → simulate crossing into tomorrow → placed
TS-280 Weather constraint: simulate different weather at different times
TS-281 Calendar sync: simulate time passing → stale cache → refresh
TS-282 14-day horizon: simulate day advancement → new instances generated
TS-283 Grandfather clause: simulate horizon shift → pending instances preserved
TS-284 Missed detection: simulate 24h after scheduled_at → cal-history-cron fires
TS-285 Recurring split time-box: simulate crossing recurrence boundary
TS-286 Debounce: rapid changes within 2000ms → coalesced
TS-287 Template change + time advance: simulate template change at T=0, then T+1d → re-evaluated
TS-288 Location template + time advance: simulate weekday→weekend transition → location shifts
```

---

## 4. TIME-TRAVEL / CLOCK CONTROL LIBRARY

### 4.1 The Problem

The scheduler is deeply time-dependent. It reads `new Date()` in dozens of places:
- `MysqlClockAdapter.now()` → `new Date()` (process wall clock)
- `MysqlClockAdapter.dbNow(db)` → `SELECT NOW(3)` (MySQL clock)
- `runSchedule.js` computes `todayKey` from current date
- `unifiedScheduleV2.js` uses `todayKey` for horizon, deadline checks, overdue detection
- `expandRecurring.js` uses today for 14-day horizon
- `cal-history-cron.js` uses 24-hour window from `scheduled_at`

To properly test overdue detection, missed detection, horizon expansion, and time-boxed splits, we need to **control what the application perceives as "now"**.

### 4.2 Current State

The `ClockPort` interface already exists in the hexagonal architecture:
- `src/slices/scheduler/domain/ports/ClockPort.js` — defines `now()` and `dbNow()`
- `src/slices/scheduler/adapters/MysqlClockAdapter.js` — production impl (wall clock + MySQL)

**However**, the legacy scheduler (`unifiedScheduleV2.js`, `runSchedule.js`) does NOT use ClockPort. It calls `new Date()` directly and reads `SELECT NOW(3)` inline. The ClockPort is only wired into the new hexagonal scheduler core, which is not yet the main execution path.

### 4.3 FakeClockAdapter — Proposed API

```javascript
// src/slices/scheduler/adapters/FakeClockAdapter.js
'use strict';

/**
 * FakeClockAdapter — controllable clock for deterministic tests.
 * Implements ClockPort. Can be advanced, set, or reset.
 */
function FakeClockAdapter(initialTime) {
  this._frozen = initialTime != null
    ? new Date(initialTime)
    : new Date();
}

FakeClockAdapter.prototype.now = function now() {
  return new Date(this._frozen);
};

FakeClockAdapter.prototype.dbNow = async function dbNow() {
  return new Date(this._frozen);
};

/** Advance the clock by `ms` milliseconds. */
FakeClockAdapter.prototype.advance = function advance(ms) {
  this._frozen = new Date(this._frozen.getTime() + ms);
};

/** Set the clock to a specific date/time. */
FakeClockAdapter.prototype.setTime = function setTime(date) {
  this._frozen = new Date(date);
};

/** Advance by N minutes (convenience). */
FakeClockAdapter.prototype.tick = function tick(minutes) {
  this.advance(minutes * 60 * 1000);
};

/** Advance by N days (convenience). */
FakeClockAdapter.prototype.skipDays = function skipDays(days) {
  this.advance(days * 24 * 60 * 60 * 1000);
};

/** Reset to real wall clock. */
FakeClockAdapter.prototype.reset = function reset() {
  this._frozen = new Date();
};

module.exports = FakeClockAdapter;
```

---

## 5. WEATHER SIMULATOR FOR TESTING

### 5.1 The Problem

Weather-constrained tasks are placed only in slots whose forecast satisfies `weather_precip`, `weather_cloud`, `weather_temp_min/max`, and `weather_humidity_min/max`. The production `SchedulerWeatherProvider` reads from the `weather_cache` table, which requires:
- A real weather API call (Open-Meteo)
- Real GPS coordinates for the user's locations
- Real time (forecast only covers ~7 days from now)

This makes weather tests: non-deterministic, time-dependent, geography-dependent, and slow.

### 5.2 Current State — Hex Arch Already Supports This

The `WeatherProviderPort` interface exists at:
`src/slices/scheduler/domain/ports/WeatherProviderPort.js`

It defines:
- `loadWeatherForHorizon(locations, db)` → `{ [dateKey]: { [hour]: { temp, precipProb, cloudcover, humidity } } }`

The production implementation is:
`src/slices/scheduler/adapters/SchedulerWeatherProvider.js`

The return shape is deterministic JSON. A fake implementation would return a predictable `weatherByDateHour` map instead of hitting the DB.

### 5.3 FakeWeatherProvider — Proposed API

```javascript
// src/slices/scheduler/adapters/FakeWeatherProvider.js
'use strict';

/**
 * FakeWeatherProvider — deterministic weather for tests.
 * Implements WeatherProviderPort. Returns a fixed or scripted weather map.
 */
function FakeWeatherProvider(weatherMap) {
  // weatherMap: { [dateKey]: { [hour]: { temp, precipProb, cloudcover, humidity } } }
  // If null/undefined, returns empty map → fail-open behavior
  this._weatherMap = weatherMap || {};
}

FakeWeatherProvider.prototype.loadWeatherForHorizon = async function loadWeatherForHorizon() {
  return this._weatherMap;
};

/**
 * Set weather for a specific (dateKey, hour).
 * @param {string} dateKey  "2026-06-15"
 * @param {number} hour     0-23
 * @param {Object} data     { temp, precipProb, cloudcover, humidity }
 */
FakeWeatherProvider.prototype.setHour = function setHour(dateKey, hour, data) {
  if (!this._weatherMap[dateKey]) this._weatherMap[dateKey] = {};
  this._weatherMap[dateKey][hour] = data;
};

/**
 * Set all hours in a date range to the same weather pattern.
 * @param {string} startDate  "2026-06-15"
 * @param {number} days       Number of days
 * @param {Function} pattern  (dateKey, hour) => { temp, precipProb, cloudcover, humidity }
 */
FakeWeatherProvider.prototype.setRange = function setRange(startDate, days, pattern) {
  var d = new Date(startDate);
  for (var i = 0; i < days; i++) {
    var dk = d.toISOString().slice(0, 10);
    for (var h = 0; h < 24; h++) {
      this.setHour(dk, h, pattern(dk, h));
    }
    d.setDate(d.getDate() + 1);
  }
};

/** Return empty map → triggers fail-open behavior in scheduler. */
FakeWeatherProvider.prototype.setEmpty = function setEmpty() {
  this._weatherMap = {};
};

/** Return null → simulates no location with coords → fail-open. */
FakeWeatherProvider.prototype.setNoData = function setNoData() {
  // loadWeatherForHorizon returns {} when no location has coords
  this._weatherMap = {};
};

module.exports = FakeWeatherProvider;
```

### 5.4 Weather Simulator — Test Patterns

```javascript
// Example 1: Fixed weather across the horizon
const weather = new FakeWeatherProvider();
weather.setRange('2026-06-15', 14, function(dk, h) {
  return {
    temp: 72,
    precipProb: h >= 14 ? 80 : 5,   // afternoon rain
    cloudcover: h >= 14 ? 90 : 10,
    humidity: 45
  };
});

// Anytime task with weather_precip='dry_only'
// → placed in morning (precip=5%) but NOT in afternoon (precip=80%)
const result = await runSchedule(userId, { weatherProvider: weather });

// Example 2: Weather changes day-over-day
weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0, cloudcover: 0, humidity: 20 });
weather.setHour('2026-06-16', 9, { temp: 60, precipProb: 90, cloudcover: 95, humidity: 85 });

// Same recurring task → placed on 6/15 but not 6/16

// Example 3: Simulating weather API failure
weather.setEmpty();
// → scheduler fail-open: all tasks placed regardless of weather constraint (BUG R38.1)

// Example 4: Season simulation
const summer = new FakeWeatherProvider();
summer.setRange('2026-07-01', 31, function() {
  return { temp: 95, precipProb: 10, cloudcover: 20, humidity: 60 };
});
const winter = new FakeWeatherProvider();
winter.setRange('2026-01-01', 31, function() {
  return { temp: 20, precipProb: 60, cloudcover: 80, humidity: 70 };
});
// Same task with weather_temp_min=40 → placed in summer, NOT in winter
```

### 5.5 Combined FakeClockAdapter + FakeWeatherProvider

The two fakes work together to simulate real-world scenarios:

```javascript
// Scenario: Task with deadline + weather constraint, time advancing through the week
const clock = new FakeClockAdapter('2026-06-15T08:00:00Z');  // Monday
const weather = new FakeWeatherProvider();
weather.setRange('2026-06-15', 7, function(dk, h) {
  var isRainy = ['2026-06-16', '2026-06-18'].indexOf(dk) !== -1;   // Tue/Thu rain
  return {
    temp: 70,
    precipProb: isRainy ? 90 : 5,
    cloudcover: isRainy ? 95 : 10,
    humidity: 50
  };
});

// Create task with deadline Friday, weather_precip='dry_only'
// → placed Mon/Wed (dry days) before deadline
clock.skipDays(5); // advance to Saturday
// → task now past deadline, detected as overdue
// → weather constraint ignored in overdue ladder (pass 2)
```

---

## 5. TEST SPEC INVENTORY

The following structured test spec files have been produced. Each contains full Data Setup, Action, Expected Outcome, and sub-scenarios.

| # | File | Tests | Lines | Size |
|---|------|-------|-------|------|
| 1 | `docs/testing/PLACEMENT-MODE-TEST-SPECS.md` | TS-01 to TS-71 (~370 sub) | ~1,600 | 86 KB |
| 2 | `docs/TEST-SPECS-RECURRENCE-TPC-SPLIT.md` | TS-72 to TS-126br (~430 sub) | ~2,400 | 108 KB |
| 3 | `juggler-backend/docs/test-specs-weather-deadlines-deps-earliest.md` | TS-127 to TS-162y | ~1,300 | 78 KB |
| 4 | `docs/TEST-SPECS-SCHEDULER-PHASES-TRIGGERS-CAL-SYNC.md` | TS-163 to TS-206 | ~1,300 | 52 KB |
| 5 | `docs/TEST-SPECS-USER-CONFIG-TEMPLATE-TASK.md` | TS-207 to TS-250 | ~1,300 | 73 KB |
| 6 | `docs/TEST-SPECS-ADVERSARIAL-GAPS.md` | TS-301 to TS-313 (16 tests) | ~700 | 47 KB |
| 7 | `docs/TEST-SPECS-ADVERSARIAL-GAPS-2.md` | TS-314 to TS-334 (21 tests) | ~700 | 46 KB |
| 8 | `docs/TEST-SPECS-ADVERSARIAL-GAPS-3.md` | TS-335 to TS-348 (14 tests) | ~800 | 65 KB |
| 9 | `docs/ADVERSARIAL-REVIEW-GAPS.md` | 36 gaps found across all files | ~400 | 32 KB |

**Low-severity gaps (G-021 to G-029)** remain unfixed — to be addressed in a later iteration.

**Total structured test specs: ~460+ across all files.**

## 6. TEST COVERAGE SUMMARY

| Domain | Total Scenarios | Current Tests | Gap |
|--------|----------------|---------------|-----|
| Placement Modes (6) | 61 (TS-01 to TS-61) | Partial (scheduler golden-master) | Many mode-specific edge cases untested |
| Mode Transitions | 10 (TS-62 to TS-71) | Minimal | Drag-to-fixed, calendar-sync lock untested |
| Recurrence Types | 13 (TS-72 to TS-84) | Partial | Biweekly parity, grandfather clause untested |
| TPC | 9 (TS-85 to TS-93) | Minimal | Fill policies, spacing guard untested |
| Rolling Recurrence | 7 (TS-94 to TS-100) | None | Anchor update logic untested |
| Instance Lifecycle | 11 (TS-101 to TS-110) | Partial | Missed detection paths untested |
| Non-Recurring Splits | 9 (TS-111 to TS-119) | None | Cross-day boundary, partial_split untested |
| Recurring Splits | 7 (TS-120 to TS-126) | None | Time-boxing, drift fix untested |
| **Split × Placement Mode** | **9 (TS-126a to TS-126i)** | **None** | **Untested** |
| **Split × Template** | **7 (TS-126j to TS-126p)** | **None** | **Untested** |
| **Split × Location/Template** | **5 (TS-126q to TS-126u)** | **None** | **Untested** |
| **Split × Weather** | **4 (TS-126v to TS-126y)** | **None** | **Untested** |
| **Split × Travel** | **6 (TS-126z to TS-126ae)** | **None** | **Untested** |
| **Split × Status Edge Cases** | **7 (TS-126af to TS-126al)** | **None** | **Untested** |
| **Split × Recurring × Template** | **6 (TS-126bm to TS-126br)** | **None** | **Untested** |
| Deadlines | 9 (TS-127 to TS-135) | Partial | Chain backpropagation untested |
| **Deadline × Template** | **6 (TS-135a to TS-135f)** | **None** | **Untested** |
| **Deadline × Split** | **4 (TS-135g to TS-135j)** | **None** | **Untested** |
| **Deadline × Dependency** | **5 (TS-135k to TS-135o)** | **None** | **Untested** |
| **Deadline × Weather** | **4 (TS-135p to TS-135s)** | **None** | **Untested** |
| **Deadline × Time-Travel** | **5 (TS-135t to TS-135x)** | **None** | **Untested** |
| Earliest-Start | 6 (TS-136 to TS-141) | None | Impossible window, validation untested |
| **Earliest-Start × Template** | **6 (TS-141a to TS-141f)** | **None** | **Untested** |
| **Earliest-Start × Split** | **3 (TS-141g to TS-141i)** | **None** | **Untested** |
| **Earliest-Start × Deadline** | **5 (TS-141j to TS-141n)** | **None** | **Untested** |
| **Earliest-Start × Time-Travel** | **3 (TS-141o to TS-141q)** | **None** | **Untested** |
| Weather | 13 (TS-142 to TS-154) | Partial | Fail-closed bug, parity gap |
| **Weather × Template** | **5 (TS-154a to TS-154e)** | **None** | **Untested** |
| **Weather × Split** | **4 (TS-154f to TS-154i)** | **None** | **Untested** |
| **Weather × Dependency** | **4 (TS-154j to TS-154m)** | **None** | **Untested** |
| **Weather × Recurrence** | **5 (TS-154n to TS-154r)** | **None** | **Untested** |
| **Weather × Time-Travel** | **6 (TS-154s to TS-154x)** | **None** | **Untested** |
| Dependencies | 8 (TS-155 to TS-162) | Partial | Circular dep, chain backprop untested |
| **Dependency × Template** | **25 (TS-162a to TS-162y)** | **None** | **Entire interaction domain untested** |
| Scheduler Phases | 12 (TS-163 to TS-175) | Golden-master (43 scenarios) | Phase 5-7 edge cases |
| Reschedule Triggers | 19 (TS-176 to TS-194) | Partial | Debounce, rate limit untested |
| Calendar Sync | 12 (TS-195 to TS-206) | Good | Concurrent sync, split sync gaps |
| User Config | 8 (TS-207 to TS-214) | Partial | Template overrides untested |
| **Template × Task Interaction** | **36 (TS-215 to TS-250)** | **None** | **Entire domain untested** |
| Edge Cases | 22 (TS-251 to TS-272) | Partial | Many validation paths untested |
| Time-Travel | 16 (TS-273 to TS-288) | None | Requires FakeClockAdapter |
| **Total (all domains)** | **440** | **~80 covered** | **~360 gaps** |
| **Adversarial gap fixes (HIGH+MED)** | **51 (TS-301 to TS-348)** | **None** | **New tests created** |
| **Low-severity gaps (G-021 to G-029)** | **~9 (to be assigned)** | **None** | **Next iteration** |
| **Grand Total** | **~500** | **~80 covered** | **~420 gaps** |
