# Scheduler v2 — Unified Spec

**Status:** Draft for user review. Covers Bucket 4 issues #23, #26, #31, #38, #39, plus #13 bundled from Bucket 3.

**Bounding memory**: scheduler bugs cascade and corrupt task data. v2 must land behind a shadow-mode flag with output-diff logging against v1 before any user sees v2 results.

---

## 1. Why rewrite

The current scheduler (`unifiedSchedule.js`, 2859 lines) is **phase-based** — six sub-phases (0 / 1 / 2 / 3 / 4 / 5) each with its own placement rules, occupancy grid interactions, and retry logic:

| Phase | Role |
|---|---|
| 0 | Pinned + markers + rigid recurring |
| 1 | Non-rigid recurring, slack-sorted within cycle window |
| 2 | Deadline-constrained tasks, slack-based forward placement |
| 3 | Free tasks by priority |
| 4 | `flexWhen` relaxation retry |
| 5 | Recurring rescue for Phase 1 misses |

The phase split leaks into the code: placement-mode branching is scattered, slack is computed once then ignored, and recurring behavior is a special case in every phase. Problems this creates:

- **Invariant drift**: each phase re-implements its own occupancy and window logic.
- **Inconsistent tie-breaking**: priority matters differently in Phase 2 (slack-first, priority-tiebreak) vs Phase 3 (priority-first).
- **Stale slack**: Phase 2 sorts by pre-Phase-2 slack, so two chain tails racing for the same capacity see identical slack values even after one of them wins.
- **Recurring placement is approximate**: Phase 1 expands N instances up-front without asking "how many are already done?" — so a 3×/week habit that was done Mon/Tue/Wed still gets Thursday/Friday instances expanded, creating noise.

Issue #38 is a request to drop the phase split entirely: **one constraint-driven queue, slack updated after each placement**. Issue #26 is the recurring counterpart — assess what's needed in the current window, not what's generically due.

---

## 2. Core algorithm (issue #38)

One pass. No phases. All tasks enter a single queue sorted by slack.

### 2.1 Task classification
Every task becomes a **placement item** with three intrinsic fields:

| Field | Meaning |
|---|---|
| `earliest` | The first minute the task could begin (max of `today`, `start_after_at`, deps-met time). |
| `deadline` | The last minute the task must end by. See §3 for derivation. |
| `mode` | Placement mode enum (§5). Controls which time windows are eligible. |

`slack = sum_of_eligible_capacity(earliest → deadline) − duration`

- `slack > 0` — task has breathing room
- `slack = 0` — task is perfectly constrained
- `slack < 0` — task is **overdue** (won't fit within deadline); will still be placed, flagged
- `slack = Infinity` — task has no deadline (free task)

### 2.2 Sort order

Single ordering rule applied to the entire queue:

1. **Slack ascending** (least slack first, overdue before merely tight).
2. **Priority ascending** (P1 before P4) — tiebreak only.
3. **Duration descending** (longer tasks place first) — harder-to-fit wins.
4. **Deterministic ID** — repeatability across runs.

No separate "priority tier walk" for free tasks. Free tasks have `slack = Infinity` and sort to the end of the same queue; priority only distinguishes them among themselves (rule 2).

### 2.3 Placement loop

```
sort queue by (slack asc, pri asc, dur desc, id)
for each item in order:
  pick earliest eligible slot in [item.earliest, item.deadline]
  that satisfies mode-specific rules (§5)
  commit: record on occupancy grid
  for each other item I in queue:
    if I shared any time window with the committed slot:
      recompute I.slack using current occupancy
      re-sort (or reinsert) I
```

The **recompute-on-commit** is the key innovation over v1. Two chain tails competing for Thursday capacity: when the first one wins a slot, the second's slack drops, and if it goes negative it jumps to the front of the queue and places as overdue.

### 2.4 Pinned / fixed / marker

These have `earliest = deadline = user's specified time`, so slack is naturally 0 or negative. Sort rule 1 puts them at the front. They place first and block their slots regardless of overlap.

Markers additionally have `duration = 0` so they don't consume capacity — they coexist with other placements at the same time.

### 2.5 Free tasks (no deadline)

`slack = Infinity`. Sort rule 2 orders them by priority among themselves, rule 3 by duration. They fill whatever capacity remains after constrained tasks place.

---

## 3. Deadlines — how `item.deadline` is derived

Three sources, first-match-wins:

1. **User deadline** (`task.deadline` column). One-offs with a hard due date.
2. **Chain deadline propagation** (unchanged from v1). A chain tail with `deadline = D` propagates `D - consumer_duration` back to each predecessor, constraint-aware (walks eligible days backward subtracting available minutes).
3. **Recurring cycle-window deadline** (#26 model, see §4). An instance's deadline is the end of its cycle window.

If none apply: `deadline = Infinity`, task is "free."

### 3.1 Overdue (#23)
`slack < 0` = overdue. v1's distinction between "past-due one-off" (P1 boost + reschedule) and "past-due recurring" (unscheduled, no roll forward) collapses into one rule:

**Overdue tasks place with the same sort rules but `deadline` is temporarily removed for placement** — they land at the earliest available slot after `today` and carry an `_overdue` flag.

The v1 "recurring past-due doesn't roll forward" rule becomes a recurring-specific property: a recurring instance whose cycle window has ended is **removed from the queue entirely** (not overdue — unschedulable). Next occurrence's cycle window is a new item.

**This is a behavior change from v1.** Review in §9.

---

## 4. Recurring window model (issue #26)

Replace v1's "expand N instances, hope they fit" with "compute what the window needs."

### 4.1 The window

Every recurring master has a **cycle window** — the period within which the required count of instances must happen. Defined by the master's recurrence type:

| Recurrence | Window |
|---|---|
| Daily | Each calendar day (Mon, Tue, …) |
| Weekly (specific days) | The calendar week; required count = number of specified days |
| Times per week | The calendar week; required count = user-specified |
| Day-of-month | The calendar month containing that day |
| Every-N-days | Rolling N-day window starting from `recur_start` |
| Monthly N times | The calendar month; required count = user-specified |

The **required frequency** (count per window) is read from `recur` JSON on the master.

### 4.2 Placement as an optimization

For each recurring master and each active window (current + next-horizon windows):

```
required = recurrence.countPerWindow
done     = count(instances where status ∈ {done, cancel} and scheduled_at ∈ window)
pending  = count(instances where status ∈ {'', wip} and scheduled_at ∈ window)
needed   = max(0, required - done - pending)

if needed == 0: no new instances to place this window
else: materialize `needed` placement items into the queue, each with
      earliest = max(today, window.start)
      deadline = window.end
      mode = master's mode
```

Key differences from v1:
- **No up-front expansion to a fixed horizon**. Instances only enter the queue when the current window demands them.
- **Completed-in-window counted**. If you hit 3/3 for "3× per week" by Wednesday, no more expansions this week.
- **Window horizon is recurrence-native**. Daily = today (+tomorrow maybe). Weekly = this week. Monthly = this month.

### 4.3 Multi-window lookahead

**Decision (2026-04-26): keep v1's 14-day horizon.** The window-aware `needed` logic still applies, just across every window the horizon spans:

```
for each window W in [current, +14 days]:
  compute (required, done, pending, needed) for W
  expand `needed` placement items for W
```

Example: weekly task 3×/week, today = Wednesday. v1 would expand 6 instances (2 weeks × 3). v2 expands:
- This week: required=3, done=2, pending=0 → expand 1
- Next week: required=3, done=0, pending=0 → expand 3
- Total: 4 instances across the 14-day view.

So the horizon controls visibility (user sees 2 weeks ahead); the window logic avoids over-expanding when earlier occurrences have already been handled.

### 4.4 Unscheduled handling

If a recurring instance's cycle window ends before it's placed, it's **not rolled to the next window** — removed from the queue and flagged `unscheduled = 1` with reason `missed_window`. The next window's expansion is independent. Same semantic as v1's "recurrings don't roll forward," just more cleanly expressed.

---

## 5. Placement mode enum (issue #13)

Replace the tangle of flags (`marker`, `rigid`, `flex_when`, `when='fixed'`, `preferred_time_mins`) with one `placement_mode` ENUM on `task_masters`:

| Value | Meaning | Time rules |
|---|---|---|
| `marker` | Calendar indicator; zero occupancy | Exact datetime, duration forced to 0 |
| `fixed` | User locked a specific datetime | Exact datetime, immovable |
| `pinned_date` | User locked a date; scheduler picks time | Any slot in work hours on that date |
| `recurring_rigid` | Same time every occurrence | `preferred_time_mins` required; no drift |
| `recurring_window` | Preferred time ± flex radius | `preferred_time_mins` + `time_flex` |
| `recurring_flexible` | Any time on occurrence day | Within `when` windows |
| `flexible` (default) | Scheduler decides everything | Within `when` windows + `start_after_at` + deadline |

Notes:
- `recurring` / `deadline` / `chain_member` are **properties** (from recurrence + depends_on + deadline columns), not modes. A `flexible` task can have a deadline. A `recurring_flexible` task cannot have a user-set deadline — its deadline is the cycle window end.
- `date_pinned` on `task_instances` is preserved for drag-pin (user drags an instance to a new slot). It sets the instance's mode to effectively `fixed` for that one occurrence without changing the master's mode.

### 5.1 Migration path (staged)
1. Add `placement_mode` ENUM column, backfill from existing flags.
2. Scheduler v2 reads `placement_mode` directly.
3. Write-path translator keeps old flags in sync during cutover.
4. After v2 ships, drop legacy flags in a cleanup migration.

---

## 6. Candidate-window caching (#38's optimization hint)

> it may be wise for each task to carry a list of the time windows or time blocks used in calculating its slack and reduce the time blocks or remove them from the list when other tasks are slotted into them

Implementation: each queued item carries `item.candidates = [{dateKey, start, end}, …]` — its eligible windows minus already-consumed minutes. On commit of task X at `(D, s, e)`:

```
for each remaining item I where I.candidates intersects (D, s, e):
  subtract the intersecting interval from I.candidates
  I.slack = sum(I.candidates) − I.duration
```

No re-walking the whole schedule per update; just local subtraction.

**Cost estimate:** N tasks, W candidate windows per task. Updates per commit: O(N·W). For N=300, W=20 → 6k ops per placement; 300 placements → 1.8M ops total. Well under 100ms.

---

## 7. BE→FE diff-only updates (issue #39)

Currently the SSE payload (per SCHEDULER.md §7) includes:
- **Added** — new row inserts
- **Changed** — `{id, patch}` pairs showing only *moved* fields
- **Removed** — deleted IDs

The complaint is that "changed" fires for tasks whose scheduler result didn't differ from their pre-run state. Likely cause: the patch builder compares *write* to the DB vs skipping the write entirely, and the DB write path emits SSE regardless.

**Fix** (can land independently of the v2 rewrite): at the end of `runSchedule`, compute a true before/after diff over `scheduled_at`, `dur`, `split_ordinal`, `status`, `unscheduled`, `date_pinned`. Only emit changes where at least one of those fields genuinely differs. Other field updates (derived caches, audit timestamps) are not interesting to the frontend.

Concrete: `runSchedule.js` currently has diff logic around lines 1100-1160 — tighten the comparator to skip equal-value updates. Should be a ~20-line change, testable independently.

---

## 8. Performance (#31)

v2 should be faster by construction because:
- One pass vs six.
- Candidate-window caching avoids re-walking occupancy.
- Window-aware recurring eliminates 14-day up-front expansion when the actual need is "this week."

Additional wins we should target:
- Precompute day windows (timeBlocks × location × dayReq) once per run, not per task-pass.
- Skip the scheduler entirely when the task_write_queue delta contains no scheduling-relevant fields.
- Short-circuit users with < ~10 tasks (no benefit from the sort overhead; just place in order).

---

## 9. Open decisions — need your input

### D1. Overdue recurring — remove or flag?

v1: unplaced, visible with `_pastDue` flag; user must mark done/skipped to clear.
v2 proposal: removed from the queue entirely if cycle window ended; task_instance is deleted.

**Question**: do you want missed recurring instances to linger in the UI ("you missed this") or silently disappear (new window's instance is your next chance)? v1 is the former; the proposal is the latter.

Recommend **keep v1's behavior** — the "you missed X" visibility is valuable for habit tracking. Instance stays with `unscheduled=1` + `missed_window` reason and shows in the issues view. Deletion happens only when the user marks it done/skipped.

### D2. Overdue one-offs — P1 boost?

v1: past-due one-offs get priority boosted to P1 for tie-breaking, placed ASAP.
v2 proposal: no priority boost; slack <= 0 already sorts them to the front of the queue.

**Question**: is the P1 visual badge (the user sees the task as P1 in the UI after past-due) desired, or is "overdue" a separate flag that doesn't override their priority setting?

Recommend **drop the P1 boost**. Priority should reflect the user's intent, not scheduler mechanics. "Overdue" is its own badge; don't conflate.

### D3. Tie-breaking with random — keep or deterministic?

#38 says "choose at random" for same-slack, same-priority, same-duration items. v1 uses task ID as the deterministic tiebreaker.

**Question**: random vs deterministic. Random spreads across runs (user can trigger re-placement by saving and hoping); deterministic is debuggable but potentially "always pick the same one."

Recommend **deterministic** (ID hash). Easier to debug; acceptable downside that same three items always sort the same way (edge case).

### D4. Candidate-window caching — do we need it?

§6 is a performance optimization described in #38. It's not strictly required — a simple "recompute slack from occupancy on every commit" works correctly, just slower.

**Question**: start simple (recompute from scratch) and add caching only if we measure a problem, or build it in from day 1?

Recommend **start simple**. Caching adds surface area for bugs; if profiling shows recompute is slow we add it.

### D5. Shadow-mode rollout

v2 must run in parallel with v1 before replacing it. Two options:

- **A. Dual-run, compare**: v1 still writes to DB + emits SSE; v2 runs after v1 and logs output. Diffs alert ops. Flip the flag when diffs are empty.
- **B. Dual-write with feature flag**: both write to DB under a flag, v1's writes commit, v2's writes go to a parallel table or JSON blob.

Recommend **A**. Cheaper, less destructive, easier to roll back.

**Question**: is a dual-run acceptable performance-wise during rollout (roughly 2× scheduler CPU)?

### D6. Scope of rewrite — all at once or staged?

v2 is ~one big rewrite. Alternatives:
- Ship §7 (BE→FE diff) immediately — independent win.
- Ship §4 (recurring window model) as a v1 patch — no algorithm change, just smarter expansion.
- Save §2-3 (one-pass constraint algo) for the rewrite proper.

Recommend **stage it**: §7 now, §4 as a v1 patch, §2-3 behind shadow flag. Reduces blast radius.

---

## 10. Proposed implementation order

If you greenlight the staged approach:

1. **§7 BE→FE diff tightening** — ~1 day. No algorithm change. Ship immediately.
2. **§4 recurring window model, v1-compatible** — ~3 days. Changes `expandRecurring` to count done-in-window instead of expanding to horizon. Scheduler still runs in phases; just sees a cleaner recurring queue.
3. **§5 placement_mode column** — ~1 day. Add column, backfill, write-path keeps flags in sync. Scheduler still reads flags.
4. **§2-3 constraint-only algorithm behind shadow flag** — ~5-7 days. Parallel run vs v1. Dual logging. When diffs are empty / explainable, flip.
5. **§6 candidate caching** — only if profiling warrants, post-shadow-mode-flip.
6. **Cleanup**: drop legacy flags, remove v1 scheduler code.

---

## 11. Decisions (recorded 2026-04-26)

- **D1 Missed recurrings** — keep v1: linger as unscheduled with `missed_window` reason.
- **D2 Overdue P1 boost** — drop. Overdue is a separate flag; priority reflects user intent.
- **D3 Tiebreak** — deterministic by ID hash.
- **D4 Candidate caching** — start simple (recompute from occupancy); add caching only if profiling warrants.
- **D5 Shadow mode** — dual-run with diff logging (A).
- **D6 Scope** — staged per §10.
- **§4.3 horizon** — keep v1's 14-day expansion window; apply `needed` computation per-window within the horizon.
