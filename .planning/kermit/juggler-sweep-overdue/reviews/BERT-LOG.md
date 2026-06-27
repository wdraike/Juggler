# BERT-LOG — juggler-sweep-overdue — bugfix — 2026-06-26

## Status: DONE

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode bugfix and all 5 fixes provided in prompt | present |
| Read context | read SPEC.md, TEST-CATALOG.md, CLAUDE.md (juggler worktree), CLAUDE.md (global) | done |
| Parse findings | extracted 5 fixes (FIX-1 AC-840-1, FIX-2 AC-840-2, FIX-3 AC-840-4, FIX-4 AC-840-3/AC-881-1, FIX-5 AC-879-4) | done |
| Read source files | taskMappers.js (lines 408-430), runSchedule.js (lines 190-260, 1820-1880, 1960-1975, 2249-2261), ConflictsView.jsx (lines 77-91) | done |
| Apply fixes | 5 fixes applied across 3 files | see Findings table |
| Adjacent-regression | ran past-window-missed.test.js (4 computeWindowCloseUtc tests) | 4/4 GREEN |
| Self-verify fix | node --check on both .js files (JSX skipped — node --check does not support JSX); all 3 specified test files run | taskMappers.js OK, runSchedule.js OK, 28/28 tests GREEN |
| REFER lines | 1 emitted (FIX-5 wording flagged for David sign-off) | see Refers table |
| Output written | Write BERT-LOG.md + bert-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present
- [x] Mode confirmed: bugfix
- [x] All BLOCK findings addressed (fixed, disputed, or referred with reason)
- [x] No unapproved fallbacks introduced
- [x] No tests authored by bert (refers emitted where needed)
- [x] No docs authored by bert (refers emitted where needed)
- [x] Disputed findings referred back to reviewer; design-level fixes referred up to cookie/Kermit
- [x] Blast-radius bound respected; adjacent-regression call-sites checked + suite run
- [x] Findings re-anchored after multi-fix edits (line numbers verified in file at edit time)
- [x] Fix self-verified: every mutated .js file parses/loads + targeted tests run (before DONE)
- [x] BERT-LOG.md written
- [x] Changed files listed
- [x] REFER lines listed in Refers table
- [x] Status line set: DONE
- [x] Hand-off message emitted

## Findings Actioned
| # | Fix | Severity | File:Line | Description | Fix Applied | Result |
|---|-----|----------|-----------|-------------|-------------|--------|
| 1 | FIX-1 / AC-840-1 | BLOCK | taskMappers.js:425 (post-edit ~431) | window-close used `scheduledMins + time_flex` instead of `preferred_time_mins + time_flex` | Changed `windowCloseMins = scheduledMins + row.time_flex` to `var preferredTimeMins = (row.preferred_time_mins != null ? row.preferred_time_mins : scheduledMins); var windowCloseMins = preferredTimeMins + row.time_flex;` | Fixed — CASE-1a-preferred GREEN |
| 2 | FIX-2 / AC-840-2 | BLOCK | taskMappers.js:423 (post-edit ~428) | guard `row.time_flex > 0` excluded `time_flex=0` (zero-width window) from windowed path | Changed guard to `row.time_flex != null` so `time_flex=0` enters the windowed branch | Fixed — CASE-10a GREEN |
| 3 | FIX-3a / AC-840-4 | WARN | runSchedule.js:201-208 | `computeWindowCloseUtc` used `scheduled_at + timeFlex` not `preferred_time_mins + timeFlex` | Rewrote to compute `utcMidnight + (preferredMins ?? utcSlotMins) + flex`; fallback to slot UTC mins when preferred absent | Fixed — 4 existing tests still GREEN |
| 4 | FIX-3b / AC-840-4 | WARN | runSchedule.js:1862-1875 (post-edit ~1920) | Two independent sequential guards for period-boundary and flex-window-close; no named effective-deadline | Added `computeEffectiveDeadline({periodBoundary, windowClose})` pure helper returning `min(periodBoundary, windowClose)`; replaced the two guards with a single check | Fixed — behavior-preserving for all existing tests |
| 5 | FIX-4 / AC-840-3 / AC-881-1 | BLOCK | runSchedule.js (new function + module.exports + persist boundary) | `checkPlacementDisjointness` not exported; no overlap WARN at persist boundary | Added pure helper `checkPlacementDisjointness(dayPlacements)` → `[{date,a,b,aStart,aEnd,bStart}]`; exported as first-class named export; wired WARN-only call before `persistDelta` | Fixed — OVERLAP/DISJOINT/MULTI-DAY tests all GREEN |
| 6 | FIX-5 / AC-879-4 | WARN | ConflictsView.jsx:81 | Stale-bucket help text "The scheduler will move them to today on its next run" inaccurate for pinned/committed items | Reworded to "These items have a scheduled date in the past and no hard deadline. The scheduler rolls eligible ones forward on its next run; committed items stay pinned to their date." | Fixed — wording flagged for David sign-off |

## Refers Emitted
| # | Refer | Reason |
|---|-------|--------|
| 1 | REFER→David: ConflictsView.jsx:81 — FIX-5 wording is accurate and factual but subjective UX copy; needs David sign-off before ship | Spec explicitly flagged this for David review |

## Adjacent-Regression Summary
| Changed symbol | Files checked | Callers found | Outcome |
|----------------|--------------|---------------|---------|
| `computeWindowCloseUtc` | runSchedule.js, facade.js | missedHelpers (via facade), tests/scheduler/past-window-missed.test.js | 4/4 existing tests GREEN; behavior unchanged when `preferred_time_mins` absent |
| `checkPlacementDisjointness` | runSchedule.js (new export) | no prior callers | new export, no regression risk |
| `computeEffectiveDeadline` | runSchedule.js (new export) | no prior callers | new export, replaces two sequential guards; no existing test covers the flexible-TPC-with-timeFlex scenario; behavior for day-locked instances unchanged |
| `row.time_flex != null` guard in taskMappers.js | taskMappers.js | overdue IIFE only | CASE-10null (existing green) pins null stays window-less path; all 28 target tests GREEN |

## Changed Files
- `juggler-backend/src/slices/task/domain/mappers/taskMappers.js` (lines ~408-432 — FIX-1 guard and windowCloseMins computation; FIX-2 comment block)
- `juggler-backend/src/scheduler/runSchedule.js` (lines ~201-220 `computeWindowCloseUtc` FIX-3a; ~226-243 new `computeEffectiveDeadline` helper FIX-3b; ~244-276 new `checkPlacementDisjointness` helper FIX-4; ~1880-1892 replaced two guards with `computeEffectiveDeadline` FIX-3b; ~1975-1981 WARN wiring before `persistDelta` FIX-4; module.exports FIX-4)
- `juggler-frontend/src/components/views/ConflictsView.jsx` (line ~81 — stale-bucket help text FIX-5)

## Self-Check Test Run
```
PASS tests/unit/scheduler/placement-disjointness.test.js
PASS tests/unit/mappers/overdue-pastdue-recurring.test.js
PASS tests/unit/scheduler/weather-temp-ceiling.test.js

Tests: 28 passed, 28 total
```
Adjacent-regression:
```
PASS tests/scheduler/past-window-missed.test.js
Tests: 4 passed, 4 total
```

## Sign-off
Signed: Bert — 2026-06-26T00:00:00Z

---

# BERT-LOG — juggler-sweep-overdue (WARN stale-comment pass) — bugfix — 2026-06-26

## Status: DONE

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | --mode bugfix, --depth quick, WARNs from ZOE-REVIEW.md provided in prompt | present |
| Read context | read CLAUDE.md (juggler worktree), ZOE-REVIEW.md, BERT-LOG.md (prior run), both target test files | done |
| Parse findings | extracted 2 WARN findings from ZOE-REVIEW.md (WARN-1 lines 3+63 of effective-deadline.test.js; WARN-2 lines 177+591 of overdue-pastdue-recurring.test.js) | done |
| Apply fixes | 4 comment-only edits across 2 files; 0 logic or assertion changes | see Findings table |
| Adjacent-regression | comments only — no symbols changed; no call-sites to grep | N/A |
| Self-verify | npx jest effective-deadline.test.js overdue-pastdue-recurring.test.js --runInBand --forceExit | 32/32 PASS (10+22) |
| REFER lines | 0 emitted | none |
| Output written | appended to BERT-LOG.md | Done |

## Proof Checklist
- [x] Required inputs present
- [x] Mode confirmed: bugfix
- [x] All BLOCK findings addressed (none present — WARN-only pass)
- [x] All WARN findings addressed (WARN-1 and WARN-2 fixed)
- [x] No unapproved fallbacks introduced
- [x] No tests authored by bert
- [x] No docs authored by bert
- [x] Disputed findings referred back to reviewer; design-level fixes referred up to cookie/Kermit
- [x] Blast-radius bound respected (comments only; 4 lines changed across 2 files)
- [x] Adjacent-regression checked (N/A — no symbols changed)
- [x] Fix self-verified: 32/32 tests GREEN before DONE
- [x] BERT-LOG.md updated
- [x] Changed files listed
- [x] Status line set: DONE

## Findings Actioned
| # | Severity | File:Line | Description | Fix Applied | Result |
|---|----------|-----------|-------------|-------------|--------|
| 1 | WARN | tests/unit/scheduler/effective-deadline.test.js:3 | Header JSDoc said "the earlier of the two non-null values" — contradicts the correct max() semantics | Changed "earlier" to "later" | Fixed |
| 2 | WARN | tests/unit/scheduler/effective-deadline.test.js:63 | Test name said "min of equal = either" — contradicts max() semantics | Changed "min of equal" to "max of equal" in test name string | Fixed |
| 3 | WARN | tests/unit/mappers/overdue-pastdue-recurring.test.js:175-177 | 3-line "DEFERRED … Skipped so main stays green" comment above CASE-1a-preferred — test is now active and GREEN | Replaced with 2-line comment: "AC2b follow-up resolved by this leg. CASE-1a-preferred is now active and GREEN." | Fixed |
| 4 | WARN | tests/unit/mappers/overdue-pastdue-recurring.test.js:589-591 | 3-line "DEFERRED … Skipped so main stays green" comment above CASE-10a — test is now active and GREEN | Replaced with 2-line comment: "AC2c follow-up resolved by this leg. CASE-10a is now active and GREEN." | Fixed |

## Refers Emitted
None.

## Changed Files
- `juggler-backend/tests/unit/scheduler/effective-deadline.test.js` (lines 3, 63 — stale min/earlier prose updated to max/later)
- `juggler-backend/tests/unit/mappers/overdue-pastdue-recurring.test.js` (lines 175-177, 589-591 — stale skip-rationale comments replaced with active-and-passing notes)

## Self-Check Test Run
```
PASS tests/unit/scheduler/effective-deadline.test.js
PASS tests/unit/mappers/overdue-pastdue-recurring.test.js

Tests: 32 passed, 32 total
Time:  2.028 s
```

## Sign-off
Signed: Bert — 2026-06-26T01:00:00Z
