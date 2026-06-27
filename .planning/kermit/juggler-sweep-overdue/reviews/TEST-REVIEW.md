# Telly Review — juggler-sweep-overdue — bugfix — 2026-06-26

## Status: DONE

## Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | SPEC.md + TRACEABILITY.md read; mode=bugfix | present |
| Scope detect | test file + source files identified | overdue-pastdue-recurring.test.js; runSchedule.js; unifiedScheduleV2.js; taskMappers.js |
| Oracle un-skip 1 | test.skip → test at line 178 (CASE-1a-preferred) | done |
| Oracle un-skip 2 | test.skip → test at line 592 (CASE-10a) | done |
| Oracle run | npx jest overdue-pastdue-recurring.test.js --runInBand | 2 failed (RED), 20 passed — confirmed RED baseline |
| New file 1 | Write placement-disjointness.test.js (3 tests) | done |
| Disjointness run | npx jest placement-disjointness.test.js --runInBand | 3 failed (TypeError: not a function) — RED confirmed |
| New file 2 | Write weather-temp-ceiling.test.js (3 tests) | done |
| Weather run | npx jest weather-temp-ceiling.test.js --runInBand | 3 passed — GREEN (weatherOk already exported + correct) |
| Catalog written | Write TEST-CATALOG.md | done |
| Traceability | Test column filled for AC-840-1, AC-840-2, AC-840-3, AC-881-1, AC-881-2 | done |

## Proof Checklist

- [x] Required inputs present — SPEC.md readable; TRACEABILITY.md readable; mode=bugfix explicit in prompt
- [x] Mode confirmed as bugfix; entry gate: regression tests that FAIL pre-fix exist (oracle tests now un-skipped and RED-confirmed)
- [x] Scope detected — source files non-empty (taskMappers.js, runSchedule.js, unifiedScheduleV2.js)
- [x] TEST-CATALOG.md built with all test files and pre-fix status
- [x] mode=bugfix: regression tests authored/un-skipped that FAIL pre-fix and will PASS post-fix; captured in TEST-CATALOG.md
- [x] All required test files created; no MISSING rows without BLOCK finding
- [x] Suite(s) run; results captured (oracle: 2 RED; disjointness: 3 RED; weather: 3 GREEN)
- [x] Coverage not flagged (--coverage not passed; step-0 RED-baseline run only)
- [x] Changed-line diff coverage: n/a at step 0 — this is the pre-fix RED baseline run; coverage measured post-fix by re-review
- [x] Mutation not-wired — per-pin self-mutation checklist recorded in TEST-CATALOG.md (§Mutation section); no silent skip
- [x] Flake/determinism: all tests are pure-function unit tests with no wall-clock, no network, no DB I/O; deterministic by construction; no Date.now/Math.random in test or production path under test
- [x] Test-data isolation: no DB used; unit tests only; isolation n/a
- [x] Contract tests: no inter-service seam touched (scheduler internal logic only)
- [x] Security-regression tests: no REFER→telly lines in leg (no SECURITY-REVIEW.md for this leg)
- [x] Test-pyramid balance: all new tests are unit tier (correct for pure-function scheduler helpers)
- [x] --setup-env not passed; not required (unit tests, no DB)
- [x] TRACEABILITY.md Test column updated for AC-840-1, AC-840-2, AC-840-3, AC-881-1, AC-881-2
- [x] --re-review not passed (step 0 only)
- [x] Findings carry file:line + severity
- [x] Requirements documentation: test files exist on disk; verified by run
- [x] No out-of-column issues requiring flag-and-refer
- [x] Rubric Coverage Map emitted below
- [x] TEST-CATALOG.md written to $REVIEW_DIR/
- [x] TEST-REVIEW.md written to $REVIEW_DIR/
- [x] Status: DONE — no unresolved BLOCKs; all pre-fix RED baselines confirmed

## Findings

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | BLOCK (pre-fix expected) | tests/unit/mappers/overdue-pastdue-recurring.test.js:209 | CASE-1a-preferred RED: code uses `scheduledMins+timeFlex` for window-close; spec requires `preferredTimeMins+timeFlex`; now=630≥600 → true (wrong); correct close=660 → false | bert: fix window-close in taskMappers.js to use `preferred_time_mins ?? scheduledMins` |
| 2 | BLOCK (pre-fix expected) | tests/unit/mappers/overdue-pastdue-recurring.test.js:614 | CASE-10a RED: `time_flex > 0` guard excludes `time_flex=0`; falls through to anytime path → false; spec requires overdue=true at slot minute | bert: change guard to `time_flex != null && time_flex >= 0` (or `=== 0` branch) in taskMappers.js |
| 3 | BLOCK (pre-fix expected) | tests/unit/scheduler/placement-disjointness.test.js:52,68,84 | All 3 disjointness tests RED: `checkPlacementDisjointness` not yet in runSchedule.js exports → TypeError | bert: implement + export `checkPlacementDisjointness` per contract in TEST-CATALOG.md |
| 4 | INFO | tests/unit/scheduler/weather-temp-ceiling.test.js | weatherOk GREEN: no code defect; `_testOnly` export path confirmed working; regression lock in place | No fix needed; if future refactor removes `_testOnly` export, suite turns RED (intended) |

All BLOCKs are pre-fix expected per the bugfix mode. bert resolves; telly --re-review after fix.

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Tier Coverage | covered | All new tests are unit-tier pure-function tests (correct tier for scheduler mapper logic) | No integration or E2E tests needed for these pure functions |
| Assertion Quality | covered | Each test asserts a specific boolean value (`toBe(true/false)`) on the discriminating input; CASE-1a uses now=10:30 to make slot-vs-preferred discriminating (not coincidentally equal) | No tautological assertions |
| Edge Case Coverage | covered | time_flex=0 vs null boundary; preferred_time_mins vs placed slot; boundary touch (aEnd==bStart not overlap); cross-dateKey isolation | Production-shape variants noted in TEST-CATALOG.md |
| Determinism | covered | All tests inject `nowInfo` (no wall-clock); no Date.now, no Math.random, no network, no FS; confirmed by grep | Pure functions only |
| Test Maintainability | covered | Tests named to AC refs; inline comments explain discriminating setup; `makeBaseRow`/`makeWeather` helpers keep tests concise | |
| E2E Depth | gap (accepted) | No E2E tests for these scheduler internals; pure unit tier is correct — E2E coverage of scheduler output exists in other suites | Accepted gap; not a BLOCK for this leg |
| Performance Testing | gap (accepted) | No perf tests for pure scheduler helpers; not required at this tier | INFO only |
| Coverage Metrics | partial | Step-0 RED baseline only; diff coverage and line/branch measured at --re-review (post-fix) per mode=bugfix workflow | Will be filled at re-review |
| Security Testing | gap (accepted) | No security surface in scheduler window-close / disjointness / weather-ceiling logic; no REFER→telly specs | Not applicable to this leg |

## Sign-off

Signed: Telly — 2026-06-26T00:00:00Z
