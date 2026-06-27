# SPEC — juggler-sweep-overdue — bugfix — 2026-06-26

Leg covers three related juggler scheduler/overdue backlog items (999.840 / 999.881 / 999.879).
All work on branch `sweep/juggler-2026-06-26` in worktree `.worktrees/juggler-sweep`. LOCAL commit only.

## Governing rules (LOCKED — honor, do not relitigate)
- NEVER-MISSING: every task is placed | overdue | unscheduled (always shown). Materialization mandatory; placement best-effort.
- R50: past+incomplete DATED items stay pinned past-due, never demoted to unscheduled (governs visibility/pinning, NOT the overdue label).
- 999.671 contract (taskMappers.js:339-371): a floating one-off (no recurrence, no deadline, not FIXED) is never committed → never overdue → rolls forward. A non-daily recurring instance is NOT overdue until its cycle boundary. **Settled — reversing needs a David ruling.**
- conflictBuckets.js = single source for Issues badge AND Issues page.
- Disjointness assertion (840.3) is fail-loud (WARN) — overlapping placements must be surfaced at persist.

## In-scope acceptance criteria

### AC-840-1 (AC2b) — window-close uses preferred_time_mins+time_flex, not the placed slot
- Overdue window-close for a windowed-daily instance = `(preferred_time_mins ?? scheduledMins) + time_flex`, NOT `scheduledMins + time_flex`.
- Oracle `CASE-1a-preferred` (currently `test.skip`, line 178) un-skipped → GREEN: placed 07:00, preferred 08:00 (480), timeFlex 180 (window closes 11:00), now 09:00 → `overdue === false`.
- The same window-close definition is applied consistently in `runSchedule.js computeWindowCloseUtc` (~201-208) which feeds missedHelpers.

### AC-840-2 (AC2c) — time_flex==0 distinct from time_flex==null
- `time_flex === 0` (zero-width window) → overdue AT the slot minute; `time_flex == null` (window-less daily) → no intra-day overdue (unchanged).
- Oracle `CASE-10a` (currently `test.skip`, line 592) un-skipped → GREEN: time_flex=0, scheduled 08:00, now 09:00 → `overdue === true`. Existing `CASE-10a-before` (now 07:00 → false) stays GREEN.

### AC-840-4 — effective-deadline = MAX(period-boundary, window-close)
- A named `computeEffectiveDeadline()` in runSchedule.js combines recurring period-boundary and flex window-close as an explicit `max(...)` (ignoring nulls), replacing the two independent sequential guards (~1862-1875). Behavior-preserving for existing green tests; window-close uses the AC-840-1 definition.
- **DETERMINATION (Oscar fix-loop iter 1, ernie F1):** the task/SPEC originally said `min()`. ernie proved this WRONG: the original two guards are independent OR early-returns ("live if within EITHER flex-window OR period-boundary"), so by De Morgan "overdue iff past BOTH" = `max(windowClose, periodBoundary)`. `min()` would make the R50.0 period-boundary extension dead (time_flex capped 0..480 → windowClose always earlier) and flag flexible-TPC recurring instances overdue mid-cycle — a LOCKED-R50.0 regression. `max()` is the exact behavior-preserving consolidation (regression-verified by the full scheduler suite staying green). **Flag for David:** task 999.840(4) wording "min" corrected to "max" per behavior-preservation + R50.0.

### AC-840-3 / AC-881-1 — fail-loud disjointness assertion at the persist boundary
- Immediately before the delta write (`runSchedule.js` ~1968-1971, `persistDelta`), a WARN-only per-day check over `result.dayPlacements`: for each dateKey, sorted by `start`, any `prev.start + prev.dur > next.start` logs `logger.warn('[SCHED] disjoint placement violation ...')` with the two task ids + slots. WARN-only — MUST NOT throw / abort the scheduler run.
- RED-before test (false-green-fixture-trap guard): construct two real grid-occupying placements that overlap (a FIXED blocker via localToUtc + placement_mode:'fixed', NOT a bare HH:MM:SS) → assert the warn fires; a disjoint set fires no warn. Prove the assertion is absent (no warn) on pre-fix code.

### AC-881-2 — temperature ceiling honored (regression lock; no code defect expected)
- count verified the weather wiring is clean end-to-end (`weather_temp_max` col → mapper `weatherTempMax` → `hasWeatherConstraint()` unifiedScheduleV2.js:916 → `weatherOk()` :946 enforces tempMax). Add a regression test: a slot whose forecast hour temp > `task.weatherTempMax` is rejected by `weatherOk()`/not selected; with `weatherTempMax=null` the check fails open (unchanged). Locks the contract so a future wiring break is caught.
- The reported 'cut grass' misplacement is a DATA condition (`weather_temp_max=null` — ceiling never saved via UI), not a code defect. Flag for David to confirm the stored value. (DEFER — see below.)

### AC-879-4 — reword the stale "past scheduled date" Issues help text
- `ConflictsView.jsx:81` currently: "The scheduler will move them to today on its next run." This is inaccurate for pinned/non-rolled items. Reword to an accurate description of the stale bucket (dated-past items with no hard commitment that the scheduler will roll forward where eligible). Keep it factual; flag the exact final wording for David sign-off (subjective UX wording).

## DEFERRED (recorded — needs David ruling / forbidden data; NOT worked this leg)
- **999.879 (1)(2)(3)** — overdue badge + same-slot-revert + Issues bucket reclassification for 'get a haircut'/'wash red car'. DEFER: every interpretation is a settled-decision reversal — if floating one-offs, treating them overdue reverses the 999.671 contract (Scooter BLOCK-level); if non-daily recurring, reverses non-daily-not-overdue-until-cycle-boundary. Task type unconfirmable without a forbidden dev-DB probe. **David ruling AMB-A required:** are these tasks (a) floating dated one-offs you want shown as overdue (reverses 999.671), or (b) non-daily recurring instances (then the `_isDailyRecur` gate at taskMappers.js:374 + the runSchedule.js:1636 `_overdue` placement-stub gap are the fix)?
- **999.881 (1) deeper placement root-fix** — PARTIAL: the disjointness assertion (AC-840-3) ships and will surface the overlap fail-loud; identifying/fixing the specific placement that produced the 1pm overlap is data-dependent (which tasks overlap, FIXED vs flexible) — needs the actual run data.
- **999.881 (2) data confirmation** — DEFER: confirm 'cut grass' stored `weather_temp_max` (DB probe forbidden in this leg). If null → data not code.
