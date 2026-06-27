# Zoe Review — 999.884-ui-map-e2e-foundation — new — 2026-06-26

## Status: ISSUES

1 BLOCK · 1 WARN · 3 INFO. Proof-checklist: all applicable boxes [x].

The `computeCoverage` unit suite is **truthful and sound** — independently mutation-confirmed (div-by-zero and unmatched cases both go RED when the calculator is regressed; it calls the REAL source, not a re-implementation). The 3 Playwright scaffolds' **content / layout / help-text** assertions are real checks, but their **branding** assertion is a **confirmed tautology (always-pass)** — and since this leg is the *foundation pattern the decomposition replicates across ~26 screens*, that vacuous pattern must be corrected before it propagates. BLOCK.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs | ls reviews/ (TEST-REVIEW.md, TEST-CATALOG.md, telly/ernie-REVIEW.json present) | present |
| Read source under test | ui-coverage.js + ui-coverage.test.js | calculator + 7 tests |
| Confirm real-fn (not re-impl) | `require('./ui-coverage')` at test:16 → resolves to e2e/report/ui-coverage.js | REAL source, not a stub |
| Run suite as-is | `node --test ui-coverage.test.js` | 7/7 PASS, 193ms |
| SPOT-MUTATION 1 (div-by-zero) | removed `if(total===0)return 0` guard, re-ran | test 6 → **not ok** (NaN leaks). Reverted from /tmp bak |
| SPOT-MUTATION 2 (unmatched) | replaced `else{unmatched.push}` with `else{surfacesCovered++}`, re-ran | tests 4 **and** 7 → **not ok**. Reverted |
| Tree clean | `git diff --stat ui-coverage.js` → empty; re-ran suite 7/7 | CLEAN, no mutation residue |
| Branding tautology proof | `node -e` resolving the assertion ternary against 4 real `getComputedStyle` rgb() values incl. non-brand white | assertionPasses=**true for ALL**, incl. white |
| Cross-check telly catalog | TEST-CATALOG.md "Assertion Quality: no tautologies" | over-broad — specs in same leg DO contain a tautology |
| Cross-check ernie | ernie-884-3 flagged branding vacuity (INFO) + REFER→zoe | confirmed; re-rated for foundation blast-radius |
| Output written | Write ZOE-REVIEW.md | Done |

## Proof Checklist
- [x] --mode present (`new`) — recorded in header
- [x] Required inputs present — TEST-REVIEW.md + TEST-CATALOG.md (telly) in reviews/; source files in scope read
- [x] Shallow-assertion grep / read run — no `expect(true)`, `.toBeTruthy()`, `.toBeDefined()` in the unit suite; all `strictEqual`/`deepStrictEqual` on exact values
- [x] Assertion-free test scan — every `test()` block carries `expect`/`assert`; none empty
- [x] Suspect test re-executed — full `node --test` run captured (7/7)
- [x] Suspect-selection recorded, risk-ordered — selected the div-by-zero guard + the unmatched/no-inflation branch (highest-risk: a miscount silently inflates a coverage % stakeholders trust) + the 3 spec branding assertions (ernie-referred)
- [x] SPOT-MUTATION executed on 2 risk-ordered suspects — both went RED; tree reverted clean via /tmp backup (not git checkout); `git diff` empty
- [x] Mock-hides-bug — N/A: `computeCoverage` is a pure function, zero mocks; specs use no mocks (real `page`)
- [x] Snapshot-triviality + tautology scan — no `toMatchSnapshot`; no `toEqual(self)` in unit suite; **branding `expect([...]).toContain(...)` in 3 specs IS a tautology** (BLOCK below)
- [x] Mode-specific (new) challenge — "does each test assert the requirement or just that code ran?": unit suite asserts exact values per AC; specs' content/help assert real DOM, branding does not
- [x] Error/negative-path audit — unmatched, empty, malformed-`{}`, dup, div-by-zero all covered; `idsOf()` throw path untested (ernie INFO, SPEC doesn't require) — acceptable
- [x] Requirement coverage — R2 (calculator) fully pinned; R4 (Playwright) authored-not-run per documented safety constraint; no zero-test implemented requirement
- [x] Zero-tolerance domains (scheduler/auth/billing) — none in scope (UI-coverage tooling + frontend scaffolds)
- [x] User-story coverage — N/A for this tooling-foundation leg
- [x] VERIFICATION-CHECKLIST.json — not regenerated; pure-tooling leg, no per-requirement checklist exists for e2e/ tooling — noted, not a gap
- [x] Bird PASS verdicts — N/A, no UX-REVIEW.md for this leg (no bird dispatch)
- [x] Bird a11y re-verify — N/A (no bird output)
- [x] Flake re-run — unit suite is pure-sync, deterministic; specs not runnable (Playwright not installed) — re-run not possible, recorded
- [x] Severity-calibration audit — ernie rated branding vacuity INFO; re-rated BLOCK for foundation-pattern blast-radius (filed as F1 + WARN F2 on telly's over-broad no-tautology claim)
- [x] Each finding carries file:line + severity
- [x] Flag-and-refer lines emitted
- [x] Rubric Coverage Map emitted — all 9 dimensions
- [x] Proof of Work populated with actual commands + results
- [x] Status set (ISSUES)
- [x] ZOE-REVIEW.md written
- [x] Scooter — no settled project-knowledge question needed re-litigating (safety constraint + brand tokens were supplied in-context)

## Findings

### Telly / Test-Truthfulness Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| F1 | **BLOCK** | `e2e/specs/login.spec.js:48-56`, `e2e/specs/day-view.spec.js:43-49`, `e2e/specs/settings-panel.spec.js:41-48` | **Branding assertion is a confirmed tautology (always-pass).** `getComputedStyle(el).backgroundColor` returns an `rgb(...)`/`rgba(...)` string in every browser — it NEVER starts with `#`. So `bg.startsWith('#')` is permanently false, the ternary always substitutes the *expected* brand token, and `expect([BRAND.x, BRAND.y]).toContain(<expected token>)` is trivially true. **Proven mechanically**: the assertion passes against `rgb(255,255,255)` (plain white — NOT a brand color), `rgba(0,0,0,0)` (transparent), and any other value. It verifies nothing about the page's actual branding and would pass on a blank/unstyled page. This leg is the **foundation pattern the decomposition copies across ~26 screens** — replicating it yields ~26 false-passing branding checks. The in-code comment ("rgb->hex conversion is done in a real helper; pattern shown here") concedes it is a placeholder, but the placeholder *is the thing being standardized*. | Before the pattern propagates: implement a real `rgb(...)→hex` (or numeric rgb compare) helper and assert the **actual** computed color equals a brand token (failing on non-brand colors); OR strip the vacuous branding assertion out of the reference scaffolds and replace with an explicit `test.fixme`/TODO so it cannot be copied as a green check. Do not mark 999.884 DONE with the tautological branding assertion presented as the canonical pattern. |
| F2 | WARN | `TEST-CATALOG.md:59` (Coverage Map "Assertion Quality: …no tautologies") | telly's Assertion-Quality dimension claims "no tautologies" for the leg, but the spec scaffolds authored in the same leg contain the F1 tautology. The claim is scoped only to the calculator and over-generalizes to "covered/no tautologies" for the whole leg. | Re-scope the claim, or downgrade to `partial` and cite the spec branding tautology + the hardening dependency (R4). |

### Cleared (challenged and CONFIRMED sound — safe to replicate)
| Item | File:Line | Verdict | Evidence |
|------|-----------|---------|----------|
| `computeCoverage` calls REAL source | `ui-coverage.test.js:16` | SOUND | `require('./ui-coverage')` → e2e/report/ui-coverage.js; not a re-implementation/stub |
| div-by-zero test genuinely pins behavior | `ui-coverage.test.js:78-86` | SOUND | Removing the `total===0` guard → test 6 goes RED (NaN leaks through `assert.ok(!Number.isNaN)`). Not tautological |
| unmatched/no-inflation test genuinely pins behavior | `ui-coverage.test.js:63-69` | SOUND | Making the `else` branch count unmatched ids as covered → tests 4 **and** 7 go RED (covered would read 3 not 1). Strong assertion (asserts both `covered===1` and exact `unmatched` array) |
| Spec content/layout/help assertions | login:38-45, day-view:29-41, settings:28-39 | SOUND PATTERN | `getByRole('heading'/'button'/'dialog')` + `getByText(help copy)` + day-grid time-slot regex are real DOM checks that FAIL on a blank/wrong page. Safe to replicate across the 26-screen decomposition |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| F3 | INFO | REFER→ernie | `juggler-frontend/playwright.config.js:53` | `baseURL` fails OPEN to dev `:3002` when no env set — collides with the live-UAT hazard (281 junk dev-DB rows). Already ernie-884-2 (WARN); truthfulness-relevant because a spec accidentally run against dev pollutes prod-like data. Config should fail closed. |
| F4 | INFO | REFER→ernie/telly | `ui-coverage.test.js:6`, `collect-coverage.js:7,19` | Header comments reference stale path `e2e/coverage/`; files live in `e2e/report/`. Copy-pasted run commands fail. Already ernie-884-1 + telly WARN. |
| F5 | INFO | REFER→ernie | `collect-coverage.js:62` | Module-level `/g` regex shares `lastIndex` across files — correct today (loop runs to exhaustion), fragile to a future early-break. Already ernie-884-4. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | partial | Unit suite asserts exact values (`deepStrictEqual`/`strictEqual`), mutation-confirmed; spec content/help/layout assert real DOM | Spec **branding** assertion has zero depth (tautology) — F1 |
| Edge Case Gaps | covered | empty / partial / full / unmatched / dup / div-by-zero / malformed-`{}` all tested and mutation-pinned | Only `idsOf()` throw path untested (INFO, not required) |
| Test Gaps | covered | Every branch/guard in ui-coverage.js has a pinning test (re-verified by mutation, not just telly's manual table) | — |
| UX Gaps | partial | Spec content/layout/help are real UX checks; branding check is vacuous | No bird/UX-REVIEW for this leg; specs authored-not-run |
| Security Gaps | covered | No security surface (pure math + read-only FS scanner); no auth/payment/SQL | — |
| Documentation Gaps | covered | Stale run-command paths flagged (F4); branding placeholder honestly labelled in-code | — |
| Architecture Gaps | covered | Calculator is pure/no-I/O; correct unit tier; no arch concern | baseURL fail-open referred to ernie |
| Review Quality | partial | telly + ernie both substantive; telly over-claimed "no tautologies" (F2); ernie correctly found branding vacuity but under-rated it INFO vs foundation blast-radius | Re-rated to BLOCK |
| False Passes | **gap** | **Confirmed false-pass: the branding assertion passes regardless of actual page branding (F1)** — exactly the systemic false-pass this leg would propagate ~26× | Highest-priority fix before decomposition |

## Sign-off
Signed: Zoe — 2026-06-26T00:00:00Z
