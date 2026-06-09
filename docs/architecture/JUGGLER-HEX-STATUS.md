---
type: architecture
service: juggler
status: active
last_updated: 2026-06-09
tags:
  - type/architecture
  - service/juggler
  - status/active
  - hexagonal
  - migration-status
  - inventory
---

> ⛔ **SUPERSEDED (2026-06-09).** This interim inventory has been folded into the consolidated set: **[JUGGLER-ARCH-REVIEW-2026-06.md](./JUGGLER-ARCH-REVIEW-2026-06.md)** (current state), **[JUGGLER-HEX-DESIGN.md](./JUGGLER-HEX-DESIGN.md)** (target), **[JUGGLER-HEX-ROADMAP.md](./JUGGLER-HEX-ROADMAP.md)** (plan). Use those.

# Juggler Hexagonal Migration — Status Inventory

**Date:** 2026-06-09
**Method:** Codebase verification (not WBS checkbox trust). Every claim below is grep/ls-evidenced against `juggler-backend/src/`.
**Plan of record:** [`JUGGLER-HEX-WBS.md`](./JUGGLER-HEX-WBS.md) (created 2026-01-15, status "Planning") + [`JUGGLER-HEX-REVIEW.md`](./JUGGLER-HEX-REVIEW.md) (2026-01-14).

> **Headline:** A conversion plan exists. Execution is **~5% done** — partial infra scaffolding, **zero domain slices implemented**. The WBS checkboxes are all unchecked AND stale: some infra libs were created (May–Jun) without updating the WBS, while most created scaffolding is **unadopted dead code**. Scheduler, Task, Calendar, Weather domains are untouched in hexagonal terms.

---

## Governance gap (read first)

- The WBS is a **standalone doc**, not tracked in the monorepo backlog. The `ARCH-HEX-*` items in `.planning/ROADMAP.md ## Backlog` (999.109–999.13x) are **all tagged `resume-optimizer`** — none are juggler. → Juggler hex work has **no active phase/leg** and no traceability into Kermit's WBS.
- WBS checkbox state is **untrustworthy** (all `[ ]`, but real work landed). This doc is the authoritative status until the WBS is reconciled or retired.

---

## Inventory by WBS phase

Legend: ✅ done+adopted · 🟡 created/partial · 🟥 not started · ☠️ created but unadopted (dead scaffolding)

| Phase | Item | State | Evidence |
|-------|------|-------|----------|
| **0** | Docs review + infra check | ✅ | Review docs exist; test-bed (3407) / dev-bed present |
| **1.1** | lib-db extraction | 🟡 stalled | `src/lib/db/index.js` exists, but **`src/db.js` singleton still present** and imported by **38 files**; lib-db has **1** real consumer (`cron/cal-history-cron.js`). Singleton's own header: *"@raike/lib-db is not yet installed… until hexagonal migration complete"* |
| **1.2** | lib-logger extraction | 🟡 | `src/lib/logger/index.js` (13KB) created, **7 non-self importers** — adoption in progress, migration incomplete |
| **1.3** | lib-config extraction | 🟥 | No `src/lib/config` |
| **1.4** | lib-cache extraction | 🟥 | No `src/lib/cache`; `lib/redis.js` is standalone, **no CachePort** |
| **1.5** | lib-events creation | ☠️ | `src/lib/events/index.js` (18KB) created, **0 non-self importers** — built, never wired in |
| **2.x** | Calendar Port + adapters + facade | 🟥 (skeleton) | `src/slices/calendar/` contains **only `README.md`** — `domain/entities`, `domain/ports`, `adapters` dirs are **empty**. **No `CalendarPort.js`, no `facade.js`, no `InMemoryCalendarAdapter`.** Real adapters live in `src/lib/cal-adapters/{apple,gcal,msft}.adapter.js` and are imported **directly** by controllers (pre-hex form, no shared port, no DI) |
| **3.x** | Task domain slice | 🟥 | No `src/slices/task`. `task.controller.js` still ~2,422 lines with **66 `getDb(`** + 12 `trx(` calls |
| **4.x** | Scheduler domain (pure ConstraintSolver/ScoreEngine + ports) | 🟥 | No `ConstraintSolver`/`ScoreEngine` files. `src/scheduler/` still procedural with **33 `db()`/`getDb(`** calls. No `TaskProviderPort`/`CalendarProviderPort` |
| **5.x** | Weather domain slice | 🟥 | No `src/slices/weather`; logic still in `weather.controller.js` |
| **6.x** | User / AI / MCP slices | 🟥 | No slices; MCP still via `juggler-mcp/` + controllers |
| **7.1–7.3** | Deprecation, docs | 🟥 | — |
| **7.2** | ESLint boundary rules | 🟡 (orphan) | `eslint.boundaries.config.js` **exists** — but there are no implemented slices/facades for it to guard |
| **8.x** | Test infra (testcontainers, factories) | 🟥 (hex-specific) | Not verified as hex-slice test infra; general `tests/` exists |

---

## What is genuinely done

1. **Analysis/planning** — REVIEW + WBS are thorough and accurate to the codebase as of Jan 2026.
2. **lib-logger** — created and partially adopted (7 importers).
3. **Adapter *extraction* (pre-port)** — calendar API logic is isolated into `lib/cal-adapters/` (apple/gcal/msft). This is the "adapters exist in spirit" state the REVIEW predicted — but **not** under a `CalendarPort` interface and **not** in the slice.

## What is scaffolded-but-dead (needs adopt-or-delete decision)

- **lib-events** (18KB, 0 importers) — biggest dead artifact.
- **lib-db** (created, 38 files still on the singleton) — extraction without migration.
- **slices/calendar/** — aspirational README + empty dirs.
- **eslint.boundaries.config.js** — guards nothing yet.

## What remains (the real work, in REVIEW's recommended order)

1. **Finish Phase 1 infra + actually adopt it** — migrate the 38 singleton consumers to lib-db; wire or delete lib-events; build lib-config + lib-cache.
2. **Phase 2 Calendar Port** (cleanest win) — define `CalendarPort.js`, make the 3 `lib/cal-adapters` implement it, add `InMemoryCalendarAdapter`, build `facade.js`, repoint controllers.
3. **Phase 3 Task domain** — entity + repository port + facade; drain 66 getDb calls from `task.controller.js`.
4. **Phase 4 Scheduler** (4 wks, **high risk**) — extract pure `ConstraintSolver` + `ScoreEngine`, inject `TaskProviderPort`/`CalendarProviderPort`; drain 33 db calls from `src/scheduler/`.
5. **Phase 5–8** — Weather, remaining slices, MCP adapter, cleanup, hex test infra.

---

## Recommended next actions

- **Decide scope**: is the full 14-week hex migration still wanted, or a targeted subset (e.g. just isolate the fragile scheduler)? The WBS assumes a 2-dev team.
- **Reconcile governance**: either register juggler hex phases in `.planning/ROADMAP.md ## Backlog` (mirror the RO `ARCH-HEX-*` pattern) so Kermit tracks them, or formally shelve the WBS.
- **Adopt-or-delete the dead scaffolding** before adding more — unadopted lib-events/lib-db/empty-slice dirs are drift.
- If proceeding: **start with Calendar Port** (Phase 2) as the lowest-risk vertical slice to prove the pattern, per REVIEW §Recommendations.

---

## References

- [`JUGGLER-HEX-WBS.md`](./JUGGLER-HEX-WBS.md) — the plan (checkboxes stale)
- [`JUGGLER-HEX-REVIEW.md`](./JUGGLER-HEX-REVIEW.md) — the analysis
- `.planning/ROADMAP.md ## Backlog` — monorepo backlog (RO ARCH-HEX only; juggler absent)
- RO equivalent (further along, for pattern reference): `resume-optimizer/.../HEXAGONAL-CONVERSION-PIPELINE.md`
