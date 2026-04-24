# Bucket 3 — Remaining Design Decisions (#11, #13)

Issues #12 (fixed bug) and #24 (terminology sweep) are already done. These two are the data-model consolidations — each touches the task model and the scheduler, so they warrant a design pass before code.

---

## Issue #11 — Merge `desired_at` + `desired_date`

### What you asked
> Why do we use `desired_at` and `desired_date` as separate fields? Why not a single date/time field?

### Why two exist today

Both live on `task_masters`. They record the user's **original intent** so the UI can show "Moved: 9:00 AM → 10:30 AM" when the scheduler reshuffled a task.

- `desired_at` DATETIME — user wanted this specific time
- `desired_date` DATE — user wanted this specific day but no specific time

Both get set from `taskToRow()` in `src/controllers/task.controller.js:462-506`:
- `scheduledAt` (explicit time) → `desired_at = scheduledAt`
- `date + time` → `desired_at = localToUtc(date, time, tz)`
- `date` only (no time) → `desired_at = localToUtc(date, null, tz)` **and** `desired_date = date`

The separate `desired_date` exists because DATETIME can't represent "this day, any time" — `localToUtc(date, null, tz)` collapses to midnight UTC, which is indistinguishable from "user actually wants midnight."

### Scheduler impact
**None.** The scheduler reads neither field — a grep of `src/scheduler/` shows only a local variable `desiredDate` in `reconcileOccurrences.js` (unrelated). These fields are purely for UI intent-display.

### Usage sites
- 42 references repo-wide (backend + frontend)
- Frontend reads only `task.desiredAt` (not `desiredDate`) — TaskEditForm shows "Moved: X → Y" at lines 1069, 1204, 1219
- MCP tool schema exposes both (tasks.js:52-53)

### Options

**Option A — Drop `desired_date`, keep only `desired_at`.** (Recommended.)

Day-only intent stores midnight of that day. Display code already handles `desired_at` exclusively on the frontend, so no UI change needed. Minor quirk: if a user genuinely wants a task at midnight and the scheduler moves it, "Moved: 12:00 AM → 10:30 AM" is a correct but unusual display. Zero-value edge case.

Migration: backfill `desired_at` from `desired_date` where `desired_at IS NULL AND desired_date IS NOT NULL`, then drop `desired_date`. Update `task.controller.js:467-506` to stop touching `desired_date`, MCP schema to drop the field, `tasks-write.js` MASTER_FIELDS to drop it.

**Option B — Rename both for clarity, keep two.**

`desired_at` → `desired_time` (DATETIME when time-specific), `desired_date` → `desired_day` (DATE when day-only). Write-path enforces exactly-one-or-the-other. No schema reduction — just semantic clarification.

**Option C — Keep as-is.**

The current shape works. Document in SCHEMA.md that they're mutually exclusive intent markers and move on. Cheapest.

### Recommendation: **Option A**.

The midnight edge case is negligible. The frontend already ignores `desired_date`. The merge is a ~50-line change + migration.

### Decision needed
- [ ] Option A — drop `desired_date` (recommended)
- [ ] Option B — rename both, keep two
- [ ] Option C — keep as-is, just document

---

## Issue #13 — Scheduling mode enum

### What you asked
> Can we consolidate the data in `task_masters` to be simpler, using settings that refer to one mutually exclusive setting for things like `marker`, `rigid`, `time blocks`, and the like?

### What's mutually exclusive today

Per `juggler-backend/docs/TASK-PROPERTIES.md`, a task's **scheduling mode** is derived from a combination of flags that are, in practice, mutually exclusive — but the schema lets you set invalid combinations (e.g., `marker=true + rigid=true`).

**Current flags on `task_masters`:**
| Flag | Type | Mode it triggers |
|---|---|---|
| `marker` | bool | Marker (calendar indicator, no placement) |
| `rigid` | bool | Rigid recurring (force-place at `preferred_time_mins`) |
| `preferred_time_mins` | int | Time-window recurring (anchor + `time_flex` radius) |
| `flex_when` | bool | Allow scheduler to drift out of `when` windows |
| `when` string | varchar | `'fixed'` triggers Fixed mode; `'allday'` all-day; `'anytime'` unconstrained |

**On `task_instances`:**
| Flag | Type | Mode it triggers |
|---|---|---|
| `date_pinned` | bool | Pinned (user drag-locked the placement) |

### The modes that actually matter

Collapsing the truth table:

| Mode | Applies to | Behavior |
|---|---|---|
| `marker` | master | No placement. Calendar indicator only. |
| `fixed` | master | Exact datetime lock. Immovable. |
| `pinned` | instance | User-pinned date. |
| `recurring_rigid` | master | Force at `preferred_time_mins`. |
| `recurring_window` | master | Preferred time ± `time_flex` radius. |
| `recurring_flexible` | master | Any time on the recurrence day. |
| `flexible` (default) | master | Scheduler decides. |

### Options

**Option A — Add `placement_mode` enum column, keep the flags.** (Recommended.)

`task_masters.placement_mode` ENUM('marker','fixed','recurring_rigid','recurring_window','recurring_flexible','flexible'). Treat as the source of truth going forward. The existing boolean flags become derived (and eventually dropped after a deprecation pass).

Pros:
- One field to set in the UI, no more invalid combinations.
- Scheduler can branch on `placement_mode` instead of combinations of 4 flags.
- Migration backfills mode from existing flags; rollback keeps flags.

Cons:
- Scheduler has 97 touchpoints on these flags (memory warns: bugs cascade).
- Deprecation needs to be staged — flags and enum coexist during cutover.

**Option B — Strict write-path validation, keep flags.**

No schema change. Add `assertValidModeCombination()` on every write. Invalid combos throw. Doesn't simplify the shape, just polices it.

**Option C — Leave as-is, document.**

Document the matrix in TASK-PROPERTIES.md (already partially done). Skip code changes.

### Recommendation: **Option A**, but executed carefully.

Given the scheduler-cascade warning, do not rip out the flags in one pass. Stage it:

1. **Phase 1** — add `placement_mode` column; backfill; scheduler still reads flags.
2. **Phase 2** — flip UI to write the enum (which also continues to set flags via a write-path translator).
3. **Phase 3** — scheduler reads enum instead of flags; flags become derived.
4. **Phase 4** — drop flags.

This bundles well with Bucket 4 (scheduler redesign) — Phase 3 is naturally a design point for the new scheduler.

### Decision (2026-04-26)

**Deferred to Bucket 4.** The scheduler redesign will touch every code path that currently branches on `marker`/`rigid`/`flex_when`/`when`/`preferred_time_mins`. Introducing `placement_mode` as a standalone Phase 1 would add a shim layer the new scheduler throws away. Bundle instead: the Bucket 4 scheduler spec will define its branching on `placement_mode` directly, and the migration + backfill lands alongside the scheduler cutover.

---

## Summary of Bucket 3 status

| # | Status |
|---|---|
| 12 | ✅ Done — added `setDatePinned(true)` to the Fixed button |
| 24 | ✅ Done — 8 user-visible strings swept ("Completed" → "Done" in prose; kept "Complete" for imperative buttons) |
| 11 | ⏸ Needs decision (see above) |
| 13 | ⏸ Needs decision (see above) |

UI verification not yet run — please open the task detail and confirm #12 visually before considering Bucket 3 closed.
