# WBS — sched-mcp-sdk-import-fix — bugfix — 2026-07-04

## Intent
MCP is completely broken in dev: POST /mcp returns HTTP 500 "McpServer is not a constructor".
Fix the two broken `@modelcontextprotocol/sdk` import sites (server.js, juggler-mcp/index.js) and
the two test files whose SDK-mock path resolution has a pre-existing duplicate-path bug that
silently swallowed the real failure. Business acceptance: POST /mcp returns a valid MCP protocol
response (not 500); juggler-mcp stdio client loads without throwing; the two previously-RED unit
test files go GREEN.

## Prior-art / contradiction discovered (material to this leg — see Determination Log)
Commit a7d7dd1 / gitlink-bump efb3a11ba (2026-07-03, "fix(ci): MCP SDK exports map ... for Linux
runner") made the OPPOSITE change to these same import sites, based on the claim "SDK v1.27
exports './server' not './server/mcp.js' — Node on Linux strictly enforces the exports map."
Verified this claim is FALSE: both @modelcontextprotocol/sdk 1.27.1 (juggler-mcp's locked
version) and 1.29.0 (juggler-backend's locked version) have IDENTICAL export shapes — bare
'./server' only exports {Server}; McpServer/StdioServerTransport are ONLY at the explicit
subpaths, in both versions (confirmed via direct `node -e require(...)` against both installed
SDKs). The CI failures that motivated a7d7dd1 were independently confirmed (via `gh run view
28665842291 --log-failed`) to be a DIFFERENT bug: `.github/workflows/ci-pipeline.yml`'s
"Install submodule dependencies" loop (lines 65-71) never includes `juggler/juggler-mcp`, so
`@modelcontextprotocol/sdk` is never installed there — the CI log shows "Cannot resolve module
'@modelcontextprotocol/sdk/server'" (module-not-found), not an export-shape error, and this
failure is PRESENT BOTH BEFORE AND AFTER a7d7dd1's change (i.e. that commit did not even fix the
CI failures it targeted). This leg's revert therefore does not regress CI — that CI gap was
already broken independent of import style. Filed as backlog 999.1113 (separate infra fix, out of
scope for this leg).

## Work Items
| ID | Task | Mode | Scope | Inputs required | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|-----------------|-----------|---------------------|--------|------|
| W1 | Fix juggler-backend/src/mcp/server.js:5 import — bare `@modelcontextprotocol/sdk/server` → `@modelcontextprotocol/sdk/server/mcp.js` | bugfix | juggler-backend | confirmed via node require test | none | createMcpServerForUser('x') does not throw; POST /mcp no longer 500s "not a constructor" | bert, telly, ernie | 1 |
| W2 | Fix juggler-mcp/index.js:9-10 imports — McpServer → `.../server/mcp.js`, StdioServerTransport → `.../server/stdio.js` | bugfix | juggler-mcp | confirmed via node require test | none | `node juggler-mcp/index.js` loads without throwing | bert, telly, ernie | 1 |
| W3 | Fix duplicate-path bug in mcp-server.test.js (SDK_MCP_PATH/SDK_STDIO_PATH both resolved identical bare path — second doMock clobbers first) so mocks target the corrected subpaths | bugfix | juggler-backend tests | test file read + CI log evidence | W1, W2 (mocked paths must match corrected source imports) | mcp-server.test.js: 15/15 tests pass (was 5 failing) | telly, zoe | 2 |
| W4 | Same fix in mcp-protocol.test.js | bugfix | juggler-backend tests | same | W1, W2 | mcp-protocol.test.js: 16/16 tests pass (was 4 failing) | telly, zoe | 2 |

## Dependency Graph
W3 ← W1, W2 (mock paths must match corrected source import paths)
W4 ← W1, W2

## Dependency Determination Log
| Dep | Type | Source |
|-----|------|--------|
| W3,W4 ← W1,W2 | shared-module / correctness | derived — the test mocks target the exact resolved path the source require()s; fixing source first (or atomically) is required for the mocks to have a correct target to name |

## Waves
Wave 1: W1, W2 (independent — different files, no shared state)
Wave 2: W3, W4 (independent of each other — different files — but both depend on Wave 1)

## Determination Log — scope-state verification
- "juggler-backend/src/mcp/transport.js:10 (StreamableHTTPServerTransport) does NOT need fixing" — VERIFIED, not assumed: `require('@modelcontextprotocol/sdk/server/streamableHttp.js')` resolves correctly against 1.29.0 (direct node test), exports {StreamableHTTPServerTransport}. No WBS item for this file.
- Live curl re-verification: pre-fix confirmed HTTP 500 "McpServer is not a constructor"; post-fix (applied directly to the nodemon-watched main-tree file for live verification, since the leg worktree's branch cannot be locally merged into "main" while the main tree holds that branch checked out elsewhere) confirmed HTTP 200 with a valid MCP `initialize` response.

## Human Approval — WARN advance (2026-07-04)
David approved advancing past Oscar's WARN verdict (3 non-blocking architectural findings from
cookie — ARCH-W1/W2/W3, all pre-existing sibling-package SDK-version-drift/test-boundary debt,
none touching correctness of this fix). Disposition:
- ARCH-W1: amended into existing backlog 999.1113 (added cookie's `test-bed/scripts/run-suite.sh`
  pool-path detail — the CI Gate's actual juggler-test execution path also never installs
  juggler-mcp's deps, a second occurrence of the same gap).
- ARCH-W2 + ARCH-W3: batched into new backlog item 999.1118 (same root theme: SDK version drift
  between juggler-backend/juggler-mcp + juggler-mcp having no test suite of its own, causing
  juggler-backend's tests to reach across the package boundary).
Leg cleared to commit + advance per this recorded approval.
