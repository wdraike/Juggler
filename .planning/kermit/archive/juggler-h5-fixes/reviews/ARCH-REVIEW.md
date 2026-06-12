# Cookie Architecture Review — ai-enrichment slice→boot integration (W2a B9) — bugfix — 2026-06-12

## Status: DONE

Advisory architecture review (fix is human-approved). The hexagonal boundary is **clean** and the
boot wiring is **safe to ship as-is** for the not-yet-serving juggler deployment. No BLOCK. The
finding of substance is a **future-DRY / pattern-precedent concern** (WARN) plus a **redundancy /
dead-validation** observation (WARN): `facade.init()`'s stated fail-fast purpose is already satisfied
at the infra layer before line 61 runs, so the hook adds a per-slice boot pattern that does not buy
the fail-fast it claims.

## Scope crossing rationale (bugfix mode)
Per Step 2's bugfix modifier, a bugfix is normally skipped unless it crosses a boundary. This leg
**does** cross a boundary — it introduces a new slice→server-boot integration seam — so the full
Branch A scan was run on the two files in scope.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode bugfix + --files (2 files) | present |
| Scope detect | explicit --files list | 2 files |
| Context files | read juggler/CLAUDE.md, juggler-backend/docs/architecture/ (no numbered ADRs), KNOWLEDGE-MAP | found |
| Boundary crossing | new slice→boot seam confirmed → full scan | crosses |
| Infra review | n/a — no TF/Docker/deploy YAML in scope | 0 findings |
| Service boundaries | facade is single public entry; no cross-service import | 0 findings |
| Hexagonal boundary | facade imports `lib/db` (port), adapters are sole SDK ring; init() exposes no adapter/port | 0 BLOCK |
| Data-flow topology | init() touches only the db seam via getDefaultDb(); no cross-domain read | 0 findings |
| Design patterns | init() is a one-off — no other slice (weather/task/user-config/calendar) has a server.js boot hook | 1 WARN |
| Scalability | init() is boot-once, idempotent (getDefaultDb cached); no instance-local mutable state added | 0 findings |
| Resilience | init() throw aborts boot (fail-fast); see failure-semantics analysis | 0 BLOCK, 1 INFO |
| Migration safety | no migration in scope | n/a |
| API-contract versioning | no shared inter-service contract touched | n/a |
| Observability arch | no cross-service hop added | n/a |
| Dependency direction | facade→lib/db (inward to infra port), not infra→domain | 0 findings |
| Scooter consult | asked re slice→boot convention + prior decision | done — no convention, no prior decision |
| Deep research | --depth not set to deep | skipped |
| Flag-and-refer | none out-of-column | 0 |
| Output written | Write ARCH-REVIEW.md + cookie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present (--mode bugfix + --files, 2 files)
- [x] Scope confirmed — 2 files in list
- [x] Mode-appropriate checks run (mode: bugfix; boundary-crossing detected → full scan, not skipped)
- [x] Infra/GCP/Cloud Run config scan completed (no infra files in scope — n/a, reasoned)
- [x] Service boundary scan completed
- [x] Hexagonal ports/adapters scan completed (Node/GCP infra SDKs — facade imports lib/db port, not raw SDK)
- [x] Data-flow topology + domain isolation scan completed
- [x] Design patterns consistency scan completed (per-slice boot-init consistency)
- [x] Scalability/statelessness scan completed (boot-once, cached, no instance-local state)
- [x] Resilience scan completed (boot fail-fast semantics analyzed)
- [x] Migration & backward-compat safety scan completed (no migration — n/a)
- [x] API-contract versioning scan completed (no shared contract — n/a)
- [x] Observability architecture scan completed (no cross-service hop — n/a)
- [x] Dependency direction scan completed (facade→lib/db inward)
- [x] Flag-and-refer lines emitted for all out-of-column issues (none)
- [x] Grep matches triaged, not just counted (each grep READ + reasoned: init call-sites, slice facades, getDefaultDb cache, eslint blocks)
- [x] All findings carry file:line + severity (BLOCK/WARN/INFO)
- [x] Prior knowledge consulted via Scooter (single front door) — no relitigation
- [x] Rubric Coverage Map emitted — every dimension marked
- [x] Output file ARCH-REVIEW.md written with Proof-of-Work table
- [x] Status line set DONE

## Scooter Consult
**Q:** Is there an established convention for how juggler hex slices (weather/task/user-config/calendar
H0–H4) integrate with server.js boot — a per-slice `facade.init()` DB-validation hook, or is boot-time
DB validation done once at the infra layer? Any prior decision on slice→boot seams?

**A (cited):** No established per-slice boot-hook convention and no prior recorded decision sanctioning
one. The verified, consistent seam across all four predecessor slices is **lazy integration through
controllers** (`require('../slices/<x>/facade')` at controller-load, methods called per-request);
none exports a `server.js`-invoked `init()`. `server.js:61` is the **only** slice `.init()` call in
boot. Calendar's `initialize(deps)` is explicitly side-effect-free and is **not** called from boot.
Boot-time DB readiness is **already done once at the infra layer**: `src/db.js:18` →
`lib/db.getDefaultDb()` resolves+validates the pool at module-load (cached via `defaultDbCached`, throws
`No database configuration found for environment: ${env}`), and that runs at `server.js:28` +
`app.js:220` **before** `start()`, with `server.js:50` (`db('sync_locks')`) actually querying the pool
**before** line 61. ADR-0002 ("lib/db, NOT src/db.js") is a code-comment convention — no numbered ADR
doc exists. KG is thin → absence of a recorded contradiction is not proof none was made.

**Binding constraint surfaced:** ADR-0002 — slice repositories obtain knex via `lib/db.getDefaultDb()`,
never `src/db.js`. The ai-enrichment facade **complies** (line 59 imports `../../lib/db`). No veto
relitigated → no BLOCK from the consult.

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | WARN | juggler-backend/src/slices/ai-enrichment/facade.js:58-62 | **Redundant / dead boot-validation.** init()'s sole stated purpose is fail-fast DB-config validation, but `getDefaultDb()` is already invoked and cached **before** init runs: `server.js:28` (`require('./db')` → `db.js:18` → `getDefaultDb()`), `app.js:220`, and `server.js:50` (`db('sync_locks')` queries the pool) all precede line 61. Because `getDefaultDb()` caches via `defaultDbCached`, the call at line 60 returns the already-built instance and **cannot throw** on misconfig — the misconfig would have aborted boot ~30 lines earlier at the top-level `require('./db')`. The hook does not deliver the fail-fast it documents. | Advisory: either drop init() (infra layer already fails fast) OR, if a *slice-specific* readiness check is genuinely wanted (e.g. a live `SELECT 1`/ping, or AI-specific config like GEMINI_API_KEY presence), make init() do something the infra-layer load does not already do. As-is it is a no-op for its stated goal. |
| 2 | WARN | juggler-backend/src/server.js:61 | **One-off pattern / future-DRY precedent.** This is the only slice→boot `init()` call; weather/task/user-config/calendar (H0–H4) all integrate lazily via controllers with zero boot hooks (Scooter-confirmed). Per-slice boot-init at this altitude is the wrong layer for *generic* db-readiness — if every slice copies it, server.js's start() accretes one `await require('./slices/<x>/facade').init()` per slice, the same copy-paste-per-slice smell already present in `eslint.boundaries.config.js` (43 `slices/` refs across hand-maintained per-slice blocks). Generic db-readiness belongs validated **once** at the infra layer (already is). | Advisory: do not generalize this into a per-slice boot convention. If slices ever need boot-time readiness, introduce a single registry/iterator (`for (const s of SLICES) await s.init?.()`) rather than N hand-added awaits. Track as a 999.x H7 DRY item if the slice count grows. Flagged as future-DRY, not blocking. |
| 3 | INFO | juggler-backend/src/server.js:61 vs 89-127 | **Failure-semantics asymmetry (intentional, sound).** init() is the only boot step **not** wrapped in try/catch — so it aborts boot (→ `start().catch` → `process.exit(1)`), unlike the ai-usage-flusher / cron starters which degrade gracefully. For Cloud Run + not-yet-serving, fail-fast (container fails, no traffic) is the correct choice and does **not** mask the error: the real error propagates to `serverLogger.error('Fatal startup error')` before exit, and the failure occurs before `app.listen()`, so no readiness/health probe ever sees a half-up instance reporting healthy. Confirmed safe. (Caveat tied to finding #1: since the infra-layer load already fails fast, init() being un-wrapped is moot — the abort already happens upstream.) | No action — documented as sound. |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Algorithmic Efficiency | covered | init() is O(1) boot-once; getDefaultDb cached | no hot-path impact |
| Modularity | covered | facade is single public entry; init() added to it, not leaked into server internals | clean |
| Separation of Concerns | partial | init() puts slice-specific boot logic in the slice (good) BUT validates a *generic* infra concern (db config) that the infra layer already owns — finding #1/#2 | redundant altitude |
| Scalability | covered | boot-once, idempotent, no instance-local mutable state added; Cloud Run scale-out safe | — |
| Data Architecture | covered | touches only lib/db port via getDefaultDb; ADR-0002 compliant (lib/db not src/db.js) | — |
| Resilience | covered | fail-fast on boot is correct for not-yet-serving; error surfaced before exit; no health-probe masking | finding #3 |
| Extensibility | partial | per-slice boot-init does not scale to N slices without a registry — finding #2 | future-DRY |
| Infrastructure | covered | no TF/Docker/deploy YAML in scope; no Cloud Run config changed | n/a-reasoned |
| Redundancy | gap | init()'s validation duplicates the infra-layer getDefaultDb load that already runs + throws first — finding #1 | dead validation |

## Sign-off
Signed: Cookie — 2026-06-12T00:00:00Z
