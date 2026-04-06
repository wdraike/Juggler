# Scheduler Dependency Chain Redesign

## Status
**Ready for implementation.** All prerequisite work is complete. This document describes a redesign of how the scheduler handles dependency chains with deadlines.

## Problem

The current scheduler has 5+ placement phases (Phase 0.5, 1, 1.5, 2, 2.5, 3) that handle deadline tasks differently from free tasks. Tasks with deadlines use **late-placement** (backward scan from due date), while free tasks use **early-placement** (forward scan from today). This causes:

1. **Priority inversion**: A P4 task gets a 6:40 PM slot via early-placement while a P2 task with an inherited deadline gets pushed to 9 PM via late-placement. They never compete for the same slots because they use different placement directions.

2. **Cascade corruption**: When task A depends on task B which has `due: 4/15`, the scheduler propagates the deadline to A and late-places it near April 15 — even though A is P2 and should get today's best slots.

3. **Phase complexity**: The multi-phase system (deadline late-place → recurring → past-deadline fallback → flexible early-place → priority compaction → pull-forward) creates subtle ordering bugs that are nearly impossible to reason about.

## Solution: Reserve-and-Place

Replace the multi-phase deadline handling with a two-step approach:

### Step 1: Compute Faux-Deadlines and Reserve Capacity

Walk backward from every hard deadline (`due_at`) through the dependency chain. For each ancestor task, compute a **faux-deadline** — the latest date/time it must complete by for the chain to meet its hard deadline.

**Algorithm:**
```
For each task with due_at:
  1. Compute its latest possible placement:
     - Start from the due date
     - Find the latest time window on that date that fits the task's duration
     - That's the "must-start-by" time for this task
  
  2. For each upstream dependency (parent task):
     - The parent's faux-deadline = child's must-start-by time minus parent's duration
     - Fit this into the parent's available time windows (morning, afternoon, evening, night)
     - Account for the parent's when-tags and location constraints
     - If the parent has multiple children with deadlines, use the earliest faux-deadline
  
  3. Reserve the computed time slots:
     - Mark the capacity as "reserved for chain" in the day occupancy grid
     - Other tasks cannot use reserved slots during placement
     - When the reserved task is actually placed (likely earlier), release the reservation
```

**Duration subtraction must account for capacity, not raw minutes:**
- A 3-hour task doesn't just subtract 3 hours from the deadline
- If the day only has 2 free hours in the task's time windows, it needs to span to the previous day
- Walk backward day-by-day, consuming available capacity in valid time windows

**Faux-deadline assignment:**
- Each ancestor task gets `faux_deadline` = the computed must-complete-by date/time
- If a task appears in multiple chains, use the earliest (tightest) faux-deadline
- Tasks with their own `due_at` keep their real deadline (don't override with faux)
- Tasks in chains with NO hard deadline anywhere get no faux-deadline — they're purely priority-based

### Step 2: Single Placement Pass

Replace all the current phases with ONE placement pass:

**Core scheduling rule: On-time trumps priority.**
Meeting deadlines is more important than respecting user-assigned priorities. A P4 task due tomorrow gets placed before a P1 task with no deadline. The rationale: a missed deadline is a hard failure (real-world consequence), while a deferred P1 task is just suboptimal ordering. The scheduler should maximize the number of deadlines met, then optimize priority ordering within the remaining capacity.

**Sort order:**
1. **Dependency order first** (topological sort) — parents before children. A task cannot be placed until all its dependencies are placed.
2. **Within ready-to-place tasks, sort by:**
   a. Tasks with deadlines/faux-deadlines before tasks without any deadline
   b. Soonest deadline first (most urgent gets first pick of capacity)
   c. Highest priority first within same deadline urgency (P1 before P2)
   d. Shortest duration first as tiebreaker (fills gaps better)
3. **Tasks with no deadline** are placed after ALL deadline tasks, sorted by priority then duration.

**Placement strategy:**
- ALL tasks use **early-placement** (forward scan from today)
- Deadline/faux-deadline constrains the date range (don't place past the deadline date)
- Reserved capacity is available to the task that reserved it, blocked for others
- When a task is placed, release its reservation
- If a task is placed earlier than its reservation, the released capacity becomes available to later tasks

### Step 3: Conflict Detection

If a chain's total duration exceeds available capacity between now and the deadline:
- Flag immediately during the reservation step (before placement even starts)
- Add to `unplaced` with a clear diagnostic:
  - `_unplacedReason: 'deadline_overflow'`
  - `_unplacedDetail: 'Chain needs 8h but only 4h available before due date 4/15'`
  - `_suggestions: [{ type: 'deadline', text: 'Reduce duration, extend deadline, or clear other tasks' }]`

When two deadline chains compete for the same capacity:
- The chain with the sooner deadline wins (on-time trumps everything)
- If deadlines are the same day, higher priority tasks within the chain get preference
- The losing chain gets flagged as a conflict with the reason: "Conflicts with [other task]'s deadline on [date]"
- Non-deadline tasks are NEVER allowed to displace deadline chain capacity — deadlines always win

### Step 4: Optimize (unchanged)

The hill-climb optimization pass runs after placement, same as today. It respects deadlines and faux-deadlines as constraints.

## What Changes

### File: `src/scheduler/unifiedSchedule.js`

**Remove:**
- Phase 0.5 merged deadline+recurring placement (lines ~1357-1470)
- Phase 1 deadline late-placement in `placeWithDeps` (lines ~1555-1595)
- Phase 1.5 past-deadline fallback (lines ~1477-1498)
- Phase 2.5 priority compaction (lines ~1700-1860)
- Phase 3 pull-forward with deps (lines ~1900-2070)
- `computeDownstreamDeadline` function (lines ~453-491) — replaced by new faux-deadline computation
- `_inheritedDeadline` flag (added in this session, no longer needed)
- The `placeWithDeps` function's deadline/ceiling late-placement branches

**Add:**
- `computeFauxDeadlines(pool, dates, dayWindows, dayOcc)` — walks chains backward, computes faux-deadlines, returns reservations
- `reserveCapacity(reservations, dayOcc)` — marks reserved slots in occupancy grid
- `releaseReservation(taskId, reservations, dayOcc)` — frees slots when task is placed
- Modified placement loop: single pass, topological sort, early-placement only

**Keep unchanged:**
- `placeEarly()` / `placeLate()` functions themselves
- `getWhenWindows()` / `getRecurFlexWindows()` / `canPlaceOnDate()`
- Recurring task placement (flex windows, preferred time)
- Fixed/pinned/marker task handling
- Hill-climb optimization
- Score computation
- Unplaced diagnostics (enhanced with deadline_overflow)

### File: `src/scheduler/hillClimb.js`

**Minor change:** Respect faux-deadlines in swap validation. `recurFlexOk` already handles this; add similar check for deadline constraints.

### Files NOT changed:
- `task.controller.js` — no changes needed
- `runSchedule.js` — no changes needed (it calls `unifiedSchedule` and persists results)
- `scheduleQueue.js` — no changes
- Frontend — no changes
- Database — no migrations needed

## Current Architecture Context

### How tasks enter the scheduler

1. `runScheduleAndPersist(userId)` loads all tasks from DB via `rowToTask()`
2. Expands recurring templates into instances via `expandRecurring()`
3. Calls `unifiedSchedule(allTasks, statuses, todayKey, nowMins, cfg)`
4. `unifiedSchedule` returns `{ dayPlacements, unplaced, score, warnings }`
5. `runScheduleAndPersist` persists changed `scheduled_at` values to DB

### Key data structures in unifiedSchedule

- **`pool`**: Array of `{ task, remaining, totalDur, earliestDate, deadline, ceiling, splittable, minChunk, _parts }`. Each active task becomes a pool item.
- **`dayOcc`**: Object `{ dateKey: Array[1440] }`. Minute-by-minute occupancy grid per day. `true` = occupied.
- **`dayWindows`**: Object `{ dateKey: { morning: [[start, end]], lunch: [...], ... } }`. Available time windows per day derived from time block config.
- **`dayPlacements`**: Object `{ dateKey: [{ task, start, dur, ... }] }`. Final placement output.
- **`globalPlacedEnd`**: Object `{ taskId: { dateKey, startMin, endMin } }`. Tracks where each task was placed for dependency resolution.

### Key functions

- **`placeEarly(item, d, afterMin, whenOverride, beforeMin)`**: Scans forward through time windows on day `d`, finds first available slot, places task. Handles splitting.
- **`placeLate(item, d, beforeMin, whenOverride, afterMin)`**: Scans backward through time windows. Used for deadline tasks currently (to be removed for ancestors).
- **`getWhenWindows(when, dayWindows)`**: Returns time windows for a task's `when` tags on a given day.
- **`getRecurFlexWindows(t, dayWindows)`**: Returns flex window `[preferredTime-flex, preferredTime+flex]` for recurring Time Window mode tasks.
- **`canPlaceOnDate(task, dateObj)`**: Checks day_req (weekday/weekend) and location constraints.
- **`depsMetByDate(task, dateObj)`**: Returns placement info for dependencies, or null if deps aren't placed yet.

### Recurring tasks

Recurring tasks have a separate placement path that should NOT change:
- Phase 0.5 handles recurring tasks with `getRecurFlexWindows()` for Time Window mode
- `preferredTimeMins` (integer, minutes from midnight) is the authoritative time anchor
- `time_flex` is the ±window in minutes
- Recurring instances inherit template fields via `TEMPLATE_FIELDS` array
- Rigid recurring tasks are force-placed at their preferred time

### Test suite

- **535 tests across 24 suites**, all passing
- Key test files for this change:
  - `tests/schedulerRules.test.js` — 200+ scenario tests including dependency chains, deadlines, fuzz testing
  - `tests/schedulerSupplyDemand.test.js` — capacity pressure tests with chains
  - `tests/schedulerDeepCoverage.test.js` — edge cases
  - `tests/schedulerScenarios.test.js` — end-to-end scenarios with real DB rows
  - `tests/schedulerTimeSimulation.test.js` — time-of-day placement tests
  - `tests/unifiedSchedule.test.js` — unit tests for the algorithm
- Test DB: Docker MySQL on port 3308 (`docker compose -f docker-compose.test.yml up -d`)
- Jest config: `NODE_ENV=test`, `maxWorkers: 1` (sequential for DB tests)

### Recent changes (this session)

1. **`preferred_time_mins`** column added — stores recurring task preferred time as minutes from midnight (no timezone conversion). Replaces the overloaded `scheduled_at` on templates.

2. **Single `TEMPLATE_FIELDS` array** — one definition used everywhere for routing template fields between instances and templates. `scheduled_at` and `desired_at` are NOT template fields.

3. **Event queue (`scheduleQueue.js`)** — replaces `scheduleAfterMutation` middleware. Controllers call `enqueueScheduleRun(userId)` after mutations. Single-flight per user with DB-backed lock.

4. **Minimal-diff persist** — scheduler only writes tasks where `scheduled_at` actually changed. Batch CASE updates for performance.

5. **`night` time block** included in default `when` — "anytime" tasks can use 9-11 PM.

6. **`_inheritedDeadline` flag** — temporary fix added in this session. Ancestor tasks with inherited deadlines use early-placement instead of late-placement. This should be replaced by the faux-deadline reservation system.

7. **Downstream ceiling tasks** — the late-placement block for ceiling tasks was removed. Ceiling tasks fall through to normal early-placement. This is correct and should be preserved.

## Implementation Notes

### Suggested implementation order

1. **Write `computeFauxDeadlines()`** — the backward chain walk. Start simple: subtract raw durations, don't worry about time windows yet. Get the basic faux-deadline computation working and passing existing tests.

2. **Replace multi-phase with single pass** — gut the Phase 0.5/1/1.5/2.5/3 code. Keep Phase 2's structure but use topological sort. Run tests, fix failures.

3. **Add capacity reservation** — implement `reserveCapacity()` and `releaseReservation()`. This prevents other tasks from stealing deadline chain capacity.

4. **Refine faux-deadline computation** — account for time windows and capacity per day (not just raw duration subtraction). This handles the "3-hour task needs a full day if schedule is packed" case.

5. **Add conflict detection** — flag chains that can't fit before their deadline.

6. **Run full test suite** — all 535 tests must pass. The fuzz test (Group 70) is particularly important — it generates random schedules and checks invariants.

### Things to watch for

- **Recurring tasks** have their own placement path (flex windows, missed detection). Don't break this. They should be placed BEFORE the main placement pass, same as today.
- **Fixed/pinned/marker tasks** are pre-placed and block time. Don't change this.
- **The hill-climb pass** needs to respect faux-deadlines. Currently it respects `item.deadline` — faux-deadlines should work the same way.
- **`todayReserved` logic** (P3/P4 skip today when P1/P2 demand is high) — this should still work. It's a good heuristic for preventing low-priority tasks from stealing today's capacity.
- **Splittable tasks** — placement needs to handle splitting across time windows and days, same as today.
- **The `computeDownstreamCeiling` function** (lines 402-439) computes ceilings from pinned/recurring downstream tasks. This is different from deadline propagation and should be preserved. Ceilings from pinned dates are structural constraints, not deadline pressure.

### DB integrity

Run `node scripts/db-integrity-check.js` before and after to ensure no data corruption. The script checks for orphans, invalid values, broken references, etc.

### Performance

The current scheduler takes ~5s for ~800 tasks (1.6s algorithm + 3.4s DB persist). The reservation step adds O(chains × chain_length) computation but no DB access. Should be negligible (<100ms).
