<!-- GENERATED from ernie-REVIEW.json — do not edit; re-render via _gate/render-review.sh -->
# ernie Review — sched-mcp-sdk-import-fix — bugfix — 2026-07-04

## Status: DONE

_Import-path fix is CORRECT and independently verified. a7d7dd1's 'Linux-strict exports map' premise is factually false; reverting to subpaths is right. Test-mock clobber fix is sound. No BLOCK/WARN; 3 INFO._

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | confirm --mode bugfix + 4 files; read WBS/INTAKE-BRIEF (repro captured) | present; bugfix gate satisfied — RED repro documented (POST /mcp HTTP 500 'McpServer is not a constructor'; telly 9 failing pre-fix) |
| Scope detect | git diff HEAD on the 4 files + git show a7d7dd1 | 4 files changed (+session.json); diff is import-line + comment-only. a7d7dd1 also fixed unifiedSchedule->unifiedScheduleV2 in 2 OTHER test files — correctly NOT reverted here |
| SDK exports — juggler-backend (1.29.0) | node -e require('@modelcontextprotocol/sdk/server').keys etc. from juggler-backend/ | bare ./server = [Server]; ./server/mcp.js = [McpServer,ResourceTemplate]; ./server/stdio.js = [StdioServerTransport] |
| SDK exports — juggler-mcp (1.27.1) | same node require probes from juggler-mcp/ | IDENTICAL shape: bare ./server = [Server]; McpServer/StdioServerTransport ONLY at subpaths. No version difference |
| Exports-map root-cause | dump package.json .exports for both versions | Both carry wildcard './*': {'require':'./dist/cjs/*'} — this resolves ./server/mcp.js + ./server/stdio.js. Node enforces exports maps identically on ALL platforms; no 'Linux-strict' mode exists. a7d7dd1's premise DISPROVEN |
| In-repo corroboration | grep all non-node_modules SDK requires | transport.js:10 already require()s '.../server/streamableHttp.js' (a subpath, via the same wildcard), was NEVER touched by a7d7dd1, works — direct proof subpath resolution is fine |
| a7d7dd1 breakage mechanism | trace destructuring under bare path | const {McpServer}=require('.../server') => undefined (bare only exports Server); new undefined() throws 'is not a constructor' — EXACTLY the dev symptom. a7d7dd1 INTRODUCED the runtime bug this leg fixes |
| Test-mock clobber trace | read both test files' doMock blocks; reason jest module-mock-by-resolved-path | PRE-fix: SDK_MCP_PATH & SDK_STDIO_PATH both require.resolve('.../server') => IDENTICAL string => 2nd jest.doMock clobbers 1st (jest keys registry by resolved path) => McpServer mock lost. POST-fix: distinct subpaths => both mocks survive AND match corrected source requires. Fix is sound |
| Fallout grep | grep whole codebase for bare '@modelcontextprotocol/sdk/server' consumers expecting {Server} | NONE. No file depends on the bare-path {McpServer/StdioServerTransport} behavior being reverted; nothing breaks |
| Logic-change scan | read full diff hunks | import lines + explanatory comments only; zero business-logic/behavior changes smuggled in |
| Scooter consult | Skill(scooter) --ask re prior MCP import ruling --domain juggler | No settled decision mandates the bare path; only artifact asserting it is a7d7dd1 (under revert), already recorded verified-false. No relitigation |

## Proof Checklist
- [x] Required inputs present — --mode bugfix, 4 files resolved; WBS + INTAKE-BRIEF present
- [x] Scope confirmed non-empty — 4 files, printed in proof-of-work; git diff HEAD reviewed line-by-line
- [x] Mode gate checked (bugfix=failing test/repro) — RED repro captured: HTTP 500 'McpServer is not a constructor' + telly 9 failing pre-fix
- [x] Complexity scan — import-line-only diff; no size/nesting change (server.js unchanged except L5; index.js L9-10)
- [x] Error handling scan — no error-path code touched; import correctness restores McpServer constructor so /mcp no longer 500s
- [x] Floating-promise / forEach(async) / Promise.all scan — no async control-flow in diff; N/A
- [x] Error-cause-preservation / no silent success-default — no catch blocks in diff; test mock's try/catch faithfully replicates SDK createToolError wrapping (intentional, documented)
- [x] Input validation scan — no entry-point/param handling in diff; import lines only
- [x] Unapproved-fallback scan — no \|\|/?? introduced; the corrected imports REMOVE the accidental undefined-yielding bare path
- [x] Numeric precision/boundary scan — no numeric/index/parseInt code in diff; N/A
- [x] ReDoS scan — no regex in diff; N/A
- [x] Date/TZ & DB-clock scan — no date/timestamp code in diff; N/A
- [x] Resource management scan — no handle/connection/timer code in diff; N/A
- [x] DB-transaction/atomicity scan — no DB writes in diff; N/A
- [x] Concurrency safety scan — module-level requires are load-time constants, not per-request mutable state; jest.doMock registry keyed per resolved path — no shared-state clobber post-fix
- [x] Idempotency-under-retry scan — no Cloud Tasks/webhook consumer in diff; N/A
- [x] Grep matches triaged not counted — every SDK require read in context; transport.js subpath + tests' streamableHttp mocks confirmed as consistent, not fallout
- [x] Type safety scan — no casts/ts-ignore; destructuring targets now match actual module exports (McpServer defined, not undefined)
- [x] React logic scan — skipped — no .jsx/.tsx in scope (backend + node MCP + tests only)
- [x] Observability scan — no console.log added in diff
- [x] Dead code scan — no commented-out code; added comments are explanatory doc of the SDK subpath split
- [x] Flag-and-refer lines emitted — INFO-2 REFER->cookie (CI workflow install gap); INFO-3 REFER->telly (coverage nuance)
- [x] All findings carry file:line + BLOCK/WARN/INFO — 3 INFO findings, each file:line
- [x] No missing-test findings filed — coverage nuance filed as INFO REFER->telly, not a missing-test finding
- [x] No security findings reviewed in depth — no security surface in an import-path fix; /mcp auth-proxy untouched by diff
- [x] Requirements Documentation Standards compliance — bugfix leg; BUG-1/BUG-2 each have RED (unhappy repro) + GREEN happy path in TRACEABILITY/TEST-CATALOG
- [x] Prior knowledge consulted via Scooter — Scooter consult recorded; confirmed no settled decision relitigated
- [x] Knowledge changes reported to Scooter — n/a — leg corrects a misdiagnosis, does not change a standard/requirement; no INBOX notice warranted
- [x] Rubric Coverage Map emitted — 9/9 dimensions considered — see coverage_map
- [x] JSON written + md rendered — ernie-REVIEW.json written; CODE-REVIEW.md via render-review.sh
- [x] Status line set — DONE — no unresolved BLOCK

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | INFO | juggler-backend/tests/unit/mcp-server.test.js:27 | [readability] Added comment states 'SDK 1.29.0 split McpServer and StdioServerTransport into separate subpath files' — the framing implies a 1.29.0-introduced change, but the layout is IDENTICAL in 1.27.1 (juggler-mcp's locked version, which is what these two test files actually resolve+mock via paths:[MCP_DIR]). — evidence: Direct node require against both installed copies: bare ./server = {Server} and McpServer/StdioServerTransport live only at ./server/mcp.js + ./server/stdio.js in BOTH 1.27.1 and 1.29.0. There was no 1.29.0 'split' — both versions share the shape; the resolution is driven by the './*' exports-map wildcard present in both. Same comment appears in mcp-protocol.test.js:199. (confidence high) | Optional: reword to 'The SDK exports map exposes bare ./server as {Server} only; McpServer/StdioServerTransport live at ./server/mcp.js and ./server/stdio.js (both 1.27.1 and 1.29.0).' Harmless to behavior — a future-reader-accuracy nit only. |
| 2 | INFO | juggler-mcp/index.js:9 | [error-handling] This diff fixes the DEV/runtime 500 and the unit-test mock-clobber bug, but does NOT address the separate CI-gate failure (workflow's submodule-install loop never installs juggler-mcp's node_modules -> 'Cannot resolve module @modelcontextprotocol/sdk'). That module-not-found failure is orthogonal and persists after this leg. — evidence: WBS-sched-mcp-sdk-import-fix.md:22-23 records the CI log as module-not-found (not export-shape); confirmed both before and after a7d7dd1. The 4 files in this leg cannot fix a .github workflow install gap. REFER->cookie (CI/infra config ownership). (confidence high) | Track the CI juggler-mcp dependency-install gap as its own item (already noted in WBS). Not fixable within this diff; do not assume CI green from this leg alone. |
| 3 | INFO | juggler-backend/tests/unit/mcp-server.test.js:67 | [coverage] Both unit test files exercise juggler-mcp/index.js (SDK 1.27.1) via require('../../../juggler-mcp/index'); juggler-backend/src/mcp/server.js's corrected import (SDK 1.29.0) is not directly asserted by a distinct unit test in these two files. — evidence: mcp-server.test.js:67 requires juggler-mcp/index; mocks resolve with paths:[MCP_DIR]=juggler-mcp (1.27.1). server.js:5 correctness independently verified by my node require probe (McpServer resolves at server/mcp.js in 1.29.0) + telly's live curl (HTTP 500->200). Flagging so coverage attribution is accurate. REFER->telly. (confidence med) | telly to confirm coverage attribution; server.js:5 is behaviorally verified via node-require + live curl even if not unit-isolated. No new test strictly required (existing suite + live repro cover both BUGs). |

### Refer-outs
- INFO REFER→cookie — CI workflow submodule-install loop never installs juggler-mcp node_modules -> module-not-found on the gate; separate from this import fix (INFO-2)
- INFO REFER→telly — coverage attribution: both unit files exercise juggler-mcp/index.js (1.27.1); backend server.js (1.29.0) import verified via node-require + live curl, not a distinct unit test (INFO-3)

## Scooter Consult
**Q:** Any prior decision/standard governing juggler MCP SDK import path (bare './server' vs subpaths './server/mcp.js','./server/stdio.js')? Reverting a7d7dd1 — relitigating a settled decision?
**A (cited):** No settled decision mandates the bare path. The ONLY artifact asserting './server' is commit a7d7dd1 itself (the commit under revert), whose 'Node on Linux strictly enforces the exports map / only ./server is exported' claim is already recorded as verified-FALSE in this leg's WBS + INTAKE-BRIEF. Both SDK 1.27.1 and 1.29.0 have identical export shapes; the './*' exports-map wildcard resolves the subpaths on every platform. telly's RED/GREEN repro (9 failing pre-fix -> 31/31 green post-fix) independently corroborates. Reverting to explicit subpaths relitigates nothing — it corrects a misdiagnosis.

## Sign-off
Signed: ernie — 2026-07-04T17:40:00Z

