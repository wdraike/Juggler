# Cookie Architecture Review — JUG-HEX H5 AI-enrichment slice — refactor — 2026-06-12

## Status: DONE

Boundary-unchanged refactor verified. Hexagonal seam is sound, dependency direction
points inward, both consumer call-sites route only through the facade, the SDK-leak
exit gate passes (`grep GoogleGenAI src/controllers src/routes` → 0 real imports), and
the extraction does not alter any service boundary or data-flow topology. Zero BLOCK.

**Re-review (fix-loop iteration 1, 2026-06-12):** WARN-1 RESOLVED — bert added the
AI-ENRICHMENT per-slice exemption blocks (eslint.boundaries.config.js:343-374) mirroring
the H3/H4 pattern. telly's facade test affordances (`_reset` + `_setAdapters` semantics)
verified — they do NOT breach the boundary or change the facade's sole-seam role. WARN-2
(timeout reject-without-abort doc) persists as a non-blocking doc nit. One WARN remaining,
all INFO refers — none blocking.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode refactor + --files (9) | present |
| Scope detect | explicit --files list | 9 files |
| Context files | read juggler CLAUDE.md, docs/architecture/ (7 docs), BASE-ARCHITECTURE-RUBRIC.md | found |
| Refactor gate | characterization + unit tests present (tests/characterization/aiEnrichment/, tests/unit/aiEnrichment/ in git status) | gate held |
| Scooter consult (cookie owns on refactor) | `Skill("scooter") --ask … --domain scheduler` | answered + block below |
| Infra review | n/a — no Terraform/Docker/deploy YAML in scope | 0 findings |
| Hexagonal boundary | read AIPort/AIUsagePort + 3 adapters + facade; verified ports define contract, adapters implement, facade sole seam | 0 BLOCK |
| Dependency direction | adapters `@implements` ports; ports throw-not-implemented base; controller/route import only `../slices/ai-enrichment/facade` | inward — clean |
| Consumer migration | grep `GoogleGenAI`/`@google/genai` in src/controllers + src/routes | 0 real imports (1 comment match) |
| eslint boundary rule | read +22 ln (lines 186-206); ran `npx eslint --config eslint.boundaries.config.js` on slice + consumers | EXIT 0; deep-import probe BLOCKED both adapter+port |
| eslint exemption parity | compared vs H3 (task) / H4 (user-config) per-slice exemption blocks | divergence — WARN-1 |
| Data-flow topology | EMOJI_SUGGEST + TASK_AI + quota flows unchanged; usage-telemetry (ai_usage_outbox) stays inside trackedGeminiCall | topology unchanged |
| Migration safety | no migration in scope; no enrichment/user_override tables exist | n/a |
| Resilience | timeout present (8s) but `Promise.race` rejects-without-abort vs H1 AbortController true-cancel | WARN-2 |
| Shared-global/per-user invariant | no enrichment-persistence tables exist → invariant not exercised, not regressed | confirmed via Scooter |
| Grep triage | every grep match READ + reasoned (GoogleGenAI match = docstring; src/db.js matches = docstrings; facade relative-require ≠ rule selector) | done |
| Output written | Write .planning/kermit/reviews/ARCH-REVIEW.md | Done |
| **Re-review (iter 1)** | re-scan 2 changed files vs prior findings | WARN-1 RESOLVED |
| eslint exemptions added | read eslint.boundaries.config.js:343-374 (4 blocks: facade/adapters/domain/tests) vs H3:309-341 / H4:376-408 | parity confirmed — selector shape + scope match |
| exemption scope check | block exempts only `**/slices/ai-enrichment/...` (facade.js, adapters/**, domain/**, *.test.js) — omits `application/**` (no such dir) | NOT broader than slice; tighter than H3/H4 (no application ring) |
| eslint exit 0 | `npx eslint --config eslint.boundaries.config.js src/` | EXIT 0 |
| boundary still enforced | external probe file deep-importing adapters/ + domain/ports/ | EXIT 1 — both BLOCKed, correct H5 messages |
| facade test affordances | read facade.js:59-65 — `_setAdapters` (undefined=skip / null=lazy-rebuild) + `_reset` mutate only private `_ai`/`_usage`; no slice-internal import bypass; no second seam | boundary intact — sole-seam role preserved |

## Re-Review Delta
| Finding | Prior | Now | Evidence |
|---------|-------|-----|----------|
| WARN-1 (missing per-slice exemption block) | WARN | **RESOLVED** | eslint.boundaries.config.js:343-374 — 4 exemption blocks added (facade / adapters/** / domain/** / tests) mirroring H3 (309-341) & H4 (376-408); same `files:` selector shape, same `no-restricted-syntax: off` scope, slice-scoped only (`**/slices/ai-enrichment/...`). External-file deep-import probe still BLOCKed (EXIT 1). `npx eslint --config eslint.boundaries.config.js src/` → EXIT 0. |
| WARN-2 (timeout reject-without-abort docstring) | WARN | PERSISTS | GeminiAIAdapter.js not in this re-review's changed-file set; doc nit remains, non-blocking. |
| facade `_reset` + `_setAdapters` semantics | NEW (telly change) | **CLEAN — no finding** | facade.js:59-65 — test affordances inside the facade's own `module.exports`; mutate only private lazy singletons `_ai`/`_usage`; import no slice-internal path that bypasses the facade; do not widen the public surface beyond the already-exported DI constructors (56-58). Facade remains the sole seam; hexagonal boundary not breached. |

Re-review counts: **RESOLVED 1 · PERSISTS 1 (WARN, doc) · NEW 0 BLOCK · 0 new violations**. Zero unresolved BLOCK → Status DONE.

## Proof Checklist
- [x] Required inputs present (--mode refactor + --files, 9 files)
- [x] Scope confirmed — 9 files in list
- [x] Mode-appropriate checks run (mode: refactor — focus on boundaries UNCHANGED; Scooter consult owned + written)
- [x] Infra/GCP/Cloud Run config scan completed (no infra files in scope — n/a, noted)
- [x] Service boundary scan completed (no cross-service import introduced; slice is intra-service)
- [x] Hexagonal ports/adapters scan completed (Node/GCP infra SDKs — @google/genai wrapped in adapter ring only)
- [x] Data-flow topology + domain isolation scan completed (behavior-preserving — topology unchanged)
- [x] Design patterns consistency scan completed (facade-per-slice idiom vs H3/H4 — WARN on exemption parity)
- [x] Scalability/statelessness scan completed (lazy singletons + injected db; no new instance-local shared state)
- [x] Resilience scan completed (timeout present; reject-without-abort nuance → WARN)
- [x] Migration & backward-compat safety scan completed (no migration in scope)
- [x] API-contract versioning scan completed (no shared inter-service contract touched; facade is intra-service)
- [x] Observability architecture scan completed (correlationId threaded through generate meta; usage telemetry unchanged)
- [x] Dependency direction scan completed (adapters→ports; consumers→facade only)
- [x] Flag-and-refer lines emitted for all out-of-column issues
- [x] Grep matches triaged, not just counted (each heuristic grep's matches READ + reasoned)
- [x] Prior knowledge consulted via Scooter (single front door) — consult block written below
- [x] All findings carry file:line + severity (BLOCK/WARN/INFO)
- [x] Rubric Coverage Map emitted — every dimension marked with evidence
- [x] Output file written with Proof-of-Work table
- [x] Status line set DONE
- [x] Re-review (iter 1): WARN-1 re-scanned → RESOLVED; facade test affordances scanned → no finding; eslint EXIT 0; boundary still enforced (external deep-import BLOCKed)

## Scooter Consult
**Question asked (`--domain scheduler`):** Is it architecturally sound for `GeminiAIAdapter`
to implement its timeout with `Promise.race` (rejects the caller but does NOT abort the
in-flight `@google/genai` SDK call), versus the H1-weather `AbortController` true-cancel
convention? And is the de-scope of `EnrichmentRepositoryPort` / `RedisAIUsageQueue` (no
`Enrichment`/`UserOverride` persistence built) a defensible work-item simplification rather
than a boundary/exit-gate failure, given the binding CLAUDE.md invariant is the
shared-global-enrichment vs per-user-override split?

**Scooter's cited answer (Confidence: documented):**
- **De-scope is defensible, NOT an exit-gate failure.** The H5 **exit gate**
  (`docs/architecture/JUGGLER-HEX-ROADMAP.md:254`) is four criteria: (1) `grep GoogleGenAI
  src/controllers src/routes` → 0; (2) *"enrichment stays globally shared + overrides
  per-user"*; (3) the AI call has a timeout; (4) usage-tracking unchanged. The
  `Enrichment`/`UserOverride` entities + `EnrichmentRepositoryPort` + `KnexEnrichmentRepository`
  + `RedisAIUsageQueue` are listed under *Work items* (roadmap:249-251), **not** under the
  exit gate. Criterion (2) is a *non-regression* clause on an EXISTING split — and the
  split's persistence **does not exist in the codebase**: `grep enrichment|user_override
  juggler-backend/src/db/migrations/` → 0 tables. There is no shared-global enrichment store
  to extract, so the invariant cannot be regressed by this refactor; building those ports
  would be a `new` feature (new tables + new persistence), out of scope for a
  behavior-preserving extraction. This **confirms** Kermit's leg-level consult: the de-scope
  is a defensible work-item simplification, and the shared-global/per-user split (CLAUDE.md
  §AI Enrichment) remains the binding invariant — untouched, not violated.
- **Timeout convention — sound for the SDK case, with one caveat.** The roadmap work-item
  says *"add timeout/AbortController"* (roadmap:251). The H1-weather convention
  (`OpenMeteoWeatherAdapter` / `NominatimGeocodeAdapter`) uses a real `AbortController` that
  cancels the underlying `fetch`. The Gemini SDK (`@google/genai generateContent`) is a
  library call, not a raw `fetch` the adapter controls — there is no public AbortSignal hook
  the adapter passes into `trackedGeminiCall`, so a `Promise.race` reject-on-deadline is the
  available mechanism. It satisfies the gate criterion ("AI call has a timeout" — the *caller*
  no longer hangs; suggest-icon→null, handleCommand→500). The **caveat** (architecturally
  honest, not a gate failure): the in-flight SDK request is not cancelled — it runs to
  completion in the background and its `ai_usage_outbox` enqueue still fires. That is a
  resilience nuance worth a WARN, not a BLOCK; behavior for the *caller* is preserved.

**Vetoes/constraints in play (scheduler-rules):** none bearing on the AI-enrichment seam.
The CLAUDE.md §AI Enrichment shared-global / per-user-override invariant is binding and is
**not** relitigated by this refactor.

**Cookie's architecture-angle confirmation:** I CONFIRM Kermit's leg-level consult. From the
boundary angle the de-scope removes *un-built* ports, not *required* ones — a refactor extracts
what exists; it does not manufacture a persistence domain. The exit gate's four criteria all
pass (verified independently below). No exit-gate failure.

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | ~~WARN~~ **RESOLVED** (re-review iter 1) | eslint.boundaries.config.js:343-374 | ~~No per-slice exemption block for the ai-enrichment slice.~~ **FIXED by bert:** 4 exemption blocks added (facade.js / adapters/** / domain/** / tests) mirroring H3 (309-341) & H4 (376-408). Verified: same `files:` selector shape + same `no-restricted-syntax: off` scope; slice-scoped to `**/slices/ai-enrichment/...` only — does NOT exempt any non-slice file (external probe still BLOCKed, EXIT 1). Correctly OMITS an `application/**` exemption (the slice has no application ring), so it is *tighter* than H3/H4, not broader. The `domain/**` exemption is a future-proof no-op today (port files contain no `require()`), matching the H3/H4 pattern. `npx eslint --config eslint.boundaries.config.js src/` → EXIT 0. | RESOLVED — no further action |
| 2 | WARN | adapters/GeminiAIAdapter.js:92-109 | The 8s timeout uses `Promise.race([trackedGeminiCall(...), timeout])` which **rejects the caller but does not abort** the in-flight `@google/genai` request — unlike the H1-weather `AbortController` true-cancel convention referenced in the W3 comment (line 30-32). The SDK call continues to completion in the background and its `ai_usage_outbox` enqueue still fires. Caller behavior is preserved (suggest-icon→null, handleCommand→500), so this is a resilience nuance, not a behavior change. Acceptable given the SDK exposes no AbortSignal hook through `trackedGeminiCall`; flagging so the divergence from the cited weather convention is on record. | Document the reject-without-cancel limitation in the adapter docstring (the comment implies AbortController-equivalence). If the SDK later exposes an AbortSignal, pass it through. → bert (doc) |
| 3 | INFO | adapters/GeminiAIAdapter.js:74-75 | `const apiKey = env.GEMINI_API_KEY \|\| ''` then throw-if-empty — this is the legacy `getGenAIClient` behavior reproduced verbatim (the `\|\| ''` collapses to the same throw path, no silent fallback). Not a new fallback; noted for the no-unapproved-fallbacks ledger. | none — behavior-identical reproduction; no action |
| 4 | INFO | adapters/GeminiAIAdapter.js:64, KnexAIUsageRepository.js:34 | `require('@google/genai')` and `require('../../../lib/db')` are correctly confined to the adapter ring (the only legitimate SDK home per the hexagonal rule) — confirming, not flagging. | none |
| 5 | INFO | ai.controller.js:54 | `var quota = await ...` uses `var` (pre-existing style in this controller). Logic/style is ernie's column, not architecture. | REFER→ernie: var usage / controller style |
| 6 | INFO | — | No ADR records the H5 timeout's reject-without-abort decision or the EnrichmentRepositoryPort/RedisAIUsageQueue de-scope rationale; both live only in code docstrings + the roadmap work-items list. | REFER→abby: needs short ADR for H5 de-scope + timeout-semantics decision |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Algorithmic Efficiency | covered | No new loops/queries; quota check is a single indexed count+insert (KnexAIUsageRepository:44-53), lifted verbatim | No N+1 introduced |
| Modularity | covered | Single-responsibility files: 2 ports (contract), 3 adapters (impl), 1 facade (seam); largest adapter 113 ln | Clean SRP; no god module |
| Separation of Concerns | covered | Controller/route are thin — delegate to facade; result-extraction stays in call-site (by design, behavior-preserving); DB access isolated to KnexAIUsageRepository | Facade is the sole public API |
| Scalability | covered | Lazy singletons (facade:33-43) + injectable db; no new module-level mutable shared state; quota count is per-user windowed | Stateless under Cloud Run scale-out |
| Data Architecture | covered | No migration in scope; quota over existing `ai_command_log`; created_at via DB default (unchanged) | No schema change |
| Resilience | partial | Timeout added (8s, GeminiAIAdapter:92-109) — closes the §6 #6 gap for the CALLER; but reject-without-abort (WARN-2) means upstream call not cancelled | Caller protected; upstream not cancelled |
| Extensibility | covered | Port + MockAIAdapter enable test doubles + provider swap; `_setAdapters` DI seam (facade:59) | Provider-swappable behind AIPort |
| Infrastructure | covered | No IaC in scope; adapter routes to lib/db (ADR-0002) not src/db.js singleton — correct pool reuse | n/a infra files |
| Redundancy | covered | Consolidates the DUPLICATED genai client factory (was in ai.controller + task.routes) into one adapter — removes duplication | Net redundancy reduction |

## Sign-off
Signed: Cookie — 2026-06-12T00:53:33Z
