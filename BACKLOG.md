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
| ~~JUG-HIGH-04~~ | ~~Multi-server readiness audit — validate all code for safe horizontal scaling~~ | — | — | 2026-05-14 | **FIXED** — Phase 07 shipped 4 fixes: FIX-01 TTL sweep replaces blanket startup `sync_locks DELETE` (f06750d); FIX-03 OAuth `usedCodes` Set → DB-backed `markCodeUsed` (048f74e); FIX-04 `scheduleQueue.pollLoop` → DB atomic claiming (0032017); FIX-05 AI rate limiter MemoryStore → RedisStore (15705d9). Post-review fixes CR-01/CR-03/WR-03/WR-05 applied. Remaining audit areas (job queues, filesystem, calendar sync locks) confirmed safe or out-of-scope for current single-instance deploy. |
| ~~JUG-HIGH-01~~ | ~~Apple last-modified field not extracted on sync ingest~~ | — | — | 2026-05-14 | **FIXED** — ETag-based change detection (commit 4d5c805). Migration `20260514000300` adds `provider_etag` to `cal_sync_ledger`; Apple CalDAV ETags replace the absent `LAST-MODIFIED`. |
| ~~JUG-HIGH-02~~ | ~~Cloud Tasks admin UI fixes~~ | — | — | 2026-05-14 | **MOVED** — belongs in resume-optimizer; tracked as `RO-HIGH-11` in `resume-optimizer/BACKLOG.md`. |
| ~~JUG-HIGH-03~~ | ~~Calendar views must show skipped & done tasks from the past~~ | — | — | 2026-05-14 | **FIXED** — `isPast` guard in DayView + DailyView `matchesFilter` (commit cdcdaef). Past-day done/skip/cancel always visible regardless of filter mode. |

---

## Medium

| ID | Title | Source File | Source Line | Last-Touched | Blocker |
|----|-------|-------------|-------------|--------------|---------|
| JUG-MED-07 <a id="scheduler-visual-docs"></a> | Scheduler — full visual documentation (Mermaid diagrams or equivalent) | (user-reported 2026-05-12) | — | 2026-05-12 | Document the scheduler end-to-end using visual tools (Mermaid, HTML flowcharts, or similar). Cover: trigger sources, scheduling algorithm flow, state transitions, split/chain/recurring paths, event queue integration. Goal: anyone can understand the scheduler from the diagrams alone. |
| ~~JUG-MED-01~~ | ~~Show all-day events at top of calendar view~~ | — | — | 2026-05-14 | **FIXED** — CalendarView sort + DailyView all-day banner (commit 2f94a01). DayView already correct. |
| ~~JUG-MED-02~~ | ~~Sort out icons for weather (currently confusing)~~ | — | — | 2026-05-14 | **FIXED** — Meteocons SVG icons, per-code WMO mapping, Comp C badge layout (icon 20px + hi/lo + raindrop 14px + precip%). Shared util `weatherIcons.js`; 4 duplicate `weatherCodeIcon()` fns removed. Sketch 001 documents decisions. |
| ~~JUG-MED-03~~ | ~~Fix sync frequency issues~~ | — | — | 2026-05-14 | **FIXED** — 3 RCs fixed: (1) Apple excluded from polling interval — added `appleFreq`/`appleAuto` to `AppLayout.jsx` loop and `activeFreqs` push; (2) `has-changes` local-change check used only `gcal_last_synced_at` — now uses max of all 3 provider timestamps so MSFT/Apple-only users get local-change detection (`cal-sync.controller.js`); (3) `calSyncSettings` object reference in `useEffect` dep array caused interval to restart every render — extracted primitive `gcalFreq`/`msftFreq`/`appleFreq` numbers before the effect, deps are now stable. |
| ~~JUG-MED-04~~ | ~~ClimbRS header consistency~~ | — | — | 2026-05-14 | **ALREADY DONE** — MASTER-PLAN.md confirms ✅ done in resume-optimizer/ClimbRS. |
| ~~JUG-MED-05~~ | ~~Header responsive layout — auto-scale, eliminate overlaps~~ | — | — | 2026-05-14 | **ALREADY DONE** — commit `c2c284a` (ResizeObserver collapse). Confirmed in git log. |
| ~~JUG-MED-06~~ | ~~Sync ingest — treat event as reminder vs. time-consuming task~~ | — | — | 2026-05-14 | **ALREADY DONE** — migration `20260505000100_add_ingest_mode_to_user_calendars` confirmed in DB. |

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
| ~~`juggler-db-db-*-collation-drift-*`~~ | ~~8~~ | ~~High~~ | **FIXED** — migration `20260515000100` converts 8 tables to `utf8mb4_unicode_ci` (commit a391eea) |
| ~~`juggler-db-db-*-missing-fk-*`~~ | ~~7~~ | ~~High~~ | **FIXED** — migration `20260515000200` adds 7 FK constraints incl. `ai_command_log` type fix + `impersonation_log` SET NULL (commit a391eea) |
| `juggler-db-db-*-duplicate-index-*` | 7 | Medium |
| `juggler-db-db-*-unused-index-*` | 6 | Low |
| `juggler-db-db-*-tz-inconsistency-*` | 5 | Medium |
| `juggler-db-db-*-json-schema-*` | 4 | Low |
| `juggler-db-db-*-type-mismatch-*` | 3 | Medium |
| ~~`juggler-db-db-*-cascade-unsafe-*`~~ | ~~1~~ | ~~High~~ | **FIXED** — migration `20260515000300` changes `sync_history.user_id` CASCADE → SET NULL to preserve audit log on user deletion (commit a391eea) |
| `juggler-deadcode-rollup-*` | 9 | Low |
| `juggler-perf-perf-*` | 7 | Medium |
| `juggler-deadui-rollup-*` | 4 | Low |
| ~~`juggler-security-*`~~ | ~~2~~ | ~~High~~ | **ALREADY DONE** — JF-R1 (rate limits) and JF-R2 (raw-body webhook HMAC) confirmed present in `app.js` by audit (2026-05-14) |
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
