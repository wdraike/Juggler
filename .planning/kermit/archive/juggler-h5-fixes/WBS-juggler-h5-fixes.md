# WBS — juggler-h5-fixes — bugfix — 2026-06-12

## Intent
Fix the H5 AI-enrichment code-review findings with production impact (backlog 999.415–999.425 + 999.417).
Behavior-changing fixes to the timeout/telemetry/quota surface + adapter robustness + the pre-existing
prompt-injection surface. (999.426 eslint DRY is a SEPARATE refactor leg, runs after this.)

**Repro + root-cause:** supplied by the /code-review (verified findings) — see each backlog item. telly
writes the failing regression tests as Oscar pipeline step 0 before any fix.

**Business acceptance:** slow-but-valid AI calls succeed; no phantom billing rows; quota cap actually holds
under concurrency; AI-disabled deploys don't flood logs; misconfig fails fast; AI input-trust boundary reviewed.

## Scooter consult (bugfix — recommended)
Carried from the just-completed H5 leg (full context, no re-ask — and the brain vector index is DEAD per
999.418, so `--ask` would run degraded/bm25-only):
- **Binding invariant (CLAUDE.md §AI Enrichment):** shared-global enrichment + per-user override must stay
  preserved. The quota/timeout fixes must not break the E2 split (e2-globalShared.h5.test.js stays green).
- **Recorded decision (KG, this session):** EnrichmentRepositoryPort/RedisAIUsageQueue de-scoped (no
  persistence tables). W3 fixes the quota in the EXISTING DB-backed `ai_command_log` path — does NOT
  reintroduce Redis (that stays de-scoped); atomicity via transaction/constraint on the current table.
- **Documented coupling (root cause):** `trackedGeminiCall` forwards one config object to BOTH the SDK call
  AND persisted telemetry — the W1 fix (separate sdkConfig/telemetryParams) is the sanctioned deeper fix.
- No veto found on raising the AI timeout budget or making it env-tunable.

## Work Items
| ID | Task | Mode | Scope | Inputs | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|--------|-----------|---------------------|--------|------|
| W1a | **Timeout mechanism (altitude + config separation).** In `gemini-tracked-call.js` separate `sdkConfig` (gets abortSignal) from `telemetryParams` (persisted) — removes the `signalClient` wrapper; move the deadline INTO `trackedGeminiCall` (or a shared `raceWithTimeout`) so every provider caller is covered; raise the AI budget to an env-tunable ≈30–60s distinct from weather's 8s. | bugfix | juggler-backend | findings #8/#9/#1(value); trackedGeminiCall + GeminiAIAdapter timeout region | — | (a) persisted model_params byte-identical (no abortSignal key); (b) slow-but-OK call within the new budget → 200 (was 500 at 8s); (c) the deadline fires for ANY trackedGeminiCall caller, not just the adapter; (d) signalClient wrapper gone; (e) E1 grep=0 + E2 split still green; (f) telly regressions green | telly, bert, ernie, cookie, zoe | 1 |
| W1b | **Timeout-abort consequences.** On a timeout-abort: suppress the orphaned `enqueue()` telemetry row (no phantom billing row); do NOT consume the 50/day quota slot for a timed-out call. | bugfix | juggler-backend | findings #3(416)/#1(quota); trackedGeminiCall abort path + ai.controller quota order + KnexAIUsageRepository | W1a | (a) 0 `ai_usage_outbox`/enqueue rows written on timeout-abort; (b) a timed-out call does NOT decrement the daily count; (c) telly regressions (no-orphan-telemetry, timeout-no-quota-burn) green | telly, bert, ernie, zoe | 2 |
| W2a | **Adapter error/lifecycle robustness.** not-configured (missing key/project) → clean `{icon:null}`/no-op, NO logger.error (999.420); null/blocked SDK result → structured 'Unexpected response', not TypeError 500 (999.422); client invalidation on key rotation OR documented restart + health signal (999.423); resolve/validate db at slice wire-up so misconfig fails fast at boot (999.421). | bugfix | juggler-backend | findings #2/#5/#6/#7; GeminiAIAdapter `_getClient`/`_getDb` + ai.controller/task.routes error paths | W1a | (a) AI-disabled deploy: suggest-icon null + 0 error logs; (b) null SDK result → structured path not 500-TypeError; (c) key rotation handled or documented+signal; (d) bad NODE_ENV fails at boot; (e) regression test per case | telly, bert, ernie, zoe | 3 |
| W2b | **Security pass — AI input-trust boundary (elmo-only, no code coupling).** elmo reviews the prompt→Gemini flow (ungated user input) + the 422 raw-echo (999.417); produces SECURITY-REVIEW.md with BLOCK/WARN/INFO. Any code fixes elmo demands feed bert in this wave. Kept separate from W2a so the security review isn't entangled with robustness refactoring. | bugfix | juggler-backend | finding 999.417 / ernie elmo-refer; ai.controller handleCommand input path, task.routes | W1a | (a) elmo SECURITY-REVIEW DONE on the input-trust boundary; (b) any BLOCK fixed; (c) prompt-injection + raw-echo dispositioned (fix or recorded-accept) | elmo, bert, zoe | 3 |
| W3 | **Quota atomicity (TOCTOU) — gated migration.** Make `checkAndLogDailyQuota` atomic (transaction or unique-window constraint + insert-or-reject) so concurrent calls cannot overshoot 50/day, single- AND multi-instance. Migration with `COLLATE utf8mb4_unicode_ci`. Stays on the existing DB `ai_command_log` path (Redis stays de-scoped). **cookie gates the migration + constraint design; elmo eyes the entitlement-math concurrency.** | bugfix | juggler-backend | finding #4 / 999.415; KnexAIUsageRepository + new migration | W1b | (a) two concurrent calls at count=49 → exactly one passes; (b) cap holds under simulated multi-instance; (c) telly concurrency test proves the race closed; (d) migration reversible; (e) cookie infra-gate on the migration; (f) E4/quota golden-master still green | telly, bert, cookie, ernie, elmo, zoe | 3 |

## Dependency Graph
W1b ← W1a (shared trackedGeminiCall region; W1b's abort-consequences sit on W1a's relocated deadline + config split).
W2a ← W1a (shared `GeminiAIAdapter.js` — serialize after the timeout/wrapper restructure).
W2b ← W1a (security review of the input path after the timeout move; review-only, no file conflict).
W3 ← W1b (shared quota path `checkAndLogDailyQuota`; W1b's don't-count-on-timeout lands before W3's atomicity rewrite).
W2a ∥ W2b ∥ W3 (Wave 3 — adapter file vs elmo-review vs repo+migration; minimal `ai.controller` overlap, sequence within Oscar if needed).

## Dependency Determination Log
| Dep | Type | Source |
|-----|------|--------|
| W1b ← W1a | shared-module + data | derived — both edit trackedGeminiCall; W1b needs W1a's relocated deadline + sdkConfig/telemetry split to know a call timed out |
| W2a ← W1a | shared-module | derived — both edit GeminiAIAdapter.js; W2a's error paths sit on W1a's restructured client/timeout |
| W2b ← W1a | review-after | derived — elmo reviews the post-W1a input path; review-only, no write conflict |
| W3 ← W1b | shared-module + data | derived — both edit the quota path; W1b's quota-on-timeout must land before W3's atomicity rewrite |
| W2a ∥ W2b ∥ W3 | independent | derived (Step 3.6) — adapter+controller vs security-review vs repo+migration; one wave, Oscar serializes the light ai.controller overlap if needed |
| **Snuffy replan** | scope | W1 split → W1a/W1b (focused test surface); elmo split out → W2b (security gate not entangled with robustness); W3 gets explicit cookie/elmo gates (HONORED — see Snuffy section) |

## Waves
- Wave 1: W1a (timeout mechanism)
- Wave 2: W1b (timeout-abort consequences)
- Wave 3: W2a (adapter robustness) ∥ W2b (elmo security pass) ∥ W3 (quota atomicity + migration)

## Snuffy Scope Gate (Step 3.7)
- **Verdict: UNDER_SCOPED** (risky surfaces — billing telemetry, quota/entitlement math, concurrency + migration, security boundary).
- **Findings:** W1 over-batched 4 distinct fixes; W2 mixed adapter-robustness with a security-only review; W3 migration/concurrency needs explicit pre-merge gates.
- **Disposition: HONORED** (near-binding on a risky surface, not overruled). Replanned 3 items/2 waves → **5 items/3 waves**: W1 split into W1a (mechanism) + W1b (abort consequences); elmo split into its own W2b security item; W3 gets explicit cookie (migration) + elmo (concurrency) gates. Full 6-agent pipeline retained.

## Notes
- Risky surface (billing telemetry, quota/entitlement math, concurrency + migration, security boundary) →
  full bugfix pipeline, elmo required (W1 telemetry + W2 input-trust), NOT trivial.
- telly step 0 writes RED repros: slow-call-succeeds, timeout-no-quota-burn, no-orphan-telemetry,
  concurrent-quota-race, not-configured-no-log, null-result-structured-error.
- Files in scope: `gemini-tracked-call.js`, `slices/ai-enrichment/adapters/GeminiAIAdapter.js`,
  `slices/ai-enrichment/adapters/KnexAIUsageRepository.js`, `controllers/ai.controller.js`,
  `routes/task.routes.js`, a new `db/migrations/*` (W3), + tests.
- Must keep H5 exit-gate green (E1 grep=0, E2 split, E3 timeout-present, E4 usage path) — these fixes
  refine E3/E4, must not regress E1/E2.
