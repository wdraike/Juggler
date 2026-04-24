# Recurring-task spacing across cycles

## Problem

Cut Grass is weekly with `timesPerCycle=1` and all 7 days eligible. The picker anchors every cycle to the same weekday (the `recur_start`'s day-of-week) via target-interval steering, then the scheduler is allowed to roam within the cycle when the anchor day is full.

Roaming defeats spacing over multiple cycles:

```
Cycle 0 (4/24 – 4/30)  pick: Fri 4/24  actual: Sat 4/25 (roamed — Fri full)
Cycle 1 (5/1  – 5/7)   pick: Fri 5/1   actual: Fri 5/1
         → gap = 6 days, off by 1 from the weekly cadence

Worst case:
Cycle 0  actual: Thu 4/30 (end-of-cycle)
Cycle 1  actual: Fri 5/1  (next day)
         → gap = 1 day — the "two consecutive days across cycles" anti-pattern
```

The user's ask: track an "average spacing" so the scheduler doesn't drop the task on two consecutive days at cycle boundaries.

## Design principles

1. **Minimum-spacing guard is the right primitive.** "Average spacing" is easy to state but hard to enforce over a single scheduler run; the practical knob is a **minimum gap** between consecutive placements of the same recurring master. `floor(cycleDays * 0.5)` is a defensible default (half the cycle).
2. **Enforce at placement time, not pick time.** The picker runs once and can't see where the scheduler will roam. The scheduler sees the actual placement and already has the machinery to filter candidate days (dayReq filter, location check, etc.). Adding another filter is cheap.
3. **Seed from DB so cross-run spacing works.** Within one run the scheduler tracks placements as they commit. To respect the last completion / pending placement from a prior run, load the most recent date per master at run start and pass it in.
4. **Skip, don't fail.** If every day in the cycle is within the minimum-spacing window of a prior placement, the instance goes unplaced. That's the correct signal — the user either has too tight a cadence or a scheduling conflict worth surfacing.

## Implementation

### runSchedule.js — seed history

Alongside the existing `taskRows` / `terminalDedupRows` load, fetch the most-recent placement date per master across ALL statuses (pending, done, skip, cancel):

```js
var recurringHistoryRows = await db('task_instances')
  .where('user_id', userId)
  .whereNotNull('master_id')
  .whereNotNull('date')
  .select('master_id', db.raw('MAX(date) as latest_date'))
  .groupBy('master_id');

var recurringHistoryByMaster = {};
recurringHistoryRows.forEach(function(r) {
  if (r.master_id && r.latest_date) {
    recurringHistoryByMaster[r.master_id] = isoToDateKey(r.latest_date);
  }
});
```

Pass via `cfg.recurringHistoryByMaster` to the scheduler.

### unifiedScheduleV2.js — enforce + update

1. At scheduler entry, build a mutable `lastByMaster` from `cfg.recurringHistoryByMaster`.
2. After every recurring placement commits (all three sites), update:
   ```js
   var mid = item.task.sourceId || item.task.master_id;
   if (mid) {
     var prev = lastByMaster[mid];
     if (!prev || slot.dateKey > prev) lastByMaster[mid] = slot.dateKey;
   }
   ```
3. In `findEarliestSlot`, when the item is `isFlexibleTpc` and has a masterId:
   - Look up `lastByMaster[masterId]`. If absent, no guard.
   - Compute `minGap = Math.max(1, Math.floor(item.cycleDays * 0.5))`.
   - Compute minimum allowed candidate date = `lastByMaster[masterId] + minGap days`.
   - In the day loop, skip any `dates[i]` whose date is before that minimum.

### What stays as-is

- Picker (`expandRecurring.js`): unchanged. Its "pick the ideal cycle-aligned date" logic is still the right starting point; the scheduler's post-pick roam is what needs guarding.
- Day-lock semantics: unchanged. Rigid / non-tpc recurring still anchor to the picked day; only `isFlexibleTpc` instances roam, and only those get the spacing guard.
- dayReq filter: unchanged. The spacing filter layers on top of it.

## Edge cases

| Case | Behavior |
|------|----------|
| First-ever run (no history) | `lastByMaster[masterId]` absent → no guard → behaves exactly as today. |
| Master with history >1 cycle old | Guard passes trivially; date is far in the past. |
| User marks last instance `skip` / `cancel` | Does NOT count as history — skip/cancel means the user opted out of that slot. Treating it as cadence would over-constrain: a user who skips a week shouldn't be blocked from re-scheduling earlier than `minGap` days later. Only `status = 'done'` seeds spacing history. |
| Cycle is fully blocked within the min-gap window | Instance goes unplaced. Emits the standard "overdue → retry w/ relaxWhen" ladder; final fallback is unscheduled lane. Acceptable — user fixes by adjusting cadence or resolving the calendar conflict. |
| Daily tpc=1 recurring (cycleDays=1) | `minGap = max(1, floor(0.5)) = 1`. Adjacent-day pickup still allowed (cycle is 1 day). Effectively no guard — correct, because a 1-day cycle doesn't HAVE adjacent-cycle ambiguity. |
| Monthly tpc=1 (cycleDays=30) | `minGap = 15`. Prevents two placements within half a month of each other across month boundaries. Matches user intent for monthly habits. |
| Cross-timezone: history dateKey is user-local ISO | `slot.dateKey` is also user-local ISO via the scheduler's dates array. Direct string comparison works because both are `YYYY-MM-DD`. |

## Rejected alternatives

- **Two-pass: pick → schedule → re-pick cycles with bad spacing → re-schedule.** More complex, harder to reason about, risks oscillation.
- **Shift the pick based on anticipated roam.** Requires predicting what the scheduler will do, which defeats the point of having two layers.
- **Expose min-gap as a per-task setting.** Not needed for v1. `cycleDays * 0.5` is a sensible default; punting configurability until a real use case appears.

## Verification

1. Unit test: Cut Grass, Cycle 0 pick = Fri, force roam to Thu 4/30 (scheduler fills the week). Cycle 1 pick = Fri 5/1. Assert instance places >= Wed 5/7 (minGap=3 from Thu 4/30). [Thu + 3 = Sun; the first eligible day in cycle 1 after minGap is Sun 5/3.]
2. Regression: Cut Grass with no prior placements. Cycle 0 should place today/tomorrow as before.
3. Observability: log a one-liner when the spacing guard rejects a day, so we can trace "why did this instance skip Mon?" in production.
