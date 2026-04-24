# Scheduler overdue-placement ladder (#23 review)

## Context

Issue #23 asked to review how v2 handles tasks that cannot be placed within their ideal constraints. This doc records the ladder v2 actually runs, the options we considered, and the rationale for keeping the current shape.

## The ladder (as implemented)

`tryPlaceQueued` in `unifiedScheduleV2.js` tries up to four passes for each item, short-circuiting on the first success:

| Pass | Condition | Effect |
|---|---|---|
| 1 | always | Normal: respect `deadline`, declared `when`, day-locks, dayReq, travel, dep order, spacing guard. |
| 2 | `item.slack < 0` | Drop the deadline ceiling (`ignoreDeadline`). Slack < 0 means the task's window is already too small for its duration — placing past the deadline is the only way to land it. Emits `overdue` flag on the placement. |
| 3 | `item.flexWhen` | Relax `when` to `anytime`. For tasks the user explicitly flagged as "prefer this window but any is fine". Emits `whenRelaxed` flag. |
| 4 | `slack < 0 && flexWhen` | Both relaxations at once. Last resort. |

If all four fail, the item goes to `unplaced` and then Phase 8 marks it `unscheduled=1` (non-recurring) or leaves recurring instances visible at their last proposed `scheduled_at`.

## Options considered, and why we're not adding them

### "Bump lower-priority tasks to make room" (v1's Phase 4)

v1 had a "recurring rescue" phase that would displace a lower-priority placement to free a slot for a higher-priority one that couldn't fit. v2 doesn't do this.

Rejected because:
- Cascading — one bump can force another, and picking the "best" cascade is NP-hard in the general case.
- Hard to explain to the user. "Why did my lunch move?" — now requires tracing an unrelated higher-priority task's deadline math.
- V2's slack-first ordering makes constrained tasks place before unconstrained ones anyway, so the common case for rescue is already handled by the sort order, not a separate pass.
- If a P1 task genuinely can't fit anywhere, unplacing it and surfacing that to the user (overdue lane) is more honest than silently shuffling.

### "Move to today" as an explicit step

A user might want an overdue task to land at today 11pm rather than last Tuesday at noon. The current ladder places at the first free slot in the (deadline-ignored) range, which is usually today or later depending on current time and window availability.

Rejected because:
- Pass 2 already lands the task at the earliest free slot — which *is* today when today has capacity, and later when it doesn't. The semantic is equivalent to "try today first". Adding an explicit "today" step would just duplicate pass 2.
- If the user wants to force a task to today regardless of window, `date_pinned` exists and already goes through `tryPlaceAtTime` in the immovable pass.

### "Downgrade priority to squeeze in"

Drop a P2 task to P3 weight so it sorts behind a P3 that was going to fit, freeing its slot.

Rejected: violates user intent. Priority means something; the scheduler shouldn't forge it.

## Observable signals

Every step-recorder entry (admin Stepper UI) carries flags that make the overdue path visible:

- `overdue: true` when pass 2 or 4 used `ignoreDeadline`.
- `whenRelaxed: true` when pass 3 or 4 used `relaxWhen`.
- The stepper's `phaseRationale` surfaces both as "Placed as overdue (deadline missed — slack < 0)." and "Placed with when-window relaxed (flex_when fallback)."

Plus per-run telemetry in `unplaced` carries a `_unplacedReason` + `_unplacedDetail` that the frontend shows in the unscheduled lane, so the user can see WHY a task fell all the way through.

## Verdict

The four-step ladder is the right shape. No changes needed to close #23.

If a future bug shows up where the ladder isn't enough (e.g. a deadline-pinned task gets consistently displaced by lower-priority fixed ones), the fix will be one of:
- Surface a warning at unplace time with the specific conflicting task IDs.
- Add a user-facing "force-place at X" hook on the task card (manual override).

Both are surface-level changes that don't require a new scheduler pass.
