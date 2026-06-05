# Zoe Review — juggler scheduler cache-always-stale fix — 2026-06-05

## Summary
Ernie's W1 confirmed: `new Date(_dbNow)` is a real fragility. W2 resolved: Telly added the grace-boundary test. Correctness challenge PASS: `SELECT NOW(3)` is guaranteed to return >= all `updated_at` values in the same run. One new finding: W1 is easy to fix inline.

## Telly Audit

### BLOCK Findings
None.

### WARN Findings
| # | Finding | Evidence | File | Remediation |
|---|---------|----------|------|-------------|
| ZW1 | `new Date(_dbNow)` parses MySQL datetime string as local time in V8. Ernie's W1 is confirmed real, not paranoia. With `dateStrings: true` MySQL2 returns `"2026-06-05 12:34:56.123"` (space, no TZ). `new Date("2026-06-05 12:34:56.123")` = implementation-defined = local time in V8. Cloud Run (UTC) = correct. Local dev (any other TZ) = wrong `generatedAt`, wrong staleness math. | runSchedule.js:1683 | One-liner fix: `new Date(String(_dbNow).replace(' ', 'T') + 'Z').toISOString()` — matches pattern used 3x elsewhere in same file |
| ZW2 | Grace-period test written but CANNOT be verified (migration failure). Pre-existing `20260605000000_add_task_status_enum_and_timestamps.js` fails with "Check constraint violated" in globalSetup — blocks ALL integration tests. Not caused by this change. | juggler-backend/src/db/migrations/20260605000000_add_task_status_enum_and_timestamps.js | Separate follow-up commit to fix migration (constraint added before backfill) |

### PASS Verifications
| # | Check | Status |
|---|-------|--------|
| 1 | Correctness of `SELECT NOW(3)` ordering | PASS — runs as LAST statement in transaction; all task `updated_at` writes precede it; MySQL NOW() advances per-statement not frozen to trx start; T_final ≥ all T_n guaranteed |
| 2 | No task writes after SELECT NOW(3) | PASS — lines 1684–1835 are only cache build + `user_config` write; trx ends line 1836 |
| 3 | `_nowRow[0][0].ts` access pattern correct | PASS — Knex raw() returns [rows, fields]; rows[0] = first row object; .ts = the field |
| 4 | Grace period logic direction correct | PASS — `max(updated_at) <= genTime + 10s` → cache fresh; 10s covers ≤10s MySQL clock lead over Node.js |
| 5 | Periodic nudge memory leak | PASS — `clearInterval(periodicNudgeId)` in cleanup return; no leak |
| 6 | Rate limit on nudge endpoint | PASS — `/nudge` uses `schedulerLimiter`; 5-min interval + visibility guard = ≤12 req/hr max per tab |
| 7 | Grace period test is genuinely new coverage | PASS — existing `'fresh cache returns quickly'` test only covers T_updated ≤ T_gen (normal case); new test covers T_updated > T_gen by 5s (clock-skew boundary case) — different branch |

## Status: ISSUES
_Signed: Zoe — 2026-06-05T00:00:00Z_
