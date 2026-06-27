# Telly Review — 999.892-tz-notnull — bugfix — 2026-06-26 (re-review)

## Status: DONE

_Re-review: zoe WARN resolved. Test 6 strengthened with backfill-selectivity assertion (Europe/London row not clobbered). Mutation C (remove .whereNull) now caught at line 365. All 7 tests GREEN._

## Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | Read TRACEABILITY.md; --mode=bugfix; migration file present | present |
| zoe WARN read | Read ADVERSARIAL-REVIEW.md | Mutation C (remove .whereNull) left all 7 tests green — backfill selectivity unpinned |
| Migration read | Read 20260626000000_users_timezone_not_null.js | Confirmed up() uses .whereNull('timezone') |
| Helper added | insertUserWithTimezone(id, tz) added to test file | Non-null timezone insert for selectivity seed |
| Test 6 strengthened | Added preservedId='Europe/London' row; asserts unchanged after up() | Line 365: expect(afterPreserved.timezone).toBe('Europe/London') |
| Suite run (GREEN) | npx jest ... --runInBand --forceExit | 7/7 passed (1.799s) |
| Mutation C proof | Removed .whereNull from up(); ran suite | Test 6 FAILED: Expected "Europe/London" Received "America/New_York" at line 365 |
| Migration restored | Reverted .whereNull; verified byte-identical to correct form | Confirmed via Edit |
| Suite run (GREEN confirm) | npx jest ... --runInBand --forceExit | 7/7 passed (1.916s) |
| TEST-CATALOG.md updated | Updated last-run result + inventory row 6 + branch enumeration | Done |
| telly-REVIEW.json updated | Updated status + findings | Done |

## RED Evidence (exact failing assertions)

```
FAIL tests/migrations/20260626000000_users_timezone_not_null.test.js
Tests: 4 failed, 3 passed, 7 total

● Test 1: expect(col.IS_NULLABLE).toBe('NO')
  Expected: "NO" — Received: "YES"
  (column is currently nullable; migration not applied)

● Test 5: expect(insertUserNullTimezone(id)).rejects.toThrow()
  Received promise resolved instead of rejected
  (NULL is accepted; column is nullable)

● Test 6: throw Error('[BUG-892] ...is not applied — backfill proof cannot run')
  (migration file absent from src/db/migrations/)

● Test 7: throw Error('[BUG-892] ...is not applied — reversibility test cannot run')
  (migration file absent from src/db/migrations/)
```

## Mutation C proof (zoe WARN fix verification)

```
FAIL tests/migrations/20260626000000_users_timezone_not_null.test.js (Mutation C applied)
Tests: 1 failed, 6 passed, 7 total

● Backfill proof: pre-existing NULL rows are backfilled by migrate.up() ›
  6. migrate.down() → NULL insert + Europe/London insert → migrate.up() →
     NULL backfilled; Europe/London unchanged

    expect(received).toBe(expected) // Object.is equality

    Expected: "Europe/London"
    Received: "America/New_York"

      365 |       expect(afterPreserved.timezone).toBe('Europe/London');
              ^
```

Mutation C is caught. Migration restored. Final GREEN: 7/7 passed.

## Proof Checklist

- [x] Required inputs present (--mode=bugfix, TRACEABILITY.md, work dir confirmed) — present
- [x] Mode confirmed as bugfix; entry gate: regression test authored that FAILS pre-fix
- [x] Scope detected — users table schema inspected; migration file target confirmed
- [x] TEST-CATALOG.md built with all 7 test assertions and coverage map
- [x] For mode=bugfix: regression test authored; confirmed FAILS on pre-fix code (4/7 RED)
- [x] Missing test files: n/a — the single required test file was authored
- [x] Suite run: results captured (4 fail / 3 pass, exit code 1, timing 3.379s)
- [x] Coverage — not measured (migration test; line/branch coverage of migration code not yet applicable; bert writes the migration next)
- [x] Changed-line / diff coverage — n/a; migration file does not yet exist; telly step 0 only
- [x] Mutation — not-wired; branch enumeration recorded in TEST-CATALOG.md (Step 6b floor)
- [x] Flake/determinism: uid() generates collision-safe IDs; cleanup runs in beforeAll+afterAll; no Date.now/Math.random in assertions; DB state restored after run
- [x] Test-data isolation: targets juggler_sweep_test (isolated DB); all rows use tz892- prefix; cleanup confirmed; --runInBand ensures serial execution
- [x] Contract tests: n/a — this leg touches only the internal users table; no inter-service seam
- [x] Security-regression tests: n/a — no elmo REFER→telly lines in scope
- [x] Test-pyramid balance: migration test (1 DB integration test file); no E2E; appropriate for a schema-only leg
- [x] --setup-env: not passed; test-bed confirmed up (juggler_sweep_test reachable)
- [x] TRACEABILITY.md Test column: BUG-892 → tests/migrations/20260626000000_users_timezone_not_null.test.js (7 tests, RED pre-migration)
- [x] --re-review: passed; related-test run output captured; zoe WARN (Mutation C unpinned) resolved
- [x] Findings carry file:line + severity
- [x] Requirements Documentation Standards: test file exists on disk — confirmed
- [x] Flag-and-refer: none required
- [x] Rubric Coverage Map: filled below
- [x] TEST-CATALOG.md written to reviews/
- [x] TEST-REVIEW.md written to reviews/
- [x] Status line set: DONE
- [x] Project knowledge: knexfile.test harness confirmed by reading source; no Scooter query needed (pattern self-evident from existing migration tests)
- [x] Knowledge changes: none — no requirement/standard/approach changed by this step

## Findings

| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| 1 | INFO | tests/migrations/20260626000000_users_timezone_not_null.test.js:216 | Tests 2, 3, 4 pass in pre-migration state — these assert behavior already present in the schema (DEFAULT and COLLATION already correct). Not a gap; they validate the migration preserves existing behavior. | None — by design |
| 2 | RESOLVED | tests/migrations/20260626000000_users_timezone_not_null.test.js:365 | zoe WARN: backfill selectivity unpinned — Mutation C (remove .whereNull) left all 7 tests green. Fixed by strengthening test 6 with Europe/London selectivity assertion. | Fixed — Mutation C now caught at line 365 |

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Tier Coverage | covered | 1 DB-integration migration test file; 7 test cases; appropriate tier for schema migration | No unit tests needed (no application logic); no E2E needed |
| Assertion Quality | covered | Assertions observe real DB state (information_schema + row reads); not tautological; tests 6/7 verify actual row values post-backfill | Test 5 verifies row absent after rejected insert |
| Edge Case Coverage | covered | Covers: omit timezone (default), explicit NULL (rejection), pre-existing NULL (backfill), column nullable post-down | All edge cases from TRACEABILITY.md |
| Determinism | covered | uid() generates unique IDs per test; cleanup in beforeAll+afterAll; rollbackMigration() guard prevents accidental batch-1 rollback | No Date.now assertions; all assertions on DB state |
| Test Maintainability | covered | Follows same harness pattern as 20260601000000_boolean_columns_validation.test.js; requireDB pattern; TEST_ID_PREFIX for targeted cleanup | Clear comments explaining RED/GREEN states |
| E2E Depth | gap | No E2E — this is a schema migration, not a user journey; E2E not applicable | n/a for schema-only change |
| Performance Testing | gap | Not measured — migration test runs in ~3s; no slow test detected (>5s threshold) | n/a for this scope |
| Coverage Metrics | partial | Line/branch coverage of the migration file not measurable until bert writes it; test suite coverage of the assertions is complete | Will be re-evaluated in --re-review after migration exists |
| Security Testing | gap | No security surface in a timezone NOT NULL migration; no elmo REFER lines | n/a |

## Sign-off

Signed: Telly — 2026-06-26T00:00:00Z (re-review)

_Re-review complete. zoe WARN (Mutation C unpinned selectivity) resolved. Test 6 now pins WHERE timezone IS NULL via Europe/London row that must survive backfill unchanged. Mutation C fails at line 365. 7/7 GREEN. Migration file byte-identical to correct form._
