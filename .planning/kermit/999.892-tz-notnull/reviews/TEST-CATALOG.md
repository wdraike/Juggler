# Test Catalog — 999.892-tz-notnull — bugfix — 2026-06-26

_Last updated: 2026-06-26 — mode: bugfix — depth: standard_

## Migration Tests

| Test File | Traceability Ref | Last Run | Result |
|-----------|------------------|----------|--------|
| `tests/migrations/20260626000000_users_timezone_not_null.test.js` | BUG-892 | 2026-06-26 | PASS (7/7 — post-migration; re-review after zoe WARN fix) |

### Test Inventory

| # | Test Name | Assertion | Pre-migration result | Post-migration target |
|---|-----------|-----------|---------------------|-----------------------|
| 1 | IS_NULLABLE = "NO" | `information_schema.COLUMNS.IS_NULLABLE = 'NO'` | FAIL — received 'YES' | PASS |
| 2 | COLUMN_DEFAULT = "America/New_York" | `COLUMN_DEFAULT = 'America/New_York'` | PASS (pre-existing) | PASS |
| 3 | COLLATION_NAME = "utf8mb4_unicode_ci" | `COLLATION_NAME = 'utf8mb4_unicode_ci'` | PASS (pre-existing) | PASS |
| 4 | Default fires on INSERT without timezone | `row.timezone = 'America/New_York'` | PASS (pre-existing default) | PASS |
| 5 | Explicit timezone=NULL INSERT rejected | `insertUserNullTimezone().rejects.toThrow()` | FAIL — resolved (nullable) | PASS |
| 6 | Backfill selectivity (down → NULL insert + Europe/London insert → up) | `after.timezone = 'America/New_York'` AND `afterPreserved.timezone = 'Europe/London'` | FAIL — migration not applied | PASS — Mutation C (remove .whereNull) now caught at line 365 |
| 7 | Reversibility (down IS_NULLABLE='YES'; up IS_NULLABLE='NO') | schema round-trip + NULL rejection | FAIL — migration not applied | PASS |

## Coverage Gaps

None for this leg — all 7 assertions from the TRACEABILITY.md requirements are encoded in tests.

## Branch Enumeration (Step 6b completeness floor — mutation not-wired)

Changes tested in the migration's `up()`:
| Guard / branch | Pinning test |
|----------------|-------------|
| `UPDATE … SET timezone='America/New_York' WHERE timezone IS NULL` (backfill) | Test 6 — down→NULL insert + Europe/London insert→up→assert NULL backfilled AND Europe/London unchanged (pins selectivity; Mutation C caught) |
| `ALTER TABLE users MODIFY timezone VARCHAR(100) NOT NULL DEFAULT '...'` | Tests 1+5 — IS_NULLABLE='NO'; NULL rejected |
| `COLLATE utf8mb4_unicode_ci` specified in ALTER | Test 3 — COLLATION_NAME assertion |
| DEFAULT preserved after NOT NULL enforcement | Tests 2+4 — DEFAULT assertions |

Changes tested in the migration's `down()`:
| Guard / branch | Pinning test |
|----------------|-------------|
| `ALTER TABLE users MODIFY timezone VARCHAR(100) NULL DEFAULT '...'` | Test 7 — IS_NULLABLE='YES' after down |
| NULL inserts accepted post-rollback | Tests 6+7 — explicit NULL insert succeeds after down |

## Production-shape input variants

| Shape | Coverage |
|-------|----------|
| INSERT omitting timezone column entirely | Test 4 |
| INSERT with explicit `timezone = NULL` (wire form) | Tests 5, 6, 7 |
| Pre-existing row with `timezone IS NULL` (backfill shape) | Test 6 (NULL row) |
| Pre-existing row with `timezone = 'Europe/London'` (selectivity shape) | Test 6 (preserved row — pins WHERE clause) |

## Missing Test Files

None — the single test file covers all required assertions.
