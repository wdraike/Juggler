# Ernie Review — juggler-h5-fixes W1b (B4 telemetry suppression + B5 check/commit quota split) — bugfix — 2026-06-11

## Status: DONE

Scope: `gemini-tracked-call.js`, `KnexAIUsageRepository.js`, `AIUsagePort.js`, `facade.js`, `ai.controller.js`. W1b suppresses orphaned `enqueue()` telemetry on our own timeout-abort via a per-call `timedOut` flag (B4), and splits `checkAndLogDailyQuota` into `checkQuota` (count, no insert) + `commitQuota` (insert), with the controller calling `checkQuota` before `callGemini` and `commitQuota` only after success (B5). The B4 suppression is precise (keys on our own deadline, not the error code, so genuine provider errors still enqueue with `errorFlag=true`); the `timedOut`/`timer`/`controller` triad is per-call scope (no stale leak); a successful call cannot be accidentally suppressed (microtask ordering guarantees `finally` drains before the timer macrotask). B5 did not worsen the pre-existing non-atomic race and removed the timeout-burns-a-slot bug. No BLOCK findings. Two WARN: dead `checkAndLogDailyQuota` (no production callers) and an unhandled-`commitQuota`-failure edge (success-then-500 with an uncharged slot).

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=bugfix, files from positional `--files` (5) | present |
| Scope detect | 5 files read in full + 3 test files + git diff HEAD~1 | 5 files |
| Bugfix gate | RED tests `timeoutAbortConsequences.test.js` (B4-red, B5-red/guard) + TRACEABILITY B4/B5; 73/73 GREEN reported | gate met |
| B4 diff | `git diff HEAD~1 -- gemini-tracked-call.js` | finally moved inside `callPromise`; `if (!timedOut)` guard added; race structure from W1a unchanged |
| B4 suppression precision | close read lines 23–80 | guard keys on `timedOut` (set by OUR timer at line 31), NOT on `err.code`; a genuine provider ETIMEDOUT leaves `timedOut=false` → still enqueues. Tighter than the test's stated `err.code` approach — correct |
| B4 per-call scope | lines 16,27,28 | `controller`/`timedOut`/`timer` are function-locals — fresh per call, no cross-call stale flag |
| B4 false-suppress check | microtask reasoning | if SDK resolves, `return result`+`finally` run as microtasks and drain before the timer macrotask can flip `timedOut`; a resolved call always enqueues. No path suppresses a success |
| B4 genuine-error path | lines 55–58, 64–78 | network/500/content-block → catch sets `errorFlag=true`, `timedOut=false` → finally enqueues with `error:true`, `errorType`. Real error telemetry preserved |
| B5 controller order | ai.controller.js 57, 97, 101 | `checkQuota` (await) → `callGemini` (await) → `commitQuota` (await) inside the same try; `commitQuota` awaited BEFORE `res.json` (line 123) |
| B5 double-commit / commit-without-check | single linear path, no loop/branch re-entry | exactly one `checkQuota` then exactly one `commitQuota`; 429 path returns before any commit; no path commits without a prior allowed check |
| B5 race vs pre-existing | compare to deleted `checkAndLogDailyQuota` | OLD: count-then-insert (non-atomic). NEW: count-then-(call)-then-insert. The check→insert window is WIDER (spans the Gemini call) but the race CLASS is identical (TOCTOU on count); W3 hardens. Not worse in kind; over-grant bound unchanged (concurrent requests each see count<limit) |
| commitQuota-throws edge | ai.controller.js 101–127 | if `commitQuota` rejects (DB error) AFTER a successful Gemini call, control jumps to the outer catch → **500 returned, AI result lost, slot NOT consumed**. WARN-2 |
| Dead-code grep | `grep -rn checkAndLogDailyQuota` | zero PRODUCTION callers; only tests (3 files), the port stub, facade pass-through, adapter impl. WARN-1 (remove per no-dead-code) |
| Port/facade/adapter contract | AIUsagePort 23/27/31, facade 51/55, KnexRepo 53/77, MockAIAdapter | `checkQuota`+`commitQuota` defined on port + adapter + facade pass-through. MockAIAdapter implements AIPort (generate) only — does NOT implement AIUsagePort, correctly (quota is a separate port; tests use real KnexAIUsageRepository against test-bed) |
| Fallback scan | grep `\|\|` / `??` vs CLAUDE.md | `Number(row && row.cnt) \|\| 0` (count default — legitimate empty-result, not maybe-null-data mask); `d.db \|\| null`, `deps \|\| {}` (DI defaults); `usage.* ?? 0`, `config ?? null` (pre-existing telemetry, byte-identical to HEAD). None paper over maybe-null business data → no BLOCK |
| parseInt scan | grep parseInt | `parseInt(process.env.AI_CALL_TIMEOUT_MS, 10)` — radix present |
| Transaction/atomicity | KnexRepo 56–66, 77–79 | `checkQuota` read-only; `commitQuota` single standalone insert — no dependent multi-write needing a trx. The check+insert separation is the deliberate B5 design, not an atomicity regression to wrap |
| Output written | Write CODE-REVIEW.md + ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present — mode=bugfix, 5 files in scope
- [x] Scope confirmed — file list non-empty, printed in Proof-of-Work
- [x] Mode noted + gate checked — bugfix; RED tests `timeoutAbortConsequences.test.js` (B4/B5) reproduce the orphaned-row + slot-burn failures; 73/73 GREEN
- [x] Complexity scan — gemini-tracked-call.js 92 lines, KnexAIUsageRepository.js 104, AIUsagePort.js 40, facade.js 74, ai.controller.js 128; all < 300; nesting ≤ 3
- [x] Error handling scan — `callPromise` catch re-throws ORIGINAL `err` (no success-default swallow); both race losers terminal-catch'd (41, 83); controller wraps the whole flow in try/catch → 500
- [x] Floating-promise / forEach(async) / Promise.all-partial scan — `timeoutPromise.catch(()=>{})`/`callPromise.catch(()=>{})` are intentional loser-suppression (value consumed via `Promise.race`); no forEach(async); no Promise.all; `enqueue(db,...)` in finally is fire-and-forget by design (queue service owns its own .catch — unchanged from HEAD)
- [x] Error-cause-preservation scan — `callPromise` catch (55–58) re-throws unchanged; no wrap-without-cause; controller catch logs+500s the real `err.message` (no success-shaped default)
- [x] Input validation scan — `handleCommand` validates `command` (49–50, 400 on empty); `checkQuota`/`commitQuota`/`trackedGeminiCall` are internal service layers behind the validated HTTP entry; `userId` from `req.user.id` (auth middleware upstream)
- [x] Unapproved-fallback scan — all `||`/`??` triaged (see Proof-of-Work); count-default `|| 0`, DI defaults, pre-existing telemetry `?? 0`/`?? null` — none mask maybe-null business data → no BLOCK
- [x] Numeric precision/boundary scan — `parseInt(...,10)`; `count >= dailyLimit` boundary correct (50 rows → at-limit → blocked, matches HEAD); `Number(row && row.cnt) || 0` guards null/empty count; no money/float, no index math
- [x] ReDoS scan (ernie OWNS) — controller's `command.replace(/[‘’]/g,…)` etc. are simple character-class literals (no nested/overlapping quantifiers); `cleaned.match(/\{[\s\S]*\}/)` is a single greedy class on a bounded model response (no catastrophic backtracking); no `new RegExp(userInput)`
- [x] Date/TZ & DB-clock scan — `new Date(Date.now() - 24h)` is the rolling-window LOWER bound for a COUNT query (read-side), not a stored authoritative `generatedAt` timestamp; `commitQuota` insert lets MySQL set `created_at` (DB clock is source of truth) — not the cache-staleness class
- [x] Resource scan — `setTimeout` `clearTimeout`'d in finally (88) AND `unref`'d (37); no sync I/O; AbortController GC'd with closure; no unclosed handles (knex pool shared, not per-call)
- [x] DB-transaction/atomicity scan — `commitQuota` is a single standalone insert (no dependent multi-write); the check/insert separation is the deliberate B5 design, not an atomicity regression
- [x] Concurrency scan — no module-level mutable quota state (facade singletons are stateless adapters); `timedOut`/`timer`/`controller` per-call; check→commit TOCTOU window noted (pre-existing class, W3 owns) — see Findings INFO-3
- [x] Idempotency-under-retry scan — `handleCommand` is a synchronous user-driven POST (not a Cloud Tasks/webhook consumer); no guaranteed-retry queue behind it; idempotency not required here
- [x] Grep matches triaged, not just counted — every `||`/`??`, parseInt, regex, transaction match READ in context (Proof-of-Work rows); the `enqueue`-in-finally and loser-`.catch` escapes reasoned about explicitly
- [x] Type safety scan — no `as any`/`@ts-ignore` (plain JS); `result?.usageMetadata`, `result.candidates?.[0]` optional-chained; `Number(row && row.cnt)` guards null row
- [x] React logic scan — SKIPPED, no .jsx/.tsx in scope (all backend)
- [x] Observability scan — controller uses structured `logger.error` (not console); `correlationId` threaded through `trackedGeminiCall` → enqueue
- [x] Dead code scan — `checkAndLogDailyQuota` has ZERO production callers (grep-confirmed: only tests + port/facade/adapter triad); flagged WARN-1 for removal per no-dead-code
- [x] Flag-and-refer lines emitted — telly (B4 genuine-error-still-enqueues coverage gap; commitQuota-throws path) — see Findings INFO-4
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed as ernie BLOCK/WARN — coverage gaps referred to telly as INFO
- [x] No security findings reviewed in depth — none sighted (no injection/secret/authz in diff)
- [x] Prior knowledge consulted — prior W1a CODE-REVIEW.md read (same surface; confirms race structure + telemetry was byte-identical at HEAD; W1b is the planned B4/B5 follow-up, no relitigation)
- [x] Knowledge changes reported to Scooter — none; W1b implements a planned TRACEABILITY item, changes no requirement/standard/approach
- [x] Rubric Coverage Map emitted — all 9 dimensions marked
- [x] Output file written with Proof-of-Work, Proof Checklist, Findings, Sign-off
- [x] Status line set — DONE (no unresolved BLOCK)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | WARN | KnexAIUsageRepository.js:87-101 (+ AIUsagePort.js:36-38, facade.js:59-61, AIUsagePort.js:23) | `checkAndLogDailyQuota` is dead code — zero production callers (grep-confirmed: only test files + the port stub / facade pass-through / adapter impl that exist solely to keep it alive). Per the no-dead-code standard it should be removed, not kept as "backward-compat" with no caller. | Remove `checkAndLogDailyQuota` from the adapter, port, facade, and drop it from `AI_USAGE_PORT_METHODS`; migrate the 3 tests (`goldenMaster.h5.test.js:1011/1031`, `e2-globalShared` comment, `timeoutAbortConsequences` comment) to `checkQuota`+`commitQuota`. If a deliberate deprecation window is wanted instead, document it in CLAUDE.md with a removal date — silent "preserved for compat" with no caller is the anti-pattern. |
| 2 | WARN | ai.controller.js:101-127 | If `commitQuota(userId)` rejects (DB error) AFTER a successful Gemini call, control falls to the outer catch → a **500 is returned and the user's already-computed AI result is discarded**, while the slot is NOT consumed. The user loses a successful result to a quota-bookkeeping write failure. (Pre-W1b, the pre-call insert failure also 500'd, but before spending the Gemini call.) W1b trades "slot burned on timeout" for "result lost on commit-failure" — should be a conscious decision, not an accident of the catch placement. | Wrap `commitQuota` so a commit failure logs distinctly and the AI result is still returned (under-count quota by one) rather than converting a successful AI call into a 500. Or confirm via Scooter that losing the result on a commit-write failure is acceptable. At minimum log the orphaned-success so it is observable. |
| 3 | INFO | ai.controller.js:57,101 | check→commit window is non-atomic (TOCTOU on the rolling count): two concurrent requests for the same user can both pass `checkQuota` at count=49 and both `commitQuota`, over-granting by one. SAME race class as the pre-existing count-then-insert — W1b did not worsen the over-grant bound, it only widened the window to span the Gemini call. W3 is slated to harden. | None in W1b (W3 owns). Noted for completeness. |
| 4 | INFO | gemini-tracked-call.js:64 | B4 suppression keys on the `timedOut` flag (our own deadline) rather than `err.code === 'ETIMEDOUT'` — MORE precise than the test's stated approach, and correctly lets a genuine provider error carrying `ETIMEDOUT` still enqueue. No test currently asserts the inverse (a genuine provider rejection STILL enqueues one row with `error:true`); the no-lost-error-telemetry guarantee is unproven by a test. | REFER→telly: add "non-timeout provider rejection still enqueues one row with error:true", and a case for the WARN-2 commitQuota-throws path. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | B4 flag-precision + microtask false-suppress analysis; B5 check/commit ordering verified linear, single-commit | Sound; WARN-2 is a behavior-choice not a logic bug |
| Readability | covered | Comments tie each change to B4/B5; naming explicit (`timedOut`, `checkQuota`/`commitQuota`) | — |
| Maintainability | partial | Dead `checkAndLogDailyQuota` kept across 4 source files + 3 tests inflates surface | WARN-1 |
| Error Handling | covered | catch re-throws original; loser `.catch`; controller try/catch→500 | WARN-2: commit-failure converts success→500 |
| Coupling | covered | Controller depends only on the facade; ports/adapters honor the seam | Deeper boundary review → cookie if wanted |
| Type Safety | covered | optional chaining on `result`/`row`; `Number()` guard; plain JS, no unsafe casts | — |
| API Design | partial | Port still carries a deprecated 3rd method with no caller | WARN-1 (trim the port surface) |
| Resource Management | covered | timer `clearTimeout`+`unref`; no sync I/O; no unclosed handles | — |
| Concurrency Safety | covered | per-call abort/timer/flag; check→commit TOCTOU identified as pre-existing class (W3) | INFO-3 |

## Sign-off
Signed: Ernie — 2026-06-11T00:00:00Z

---

# Ernie Review — juggler-h5-fixes Wave 3 (W2a adapter robustness B6/B7/B8/B9 + W2b W1/W2) — bugfix — 2026-06-12

## Status: ISSUES

Scope: `GeminiAIAdapter.js`, `facade.js`, `ai.controller.js` (+ read `gemini-tracked-call.js`, `task.routes.js` for the not-configured/suggest-icon contracts). One BLOCK: **B9 does not achieve its stated "fail-fast-at-boot" goal** — the GeminiAIAdapter constructor (where bert added eager NODE_ENV validation) only runs on the FIRST AI request via the facade's lazy `ai()` singleton, never at server boot; no module wires the adapter at boot. The test pins "constructor throws on bad NODE_ENV", which passes while the real-world goal (misconfig caught at deploy, not first user request) is unmet — a test-passes-goal-unmet gap. B6/B7/B8 and W1/W2 are correct. B6 cleanly distinguishes not-configured (`{}`, no throw, before the tracked call) from a real failure (thrown, surfaces+logs). B7 guards null + all partial candidate shapes via optional chaining with no deref path. B8 invalidation is race-free (single-threaded) and correctly scoped to the API-key path (Vertex documented as restart-required). W2 threads the authenticated `req.user.id` on BOTH paths (suggest-icon gets a real userId, not null). No unapproved fallbacks. Security (W1 encode, W2 attribution) referred to elmo who is re-reviewing separately.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=bugfix, files from positional `--files` (3) | present |
| Scope detect | 3 files read in full + 2 referenced (tracked-call, task.routes) | 3 in-scope |
| Bugfix gate | bert reports 9/9 adapterLifecycle + 108/108 AI suite GREEN; B6/B7/B8/B9 RED tests in `adapterLifecycle.test.js` | gate met |
| Complexity | `wc -l`: GeminiAIAdapter 155, facade 70, ai.controller 153 | all < 300; nesting ≤ 3 |
| B9 boot-reality | grep `ai-enrichment/facade` in `app.js`/`server.js` + every importer | facade required ONLY by `ai.controller.js` + `task.routes.js`; both call `generate()`/`checkQuota()` inside REQUEST handlers; `app.js` imports `task.routes` but nothing calls `ai()`/`usage()` at module load | **BLOCK** |
| B9 lazy-singleton | facade.js 33-43 `ai()` builds `new GeminiAIAdapter()` on first call only | constructor (and its NODE_ENV throw) deferred to first AI request, NOT boot |
| B9 test scope | `adapterLifecycle.test.js:624-701` | asserts `new GeminiAIAdapter()` throws on bad NODE_ENV — true at unit level, but no test asserts boot fails; goal-unmet gap |
| B6 not-configured precision | GeminiAIAdapter 122-148 | `generate()` returns `{}` ONLY when `!isConfigured()` (no key / no Vertex project), evaluated BEFORE `trackedGeminiCall`; a real failure throws from inside the tracked call → propagates | correct |
| B6 real-error path | gemini-tracked-call.js 55-58, 85-86 | network/auth-reject/SDK throw → catch sets errorFlag, re-throws → `Promise.race` rejects → propagates to caller (logged at ai.controller 150 / task.routes 56) | real failures surface |
| B6 handleCommand consumption | ai.controller 39-51 | `{}` → `!result` false (empty obj truthy) → no `.text`/`.candidates` → throws `Unexpected Gemini response structure` → 500. So on the handleCommand path a not-configured deploy yields a 500, NOT a clean signal | INFO-7 (pre-existing: handleCommand has no AI-disabled clean state; suggest-icon does) |
| B6 suggest-icon consumption | task.routes 42-52 | `{}` → no `.text`/`.candidates` → `raw=''` → `!raw` → `{icon:null}`, no error log | clean (B6 goal met for this path) |
| B7 null guard | ai.controller 39-41 | `if (!result)` catches null/undefined/'' /0/false before any deref | covered |
| B7 partial shapes | ai.controller 43-51 | `result.text` truthy-checked; `result.candidates?.[0]?.content?.parts` optional-chained — `{candidates:[]}`, `{candidates:[{}]}`, `{candidates:[{content:{}}]}` all → falsy → throws structured error; `.map` runs only when `parts` confirmed | no deref crash |
| B8 invalidation race | GeminiAIAdapter 102-109 | `_cachedApiKey === currentKey` compared each `_getClient`; Node single-threaded, compare+rebuild+assign within one synchronous tick — no interleave | race-free |
| B8 scope | GeminiAIAdapter 92-100 vs 101-110 | invalidation on API-key branch only; Vertex branch caches for adapter lifetime (project/location rotation needs restart) — documented at 84-87, matches original | correct, intentional |
| B8 perf | line 104 | rebuild ONLY when key string actually changes; steady-state returns cached client | negligible cost, no over-rebuild |
| W2 handleCommand userId | ai.controller 56, 25, 32 | `req.user.id` (JWT middleware) → `callGemini(...,userId)` → meta.userId → trackedGeminiCall telemetry | authenticated, not spoofable |
| W2 suggest-icon userId | task.routes 14, 39 | `router.use(authenticateJWT)`; `req.user?.id || null` → meta.userId | authenticated; real userId threaded (not forced null) |
| W1 encode | ai.controller 136-138; node repl verify | `/[&<>"'`=\/\x00-\x1F\x7F]/g` → decimal entity; verified `<>&"'`=/`+ctrl all encoded | allowlist-encode correct → REFER→elmo |
| Fallback scan | grep `\|\|`/`??` vs CLAUDE.md | DI defaults (`d.x||y`), presentation defaults in task-line builder (behavior-identical refactor), `userId||null` (intentional), `GEMINI_API_KEY||''` (B8 empty-key sentinel for compare), `NODE_ENV||'development'` (Node convention) — none mask maybe-null business data | no BLOCK |
| parseInt scan | GeminiAIAdapter 52 | `parseInt(env.AI_CALL_TIMEOUT_MS, 10)` — radix present | clean |
| Output written | append CODE-REVIEW.md + ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present — mode=bugfix, 3 files in scope
- [x] Scope confirmed — file list non-empty, printed in Proof-of-Work
- [x] Mode noted + gate checked — bugfix; B6/B7/B8/B9 RED tests in adapterLifecycle.test.js; 9/9 + 108/108 GREEN reported
- [x] Complexity scan — GeminiAIAdapter 155, facade 70, ai.controller 153; all < 300; nesting ≤ 3
- [x] Error handling scan — `generate()` not-configured returns `{}` (intended, not a swallow); real errors thrown by trackedGeminiCall propagate; controller try/catch→500; suggest-icon try/catch→{icon:null}
- [x] Floating-promise / forEach(async) / Promise.all-partial scan — `generate` returns the trackedGeminiCall promise (awaited by callers); no forEach(async); no Promise.all in scope
- [x] Error-cause-preservation scan — B7 throws a fresh `Error('Unexpected Gemini response structure')` for a malformed/null result (a SHAPE assertion, not an error re-wrap — no upstream cause to preserve); B6 `{}` return is the documented not-configured contract, not a success-default masking a failure (failures still throw from trackedGeminiCall)
- [x] Input validation scan — `handleCommand` validates `command` (59-60, 400); suggest-icon validates `text` (29-32) + emoji shape (50); `generate(contents,config,meta)` is internal behind validated HTTP entries
- [x] Unapproved-fallback scan — all `||`/`??` triaged (Proof-of-Work row); DI defaults, presentation defaults, `userId||null`, `GEMINI_API_KEY||''` compare-sentinel — none mask maybe-null business data → no BLOCK
- [x] Numeric precision/boundary scan — `parseInt(...,10)` radix present; `raw.length > 4` emoji bound correct; no money/float/index math in scope
- [x] ReDoS scan (ernie OWNS) — W1 `/[&<>"'`=\/\x00-\x1F\x7F]/g` is a flat character class (no quantifier nesting); `/\P{ASCII}/u` (task.routes 50) single negated class; `command.replace(/[‘’]/g,…)` simple classes; no `new RegExp(userInput)` | no catastrophic backtracking
- [x] Date/TZ & DB-clock scan — `new Date().toLocaleDateString` (ai.controller 73) builds a display string for the prompt only (not a stored timestamp); no hand-rolled date math; no authoritative `generatedAt` written here
- [x] Resource scan — adapter holds a single cached SDK client (intentionally long-lived); B8 discards+rebuilds on key change (old client GC'd, no handle to close); no sync I/O; no timers in scope (timer lives in trackedGeminiCall, already reviewed W1b)
- [x] DB-transaction/atomicity scan — no DB writes in the 3 in-scope files (adapter delegates the outbox enqueue to trackedGeminiCall; quota writes live in KnexAIUsageRepository, out of this scope)
- [x] Concurrency scan — facade `_ai`/`_usage` module-level singletons are stateless adapters (no per-request mutable state); B8 `_cachedApiKey`/`_client` mutation is single-threaded-safe; no N+1
- [x] Idempotency-under-retry scan — `generate`/handleCommand/suggest-icon are synchronous user-driven HTTP, not Cloud Tasks/webhook consumers; no guaranteed-retry queue; idempotency not required
- [x] Grep matches triaged, not just counted — every `||`/`??`, parseInt, regex match READ in context; the B9 boot-reality conclusion drawn from reading every facade importer (not a grep count); B6 not-configured vs real-error distinction traced through trackedGeminiCall
- [x] Type safety scan — optional chaining on `result.candidates?.[0]?.content?.parts`; `req.user?.id`; plain JS, no `as any`/`@ts-ignore`
- [x] React logic scan — SKIPPED, no .jsx/.tsx in scope (all backend)
- [x] Observability scan — structured `logger.error`/`logger.warn` (ai.controller 118,150; task.routes 56); adapter `logger.info` on client build; B6 deliberately does NOT log on not-configured (the documented goal)
- [x] Dead code scan — `_getDb` (GeminiAIAdapter 76-79) retained as the lazy-resolve fallback for the db-injected branch; `DEFAULT_AI_CALL_TIMEOUT_MS` used; no commented-out blocks; no new TODO/FIXME
- [x] Flag-and-refer lines emitted — elmo (W1 encode, W2 attribution — he is re-reviewing W1/W2 separately); telly (B9 boot-fail-fast has no boot-level test; B6 handleCommand-500-on-not-configured uncovered) — see Findings
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed as ernie BLOCK/WARN — coverage gaps referred to telly as INFO
- [x] No security findings reviewed in depth — W1/W2 emitted as INFO REFER→elmo only
- [x] Prior knowledge consulted — prior W1a/W1b CODE-REVIEW sections (this file) read; confirms the facade lazy-singleton + behavior-identical-refactor framing; no relitigation. Bugfix mode: Scooter consult not mandatory; B9 finding hinges on the "fail fast at boot is the explicit requirement" decision recorded in `adapterLifecycle.test.js:60-62` — flagged for Oscar/Scooter arbitration rather than relitigated here
- [x] Knowledge changes reported to Scooter — none authored by ernie; B9 BLOCK may require a decision (boot-wire vs accept first-request-fail) — Oscar to route
- [x] Rubric Coverage Map emitted — all 9 dimensions marked
- [x] Output file written with Proof-of-Work, Proof Checklist, Findings, Sign-off
- [x] Status line set — ISSUES (1 unresolved BLOCK: B9 goal-unmet)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 5 | BLOCK | GeminiAIAdapter.js:55-73 (+ facade.js:33-43) | **B9 fail-fast-at-BOOT goal not met.** bert added eager NODE_ENV validation in the GeminiAIAdapter constructor, but the facade builds the adapter via a LAZY `ai()` singleton (`new GeminiAIAdapter()` on first `generate()`/`checkQuota()`). The only importers (`ai.controller.js`, `task.routes.js`) call the facade INSIDE request handlers; nothing instantiates the adapter at server boot (verified: `app.js` imports `task.routes` but no module-load call to `ai()`/`usage()`). So a misconfigured `NODE_ENV` deploy BOOTS CLEANLY and fails only on the FIRST user AI request — exactly the outcome B9 set out to prevent. The unit test (`adapterLifecycle.test.js:624-701`) pins "constructor throws on bad NODE_ENV", which passes while the deploy-time goal is unmet: a test-passes-goal-unmet gap. | Add a boot-time wire-up: in `server.js` (after env is loaded, before `listen`) eagerly construct/validate the adapter — e.g. export an `init()`/`warmup()` from the facade that calls `ai()` (and optionally `usage()`) and let `server.js` invoke it at startup so a bad `NODE_ENV`/missing config throws at boot. Then add a boot-level test asserting startup fails on misconfig. Alternatively, if "fail at first request" is in fact acceptable, get that decision recorded via Scooter and downgrade B9's stated goal — but do not leave the constructor-throw as the proof of a boot-fail-fast it does not deliver. |
| 6 | INFO | ai.controller.js:136-138 | W1 allowlist-encode of echoed model output (422 path): `/[&<>"'`=\/\x00-\x1F\x7F]/g` → decimal HTML entity. Verified correct (encodes backtick, `=`, `/`, control chars the prior denylist missed). | REFER→elmo (he is re-reviewing W1/W2 separately) |
| 7 | INFO | ai.controller.js:25-34; task.routes.js:39 | W2 attribution: telemetry `userId` is the authenticated `req.user.id` (handleCommand) / `req.user?.id || null` (suggest-icon) — sourced from JWT auth middleware, not a client-supplied/spoofable field. suggest-icon correctly threads a real userId (falls to null only if `req.user` is somehow absent). | REFER→elmo (audit-trail / attribution is his W2 re-review) |
| 8 | INFO | ai.controller.js:39-51 | B6 not-configured contract is asymmetric across call-sites: suggest-icon maps the `{}` result to `{icon:null}` cleanly (B6 goal met), but handleCommand has no AI-disabled clean state — `{}` falls through B7 to `throw 'Unexpected Gemini response structure'` → 500. This is pre-existing (handleCommand always 500'd a not-configured deploy) and arguably correct (the task-command feature is non-functional without AI), so not a regression — noted so the asymmetry is a conscious choice. No boot/integration test covers the not-configured handleCommand path. | REFER→telly: add a case asserting handleCommand returns a defined status on a not-configured adapter; and a B9 boot-level fail-fast test (see Finding 5). |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | partial | B6/B7/B8/W1/W2 verified correct; B9 logic is correct in isolation but does not achieve its stated boot-fail-fast goal | BLOCK-5 |
| Readability | covered | Each change tagged B6/B7/B8/B9/W1/W2 with rationale comments; naming explicit (`_cachedApiKey`, `isConfigured`) | — |
| Maintainability | covered | Adapter stays the single SDK seam; facade DI hooks (`_setAdapters`/`_reset`) intact | — |
| Error Handling | covered | not-configured `{}` vs thrown real-error distinction is clean and traceable through trackedGeminiCall; controller/route catch blocks intact | INFO-8 asymmetry noted |
| Coupling | covered | Controller/route depend only on the facade; adapter owns env+SDK; B9 fix needs a boot hook (a new, thin server→facade edge) | cookie if the boot-wire crosses a boundary concern |
| Type Safety | covered | optional chaining on result/candidates/req.user; no unsafe casts; plain JS | — |
| API Design | covered | `isConfigured()` added as a clean port-adjacent predicate; `generate` contract (`{}` on not-configured) documented | — |
| Resource Management | covered | single long-lived SDK client; B8 discard+rebuild GC-safe; no sync I/O; timers out of scope | — |
| Concurrency Safety | covered | facade singletons stateless adapters; B8 `_cachedApiKey`/`_client` mutation single-threaded-safe; no shared per-request mutable state | — |

## Sign-off
Signed: Ernie — 2026-06-12T00:00:00Z

---

# Ernie Review — juggler-h5-fixes W2a B9 re-review (iteration 2 — boot-fail-fast via facade.init) — bugfix — 2026-06-12

## Status: DONE

Scope: `facade.js`, `GeminiAIAdapter.js`, `server.js` (+ read `lib/db/index.js`, `adapterLifecycle.test.js`). **B9 BLOCK (prior Finding #5) is CLOSED.** bert replaced the rejected constructor-NODE_ENV-allowlist approach with the human-approved boot-fail-fast design: (1) a new async `facade.init()` that eagerly calls `getDefaultDb()` and lets the throw propagate; (2) `await require('./slices/ai-enrichment/facade').init()` wired into `server.js start()` AFTER `loadJWTSecrets()`, BEFORE `app.listen()`; (3) the constructor NODE_ENV string-allowlist removed. I traced the boot path end-to-end and confirmed the fail-fast is GENUINE and LOUD, not swallowed: a throw in `init()` rejects `start()`'s promise → the top-level `start().catch(err => { serverLogger.error(...); process.exit(1); })` (server.js:171-174) fires → process exits 1 BEFORE `app.listen()` ever runs. A valid config resolves `init()` cleanly and boot proceeds. `init()` does NOT eagerly build the `ai()`/`usage()` lazy singletons (only the db seam is validated), so the DI/test seams (`_setAdapters`/`_reset`) are intact — confirmed by B9-boot-guard. The constructor's no-db-injected `getDefaultDb()` call and `init()`'s call both hit the memoized `getDefaultDb()` (one cached pool, `defaultDbCached` guard) → no double-build. 11/11 adapterLifecycle GREEN in isolation (reproduced). No production-code BLOCK or WARN. **One WARN on test isolation:** the cross-suite contamination bert flagged is REAL but he MIS-IDENTIFIED which test — it is **B9-boot-red** (the very test that proves boot-fail-fast propagation), not B7-guard/B7-guard-2; reproduced deterministically; root cause is a stale `libDb` spy reference surviving a sibling suite's `jest.resetModules()`. Referred to telly (test-quality / false-confidence on the B9 proof).

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=bugfix, files from positional `--files` (3) | present |
| Scope detect | 3 files read in full + lib/db/index.js + adapterLifecycle.test.js | 3 in-scope |
| Bugfix gate | re-review of prior BLOCK #5; 11/11 adapterLifecycle reproduced GREEN (isolated, DB_PORT=3407) | gate met |
| Complexity | `wc -l`: facade 88, GeminiAIAdapter 146, server.js 188 | all < 300; nesting ≤ 3 |
| **B9 boot-fail-fast trace** | server.js 35→57→61→63 + 171-174 | `start()` awaits `loadJWTSecrets()` (57) → `await facade.init()` (61) → `app.listen` (63). init() throw → start() promise rejects → top-level `start().catch(...process.exit(1))` (171-174). **Listen never runs on misconfig.** Fail-fast GENUINE, not swallowed | **B9 CLOSED** |
| B9 await-safety | server.js 61 vs 171 | `init()` is AWAITED inside `start()`; its rejection is NOT a floating promise — it surfaces through start()'s returned promise to the `.catch` → `process.exit(1)`. No hang, no unhandledRejection-handler swallow (the 177-179 handler is a net for OTHER floats, not this awaited path) | safe |
| B9 valid-config boot | init() resolves → start() continues | getDefaultDb() returns a pool → init() resolves undefined → execution falls through to app.listen. Normal boot intact | confirmed |
| init() correctness | facade.js 58-62 | `require('../../lib/db')` resolves to `src/lib/db` (facade is at src/slices/ai-enrichment/ → `../../` = src/); calls `getDefaultDb()`; no try/catch → real db-config error propagates verbatim (`No database configuration found for environment: <env>`) | correct |
| init() idempotency / no double-build | lib/db/index.js 47-65 | `getDefaultDb()` memoized via `defaultDbCached`; constructor (adapter:62, no-db path) + init() both call it → ONE pool built, cached. init() safe to call once at boot; a second call is a no-op return | no double-build |
| init() does NOT build singletons | facade.js 58-62 vs 36-43 | init() calls ONLY `getDefaultDb()`; never `ai()`/`usage()`. `_ai`/`_usage` stay null → DI seams (`_setAdapters`/`_reset`) intact; B9-boot-guard asserts generate/checkQuota still callable post-init | seam preserved |
| Removed-check safety | adapter 55-64; grep NODE_ENV allowlist | constructor NODE_ENV string-allowlist GONE; no path depends on it (the only consumer was the deleted check); `['development','production','test']` allowlist now lives correctly in `getDefaultDb` (knexfile[env] lookup), which is the REAL config resolution | safe |
| server.js placement | server.js 49-63 | order: sync-lock sweep (49-54, own try/catch, non-fatal) → loadJWTSecrets (57) → **facade.init (61)** → listen (63). init() needs only env+knexfile (loaded at require('dotenv') line 5); no dependency on JWT secrets or the lock sweep; placing it before listen is the correct altitude | correct |
| **Cross-suite contamination** | `npx jest tests/api/ai-command tests/unit/aiEnrichment/adapterLifecycle tests/characterization/aiEnrichment/goldenMaster.h5 --runInBand` | **B9-boot-red FAILS** ("Received promise resolved instead of rejected") under this specific file order. Full-glob default order: 110/110 PASS. bert flagged B7-guard/B7-guard-2 — WRONG test | WARN-9 (telly) |
| Contamination root cause | adapterLifecycle 645,663,683 + ai-command 660,691 | adapterLifecycle captures `const libDb=require(lib/db)` at load, spies `getDefaultDb` on THAT ref; `init()` does a fresh `require(lib/db)` at call time; a sibling suite's `jest.resetModules()` (ai-command:660/691) swaps the registry so init()'s fresh require is UNSPIED → real cached getDefaultDb → no throw → B9-boot-red's `.rejects` resolves. Test-only fragility; production unaffected | WARN-9 |
| Fallback scan | grep `\|\|`/`??` in 3 files | adapter DI defaults (`d.db`/`d.env`/`d.model`/`d.logger`); `GEMINI_API_KEY \|\| ''` (B8 compare-sentinel, unchanged); `VERTEX_AI_LOCATION \|\| 'us-central1'` (region default, unchanged); server `PORT \|\| 5002`, `NODE_ENV !== 'production'` (guards). init() adds NO new fallback. None mask maybe-null business data | no BLOCK |
| Output written | append CODE-REVIEW.md + update ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present — mode=bugfix, 3 files in scope
- [x] Scope confirmed — file list non-empty, printed in Proof-of-Work
- [x] Mode noted + gate checked — bugfix; B9-boot-red/guard/env-ok RED→GREEN in adapterLifecycle.test.js; 11/11 reproduced GREEN isolated
- [x] Complexity scan — facade 88, GeminiAIAdapter 146, server.js 188; all < 300; nesting ≤ 3
- [x] Error handling scan — `init()` has NO try/catch (correct: it MUST let getDefaultDb's throw propagate to fail boot); server.js `start().catch` exits(1) — no swallow; the listen-callback's startup-enqueue has its own `.catch` (server.js:79)
- [x] Floating-promise / forEach(async) / Promise.all-partial scan — `await facade.init()` is awaited (not floating); a rejection flows to start()'s `.catch`; server.js's pre-existing `Promise.all(...).then().catch()` (70-81) and the cron `forEach` (75,77) are unchanged from HEAD and out of the B9 change-region
- [x] Error-cause-preservation scan — `init()` lets the ORIGINAL getDefaultDb error propagate unwrapped (no wrap-without-cause, no success-default swallow); no catch in init() at all
- [x] Input validation scan — `init()` takes no params; entry-point validation (handleCommand `command`, suggest-icon `text`) unchanged from prior review and out of scope
- [x] Unapproved-fallback scan — all `||`/`??` in the 3 files triaged (Proof-of-Work row); init() adds none; existing ones are DI/region/port defaults + B8 compare-sentinel — none mask maybe-null business data → no BLOCK
- [x] Numeric precision/boundary scan — `parseInt(env.AI_CALL_TIMEOUT_MS, 10)` radix present (adapter:52); `PORT \|\| 5002` numeric default; no money/float/index math in the B9 change
- [x] ReDoS scan (ernie OWNS) — no regex added by the B9 change; `lsof` exec in server.js (pre-existing, dev-only zombie-kill) takes no user input; no `new RegExp(userInput)`
- [x] Date/TZ & DB-clock scan — B9 change adds no date math; `getDefaultDb()` builds a pool, MySQL owns stored timestamps; not the cache-staleness class
- [x] Resource scan — `init()` builds the shared knex pool once (memoized, app-lifetime — intentional, destroyed in shutdown via `db.destroy()` server.js:152); no per-call handle; no timer; no sync I/O added (the pre-existing dev-only `execSync` lsof at server.js:16 is unchanged + guarded by NODE_ENV!=='production')
- [x] DB-transaction/atomicity scan — `init()` performs NO write (only resolves the pool handle); no dependent multi-write to wrap
- [x] Concurrency scan — `init()` runs ONCE at boot before `app.listen` (no concurrent callers); `defaultDbCached`/`_ai`/`_usage` mutations are single-threaded boot-time; no shared per-request mutable state added
- [x] Idempotency-under-retry scan — `init()` is a boot-sequence call, not a Cloud Tasks/webhook consumer; getDefaultDb memoization makes a repeat call a no-op anyway; idempotency satisfied by design
- [x] Grep matches triaged, not just counted — every `||`/`??`, parseInt READ in context; the boot-fail-fast conclusion drawn from TRACING server.js start()→catch→exit (not a grep); contamination root-caused by READING the spy/resetModules interaction across two suites
- [x] Type safety scan — plain JS; `init()` destructures `{ getDefaultDb }` from a known module shape; no `as any`/`@ts-ignore`; optional chaining unchanged elsewhere
- [x] React logic scan — SKIPPED, no .jsx/.tsx in scope (all backend)
- [x] Observability scan — server.js `start().catch` logs `Fatal startup error` via structured `serverLogger.error` before exit(1) — a boot-fail is observable; init() itself is silent-on-success (correct, no noise)
- [x] Dead code scan — constructor NODE_ENV allowlist REMOVED (the prior dead/wrong check); no new commented-out blocks; no new TODO/FIXME; `_getDb` lazy-fallback retained (still used by generate())
- [x] Flag-and-refer lines emitted — telly (B9-boot-red cross-suite contamination — false-confidence on the boot-fail-fast proof; bert mis-identified the test) — see Finding 10
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed as ernie BLOCK/WARN — contamination referred to telly as WARN-on-test-quality (an EXISTING test silently stops asserting), not a "missing test"
- [x] No security findings reviewed in depth — none sighted in the B9 change (no injection/secret/authz introduced)
- [x] Prior knowledge consulted — prior W3/W2a CODE-REVIEW section (Finding #5, this file) read; this iteration verifies the human-approved fix to that exact BLOCK; no relitigation (the design was decided 2026-06-12 per adapterLifecycle.test.js:18, recorded in TRACEABILITY B9)
- [x] Knowledge changes reported to Scooter — none authored by ernie; B9 implements an already-approved decision (boot-wire facade.init), changes no requirement/standard
- [x] Rubric Coverage Map emitted — all 9 dimensions marked
- [x] Output file written with Proof-of-Work, Proof Checklist, Findings, Sign-off
- [x] Status line set — DONE (prior BLOCK #5 RESOLVED; no new BLOCK)

## Re-review delta
| Prior finding | File:line | Verdict | Evidence |
|---------------|-----------|---------|----------|
| #5 BLOCK (B9 fail-fast-at-boot goal not met — lazy constructor never runs at boot) | GeminiAIAdapter.js:55-73 + facade.js:33-43 | **RESOLVED** | Approach replaced: `facade.init()` (facade.js:58-62) eagerly resolves `getDefaultDb()`; wired into `server.js start()` at line 61 (after loadJWTSecrets, before app.listen); throw propagates to `start().catch → process.exit(1)` (171-174). Misconfig now fails AT BOOT, not first request. Constructor NODE_ENV allowlist removed. 11/11 adapterLifecycle GREEN isolated. |
| #6/#7 INFO (W1 encode / W2 attribution) | ai.controller.js | unchanged (REFER→elmo) | out of this re-review's 3-file scope; elmo owns |
| #8 INFO (B6 handleCommand-500 asymmetry; coverage) | ai.controller.js:39-51 | unchanged (REFER→telly) | out of scope; pre-existing, telly owns the coverage gap |

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 9 | INFO | server.js:59-61 (+ facade.js:58-62) | **B9 boot-fail-fast CONFIRMED GENUINE.** `await facade.init()` is correctly placed after `loadJWTSecrets()` and before `app.listen()`; `init()` propagates the real `getDefaultDb()` config error (no try/catch swallow); the rejection flows through `start()`'s returned promise to the top-level `start().catch(err => { serverLogger.error('Fatal startup error'); process.exit(1) })` (server.js:171-174) → process exits 1 BEFORE listen. A valid config resolves cleanly and boot proceeds. init() validates ONLY the db seam (does not eager-build ai()/usage() singletons → DI/test seams intact); constructor + init() share the memoized `getDefaultDb()` pool (no double-build). | None — this is the closure evidence for prior BLOCK #5. No action. |
| 10 | WARN | tests/unit/aiEnrichment/adapterLifecycle.test.js:645,663,683 | **Cross-suite contamination is REAL but bert mis-identified the test.** It is **B9-boot-red** (not B7-guard/B7-guard-2) that breaks under a specific run order: `npx jest tests/api/ai-command tests/unit/aiEnrichment/adapterLifecycle tests/characterization/aiEnrichment/goldenMaster.h5 --runInBand` → B9-boot-red "Received promise resolved instead of rejected". Root cause: the suite captures `const libDb=require(lib/db)` at load and spies `getDefaultDb` on that reference, but `facade.init()` does a FRESH `require(lib/db)` at call time; a sibling suite's `jest.resetModules()` (ai-command.test.js:660,691) swaps the module registry so init()'s require returns an UNSPIED module → the real (cached) `getDefaultDb` runs → no throw → the `.rejects` assertion silently resolves. **This is not benign "pre-existing": B9-boot-red is the SOLE proof that boot-fail-fast PROPAGATES, and it can silently stop asserting under run-order churn — a false-confidence gap on the exact guarantee this leg delivers.** Production code is unaffected (the lazy-rebuild + memoization is correct); the defect is test-only. | REFER→telly: make B9-boot-red resilient to sibling `resetModules()` — either `jest.spyOn` the module that `init()` actually re-requires at call time (re-acquire `libDb` AFTER any reset, or `jest.doMock` the lib/db `getDefaultDb` to throw and re-require the facade inside the test), or add a `beforeEach(() => jest.resetModules())` so the suite owns its registry. Then assert it holds under `--runInBand` with ai-command ordered first. bert's "pre-existing, not W2a" label is incorrect for THIS test — it guards the W2a B9 deliverable; treat as a W2a test-hardening item, not a deferral. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | Boot-fail-fast traced start()→init()→catch→exit(1); valid-config boots; no double-build; singletons not eager-built | Prior BLOCK #5 RESOLVED |
| Readability | covered | init() JSDoc states the boot-hook contract + why singletons stay lazy; server.js B9 comment ties placement to intent | — |
| Maintainability | covered | Wrong NODE_ENV allowlist removed; the real allowlist lives in getDefaultDb (knexfile lookup) — single source | — |
| Error Handling | covered | init() intentionally has no catch (must propagate); start().catch logs+exits; no swallow | — |
| Coupling | covered | server→facade.init is a thin, intended boot edge; facade→lib/db via getDefaultDb (ADR-0002); no new cross-boundary leak | cookie if the boot edge wants a deeper look — none warranted |
| Type Safety | covered | plain JS; destructure of known module shape; no unsafe cast | — |
| API Design | covered | `init()` added as a clean async boot hook on the facade; idempotent; does not perturb generate/checkQuota/quota seams | — |
| Resource Management | covered | one memoized pool, app-lifetime, destroyed in shutdown; no new handle/timer; no sync I/O added | — |
| Concurrency Safety | covered | init() runs once at boot pre-listen; memoization makes repeat a no-op; no shared per-request mutable state | — |

## Sign-off
Signed: Ernie — 2026-06-12T00:00:00Z

---

# Ernie Review — W3 quota atomicity (commitQuota TOCTOU fix) — bugfix — 2026-06-12

## Status: DONE

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=bugfix, files from positional (KnexAIUsageRepository.js, ai.controller.js) | present |
| Scope detect | read both files in full + facade.js + quotaTOCTOU.test.js | 2 review files |
| Mode gate (bugfix) | failing test exists: `quotaTOCTOU.test.js` B11-race [RED→GREEN] | satisfied |
| Complexity scan | wc -l: KnexAIUsageRepository=122, ai.controller=153; commitQuota nesting ≤2 | under 300; OK |
| Error handling scan | `db.transaction(cb)` auto-rolls-back on throw / commits on resolve; controller try/catch around commitQuota (W1b WARN-2); outer try/catch → 500 | OK |
| Floating-promise / forEach scan | grep forEach(async/.then → none; all awaits inside try or transaction cb | clean |
| Error-cause scan | no catch-returns-success-default; commitErr logged (warn) not swallowed silently | clean |
| Input validation scan | controller validates `command` (400 if empty); userId from `req.user.id` (authed); userId not externally shaped | OK |
| Unapproved-fallback scan | grep `\|\|`/`??`: all are boolean guards / shape-defaults on optional config (tasks/statuses/config) or `Number(x)\|\|0` on a COUNT (cannot be a real null slot) — none paper over a maybe-null DB field | no BLOCK |
| Numeric/boundary scan | grep parseInt → none; count math is integer COUNT(*); `count < limit` boundary correct (49<50 inserts, 50<50 skips) | OK |
| ReDoS scan | controller regexes are fixed literal char-classes (smart-quotes, ```json strip, HTML-entity encode) — no nested/overlapping quantifiers, no `new RegExp(userInput)` | clean |
| Date/DB-clock scan | `windowStart = new Date(Date.now()-24h)` used as a query BOUND (param), not a persisted authoritative timestamp; `created_at` defaults to DB NOW() (insert has no created_at) → DB clock IS source of truth for the stored row | OK |
| Resource scan | `db.transaction` manages the trx connection (commit/rollback both release it); deny path = clean resolve of empty trx → committed+released, no leak; no sync I/O; no timer | OK |
| DB-transaction/atomicity scan | commitQuota wraps SELECT…FOR UPDATE + conditional INSERT in one trx — the dependent read+write are atomic; matches WBS W3 acceptance (a) | correct |
| Concurrency scan | FOR UPDATE serializes concurrent committers; re-count inside trx does NOT trust checkQuota's stale count; no module-level mutable per-request state | race closed |
| Idempotency scan | commitQuota is NOT idempotent (each call inserts a slot) but it is NOT a queue/webhook consumer — it is invoked once per successful HTTP request behind express-rate-limit; no guaranteed-retry delivery on this path | N/A — not retry-driven |
| trx.raw shape verify | `const [lockRow] = await trx.raw('SELECT COUNT…')` → mysql2 returns `[rows,fields]`, lockRow=rows, `lockRow[0].cnt`=count; matches repo convention (migration `const [cols]=…raw(SHOW COLUMNS)`, task-write-queue `row[0]`) | correct |
| Type safety scan | no `as any`/@ts-ignore (plain JS); null-guards present on lockRow chain | OK |
| React scan | no .jsx/.tsx in scope | skipped |
| Observability scan | commitErr logged via structured `logger.warn` with context; no bare console.log | OK |
| Dead code scan | no TODO/FIXME; no commented-out blocks | clean |
| Scooter consult | INBOX checked + W3/B11/WARN-2 TRACEABILITY read; deny-path design clarified + process-decision notice appended to INBOX | done |
| Output written | append to .planning/kermit/reviews/CODE-REVIEW.md | Done |

## Scooter Consult (W3)
**Question asked:** Is the atomic-deny path's silent success (race-loser gets the AI result un-counted, commitQuota returns void) an acceptable/approved design, consistent with the W1b WARN-2 "commit failure non-fatal" decision?
**Brain state:** HEALTH-ALERT absent; answered from authoritative leg docs (TRACEABILITY.md, WBS) since the change is mid-leg (not yet reconciled to KG).
**Cited record:**
- `TRACEABILITY.md` B5 / AP-72g B5-warn2 [GREEN]: handleCommand + success + commitQuota throws → 200 with AI result. The recorded WARN-2 decision: a DB write failure must NOT discard the user's result; under-count-by-one acceptable.
- `WBS-juggler-h5-fixes.md` W3 acceptance (a): "two concurrent calls at count=49 → **exactly one passes**." This is a ROW-COUNT invariant (finalCount ≤ 50), NOT a "tell the loser it lost" requirement.
**Conclusion (no veto relitigated):** The atomic-deny path (re-count ≥ limit → skip INSERT → resolve void) is a deliberate fail-open that EXTENDS the WARN-2 rationale: a sub-second boundary-race loss under-counts by at most one slot, and signalling the loss would require either discarding a successful AI result (re-introduces the WARN-2 regression) or a second round-trip — neither warranted. Consistent with the recorded decision. Process-decision notice appended to INBOX to make this explicit for the next asker.

## Proof Checklist
- [x] Required inputs present — mode=bugfix, 2 files in scope
- [x] Scope confirmed — both files read in full + facade + B11 test
- [x] Mode gate checked — bugfix: failing test `quotaTOCTOU.test.js` B11-race (RED→GREEN) present
- [x] Complexity scan run — 122/153 lines, nesting ≤2, under threshold
- [x] Error handling scan run — transaction auto-rollback; controller WARN-2 try/catch; outer 500 catch
- [x] Floating-promise / forEach(async) / Promise.all scan run — none; all awaits inside try/trx
- [x] Error-cause-preservation scan run — commitErr logged (warn), not a success-shaped swallow
- [x] Input validation scan run — command validated (400); userId from authed req.user.id, not external input
- [x] Unapproved-fallback scan run — all `\|\|`/`??` are boolean/shape guards or `Number()\|\|0` on a COUNT; none over a maybe-null DB field; CLAUDE.md approved-fallback list checked (those are frontend TaskDetailHeader entries, not in scope)
- [x] Numeric precision/boundary scan run — no parseInt; integer COUNT; `count<limit` boundary correct
- [x] ReDoS scan run (ernie OWNS) — controller regexes fixed char-classes, no nested quantifiers, no new RegExp(userInput)
- [x] Date/TZ & DB-clock scan run — windowStart is a query bound (param), stored row uses DB NOW() default → DB clock authoritative
- [x] Resource management scan run — trx commit/rollback both release; deny path is empty committed trx, no leak; no sync I/O; no timer
- [x] DB-transaction/atomicity scan run — dependent SELECT FOR UPDATE + INSERT in one trx with rollback-on-throw
- [x] Concurrency safety scan run — FOR UPDATE serializes; re-count distrusts stale checkQuota; no shared per-request state
- [x] Idempotency-under-retry scan run — commitQuota is not a queue/webhook consumer; no guaranteed-retry on this path → N/A
- [x] Grep matches triaged, not just counted — every `\|\|`/`??`, raw-destructure, and Date match READ in context and reasoned (mysql2 [rows,fields] shape confirmed against repo precedent)
- [x] Type safety scan run — no unsafe casts; null-guard chain on lockRow present
- [x] React logic scan — skipped (no .jsx/.tsx in scope), noted
- [x] Observability scan run — structured logger.warn on commit error; no bare console.log
- [x] Dead code scan run — no TODO/FIXME, no commented-out blocks
- [x] Flag-and-refer lines emitted — telly (deny-path assertion gap), elmo (n/a — no security finding surfaced)
- [x] All findings carry file:line + BLOCK/WARN/INFO severity
- [x] No "missing test" findings filed as ernie BLOCK — coverage gap referred to telly
- [x] No security findings reviewed in depth
- [x] Prior knowledge consulted via Scooter — TRACEABILITY/WBS read; WARN-2 decision honored, not relitigated
- [x] Knowledge change reported to Scooter — process-decision INBOX notice appended (deny-path fail-open clarification)
- [x] Rubric Coverage Map emitted (below)
- [x] Output appended to .planning/kermit/reviews/CODE-REVIEW.md
- [x] Status line set: DONE (no unresolved BLOCK)

## Findings (W3)
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| W3-1 | INFO | KnexAIUsageRepository.js:101-119 | **commitQuota atomicity CONFIRMED CORRECT.** The transaction re-counts under `SELECT COUNT(*) … FOR UPDATE` (does NOT trust checkQuota's stale count); on re-count ≥ limit it correctly skips the INSERT (`if (count < limit)`); the FOR UPDATE range-lock on idx_ai_command_log_user_time serializes concurrent committers so the second caller blocks, re-evaluates at count=50, and skips. Row-count invariant finalCount ≤ 50 holds (B11 criterion a). Knex `db.transaction(cb)` commits on resolve / rolls back on throw → no leaked connection on deny (empty trx commits+releases) or on error (rollback+releases). `const [lockRow] = trx.raw(…)` correctly reads mysql2's `[rows,fields]` (lockRow=rows, lockRow[0].cnt=count), matching repo precedent. | None — closure evidence for prior BLOCK B11. No action. |
| W3-2 | INFO | ai.controller.js:115-119 | **Deny-path fail-open is consistent with WARN-2, not a bug.** When the atomic re-check denies (user passed checkQuota but lost the race), commitQuota resolves `void` — no error, no 429. The controller returns the already-computed AI result (200) un-counted. This is NOT the "lost result" regression: it EXTENDS the recorded WARN-2 decision (under-count-by-one on a rare write event is acceptable; discarding a successful result is not). The 50/day cap is enforced as a row-count invariant, not as a per-caller win/lose signal. Verified against TRACEABILITY B5/AP-72g + WBS W3 acceptance (a). | None — design-correct. Recorded as a process-decision in Scooter INBOX so the next reader doesn't re-flag it. |
| W3-3 | INFO | tests/unit/aiEnrichment/quotaTOCTOU.test.js:208-257 | **Deny-path BEHAVIOR is asserted only at the row-count level.** B11-race asserts `finalCount ≤ 50` (the binding invariant — good) but deliberately does NOT assert the loser's outcome (the comment at :254-257 says either allowed=false OR a rejected promise is acceptable). Given the chosen mechanism resolves void (never rejects, never returns allowed=false from commitQuota), there is no test pinning that the race-LOSER's request still returns its AI result (200, not 429/500) and that commitQuota does not throw on the skip path. The logic is correct as written; the gap is a missing positive assertion on the loser's success path. | REFER→telly: add an assertion that the denied concurrent caller (a) does not throw from commitQuota and (b) at the controller level still returns 200 with its result (mirror of AP-72g B5-warn2 but for the race-loss path, not the DB-error path). ernie notes this is a coverage gap, not a logic defect. |
| W3-4 | INFO | KnexAIUsageRepository.js:69,107 | checkQuota and commitQuota use the IDENTICAL 24h window expression `new Date(Date.now() - 24*60*60*1000)` and the same `dailyLimit` → the limit is applied consistently across check and commit (no double-count, no window skew). Minor: the window is a 24h ROLLING window, not a calendar day; the user-facing message says "tomorrow" (controller:69). Pre-existing semantics, unchanged by W3. | None for W3. (Pre-existing rolling-vs-calendar wording is out of this leg's scope.) |

## Coverage Map (W3)
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | Re-count under FOR UPDATE; `count<limit` boundary correct; deny skips INSERT; mysql2 raw shape correct; finalCount≤50 invariant holds | Prior BLOCK B11 RESOLVED |
| Readability | covered | commitQuota JSDoc states the FOR UPDATE serialization mechanism + the skip-on-limit branch; inline comments explain the lock anchor | — |
| Maintainability | covered | dailyLimit injectable; window expression factored identically in both methods; no magic beyond AI_DAILY_LIMIT const | — |
| Error Handling | covered | trx auto-rollback on throw; controller WARN-2 try/catch isolates commit DB error from the response; deny is a clean resolve (no error to handle) | — |
| Coupling | covered | repo depends only on lib/db getDefaultDb (ADR-0002) + the trx; controller calls via facade; no new cross-boundary edge | cookie owns infra-locking depth per CONTEXT — deferred |
| Type Safety | covered | null-guard chain `lockRow && lockRow[0] && lockRow[0].cnt`; Number() coercion on COUNT; plain JS, no unsafe cast | — |
| API Design | covered | checkQuota returns {allowed}; commitQuota returns void (intentional — see W3-2); split contract preserved from W1b | Deny signal intentionally absent (design-recorded) |
| Resource Management | covered | db.transaction owns the connection; commit+rollback both release; empty-deny trx commits cleanly; no leak on any path | — |
| Concurrency Safety | covered | FOR UPDATE exclusive range-lock serializes committers; re-count distrusts stale checkQuota count; race closed; no module-level per-request mutable state | The core W3 deliverable — verified |

## Sign-off (W3)
Signed: Ernie — 2026-06-12T00:05:00Z
