# Scheduler Priority Redesign

## Status
**Draft — under review.** Supersedes SCHEDULER-DEPENDENCY-REDESIGN.md.

## Problem

The current scheduler's sort order places all deadline/faux-deadline tasks before all non-deadline tasks ("on-time trumps priority"). This causes:

1. **Priority starvation**: P3/P4 tasks with faux-deadlines (from dependency chains) consume capacity before P1 tasks without deadlines. The user sees tomorrow loaded with low-priority chain tasks while high-priority work goes unscheduled.

2. **Faux-deadlines as sort elevators**: Faux-deadlines were designed as date-range constraints, but the sort treats them identically to hard deadlines — any task with a faux-deadline jumps the entire priority queue.

3. **Over-aggressive frontloading**: The greedy single-pass early-placement fills today/tomorrow first. Combined with the sort issue, low-priority chain tasks fill the best slots.

## Solution: Late-Place, Pull-Forward, Fill

Replace the current single-pass greedy placement + hill-climbing with a four-phase algorithm:

1. **Phase 0**: Place immovable items (date/time-pinned)
2. **Phase 1**: Late-place all constrained tasks at their latest possible position (overlaps allowed)
3. **Phase 2**: Pull forward by priority tier, resolving overlaps (multi-pass until stable)
4. **Phase 3**: Fill unconstrained tasks by priority

### Task Buckets

Every task falls into one of these buckets:

| Bucket | Description | Phase |
|--------|-------------|-------|
| **Pinned** | Date/time-pinned by user (`datePinned = true`) | Phase 0 — immovable |
| **Constrained** | Has hard deadline, faux-deadline, or ceiling | Phase 1 + 2 |
| **Recurring** | Recurring tasks (have inherent time window constraints, earliest/latest) | Phase 1 + 2 |
| **Unconstrained** | No deadline constraints; includes `startAfter`-only tasks | Phase 3 |

Cross-cutting properties that apply within any bucket:
- `startAfter` — floor constraint (earliest placement date)
- `when` windows — restricts which time blocks are available
- `dayReq` — weekday/weekend restriction
- Dependencies — ordering constraint (parent before child)

### Phase 0: Immovable Placement

Place all date/time-pinned tasks at their pinned date and time. Mark their slots as occupied in the occupancy grid. These never move in any subsequent phase.

Fixed events (calendar imports, markers) are also placed here.

### Phase 1: Late-Place Constrained Tasks

For each constrained or recurring task, compute its placement window:

- **`earliest`**: Max of (today, `startAfter`, dependency completion dates, first valid `dayReq` date)
- **`latest`**: Min of (hard deadline, faux-deadline, ceiling, last valid `dayReq` date in range)

**Validation**: If `earliest > latest`, the task has impossible constraints. Mark as unplaceable immediately with diagnostic info (`_unplacedReason: 'impossible_window'`).

**Late-placement**: Place each task at its `latest` possible position — the latest time on the latest valid date that fits the task's duration within its `when` windows. If that slot is occupied by a Phase 0 item, scan backward to the nearest available slot still within the [earliest, latest] range.

**Overlaps are allowed** between Phase 1 tasks. Multiple constrained tasks may claim the same time slot. This is intentional — Phase 2 resolves overlaps.

Faux-deadline computation (existing `computeFauxDeadlines()`) still runs before this phase to determine the `latest` date for dependency chain ancestors.

### Phase 2: Pull Forward by Priority (Multi-Pass)

Build a finalized occupancy grid starting with Phase 0 placements only.

For each priority tier (P1, then P2, P3, P4):
  - Collect all constrained/recurring tasks at this priority level
  - Sort by **tightest window first** (smallest `latest - earliest` range gets first pick)
  - For each task in this order:
    - Find the latest non-overlapping slot that is ≤ the task's current (late-placed) position
    - The slot must respect: `when` windows, `dayReq`, `startAfter`, deadline, dependency ordering, and not overlap with any finalized placement
    - "Just resolve overlap" — scan backward from the late-placed position until finding a free slot. Do NOT pull to the earliest possible position.
    - Finalize the placement. Mark the slot as occupied in the finalized grid.

**Multi-pass convergence**: After processing all four tiers, check if any task position changed during this pass. If so, re-run the full P1→P4 cycle. Repeat until no positions change. This handles mixed-priority dependency chains (e.g., P4 parent moves earlier in P4 tier → P1 child can now also move in next P1 pass).

Cap iterations at 10 passes to prevent infinite loops (should converge in 2-3).

**Overlap resolution**: After convergence, if any tasks still overlap (impossible to resolve through pull-forward alone), unschedule them starting from P4 and working upward until only one task remains per time slot. These tasks get `_unplacedReason: 'capacity_conflict'`.

### Phase 3: Fill Unconstrained Tasks

All tasks with no deadline constraints (no hard deadline, no faux-deadline, no ceiling). This includes `startAfter`-only tasks.

Process by priority (P1 first, then P2, P3, P4). Within the same priority, respect dependency ordering (topo sort — parents before children).

For each task: scan forward from today (or `startAfter` date), find the first available slot in the finalized grid that fits the task's duration and respects `when` windows / `dayReq` / dependencies.

This is similar to the current `placeEarly()` behavior, but runs after all constrained tasks are finalized.

## What Changes

### Remove
- **Hill-climbing** (`hillClimb.js`) — replaced by pull-forward multi-pass
- **Score computation** (`scoreSchedule.js`) — no longer drives optimization. Keep for diagnostics if useful, but decouple from placement.
- **"On-time trumps priority" sort** — priority is now the primary sort criterion
- **Today capacity reservation** (`computeTodayReserved`, `skipToday`) — replaced by the priority-first pull-forward
- **`reserveCapacityForChains()`** — replaced by Phase 1 late-placement. The new algorithm doesn't need string-marker reservations; it uses the late-placed positions directly.
- **Single-pass greedy placement loop** (Step 2f) — replaced by Phase 2 + Phase 3

### Keep
- **`computeFauxDeadlines()`** — still needed to compute [earliest, latest] windows for dependency chain ancestors
- **`placeEarly()` / `placeLate()`** — underlying placement helpers. Phase 1 uses late-place, Phase 3 uses early-place.
- **`getWhenWindows()` / `getRecurFlexWindows()` / `canPlaceOnDate()`** — constraint helpers
- **`depsMetByDate()`** — dependency validation
- **`computeDownstreamCeiling()`** — ceiling computation from pinned/recurring downstream tasks
- **Recurring expansion** (`expandRecurring()`) — unchanged
- **Splittable task handling** — tasks that split across time windows/days
- **Unplaced diagnostics** — enhanced with new reason codes

### Modify
- **`unifiedSchedule()`** main function — rewrite the placement section (currently Steps 2a-2f) to implement the four-phase algorithm
- **Pool item structure** — add `window: { earliest, latest }` to each pool item

## File Changes

| File | Change |
|------|--------|
| `src/scheduler/unifiedSchedule.js` | Rewrite placement logic: 4-phase algorithm |
| `src/scheduler/hillClimb.js` | Remove (or keep as dead code initially) |
| `src/scheduler/scoreSchedule.js` | Decouple from placement; optional diagnostic use |
| `tests/` | Update tests to match new placement behavior |

## Algorithm Walkthrough

### Example: Mixed-priority dependency chain

```
Tasks:
  A: P4 "Research vendors" (no deadline, depends on nothing)
  B: P2 "Write proposal" (no deadline, depends on A)
  C: P1 "Submit proposal" (due Friday, depends on B)
  D: P1 "Prepare presentation" (no deadline, independent)
  E: P3 "Update docs" (no deadline, independent)
```

**Faux-deadline computation:**
- C has hard deadline: Friday
- B gets faux-deadline: Thursday (C needs Friday, B must finish before)
- A gets faux-deadline: Wednesday (B needs Thursday, A must finish before)

**Phase 0:** Nothing pinned.

**Phase 1 (late-place constrained tasks):**
- A: window [today, Wednesday] → placed at Wednesday latest slot
- B: window [today, Thursday] → placed at Thursday latest slot
- C: window [today, Friday] → placed at Friday latest slot
- D: unconstrained → Phase 3
- E: unconstrained → Phase 3

**Phase 2 (pull forward by priority):**

Pass 1:
- P1 tier: C (Submit, due Friday). Currently at Friday. No overlap with finalized grid. Stays at Friday. Finalized.
- P2 tier: B (Write). Currently at Thursday. No overlap with finalized grid. Stays at Thursday. Finalized.
- P3 tier: nothing constrained.
- P4 tier: A (Research). Currently at Wednesday. No overlap with finalized grid. Stays at Wednesday. Finalized.

No positions changed → converged.

**Phase 3 (fill unconstrained):**
- P1: D (Prepare presentation). Scan from today → placed in earliest available slot (today or tomorrow).
- P3: E (Update docs). Scan from today → placed in next available slot after D.

**Result:** D (P1, independent) gets today's best slots. The chain A→B→C is spread across Wed-Fri near its deadline. E (P3) fills gaps. No low-priority task displaces the P1 independent task.

### Example: Capacity conflict

```
Tasks:
  F: P1 "Critical fix" (due tomorrow, 4h)
  G: P3 "Code review" (due tomorrow, 4h)
  Tomorrow has 6h available.
```

**Phase 1:** Both late-placed at tomorrow. Overlapping (8h needed, 6h available).

**Phase 2:**
- P1: F placed at tomorrow. 4h consumed. Finalized.
- P3: G needs 4h, only 2h remain on tomorrow. Cannot fully place within deadline.
  - If G can split: place 2h tomorrow, but remaining 2h can't go past deadline → partial placement, flagged.
  - If G can't split: unscheduled with `_unplacedReason: 'capacity_conflict'`.

### Example: Recurring tasks

```
Tasks:
  H: P2 recurring daily "Standup" (15min, preferred 9:00 AM, flex ±30min)
  I: P1 "Deploy hotfix" (no deadline, independent, 2h)
```

**Phase 1:** H late-placed at 9:30 AM (latest in flex window) on each day.

**Phase 2:**
- P1: nothing constrained.
- P2: H on each day. No overlap → stays at 9:30 AM. Finalized.

**Phase 3:**
- P1: I placed earliest available. If 9:30-9:45 is taken by H, I gets 6:00 AM or next available block.

## Edge Cases

### startAfter without deadline
A task with `startAfter: Wednesday` but no deadline is **unconstrained** — it goes to Phase 3 with a floor of Wednesday. It won't be placed before Wednesday but has no ceiling.

### startAfter > deadline
Impossible constraint. Detected in Phase 1 (`earliest > latest`). Marked unplaceable with `_unplacedReason: 'impossible_window'`.

### Circular dependencies
Already detected by existing `topoSortTasks()` with circular break handling. No change needed.

### Task too large for any single day
Handled by existing splitting logic. `placeEarly()` / `placeLate()` split tasks across time windows and days when `splittable = true`.

### All days full
Task remains unplaced after Phase 3 scan. `_unplacedReason: 'no_capacity'`.

### Pull-forward can't find any earlier slot
Task stays at its late-placed position. This is correct — it was placed at its latest possible time, and if nothing earlier is available, that's where it belongs.

## Verification

1. Run full test suite: `cd juggler-backend && npm test`
2. Tests that will need updating:
   - Any test asserting "deadline tasks sort before priority tasks" 
   - Hill-climbing-specific tests
   - Tests that check the score-based optimization
3. Add new tests:
   - Priority starvation scenario (P1 without deadline vs P3/P4 with faux-deadline)
   - Multi-pass convergence for mixed-priority chains
   - Overlap resolution with priority-based unscheduling
   - Impossible constraint detection
4. Run `node scripts/db-integrity-check.js` before and after
5. Manual testing: run scheduler, verify P1 tasks get earliest slots when they have no deadline
