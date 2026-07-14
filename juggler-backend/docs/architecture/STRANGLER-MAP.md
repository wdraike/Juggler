# Strangler Map — juggler-backend (999.1200)

Two architectural generations coexist. This doc is the codified map: what is
migrated, what is legacy, the migration order, and which gates hold the line.
Every require cycle + inversion found in the 2026-07-06 deep review crossed the
generation boundary — the half-done state is where the bugs live. Update this
doc when a leg lands; the eslint/cycle ratchet configs are the enforcement SSOT,
this doc is the narrative index over them.

Status below verified against the tree on **2026-07-14**.

## MIGRATED — hexagonal slices (ports + adapters, InMemory test doubles)

| Slice | Entry point | Notes |
|-------|-------------|-------|
| task | `src/slices/task/facade.js` | W6; thin controller; atomic composed ops (999.1570) |
| user-config | `src/slices/user-config/facade.js` | facadeDbClean (999.1516) |
| calendar | `src/slices/calendar/facade.js` | owns sync Phase-1 fetch since 999.1025 sub-leg 2 |
| weather | `src/slices/weather/` | |
| ai-enrichment | `src/slices/ai-enrichment/` | |
| scheduler (facade) | `src/slices/scheduler/facade.js` | ports consumed by the legacy scheduler core |

Proper shims (allowed): `lib/cal-adapters`, `lib/task-status`.

## LEGACY — direct-db / fat modules (the shrinking set)

| Module | Size (2026-07-14) | State |
|--------|------------------|-------|
| `scheduler/runSchedule.js` | 2748 L | DB access fully port-delegated (999.1532); module itself still monolithic, grandfathered entry file |
| `scheduler/unifiedScheduleV2.js` | 2771 L | same |
| `scheduler/scheduleQueue.js` | 633 L | same |
| `scheduler/schedulerSession.js` | 280 L | same |
| `controllers/cal-sync.controller.js` | 2106 L | 999.1025 in flight (harness sub-leg 1 + Phase-1 fetch extraction sub-leg 2 landed) |
| `mcp/tools/{config,data,tasks}.js` + `mcp/transport.js`, `mcp/getUserTimezone.js` | ~1160 L | task WRITES go via task facade; direct-db reads remain (grandfathered) |
| middleware: `jwt-auth`, `calendar-limit`, `feature-gate` (+ `entity-limits`, `plan-features` in cycles) | — | provisioning extracted behind UserRepositoryPort (999.1197); rest open |
| routes: `health.routes`, `health.diagnostics`, `my-plan.routes` | — | direct-db |
| lib: `task-write-queue`, `sync-lock`, `push-subscriptions`, `usage-reporter`, `{gcal,apple,msft}-cal-api` | — | `lib/tasks-write` is task-slice-internal (999.1199, boundary-ruled) |

## Migration order (by payoff/risk — from the 2026-07-06 deep review)

1. **Repoint controller-shim importers + break cycles** (JUG-REQUIRE-CYCLES-X11)
   — 60→7 done (999.1192/1198). **REGRESSED 7→9** since: `task-write-queue ↔
   task/facade` (introduced 6caa50ef, 999.1199/1196) and `calendar/facade ↔
   scheduler adapters` (introduced 3c76eb79, 999.1025 sub-leg 2). Fix + gate
   wiring = **999.1628**.
2. **MCP tools → facades** (JUG-MCP-TOOLS-BYPASS-FACADE) — partial: task writes
   on the facade (incl. atomic updateTaskAndStatus, 999.1570); config/data/
   transport/getUserTimezone still direct-db.
3. **Logic-bearing routes → use-cases** (JUG-ROUTES-EMBED-LOGIC) — open.
4. **H7 scheduler-core ports** (JUG-HEX-H7-RUNSCHEDULE-PORTS) — DB access done
   (999.1532); decomposition of the entry files themselves remains open.
5. **cal-sync extraction** — 999.1025, in flight (characterization harness
   first; sub-legs 1–2 landed).
6. **Middleware → use-cases** — JUG-JWTAUTH-PROVISIONING partially done
   (999.1197 ProvisionUserOnFirstLogin); JUG-ENTITYLIMIT-DUAL-PATHS open.

## Enforcement (deterministic gates)

- `eslint.boundaries.config.js` (`npm run lint:boundaries`): per-slice
  facade-only access, `DB_GRANDFATHERED_FILES` direct-db ratchet (shrink-only),
  domain-purity rules (999.1533), legacy-scheduler ClockPort wall-clock rule
  (999.1195), `lib/tasks-write` slice-internal boundary (999.1199).
- `scripts/check-require-cycles.js` (`npm run lint:cycles`): `MAX_CYCLES=7`
  ratchet — lower it when you remove cycles, **never raise it**.
- ⚠ Gating gap (2026-07-14): only the `package.json` `precommit` npm script
  chains these, and nothing invokes it — vinatieri pre-commit runs staged
  eslint + related tests only, CI runs `lint`. Wiring `lint:cycles` (and
  `lint:boundaries` if absent) into vinatieri/CI is part of **999.1628**;
  blocked until the two new cycles are broken (the gate would fail every
  commit today).

## Rules of engagement

- New functionality goes IN A SLICE (or extends one); never add code to the
  legacy set.
- Touching a legacy module: keep every ratchet list shrinking — no new
  `DB_GRANDFATHERED_FILES` entries, no new cycles, no new bare wall-clock reads.
- The numbered legs above are their own tickets; this doc + the ratchets are
  999.1200's deliverable.
