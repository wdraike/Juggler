---
type: decision
status: accepted
date: 2026-05-12
deciders: prior veto (recorded here 2026-06-09)
---

# ADR-0003 — Repository timestamps use JS `new Date()`, never `db.fn.now()`

## Status

Accepted (prior veto 2026-05-12; recorded as an ADR 2026-06-09). This is persistence
invariant **P1**, binding on every `Knex*Repository` adapter.

## Context

`db.fn.now()` returns a Knex raw object. On the write path this raw object breaks
circular-JSON serialization (the 2026-05-12 veto). The legacy `task.controller.js`
violated this on ~8 write paths. The domain — not the database — should own the clock so
that writes are serializable and timestamps are deterministic and testable.

## Decision

Every `Knex*Repository` adapter sets `created_at` / `updated_at` (and related write-time
fields such as `completed_at` / `scheduled_at`) with a JS **`new Date()`**, never
`db.fn.now()` or raw `NOW()`. The repository corrects all in-scope legacy sites. Where
DB-clock parity genuinely matters (the scheduler's notion of "now"), the domain uses an
explicit `ClockPort` → `MysqlClockAdapter` rather than reaching for `db.fn.now()` inline.

## Consequences

- **Easier:** writes are serializable (no circular-JSON break); timestamps are
  deterministic and can be asserted in adapter unit tests (the test stubs knex and checks a
  JS `Date` is passed); the clock is an explicit, injectable dependency.
- **Trade-off:** timestamps come from the app server clock rather than the DB clock; cases
  needing DB-clock parity must go through `ClockPort` explicitly.

**Alternatives considered:** (a) **`db.fn.now()`** — rejected (the veto: circular-JSON
break on the write path); (b) **raw SQL `NOW()`** — rejected: same serialization class plus
it couples the domain to the SQL dialect.
