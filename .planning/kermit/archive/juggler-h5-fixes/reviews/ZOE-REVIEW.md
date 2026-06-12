# Zoe Review — juggler-h5-fixes W1a (AI call timeout) — bugfix — 2026-06-11

## Status: DONE

No BLOCK or WARN findings. All three RED regression tests are confirmed genuine repros (not tautologies), the B2 byte-identity guard is confirmed real, no false-GREEN found, and the full suite's failures are all confirmed pre-existing / W1a-unrelated. Bert's terminal `.catch` guards demonstrably prevent any W1a-attributable ETIMEDOUT runner crash.

## Proof of Work

| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | `ls .planning/kermit/reviews/{TEST-REVIEW,TEST-CATALOG,UX-REVIEW}.md TRACEABILITY.md` | TEST-REVIEW + TEST-CATALOG present; no UX-REVIEW (telly-only audit); no root TRACEABILITY.md (leg copy under .planning/kermit/juggler-h5-fixes/) |
| Read sources + test | gemini-tracked-call.js, GeminiAIAdapter.js, trackedCallTimeout.test.js, `git diff` both sources | post-fix code understood; pre-fix bug surface confirmed via diff |
| Baseline run | `DB_PORT=3407 npx jest --testPathPattern=trackedCallTimeout --verbose` | 6/6 GREEN post-fix |
| **M1 — remove timeout** | `Promise.race([callPromise,timeoutPromise])` → `await callPromise` in trackedGeminiCall; re-run; revert | **B3a + B1a FAIL** (B3a hang→500ms ceiling; B1a no deadline). B2a/guards stay green. Reverted clean. |
| **M2 — remove signal injection** | SDK call `config: sdkConfig` → `config`; re-run; revert | **B2a FAILS** (`Expected constructor: AbortSignal`). Only B2a. Reverted clean. |
| **M3 — adapter ignores env** | adapter `envBudget = DEFAULT(45000)` ignoring `env.AI_CALL_TIMEOUT_MS`; re-run; revert | **B1a FAILS** (`Resolved to value: {"text":"slow-ok"}` — telly's exact pre-fix message). Only B1a. Reverted clean. |
| **M4 — leak signal into telemetry** | enqueue `modelParams: config` → `sdkConfig`; re-run; revert | **B2b GUARD FAILS** (`toEqual(originalConfig)` + `not.toHaveProperty('abortSignal')`). Guard is real. Reverted clean. |
| Fake-timer check | `grep useFakeTimers/advanceTimers tests/.../trackedCallTimeout.test.js` | NONE — real wall-clock timers; 30ms/50ms deadlines genuine |
| Direct-caller check | grep `trackedGeminiCall(` in test | B3a/B2a/B2b call trackedGeminiCall DIRECTLY (lines 202/316/363); B1a via `adapter.generate` (line 114) — B3 exercises trackedGeminiCall's own timeout, not adapter's |
| Shallow-assertion grep | `grep toBeDefined/toBeTruthy/.skip/.todo/expect(true)` | 1 `toBeDefined()` (line 330) — precondition guard before real `toBeInstanceOf(AbortSignal)`; not tautological |
| aiEnrichment suites | `DB_PORT=3407 npx jest --testPathPattern=aiEnrichment` | 4 suites / 70 tests GREEN (goldenMaster, e2-globalShared, geminiAdapterTimeout, trackedCallTimeout) |
| FULL suite | `cd test-bed && make test-juggler` (MySQL 3407 UP) | 171 passed / 22 failed suites; 3217 passed / 70 failed tests; runner crash from `usage-reporter.js:92` |
| Crash attribution | grep run output for `Gemini call timed out`/gemini ETIMEDOUT | ZERO gemini-tracked-call ETIMEDOUT in entire run — bert's `.catch` guards hold. Crash is `usage-reporter.js` flush timer post-teardown (NOT in W1a diff) |
| W1a diff scope | `git diff --name-only HEAD` | only gemini-tracked-call.js, GeminiAIAdapter.js (+ docs). usage-reporter.js NOT touched |
| Pre-existing proof | `git stash` W1a → run `validate-task-input`+`scheduleQueueClaiming` baseline → pop | Both FAIL identically without W1a (3 failed) → pre-existing, not W1a |
| Tree clean | `diff -q` both sources vs post-fix backups; `git status` | both CLEAN; only expected W1a `M` files; 6/6 still green; backups removed |
| Output written | Write .planning/kermit/reviews/ZOE-REVIEW.md | Done |

### Mutation → Test mapping (the adversarial core)

Each fix piece was independently reverted; the matching RED test went RED and the non-matching ones stayed GREEN. This proves each test pins a *distinct* behavior — none is a tautology or accidental pass.

| Fix piece reverted | B1a | B3a | B2a | B2b | Conclusion |
|---|---|---|---|---|---|
| M1: Promise.race timeout removed | **RED** | **RED** | green | green | Timeout enforcement genuinely lives in trackedGeminiCall; both deadline-tests depend on it |
| M2: abortSignal injection removed | green | green | **RED** | green | B2a uniquely pins SDK-boundary signal injection |
| M3: adapter ignores AI_CALL_TIMEOUT_MS | **RED** | green | green | green | B1a uniquely pins the env→adapter→budget path |
| M4: sdkConfig leaked to enqueue | green | green | green | **RED** | B2b guard uniquely pins telemetry byte-identity |

## Proof Checklist

- [x] --mode present; recorded in header (bugfix)
- [x] Required inputs present — TEST-REVIEW.md + TEST-CATALOG.md present; no UX-REVIEW (telly-only); root TRACEABILITY.md absent (leg copy noted)
- [x] Shallow-assertion grep run; examined — 1 `toBeDefined()` precondition guard (not tautological)
- [x] Assertion-free test grep run — 10 `expect()` across 6 tests; every test asserts
- [x] At least one suspect test re-executed — full trackedCallTimeout suite re-run multiple times
- [x] Suspect-selection applied — all 3 RED tests + B2b guard challenged (bugfix regression tests = rank-3 risk; this leg = AI data-mutation/telemetry path)
- [x] SPOT-MUTATION executed on ≥1 suspect — **4 mutations** (M1–M4), each matching test went RED, non-matching stayed GREEN; tree reverted clean (git status + diff -q verified)
- [x] Mock-hides-bug grep run — enqueue mocked (`mockEnqueueFn`); B2b asserts the CODE's transform (original config passed through) not the mock's echo. capturingClient (B2a) captures real SDK params. No mock-asserting-itself. aiRateLimiter mocks trackedGeminiCall fully → does NOT exercise W1a (its failures are unrelated 429 assertions)
- [x] Snapshot-triviality + tautology grep — `toMatchSnapshot` 0 hits; no `expect(x).toEqual(x)` self-comparison. B2b uses `toEqual(originalConfig)` (distinct object) — proven real by M4
- [x] Mode-specific (bugfix) challenge applied — for each RED test, confirmed it FAILS on pre-fix code by mutating each fix piece back to its pre-fix behavior; B1a failure message byte-matches telly's reported pre-fix output
- [x] Error/negative-path audit — timeout path (ETIMEDOUT) is the error path under test; hanging-client + slow-client + abort-on-timeout covered. Edge gaps (concurrent calls, signal-ignoring SDK) noted by telly as out-of-scope for Step 0 — acceptable, INFO only
- [x] Bird PASS verdicts — N/A, no UX-REVIEW (telly-only leg)
- [x] Bird a11y re-verify — N/A (no UX-REVIEW)
- [x] Flake re-run — trackedCallTimeout re-run ≥4× across the mutation cycles + baseline; deterministic GREEN every clean run; B3a's 51-54ms timing well within its 500ms ceiling — no flake
- [x] Severity-calibration audit — telly filed 3 INFO (known pre-fix bugs, now fixed) — correct. No BLOCK-as-WARN mis-rating. Full-suite 70 failures: zoe confirms pre-existing (baseline stash proof) — correctly NOT attributable to W1a
- [x] Each finding carries file:line + severity
- [x] Flag-and-refer emitted (usage-reporter crash → ernie; broad pre-existing suite failures → telly/oscar)
- [x] Rubric Coverage Map emitted — all 9 dimensions marked
- [x] Proof of Work populated with actual commands + results
- [x] Status set: DONE
- [x] ZOE-REVIEW.md written
- [x] Scooter — not needed; behavior specs came from prompt + code + telly's catalog; "aiRateLimiter known pre-existing" supplied in prompt context. No settled question relitigated
- [x] Knowledge changes — none (audit only; no requirement/standard/approach changed)

## Findings

### Telly Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| — | — | — | No BLOCK/WARN. All 3 RED tests are genuine repros (M1/M2/M3 confirm each fails on the matching pre-fix mutation, isolating distinct behaviors). B2b guard is genuine (M4 confirms it fails when telemetry is polluted). No tautologies, no fake timers masking a non-firing deadline, no mock asserting itself. | — |
| 1 | INFO | trackedCallTimeout.test.js:330 | `expect(sdkConfig).toBeDefined()` is a precondition guard preceding the real `toBeInstanceOf(AbortSignal)` (line 332). Acceptable — not the load-bearing assertion. | None — informational |
| 2 | INFO | trackedCallTimeout.test.js (B3a, 500ms ceiling) | RED proven via Jest's test-timeout-as-failure mechanism rather than an explicit rejection assertion on pre-fix code. This is a valid (and telly-documented) RED mode, but it couples the repro to the runner's ceiling. Post-fix it asserts ETIMEDOUT explicitly (verified GREEN at 51ms). Acceptable. | None — informational |
| 3 | INFO | Coverage Map "Edge Case Coverage: partial" | Concurrent calls + signal-ignoring SDK version not covered. Telly scoped these out for Step 0; the belt-and-suspenders Promise.race already covers the signal-ignoring case behaviorally. No action required this leg. | None |

### Bird Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| — | — | — | No UX-REVIEW.md present — telly-only leg (internal timeout/telemetry wiring, no UI surface). Nothing to audit. | — |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→ernie | src/lib/usage-reporter.js:66,92 | Full-suite runner crash: `flush` timer (`AbortSignal.timeout(30000)` in `usage-reporter.js:66`) fires ~30s after Jest teardown → `import after environment torn down` → then `libUsageReporterLogger.warn` on undefined logger (line 92) crashes the Node process. Pre-existing (not in W1a diff); triggered by `app.test.js` + `aiRateLimiter.test.js`. Out of zoe's column — production/test-infra resource-management. |
| 2 | INFO | REFER→telly / oscar | full suite | 22 failed suites / 70 failed tests on `make test-juggler` (cal-sync, scheduler, task adapters, validate-task-input, etc.). Confirmed PRE-EXISTING via `git stash` baseline (validate-task-input + scheduleQueueClaiming fail identically without W1a). None reference W1a source except aiRateLimiter (which fully mocks `trackedGeminiCall`, so its 2 failures are unrelated 429-assertion failures). These are NOT W1a regressions but the leg's green-bar claim ("240/240") is far narrower than the full-suite reality — telly/oscar should reconcile the suite's baseline red. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | M1–M4 prove each assertion is load-bearing: reverting the matching fix piece flips exactly the right test RED. B1a checks resolved-vs-rejected + `{code:'ETIMEDOUT'}`; B2a checks `instanceof AbortSignal`; B2b checks `toEqual` + property absence. | No `toBeTruthy`/`toBeDefined`-only assertions on the meaningful path |
| Edge Case Gaps | partial | Covered: env=10ms, env omitted, hanging client, fast client, abort-on-deadline, signal presence/absence. Uncovered: concurrent calls, signal-ignoring SDK (behaviorally covered by Promise.race). | Telly-scoped-out for Step 0 — acceptable; INFO #3 |
| Test Gaps | covered | 6 tests cover all 3 bug surfaces (B1 env-budget, B2 signal injection + telemetry separation, B3 timeout altitude) with RED+GUARD pairs. | aiEnrichment 70/70 green |
| UX Gaps | n/a | No UI surface; telly-only leg, no UX-REVIEW. | — |
| Security Gaps | covered | No security seam touched. abortSignal/telemetry separation has no auth/payment dimension. No elmo REFER→zoe. | — |
| Documentation Gaps | covered | Source comments accurately describe the B2 invariant and timer.unref rationale; telly's TEST-CATALOG matches actual test behavior. | — |
| Architecture Gaps | covered | Timeout correctly relocated to trackedGeminiCall (the SDK-call chokepoint); adapter reduced to passing timeoutMs via meta. Signal injected at SDK boundary only — telemetry byte-identity preserved (M4 proves). | — |
| Review Quality | covered | All 3 RED tests + the B2b guard challenged via independent mutation; full suite re-run; pre-existing failures proven via stash baseline. No high-risk test left unchallenged. | — |
| False Passes | covered | Zero false-GREEN. No fake timers (real wall-clock). B3a exercises trackedGeminiCall's OWN timeout (direct call, not adapter). B2b is a real guard, not an echo of a mock. No W1a-attributable ETIMEDOUT crash (bert's `.catch` holds). | — |

## Sign-off
Signed: Zoe — 2026-06-11T00:00:00Z

---

# Zoe Review — juggler-h5-fixes W1b (B4 phantom-enqueue + B5 quota check/commit split) — bugfix — 2026-06-12

## Status: ISSUES

_Adversarial mutation audit of bert's W1b GREEN (B4 timeout-abort enqueue suppression; B5 quota check/commit split). 6/6 mutations executed; tree reverted clean. B4 fully pinned. B5 repository-level fully pinned. **BLOCK-1: the B5 controller-level fix — the actual bug location per TRACEABILITY.md (`ai.controller` quota-on-timeout) — is COMPLETELY UNPINNED.** Mutating the controller to `commitQuota` BEFORE `callGemini` (the exact B5 bug) leaves all 97 relevant tests GREEN. The B5 regression test does not exercise the controller it claims to protect._

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | `ls TEST-REVIEW.md TEST-CATALOG.md` + read 4 target files | present; mode=bugfix |
| Baseline run | `DB_PORT=3407 jest --testPathPattern=timeoutAbortConsequences` | 3/3 GREEN (B4-red, B5-red, B5-guard) |
| Shallow-assert grep | `grep expect(true)/toBeTruthy/toBeDefined/skip/todo` on B5 test | 0 hits; only legit `mockEnqueueFn` spy |
| **M1 — B4 unconditional enqueue** | mutate `if(!timedOut)`→`if(true)`; run B4-red | **RED** — enqueue 1×, expected 0 → mutant KILLED. B4 suppression PINNED |
| **M2 — B4 over-broad suppression** | mutate `if(!timedOut)`→`if(false)`; run goldenMaster B3.2 error-path | **RED** — enqueue 0×, expected 1 → KILLED. Lost-error-telemetry PINNED by goldenMaster.h5.test.js:816/830 |
| **M3 — B5 controller commit-before-call** | swap `commitQuota` to BEFORE `callGemini` in controller; run timeoutAbort + goldenMaster + ai-command (97 tests) | **STAYS GREEN — 97/97 pass.** B5-red does NOT drive the controller → commit-placement regression UNPINNED → **BLOCK** |
| **M4 — B5 no-op commitQuota** | mutate `commitQuota` insert→no-op; run B5-guard | **RED** — 0 rows, expected 1 → KILLED. Insert PINNED |
| **M5 — B5 double-insert commitQuota** | add 2nd insert; run B5-guard | **RED** — 2 rows, expected 1 → KILLED (`toHaveLength(1)` exact). Double-count PINNED |
| **M6 — B5 checkQuota inserts** | add insert to `checkQuota`; run B5 suite | **RED** — B5-red + B5-guard both fail (rowsAfterCheck=1, expected 0) → KILLED. Count-only contract PINNED |
| Flake re-run | B4/B5 ×2 | 3/3, 3/3 — deterministic, no flake |
| W1b suites (harness) | `make test-juggler` grep aiEnrichment/ai-command | 6/6 suites PASS, 97 tests; ZERO W1b FAILs |
| Pre-existing crash attribution | `make test-juggler` ×3 on SAME clean (stashed) baseline | **136 → 54 failed across identical runs — harness is non-deterministic under parallel 3407 contention**; W1b-vs-baseline delta is noise, not regression |
| aiRateLimiter attribution | restore committed (pre-W1b) controller, run aiRateLimiter | same 2 FAILs on pre-W1b code → **pre-existing, not W1b** |
| Tree cleanup | revert all 6 mutations + restore W1b (manual Edit + stash pop) | `grep MUTATION` empty; diffs match W1b (+139/-28); 97/97 GREEN |
| Output written | append `.planning/kermit/reviews/ZOE-REVIEW.md` | Done |

## Proof Checklist
- [x] --mode present; recorded (bugfix)
- [x] Required inputs present (TEST-REVIEW.md + TEST-CATALOG.md) — UX-REVIEW absent (telly-only leg, noted)
- [x] Shallow-assertion grep run; 0 hits on B5 test (only legit enqueue spy)
- [x] Assertion-free grep run; none
- [x] Suspect tests re-executed (B4-red, B5-red, B5-guard, goldenMaster B3.2)
- [x] Suspect-selection risk-ordered: B5 (data-mutation/quota = highest blast radius) first, then B4 (billing telemetry), then error-telemetry guard
- [x] SPOT-MUTATION executed on 6 mutants; results recorded; **M3 still-passing = BLOCK**; tree reverted clean (git status verified)
- [x] Mock-hides-bug: only mock is `mockEnqueueFn` spy whose CALL COUNT is asserted (not its return) — legitimate. B5 uses REAL test-bed DB (3407), no mock-hidden seam
- [x] Snapshot-triviality + tautology grep: none; `toHaveLength`/`toHaveBeenCalledTimes` are exact, non-tautological
- [x] Mode-specific (bugfix) challenge: would each regression test FAIL on pre-fix code? B4-red YES (M1). B5-guard YES (M4). **B5-red for the CONTROLLER bug: NO (M3) — does not reproduce the controller-level bug**
- [x] Error/negative-path audit: genuine provider error → enqueue MUST fire — covered by goldenMaster B3.2 (M2 confirms)
- [ ] Bird PASS verdicts — N/A (no UX-REVIEW; telly-only leg)
- [ ] Bird a11y re-verify — N/A
- [x] Flake re-run ≥2× on suspects (B4/B5 deterministic) AND on full harness (proved non-deterministic — noise)
- [x] Severity-calibration audit: telly's B5-red mutation note ("call commitQuota after timeout → KILLED") is FALSE — re-rated as BLOCK against the test's protective claim
- [x] Each finding carries file:line + severity
- [x] Flag-and-refer emitted
- [x] Rubric Coverage Map emitted — all 9 dimensions
- [x] Proof of Work populated with actual commands
- [x] Status set: ISSUES
- [x] ZOE-REVIEW.md written
- [x] Scooter: not needed — bug spec from prompt + TRACEABILITY.md + code read; no unsettled knowledge
- [x] Knowledge changes: none

## Findings

### Telly Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| 1 | **BLOCK** | `tests/unit/aiEnrichment/timeoutAbortConsequences.test.js:252-292` (B5-red) | B5-red claims to protect "timed-out call must NOT consume quota slot" but NEVER invokes `ai.controller.handleCommand` — it instantiates `KnexAIUsageRepository` directly, calls `checkQuota`, and "models the timeout by simply NOT calling commitQuota" (line 281). **Mutating the controller to `commitQuota` BEFORE `callGemini` (the exact B5 bug — TRACEABILITY.md root cause `ai.controller` quota-on-timeout) leaves all 97 tests GREEN (M3).** The controller's success-only commit placement — the actual fix — is unpinned. Telly's mutation note ("call commitQuota after timeout → 1 row → KILLED") is FALSE: that mutant survives. | Add a controller-level (or facade-level) regression: drive `handleCommand` with a Gemini call that throws ETIMEDOUT, assert `commitQuota` NOT called / 0 rows in `ai_command_log`; and a success path asserting exactly 1 row. Must FAIL on commit-before-call. |
| 2 | WARN | `tests/api/ai-command.test.js:537` ("returns 500 when Gemini call throws") | The one test that drives the real controller through a thrown Gemini call asserts ONLY `res.status===500` — no assertion that the quota slot was not consumed. With commit-before-call mutation it still passes. Compounds BLOCK-1: even the existing controller test cannot observe quota burn on error. | Extend to spy `commitQuota`/`ai_command_log` and assert no slot consumed on the 500 path. |
| 3 | INFO | `gemini-tracked-call.js:64` | B4 suppression keyed on `timedOut` flag (set synchronously by the timer before `controller.abort()`), NOT `err.code==='ETIMEDOUT'` as telly's original RED-proof text described. Mechanism is sound and superior (no dependence on the error propagating), but telly's TEST-REVIEW narrative (line 43) misdescribes the implemented fix. | Doc-only; bert's mechanism is correct. |

### Cleared by mutation (genuinely pinned)
- B4 enqueue-suppression: M1 (unconditional→RED) + M2 (over-broad→RED via goldenMaster B3.2). Both timeout-suppression AND error-telemetry-preservation pinned.
- B5 repository contract: M4 (no-op commit→RED), M5 (double-insert→RED, exact `toHaveLength(1)`), M6 (check inserts→RED). `commitQuota` insert + `checkQuota` count-only fully pinned at the repo layer.

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→telly | full `make test-juggler` harness | Suite is non-deterministic: 281/136/54 failed across identical runs (parallel DB contention on shared 3407 + `usage-reporter.js:92` undefined-`warn` + `TaskStatus.js:34` undefined-`slice` module-resolution crashes). Pre-existing, NOT W1b — but the flaky full-suite gate cannot reliably attribute regressions. Worth a serial/isolated-DB harness fix. |
| 2 | INFO | REFER→ernie | `ai.controller.js:57,101` | Controller correctness (commit ordering) is sound as written; the gap is test coverage (BLOCK-1), not production logic. Noting for ernie's awareness that the fix is correct but unprotected. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | All assertions load-bearing: M1/M2/M4/M5/M6 each flip exactly the right test RED. `toHaveBeenCalledTimes(0)`, `toHaveLength(0/1)` — exact, non-tautological. | B4 + B5-repo solid |
| Edge Case Gaps | partial | Covered: timeout path, success path, over-limit, check-no-insert, genuine-error telemetry. **Gap: controller-level timeout→no-commit (BLOCK-1).** Uncovered (telly-scoped): TOCTOU concurrent (B11). | |
| Test Gaps | **gap** | B5 regression does not exercise the controller it protects (BLOCK-1). The success-only commit branch — the literal fix — has zero pinning test. | The single highest-value gap |
| UX Gaps | n/a | No UI surface; telly-only leg, no UX-REVIEW. | — |
| Security Gaps | covered | No auth/payment seam in quota accounting beyond per-user count; B5 uses real DB. No elmo REFER→zoe. | quota=billing-adjacent but no new attack surface |
| Documentation Gaps | partial | Telly TEST-REVIEW line 43 misdescribes B4 mechanism (`err.code` vs `timedOut` flag) and B5-red mutation note (line 211-214) overstates kill — that mutant survives (M3). | Findings #1, #3 |
| Architecture Gaps | covered | check/commit split correctly placed: `checkQuota` read-only at repo, `commitQuota` after `callGemini` resolves in controller. Hexagonal boundary clean (facade→port→adapter). | |
| Review Quality | covered | All 3 regression tests + B3.2 guard independently mutated; full harness re-run ×3; pre-existing failures proven via stash baseline + committed-controller restore. No high-risk test left unchallenged. | |
| False Passes | **gap** | **B5-red is a confirmed false-pass for the controller bug (BLOCK-1):** GREEN while the actual bug (commit-before-call) is present. B4 + B5-repo have zero false passes. | The false-pass zoe exists to catch |

## Sign-off
Signed: Zoe — 2026-06-12T00:00:00Z

---

# Zoe Review — juggler-h5-fixes W1b fix-loop (BLOCK-1 re-confirmation) — bugfix --re-review — 2026-06-12

## Status: DONE

_BLOCK-1 is GENUINELY CLOSED. telly's controller-level pin (AP-72g) was independently confirmed by REAL source mutation — not spy-logic cross-verification. I mutated `ai.controller.handleCommand` to commit quota BEFORE `callGemini` (the literal B5 bug): **B5-controller-pin went RED** (`commitQuotaSpy` expected 0 calls, received 1). I removed the WARN-2 try/catch: **B5-warn2 went RED** (expected 200, received 500). The claimed Babel/curly-quote encoding constraint does NOT exist — the Edit tool inserted the mutation line cleanly on the first attempt. The spy genuinely intercepts the controller's real call path (M1 RED proves interception). Both prior BLOCK-1 and WARN-2 mutants are now killed. 99/99 W1b suites + 26/26 ai-command GREEN, deterministic._

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Read sources | ai.controller.js (full), ai-command.test.js (AP-72g lines 502-605), facade.js | Spy targets `aiEnrichment.commitQuota` (facade module-export prop); controller (line 16) + test (line 531) require the SAME cached facade module → spy interception is structurally valid |
| Baseline | `DB_PORT=3407 jest -t "AP-72g"` | 2/2 GREEN (B5-controller-pin, B5-warn2) |
| **M1 — REAL commit-before-call mutant** | Inserted `await aiEnrichment.commitQuota(userId)` BEFORE `const raw = await callGemini(...)` via Edit (NO encoding/Babel error — clean first try); re-run AP-72g | **B5-controller-pin RED** — `expect(commitQuotaSpy).not.toHaveBeenCalled()` → Expected 0, Received 1. **MUTANT KILLED.** Spy proven to intercept the controller's real call (point #3 ✓). B5-warn2 also RED (incidental — commit now runs first). Reverted. |
| **M2 — WARN-2 try/catch removal (isolated)** | Replaced the `try { commitQuota } catch { logger.warn }` block with a bare unguarded `await aiEnrichment.commitQuota(userId)`; re-run AP-72g | **B5-warn2 RED** — Expected 200, Received 500 (commitQuota throws → outer catch → 500). **MUTANT KILLED.** B5-controller-pin STAYED GREEN (Gemini throws first, never reaches commit) → the two tests pin DISTINCT behaviors. Reverted. |
| Spy robustness (point #3) | No `jest.mock` on the facade anywhere in the test; only `jest.spyOn(aiEnrichment,'commitQuota')` on the real cached singleton (lines 551/585). `beforeEach` clearAllMocks + `afterEach` restoreAllMocks; spy created fresh per-test → no leakage/wrong-object | Spy is on the correct shared object; M1 RED is the empirical proof it fires on the controller path. Not a false-pass. |
| Post-revert | `grep ZOE-MUTATION` controller; `git diff` controller | 0 markers; diff = clean W1b fix (+17/-2: checkQuota/commitQuota split + try/catch), no zoe residue |
| Flake re-run | AP-72g ×2 post-revert | 2 passed / 2 passed — deterministic |
| Full ai-command suite | `DB_PORT=3407 jest --testPathPattern="api/ai-command"` | 26/26 GREEN |
| W1b aiEnrichment suites | `DB_PORT=3407 jest --testPathPattern="aiEnrichment\|api/ai-command"` | **6 suites / 99 tests GREEN** (goldenMaster, e2-globalShared, timeoutAbortConsequences, trackedCallTimeout, geminiAdapterTimeout, ai-command) — telly's exact count; ZERO W1b FAILs |
| Harness note | `make test-juggler` syncs `.worktrees/test` to committed submodule HEAD (lacks uncommitted W1b); direct `DB_PORT=3407` run uses the SAME `ra-mysql-test` (3407) container | Direct jest run IS the authoritative test of the actual W1b working-tree code; full harness non-determinism is documented pre-existing (prior review: 281/136/54) and not W1b |
| Tree clean | `grep ZOE-MUTATION` + `git status --short` | 0 markers; only expected W1b `M` files; no zoe edit to test or source |
| Output written | append `.planning/kermit/reviews/ZOE-REVIEW.md` | Done |

## Proof Checklist
- [x] --mode present; recorded (bugfix --re-review)
- [x] Required inputs present — prior ZOE-REVIEW.md (BLOCK-1) + target files (ai.controller.js, ai-command.test.js); no UX-REVIEW (telly-only leg)
- [x] Shallow-assertion grep — N/A this re-review; AP-72g assertions are exact (`not.toHaveBeenCalled`, `toBe(500)`, `toBe(200)`, `toBe('Done from AI.')`) — non-tautological
- [x] Suspect selected risk-ordered — AP-72g (quota = data-mutation/billing-adjacent, highest blast radius; the literal BLOCK-1 surface) — only suspect, the re-review target
- [x] **SPOT-MUTATION executed on REAL SOURCE (not spy-logic): M1 commit-before-call → B5-controller-pin RED (mutant KILLED); M2 try/catch removed → B5-warn2 RED (mutant KILLED). Both reverted; tree clean (grep + git status).**
- [x] Babel/encoding claim DISPROVEN — Edit inserted/removed mutation lines on first attempt with no error; the curly quotes live only in the untouched `scopeConstraint` string (line 90), unrelated to lines 97/106
- [x] Spy-robustness verified (point #3) — spy on real cached facade singleton (same module the controller requires); M1 RED empirically proves interception of the controller call path; no rival jest.mock; no per-test leakage
- [x] Mode-specific (bugfix) challenge — would the pin FAIL on the pre-fix/buggy controller? YES: M1 (commit-before-call) RED, M2 (no error-isolation) RED. The regression tests genuinely reproduce both the B5 bug and the WARN-2 bug.
- [x] Distinct-behavior check — M2 left B5-controller-pin GREEN; M1 isolation shows each test pins its own behavior, not a coupled/tautological pair
- [x] Flake re-run ≥2× — AP-72g 2/2 GREEN post-revert; deterministic
- [x] Suites GREEN with exact counts — 6 suites / 99 tests (aiEnrichment+ai-command); 26/26 ai-command; no new crash
- [x] Each finding carries file:line + severity
- [x] Status set: DONE
- [x] ZOE-REVIEW.md written (appended)
- [x] Scooter — not needed; bug spec from prior ZOE-REVIEW BLOCK-1 + code; no unsettled knowledge
- [x] Knowledge changes — none (audit only)
- [ ] Bird PASS / a11y — N/A (no UX-REVIEW; telly-only leg)

## Findings

### Telly Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| — | — | `tests/api/ai-command.test.js:538-604` (AP-72g) | **BLOCK-1 CLOSED.** The controller-level pin is GENUINE, not spy-theater. M1 (real `commitQuota`-before-`callGemini` source mutation) drives `B5-controller-pin` RED — the exact bug telly previously failed to pin at the controller is now killed. M2 (real try/catch removal) drives `B5-warn2` RED. The spy intercepts the controller's real call path (empirically proven by M1). The two tests pin distinct behaviors (M2 leaves the pin GREEN). No tautology, no false-pass. telly's only mis-statement was claiming a Babel encoding constraint blocked source mutation — it does not exist (Edit worked first try) — but telly's spy-logic conclusion was nonetheless CORRECT and the test is sound. | None — BLOCK-1 resolved. (Optional INFO: telly's "encoding constraint" note in their report is inaccurate; the pin holds regardless.) |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→telly | telly TEST-REVIEW (encoding-constraint claim) | telly reported a Babel/non-ASCII-curly-quote constraint blocked inserting a controller mutation line, so used spy-logic cross-verification instead. That constraint is not real — zoe inserted the mutation cleanly via Edit. Harmless (the pin is genuine), but the report's rationale is inaccurate; telly should correct the narrative. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | M1/M2 prove both AP-72g assertions are load-bearing — each flips exactly one test RED under the matching real-source mutant | `not.toHaveBeenCalled` + `toBe(500/200)` exact |
| Edge Case Gaps | covered | Controller timeout→no-commit (was BLOCK-1) NOW pinned; commitQuota-DB-error→200 (WARN-2) pinned | the prior gap is closed |
| Test Gaps | covered | AP-72g supplies the missing controller-level regression; M1/M2 confirm it exercises the real controller path | prior "gap" resolved |
| UX Gaps | n/a | telly-only leg, no UX surface | — |
| Security Gaps | covered | quota=billing-adjacent; pin now protects against double/early quota burn on error | no new attack surface |
| Documentation Gaps | partial | telly's encoding-constraint claim is inaccurate (Flag-and-Refer #1); controller source comments accurately describe B5+WARN-2 | doc-only |
| Architecture Gaps | covered | check/commit split correctly placed; commit success-only + error-isolated; both pinned at controller | — |
| Review Quality | covered | BLOCK-1 re-challenged by REAL source mutation (not re-reading); both mutants killed; flake re-run; exact suite counts | the prior false-pass is now genuinely closed |
| False Passes | covered | **Zero remaining false-pass.** The prior B5 controller false-pass (BLOCK-1) is eliminated — AP-72g goes RED on the literal bug. WARN-2 also pinned. | the false-pass zoe existed to catch is now closed |

## Sign-off
Signed: Zoe — 2026-06-12T12:00:00Z

---

# Zoe Review — juggler-h5-fixes W2a (B6/B7/B8/B9 adapter lifecycle) — bugfix — 2026-06-12

## Status: ISSUES

_Adversarial mutation-test of telly's 4 RED tests (B6/B7/B8/B9) + bert's fixes. B6/B7/B8 genuinely pin their fixes (each goes RED under a real-source mutant). **B9 is a confirmed test-passes-but-real-goal-unmet false-pass: it pins the CONSTRUCTOR throw, but the adapter is built lazily on first request — never at boot — so the stated "fail-fast-at-boot" requirement is NOT met.** Empirically verified: a bad NODE_ENV boots green and 500s on the first AI call. Plus a B6 negative-path gap (no test proves a REAL error still surfaces). All 4 mutations reverted; tree clean; 108/108 GREEN._

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | `ls TEST-REVIEW.md TEST-CATALOG.md` (telly-only; no UX-REVIEW — expected) | present |
| Baseline run | `DB_PORT=3407 NODE_ENV=test jest adapterLifecycle --verbose` | 9/9 GREEN |
| M1 — B6 mutate | commented `if(!this.isConfigured()) return {}` (`false &&`) in GeminiAIAdapter.generate | **B6-red → RED** (mockErrorSpy called 1, expected 0) — PINS |
| M2 — B7 mutate | commented `if(!result) throw` (`false &&`) in ai.controller.callGemini | **B7-red → RED** ("Cannot read properties of null (reading 'text')") — PINS, structured-msg assertion real |
| M3 — B8 mutate | replaced `this._client && _cachedApiKey===currentKey` with `this._client` (no key cmp) | **B8-red → RED** (GoogleGenAI called 1, expected 2) — PINS |
| M4 — B9 mutate | removed eager NODE_ENV validation throw from constructor | **B9-red → RED** ("Received function did not throw") — pins CONSTRUCTOR throw only |
| B9 boot-vs-call probe | `NODE_ENV=zoe_bogus_env node -e "require(facade);require(ai.controller)"` then `facade.generate()` | **BOOT-REQUIRE succeeded** (no throw at boot); constructor threw only on FIRST generate() call |
| B9 construction-site grep | `grep "new GeminiAIAdapter" src/` | only `facade.js:37` — lazy, inside `ai()`, called from `generate()`. No boot-time construction anywhere. |
| B6 negative-path grep | `grep "toHaveBeenCalled" tests/` (positive logger.error assertions) | **none** — no test proves a real (post-isConfigured) error still logs |
| Mutations reverted | `grep ZOE-MUTATION src/` + guard-line confirm | NONE remaining; all 4 guards restored to bert's originals |
| Full suite | `DB_PORT=3407 NODE_ENV=test jest "(aiEnrichment|ai-command)"` | **108/108 PASS, 7 suites** — no new crash |
| Tree clean | `git status` / grep | clean (no zoe edits) |

## Proof Checklist
- [x] --mode present (bugfix); recorded in header
- [x] Required inputs present (TEST-REVIEW.md + TEST-CATALOG.md; telly-only leg, no UX-REVIEW — noted)
- [x] Shallow-assertion grep run — assertions are exact (`not.toHaveBeenCalled`, `toHaveBeenCalledTimes(2)`, `toMatch(/.../)`, `toThrow(/.../)`); no `expect(true)`/`toBeDefined` theater
- [x] Assertion-free grep — every it/test block carries `expect()`
- [x] Suspect tests re-executed (baseline 9/9 GREEN; full 108/108 GREEN)
- [x] Suspect-selection: B9 prioritized (highest blast-radius — boot-fail-fast claim is the prompt's named risk); all 4 RED tests mutation-tested
- [x] SPOT-MUTATION on all 4 risk-ordered suspects: source mutated, test re-run, result recorded; B6/B7/B8 PIN; B9 pins constructor-only (false-pass on the real goal); tree reverted clean (git status verified)
- [x] Mock-hides-bug examined — B6/B7 use real controller+route via supertest (mock only at SDK/DB seam); B8/B9 instantiate real GeminiAIAdapter via DI; no mock-asserting-itself
- [x] Snapshot/tautology grep — none; no `toMatchSnapshot`, no `toEqual(x)` self-compare
- [x] Mode-specific (bugfix): each RED test mutation-verified to fail on the literal bug; B9's pre-fix-failure-mode (real goal) re-derived — does NOT reproduce the boot failure
- [x] Error/negative-path audit — B6 real-error-surfaces gap found (WARN-3)
- [x] Bird PASS challenged — N/A (telly-only leg, no UX-REVIEW)
- [x] Bird a11y re-verify — N/A
- [x] Flake re-run — full suite GREEN; counts deterministic across baseline + post-revert runs
- [x] Severity-calibration audit — telly filed B6/B7/B8/B9 as INFO (pre-fix targets, correct for authoring step); zoe re-rates the B9 *goal-unmet* as BLOCK against the fix, B6 negative-gap as WARN
- [x] Findings carry file:line + severity
- [x] Flag-and-refer emitted (B9 architecture/req → cookie/oscar; bert impl divergence)
- [x] Rubric Coverage Map emitted — no blank dimension
- [x] Proof of Work populated with actual commands + results
- [x] Status set: ISSUES
- [x] ZOE-REVIEW.md written (appended W2a section)
- [x] Scooter — not separately consulted; B9 requirement source is TRACEABILITY.md (read directly) which states the boot→first-request contract; no unsettled knowledge question
- [x] Knowledge changes — none authored by zoe

## Findings

### Telly / Bert Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| 1 | BLOCK | `adapterLifecycle.test.js:652-703` (B9-red) + `GeminiAIAdapter.js:64-73` + `facade.js:36-39` | **False-pass on the real goal.** B9's requirement (TRACEABILITY B9: "db resolve **boot→first-request**", fail-fast-at-boot) is NOT met. B9-red proves the *constructor* throws on bad NODE_ENV, but the facade builds the adapter **lazily on first `generate()` call** — `new GeminiAIAdapter()` only runs inside `ai()` (facade.js:37), which fires on the first AI request, never at boot. Empirically confirmed: `NODE_ENV=zoe_bogus_env` + requiring facade+controller (= server boot) **succeeds**; the throw fires only on first `generate()`. Real-world consequence is identical to the pre-fix lazy `_getDb()`: a misconfigured deploy boots green and 500s on the first AI request. The test pins constructor-throws, which is the wrong altitude for "fail-fast-at-boot." | EITHER (a) eagerly construct the adapter at server boot (e.g. `facade.warmup()` called in app/server bootstrap so the constructor throw surfaces at startup) and add a test asserting boot-require throws on bad NODE_ENV; OR (b) if first-call resolution is acceptable, correct the B9 requirement/AC + test name to drop the "boot"/"fail-fast" framing (it's "fail on first call inside constructor", not at boot). As-is, B9 is GREEN while the stated goal is unmet. |
| 2 | WARN | `GeminiAIAdapter.js:67-71` (B9 impl) | bert's B9 fix does NOT do the designed "eager `getDefaultDb()`" — it hardcodes `_validEnvs = ['development','production','test']` and throws on string non-membership, reading `process.env.NODE_ENV` (not `this._env`, inconsistent with every other env read in the adapter). B9-red therefore pins **bert's allowlist literal**, not real DB-config resolution. A NODE_ENV that IS in the list but has a broken/missing knexfile entry would pass the check yet fail later — the exact class of misconfig B9 claims to catch. | Make the constructor invoke the real DB-config resolver (or a real knexfile-keys probe) so the throw reflects actual config validity, not a hardcoded string list; read `this._env.NODE_ENV` for consistency. (Acknowledged: bert documented the jest.mock constraint that blocked the direct `getDefaultDb()` call — but that's a test-isolation problem to solve, not a reason to pin a literal.) |
| 3 | WARN | `adapterLifecycle.test.js:311-411` (B6) | **Negative-path gap.** Both B6 tests assert `mockErrorSpy.not.toHaveBeenCalled()` (not-configured + success). NO test asserts a REAL error (after `isConfigured()` passes — e.g. SDK/network failure on a configured deploy) STILL logs/surfaces. The B6 not-configured short-circuit is currently narrow (keyed on env presence, verified by reading `generate()`/`isConfigured()` — real errors DO propagate to the route catch and log), so this is not a present-tense swallow. But there is no regression guard: a future broadening of `isConfigured()` or the `generate()` early-return to swallow on error would go undetected. | Add a B6 companion: configured adapter, `trackedGeminiCall` rejects with a real error → assert `mockErrorSpy` WAS called (real error surfaces / is not swallowed by the not-configured path). |

### Cleared Suspects (mutation-confirmed genuine pins)
| Test | Mutation applied | Result |
|------|------------------|--------|
| B6-red | `generate()` not-configured guard disabled | RED — mockErrorSpy 1≠0. Genuinely pins clean-no-op. |
| B7-red | `callGemini` null guard disabled | RED — exact TypeError "Cannot read properties of null (reading 'text')"; asserts structured `/Unexpected Gemini response structure/i` AND status 500 (not any-500). Genuinely pins. |
| B8-red | `_getClient` key comparison removed | RED — GoogleGenAI 1≠2. Asserts re-instantiation count AND new key (`toMatchObject({apiKey:'key-v2'})`) AND `client2 !== client1`. Genuinely pins live-invalidation. |
| B9-red | constructor eager validation removed | RED — "did not throw". Genuinely pins the **constructor throw** — but see BLOCK-1: constructor-throw ≠ boot-fail-fast. |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→cookie | `facade.js:36-39` + `GeminiAIAdapter.js:55-73` | Architectural: "fail-fast-at-boot" cannot be satisfied by a lazy-singleton facade + constructor throw. The boot-vs-first-call seam (whether to warm the adapter at startup) is an arch decision — out of zoe's column. Pairs with BLOCK-1. |
| 2 | INFO | REFER→oscar | TRACEABILITY.md B9 / acceptance | B9 acceptance criterion ("db resolve boot→first-request") and the authored test (constructor-throws) are mismatched in altitude. Oscar should decide: fix the impl to truly boot-fail-fast, or correct the AC to match what was built. |
| 3 | INFO | REFER→ernie | `GeminiAIAdapter.js:67` | Constructor reads `process.env.NODE_ENV` while the rest of the adapter reads `this._env.*` — env-source inconsistency (DI-injected env ignored for the NODE_ENV check). Production-logic nit, out of zoe's column. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | M1/M2/M3/M4 each flip exactly one RED test under the matching real-source mutant; assertions are exact-count / exact-message / exact-throw, not `toBeDefined` | B6/B7/B8 fully load-bearing; B9 load-bearing for the constructor (wrong target) |
| Edge Case Gaps | partial | Covered: not-configured, null result, key rotation, invalid NODE_ENV-at-construction. GAP: real-error-still-surfaces (B6, WARN-3); boot-time misconfig (B9, BLOCK-1) | two negative/altitude gaps |
| Test Gaps | partial | B9 has no boot-level test (the actual requirement); B6 has no positive-logger.error test | BLOCK-1 + WARN-3 |
| UX Gaps | n/a | telly-only leg, no UX surface | — |
| Security Gaps | covered | B8 live-invalidation closes a stale-key window (rotated/leaked key kept in use); pinned. No new attack surface in B6/B7/B9 | — |
| Documentation Gaps | partial | B9 fix comment (`GeminiAIAdapter.js:55-63`) claims "fails at boot" — inaccurate; it fails at first-call construction | doc claim contradicts runtime behavior (BLOCK-1 root) |
| Architecture Gaps | gap | Lazy-singleton facade means no boot-time adapter construction; "fail-fast-at-boot" is structurally unmet | REFER→cookie #1; BLOCK-1 |
| Review Quality | covered | All 4 RED tests re-challenged by REAL source mutation (not log-trust); B9 false-pass surfaced by an independent boot-vs-call runtime probe + construction-site grep, not by re-reading telly | the prompt's named B9 risk was specifically investigated |
| False Passes | gap | **1 confirmed false-pass on the real goal (B9, BLOCK-1):** test GREEN while "fail-fast-at-boot" is unmet. B6 has a latent-regression gap (WARN-3). B6/B7/B8 themselves are genuine pins. | the exact false-pass class zoe exists to catch |

## Sign-off
Signed: Zoe — 2026-06-12T13:30:00Z

---

# Zoe Review — juggler-h5-fixes W2a B9 re-confirmation (iteration 2, boot-contract rewrite) — bugfix --re-review — 2026-06-12

## Status: DONE

_**B9 IS GENUINELY CLOSED.** The prior false-pass (constructor-throws pinned, but lazy facade → never at boot) is eliminated. telly rewrote B9 to a real boot contract; bert added `facade.init()` (eager `getDefaultDb()` validation) + wired `await facade.init()` into `server.js start()` BEFORE `app.listen`. I confirmed all four prompt points by REAL source mutation + reading the wiring, not by trusting telly's GREEN:_

1. **B9-boot-red kills the mutant — point #1 PASS (both ways).** M1 (no-op `init()`, drops `getDefaultDb()`) → B9-boot-red RED. M2 (`init()` calls `getDefaultDb()` but `try/catch` swallows the throw) → B9-boot-red RED. The test pins that `init()` genuinely **propagates** the db-config failure, not merely that it calls something.
2. **B9-env-ok proves db-resolution, not string-allowlist — point #2 PASS.** M3 (re-add the old `['development','production','test']` NODE_ENV allowlist throw to `init()`) → B9-env-ok RED (`Rejected to value: [Error: Invalid NODE_ENV: staging_env_b9_telly_test]`). A regression to the wrong-altitude string check is caught; the bogus-NODE_ENV + resolvable-db case passes only because the fix validates real config resolution.
3. **The server.js boot wiring is REAL — point #3 PASS.** `juggler-backend/src/server.js:61` — `await require('./slices/ai-enrichment/facade').init();` sits inside `start()`, BEFORE `app.listen(PORT,...)` (line 63). `init()` awaits `getDefaultDb()`, which throws on bad config; the awaited throw rejects the `start()` promise; `start().catch()` (line 171-174) logs "Fatal startup error" and **`process.exit(1)`** — boot genuinely aborts, `app.listen` never reached. This is NOT the prior test-passes-goal-unmet class: the unit-tested `init()` is actually invoked at boot AND a throw aborts the process.
4. **Cross-suite contamination — could NOT reproduce; attributed PRE-EXISTING, NOT the new code.** See attribution below.

_All 3 mutations reverted; tree clean (no `ZOE-MUTATION` residue; `init()` restored to bert's original). adapterLifecycle 11/11 GREEN; all AI suites 7 suites / 110 tests GREEN; full juggler suite — adapterLifecycle PASSES._

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Read sources | facade.js (init), adapterLifecycle.test.js (B9 block 634-768), server.js (start + catch), lib/db/index.js (getDefaultDb) | Wiring + contract understood |
| Baseline | `DB_PORT=3407 NODE_ENV=test jest adapterLifecycle --verbose` | **11/11 GREEN** (B6×2, B7×3, B8×2, B9×4) |
| **M1 — init() no-op (drops getDefaultDb)** | `async init(){ return; }`; run B9 | **B9-boot-red RED** ("1 failed"); guards + env-ok stay GREEN (they mock getDefaultDb→resolve). Reverted. |
| **M2 — init() swallows throw** | `try{getDefaultDb()}catch{}`; run B9 | **B9-boot-red RED**; guards GREEN. Pins propagation, not just the call. Reverted. |
| **M3 — re-add NODE_ENV allowlist throw** | `if(!['development','production','test'].includes(NODE_ENV)) throw`; run B9 | **B9-env-ok RED** (`Rejected: Invalid NODE_ENV: staging_env_b9_telly_test`); boot-red + boot-guard stay GREEN. Reverted. |
| Wiring read (point #3) | `grep -n "facade.*init\|app.listen\|process.exit" server.js` | `init()` at line 61 (inside start, before listen line 63); `start().catch → process.exit(1)` at 171-174 — boot aborts on throw |
| getDefaultDb mechanism | read `lib/db/index.js:50-65` | throws `No database configuration found for environment: ${env}` when knexfile lacks the NODE_ENV key — real config-resolution, module-level cache (mocked in test, per-file registry → no cross-suite leak) |
| Module-state leak probe (point #4) | `grep _cachedApiKey/this._client GeminiAIAdapter.js`; `grep defaultDbCached lib/db` | B8 key-cache is **instance-level** (`this.`) — no leak. getDefaultDb cache is module-level but mocked per-file + facade `_reset()` in beforeEach/afterEach. New code introduces NO cross-suite shared state. |
| Contamination repro A | `jest "(aiEnrichment\|api/ai-command)"` ×3 (parallel) | **110/110 GREEN ×3** — deterministic, no B7-guard failure |
| Contamination repro B | `jest "(aiEnrichment\|api/ai-command)" --runInBand` | **110/110 GREEN** serial — no B7-guard failure |
| Contamination repro C | `jest "(adapterLifecycle\|aiRateLimiter\|api/ai-command)"` | adapterLifecycle **11/11 PASS**; the only 2 failures are inside `aiRateLimiter.test.js` (429 assertions) — pre-existing |
| Contamination repro D | full `jest` (entire juggler suite) | `PASS tests/unit/aiEnrichment/adapterLifecycle.test.js`; harness crash is the documented `usage-reporter.js:92` teardown + `aiRateLimiter` 429 + `taskMappers.js:155` source_id — all pre-existing, none in B9 diff |
| Tree clean | `grep -rn ZOE-MUTATION juggler-backend/`; `grep -A4 "async init()" facade.js` | NONE; init() body = bert's original (eager getDefaultDb + propagating comment) |
| Final counts | adapterLifecycle 11/11; AI suites 7/110 | GREEN |
| Output written | append `.planning/kermit/reviews/ZOE-REVIEW.md` | Done |

### Mutation → Test mapping (the adversarial core)
| Mutation | B9-boot-red | B9-env-ok | B9-boot-guard | Conclusion |
|---|---|---|---|---|
| M1: init() no-op (no getDefaultDb call) | **RED** | green | green | boot-red pins that init() invokes the db validator |
| M2: init() swallows getDefaultDb throw | **RED** | green | green | boot-red pins **propagation** of the failure, not just the call |
| M3: re-add NODE_ENV string-allowlist throw | green | **RED** | green | env-ok pins db-resolution-NOT-NODE_ENV; old wrong check is caught |

Each B9 assertion is load-bearing and pins a *distinct* facet (call → propagation → not-a-string-check). No tautology; the only `expect(true).toBe(true)` (B9-boot-assert, line 766) is explicitly a documentation REFER, not a behavioral pin — and the behavior it documents (server.js wiring) is verified REAL by reading server.js:61 + the process.exit(1) abort path.

## Contamination Attribution (point #4)
bert flagged "B7-guard-2/B7-guard fail when all suites run together but pass isolated." **I could not reproduce this across four independent runs** (AI-suite parallel ×3, AI-suite serial in-band, adapterLifecycle+aiRateLimiter+ai-command, and the FULL juggler suite). In every run `adapterLifecycle.test.js` was GREEN, including B7-guard/B7-guard-2.

Attribution: **PRE-EXISTING harness non-determinism, NOT a defect introduced by the new `facade.init()` or the B8 key-cache.** Evidence:
- The B8 live-invalidation cache (`this._client`, `this._cachedApiKey`) is **instance-level**, not module-level — it cannot leak across suites.
- `facade.init()` calls `getDefaultDb()` (module-level cache) but the test mocks `lib/db` and Jest gives each test file its own module registry, so no real cache is shared; the facade's own `_ai`/`_usage` singletons are reset in adapterLifecycle's beforeEach/afterEach via `facade._reset()`.
- The full-suite crash signatures (`usage-reporter.js:92` undefined-`warn` teardown timer, `aiRateLimiter` 429 failures, `taskMappers.js:155` `source_id` TypeError, `TaskStatus`/`slice` module-resolution) are **all** documented PRE-EXISTING in the prior W1a/W1b reviews and are unrelated to AI-enrichment. They stem from shared-3407 parallel DB contention + post-teardown timers, which the prior reviews already proved non-deterministic (281/136/54 failures across identical runs).
- If B7-guard *did* flicker in bert's run, the mechanism is **intra-file** `resolveQueue` quota-seed starvation under load (the `then`/`select`/`first` shift entries off a module-level queue that beforeEach re-seeds), NOT cross-suite leakage from the W2a code. That is a test-harness robustness concern (REFER→telly), not a B9-attributable regression and not a masked real regression of the AI slice.

**Verdict: the contamination does not mask any real AI-slice regression and is not attributable to the W2a B9 change. It is the same pre-existing flaky-full-harness condition already on record.**

## Proof Checklist
- [x] --mode present; recorded (bugfix --re-review)
- [x] Required inputs present — prior ZOE-REVIEW.md (W2a B9 BLOCK) + target files (adapterLifecycle.test.js, facade.js, server.js); telly reports 11/11 GREEN; no UX-REVIEW (telly-only leg)
- [x] Shallow-assertion grep — B9 assertions are exact (`toThrow(/No database configuration found/)`, `resolves.not.toThrow()`, `typeof === 'function'`); the lone `expect(true).toBe(true)` (B9-boot-assert:766) is an explicit documentation REFER whose claim is independently verified via server.js read — not a load-bearing pin
- [x] Suspect selected risk-ordered — B9 (boot fail-fast = prompt's named re-confirmation target; the prior false-pass) is the sole re-review suspect
- [x] **SPOT-MUTATION executed on REAL SOURCE (3 mutants): M1 init no-op → boot-red RED; M2 swallow throw → boot-red RED; M3 re-add NODE_ENV allowlist → env-ok RED. All reverted; tree clean (grep ZOE-MUTATION empty; init() = original).**
- [x] Mode-specific (bugfix) challenge — would the regression test FAIL on the pre-fix/wrong code? YES: M1/M2 (init doesn't propagate db failure) → boot-red RED; M3 (old wrong NODE_ENV check) → env-ok RED. Genuinely reproduces the boot-contract failure AND the old-approach regression.
- [x] Point #3 — server.js wiring READ and verified real: `await facade.init()` at server.js:61 inside start() before app.listen (63); throw → start() rejects → catch → process.exit(1) (171-174). Boot aborts on misconfig. NOT test-passes-goal-unmet.
- [x] Point #4 — contamination investigated across 4 run configs; could not reproduce adapterLifecycle/B7-guard failure; attributed PRE-EXISTING harness non-determinism (instance-level B8 cache + per-file module registry + facade._reset prove no cross-suite leak from new code)
- [x] Mock-hides-bug — B9 mocks getDefaultDb via jest.spyOn on the real cached lib/db module (mocked at module level); the test asserts init()'s **propagation behavior** (throw passes through / resolve passes through), not the mock's echo. Legitimate.
- [x] Snapshot/tautology grep — no toMatchSnapshot; the one `expect(true)` is a documented REFER, behavior verified elsewhere
- [x] Flake re-run — AI suites ×3 (110/110 each) + adapterLifecycle final 11/11; deterministic GREEN in AI scope
- [x] Severity-calibration — prior BLOCK-1 (B9 false-pass) is now resolvable to closed: the fix changed altitude (constructor→boot hook) AND wiring is real. No new BLOCK/WARN; prior WARN-2 (allowlist literal) is superseded by the getDefaultDb-based init (env-ok/M3 prove it's no longer a string check). WARN-3 (B6 negative-path gap) is out of this re-review's scope (B9-only re-confirmation).
- [x] Each finding carries file:line + severity
- [x] Flag-and-refer emitted (full-harness flake → telly)
- [x] Rubric Coverage Map emitted — no blank dimension
- [x] Proof of Work populated with actual commands + results
- [x] Status set: DONE
- [x] ZOE-REVIEW.md written (appended)
- [x] Scooter — not separately consulted; B9 boot contract was supplied in the prompt + prior ZOE-REVIEW BLOCK-1 + read directly from facade/server/lib-db; no unsettled knowledge question
- [x] Knowledge changes — none authored by zoe (audit only)
- [ ] Bird PASS / a11y — N/A (no UX-REVIEW; telly-only leg)

## Findings

### Telly / Bert Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| — | — | `adapterLifecycle.test.js:634-744` (B9-boot-red/boot-guard/env-ok) + `facade.js:58-62` (init) + `server.js:61` (wiring) | **B9 CLOSED — prior BLOCK-1 (test-passes-goal-unmet) is eliminated.** The contract was rewritten from a constructor-level NODE_ENV string allowlist (wrong altitude, never fires at boot) to a boot hook `facade.init()` that eagerly calls `getDefaultDb()` and propagates its throw, wired into `server.js start()` before `app.listen`. M1/M2 prove boot-red pins propagation of the db-config failure; M3 proves env-ok pins db-resolution-not-NODE_ENV-string. server.js:61 + the `start().catch→process.exit(1)` path make the boot abort real. No tautology, no false-pass on the real goal. | None — B9 resolved. |

### Cleared Suspects (mutation-confirmed genuine pins)
| Test | Mutation applied | Result |
|------|------------------|--------|
| B9-boot-red | init() no-op (M1) | RED — "init() must throw" not satisfied. Pins that init invokes the db validator. |
| B9-boot-red | init() swallows getDefaultDb throw (M2) | RED — propagation broken. Pins that the failure PROPAGATES, not just that getDefaultDb is called. |
| B9-env-ok | re-add NODE_ENV allowlist throw (M3) | RED — `Invalid NODE_ENV: staging_env_b9_telly_test`. Pins db-resolution NOT a NODE_ENV string check; old wrong approach is caught. |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→telly | full `make test-juggler` / `jest` harness | Could not reproduce bert's B7-guard cross-suite failure (4 run configs all GREEN for adapterLifecycle). If it flickers, the mechanism is intra-file `resolveQueue` quota-seed starvation under parallel-3407 load — the same documented pre-existing harness non-determinism (usage-reporter teardown timer + aiRateLimiter 429 + taskMappers source_id), NOT the W2a B9 code. A serial/isolated-DB harness would stabilize attribution. |
| 2 | INFO | REFER→cookie | `facade.js:58-62` + `server.js:61` | The prior arch concern (lazy-singleton facade cannot fail-fast-at-boot) is now RESOLVED by the explicit boot hook — `init()` validates the db seam eagerly at startup while ai()/usage() singletons stay lazy. Noting closure of the prior REFER→cookie. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | M1/M2/M3 each flip exactly the matching B9 test RED; assertions are exact-throw / exact-resolve / exact-reject — not toBeDefined theater | boot-red pins call+propagation; env-ok pins not-a-string-check |
| Edge Case Gaps | covered | bad-config-throws, good-config-resolves, bogus-NODE_ENV-with-resolvable-db all pinned; the prior boot-time-misconfig gap (BLOCK-1) is closed | — |
| Test Gaps | covered | B9 now has a genuine boot-contract test (the prior gap); server.js wiring verified by read (E2E-level, correctly REFER-documented by B9-boot-assert) | prior gap resolved |
| UX Gaps | n/a | telly-only leg, no UX surface | — |
| Security Gaps | covered | boot fail-fast surfaces DB misconfig at startup rather than mid-request; no new attack surface | — |
| Documentation Gaps | covered | facade.js init() comment + test header (634-744) now accurately describe the boot hook; the prior inaccurate "fails at boot" constructor comment is gone | — |
| Architecture Gaps | covered | boot hook is the correct altitude for boot-time validation; lazy singletons preserved for non-AI deploys; prior REFER→cookie closed | — |
| Review Quality | covered | B9 re-challenged by REAL source mutation (3 mutants) + server.js wiring read + 4-config contamination repro — not by re-reading telly's GREEN | the prompt's named re-confirmation target fully exercised |
| False Passes | covered | **Prior B9 false-pass (constructor-throw ≠ boot-fail-fast) is ELIMINATED.** boot-red/env-ok go RED on the matching mutants; wiring abort path is real (process.exit(1)). No remaining false-pass in the B9 surface. | the exact false-pass zoe previously caught is now closed |

## Sign-off
Signed: Zoe — 2026-06-12T15:00:00Z

---

# Zoe Review — juggler-h5-fixes W3 (B11 quota TOCTOU atomicity) — bugfix — 2026-06-12

## Status: DONE

_Adversarial mutation-test of telly's B11-race + bert's atomic `commitQuota` (db.transaction + SELECT COUNT FOR UPDATE). **B11-race is a GENUINE race repro and genuinely pins the atomicity — not a false-GREEN, not serialized by accident.** Confirmed by REAL source mutation (revert to non-atomic count-then-insert → finalCount=51 RED, deterministic ×3) + an independent N-way/boundary probe. The 2-way test fires real concurrency on distinct pooled connections; the FOR-UPDATE-guarded commit is the true gate (N-way @49 with all 5 racers passing checkQuota still yields exactly 50). No quota-on-timeout reintroduced (B5-red GREEN). All mutations + the throwaway probe reverted; tree clean._

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | `ls TEST-REVIEW/TEST-CATALOG.md` + read quotaTOCTOU.test.js, KnexAIUsageRepository.js, test-db.js, knexfile.js, TRACEABILITY.md | present; mode=bugfix; no UX-REVIEW (telly-only leg) |
| Pool/connection analysis | read `test-db.js:21` (single shared knex) + `knexfile.js:85` (test pool `{min:1,max:5}`) | both repos share ONE knex instance BUT `db.transaction()` draws a distinct pooled connection (max=5 ≥ 2 concurrent) → real concurrency, not single-connection serialization |
| Baseline run | `DB_PORT=3407 jest quotaTOCTOU --verbose` | **2/2 GREEN** (B11-race finalCount=50, B11-guard 49 rows) |
| **M1 — revert commitQuota to non-atomic count-then-insert** | replaced db.transaction+FOR UPDATE with plain `.count().first()` then `.insert()`; run B11-race | **B11-race RED — `Received: 51`, `Expected: <= 50`.** Mutant KILLED. The test genuinely catches the race. |
| M1 determinism | re-run B11-race ×3 under non-atomic | **51 / 51 / 51** — race fires deterministically; never accidentally 50 (which serialization would force) → proves REAL two-connection concurrency |
| Revert M1 | restore atomic body | clean (no ZOE-MUTATION residue; `git diff` = W3 fix only) |
| **N-way + boundary probe** (throwaway `zoeProbeTOCTOU.test.js`) | 5-way @49, 5-way @46, @50 single, @50 two-concurrent, @48 two-concurrent, on the ATOMIC fix | **5/5 PASS:** @49→50 (allowedTrue=5), @46→50, @50→50, @50-2x→50, @48-2x→50 |
| N-way overshoot check | re-apply M1b non-atomic; run probe | @49→**54**, @46→**51** (N-way overshoots far worse than 2-way's 51) → mechanism NOT 2-specific; probe would catch a broken impl. @50 cases stay 50 even non-atomic (checkQuota denies at limit → not the race-sensitive boundary) |
| Revert M1b + delete probe | restore atomic; `rm zoeProbeTOCTOU.test.js` | clean |
| Point 5 — regression | `DB_PORT=3407 jest "quotaTOCTOU\|timeoutAbortConsequences\|goldenMaster.h5"` | **58/58 PASS** (3 suites) |
| B4/B5 detail | `jest timeoutAbortConsequences --verbose` | B4-red, B5-red (0 rows on timeout), B5-guard all GREEN → **atomic change did NOT reintroduce quota-on-timeout** |
| Tree clean | `git status --short`; `grep -rn ZOE-MUTATION\|zoeProbe src tests` | probe gone; KnexAIUsageRepository = W3 fix only; NO residue; final quotaTOCTOU 2/2 GREEN |
| Output written | append `.planning/kermit/reviews/ZOE-REVIEW.md` + `zoe-REVIEW.json` | Done |

### The five dispatch points — verdicts
1. **B11-race genuinely pins atomicity:** ✓ M1 (non-atomic) → 51 RED, deterministic ×3. The test catches the race, not a happens-to-pass.
2. **Real race vs serialized-by-accident:** ✓ REAL. A single-connection serialization would yield 50 even on non-atomic code (2nd checkQuota sees the 1st insert). The observed 51 is ONLY possible when both SELECT COUNTs run before either INSERT commits = two distinct connections (pool max=5). N-way @49 allowedTrue=5/finalCount=50 confirms the commit-phase FOR UPDATE is the true gate. **Not a false-GREEN-by-serialization.**
3. **N-way robustness:** ✓ 5-way @49→50, @46→50 on the fix; non-atomic → 54/51. The mechanism is NOT 2-specific — FOR UPDATE serializes N callers. 2-way IS sufficient evidence for the binding case, and N-way confirms no 2-specific artifact.
4. **Boundary:** ✓ @50 (at limit) → 0 new inserts (stays 50), single AND two-concurrent. @48 two-concurrent → exactly 50 (both allowed). Note: @50 is guarded by `checkQuota` (count≥limit → allowed:false), so it is NOT the TOCTOU-sensitive boundary — count=49 (the test's choice) is the correct race boundary.
5. **quotaTOCTOU + B4/B5 + goldenMaster:** ✓ 58/58 GREEN; B5-red confirms no quota-on-timeout regression from the transaction wrapper.

## Proof Checklist
- [x] --mode present; recorded (bugfix)
- [x] Required inputs present (TEST-REVIEW.md + TEST-CATALOG.md + TRACEABILITY.md); UX-REVIEW absent (telly-only leg, noted)
- [x] Shallow-assertion grep — B11-race assertion is `toBeLessThanOrEqual(50)` + `toHaveLength(SEED_COUNT)` precondition; B11-guard `toHaveLength(49)`/`toBe(USER)` — exact, non-tautological; no `expect(true)`/`toBeDefined`-only/`toBeTruthy` on the load-bearing path
- [x] Assertion-free grep — both tests carry multiple `expect()`; none assertion-free
- [x] Suspect tests re-executed — B11-race re-run baseline + ×3 under M1 + probe ×2 configs
- [x] Suspect-selection risk-ordered — B11-race is the sole high-risk suspect (quota = data-mutation/billing-adjacent, concurrency-correctness = highest blast radius)
- [x] **SPOT-MUTATION on REAL SOURCE: M1 (non-atomic count-then-insert) → B11-race RED finalCount=51; M1b (non-atomic, N-way) → 54/51 overshoot. Both reverted; tree clean (git status + grep verified).**
- [x] Mock-hides-bug — NO mocks: B11-race + guard + zoe-probe all use REAL test-bed MySQL 3407 via shared knex; the FOR UPDATE race only exists at the real DB level (a mock cannot exhibit it). No mock-asserting-itself, no mock-hidden seam.
- [x] Snapshot/tautology grep — no `toMatchSnapshot`; no `expect(x).toEqual(x)` self-compare; counts are exact (`toBe`/`toHaveLength`/`toBeLessThanOrEqual`)
- [x] Mode-specific (bugfix) challenge — would B11-race FAIL on pre-fix (non-atomic) code? **YES (M1: 51, deterministic).** Genuinely reproduces the TOCTOU; the regression test could have been written before the fix and caught the bug.
- [x] Real-concurrency verification — pool `{min:1,max:5}` + `db.transaction()` per acquire → distinct connections; the 51 result (vs serialization's 50) is the empirical proof; N-way allowedTrue=5/final=50 confirms the commit-gate
- [x] N-way + boundary independently probed (throwaway test) — 5/5 PASS on fix; overshoot on non-atomic; probe deleted
- [x] Error/negative-path audit — quota-on-timeout (B5) re-verified GREEN; the new transaction does not call commitQuota on the error path (controller unchanged; commitQuota still success-only)
- [ ] Bird PASS verdicts — N/A (no UX-REVIEW; telly-only leg)
- [ ] Bird a11y re-verify — N/A
- [x] Flake re-run ≥2× — B11-race deterministic across baseline + 3× M1 + probe runs; never flickered
- [x] Severity-calibration — telly's B11-race mutation note ("remove atomicity → finalCount=51 → KILLED") is ACCURATE (M1 confirms exactly 51). No BLOCK-as-WARN mis-rating. No findings to re-rate.
- [x] Each finding carries file:line + severity
- [x] Flag-and-refer emitted
- [x] Rubric Coverage Map emitted — all 9 dimensions
- [x] Proof of Work populated with actual commands + results
- [x] Status set: DONE
- [x] ZOE-REVIEW.md written (appended); zoe-REVIEW.json emitted
- [x] Scooter — not needed; bug spec from prompt + TRACEABILITY.md (999.415) + code read; no unsettled knowledge relitigated
- [x] Knowledge changes — none (audit only; no requirement/standard/approach changed)

## Findings

### Telly / Bert Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| — | — | `tests/unit/aiEnrichment/quotaTOCTOU.test.js:163-263` (B11-race) + `KnexAIUsageRepository.js:101-118` (commitQuota) | **B11-race is a GENUINE, non-tautological race repro that pins the atomic fix.** M1 (revert to non-atomic count-then-insert) drives finalCount=51 RED, deterministically ×3 — the exact mutation telly's MUTATION NOTE predicts. The race is REAL (two distinct pooled connections; serialization would force 50, the observed 51 proves concurrency). The FOR-UPDATE commit gate holds N-way (5 racers @49 → 50, all 5 passing the advisory checkQuota). No quota-on-timeout reintroduced (B5-red GREEN). No false-GREEN, no serialization artifact, no mock hiding the seam (real MySQL 3407). | None — B11 atomicity genuinely verified. |

### Cleared Suspects (mutation-confirmed genuine pins)
| Test | Mutation applied | Result |
|------|------------------|--------|
| B11-race | M1: commitQuota → non-atomic count-then-insert (no trx, no FOR UPDATE) | RED — finalCount=51 (deterministic ×3). Pins the atomicity. |
| B11-race (N-way, zoe probe) | M1b: same non-atomic body, 5 concurrent @49 | overshoot to 54 (vs 50 on fix). Confirms mechanism not 2-specific. |
| B11-guard | (telly's documented mutant) skip commitQuota → 48 rows → `toHaveLength(49)` fails | not re-run by zoe (low risk, happy-path); telly's oracle is sound and confirmed GREEN on the fix |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→telly | `tests/unit/aiEnrichment/quotaTOCTOU.test.js` (coverage breadth) | The committed B11-race tests only 2-way concurrency at count=49. zoe's throwaway N-way/boundary probe (5-way @49/@46, @50 single+2x, @48 2x — all PASS on the fix) confirms robustness but is not retained. 2-way is sufficient to pin the binding race (the boundary case), so this is breadth-not-correctness — optional to fold an N-way variant into the suite for regression durability. |
| 2 | INFO | REFER→cookie | `KnexAIUsageRepository.js:104-118` | The atomic mechanism is `SELECT COUNT(*) ... FOR UPDATE` inside a REPEATABLE-READ trx, anchored on `idx_ai_command_log_user_time`. Range-lock correctness under gap-locking is an InnoDB-isolation arch concern; empirically the N-way probe shows correct serialization, but the lock-anchor index dependency (no new migration; relies on the existing composite index) is an arch note — out of zoe's column. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | M1 flips B11-race RED (51) under the matching non-atomic mutant; the `toBeLessThanOrEqual(50)` is load-bearing, not theater; N-way probe proves it's not 2-specific | exact-count assertion, genuinely pins |
| Edge Case Gaps | partial | Covered (binding): 2-way @49 race. zoe-probed (not retained): 5-way @49/@46, @50 single+2x, @48 2x. The @50 boundary is checkQuota-guarded (not race-sensitive). | F&R #1 — optional N-way variant in suite |
| Test Gaps | covered | The TOCTOU race surface (concurrent commit at boundary) is genuinely pinned by B11-race; no untested branch of the atomic commit. checkQuota count-only contract covered by B5/goldenMaster. | — |
| UX Gaps | n/a | telly-only leg, no UX surface | — |
| Security Gaps | covered | Quota is billing-adjacent (50/day cap = abuse/cost control); the atomic fix closes the overshoot that let a user exceed the paid cap via concurrent requests. No new attack surface; real-DB pinned. No elmo REFER→zoe. | the race had a billing-integrity dimension — now closed |
| Documentation Gaps | covered | quotaTOCTOU.test.js header + KnexAIUsageRepository.js:23-37 comment accurately describe the FOR UPDATE mechanism; telly's MUTATION NOTE (finalCount=51) matches M1 exactly | — |
| Architecture Gaps | covered | Atomicity correctly placed in commitQuota at the repo/adapter layer; checkQuota stays read-only (advisory); commit success-only (B5 preserved). Lock-anchor index dependency noted (F&R #2). | — |
| Review Quality | covered | B11-race re-challenged by REAL source mutation (not re-reading telly) + independent N-way/boundary probe + pool-config analysis proving real concurrency; flake re-run ×3; regression suite 58/58 | the highest-risk test fully exercised |
| False Passes | covered | **Zero false-pass.** B11-race goes RED on the literal non-atomic bug (51); the race is real (not serialized → would-be 50); the fix holds N-way (5→50). No tautology, no mock-hidden seam, no quota-on-timeout regression. | the false-pass class zoe exists to catch is absent |

## Sign-off
Signed: Zoe — 2026-06-12T16:30:00Z
