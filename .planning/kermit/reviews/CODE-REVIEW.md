# Ernie Review — quotaTOCTOU.test.js + timeoutAbortConsequences.test.js — bugfix — 2026-06-12

## Status: DONE

Leg: juggler-test-failloud-residual. Reviewed the UNCOMMITTED `git diff` on two
test files converting 4 silent skip-pass sites
(`if(!dbAvailable){console.warn;return}`) to in-body `await assertDbAvailable()`
(TEST-FR-001). Code-correctness column only.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=bugfix, files from positional list (2) | present |
| Scope detect | `git diff --name-only` | 2 files, both tests, 0 prod files |
| Bugfix gate | RED-intent tests (EXPECT-RED labels) + TEST-FR-001 standard cited | satisfied |
| Helper read | Read tests/helpers/requireDB.js | `assertDbAvailable` is `async`, throws on down/probe-throw |
| Import/await check | grep import + `await assertDbAvailable()` both files | imported once each; all 4 call sites `await`ed |
| Lifecycle-guard check | Read beforeAll/afterAll/beforeEach + `dbAvailable` refs | `let dbAvailable` retained; hooks still reference it; no ReferenceError |
| B4 pure-unit check | Read timeoutAbort lines 115-184 | untouched, no DB dependency added |
| Dead-code scan | grep removed-guard residue | none — `dbAvailable` still consumed by 3 hooks |
| Prod-code check | `git diff --name-only` / `--cached` | 0 production files modified |
| Error-handling scan | helper throws loud; no swallowed errors introduced | clean |
| Output written | Write .planning/kermit/reviews/CODE-REVIEW.md + ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present — mode=bugfix, 2 files in scope
- [x] Scope confirmed — 2 test files, printed above
- [x] Mode noted + gate checked — bugfix; EXPECT-RED reproduction labels + TEST-FR-001 governing standard present
- [x] Complexity scan run — test files; no logic-density concern from this diff (guard swap only)
- [x] Error handling scan run — no `.then` w/o catch, no empty catch introduced; helper throws loud (TEST-FR-001) — the intended behavior
- [x] Floating-promise / forEach(async) scan run — all 4 `assertDbAvailable()` calls are `await`ed; no floating promise, no forEach(async)
- [x] Error-cause-preservation scan run — no catch-returns-success-default added; the change REMOVES the silent skip-pass (the prior false-green)
- [x] Input validation scan run — n/a (no public entry points; test files)
- [x] Unapproved-fallback scan run — no `||`/`??` field-read fallbacks added; helper explicitly forbids them (requireDB.js §Invariants)
- [x] Numeric precision/boundary scan run — n/a to this diff (no numeric/boundary math changed)
- [x] ReDoS scan run — no regex added
- [x] Date/TZ & DB-clock scan run — n/a (no date math touched)
- [x] Resource management scan run — `afterAll` `testDb.destroy()` retained behind `if (dbAvailable)`; no handle leak introduced
- [x] DB-transaction/atomicity scan run — n/a (no write-path logic changed)
- [x] Concurrency safety scan run — B11 race/Promise.all logic untouched by the guard swap
- [x] Idempotency-under-retry scan run — n/a (test files, no queue/webhook consumer)
- [x] Grep matches triaged — each `dbAvailable` ref and `await` call READ in context, not counted
- [x] Type safety scan run — no casts / `@ts-ignore` (plain JS test)
- [x] React logic scan — skipped (no .jsx/.tsx in scope)
- [x] Observability scan run — removed `console.warn` skip-noise is intentional (replaced by loud throw); no bare prod console.log added
- [x] Dead code scan run — no TODO/FIXME added; no orphaned variable left by guard removal
- [x] Flag-and-refer lines emitted — test-quality → zoe; security → elmo (none triggered; noted as n/a in findings)
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed (telly's column)
- [x] No security findings reviewed in depth
- [x] Prior knowledge — n/a deep consult for bugfix guard-swap; governing standard TEST-FR-001 supplied in prompt + matched against helper header
- [x] Knowledge changes reported — none (no requirement/standard changed)
- [x] Rubric Coverage Map emitted — all 9 dimensions below
- [x] Output file written with Proof-of-Work, Checklist, Findings, Sign-off
- [x] Status line set — DONE (no BLOCK)

## Findings

No BLOCK, no WARN. The five requested correctness checks all pass:

| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | INFO | quotaTOCTOU.test.js:79,169,268 / timeoutAbortConsequences.test.js:73,259,297 | (1) Helper imported + used correctly. `assertDbAvailable` is `async` (requireDB.js:93); each of the 4 call sites uses `await assertDbAvailable()`. Throws `[TEST-FR-001]` on DB-down or probe-throw → RED instead of vacuous green. Correct. | None |
| 2 | INFO | quotaTOCTOU.test.js:113,116,131,142 / timeoutAbortConsequences.test.js:227,230,241,251 | (2) Lifecycle guards intact. `let dbAvailable` still declared + set in `beforeAll`; `afterAll` (`if (dbAvailable)`) and `beforeEach` (`if (!dbAvailable) return`) still reference it — no ReferenceError. Only the in-body `if (!dbAvailable) return` was removed from test callbacks, not from hooks. Ordering sound: on DB-down, `beforeEach` returns early (no DB call) then the body's `assertDbAvailable()` throws RED. | None |
| 3 | INFO | timeoutAbortConsequences.test.js:115-184 | (3) B4 pure-unit `describe` ("timeout-abort must NOT enqueue…") NOT touched — mocked `enqueue` spy, no DB. The file-level `assertDbAvailable` import (line 73) is unused by B4 and adds no DB dependency to it. B4 stays Docker-free. | None |
| 4 | INFO | both files | (4) No leftover dead variables / unreachable code. `dbAvailable` still consumed by 3 hooks per suite; the removed `console.warn` skip blocks left no orphan. The post-removal `beforeEach` comment is accurate (DB-down throws in-body before any DB call in the body). | None |
| 5 | INFO | git diff --name-only | (5) No production code touched — diff is exactly the 2 named test files; `git diff --cached` empty. | None |
| 6 | INFO | (whole leg) | Test-quality judgments (assertion strength, mutation-kill, whether the loud-throw surfaces RED in CI) are zoe's column. Security (none observed) is elmo's. | REFER→zoe (test quality), REFER→elmo (security, none triggered) |

### Triage note (grep-discipline)
The only fallback-shaped tokens in scope are the retained lifecycle `if (!dbAvailable) return`
guards — boolean control-flow guards in `beforeEach`/`beforeAll`, NOT field-read `||`/`??`
fallbacks over a maybe-null value, so they are not No-Unapproved-Fallbacks findings.
`requireDB.js` itself bans `||`/`??` re-enabling of silent skipping (§Invariants); the diff adds none.

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | 4 guard-swap sites verified equivalent-or-stricter; lifecycle ordering reasoned (beforeEach early-return then body throws) | core of review |
| Readability | covered | comments updated to match new control flow; accurate | — |
| Maintainability | covered | uses shared `requireDB` helper (DRY) vs inline console.warn skip | improves maintainability |
| Error Handling | covered | loud throw replaces silent skip-pass; helper re-throws probe errors as TEST-FR-001 | the point of the change |
| Coupling | covered | adds one require on a test helper; no new coupling to prod | — |
| Type Safety | covered | plain JS test, no casts/ts-ignore | n/a deeper |
| API Design | covered | `assertDbAvailable()` async, awaited correctly at all sites | — |
| Resource Management | covered | `afterAll` testDb.destroy() retained behind dbAvailable guard | no handle leak |
| Concurrency Safety | covered | B11 Promise.all race logic untouched by guard swap | — |

## Sign-off
Signed: Ernie — 2026-06-12T00:00:00Z
