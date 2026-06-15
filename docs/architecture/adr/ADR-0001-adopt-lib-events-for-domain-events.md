---
type: decision
status: accepted
date: 2026-06-09
deciders: cookie, Kermit
---

# ADR-0001 — Adopt `@raike/lib-events` for cross-slice domain events

## Status

Accepted. (Originally proposed 2026-06-09; adopted as the `TaskEventPort` backing bus.)

## Context

`src/lib/events` is 634 lines and was built 2026-05-28, but had **0 importers** — the
largest piece of dead scaffolding in the service (`JUGGLER-ARCH-REVIEW-2026-06 §6 #2`).
The hexagonal design needs the scheduler to be triggered by task mutations **without
the scheduler self-triggering** (invariants S4 "triggered by user/MCP mutation only —
never self-triggers" and S6 "no cascading scheduler calls"). A typed publisher/subscriber
seam between the Task slice and the Scheduler slice satisfies that decoupling cleanly.

## Decision

Adopt `@raike/lib-events` as the backing bus for the **`TaskEventPort`** driven-port:

- The **Task slice publishes** lifecycle events (`TASK_CREATED`, `TASK_UPDATED`,
  `TASK_COMPLETED`) via the `EventBusTaskEvents` adapter.
- The **Scheduler slice subscribes** to those task-mutation events and runs the schedule.

Binding invariants on the port: E-1 publisher-only (must not call `enqueueScheduleRun`),
E-2 fire-and-forget (a publish must not throw into or alter the task write response), and
E-3 minimal payload (`{ taskId, userId, status, timestamp }`). Until the scheduler slice
lands, the existing direct facade trigger remains in place.

## Consequences

- **Easier:** a clean, typed trigger boundary with no controller-to-scheduler direct call;
  preserves the S4/S6 invariants by construction; 634 lines of built work are retained.
- **Harder:** one publisher plus the subscribe seam must be wired before the scheduler
  slice can rely on it.

**Alternatives considered:** (a) **delete `lib-events`** and keep the direct facade trigger
— rejected: discards the decoupled seam the scheduler needs and 634 lines of built work;
(b) **leave it dead** — rejected: ongoing drift risk and a false "we have an event bus" signal.
