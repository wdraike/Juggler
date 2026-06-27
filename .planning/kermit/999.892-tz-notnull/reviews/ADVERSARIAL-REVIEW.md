# Zoe Review — 999.892-tz-notnull (users.timezone NOT NULL migration) — bugfix — 2026-06-26

## Status: ISSUES

BLOCK: 0 · WARN: 1 · INFO: 3

Verdict: The four RED-genuine assertions (1, 5, 6, 7) are **truthful** — proven by source
mutation, not just re-run. No tautologies, no false-passes. One real coverage gap (WARN):
the backfill's `whereNull` selectivity is unpinned — a regression that clobbers existing
non-null user timezones passes all 7 tests.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs | Read test, migration, TEST-REVIEW.md, TEST-CATALOG.md, telly-REVIEW.json, requireDB.js | all present |
| Baseline GREEN | `npx jest tests/migrations/20260626000000_users_timezone_not_null.test.js --runInBand` | 7/7 pass |
| Knex/config | knex 3.2.10 (`migrate.down({name})` supported); knexfile.test.migrations.dir=src/db/migrations; DB_NAME from env (juggler_sweep_test) | confirmed |
| **Mutation A** | up() ALTER `NOT NULL`→`NULL` (neuter enforcement), re-run jest | **3 fail** — tests 1, 5, 7 RED (IS_NULLABLE 'YES'; NULL insert resolved; cycle nullable). Enforcement genuinely pinned. |
| **Mutation B** | up() backfill value `America/New_York`→`UTC`, re-run jest | **1 fail** — test 6 only (Expected America/New_York, Received UTC). Backfill genuinely pinned + isolated from the column DEFAULT. |
| **Mutation C** | up() remove `.whereNull('timezone')` (backfill clobbers ALL rows), re-run jest | **7/7 pass** — gap: selectivity unpinned (WARN-1). |
| Direct repro | drove `migrate.latest()` on juggler_sweep_test with mutated file | mutated NULL migration → column nullable (confirms mutation reaches the SUT) |
| Tree clean | `diff backup vs file` + `git diff` + DB col probe | file byte-identical to backup, no residue; migration rolled back (nullable) by afterAll |

## Adversarial answers to the 5 dispatched questions
1. **Real RED→GREEN (tests 1,5,6,7):** YES. Mutation A flips IS_NULLABLE/NULL-acceptance and tests 1, 5, 7 go RED; on the pre-migration nullable schema these same assertions fail (telly's reported 4/7 RED is reproducible in principle). The RED is genuine, not masked.
2. **Tautology / false-pass:** None found.
   - Test 5 asserts the insert `.rejects.toThrow()` **and** that the row is `undefined` (not persisted). The throw is for the *correct* reason: `insertUserNoTimezone` (test 4, same columns minus timezone) **succeeds**, so the only delta causing test 5's throw is `timezone=NULL` on a NOT NULL column — not a missing-required-column error. Under Mutation A test 5 correctly *resolved* instead of rejecting.
   - Test 4 (default-on-insert) genuinely **omits** the timezone column (`INSERT (id,email,created_at,updated_at)`) and reads back the DEFAULT — it does not set the value explicitly. It stayed green under Mutation B (backfill path), confirming it reads the column DEFAULT, a separate path.
3. **Backfill proof (test 6):** Genuine. It rolls the migration **down by name** (`migrate.down({ name: '20260626000000_users_timezone_not_null.js' })` — the RIGHT migration, not "latest batch"), inserts an explicit-NULL row, asserts it stored NULL, rolls **up**, and reads back `'America/New_York'`. Mutation B (backfill value → UTC) makes *only* test 6 fail, proving it observes the up() backfill of an EXISTING null row, distinct from the column DEFAULT.
4. **Reversibility (test 7):** Genuine both directions. down() → IS_NULLABLE 'YES' + NULL insert **succeeds** + stored NULL; up() → IS_NULLABLE 'NO' + NULL insert **rejected** + not persisted. Mutation A makes the up()-side re-enforcement assertions RED.
5. **Cleanup / coverage probe:** Seeded rows are removed — `DELETE FROM users WHERE id LIKE 'tz892-%'` in beforeAll + afterAll, plus per-test self-deletes; rejected inserts (tests 5/7) never persist. No row pollution. The COLLATION assertion (test 3) reads the **real** column collation (`information_schema.COLUMNS.COLLATION_NAME`), not a fabricated value.

## Findings

### Telly Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| W1 | WARN | tests/migrations/20260626000000_users_timezone_not_null.test.js (backfill coverage) | **Backfill selectivity (`whereNull`) is unpinned.** Mutation C removed `.whereNull('timezone')` so up() overwrites EVERY users row to 'America/New_York' — all 7 tests still PASS. No test seeds a row with an existing non-null timezone (e.g. 'Europe/London') to assert the backfill leaves it untouched. A future edit that clobbers real user timezones (data corruption) would pass green. | Add a test: insert one user with `timezone='Europe/London'` and one with `timezone=NULL`, run down→insert→up, assert the London row is **preserved** and the NULL row backfilled to 'America/New_York'. |
| I1 | INFO | test.js tests 2,3,4 | Preservation-only assertions: green in BOTH pre- and post-migration states (DEFAULT + COLLATION already correct in the initial schema), so they cannot go RED pre-migration. Valid as anti-regression guards; telly disclosed this honestly in its own INFO finding. | None — by design. |
| I2 | INFO | test.js test 7 (down phase) | After down(), only IS_NULLABLE is asserted. The down() ALTER also re-declares DEFAULT + COLLATE, but no test asserts the DEFAULT/COLLATION survive the rollback. If down() silently dropped them, no test catches it (low risk — down() is explicit). | Optional: assert COLUMN_DEFAULT + COLLATION_NAME in the down state. |
| I3 | INFO | test.js afterAll | afterAll rolls the migration back to restore pre-migration (nullable) state. For a co-running suite ordered AFTER this one in the same jest invocation, users.timezone is left nullable and the migration absent from knex_migrations — schema/ledger inconsistent with an "applied" migration. Deliberate + commented; single-file run (as dispatched) unaffected; no current suite depends on the NOT NULL state. | None — note only. |

### Bird Audit
N/A — no UX-REVIEW.md in scope (schema-only migration leg).

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→telly | test.js W1 | Coverage gap is telly's to close (add the preserve-existing-timezone test); not a production-code defect. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | Tests observe real DB state (information_schema + row reads); test 5 asserts throw AND non-persistence; mutations A/B prove depth | — |
| Edge Case Gaps | partial | Omit-column, explicit-NULL, pre-existing-NULL, post-down-nullable all covered; **existing-non-null-preserved NOT covered** (W1) | WARN-1 |
| Test Gaps | covered | All 4 RED-genuine assertions pin behavior under mutation; backfill rolls correct migration by name | — |
| UX Gaps | n/a | schema-only leg | — |
| Security Gaps | n/a | no security surface in a NOT NULL migration | — |
| Documentation Gaps | covered | TEST-CATALOG branch-enumeration + RED evidence accurate and match reproduced results | — |
| Architecture Gaps | covered | requireDB guard (TEST-FR-001) + isMigrationApplied rollback safety guard present; correct test-bed targeting | — |
| Review Quality | covered | 3 risk-ordered mutations executed (enforcement, backfill value, backfill selectivity); tree verified byte-clean | — |
| False Passes | covered | None confirmed; one latent gap (W1) where a future regression would false-pass | — |

## Proof Checklist
- [x] --mode present (bugfix) — recorded
- [x] Required inputs present (TEST-REVIEW.md + TEST-CATALOG.md) — present
- [x] Shallow-assertion / assertion-free patterns examined — none (every test has concrete DB-state expectations)
- [x] Suspect tests re-executed — full suite run GREEN (7/7) then under 3 mutations
- [x] Suspect-selection risk-ordered — data-mutation (backfill) + NOT NULL enforcement prioritized
- [x] SPOT-MUTATION executed on ≥1 suspect — 3 mutations (A enforcement, B backfill value, C selectivity); tree reverted byte-clean (diff + git verified)
- [x] Mock-hides-bug — N/A (no mocks; real MySQL via knex against test-bed 3407)
- [x] Snapshot-triviality / tautology — none; no snapshots; assertions non-tautological
- [x] Mode-specific challenge (bugfix: would tests fail on pre-fix code?) — YES, proven by Mutation A reproducing the pre-migration RED
- [x] Error/negative-path audit — NULL-rejection (test 5/7) covered; backfill-preserves-existing gap flagged (W1)
- [x] Requirement coverage — BUG-892 traces to the test file (7 tests); all TRACEABILITY assertions encoded
- [x] Zero-tolerance domain check — migration touches users table only; not scheduler/auth/billing
- [x] User-story coverage — N/A (schema migration, no US)
- [x] Bird PASS verdicts — N/A (no UX-REVIEW)
- [x] Flake re-run — deterministic across runs (uid() collision-safe; per-test cleanup; --runInBand); mutation runs reproducible
- [x] Severity calibration — telly's lone INFO is correctly rated; no BLOCK-as-WARN mis-rating found
- [x] Each finding carries file/location + severity
- [x] Flag-and-refer emitted (REFER→telly for W1)
- [x] Rubric Coverage Map emitted — all dimensions marked
- [x] Output written
- [x] Scooter — not needed (harness/pattern self-evident from existing migration tests; no settled-question relitigation)

## Sign-off
Signed: Zoe — 2026-06-26T19:00:00Z
