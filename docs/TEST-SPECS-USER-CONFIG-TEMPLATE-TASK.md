# Juggler Scheduler — Full Structured Test Specs
## User Config | Template × Task Setting Interaction

**Updated:** 2026-06-15
**Scope:** TS-207 through TS-250

---

## Format Legend

Each test spec includes:
- **ID** — Test scenario identifier
- **Domain** — Feature area
- **Title** — One-line description
- **Data Setup** — Preconditions, clock, user config, tasks, existing instances
- **Action** — What triggers the behavior (scheduler run / config change / status change)
- **Expected Outcome** — What must happen (placements, unplaced, flags, warnings)
- **Sub-scenarios** — Related edge cases that should also be covered

---

## Global Context for This Section

**Default weekday blocks (blocksMap.Mon–Fri):**
- morning(360-480), biz1(480-720), lunch(720-780), biz2(780-1020), evening(1020-1260), night(1260-1380)

**Default weekend blocks (blocksMap.Sat–Sun):**
- morning(420-720), afternoon(720-1020), evening(1020-1260), night(1260-1380)

**Tool matrix (default):**
```json
{home: ["phone", "personal_pc"], work: ["phone", "work_pc", "printer"], transit: ["phone"]}
```

**GRID_START=6** (360 min), **GRID_END=23** (1380 min)

**Resolution Chain A — Time Block Resolution (getBlocksForDate):**
1. `locScheduleOverrides[dateStr]` → lookup `scheduleTemplates[templateId].blocks`
2. `blocksMap[dayName]` (e.g. `blocksMap['Mon']`)
3. Fallback: `blocksMap.Mon || []`

**Resolution Chain B — Location Resolution (resolveLocationId):**
1. `hourLocationOverrides[dateStr][hour]`
2. `locScheduleOverrides[dateStr]` → templateId
3. `locScheduleDefaults[dayName]` → templateId
4. Template `hours[minSlot]` or `hours[hour]`
5. Block's `loc` field
6. Default: `"home"`

**Combined Slot Eligibility (all must pass):**
1. Time blocks exist for this date
2. Task's `when`-tag matches at least one window
3. Resolved location is in task's `location` array (or location empty)
4. Resolved location's `toolMatrix` entry contains all task's required tools
5. Weather constraints pass (if set)
6. Day-of-week constraint passes (`day_req`)

---

# 1. User Config Tests (TS-207 to TS-214)

These tests cover the user-configuration system that governs how schedule templates, location schedules, tool mappings, and preferences are applied. Each test exercises a specific user-config feature path through the resolution chains.

---

## 1.1 Time Blocks Override — Date-Specific (TS-207)

---
**ID:** TS-207
**Domain:** User Config / Time Blocks Override
**Title:** Date-specific time block override is respected, overriding day-of-week defaults
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday, June 15, 2026)
- User config:
  - `time_blocks`: default weekday blocks (morning 360-480, biz1 480-720, lunch 720-780, biz2 780-1020, evening 1020-1260, night 1260-1380)
  - `template_overrides`: `{ "2026-06-15": "holiday" }`
  - `schedule_templates`: `{ "holiday": { blocks: [] } }` (no blocks — zero capacity day)
  - `template_defaults`: `{ "Mon": "default", "Tue": "default", ... }` (default template has the weekday blocks above)
- Tasks:
  1. Anytime task: `{ id: 't1', text: 'Work task', dur: 60, pri: P3, placementMode: 'anytime' }`
  2. Fixed task: `{ id: 't2', text: 'Standup', dur: 30, placementMode: 'fixed', date: '2026-06-15', time: '09:00' }`
**Action:** Run scheduler
**Expected Outcome:**
- `template_overrides['2026-06-15']` = `"holiday"` takes priority over `template_defaults['Mon']`
- `scheduleTemplates['holiday']` has no blocks → `getBlocksForDate` returns `[]`
- `t1` (anytime, no when-tag) is placed in the default anytime window → `[GRID_START, GRID_END]` = `[360, 1380]` still applies because when-tag=anytime bypasses block windows
- `t2` (fixed) is placed at 09:00 via Phase 0 immovables — fixed tasks are exempt from block constraints
**Sub-scenarios:**
- [SUB-207a] `template_overrides` references non-existent templateId → fall through to day-of-week blocks
- [SUB-207b] `template_overrides` date falls on weekend → weekend blocks used after override fallthrough
- [SUB-207c] Multiple `template_overrides` across consecutive days → each day independently resolved
- [SUB-207d] `template_overrides` date in the past → still applied on scheduler re-run (historical override)
- [SUB-207e] `template_overrides` with blocks that have different `loc` values → Chain B step 5 affected
---

## 1.2 Location Schedule — Day-of-Week Template (TS-208)

---
**ID:** TS-208
**Domain:** User Config / Location Schedule
**Title:** Day-of-week location schedule template is respected when no date-specific override
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "work", "Tue": "work", "Wed": "work", "Thu": "work", "Fri": "work", "Sat": "weekend", "Sun": "weekend" }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work", 480: "work", 1380: "work" } }, "weekend": { hours: { 0: "home" } } }`
  - `time_blocks`: default weekday blocks (all have `loc: null` — no block-level loc)
  - No `loc_schedule_overrides`
  - No `hour_location_overrides`
- Tasks:
  1. Task with location constraint: `{ id: 't1', text: 'Office task', dur: 60, pri: P3, location: ["work"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `loc_schedule_overrides['2026-06-15']` is undefined → fall through
- `loc_schedule_defaults['Mon']` = `"work"` → templateId = `"work"`
- `loc_schedules['work'].hours[480]` = `"work"` → resolveLocationId returns `"work"` for morning block
- `t1.location` = `["work"]` → location constraint passes → `t1` placed in morning block at earliest available slot
**Sub-scenarios:**
- [SUB-208a] Saturday → `loc_schedule_defaults['Sat']` = `"weekend"` → resolved to `"home"` → task with `location=["work"]` is unplaced during weekend
- [SUB-208b] `loc_schedule_defaults` missing a day (e.g. no "Wed" key) → fall through to block `loc` field → default `"home"`
- [SUB-208c] `loc_schedules[templateId]` missing → fall through to block `loc` field → default `"home"`
- [SUB-208d] `loc_schedules[templateId].hours` uses `hour` granularity vs `minSlot` both tested
---

## 1.3 Location Override — Date-Specific (TS-209)

---
**ID:** TS-209
**Domain:** User Config / Location Override
**Title:** Date-specific location schedule override is respected, overriding day-of-week default
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "work", "Tue": "work", ..., "Sat": "weekend", "Sun": "weekend" }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work" } }, "remote": { hours: { 0: "home" } } }`
  - `loc_schedule_overrides`: `{ "2026-06-15": "remote" }`  (Monday is a remote day)
  - `time_blocks`: default weekday blocks (no block-level loc)
- Tasks:
  1. Office task: `{ id: 't1', text: 'Office task', dur: 60, pri: P3, location: ["work"] }`
  2. Home task: `{ id: 't2', text: 'Home task', dur: 30, pri: P3, location: ["home"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `loc_schedule_overrides['2026-06-15']` = `"remote"` → takes priority over `loc_schedule_defaults['Mon']`
- `loc_schedules['remote'].hours[0]` = `"home"` → resolveLocationId returns `"home"` for all hours
- `t1.location` = `["work"]` → location constraint FAILS → `t1` is unplaced
- `t2.location` = `["home"]` → location constraint PASSES → `t2` placed in earliest morning block
**Sub-scenarios:**
- [SUB-209a] `loc_schedule_overrides` references non-existent templateId → fall through to `loc_schedule_defaults` day-of-week
- [SUB-209b] `loc_schedule_overrides` applies to a past date → still used in scheduler re-run (historical)
- [SUB-209c] `loc_schedule_overrides` + `hour_location_overrides` on same date → hour-level wins per Chain B step 1
- [SUB-209d] `loc_schedule_overrides` changes the template, but the template's hours only partially cover the day → unmapped hours fall through to block loc → default "home"
---

## 1.4 Hour Location Override — Hour-Level Override (TS-210)

---
**ID:** TS-210
**Domain:** User Config / Hour Location Override
**Title:** Hour-level location override overrides everything for that specific hour
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "work" }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work" } } }`
  - `hour_location_overrides`: `{ "2026-06-15": { 9: "gym", 14: "office" } }`  (override hour 9→gym, hour 14→office)
  - `time_blocks`: default weekday blocks
- Tasks:
  1. Gym task: `{ id: 't1', text: 'Gym workout', dur: 60, pri: P3, location: ["gym"] }`
  2. Office task: `{ id: 't2', text: 'Office work', dur: 60, pri: P3, location: ["work"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `hour_location_overrides['2026-06-15'][9]` = `"gym"` → Chain B step 1 matches at hour 9 (minute 540-599)
- `t1.location` = `["gym"]` → placement attempted at slot 540 (9:00) → location matches → placed at 09:00-10:00
- `t2.location` = `["work"]` → during hour 9, location resolves to "gym" → NOT a match → cannot place at 09:00-10:00
- `t2` placed at 08:00-09:00 (hour 8, when location resolves to "work" via defaults) or any other non-overridden hour slot
**Sub-scenarios:**
- [SUB-210a] `hour_location_overrides` for hour that falls inside a block → block is partially usable for location-constrained tasks
- [SUB-210b] `hour_location_overrides` at hour 6 (GRID_START) → earliest possible override
- [SUB-210c] `hour_location_overrides` at hour 23 (GRID_END) → latest possible override
- [SUB-210d] `hour_location_overrides` with non-existing location → task requiring that location gets no valid slot → unplaced
- [SUB-210e] Multiple `hour_location_overrides` on same day, same hour → last write wins (deterministic merge)
- [SUB-210f] `hour_location_overrides` for a date in the past → still applied on re-run
---

## 1.5 Tool Matrix — Location→Tool Mapping (TS-211)

---
**ID:** TS-211
**Domain:** User Config / Tool Matrix
**Title:** Tool matrix location→tool mapping is respected — task with required tool placed only where that tool exists
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `tool_matrix`: `{ home: ["phone", "personal_pc"], work: ["phone", "work_pc", "printer"], transit: ["phone"] }`
  - `loc_schedule_defaults`: `{ "Mon": "work" }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work" } } }`
  - `time_blocks`: default weekday blocks with `loc` fields: `biz1.loc = "work"`, `lunch.loc = null`, `biz2.loc = "work"`
- Tasks:
  1. Task requiring printer: `{ id: 't1', text: 'Print documents', dur: 30, pri: P3, tools: ["printer"] }`
  2. Task requiring personal_pc: `{ id: 't2', text: 'Personal work', dur: 30, pri: P3, tools: ["personal_pc"] }`
  3. Task requiring phone (everywhere): `{ id: 't3', text: 'Call', dur: 15, pri: P3, tools: ["phone"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `t1.tools` = `["printer"]` → resolveLocationId returns `"work"` (via default + template) → `tool_matrix["work"]` includes "printer" → TOOL constraint PASSES → placed in a work block
- `t2.tools` = `["personal_pc"]` → `tool_matrix["work"]` does NOT include "personal_pc" → TOOL constraint FAILS → `t2` is unplaced (no location where personal_pc exists during work hours)
- `t3.tools` = `["phone"]` → `tool_matrix["work"]` includes "phone" → PASSES → placed in a work block
**Sub-scenarios:**
- [SUB-211a] Task with BOTH location and tools → AND logic: location must match AND tools must exist at that location
- [SUB-211b] Task with tools = [] or null → no tool constraint → placed anywhere
- [SUB-211c] `tool_matrix` entry missing for a resolved location → fall through to empty array → any non-empty tools constraint fails → unplaced
- [SUB-211d] Task with multiple tools (AND) → all must exist in the resolved location's `tool_matrix`
- [SUB-211e] `tool_matrix` has a location that no template references → tools at that location unreachable
- [SUB-211f] `tool_matrix` change (tool added) → previously unplaced task becomes placeable on next scheduler run
- [SUB-211g] `tool_matrix` change (tool removed) → existing placed tasks re-evaluated on next scheduler run
---

## 1.6 Preferences — temperatureUnit, weekStartsOn, defaultDuration, timezone (TS-212)

---
**ID:** TS-212
**Domain:** User Config / Preferences
**Title:** User preferences affect scheduler behavior and display calculations
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config preferences variations:
  1. `temperatureUnit: "F"` or `"C"` — affects weather constraint threshold evaluation
  2. `weekStartsOn: 0` (Sunday) or `1` (Monday) — affects day-of-week index mapping in block resolution
  3. `defaultDuration: 30` or `60` — affects new task default dur (not scheduler placement)
  4. `timezone: "America/New_York"` or `"America/Los_Angeles"` — affects `nowMins` calculation and day boundaries
- Tasks:
  1. Task with weather constraint: `{ id: 't1', text: 'Weather task', dur: 30, pri: P3, weather_temp_min: 32, weather_temp_max: 80, weather_temp_unit: "F" }`
  2. New task created via API (no explicit dur)
**Action:** 1) Run scheduler with each preference variant. 2) Create a task via POST /api/tasks.
**Expected Outcome:**
- `temperatureUnit: "F"` → weather check uses Fahrenheit thresholds (32-80°F)
- `temperatureUnit: "C"` → weather check uses Celsius thresholds (0-27°C); if `weather_temp_unit="F"` on task, convert before comparison
- `weekStartsOn: 0` → `getDay()` mapping: Sun=0, Mon=1, ..., Sat=6
- `weekStartsOn: 1` → `getDay()` mapping: Mon=0, Tue=1, ..., Sun=6
- `defaultDuration: 30` → new task created without dur gets `dur=30`
- `defaultDuration: 60` → new task created without dur gets `dur=60`
- `timezone: "America/New_York"` → `nowMins` computed from EDT; day boundaries at midnight ET
- `timezone: "America/Los_Angeles"` → `nowMins` computed from PDT; day boundaries at midnight PT (3h difference)
**Sub-scenarios:**
- [SUB-212a] `temperatureUnit` change triggers scheduler re-run (SCHED_KEYS includes `preferences`)
- [SUB-212b] `weekStartsOn` change affects weekday→block mapping on scheduler re-run
- [SUB-212c] `timezone` change shifts all existing placements' displayed times (no re-run needed for display)
- [SUB-212d] `defaultDuration` change only affects NEW tasks, not existing ones
- [SUB-212e] Invalid preferences values rejected (non-IANA timezone, temperatureUnit not "F"/"C", weekStartsOn not 0-6)
- [SUB-212f] `timezone` affects deadline comparisons: a deadline at midnight in the user's timezone may be tomorrow in UTC
---

## 1.7 Schedule Templates — Named Templates Applied (TS-213)

---
**ID:** TS-213
**Domain:** User Config / Schedule Templates
**Title:** Named schedule templates with custom block definitions are correctly applied
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `template_defaults`: `{ "Mon": "default", "Tue": "default", ..., "Sat": "weekend", "Sun": "weekend" }`
  - `schedule_templates`: `{ "default": { blocks: [...] }, "travel": { blocks: [{ id: "early", tag: "morning", name: "Early", start: 300, end: 660, loc: "transit" }, { id: "late", tag: "evening", name: "Late", start: 1080, end: 1260, loc: "hotel" }] } }`
  - `template_overrides`: `{ "2026-06-15": "travel" }` (Monday is a travel day)
  - Default weekday blocks would normally have 6 blocks (morning through night)
- Tasks:
  1. Morning task: `{ id: 't1', text: 'Early meeting', dur: 60, pri: P3, when: "morning" }`
  2. Biz1 task: `{ id: 't2', text: 'Business task', dur: 60, pri: P3, when: "biz1" }`
  3. Anytime task: `{ id: 't3', text: 'Flex work', dur: 30, pri: P3 }`
**Action:** Run scheduler
**Expected Outcome:**
- `template_overrides['2026-06-15']` = `"travel"` → `scheduleTemplates["travel"].blocks` used
- Blocks available: `early(300-660)` with tag `morning`, `late(1080-1260)` with tag `evening`
- `t1.when = "morning"` → matches `early` block (tag "morning") → placed in 300-660 window
- `t2.when = "biz1"` → no block tagged "biz1" in travel template → no matching window → unplaced
- `t3` (anytime) → placed in the anytime window `[360-1380]` (clamped to GRID_START..GRID_END) or within any block
**Sub-scenarios:**
- [SUB-213a] Named template with blocks outside GRID_START..GRID_END → clamped to schedule bounds
- [SUB-213b] Named template with zero-duration blocks (start=end) → skipped
- [SUB-213c] Named template with overlapping blocks → deduplicated windows (union)
- [SUB-213d] `template_overrides` references non-existent template → fall through to day-of-week default
- [SUB-213e] `template_defaults` day not defined → fall through to hard-coded default blocks (DEFAULT_WEEKDAY or DEFAULT_WEEKEND)
- [SUM-213f] Named template with `loc` fields on blocks → Chain B step 5 fallback for location resolution
---

## 1.8 Config Change → Scheduler Re-Run (TS-214)

---
**ID:** TS-214
**Domain:** User Config / Config Change Trigger
**Title:** Each SCHED_KEYS config change triggers scheduler re-run via enqueueScheduleRun
**Data Setup:**
- DB: existing user with scheduled tasks
- Test: mock `enqueueScheduleRun` to track calls
- User config has SCHED_KEYS: `time_blocks`, `loc_schedules`, `loc_schedule_defaults`, `loc_schedule_overrides`, `hour_location_overrides`, `tool_matrix`, `preferences`, `schedule_templates`, `template_defaults`, `template_overrides`
**Action:** Update each SCHED_KEYS config key one at a time via PATCH /api/config/:key
**Expected Outcome:**
- Each SCHED_KEYS update calls `enqueueScheduleRun` once with source `'config:<key>'`
- Non-SCHED_KEYS updates (e.g. `locations`, `tools`) do NOT trigger scheduler re-run
- `schedule_queue` row inserted for the user after each SCHED_KEYS change
- The scheduler re-evaluates ALL tasks when it runs (not just affected tasks)
**Sub-scenarios:**
- [SUB-214a] Multiple config changes in rapid succession (within 2000ms debounce) → coalesced into single scheduler run
- [SUB-214b] Config change + task change simultaneously → both queue entries coalesced
- [SUB-214c] Config change that reverts to previous values → still triggers (simplified: always trigger)
- [SUB-214d] Config change for a user with no tasks → still queues a run (no-op when scheduler runs)
- [SUB-214e] Bulk config import (POST /api/data/import) → triggers scheduler re-run with source `'import'`
---

# 2. Template × Task Setting Interaction Tests (TS-215 to TS-250)

These tests cover the combinatorial interaction between user-config templates and individual task settings. Each test exercises a specific path through the resolution chains in §1.11 of TASK-SETTINGS-TREE.md.

---

## 2.1 Time Block Template × Task `when`-tag (TS-215 to TS-222)

---
**ID:** TS-215
**Domain:** Template × Task / Time Block × when-tag
**Title:** Default weekday blocks + task when=morning → placed in morning block
**Data Setup:**
- Clock: fixed at `2026-06-15T06:30:00Z` (Monday, before grid start)
- User config:
  - Default weekday blocks: morning(360-480), biz1(480-720), lunch(720-780), biz2(780-1020), evening(1020-1260), night(1260-1380)
  - No template_overrides, no locScheduleOverrides
- Tasks:
  1. `{ id: 't1', text: 'Morning task', dur: 60, pri: P3, when: "morning" }`
  2. `{ id: 't2', text: 'Biz1 task', dur: 30, pri: P3, when: "biz1" }`
  3. `{ id: 't3', text: 'Lunch task', dur: 30, pri: P3, when: "lunch" }`
**Action:** Run scheduler
**Expected Outcome:**
- `getBlocksForDate('2026-06-15', blocksMap, cfg)` → no override → `blocksMap['Mon']` → default weekday blocks
- `buildWindowsFromBlocks(blocks)` → windows by tag: morning=[360,480], biz1=[480,720], lunch=[720,780], biz2=[780,1020], evening=[1020,1260], night=[1260,1380]
- `getWhenWindows('morning', windows)` → `[360,480]`
- `t1` placed within morning window (earliest slot: 360-420)
- `t2` placed within biz1 window (480-510)
- `t3` placed within lunch window (720-750)
**Sub-scenarios:**
- [SUB-215a] Task with `when="morning,afternoon"` → placed in morning OR biz2 (afternoon alias) — whichever is earliest
- [SUB-215b] Task with `when=""` or `when="anytime"` → no tag constraint, placed in any block
- [SUB-215c] Task with `when` tag that doesn't exist in any block → matching windows empty → unplaced
- [SUB-215d] Multiple tasks sharing the same `when` tag → placed in order of slack/priority within the same window
---

---
**ID:** TS-216
**Domain:** Template × Task / Time Block × when-tag
**Title:** Holiday template (no blocks) + task when=morning → unplaced (no windows)
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `template_overrides`: `{ "2026-06-15": "holiday" }`
  - `schedule_templates`: `{ "holiday": { blocks: [] } }` (no blocks)
  - `template_defaults`: `{ "Mon": "default" }`
- Tasks:
  1. `{ id: 't1', text: 'Morning task', dur: 60, pri: P3, when: "morning" }`
  2. `{ id: 't2', text: 'Anytime task', dur: 30, pri: P3, placementMode: 'anytime' }`
  3. Fixed task: `{ id: 't3', text: 'Standup', dur: 30, placementMode: 'fixed', date: '2026-06-15', time: '09:00' }`
**Action:** Run scheduler
**Expected Outcome:**
- `getBlocksForDate` → template_overrides matches → `scheduleTemplates["holiday"].blocks = []`
- `buildWindowsFromBlocks([])` → empty windows map
- `t1.when = "morning"` → `getWhenWindows("morning", {})` → empty → unplaced with `_unplacedReason`
- `t2` (anytime) → `when=""` → bypasses block check → placed in `[GRID_START, GRID_END]` = `[360, 1380]`
- `t3` (fixed) → Phase 0 immovables, exempt from block constraints → placed at 09:00
**Sub-scenarios:**
- [SUB-216a] Holiday template on weekend → already no blocks (weekend has different defaults) → consistent
- [SUB-216b] Holiday template with `scheduleTemplates` blocks = `[]` vs `undefined` → both treated as "no blocks"
- [SUB-216c] All tasks with `when` tags unplaced; only anytime/fixed tasks placed
---

---
**ID:** TS-217
**Domain:** Template × Task / Time Block × when-tag
**Title:** Travel day template (shifted hours) + task when=morning → placed in shifted morning block
**Data Setup:**
- Clock: fixed at `2026-06-15T05:00:00Z` (Monday, before any block start)
- User config:
  - `template_overrides`: `{ "2026-06-15": "travel" }`
  - `schedule_templates`: `{ "travel": { blocks: [{ id: "early_departure", tag: "morning", name: "Early flight", start: 240, end: 360 }, { id: "evening_arrival", tag: "evening", name: "Hotel evening", start: 1140, end: 1320 }] } }`
- Tasks:
  1. `{ id: 't1', text: 'Early travel task', dur: 60, pri: P3, when: "morning" }`
**Action:** Run scheduler
**Expected Outcome:**
- `getBlocksForDate` → travel template selected
- Windows: morning=[240,360] (clamped to [360,360] since 240 < GRID_START? Actually, GRID_START=360, so the window would be 360-360 = zero duration, OR the block gets clamped to [360,360] meaning no window)
- Wait — travel template block `early_departure` starts at 240 (4:00 AM), which is before GRID_START (360, 6:00 AM). Need to determine clamping behavior.
- If blocks are clamped to GRID_START..GRID_END → `early_departure` becomes [360,360] (zero duration, skipped)
- `t1` has no eligible morning window → unplaced
- Alternatively, if not clamped: `early_departure` is usable → `t1` placed at 240-300 (4:00-5:00 AM)
**Sub-scenarios:**
- [SUB-217a] Travel template where all blocks are before GRID_START → all windows zero after clamp → no blocks for when-tag tasks
- [SUB-217b] Travel template where blocks span GRID_START boundary → only portion after GRID_START usable
- [SUB-217c] Travel template with blocks that have different loc fields → location resolution affected
- [SUB-217d] Travel template + task with `when` that matches multiple shifted blocks
---

---
**ID:** TS-218
**Domain:** Template × Task / Time Block × when-tag
**Title:** Template with custom tags + task when=custom_tag → placed in custom block
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `schedule_templates`: `{ "custom_day": { blocks: [{ id: "deep_work", tag: "focus", name: "Deep Work", start: 420, end: 720 }, { id: "meetings", tag: "collab", name: "Collaboration", start: 780, end: 1020 }] } }`
  - `template_overrides`: `{ "2026-06-15": "custom_day" }`
- Tasks:
  1. `{ id: 't1', text: 'Focus time', dur: 120, pri: P3, when: "focus" }`
  2. `{ id: 't2', text: 'Meeting block', dur: 60, pri: P3, when: "collab" }`
  3. `{ id: 't3', text: 'Morning task', dur: 30, pri: P3, when: "morning" }` (standard tag)
**Action:** Run scheduler
**Expected Outcome:**
- `getBlocksForDate` → custom_day template blocks used
- Windows: focus=[420,720], collab=[780,1020]
- `t1.when = "focus"` → matches custom block → placed at 420-540 (earliest slot in focus block)
- `t2.when = "collab"` → matches custom block → placed at 780-840
- `t3.when = "morning"` → no block tagged "morning" in custom template → `getWhenWindows("morning", {focus:[420,720], collab:[780,1020]})` → empty → unplaced
**Sub-scenarios:**
- [SUB-218a] Custom tag names up to 30 chars (validation limit)
- [SUB-218b] Custom tag name overlaps with standard name ("morning") → standard name still resolved
- [SUB-218c] Multiple custom tags on one task ("focus,collab") → placed in either matching block
- [SUB-218d] Custom tag on a block that uses special characters → validated on config save
---

---
**ID:** TS-219
**Domain:** Template × Task / Time Block × when-tag
**Title:** Template with custom tags + task when=standard_tag → unplaced (tag not in template)
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - Custom template that only has "focus" and "collab" blocks (no "morning", "biz1", etc.)
  - `template_overrides`: `{ "2026-06-15": "custom_day" }`
- Tasks:
  1. `{ id: 't1', text: 'Standard morning task', dur: 30, pri: P3, when: "morning" }`
  2. `{ id: 't2', text: 'Standard biz task', dur: 30, pri: P3, when: "biz1" }`
**Action:** Run scheduler
**Expected Outcome:**
- `getWhenWindows("morning", windows)` → no match → empty windows → `t1` unplaced
- `getWhenWindows("biz1", windows)` → no match → `t2` unplaced
- Both tasks go to `stillUnplaced`
**Sub-scenarios:**
- [SUB-219a] In the UI, task shows as unplaced with a reason that indicates no matching block
- [SUB-219b] If template changes to add the standard tag later → previously unplaced tasks become placeable on next scheduler run
---

---
**ID:** TS-220
**Domain:** Template × Task / Time Block × when-tag
**Title:** Template change (blocks removed) → existing placed tasks lose valid windows on next scheduler run
**Data Setup:**
- T=0: User has template with morning block (360-480) + biz1 block (480-720)
- Task: `{ id: 't1', text: 'Biz task', dur: 60, pri: P3, when: "biz1" }`
- First scheduler run: `t1` placed at 480-540 (biz1 block)
- T=1: User changes template, removes biz1 block → template only has morning block now
- Clock advances slightly (or manual re-run triggered)
**Action:** Second scheduler run
**Expected Outcome:**
- Scheduler resets all non-fixed tasks (Phase 0 exempts fixed)
- `getBlocksForDate` → new template (no biz1 block)
- `getWhenWindows("biz1", windows)` → empty → `t1` cannot be placed
- `t1` goes to `stillUnplaced`
- Previous placement at 480 is cleared; slot becomes available for other tasks
**Sub-scenarios:**
- [SUB-220a] Block removal affects only tasks with that `when` tag; tasks with other tags unaffected
- [SUB-220b] Block removal that leaves NO blocks → all when-tag tasks unplaced; anytime/fixed tasks still placed
- [SUB-220c] Fixed task unaffected by block removal (Phase 0 immovables)
- [SUB-220d] Block removal + template change trigger → scheduler automatically enqueued
---

---
**ID:** TS-221
**Domain:** Template × Task / Time Block × when-tag
**Title:** Template change (blocks added) → previously unplaced tasks become placeable on next scheduler run
**Data Setup:**
- T=0: Template has no "biz1" block (only morning). Task `t1` with `when="biz1"` is unplaced.
- T=1: User adds biz1 block (480-720) to template → config update triggers `enqueueScheduleRun`
**Action:** Second scheduler run (via template change trigger)
**Expected Outcome:**
- `getBlocksForDate` → new template with biz1 block
- `getWhenWindows("biz1", windows)` → `[480,720]` → `t1` now has a valid window
- `t1` placed at earliest slot within biz1 block (480-540)
- Task moves from `stillUnplaced` to `dayPlacements`
**Sub-scenarios:**
- [SUB-221a] Multiple previously unplaced tasks all become placeable after block addition
- [SUB-221b] Block addition creates new window for some tasks but not others (different tags)
- [SUB-221c] Block addition that overlaps with existing tasks' placements → scheduler re-packs around new capacity
- [SUB-221d] Block addition triggers automatic scheduler re-run (no manual intervention needed)
---

---
**ID:** TS-222
**Domain:** Template × Task / Time Block × when-tag
**Title:** Multiple templates across days + recurring task with when-tag → different windows each day
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `template_overrides`: `{ "2026-06-15": "travel", "2026-06-16": "office" }`
  - `schedule_templates`: `{ "travel": { blocks: [{ id: "morning_flight", tag: "morning", start: 360, end: 540 }] }, "office": { blocks: [{ id: "morning", tag: "morning", start: 540, end: 720 }] } }`
- Tasks:
  1. Recurring daily task: `{ id: 'recur-1', text: 'Daily morning check', dur: 30, pri: P3, when: "morning", recurring: true, recur: { type: 'daily' }, anchorDate: '2026-06-15' }`
- Existing instances generated for 2026-06-15 and 2026-06-16
**Action:** Run scheduler
**Expected Outcome:**
- For 2026-06-15 (Monday, travel template): morning window = [360, 540]
  - Instance placed at 360-390 (earliest slot in travel morning block)
- For 2026-06-16 (Tuesday, office template): morning window = [540, 720]
  - Instance placed at 540-570 (earliest slot in office morning block)
- Same recurring task, different days, different placement windows due to different templates
**Sub-scenarios:**
- [SUB-222a] Day with no template_override → falls through to day-of-week default blocks
- [SUB-222b] Recurring task on a day with NO matching when-tag block → that occurrence unplaced, other days unaffected
- [SUB-222c] Recurring task with different template each day of the week → each day independently resolved
- [SUB-222d] Template changes mid-week → recurring instances before vs after the change see different windows
---

## 2.2 Location Template × Task `location`/`tools` (TS-223 to TS-230)

---
**ID:** TS-223
**Domain:** Template × Task / Location Template × location
**Title:** locScheduleDefaults + task location=["work"] → placed during work-location hours
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "work" }`
  - `loc_schedules`: `{ "work": { hours: { 480: "work", 780: "work", 1020: "work" } } }`  (work 8:00-17:00)
  - `time_blocks`: default weekday blocks with no block-level `loc`
- Tasks:
  1. `{ id: 't1', text: 'Office task', dur: 60, pri: P3, location: ["work"] }`
  2. `{ id: 't2', text: 'Home task', dur: 30, pri: P3, location: ["home"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `resolveLocationId('2026-06-15', 480, cfg, blocks)` → chain B: no hourOverride, no locOverride → locScheduleDefaults['Mon']='work' → locSchedules['work'].hours[480]='work' → resolves to "work"
- All slots during work hours (480-1380) resolve to "work" via template spanning whole day or individual hour entries
- `t1.location = ["work"]` → match → placed at earliest work-hour slot
- `t2.location = ["home"]` → no slot resolves to "home" → unplaced (or placed during non-template hours if fallthrough to "home")
**Sub-scenarios:**
- [SUB-223a] Loc schedule with hours that only partially cover the day → unmapped hours fall through to block loc → default "home"
- [SUB-223b] Task with `location = ["home", "work"]` → placed in either location's hours (whichever is earliest)
- [SUB-223c] `loc_schedules` template hours defined by `minSlot` (minute-level) vs `hour` (hour-level) — both resolve correctly
---

---
**ID:** TS-224
**Domain:** Template × Task / Location Template × location
**Title:** locScheduleOverrides (remote day) + task location=["work"] → unplaced (location is "home" all day)
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "work" }`
  - `loc_schedule_overrides`: `{ "2026-06-15": "remote" }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work" } }, "remote": { hours: { 0: "home" } } }`
- Tasks:
  1. `{ id: 't1', text: 'Office task', dur: 60, pri: P3, location: ["work"] }`
  2. `{ id: 't2', text: 'Home task', dur: 30, pri: P3, location: ["home"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `resolveLocationId('2026-06-15', 480, cfg, blocks)` → chain B step 2: locScheduleOverrides['2026-06-15']='remote' → locSchedules['remote'].hours[0]='home' → resolves to "home" for all hours
- `t1.location = ["work"]` → no match → unplaced
- `t2.location = ["home"]` → match → placed at earliest available slot
**Sub-scenarios:**
- [SUB-224a] Remote day override with partial hours mapping some to "work", others to "home" → task only placed in matching hours
- [SUB-224b] Remote day override + `hour_location_overrides` (higher priority) → hour-level can override back to "work" for specific hours
---

---
**ID:** TS-225
**Domain:** Template × Task / Location Template × location
**Title:** locScheduleOverrides (office day) + task location=["home"] → unplaced during office hours
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday, normally a remote day via defaults)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "remote" }` (normally remote on Mondays)
  - `loc_schedule_overrides`: `{ "2026-06-15": "office" }` (but this Monday is in office)
  - `loc_schedules`: `{ "remote": { hours: { 0: "home" } }, "office": { hours: { 480: "work", 1380: "work" } } }`  (office hours 8:00-23:00)
- Tasks:
  1. `{ id: 't1', text: 'Home chore', dur: 30, pri: P3, location: ["home"] }`
  2. `{ id: 't2', text: 'Office task', dur: 60, pri: P3, location: ["work"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `resolveLocationId` → override 'office' takes priority → all mapped hours resolve to "work"
- `t1.location = ["home"]` → no "home" hours in office template → unplaced
- `t2.location = ["work"]` → match → placed during office hours
**Sub-scenarios:**
- [SUB-225a] Office override that still has some "home" hours after 5PM → t1 placed in those after-hours slots
- [SUB-225b] Task with BOTH home and work locations → placed in earliest matching slot across both location types
---

---
**ID:** TS-226
**Domain:** Template × Task / Location Template × location
**Title:** hourLocationOverrides + task location=["gym"] → placed only during gym hour
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "work" }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work" } } }`
  - `hour_location_overrides`: `{ "2026-06-15": { 17: "gym" } }` (5:00 PM at the gym)
  - Time blocks: default weekday blocks
- Tasks:
  1. `{ id: 't1', text: 'Gym workout', dur: 60, pri: P3, location: ["gym"] }`
  2. `{ id: 't2', text: 'Work task', dur: 60, pri: P3, location: ["work"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `hour_location_overrides['2026-06-15'][17]` = `"gym"` → for minute 1020-1079 (5:00 PM hour), location resolves to "gym"
- Block evening(1020-1260) contains hour 17 → part of evening block resolves to "gym"
- `t1.location = ["gym"]` → can only be placed during the gym hour (1020-1079) → placed there if capacity available
- `t2.location = ["work"]` → during hour 17, location is "gym" → NOT "work" → cannot place at 1020-1079 → placed in earlier work blocks (morning, biz1, biz2)
**Sub-scenarios:**
- [SUB-226a] Gym hour is only 60 min → t1 with dur=120 cannot fit in single gym hour → unplaced (or split across two gym hours if multiple)
- [SUB-226b] `hour_location_overrides` at non-standard hour boundaries (e.g. hour 6 = GRID_START)
- [SUB-226c] Multiple `hour_location_overrides` on same day → each hour independently resolved
---

---
**ID:** TS-227
**Domain:** Template × Task / Location Template × location
**Title:** locSchedules template hours + task location=["office"] → placed during office hours in template
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "office_hours" }`
  - `loc_schedules`: `{ "office_hours": { hours: { 0: "commute", 540: "office", 1020: "commute", 1140: "home" } } }`
    - 0-539: commute (before 9 AM)
    - 540-1019: office (9:00 AM - 5:00 PM)
    - 1020-1139: commute (5:00 PM - 7:00 PM)
    - 1140-1439: home (after 7 PM)
- Tasks:
  1. `{ id: 't1', text: 'Office task', dur: 60, pri: P3, location: ["office"] }`
  2. `{ id: 't2', text: 'Commute task', dur: 15, pri: P3, location: ["commute"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `resolveLocationId` for minute 540 → template 'office_hours' → hours[540]="office" → "office"
- `t1.location = ["office"]` → placed at 540 (9:00 AM) earliest office slot
- `resolveLocationId` for minute 400 (before 9 AM) → hours[0]="commute"
- `t2.location = ["commute"]` → placed at 360 (6:00 AM) earliest GRID_START slot during commute hours
**Sub-scenarios:**
- [SUB-227a] Template hours with gaps between entries → last matched minute entry covers the gap
- [SUB-227b] Template hours that don't cover GRID_START..GRID_END → unmapped slots fall through to block loc → default "home"
---

---
**ID:** TS-228
**Domain:** Template × Task / Location Template × location
**Title:** Block loc field fallback + task location=["home"] → placed during home-location blocks
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - No `loc_schedule_defaults` defined
  - No `loc_schedule_overrides`
  - No `hour_location_overrides`
  - `time_blocks`: custom blocks with `loc` fields:
    - `morning: { loc: "home" }`
    - `biz1: { loc: "work" }`
    - `lunch: { loc: null }` (no loc)
    - `biz2: { loc: "work" }`
    - `evening: { loc: "home" }`
- Tasks:
  1. `{ id: 't1', text: 'Home task', dur: 60, pri: P3, location: ["home"] }`
  2. `{ id: 't2', text: 'Work task', dur: 60, pri: P3, location: ["work"] }`
  3. `{ id: 't3', text: 'Anywhere task', dur: 30, pri: P3, location: ["home", "work"] }`
**Action:** Run scheduler
**Expected Outcome:**
- Chains A+B: no overrides, no locScheduleDefaults → fall through to Chain B step 5 (block's `loc` field)
- Steps 1-4 produce no match → step 5 checks `getBlockAtMinute(blocks, minute).loc`
- `t1.location = ["home"]` → placed in morning block (loc="home") or evening block (loc="home")
- `t2.location = ["work"]` → placed in biz1 or biz2 block (loc="work")
- `t3.location = ["home","work"]` → placed in earliest slot (morning at "home")
- `t3` could also be placed during lunch block: block.loc is null → step 6 fallback "home" → "home" is in location array → valid
**Sub-scenarios:**
- [SUB-228a] Block with no `loc` field → step 6 fallback to "home"
- [SUB-228b] Block with `loc = null` → same as no `loc` → falls through to "home"
- [SUB-228c] All blocks have loc=null → all location constraints resolve to "home"
---

---
**ID:** TS-229
**Domain:** Template × Task / Location Template × location
**Title:** All location resolution steps exhausted → default "home" used
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - No `hour_location_overrides`
  - No `loc_schedule_overrides`
  - No `loc_schedule_defaults`
  - No `loc_schedules` templates
  - `time_blocks`: default weekday blocks with ALL `loc` fields set to `null`
- Tasks:
  1. `{ id: 't1', text: 'Home task', dur: 60, pri: P3, location: ["home"] }`
  2. `{ id: 't2', text: 'Work task', dur: 60, pri: P3, location: ["work"] }`
**Action:** Run scheduler
**Expected Outcome:**
- Chain B: no matches at steps 1-4 → step 5 (block.loc) also null → step 6: return `"home"`
- ALL minutes in ALL blocks resolve to "home"
- `t1.location = ["home"]` → match → placed
- `t2.location = ["work"]` → no match → unplaced
**Sub-scenarios:**
- [SUB-229a] This is the ultimate fallback; always produces "home" location even with minimal config
- [SUB-229b] Combined with tool_matrix → home's tool_matrix entry is used
- [SUB-229c] This is the default behavior for any location-constrained task when user hasn't configured any location templates
---

---
**ID:** TS-230
**Domain:** Template × Task / Location Template × location
**Title:** Template change (location shifts) → existing placed tasks re-evaluated on next scheduler run
**Data Setup:**
- T=0: User has `loc_schedule_defaults = { "Mon": "work" }` with `loc_schedules["work"].hours = { 0: "work" }`
- Task `{ id: 't1', text: 'Office task', dur: 60, pri: P3, location: ["work"] }`
- First scheduler run: `t1` placed in morning block at 360
- T=1: User changes `loc_schedule_defaults["Mon"]` to `"remote"` (new template maps all hours to "home")
- Config change triggers scheduler re-run
**Action:** Second scheduler run
**Expected Outcome:**
- Scheduler resets all non-fixed tasks
- `resolveLocationId` now resolves all minutes to "home" (via new template)
- `t1.location = ["work"]` fails → unplaced
- Previous placement at 360 cleared; slot freed for other tasks
**Sub-scenarios:**
- [SUB-230a] Location change only affects specific days → tasks on unaffected days stay placed
- [SUB-230b] Location change adds matching hours → previously unplaced location-constrained tasks become placeable
- [SUB-230c] Location template change + tool matrix interaction → even if location matches, tools may now be missing
- [SUB-230d] Fixed tasks are NOT re-evaluated (Phase 0 immovables); they stay at their declared time regardless of location change
---

## 2.3 Tool Matrix × Task `tools` (TS-231 to TS-235)

---
**ID:** TS-231
**Domain:** Template × Task / Tool Matrix × tools
**Title:** toolMatrix[work] has "laptop" + task tools=["laptop"] → placed during work-location hours
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `tool_matrix`: `{ home: ["phone", "personal_pc"], work: ["phone", "work_pc", "laptop", "printer"], transit: ["phone"] }`
  - `loc_schedule_defaults`: `{ "Mon": "work" }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work" } } }`
  - `time_blocks`: default weekday blocks
- Tasks:
  1. `{ id: 't1', text: 'Laptop work', dur: 60, pri: P3, tools: ["laptop"] }`
  2. `{ id: 't2', text: 'Phone task', dur: 15, pri: P3, tools: ["phone"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `resolveLocationId` returns "work" for all blocks
- `canTaskRunAtMin(t1, minute, cfg)` → location = "work" → tool_matrix["work"] includes "laptop" → PASSES
- `t1` placed in earliest work-hour slot
- `canTaskRunAtMin(t2, minute, cfg)` → tool_matrix["work"] includes "phone" → PASSES
- `t2` placed (anywhere, since phone exists at all locations)
**Sub-scenarios:**
- [SUB-231a] Task with tools=["laptop"] but location resolves to "home" → home doesn't have "laptop" → TOOL constraint fails → unplaced
- [SUB-231b] Task with tools=["printer"] → only work has printer → placed only in work-location blocks
- [SUB-231c] Task with tools=["personal_pc"] → only home has personal_pc → placed only in home-location blocks
- [SUB-231d] Task with multiple tools (AND): tools=["phone", "printer"] → need location where BOTH exist → work is fine, home fails (no printer)
---

---
**ID:** TS-232
**Domain:** Template × Task / Tool Matrix × tools
**Title:** toolMatrix[home] missing "laptop" + task tools=["laptop"] → NOT placed during home-location hours
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `tool_matrix`: `{ home: ["phone", "personal_pc"], work: ["phone", "work_pc", "printer"] }` (no laptop anywhere)
  - `loc_schedule_defaults`: `{ "Mon": "home" }` (working from home today)
  - `loc_schedules`: `{ "home": { hours: { 0: "home" } } }`
- Tasks:
  1. `{ id: 't1', text: 'Need laptop', dur: 60, pri: P3, tools: ["laptop"] }`
  2. `{ id: 't2', text: 'Phone call', dur: 15, pri: P3, tools: ["phone"] }`
**Action:** Run scheduler
**Expected Outcome:**
- `resolveLocationId` returns "home" for all blocks
- `canTaskRunAtMin(t1, minute, cfg)` → location = "home" → tool_matrix["home"] = ["phone", "personal_pc"] → "laptop" NOT present → FAILS
- `t1` unplaced (no location with "laptop" exists)
- `t2.tools = ["phone"]` → tool_matrix["home"] includes "phone" → PASSES → placed
**Sub-scenarios:**
- [SUB-232a] Tool missing at ALL locations → task permanently unplaced until tool is added to some location's matrix
- [SUB-232b] Tool exists at some locations but not the currently resolved one → task unplaced for that day but could be placed on a day with different location
---

---
**ID:** TS-233
**Domain:** Template × Task / Tool Matrix × tools
**Title:** toolMatrix change (tool removed) → existing placed tasks re-evaluated on next scheduler run
**Data Setup:**
- T=0: `tool_matrix = { work: ["phone", "work_pc", "printer", "laptop"] }`
- Task `{ id: 't1', text: 'Laptop task', dur: 60, pri: P3, tools: ["laptop"] }`
- First scheduler run: `t1` placed (work has laptop)
- T=1: User removes "laptop" from tool_matrix["work"]
**Action:** Second scheduler run (triggered by config change)
**Expected Outcome:**
- Scheduler resets non-fixed tasks
- `resolveLocationId` still returns "work"
- `tool_matrix["work"]` no longer includes "laptop" → `canTaskRunAtMin` FAILS
- `t1` unplaced
- Previous slot freed for other tasks
**Sub-scenarios:**
- [SUB-233a] Tool removal from one location but another location still has it → task may still be placed on days at that location
- [SUB-233b] Tool removal affects multiple tasks → all are re-evaluated
- [SUB-233c] Tool added back to matrix → previously unplaced task becomes placeable on next run
---

---
**ID:** TS-234
**Domain:** Template × Task / Tool Matrix × tools
**Title:** toolMatrix change (tool added) → previously unplaced tasks become placeable on next scheduler run
**Data Setup:**
- T=0: `tool_matrix = { home: ["phone", "personal_pc"] }` (no "printer" anywhere)
- Task `{ id: 't1', text: 'Print job', dur: 30, pri: P3, tools: ["printer"] }`
- First scheduler run: `t1` unplaced (no location has "printer")
- T=1: User adds "printer" to tool_matrix["home"] → `tool_matrix = { home: ["phone", "personal_pc", "printer"] }`
- Config change triggers scheduler re-run
**Action:** Second scheduler run
**Expected Outcome:**
- `resolveLocationId` returns "home" (or whatever the day's location resolves to)
- `tool_matrix["home"]` now includes "printer" → `canTaskRunAtMin` PASSES
- `t1` placed at earliest available slot
**Sub-scenarios:**
- [SUB-234a] Tool added to a different location than the one resolved for today → task still unplaced on this day but may be placed on other days
- [SUB-234b] Tool added to multiple locations → task placed at earliest matching location's earliest block
- [SUB-234c] Tool addition triggers automatic scheduler re-run
---

---
**ID:** TS-235
**Domain:** Template × Task / Tool Matrix × tools
**Title:** Task with both location + tools → AND logic through both chains
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "work" }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work" } } }`
  - `tool_matrix`: `{ home: ["phone", "personal_pc"], work: ["phone", "work_pc", "printer"] }`
  - `time_blocks`: blocks with loc fields: morning.loc="home", biz1.loc="work", lunch.loc=null, biz2.loc="work", evening.loc="home", night.loc="home"
- Tasks:
  1. `{ id: 't1', text: 'Print at work', dur: 60, pri: P3, location: ["work"], tools: ["printer"] }`
  2. `{ id: 't2', text: 'Phone at home', dur: 30, pri: P3, location: ["home"], tools: ["phone"] }`
  3. `{ id: 't3', text: 'Printer at home', dur: 30, pri: P3, location: ["home"], tools: ["printer"] }`  (invalid combo)
**Action:** Run scheduler
**Expected Outcome:**
- `t1`: location=["work"] AND tools=["printer"]
  - During biz1/biz2 blocks: resolveLocationId → via defaults → "work" (override: chain B says defaults override block loc? No — step 2: locScheduleOverrides[date]? No. Step 3: locScheduleDefaults['Mon']='work'. Step 4: locSchedules['work'].hours[0]='work' → resolves to "work")
  - location=["work"] → MATCH on location
  - tool_matrix["work"] has "printer" → TOOL MATCH
  - `t1` placed in work block (biz1 or biz2)
- `t2`: location=["home"] AND tools=["phone"]
  - During morning block: resolveLocationId → chain B steps 1-4 miss → step 5: morning.loc="home" → "home"
  - location=["home"] → MATCH
  - tool_matrix["home"] has "phone" → TOOL MATCH
  - `t2` placed in morning block at 360
- `t3`: location=["home"] AND tools=["printer"]
  - During morning block: location resolves to "home" → location MATCH
  - tool_matrix["home"] = ["phone", "personal_pc"] → NO "printer" → TOOL FAILS
  - `t3` unplaced
**Sub-scenarios:**
- [SUB-235a] Location AND both pass → placed; either fails → unplaced
- [SUB-235b] Location passes but tools fail → task goes to stillUnplaced, not deferred
- [SUB-235c] AND logic is strict: cannot relax one constraint independently (only via flexWhen or fallback passes)
- [SUB-235d] Travel buffer combined with location+tool → buffer time also must be at matching location
---

## 2.4 Combined Template Interactions (TS-236 to TS-242)

---
**ID:** TS-236
**Domain:** Template × Task / Combined
**Title:** Holiday template (no blocks) + location override → task unplaced regardless of location
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `template_overrides`: `{ "2026-06-15": "holiday" }` (no blocks)
  - `loc_schedule_overrides`: `{ "2026-06-15": "work" }` (but no blocks to apply it to!)
  - `schedule_templates`: `{ "holiday": { blocks: [] } }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work" } } }`
- Tasks:
  1. `{ id: 't1', text: 'Office task', dur: 60, pri: P3, location: ["work"] }`
**Action:** Run scheduler
**Expected Outcome:**
- Chain A: `template_overrides['2026-06-15']='holiday'` → `scheduleTemplates['holiday'].blocks = []`
- `getBlocksForDate` returns `[]` → no blocks at all
- Even though Chain B would resolve to "work", there are no time blocks to place tasks in
- `t1` unplaced because Chain A produced zero windows
**Sub-scenarios:**
- [SUB-236a] Holiday template overrides ALL scheduling regardless of location or tool constraints
- [SUB-236b] Only fixed tasks (Phase 0 immovables) and anytime (when="") survive — fixed through immovability, anytime through by-pass of block windows
---

---
**ID:** TS-237
**Domain:** Template × Task / Combined
**Title:** Travel day template + location override → task placed only where both chains allow
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `template_overrides`: `{ "2026-06-15": "travel" }`
  - `schedule_templates`: `{ "travel": { blocks: [{ id: "morning_flight", tag: "morning", start: 360, end: 540, loc: "transit" }, { id: "hotel_work", tag: "biz1", start: 660, end: 900, loc: "hotel" }] } }`
  - `loc_schedule_overrides`: `{ "2026-06-15": "travel_loc" }`
  - `loc_schedules`: `{ "travel_loc": { hours: { 0: "transit", 660: "hotel" } } }`
- Tasks:
  1. `{ id: 't1', text: 'Transit task', dur: 60, pri: P3, when: "morning", location: ["transit"] }`  — both match transit
  2. `{ id: 't2', text: 'Hotel work', dur: 60, pri: P3, when: "biz1", location: ["hotel"] }`  — both match hotel
  3. `{ id: 't3', text: 'Office task', dur: 30, pri: P3, when: "biz1", location: ["work"] }`  — time OK, location wrong
  4. `{ id: 't4', text: 'Morning home task', dur: 30, pri: P3, when: "morning", location: ["home"] }`  — time OK, location wrong
**Action:** Run scheduler
**Expected Outcome:**
- Chain A → travel blocks: morning(360-540), biz1(660-900)
- Chain B:
  - For minutes 360-539: resolveLocationId → locScheduleOverrides → travel_loc hours[0]="transit" → "transit"
  - For minutes 660-899: resolveLocationId → travel_loc hours[660]="hotel" → "hotel"
- `t1`: when="morning" AND location=["transit"] → placed at 360-420 (transit slot)
- `t2`: when="biz1" AND location=["hotel"] → placed at 660-720 (hotel slot)
- `t3`: when="biz1" matches → time OK, but location resolves to "hotel" not "work" → LOCATION FAILS → unplaced
- `t4`: when="morning" matches → time OK, but location resolves to "transit" not "home" → LOCATION FAILS → unplaced
**Sub-scenarios:**
- [SUB-237a] Both chains must independently pass; neither can compensate for the other
- [SUB-237b] If day has blocks but location never matches, all location-constrained tasks unplaced
- [SUB-237c] If day has location matches but no blocks for the task's when-tag, all when-constrained tasks unplaced
---

---
**ID:** TS-238
**Domain:** Template × Task / Combined
**Title:** Template with no blocks but task when=anytime → placed in default anytime window
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `template_overrides`: `{ "2026-06-15": "empty" }`
  - `schedule_templates`: `{ "empty": { blocks: [] } }`
- Tasks:
  1. `{ id: 't1', text: 'Anytime task', dur: 30, pri: P3 }`  (when="" = anytime)
  2. `{ id: 't2', text: 'Morning task', dur: 30, pri: P3, when: "morning" }`
**Action:** Run scheduler
**Expected Outcome:**
- `getBlocksForDate` returns `[]`
- `t1` (when=""): `getWhenWindows("", windows)` → maps to ALL blocks → `windows[""]` returns `[[GRID_START, GRID_END]]` = `[[360, 1380]]` — the anytime window is synthetic, not block-derived
- `t1` placed at 360-390 (earliest slot in synthetic anytime window)
- `t2` (when="morning"): `getWhenWindows("morning", {})` → empty → unplaced
**Sub-scenarios:**
- [SUB-238a] Anytime window always exists regardless of template, as long as `GRID_START < GRID_END`
- [SUB-238b] This is why anytime tasks survive holiday templates but when-tag tasks don't
---

---
**ID:** TS-239
**Domain:** Template × Task / Combined
**Title:** Template with blocks but no loc field + task location=["work"] → falls through to default "home" → fails
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `time_blocks`: default weekday blocks with ALL `loc` fields set to `null`
  - No `loc_schedule_defaults`, `loc_schedule_overrides`, `hour_location_overrides`, `loc_schedules`
- Tasks:
  1. `{ id: 't1', text: 'Work task', dur: 60, pri: P3, location: ["work"] }`
  2. `{ id: 't2', text: 'Home task', dur: 30, pri: P3, location: ["home"] }`
**Action:** Run scheduler
**Expected Outcome:**
- Chain A: blocks exist → windows exist → `t1` and `t2` have time windows
- Chain B: no matches at steps 1-5 → step 6 returns "home" for all minutes
- `t1.location = ["work"]` → resolved location "home" is NOT in ["work"] → FAILS → unplaced
- `t2.location = ["home"]` → resolved location "home" IS in ["home"] → PASSES → placed
**Sub-scenarios:**
- [SUB-239a] User has blocks configured but no location templates → all location-constrained tasks except "home" tasks fail
- [SUB-239b] This is an important UX gap: blocks exist but location resolution is degenerate
- [SUB-239c] Tool_matrix["home"] used when all locations fall through to "home"
---

---
**ID:** TS-240
**Domain:** Template × Task / Combined
**Title:** Template with blocks + loc field + toolMatrix → full chain exercised
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `time_blocks`: custom blocks: `[{ id: "home_morning", tag: "morning", start: 360, end: 660, loc: "home" }, { id: "work_biz", tag: "biz", start: 720, end: 1080, loc: "work" }]`
  - `tool_matrix`: `{ home: ["phone", "personal_pc"], work: ["phone", "work_pc", "laptop"] }`
  - No location templates/overrides (fall through to block.loc)
- Tasks:
  1. `{ id: 't1', text: 'Personal laptop task', dur: 60, pri: P3, when: "morning", location: ["home"], tools: ["personal_pc"] }`
  2. `{ id: 't2', text: 'Work laptop task', dur: 60, pri: P3, when: "biz", location: ["work"], tools: ["laptop"] }`
  3. `{ id: 't3', text: 'Home laptop task in biz time', dur: 30, pri: P3, when: "biz", location: ["home"], tools: ["personal_pc"] }`  (want home during biz block — impossible)
**Action:** Run scheduler
**Expected Outcome:**
- For home_morning block (360-660):
  - Chain B step 5: block.loc = "home" → resolves to "home"
  - tool_matrix["home"] = ["phone", "personal_pc"]
  - `t1`: when="morning" ✓, location=["home"] ✓ (resolved to "home"), tools=["personal_pc"] ✓ (home has it) → PLACED at 360-420
- For work_biz block (720-1080):
  - Chain B step 5: block.loc = "work" → resolves to "work"
  - tool_matrix["work"] = ["phone", "work_pc", "laptop"]
  - `t2`: when="biz" ✓, location=["work"] ✓, tools=["laptop"] ✓ (work has it) → PLACED at 720-780
  - `t3`: when="biz" ✓, but location=["home"] → resolved "work" ≠ "home" → LOCATION FAILS → unplaced
**Sub-scenarios:**
- [SUB-240a] Full chain exercises all 6 slot-eligibility checks in sequence
- [SUB-240b] Adding weather constraints would exercise check #5 as well
- [SUB-240c] Block's loc field can be overridden by higher-priority Chain B steps
---

---
**ID:** TS-241
**Domain:** Template × Task / Combined
**Title:** Config change triggers scheduler re-run → all template effects re-evaluated
**Data Setup:**
- T=0: User has weekday blocks + work location. Tasks all placed.
- T=1: User changes template_overrides to "holiday" for today AND modifies loc_schedule_overrides to "remote" for today
**Action:** Config change → `enqueueScheduleRun` called
**Expected Outcome:**
- Scheduler runs after 2000ms debounce
- ALL tasks are reset (non-fixed)
- New template (holiday — no blocks) + new location (remote — all home) applied
- Previously placed tasks re-evaluated:
  - When-tag tasks with no matching blocks → unplaced
  - Location-constrained tasks → checked against new location (all home)
- Fixed tasks remain at their declared times (Phase 0 exempt)
**Sub-scenarios:**
- [SUB-241a] Single config change triggers single scheduler run
- [SUB-241b] Multiple simultaneous config changes trigger single scheduler run (debounced)
- [SUB-241c] Config change enqueues run for the correct user only
---

---
**ID:** TS-242
**Domain:** Template × Task / Combined
**Title:** Multiple config changes in rapid succession → debounced, single scheduler run
**Data Setup:**
- T=0: stable config, tasks placed
- T=1+0ms: Change template_overrides (triggers enqueue)
- T=1+500ms: Change loc_schedule_defaults (triggers enqueue)
- T=1+1200ms: Change tool_matrix (triggers enqueue)
**Action:** Three config changes within 2000ms window
**Expected Outcome:**
- Each change calls `enqueueScheduleRun`
- Debounce mechanism (2000ms quiet period) coalesces all three into ONE actual scheduler run
- The scheduler run happens at T=1+3200ms (2000ms after the last trigger)
- The single run applies all three changes simultaneously
- Rate limit (10 runs/min) decrements by 1, not 3
**Sub-scenarios:**
- [SUB-242a] Debounce window is per-user; different users' changes are independent
- [SUB-242b] Debounce resets on each new trigger within the window
- [SUB-242c] After the coalesced run completes, the next trigger starts a fresh debounce window
- [SUB-242d] Rapid changes beyond rate limit (10/min) → excess runs are dropped
---

## 2.5 Template Edge Cases (TS-243 to TS-250)

---
**ID:** TS-243
**Domain:** Template × Task / Edge Cases
**Title:** locScheduleOverrides references non-existent templateId → fall through to day-of-week blocks and block loc field
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_overrides`: `{ "2026-06-15": "nonexistent_template" }`
  - `loc_schedules`: `{ }` (no templates defined)
  - `loc_schedule_defaults`: `{ "Mon": "work" }`
  - `loc_schedules`: `{ "work": { hours: { 0: "work" } } }`
  - `time_blocks`: default blocks with block.loc="home" on morning, block.loc="work" on biz1/biz2, etc.
- Tasks:
  1. `{ id: 't1', text: 'Work task', dur: 60, pri: P3, location: ["work"] }`
**Action:** Run scheduler
**Expected Outcome:**
- Chain B step 2: `locScheduleOverrides['2026-06-15'] = "nonexistent_template"`
  - Looks up `locSchedules["nonexistent_template"]` → undefined → step 2 partially matches but cannot resolve → fall through to step 3
- Step 3: `locScheduleDefaults['Mon'] = "work"` → templateId = "work"
- Step 4: `locSchedules["work"].hours[0] = "work"` → resolves to "work"
- `t1.location = ["work"]` → match → placed
- The override was ignored gracefully because the referenced template doesn't exist
**Sub-scenarios:**
- [SUB-243a] Non-existent template in override → logs warning but doesn't crash
- [SUB-243b] Fallthrough from step 2 to step 3 uses locScheduleDefaults normally
- [SUB-243c] If locScheduleDefaults also missing → step 4 missing → step 5 (block.loc) → step 6 (default "home")
---

---
**ID:** TS-244
**Domain:** Template × Task / Edge Cases
**Title:** locSchedules references non-existent templateId → fall through to block loc field
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `loc_schedule_defaults`: `{ "Mon": "nonexistent" }`
  - `loc_schedules`: `{ }` (no templates — not even the referenced one)
  - `time_blocks`: default blocks with `morning.loc = "home"`, `biz1.loc = "work"`, etc.
- Tasks:
  1. `{ id: 't1', text: 'Work task', dur: 60, pri: P3, location: ["work"] }`
  2. `{ id: 't2', text: 'Home task', dur: 30, pri: P3, location: ["home"] }`
**Action:** Run scheduler
**Expected Outcome:**
- Steps 1-2: no hourOverride, no dateOverride
- Step 3: `locScheduleDefaults['Mon'] = "nonexistent"` → templateId = "nonexistent"
- Step 4: `locSchedules["nonexistent"]` → undefined → no template hours → fall through
- Step 5: `getBlockAtMinute(blocks, minute).loc` → checked for each minute
- During morning block (360-480, loc="home") → resolves to "home"
- During biz1 block (480-720, loc="work") → resolves to "work"
- `t1.location = ["work"]` → placed in biz1 (loc="work")
- `t2.location = ["home"]` → placed in morning (loc="home")
**Sub-scenarios:**
- [SUB-244a] Non-existent templateId in defaults → logs warning, graceful fallthrough
- [SUB-244b] If blocks also have no loc → step 6 default "home" used
---

---
**ID:** TS-245
**Domain:** Template × Task / Edge Cases
**Title:** Template with overlapping blocks → deduplicated windows
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `template_overrides`: `{ "2026-06-15": "overlap" }`
  - `schedule_templates`: `{ "overlap": { blocks: [{ id: "b1", tag: "morning", start: 360, end: 600 }, { id: "b2", tag: "focus", start: 480, end: 720 }, { id: "b3", tag: "biz", start: 600, end: 840 }] } }`
    - b1=morning 360-600, b2=focus 480-720, b3=biz 600-840
    - b1 and b2 overlap at 480-600 (2h overlap)
- Tasks:
  1. `{ id: 't1', text: 'Morning task', dur: 60, pri: P3, when: "morning" }`
  2. `{ id: 't2', text: 'Focus task', dur: 120, pri: P3, when: "focus" }`
  3. `{ id: 't3', text: 'Biz task', dur: 60, pri: P3, when: "biz" }`
**Action:** Run scheduler
**Expected Outcome:**
- `buildWindowsFromBlocks(blocks)` should deduplicate overlapping windows, or at minimum produce non-overlapping placement slots
- Windows by tag: morning=[360,600], focus=[480,720], biz=[600,840]
- If no dedup: overlapping slots (e.g. 480-600) may be double-counted in capacity
- With dedup: overlapping regions should be allocated to only one block's capacity OR windows should be merged into non-overlapping union segments
- `t1` placed at oldest morning slot (360-420)
- `t2` placed at oldest focus slot (480-600)
- `t3` placed at 600-660 (start of biz block, no overlap)
**Sub-scenarios:**
- [SUB-245a] Completely overlapping blocks (same start and end) → only one effective window
- [SUB-245b] Block A fully contained within Block B → only larger block considered for capacity
- [SUB-245c] Three-way overlap → all deduplicated correctly
---

---
**ID:** TS-246
**Domain:** Template × Task / Edge Cases
**Title:** Template with zero-duration blocks (start=end) → skipped
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `template_overrides`: `{ "2026-06-15": "zeroblocks" }`
  - `schedule_templates`: `{ "zeroblocks": { blocks: [{ id: "good_morning", tag: "morning", start: 360, end: 480 }, { id: "zero_block", tag: "biz", start: 600, end: 600 }] } }`
    - `zero_block` has start=end=600 → zero duration
- Tasks:
  1. `{ id: 't1', text: 'Morning task', dur: 60, pri: P3, when: "morning" }`
  2. `{ id: 't2', text: 'Biz task', dur: 30, pri: P3, when: "biz" }`
**Action:** Run scheduler
**Expected Outcome:**
- `buildWindowsFromBlocks` should skip any block where `start >= end`
- Windows produced: morning=[360,480]; biz tag has no valid window (zero-block skipped)
- `t1` placed at 360-420 (morning block)
- `t2` unplaced (biz window is empty after filtering zero-duration block)
**Sub-scenarios:**
- [SUB-246a] Block with negative duration (start > end) → also skipped
- [SUB-246b] All blocks zero-duration → no windows → only anytime tasks placed
- [SUB-246c] Zero-duration block with tag that exists on other valid blocks → valid blocks still provide windows for that tag
---

---
**ID:** TS-247
**Domain:** Template × Task / Edge Cases
**Title:** Template with blocks outside GRID_START..GRID_END → clamped
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `template_overrides`: `{ "2026-06-15": "extreme" }`
  - `schedule_templates`: `{ "extreme": { blocks: [{ id: "pre_dawn", tag: "early", start: 180, end: 400 }, { id: "post_dusk", tag: "late", start: 1300, end: 1500 }, { id: "normal", tag: "day", start: 480, end: 720 }] } }`
    - pre_dawn: 180-400 (3:00 AM - 6:40 AM) — starts before GRID_START(360)
    - post_dusk: 1300-1500 (9:40 PM - 1:00 AM) — ends after GRID_END(1380)
- Tasks:
  1. `{ id: 't1', text: 'Early task', dur: 30, pri: P3, when: "early" }`
  2. `{ id: 't2', text: 'Late task', dur: 60, pri: P3, when: "late" }`
  3. `{ id: 't3', text: 'Day task', dur: 60, pri: P3, when: "day" }`
**Action:** Run scheduler
**Expected Outcome:**
- Block clamping: each block's interval intersected with [GRID_START, GRID_END] = [360, 1380]
- pre_dawn: original [180,400] → clamped [max(180,360), min(400,1380)] = [360, 400] → valid (40 min window)
- post_dusk: original [1300,1500] → clamped [max(1300,360), min(1500,1380)] = [1300, 1380] → valid (80 min window)
- normal: original [480,720] → within range → unchanged
- After clamping:
  - `t1.when = "early"` → window [360,400] → placed at 360-390 (earliest slot)
  - `t2.when = "late"` → window [1300,1380] → placed at 1300-1360
  - `t3.when = "day"` → window [480,720] → placed at 480-540
**Sub-scenarios:**
- [SUB-247a] Block entirely before GRID_START (e.g. [0, 300]) → after clamping becomes [360,360] → zero duration → skipped
- [SUB-247b] Block entirely after GRID_END (e.g. [1400, 1440]) → after clamping becomes [1380,1380] → zero duration → skipped
- [SUB-247c] Block spanning GRID_START from outside → only in-range portion usable
---

---
**ID:** TS-248
**Domain:** Template × Task / Edge Cases
**Title:** Template change while tasks are in-flight (scheduler running) → next run picks up changes
**Data Setup:**
- T=0: Scheduler begins execution (Phase 1 processing queue)
- T=0+500ms: While scheduler is running, user changes template_overrides
- T=0+1500ms: Scheduler finishes (used old template)
**Action:** Config change during scheduler execution
**Expected Outcome:**
- The running scheduler completes with the config snapshot taken at start time
- The in-flight config change triggers `enqueueScheduleRun` after the current run completes
- A new scheduler run starts with the updated config
- No data corruption: old and new runs don't interleave
- Final state reflects the new config (placement uses updated template)
**Sub-scenarios:**
- [SUB-248a] Config change completes before scheduler run starts → run uses new config
- [SUB-248b] Scheduler runs, then config change → next run picks up changes
- [SUB-248c] Two config changes during a scheduler run → both coalesced into single post-run queue entry
---

---
**ID:** TS-249
**Domain:** Template × Task / Edge Cases
**Title:** Template with no blocks and no fallback → blocksMap.Mon || [] → empty → all when-tag tasks unplaced
**Data Setup:**
- Clock: fixed at `2026-06-15T07:00:00Z` (Monday)
- User config:
  - `time_blocks`: `{ }` (empty — no blocks defined for any day)
  - `template_defaults`: not defined
  - `template_overrides`: none
  - No `schedule_templates` at all
- Tasks:
  1. `{ id: 't1', text: 'Morning task', dur: 30, pri: P3, when: "morning" }`
  2. `{ id: 't2', text: 'Anytime task', dur: 30, pri: P3, placementMode: 'anytime' }`
  3. Fixed task: `{ id: 't3', text: 'Standup', dur: 30, placementMode: 'fixed', date: '2026-06-15', time: '09:00' }`
**Action:** Run scheduler
**Expected Outcome:**
- Chain A: no overrides → `blocksMap['Mon']` → undefined or `[]` (empty blocksMap) → `blocksMap.Mon || []` → `[]`
- `getBlocksForDate` returns `[]`
- `t1.when = "morning"` → no blocks → no matching windows → unplaced
- `t2` (anytime, when="") → the anytime synthetic window `[GRID_START, GRID_END]` = `[360, 1380]` exists regardless of blocks → placed
- `t3` (fixed) → Phase 0 immovables → placed at 09:00 regardless of blocks
**Sub-scenarios:**
- [SUB-249a] Empty blocksMap is a valid configuration (user has no blocks defined)
- [SUB-249b] In this state, only anytime and fixed tasks are schedulable
- [SUB-249c] When tasks with flexWhen=true → fallback passes could still fail because block windows are empty (flexWhen relaxes `when` constraint but doesn't create blocks)
- [SUB-249d] UI warning should indicate no blocks configured
---

---
**ID:** TS-250
**Domain:** Template × Task / Edge Cases
**Title:** Template with blocks that have no loc field → all resolve to "home"
**Data Setup:**
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- User config:
  - `time_blocks`: default weekday blocks with ALL `loc` fields omitted/null
  - No `loc_schedule_defaults`, `loc_schedule_overrides`, `hour_location_overrides`, or `loc_schedules`
  - No location templates at all
- Tasks:
  1. `{ id: 't1', text: 'Home task', dur: 60, pri: P3, location: ["home"] }`
  2. `{ id: 't2', text: 'Office task', dur: 60, pri: P3, location: ["office"] }`
  3. `{ id: 't3', text: 'Task with tools', dur: 30, pri: P3, tools: ["personal_pc"] }`
**Action:** Run scheduler
**Expected Outcome:**
- Chain B steps 1-5: all miss (no config, no block loc) → step 6: default `"home"`
- ALL minutes in ALL blocks resolve to "home"
- `t1.location = ["home"]` → match → placed
- `t2.location = ["office"]` → no match → unplaced
- For `t3`:
  - `canTaskRunAtMin(t3, minute, cfg)` → resolved location = "home" → tool_matrix["home"] = ["phone", "personal_pc"] → "personal_pc" present → PASSES
  - `t3` placed (has tool at the default location)
**Sub-scenarios:**
- [SUB-250a] `tool_matrix` for "home" is used when all locations fall through to "home"
- [SUB-250b] If `tool_matrix["home"]` is also undefined/empty → any non-empty tools constraint fails → unplaced
- [SUB-250c] This is the minimum-viable config: blocks exist but no location info → everything resolves to "home"
- [SUB-250d] Adding `loc` fields to blocks later → existing tasks re-evaluated on next scheduler run
---

# 3. Sub-Scenario Index

This section groups sub-scenarios by theme for convenience.

## 3.1 Non-Existent Reference Fallthroughs
| Sub-ID | Parent | Description |
|--------|--------|-------------|
| SUB-207a | TS-207 | `template_overrides` references non-existent templateId |
| SUB-209a | TS-209 | `loc_schedule_overrides` references non-existent templateId |
| SUB-213d | TS-213 | `template_overrides` references non-existent template → fall through |
| SUB-243 | TS-243 | `locScheduleOverrides` non-existent template → fall through to day-of-week |
| SUB-244 | TS-244 | `loc_schedules` non-existent template → fall through to block loc |

## 3.2 Clamping & Zero-Duration
| Sub-ID | Parent | Description |
|--------|--------|-------------|
| SUB-213a | TS-213 | Blocks outside GRID_START…GRID_END → clamped |
| SUB-213b | TS-213 | Zero-duration blocks (start=end) → skipped |
| SUB-245 | TS-245 | Overlapping blocks → deduplication |
| SUB-246 | TS-246 | Zero-duration blocks → skipped |
| SUB-247 | TS-247 | Blocks outside grid bounds → clamped to range |

## 3.3 Config Change Triggers
| Sub-ID | Parent | Description |
|--------|--------|-------------|
| SUB-214a | TS-214 | Multiple rapid changes → debounced |
| SUB-212a | TS-212 | `temperatureUnit` change triggers re-run |
| SUB-241 | TS-241 | Single config change triggers single re-run |
| SUB-242 | TS-242 | Multiple rapid changes → single debounced run |
| SUB-248 | TS-248 | Change during in-flight scheduler → next run |

## 3.4 Fixed Tasks Exempt from Template Effects
| Sub-ID | Parent | Description |
|--------|--------|-------------|
| SUB-207b | TS-207 | Fixed placed regardless of override |
| SUB-216 | TS-216 | Fixed survives holiday template |
| SUB-220c | TS-220 | Fixed unaffected by block removal |
| SUB-230d | TS-230 | Fixed unaffected by location change |
| SUB-249 | TS-249 | Fixed placed even with empty blocksMap |

## 3.5 Location × Tool AND Logic
| Sub-ID | Parent | Description |
|--------|--------|-------------|
| SUB-211a | TS-211 | Both location+tool required |
| SUB-235 | TS-235 | Full AND logic test |
| SUB-231d | TS-231 | Multiple tools (AND) |
| SUB-235a | TS-235 | Either fails → unplaced |

## 3.6 Recurring Across Templates
| Sub-ID | Parent | Description |
|--------|--------|-------------|
| SUB-222 | TS-222 | Recurring across different templates per day |
| SUB-222b | TS-222 | Single occurrence unplaced, others unaffected |
| SUB-222d | TS-222 | Template change mid-week |

---

*End of Test Specs — User Config & Template × Task Interaction (TS-207 to TS-250)*