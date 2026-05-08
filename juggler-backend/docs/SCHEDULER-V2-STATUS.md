# unifiedScheduleV2 — Gap Status Audit

**Audited:** 2026-05-08
**Audited by:** Plan qa-juggler/E (automated code inspection)
**Purpose:** Verify which "known gaps vs v1" from the file header comment are actually open vs
implemented in the current code. The original header listed all items as 4.3/4.4 future work.
Direct code inspection shows several were already implemented and the header was stale.

---

## Summary Table

| Gap | Status | Evidence | Severity if Open |
|-----|--------|----------|-----------------|
| Slack recompute after commit (4.3) | IMPLEMENTED | Lines 1138–1159 + sort at line 1109 | N/A |
| Chain deadline backprop | OPEN | Comment at line 262; no propagation code present | MEDIUM |
| Location/tool constraint enforcement | IMPLEMENTED | checkLoc line 732; canTaskRunAtMin() lines 805, 869 | N/A |
| Dependency-met check | IMPLEMENTED | checkDeps line 725; depsSatisfied() lines 804, 868 | N/A |
| timesPerCycle / recurring_rigid nuances | OPEN — held for UX review | No budget-aware logic in queue loop; MASTER-PLAN.md | LOW |
| Marker handling | OPEN (partial) | tryPlaceAtTime line 1039 covers time-set markers; time-unset markers fall to queue | LOW |
| Split chunks | Pre-inserted as DB rows (design intent) | Phase 1 design; no gap | N/A |

---

## Detailed Findings

### 1. Slack Recompute After Commit (4.3)

**Status:** IMPLEMENTED

**Code location:** `unifiedScheduleV2.js` lines 1067–1159

**How it works:**

After each successful placement commit in the main `while (queue.length > 0)` loop, the
algorithm performs incremental capacity subtraction on all remaining queued items whose eligible
date range includes the committed slot's date (lines 1138–1159). For each affected item it
computes `overlapWithEligibleWindows(other, slot.dateKey, slot.start, item.dur, ...)` and
subtracts the overlap from `other.capacity`, then re-derives `other.slack = other.capacity -
other.dur`. The queue is then re-sorted on every iteration via `queue.sort(compareItems)` at
line 1109, so the lowest-slack item always leads.

The comment at line 1074 notes that a min-heap would be faster (O(N log N) vs O(N² log N) for
N ≈ 300 tasks), but correctness takes priority over micro-optimization at this stage. At ~300
tasks the loop is ~600k operations, well within scheduler latency budget.

**Action:** None needed.

---

### 2. Chain Deadline Backprop

**Status:** OPEN

**Code location:** Comment at line 262: `"4.4 will refine chain backprop + cycle window computation for timesPerCycle"`. No backpropagation code exists in `unifiedScheduleV2.js`.

**How it works / what's missing:**

Currently, only user-supplied `deadline` values are honored. If task B depends on task A, and
task B has a hard deadline, task A does NOT receive a derived `fauxDeadline` equal to "latest
time A can end so B can still start and meet its deadline." In v1 the `runSchedule.js`
orchestrator computed `fauxDeadline` for chain predecessors before calling the scheduler.

In v2, the `buildItems()` function (around line 264) reads `t.deadline` directly. No logic
derives earlier deadlines for predecessors. A chain where only the tail member has a deadline
will schedule the head as a free (Infinity-slack) task, placing it last — after the tail, if
capacity allows. The tail may then fail its dependency gate and end up unplaced.

**Scenario where this causes incorrect scheduling:**

> A → B, B has deadline Friday. A has no deadline.
> Expected: A gets slack computed as if it must finish by Friday minus B.dur.
> Actual: A gets slack=Infinity (free), sorts last. B with low slack sorts first and lands
> Monday. A sorts after and also lands Monday — which satisfies the dep gate by accident.
> But if Monday has no capacity for B, B goes to unplaced even though A was placed.

**Action:** Fix in a future phase. See Recommended Fix below.

#### Recommended Fix

In `runSchedule.js` or in `buildItems()` in `unifiedScheduleV2.js`, after parsing items, run
a backward pass over the dependency graph:

```
for each item in reverse topological order:
  for each predecessor of item:
    candidate_deadline = item.deadlineDate minus predecessor.dur (in minutes)
    if predecessor.deadlineDate is null OR candidate_deadline < predecessor.deadlineDate:
      predecessor.deadlineDate = candidate_deadline
      # recompute predecessor.slack
```

This mirrors v1's `fauxDeadline` logic. It requires topological sorting of the dep graph before
the slack pass — `O(N + E)` where E is edge count. The existing `depsSatisfied()` traversal
already has the dep graph shape via `item.dependsOn` arrays.

---

### 3. Location/Tool Constraint Enforcement

**Status:** IMPLEMENTED

**Code location:** `unifiedScheduleV2.js`

- `checkLoc` initialized at line 732:
  ```js
  var checkLoc = cfg && item.task && (
    (Array.isArray(item.task.location) && item.task.location.length > 0) ||
    (Array.isArray(item.task.tools) && item.task.tools.length > 0)
  );
  ```
- `canTaskRunAtMin(item.task, d.key, s, cfg, toolMatrix, blocks)` called at line 805 inside
  `findEarliestSlot`'s inner slot loop.
- Same check replicated in `findLatestSlot` at lines 848–851 (checkLoc) and 869 (call site).

**How it works:**

`canTaskRunAtMin` is imported from `locationHelpers.js` (line 48). It receives the task, the
candidate date/minute, the full cfg object, and the toolMatrix. `checkLoc` is false when the
task has no location/tool requirements OR when `cfg` is null (cfg=null happens in some unit
test scenarios — fail-open is correct there).

Pinned/fixed/marker items bypass this gate intentionally — they go through `tryPlaceAtTime`
which does not call `canTaskRunAtMin` (lines 563–581). The comment at line 730 documents this.

**Action:** None needed.

---

### 4. Dependency-Met Check

**Status:** IMPLEMENTED

**Code location:** `unifiedScheduleV2.js`

- `checkDeps` initialized at line 725:
  ```js
  var checkDeps = placedById && item.dependsOn && item.dependsOn.length > 0;
  ```
- `depsSatisfied(item, i, s, placedById, statuses, dates)` called at line 804 inside
  `findEarliestSlot`'s inner slot loop.
- Same pattern in `findLatestSlot`: checkDeps at line 844, call at line 868.

**How it works:**

`depsSatisfied()` is defined at lines 606–626. It iterates `item.dependsOn`, looks up each dep
in `placedById` (seeded with immovable placements at line 1086–1092, then updated on each queue
commit at line 1131). A dep is considered satisfied when: its status is terminal
(done/cancel/skip/disabled/pause), it is not in the scheduling pool (undefined in `statuses`),
or its placed end time ≤ candidate start time. A dep that is live but not yet placed blocks the
candidate slot — the item defers to `unplaced` and gets a retry pass at line 1168.

`placedById` is passed into `findEarliestSlot` via `opts.placedById`. The `tryPlaceQueued`
helper (line 886) passes `base = { placedById, statuses, cfg, env }` to the slot-finding
functions, so the dep gate always has current placement state.

**Note on RESEARCH.md assumption A3:** The research document assumed `depsSatisfied()` might
not be called. This audit confirms it IS called — assumption A3 was incorrect. The dep-met
check is fully implemented.

**Action:** None needed.

---

### 5. timesPerCycle / recurring_rigid Nuances

**Status:** OPEN

**Code location:** MASTER-PLAN.md (deferred); no `timesPerCycle` budget logic in
`unifiedScheduleV2.js`.

**How it works / what's missing:**

`timesPerCycle` is an occurrence-count setting (e.g., "run this task 3 times per week"). The
scheduler currently treats each expanded recurring instance as an independent task. There is no
logic to enforce that exactly N instances are placed within a cycle window, or to spread them
across the cycle using a work-budget model.

The `isFlexibleTpc` flag exists in `buildItems()` (line ~342) and the `isDayLocked` derivation
uses it, but there is no capacity enforcement — a user setting `timesPerCycle=2` for a weekly
task will have both occurrences expanded as normal instances, but the scheduler does not
guarantee they land on different days or fall within the cycle's allowed window beyond the
basic date-range clamping.

**Severity:** LOW — affects advanced recurring scheduling fidelity. Basic recurring task
placement works correctly for the common case (once-per-day/week with no explicit count).

**Action:** Deferred to a future UX review phase per MASTER-PLAN. No immediate fix needed.

---

### 6. Marker Handling

**Status:** OPEN (partial)

**Code location:** `unifiedScheduleV2.js`

- Immovable path: lines 1038–1039 gate on `item.isMarker && item.anchorDate && item.anchorMin != null`.
- Queue fallthrough: markers without `anchorMin` skip the immovable gate and enter the
  slack-sorted queue. They have `dur=0` (line 241).

**How it works / what's missing:**

Markers WITH a specific time (`anchorDate` and `anchorMin` both set) are handled correctly:
they go through `tryPlaceAtTime` (line 1043), appear on the calendar at their precise time,
and have `dur=0` so they consume no occupancy (comment at line 1034).

Markers WITHOUT a time (anchorMin=null) fall through to the queue. With `dur=0`, the slot
search condition `s + item.dur <= winEnd` at line 802 reduces to `s <= winEnd`, always true
within any window. They will be placed at the earliest eligible window slot (e.g., start of
the morning block). This produces a valid placement but the semantics are unclear: is a
time-unset marker an "all-day" marker? There is no dedicated all-day marker rendering path.
The marker will appear at e.g. 08:00 rather than being marked as "all day".

**Severity:** LOW — affects markers without a specific time. Most marker usage in practice
sets an explicit time.

**Action:** To fix, add an explicit check in the immovable-path pre-filter: if
`item.isMarker && item.anchorDate && item.anchorMin == null`, place it as an all-day marker
(at `DAY_START`, locked=true, dur=0) without going through `findEarliestSlot`. This avoids the
ambiguous queue placement. Alternatively, define that time-unset markers are "all-day" at the
data layer and propagate `anchorMin = DAY_START` during `buildItems()`.

---

### 7. Split Chunks

**Status:** Design intent — not a gap

**Code location:** `unifiedScheduleV2.js` lines 282–285 (splitOrdinal/splitTotal extraction),
`isDayLocked` derivation at line 349.

**How it works:**

Split chunks are pre-inserted as distinct `task_instance` rows in the DB before the scheduler
runs. Each chunk carries its own `splitOrdinal` and `splitTotal` metadata. The scheduler treats
each chunk as a regular task item; `isDayLocked` for non-first chunks ensures all chunks of
the same occurrence share the same anchor day (line 349: `splitTot > 1` contributes to
`isDayLocked`).

This is Phase 1 design intent. A more sophisticated approach would split at scheduling time
based on available capacity, but the current approach of pre-splitting is deliberately simpler
and sufficient for the v2 milestone.

**Action:** None needed at this stage.

---

## Recommendations

Priority-ordered for any future phase addressing open gaps:

1. **(MEDIUM) Chain deadline backprop** — Implement a backward topological pass over the dep
   graph in `buildItems()` or `runSchedule.js` to propagate derived deadlines from chain tails
   to predecessors. See the Recommended Fix in §2 above. This is the highest-impact open item:
   it affects correctness for all dependency chains where only the tail has a deadline.

2. **(LOW) Marker all-day handling** — Add an explicit all-day placement path for time-unset
   markers (anchor them at DAY_START in the immovable phase, not via the slot-search queue).
   Low effort, improves calendar rendering correctness.

3. **(LOW) timesPerCycle work-budget awareness** — Defer until UX review confirms desired
   behavior. Current occurrence-count approach works for the common case.

---

## Track F Findings

The following item is not a scheduler gap but was surfaced during the code audit and is
included here as a consolidated finding for Track F (Code Quality).

### SSE `getStats()` Missing Export

**File:** `juggler-backend/src/sse-emitter.js`
**Caller:** `juggler-backend/src/routes/health.routes.js` — calls `sse.getStats()` inside the
`/api/health/detailed` handler.

**Finding:** `sse-emitter.js` does not export a `getStats` function. The health route wraps
the call in a try/catch, so there is no crash. The effect is that the `/api/health/detailed`
endpoint always reports SSE as `'operational'` without a live connection count — the catch
block returns a default value instead of actual SSE metrics.

**Severity:** LOW — no crash; health endpoint is already auth-gated; the missing count only
affects operational visibility (monitoring dashboards, admin health checks).

**Recommended fix:** Add `getStats()` to `sse-emitter.js` returning the current connection
count from the in-process Map registry (added in Task 9 per MASTER-PLAN.md). Three-line change:
```js
function getStats() {
  return { connections: clients.size };
}
exports.getStats = getStats;
```
Then the health endpoint will report actual SSE connection counts.
