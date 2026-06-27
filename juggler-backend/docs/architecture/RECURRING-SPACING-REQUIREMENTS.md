# Recurring Task Spacing — Requirements

**Service:** juggler
**Status:** draft (needs implementation)
**Last Updated:** 2026-06-27
**Backlog:** 999.874 (sub-item 2)

---

## User Story

As a user with a recurring task (e.g. "Call Mom 3 times per week"),
I want the scheduler to space my task instances evenly across the
recurrence cycle, so that I don't get two instances on consecutive
days while leaving other days empty.

---

## Requirements

### R1 — Instance Day Assignment

Each recurring instance SHALL be assigned a target day (start-on)
and a deadline, spaced by the minimum gap derived from the
recurrence configuration:

- For flexible TPC (timesPerCycle < selected days):
  `minGap = max(1, floor(cycleDays * 0.5))`
- For non-flexible TPC (timesPerCycle >= selected days):
  instances are day-locked to their recurrence pattern days
  (no spacing enforcement needed)

The first instance's start-on SHALL be the first eligible day of
the cycle. Each subsequent instance's start-on SHALL be the
previous instance's start-on + minGap days.

### R2 — Placement Attempt

The scheduler SHALL attempt to place each instance on its assigned
start-on day, within that day's time blocks and working hours.

### R3 — Start-On Relaxation

If an instance cannot be placed on its assigned start-on day
(no free slot within time blocks), the scheduler SHALL relax the
start-on forward one day at a time until it lands on a day that:

1. Is not already occupied by another instance of the same
   recurring master
2. Has a free slot within time blocks

### R4 — Average Spacing Recalculation

After each instance is placed, the scheduler SHALL recalculate the
average spacing across all placed instances of that master in the
current cycle. The remaining unplaced instances' start-on and
deadline SHALL be reset to maintain that average spacing.

### R5 — Recursive Relaxation

If a remaining instance (after R4 recalculation) cannot be placed
on its new start-on day, the scheduler SHALL apply R3 relaxation
again. This may cascade — each placement changes the average
spacing, which changes the remaining instances' targets.

### R6 — Unscheduled Fallback

If an instance cannot be placed after exhausting all relaxation
attempts (no valid day within the cycle), it SHALL be marked as
`unscheduled` with the reason surfaced to the user (e.g. "No
available slot within the recurrence cycle").

### R7 — Existing Instance Preservation

Already-placed instances from prior scheduler runs SHALL NOT be
moved by the spacing algorithm. Only new/unscheduled instances
are subject to spacing. The spacing guard uses the most recent
placement date per master as the starting reference.

### R8 — Scope

This spacing algorithm applies to flexible TPC recurring tasks
only. Non-recurring tasks, day-locked recurring (tpc >= selected
days), and rolling-interval tasks are not affected.

---

## Design Notes

- The existing spacing guard in `unifiedScheduleV2.js` (lines
  1102-1131) provides a simpler "block or allow" check. This
  requirement supersedes it with a multi-step algorithm.
- The `recurringHistoryByMaster` seeding in `runSchedule.js`
  (loading the most recent placement date per master) is the
  correct starting reference and should be preserved.
- The safety valve (relax guard when all search days are blocked)
  is replaced by the explicit relaxation algorithm in R3-R5.
