# Juggler — Backlog

_Last consolidated: 2026-05-11 (Phase `consolidate-handovers`)_

This is the canonical open-work index for `juggler/`.

**Location decision (user choice 2026-05-11, Option A):** This file lives **inside the
`juggler/` submodule** as `juggler/BACKLOG.md`. Each update requires a submodule commit
and a monorepo pointer bump — the trade-off is accepted in exchange for keeping each
service's backlog inside its own repo (so juggler-specific consumers see it without the
monorepo).

**Scope of this file:**
- 3 items from the informal `Juggler Backlog Thoughts.md` vault note (now purged).
- 6 hand-written `.planning/todos/pending/` files (pre-audit). These remain the canonical
  individual files; this BACKLOG.md references them so they are not lost amid the 102
  machine-generated juggler audit todos.
- 2 items reflected from `MASTER-PLAN.md` JUGGLER section (Hold + Open).
- An aggregate-count summary of the 102 `juggler-{db,deadcode,perf,deadui,security}-*`
  machine-generated todos per RESEARCH §6.

## Source-file column convention

`Source File` points to the canonical record for each row. For hand-written todos
that's a path in `.planning/todos/pending/`. For consolidated vault notes (now
purged), the row is the canonical record itself; no source remains.

---

## Critical

| ID | Title | Source File | Source Line | Last-Touched | Blocker |
|----|-------|-------------|-------------|--------------|---------|
| _(no critical-tier items)_ | | | | | |

---

## High

| ID | Title | Source File | Source Line | Last-Touched | Blocker |
|----|-------|-------------|-------------|--------------|---------|
| JUG-HIGH-04 <a id="multi-server-config-audit"></a> | Multi-server readiness audit — validate all code for safe horizontal scaling | (user-reported 2026-05-12) | — | 2026-05-12 | Audit entire backend for patterns that break under multiple Cloud Run instances. Full audit scope: (1) SSE/real-time — identify all SSE or WebSocket fan-out; confirm no in-process-only subscriber maps (same issue pattern as resume-optimizer); design Pub/Sub or sticky-session path if found. (2) Scheduler state — `unifiedScheduleV2.js` and `scheduleQueue.js`; confirm event queue deduplication is DB-backed not in-memory; no in-process timers driving schedule runs. (3) Calendar sync — concurrent-sync duplicate-active-row bug (Apple, known) may worsen under multi-instance; audit lock strategy for sync ingest across all providers (GCal, MSFT, Apple). (4) In-memory caches/singletons — AI enrichment cache, rate limiters, MCP connection state; identify what must be shared. (5) Job queues — confirm `QUEUE_DRIVER` routes all async work through Cloud Tasks; no in-process fallback queues. (6) Filesystem — temp file writes, attachment staging; Cloud Run containers don't share disk. (7) Process-level locks — `setInterval`, `setTimeout`, in-memory mutex patterns that assume single process. Output: findings doc listing each risk with severity (breaks silently / breaks loudly / safe) + recommended fix per item before any scale-out. |
| JUG-HIGH-01 | Apple last-modified field not extracted on sync ingest | .planning/todos/pending/2026-05-09-apple-last-modified-not-extracted.md | (whole file) | 2026-05-09 | Hand-written 2026-05-09. Apple CalDAV cal-sync ingest path; field is dropped — affects change-detection downstream. |
| JUG-HIGH-02 | Cloud Tasks admin UI fixes | .planning/todos/pending/2026-05-10-cloud-tasks-admin-ui-fixes.md | (whole file) | 2026-05-10 | Hand-written 2026-05-10. Admin queue page bugs in the Cloud-Tasks-backed event-queue surface. |
| JUG-HIGH-03 | Calendar views must show skipped & done tasks from the past | .planning/todos/pending/2026-05-08-juggler-calendar-views-show-past-skipped-and-done-tasks.md | (whole file) | 2026-05-08 | Hand-written 2026-05-08. Calendar UI filter is dropping skipped/done tasks from past dates. |

---

## Medium

| ID | Title | Source File | Source Line | Last-Touched | Blocker |
|----|-------|-------------|-------------|--------------|---------|
| JUG-MED-07 <a id="scheduler-visual-docs"></a> | Scheduler — full visual documentation (Mermaid diagrams or equivalent) | (user-reported 2026-05-12) | — | 2026-05-12 | Document the scheduler end-to-end using visual tools (Mermaid, HTML flowcharts, or similar). Cover: trigger sources, scheduling algorithm flow, state transitions, split/chain/recurring paths, event queue integration. Goal: anyone can understand the scheduler from the diagrams alone. |
| JUG-MED-01 | Show all-day events at top of calendar view | ~/Obsidian-Vault/wiki/design-docs/juggler/Juggler Backlog Thoughts.md (purged 2026-05-11; content captured here) | Item 1 of 3 | 2026-05-11 | Calendar layout/ordering change. Trivial UX win, no design blocker. |
| JUG-MED-02 | Sort out icons for weather (currently confusing) | ~/Obsidian-Vault/wiki/design-docs/juggler/Juggler Backlog Thoughts.md (purged 2026-05-11) | Item 2 of 3 | 2026-05-11 | Weather icon-set ambiguity. Needs UX pass + map to canonical icon set. |
| JUG-MED-03 | Fix sync frequency issues | ~/Obsidian-Vault/wiki/design-docs/juggler/Juggler Backlog Thoughts.md (purged 2026-05-11) | Item 3 of 3 | 2026-05-11 | Sync frequency is informally noted as inconsistent. Needs concrete repro + RC before a fix can be scoped. |
| JUG-MED-04 | ClimbRS header consistency (Juggler ↔ ClimbRS auth artifacts) | .planning/todos/pending/2026-05-04-juggler-climbrs-header-consistency.md | (whole file) | 2026-05-04 | Hand-written 2026-05-04, pre-audit. Note: MASTER-PLAN.md shows "✅ ClimbRS header consistency — done in resume-optimizer/ClimbRS" in Closed list — verify status before working; may already be done. |
| JUG-MED-05 | Header responsive layout — auto-scale, eliminate overlaps | .planning/todos/pending/2026-05-04-juggler-header-responsive-overlap.md | (whole file) | 2026-05-04 | Hand-written 2026-05-04. Note: MASTER-PLAN.md shows "✅ Header responsive overlap — commit `c2c284a`" in Closed list — verify whether this todo predates the fix or covers a residual issue. |
| JUG-MED-06 | Sync ingest — treat event as reminder vs. time-consuming task | .planning/todos/pending/2026-05-04-juggler-sync-ingest-reminder-vs-task.md | (whole file) | 2026-05-04 | Hand-written 2026-05-04. Note: MASTER-PLAN.md shows "✅ Sync ingest reminder-vs-task — migration `20260505000100_add_ingest_mode_to_user_calendars`" in Closed list — verify whether this todo is the DB part only or also covers UI surfacing. |

---

## Hold (design decision pending)

| ID | Title | Source File | Source Line | Last-Touched | Blocker |
|----|-------|-------------|-------------|--------------|---------|
| JUG-HOLD-01 | `timesPerCycle` work-budget-aware | MASTER-PLAN.md (JUGGLER → Hold) | "tpc currently occurrence-count-based, not work-budget-based" | 2026-05-08 | Design question: suppress slots when `sum(time_remaining) < session_dur`, or keep occurrence-count + manual tpc adjust? Files: `shared/scheduler/expandRecurring.js` (tpc slot accounting), `src/scheduler/runSchedule.js:489` (`time_remaining → effectiveDur`). Held for UX review. |

---

## Reference (from MASTER-PLAN.md)

| ID | Title | Source File | Source Line | Last-Touched | Blocker |
|----|-------|-------------|-------------|--------------|---------|
| JUG-REF-01 | Full juggler code review (covered by `juggler-code-review` phase) | MASTER-PLAN.md (JUGGLER → Open) | "Full juggler code review — DB schema, SQL, dead code, …" | 2026-05-08 | Note: the audit phase produced the 102 deferred findings summarized below. MASTER-PLAN.md bullet should move to ✅ Closed once the user confirms; for now it remains for traceability. |

---

## Deferred Audit Findings (not enumerated here — see `.planning/todos/pending/`)

102 machine-generated juggler audit todo files from `juggler-code-review-*` phases. They
remain the canonical individually-addressable format per RESEARCH §6. This section
only summarizes counts.

| Category | Count | Priority |
|----------|-------|----------|
| `juggler-db-db-*-dead-by-*` (dead-by-date drift) | 20 | Medium |
| `juggler-db-db-*-missing-index-*` | 18 | Medium |
| `juggler-db-db-*-collation-drift-*` | 8 | High — MySQL 8 default `utf8mb4_0900_ai_ci` breaks joins (CLAUDE.md collation rule) |
| `juggler-db-db-*-missing-fk-*` | 7 | High |
| `juggler-db-db-*-duplicate-index-*` | 7 | Medium |
| `juggler-db-db-*-unused-index-*` | 6 | Low |
| `juggler-db-db-*-tz-inconsistency-*` | 5 | Medium |
| `juggler-db-db-*-json-schema-*` | 4 | Low |
| `juggler-db-db-*-type-mismatch-*` | 3 | Medium |
| `juggler-db-db-*-cascade-unsafe-*` | 1 | High — destructive cascade risk |
| `juggler-deadcode-rollup-*` | 9 | Low |
| `juggler-perf-perf-*` | 7 | Medium |
| `juggler-deadui-rollup-*` | 4 | Low |
| `juggler-security-*` | 2 | High |
| `juggler-db-db-*` (residual / uncategorized) | 1 | Medium |
| **Total** | **102** | — |

_Subtotal check: db=80, deadcode=9, perf=7, deadui=4, security=2 — matches RESEARCH §0._

_Full list: `find .planning/todos/pending -name "juggler-db-*" -o -name "juggler-deadcode-*" -o -name "juggler-perf-*" -o -name "juggler-deadui-*" -o -name "juggler-security-*"` (102 files)_

---

## Active design specs (kept in place, not consolidated here)

These are reference docs and remain at their vault location:

- `~/Obsidian-Vault/wiki/design-docs/juggler/SYNC-EVENT-TO-TASK-HANDOFF.md` — active design spec for juggler sync. Keep open while sync work continues.

---

## Reversibility note

Sources for every row above:
- Hand-written todos: untouched in `.planning/todos/pending/`.
- `Juggler Backlog Thoughts.md`: purged by Task 6 of `consolidate-handovers`; the 3 items are captured verbatim above (JUG-MED-01..03).
- MASTER-PLAN.md: untouched (only the `### Open` section is refreshed by Task 8 to point here).

Pre-state snapshot: `.planning/phases/consolidate-handovers/PRE-STATE.txt`.
