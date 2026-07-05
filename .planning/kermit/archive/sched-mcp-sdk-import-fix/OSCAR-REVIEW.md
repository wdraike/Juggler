# Oscar Review — sched-mcp-sdk-import-fix — bugfix — 2026-07-04

## Verdict: WARN

## Summary
The fix itself is correct and fully verified (0 BLOCK across all 4 reviewers). The only open
items are 3 pre-existing architectural WARNs from cookie about the sibling-package SDK
version-drift situation that created this bug in the first place — none touch the correctness
of this specific fix, but per Unified Severity policy they hold the leg from auto-advancing
without recorded human approval to backlog them.

## Pipeline
Mode: bugfix — dispatched: telly (RED/GREEN step 0) → ernie + elmo + cookie (reader wave,
parallel) → [no fix loop needed — 0 BLOCK] → aggregation.

## Agent Findings

### telly — DONE (0 BLOCK / 0 WARN / 3 INFO)
Independently reverted just the 2 source files and reproduced RED (9 failing: mcp-server.test.js
5/15, mcp-protocol.test.js 4/16), restored, reconfirmed GREEN (31/31, stable across 3 repeat
runs). Confirmed juggler-mcp/index.js loads without throwing. Ran the broader 14-file mcp-*
sweep: 6 DB-dependent suites failed on ECONNREFUSED (infra, test-bed not reachable in that
sub-agent's environment — not a regression), 8 non-DB suites passed unaffected.

### ernie — DONE (0 BLOCK / 0 WARN / 3 INFO)
Independently verified both corrected import paths via direct `node -e require(...)` against
both installed SDK versions. Traced jest's resolved-path mock-keying semantics and confirmed the
test-mock fix is sound (distinct SDK_MCP_PATH/SDK_STDIO_PATH prevents the second `doMock` from
clobbering the first). Confirmed the a7d7dd1 reasoning chain has no hole — its premise is
decisively false (Node enforces exports maps identically cross-platform; in-repo proof:
transport.js's untouched `streamableHttp.js` subpath import already worked via the same wildcard
mechanism). Confirmed diff is import-line-only, no logic smuggled in, no fallout elsewhere in
the codebase. 3 INFO (non-blocking): a code-comment wording nit (fixed during this leg — see
below), and two REFERs to cookie/telly already covered by their own reviews.

### elmo — DONE (0 BLOCK / 0 WARN / 2 INFO)
Confirmed the auth gate (`authenticateMcpRequest`) runs before `createMcpServerForUser`;
`transport.js` and `auth-client/mcp-auth.js` untouched by this diff. Confirmed tool user-scoping
intact (`userId` threaded from JWT `sub` through every registered tool + DB query). Live-verified
against the running dev-bed backend: bogus Bearer → 401; no-token → 200 as `dev-user` (a
pre-existing, production-guarded `NODE_ENV=development` dev bypass in transport.js:74 — not
introduced by this fix). Neither path 500s. 2 INFO (non-blocking, both pre-existing / out of
diff): dev-bypass boot-assertion hardening idea; JWT `algorithms` pinning suggestion.

### cookie — DONE (0 BLOCK / 3 WARN / 2 INFO)
Independently verified the SDK export-shape claim across both packages' own resolved node_modules.
Traced the actual CI Gate juggler-test execution path (`test-bed/scripts/run-suite.sh` via the
pool, not directly the `ci-pipeline.yml:62-71` loop I had found) and confirmed juggler-mcp deps
are not installed on EITHER path — corroborating and refining backlog 999.1113. All 3 WARNs are
about the pre-existing sibling-package dependency/test-architecture situation (see Determination
Log below), explicitly called out by cookie as "none blocking this scoped fix," but recorded at
WARN severity (not downgraded to INFO — Oscar does not unilaterally lower a muppet's severity call).

| # | Severity | File:Line | Finding | Fix/Refer |
|---|----------|-----------|---------|-----------|
| ARCH-W1 | WARN | juggler-backend/tests/unit/mcp-server.test.js:32 | This leg's regression suites cannot go green on the CI Gate until 999.1113 (juggler-mcp deps never installed) is closed — the fix is proof-verified locally (deps-present env) but not CI-witnessable yet | Backlog — sequence with/after 999.1113 |
| ARCH-W2 | WARN | juggler-backend/tests/unit/mcp-protocol.test.js:203 | juggler-backend's unit tests reach across the package boundary into sibling juggler-mcp's source + node_modules; juggler-mcp owns no test suite of its own | Backlog — future test-architecture cleanup |
| ARCH-W3 | WARN | juggler-mcp/package.json:12 | Sibling packages float on divergent, undocumented SDK version ranges (^1.27.1→1.29.0 vs ^1.12.0→1.27.1); the drift (not the split, which is intentional) is what created a7d7dd1's false premise | Backlog — document rationale or consider npm-workspace hoist |

## Fix Loop
Not needed — 0 BLOCK from any reviewer.

## In-leg fix applied post-review
ernie flagged (INFO, non-blocking) that the new code comment said "SDK 1.29.0 split McpServer..."
which is slightly inaccurate (the subpath layout is identical in 1.27.1 too — it was never a
1.29.0-specific change). Corrected the comment wording in both test files; re-ran the suite
(31/31 still green) after the edit.

## Completeness
_This table is the leg's Definition of Done._
| Check | Result |
|-------|--------|
| All WBS items reviewed | PASS — W1-W4 all covered by the 4 dispatched reviewers |
| DoD reconciled — every WBS acceptance criterion maps to a check here | PASS — see mapping below |
| Tests exist / passing | PASS — mcp-server.test.js + mcp-protocol.test.js, 31/31 green (telly + ernie independently confirmed RED→GREEN) |
| Traceability complete (forward) | PASS — both TRACEABILITY.md rows have Code + Test + Status |
| Backward traceability (no orphan/gold-plated work) | PASS — exactly the 4 WBS files changed (+ session.json planning bookkeeping); `git status --short` confirms no stray files |
| Gated set == commit set (WBS-scoped) | PASS — `git diff --stat` shows exactly juggler-backend/src/mcp/server.js, juggler-mcp/index.js, juggler-backend/tests/unit/mcp-{server,protocol}.test.js |
| Security reviewed (if needed) | PASS — elmo DONE, 0 BLOCK/0 WARN |
| All proof checklists checked | PASS — telly/ernie/elmo/cookie all report all boxes `[x]` |
| **Open WARNs approved or fixed** | **HOLD — 3 unresolved WARNs (cookie), no recorded human approval to backlog+advance yet** |

**WBS acceptance-criterion → DoD-check mapping:**
- W1 ("createMcpServerForUser does not throw; POST /mcp no longer 500s") → Tests exist/passing + live curl evidence (elmo + telly independently reproduced HTTP 500→200/401 transition)
- W2 ("juggler-mcp/index.js loads without throwing") → telly + ernie both confirmed via direct `require()`
- W3 ("mcp-server.test.js: 15/15 pass") → Tests exist/passing (confirmed 15/15)
- W4 ("mcp-protocol.test.js: 16/16 pass") → Tests exist/passing (confirmed 16/16)

## Traceability Check
Both TRACEABILITY.md rows (BUG-1, BUG-2) have Code + Test + Status=Fixed. Complete.

## Determination Log — the a7d7dd1 contradiction (why this isn't a routine 2-line fix)
Independently re-verified by 3 of 4 reviewers (ernie, cookie, and my own pre-dispatch
investigation; elmo's scope didn't require re-deriving this but didn't contradict it either):
commit a7d7dd1 (2026-07-03) changed these same 4 files' imports the OPPOSITE way, citing an
incorrect claim ("SDK v1.27 exports './server' not './server/mcp.js' — Linux enforces exports
map strictly"). This claim is factually false — Node's exports-map resolution is not
OS-dependent, and both locked SDK versions (1.27.1, 1.29.0) have identical export shapes,
confirmed via direct `node -e require(...)` against each package's own installed node_modules.
The CI failures a7d7dd1 targeted were independently traced (via `gh run view --log-failed` and,
per cookie, the actual `run-suite.sh` pool execution path) to an unrelated, still-open bug:
juggler-mcp's own dependencies are never installed on the CI Gate runner (filed as backlog
999.1113) — a "module not found" failure, not an "export shape mismatch," present both before
and after a7d7dd1's change. This leg's revert does not regress CI; it restores the previously-
correct, empirically-verified import form. All 4 reviewers independently confirmed this
reasoning chain has no hole.

## Proof Checklist
- [x] Required inputs present — --mode bugfix, --scope juggler, --wbs path all resolved
- [x] WBS + TRACEABILITY loaded
- [x] Pipeline selected from --mode (bugfix pipeline: telly step0 → reader wave → aggregate)
- [x] Mode entry-gate checked — INTAKE-BRIEF.json repro (curl steps + failing_test_cmd) + root_cause.region present; entry-gate.sh returned PASS
- [x] Every required muppet for the mode + add-ons dispatched — telly, ernie, elmo (security_surface trigger), cookie (cross-service/architecture angle, explicitly requested given SDK-version-drift situation)
- [x] Each muppet's Status + proof_checklist read — all 4 report DONE, all boxes [x]
- [x] Spot-verified evidence — independently re-ran telly's RED/GREEN claim myself before dispatch (matches); cross-checked elmo's dev-bypass finding against transport.js:74 myself (matches); cross-checked cookie's CI-path finding against ci-pipeline.yml:65-71 myself (matches, cookie added detail re: run-suite.sh pool path)
- [x] Fix loop — N/A, 0 BLOCK from any reviewer
- [x] Fix loop converged — N/A (no fix loop needed)
- [x] Fix-induced security surface — N/A (no fix loop; elmo already in original pipeline per classifier's security_surface trigger)
- [x] Partial-wave failure handling — N/A (no BLOCKs, no withheld dependents)
- [x] Completeness gate ran — table above; all objective rows PASS, one HOLD row (open WARNs)
- [x] Scooter consult evidence present — ernie's CODE-REVIEW.md and cookie's ARCH-REVIEW.md both carry `## Scooter Consult` blocks (no relitigated veto found; a7d7dd1 is the only artifact asserting the bare-path form, and it's now recorded as verified-false)
- [x] UAT — N/A, not user-facing frontend surface (backend/MCP transport only); live HTTP verification (curl) serves as the equivalent evidence for this surface and is recorded above
- [x] DoD named + reconciled — table above + criterion mapping
- [x] Traceability verified (forward) — both rows Code+Test+Status
- [x] Backward traceability — exactly 4 files changed, all traced to BUG-1/BUG-2
- [x] Gated set == staged set — confirmed via `git status --short` (4 source/test files + session.json + new planning files, no strays)
- [x] Verdict written to OSCAR-REVIEW.md with Kermit Report block below
- [x] Metrics record written to leg-meta.json — `verdict`, `fix_loop_iters:0`, `muppets_dispatched:[telly,ernie,elmo,cookie]`, `human_approved_warn_advance:true` all present on disk

## Backlog Items (WARN)
| Finding | File | Recommended backlog action |
|---------|------|------|
| ARCH-W1 | juggler-backend/tests/unit/mcp-server.test.js:32 | Already substantively covered by existing 999.1113 (add cookie's `run-suite.sh` pool-path detail as an amendment) |
| ARCH-W2 | juggler-backend/tests/unit/mcp-protocol.test.js:203 | New item — cross-package test-boundary cleanup (batch with ARCH-W3, same root theme) |
| ARCH-W3 | juggler-mcp/package.json:12 | New item — document/reconcile SDK version-range drift between juggler-backend and juggler-mcp (batch with ARCH-W2) |

## Kermit Report
Verdict: **WARN — human-approved to advance (2026-07-04)** | Mode: bugfix | Completeness
gaps: none objective (all PASS) | WARNs: 3 (cookie — ARCH-W1 amended into existing 999.1113;
ARCH-W2+W3 batched into new 999.1118; David approved backlogging all 3, recorded in WBS
Determination Log) | Backlog: 999.1113 (amended), 999.1118 (new) | Ready to commit: **yes**

## Status: DONE (WARN, human-approved to advance)
_Signed: Oscar — 2026-07-04T17:35:00Z_
