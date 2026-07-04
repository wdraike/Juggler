<!-- GENERATED from elmo-REVIEW.json — do not edit; re-render via _gate/render-review.sh -->
# elmo Review — sched-mcp-sdk-import-fix — bugfix — 2026-07-04

## Status: DONE

_Import-path bugfix only (5 require() strings + test mock paths). No auth/authz/route logic touched. transport.js unchanged. Live: bogus token->401, fix works (no 500). 0 BLOCK 0 WARN 2 INFO._

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Scope + diff | git diff main -- <4 files>; git status --porcelain | Diff = 5 require()/mock path strings + comments only. server.js:5 (1 line), juggler-mcp/index.js:9-10 (2 lines), 2 test files (mock paths + comment blocks), session.json (planning meta). No logic, no routes, no auth code. |
| Confirm auth surface unchanged | git diff main --name-only \| grep -c transport.js / mcp-auth | transport.js = 0 matches (UNCHANGED, not in diff). auth-client/mcp-auth.js = 0 matches (UNCHANGED). Auth middleware runs at transport.js:65 (authenticateMcpRequest) BEFORE createMcpServerForUser at line 80 — order preserved. |
| Scanner pre-filter (Step 2.5) | gitleaks 8.30.1; semgrep 1.168.0 --config auto; eslint on changed files | gitleaks=ran (no leaks). semgrep=ran on server.js + index.js (exit 0, no findings). eslint=errored (ESLint 9 vs legacy .eslintrc config mismatch) -> grep-fallback on the 2 changed source files: only require() path strings edited, no sink/eval/secret -> trivially clean. |
| SDK exports validation | node require @modelcontextprotocol/sdk/server/{mcp,stdio,index}.js from juggler-mcp | server/mcp.js exports McpServer (function); server/stdio.js exports StdioServerTransport (function); bare server/index.js exports only {Server}. Confirms the fix targets the correct subpaths and the old bare './server' path was the root cause of 'McpServer is not a constructor'. |
| Tool user-scoping trace (A01 IDOR/BOLA) | grep userId in mcp/tools/tasks.js; read register* signatures | register{Task,Schedule,Config,Data}Tools(server, userId) all receive userId. Every DB access in tasks.js constrained: db('tasks_v').where('user_id', userId), where({id, user_id: userId}), task_masters where({id, user_id: userId}), user_config where({user_id: userId}). userId derives from authResult.userId (JWT sub) — no cross-user access path. Scoping intact and untouched by diff. |
| Live verify — unauth POST /mcp | curl POST /mcp bogus Bearer + no-token (localhost:5002 dev-bed) | Bogus token -> HTTP 401 {code:-32000,'Invalid or expired token'}. No-token + Accept headers -> HTTP 200 served as dev-user (NODE_ENV=development dev bypass, transport.js:74, production-guarded). NEITHER path 500'd — fix confirmed live. Production posture: bogus/no token both rejected (bypass gated by NODE_ENV!=='production'). |

## Proof Checklist
- [x] Required inputs present (--mode + --files) — --mode bugfix, --files = 4 files
- [x] Scope confirmed — files list non-empty; count recorded — 4 target files; actual code diff = server.js + juggler-mcp/index.js (2 source), 2 test files
- [x] Scanner pre-filter run (gitleaks/semgrep/eslint recorded ran/absent/errored) — gitleaks=ran clean; semgrep=ran clean (exit0); eslint=errored(config)->grep-fallback recorded
- [x] Mode-appropriate checks run (bugfix) — bugfix: narrow diff threat-model; threat-intel omitted (scope narrow, no new integration/dep)
- [x] All OWASP A01-A10 categories scanned — Coverage map full 10/10; diff is import-path strings — no new sink in any category
- [x] Authz checked — sensitive route auth middleware verified (A01) — /mcp route auth via authenticateMcpRequest at transport.js:65 before server construction; unchanged
- [x] BOLA/IDOR ownership-trace done — tasks.js every query where user_id:userId; userId from JWT sub via authResult; no cross-user id path
- [x] BFLA/vertical authz checked — single-tenant per-user tools; no role escalation surface; no admin route in diff
- [x] Mass-assignment checked — No req.body spread introduced; diff touches no handler body
- [x] Cross-product/tenant authz checked — planCheck(authResult) keys plans[APP_ID] by slug; unchanged (transport.js:26)
- [x] CSRF check run — Bearer-token auth only (Authorization header), not cookie — CSRF N/A; exemption noted
- [x] JWT algorithm pinning verified as static check (A07) — auth-client/mcp-auth.js:204 jwtVerify(token,getJWKS(),{issuer:'raike-auth'}) — no explicit algorithms pin; jose+asymmetric JWKS rejects alg:none & mitigates HS/RS confusion. Out-of-diff (unchanged). INFO E-2.
- [x] Prototype-pollution checked — No user-input merge introduced by diff
- [x] Path-traversal/upload limits checked — No file/path handling in diff; require() paths are static literals
- [x] Secrets scan complete — gitleaks clean; no hardcoded creds in changed lines
- [x] Secrets/PII-in-logs scan complete — No new log sink in diff
- [x] Supply-chain depth checked (A06) — No package.json/lockfile in diff; SDK version 1.27.1 unchanged; import path correction only. npm audit not in scope (no dep change).
- [x] Threat model done if --external (Step 5) — bugfix narrow scope, no new integration — targeted threat-intel omitted per REFERENCE gate
- [ ] Full threat model of new surface if --mode new — N/A — bugfix, no new surface
- [ ] npm audit run (A06) — N/A — no dep/lockfile change in scope; recorded 'no dep change in scope — skipped'
- [x] Refer-ins from ernie/cookie incorporated — No ernie/cookie REFER->elmo entries for this leg
- [x] Security-regression tests referred to telly — No security BLOCK — no regression test refer required
- [x] Grep matches triaged not counted — userId scoping matches READ + reasoned; live curl confirmed auth rejection path
- [x] Findings carry file:line + severity — 2 INFO findings with file:line
- [x] Flag-and-refer for out-of-column issues — None — no code-logic/arch/test issue surfaced
- [ ] Prior knowledge consulted via Scooter — N/A for bugfix — settled auth invariants read from CLAUDE.md; no design decision to relitigate
- [ ] Knowledge changes reported to Scooter — N/A — no security-standard/approach changed by this leg
- [x] Rubric Coverage Map emitted — Coverage: full (10/10), no gaps
- [x] elmo-REVIEW.json written + SECURITY-REVIEW.md rendered — this file + render-review.sh
- [x] Status line set — DONE

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | INFO | juggler-backend/src/mcp/transport.js:74 | [A07 Authentication (dev bypass) / out-of-diff observation] The now-working /mcp endpoint serves no-token requests as userId 'dev-user' when NODE_ENV=development (or MCP_DEV_NO_AUTH=true), reachable now that the import fix lets a real McpServer construct. — evidence: transport.js:62,74 grant authResult={userId:'dev-user'} on the token-less/dev-token path, guarded by `&& process.env.NODE_ENV !== 'production'`. Live-confirmed: no-token POST to dev-bed (NODE_ENV=development) returned HTTP 200 initialize as server 'juggler'. This bypass is UNCHANGED by this diff (transport.js not in the file list) and is production-guarded — bogus token in prod-equivalent path returned 401. Before the fix the endpoint 500'd at `new McpServer()` AFTER the auth check (line 80 > line 65), so the brokenness was never an auth control; it broke authed and dev paths equally. No control weakened. Recorded so reviewers know the dev-open behavior is now live in development. (confidence high) | No action required for this leg. Optional hardening (separate backlog): assert NODE_ENV is explicitly set at boot so an unset NODE_ENV cannot be mistaken for non-production; confirm Cloud Run deploy sets NODE_ENV=production. |
| 2 | INFO | auth-client/mcp-auth.js:204 | [A07 Authentication (JWT alg pinning) / out-of-diff surrounding surface] JWT verification does not explicitly pin the allowed signature algorithms. — evidence: jwtVerify(token, getJWKS(), { issuer: 'raike-auth' }) — no `algorithms` option. Mitigated in practice: jose's jwtVerify rejects alg:none by default, and getJWKS() (createRemoteJWKSet) supplies asymmetric keys so HS/RS key-confusion is not exploitable (an HS256 token is not verified against a JWKS KeyLike as an HMAC secret). File is UNCHANGED by this diff (mcp-auth.js not in file list); flagged only as surrounding-surface awareness, not a defect of this bugfix leg. (confidence high) | Out of scope for this leg. Best-practice follow-up (backlog): add explicit `algorithms: ['RS256']` (or the deployed alg) to the jwtVerify options for defense-in-depth. |

## Sign-off
Signed: elmo — 2026-07-04T13:25:00Z

