# Ernie Review — H6 Wave 4 (scheduler facade + caller migration) — refactor — 2026-06-12

## Status: DONE

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | mode=refactor, 4 files from positional list | present |
| Scope detect | facade.js, index.js, mcp/tools/schedule.js, routes/schedule.routes.js | 4 files |
| Mode gate (refactor) | golden-master characterization suite pins schedule OUTPUT bit-for-bit (cited facade.js:22-24); cookie owns Scooter block (non-trivial refactor) — present in ARCH-REVIEW.md | met |
| Re-export identity (source) | `grep module.exports` runSchedule.js / unifiedScheduleV2.js | runSchedule → `{runScheduleAndPersist, getSchedulePlacements, computeWindowCloseUtc}`; unifiedScheduleV2 → fn directly. facade re-reads each by-reference (facade.js:51-52,67-71) |
| Re-export identity (runtime) | `node -e` strict `===` compare facade vs legacy modules | ALL true: runScheduleAndPersist / getSchedulePlacements / computeWindowCloseUtc / unifiedScheduleV2 are the SAME function objects |
| Caller migration | `git diff` working tree (uncommitted) | 3 sites, import-path-only swap to facade; call signatures unchanged at :25/:44 (mcp), :39/:54/:139 (routes) |
| Definedness | `typeof` all 5 caller symbols off facade | all `function`; zero undefined facade exports (27 keys) |
| Barrel correctness | `node -e` Object.assign verify | `idx.scheduler === facade`; every named export same ref; seed key `scheduler` does NOT collide (facade has no `scheduler` key) → no shadow/loss |
| Circular require | `grep` back-edges from runSchedule/unifiedScheduleV2/application/domain/adapters→facade/index | NONE — no cycle; facade loads cleanly |
| Error handling scan | grep .then/catch{}/await | callers retain prior try/catch + 500 mapping; no new error paths |
| Input validation scan | route handlers | unchanged; auth+rate-limit middleware retained; no new entry points |
| Unapproved-fallback scan | grep `||`/`??` | only pre-existing `timezone || 'America/New_York'` and `req.user ? … : 'anon'` — unchanged by this leg, not introduced |
| Concurrency scan | withLock / withSyncLock retained | per-user lock seams unchanged; facade adds no shared mutable state |
| Type/React/observability/dead-code scans | n/a (backend, no JSX); facade is a flat re-export | clean |
| Output written | Write CODE-REVIEW.md + ernie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present — mode=refactor, 4-file scope non-empty
- [x] Scope confirmed — 4 files printed in Proof-of-Work
- [x] Mode gate checked — refactor: golden-master characterization pins output (facade.js:22-24); cookie owns Scooter block (ARCH-REVIEW.md)
- [x] Complexity scan — facade.js 103 lines (thin re-export), index.js 21 lines; no nesting; under 300
- [x] Error handling scan — no `.then` without catch; caller try/catch + 500 mapping unchanged; facade is synchronous re-export (no async, no swallow)
- [x] Floating-promise / forEach(async) / Promise.all scan — no async in facade/index; caller awaits preserved (mcp :44 returns the promise into withLock; routes :39/:54 awaited)
- [x] Error-cause-preservation scan — no catch in facade/index; caller catches re-log + 500, unchanged
- [x] Input validation scan — no new entry points; route auth/rate-limit middleware retained
- [x] Unapproved-fallback scan — only pre-existing `timezone`/`anon` fallbacks; this leg introduces none
- [x] Numeric precision/boundary scan — facade/index numeric-free; `parseInt(…,10)` in unchanged /debug+/step code carries radix
- [x] ReDoS scan — no regex in facade/index/migrated lines
- [x] Date/TZ & DB-clock scan — no date math in facade/index; migrated lines unchanged
- [x] Resource management scan — no sync I/O, handles, or timers in facade/index
- [x] DB-transaction/atomicity scan — facade adds no writes; delta-write seam (RunScheduleCommand) unchanged behind the re-export
- [x] Concurrency safety scan — facade is stateless re-export; withLock/withSyncLock seams retained; no module-level mutable state introduced
- [x] Idempotency-under-retry scan — n/a; no new queue/webhook consumer; /nudge enqueue path unchanged
- [x] Grep matches triaged — `||`/`??`, fallback, and require-graph matches READ and reasoned, not counted
- [x] Type safety scan — no casts/@ts-ignore; runtime `typeof` confirms all 5 symbols are functions, zero undefined
- [x] React logic scan — skipped (backend, no .jsx/.tsx)
- [x] Observability scan — no bare console.log; routes use structured `@raike/lib-logger`
- [x] Dead code scan — facade carries explanatory header only; no commented-out code; no TODO/FIXME
- [x] Flag-and-refer — none required (no security/coverage/visual sightings in scope)
- [x] All findings carry file:line + BLOCK/WARN/INFO (no BLOCK/WARN filed; 2 INFO)
- [x] No "missing test" findings filed
- [x] No security reviewed in depth
- [x] Prior knowledge consulted — cookie owns the refactor Scooter consult (DESIGN §6.1 facade-only) in ARCH-REVIEW.md; not duplicated (non-trivial refactor rule)
- [x] Knowledge changes reported to Scooter — none; this leg changes no requirement/standard/approach
- [x] Rubric Coverage Map emitted — all 9 dimensions below
- [x] Output written — CODE-REVIEW.md + ernie-REVIEW.json
- [x] Status set — DONE (no BLOCK)

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| — | — | — | No BLOCK or WARN findings. The leg is a behavior-preserving import-path migration; re-export identity, caller signatures, barrel correctness, and require-graph acyclicity all verified at runtime. | — |
| 1 | INFO | facade.js:71 | `computeWindowCloseUtc` is re-exported "for parity" but no caller in this leg imports it (callers take only runScheduleAndPersist/getSchedulePlacements/unifiedScheduleV2). Harmless — parity with the legacy module's export surface; a public seam, not dead code. No action. | none |
| 2 | INFO | routes/schedule.routes.js:79 | `/debug` uses lazy `require('../slices/scheduler/facade').unifiedScheduleV2` inside the handler (vs the top-level destructure used by the other two routes). Functionally identical (module cached on first require; same fn object — verified `===`). Pre-existing lazy-require pattern; stylistic inconsistency only. No action. | none |

### Verdict (per dispatch request)
- **Re-export identity:** CONFIRMED. `facade.runScheduleAndPersist === runSchedule.runScheduleAndPersist`, `getSchedulePlacements` same, `unifiedScheduleV2 === require('unifiedScheduleV2')`, `computeWindowCloseUtc` same — all strict-equal at runtime. The facade reads properties off the required legacy objects (facade.js:51-52, 67-71); it adds NO wrapper that alters args/`this`/return. Same function objects, not re-implementations.
- **Caller-migration correctness:** CONFIRMED. All 3 sites resolve the imported names to defined functions with unchanged call signatures — routes :10 `{runScheduleAndPersist, getSchedulePlacements}` and :79 `.unifiedScheduleV2`, mcp :7 `{runScheduleAndPersist, getSchedulePlacements}`. No missing export, no renamed symbol, no undefined (typeof === function for all). The `/nudge` `enqueueScheduleRun` import correctly stays on `scheduler/scheduleQueue` (trigger seam, deliberately NOT routed through the facade — S4/S6 invariant honored, facade.js:36-40).
- **No-cycle:** CONFIRMED. facade → runSchedule.js / unifiedScheduleV2.js / application / domain / adapters / ports; none of those require facade or index back (grep: zero back-edges). The facade module loads to a complete, non-partial export object (27 keys, zero undefined).
- **Barrel correctness:** CONFIRMED. `index.js` `Object.assign({ scheduler: facade }, facade)` exposes both the namespaced `scheduler` handle (`idx.scheduler === facade`) and every flat named export by-reference; the seed key `scheduler` does not collide (facade exports no `scheduler` key), so nothing is shadowed or lost.

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Correctness | covered | Runtime `===` proves re-exports are the same function objects; output pinned by golden-master | Behavior-preserving; zero logic delta |
| Readability | covered | facade.js header documents intent (thin re-export, S4/S6 invariant); index.js trivial | Clear |
| Maintainability | covered | Mirrors task/weather/calendar facade idiom; single sanctioned import surface | Consistent with established slice pattern |
| Error Handling | covered | No new error paths; caller try/catch + 500 mapping retained; facade synchronous | n/a for re-export |
| Coupling | covered | Callers now depend on facade (canonical seam) not `scheduler/*` internals; no back-edge | Tightens boundary; cookie owns deeper boundary review |
| Type Safety | covered | `typeof` confirms all 5 caller symbols are functions; zero undefined exports | No casts; plain CJS |
| API Design | covered | Re-export preserves exact signatures; computeWindowCloseUtc parity kept | INFO-1: unused-by-this-leg export, harmless |
| Resource Management | covered | No I/O/handles/timers introduced; module cached on require | n/a |
| Concurrency Safety | covered | Stateless re-export; withLock/withSyncLock seams unchanged; no module-level mutable state | S5 delta-write seam unchanged behind facade |

## Sign-off
Signed: Ernie — 2026-06-12T00:00:00Z
