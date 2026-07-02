---
type: design
service: juggler
status: active
last_updated: 2026-07-02
tags:
  - type/design
  - service/juggler
  - status/active
  - scheduler
  - task-management
---

# Scheduler overdue-placement ladder (#23 review)

**Last Updated:** 2026-07-02

## Context

Issue #23 asked to review how v2 handles tasks that cannot be placed within their ideal constraints. This doc records the ladder v2 actually runs, the options we considered, and the rationale for keeping the current shape.

## Supersession note (leg juggy4, 2026-07-02)

This doc's four-pass `tryPlaceQueued` ladder below is **unchanged** by leg juggy4. What changed sits
one layer downstream: two **post-loop rescue passes** in `unifiedScheduleV2.js` — Phase 4
`missedWindowItems` (TIME_WINDOW tasks whose flex window is entirely past) and Phase 5
`pastAnchoredRecurrings` (recurring tasks whose `anchorDate < today`) — that run *after* an item has
already exhausted (or, for Phase 5, bypassed via `pastAnchoredPreQueue`) this ladder. These are
documented in full under `juggler-backend/docs/SCHEDULER-SPEC.md` §[PLACE-PHASES] (Phase 4/5 rows) and
§[PLACE-SPLIT] (overdue split-chunk routing).

**Prior behavior (commit `9bb62bb`'s when-block-anchor branch, SUPERSEDED):** when a recurring
TIME_WINDOW task's flex window passed and it had a `when` block, Phase 4 synthesized a **new** grid
placement directly into `dayPlacements` — with no `dayOcc`/`reserveWithTravel` occupancy check — so two
unrelated overdue tasks could land at the identical date+start (repro:
`.planning/kermit/juggy4/INTAKE-BRIEF.json`). Phase 5 had the same defect for past-anchored recurring
items with no explicit start time (fell back to `start=0` for every such item).

**Current behavior (David's product ruling, 2026-07-02):** Phase 4 and Phase 5 **never** write to
`dayPlacements`; every item they touch is routed to `unplaced` instead — matching the pre-existing
Phase 3 `missedPreferredTimeItems` precedent. This makes the "If all four fail…" sentence below
literally true for these cases too, which it previously was not (the when-block-anchor branch bypassed
"goes to unplaced" entirely). The persisted end-state is unchanged from what `runSchedule.js` §8 already
did for every *other* item that reaches `unplaced` — see the two-way split described just below the
ladder table.

## The ladder (as implemented)

`tryPlaceQueued` in `unifiedScheduleV2.js` tries up to four passes for each item, short-circuiting on the first success:

| Pass | Condition | Effect |
|---|---|---|
| 1 | always | Normal: respect `deadline`, declared `when`, day-locks, dayReq, travel, dep order, spacing guard. |
| 2 | `item.slack < 0` | Drop the deadline ceiling (`ignoreDeadline`). Slack < 0 means the task's window is already too small for its duration — placing past the deadline is the only way to land it. Emits `overdue` flag on the placement. |
| 3 | `item.flexWhen` | Relax `when` to `anytime`. For tasks the user explicitly flagged as "prefer this window but any is fine". Emits `whenRelaxed` flag. |
| 4 | `slack < 0 && flexWhen` | Both relaxations at once. Last resort. |

If all four fail, the item goes to `unplaced` and then `runSchedule.js` §8 ("Mark unplaced tasks",
`:1907-1987`) applies a 2-way split for recurring instances: **(a)** DB row already has a
`scheduled_at` (was placed on a prior run) → preserve `scheduled_at`/`date`, write `overdue=1` — stays
visible on the grid at its last real slot, NOT moved to the unscheduled lane (`:1940-1978`); **(b)**
DB row's `scheduled_at` is still `NULL` (never placed) → write `unscheduled=1` — moved to the
unscheduled-overdue lane, `date` stays pinned to its own anchor, never rolled forward (`:1980-1984`).
Non-recurring tasks get an analogous split further down §8 (`:1988+`).

## Phase-9 — Recurring missed-freeze

After the placement ladder, `runSchedule.js` Phase 9 auto-applies `status: "missed"` to past recurring instances whose timeFlex window AND recurrence-period boundary (R50.0 `recurringPeriodEndKey`) have both expired. The freeze slot for `scheduled_at` and `completed_at` follows a priority ladder:

| Priority | Source | Condition |
|----------|--------|-----------|
| 1 | `rawRowPast.scheduled_at` (last real placed slot) | Instance was placed at least once — `scheduled_at != null` in the DB row |
| 2 | `computeWindowCloseUtc(t, today, TIMEZONE)` | Never placed, but has a timeFlex window to close |
| 3 | `localToUtc(effectiveDate, '12:00 AM', TIMEZONE)` | Never placed and no computed window close |
| 4 | `clockNow()` | Fallback (should not be reached in practice) |

**Rule (LOCKED design, 999.808, W. David Raike 2026-06-19):** A missed PLACED instance freezes at its **last real `scheduled_at`** — the slot where the user actually had the task. A never-placed instance falls back to the period-deadline / `windowClose` / midnight of the occurrence date.

This refines R32.4 (which previously described the freeze slot as `windowClose` regardless of placement). The terminal-`scheduled_at` DB CHECK constraint is satisfied in both branches.

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
