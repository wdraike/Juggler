# Ernie Review — ai-enrichment slice (JUG-HEX H5) — refactor — 2026-06-11

## Status: DONE

> **Re-review iteration 2 (2026-06-11) — FINAL.** Re-verified bert iteration-2's B5 fix
> on the single changed file `GeminiAIAdapter.js` with a real call-chain repro (NOT the log).
> **B5 is RESOLVED.** bert replaced the leaky `configWithSignal` copy with a `signalClient`
> wrapper that merges `abortSignal` into the `generateContent` params at the SDK boundary
> ONLY, and now passes the ORIGINAL unmodified `config` to `trackedGeminiCall` (telemetry path).
> Proven: persisted `ai_usage_outbox.model_params` is byte-identical to legacy
> (`{"temperature":…,"topP":…,"topK":…,"maxOutputTokens":…}`) with NO `abortSignal` key, on
> BOTH the success path and the timeout/abort path. No new correctness regression from the
> wrapper. Status DONE: zero unresolved BLOCK. W2 (orphaned-enqueue-on-abort) remains a
> documented BACKLOG WARN per the dispatch (not re-flagged as BLOCK). Iteration-2 delta in
> `## Re-Review Delta (iteration 2 — FINAL)` below.
>
> _(Superseded: iteration-1 ISSUES status / B5-new BLOCK — now RESOLVED.)_

## Re-Review Delta (iteration 2 — FINAL)

**Scope:** `juggler-backend/src/slices/ai-enrichment/adapters/GeminiAIAdapter.js` (only file changed since iteration 1).

**B5 — RESOLVED.** Explicit statement: **B5 (persisted telemetry leaked `abortSignal`) is genuinely fixed.**

| Iteration-1 finding | Iteration-2 verdict | Evidence (real repro, not log) |
|---------------------|---------------------|--------------------------------|
| **B5-new** (config copy leaks `abortSignal` into persisted `model_params`) | **RESOLVED** | bert iteration-2 (`GeminiAIAdapter.js:105-147`) deleted `configWithSignal`. The adapter now (1) builds a `signalClient` whose `models.generateContent(params)` calls `rawClient.models.generateContent(Object.assign({}, params, { config: Object.assign({}, params.config, { abortSignal }) }))` — merging the signal into a COPY of the config at the SDK boundary only (line 110-117); and (2) passes the **ORIGINAL** `config` to `trackedGeminiCall(this._getDb(), signalClient, this.model, contents, config, meta)` (line 136-138). `trackedGeminiCall` persists `modelParams: config ?? null` (gemini-tracked-call.js:22) → `ai-usage-queue.service.js:15` `JSON.stringify`. Repro (real GeminiAIAdapter + real trackedGeminiCall + real signalClient + capturing fake db, ai.controller's exact config shape) confirms persisted `model_params` = `{"temperature":0.7,"topP":0.9,"topK":40,"maxOutputTokens":2048}` — **byte-identical to legacy snapshot, `hasOwnProperty("abortSignal")===false`**. The signal CANNOT reach the persisted config: the only object carrying it is the per-call `Object.assign` copy inside `signalClient.generateContent`, which is never passed to `enqueue`. |
| **B3** (generate params reach SDK unchanged) | **CONFIRMED** | Same repro: SDK boundary received `config` with `temperature/topP/topK/maxOutputTokens` all at legacy values PLUS `abortSignal instanceof AbortSignal === true`. TEST B (config with `safetySettings`, `tools`, `responseMimeType`): wrapper preserved every key and only ADDED `abortSignal` — drops nothing. Original caller `config` object unmutated (`!("abortSignal" in cfg)`). |
| **signalClient wrapper correctness** | **CONFIRMED** | (1) Forwards to real client with merged signal — verified. (2) No double-wrap: a single `Object.assign` layer for params, a single layer for config. (3) Drops no needed method: `trackedGeminiCall` only ever calls `client.models.generateContent` (grep-confirmed — no other client method used on the SDK path), and the wrapper provides exactly that. (4) No unhandled rejection: repro across success + timeout/abort + undefined-config paths recorded **0 unhandledRejection events** (`timeoutPromise.catch(()=>{})` and `callPromise.catch(()=>{})` swallow the race-losers). |
| **Abort actually fires the signal** | **CONFIRMED** | Timeout repro (timeoutMs=50, never-resolving SDK with a signal listener): `controller.abort()` fired → SDK's `abort` listener fired → SDK promise rejected; caller got deterministic `ETIMEDOUT`; persisted `model_params` STILL clean (`{"temperature":0.5,"topP":1,"topK":32,"maxOutputTokens":100}`, no `abortSignal`) even on the abort path. |
| **W2** (orphaned enqueue on abort) | **BACKLOG (WARN, unchanged)** | Per dispatch: NOT re-flagged as BLOCK. The `finally`→`enqueue` still fires an error telemetry row on abort. Documented backlog; out of B5 scope. |
| undefined-config path divergence | **NOT A PRODUCTION PATH** | TEST C: with `config===undefined` the wrapper sends SDK `{abortSignal}` and persists `model_params: null` (legacy persisted null too). Both production callers (`ai.controller.js:25`, `task.routes.js:38`) ALWAYS pass a concrete config object (grep-confirmed), so this divergence is unreachable in production. No finding. |

**Verification method (real repro, per dispatch ask):** Three `node`-driven repros exercising the REAL `GeminiAIAdapter.generate` → REAL `trackedGeminiCall` → REAL `ai-usage-queue.enqueue` chain with a capturing fake `db` and fake SDK client. Confirmed (1) telemetry byte-identity on success + abort paths; (2) signalClient forwards correctly, preserves all params, adds only `abortSignal`, no double-wrap, no dropped method, 0 unhandled rejections; (3) no new correctness regression. Temp repro scripts removed after run.

> _Iteration-1 sections below are retained for history; B5-new is now RESOLVED per the iteration-2 delta above._

## Re-Review Delta (iteration 1)

**Scope:** `juggler-backend/src/slices/ai-enrichment/adapters/GeminiAIAdapter.js`,
`juggler-backend/src/slices/ai-enrichment/facade.js` (only these two changed since
the prior review).

| Prior finding | Verdict | Evidence |
|---------------|---------|----------|
| **W2** (race-not-cancel, orphaned telemetry) | **PARTIALLY RESOLVED → re-filed as B5-new + W2 (telemetry half PERSISTS)** | bert wired a real `AbortController` (`GeminiAIAdapter.js:102-114`) and threads `abortSignal` into a config COPY. The SDK genuinely accepts `abortSignal` (`genai.d.ts:4273`). The "cancellation" half of W2 is addressed for the *caller*. BUT the SDK type doc itself states *"AbortSignal is a client-only operation… will not cancel the request in the service. You will still be charged usage"* — so the upstream call is NOT torn down server-side, and the `finally`→`enqueue()` orphaned-telemetry row STILL fires (now as an error row, errorType=AbortError, not a late-success row). The test's own NOTE (geminiAdapterTimeout.test.js:15-20) confirms the orphaned-enqueue path is unresolved backlog. |
| **NEW B5-new** (config copy leaks `abortSignal` into persisted telemetry) | **NEW BLOCK** | See finding B5-new below — the copy correctly leaves the SDK call params unchanged, but `configWithSignal` (carrying `abortSignal`) is what's passed to `trackedGeminiCall`, which forwards it BOTH to `generateContent` AND to the persisted `modelParams`. `model_params` JSON now gains a `"abortSignal":{}` key — NOT byte-identical to legacy (refactor-equivalence break). |
| **W1** (quota TOCTOU) | UNCHANGED | KnexAIUsageRepository.js not in this re-review scope; verbatim-preserved pre-existing weakness, still WARN. |
| **I1–I5** | UNCHANGED | Out of changed-file scope; no regression. |

**Verification of the three re-review asks:**
- **(a) config not mutated / B3 generate-params preserved** — PARTIALLY. The original `config`
  object IS NOT mutated (verified: `Object.assign({}, config, …)` shallow-copies;
  `node -e` repro confirms `config` keys unchanged). temperature/topP/topK/maxOutputTokens
  reach the SDK unchanged. **HOWEVER** the prior review's stated goal — "the original `config`
  reference passed into the telemetry row (modelParams, B3) stays byte-identical to legacy" —
  is MISSED: `trackedGeminiCall` receives `configWithSignal` (not `config`) and persists THAT
  as `model_params`. Telemetry now carries an extra `"abortSignal":{}`. → **B5-new BLOCK**.
- **(b) AbortController + Promise.race composition correct** — YES. No unhandled rejection
  (`callPromise.catch(() => {})` swallows the loser, mirroring H1 fetchWithTimeout:55-62).
  No double-resolve (Promise first-settle-wins). Timer cleared in `finally` and `unref()`'d
  → no leaked handle. Timeout unit test PASS (2/2, run with `--globalSetup=` bypass; DB suite is telly's on 3407).
- **(c) orphaned enqueue on real abort** — STILL FIRES. `controller.abort()` → SDK rejects →
  `trackedGeminiCall` catch → `finally` → `enqueue()`. The abort does NOT prevent the
  telemetry row; it only changes it from a late-success row to an error row. The
  orphaned-telemetry WARN **still stands** (W2 telemetry half).

**facade.js (`_reset` / `_setAdapters`) — VERIFIED test-only, no prod-path change:**
Both members are underscore-prefixed and defined as separate object properties. The
production methods `generate` (facade.js:47-49) and `checkAndLogDailyQuota` (facade.js:51-53)
call `ai()`/`usage()`, which lazily build the REAL `GeminiAIAdapter` / `KnexAIUsageRepository`
— never `MockAIAdapter`. `_setAdapters` (undefined=no-touch / null=reset-to-lazy) and `_reset`
mutate the `_ai`/`_usage` singletons but are reachable only from tests
(grep: only `tests/characterization/aiEnrichment/e2-globalShared.h5.test.js` calls them).
`MockAIAdapter` is reachable ONLY via explicit `_setAdapters` DI. Live-wiring (real adapters
on the prod path) is preserved. No production behavior change. CLEAN.

## Scooter Consult
> NOTE: H5 is a **non-trivial** refactor; cookie owns the binding `## Scooter Consult` block in ARCH-REVIEW.md (per AGENT-STANDARD — ernie duplicates only on `--mode refactor --trivial`). The consult below is ernie's correctness-scoped read, not the gate artifact.

**Question asked:** Any binding decision/veto/prior approach on the 8s AbortController timeout convention, lib/db `getDefaultDb()` vs `src/db.js` (ADR-0002), the `GEMINI_API_KEY || ''` fallback, and the behavior-identical refactor contract for the H5 AIPort/AIUsagePort extraction.

**Cited answer (federated):**
- **8s timeout convention** — confirmed from the H1-weather slice: `juggler-backend/src/slices/weather/adapters/constants.js:37` defines `EXTERNAL_CALL_TIMEOUT_MS = 8000` as the AbortController budget for outbound provider/geocode fetches. H5 reuses the same 8000ms value (`GeminiAIAdapter.js:33`). The convention is real and the value matches. **Caveat:** weather uses a true `AbortController` that *aborts the in-flight fetch* (`fetchWithTimeout.js`); H5 uses `Promise.race` + a timer that rejects the caller but does NOT abort the underlying SDK call (see W2 below) — the value matches the convention, the cancellation mechanism does not.
- **lib/db vs src/db.js (ADR-0002)** — confirmed: `src/db.js` was collapsed (juggler-hex-h2 W5) to `module.exports = require('./lib/db').getDefaultDb()` — i.e. `src/db.js` and `lib/db.getDefaultDb()` return the **exact same** lazy-cached knex singleton / single pool. The slice's `require('../../../lib/db').getDefaultDb()` therefore resolves to the identical pool the legacy `require('../db')` used. Behavior-identical. (No literal "ADR-0002" doc found under `juggler-backend/docs/`; the decision is recorded in `src/db.js`'s header + the slice JSDoc. **Gap:** ADR-0002 cited by the slice has no on-disk ADR file — INFO REFER→cookie/abby, not a correctness defect.)
- **`GEMINI_API_KEY || ''` fallback** — PRE-EXISTING: `git show HEAD:.../ai.controller.js:18` shows `const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''` verbatim in the legacy code, immediately re-guarded by `if (!GEMINI_API_KEY) throw`. Preserved, not new. Not an unapproved fallback.
- **Behavior-identical contract** — H4 cache-coherence-trap memory (2026-06-11) is the governing lesson: green tests can pass while a slice is dead code or has broken a cross-component invariant. Two duties enforced here: (a) live-wiring trace (done — facade carries the request, see W2/live-wiring below); (b) enumerate every cache the module owns. **This slice owns NO cache** (quota is a per-request DB count+insert; the client singleton is a connection cache, not a data cache), so the cache-coherence split class does not apply.

**Confidence:** documented. **Vetoes in play:** none surfaced for ai-enrichment. **Brain health:** no HEALTH-ALERT; full confidence.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=refactor, files from positional list (8) | present |
| Scope detect | wc -l on 8 files | 529 lines total, all < 300 |
| Mode gate (refactor) | characterization tests exist (goldenMaster.h5, e2-globalShared.h5) + green? | exist; DB-backed suite is telly's to run on test-bed; timeout unit test run + PASS |
| Behavior-equivalence | `git diff HEAD` ai.controller.js + task.routes.js; `git show HEAD:` originals | verbatim extraction confirmed (client branch, generate params, quota, parsing) |
| Live-wiring trace | grep facade importers; grep GoogleGenAI in controllers/routes (exit gate) | ai.routes→handleCommand→facade; exit gate = 0 GoogleGenAI |
| Mock-on-prod check | grep MockAIAdapter / _setAdapters on prod path | mock only via _setAdapters (DI/tests); prod resolves real GeminiAIAdapter |
| Complexity scan | wc -l + nesting | largest = ai.controller 121 lines; no file > 300; no deep nesting added |
| Error handling scan | timeout/AbortController path, quota DB failure, race | timeout rejects ETIMEDOUT cleanly; finally clears timer; no swallow |
| Input validation scan | handleCommand command guard; suggest-icon text guard | preserved verbatim (400 empty command; {icon:null} empty text) |
| Unapproved-fallback scan | grep `\|\|`/`??` on 4 new files + git show originals | all DI defaults or pre-existing env guards; no NEW data-integrity fallback |
| Numeric/boundary scan | parseInt radix, money, off-by-one | none on these paths; quota `Number(row&&row.cnt)\|\|0` preserved verbatim |
| ReDoS scan | regex on user input | emoji `/\P{ASCII}/u` (bounded, ≤4 chars) + sanitize replaces — no backtracking; fixed patterns only |
| Date/TZ & DB-clock scan | quota window + occurredAt | `Date.now()-24h` window preserved verbatim; created_at via DB default (not app clock) — correct |
| Resource scan | timer leak, handle close | setTimeout cleared in finally + unref'd; no new handles |
| Transaction/atomicity scan | quota count-then-insert | non-transactional, but verbatim-preserved (pre-existing TOCTOU, see W1) |
| Concurrency scan | module state, quota race | facade lazy singletons (safe — idempotent build); quota race pre-existing |
| Idempotency scan | no queue/webhook consumer in scope | n/a |
| Type safety scan | `as any`/null guards | JS files; `result.candidates?.[0]?...` optional-chain preserved |
| React scan | no .jsx/.tsx in scope | skipped (no React files) |
| Observability scan | console.log / logger | no console.*; uses createLogger/aiControllerLogger |
| Dead code scan | TODO/FIXME; unused imports | none; AIPort/AIUsagePort port modules imported by tests only (contract base — see W3) |
| Output written | Write CODE-REVIEW.md | Done |

## Proof Checklist
- [x] Required inputs present: mode=refactor, 8 files in scope
- [x] Scope confirmed — 8 files, printed in Proof-of-Work
- [x] Mode noted + gate checked — refactor: characterization tests (goldenMaster.h5, e2-globalShared.h5, geminiAdapterTimeout) exist; timeout unit test run green; full DB suite deferred to telly (test-bed 3407)
- [x] Complexity scan run — all files < 300 lines, no deep nesting
- [x] Error handling scan run — timeout path rejects cleanly, no empty catch, no swallow
- [x] Floating-promise / forEach(async) / Promise.all-partial scan — `Promise.race` used correctly; loser promise's rejection handled (see W2 note); no forEach(async); no floating promise
- [x] Error-cause-preservation scan — timeout Error carries `code='ETIMEDOUT'`; trackedGeminiCall re-throws original err; no catch-returns-success-default in slice
- [x] Input validation scan — command guard (400) + suggest-icon text guard ({icon:null}) preserved verbatim
- [x] Unapproved-fallback scan — every `||`/`??` READ in context: DI defaults (`deps||{}`) or pre-existing env guards (`GEMINI_API_KEY||''`, `VERTEX_AI_LOCATION||'us-central1'`, `GEMINI_MODEL||'...'` all in git HEAD); no NEW fallback
- [x] Numeric precision/boundary scan — quota `Number()||0` + count`>=`limit preserved verbatim; no parseInt/money/off-by-one on path
- [x] ReDoS scan (ernie OWNS) — emoji validation regex `/\P{ASCII}/u` on a ≤4-char bounded input; sanitize uses simple char-class replaces; no `new RegExp(userInput)`; no catastrophic backtracking
- [x] Date/TZ & DB-clock scan — quota window `Date.now()-24h` preserved; `created_at` written by DB default (DB clock), `occurredAt: new Date(start)` is telemetry (unchanged from legacy)
- [x] Resource management scan — timer `unref()`'d + `clearTimeout` in finally; no leaked handles
- [x] DB-transaction/atomicity scan — quota count+insert non-transactional but VERBATIM-preserved (pre-existing, see W1)
- [x] Concurrency safety scan — facade lazy singletons idempotent; quota TOCTOU pre-existing (W1)
- [x] Idempotency-under-retry scan — no Cloud Tasks/webhook consumer in scope (n/a)
- [x] Grep matches triaged not counted — every `||`/`??`, the timeout race, and the quota count-insert were READ and reasoned against the legacy original
- [x] Type safety scan — optional-chaining on `result.candidates?.[0]` preserved; no unsafe casts
- [x] React logic scan — skipped (no .jsx/.tsx in scope)
- [x] Observability scan — no bare console.log; structured loggers used
- [x] Dead code scan — no TODO/FIXME; port base modules used only by tests/contract (W3 INFO)
- [x] Flag-and-refer lines emitted (elmo/cookie/telly below)
- [x] All findings carry file:line + BLOCK/WARN/INFO
- [x] No "missing test" findings filed (telly owns); W3 logic-untestable noted as INFO only
- [x] No security findings reviewed in depth (REFER→elmo emitted)
- [x] Prior knowledge consulted via Scooter — H1 timeout convention, ADR-0002/db pool, H4 cache-trap, GEMINI fallback origin all confirmed; no relitigation
- [x] Knowledge changes reported to Scooter — none (no requirement/standard changed this leg)
- [x] Rubric Coverage Map emitted — all 9 dimensions marked
- [x] Output file written as .planning/kermit/reviews/CODE-REVIEW.md
- [x] Status line set: DONE (no unresolved BLOCK)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| W1 | WARN | KnexAIUsageRepository.js:44-54 | Quota check is a count-then-insert with no transaction/atomic guard — a TOCTOU race lets two concurrent requests for the same user both read `count=49` and both insert, exceeding the 50/day cap by 1+. **This is PRE-EXISTING (verbatim from legacy `checkAndLogDailyQuota`) and NOT introduced by the refactor** — behavior is identical. Filed WARN per behavior-preservation contract: the extraction faithfully preserved a pre-existing weakness. The route-level 2/min rate limiter narrows the window. | No fix required for behavior-identical H5. If a future leg hardens the quota, use an atomic conditional insert or a transaction. Note in slice as known-preserved. |
| B5-new | ~~BLOCK~~ **RESOLVED (iter2)** | GeminiAIAdapter.js:105-147 → gemini-tracked-call.js:22 → ai-usage-queue.service.js:15 | **RESOLVED in iteration 2** (see `## Re-Review Delta (iteration 2 — FINAL)`): bert replaced `configWithSignal` with a `signalClient` wrapper that merges `abortSignal` at the SDK `generateContent` boundary only; the ORIGINAL `config` now reaches `trackedGeminiCall`. Real repro proves persisted `model_params` is byte-identical to legacy (no `abortSignal` key) on success AND abort paths. _Original iteration-1 finding below for history:_ **NEW regression from bert's W2 fix.** The AbortController `signal` is merged into a config COPY (`configWithSignal`), correctly leaving the SDK call params unchanged. But `configWithSignal` is what is passed to `trackedGeminiCall(... configWithSignal ...)`, and `trackedGeminiCall` forwards its `config` arg BOTH to `generateContent({...config})` AND to the persisted telemetry: `modelParams: config ?? null` → `model_params: JSON.stringify(event.modelParams)`. `JSON.stringify({temperature,topP,topK,maxOutputTokens, abortSignal: signal})` serializes the AbortSignal to `{}`, so every persisted `ai_usage_outbox.model_params` row now gains a junk `"abortSignal":{}` key. This is **NOT byte-identical to legacy** (legacy persisted the bare config). Verified by `node -e` repro. The intended invariant ("B3 telemetry params byte-identical") is broken — a refactor-equivalence defect, not a behavior-preserving change. | Keep `abortSignal` OUT of the value forwarded to telemetry: pass the signal through a separate channel (e.g. a 7th arg / the `meta` object, consumed only by `generateContent`), OR have the adapter pass the ORIGINAL `config` to `trackedGeminiCall` for telemetry while threading the signal in only at the `generateContent` boundary, OR strip `abortSignal` from `modelParams` before `enqueue`. Re-run the characterization golden-master (telly, 3407) to confirm `model_params` matches legacy. |
| W2 | WARN | GeminiAIAdapter.js:102-127 → gemini-tracked-call.js:16-30 | **PERSISTS (telemetry half).** bert's real `AbortController` resolves the *caller-cancellation* half (the SDK accepts `abortSignal`, genai.d.ts:4273; the caller now gets a deterministic ETIMEDOUT and the in-flight client promise rejects). BUT the SDK doc states AbortSignal is client-only — it does NOT cancel the upstream request server-side ("You will still be charged usage"), and on abort the SDK promise still settles → `trackedGeminiCall`'s `finally` STILL fires `enqueue(...)`, producing an orphaned `ai_usage_outbox` row (now an error row, errorType=AbortError) for a result the caller already discarded. The test itself documents this as unresolved backlog (geminiAdapterTimeout.test.js:15-20). | Accept the orphaned error-row as known-and-documented, OR suppress the `enqueue` when the failure is an abort/ETIMEDOUT (guard the `finally` on the abort reason). Confirm with product whether a billed+telemetered timed-out call is acceptable. Owner: bert/cookie per the test note. |
| I1 | INFO | task.routes.js:36-58 vs legacy | Behavior nuance: in the legacy suggest-icon, a missing `GOOGLE_CLOUD_PROJECT`/`GEMINI_API_KEY` returned `{icon:null}` **silently** (inline `return res.json` before any call). Now the adapter THROWS those errors, caught by the route catch which logs `logger.error('suggest-icon error:', ...)`. Same HTTP response, but a new error-log line appears where before it was silent. Not a contract break (response identical); noted for awareness. | None required. Acceptable observability improvement. |
| I2 | INFO | AIPort.js / AIUsagePort.js (whole file) | The port base modules (`AIPort`, `AIUsagePort`, `AI_*_PORT_METHODS`) are imported by NO production code — only by tests/contract assertions. This is intentional (a JSDoc-typedef contract + throw-not-implemented base; the call-sites program against the facade, not the port class). Logic is untestable-as-production-wiring by design — flagged INFO so it is not mistaken for dead code in a future sweep. | None. Confirm telly has a contract test asserting the adapters satisfy `AI_PORT_METHODS`. REFER→telly for coverage of the port-conformance contract. |
| I3 | INFO REFER→elmo | ai.controller.js:107 / 87-89 | Prompt-injection surface (user `command` flows into the Gemini system prompt; a "SCOPE RESTRICTION" prepend is the only guard) and the 422 raw-echo `cleaned.substring(0,500).replace(/[<>&"']/g,'')`. Both pre-existing, unchanged by H5. Security assessment is elmo's. | REFER→elmo (prompt-injection robustness + raw echo). Not reviewed here. |
| I4 | INFO REFER→cookie | facade.js / slice JSDoc | Slice cites "ADR-0002 (lib/db)" but no ADR file exists under `juggler-backend/docs/`. Boundary/port-direction and the missing ADR artifact are architecture concerns. | REFER→cookie (port/adapter boundary + ADR-0002 artifact existence). |
| I5 | INFO REFER→telly | tests/characterization/aiEnrichment | Full DB-backed golden-master + e2-globalShared suites require test-bed MySQL 3407 (jest globalSetup refuses 3307); I could only run the pure-unit timeout test (PASS). Confirming the green characterization suite on test-bed is telly's. | REFER→telly to run goldenMaster.h5 + e2-globalShared.h5 on test-bed and confirm green (refactor gate evidence). |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | partial | git diff confirms verbatim extraction of client branch, generate params, quota count+insert, response parsing | **B5-new (iter1): bert's W2 fix leaks `abortSignal:{}` into persisted telemetry `model_params` — NO LONGER byte-identical to legacy.** SDK call params unchanged; persisted telemetry is not. |
| Readability | covered | small focused files, clear JSDoc headers, no deep nesting | all < 300 lines |
| Maintainability | covered | facade is the single entry point; adapters injectable; H4 cache-trap duties satisfied (no cache; live-wired) | — |
| Error Handling | partial | timeout rejects cleanly (ETIMEDOUT); `callPromise.catch(()=>{})` prevents unhandled rejection; `finally` clears + `unref()`s timer (no leaked handle); quota DB failure propagates | W2 (persists): abort does not cancel upstream; `finally`→`enqueue()` still fires orphaned (error) telemetry row |
| Coupling | covered | slice imports lib/db (not src/db.js); call-sites program against facade; exit gate grep GoogleGenAI=0 | boundary depth → cookie (I4) |
| Type Safety | covered | JS; optional-chaining preserved on candidates parse; Number() coercion on quota count | — |
| API Design | covered | facade exposes exactly the 2 methods call-sites need + DI seam (_setAdapters); ports define method-name contracts | — |
| Resource Management | covered | timer unref()'d + clearTimeout in finally; no leaked handles; lazy DB resolve | — |
| Concurrency Safety | partial | facade lazy singletons idempotent | W1: pre-existing quota TOCTOU (verbatim-preserved, not introduced) |

## Re-Review Proof Checklist (iteration 2 — FINAL)
- [x] B5 verified with a REAL repro (not the log) — real GeminiAIAdapter→trackedGeminiCall→ai-usage-queue chain, capturing fake db; persisted `model_params` byte-identical to legacy, no `abortSignal` key
- [x] B5 verified on the ABORT path too — timeout fires `controller.abort()`, SDK signal listener fires, persisted telemetry STILL clean
- [x] signalClient wrapper correct — forwards to real client with merged signal; preserves ALL config keys (safetySettings/tools/responseMimeType); adds only `abortSignal`; no double-wrap; original caller config unmutated
- [x] No dropped client method — `trackedGeminiCall` only calls `client.models.generateContent` (grep-confirmed); wrapper provides exactly that
- [x] No unhandled rejection — 0 unhandledRejection events across success + timeout/abort + undefined-config repros
- [x] B3 generate-params reach SDK unchanged — temperature/topP/topK/maxOutputTokens at legacy values + `abortSignal` present at SDK boundary
- [x] No NEW correctness regression from the wrapper
- [x] W2 orphaned-enqueue-on-abort left as BACKLOG WARN (not re-flagged BLOCK, per dispatch)
- [x] undefined-config divergence reasoned — not a production path (both callers always pass concrete config)
- [x] Temp repro scripts removed after run
- [x] CODE-REVIEW.md updated with Status DONE + explicit B5-resolved statement + this proof checklist

## Sign-off
Signed: Ernie — 2026-06-11T00:00:00Z (original review)
Re-review iteration 1 — Ernie — 2026-06-11T00:00:00Z — Status: ISSUES (1 BLOCK: B5-new; W2 telemetry half persists). All proof-checklist boxes [x] for the re-review scope (two changed files). Composition (b) and facade test-affordance (point 2) verified clean.
Re-review iteration 2 (FINAL) — Ernie — 2026-06-11T00:00:00Z — Status: **DONE**. B5 RESOLVED, verified with a real call-chain repro on success + abort paths (persisted `model_params` byte-identical to legacy, no `abortSignal` key). signalClient wrapper correct (preserves all params, adds only the signal, no double-wrap, no dropped method, 0 unhandled rejections). No new correctness regression. Zero unresolved BLOCK. W2 left as documented BACKLOG WARN per dispatch. All iteration-2 proof-checklist boxes [x].
