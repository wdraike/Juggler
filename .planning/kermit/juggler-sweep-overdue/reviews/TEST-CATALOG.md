# Test Catalog — juggler-sweep-overdue — bugfix — 2026-06-26

_Last updated: 2026-06-26 — mode: bugfix — depth: standard_

## Oracle Tests Un-skipped (Step 0 RED baseline)

| AC | Test Name | File | Line | Pre-fix Result | Failing Assertion |
|----|-----------|------|------|---------------|-------------------|
| AC-840-1 / AC2b | CASE-1a-preferred — preferred_time_mins+timeFlex window-close | tests/unit/mappers/overdue-pastdue-recurring.test.js | 178 (was test.skip) | **RED** | `expect(task.overdue).toBe(false)` → `Expected: false, Received: true` (code uses scheduledMins+timeFlex=600; now=630≥600 → true; spec requires preferred=480+flex=180=660; now=630<660 → false) |
| AC-840-2 / AC2c | CASE-10a — time_flex=0 overdue at slot minute | tests/unit/mappers/overdue-pastdue-recurring.test.js | 592 (was test.skip) | **RED** | `expect(task.overdue).toBe(true)` → `Expected: true, Received: false` (code guard is `time_flex > 0`; time_flex=0 falls to window-less path → false; spec requires time_flex=0 → overdue at slot minute → true) |

## New Test Files

### tests/unit/scheduler/placement-disjointness.test.js

| Test | Pre-fix Status | Reason |
|------|---------------|--------|
| OVERLAP: A[780,60] + B[800,30] → 1 violation | **RED** | `checkPlacementDisjointness` is not yet exported from runSchedule.js → `TypeError: checkPlacementDisjointness is not a function` |
| DISJOINT: A[780,60] + B[840,30] boundary → 0 violations | **RED** | same — function undefined |
| MULTI-DAY: different dateKeys → 0 violations | **RED** | same — function undefined |

Contract bert must implement and export from `src/scheduler/runSchedule.js`:

```
checkPlacementDisjointness(dayPlacements)
  dayPlacements: { 'YYYY-MM-DD': [ { task: { id: string }, start: int, dur: int } ] }
  returns: Array<{ date: string, a: taskId, b: taskId, aStart: int, aEnd: int, bStart: int }>
  logic: for each dateKey, sort entries by start; flag any prev where prev.start + prev.dur > next.start
  boundary: prev.start + prev.dur === next.start is NOT a violation (touching allowed)
  scope: strictly per-dateKey — never cross-date comparisons
```

Export requirement: add `checkPlacementDisjointness` to `module.exports` in runSchedule.js.

### tests/unit/scheduler/weather-temp-ceiling.test.js

| Test | Pre-fix Status | Reason |
|------|---------------|--------|
| temp(30) > weatherTempMax(25) → false | **GREEN** | `weatherOk` already exported under `module.exports._testOnly`; implementation correct |
| temp(20) <= weatherTempMax(25) → true | **GREEN** | same |
| weatherTempMax=null → true (no ceiling) | **GREEN** | hasWeatherConstraint returns false → weatherOk returns true immediately |

`weatherOk` export path: `require('.../unifiedScheduleV2')._testOnly.weatherOk` (line 2443). No bert action needed for this export.

## Branch Enumeration (changed-region guards — Step 6b completeness floor)

Guards the diff will touch in `taskMappers.js` (AC-840-1, AC-840-2):

| Guard | Pinning Test |
|-------|-------------|
| `row.time_flex > 0` → windowed branch | CASE-10a (now un-skipped) flips RED when guard stays `>0` vs `>=0` |
| `windowCloseMins = scheduledMins + time_flex` vs `preferredTimeMins + time_flex` | CASE-1a-preferred (now un-skipped) is discriminating at now=10:30 |
| `time_flex == null` → anytime/no-window branch | CASE-10null (existing, green) pins this stays false |

Guards in `runSchedule.js` (AC-840-3):

| Guard | Pinning Test |
|-------|-------------|
| `prev.start + prev.dur > next.start` overlap predicate | OVERLAP test — bert must self-mutate to `>=` to verify DISJOINT flips RED |
| per-dateKey isolation (no cross-date) | MULTI-DAY test |

## Production-shape Input Variants

- `time_flex` stored as integer or null (DB column) — both shapes covered (CASE-10a uses 0; CASE-10null uses null)
- `preferred_time_mins` stored as integer or null — CASE-1a-preferred uses 480 (set); existing CASE-1 uses null (falls back to scheduledMins)
- `dayPlacements` entries shaped as `{ task: { id }, start, dur }` — matches the runSchedule.js internal shape bert will write against

## Mutation (not-wired — per-pin fallback checklist)

Stryker not wired for juggler-backend. Per-pin self-mutation required before GREEN declared:

- CASE-1a-preferred: bert swaps `preferredTimeMins ?? scheduledMins` ordering — test must flip RED
- CASE-10a: bert swaps guard from `!= null && >= 0` back to `> 0` — test must flip RED
- OVERLAP test: swap `>` to `>=` in checkPlacementDisjointness — DISJOINT test must flip RED (OVERLAP stays RED for different reason if equal)
- weather ceiling: swap `>` to `>=` in temp check (line 946 unifiedScheduleV2.js) — ceiling test (temp=25) would flip; use temp=20 vs 25 to verify (temp=20 < 25 ✓; bert must confirm mutation kills)
