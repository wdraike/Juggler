# Test Catalog — 999.884-ui-map-e2e-foundation — new — 2026-06-26

_Last updated: 2026-06-26 — mode: new_

## Source Files in Scope

| File | Description |
|------|-------------|
| `juggler-frontend/e2e/report/ui-coverage.js` | Pure coverage calculator (`computeCoverage`) |
| `juggler-frontend/e2e/report/collect-coverage.js` | @covers scanner + report printer (reads FS, no browser) |

## Unit Tests

| Module | Test File | Requirement(s) | Traceability Ref | Last Run | Result |
|--------|-----------|----------------|------------------|----------|--------|
| `e2e/report/ui-coverage.js:computeCoverage` | `e2e/report/ui-coverage.test.js` | R2 | R2 | 2026-06-26 | PASS 7/7 |

### Test cases in `ui-coverage.test.js` (7 total)

| # | Test name | AC / Case covered | Assertion quality |
|---|-----------|-------------------|-------------------|
| 1 | empty coverage => 0% everywhere, totals intact | empty => 0% guard | deepStrictEqual on all three cats + unmatched |
| 2 | partial coverage computes rounded percentages | partial (1/3=33%, 1/2=50%, 2/5=40%) | strictEqual per field incl. pct rounding |
| 3 | full coverage => 100% everywhere | all ids covered => 100% | strictEqual pct + overall.covered count |
| 4 | unknown covered id goes to unmatched and does NOT inflate covered | unmatched surfacing; no inflation | screens/paths/overall.covered asserted; unmatched.sort() compared |
| 5 | duplicate covered ids are counted once | de-duplication | covered counts asserted after 3× + 2× dupes |
| 6 | div-by-zero guard: empty category total => pct 0, not NaN | total=0 => pct=0, never NaN | strictEqual + assert.ok(!NaN) |
| 7 | missing map arrays are treated as empty, not crashes | malformed uiMap `{}` | total=0; unknown id surfaced in unmatched |

## E2E / Integration Tests

| Journey | Test File | Traceability Ref | Last Run | Result |
|---------|-----------|------------------|----------|--------|
| Playwright specs (R4) | `e2e/specs/*.spec.js` | R4 | NOT RUN (safety constraint — David-greenlit) | AUTHORED-NOT-RUN |
| collect-coverage.js node run | manual `node e2e/report/collect-coverage.js` | R3 | 2026-06-26 | PASS (exit 0, printed report) |

**Note:** Playwright live suite execution is under a hard safety constraint (prior UAT agent left 281 junk rows in dev DB). R4 specs are authored; live execution is a David-greenlit separate step. This is expected and not a coverage gap for this leg.

## Coverage Gaps

None for the in-scope pure-logic surface (R2). The collect-coverage.js FS-read path has no unit test, but is validated by the manual node run (exit 0). The `idsOf()` error-throw path (entry with missing `id`) is not explicitly unit-tested — flagged as INFO only; SPEC does not require it.

## Missing Test Files

None — all testable units in scope have tests.

## Branch Enumeration (mutation-wired: no — manual self-assessment)

Changed region guards in `ui-coverage.js`:

| Guard / branch | Pinning test(s) |
|----------------|-----------------|
| `if (total === 0) return 0` | test 6 (div-by-zero) — would fail if changed to return 1 |
| `Array.isArray(...) ? ... : []` (malformed map) | test 7 (missing arrays) |
| `surfaceIds.has(id)` branch | tests 2, 3, 4 (valid surface ids routed correctly) |
| `pathIds.has(id)` branch | tests 2, 3, 4 (valid path ids routed correctly) |
| else branch (unmatched) | test 4 (unknown ids land in unmatched array) |
| `new Set(coveredIds)` de-dup | test 5 (3× dup counts as 1) |

Stryker: not wired. All key guards have pinning tests.

## Input-Shape Variants

`computeCoverage` is pure in-memory (no DB, no wire format). The uiMap is consumed in-process from a parsed JSON object. Variants tested:
- Well-formed fixture with screens, modals, paths
- Empty coveredIds array
- Partial coveredIds
- Unknown coveredIds (unmatched)
- Duplicate coveredIds
- Empty map (`{}` missing all arrays)
- Empty map with arrays present but zero entries

## Test-Pyramid Balance

| Tier | Files | Tests |
|------|-------|-------|
| Unit | 1 | 7 |
| Integration | 0 | 0 (N/A — pure functions; no DB/API) |
| E2E | authored, not run | N/A (safety constraint) |

Pure function under test has no I/O; unit is the correct and only tier. Not inverted.
