# Oscar Review — 2026-06-05 (task.controller regression fix)

## Verdict: WARN

## Summary
Restores two module-level definitions (logger, db) dropped by commit 7d3d40b that broke createTask + getSchedulePlacements. Fix verified live (POST /api/tasks 201, GET /placements 200). WARN: integration tests that would catch this exist but can't run (test-bed migration broken).

## Agent Findings (inline review — context-constrained)

### Ernie (code quality) — PASS
- Both additions restore the exact pattern used elsewhere: `createLogger('@raike/lib-logger')` matches impersonation.controller.js; `const db = require('../db')` is the line 7d3d40b removed (present and working March 1 → June 2).
- require() is cached → module-level `db` is the same instance `getDb()` returns. No double-connection.
- Module loads clean (24 exports). No new logic, no behavior change beyond restoring defined references.
- No circular-dependency risk: identical line ran for 3 months without issue.

### Telly (tests) — WARN
- Controller integration tests EXIST (taskCrudIntegration.test.js, taskPipeline.test.js, runScheduleIntegration.test.js) but self-skip because test-bed globalSetup migration fails (20260605000000). That skip is why a 3-day ReferenceError regression shipped uncaught.
- No new test added in this fix (context-constrained emergency fix). Regression-guard test deferred to backlog.

## Completeness
| Check | Result |
|-------|--------|
| Module loads / syntax | PASS |
| Fix verified live (201/200) | PASS |
| Tests exist for changed code | PASS (exist) |
| Tests passing | WARN (suite skips — test-bed migration broken) |
| Docs updated | N/A (regression fix, no API change) |
| Security review | N/A (no auth/payment logic) |

## Backlog Items
| # | Finding | Severity |
|---|---------|----------|
| 1 | test-bed migration 20260605000000_add_task_status_enum_and_timestamps fails in globalSetup → ALL juggler integration tests self-skip → regressions ship uncaught (this 3-day bug) | HIGH |
| 2 | Orphaned recurring instances reference missing template 019d5dfa-... — spams [rowToTask] warnings, possible data-integrity issue | MED |
| 3 | Audit other controllers for same 7d3d40b breakage (bare `db`/`logger` refs after getDb() refactor) | MED |
| 4 | Add regression-guard test: require task.controller + assert createTask returns 201 (would catch missing module-level refs) | MED |

## Kermit Report
Verdict: WARN
Completeness gaps: test suite unrunnable (pre-existing test-bed migration break)
Backlog items: 4
Ready to commit: yes

## Status: ISSUES (WARN — safe to commit, app restored)
_Signed: Oscar — 2026-06-05T00:00:00Z_
