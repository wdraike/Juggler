# Telly Review — mcp-terminal-schedule-guard — bugfix — 2026-06-26 (R4b fix-loop 2026-06-26)

## Status: DONE

## Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode bugfix, TRACEABILITY.md at .planning/kermit/999.895/TRACEABILITY.md | present |
| Scope detect | read src/mcp/tools/tasks.js L385-426 (set_task_status), L238-383 (update_task); src/slices/task/application/commands/UpdateTaskStatus.js L147-160; src/lib/rolling-anchor.js; tests/helpers/mcp.js | 4 source files in scope |
| DB constraint audit | read 20260527213906_add_terminal_scheduled_at_constraint.js | Discovered `chk_task_instances_terminal_scheduled` — enforces terminal requires scheduled_at at DB level independently of the app guard |
| Helper path fix | corrected tests/helpers/mcp.js:22 `require('../src/...')` → `require('../../src/...')` | Path was broken; `tests/scheduler/fixedRecurringGap.test.js:22` had commented on this. Fixed so helper can be used. |
| Test authored | Write tests/mcp-terminal-schedule-guard.test.js | 13 integration tests; R1/R5 (4 tests) RED; R2/R3/R4/R5b (9 tests) GREEN |
| Suite run (pre-fix RED proof) | npx jest tests/mcp-terminal-schedule-guard.test.js --runInBand --forceExit | 4 failed (RED), 9 passed — confirmed RED |
| R4b added (zoe fix-loop) | Added ROLLING_UNSC_INST_ID constant + seed (scheduled_at=null) + R4b describe block | Seeds unscheduled rolling instance; exercises masterId→isRollingMaster branch that R4 skipped |
| Mutation-verify R4b (neuter) | Removed masterId→isRollingMaster block from tasks.js:79-82; ran suite | R4b RED: text matched /without a scheduled time/ (app guard fired, exemption gone) |
| Mutation-verify R4b (restore) | Restored exemption block; `git diff src/mcp/tools/tasks.js` | Shows only bert's guard, no telly/mutation residue |
| Suite run (14 tests, all green) | npx jest tests/mcp-terminal-schedule-guard.test.js --runInBand --forceExit | 14 passed, 0 failed |
| Traceability updated | filled Test column in .planning/kermit/999.895/TRACEABILITY.md | done |
| TEST-CATALOG.md | Write .planning/kermit/999.895/reviews/TEST-CATALOG.md | done |
| Output written | Write TEST-REVIEW.md | done |

## Proof Checklist

- [x] Required inputs present (--mode bugfix, TRACEABILITY.md)
- [x] Mode confirmed as bugfix; entry gate: regression test that FAILS pre-fix authored
- [x] Scope detected — 4 source files (set_task_status, update_task, UpdateTaskStatus.js, rolling-anchor.js)
- [x] TEST-CATALOG.md built with all source files, test status, and infrastructure fix note
- [x] For mode=bugfix: regression test authored that FAILS pre-fix (4 RED) — R1a/R1b/R1c (set_task_status isError) + R5a (update_task isError)
- [x] Guards-against-false-positive tests pass on current code (R2/R3/R4/R5b/R4b GREEN)
- [x] Suite run; results captured — 4 failed, 9 passed (pre-fix); 14 passed (post-fix with R4b)
- [x] Coverage measured: n/a (--coverage not passed); changed-line coverage: ALL changed lines in scope (set_task_status, update_task) touched by the regression tests
- [x] Changed-line diff coverage: the lines being fixed (missing guard in set_task_status and update_task) are directly exercised by R1/R5 tests
- [x] Mutation: not-wired (recorded in TEST-CATALOG.md); per-pin self-mutation: R1/R5 tests are live because they fail on current code; R4b mutation-verified (neutered exemption block → R4b RED; restored → all 14 green); R2/R3/R4/R5b would fail if success path removed
- [x] R4b zoe-fix-loop: added ROLLING_UNSC_INST_ID (scheduled_at=null); R4b exercises masterId→isRollingMaster branch (willBeScheduled=false path); mutation-verified RED under neutered exemption; TEST-CATALOG.md corrected to note R4 does NOT reach masterId→isRollingMaster branch (it exits at willBeScheduled=true)
- [x] Flake/determinism: static IDs + USER_ID isolation; no Date.now()/Math.random in test file; deterministic seed
- [x] Test-data isolation: unique USER_ID 'mcp-guard-895-test'; cleanup in afterAll (instances then masters then user); DB on test-bed 3407
- [x] Contract tests: no inter-service seam touched (MCP tool path internal to juggler-backend)
- [x] Security-regression tests: no REFER→telly specs in SECURITY-REVIEW.md for this leg
- [x] Test-pyramid: integration tests only (DB-backed); no E2E; appropriate for MCP tool DB write path
- [x] TRACEABILITY.md Test column filled: yes (R1a/R1b/R1c/R5a RED; R2/R3/R4/R5b GREEN noted)
- [x] Findings carry file:line + severity (see below)
- [x] Flag-and-refer: see findings
- [x] Rubric Coverage Map emitted below
- [x] TEST-CATALOG.md written to .planning/kermit/999.895/reviews/
- [x] TEST-REVIEW.md written to .planning/kermit/999.895/reviews/
- [x] Status set DONE (regression tests authored and confirmed RED on pre-fix code)
- [x] Scooter not consulted (no project knowledge gap; requirements clear from traceability + source)

## Findings

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | BLOCK | src/mcp/tools/tasks.js:393-426 (set_task_status) | No terminal-requires-schedule guard. Handler writes terminal status with null scheduled_at → DB constraint fires unhandled (raw MySQL error to caller). MUST add guard before DB write, exempt rolling instances (check isRollingMaster via master_id lookup), mirror UpdateTaskStatus.js:147-160. | bert to implement guard |
| 2 | BLOCK | src/mcp/tools/tasks.js:246-382 (update_task) | No terminal-requires-schedule guard when `status` is in terminal set and task has null scheduled_at and call provides no date/scheduledAt. DB constraint fires unhandled. | bert to implement guard (allow when `date` or `scheduledAt` provided in same call) |
| 3 | INFO | tests/helpers/mcp.js:22 | Broken require path `'../src/mcp/tools/tasks'` resolved to non-existent `tests/src/...`. Fixed to `'../../src/mcp/tools/tasks'`. Pre-existing; tests/scheduler/fixedRecurringGap.test.js:22 documented this breakage. | Fixed in this leg |
| 4 | INFO | src/mcp/tools/tasks.js — DB constraint interplay | DB-level `chk_task_instances_terminal_scheduled` constraint enforces terminal-requires-schedule independently. App-level guard (to be added) must fire BEFORE the DB write, otherwise error surfaces as raw MySQL throw. Rolling instances with scheduled_at set succeed. Unscheduled rolling instances: DB constraint still blocks (app guard exempt doesn't help if scheduled_at null). Bert's fix should address whether rolling instances get scheduled_at = NOW() set automatically. | REFER→bert (design decision for unscheduled rolling instances) |

## Coverage Map

| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Tier Coverage | covered | 13 integration tests against real test-bed DB 3407; no unit or E2E | MCP tool path requires DB; integration tier appropriate |
| Assertion Quality | covered | Every RED test has a concrete assertion (`result.isError === true` + text match + DB state check); every GREEN test asserts actual DB state not just return value | No tautological assertions |
| Edge Case Coverage | partial | Covers 3 terminal statuses (done/skip/cancel) for R1; covers date-in-call exemption for R5. Does NOT cover update_task with scheduledAt (ISO UTC) in call (analogous to date) — documented in TEST-CATALOG.md | Could add R5c for scheduledAt case |
| Determinism | covered | Static task IDs, static USER_ID, no Math.random/Date.now in test; DB is test-bed tmpfs | No time-dependent assertions |
| Test Maintainability | covered | Static IDs with meaningful names; cleanup in afterAll; `baseTask()` factory; descriptive describe/it names; full comments linking to spec | |
| E2E Depth | gap | No E2E tests for MCP tool path; out of scope for this bugfix leg | MCP clients are external; E2E would require ClimbRS integration |
| Performance Testing | gap | No performance assertions; not applicable for this bugfix | |
| Coverage Metrics | partial | Changed lines (set_task_status, update_task) exercised; --coverage not run; mutation not-wired; per-pin self-mutation verified (R1/R5 RED = live assertions) | |
| Security Testing | gap | No REFER→telly from elmo for this leg; out of scope | Auth seam not touched by this leg |

## Sign-off

Signed: Telly — 2026-06-26T21:19:19Z (R4b fix-loop: 2026-06-26T21:45:00Z)
