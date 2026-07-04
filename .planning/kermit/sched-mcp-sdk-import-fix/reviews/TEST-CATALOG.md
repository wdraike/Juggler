# Test Catalog — sched-mcp-sdk-import-fix

_Last updated: 2026-07-04 13:20 — mode: bugfix_

## Unit Tests

| Module | Test File | Requirement(s) | Story | Traceability Ref | Last Run | Result | Line % | Branch % |
|--------|-----------|----------------|-------|-------------------|----------|--------|--------|----------|
| juggler-backend/src/mcp/server.js (createMcpServerForUser + tool registration) | juggler-backend/tests/unit/mcp-server.test.js | R17.1, R17.2 | MCP tool exposure | BUG-1, BUG-2 | 2026-07-04 | PASS (15/15) | n/a (targeted run, no --coverage) | n/a |
| juggler-mcp/index.js (stdio server, McpServer + StdioServerTransport wiring) | juggler-backend/tests/unit/mcp-protocol.test.js | R17.1, R17.3 | MCP stdio protocol | BUG-1, BUG-2 | 2026-07-04 | PASS (16/16) | n/a | n/a |

Combined: **31/31 passing** post-fix (`cd juggler-backend && npx jest tests/unit/mcp-server.test.js tests/unit/mcp-protocol.test.js`).

## Regression Verification (bugfix mode — RED then GREEN)

| Step | Source state | Command | Result |
|------|--------------|---------|--------|
| RED repro | Reverted `juggler-backend/src/mcp/server.js` + `juggler-mcp/index.js` to bare `@modelcontextprotocol/sdk/server` import (via `git stash push -m ... -- <2 source files>`; test files left at the FIXED state) | `cd juggler-backend && npx jest tests/unit/mcp-server.test.js tests/unit/mcp-protocol.test.js` | **9 failing** — mcp-server.test.js 5/15 failed, mcp-protocol.test.js 4/16 failed. Matches Oscar's reported pre-fix numbers exactly. Failures: registered-tool-registry assertions (`expect(registeredNames.length).toBe(20)` → received 0), `schema` reads on undefined tool entries, and unresolved tool names — the mocked `server/mcp.js`/`server/stdio.js` subpaths are never hit when the source `require()`s the bare path. |
| Restore | `git stash pop` | — | Source files confirmed restored to fixed state (`grep` shows `.../server/mcp.js` and `.../server/stdio.js` in both files) |
| GREEN confirm | Current working tree (fixed source + fixed test mock-path plumbing) | same command | **31/31 passing** (2 suites, 0 failures) |
| GREEN repeat x3 | same | same command, 3x | 31/31 passing each run — deterministic, no flake |

No brand-new regression-test FILE was required — BUG-2 (the test's own `SDK_MCP_PATH`/`SDK_STDIO_PATH` mock-clobber bug, both computed via the identical `require.resolve('@modelcontextprotocol/sdk/server', ...)` so the second `jest.doMock` silently clobbered the first) lived inside `mcp-server.test.js` / `mcp-protocol.test.js` themselves, and both files are already corrected on disk in this working tree (confirmed via `git diff` — each now resolves its own distinct subpath: `server/mcp.js` vs `server/stdio.js`). The existing suite, now fixed, IS the regression test for both BUG-1 and BUG-2.

## Direct-load smoke check (juggler-mcp/index.js)

| Check | Command | Result |
|-------|---------|--------|
| No-throw on require | `cd juggler-mcp && JUGGLER_TOKEN= JUGGLER_API_URL=http://localhost:5002 node -e "require('./index.js')"` | `LOAD_OK: no throw` — confirms `McpServer`/`StdioServerTransport` resolve to real constructors against the ACTUAL installed SDK (1.27.1 in `juggler-mcp/node_modules`), not just the jest-mocked path. |
| SDK version parity | `cat node_modules/@modelcontextprotocol/sdk/package.json` in both juggler-backend (1.29.0) and juggler-mcp (1.27.1) | Both installed SDK versions confirmed to expose `McpServer`/`StdioServerTransport` only at the explicit `./server/mcp.js` / `./server/stdio.js` subpaths — matches the intake brief's root-cause claim of "confirmed identical in both 1.27.1 and 1.29.0". |

## Broader mcp-*.test.js sweep (regression check — no DB up required for a subset)

| Test File | DB-dependent? | Result | Notes |
|-----------|---------------|--------|-------|
| tests/mcp-create-task-boundary.test.js | yes (real DB via `assertDbAvailable`/knex) | FAIL — all failures `ECONNREFUSED 127.0.0.1:3306` | INFRA — `.env.test` absent in this worktree (gitignored, per-dev; CLAUDE.md requires copying `.env.test.example` first), so `DB_PORT` falls back to MySQL default 3306 instead of test-bed 3407, even though the test-bed docker MySQL is confirmed reachable on port 3407 (`nc -z 127.0.0.1 3407` succeeds). Unrelated to this leg's diff. |
| tests/mcpOverdueRegression.integration.test.js | yes | FAIL — `[TEST-FR-001]` DB unreachable | INFRA, same root cause as above |
| tests/mcp-task-config.test.js | yes | FAIL — `ECONNREFUSED 127.0.0.1:3306` | INFRA, same root cause |
| tests/mcp-locked-path.test.js | yes | FAIL — `ECONNREFUSED 127.0.0.1:3306` | INFRA, same root cause |
| tests/mcp-terminal-schedule-guard.test.js | yes | FAIL — `[TEST-FR-001]` DB unreachable | INFRA, same root cause |
| tests/mcp.test.js | yes (`helpers/testDb` + `assertDbAvailable`) | FAIL — `[TEST-FR-001]` DB unreachable | INFRA, same root cause |
| tests/mcp-update-config.characterization.test.js | no (DB fully `jest.mock`'d) | PASS | unaffected |
| tests/mcp-oauth-authorize-guard.test.js | no (in-process express app, no DB import) | PASS | unaffected |
| tests/mcp-update-task.test.js | mocked | PASS | unaffected |
| tests/mcp-create-tasks.test.js | mocked | PASS | unaffected |
| tests/mcp-list-tasks.test.js | mocked | PASS | unaffected |
| tests/mcp-cross-user-isolation.test.js | mocked | PASS | unaffected |
| tests/mcp-http-calsync-divergence.test.js | mocked | PASS | unaffected |
| tests/mcp-transport.test.js | mocked | PASS | unaffected |

Combined run: 6 suites failed / 8 suites passed / 326 tests (77 failed, 249 passed). All 118 failure-line occurrences grep to `ECONNREFUSED 127.0.0.1:3306` or `[TEST-FR-001] ... DB unreachable` — **zero failures attributable to the SDK import-path change.** The 6 DB-dependent suites are blocked purely on this worktree's missing `.env.test` (a known per-dev setup step, not a regression), not by this fix. No regression introduced by the leg.

## Coverage Gaps

None on the leg's changed lines. Both changed import lines (`juggler-backend/src/mcp/server.js:5` and `juggler-mcp/index.js:9-10`) are directly exercised — the fixed test files' `jest.doMock` targets resolve to those exact subpaths and the suite fails loudly (9 failures) when the import reverts to the bare path, proving the changed lines are covered by an assertion that would catch a regression (the RED/GREEN self-mutation above serves as the mutation-testing fallback; Stryker is `not-wired` in juggler-backend).

## Missing Test Files

None — the two files this bugfix required (`mcp-server.test.js`, `mcp-protocol.test.js`) already existed and are already corrected in the working tree; no new test file was needed.
