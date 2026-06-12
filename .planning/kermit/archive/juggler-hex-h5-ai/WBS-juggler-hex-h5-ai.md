# WBS — juggler-hex-h5-ai — refactor — 2026-06-11

## Intent
Reconstruct leg for **JUG-HEX Phase H5 — AI-enrichment slice extraction** (roadmap 999.304 / JUG-HEX-06).
Work already built **uncommitted** on branch `leg/juggler-hex-h5-ai`; session tracking was lost (session.json
reset to idle, no WBS/SPEC/traceability). This leg reconstructs the tracking and gates the built work through Oscar.

**Mode:** refactor — behavior-preserving extraction of the `@google/genai` provider + daily-quota out of
`controllers/ai.controller.js` + `routes/task.routes.js` and behind an `AIPort` / `AIUsagePort` facade.
**"No behavior change" contract:** AI command handling, icon suggestion, the 50/day quota, and the
shared-global-enrichment / per-user-override split (CLAUDE.md §AI Enrichment) all behave identically pre/post.

**Business acceptance criteria (roadmap H5 exit-gate):**
- E1. `grep -rn 'GoogleGenAI' src/controllers src/routes` → **0** (SDK leak gone). ✅ verified 0 hits at intake.
- E2. Enrichment stays **globally shared**; user overrides stay **per-user, never shared** (CLAUDE.md invariant).
- E3. AI call has an explicit **timeout** (closes ARCH-REVIEW §6 #6).
- E4. Usage-tracking (50/day quota via `ai_command_log`) **unchanged**.

## Scooter consult (mandatory — refactor)
- **Answer (cited):** No recorded *decision* on de-scoping H5's `EnrichmentRepositoryPort` /
  `KnexEnrichmentRepository` / `Enrichment`+`UserOverride` entities / `RedisAIUsageQueue`. Roadmap separates
  *work-items* from *exit-gate*; the exit-gate (E1–E4) is satisfiable WITHOUT those four — DB-backed
  `KnexAIUsageRepository` satisfies E4 ("usage-tracking unchanged"); Redis was a work-item, not an exit
  criterion. The `Enrichment` entity likely belongs to the shared-global enrichment **cache** path, NOT this
  leg's two-file surface. → completeness adjudicated by Oscar against actual code, NOT assumed de-scoped.
- **Binding constraints / vetoes in play:**
  - CLAUDE.md §AI Enrichment (authoritative): shared-global enrichment + per-user overrides MUST be preserved
    — flagged as "the only subtlety" of H5. ⚠️ binding (→ E2).
  - Roadmap exit-gate: AI call MUST have a timeout (→ E3). No veto on DB-vs-Redis usage queue.
- **Applicable lesson — `hex-extraction-cache-coherence-trap` (H4):** slice extraction can silently break
  cache coherence + ship dead code green tests miss → characterization must assert shared-global coherence
  (not just happy-path generate); leg checked for unwired code.
- **Gap emitted:** yes — de-scope decision unrecorded (INBOX `2026-06-11T21:00Z`).
- Source: `docs/architecture/JUGGLER-HEX-ROADMAP.md:244`, `juggler/CLAUDE.md:72`, memory H4 lesson.

## Work Items
| ID | Task | Mode | Scope | Inputs required | Depends on | Acceptance criteria | Agents | Wave |
|----|------|------|-------|-----------------|-----------|---------------------|--------|------|
| W1 | AI-enrichment slice extraction: `AIPort`+`AIUsagePort` (domain/ports), `GeminiAIAdapter` (wraps `@google/genai`, timeout/AbortController), `MockAIAdapter`, `KnexAIUsageRepository`, `facade.js`; migrate `ai.controller.js` + `task.routes.js` (suggest-icon) off the SDK to the facade; per-slice eslint boundary rule. **Behavior-preserving.** | refactor | juggler-backend | target files (built); "no behavior change" contract; characterization tests (telly step 0 — already drafted) | — | E1 (grep=0 ✅), E3 (timeout present + asserted), E4 (50/day quota path unchanged), eslint boundary forbids deep-import of slice internals; controller/routes thin (0 direct SDK) | telly (char step0), ernie, cookie, elmo, zoe | 1 |
| W2 | **GATE ITEM** — E2 invariant verification + behavior-identity. telly **authors a NEW characterization test** asserting the **shared-global / per-user-override** split (E2): two different users' enrichment for the same input yield the **same global** enriched value (no per-user leakage); a user override stays per-user (never shared). The 1080-ln golden-master currently pins B1–B4 (command, suggest-icon, usage enqueue, client branching) but has **ZERO E2 assertion** (Snuffy finding) → this is new test work, not a re-run. Plus: ernie traces the facade is **live-wired** (not dead code); zoe audits the E2 test for false-pass/tautology. | refactor | juggler-backend | W1 slice; CLAUDE.md §AI Enrichment invariant | W1 | E2 asserted by a NEW characterization test (was absent); golden-master green before+after **including the E2 assertion**; facade proven live-wired; no unwired production code (H4 lesson). **Golden-master is NOT accepted green until E2 asserted.** | telly, ernie, zoe | 2 |

## Dependency Graph
W2 ← W1 (data + build-order: W2's characterization asserts against W1's extracted slice; the behavior-identity
proof requires the slice to exist). Single chain — irreducibly serial (extract → prove-identical); not parallelizable.

## Dependency Determination Log
| Dep | Type | Source |
|-----|------|--------|
| W2 ← W1 | build-order + data | derived — characterization/behavior-identity proof consumes the extracted slice; cannot assert identity before extraction exists |
| W1 internal (ports+adapters+facade+migration+eslint batched into ONE item) | shared-module / shared-test-surface | derived (Step 3.2 batching test) — all slice files share `goldenMaster.h5.test.js` + one ernie/cookie review module; splitting would duplicate the test pass + re-review the same module. Batched. |

## Snuffy Scope Gate (Step 3.7)
- **Verdict: UNDER_SCOPED** (risky surface — AI provider + quota-adjacent + H4 cache-coherence trap).
- **Finding:** golden-master (1080 ln) pins B1–B4 but has **zero E2 assertion** (shared-global / per-user-override
  split) — the only binding CLAUDE.md invariant. That is a gap, not a deferral.
- **Disposition: HONORED** (not overruled — an UNDER_SCOPED flag on a risky surface is near-binding). W2 sharpened
  into a **gate item**: telly authors the missing E2 characterization test; golden-master not accepted green until
  E2 is asserted; ernie traces the facade is live-wired; zoe audits the E2 test for false-pass. No justification
  required (flag honored, not overruled).

## Waves
Wave 1: W1 (slice extraction + consumer migration + eslint)
Wave 2: W2 (behavior-identity + shared-global-invariant verification)

## Notes
- All work is **already implemented uncommitted**; the Oscar pipeline gates the built diff (telly greens the
  characterization step 0, ernie/cookie verify behavior-identical + boundary, elmo probes the provider surface,
  zoe audits the char-test for false-pass / tautology — especially the E2 shared-global assertion).
- Files in scope (committed set == gated set): `juggler-backend/src/slices/ai-enrichment/**` (8 files),
  `juggler-backend/src/controllers/ai.controller.js`, `juggler-backend/src/routes/task.routes.js`,
  `juggler-backend/eslint.boundaries.config.js`, `juggler-backend/tests/characterization/aiEnrichment/**`,
  `juggler-backend/tests/unit/aiEnrichment/**`, `.gitignore` (MemPalace per-project ignore — incidental, chore).
- **`.gitignore` change** (mempalace.yaml/entities.json ignore) is unrelated to H5 — incidental. Flag to Oscar:
  either fold as a trivial chore line in this commit or split. Recommend fold (1 line, non-risky).
