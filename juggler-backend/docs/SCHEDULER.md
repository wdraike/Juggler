# Scheduler — Design & Test Cases

## Status
**Current design.** Single source of truth for the scheduler placement algorithm and its test coverage. Consolidates the earlier `SCHEDULER-PRIORITY-REDESIGN.md`, `SCHEDULER-DEPENDENCY-REDESIGN.md`, and `SCHEDULER-TEST-CASES.md` drafts.

## Guiding principles

These three principles resolve every ambiguity in the placement logic. When the algorithm has to make a choice, it works through them in order.

1. **Deadlines drive the schedule; priority is a tie-breaker.** A P3 task due Thursday beats a P1 task with no deadline — the deadline is what gives the work urgency. Priority only decides the outcome when deadlines are equivalent (or both absent).
2. **Past-due tasks are treated as due today AND promoted to P1 for tie-breaking.** "It needed to be done yesterday" is the strongest urgency signal. Classification folds past-due into due-today; the priority boost ensures they win tie-breaks on today's slots.
3. **Pinned items get dropped first during pile-up resolution.** Pinned work is user-anchored, but when the scheduler is resolving a pile-up it treats pinned tasks as the most expendable — the user can re-pin them if they still matter.

---

## Plain-language outline

### 1. What the scheduler does
- Reads the user's tasks
- Picks a day and time for each one it can place
- Writes those picks back to the database
- Pushes a change summary to the frontend via SSE

### 2. Load phase — gather what we're working with
- Load every task the user owns (via `tasks_v` view)
- For each recurring task, expand into one row per upcoming occurrence within the next 56 days
- If a recurring task has split enabled (e.g., 60 min ÷ 30 min chunks = 2), materialize one row per chunk per occurrence (via `reconcile-splits.js`)

### 3. Classify each task by how it can move
- **Fixed** — user locked to a specific time (`when` includes `'fixed'`). Never moved
- **Markers** — reminders at a time that don't occupy a slot. Never moved
- **Pinned** — user set `date_pinned=1` with a specific `scheduled_at`. Never moved by the scheduler (though first to evict during pile-up cleanup)
- **Recurring instances** — see 4b for per-frequency placement rules
- **Deadline tasks** — anything with `due_at`. Past-due (due_at < today) is promoted here: `due_at` is remapped to today and priority is bumped to P1 for tie-breaking
  - A task is a **chain member** if it has `due_at` *or* any task transitively depending on it has `due_at`
  - A **solo anchor** = a chain of size 1 (a deadline task with no prereqs)
- **Free tasks** — no deadline, no chain membership. Place anywhere

### 4. Placement phase — figure out when each task goes

> **Implementation note:** in code (`src/scheduler/unifiedSchedule.js`), these four
> sub-phases are called Phase 0 / Phase 1 / Phase 2 / Phase 3+4. The mapping is:
> 4a → Phase 0 (immovables), 4b → Phase 1 (recurring), 4c → Phase 2
> (deadline work — reserve + forward-pull), 4d → Phase 3 (priority)
> + Phase 4 (flexWhen relaxation). Section **4e** below documents Phase 5
> (recurring rescue), which the earlier outline omitted.

#### 4a. Immovable first  *(Phase 0)*
- Fixed tasks at their locked times
- Markers at their times (no occupancy)
- Pinned tasks at their pinned times

#### 4b. Recurring instances by frequency  *(Phase 1)*
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

#### 4c. Deadline work (solo anchors + chains) — backward sweep, then forward pull  *(Phase 2)*
This is the heart of the scheduler. Fully completed before 4d, so free tasks fill around the committed chain layer.

See **"Deep-dive: 4c"** below for the global backward sweep with tie-break rules and the per-member forward pull.

#### 4d. Free tasks  *(Phase 3 + Phase 4)*
- **Phase 3** — walk priority tiers P1 → P2 → P3 → P4 (priority as tie-break only — these are all deadline-free, so nothing separates them beyond priority). For each task, place at the earliest free slot that respects its `when`, `dayReq`, `start_after`, and dependency constraints.
- **Phase 4** — retry any task that came in with `flexWhen=true` and didn't place in Phase 3, relaxing its `when` to `anytime`. Lets flexible tasks spill into non-preferred windows when capacity is tight.

#### 4e. Recurring rescue  *(Phase 5)*
After Phase 4, look for recurring instances whose template requires placement today (or within the recur window) but which didn't land in Phase 1. For each unplaced recurring:
- Try any remaining gap in the valid window, ignoring the `when` preference
- Try the next valid day if today has no capacity
- Mark `unscheduled=1` with a `missedRecurring` reason if nothing works

This is the last-chance pass before cleanup. Without it, a user who over-books a day loses their daily habit entirely instead of getting a "best effort" landing.

### 5. Cleanup

#### 5a. Merge adjacent same-task chunks
If two chunks of one split task landed back-to-back on the same day, fold them into a single longer block; delete the sibling row. Idempotent — reconcile re-splits and re-merges on the next run.

#### 5b. Resolve pile-ups by eviction order
When multiple tasks overlap on a slot that can't fit them all:

1. **Pinned tasks first** — principle #3. User can re-pin if it still matters
2. **Lowest effective priority next** — effective = own priority, with past-due bumped to P1 per principle #2
3. **Longest-duration first among tied priorities** — the larger task is "more expensive" to reshuffle, so if we're going to evict let it be the one that frees more space
4. **Deterministic `id` tie-break** for repeatability

Evicted tasks:
- Get `unscheduled=1`
- Keep their last proposed `scheduled_at` so the UI can render "was supposed to be at…"
- Carry a past-due badge if applicable

### 6. Persist
- Batch-update every placed task's `scheduled_at` and `duration`
- Clear `date_pinned` on any task the scheduler placed (the scheduler moved it, so the old pin is stale)
- Set `unscheduled=1` on evicted tasks
- All inside a single transaction per user

### 7. Notify
- Emit one SSE event (`schedule:changed`) carrying:
  - **Added** — full task rows for newly inserted items
  - **Changed** — `{id, patch}` pairs showing only the fields that moved
  - **Removed** — IDs of deleted rows
- Frontend merges these into in-memory state; calendar re-renders without re-fetching

### 8. Guard rails — what blocks placement
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
- Deterministic IDs (`masterId-YYYYMMDD-N`) — unchanged rows stay byte-identical across runs; no needless UPDATEs
- One scheduler run per user at a time via `sync_locks`
- Drift detection: if an instance's `(split_ordinal, split_total, dur)` doesn't match the chunk plan, reconcile fixes it before placement
- Idempotent on stable input: back-to-back runs on the same data produce zero changes

---

## Split chunks — when one task becomes N rows

A recurring task with `split=1` and `split_min=M` gets divided into chunks at reconcile time. Given a master duration `D`, `N = ceil(D / M)` chunks are produced per occurrence. Chunks share the same `occurrence_ordinal` and differ by `split_ordinal` (1..N).

### Row identity
- Chunk 1 id: `masterUUID-YYYYMMDD`
- Chunk 2+ id: `masterUUID-YYYYMMDD-2`, `masterUUID-YYYYMMDD-3`, …

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

### 4c-1. Build the chain graph
- Every task with `due_at` is a **chain tail**
- A task is a **chain member** if it's a tail OR any task that transitively depends on it has `due_at`
  - Walk `depends_on` upstream from each tail — every node visited is in the chain
- A **chain** = {tail} ∪ {all transitive prerequisites of the tail via `depends_on`}
- A **solo anchor** = 1-member chain (tail with no prereqs)
- Past-due tails are remapped to due-today *before* this step (principle #2); their priority is also bumped to P1 for subsequent tie-breaks

### 4c-2. Global backward sweep — one queue across all chains

Chains aren't processed one at a time. A single chain can mix priorities (a P3 prereq feeding a P1 tail — the prereq inherits urgency from its consumer, not from its own priority). Per-chain processing would starve a high-priority chain whose tail is a month out while a low-priority chain whose tail is tomorrow grabs today's slots.

Instead the scheduler maintains a **global ready queue** spanning every chain's members and walks them backward in time together.

**`target_finish`** — the latest wall-clock time a task is allowed to end:
- **Tail** (has `due_at`): `target_finish` = end of `due_at` day
- **Prereq**: `target_finish` = `min(consumer.start, own due_at end-of-day)` once the consumer is placed
- Initially only tails have `target_finish` known; prereqs join the queue as their consumers commit

### 4c-3. The sweep algorithm

```
ready  ← { every tail, keyed by target_finish = end-of-(due_at) }
while ready is non-empty:
   candidate ← pick-one(ready)            // see tie-break below
   place candidate backward from its target_finish:
      walk days from target_finish day → earlier, picking the latest
      slot that fits (when-window, capacity, day-of-week, etc.)
      respecting already-placed work (fixed, pinned, recurring,
      prior sweep placements)
   if placed:
      remove candidate from ready
      for each direct prereq P of candidate:
         add P to ready with
           target_finish = min(candidate.start, P.due_at end-of-day)
   else:
      mark candidate unscheduled and roll back: any consumer
      that already committed on the assumption this prereq
      would fit is also unscheduled (see 4c-6).
```

**pick-one** — applied in order:

1. **Latest `target_finish` first.** What has to end latest is committed first. Walking backward, later decisions constrain earlier ones. A Friday-due task is committed before a Wednesday-due task.
2. **Highest priority wins ties on `target_finish`.** Principle #1's tie-break rule. Two tails sharing Friday → P1 picks before P2 before P3 before P4. The P1 gets first pick of Friday's latest slot.
3. **Longest remaining duration wins ties on priority.** The bigger task is harder to fit, so letting it pick first prevents it from being the one that can't fit.
4. **Deterministic `id` final tie-break** for repeatability.

### 4c-4. Placement rules during the sweep
For any candidate being placed (tail or prereq):
- Honor `when`, day-of-week, day-of-month, location, tools — same as any placement
- Never land after `target_finish`. If no slot fits ≤ target_finish on the target day, step to the previous day and try its latest slot. Keep walking back until placed or we pass the task's `start_after_at`
- **Recurring prereqs stay on their occurrence day.** The sweep treats the recurring instance's position as a hard constraint. If the recurring instance ends after the consumer's start, the consumer's placement is redone under the new lower bound
- **Fixed / pinned siblings are immovable** during the sweep (pinned is only dropped during 5b pile-up resolution, not during placement)
- **Partial failure rollback:** if a prereq can't fit in `[start_after_at, target_finish]`, the prereq is marked `unscheduled=1` AND any descendant that already committed (whose placement assumed this prereq would fit before it) is also rolled back to unscheduled. Rationale: "Call attorney after reviewing contract" with the review unscheduled is nonsense; keeping just the call placed creates false confidence.

### 4c-5. Forward pull — per-member, reverse topo order
After the backward sweep, each chain sits "as late as possible within its deadline." Now pull each member forward to its earliest feasible position:

1. Walk chain members in **reverse topological order** (tail first, then consumers of the tail, then their prereqs, etc. — innermost prereqs last)
   - Why reverse topo: a consumer's forward pull depends on where its prereqs ended up; pulling the consumer forward first doesn't free space behind it. Pulling tail-first lets each prereq then pull forward into the freed gap.
2. For each member:
   - Find the earliest slot that:
     - Is on or after `start_after_at` and today
     - Is on or after `max(prereq.end)` across all its direct prereqs
     - Respects `when`, `dayReq`, location, tools
     - Isn't occupied by higher-priority placed work, another pulled chain member, fixed tasks, or recurring instances
   - If earlier than the member's current slot, move it
   - Delta is **per-member** — not a uniform chain shift. This is what makes diamond-shaped DAG chains tighten correctly: members with more slack move further, members with tight prereq bindings stay put
3. Iterate until no member moved in a full pass (multi-pass convergence; typically 2–3 passes)

### 4c-6. Chain interaction — slot competition across chains
Because the sweep interleaves members from all chains by `target_finish`, multiple chains' tails often compete for the same deadline-day slots. Tie-break rules from 4c-3 resolve every collision:

- **Same `target_finish`, different priority**: higher priority places first and grabs its preferred slot. Lower priority takes what's left; if nothing's left, its sweep walks back a day.
- **Same `target_finish`, same priority**: longer remaining duration picks first.
- **Different `target_finish`**: always later first. Friday's chain commits on Friday before Thursday's chain even enters the picture.
- **Shared prereq (P feeds both T1 and T2)**: P enters the ready queue when the *first* of T1 or T2 places. `target_finish` = `min(T1.start, T2.start)` — the tighter bound wins. Tie-break rules then decide P's slot.

**Chain members don't compete with their own siblings** — dep ordering means their placement is sequential within the chain. Competition happens across chains and across consumers of the same shared prereq.

### 4c-7. Output of 4c
By the end of 4c:
- Every deadline task (solo or tail) is either placed at its earliest feasible position ≤ its deadline, or flagged `unscheduled=1` with a past-due-style badge
- Every chain prereq is either placed such that it ends ≤ its consumer's start, or flagged `unscheduled=1` (with any transitively-committed descendants rolled back)
- The "committed" layer is complete. 4d fills remaining gaps with free tasks.

---

## Edge cases

### Cycles in `depends_on`
Detected **once, up front**, immediately after classification. Offending edges dropped deterministically (by `id` sort); a `backwardsDep` warning is logged. The sweep never sees cycles.

### Prereq with its own deadline
`target_finish` for a prereq = `min(consumer.start, own due_at end-of-day)`. Handles the case where A (due Fri) depends on B (due Wed) — B is constrained to end by Wednesday even though A wants it by Thursday morning.

### Recurring prereq blocks its consumer
A recurring instance placed in 4b sits at a fixed time on its day. If a consumer needs to start before that recurring prereq ends, the consumer has no valid slot on the recurring's day and walks back to the previous day. If the recurring has no flex and the consumer has `start_after` on or after the recurring's day, the consumer is unscheduled. Rare but possible.

### Tail unscheduled because deadline day is full
Even after past-due → today remap, today can be so full that the past-due task has no slot. Result: unscheduled with a past-due badge. User sees it in the unscheduled lane. Consistent with guard-rails behavior in section 8.

### Very long chains that can't all fit in the allowed days
The farthest-back prereqs spill out of [start_after, target_finish]; they get `unscheduled=1` and their consumers are rolled back (4c-6). Any portion of the chain that does fit still gets placed.

### startAfter without deadline
An unconstrained task whose `start_after_at` is in the future goes to 4d and the forward fill respects the floor.

### startAfter > deadline
Impossible constraint. Detected at 4c-4's backward walk when no day in `[start_after_at, target_finish]` has a slot. Task unscheduled with `_unplacedReason: 'impossible_window'`.

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

---

## Verification

Tests that prove each guiding principle is honored:

### Principle 1 — deadlines drive, priority tie-breaks
- **Test:** P3 task due Thursday vs P1 task with no deadline. Today has one slot. Expected: P3 (deadline) wins, P1 (no deadline) goes to tomorrow.
- **Test:** Two P2 tasks, both due Friday. Expected: longer-duration task gets first pick of the latest Friday slot; shorter task follows.
- **Test:** Two P2 tasks, no deadlines. Expected: longer-duration first within the priority tier; same priority = duration tie-breaks.

### Principle 2 — past-due = due today + P1
- **Test:** Task due yesterday, own priority P3. Today has a slot contested with on-time P1 task also due today. Expected: both are effective-P1-due-today; longer-duration wins.

### Principle 3 — pinned tasks dropped first
- **Test:** Day over-committed with a pinned P2 and two on-time P1 chain members. Expected: pinned P2 evicted; both P1 chain members stay.

### Algorithmic invariants
- **Backward sweep ordering:** two chains, one due Friday, one due Thursday. Expected: Friday tail placed first; Thursday tail placed after, working around Friday's commitments.
- **Diamond DAG forward pull:** A depends on B and C; B and C both depend on D. Back-sweep places A → B/C → D tightly. Forward pull then moves each independently; members with slack pull further, the most-constrained member stays put.
- **Shared prereq `target_finish`:** P feeds T1 (due Fri) and T2 (due Wed). Expected: P placed with `target_finish = min(T1.start, T2.start)` — almost certainly T2-adjacent.

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
| `src/scheduler/unifiedSchedule.js` | Rewrite the constrained-placement section to implement the global backward sweep + per-member forward pull |
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
| UC-3.3 | P1 task due in 5 days — plenty of capacity | Late-placed near due date (not pulled to today) | [UNIT] |
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
| UC-4.3 | Today nearly full — P3/P4 tasks without deadlines | Deferred to tomorrow (today reserved for P1/P2) | [UNIT] |
| UC-4.4 | todayReserved threshold boundary — exactly 60% capacity demand | P3/P4 just barely deferred | [UNIT] |
| UC-4.5 | All same priority — placement order stable | Deterministic (by constraint narrowness) | [UNIT] |

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

## 11. Pull-Forward & Dampening

| ID | Case | Expected | Type |
|----|------|----------|------|
| UC-11.1 | Deadline task on day 10, days 1-9 mostly empty | With dampening: lands mid-range, not day 1 | [UNIT] |
| UC-11.2 | Dampening disabled | Task pulled all the way to earliest available day | [UNIT] |
| UC-11.3 | Deadline task with dependency — dep on day 5 | Task pulled forward but not before day 5 | [UNIT] |
| UC-11.4 | `startAfter` constraint — can't pull before that date | Respected even with pull-forward | [UNIT] |

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

These encode the three guiding principles at the top of this doc (deadlines over priority; past-due = today + P1; pinned-first eviction) and the global backward sweep.

### Principle 1 — deadlines drive, priority tie-breaks

| UC | Scenario | Expected |
|----|----------|----------|
| PDS-1 | P3 task due Thursday vs P1 task with no deadline. One slot free today. | P3 wins today (deadline > priority). P1 placed on next available day. |
| PDS-2 | Two P2 tasks, both due Friday, different durations. | Longer-duration task gets first pick of Friday's latest slot (priority tied → duration tie-breaks). |
| PDS-3 | Two P2 tasks, neither with a deadline. | Within P2 tier, longer-duration first. Same tie-break rules apply even without deadlines. |
| PDS-4 | P1 task with `due_at` on the 56-day horizon edge vs P4 task with `due_at` tomorrow. | P4 tomorrow's tail is committed when backward sweep reaches it; P1 far-out tail already committed earlier. Neither starves the other — each owns its own deadline day. |

### Principle 2 — past-due tasks = due today + P1

| UC | Scenario | Expected |
|----|----------|----------|
| PDP-1 | Task due yesterday, own priority P3. | Classification remaps due_at → today AND bumps effective priority to P1 for tie-breaks. Placed on today's earliest free slot (competing with on-time P1 tasks). |
| PDP-2 | Past-due P3 + on-time P1 both due today. One slot left. | Both tied on target_finish + effective priority; longer-duration wins. The loser goes unscheduled; past-due badge if it was the past-due one. |
| PDP-3 | Past-due task that can't fit today either. | `unscheduled=1` with `scheduled_at` preserved as "last proposed time"; past-due badge remains. |

### Principle 3 — pinned eviction first

| UC | Scenario | Expected |
|----|----------|----------|
| PE-1 | Day over-committed with a pinned P2 and two on-time P1 chain members. | Pile-up cleanup evicts the pinned P2 first; both P1 chain members stay placed. |
| PE-2 | Pinned P1 vs unpinned P4 chain member, same slot. | Pinned P1 still evicted first — pinning trumps priority in eviction order. |
| PE-3 | Two pinned tasks in the same slot. | Lower-priority pinned evicted first; ties on priority → longer-duration first; final tie-break `id`. |

### Global backward sweep behavior

| UC | Scenario | Expected |
|----|----------|----------|
| SW-1 | Two chains: Chain A tail due Friday, Chain B tail due Thursday. | Friday tail placed first (latest target_finish); Thursday tail placed after, working around Friday's commitments. |
| SW-2 | Chain A (P1 tail due Fri), Chain B (P3 tail due Fri). Both fit only one slot. | P1 chain wins its preferred slot (priority tie-break on equal target_finish). P3 chain walks back one day. |
| SW-3 | Shared prereq P feeds T1 (due Fri) and T2 (due Wed). | P placed once with `target_finish = min(T1.start, T2.start)`. In practice T2-adjacent since its target is earlier. |
| SW-4 | Prereq B (own due=Wed) feeds tail A (due Fri). | B's effective `target_finish = min(A.start, end-of-Wednesday)` — Wednesday in this case. B placed by Wed, not pulled forward to A's start. |

### Forward pull — per-member, reverse topo

| UC | Scenario | Expected |
|----|----------|----------|
| FP-1 | Diamond DAG: A→(B,C)→D, all P2, one-hour each, one-week deadline window. | After backward sweep places A latest, B/C stacked before, D farther back. Forward pull walks tail-first: A pulls forward, then B/C pull into the gap A vacated, then D pulls in after B/C's new positions. |
| FP-2 | Chain with one member constrained by `start_after_at = 3 days out`. | Other members pull forward to today; the constrained member stays at its floor. Per-member delta, not uniform. |
| FP-3 | Chain where earliest slots are blocked by a pinned task. | Forward pull stops at the pinned task's upper bound — chain members sit right after the pin. |

### Rollback on failed prereq

| UC | Scenario | Expected |
|----|----------|----------|
| RB-1 | Chain A→B; B can't fit anywhere in `[start_after, target_finish]`. | A also reverted to `unscheduled=1` (no false-confidence placement). Both surface in unscheduled lane with diagnostic reason. |
| RB-2 | A→B→C chain; B fails, A and C independent of each other directly but both dependent through chain. | A (tail) unscheduled because its prereq B failed. C has no remaining consumer after B's failure; stays placed at its backward-sweep slot (effectively a solo until user repairs the chain). |

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
