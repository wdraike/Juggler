# Scheduler — Design & Test Cases

## Status
**Current design.** Single source of truth for the scheduler placement algorithm and its test coverage. Consolidates the earlier `SCHEDULER-PRIORITY-REDESIGN.md`, `SCHEDULER-DEPENDENCY-REDESIGN.md`, and `SCHEDULER-TEST-CASES.md` drafts.

## Core principle

**Tasks are scheduled in order most-to-least constrained. Tasks with no deadlines are placed last.**

This is the unifying rule. Everything else (phase order, comparators, past-due boosts, rollback) exists to serve it.

### Severity hierarchy (most → least constrained)
1. **Pinned** — user locked to a specific date/time. Immovable.
2. **Overdue** — past its deadline (or past its scheduled day for rigid recurrings). Must place ASAP; slack=0.
3. **Explicit or implied deadline** — one-offs with `deadline`, chain members with `fauxDeadline`, recurring instances (cycle window's end = implied deadline). Sorted by slack within this band.
4. **Free / backlog** — no deadline, no deps. Fills what's left.

## Task-type terminology
- **One-off** = a single task that is **non-recurring** AND has **no dependencies**. A one-off *may* carry an explicit `deadline`.
- **Chain member** = non-recurring task with dependencies (or depended-on-by a deadline task). A chain tail has its own `deadline`; predecessors inherit a `fauxDeadline` propagated backward.
- **Recurring instance** = expanded from a recurring template. **Always carries an implied deadline = the end of its cycle window** (the moment the next occurrence begins). An instance must finish before its next sibling starts — no overlap across occurrences.
- **Split chunk** = one of N pieces a task was divided into during preprocessing. Durations sum to the original task's duration. Each chunk **inherits the original's priority, start time, and deadline** — the scheduler treats each chunk as a one-off task carrying the original's constraints, and the chunks compete individually in the severity order.

## Secondary principles

These resolve remaining ambiguity when the severity hierarchy alone isn't decisive.

1. **Deadlines drive the schedule; priority is a tie-breaker.** A P3 task due Thursday beats a P1 task with no deadline. Priority only decides the outcome when deadlines (or slack) are equivalent.
2. **Past-due tasks are promoted to P1 and rescheduled aggressively.** One-off past-due tasks get P1 boost and place in any available window. **Recurring past-due instances do NOT roll forward to the next day** — if they can't fit their original day, they go to the unscheduled/issues list and the user must mark them done or skipped. Split tasks place what fits and log the rest. See §8 for full rules.
3. **Overlaps are prevented, not resolved.** The occupancy grid blocks already-placed minutes. Each phase places around what previous phases committed. Pinned tasks are placed first (Phase 0) and all subsequent phases respect their slots.

---

## Plain-language outline

### 1. What the scheduler does
- Reads the user's tasks
- Picks a day and time for each one it can place
- Writes those picks back to the database
- Pushes a change summary to the frontend via SSE

### 2. Load phase — gather what we're working with
- Load every task the user owns (via `tasks_v` view)
- For each recurring task, expand into one row per upcoming occurrence within `RECUR_EXPAND_DAYS` (currently 14 days; see `src/scheduler/constants.js`). Existing pending instances dated beyond the horizon are grandfathered — `toDeleteIds` in `runSchedule.js` preserves them so a horizon shrink doesn't wipe legitimate rows.
- If a recurring task has split enabled (e.g., 60 min ÷ 30 min chunks = 2), materialize one row per chunk per occurrence (via `reconcile-splits.js`)

### 3. Classify each task by how it can move
- **Pinned** — user set `date_pinned=1` with a specific time. Never moved by the scheduler. Calendar-synced tasks are also pinned.
- **Markers** — reminders at a time that don't occupy a slot. Never moved
- **Recurring instances** — see 4b for per-frequency placement rules
- **Deadline tasks** — anything with `due_at`. Past-due (due_at < today) is promoted here: `due_at` is remapped to today and priority is bumped to P1 for tie-breaking
  - A task is a **chain member** if it has `due_at` *or* any task transitively depending on it has `due_at`
  - A **solo anchor** = a chain of size 1 (a deadline task with no prereqs)
- **Free tasks** — no deadline, no chain membership. Place anywhere

### 4. Placement phase — figure out when each task goes

> **Implementation note:** in code (`src/scheduler/unifiedSchedule.js`), these
> sub-phases are called Phase 0 / Phase 1 / Phase 2 / Phase 3+4 / Phase 5:
> 4a → Phase 0 (pinned + markers), 4b → Phase 1 (recurring, slack-sorted),
> 4c → Phase 2 (deadline work — slack-based forward placement),
> 4d → Phase 3 (priority fill) + Phase 4 (flexWhen relaxation),
> 4e → Phase 5 (recurring rescue).

#### 4a. Immovable first  *(Phase 0)*
- Pinned tasks (`datePinned` + has time) at their locked times
- Markers at their times (no occupancy)

#### 4b. Recurring instances — constrained-first  *(Phase 1)*
All recurring instances are sorted by **slack** (available capacity in cycle window minus duration) across ALL priority tiers, with priority as tiebreaker. This ensures narrow-window tasks (e.g., "morning" only) place before wide-window tasks (e.g., "anytime"), regardless of priority — the anytime task can go later in the day, the morning task can't.

Each recurrence type has a different "valid days" rule. Within valid days, pick the best slot inside the task's `when` window (morning / lunch / afternoon / evening / night).

| Frequency | Valid days | Time flexibility |
|---|---|---|
| **Daily** | the one scheduled day | flex within when-window |
| **Specific day(s) of week** (e.g., Tue/Thu) | the scheduled day only | flex within when-window |
| **Day-of-month** (e.g., 15th) | that calendar date | flex within when-window |
| **Every-N-days** (e.g., every 3) | the computed date | flex within when-window |
| **Times-per-cycle / weekly-count** (e.g., 3× per week) | any eligible day within the cycle window | flex on both day *and* time |
| **Monthly-N-times** | any day within the month matching constraints | flex on day and time |

If the occurrence day has already passed and the recurrence has no remaining flexibility, that occurrence is skipped.

#### 4c. Deadline work — slack-based left-to-right placement  *(Phase 2)*
This is the heart of the scheduler. Fully completed before 4d, so free tasks fill around the committed chain layer.

See **"Deep-dive: 4c"** below for the slack computation, sort order, and forward placement pass.

#### 4d. Free tasks  *(Phase 3 + Phase 4)*
- **Phase 3** — walk priority tiers P1 → P2 → P3 → P4 (priority as tie-break only — these are all deadline-free, so nothing separates them beyond priority). For each task, place at the earliest free slot that respects its `when`, `dayReq`, `start_after`, and dependency constraints.
- **Phase 4** — retry any task that came in with `flexWhen=true` and didn't place in Phase 3, relaxing its `when` to `anytime`. Lets flexible tasks spill into non-preferred windows when capacity is tight.

#### 4e. Recurring rescue  *(Phase 5)*
After Phase 4, look for recurring instances that didn't land in Phase 1. For each unplaced recurring, on its **assigned day only**:
- Try any remaining gap in the valid window, ignoring the `when` preference
- Try bumping a lower-priority non-recurring task off that day to free up capacity, then re-place the bumped task elsewhere. If the bump can't be accommodated, revert.
- If the recurring still can't fit **on its assigned day**, mark `unscheduled=1` with a `missedRecurring` reason.

**Recurrings do NOT roll forward.** A daily task that missed Monday is not attempted on Tuesday — it's left unscheduled for the user to mark done or skipped. This is by design: rolling a missed recurring into the next day double-books the user and silently erodes habit cadence.

### 5. Overlap prevention

The scheduler prevents overlaps during placement — the occupancy grid (`dayOcc`) blocks already-occupied minutes. There is no post-placement pile-up resolution. Each phase respects what previous phases placed:

- Phase 0 locks pinned/marker slots
- Phase 1 recurring fills around Phase 0
- Phase 2 deadline tasks fill around Phase 0+1
- Phase 3 free tasks fill remaining gaps
- Phase 4/5 relaxation and rescue respect all prior placements

Split chunks stay as separate DB rows. Adjacent chunks of the same task are visually collapsed in the frontend but remain independent in the database for correct scheduling and status tracking.

### 6. Persist
- Batch-update every placed task's `scheduled_at`, `date`, `day`, `time`, and `dur`
- Clear `date_pinned` on any task the scheduler placed (the scheduler moved it, so the old pin is stale)
- Set `unscheduled=1` on unplaced tasks (preserves `scheduled_at` for "was supposed to be at…" display)
- INSERT new in-memory chunks that were placed (with full date/day/time fields)
- All inside a single transaction per user

### 7. Notify
- Emit one SSE event (`schedule:changed`) carrying:
  - **Added** — full task rows for newly inserted items
  - **Changed** — `{id, patch}` pairs showing only the fields that moved
  - **Removed** — IDs of deleted rows
- Frontend merges these into in-memory state; calendar re-renders without re-fetching

### 8. Past-due handling — what happens when time passes

Three rules govern incomplete tasks whose scheduled time has passed:

**Rule 1: One-off past-due tasks → P1 boost, reschedule within existing constraints, flag as past-due.**
The task's priority is boosted to P1 and the scheduler tries to place it in its original `when` and `where` windows. If it can't fit, it goes to the issues log — the user decides whether to relax the constraints. The task is marked `_pastDue` for visual indication.

**Rule 2: Recurring past-due instances → unscheduled, no roll-forward.**
A recurring instance that missed its assigned day is NOT rolled forward to a later day in the cycle window. It goes to the unscheduled/issues list with a `_pastDue` flag, and the user must mark it done or skipped to clear it. The next occurrence starts fresh on its own day. Rationale: rolling recurrings forward double-books the user and silently erodes habit cadence.

Exception — tpc-flexible recurrings: a `timesPerCycle` template whose count is less than its allowed-days count can slide within the cycle window by design. These are flex-day templates (e.g. "3× per week on M/T/W/Th/F"), not rigid daily tasks.

**Rule 3: Split tasks past-due → schedule what fits, unschedule the rest.**
Place as many chunks as capacity allows. Chunks that can't fit are added to the unplaced/issues log with a `partial_split` reason. The user sees which chunks were placed and which weren't.

### 9. Guard rails — what blocks placement
- No free slot in any allowed when-window → unscheduled
- Day-of-week / day-of-month restriction doesn't match any candidate day → unscheduled
- Dependencies not yet placed → task waits; next scheduler run retries
- Required location/tools aren't available in a candidate slot → skip that slot
- Even after past-due → today remap, if today is full → unscheduled (with past-due badge)
- **Unscheduled-recurring midnight guard**: a recurring master with no specific `time`, `preferredTimeMins`, or `when='fixed'` does NOT get a stored `scheduled_at` at insert time. If we naively called `localToUtc(date, null, tz)`, the result would be midnight-local-as-UTC (e.g. 04:00 UTC in EDT), causing every unconstrained recurring task to pile up at wall-clock midnight and consume morning/lunch capacity the user isn't working. The fix: leave `scheduled_at` NULL on insert and let the placement phase choose a slot from the `when`-window / time-block configuration. See `src/scheduler/runSchedule.js:357-365`.

### 9. Triggers — when the scheduler runs
- User edits a task (UI or MCP)
- Calendar sync (Google / Outlook / Apple) pulls remote changes
- Manual "Run scheduler"
- Task status flipped to done / skip / cancel
- Queue poller runs every ~2 s; dirty users get processed

### 10. Safety — why repeated runs are cheap
- Ordinal IDs (`masterId-N` for instances, `masterId-N-S` for split chunks) — date-agnostic, reusable across scheduler runs
- One scheduler run per user at a time via `sync_locks`
- Drift detection: if an instance's `(split_ordinal, split_total, dur)` doesn't match the chunk plan, reconcile fixes it before placement
- Idempotent on stable input: back-to-back runs on the same data produce zero changes

---

## Split chunks — when one task becomes N rows

A recurring task with `split=1` and `split_min=M` gets divided into chunks at reconcile time. Given a master duration `D`, `N = ceil(D / M)` chunks are produced per occurrence. Chunks share the same `occurrence_ordinal` and differ by `split_ordinal` (1..N).

### Row identity
- Chunk 1 id: `masterUUID-<ordinal>` (e.g., `abc123-1`)
- Chunk 2+ id: `masterUUID-<ordinal>-<splitOrdinal>` (e.g., `abc123-1-2`, `abc123-1-3`)
- `split_group`: links chunks of the same occurrence (set to the primary chunk's ID)

All chunks reference the same `master_id` and `occurrence_ordinal`.

### Placement
- Chunk 1 inherits the master's preferred time at insert. If the master has no specific time, the chunk's `scheduled_at` is left `null` and the placement phase assigns a slot from the `when`-window / time-block configuration (see §8 "Unscheduled-recurring midnight guard").
- Chunks 2..N start unplaced; the placement phase fits each around chunk 1 using the master's `when` / flex rules.

### Status propagation (done / skip / cancel)
The user's "mark done" intent applies to the **occurrence**, not the chunk. `PUT /api/tasks/:id/status` propagates the status update to every sibling chunk with the same `(master_id, occurrence_ordinal)` pair. Without this, marking chunk 1 done leaves chunk 2 active and the task "comes back" later the same day. See `src/controllers/task.controller.js:updateTaskStatus`.

### Drift detection
If the master's `dur` or `split_min` changes, reconcile recomputes `split_total` for every future occurrence and deletes/inserts chunks to match. A user can also manually change a chunk's `dur` — reconcile detects the drift via the `(split_ordinal, split_total, dur)` invariant.

---

## Deep-dive: 4c (deadline work)

### 4c-1. Build the chain graph and compute slack
- Every task with `deadline` is a **chain tail**
- A task is a **chain member** if it's a tail OR any task that transitively depends on it has `deadline`
  - Walk `depends_on` upstream from each tail — every node visited is in the chain
- A **chain** = {tail} ∪ {all transitive prerequisites of the tail via `depends_on`}
- A **solo anchor** = 1-member chain (tail with no prereqs)
- Past-due tails get `slack=0` and priority bumped to P1 (principle #2)

**Slack computation** — measures urgency as available capacity minus task duration:

- **Solo anchor (own deadline, no chain):** `slack = available_capacity(earliest..deadline) - duration`. Available capacity sums free minutes across eligible days in the task's `when`-windows.
- **Chain member:** Walk backward from the chain tail's hard deadline. For each predecessor P of consumer C, compute `P.mustFinishBy` by subtracting C's duration from C's `mustFinishBy` using a constraint-aware capacity walk (same approach: walk eligible days backward, subtract available minutes). Then `P.slack = available_capacity(P.earliest..P.mustFinishBy) - P.duration`.
- **Past-due:** `slack = 0` (most urgent).
- **No deadline:** `slack = Infinity` (handled in Phase 3/4).

Slack is computed **once** after Phase 1 (recurring placement), using current occupancy. It determines placement *order*, not exact placement — the forward scan handles actual capacity at placement time.

### 4c-2. Sort all constrained items by slack

All constrained items (solo anchors + chain members + constrained split chunks) are sorted into a single queue:

1. **Lowest slack first.** Most urgent tasks get first pick of capacity.
2. **Highest priority wins ties on slack.** Two tasks with identical slack → P1 places before P2.
3. **Longest remaining duration wins ties on priority.** Harder-to-fit tasks pick first.
4. **Deterministic `id` final tie-break** for repeatability.

### 4c-3. Forward placement pass

```
for each item in slack-sorted order:
   place item forward from max(today, start_after_at):
      walk days from earliest → effective_deadline, picking the
      earliest slot that fits (when-window, capacity, day-of-week,
      location, tools, dependency ordering via depsMetByDate)
   if placed: record in globalPlacedEnd
   else: leave for retry/rollback passes
```

### 4c-4. Retry pass
Some items may not place on the first pass because dependencies weren't placed yet (e.g., diamond DAGs where the sort order doesn't perfectly match topological order). After the main pass, retry all unplaced items — their deps may now be satisfied.

### 4c-5. Chain rollback
If a deadline task (chain tail) is still unplaced after the retry pass but its predecessors consumed the available capacity:
1. Unplace all chain members
2. Temporarily hide chain members from the dependency check
3. Re-place in **reverse topological order** (tail first, head last)
4. The tail gets first pick; predecessors fill remaining capacity

This ensures that under capacity pressure, the deadline task is prioritized over its prerequisites. Predecessors that don't fit are left unplaced.

### 4c-6. Past-due overflow
Tasks that couldn't fit within their (expired) deadline window get their deadline ceiling removed and are placed ASAP going forward. They carry a `_pastDue` flag for UI display.

### 4c-7. Chain interaction — slot competition across chains
Because the sort interleaves members from all chains by slack, multiple chains' tasks compete for the same slots. Sort rules from 4c-2 resolve every collision:

- **Different slack**: lower slack places first. A task due tomorrow beats a task due next week.
- **Same slack, different priority**: higher priority places first.
- **Same slack, same priority**: longer duration places first.
- **Shared prereq (P feeds both T1 and T2):** P gets the tighter `mustFinishBy` from whichever consumer imposes the stricter constraint, resulting in lower slack → earlier placement.

### 4c-8. Output of 4c
By the end of 4c:
- Every deadline task is either placed at its earliest feasible position ≤ its deadline, or placed past-due (ASAP with no ceiling), or flagged `unscheduled=1`
- Every chain prereq is either placed such that it ends ≤ its consumer's start, or unplaced (deadline task was prioritized during rollback)
- The "committed" layer is complete. 4d fills remaining gaps with free tasks.

---

## Edge cases

### Cycles in `depends_on`
Detected **once, up front**, immediately after classification. Offending edges dropped deterministically (by `id` sort); a `backwardsDep` warning is logged. The placement pass never sees cycles.

### Prereq with its own deadline
A prereq's effective deadline = `min(consumer.effective_start, own deadline)`. Handles the case where A (due Fri) depends on B (due Wed) — B is constrained to end by Wednesday even though A wants it by Thursday morning.

### Recurring prereq blocks its consumer
A recurring instance placed in 4b sits at a fixed time on its day. If a consumer needs to start before that recurring prereq ends, the consumer skips to the next eligible day. If no eligible day exists within constraints, the consumer is unscheduled.

### Tail unscheduled because deadline day is full
Past-due overflow (4c-6) removes the deadline ceiling and places ASAP. If even then no capacity exists, the task is flagged `unscheduled=1` with a past-due badge.

### Very long chains that can't all fit in the allowed days
Chain rollback (4c-5) prioritizes the tail. Farthest predecessors are left unplaced. Any portion of the chain that fits is placed.

### startAfter without deadline
An unconstrained task whose `start_after_at` is in the future goes to 4d and the forward fill respects the floor.

### startAfter > deadline
Impossible constraint. Detected during window computation. Task flagged with `_unplacedReason: 'impossible_window'`.

---

## What changed from the prior version of this doc

| Prior wording / design | Correction |
|---|---|
| "Priority is now the primary sort criterion" | **Deadlines are primary, priority is a tie-breaker.** Rewrote the sort order everywhere. |
| Per-chain sequential processing ("Phase 2 pull-forward by priority tier") | **Global backward sweep across all chain members**, ordered by `target_finish`. |
| Forward pull as a uniform chain shift | **Per-member reverse-topo pull**, so diamond-shaped DAG chains tighten internal gaps correctly. |
| Past-due as a separate rescue phase | Folded into classification: past-due = due today + priority bumped to P1. |
| Pinned tasks never evicted | Pinned tasks dropped **first** during pile-up resolution (5b). |
| "If a prereq can't place, continue the chain" | **Roll back the consumer** (and its transitive ancestors) to unscheduled. Leaving a tail placed with its prereq unscheduled creates false confidence. |
| Global backward sweep + forward pull (multi-pass convergence) | **Slack-based left-to-right placement.** Single forward pass sorted by constraint-aware slack. Chain rollback replaces backward sweep for capacity-constrained chains. |
| Past-due reclassified to unconstrained pool | **Past-due stays in constrained pool** with slack=0, P1 boost. Overflow pass places ASAP with no deadline ceiling. |
| Capacity reservation (reserve slots backward from deadline) | **Removed.** Slack-based ordering ensures urgent tasks get first pick naturally. |

---

## Verification

Tests that prove each guiding principle is honored:

### Principle 1 — deadlines drive, priority tie-breaks
- **Test:** P3 task due Thursday vs P1 task with no deadline. Today has one slot. Expected: P3 (deadline) wins, P1 (no deadline) goes to tomorrow.
- **Test:** Two P2 tasks, both due Friday. Expected: longer-duration task gets first pick of the latest Friday slot; shorter task follows.
- **Test:** Two P2 tasks, no deadlines. Expected: narrower when-window first within the priority tier (code uses when-width as the Phase 3 tie-break, not duration — see PDS-3 note).

### Principle 2 — past-due = due today + P1
- **Test:** Task due yesterday, own priority P3. Today has a slot contested with on-time P1 task also due today. Expected: both are effective-P1-due-today; longer-duration wins.

### Principle 3 — pinned tasks dropped first
- **Test:** Day over-committed with a pinned P2 and two on-time P1 chain members. Expected: pinned P2 evicted; both P1 chain members stay.

### Algorithmic invariants
- **Slack ordering:** two chains, one due Friday, one due Thursday. Expected: Thursday chain has lower slack → placed first. Friday chain fills around Thursday's commitments.
- **Diamond DAG:** A depends on B and C; B and C both depend on D. Slack sort places D earliest (tightest effective deadline), then B/C, then A. Forward placement satisfies deps naturally.
- **Shared prereq slack:** P feeds T1 (due Fri) and T2 (due Wed). P's effective deadline = `min(T1's effective_start, T2's effective_start)` → tighter bound → lower slack → placed early.
- **Chain rollback under pressure:** Chain A→B→C with C due today and insufficient capacity. Forward pass fills A/B but C can't fit. Rollback unplaces all, re-places C first (tail priority), then B fills remaining. A drops if no room.

### Regression
1. Run full test suite: `cd juggler-backend && npm test`
2. Manual scheduler run on the test user; verify:
   - No P1 deadline task lands at its deadline day's latest slot if earlier slots are free
   - No pinned task blocks a P1 deadline task from placing
   - Past-due tasks surface on today's schedule or in the unscheduled lane with a past-due badge
3. Idempotence: run the scheduler twice on stable input; second run's `executing N DB updates` log line should show 0 or near-zero.

---

## File changes

| File | Change |
|---|---|
| `src/scheduler/unifiedSchedule.js` | Rewrite the constrained-placement section to implement slack-based left-to-right placement with chain rollback |
| `src/scheduler/runSchedule.js` | No change — already clears `date_pinned` on placed tasks; already preserves `scheduled_at` on unscheduled items |
| `tests/schedulerScenarios.test.js`, `tests/schedulerDeepCoverage.test.js` | Add cases for each principle above; update any test that codified the old "priority is primary" behavior |

---

# Test Cases — Comprehensive Coverage

This section catalogs every use case the scheduler must handle correctly. Each case maps to one or more automated tests.

**Legend:** UC = Use Case, `[UNIT]` = pure scheduler function test, `[INT]` = integration test (DB + scheduler), `[TIME]` = time-simulation test

## 1. Rigid Habit Placement

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-1.1 | Rigid habit with `when:"lunch"` — lunch block is free | Placed at lunch block start (720) | [UNIT] |
| UC-1.2 | Rigid habit with `when:"lunch"` — previously misplaced at 7am (feedback loop) | Corrected to lunch block start, not 7am | [UNIT] |
| UC-1.3 | Rigid habit with `when:"morning"` — morning is in the past | Placed at morning start (past-time overlay, locked) | [TIME] |
| UC-1.4 | Rigid habit with `when:"evening"` — evening is in the future | Placed at evening block start | [UNIT] |
| UC-1.5 | Rigid habit with `when:"lunch"` — lunch block occupied by fixed calendar event | Fallback scan within lunch window, then nearby windows | [UNIT] |
| UC-1.6 | Rigid habit with multi-tag `when:"morning,lunch"` — morning free | Placed at morning start (first matching window) | [UNIT] |
| UC-1.7 | Rigid habit with no `when` tag — defaults to "morning,lunch,afternoon,evening" | Placed at first available window | [UNIT] |
| UC-1.8 | Rigid habit `when:"lunch"` across multiple days — verify each day gets correct placement | Lunch block on each day | [UNIT] |
| UC-1.9 | Rigid habit with `timeFlex: 30` — placed ±30m from window start | Within flex range of lunch start | [UNIT] |
| UC-1.10 | Two rigid habits both `when:"lunch"` — only 30m block | First gets the slot, second scans nearby | [UNIT] |

## 2. Non-Rigid Habit Placement

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-2.1 | Non-rigid habit with `when:"morning,afternoon"` — both windows available | Placed in first matching window (morning) | [UNIT] |
| UC-2.2 | Non-rigid habit with flexWhen — all `when` windows full | Placed in any available slot (relaxed) | [UNIT] |
| UC-2.3 | Non-rigid habit with flexWhen:false — all `when` windows full | Stays unplaced | [UNIT] |
| UC-2.4 | Non-rigid P1 habit vs P1 deadline task competing for same slot | Deadline task gets priority (merged phase) | [UNIT] |
| UC-2.5 | Non-rigid habit on today — past time blocked, future available | Placed in future slot within when-window | [TIME] |
| UC-2.6 | Non-rigid habit with `dayReq:"weekday"` on a Saturday | Not placed on Saturday, placed on next weekday | [UNIT] |
| UC-2.7 | Daily habit generating instances for 7 days | 7 instances created, each on correct day | [UNIT] |
| UC-2.8 | Habit with `habitStart` in the future — scheduler runs today | No instance generated for today | [UNIT] |
| UC-2.9 | Habit with `habitEnd` in the past — scheduler runs today | No new instances generated | [UNIT] |

## 3. Deadline Task Placement

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-3.1 | P1 task due today — sufficient capacity | Placed on today | [UNIT] |
| UC-3.2 | P1 task due today — today full, tomorrow available | Placed on today (displaces lower-pri if needed) or deadline miss | [UNIT] |
| UC-3.3 | P1 task due in 5 days — plenty of capacity | Placed at earliest available slot (left-to-right), within deadline window | [UNIT] |
| UC-3.4 | P1 task due today vs P1 habit — capacity for only one | Deadline task wins (merged phase: deadlines before habits within same priority) | [UNIT] |
| UC-3.5 | P2 task due today vs P1 habit — capacity for both | Both placed (P1 habit first, P2 deadline second) | [UNIT] |
| UC-3.6 | Past deadline (due yesterday) — today available | Placed on today (past-due → today remap) | [UNIT] |
| UC-3.7 | Past deadline (due last week) — still unplaced | Placed on today with deadline miss penalty | [UNIT] |
| UC-3.8 | Deadline task with `startAfter` > `due` (impossible) | Warning issued, placed as best effort | [UNIT] |
| UC-3.9 | Deadline task with `dayReq:"weekday"` due on Sunday | Placed on Friday (last available weekday before due) | [UNIT] |

## 4. Priority Ordering

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-4.1 | P1, P2, P3 tasks — no deadlines — sufficient capacity | All placed, P1 earliest, P3 latest | [UNIT] |
| UC-4.2 | P3 task with deadline today vs P1 task no deadline | P3 deadline placed first (deadline governs) | [UNIT] |
| UC-4.3 | All same priority — placement order stable | Deterministic (by constraint narrowness) | [UNIT] |

## 5. Dependency Chains

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-5.1 | A depends on B — both on same day | B placed before A (earlier start time) | [UNIT] |
| UC-5.2 | A depends on B — B on day 1, A on day 2 | B on day 1, A on day 2 (deps met) | [UNIT] |
| UC-5.3 | Chain A→B→C — C has deadline | All placed in order, C near deadline | [UNIT] |
| UC-5.4 | Diamond: A→B, A→C, B→D, C→D | All placed respecting both paths | [UNIT] |
| UC-5.5 | Circular dependency: A→B→A | Detected, warning issued, one edge broken | [UNIT] |
| UC-5.6 | Backward dependency: A (pinned 3/20) depends on B (pinned 3/25) | Warning issued, constraint skipped | [UNIT] |
| UC-5.7 | Dependency on completed task | Dep treated as met (completed tasks are done) | [UNIT] |
| UC-5.8 | Deadline propagation: C due 3/20, B depends on C, A depends on B | A's effective ceiling ≈ 3/17-3/18 | [UNIT] |

## 6. Split Tasks

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-6.1 | 120m split task, two 60m gaps available | Split into two 60m chunks | [UNIT] |
| UC-6.2 | 90m split task, `splitMin:30` — three 30m gaps | Split into three 30m chunks | [UNIT] |
| UC-6.3 | 90m split task, `splitMin:60` — only one 60m gap | Only 60m placed, 30m unplaced (can't create runt) | [UNIT] |
| UC-6.4 | Split task with dependency — dep must finish before first chunk | First chunk after dep completion | [UNIT] |
| UC-6.5 | Split task across two days | Chunks on day 1 and day 2 | [UNIT] |
| UC-6.6 | Split task with location constraints — gap crosses location boundary | Chunks respect location at each minute | [UNIT] |

## 7. Location & Tool Constraints

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-7.1 | Task requires `personal_pc` — home location has it, work doesn't | Only placed during home blocks | [UNIT] |
| UC-7.2 | Task requires `printer` — only available at work and home | Placed in blocks where location is work or home | [UNIT] |
| UC-7.3 | Task with `location:["work"]` — day is all at home | Cannot be placed (location mismatch) | [UNIT] |
| UC-7.4 | Location schedule override (e.g., travel day) — all transit | Tasks requiring home tools cannot be placed | [UNIT] |
| UC-7.5 | Hour-level location override at noon — changes from home to work | Tasks at noon use work tools, not home | [UNIT] |
| UC-7.6 | Location resolution priority: hour override > template > time block > default | Correct cascade | [UNIT] |

## 8. Time-of-Day Simulation

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-8.1 | Scheduler runs at 6am — full day available | All tasks placed in morning/afternoon/evening | [TIME] |
| UC-8.2 | Scheduler runs at noon — morning past | Morning tasks stay (past overlay), afternoon+ available | [TIME] |
| UC-8.3 | Scheduler runs at 10pm — most of day past | Only night block available for new tasks | [TIME] |
| UC-8.4 | Scheduler runs at 11:59pm — day nearly over | Almost nothing available, most deferred to tomorrow | [TIME] |
| UC-8.5 | Scheduler runs at 6am, then again at noon — same day | Results consistent; tasks don't jump around | [TIME] |
| UC-8.6 | Scheduler runs at noon — rigid morning habit | Morning habit placed in past overlay (locked, not moved to afternoon) | [TIME] |
| UC-8.7 | Scheduler runs at 1pm — `when:"lunch"` habit, lunch is 12-1pm | Lunch habit placed at noon (past overlay, locked) | [TIME] |
| UC-8.8 | Scheduler runs Monday 8am, then Wednesday 8am — multi-day | Monday tasks stable, new tasks fill Wednesday | [TIME] |
| UC-8.9 | Full week simulation: run at 8am each day for 7 days | All habits placed correctly each day, no drift | [TIME] |
| UC-8.10 | Full month simulation: verify no feedback loops compound over 30 runs | Habits stay in their windows, no gradual drift | [TIME] |

## 9. Fixed Tasks & Calendar Events

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-9.1 | Fixed task at 2pm for 60m | Occupies 2-3pm exactly, other tasks work around it | [UNIT] |
| UC-9.2 | Two fixed tasks overlap (1-2pm and 1:30-2:30pm) | Both placed, overlap warning issued | [UNIT] |
| UC-9.3 | Fixed task with `travelBefore:30` | 30m before task is blocked from other placements | [UNIT] |
| UC-9.4 | Calendar event synced from Google — becomes fixed | Treated as immovable anchor | [UNIT] |
| UC-9.5 | Marker (non-blocking) at 10am | Other tasks can be placed at 10am | [UNIT] |
| UC-9.6 | Fixed task at midnight (00:00) | Not treated as "past" on current day | [UNIT] |

## 10. Recurring Task Expansion

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-10.1 | Daily habit — generate for 7 days | 7 instances with correct IDs (`rc_templateId_MMDDYYYY`) | [UNIT] |
| UC-10.2 | Weekly habit (M,W,F) — generate for 14 days | 6 instances (3 per week × 2 weeks) | [UNIT] |
| UC-10.3 | Biweekly habit — boundary check | Only every other week | [UNIT] |
| UC-10.4 | Monthly habit (1st and 15th) — February | 1st and 15th (not 28th/29th) | [UNIT] |
| UC-10.5 | Monthly habit (last day) — February vs March | Feb 28 (or 29), Mar 31 | [UNIT] |
| UC-10.6 | Dupe prevention — instance already exists in DB | Not re-created | [INT] |
| UC-10.7 | Habit paused — no new instances generated | Expansion skips paused templates | [UNIT] |
| UC-10.8 | Habit disabled — no new instances generated | Expansion skips disabled templates | [UNIT] |
| UC-10.9 | Instance marked done — not re-scheduled | Done status preserved across runs | [INT] |
| UC-10.10 | DST spring forward — habit near 2am boundary | Instance generated with correct date | [UNIT] |

## 11. Slack-Based Placement Ordering

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-11.1 | Deadline task on day 10, days 1-9 mostly empty | Placed at earliest available slot (left-to-right) within deadline window | [UNIT] |
| UC-11.2 | Two tasks, same priority, different deadlines | Lower-slack task placed first | [UNIT] |
| UC-11.3 | Deadline task with dependency — dep on day 5 | Task placed after day 5 (deps enforced at placement time) | [UNIT] |
| UC-11.4 | `startAfter` constraint | Respected — no placement before startAfter date | [UNIT] |

## 12. Hill Climbing Optimization

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-12.1 | Hill climb disabled (0 iterations) | Score equals greedy-only score | [UNIT] |
| UC-12.2 | Hill climb enabled — score should not worsen | Score ≤ greedy score | [UNIT] |
| UC-12.3 | Swap doesn't violate dependencies | After swap, deps still met | [UNIT] |
| UC-12.4 | Cross-day swap respects priority ordering | Higher-pri never moved to later day | [UNIT] |
| UC-12.5 | Date-shift respects `startAfter` | Task not moved before startAfter | [UNIT] |

## 13. Scoring Correctness

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-13.1 | All tasks placed, no conflicts | Score = 0 (or near 0) | [UNIT] |
| UC-13.2 | One unplaced P1 task | Score penalty = 1000 × 4 (P1 multiplier) | [UNIT] |
| UC-13.3 | Deadline miss by 1 day, P2 | Score penalty = 500 × 3 × 1 | [UNIT] |
| UC-13.4 | Lower-pri task before higher-pri same day | Priority drift penalty | [UNIT] |
| UC-13.5 | Habit placed 2 hours from preferred time | Habit time drift penalty | [UNIT] |

## 14. Overflow & Relaxation

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-14.1 | Task can't fit on assigned day — overflow ±1 day | Placed on adjacent day | [UNIT] |
| UC-14.2 | Task can't fit ±2 days — stays unplaced | Unplaced with warning | [UNIT] |
| UC-14.3 | flexWhen task — `when` windows full | Placed in "anytime" window, marked `_whenRelaxed` | [UNIT] |
| UC-14.4 | Habit rescue — bump non-habit to make room | Habit placed, non-habit re-placed on another day | [UNIT] |
| UC-14.5 | Habit rescue fails — bumped task can't re-place | Entire bump reverted, habit stays unplaced | [UNIT] |

## 15. Persistence & Feedback Loop Prevention

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-15.1 | Scheduler runs twice — results identical (idempotent) | Same placements both runs | [INT] |
| UC-15.2 | `original_scheduled_at` reset before each run | Non-fixed tasks reset to original time | [INT] |
| UC-15.3 | Fixed task NOT reset | `when:"fixed"` tasks keep their scheduled_at | [INT] |
| UC-15.4 | Habit misplaced in run 1 — corrected in run 2 | `when`-window override fixes the placement | [INT] |
| UC-15.5 | Task edited by user between runs — new time honored | User edit persists, scheduler respects it | [INT] |
| UC-15.6 | Schedule cache invalidated on timezone change | Re-runs scheduler with new timezone | [INT] |
| UC-15.7 | Schedule cache invalidated on task update | Stale cache not served | [INT] |

## 16. Edge Cases & Boundary Conditions

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-16.1 | Zero tasks | Empty result, no errors | [UNIT] |
| UC-16.2 | One task, 30m, full day available | Placed at first available slot | [UNIT] |
| UC-16.3 | 100 tasks, day nearly full | As many placed as possible, rest unplaced | [UNIT] |
| UC-16.4 | Task with `dur:0` | Skipped (zero duration) | [UNIT] |
| UC-16.5 | Task with `dur:720` (12 hours) | Clamped to max, placed across available time | [UNIT] |
| UC-16.6 | Task with `dur:1440` (24 hours) | Clamped to 720, placed as much as possible | [UNIT] |
| UC-16.7 | Task at 10:30pm, 120m duration — extends past midnight | Clamped to grid end (11pm) | [UNIT] |
| UC-16.8 | All statuses excluded: done, cancel, skip, pause, disabled | None scheduled | [UNIT] |
| UC-16.9 | WIP status task with timeRemaining | Uses timeRemaining, not full dur | [UNIT] |
| UC-16.10 | Date crossing month boundary (3/31 → 4/1) | Correct date handling | [UNIT] |
| UC-16.11 | Orphaned when-tag (no matching time block) | Reassigned to anytime, warning issued | [UNIT] |
| UC-16.12 | Priority normalization: "2" → "P2", null → "P3" | Correct normalization | [UNIT] |
| UC-16.13 | No overlaps invariant — run 50 random scenarios | Zero overlaps in all cases | [UNIT] |

## 17. Timezone & DST

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-17.1 | UTC round-trip: local→UTC→local | Same date/time | [UNIT] |
| UC-17.2 | DST spring forward: 2am→3am (Mar 8 2026 US) | Correct handling, no lost hour | [UNIT] |
| UC-17.3 | DST fall back: 2am→1am (Nov 1 2026 US) | Correct handling, no duplicate hour | [UNIT] |
| UC-17.4 | Task scheduled at 2:30am during spring forward | Snapped to 3:00am (or 1:30am) | [UNIT] |
| UC-17.5 | Scheduler in US/Eastern, task created in US/Pacific | Correct conversion both ways | [UNIT] |
| UC-17.6 | todayKey/nowMins correct for different timezones | 8am EST = different todayKey than 8am PST | [UNIT] |

## 18. Integration: Full DB Pipeline

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-18.1 | Load tasks from DB → run scheduler → persist results | scheduled_at updated in DB | [INT] |
| UC-18.2 | Expand recurring → schedule → persist instances | Instances in DB with correct scheduled_at | [INT] |
| UC-18.3 | Run scheduler twice — DB state consistent | No duplicate instances, same placements | [INT] |
| UC-18.4 | Mark instance done → re-run → done instance untouched | Status preserved, not re-scheduled | [INT] |
| UC-18.5 | Delete habit template → instances orphaned | Orphaned instances not re-generated | [INT] |
| UC-18.6 | Change habit template `when` → instances updated | New instances use updated when-windows | [INT] |
| UC-18.7 | Config change (add time block) → re-run | New block available for scheduling | [INT] |
| UC-18.8 | Concurrent scheduler runs blocked by sync lock | Second run waits or fails gracefully | [INT] |

## 19. User's Real Config Scenarios

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-19.1 | Friday: Lunch habit `when:"lunch"`, blocks have lunch 720-780 at `loc:"work"`, but location template resolves to home | Lunch placed at 720 (noon), tool availability from home (not work) | [UNIT] |
| UC-19.2 | Thursday: `locScheduleDefaults.Thu = "weekend"`, weekend template all-home | All blocks resolve to home location | [UNIT] |
| UC-19.3 | P1 "File for Unemployment" due today + P1 habits — merged phase | Deadline task placed before habits within P1 tier | [UNIT] |
| UC-19.4 | "Apply for Jobs" (P1 habit, flexWhen) + "Resume Optimizer" (P1 habit) — afternoon | Both placed, flex habit can shift if needed | [UNIT] |
| UC-19.5 | Travel day override (3/31 → "car" template) — tasks requiring home tools | Tasks with `tools:["personal_pc"]` only in evening (home after transit) | [UNIT] |
| UC-19.6 | Dr. Nguyen telehealth (gcal, fixed) at 1pm blocks afternoon | Other tasks scheduled around it | [UNIT] |
| UC-19.7 | Morning prescriptions (rigid habit) + Eat Breakfast (rigid habit) + Lunch (rigid habit) | Each in their correct block, no interference | [UNIT] |
| UC-19.8 | "weekend" location template missing minutes 765-810 — fallback to time block loc | Minutes 765-780 resolve to time block's lunch loc | [UNIT] |

## 20. Priority / Deadline Algorithm Invariants

These encode the three guiding principles at the top of this doc (deadlines over priority; past-due = today + P1; pinned-first eviction) and the slack-based forward placement algorithm.

### Principle 1 — deadlines drive, priority tie-breaks

| UC | Scenario | Expected |
|----|----------|----------|
| PDS-1 | P3 task due Thursday vs P1 task with no deadline. One slot free today. | P3 wins today (deadline → lower slack → placed first). P1 placed on next available day. |
| PDS-2 | Two P2 tasks, both due Friday, different durations. | Longer-duration task placed first (priority tied → duration tie-breaks in slack sort). |
| PDS-3 | Two P2 tasks, neither with a deadline. | Within P2 tier in Phase 3, narrower when-window first (code: `unifiedSchedule.js:1799-1804`). **Note: an earlier version of this table said "longer-duration first"; the code uses when-width. If duration-tie is desired, add a duration-desc step to the Phase 3 comparator.** |
| PDS-4 | P1 task due in 56 days vs P4 task due tomorrow. | P4 has lower slack → placed first. P1's distant deadline means high slack → placed later. Neither starves the other. |

### Principle 2 — past-due tasks = slack 0 + P1

| UC | Scenario | Expected |
|----|----------|----------|
| PDP-1 | Task due yesterday, own priority P3. | Gets slack=0 + P1 boost. Placed at today's earliest free slot. |
| PDP-2 | Past-due P3 + on-time P1 both due today. One slot left. | Both have slack=0 + P1; longer-duration wins. Loser goes to overflow (placed ASAP with no ceiling) or unscheduled. |
| PDP-3 | Past-due task that can't fit today either. | Overflow pass places ASAP on future day. If still can't fit: `unscheduled=1` with past-due badge. |

### Principle 3 — pinned eviction first

| UC | Scenario | Expected |
|----|----------|----------|
| PE-1 | Day over-committed with a pinned P2 and two on-time P1 chain members. | Pile-up cleanup evicts the pinned P2 first; both P1 chain members stay placed. |
| PE-2 | Pinned P1 vs unpinned P4 chain member, same slot. | Pinned P1 still evicted first — pinning trumps priority in eviction order. |
| PE-3 | Two pinned tasks in the same slot. | Lower-priority pinned evicted first; ties on priority → longer-duration first; final tie-break `id`. |

### Slack-based placement ordering

| UC | Scenario | Expected |
|----|----------|----------|
| SL-1 | Two chains: Chain A tail due Friday, Chain B tail due Thursday. | Thursday chain has lower slack → placed first. Friday chain fills around Thursday's commitments. |
| SL-2 | Chain A (P1 tail due Fri), Chain B (P3 tail due Fri). Both fit only one slot. | Same slack → P1 wins on priority tie-break. P3 chain placed on next available day. |
| SL-3 | Shared prereq P feeds T1 (due Fri) and T2 (due Wed). | P's effective deadline = min(T1's effective_start, T2's effective_start) → lower slack → placed early. |
| SL-4 | Prereq B (own due=Wed) feeds tail A (due Fri). | B's effective deadline = min(A's effective_start, end-of-Wednesday) = Wednesday. B placed by Wed. |

### Diamond DAG placement

| UC | Scenario | Expected |
|----|----------|----------|
| DD-1 | Diamond DAG: A→(B,C)→D, all P2, one-hour each, one-week deadline window. | D has tightest effective deadline → lowest slack → placed first. B/C placed after D. A placed last. All satisfy dep ordering. |
| DD-2 | Chain with one member constrained by `start_after_at = 3 days out`. | Other members placed from today; constrained member waits for its floor date. |
| DD-3 | Chain where earliest slots are blocked by a pinned task. | Tasks placed in earliest available slot after the pin. |

### Chain rollback under capacity pressure

| UC | Scenario | Expected |
|----|----------|----------|
| CR-1 | Chain A→B→C, C due today, only 360m capacity, chain needs 540m. | Forward pass fills A/B but C can't fit. Rollback unplaces all, places C first. B fills remaining. A unplaced. |
| CR-2 | Chain A→B; B can't fit anywhere in deadline window. | B unplaced with diagnostic reason. A placed independently if it has capacity. |

### Idempotence

| UC | Scenario | Expected |
|----|----------|----------|
| IDEM-1 | Run scheduler twice on stable data. | Second run's log: `executing 0 DB updates` (or near-zero from incidental timestamp bumps). No placement changes. |
| IDEM-2 | Run scheduler after editing one task's `dur`. | Only affected chain re-evaluated; unrelated tasks keep byte-identical rows (deterministic ID check). |

---

## Running the Tests

```bash
# Unit tests (no DB needed)
npm test -- tests/schedulerRules.test.js

# Integration tests (requires Docker MySQL)
docker compose -f docker-compose.test.yml up -d
npm test -- tests/schedulerIntegration.test.js

# Time simulation tests
npm test -- tests/schedulerTimeSimulation.test.js

# All scheduler tests
npm test -- tests/scheduler*.test.js
```
