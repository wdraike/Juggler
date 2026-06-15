# Juggler Scheduler — Full Structured Test Specs
## Scheduler Phases | Reschedule Triggers | Calendar Sync

**Updated:** 2026-06-15  
**Scope:** TS-163 through TS-206

---

## Format Legend

Each test spec includes:
- **ID** — Test scenario identifier
- **Domain** — Feature area
- **Title** — One-line description
- **Data Setup** — Preconditions, clock, master task config, existing instances
- **Action** — What triggers the behavior (scheduler run / status change / cron)
- **Expected Outcome** — What must happen (instances generated, placements, statuses)
- **Sub-scenarios** — Related edge cases that should also be covered

---

# 1. Scheduler Phases (TS-163 to TS-175)

The v2 scheduler (`unifiedScheduleV2.js`) runs 8 sequential phases. All phases share the same `dayOcc` occupancy grid — earlier phases claim capacity that later phases must respect. Phases run after the main slack-sorted queue loop completes.

### Phase 0 — Immovables (TS-163)

Fixed, pinned, rigid-recurring with anchor, and markers with anchor. Placed at exact time via `tryPlaceAtTime`. Exempt from reset. They claim their slots *before* the slack-sorted queue is built, so other items' slack reflects actual occupancy.

---
**ID:** TS-163  
**Domain:** Scheduler Phases / Phase 0 Immovables  
**Title:** Fixed tasks placed at exact time — exempt from reset  
**Data Setup:**
- User config: default time_blocks (e.g. morning 7-12, afternoon 12-5)
- Clock: fixed at `2026-06-15T08:00:00Z` (Monday)
- Tasks:
  1. Fixed task: `{ id: 'fixed-1', text: '9am meeting', dur: 60, pri: P3, placementMode: 'fixed', date: '2026-06-15', time: '09:00' }`
  2. Anytime task: `{ id: 'any-1', text: 'flex work', dur: 30, pri: P3, placementMode: 'anytime' }`
- First run: scheduler places both
- Second run: scheduler resets and re-places
**Action:** Run scheduler twice
**Expected Outcome:**
- After both runs, `fixed-1` is still at `2026-06-15 09:00`
- `fixed-1` has no `_overdue` or `_conflict` flags
- `any-1` has been reset and re-placed to earliest available slot (different from first run)
**Sub-scenarios:**
- [SUB-163a] Multiple fixed tasks at same time → both placed via `tryPlaceAtTime`, second sees dayOcc already occupied, falls through to queue or conflict placement
- [SUB-163b] Fixed + recurring fixed (rigid with anchorMin) → both exempt from reset, placed at their exact times
- [SUB-163c] Drag-pinned fixed — created by drag-drop → also exempt from reset (isPinned flag)
- [SUB-163d] Marker with anchorDate + anchorMin → placed via immovable path (dur=0, reserve is no-op); appears on calendar without blocking time
- [SUB-163e] Marker WITHOUT anchorMin → NOT immovable; falls through to slack-sorted queue with dur=0, lands at earliest eligible window slot
- [SUB-163f] Fixed task scheduled in the past (time < nowMins) → still placed immovably at its declared time; other tasks respect the occupancy block even if it's already started
- [SUB-163g] Fixed task with `when` tag matching time block → placed at exact declared time, not repositioned to block start

---
**ID:** TS-163a  
**Domain:** Scheduler Phases / Phase 0 Immovables  
**Title:** Rigid recurring with anchor — immovable when slot is clear, queued when conflict  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Tasks:
  1. Fixed task: `{ id: 'fixed-1', text: 'Standup', dur: 30, placementMode: 'fixed', date: '2026-06-15', time: '09:00' }`
  2. Rigid recurring: `{ id: 'rigid-1', text: 'Daily sync', dur: 30, recurring: true, isRigid: true, anchorDate: '2026-06-15', anchorMin: 540 (9:00 AM), recur: { type: 'daily' } }`
**Action:** Run scheduler
**Expected Outcome:**
- `fixed-1` is placed at 09:00 via Phase 0
- `rigid-1` detects task conflict at 09:00 (fixed-1 already occupies 09:00-09:30) → does NOT place immovably → enters the queue
- `rigid-1` is placed at the next available non-overlapping slot (e.g. 09:30) via the slack-sorted queue
- If no slot available in the day, `rigid-1` is force-placed by Phase 6 with `_conflict: true, locked: true`

---

### Phase 1 — Queue (TS-164)

All non-immovable items, slack-sorted by `(slack asc, pri asc, dur desc, id)`. Each item goes through `tryPlaceQueued` → 4-level fallback ladder.

---
**ID:** TS-164  
**Domain:** Scheduler Phases / Phase 1 Queue  
**Title:** Slack-sorted queue processes constrained items in most-constrained-first order  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Tasks:
  1. Tight deadline: `{ id: 'tight-1', text: 'Due today', dur: 60, pri: P3, placementMode: 'anytime', deadline: '2026-06-15' }`
  2. Flexible far-out: `{ id: 'flex-1', text: 'Due next week', dur: 30, pri: P3, placementMode: 'anytime', deadline: '2026-06-22' }`
  3. High-priority: `{ id: 'high-1', text: 'Important', dur: 45, pri: P1, placementMode: 'anytime' }`
- Only one free slot: `2026-06-15 08:00-09:00` (60 min window before a fixed meeting)
**Action:** Run scheduler
**Expected Outcome:**
- `tight-1` (slack=0, has deadline today) is placed first at 08:00-09:00
- `high-1` (pri=P1, no deadline) is placed next at earliest available slot on later date
- `flex-1` (pri=P3, slack=7 days) is placed last
- Sort order is strictly: slack asc, then pri asc, then dur desc, then id

---
**ID:** TS-164a  
**Domain:** Scheduler Phases / Phase 1 Queue  
**Title:** Dynamic slack recompute after each placement  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Tasks (all with deadline `2026-06-15`, same pri=P3, same dur=30):
  1. `{ id: 'a-1', text: 'Task A' }`
  2. `{ id: 'b-1', text: 'Task B' }`
  3. `{ id: 'c-1', text: 'Task C' }`
- Only one morning block: 08:00-09:00 (4 slots of 15 min)
**Action:** Run scheduler
**Expected Outcome:**
- After each placement, remaining items whose eligible range includes the consumed slot date have their capacity subtracted and slack recomputed
- Items that couldn't have used that slot (earliest > slot date or deadline < slot date) keep existing slack unchanged
- All 3 tasks are placed within the single morning block, packed consecutively
- `slackByTaskId` reflects final values

---
**ID:** TS-164b  
**Domain:** Scheduler Phases / Phase 1 Queue  
**Title:** Infinite-slack (free) tasks do not trigger recompute  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Tasks:
  1. Free task: `{ id: 'free-1', text: 'Someday', dur: 60, pri: P5, placementMode: 'anytime' }`
  2. Constrained: `{ id: 'con-1', text: 'Due soon', dur: 30, pri: P3, deadline: '2026-06-16' }`
**Action:** Run scheduler
**Expected Outcome:**
- `free-1` has `slack=Infinity` or `null` → treated as sentinel, not a real budget
- When `free-1` is placed, no capacity recompute runs for other items
- `con-1` is placed with correct slack unaffected by `free-1`'s placement

---
**ID:** TS-164c  
**Domain:** Scheduler Phases / Phase 1 Queue  
**Title:** Split task inline expansion during queue phase  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Task: `{ id: 'split-1', text: 'Long task', dur: 180, split: true, splitMin: 60, placementMode: 'anytime' }`
- Available windows: morning 08:00-10:00 (120min), afternoon 13:00-15:00 (120min)
**Action:** Run scheduler
**Expected Outcome:**
- `split-1` cannot fit as a single 180-min block → not placed by `tryPlaceQueued`
- Inline split expansion fires: places 120-min chunk in morning, 60-min chunk in afternoon
- Each chunk is a separate `dayPlacements` entry with the same task object
- `placedById` records the first chunk's slot for dependency-ordering
- Partial placement (if remaining > 0) → task marked with `_unplacedReason='partial_split'`

---
**ID:** TS-164d  
**Domain:** Scheduler Phases / Phase 1 Queue  
**Title:** Dependency-gating in findEarliestSlot — dep not placed yet → skip candidate slot  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Tasks:
  1. Predecessor: `{ id: 'pre-1', text: 'Prep work', dur: 60, pri: P3, placementMode: 'anytime' }`
  2. Successor: `{ id: 'suc-1', text: 'Finalize', dur: 30, pri: P3, dependsOn: ['pre-1'], placementMode: 'anytime' }`
**Action:** Run scheduler
**Expected Outcome:**
- `suc-1` enters queue before `pre-1` due to slack ordering
- `findEarliestSlot` checks `depReadyAbs` → dep `pre-1` not in `placedById` → `depReadyAbs=-Infinity` → the dep-met check rejects all slots
- `suc-1` is deferred (`_deferred=true`) to the retry pass
- After `pre-1` is placed in a later iteration, `suc-1` is placed in the retry pass

---

### Phase 2 — Retry (TS-165)

Items deferred in Phase 1 due to unmet dependencies get one retry pass after the main loop completes.

---
**ID:** TS-165  
**Domain:** Scheduler Phases / Phase 2 Retry  
**Title:** Deferred dep-blocked items are retried once after main loop  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Diamond DAG:
  1. `{ id: 'a', text: 'Root', dur: 30, pri: P3 }`
  2. `{ id: 'b', text: 'Mid-1', dur: 30, pri: P3, dependsOn: ['a'] }`
  3. `{ id: 'c', text: 'Mid-2', dur: 30, pri: P3, dependsOn: ['a'] }`
  4. `{ id: 'd', text: 'Leaf', dur: 30, pri: P3, dependsOn: ['b', 'c'] }`
**Action:** Run scheduler
**Expected Outcome:**
- Main loop may place items in non-topological order
- Items that couldn't place due to deps are tagged `_deferred=true`
- Retry pass iterates only `_deferred` items, clears the flag, calls `tryPlaceQueued` again
- After retry, all 4 items are placed in dependency-satisfied order
- `stillUnplaced` contains only items that were NOT deferred (other failures)
- Only one retry pass (not iterative); pathological multi-level chains may still fail

---
**ID:** TS-165a  
**Domain:** Scheduler Phases / Phase 2 Retry  
**Title:** Retry pass does NOT retry non-deferred items  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Tasks:
  1. Capacity-failed item: `{ id: 'no-space', text: 'Too big', dur: 600, pri: P3 }`
  2. Normal item: `{ id: 'normal', text: 'Fits fine', dur: 30, pri: P3 }`
- Only 120 total minutes of capacity
**Action:** Run scheduler
**Expected Outcome:**
- `no-space` fails placement (capacity exceeded) → but is NOT `_deferred` → goes to `stillUnplaced` directly
- Retry pass only processes `_deferred` items → `no-space` is NOT retried
- `no-space` remains unplaced with `_unplacedReason` set

---
**ID:** TS-165b  
**Domain:** Scheduler Phases / Phase 2 Retry  
**Title:** Retry-placed items get overdue/relaxed flags if applicable  
**Data Setup:**
- Task A: due today, dep on Task B
- Task B: placed late in main loop in afternoon
- Task A has slack < 0 after waiting
**Action:** Run scheduler
**Expected Outcome:**
- Task A retry succeeds via Pass2 (ignoreDeadline) → `_overdue=true` set
- Entry appears in dayPlacements with `_overdue` flag

---

### Phase 3 — Missed Preferred-Time (TS-166)

Recurring non-TIME_WINDOW tasks whose preferred-time window has entirely passed. Marked as missed; go to unplaced only (no grid placement because they lack a time-window anchor for an overdue slot).

---
**ID:** TS-166  
**Domain:** Scheduler Phases / Phase 3 Missed Preferred-Time  
**Title:** Recurring non-TIME_WINDOW with passed preferred time → marked missed, unplaced only  
**Data Setup:**
- Clock: `2026-06-15T14:00:00Z` (2 PM)
- Task: recurring with preferred time `morning` (block ends at 12:00), `recur: { type: 'daily' }`, NOT time_window mode
- No morning block left in the day
**Action:** Run scheduler
**Expected Outcome:**
- Item is classified with `isMissedPreferredTime=true` during `buildItems`
- Skipped from Phase 0 queue entirely (line 1345-1348)
- Enters `missedPreferredTimeItems[]`
- Phase 3 sets `_unplacedReason='missed'` and `_unplacedDetail='Preferred-time window has passed'`
- Pushed to `stillUnplaced`
- NOT dual-placed on the grid (no `when` block anchor for overdue display)

---
**ID:** TS-166a  
**Domain:** Scheduler Phases / Phase 3 Missed Preferred-Time  
**Title:** Missed preferred-time at correct time boundary  
**Data Setup:**
- Clock: `2026-06-15T12:00:00Z` (12:00 noon = end of morning block)
- Task: recurring, preferred time `morning`, dur=30
**Action:** Run scheduler
**Expected Outcome:**
- If morning block ends at 12:00 and preferred time is `morning`, item's preferred time is at the END of the morning window
- If preferred-time window is `[end, end)` i.e. entirely passed → isMissedPreferredTime=true
- If ANY part of the preferred-time window is still available → item enters the queue normally, not missed

---

### Phase 4 — Missed Window (TS-167)

TIME_WINDOW tasks with entirely-past flex window. Dual-placed with `_overdue=true` on the grid AND in unplaced list.

---
**ID:** TS-167  
**Domain:** Scheduler Phases / Phase 4 Missed Window  
**Title:** TIME_WINDOW with entirely-past flex window → dual-placed with _overdue + unplaced  
**Data Setup:**
- Clock: `2026-06-15T14:00:00Z`
- Task: `{ id: 'tw-1', text: 'Morning window', dur: 30, placementMode: 'time_window', when: 'morning', timeFlex: 60, date: '2026-06-15' }`
- Morning block: 07:00-12:00, flex window extends to 13:00
- Clock is at 14:00 → flex window entirely past
**Action:** Run scheduler
**Expected Outcome:**
- Item has `isMissedWindow=true` in buildItems
- Falls through queue, enters retry pass but fails, reaches Phase 4 filter
- Dual-placed:
  1. `dayPlacements[anchorDate]` entry with `_overdue=true`, start at `preferredTimeMins` or `anchorMin`
  2. `stillUnplaced` entry with `_unplacedReason='missed'`
- When the task has a `when` block (e.g. 'morning'), the grid placement uses the block's start time as anchor

---
**ID:** TS-167a  
**Domain:** Scheduler Phases / Phase 4 Missed Window  
**Title:** TIME_WINDOW missed — NO when block → unplaced only, no grid anchor  
**Data Setup:**
- Task: `{ id: 'tw-2', text: 'Flex window no when', dur: 30, placementMode: 'time_window', timeFlex: 120, date: '2026-06-15' }`
- No `when` field on the task
- Flex window entirely past
**Action:** Run scheduler
**Expected Outcome:**
- `isMissedWindow=true`
- Still added to `stillUnplaced` with `_unplacedReason='missed'`
- NOT dual-placed on the grid because `item.when` is empty/falsy → no obvious calendar anchor slot

---
**ID:** TS-167b  
**Domain:** Scheduler Phases / Phase 4 Missed Window  
**Title:** TIME_WINDOW missed — flex window partially remaining → NOT missed  
**Data Setup:**
- Clock: `2026-06-15T12:30:00Z`
- Task: `when='morning'` (07:00-12:00), `timeFlex=60` → flex extends to 13:00
- 30 min of flex window remaining (12:30-13:00)
**Action:** Run scheduler
**Expected Outcome:**
- `isMissedWindow=false`
- Item enters queue normally, placed within the remaining flex window or deferred

---

### Phase 5 — Past-Anchored Recurring (TS-168)

Recurring tasks with `anchorDate < today`. Pre-classified before the queue so they don't drift to future dates. Force-placed at their original date with `_overdue=true`.

---
**ID:** TS-168  
**Domain:** Scheduler Phases / Phase 5 Past-Anchored Recurring  
**Title:** Recurring with anchorDate before today → force-placed at original date with _overdue  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z` (Monday)
- Task: recurring daily `{ id: 'past-recur', text: 'Past daily', dur: 30, recurring: true, recur: { type: 'daily' }, anchorDate: '2026-06-13', anchorMin: 540 }`
- Existing instances: `{ id: 'past-recur-1', source_id: 'past-recur', date: '2026-06-13' }` (already completed)
**Action:** Run scheduler
**Expected Outcome:**
- Past-anchored items are placed in `pastAnchoredPreQueue[]` before the queue loop (line 1337-1341)
- They never enter the slack-sorted queue (prevented from drifting to today or future dates)
- After retry pass, merged into `stillUnplaced`, then Phase 5 filters them
- Force-placed on their original `anchorDate` at `preferredTimeMins` or `anchorMin`
- Entry has `_overdue=true`
- New instance for 2026-06-13 is generated and placed; old terminal instance is dedup'd

---
**ID:** TS-168a  
**Domain:** Scheduler Phases / Phase 5 Past-Anchored Recurring  
**Title:** Past-anchored recurring — preferredTimeMins takes priority over anchorMin  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Task: recurring, `anchorDate='2026-06-13', anchorMin=480 (8:00), preferredTimeMins=540 (9:00)`
**Action:** Run scheduler
**Expected Outcome:**
- Phase 5 uses `item.preferredTimeMins` as the start time (540), not `anchorMin` (480)
- Fallback: if `preferredTimeMins` is null → use `anchorMin`
- Double fallback: if both null → use `0` (midnight)

---
**ID:** TS-168b  
**Domain:** Scheduler Phases / Phase 5 Past-Anchored Recurring  
**Title:** Past-anchored recurring with no anchorDate → not past-anchored, enters queue normally  
**Data Setup:**
- Recurring task with `anchorDate=null` or `anchorDate >= today`
**Action:** Run scheduler
**Expected Outcome:**
- `item.anchorDate < todayIsoKey` is false → NOT pushed to `pastAnchoredPreQueue`
- Enters the normal queue flow
- Placed by slack-sorted pass on today or future dates

---

### Phase 6 — Rigid Forced (TS-169)

Still-unplaced fixed/rigid items. Force-placed at anchor with `_conflict=true, locked=true`.

---
**ID:** TS-169  
**Domain:** Scheduler Phases / Phase 6 Rigid Forced  
**Title:** Still-unplaced fixed/rigid tasks → force-placed with _conflict and locked  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Tasks:
  1. Fixed task at 09:00: `{ id: 'fixed-1', text: 'Fixed meeting', dur: 60, placementMode: 'fixed', date: '2026-06-15', time: '09:00' }`
  2. Another fixed task at same time: `{ id: 'fixed-2', text: 'Also fixed', dur: 60, placementMode: 'fixed', date: '2026-06-15', time: '09:00' }`
- Only 60 min available at 09:00 (blocked by fixed-1 after Phase 0)
**Action:** Run scheduler
**Expected Outcome:**
- `fixed-2` enters the queue, tryPlaceQueued cannot find a slot
- Phase 6 identifies `fixed-2` as `placementMode === PLACEMENT_MODES.FIXED`
- Force-placed at `anchorDate` (2026-06-15) at `anchorMin` (540), or falls back to when-block start, or nowMins
- Entry has `locked: true` and `_conflict: true`
- Warning `{ type: 'recurringConflict', taskId: 'fixed-2' }` added to warnings array

---
**ID:** TS-169a  
**Domain:** Scheduler Phases / Phase 6 Rigid Forced  
**Title:** Rigid force-place — when-block start used when anchorMin is null  
**Data Setup:**
- Task: fixed, `date='2026-06-15'`, `when='morning'`, no time/date set
- Morning block: 07:00-12:00
**Action:** Run scheduler
**Expected Outcome:**
- `anchorMin` is null → falls through
- `task.when` matches 'morning' block → `forceStart = block.start` (420)
- Falls back to `nowMins` if no when-block match found

---
**ID:** TS-169b  
**Domain:** Scheduler Phases / Phase 6 Rigid Forced  
**Title:** Phase-6 placement is overdue if force time is in the past on today  
**Data Setup:**
- Clock: `2026-06-15T10:00:00Z`
- Fixed task: `when='morning'`, morning block starts at 07:00
**Action:** Run scheduler
**Expected Outcome:**
- `forceDate === todayIsoKey` and `forceStart (420) < nowMins (600)` → `_overdue=true`
- Both `_conflict` and `_overdue` flags set on the entry

---

### Phase 7 — Deadline Relaxed (TS-170)

Deadline tasks (deadline ≤ today) still unplaced with unmet deps. Placed ignoring deps and deadline as last resort.

---
**ID:** TS-170  
**Domain:** Scheduler Phases / Phase 7 Deadline Relaxed  
**Title:** Deadline task with unmet deps → placed ignoring deps and deadline  
**Data Setup:**
- Clock: `2026-06-15T08:00:00Z`
- Tasks:
  1. `{ id: 'dep-1', text: 'Dependency', dur: 120, pri: P3 }`
  2. `{ id: 'deadline-task', text: 'Hard deadline', dur: 30, pri: P1, deadline: '2026-06-15', dependsOn: ['dep-1'] }`
- `dep-1` is 120min but only 90min total capacity remains today → dep-1 is unplaced
**Action:** Run scheduler
**Expected Outcome:**
- `deadline-task` deferred in main loop (dep not placed), retry pass fails again
- Phase 7 filters: `deadlineDate <= todayIsoKey && dependsOn.length > 0`
- `relaxDeps: true` AND `ignoreDeadline: true` (last resort)
- If a slot is found: placed with `_overdue=true`
- If still no slot: item remains in `stillUnplaced`

---
**ID:** TS-170a  
**Domain:** Scheduler Phases / Phase 7 Deadline Relaxed  
**Title:** Deadline-relaxed placement uses findEarliestSlot ignoring deadline and deps  
**Data Setup:**
- Task: deadline today, depends on missing dep, capacity is full today but free tomorrow
**Action:** Run scheduler
**Expected Outcome:**
- `relaxedEnv = Object.assign({}, env, { relaxDeps: true })`
- `findEarliestSlot` called with `{ relaxDeps: true, ignoreDeadline: true }`
- Result: placed tomorrow (deadline ignored as last resort)
- Entry has `_overdue: true`

---
**ID:** TS-170b  
**Domain:** Scheduler Phases / Phase 7 Deadline Relaxed  
**Title:** Deadline-relaxed only applies when deadline ≤ today  
**Data Setup:**
- Task: deadline `2026-06-20`, today is `2026-06-15`, has unmet deps
**Action:** Run scheduler
**Expected Outcome:**
- `deadlineDate > todayIsoKey` → Phase 7 filter DOES NOT match
- Task stays in `stillUnplaced` with deps unmet
- NOT deadline-relaxed; remains in unplaced output for user to resolve

---

### Fallback Ladder (TS-171 to TS-175)

The 4-level fallback ladder inside `tryPlaceQueued()`:

---
**ID:** TS-171  
**Domain:** Scheduler Phases / Fallback Pass 1 (Normal)  
**Title:** Pass 1 — normal placement with all constraints respected  
**Data Setup:**
- Task with deadline, when-block, day-locks, travel, deps, spacing all set
- Slot available within constraints
**Action:** Run scheduler, item enters `tryPlaceQueued`
**Expected Outcome:**
- `findEarliestSlot` (or `findLatestSlot`) called with `base = { placedById, statuses, cfg, env, relaxDeps: false }`
- All constraints active: deadline ceiling, when-window, day-locks, dayReq, travel, deps, spacing
- Slot found → returns `{ slot: { dateKey, start } }` — no `overdue` or `relaxed` flags
- Item placed cleanly

---
**ID:** TS-172  
**Domain:** Scheduler Phases / Fallback Pass 2 (Overdue)  
**Title:** Pass 2 — slack<0 → drop deadline ceiling, set _overdue  
**Data Setup:**
- Task with tight deadline today, slack < 0 (capacity insufficient before deadline)
- Normal Pass 1 fails (deadline ceiling prevents later slot)
**Action:** Run scheduler, Pass 1 fails → enters Pass 2
**Expected Outcome:**
- Condition: `item.slack != null && isFinite(item.slack) && item.slack < 0`
- `ignoreDeadline: true` set on options
- `findEarliestSlot` looks beyond deadline ceiling
- If slot found: returns `{ slot, overdue: true }`
- Entry gets `_overdue: true`

---
**ID:** TS-172a  
**Domain:** Scheduler Phases / Fallback Pass 2 (Overdue)  
**Title:** Pass 2 skipped when item has no finite slack (free task)  
**Data Setup:**
- Free task (no deadline, infinite slack) that fails Pass 1 due to capacity
**Action:** Run scheduler, Pass 1 fails
**Expected Outcome:**
- `overdueApplicable = (item.slack != null && isFinite(item.slack) && item.slack < 0)` → `false` for free tasks (`slack=Infinity` or `null`)
- Pass 2 is skipped entirely
- Falls directly to Pass 3 check

---
**ID:** TS-173  
**Domain:** Scheduler Phases / Fallback Pass 3 (When-Relaxed)  
**Title:** Pass 3 — flexWhen → relax when to anytime, set _whenRelaxed  
**Data Setup:**
- Task with `flexWhen` enabled (flexible when constraint)
- Normal Pass 1 fails because when-window is too restrictive
- Pass 2 may have failed or was skipped
**Action:** Run scheduler, Pass 1 (and maybe Pass 2) fail
**Expected Outcome:**
- Condition: `item.flexWhen === true`
- `relaxWhen: true` set on options
- When-window constraint dropped → all day blocks become eligible
- If slot found: returns `{ slot, relaxed: true }`
- Entry gets `_flexWhenRelaxed: true`

---
**ID:** TS-174  
**Domain:** Scheduler Phases / Fallback Pass 4 (Both)  
**Title:** Pass 4 — both relaxations, _overdue + _whenRelaxed  
**Data Setup:**
- Task with slack<0 AND flexWhen=true
- Pass 1, 2, 3 all fail
**Action:** Run scheduler
**Expected Outcome:**
- Both `ignoreDeadline: true` AND `relaxWhen: true` set
- Last-resort attempt
- If slot found: returns `{ slot, overdue: true, relaxed: true }`
- Entry gets both `_overdue` and `_flexWhenRelaxed`

---
**ID:** TS-175  
**Domain:** Scheduler Phases / Fallback All Fail  
**Title:** All 4 passes fail → unplaced with _unplacedReason and _unplacedDetail  
**Data Setup:**
- Task with dur > total capacity across all dates, slack<0, flexWhen
- Every pass returns null slot
**Action:** Run scheduler, all 4 passes fail
**Expected Outcome:**
- `tryPlaceQueued` returns `{ slot: null }`
- In calling code (main loop): item pushed to `unplaced` array
- If weather constraint exists: `item.task._unplacedReason = 'weather'`
- If inline split fails (and split=true): `item.task._unplacedReason = 'partial_split'`
- No `_unplacedReason` set for generic capacity failure → relies on return contract
- After all phases: output `unplacedTasks` array includes the task

---
**ID:** TS-175a  
**Domain:** Scheduler Phases / Fallback All Fail  
**Title:** PreferLatestSlot special case — extra relaxed pass for today's overdue recurring  
**Data Setup:**
- Recurring task with `preferLatestSlot=true` (today's overdue recurring), flexWhen
- Normal 4 passes all fail
**Action:** Run scheduler
**Expected Outcome:**
- Extra fallback after Pass 4: `findLatestSlot` with `relaxWhen: true`
- Attempts to place at the latest possible slot even with relaxed when
- Gives the task one more chance to stay visible for completion marking
- If succeeds: `{ slot, relaxed: true }`

---

# 2. Reschedule Triggers (TS-176 to TS-194)

Every trigger must route through `enqueueScheduleRun(userId, source, options)`. The `source` string identifies the origin. Debounce: 2000ms quiet period. Rate limit: 10 runs/min/user. DB-backed queue with multi-instance claiming.

---
**ID:** TS-176  
**Domain:** Reschedule Triggers / Task Mutations — createTask  
**Title:** Task creation triggers enqueueScheduleRun with source 'api:createTask'  
**Data Setup:**
- DB: existing user with no schedule_queue entry
- Test: mock enqueueScheduleRun to track calls
**Action:** Call `POST /api/tasks` with valid task body
**Expected Outcome:**
- `enqueueScheduleRun` called once with matching userId
- `source` string is `'api:createTask'`
- `options` includes created task ID(s) in the affected-task-id array
- schedule_queue row inserted for user
- DB-persisted (survives instance crash)

---
**ID:** TS-177  
**Domain:** Reschedule Triggers / Task Mutations — updateTask  
**Title:** Task update with scheduling-relevant field triggers reschedule  
**Data Setup:**
- Existing task with scheduling-relevant fields (dur, when, deadline, priority, etc.)
**Action:** `PATCH /api/tasks/:id` changing `dur` from 30 to 60
**Expected Outcome:**
- `enqueueScheduleRun` called with source `'api:updateTask'`
- Task IDs affected included in options

---
**ID:** TS-177a  
**Domain:** Reschedule Triggers / Task Mutations — updateTask  
**Title:** Task update with NON-scheduling field does NOT trigger reschedule  
**Data Setup:**
- Existing task
**Action:** `PATCH /api/tasks/:id` changing only `text` (description) or `notes`
**Expected Outcome:**
- `enqueueScheduleRun` is NOT called
- scheduler is not invoked (no schedule_queue row created)

---
**ID:** TS-178  
**Domain:** Reschedule Triggers / Task Mutations — deleteTask  
**Title:** Task deletion triggers reschedule  
**Data Setup:**
- Existing scheduled task
**Action:** `DELETE /api/tasks/:id`
**Expected Outcome:**
- `enqueueScheduleRun` called with source `'api:deleteTask'`
- Scheduler re-runs to fill the slot vacated by the deleted task

---
**ID:** TS-179  
**Domain:** Reschedule Triggers / Task Mutations — updateTaskStatus  
**Title:** Task status change triggers reschedule (including instance cascade)  
**Data Setup:**
- Task with pending instances
**Action:** `PATCH /api/tasks/:id/status` changing to 'done'
**Expected Outcome:**
- `enqueueScheduleRun` called with source `'api:updateTaskStatus'`
- Source includes both the task ID and any sibling instance IDs
- For template status changes: source is `'api:updateTaskStatus:template'`

---
**ID:** TS-180  
**Domain:** Reschedule Triggers / Task Mutations — reEnableTask  
**Title:** Task re-enable triggers reschedule  
**Data Setup:**
- Disabled/completed task
**Action:** `POST /api/tasks/:id/re-enable`
**Expected Outcome:**
- `enqueueScheduleRun` called with source `'api:reEnableTask'`
- Updated task re-enters the schedule

---
**ID:** TS-181  
**Domain:** Reschedule Triggers / Task Mutations — takeOwnership  
**Title:** takeOwnership triggers reschedule (detaches provider link)  
**Data Setup:**
- Calendar-synced task with provider_event_id
**Action:** `POST /api/tasks/:id/take-ownership`
**Expected Outcome:**
- `enqueueScheduleRun` called with source `'api:takeOwnership'`
- Only ONE trigger call (not two — explicit S4/S6 rule)
- Task's provider linkage is detached before the scheduler re-runs

---
**ID:** TS-182  
**Domain:** Reschedule Triggers / Task Mutations — batchCreateTasks  
**Title:** Batch create triggers reschedule once for all created tasks  
**Data Setup:**
- Batch of 10 tasks
**Action:** `POST /api/tasks/batch` with array of 10 task bodies
**Expected Outcome:**
- `enqueueScheduleRun` called ONCE (not 10 times)
- Source: `'api:batchCreateTasks'`
- Options include all created task IDs
- `skipEmit` flag set appropriately based on mode

---
**ID:** TS-183  
**Domain:** Reschedule Triggers / Config Changes — SCHED_KEYS  
**Title:** Time blocks change triggers reschedule  
**Data Setup:**
- Existing time_blocks config
**Action:** Update `time_blocks` config key (within SCHED_KEYS)
**Expected Outcome:**
- `enqueueScheduleRun` called via config.controller `scheduleAfter` directive
- Source: derived from `result.scheduleAfter.source`

---
**ID:** TS-183a  
**Domain:** Reschedule Triggers / Config Changes — SCHED_KEYS  
**Title:** Each SCHED_KEYS type triggers reschedule  
**Data Setup:**
- Any of: time_blocks, locations, tool_matrix, preferences, templates
**Action:** Update each config key
**Expected Outcome:**
- `enqueueScheduleRun` called for each
- Locations replaced (bulk re-import) also triggers

---
**ID:** TS-184  
**Domain:** Reschedule Triggers / Config Changes — Location replacements  
**Title:** Bulk location replacement triggers reschedule  
**Data Setup:**
- Existing locations config
**Action:** Replace all locations (bulk import/update)
**Expected Outcome:**
- `enqueueScheduleRun` called
- scheduler re-runs with new location constraints

---
**ID:** TS-185  
**Domain:** Reschedule Triggers / Config Changes — Import  
**Title:** Data import triggers reschedule  
**Data Setup:**
- Importing tasks/config from external source
**Action:** POST /api/data/import
**Expected Outcome:**
- `enqueueScheduleRun(result.scheduleAfter.userId, result.scheduleAfter.source)` called
- Data controller schedules after import

---
**ID:** TS-186  
**Domain:** Reschedule Triggers / MCP Tools  
**Title:** Each MCP task mutation tool triggers reschedule  
**Data Setup:**
- MCP session with authenticated user
**Action:** Call each MCP tool:
  1. `create_task`
  2. `update_task`
  3. `set_task_status`
  4. `delete_task`
  5. `batch_update_tasks`
  6. `config`
**Expected Outcome:**
- Each tool calls `enqueueScheduleRun` with appropriate source
- MCP tools use same guards as REST API (non-scheduling field updates do NOT trigger)

---
**ID:** TS-187  
**Domain:** Reschedule Triggers / External — Calendar Sync  
**Title:** Calendar sync triggers reschedule when tasks are pulled or deleted  
**Data Setup:**
- User with connected calendar
- Sync pulls new events → creates tasks
- Sync detects deleted events → deletes local tasks
**Action:** POST /api/cal/sync
**Expected Outcome:**
- `enqueueScheduleRun` called with source `'cal-sync'`
- Called ONLY when `pulled > 0 || deleted_local > 0`
- Called AFTER sync write phase completes
- `uniqueAffected` options contain all created/deleted task IDs

---
**ID:** TS-187a  
**Domain:** Reschedule Triggers / External — Calendar Sync  
**Title:** Calendar sync with zero changes does NOT trigger reschedule  
**Data Setup:**
- No changes in sync (pushed=0, pulled=0, deleted=0)
**Action:** POST /api/cal/sync
**Expected Outcome:**
- `enqueueScheduleRun` is NOT called
- Stats returned with all-zero counters

---
**ID:** TS-188  
**Domain:** Reschedule Triggers / External — Startup  
**Title:** Server startup triggers reschedule for all users with pending tasks  
**Data Setup:**
- Server restart
- Users with unscheduled/completed tasks
**Action:** Server starts up, `startPollLoop` runs
**Expected Outcome:**
- `enqueueScheduleRun(r.user_id, 'startup')` called for each user found in DB scan
- `schedule_queue` row created for each dirty user
- Poll loop picks them up and runs scheduler

---
**ID:** TS-189  
**Domain:** Reschedule Triggers / User — POST /schedule/run  
**Title:** Manual schedule run triggers immediate reschedule  
**Data Setup:**
- User with pending tasks
**Action:** `POST /api/schedule/run`
**Expected Outcome:**
- `enqueueScheduleRun` called with source `'api:scheduleRun'` or `'manual'`
- Scheduler runs immediately

---
**ID:** TS-190  
**Domain:** Reschedule Triggers / User — POST /schedule/nudge  
**Title:** Nudge triggers reschedule  
**Data Setup:**
- User requests schedule nudge
**Action:** `POST /api/schedule/nudge`
**Expected Outcome:**
- `enqueueScheduleRun` called
- Reschedule triggered

---
**ID:** TS-191  
**Domain:** Reschedule Triggers / Frontend — task-end timer  
**Title:** Frontend task-end timer fires enqueueScheduleRun  
**Data Setup:**
- User has a running task timer in frontend
- Timer expires
**Action:** Frontend sends `POST /api/schedule/nudge` or emits SSE event
**Expected Outcome:**
- `enqueueScheduleRun` called with source `'frontend:task-end-nudge'`
- Scheduler re-runs to free capacity from the completed task

---
**ID:** TS-192  
**Domain:** Reschedule Triggers / Frontend — tab visibility + periodic nudge  
**Title:** Tab visibility change and 5-minute periodic nudge trigger reschedule  
**Data Setup:**
- Frontend tab becomes visible after being hidden
- 5-minute periodic nudge fires
**Action:** Tab visibility event / periodic timer
**Expected Outcome:**
- `enqueueScheduleRun` called
- Reschedule ensures calendar view is up-to-date
- 5-min nudge prevents stale schedules from persisting too long

---
**ID:** TS-193  
**Domain:** Reschedule Triggers / Frontend — weather refresh SSE  
**Title:** Weather refresh via SSE triggers reschedule  
**Data Setup:**
- User has tasks with weather constraints
- Weather data refreshes
**Action:** SSE event from frontend requesting weather refresh
**Expected Outcome:**
- `enqueueScheduleRun` called
- Scheduler re-runs to re-evaluate weather-constrained placements

---
**ID:** TS-194  
**Domain:** Reschedule Triggers / Debounce + Rate Limit  
**Title:** Debounce prevents rapid re-scheduling within 2-second window  
**Data Setup:**
- User triggers 10 rapid mutations in 500ms
**Action:** All 10 mutations call `enqueueScheduleRun(userId, source)` quickly
**Expected Outcome:**
- Debounce check in `processUser()` finds `(Date.now() - last) < DEBOUNCE_MS (2000)` → returns `{ ran: false, reason: 'debounce' }`
- Only ONE scheduler run executes after the 2-second quiet period
- `_lastEnqueueTime` is updated on each call so the timer resets

---
**ID:** TS-194a  
**Domain:** Reschedule Triggers / Debounce + Rate Limit  
**Title:** Rate limit blocks 11th scheduler run within 1-minute window  
**Data Setup:**
- Mock rate limiter: 10 runs/min/user limit
- 10 scheduler runs already executed in the last minute
**Action:** 11th trigger fires
**Expected Outcome:**
- Rate limit check (via lib-rate-limit) returns `allowed: false`
- Schedule run is skipped
- Error logged
- Next run allowed after rate window resets

---
**ID:** TS-194b  
**Domain:** Reschedule Triggers / Debounce + Rate Limit  
**Title:** What does NOT trigger schedule: lib-events, read-only ops, impersonation  
**Data Setup:**
- User performing non-mutating actions
**Action:**
  1. GET /api/tasks (read-only)
  2. lib-events (event log publish)
  3. Impersonated user actions (admin viewing as user)
**Expected Outcome:**
- `enqueueScheduleRun` is NOT called for any of these
- No schedule_queue row created

---
**ID:** TS-194c  
**Domain:** Reschedule Triggers / Debounce + Rate Limit  
**Title:** Source string is correctly passed through to runScheduleAndPersist  
**Data Setup:**
- Trigger from any source
**Action:** Trigger fires, enqueueScheduleRun called, poll loop picks it up
**Expected Outcome:**
- `runScheduleAndPersist(userId, row.source)` receives the original source string
- Source persists in schedule_queue row (DB column)
- Survives instance restart (stored in DB, not just in-memory dirty set)

---
**ID:** TS-194d  
**Domain:** Reschedule Triggers / Debounce + Rate Limit  
**Title:** DB claim prevents multi-instance double-run  
**Data Setup:**
- Two server instances (A and B)
- User has a schedule_queue row
**Action:** Both instances try to claim and run for the same user
**Expected Outcome:**
- Instance A wins the atomic claim (`claimed_by=A, claimed_at=...`)
- Instance B sees `already_claimed` and skips
- Only ONE scheduler run happens
- After A finishes, claim is released (or expired via TTL)
- Instance B's next poll can process the user

---
**ID:** TS-194e  
**Domain:** Reschedule Triggers / Debounce + Rate Limit  
**Title:** Single-flight prevents self-racing within one instance  
**Data Setup:**
- Single server instance
- Poll loop fires for same user while processUser is still running
**Action:** processUser starts; poll loop fires again for same userId
**Expected Outcome:**
- `_running.has(userId)` is true → second call enters retry loop
- After `MAX_LOCK_RETRIES (5)`, gives up: `{ ran: false, reason: 'lock_timeout' }`
- First call completes normally
- No concurrent scheduler runs for the same user on the same instance

---

# 3. Calendar Sync (TS-195 to TS-206)

GCal/MSFT/Apple OAuth connect/disconnect, push/pull sync, sync-locked editing, takeOwnership, sync errors, concurrent sync, split sync, multi-provider interference, duplicate active rows.

---
**ID:** TS-195  
**Domain:** Calendar Sync / OAuth Connect  
**Title:** GCal OAuth connect creates provider linkage and enables push sync  
**Data Setup:**
- User with no calendar connections
- Mock OAuth flow returns valid tokens
**Action:** Complete GCal OAuth flow (auth redirect → token exchange)
**Expected Outcome:**
- `gcal_access_token`, `gcal_refresh_token`, `gcal_token_expiry` set on users row
- `user_calendars` row inserted with provider='gcal', enabled=true, sync_direction='full'
- Initial sync is triggered automatically
- Frontend shows "Connected" status

---
**ID:** TS-195a  
**Domain:** Calendar Sync / OAuth Connect  
**Title:** MSFT OAuth connect — same behavior as GCal  
**Data Setup:**
- User with no calendar connections
**Action:** Complete MSFT OAuth flow
**Expected Outcome:**
- `msft_cal_access_token`, `msft_cal_refresh_token`, `msft_cal_token_expiry` set
- `user_calendars` row with provider='msft', enabled=true
- Sync triggered

---
**ID:** TS-195b  
**Domain:** Calendar Sync / OAuth Connect  
**Title:** Apple CalDAV connect — password-based, creates calendar rows per calendar  
**Data Setup:**
- User with no Apple connection
- Apple password/token provided
**Action:** Complete Apple CalDAV setup
**Expected Outcome:**
- `apple_cal_password` (or equivalent) set
- `user_calendars` rows inserted for each discovered Apple calendar
- Each row has provider='apple', individual sync_direction setting
- Default direction may be 'ingest-only' unless user chooses full sync

---
**ID:** TS-196  
**Domain:** Calendar Sync / OAuth Disconnect  
**Title:** Calendar disconnect clears tokens and ledger  
**Data Setup:**
- User with connected GCal, existing ledger entries, synced tasks
**Action:** User disconnects GCal in Settings
**Expected Outcome:**
- `gcal_access_token`, `gcal_refresh_token`, `gcal_token_expiry` set to null
- `cal_sync_ledger` entries for 'gcal' marked as inactive or deleted
- Tasks remain in Juggler (not deleted)
- Calendar events on GCal remain (no mass-delete)
- Frontend shows "Disconnected" status
- Next sync skips GCal

---
**ID:** TS-197  
**Domain:** Calendar Sync / Push Sync  
**Title:** Push creates/updates calendar events for tasks with placement_mode='fixed'  
**Data Setup:**
- User with GCal connected
- Task: fixed mode, `{ id: 'fixed-1', text: 'Meeting', dur: 60, date: '2026-06-15', time: '09:00', placementMode: 'fixed' }`
- No existing GCal event for this task
**Action:** POST /api/cal/sync
**Expected Outcome:**
- Task pushes to GCal: creates event at 2026-06-15 09:00-10:00
- `cal_sync_ledger` row created: task_id, gcal_event_id, provider, status='active', last_hash
- `gcal_event_id` stored on task row
- Sync stats: pushed=1

---
**ID:** TS-197a  
**Domain:** Calendar Sync / Push Sync  
**Title:** Push updates existing event when task changes (hash mismatch)  
**Data Setup:**
- Task has existing ledger entry with matching gcal_event_id
- Task text changed from "Meeting" to "Updated Meeting" since last sync
**Action:** POST /api/cal/sync
**Expected Outcome:**
- `taskHash` computation detects difference from `last_hash` in ledger
- PATCH request to GCal: updates event title
- `last_hash` updated to new hash
- Sync stats: pushed=1

---
**ID:** TS-197b  
**Domain:** Calendar Sync / Push Sync  
**Title:** Push SKIPS flexible/anyme tasks (not fixed)  
**Data Setup:**
- Task: `placementMode='anytime'`, has scheduler-placed time
**Action:** POST /api/cal/sync
**Expected Outcome:**
- Task is skipped in push loop (flexible tasks don't push to calendar)
- No ledger entry created
- Sync stats: skipped=1

---
**ID:** TS-197c  
**Domain:** Calendar Sync / Push Sync  
**Title:** Recurring tasks push only the first generated instance  
**Data Setup:**
- Template with daily recurrence, generates 14 instances
- Each instance has placement_mode='fixed' (promoted by sync)
**Action:** POST /api/cal/sync
**Expected Outcome:**
- All generated instances push to calendar (one event per occurrence)
- Each gets its own ledger entry
- Contiguous split chunks are merged into a single event

---
**ID:** TS-197d  
**Domain:** Calendar Sync / Push Sync  
**Title:** All-day tasks and reminder/marker tasks push correctly  
**Data Setup:**
- Task with `when='allday'` → allday event
- Marker task with `marker=true` → reminder event
**Action:** POST /api/cal/sync
**Expected Outcome:**
- Allday tasks create date-only events (no time component)
- Marker tasks create zero-duration reminder events (or all-day, depending on adapter)
- Sync stats correctly track

---
**ID:** TS-198  
**Domain:** Calendar Sync / Pull Sync  
**Title:** Pull creates new tasks from calendar events (ingest)  
**Data Setup:**
- User with GCal connected, ingest mode
- GCal has 3 new events since last sync
**Action:** POST /api/cal/sync
**Expected Outcome:**
- 3 new tasks created in Juggler with `placement_mode='fixed'`
- Each task has `date`, `time`, `dur` derived from event
- `cal_sync_ledger` row created for each
- `gcal_event_id` stored on task
- Sync stats: pulled=3

---
**ID:** TS-198a  
**Domain:** Calendar Sync / Pull Sync  
**Title:** Pull updates existing task when calendar event changes  
**Data Setup:**
- Existing task linked to GCal event (has gcal_event_id)
- Event time or title changed on GCal since last sync
**Action:** POST /api/cal/sync
**Expected Outcome:**
- Task is updated to match new event data
- Ledger updated, hash refreshed
- Sync stats reflect updates

---
**ID:** TS-198b  
**Domain:** Calendar Sync / Pull Sync  
**Title:** Pull deletes local task when calendar event is missing (after MISS_THRESHOLD)  
**Data Setup:**
- Task with ledger entry, event disappeared from GCal
- First sync: miss_count=1
- Second sync: miss_count=2
- Third sync: miss_count=3
**Action:** Three consecutive syncs without the event
**Expected Outcome:**
- First two syncs: miss_count incremented, task NOT deleted
- Third sync: miss_count >= MISS_THRESHOLD (3) → task is deleted locally
- Ledger status set to 'deleted_local'
- Provider event deleted from calendar (cleanup)
- Sync stats: deleted_local=1

---
**ID:** TS-198c  
**Domain:** Calendar Sync / Pull Sync  
**Title:** Apple CDN grace prevents premature deletion during propagation lag  
**Data Setup:**
- Apple CalDAV connected
- Task pushed recently (< 120 seconds ago), event not yet visible on calendar
**Action:** Sync runs during CDN grace window
**Expected Outcome:**
- `withinCdnGrace(ledger, 'apple')` returns true (last_pushed_at < 120s ago)
- Missing event is NOT counted as a miss → miss_count NOT incremented
- Prevents false-positive deletion loop
- GCal/MSFT have no CDN grace (CDN_GRACE_MS is 0)

---
**ID:** TS-199  
**Domain:** Calendar Sync / Sync-Locked Editing  
**Title:** guardFixedCalendarWhen prevents changing fixed tasks linked to calendar  
**Data Setup:**
- Task with `gcal_event_id` set, currently `placement_mode='fixed'`
**Action:** API call tries to set `placement_mode='anytime'`
**Expected Outcome:**
- `guardFixedCalendarWhen` sees `isCalLinked=true` (gcal_event_id exists)
- `placement_mode` value is stripped from the row
- Task stays in `placement_mode='fixed'`
- Update proceeds but placement_mode change is silently dropped
- Exception: `_allowUnfix` flag allows the change (for takeOwnership flow)

---
**ID:** TS-199a  
**Domain:** Calendar Sync / Sync-Locked Editing  
**Title:** Non-calendar tasks can freely change placement_mode  
**Data Setup:**
- Task with NO calendar linkage (null gcal_event_id, msft_event_id, apple_event_id)
**Action:** Change `placement_mode` from 'fixed' to 'anytime'
**Expected Outcome:**
- `guardFixedCalendarWhen` returns early (no guardTarget or not linked)
- Change succeeds
- New placement_mode applied

---
**ID:** TS-200  
**Domain:** Calendar Sync / takeOwnership  
**Title:** takeOwnership detaches provider link and un-fixes placement_mode  
**Data Setup:**
- Calendar-synced task: `placement_mode='fixed'`, `gcal_event_id='abc123'`
**Action:** POST takeOwnership
**Expected Outcome:**
- `gcal_event_id` set to null (detached)
- `placement_mode` set to 'anytime'
- Calendar event remains on provider (not deleted)
- Future syncs treat this task as unsynced (no ledger linkage)
- Scheduler re-run places the task flexibly

---
**ID:** TS-201  
**Domain:** Calendar Sync / Sync Errors  
**Title:** 401/403 auth error → tokens cleared, user prompted to reconnect  
**Data Setup:**
- User with expired GCal tokens
**Action:** POST /api/cal/sync
**Expected Outcome:**
- Token validation detects `invalid_grant` or `unauthorized`
- Tokens cleared from users row
- Error detail: `retryable=false`, `userAction='Reconnect your Google Calendar'`
- Sync continues for other providers (if any)
- Frontend shows reconnection prompt

---
**ID:** TS-201a  
**Domain:** Calendar Sync / Sync Errors  
**Title:** 404 (not found) → event no longer exists, ledger cleaned up  
**Data Setup:**
- Ledger row referencing event that was deleted externally
**Action:** POST /api/cal/sync, push fails with 404
**Expected Outcome:**
- Error: `retryable=false`, `userAction=null`
- Ledger row status updated (event is gone)
- Task remains in Juggler but becomes unlinked

---
**ID:** TS-201b  
**Domain:** Calendar Sync / Sync Errors  
**Title:** 412 (conflict) → event modified externally, retries next sync  
**Data Setup:**
- Ledger row for event; event was modified on calendar since last sync
**Action:** POST /api/cal/sync, push fails with 412
**Expected Outcome:**
- Error: `retryable=true`
- Event is NOT re-pushed this cycle
- Next sync will retry

---
**ID:** TS-201c  
**Domain:** Calendar Sync / Sync Errors  
**Title:** 429 (rate limit) → back off, retry automatically  
**Data Setup:**
- GCal rate limit hit
**Action:** POST /api/cal/sync
**Expected Outcome:**
- Error: `retryable=true`
- Throttle log increased
- Sync completes with partial results
- Next sync retries

---
**ID:** TS-201d  
**Domain:** Calendar Sync / Sync Errors  
**Title:** 5xx (server error) → retryable, no user action  
**Data Setup:**
- GCal temporarily unavailable
**Action:** POST /api/cal/sync
**Expected Outcome:**
- Error: `retryable=true`
- Sync continues for other providers
- Next sync retries

---
**ID:** TS-202  
**Domain:** Calendar Sync / Concurrent Sync  
**Title:** Concurrent sync runs — lock prevents simultaneous writes  
**Data Setup:**
- Two sync requests in parallel for the same user
**Action:** Both POST /api/cal/sync simultaneously
**Expected Outcome:**
- First request acquires lock (`acquireLock` returns `{ acquired: true, token }`)
- Second request fails lock acquisition (8 exponential-backoff attempts)
- Second request returns 409: `'Scheduler is busy'`
- SSE emits `sync:lock_conflict` event
- First request completes normally
- Only one write phase executes

---
**ID:** TS-202a  
**Domain:** Calendar Sync / Concurrent Sync  
**Title:** Concurrent lock re-read detects ledger changes from other sync  
**Data Setup:**
- Sync A locks after reading ledgers
- Sync B completed between A's read and lock acquisition
**Action:** Sync A acquires lock → post-lock ledger re-read
**Expected Outcome:**
- Sync A's post-lock re-read picks up ledger rows inserted by Sync B
- Deduplication merges newer rows (by updated_at / computed_at)
- Sync A's write phase does not duplicate Sync B's work

---
**ID:** TS-203  
**Domain:** Calendar Sync / Split Sync  
**Title:** Contiguous split chunks are merged into a single calendar event  
**Data Setup:**
- Task split into 3 contiguous 30-min chunks (total 90 min)
- Chunks: 08:00-08:30, 08:30-09:00, 09:00-09:30
**Action:** POST /api/cal/sync
**Expected Outcome:**
- Merge logic identifies contiguous run (30s tolerance)
- Leader chunk (08:00-08:30) gets merged duration of 90 min
- Followers are suppressed from push
- One calendar event created: 08:00-09:30
- Followers' old ledger entries queued for deletion

---
**ID:** TS-203a  
**Domain:** Calendar Sync / Split Sync  
**Title:** Non-contiguous split chunks push individually with ordinal suffixes  
**Data Setup:**
- Task split into 2 chunks: 08:00-09:00 and 13:00-14:00 (gap in between)
**Action:** POST /api/cal/sync
**Expected Outcome:**
- No merge (gap > 30s tolerance)
- Each chunk pushes as its own calendar event
- Event titles include ' (1/2)' and ' (2/2)' suffixes
- Two separate ledger entries

---
**ID:** TS-204  
**Domain:** Calendar Sync / Multi-Provider Interference  
**Title:** MISS_THRESHOLD per-provider — events from one provider not confused with another  
**Data Setup:**
- User with both GCal and Apple connected
- GCal event exists, Apple calendar does NOT have the same event
**Action:** POST /api/cal/sync
**Expected Outcome:**
- GCal sync: normal push/pull
- Apple sync: event not found on Apple (that's expected — it's a GCal-only task)
- miss_count for Apple ledger is NOT incremented (never existed there)
- No cross-provider interference: each provider's ledger is independent

---
**ID:** TS-204a  
**Domain:** Calendar Sync / Multi-Provider Interference  
**Title:** Multi-provider — task linked to both GCal and Apple correctly syncs both  
**Data Setup:**
- Task with both `gcal_event_id` and `apple_event_id` set
**Action:** POST /api/cal/sync
**Expected Outcome:**
- Task pushes to GCal and Apple independently
- Both ledger entries updated
- Hash comparison is per-provider

---
**ID:** TS-205  
**Domain:** Calendar Sync / Duplicate Active Rows  
**Title:** Concurrent sync duplicate active ledger rows are prevented  
**Data Setup:**
- Two syncs run for same user concurrently (rare race)
- Both create the same task-ledger mapping
**Action:** Write phase attempts to insert duplicate `active_task_key`
**Expected Outcome:**
- `unique constraint on active_task_key` prevents duplicate
- Insert fails gracefully (caught, logged)
- Second entry is dropped; first one remains valid
- No duplicate entries in ledger

---
**ID:** TS-206  
**Domain:** Calendar Sync / Sync Timeout  
**Title:** Sync exceeding 5-minute timeout aborts before write phase  
**Data Setup:**
- Large sync: 2000+ events to process
- Fetch phase takes > 5 minutes
**Action:** POST /api/cal/sync
**Expected Outcome:**
- After 300000ms: `Date.now() - syncStart > 300000` check triggers
- Sync aborts: `return res.status(200).json({ ..., error: 'sync_timeout' })`
- No write phase executes (lock not acquired)
- SSE emits `sync:done` with error
- User can retry

---
**ID:** TS-206a  
**Domain:** Calendar Sync / Sync Timeout  
**Title:** Write-phase lock held for over 120 seconds → heartbeat stops, lock expires  
**Data Setup:**
- Large write phase takes > 120s
**Action:** Lock heartbeat interval fires
**Expected Outcome:**
- After 120000ms of lock holding, `clearInterval(lockHeartbeat)` fires
- `writePhaseLockLost = true`
- Lock expires naturally (TTL not refreshed)
- Write phase continues but with no heartbeat → another instance could acquire after TTL expiry
- Warning logged

---
**ID:** TS-206b  
**Domain:** Calendar Sync / Sync Timeout  
**Title:** Lock refresh fails → write-phase-lock flag prevents partial writes  
**Data Setup:**
- Lock token becomes invalid mid-write (e.g., manually released or DB row deleted)
**Action:** Lock refresh returns `ok=false`
**Expected Outcome:**
- `writePhaseLockLost = true`
- Warning logged: 'Write-phase lock lost — refresh returned 0 rows'
- Write phase continues but marks state as degraded
- (Design choice: optimistic — continue writes rather than leaving ledger in inconsistent state)