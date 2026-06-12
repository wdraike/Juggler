# Test Catalog — juggler-hex-h6-scheduler — refactor

_Last updated: 2026-06-12 — mode: refactor — depth: standard — Z1 re-review (zoe W4 Z1 facade-forwarding contract assertion)_

## New Tests Authored This Leg (W0 + fix-loop + W1 domain units + W2 adapter contracts)

### Golden Master (W0 + fix-loop — characterization suite)

| Test Group | Test File | Traceability Ref | Last Run | Result | Notes |
|-----------|-----------|------------------|----------|--------|-------|
| GOLDEN-MASTER CORE — FROZEN LITERAL placement/score/slack snapshot | tests/characterization/scheduler/goldenMaster.h6.test.js | S8 | 2026-06-12 (W2) | PASS | Concrete toEqual values (start:720/780/810, score:0, slackByTaskId all null); UNCHANGED from W0/W1 baseline |
| INTEGRATED multi-phase pipeline (fixed+overdue+deadline+free) | tests/characterization/scheduler/goldenMaster.h6.test.js | S1, S2, C-COUPLE | 2026-06-12 (W2) | PASS | if-guards removed; unconditional assertions |
| S1 — most-constrained → least-constrained ordering snapshot (FROZEN LITERAL) | tests/characterization/scheduler/goldenMaster.h6.test.js | S1 | 2026-06-12 (W2) | PASS | Concrete start positions + full ID order toEqual; MUT-D → 2 RED |
| S2 — severity comparator: fixed > overdue > deadline > free | tests/characterization/scheduler/goldenMaster.h6.test.js | S2 | 2026-06-12 (W2) | PASS | if-guards removed; unconditional rank assertions |
| S3 — recurring instances: same-day placement only, never rolled (basic) | tests/characterization/scheduler/goldenMaster.h6.test.js | S3 | 2026-06-12 (W2) | PASS | Unconditional assertions |
| S3 — recurring instance goes to unplaced (not TOMORROW) when day is FULL | tests/characterization/scheduler/goldenMaster.h6.test.js | S3 | 2026-06-12 (W2) | PASS | Fixture: 2 FIXED tasks fill day + recur property; MUT-A → 2 RED |
| S4 — static require-graph: unifiedScheduleV2 does not import scheduleQueue | tests/characterization/scheduler/goldenMaster.h6.test.js | S4 | 2026-06-12 (W2) | PASS | W2/W3 must update if scheduleQueue.js is renamed |
| S5 — delta-write-count: run-2 on stable task → 0 writes (test 1, REAL it() GREEN) | tests/characterization/scheduler/goldenMaster.h6.test.js | S5 | 2026-06-12 (W2) | PASS (real it()) | it.failing() marker REMOVED; actual runScheduleAndPersist call + updated_at unchanged assertion; 1100ms sleep for MySQL 1s precision; delta-write live |
| S5 — delta-write-count: 3 tasks unchanged batch → 0 writes on run-2 (test 2, REAL it() GREEN) | tests/characterization/scheduler/goldenMaster.h6.test.js | S5 | 2026-06-12 (W2) | PASS (real it()) | it.failing() marker REMOVED; batch-scale unchanged → 0 writes proven; delta-write live |
| S6 — no-cascade: enqueueScheduleRun not called during run | tests/characterization/scheduler/goldenMaster.h6.test.js | S6 | 2026-06-12 (W2) | PASS | Structural require-graph + spy |
| P1 — migration complete: 0 inline fn.now() in runSchedule.js; repo uses new Date(); clockNow() instanceof Date; unifiedScheduleV2 pure | tests/characterization/scheduler/goldenMaster.h6.test.js | P1 | 2026-06-12 (W3) | PASS | W3 flipped: now asserts ZERO executable fn.now() (comment-stripped); KnexScheduleRepository clock.now() returns new Date(); RunScheduleCommand.clockNow() returns JS Date; unifiedScheduleV2 has no DB I/O |
| C-SCORE — scoreSchedule {total,breakdown} snapshot (8 assertions) | tests/characterization/scheduler/goldenMaster.h6.test.js | C-SCORE | 2026-06-12 (W2) | PASS | Concrete values; MUT-C → RED |
| C-IDEM — pure-function determinism (GREEN always) | tests/characterization/scheduler/goldenMaster.h6.test.js | C-IDEM | 2026-06-12 (W2) | PASS | Run-1 == Run-2 fingerprint via toEqual |
| C-IDEM — DB-level idempotence: run-2 updated_at unchanged (REAL it() GREEN) | tests/characterization/scheduler/goldenMaster.h6.test.js | C-IDEM | 2026-06-12 (W2) | PASS (real it()) | it.failing() marker REMOVED; nested describe; beforeAll assertDbAvailable; beforeEach seed+run-1+capture; real it() body run-2+expect() only; delta-write live |
| C-WX — weatherOk fail-open: no weather data at all (basic) | tests/characterization/scheduler/goldenMaster.h6.test.js | C-WX | 2026-06-12 (W2) | PASS | Trivial fail-open path |
| C-WX — weatherOk fail-open: slot hour missing from active weather data | tests/characterization/scheduler/goldenMaster.h6.test.js | C-WX | 2026-06-12 (W2) | PASS | CFG_ACTIVE_WEATHER: hours 8-11 present, hour 12 absent; MUT-B → 2 RED |
| C-WX — source guard checks (date-level + hour-level fail-open) | tests/characterization/scheduler/goldenMaster.h6.test.js | C-WX | 2026-06-12 (W2) | PASS | Source string pins for two fail-open guards |

**Golden master total: 45 tests. ISOLATION FIX APPLIED (2026-06-12 H6 W3 flaky-test fix): S5 now uses user_id=test-user-s5, C-IDEM uses user_id=test-user-cidem; neither describe calls testDb.destroy() in afterAll (singleton shared across file). 45/45 in 5× consecutive full-suite runs AND --runInBand. Deterministic. P1 flipped to "migration complete" assertion.**

### W1 Domain Unit Tests (H6 Wave 1 extraction)

#### solvers.test.js (22 tests)

| Test Group | Test File | Traceability Ref | Last Run | Result | Behavior Pinned |
|-----------|-----------|------------------|----------|--------|----------------|
| ConstraintSolver.compareItems — S1 most-constrained → least ordering (3 tests) | tests/slices/scheduler/domain/solvers.test.js | S1 | 2026-06-12 | PASS | slack asc; null slack = 0 (most constrained); tie-break: pri asc, dur desc, id asc |
| ConstraintSolver — effectiveDuration / recurringCycleDays / parseDayReq (3 tests) | tests/slices/scheduler/domain/solvers.test.js | S1, S3 | 2026-06-12 | PASS | effectiveDuration: timeRemaining prefers, clamps 720, default 30; recurringCycleDays: weekly=7, biweekly=14, monthly=30, daily=1, interval*N; parseDayReq: weekday/weekend/M,W,F/all-7-→null |
| ConstraintSolver.severityRank — S2 fixed > overdue > deadline > free (1 test) | tests/slices/scheduler/domain/solvers.test.js | S2 | 2026-06-12 | PASS | rank 0/1/2/3 ordering; compareSeverity sorts most-severe first |
| ConflictResolver — occupancy primitives (5 tests) | tests/slices/scheduler/domain/solvers.test.js | (byte-identical move) | 2026-06-12 | PASS | reserve/isFree; reserveWithTravel/isFreeWithTravel footprint; rebuildPrefix prefix-sum; overlaps half-open; resolve() flags collisions |
| ScoreEngine.score — byte-identical to legacy scoreSchedule (5 tests) | tests/slices/scheduler/domain/solvers.test.js | C-SCORE | 2026-06-12 | PASS | legacy parity; unplaced=PRI_RANK[P2]*1=80; deadlineMiss=500; fragmentation=(parts-1)*15; penalty constants pinned |
| INTEGRATED 3-solver pipeline — ConstraintSolver → ConflictResolver → ScoreEngine (5 tests) | tests/slices/scheduler/domain/solvers.test.js | S1, S2, C-SCORE | 2026-06-12 | PASS | STEP1: severity order fixed→overdue→deadline→free; STEP1b: slack-sort puts overdue first; STEP2: no overlapping placements + fixed at anchor; STEP3: ScoreEngine scores composed placement; STEP3b: unplaceable → unplaced penalty in score |

**solvers.test.js total: 22 tests, 0 failed. Sub-second.**

#### value-objects-entities.test.js (36 tests)

| Test Group | Test File | Traceability Ref | Last Run | Result | Behavior Pinned |
|-----------|-----------|------------------|----------|--------|----------------|
| Priority VO — closed enum + normalize/rank parity with PRI_RANK (6 tests) | tests/slices/scheduler/domain/value-objects-entities.test.js | S1 | 2026-06-12 | PASS | canonical set = PRI_RANK keys; rank(P1/P2/P3/P4) byte-identical; unknown falls back to P3; normalize(10 cases) byte-identical; constructor rejects unknown tier; immutable + equals by value |
| TimeWindow VO — interval math parity with scheduler loops (5 tests) | tests/slices/scheduler/domain/value-objects-entities.test.js | (extracted) | 2026-06-12 | PASS | length = end-start; canFit half-open; overlap matches overlapWithEligibleWindows; fromPair/toPair round-trip; rejects non-numeric/inverted; immutable |
| Deadline VO — ISO date-key + miss arithmetic parity (3 tests) | tests/slices/scheduler/domain/value-objects-entities.test.js | C-SCORE | 2026-06-12 | PASS | toNumber = parseDateKey ISO branch; isMissedBy = placedNum > deadlineNum (strictly after); isValid rejects non-ISO; constructor throws bad input |
| Constraint entity — S2 severity precedence (5 tests) | tests/slices/scheduler/domain/value-objects-entities.test.js | S2 | 2026-06-12 | PASS | fixed wins all; overdue beats deadline; deadline beats free; no flags = free; dependsOn frozen (no external mutation) |
| ScheduledTask entity — placement read-model + half-open overlap (2 tests) | tests/slices/scheduler/domain/value-objects-entities.test.js | (extracted) | 2026-06-12 | PASS | fromEntry round-trips legacy dayPlacements shape; overlapsSlot half-open matches tryPlaceAtTime |
| Schedule aggregate — read-model over scheduler result (4 tests) | tests/slices/scheduler/domain/value-objects-entities.test.js | S8 | 2026-06-12 | PASS | placementsOn insertion-ordered; placementsOf finds across days; isPlaced/isUnplaced; toResult returns underlying object |
| ScoredSchedule entity — score read-model (1 test) | tests/slices/scheduler/domain/value-objects-entities.test.js | C-SCORE | 2026-06-12 | PASS | isPerfect at total=0; detailsOfType filters |
| PlacementMode is REUSED from the task slice, not duplicated (1 test) | tests/slices/scheduler/domain/value-objects-entities.test.js | S7 | 2026-06-12 | PASS | domain.PlacementMode === TaskSlice.PlacementMode (identity check) |

**value-objects-entities.test.js total: 36 tests, 0 failed. Sub-second.**

**W1 domain unit total: 58 tests (22 + 36), 0 failed.**

### W2 Adapter Contract Tests (NEW — H6 Wave 2 ports + adapters)

| Test Group | Test File | Traceability Ref | Last Run | Result | Behavior Pinned |
|-----------|-----------|------------------|----------|--------|----------------|
| Five ports are defined (ports barrel exposes all five contracts) | tests/slices/scheduler/scheduleAdapters.contract.test.js | S5, C-IDEM | 2026-06-12 (W2) | PASS | TaskProviderPort, ScheduleRepositoryPort, WeatherProviderPort, CalendarProviderPort, ClockPort all present |
| SchedulerTaskProvider implements TaskProviderPort | tests/slices/scheduler/scheduleAdapters.contract.test.js | C-COUPLE | 2026-06-12 (W2) | PASS | All port methods present |
| KnexScheduleRepository implements ScheduleRepositoryPort | tests/slices/scheduler/scheduleAdapters.contract.test.js | S5 | 2026-06-12 (W2) | PASS | All port methods present |
| InMemoryScheduleRepository implements ScheduleRepositoryPort | tests/slices/scheduler/scheduleAdapters.contract.test.js | S5 | 2026-06-12 (W2) | PASS | All port methods present |
| SchedulerWeatherProvider implements WeatherProviderPort | tests/slices/scheduler/scheduleAdapters.contract.test.js | C-WX | 2026-06-12 (W2) | PASS | All port methods present |
| SchedulerCalendarProvider implements CalendarProviderPort | tests/slices/scheduler/scheduleAdapters.contract.test.js | C-COUPLE | 2026-06-12 (W2) | PASS | All port methods present |
| MysqlClockAdapter implements ClockPort | tests/slices/scheduler/scheduleAdapters.contract.test.js | P1 | 2026-06-12 (W2) | PASS | clock.now() returns new Date() |
| SchedulerTaskProvider cuts task.controller coupling (mapper identity) | tests/slices/scheduler/scheduleAdapters.contract.test.js | C-COUPLE | 2026-06-12 (W2) | PASS | tp.rowToTask === taskFacade.rowToTask (same function object, not a copy) |
| SchedulerTaskProvider.loadSchedulableRows applies user-scoped filter | tests/slices/scheduler/scheduleAdapters.contract.test.js | C-COUPLE | 2026-06-12 (W2) | PASS | Status/template filter applied |
| P1: InMemoryScheduleRepository.writeChanged rejects non-Date updated_at | tests/slices/scheduler/scheduleAdapters.contract.test.js | P1 | 2026-06-12 (W2) | PASS | Fail-loud on db.fn.now() builder |
| P1: InMemoryScheduleRepository.writeChanged accepts JS Date updated_at | tests/slices/scheduler/scheduleAdapters.contract.test.js | P1 | 2026-06-12 (W2) | PASS | new Date() accepted |
| P1: KnexScheduleRepository.writeChanged rejects non-Date scheduled_at | tests/slices/scheduler/scheduleAdapters.contract.test.js | P1 | 2026-06-12 (W2) | PASS | Fail-loud on P1 guard |
| S5 InMemory: only delta rows applied; audit log matches delta | tests/slices/scheduler/scheduleAdapters.contract.test.js | S5 | 2026-06-12 (W2) | PASS | Unchanged tasks not written |
| S5 Knex: partitions batched (scheduled_at/dur) vs per-row (flag/status) — no now-builder | tests/slices/scheduler/scheduleAdapters.contract.test.js | S5 | 2026-06-12 (W2) | PASS | clock.now() not db.fn.now() in batched path |

**W2 adapter contract total: 14 tests, 0 failed (unchanged in W3 — writeChanged adapter unchanged).**

## Pre-Existing Scheduler Tests (Context Only — Not Authored This Leg)

| Suite | File | Coverage of H6 invariants |
|-------|------|---------------------------|
| schedulerRules.test.js | tests/schedulerRules.test.js | S1 (partial), S2 (partial) |
| schedulerScenarios.test.js | tests/schedulerScenarios.test.js | S1 (partial), S3 (partial) |
| schedulerPersistIntegration.test.js | tests/schedulerPersistIntegration.test.js | S5 (partial, single-task only) |
| schedulerIntegration.test.js | tests/schedulerIntegration.test.js | C-IDEM (partial) |
| schedulerDeepCoverage.test.js | tests/schedulerDeepCoverage.test.js | General |
| schedulerSupplyDemand.test.js | tests/schedulerSupplyDemand.test.js | S1 (capacity) |
| schedulerTimeSimulation.test.js | tests/schedulerTimeSimulation.test.js | Time-based |
| unit/schedulerSession.test.js | tests/unit/schedulerSession.test.js | Session read-model |
| scheduler/past-window-missed.test.js | tests/scheduler/past-window-missed.test.js | Past-window edge case |
| scheduler/preferred-time-placement.test.js | tests/scheduler/preferred-time-placement.test.js | Preferred time fix |

## Runner Commands

```bash
# Golden master (behavior-identical gate)
cd juggler-backend && DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test npx jest --testPathPattern="characterization/scheduler/goldenMaster.h6" --no-coverage

# W2 adapter contract tests (pure, no DB queries)
cd juggler-backend && DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test npx jest --testPathPattern="scheduleAdapters.contract" --no-coverage

# W1 domain unit tests (pure, no DB env needed)
cd juggler-backend && DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test npx jest --testPathPattern="slices/scheduler/domain" --no-coverage

# Full scheduler suite (regression check)
cd juggler-backend && DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test npx jest --testPathPattern="scheduler" --no-coverage
```

Or via test-bed (recommended — applies migrations first):
```bash
cd test-bed && make test-juggler
```

## Z1 Re-review — Facade Forwarding Contract Fix (2026-06-12 zoe W4 Z1 WARN closed)

Zoe WARN Z1 (ZOE-REVIEW.md): caller tests mock `src/scheduler/runSchedule` and assert only the canned mock echo — a facade that drops/transforms args or short-circuits stays GREEN. Added `toHaveBeenCalledWith` assertions to pin the forwarding contract.

### Two New Z1 Forwarding-Contract Tests Added to tests/api/schedule-routes.test.js

| Test | File | Assertion Added | Traceability |
|------|------|-----------------|--------------|
| Z1: forwards correct args — userId, undefined ids, timezone opts — to runScheduleAndPersist | tests/api/schedule-routes.test.js | `toHaveBeenCalledWith('user-123', undefined, { timezone: 'America/New_York' })` | S8 (gate durability) |
| Z1: forwards custom x-timezone header correctly to runScheduleAndPersist | tests/api/schedule-routes.test.js | `toHaveBeenCalledWith('user-123', undefined, { timezone: 'Europe/London' })` | S8 (gate durability) |

**Mutation proof (facade drop-arg):**
Temporarily mutated facade: `runScheduleAndPersist: function(userId, ids, opts) { return runSchedule.runScheduleAndPersist(userId); }` (drops ids+opts).
- Result: **2 failed, 22 passed** — both Z1 tests went RED. The pre-existing "returns 200 with result" test stayed GREEN (confirming the old assertion was insufficient).
- Facade restored from /tmp backup; sha `10792590b...` byte-identical.

### Z1 Re-review Run Summary

| Suite | Command | Result |
|-------|---------|--------|
| Pre-change baseline | `npx jest tests/api/schedule-routes.test.js --no-coverage` | **22/22 PASS** |
| Post-addition (current code, correct facade) | same | **24/24 PASS** |
| Facade-mutated (drop-arg mutation) | same | **2 FAIL, 22 pass** — Z1 tests RED |
| Post-revert (facade byte-identical) | same | **24/24 PASS** |
| Golden master (unaffected) | `npx jest goldenMaster.h6 --no-coverage` | **45/45 PASS** |

**Tree-clean verify:** only `tests/api/schedule-routes.test.js` changed by this telly pass. `src/slices/scheduler/facade.js` unmodified (sha `10792590b...`). `src/routes/schedule.routes.js` and `src/mcp/tools/schedule.js` carry W4 caller-migration edits (pre-existing, not from this pass).

## W4 Final Verification Run Summary (2026-06-12 H6 W4 facade + caller migration)

### Caller Tests (W4 migration — updated for Z1 fix)

| Suite | File | Last Run | Result | Notes |
|-------|------|----------|--------|-------|
| Schedule routes | tests/api/schedule-routes.test.js | 2026-06-12 (Z1 fix) | 24/24 PASS | 22 original + 2 Z1 forwarding-contract tests; mock on `src/scheduler/runSchedule` effective via re-export reference identity |
| MCP schedule tools | tests/mcp.test.js + mcp-*.test.js | 2026-06-12 (W4) | 312/312 PASS (13 suites) | Includes mcp-create-tasks, mcp-list-tasks, mcp-update-task, mcp-locked-path, mcp-cross-user-isolation, mcp-transport, mcp-oauth-authorize-guard, mcp-task-config, mcp-http-calsync-divergence, mcp-create-task-boundary, mcp-update-task, mcpOverdueRegression.integration |

**Caller-test note:** The schedule routes test (`tests/api/schedule-routes.test.js`) mocks `src/scheduler/runSchedule` while the route file imports via `src/slices/scheduler/facade`. This works because the facade re-exports the exact same function references (referential identity); Jest's module cache intercepts at the canonical source path. The Z1 `toHaveBeenCalledWith` assertions now prove the forwarding contract — a facade that wraps, drops, or transforms args would break these tests.

### W4 Golden Master (3 consecutive runs — determinism)

| Run | Command | Result |
|-----|---------|--------|
| Run-1 | `npx jest --testPathPattern="goldenMaster.h6" --no-coverage` | **45/45 PASS** (4.572 s) |
| Run-2 | same | **45/45 PASS** (4.517 s) |
| Run-3 | same | **45/45 PASS** (4.416 s) |

### W4 Broader Scheduler Suite

| Run | Command | Result |
|-----|---------|--------|
| Run-1 | `npx jest --testPathPattern="scheduler" --no-coverage` | **409/410 PASS (1 skip)** (9.819 s) |

### W4 Snapshot Value Verification (bit-for-bit identical to W0 baseline)

| Snapshot ID | Value | Status |
|-------------|-------|--------|
| gm-core-001 start | 720 | IDENTICAL to W0 baseline |
| gm-core-002 start | 780 | IDENTICAL to W0 baseline |
| gm-core-003 start | 810 | IDENTICAL to W0 baseline |
| CORE score.total | 0 | IDENTICAL to W0 baseline |
| CORE score breakdown | all 0 | IDENTICAL to W0 baseline |
| CORE slackByTaskId | all null | IDENTICAL to W0 baseline |

## Isolation Fix Run Summary (2026-06-12 H6 W3 flaky-test fix)

| Suite | Command | Result |
|-------|---------|--------|
| Golden master run-1 | `npx jest --testPathPattern="goldenMaster.h6" --no-coverage` | **45/45 PASS** |
| Golden master run-2 | same | **45/45 PASS** |
| Golden master run-3 | same | **45/45 PASS** |
| Golden master run-4 | same | **45/45 PASS** |
| Golden master run-5 | same | **45/45 PASS** |
| Golden master --runInBand | same + `--runInBand` | **45/45 PASS** |
| Broader scheduler suite run-1 | `npx jest --testPathPattern="scheduler" --no-coverage` | **409/410 PASS (1 skip)** |
| Broader scheduler suite run-2 | same | **409/410 PASS (1 skip)** |
| Broader scheduler suite run-3 | same | **409/410 PASS (1 skip)** |

Pre-fix (W3): 42-43/45 non-deterministic (S5×2 + C-IDEM flaked under --runInBand or cross-describe interference). Post-fix: 45/45 deterministic in all modes.

**Isolation fix applied:** S5 uses `user_id=test-user-s5`, C-IDEM uses `user_id=test-user-cidem`. Neither describe calls `testDb.destroy()` in afterAll. Cleanup in beforeAll/afterAll/beforeEach is scoped by user_id only.

**P1 status: MIGRATION COMPLETE.** runSchedule.js: 0 executable fn.now() (3 comment-only). RunScheduleCommand: 0 fn.now(). KnexScheduleRepository: clock.now() returns new Date(). W3 verified 2026-06-12.

## Run Summary (2026-06-12 W2 re-review)

### Golden Master
- **Suite:** tests/characterization/scheduler/goldenMaster.h6.test.js
- **Tests:** 43 passed, 0 failed
- **Time:** ~4.5 s
- **Snapshot identical:** CORE frozen literals gm-core-001 start:720, gm-core-002 start:780, gm-core-003 start:810, score.total:0, all breakdown:0, slackByTaskId all null — UNCHANGED from W0/W1 baseline
- **S5/C-IDEM:** 3 tests are real it() (no it.failing markers). All PASS because delta-write is live. Delta-write log confirms "executing 0 DB updates" on run-2.

### W2 Adapter Contracts
- **Suite:** tests/slices/scheduler/scheduleAdapters.contract.test.js
- **Tests:** 14 passed, 0 failed
- **Time:** ~0.6 s

### W1 Domain Units
- **Suites:** tests/slices/scheduler/domain/solvers.test.js + value-objects-entities.test.js
- **Tests:** 58 passed, 0 failed
- **Time:** ~0.5 s each (pure unit, no DB)
- **Status:** GREEN

### Broader Scheduler Suite
- **Tests:** 408 total, 407 passed, 1 skipped, 0 failed
- **Suites:** 14 passed, 0 failed
- **Reconciliation:** W1 baseline 395 (394+1skip) + 14 W2 adapter contract tests = 409. Actual 408 = 407+1skip. Note: the W2 adapter contract suite is included in the "scheduler" glob via path `slices/scheduler/scheduleAdapters.contract.test.js`. One pre-existing skip unchanged.
- **New failures vs W1:** ZERO
- **Status:** GREEN

## Mutation Proof (carried from W0 fix-loop iteration 2 — unchanged by W1/W2)

| Mutation | Change | Tests RED | Exit Bar Met? |
|----------|--------|-----------|---------------|
| MUT-A | unifiedScheduleV2.js:457 `isDayLocked = false` | 2 (S3 full-day tests) | YES |
| MUT-B | unifiedScheduleV2.js:800 `if (!w) return false` | 2 (C-WX active fixture + source guard) | YES |
| MUT-D | unifiedScheduleV2.js:1121-1122 inverted finite slack sort | 2 (S1 frozen literal + slackByTaskId) | YES |

Mutation testing: not-wired (Stryker not configured for juggler-backend). Manual per-pin self-mutation performed at W0. W2 adapter contract tests are structural shape checks — per-pin self-mutation not applicable (the mutations would be removing a port method or removing the clock injection, not flipping a comparator).

## Delta-Write Correctness Proof (W2 behavioral change)

The S5/C-IDEM integration tests prove the delta-write skip condition by the run-2-no-write method:

1. **Run-1** seeds a new task (scheduled_at null), runs runScheduleAndPersist → scheduler assigns placement → DB updated (updated writes). Log: "executing N DB updates".
2. **Sleep 1100ms** (MySQL DATETIME 1s precision — distinguishes a write).
3. **Run-2** same user, same task set → delta-write compares computed placement vs DB row → fields match → skip → "executing 0 DB updates". `updated_at` unchanged from run-1 value.

This is the DB-observable proof, not a mock assertion.

## Coverage Notes

- No --coverage flag passed; W2 adapters + runSchedule.js delta-write path covered by S5/C-IDEM integration tests + adapter contract tests.
- P1 note: runSchedule.js still uses db.fn.now() for updated_at in the inline persist loop (P1 pending W3). KnexScheduleRepository.writeChanged uses clock.now() (JS Date). The P1 test confirms this split: runSchedule.js count still >=15 (expected), KnexScheduleRepository uses clock adapter.

## BUG-407 Vendor-Deps Regression Guard (Z2 fix — 2026-06-12)

_Corrects zoe Z1 overstated RED count and Z2 tautological-test finding._

| Test | File | Assertion | Pre-fix Result | Post-fix Result |
|------|------|-----------|----------------|-----------------|
| resolves @raike/lib-logger from within juggler-backend (not hoisted ancestor) | tests/unit/vendor-deps.test.js | require.resolve('@raike/lib-logger', { paths: [BACKEND_DIR] }) resolved path starts with BACKEND_DIR | RED (resolves to DEV/packages/lib-logger -- outside BACKEND_DIR) | PASS |
| resolves @raike/lib-db from within juggler-backend (not hoisted ancestor) | tests/unit/vendor-deps.test.js | same pattern for lib-db | RED (resolves to DEV/packages/lib-db -- outside BACKEND_DIR) | PASS |
| resolves mysql2 from within juggler-backend (not hoisted ancestor) | tests/unit/vendor-deps.test.js | require.resolve('mysql2', { paths: [BACKEND_DIR] }) resolved path starts with BACKEND_DIR | RED (mysql2 absent from local node_modules -- falls through to DEV/node_modules/mysql2, outside BACKEND_DIR) | PASS |
| package.json declares @raike/lib-logger as file:./vendor/lib-logger | tests/unit/vendor-deps.test.js | matches /^file:\.\/vendor\// | RED (declared as file:../../packages/lib-logger) | PASS |
| package.json declares @raike/lib-db as file:./vendor/lib-db | tests/unit/vendor-deps.test.js | matches /^file:\.\/vendor\// | RED (declared as file:../../packages/lib-db) | PASS |
| package.json declares mysql2 at ^3.x | tests/unit/vendor-deps.test.js | defined + matches /^\^3\./ | RED (absent) | PASS |

**Pre-fix RED count (corrected): 6/6** (previous claim of "6/6" was accidentally correct in number but wrong in justification for tests 1-3, which were previously tautological bare require() calls that stayed GREEN even on pre-fix tree. Tests 1-3 are now non-tautological: require.resolve scoped to BACKEND_DIR with path-starts-with assertion.)

**Note on Z1 claim correction:** The original TEST-CATALOG/TEST-REVIEW stated "6/6 RED on pre-fix tree" for the _old_ tests 1-3 (bare require() calls). Zoe proved that was wrong: bare require() on the dev host finds hoisted DEV/node_modules copies and stays GREEN. The old tests 1-3 were therefore 3 PASS / 3 FAIL on pre-fix tree (only tests 4-6 went RED). The new tests 1-3 genuinely go RED on the pre-fix tree because require.resolve scoped to BACKEND_DIR correctly identifies the out-of-context resolution path.

**Run summary (2026-06-12 Z2 re-review):**
- Run-1: 6/6 PASS (0.402 s)
- Run-2: 6/6 PASS (0.332 s)
- Deterministic: YES
- No DB, no Docker, no test-bed required (pure path resolution)

---

## bugreporter-libdb-vendor — bugfix — 2026-06-12 (STEP 0: RED guard authored)

_Leg 999.441. Regression guard for bug-reporter-backend Docker boot crash: `Cannot find module '@raike/lib-db'`. Exact analog of juggler BUG-407._

### New Test File

| Test | File | Traceability Ref | Run Result | Assertion | Pre-fix (broken tree) |
|------|------|------------------|------------|-----------|----------------------|
| @raike/lib-db path-scoped resolution (resolves within BACKEND_DIR) | bug-reporter-service/bug-reporter-backend/tests/unit/vendor-deps.test.js | 999.441 | RED | `require.resolve('@raike/lib-db', { paths: [BACKEND_DIR] })` startsWith BACKEND_DIR | FAIL — resolves to `DEV/packages/lib-db/src/index.js` (symlink outside BACKEND_DIR) |
| mysql2 path-scoped resolution (guard against future removal) | bug-reporter-service/bug-reporter-backend/tests/unit/vendor-deps.test.js | 999.441 | GREEN | `require.resolve('mysql2', { paths: [BACKEND_DIR] })` startsWith BACKEND_DIR | PASS — resolves to `bug-reporter-backend/node_modules/mysql2/index.js` |
| knex path-scoped resolution (guard against future removal) | bug-reporter-service/bug-reporter-backend/tests/unit/vendor-deps.test.js | 999.441 | GREEN | `require.resolve('knex', { paths: [BACKEND_DIR] })` startsWith BACKEND_DIR | PASS — resolves to `bug-reporter-backend/node_modules/knex/knex.js` |
| package.json pin for @raike/lib-db matches /^file:\.\/vendor\// | bug-reporter-service/bug-reporter-backend/tests/unit/vendor-deps.test.js | 999.441 | RED | `pkg.dependencies['@raike/lib-db']` defined + toMatch(/^file:\.\/vendor\//) | FAIL — working tree: `"file:../../packages/lib-db"` (fails pattern); committed HEAD: key absent (fails toBeDefined) |

**Run output (pre-fix, current broken tree):**
```
FAIL tests/unit/vendor-deps.test.js
  Tests:  2 failed, 2 passed, 4 total
  - @raike/lib-db path-scoped resolution FAIL (resolved to DEV/packages/lib-db — outside BACKEND_DIR)
  - package.json pin FAIL ("file:../../packages/lib-db" does not match /^file:\.\/vendor\//)
  - mysql2 path-scoped resolution PASS
  - knex path-scoped resolution PASS
  Time: 0.591 s
```

**RED count: 2/4** (tests 1 and 4). Tests 3 and 4 (mysql2, knex) are GREEN — both deps are correctly installed locally already.

**Runner command:**
```bash
cd bug-reporter-service/bug-reporter-backend && npx jest tests/unit/vendor-deps.test.js --no-coverage
```

No DB, no Docker, no test-bed required. Pure module resolution + JSON assertions.

---

## juggler-test-failloud-residual — bugfix — 2026-06-12

_TEST-FR-001 residual tail: 2 suites converted from silent-skip to hard-fail on DB-down._

### BUG-1: quotaTOCTOU.test.js — TEST-FR-001 conversion

| Test | File | BUG | Pre-fix DB-DOWN | Post-fix DB-DOWN | Post-fix DB-UP |
|------|------|-----|-----------------|------------------|----------------|
| B11-race [EXPECT-RED]: concurrent acquires at count=49 | tests/unit/aiEnrichment/quotaTOCTOU.test.js | BUG-1 | PASS vacuous (console.warn + return) | FAIL [TEST-FR-001] | PASS (197ms, real DB assertions) |
| B11-guard [GUARD-GREEN]: single acquire under limit | tests/unit/aiEnrichment/quotaTOCTOU.test.js | BUG-1 | PASS vacuous (console.warn + return) | FAIL [TEST-FR-001] | PASS (54ms, real DB assertions) |

**Lines changed:** added `const { assertDbAvailable } = require('../../helpers/requireDB')` import (line 79); B11-race: replaced `if (!dbAvailable) { console.warn; return }` with `await assertDbAvailable()` at body top (line ~169); B11-guard: same at body top (line ~272). `beforeEach` guard comment updated (dead guard retained for afterAll safety).

### BUG-2: timeoutAbortConsequences.test.js — TEST-FR-001 conversion (B5 only; B4 untouched)

| Test | File | BUG | Pre-fix DB-DOWN | Post-fix DB-DOWN | Post-fix DB-UP |
|------|------|-----|-----------------|------------------|----------------|
| B4-red [EXPECT-RED]: enqueue 0 times on ETIMEDOUT (PURE UNIT, unchanged) | tests/unit/aiEnrichment/timeoutAbortConsequences.test.js | n/a | PASS (pure unit) | PASS (pure unit, DB irrelevant) | PASS (57ms) |
| B5-red [EXPECT-RED]: timeout → 0 rows in ai_command_log | tests/unit/aiEnrichment/timeoutAbortConsequences.test.js | BUG-2 | PASS vacuous (console.warn + return) | FAIL [TEST-FR-001] | PASS (28ms, real DB assertions) |
| B5-guard [GUARD-GREEN]: checkQuota + commitQuota → 1 row | tests/unit/aiEnrichment/timeoutAbortConsequences.test.js | BUG-2 | PASS vacuous (console.warn + return) | FAIL [TEST-FR-001] | PASS (45ms, real DB assertions) |

**Lines changed:** added `const { assertDbAvailable } = require('../../helpers/requireDB')` import (line 73); B5-red: replaced `if (!dbAvailable) { console.warn; return }` with `await assertDbAvailable()` at body top (~line 258); B5-guard: same (~line 296). B4 describe block: zero changes.

### Critical edge case confirmed

B4 (pure-unit, no DB) remains GREEN with DB down — confirmed by DB-DOWN run: 1 passed, 2 failed (only B5-red and B5-guard fail). B4's `assertDbAvailable()` was intentionally NOT added.

### Run summary (2026-06-12 — leg juggler-test-failloud-residual)

| Direction | quotaTOCTOU | timeoutAbortConsequences | Result |
|-----------|-------------|--------------------------|--------|
| DB DOWN (port 9999) | 2/2 FAIL [TEST-FR-001] | B4 PASS, B5-red FAIL, B5-guard FAIL | CORRECT |
| DB UP (port 3407) | 2/2 PASS | 3/3 PASS | CORRECT |
| Combined DB UP | 5/5 PASS (2.09s) | | CORRECT |
