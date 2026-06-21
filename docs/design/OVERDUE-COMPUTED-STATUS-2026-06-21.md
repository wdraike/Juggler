---
type: adr
status: active
version: leg/juggler-overdue-computed-status @ 2026-06-21
Last-updated: 2026-06-21
---

# Overdue as Computed-on-Read Display Status

**Date:** 2026-06-21
**Status:** ACCEPTED — committee-reviewed
**Leg:** `juggler-overdue-computed-status`
**Requirements:** R50.6, R50.7, R50.8 (see `juggler/docs/REQUIREMENTS.md` lines ~558-560)

---

## Table of Contents

1. [Problem](#1-problem)
2. [Decision — HYBRID approach](#2-decision--hybrid-approach)
3. [Rationale](#3-rationale)
4. [Consequences](#4-consequences)
5. [Alternatives considered](#5-alternatives-considered)
6. [Wrong-for-naive cases — edge-case contract](#6-wrong-for-naive-cases--edge-case-contract)
7. [Non-goals and deferred work](#7-non-goals-and-deferred-work)
8. [Implementing code](#8-implementing-code)
9. [Traceability](#9-traceability)

---

## 1. Problem

Three separate issues combined to produce stale or incorrect overdue display:

**a. Stale stored flag between scheduler runs.** `task_instances.overdue` is a stored
boolean written only when the scheduler runs. A task that becomes past-due between two
scheduler runs continues to read its stale `overdue=0` flag and therefore does not
appear in the Overdue list until the next run fires.

**b. Implied deadline not persisted.** Recurring and split tasks have an "implied
deadline" — the boundary of the recurrence period (e.g. end of week for a weekly
task). This boundary is computed in-run inside `recurringPeriodEndKey`
(`runSchedule.js:261`) but is never written to the database. The read path therefore
cannot reconstruct it, which means the gap in (a) is worse for recurring tasks: no
run means no `overdue` flag AND no deadline to compare against.

**c. Two diverged `getNowInTimezone` implementations.** The backend scheduler had its
own local implementation (`runSchedule.js:295`) and the frontend had a separate
implementation (`juggler-frontend/src/utils/timezone.js:141`). The two had drifted in
their formatting and edge-case handling, creating a class of off-by-a-day overdue
calls around midnight and DST transitions.

---

## 2. Decision — HYBRID approach

This design is explicitly HYBRID — not a pure-computed approach and not a pure-stored
approach. The word "hybrid" is load-bearing: it means the stored flag is kept and the
computed path is added on top of it, not a replacement.

**Decision 1 — Compute the overdue STATUS on read for display.**
`rowToTask` (the read-path mapper) derives `overdue` from a timezone-aware predicate
comparing (hard deadline OR materialized `implied_deadline` OR FIXED `scheduled_at`)
against the shared now, and OR-es the result with the stored flag. A past-due item
therefore shows `overdue:true` at read time even without a scheduler run having fired.

**Decision 2 — Keep placement results persisted.**
`scheduled_at` / unscheduled status remain written by the scheduler. The read path
computes a display label only; it never moves tasks or enqueues a scheduler run.

**Decision 3 — Keep the stored `overdue` flag.**
The flag is NOT deleted. It remains the scheduler solver's severity input and the
run's idempotency anchor. Its existing write paths are unchanged. The display path
OR-es with it rather than replacing it.

**Decision 4 — Materialize the implied deadline.**
A new nullable `task_instances.implied_deadline` DATE column is written during the
existing expand/reconcile insert pass (the scheduler's W3 phase). `implied_deadline`
is set to `recurringPeriodEndKey(master.recur, occDate)` for each recurring instance
row as it is inserted. It is exposed via the `tasks_v` view.

The column is a real persisted column, not a MySQL generated column. It cannot be a
generated column because the implied-deadline formula depends on recurrence type,
`timesPerCycle`, and the selected-day count — logic that lives in JS and is not
SQL-expressible.

**Decision 5 — One shared `getNowInTimezone` contract.**
A single module at `shared/scheduler/getNowInTimezone.js` provides the authoritative
implementation. Backend scheduler code that previously contained a local duplicate
now imports the shared module. The frontend utility (`juggler-frontend/src/utils/timezone.js`)
is reconciled to return the same field shape (`todayKey`, `nowMins`, `todayDate`),
the same h23 formatting, and the same `America/New_York` default. The frontend keeps
its own ESM copy (CRA cannot import from the backend's CommonJS shared/ tree), but
the spec they implement is now identical.

**Decision 6 — No read-triggered reschedule.**
The `scheduleQueue` remains write-driven (debounce + rate limit). The past-due
predicate that gates task placement continues to run only inside a scheduler run.
The read path computes a display status only and never enqueues work.

---

## 3. Rationale

**Why compute on read rather than relying only on more-frequent runs?**
The scheduler is expensive and rate-limited by design (debounce + queue). Tightening
its run frequency would couple overdue freshness to scheduler coupling costs. Deriving
the display label from a simple date comparison is cheap and stateless: it costs one
`getNowInTimezone` call per task row and compares two date strings. The run still does
everything that matters for actual placement; the read adds only the label.

**Why keep the stored flag instead of going pure-computed?**
Two reasons. First, the solver uses `overdue` as a severity signal when ranking
unplaced tasks; removing it would require the solver to recompute the same predicate
itself (duplication and drift risk). Second, the stored flag is the run's idempotency
anchor — it prevents the same past-due write from firing on every run for already-
resolved tasks. Removing the flag would break the solver and the idempotency contract.

**Why materialize `implied_deadline` to a column instead of recomputing in the mapper?**
The `recurringPeriodEndKey` formula requires `recur` (recurrence rule JSON),
`timesPerCycle`, and the occurrence date. These inputs are available during the
expand/reconcile insert pass but not in the read-path mapper without a secondary
query. Adding a secondary query per task row on every read would be an unacceptable
performance regression. Writing once during insert keeps the read path to a single
`tasks_v` row read, as before.

**Why not a MySQL generated column?**
Generated column expressions are SQL: they cannot call JavaScript functions, parse
JSON recurrence rules, or inspect `timesPerCycle`. Any SQL approximation would
duplicate and then diverge from the in-run logic.

**Why one shared now-contract?**
Off-by-a-day overdue calls around midnight and DST transitions are a whole class of
bugs, not isolated incidents. The two implementations had drifted; consolidating to
one specification-level contract (h23 formatting, `hour % 24` guard, same return
shape, injectable clock for tests) eliminates the class entirely.

---

## 4. Consequences

**Positive:**
- Past-due items show `overdue:true` in the UI immediately after the deadline passes, without waiting for a scheduler run. Eliminates the stale-flag display gap.
- The solver's existing severity signal (`task_instances.overdue` stored flag) and idempotency anchor are preserved without modification. No scheduler behavior changes.
- One canonical `getNowInTimezone` implementation eliminates the entire class of off-by-a-day bugs at midnight and DST transitions for any future consumer.
- `implied_deadline` is now queryable in SQL (e.g., for future analytics, reporting, or server-side overdue filtering) without recomputing JS recurrence logic.

**Negative / trade-offs:**
- Schema migration required: `task_instances.implied_deadline` DATE column + `tasks_v` view recreation. Pre-existing instance rows receive `NULL` (fail-safe — the stored `overdue` flag covers them).
- The frontend ESM copy of `getNowInTimezone` must be kept in sync with the shared spec manually (CRA cannot import from the backend's CommonJS `shared/` tree). The spec is now documented; divergence is a future risk.
- `rowToTask` now has a 5th optional `nowInfo` argument for clock injection. Callers that do not pass it receive wall-clock `now`; test suites must inject a fixed clock to get deterministic results.
- The `implied_deadline` backfill for pre-existing rows is deferred (NULL is the safe default — the stored overdue flag covers them). A future migration can backfill if needed.

---

## 5. Alternatives considered

**Alternative A — Pure computed (no stored flag, no migration)**
Derive `overdue` entirely from a JS predicate at read time; delete the stored `task_instances.overdue` column. Rejected: the solver uses the stored flag as a severity signal for ranking unplaced tasks, and the run uses it as an idempotency anchor. Removing it would require the solver to recompute the same predicate (duplication and drift) and would break idempotency.

**Alternative B — More-frequent scheduler runs**
Tighten the scheduler debounce / cron interval to reduce the stale-display window. Rejected: the scheduler is rate-limited by design (expensive, enqueues Cloud Tasks, modifies task state). Tightening the run frequency couples display freshness to scheduling cost and does not address the root cause (implied deadline not persisted, two diverged now-impls).

**Alternative C — MySQL generated column for `implied_deadline`**
Express `implied_deadline` as a generated (virtual or stored) column in SQL so no application code writes it. Rejected: the `recurringPeriodEndKey` formula depends on recurrence type, `timesPerCycle`, and the selected-day count — all encoded as JS logic over a JSON recurrence rule. This logic cannot be expressed in SQL. Any SQL approximation would duplicate and then diverge from the in-run logic.

**Alternative D — Secondary query in the read mapper**
Recompute `recurringPeriodEndKey` in `rowToTask` by fetching recurrence-rule data on demand. Rejected: would add a secondary DB query per task row on every read, an unacceptable performance regression for a listing endpoint that returns many rows.

**Alternative E — Server "now" endpoint for the frontend**
Replace the frontend's local `getNowInTimezone` with a network call to a backend endpoint returning the server's current time. Rejected (for this leg): the two implementations had drifted in spec, not just in server/client time. Fixing the spec (same fields, same formatting, same default) is sufficient. A server-provided timestamp is a separate decision and is deferred.

---

## 6. Wrong-for-naive cases — edge-case contract

These are the cases where a naive "is today past the deadline?" predicate produces the
wrong answer. Every one MUST be handled by the computed read path.

| Case | Naive result | Correct result | Guard |
|------|-------------|----------------|-------|
| Floating task (no deadline, no `implied_deadline`, non-FIXED) | Might compute overdue from some fallback date | Never overdue | `hasHardCommitment` gate: requires `row.deadline OR row.implied_deadline OR FIXED`. If none, skip computed path entirely. Honors 999.671. |
| ANYTIME task (same-day, no deadline) | Might compare clock time | Not overdue — same-day ANYTIME is in-progress, not past-due | Same `hasHardCommitment` gate: no deadline and no implied_deadline → no computed path |
| FIXED event | Uses master deadline | Uses `scheduled_at` as the hard due | `placement_mode === 'FIXED'` → use derived `task.date` from `scheduled_at` |
| Terminal status (done / skip / cancel / paused / missed / disabled) | Might still compute overdue | Never overdue | `isTerminalStatus(row.status)` clamp; `disabled` separately suppressed |
| Recurring master with no materialized instance | No instance row exists | No false overdue — the row literally does not exist | No instance row in `task_instances` → no `rowToTask` call → no computed overdue |
| Split chunks | Each chunk has one implied_deadline (the master's period end) | Implied deadline is per-OCCURRENCE, not per-master | `implied_deadline` written per-instance row during insert pass, not inherited from the master |

---

## 7. Non-goals and deferred work

The following are explicitly out of scope for this leg and must not be inferred from
this design:

**Recurring-overdue lifecycle (999.801 family).** This design addresses the display
status gap. The broader recurring-overdue lifecycle — freezing the overdue flag at the
last-valid slot when a recurring task is missed, the full R32.4 reconciliation pass,
over-materialization (timesPerCycle=1 producing too many instances per cycle) — is
separate future work tracked under the 999.801 backlog family.

**Server "now" endpoint for the frontend.** The frontend now-contract reconciliation
in this leg is implementation-parity: it aligns the frontend ESM copy's return shape
and defaults to the shared spec. It does not add a network round-trip to a server-
provided "now" timestamp. That is a separate decision and is deferred.

---

## 8. Implementing code

| File | Role | What changed |
|------|------|-------------|
| `shared/scheduler/getNowInTimezone.js` | Shared now-contract (NEW) | Canonical implementation; `todayKey` / `nowMins` / `todayDate`; h23 formatting; injectable clock; exported as CJS for both backend consumers |
| `juggler-backend/src/slices/task/domain/mappers/taskMappers.js` | Read-path mapper | `rowToTask` extended with optional 5th arg `nowInfo` for clock injection; computed-overdue IIFE at `overdue` field: short-circuits on stored flag, suppresses on terminal/disabled, evaluates `hasHardCommitment`, derives `dueKey` from deadline/`implied_deadline`/FIXED, compares against shared now |
| `juggler-backend/src/scheduler/runSchedule.js` | Scheduler runner | Local `getNowInTimezone` duplicate removed; replaced with `require('../../../shared/scheduler/getNowInTimezone')`. `chunkInsertRows` map populates `implied_deadline: recurringPeriodEndKey(...)` per instance row |
| `juggler-backend/src/db/migrations/20260621000000_add_implied_deadline_to_task_instances.js` | Schema migration | Adds nullable `implied_deadline` DATE to `task_instances`; recreates `tasks_v` view to expose the new column in the instances branch and `cast(NULL as date)` in the templates branch. Reversible `down()` restores prior view |
| `juggler-frontend/src/utils/timezone.js` | Frontend tz utils | `getNowInTimezone` export reconciled: returns `{ todayKey, nowMins, todayDate }` with same h23 formatting, same `America/New_York` default, same `hour % 24` guard |
| `juggler-frontend/src/components/views/ConflictsView.jsx` | Overdue list view | Generated instances with `t.overdue === true` now appear in the Overdue section (W5 fix: previously they were filtered out before the computed `overdue` field was available) |

---

## 9. Traceability

| Requirement | Statement summary | Status | Code pointer |
|-------------|------------------|--------|-------------|
| R50.6 | Read path derives computed overdue (OR-ed with stored flag); floating/terminal never overdue | implemented | `taskMappers.js` `rowToTask` overdue IIFE |
| R50.7 | `implied_deadline` DATE column materialized during expand/reconcile; exposed via `tasks_v` | implemented | Migration `20260621000000_add_implied_deadline_to_task_instances.js`; `runSchedule.js` `chunkInsertRows` |
| R50.8 | Single `getNowInTimezone` contract (shared backend + frontend parity) | implemented | `shared/scheduler/getNowInTimezone.js`; `runSchedule.js` import; `timezone.js` reconciled |

Builds on shipped R50.0–R50.5 (origin/main juggler `c529cec`).

Brain cross-references: #88199 (R50 model), #88203/#88204 (R50 shipped), #72163 (999.671 floating guard).

Backlog item: 999.801 family (recurring-overdue lifecycle — deferred, out of scope for this leg).
