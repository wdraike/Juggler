# Telly Review — juggler-hex-h6-scheduler H6 Z1 Re-review (facade forwarding contract) — refactor — 2026-06-12

## Status: DONE

_Supersedes W4 review below. Closes zoe WARN Z1 (ZOE-REVIEW.md F006 escalated). BLOCK: 0 WARN: 0 (Z1 closed)._

---

## Z1 Re-review Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Read ZOE-REVIEW.md | identified Z1 WARN: caller tests mock legacy path, assert only canned echo — no forwarding-contract assertion | Gap confirmed at tests/api/schedule-routes.test.js:168,174 |
| Read schedule-routes.test.js | existing `POST /api/schedule/run` test: `expect(res.status).toBe(200)` + `toHaveProperty('dayPlacements')` only | No `toHaveBeenCalledWith`; Z1 confirmed |
| Read schedule.routes.js:39 | `runScheduleAndPersist(req.user.id, undefined, opts)` where `opts = { timezone: header \|\| 'America/New_York' }` | Exact call signature identified |
| Backup | `cp` test + facade → /tmp; shasum | test `f1a4688...`, facade `1079259...` |
| Baseline run | `npx jest tests/api/schedule-routes.test.js --no-coverage` | **22/22 PASS** |
| Author Z1 tests | Added 2 tests to describe `POST /api/schedule/run` in tests/api/schedule-routes.test.js | `toHaveBeenCalledWith('user-123', undefined, { timezone: 'America/New_York' })` + timezone-header variant |
| Post-addition run (correct code) | `npx jest tests/api/schedule-routes.test.js --no-coverage` | **24/24 PASS** |
| Facade mutation (drop-arg) | facade `runScheduleAndPersist: fn(u,i,o){ return real(u); }` (drops ids+opts) | `2 FAIL, 22 pass` — both Z1 tests RED; old test still GREEN (confirms insufficient) |
| Facade revert | `cp /tmp/facade.js.bak` → facade.js; shasum | `1079259...` byte-identical |
| Post-revert run | `npx jest tests/api/schedule-routes.test.js --no-coverage` | **24/24 PASS** |
| Golden master unaffected | `npx jest goldenMaster.h6 --no-coverage` | **45/45 PASS** |
| Tree clean | `git status` | only `tests/api/schedule-routes.test.js` changed by this pass; facade sha unchanged |
| Z1 TRACEABILITY update | S8 test column: added Z1 forwarding-contract tests | updated |

## W4 Proof of Work (carried)

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | TRACEABILITY.md at `.planning/kermit/juggler-hex-h6-scheduler/TRACEABILITY.md`; mode=refactor, --re-review, --depth deep, --traceability flag | All inputs present; 13 TRACEABILITY rows confirmed |
| W4 scope confirmed | `src/slices/scheduler/facade.js` + `src/slices/scheduler/index.js` + callers `src/routes/schedule.routes.js` + `src/mcp/tools/schedule.js` | Facade is thin re-export; both callers migrated to `../slices/scheduler/facade` path |
| Golden master run-1 | `DB_HOST=127.0.0.1 DB_PORT=3407 … npx jest --testPathPattern="goldenMaster.h6" --no-coverage` | **45/45 PASS** — 4.572 s |
| Golden master run-2 | same | **45/45 PASS** — 4.517 s |
| Golden master run-3 | same | **45/45 PASS** — 4.416 s |
| Frozen literals verified | CORE start values (720/780/810), score.total:0, breakdown all 0, slackByTaskId all null | IDENTICAL to W0 baseline; S1/S2/S3/C-SCORE/C-WX/S4/S5/S6/P1/C-IDEM/C-COUPLE all GREEN |
| Broader scheduler suite | `npx jest --testPathPattern="scheduler" --no-coverage` | **409/410 PASS (1 pre-existing skip)** — 14 suites, 9.819 s |
| Caller tests — schedule routes | `npx jest --testPathPattern="schedule.routes" --no-coverage` | **22/22 PASS** — 1 suite |
| Caller tests — MCP | `npx jest --testPathPattern="mcp" --no-coverage` | **312/312 PASS** — 13 suites |
| Caller migration confirmed | `src/routes/schedule.routes.js:10` + `src/mcp/tools/schedule.js:7` | Both import from `slices/scheduler/facade`; migration complete |
| Mock validity confirmed | `tests/api/schedule-routes.test.js` mocks `src/scheduler/runSchedule` | Effective: facade re-exports same function references; Jest module cache intercepts at canonical path |
| TRACEABILITY sweep | All 13 rows (S1–S8, P1, C-IDEM, C-SCORE, C-WX, C-COUPLE) | 0 W-pending rows; all Code columns → extracted slice paths; all Test columns → green pinning tests; Status = extracted/verified/GREEN/CLEARED |
| TEST-CATALOG.md updated | W4 verification section added | W4 run summaries, snapshot values, caller test table added |
| telly-REVIEW.json updated | W4 status update | DONE; findings carry forward from W3 (f001/f002 RESOLVED; f003/f004/f005 unchanged) |

---

## Proof Checklist

- [x] Required inputs present (--mode refactor, --re-review, --depth deep, --traceability TRACEABILITY.md) — all present; 13 traceability rows seeded
- [x] Mode confirmed as refactor; entry gate: characterization suite (golden master) GREEN before and after W4; CORE/S1/S2/S3/C-SCORE/C-WX frozen literals IDENTICAL to W0 baseline
- [x] Scope detected — W4 scope: `src/slices/scheduler/facade.js`, `src/slices/scheduler/index.js`, `src/routes/schedule.routes.js`, `src/mcp/tools/schedule.js` (migration callers)
- [x] TEST-CATALOG.md built/updated — W4 final verification section added with caller test table, 3-run golden master, snapshot value table
- [x] For mode=refactor: characterization suite run POST-W4; all frozen literals UNCHANGED from W0; no behavioral regressions
- [x] Golden master 45/45 confirmed stable — 3× consecutive runs all 45/45; CORE/S1/S2/S3/C-SCORE/C-WX/S4/S5/S6/P1/C-IDEM/C-COUPLE all GREEN
- [x] No assertion weakened — W4 introduces only the facade thin re-export and caller path migration; no test changes in W4
- [x] Suite(s) run; results captured (pass/fail counts + timing) — golden master 3×, broader scheduler ×1, caller tests ×1
- [x] Coverage measured if --coverage — not requested; not run
- [x] Changed-line / diff coverage: W4 source changes are import-path redirections (facade.js = re-exports only; index.js = 1-line facade re-export; schedule.routes.js line 10 + mcp/tools/schedule.js line 7 — require path only). All changed lines are covered by the passing caller tests.
- [x] Mutation testing: Stryker not wired (carried INFO). W4 facade is a thin re-export with no logic to mutate; per-pin self-mutation N/A for re-export files. Prior MUT-A/B/D from W0 unchanged.
- [x] Flake/determinism: 3× golden master runs all 45/45. Timing-based sleeps (S5/C-IDEM 1100ms) pre-existing and consistent across runs. No new non-deterministic inputs introduced by W4.
- [x] Test-data isolation: no new test data; W4 does not touch test files. S5/C-IDEM isolation fix (W3) remains in effect.
- [x] Contract tests for inter-service seams: W4 does not touch auth/payment seam; not applicable
- [x] Security-regression tests: no REFER→telly items in SECURITY-REVIEW.md for H6; not applicable
- [x] Test-pyramid balance: W4 is import-path-only; pyramid unchanged from W3 (45 golden-master integration + 58 domain unit + 14 adapter contract + 22 schedule-routes + 312 MCP caller tests)
- [x] TRACEABILITY.md Test column: all 13 rows verified; 0 W-pending; Code columns point at extracted slice; Test columns point at green pinning tests; Status column = verified/extracted/GREEN/CLEARED throughout
- [x] --re-review: related-test run output captured (golden master 3×, broader scheduler, caller suite)
- [x] Findings carry file:line + severity BLOCK/WARN/INFO
- [x] Flag-and-refer: F001/F002 BLOCK resolved in W3; F003 WARN carried; F004/F005 INFO carried; REFER→zoe for adversarial capstone
- [x] Rubric Coverage Map emitted — all 9 dimensions marked
- [x] TEST-CATALOG.md written to .planning/kermit/reviews/
- [x] TEST-REVIEW.md written to .planning/kermit/reviews/ with Proof-of-Work table
- [x] Status line set: DONE
- [x] Scooter not needed: W4 is import-path migration (thin facade + caller re-point); no requirement/NFR/standard/approach changed; behavior-identical by construction and golden-master proof

---

## Findings

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| F001 | ~~BLOCK~~ RESOLVED (W3) | tests/characterization/scheduler/goldenMaster.h6.test.js | S5 and C-IDEM shared testDb singleton + shared user_id caused non-deterministic failures. Fixed in W3: unique user_ids (test-user-s5/test-user-cidem); no destroy() in per-describe afterAll. | RESOLVED — no further action |
| F002 | ~~BLOCK~~ RESOLVED (W3) | tests/characterization/scheduler/goldenMaster.h6.test.js | Shared user_id='test-user-001' cross-contamination between S5 and C-IDEM beforeEach. Fixed in W3. | RESOLVED — no further action |
| F003 | WARN | tests/characterization/scheduler/goldenMaster.h6.test.js:~962 | P1 source-grep comment-strip uses `indexOf('//')` — does not handle block comments or string literals containing `//`. Theoretical fragility; no such patterns in current source. | Carried from W3. Document limitation in test comment. REFER→zoe for adversarial audit of comment-stripping adequacy. |
| F004 | INFO | juggler-backend/ | Stryker mutation testing not wired. Per-leg fallback (manual self-mutation MUT-A/B/D at W0) remains valid. W4 facade has no logic to mutate. | Backlog: wire Stryker. Not blocking. |
| F005 | INFO | tests/characterization/scheduler/goldenMaster.h6.test.js:~840,~1285 | S5/C-IDEM use 1100ms setTimeout for MySQL DATETIME 1s precision. Timing-based; pre-existing W2 design. Consistent across all runs. | Carried from W3. REFER→zoe if adversarial audit of timing-sleep sufficiency desired. |
| F006 | ~~INFO~~ **RESOLVED (Z1 re-review 2026-06-12)** | tests/api/schedule-routes.test.js | Test mocks `src/scheduler/runSchedule` (legacy path). Originally asserted only canned echo. Zoe escalated to WARN (Z1). FIXED: added `toHaveBeenCalledWith` assertions proving forwarding contract. Mutation proof: facade drop-arg → 2 RED. 24/24 green on correct code. | RESOLVED — `toHaveBeenCalledWith` assertion added at tests/api/schedule-routes.test.js ~189,205 |

---

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Tier Coverage | covered | Golden master: 45 integration (DB-backed, S5/C-IDEM/P1); 58 domain unit (W1); 14 adapter contract (W2); 22 schedule-route caller; 312 MCP caller. Healthy pyramid. | W4 adds no new test tier — facade is thin re-export with no domain logic |
| Assertion Quality | partial | Frozen-literal toEqual assertions (CORE/S1/S2/S3/C-SCORE/C-WX) strong. P1 source-grep carve-out valid but block-comment fragility (F003 WARN). S5/C-IDEM 1100ms sleep (F005 INFO). Caller tests mock at legacy path (F006 INFO). | Strongest: CORE/S1/S2/S3; weakest: P1 comment-strip |
| Edge Case Coverage | covered | S3 full-day conflict; C-WX active-weather hour-gap; S2 capacity crunch; C-IDEM batch-scale 3 tasks; pure-function idempotence. All from prior waves; no regression. | Unchanged from W3 |
| Determinism | covered | 3× golden master 45/45. Isolation fix (W3) eliminated shared-singleton non-determinism. 1100ms timing sleep bounded and consistent (INFO F005). | Fully deterministic |
| Test Maintainability | covered | S5/C-IDEM isolated user_ids; scoped cleanup; no destroy() in per-describe afterAll. W4 facade thin re-export: single public surface, callers import facade path. F006 INFO (mock path mismatch) is minor technical debt. | Good; F006 is cosmetic |
| E2E Depth | gap | No Playwright/Cypress E2E. Not required for behavior-identical refactor; golden-master integration tests serve as the behavior contract. | Intentional gap for H6 |
| Performance Testing | gap | No performance assertions beyond the perf log line (not asserted). No perf change from W4 (import path only). | Acceptable for refactor |
| Coverage Metrics | gap | --coverage not run (not requested). Only import path lines changed in W4; all covered by passing caller tests. | INFO only |
| Security Testing | covered | No auth/payment/entitlement seam touched by W4. No REFER→telly from elmo in SECURITY-REVIEW.md for H6. S4/S6 static require-graph tests confirm scheduleQueue isolation (no scheduler self-trigger or cascade via the facade). | No gap |

---

## Behavior-Identity Verdict: WHOLE H6 EXTRACTION — PASS

The complete H6 hexagonal extraction (W0 characterization baseline → W1 domain extraction → W2 adapter/port extraction → W3 RunScheduleCommand + inline flush collapse → W4 facade + caller migration) is **behavior-identical end-to-end**:

1. **Golden master 45/45 × 3 runs** — CORE/S1/S2/S3/C-SCORE/C-WX/S4/S5/S6/P1/C-IDEM/C-COUPLE all PASS; frozen literals (start:720/780/810, score.total:0, slackByTaskId all null) bit-for-bit identical to W0 baseline.
2. **Broader scheduler suite 409/410** (1 pre-existing skip; zero regressions across all 4 waves).
3. **Caller tests 312/312 PASS** — schedule routes and all MCP tools exercise the migrated facade import path.
4. **TRACEABILITY complete** — all 13 rows verified; 0 W-pending; every Code column references extracted slice files; every Test column references a green pinning test.
5. **Delta-write behavioral change (S5/C-IDEM)** was the ONE intentional behavioral improvement approved mid-leg; proven by DB-observable run-2 "executing 0 DB updates" proof.
6. **P1 migration complete** — 0 executable fn.now() in runSchedule.js; KnexScheduleRepository uses clock.now() (new Date()); RunScheduleCommand.clockNow() returns JS Date.

**REFER→zoe for final adversarial capstone:** bit-for-bit frozen-literal integrity (are the W0 snapshot values actually computed, not hardcoded?), S5/C-IDEM 1100ms sleep sufficiency (F005), P1 comment-strip block-comment fragility (F003), and F006 mock-path mismatch. Telly's behavioral verdict is PASS; zoe's adversarial challenge is the final quality gate.

---

## Sign-off

Signed: Telly — 2026-06-12T16:45:00Z (W4); Z1 re-review 2026-06-12T21:00:00Z

**W4 Final Summary:**

- **Facade verified thin:** `src/slices/scheduler/facade.js` re-exports `runScheduleAndPersist` / `getSchedulePlacements` / `unifiedScheduleV2` / `RunScheduleCommand` / domain entities / ports / adapters by reference — zero behavior change.
- **Callers migrated:** `src/routes/schedule.routes.js` line 10 + `src/mcp/tools/schedule.js` line 7 both `require('../slices/scheduler/facade')`.
- **Golden master stable:** 45/45 × 3 runs; all frozen literals bit-for-bit identical to W0 baseline; deterministic.
- **Broader suite:** 409/410 (1 pre-existing skip); zero regressions.
- **Caller suite:** 312/312 PASS across 13 MCP suites + schedule routes.
- **All 13 TRACEABILITY rows verified; 0 W-pending.**
- **H6 extraction behavior-identical end-to-end. FINAL VERDICT: PASS.**
