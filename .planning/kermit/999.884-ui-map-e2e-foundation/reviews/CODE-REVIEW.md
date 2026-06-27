# Ernie Review — 999.884 UI-map + E2E coverage foundation (juggler-frontend) — new — 2026-06-26

## Status: DONE

## Scooter Consult
**Question asked:** "UI map + E2E Playwright coverage tooling approach for juggler-frontend; any prior decisions/vetoes on E2E test layout, coverage reporting, or the existing tests/e2e smoke suite" (domain: scheduler)

**Brain health:** DEGRADED — `mcp__brain` tools are not in this subagent's tool scope and `~/brain` exposes no CLI entrypoint I could invoke (`cli.js` MODULE_NOT_FOUND). Federation fell back to authoritative docs + project memory + rules files. **Confidence: partial (brain offline).**

**Cited answer:**
- **Playwright is the monorepo's sanctioned E2E tool.** `resume-optimizer/docs/testing/TESTING-GUIDE.md:68-78` (E2E Strategy) and `TESTING-FRAMEWORK.md:400-402` both prescribe `npx playwright test tests/e2e/...` for login/import/responsive flows. The new juggler tooling adopting `@playwright/test` + a `tests/e2e/**` tree is consistent with the established approach — no conflicting standard.
- **Binding prior decision / hazard (HONORED):** memory `live-uat-agent-cleanup-hazard.md:16` — a live-env Playwright UAT left **281 `E2E-TEST-` junk rows in the dev DB** and polluted the main tree. The governing rule is: E2E must run only against an **ephemeral/test stack, NEVER the dev server or dev DB**, and cleanup must be verified not trusted. `playwright.config.js` and every spec header cite this constraint and enforce it structurally (package not installed, authored-not-run, env-driven baseURL). The approach does **not** relitigate or violate this veto.
- **No veto found** on a UI-map + coverage-report tool specifically, and **no prior decision** on E2E directory layout for juggler-frontend. The design's choice to scan BOTH `tests/e2e/**` (pre-existing smoke suite) and `e2e/specs/**` (new) — and to `testMatch` both — correctly avoids orphaning the existing smoke suite, which is the only layout-relevant constraint surfaced.

**Vetoes/constraints in play:** Never point the E2E runner at dev:3002 / the dev DB (live-UAT hazard). See WARN-2 — the config's literal default partially undercuts this.
**Gap emitted:** A degraded-brain note — could not confirm against the curated Brain; an INBOX reconcile is advisable once brain MCP is reachable. No knowledge change introduced by this leg.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=new, 8 files from positional list | present |
| Scope detect | `git diff --cached` (staged) | 8 in-scope files (of 15 staged) confirmed |
| Behavior verify | `node --test e2e/report/ui-coverage.test.js` | 7/7 pass |
| Behavior verify | `node e2e/report/collect-coverage.js` | runs clean; surfaces 7/27, paths 4/15, overall 11/42; 0 unmatched |
| JSON integrity | parse ui-map.json + dup/id scan | 42 ids, 42 unique, 0 dups; 15 screens+12 modals+15 paths=42 coherent; all carry string id |
| @covers resolution | grep all specs vs map ids | every annotation resolves; `none` sentinel + empty-grep artifact correctly excluded by stricter COVERS_RE |
| Error handling scan | review pure fns | idsOf throws on missing id (integrity-first); no swallowed errors; no async in tooling |
| Unapproved-fallback scan | grep `\|\|` / `??` | calculator has NO data fallbacks; `Array.isArray(?)?:[]` surfaces as visible 0/0 (reported, not hidden); only fallback is config baseURL (WARN-2) |
| Numeric/precision scan | review pct/round | div-by-zero guarded (total===0 → 0); Math.round integer pct; no float money paths |
| ReDoS scan | COVERS_RE `/@covers\s+([A-Za-z0-9:_-]+)/g` | linear, no nested quantifiers; input is dev-authored specs not user data — safe |
| Concurrency scan | module-level state | COVERS_RE `/g` lastIndex shared (INFO-2); no server/shared-request state |
| React logic scan | n/a | no .jsx/.tsx in scope (specs are Playwright, not React) — skipped |
| Output written | Write CODE-REVIEW.md + ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present — mode=new, 8-file scope non-empty
- [x] Scope confirmed — file list printed in Proof of Work
- [x] Mode gate checked (new=SPEC) — DECOMPOSITION.md/UI-MAP.md present as the leg's spec artifacts; acceptance is the documented integrity rules in ui-coverage.js header, all verified by the green unit suite
- [x] Complexity scan — largest in-scope file ui-coverage.js ~135 lines; no file >300; nesting ≤3
- [x] Error handling scan — idsOf throws on bad id; no `.then` without catch; no empty catch; pure sync tooling
- [x] Floating-promise / forEach(async) scan — none; tooling is synchronous (fs sync reads in a CLI script, acceptable per Step-6 startup/script exemption)
- [x] Error-cause-preservation scan — no catch-returns-success-default; the only thrown error carries full context (`JSON.stringify(entry)`)
- [x] Input validation scan — computeCoverage guards array shapes; idsOf rejects non-string/empty id; collector skips missing dirs
- [x] Unapproved-fallback scan — calculator clean; empty-array guards surface as visible 0/0 not silent substitution; config baseURL fallback noted WARN-2
- [x] Numeric precision/boundary scan — div-by-zero guard, Math.round, empty/full/partial/dup all covered by tests
- [x] ReDoS scan (OWNED) — COVERS_RE linear, no `new RegExp(userInput)`
- [x] Date/TZ scan — no date math in scope
- [x] Resource management scan — `readFileSync`/`readdirSync` in a non-server CLI script (script exemption); no unclosed handles/timers
- [x] DB-transaction scan — no DB access (tooling explicitly does not touch DB)
- [x] Concurrency safety scan — shared `/g` regex lastIndex noted INFO-2 (currently safe); no request-shared state
- [x] Idempotency-under-retry scan — n/a (no queue/webhook consumers)
- [x] Grep matches triaged — every `||`, exec-loop, and Array.isArray guard READ in context, not counted
- [x] Type safety scan — plain CommonJS; no `as any`/`@ts-ignore`; `// @ts-check` on config
- [x] React logic scan — skipped, no React files in scope (noted)
- [x] Observability scan — `console.log` is the intended report output of a CLI reporter, not stray debug (acceptable)
- [x] Dead code scan — no commented-out code blocks; no TODO/FIXME
- [x] Flag-and-refer emitted — test-quality (vacuous branding assertion) → zoe/telly (INFO-1)
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed
- [x] No security findings reviewed in depth — none observed
- [x] Requirements doc-standard — the calculator's integrity rules each have a happy + unhappy test (unknown-id, dedupe, div-by-zero, missing-arrays)
- [x] Prior knowledge consulted via Scooter — see Scooter Consult (degraded/partial)
- [x] Knowledge changes reported — none introduced by this leg
- [x] Rubric Coverage Map emitted — below
- [x] Output file written with Proof-of-Work, Checklist, Findings, Sign-off
- [x] Status line set — DONE (no BLOCK)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | WARN | e2e/report/collect-coverage.js:7,19; e2e/report/ui-coverage.test.js:7 | Header docstrings reference a stale directory: `node e2e/coverage/collect-coverage.js`, `e2e/coverage/*`, and `node --test e2e/coverage/ui-coverage.test.js`. The files actually live in `e2e/report/`. The documented run commands fail verbatim if copy-pasted. | Update the path references from `e2e/coverage` to `e2e/report`. |
| 2 | WARN | playwright.config.js:53 | `baseURL: …PLAYWRIGHT_BASE_URL \|\| …FRONTEND_URL \|\| 'http://localhost:3002'` defaults to the **dev frontend port** — the exact target the file's own header and the live-UAT hazard (281 junk rows in dev DB) say to NEVER hit. With no env set, the runner silently aims at dev. Multiple other guards (package not installed, authored-not-run) mitigate, but the config itself fails *open*. | Fail closed: `throw` if neither `PLAYWRIGHT_BASE_URL` nor `FRONTEND_URL` is set, instead of defaulting to the dev port. |
| 3 | INFO | e2e/specs/login.spec.js:62-67; day-view.spec.js:55-60; settings-panel.spec.js:50-55 | The branding assertions are vacuous as authored: `getComputedStyle().backgroundColor` returns `rgb(...)`, so `bg.startsWith('#')` is always false and the ternary substitutes the expected `BRAND.*` token, making `expect([...]).toContain(BRAND.*)` trivially pass. In-code comment acknowledges it's a placeholder ("rgb->hex conversion is done in a real helper"). REFER→zoe/telly to harden before the suite is greenlit. | REFER→zoe (test-truthfulness) / telly (test authoring) |
| 4 | INFO | e2e/report/collect-coverage.js:36,62-66 | `COVERS_RE` is a module-level `/g` regex driven by `.exec` in a `while` loop across multiple files. Currently safe because each inner loop runs to exhaustion (resetting `lastIndex`), but a future `break` would carry a stale `lastIndex` into the next file and silently skip its leading annotations. | Defensive: reset `COVERS_RE.lastIndex = 0` per file, or build a fresh regex / use `String.matchAll` per file. |

No BLOCK findings. The pure `computeCoverage` calculator is correct: div-by-zero guarded, coveredIds de-duped via `Set`, unknown ids routed to `unmatched` and excluded from `covered` (no silent counting — the no-fallback invariant is honored), category math correct (surfaces = screens ∪ modals, paths separate, overall = the union with namespaced ids so no cross-category collision), `Math.round` percentages. `idsOf` throws on a missing id rather than papering over it. ui-map.json is well-formed with 42 unique ids and coherent counts. All spec `@covers` tags resolve to real map ids.

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | 7/7 unit tests green; manually re-derived surfaces/paths/overall math; JSON counts coherent | core calculator sound |
| Readability | covered | small pure fns, JSDoc on the contract, intent comments | well under size limits |
| Maintainability | covered | calculator decoupled from map via inline fixture; both spec trees matched | WARN-1 stale path comments |
| Error Handling | covered | idsOf throws on bad id; missing-dir guarded; no swallowed errors | integrity-first, not fallback-first |
| Coupling | covered | pure computeCoverage has zero I/O/requires; collector isolates fs | clean port boundary |
| Type Safety | covered | CommonJS + `// @ts-check` on config; explicit string-id guard | no unsafe casts |
| API Design | covered | computeCoverage returns a stable shape incl. `unmatched` | documented contract |
| Resource Management | covered | sync fs reads in a CLI script (script exemption); no handles/timers leaked | not server code |
| Concurrency Safety | partial | no request-shared state; module-level `/g` regex lastIndex is the only shared mutable, currently safe | INFO-2 defensive note |

## Sign-off
Signed: Ernie — 2026-06-26T00:00:00Z
