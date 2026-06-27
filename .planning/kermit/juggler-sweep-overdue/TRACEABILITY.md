# Traceability — juggler-sweep-overdue — bugfix
| ID | Description | Design element | Code (file:sym) | Test(s) | Status |
|----|-------------|----------------|-----------------|---------|--------|
| AC-840-1 | Window-close uses preferred_time_mins+time_flex (AC2b) | overdue IIFE windowed-daily branch | taskMappers.js overdue IIFE (`(preferred_time_mins ?? scheduledMins)+time_flex`) | tests/unit/mappers/overdue-pastdue-recurring.test.js CASE-1a-preferred (un-skipped) | verified GREEN (RED→GREEN proven; zoe mutation-confirmed) |
| AC-840-2 | time_flex==0 distinct from null (AC2c) | overdue IIFE flex guard (`time_flex != null`) | taskMappers.js overdue IIFE | tests/unit/mappers/overdue-pastdue-recurring.test.js CASE-10a (un-skipped) + CASE-10a-before/10null/10b | verified GREEN (RED→GREEN; zoe mutation-confirmed) |
| AC-840-4 | effective-deadline = MAX(period-boundary, window-close) — corrected from min per ernie F1/R50.0 | computeEffectiveDeadline() max(non-null) | runSchedule.js computeEffectiveDeadline (~235) + call-site (~1942) | tests/unit/scheduler/effective-deadline.test.js (10/10) | verified GREEN (behavior-preserving, regression-confirmed) |
| AC-840-3 | Fail-loud WARN disjointness assertion at persist | persist-boundary guard | runSchedule.js checkPlacementDisjointness (exported) + WARN-only wiring before persistDelta | tests/unit/scheduler/placement-disjointness.test.js (3) | verified GREEN (RED→GREEN; zoe mutation-confirmed) |
| AC-881-1 | Overlap surfaced fail-loud (covered by AC-840-3) | persist-boundary guard | runSchedule.js (shared with AC-840-3) | tests/unit/scheduler/placement-disjointness.test.js (shared) | verified GREEN |
| AC-881-2 | Temperature ceiling honored (regression lock) | weatherOk/hasWeatherConstraint | unifiedScheduleV2.js:912-946 (no code change — wiring verified clean) | tests/unit/scheduler/weather-temp-ceiling.test.js (3) | verified GREEN (regression lock; zoe mutation-confirmed) |
| AC-879-4 | Stale-bucket help text accurate | Issues stale section | ConflictsView.jsx:81 (reworded) | bird UX-REVIEW (copy review) | verified (bird DONE; wording flagged for David sign-off) |
| DEFER-879-123 | Overdue badge/revert/bucket | — | taskMappers.js (isPlacedRecurringInstance gate); runSchedule.js:1636 | — | DEFER (David ruling AMB-A — settled-decision reversal 999.671) |
| DEFER-881-1d | Deeper placement root-fix | — | runSchedule.js placement | — | PARTIAL (assertion ships; root-fix data-dependent) |
| DEFER-881-2d | Confirm stored weather_temp_max | — | DB (forbidden probe) | — | DEFER (data) |
