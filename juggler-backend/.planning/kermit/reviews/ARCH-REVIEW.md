# Cookie Architecture Review — H6/W3 RunScheduleCommand application seam — refactor — 2026-06-12

## Status: DONE

## Re-Review Delta
No prior `.planning/kermit/reviews/ARCH-REVIEW.md` exists (W1/W2 passes were not persisted to this path). This is the FIRST architecture review at this location; all findings are NEW. No RESOLVED/PERSISTS to diff.

## Scope
- `src/slices/scheduler/application/RunScheduleCommand.js` (the new application-layer command — 161 lines)
- `src/slices/scheduler/application/index.js` (barrel)
- `src/scheduler/runSchedule.js` (the caller / public entry `runScheduleAndPersist`, 110 KB)
- Depth: standard. Mode: refactor (behavior-preserving slice extraction).

## Scooter Consult
Asked Scooter (via scheduler-rules / prior-decision lookup) on the structural question: "Is delegating only the persist touchpoints of `runScheduleAndPersist` to an application command — while the ~1,600-line read/compute body stays inline — an acceptable hexagonal seam for the scheduler slice, or must the whole orchestration be lifted?"

Binding prior decisions that govern this leg (CLAUDE.md §Scheduler + the H4 hex-extraction memory):
- **Scheduler bugs cascade and corrupt all task data — test exhaustively before any change.** This is the governing constraint and it directly supports the implementer's choice NOT to restructure the read/compute interleaving the golden-master pins bit-for-bit.
- **Hex-extraction cache-coherence trap (H4 memory):** slice extraction can silently break cache coherence and ship dead code that green tests miss. Relevant here because W3 collapsed a dual delta-write impl — the risk is exactly the "two writers, one goes dead" trap. W3 addresses it head-on by removing the inline flush (see Finding-INFO-1).
- No veto is relitigated by this seam choice. The partial-orchestration seam is consistent with the "most-constrained → least-constrained, never reverse; never self-trigger" invariants — none of which this change touches.

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode refactor + --files | present |
| Scope detect | listed application/ + runSchedule.js | 3 files |
| Context files | read juggler CLAUDE.md §Scheduler, MEMORY hex-trap, both slice CLAUDE.md | found |
| Prior review | searched .planning for ARCH-REVIEW* | none — first review |
| Hexagonal boundary | require-graph: app→adapters forward only; no infra SDK in app | 0 BLOCK |
| Dependency direction | adapters/domain do NOT require application; domain does NOT require adapters | clean inward |
| scheduleQueue invariant (S4/S6) | grep scheduleQueue/enqueueScheduleRun in application/ | 0 live refs (3 comment refs only) |
| Seam analysis | read delegation sites + residual direct db()/trx() writes | 1 WARN (partial seam), documented |
| Single delta-write | confirmed inline flush removed; persistDelta → writeChanged sole path | 1 writer |
| Mirror-pattern check | compared to task/ + user-config/ application layout | 1 WARN (no commands/ subdir, no facade) |
| P1 (no fn.now) | grep fn.now() in runSchedule.js | 0 live (3 comment refs) |
| eslint boundaries | inspected eslint.boundaries.config.js for scheduler rule | absent — confirms W4 (expected) |
| Migration safety | no migrations in scope | n/a |
| Output written | Write ARCH-REVIEW.md + cookie-REVIEW.json | Done |

## Proof Checklist
- [x] Required inputs present (--mode refactor + --files)
- [x] Scope confirmed — 3 files in list
- [x] Mode-appropriate checks run (refactor: boundaries UNCHANGED + Scooter consult)
- [x] Infra/GCP/Cloud Run config scan completed (n/a — no infra files in scope; noted)
- [x] Service boundary scan completed (intra-service slice boundary)
- [x] Hexagonal ports/adapters scan completed (Knex/clock — application→adapters forward only)
- [x] Data-flow topology + domain isolation scan completed
- [x] Design patterns consistency scan completed (mirror vs task/user-config)
- [x] Scalability/statelessness scan completed (module-level command instance — see Finding-INFO-2)
- [x] Resilience scan completed (deadlock-retry + trx boundary stay in caller — correct)
- [x] Migration & backward-compat safety scan completed (no migrations in scope)
- [x] API-contract versioning scan completed (no shared cross-service contract touched)
- [x] Observability architecture scan completed (intra-service; logging unchanged)
- [x] Dependency direction scan completed (inward — confirmed)
- [x] Flag-and-refer lines emitted for out-of-column issues
- [x] Grep matches triaged, not just counted (every fn.now / scheduleQueue / db()-write match READ in context)
- [x] All findings carry file:line + severity
- [x] Output file written with Proof-of-Work table
- [x] Status line set: DONE

## Findings
| # | Severity | File:Line | Description | Required Fix / Refer |
|---|----------|-----------|-------------|----------------------|
| 1 | WARN | src/scheduler/runSchedule.js:886,911,1777-1782 | **Partial-orchestration seam — caller still owns direct DB writes.** `runScheduleAndPersist` delegates the delta-write/delete/backfill/clock primitives to the command but keeps three inline writes outside it: the safety-net `db('task_instances')...update({unscheduled:1})` (886, intentionally on `db` not `trx` to survive rollback), the drift-fix CASE-update `trx('task_instances')...update(driftFields)` (911), and the `user_config` schedule_cache upsert (1777-1782). These straddle the boundary the command was created to own. Acceptable for H6 (the read/compute interleaving + the rollback-survival semantic at 886 are golden-master-pinned and behavior-risky to move), but it leaves runSchedule.js as a module that writes the DB both *through* and *around* the application command. | W4/H7: lift the remaining writes behind the command (e.g. `command.persistCache()`, `command.flagUnscheduled()`, `command.persistDrift()`) so the slice has ONE persist surface. Document the 886 rollback-survival semantic in the port contract before moving it (do NOT silently fold a non-trx write into a trx-scoped primitive). |
| 2 | WARN | src/slices/scheduler/application/ (layout) | **Mirror-pattern divergence.** Sibling application layers (`slices/task/application/`, `slices/user-config/application/`) use a `commands/` (+ `queries/`) subdir AND a slice `facade.js` as the single public entry; the boundary eslint rules forbid reaching past the facade. The scheduler slice puts `RunScheduleCommand.js` directly under `application/` with no `commands/` subdir and **no `facade.js`** — `runSchedule.js` imports the command class directly (`require('../slices/scheduler/application/RunScheduleCommand')`). Functionally clean now (one command), but inconsistent with the established slice shape and not yet facade-guarded. | W4: introduce `slices/scheduler/facade.js` as the single entry and move the command under `application/commands/` to match task/user-config, OR record an ADR for why scheduler intentionally diverges (single command, no query side). Refer authoring → abby if an ADR is chosen. |
| 3 | INFO | src/slices/scheduler/application/RunScheduleCommand.js:75-82 | Module-level singleton `_runScheduleCommand = new RunScheduleCommand()` in runSchedule.js (109) is stateless except for the injected clock + repositoryFactory (both pure factories, no per-request state). Safe under Cloud Run scale-out — no instance-local mutable state crosses requests. Noted, not a finding. | none |
| 4 | INFO | — | scheduleQueue S4/S6 invariant HOLDS: zero live `scheduleQueue`/`enqueueScheduleRun` references in `application/` (the 3 grep hits are the invariant's own doc comments). The command persists; it does not trigger. The golden-master require-closure assert is the right guard. | none |
| 5 | INFO | — | Per-slice eslint boundary rule for `scheduler` is ABSENT from `eslint.boundaries.config.js` (calendar/weather/task/ai-enrichment/user-config rules present; scheduler not). This matches the stated expectation that scheduler boundary enforcement lands in **W4**. Confirmed expected. | W4: add the scheduler facade-boundary rule once the facade (Finding-2) exists. |
| 6 | INFO | src/scheduler/runSchedule.js (drift CASE-update 902-911) | The drift-fix batched CASE-WHEN UPDATE and the safety-net unscheduled flag are correctness-sensitive scheduler writes. The architecture is sound; the per-statement SQL correctness (binding count, chunk size vs max_allowed_packet) is a code-correctness concern. | REFER→ernie: verify CASE-update binding/chunk correctness |

## W3 Application-Layer Boundary Verdict

**PASS for H6/W3.** The application-layer seam is architecturally sound:

1. **Layering is correct (item 1).** `application → adapters → domain/ports`, never the reverse. Confirmed by require-graph: `RunScheduleCommand` imports only `../adapters/KnexScheduleRepository` + `../adapters/MysqlClockAdapter` (forward); adapters and domain do NOT import `application`; domain does NOT import `adapters`. No raw infra SDK (`knex`/`mysql`/`redis`) appears in `application/`. The command is a pure I/O orchestrator over the W2 ports.

2. **scheduleQueue invariant holds (item 2).** Zero live references in the command/barrel — the core/orchestrator does not self-trigger. Backed by the golden-master require-closure assert.

3. **Single delta-write writer confirmed (item 4).** The inline knex flush is gone; `persistDelta → KnexScheduleRepository.writeChanged` is the sole delta-write impl. The dual-impl (inline + dormant adapter) is collapsed to one — this is the most valuable architectural win of W3 and directly defuses the H4 "two writers, one goes dead" cache-coherence trap.

4. **Seam choice is acceptable for H6 (item 3).** NOT lifting the ~1,600-line read/compute body into the command was the correct call on the highest-risk hex phase — the golden-master pins that interleaving bit-for-bit and the rollback-survival semantic at line 886 is subtle. `runScheduleAndPersist` correctly retains the trx boundary, deadlock-retry, and sync-lock (T-TX) — those must stay with the caller because the retry re-opens the whole read+compute+write transaction.

5. **eslint per-slice rule (item 5): expected-absent for W4.** Confirmed.

## Smell to address in W4

The seam is **acceptable but not yet complete** — it is a partial-orchestration boundary, not a closed one:

- **(primary smell) runSchedule.js writes the DB both through AND around the command.** Three inline writes (Finding-1: lines 886, 911, 1777-1782) bypass the application command. Until those are behind the command, the slice has two persist surfaces and the "single persist seam" claim in the command's own docstring is aspirational, not enforced. W4 should close this — but carefully: the line-886 `db` (not `trx`) rollback-survival semantic must be made explicit in the port contract before it moves, never silently folded into a trx-scoped primitive (no-unapproved-fallback discipline applies to semantics too).
- **(secondary smell) no facade + non-mirrored layout (Finding-2).** The scheduler slice diverges from the task/user-config `commands/` + `facade.js` shape and has no boundary eslint rule (Finding-5). W4 should add `slices/scheduler/facade.js` + the per-slice rule so the boundary is *enforced*, not just *observed* — otherwise the next caller can reach straight past the application layer into adapters with nothing stopping it.

Neither smell blocks H6. Both are the natural W4 closure work.

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Algorithmic Efficiency | covered | Delta-write (writeChanged) chunked at 200; drift CASE-update chunked at 200 — preserved verbatim from legacy | unchanged by refactor |
| Modularity | covered | Command extracted as a thin per-primitive orchestrator over W2 ports | clean module |
| Separation of Concerns | partial | App-layer owns persist primitives, BUT 3 writes remain inline in caller (Finding-1) | W4 closure |
| Scalability | covered | Stateless module-level command instance; no instance-local mutable state (Finding-3) | Cloud-Run safe |
| Data Architecture | covered | All writes trx-bound (T-TX); single delta-write impl; instanceOnly:true preserves master.dur semantic | one writer |
| Resilience | covered | Deadlock-retry + sync-lock + trx boundary correctly retained in caller; command opens no own txn | correct placement |
| Extensibility | partial | repositoryFactory + clock injectable (testable), BUT no facade — next consumer can bypass app layer (Finding-2) | W4 facade |
| Infrastructure | n/a | No Terraform/Docker/deploy YAML in scope | — |
| Redundancy | covered | Dual delta-write impl collapsed to one; dead inline flush removed (defuses H4 trap) | W3's key win |

## Sign-off
Signed: Cookie — 2026-06-12T00:00:00Z
