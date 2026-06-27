# WBS — juggler-sweep-overdue — bugfix — 2026-06-26

## Intent
Fix three related juggler scheduler/overdue defects (999.840 effective-deadline follow-up;
999.881 cut-grass overlap+temperature; 999.879 overdue badge/bucket/wording). Honor LOCKED
rules (NEVER-MISSING, R50, 999.671 contract). TDD RED-before-GREEN; un-skip the 2 oracle tests.
LOCAL commit on sweep/juggler-2026-06-26 only.

## Scooter consult (Step 2.5)
R50 vs 999.671: floating dated one-off (no deadline, not FIXED) is settled `overdue=FALSE` /
roll-forward (taskMappers.js:339-371, 999.671 contract). Treating it overdue = BLOCK-level
settled-decision reversal → David ruling. Stale "past scheduled date" bucket is FOR exactly the
no-hard-commitment dated-past class. → 999.879 (1)(2)(3) DEFERRED.

## Work Items
| ID | Task | Mode | Scope | Inputs | Depends on | Acceptance | Agents | Wave |
|----|------|------|-------|--------|-----------|------------|--------|------|
| WI-1 | 840 core: overdue predicate AC2b (preferred_time_mins+time_flex) + AC2c (time_flex==0 vs null); un-skip CASE-1a-preferred + CASE-10a oracle tests → GREEN; consistent computeWindowCloseUtc + computeEffectiveDeadline=min(period,window) in runSchedule.js | bugfix | juggler-backend | taskMappers.js:423-425; runSchedule.js:201-208,252-262,1862-1875; oracle tests | — | AC-840-1, AC-840-2, AC-840-4 (SPEC) | telly,bert,ernie,zoe | 1 |
| WI-2 | 840.3/881.1: WARN-only disjointness assertion over result.dayPlacements at persist boundary (~1968-1971) + RED-first disjointness test (false-green-fixture-trap guard) | bugfix | juggler-backend | runSchedule.js persist boundary | — | AC-840-3 (SPEC) | telly,bert,ernie,zoe | 1 |
| WI-3 | 881.2: weather temp-ceiling regression test (no code change expected) — weatherOk rejects over-ceiling slot when weatherTempMax set; fails open when null | bugfix | juggler-backend | unifiedScheduleV2.js:912-946 | — | AC-881-2 (SPEC) | telly,zoe | 1 |
| WI-4 | 879.4: reword ConflictsView stale-bucket help text to be accurate; flag wording for David | bugfix | juggler-frontend | ConflictsView.jsx:81 | — | AC-879-4 (SPEC) | bert,bird | 1 |

## Dependency Graph
All items independent → single wave. (WI-1 internally couples taskMappers + runSchedule window-close
semantics but is one cohesive item; no cross-item dep.)

## Dependency Determination Log
| Dep | Type | Source |
| WI-1 internal (taskMappers ↔ runSchedule window-close) | shared-module (one definition) | derived (count brief: computeWindowCloseUtc must match mapper) — batched into one item |
| WI-2/WI-3/WI-4 vs WI-1 | none | independent files/surfaces → same wave (Step 3.6 parallelism) |

## Waves
Wave 1: WI-1, WI-2, WI-3, WI-4 (all independent).

## Deferred (NOT worked — see SPEC DEFERRED)
- 999.879 (1)(2)(3): settled-decision reversal → David ruling AMB-A.
- 999.881 (1) deeper placement root-fix: data-dependent (PARTIAL — assertion ships).
- 999.881 (2) data confirmation: DB probe forbidden.

## Determination Log
- Mode: bugfix (3 related defects, shared scheduler/overdue + Issues code).
- Scope narrowed from optimistic task framing after evidence-first intake (count brief +
  Scooter consult) revealed 879.1/3 hinge on a settled-decision reversal and 881.2 wiring is
  clean (data issue). Per "evidence-first, no guessing" + "don't relitigate locked decisions".
