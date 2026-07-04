<!-- GENERATED from telly-REVIEW.json — do not edit; re-render via _gate/render-review.sh -->
# telly Review — sched-mcp-sdk-import-fix — bugfix — 2026-07-04

## Status: DONE

_RED confirmed pre-fix (9 failing, exact match to Oscar's 5/15+4/16); GREEN confirmed post-fix (31/31, 3x stable); no regression in broader mcp-* sweep._

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | ls TRACEABILITY.md; confirm --mode/--files present | present; TRACEABILITY.md rows BUG-1/BUG-2 already claim Fixed with test refs |
| Scope detect | git diff --stat on the 4 in-scope files | 2 source files (2-line + 4-line diffs), 2 test files (mock-path fix, comment-only otherwise) |
| GREEN baseline (current tree) | cd juggler-backend && npx jest tests/unit/mcp-server.test.js tests/unit/mcp-protocol.test.js | 2 suites passed, 31/31 tests passed, 0.61s |
| Revert source only | git stash push -m telly-temp-revert-source-only -- juggler-backend/src/mcp/server.js juggler-mcp/index.js | source reverted to bare '@modelcontextprotocol/sdk/server' import; test files untouched (left at fixed state) |
| RED repro | cd juggler-backend && npx jest tests/unit/mcp-server.test.js tests/unit/mcp-protocol.test.js | 9 failing total: mcp-server.test.js 5/15 failed, mcp-protocol.test.js 4/16 failed -- exact match to Oscar's reported pre-fix numbers |
| Restore working tree | git stash pop | source files restored to fixed subpath imports; verified via grep + git diff --stat |
| GREEN re-confirm | cd juggler-backend && npx jest tests/unit/mcp-server.test.js tests/unit/mcp-protocol.test.js | 2 suites passed, 31/31 tests passed |
| Determinism (3x repeat) | for i in 1 2 3; do npx jest tests/unit/mcp-server.test.js tests/unit/mcp-protocol.test.js; done | 31/31 passed all 3 runs, no flake |
| Direct-load smoke check | cd juggler-mcp && JUGGLER_TOKEN= JUGGLER_API_URL=http://localhost:5002 node -e "require('./index.js')" | LOAD_OK: no throw |
| SDK version parity check | cat node_modules/@modelcontextprotocol/sdk/package.json in juggler-backend and juggler-mcp | 1.29.0 and 1.27.1 respectively -- both installed SDKs confirmed to only expose McpServer/StdioServerTransport at explicit subpaths, matching intake-brief root-cause claim |
| Broader mcp-*.test.js sweep | npx jest on all 14 mcp-*.test.js files under tests/ (excluding the 2 unit/ files already covered) | 6 suites FAIL (all DB-dependent: ECONNREFUSED 127.0.0.1:3306 / TEST-FR-001), 8 suites PASS (unit or DB-mocked). All 118 failure occurrences grep to the same DB-unreachable root cause. Confirmed test-bed docker MySQL IS listening on 3407 but .env.test is absent in this worktree (per-dev gitignored setup file) -- DB_PORT fell back to default 3306. Infra gap, not a code regression. |
| Output written | wrote TEST-CATALOG.md + telly-REVIEW.json, rendered TEST-REVIEW.md via render-review.sh | done |

## Proof Checklist
- [x] Required inputs present (--mode, --files, TRACEABILITY.md) — all 4 files present; TRACEABILITY.md at leg dir
- [x] Mode confirmed bugfix; entry gate verified (failing test reproducing the bug exists) — independently reproduced RED (9 failing) by reverting only the 2 source files
- [x] Scope detected — 2 source + 2 test files, all read and diffed
- [x] TEST-CATALOG.md built — written to reviews/TEST-CATALOG.md
- [x] bugfix: regression test authored/confirmed FAILS pre-fix, PASSES post-fix — existing mcp-server.test.js + mcp-protocol.test.js: 9 failing pre-fix (matches 5/15+4/16), 31/31 post-fix -- no new file needed, BUG-2's own mock-path fix IS the authoring fix
- [x] All missing test files authored — none missing -- both required test files already existed and are already corrected
- [x] Suite(s) run; results captured — 31/31 targeted; 249/326 broader sweep (77 fails all DB-infra)
- [x] Coverage measured / thresholds applied — no --coverage flag passed; changed-line coverage confirmed qualitatively via RED/GREEN self-mutation (see below) rather than a numeric report
- [x] Changed-line / diff coverage measured — both changed import lines (server.js:5, index.js:9-10) proven covered -- reverting them alone flips 9 tests RED
- [x] Mutation score / not-wired recorded — Stryker not-wired in juggler-backend; manual self-mutation fallback used (source-revert RED/GREEN cycle) -- changed lines proven to kill the mutant
- [x] Flake/determinism: repeat-run + un-mocked non-determinism audit — 3x repeat run of targeted suite, 31/31 each; grepped for Date.now/Math.random -- only 2 Date.now() calls used solely for unique /tmp path naming, not asserted on, no flake risk
- [x] Test-data isolation / DB on test-bed — targeted suite (31/31) is pure unit, no DB; broader DB-dependent suites correctly target test-bed 3407 via env config, confirmed by ECONNREFUSED being to 3306 (missing .env.test), not 3308/3307 -- guard behavior is correct, just unconfigured in this worktree
- [x] Contract tests present for touched inter-service seams — MCP HTTP route is JWT/OAuth-authenticated (risk flag in intake brief) but this diff touches only the SDK import path, not auth logic; mcp-oauth-authorize-guard.test.js (existing contract/guard test for this seam) passes unaffected in the broader sweep
- [x] Security-regression tests from elmo REFER specs authored — n/a -- no SECURITY-REVIEW.md / elmo REFER->telly specs found in this leg's reviews dir
- [x] REFER accountability scanned — no BERT-LOG.md or other review file present in this leg's reviews dir yet (telly is step 0 of the bugfix pipeline) -- no REFER->telly items to action
- [x] Test-pyramid balance reported; slow tests flagged — targeted suite is 100% unit tier (31 tests, 2 files), runs in <1s total -- no E2E/integration in this narrow scope, not inverted; no test >5s
- [x] --setup-env n/a (not passed) — flag not passed; test-bed docker confirmed already up (3407 reachable) but .env.test wiring is a separate per-dev step out of this leg's scope
- [x] TRACEABILITY.md Test column filled — already filled by intake with the exact RED/GREEN numbers telly independently reproduced -- no discrepancy found, no edit needed
- [x] --re-review n/a (not passed) — flag not passed
- [x] Findings carry file:line + severity — see findings[]
- [x] Rubric Coverage Map emitted — see coverage_map in findings/summary below
- [x] TEST-CATALOG.md written to $REVIEW_DIR/ — written
- [x] telly-REVIEW.json written + TEST-REVIEW.md rendered via render-review.sh — this file + render step
- [x] Status line set — DONE

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | INFO | juggler-backend/src/mcp/server.js:5 | [regression-verification] The bugfix regression test (existing mcp-server.test.js + mcp-protocol.test.js) is independently confirmed RED pre-fix and GREEN post-fix, matching Oscar's reported numbers exactly. — evidence: Reverted only the 2 source files via git stash; ran targeted suite: 9 failing (5/15 + 4/16). Restored via git stash pop; ran again: 31/31 passing, stable across 3 repeat runs. (confidence high) | — |
| 2 | INFO | juggler-backend/tests/ | [coverage-gap] Broader mcp-*.test.js sweep (14 files) shows no regression from this fix; all failures are DB-infra (missing .env.test in this worktree), not code. — evidence: 6/14 suites fail, all 118 failure lines grep to ECONNREFUSED 127.0.0.1:3306 or [TEST-FR-001] DB unreachable; test-bed MySQL confirmed reachable on 3407 via nc, but .env.test (gitignored, per-dev) is absent so DB_PORT falls back to MySQL default 3306. 8/14 suites (unit + DB-mocked) pass outright. (confidence high) | Not required for this leg -- copy juggler-backend/.env.test.example to .env.test in this worktree if a full DB-backed regression run is later needed here. |
| 3 | INFO | juggler-backend/src/mcp/server.js | [e2e-depth] The live curl repro (HTTP 500 -> HTTP 200) cited in TRACEABILITY.md was a manual verification, not an automated E2E/smoke test. — evidence: No automated test in the repo drives the full HTTP /mcp JSON-RPC initialize round trip against a running server process; coverage here is at the unit (mocked-SDK) tier only. (confidence med) | Optional follow-up: add a lightweight smoke test that boots the express app and posts a real initialize request through the /mcp route, asserting HTTP 200 -- would catch a live-wiring regression the mocked unit suite cannot see. Not blocking for this mechanical import-path fix. |

## Sign-off
Signed: telly — 2026-07-04T17:15:30Z

