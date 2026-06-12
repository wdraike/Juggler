# PLAN (for review — not yet opened) — juggler H5 AI-enrichment fixes — 2026-06-12

Fixes all 10 /code-review findings on the H5 slice (backlog 999.415–999.426). **Two legs** (one mode each).
Nothing opened/handed to Oscar yet — awaiting your approval.

## Mode classification
- **9 findings = bugfix** (behavior is wrong/suboptimal: timeout fails good calls, phantom billing rows,
  quota overshoot, error-log flood, masked errors, stale client, late db failure). The altitude moves
  (timeout → trackedGeminiCall, config/telemetry separation) ride along as the *implementation* of the
  bugfix — a behavior-changing refactor is a bugfix (Kermit reclassification rule).
- **1 finding = refactor** (999.426 eslint DRY — behavior-preserving, cross-slice). Separate leg.

---

## LEG 1 — bugfix — AI-enrichment robustness & telemetry-correctness
Scope: juggler-backend. Files: `GeminiAIAdapter.js`, `services/gemini-tracked-call.js`,
`KnexAIUsageRepository.js`, `ai.controller.js`, `task.routes.js` (+ a migration for W3).

### Work Items
| ID | Task | Findings | Depends on | Acceptance criteria | Wave |
|----|------|----------|-----------|---------------------|------|
| W1 | **Timeout + telemetry root-cause fix.** Separate `sdkConfig` vs `telemetryParams` in `trackedGeminiCall` (removes the `signalClient` wrapper); push the deadline into `trackedGeminiCall` (or a shared `raceWithTimeout` helper) so all provider calls get it; raise the AI budget to a tunable value (≈30–60s, env-overridable) distinct from the geocode 8s; on timeout-abort **suppress** the orphaned `enqueue()` row; **don't consume the daily-quota slot** for a timed-out call. | 999.419, 999.424, 999.425, 999.416 | — | (a) telemetry model_params byte-identical (no abortSignal); (b) no `enqueue()` row written on timeout-abort; (c) a slow-but-successful call within the new budget returns 200; (d) a timed-out call does NOT decrement the 50/day count; (e) timeout reachable by any trackedGeminiCall caller; (f) char-suite + new regression tests green | 1 |
| W2 | **Adapter error/lifecycle robustness.** Not-configured (missing key/project) → clean `{icon:null}`/no-op, NO `logger.error` (999.420); guard null/blocked SDK result → structured 'Unexpected response' not a TypeError 500 (999.422); support client invalidation on key rotation, or document restart-required + reconcile env-read timing (999.423); resolve/validate the db handle at slice wire-up so misconfig fails fast at boot, not first request (999.421). | 999.420, 999.422, 999.423, 999.421 | W1 | (a) AI-disabled deploy: suggest-icon returns null with 0 error logs; (b) null SDK result → structured error path, not 500-TypeError; (c) key rotation picked up without process restart OR documented + health signal; (d) bad NODE_ENV fails at boot; (e) regression tests per case | 2 |
| W3 | **Quota atomicity (TOCTOU).** Make `checkAndLogDailyQuota` atomic — transactional check-then-insert, or a unique-window constraint + insert-or-reject, so concurrent calls cannot overshoot the 50/day cap (single-instance AND multi-instance). Migration for any constraint (`COLLATE utf8mb4_unicode_ci`). | 999.415 | W1 | (a) two concurrent calls at count=49 → exactly one passes; (b) cap holds across simulated multi-instance; (c) telly concurrency test proves the race is closed; (d) migration reversible | 2 |

### Dependency graph
W2 ← W1 (shared `GeminiAIAdapter.js` — serialize). W3 ← W1 (shared quota path `KnexAIUsageRepository`/controller — serialize). W2 ∥ W3 (different files: adapter vs repo → same wave, run concurrent).

### Waves
- Wave 1: W1 (deep root-cause fix — changes timeout location + quota-on-timeout)
- Wave 2: W2 + W3 (concurrent — independent files, both built on W1)

### Risk / notes
- **Risky surface** → full bugfix pipeline, NOT trivial. W1 touches billing telemetry + quota math; W3 is concurrency + a migration. elmo should run (999.417 prompt-injection is an adjacent pre-existing surface — fold an elmo pass here or keep as its own leg; recommend fold so the AI input-trust boundary gets one security look).
- telly step 0 writes the failing regression tests (slow-call, timeout-no-quota-burn, no-orphan-telemetry, concurrent-quota, not-configured-no-log) before any fix.
- 999.417 (prompt-injection, Medium) — recommend folding into W2 as an elmo-owned item, OR a separate security leg. Your call.

---

## LEG 2 — refactor — eslint per-slice boundary DRY
Scope: juggler-backend. File: `eslint.boundaries.config.js` only.

| ID | Task | Findings | Acceptance criteria |
|----|------|----------|---------------------|
| W1 | Extract `sliceBoundaryRules(name, opts)` helper emitting the rule + exemption objects; collapse the 5 copy-paste per-slice blocks (calendar/weather/task/user-config/ai-enrichment); fix the AI block divergence. Behavior-preserving: `npx eslint --config eslint.boundaries.config.js src/` output identical before/after (same violations, EXIT 0). | 999.426 | (a) lint output byte-identical pre/post; (b) all 5 slices covered by the helper; (c) boundary still BLOCKs external deep-imports (probe test) | 

- Independent of Leg 1 (different file). Low priority — **H7-cleanup candidate**; could defer to the H7 leg rather than run now.
- refactor mode → characterization = the lint-output diff (identical before/after).

---

## Execution order (recommended)
1. **Leg 1** first (the real bugs — billing/quota/user-facing failures). Highest-value: 999.419 + 999.416 + 999.415 are the ones with production impact.
2. **Leg 2** (or fold into the future H7 cleanup leg) — cosmetic/maintainability, no rush.

## Open questions for you
1. Fold **999.417 (prompt-injection elmo pass)** into Leg 1 W2, or keep as a separate security leg?
2. Run **Leg 2 (eslint DRY) now**, or defer it to the H7 cleanup phase?
3. Execute Leg 1 now after approval, or just lock in the plan?

_No leg opened. No lock acquired. Awaiting approval._
