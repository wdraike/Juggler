---
type: decision
status: accepted
date: 2026-06-09
deciders: cookie, Kermit
---

# ADR-0002 — Migrate persistence to `@raike/lib-db`; retire `src/db.js`

## Status

Accepted — **in progress**. `lib/db` is the canonical DB-access home and new
`Knex*Repository` adapters route through `getDefaultDb()`. `src/db.js` still exists as an
interim bridge that re-exports the shared connection; roughly **35 importers** remain to be
migrated slice-by-slice (tracked as backlog **999.434**).

## Context

`src/lib/db` was extracted but had only **1** consumer (`cron/cal-history-cron.js`), while
the legacy `src/db.js` singleton still had **35** importers (`JUGGLER-ARCH-REVIEW-2026-06 §3`).
This "extraction-without-migration" half-state is the worst outcome: two DB-access homes,
neither canonical. Per-slice repository injection (and testability of those repositories)
requires a single connection seam.

## Decision

Route every `Knex*Repository` adapter through `@raike/lib-db` (`getDefaultDb()`). Migrate
the 35 `src/db.js` consumers **slice-by-slice as each slice lands** (delta migration, not
big-bang). Keep `src/db.js` as an interim re-export bridge so unmigrated consumers keep
working; **delete it when the last consumer moves**.

## Consequences

- **Easier:** a single DB-access home; repositories become injectable and unit-testable
  against a stub knex; the half-state is resolved incrementally without a flag day.
- **Harder:** the ~35 edits are spread across legs, so the `src/db.js` bridge lingers until
  the final slice migrates; the deletion is tracked separately (999.434) rather than as a
  cleanup carry.

**Alternatives considered:** (a) **keep `src/db.js` as canonical, delete `lib/db`** —
rejected: blocks per-slice repository injection and testability; (b) **big-bang migrate all
35 importers at once** — rejected: high blast radius, violates delta-migration discipline.
