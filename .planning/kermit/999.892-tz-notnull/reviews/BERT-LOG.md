# BERT-LOG — 999.892-tz-notnull — bugfix — 2026-06-26

## Status: DONE

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | --mode bugfix, inline Oscar spec as findings source | present |
| Read context | read CLAUDE.md (juggler), existing migrations for style, test file | done |
| Parse findings | 2 work items: W1 migration, W2 CS1–CS4 call-site fixes | done |
| Apply W1 | Created src/db/migrations/20260626000000_users_timezone_not_null.js | done |
| Apply W2-CS1 | deriveSchedulePlacements.js:48 — row guard stripped of column-null check | done |
| Apply W2-CS2 | src/mcp/tools/schedule.js:14 — getUserTimezone guard updated | done |
| Apply W2-CS3 | src/mcp/tools/tasks.js:91 — getUserTimezone guard updated | done |
| Apply W2-CS4 | src/mcp/tools/data.js:15 — getUserTimezone guard updated | done |
| Adjacent-regression | resolveTimezone (module-internal, 1 caller); getUserTimezone (closure, callers all within same register*Tools scope); KnexConfigRepository.getUserTimezone — untouched (A1 contract) | no external callers; no regressions |
| Self-verify parse | node --check on all 5 mutated files | all PARSE OK |
| Self-verify lint | npx eslint on all 5 mutated files | 0 issues |
| Self-verify test | npx jest tests/migrations/20260626000000_users_timezone_not_null.test.js --runInBand --forceExit | 7/7 PASS |
| Output written | BERT-LOG.md + bert-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present
- [x] Mode confirmed: bugfix
- [x] All BLOCK findings addressed (fixed, disputed, or referred with reason)
- [x] No unapproved fallbacks introduced (row-absence / DB-error guards preserved; column-null guards removed)
- [x] No tests authored by bert (telly wrote the test; bert only ran it)
- [x] No docs authored by bert (no docs required)
- [x] Disputed findings referred back to reviewer — none disputed
- [x] Design-level fixes referred up — not applicable
- [x] Blast-radius bound respected (5 files, ~10 changed lines total)
- [x] Adjacent-regression checked — resolveTimezone and getUserTimezone are all module-internal closures; KnexConfigRepository.getUserTimezone untouched
- [x] Findings re-anchored after multi-fix edits (each fix was in a different file; no line-number drift)
- [x] Fix self-verified: all 5 mutated files parse cleanly; 7/7 migration tests GREEN
- [x] BERT-LOG.md written
- [x] Changed files listed
- [x] No REFER lines (no tests or docs needed beyond what telly already wrote)
- [x] Status: DONE

## Findings Actioned
| # | Severity | File:Line | Description | Fix Applied | Result |
|---|----------|-----------|-------------|-------------|--------|
| W1 | BLOCK | src/db/migrations/20260626000000_users_timezone_not_null.js (new) | Migration missing — users.timezone is nullable | Created migration: backfill NULLs then ALTER MODIFY NOT NULL, with correct collation; down() reverts to nullable | Fixed — 7/7 test assertions GREEN |
| W2-CS1 | WARN | src/scheduler/deriveSchedulePlacements.js:48 | `if (row && row.timezone)` — column-null guard redundant after NOT NULL migration | Changed to `if (row)` — DB-error guard (try/catch) and row-absence guard (`return DEFAULT_TIMEZONE`) preserved | Fixed |
| W2-CS2 | WARN | src/mcp/tools/schedule.js:14 | `(user && user.timezone) \|\| 'America/New_York'` — column-null fallback redundant | Changed to `user ? user.timezone : 'America/New_York'` | Fixed |
| W2-CS3 | WARN | src/mcp/tools/tasks.js:91 | Same pattern as CS2 | Changed to `user ? user.timezone : 'America/New_York'` | Fixed |
| W2-CS4 | WARN | src/mcp/tools/data.js:15 | Same pattern as CS2 | Changed to `user ? user.timezone : 'America/New_York'` | Fixed |

## Refers Emitted
None.

Note: `src/slices/user-config/adapters/KnexConfigRepository.js` `getUserTimezone` — deliberately left untouched per A1 contract; it returns null intentionally.

## Changed Files
- `/Users/david/Documents/Software Dev/raike-and-sons/.worktrees/juggler-sweep/juggler-backend/src/db/migrations/20260626000000_users_timezone_not_null.js` (new — migration: backfill + NOT NULL ALTER)
- `/Users/david/Documents/Software Dev/raike-and-sons/.worktrees/juggler-sweep/juggler-backend/src/scheduler/deriveSchedulePlacements.js` (line 48 — stripped column-null guard in resolveTimezone)
- `/Users/david/Documents/Software Dev/raike-and-sons/.worktrees/juggler-sweep/juggler-backend/src/mcp/tools/schedule.js` (line 14 — getUserTimezone guard updated)
- `/Users/david/Documents/Software Dev/raike-and-sons/.worktrees/juggler-sweep/juggler-backend/src/mcp/tools/tasks.js` (line 91 — getUserTimezone guard updated)
- `/Users/david/Documents/Software Dev/raike-and-sons/.worktrees/juggler-sweep/juggler-backend/src/mcp/tools/data.js` (line 15 — getUserTimezone guard updated)

## Test Result
```
PASS tests/migrations/20260626000000_users_timezone_not_null.test.js
  Schema: users.timezone after migrate.latest()
    ✓ 1. IS_NULLABLE = "NO" — column enforces NOT NULL (9 ms)
    ✓ 2. COLUMN_DEFAULT = "America/New_York" (6 ms)
    ✓ 3. COLLATION_NAME = "utf8mb4_unicode_ci" (6 ms)
  Default: INSERT without timezone column → "America/New_York"
    ✓ 4. Omitting timezone on INSERT yields timezone = "America/New_York" (18 ms)
  NOT NULL enforcement: INSERT timezone=NULL is rejected
    ✓ 5. Explicit timezone=NULL INSERT throws; row is not persisted (11 ms)
  Backfill proof: pre-existing NULL rows are backfilled by migrate.up()
    ✓ 6. migrate.down() → NULL insert → migrate.up() → row.timezone = "America/New_York" (557 ms)
  Reversibility: migrate.down() restores nullable; migrate.up() re-enforces NOT NULL
    ✓ 7. down()→IS_NULLABLE="YES"+NULL insert succeeds; up()→IS_NULLABLE="NO"+NULL rejected (494 ms)

Tests: 7 passed, 7 total
```

## Sign-off
Signed: Bert — 2026-06-26T00:00:00Z
