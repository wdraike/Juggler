# Juggler Scheduler — Authoritative Specification

**Status:** DRAFT for review/lock · **Built:** 2026-06-23 · **Reconciled against:** juggler `main` tip
`505a09b` + WIP branch `leg/juggler-overdue-reschedule` `60835fe` + brain + the existing doc fragments.

## Purpose
The single source of truth for what the juggler scheduler is supposed to do — placement, recurring
lifecycle, overdue/missed, persistence/read-model, and calendar-sync coupling — with **every behavior
tagged by its real status in the code** (IMPLEMENTED / PARTIAL / PLANNED / CONTRADICTED / KNOWN-BUG).
It exists so scheduler intent stops being scattered across a dozen branches + 8 doc fragments + brain
facts, so in-flight work isn't "lost" between sessions, and so any change is validated against the
whole, not a slice.

**How to use:** read the relevant section before designing/changing scheduler code. On any change to a
behavior here, TELL Scooter (INBOX) so this stays current. This doc reconciles the fragments below —
where a fragment disagrees with the code, the **code + this doc win** and the fragment is flagged stale.

## Doc reconciliation map (what was scattered, what's canonical now)
| Source | Role now |
|--------|----------|
| **THIS doc + SECTION A–F** | Authoritative consolidated spec (single source of truth) |
| `juggler-backend/docs/architecture/SCHEDULER-RULES.md` | Canonical per-rule detail (§3 placement, §5–6 recurring) — current, keep |
| `juggler-backend/docs/architecture/SCHEDULER-OVERDUE-LADDER.md` | Canonical overdue-ladder detail — keep |
| `juggler-backend/docs/SCHEDULER.md` | **STALE** — teaches a dead v1 "Phase 0–5" model; superseded by SCHEDULER-RULES.md §3.1 7-phase. Annotate/retire. |
| `SCHEDULER-TRACEABILITY-REPORT.md`, `MISSING-REQUIREMENTS-AND-TESTS-REPORT.md`, `TRACEABILITY-AUDIT-CURRENT.md` | Requirement IDs (R11/R32/R33/R34/R50…) + test-gap source. No formal `REQUIREMENTS.md` exists — R-numbers live here + in code comments. |
| `RECURRING-SPACING-DESIGN.md`, `TASK-STATE-MATRIX.md`, `TASK-CONFIGURATION-MATRIX.md`, `TASK-PROPERTIES.md` | Supporting design — mostly current; specific drifts flagged in §B. |

## Status dashboard (reconciled vs code)
| Subsystem (section) | Behaviors | Implemented | Partial | Planned/Not-built | Contradicted / Known-bug |
|---------------------|-----------|-------------|---------|-------------------|--------------------------|
| A — Placement engine | 23 | 21 | 1 | — | 1 (weather fail-open) + 3 doc-drift gaps |
| B — Recurring lifecycle | 24 | ~20 | ~2 | master/instance UPSERT redesign | 2 (dual-missed logic, delete-instance) + doc drift |
| C — Overdue / forward-roll | 16 | 9 (main) | 2 | 999.801 reconcile | 3 WIP-ungated + 1 BLOCK on `60835fe` |
| D — Persistence / read model | 21 | 18 | 2 (slack_mins, W4 cache) | W2 partition (NOT built) | 1 (slack_mins dropped) |
| E — Calendar sync coupling | 19 | 16 | 1 | — | 1 known-bug (split-part) + contention |
| F — In-flight / gaps | inventory | — | — | W2, W4, L4, 999.801 | ~25 untested sub-reqs |

## ✅ LOCKED DECISIONS (David, 2026-06-23)
| # | Topic | Ruling |
|---|-------|--------|
| D4+D5 | Foundation sequencing | **Build W2 foundation FIRST** (overdue↔unscheduled partition + FIXED anchor + preserve-prior-placement), THEN forward-roll/effective-deadline overdue on top (fold in WIP `60835fe`). |
| D1 | "missed" rule | **Period-boundary only.** Delete the legacy 2h/24h `isTaskMissed`/`shouldAutoMarkMissed` (verify no live caller first). |
| D2 | Delete one occurrence | **Soft-skip** (`status='skip'`, keep tombstone). Fix `DeleteTask.js` instance scope to match spec+test. |
| D3 | Weather lookup fails | **Fail-closed** — hold the task unplaced. Fix code to match R11.10/R38.1. |
| D7 | `slack_mins` | **Persist it** + dampen rewrite-churn (write only on meaningful change). |
| D6 | Split-part sync + cache | **Fix, HIGH priority** — persist per-split-part rows → cal-sync pushes 1 event/chunk → remove `schedule_cache` write (W4). One leg. |
| D8 | Chain-rollback pass | **Confirmed dropped** — keep place-what-fits/rest-unplaced; delete the stale rollback doc. |

### Locked work sequence
1. **W2 foundation** — overdue↔unscheduled+placed partition, FIXED anchor, preserve-prior-placement (the load-bearing piece D4/D5/D1 depend on; fold the D1 missed-rule cleanup here).
2. **Forward-roll + effective-deadline overdue** — on top of W2; fold in WIP `60835fe`; fix the period-end-cap BLOCK + window-close/time_flex=0 WARNs.
3. **Split-part persistence** (D6, HIGH) — per-split-part rows → cal-sync fix + `schedule_cache` removal.
4. **Cleanup batch** — D2 soft-skip, D3 weather fail-closed, D7 slack persist, D8 delete stale doc.

Each step: spec the behavior precisely → encode in tests → run → fix to green (TDD).

## ⚠️ Contradictions + decisions (RESOLVED above — detail kept for context)
These are where code/docs/designs disagree, or where a load-bearing piece is unbuilt. Each needs a
ruling before the scheduler is internally consistent.

- **D1 — Dual "missed" logic (§B).** `shared/scheduler/missedHelpers.js` ships BOTH the canonical
  period-boundary `computeRecurringDeadline` AND legacy fixed 2h/24h `isTaskMissed` /
  `shouldAutoMarkMissed` that ignore the recurrence cycle and disagree with the Phase-9 ladder.
  → **Decision:** retire the legacy 2h/24h path (confirm no live caller) so one rule governs "missed".
- **D2 — Delete-instance: hard-delete vs soft-skip (§B).** SCHEDULER-RULES.md + the VERIFIED R32.5
  test say delete-of-instance = soft-skip (`status='skip'`); `DeleteTask.js scope=instance` does a
  hard row delete. → **Decision:** which is intended? (affects dedup + history).
- **D3 — Weather gating fail-open vs fail-closed (§A).** Code fails OPEN (places anyway on weather-API
  failure); requirement R11.10/R38.1 says fail-CLOSED. → **Decision:** product call.
- **D4 — Overdue forward-roll (§C, WIP `60835fe`).** Today's fix is built but ungated: 1 BLOCK
  (period-end cap bleeds into the next cycle — must be `anchor+cycleLen-1`, applied unconditionally) +
  3 WARNs (window-close should use `preferred_time_mins` not placed slot; `time_flex==0` distinct from
  null; duplicated `isFlexibleTpc` classifier). It overlaps **999.801** (recurrence-period auto-missed
  reconcile) and **DB-single-source W2**. → **Decision:** finish + fold into this spec as one coherent
  requirement (recommended), don't ship the partial.
- **D5 — W2 partition NOT BUILT (§D/§F) — load-bearing.** The deadline-based OVERDUE↔UNSCHEDULED
  partition + FIXED-anchor + preserve-prior-placement (DB-single-source W2) is the core scheduler change
  the overdue work depends on, and it is **not built**. → **Decision:** sequence W2 before/with the
  forward-roll fix.
- **D6 — W4 `schedule_cache` + split-part sync (§D/§E).** `schedule_cache` write still has ONE reader
  (cal-sync); full removal blocked on persisting per-split-part placements as first-class rows — the
  same gap that makes **split-part calendar sync a KNOWN-BUG (CAL-16, `reconcileSplitsForUser`
  unwired)**. → **Decision:** one leg fixes both (persist per-split-part rows → cal-sync reads them →
  drop the cache).
- **D7 — slack_mins dropped on persist (§D).** Materialized + computed + read, but the batched persist
  silently drops it → read consumers see stale/NULL slack. → **Decision:** persist it or stop reading it.
- **D8 — chain-rollback pass (§A).** SCHEDULER.md §4c-5 documents a reverse-topological chain-rollback
  pass that does not appear to exist in v2. → **Decision:** confirm dropped-by-design or restore.

## Planned / not-built roadmap (consolidated — so nothing is orphaned)
| Item | Source | Status | Note |
|------|--------|--------|------|
| Recurring forward-roll + effective-deadline overdue | leg `60835fe` (this session) | **WIP, ungated** | finish D4; biggest unmerged payload — don't lose it |
| DB-single-source **W2** (overdue↔unplaceable partition, FIXED anchor, preserve-prior) | ARCH-DB-SINGLE-SOURCE | **NOT BUILT** | load-bearing (D5) |
| DB-single-source **W4** (remove `schedule_cache` write) | ARCH-DB-SINGLE-SOURCE | **PARTIAL/blocked** | needs per-split-part persistence (D6) |
| **999.801** recurrence-period implied-due + R32.4 auto-missed reconcile | overdue-lifecycle design | **partial** | overlaps `60835fe` |
| Split-part calendar sync (`reconcileSplitsForUser` wiring) | §E CAL-16 | **KNOWN-BUG** | couples to W4 (D6) |
| Master/instance **UPSERT + drop-refabricate-on-edit** | master-instance redesign | **absent (~40% substrate built)** | re-INSERTs every run today |
| **L4 adaptive interval** (R54) | master-instance redesign | **deferred** | own milestone |
| ~25 untested sub-reqs (R37 earliest-start, R40 FlexWhen, R34.5 TPC spacing, R19/R35 split) | §F / MISSING-REQ report | **untested** | coverage backlog |

---
_Detailed per-behavior catalogs follow (Sections A–F). Each row: behavior · code file:line · status ·
tests · source · notes._

---

# SECTION A — Juggler Placement Engine (authoritative spec)

> Scope: the core placement algorithm (R11 family) — slack-sorted single-pass placement,
> the 6 placement modes, the 7-phase model, the 4-level fallback ladder, when-tags/when-windows,
> time blocks, slack computation, split chunks, and slot search.
> Reconciled against **actual code** (juggler submodule, main tree HEAD as of 2026-06-23),
> not just docs. All file:line citations are to `juggler/juggler-backend/`.

## Orientation — what is actually live

The live placement core is **`src/scheduler/unifiedScheduleV2.js`** (2390 lines).
- Entry chain: `routes/schedule.routes.js:39` → `runScheduleAndPersist` (facade, sourced from `src/scheduler/runSchedule.js`) → `RunScheduleCommand` → `unifiedScheduleV2(allTasks, statuses, todayKey, nowMins, cfg)` at `unifiedScheduleV2.js:1493`.
- `unifiedSchedule.js` is a one-line re-export shim; `scoreSchedule.js`, `timeBlockHelpers.js`, `dependencyHelpers.js`, `dateHelpers.js`, `locationHelpers.js` are thin re-export barrels. The pure logic lives in `src/slices/scheduler/domain/` (H6 hex migration, golden-master verified byte-identical) and in `shared/scheduler/*`.
- The cache-version hash (`constants.js`) is computed over `unifiedScheduleV2.js`, `runSchedule.js`, `reconcileOccurrences.js`, and `shared/scheduler/expandRecurring.js` — these four files are the canonical placement surface.

**Doc map (the prompt's doc names were mostly wrong paths — corrected here):**
- `docs/architecture/SCHEDULER.md` — canonical design doc, but its "Phase 0–5" model is the **v1 design reference, NOT current behavior** (officially flagged as contradiction C2; see GAP-1).
- `docs/architecture/SCHEDULER-RULES.md` §3.1 — **authoritative** 7-phase table for v2.
- `docs/SCHEDULER-VISUAL.md` (999.008) — visual walkthrough: 7 phases, 4-level ladder, 6 modes, slack-sorted single pass.
- `docs/SCHEDULER-TRACEABILITY-REPORT.md` — R11.x requirement IDs + test status.
- `docs/TASK-CONFIGURATION-MATRIX.md` — per-mode behavior matrix.
- `docs/architecture/SCHEDULER-OVERDUE-LADDER.md` — overdue ladder detail.
- There is **no** `REQUIREMENTS.md`, `SCHEDULER-RULES.md`, or `SCHEDULER.md` at `docs/` root, and **no `R11.x` defined anywhere as a numbered requirement spec** — the R11.x IDs appear only in the traceability report and in code comments (see GAP-2).

---

## Behaviors

### [PLACE-MODES] Exactly 6 placement modes; `placement_mode` is the primary routing switch
- **Code:** `src/lib/placementModes.js:15-22` — `PLACEMENT_MODES = { REMINDER:'reminder', ALL_DAY:'all_day', FIXED:'fixed', TIME_WINDOW:'time_window', TIME_BLOCKS:'time_blocks', ANYTIME:'anytime' }`. Consumed in `unifiedScheduleV2.js:65` and routed in `buildItems` (`:236`) where `var pm = t.placementMode || PLACEMENT_MODES.ANYTIME` (`:250`) is the default fallback.
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/placementModes.test.js`, `tests/unit/derivePlacementMode.test.js`, `tests/unit/placement-mode-migration.test.js`
- **Source:** `placementModes.js`; SCHEDULER-RULES.md §1; TASK-CONFIGURATION-MATRIX.md:29; SCHEDULER-VISUAL.md §4
- **Notes:** Values match the `task_masters.placement_mode` ENUM (migration `20260518000100`). The redesign (D-01..D-04) renamed `MARKER→REMINDER`, split `FLEXIBLE→ANYTIME/TIME_WINDOW/TIME_BLOCKS`, and dropped `PINNED_DATE`, `RECURRING_RIGID/WINDOW/FLEXIBLE` (recurrence is orthogonal — driven by the `recurring` boolean, not by mode). `'fixed'`/`'allday'` tokens are no longer stored in the `when` column.

### [PLACE-MODE-FIXED] `fixed` — immovable, anchored at exact time
- **Code:** `buildItems` `unifiedScheduleV2.js:317` (`fixed = pm===FIXED && !t.recurring`), `:587` (`isRigid`), `:646-648` (`eligibleWindows` returns the single anchor slot `[anchorMin, anchorMin+dur]`). Placed in Phase 0 via `tryPlaceAtTime` (`:803`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/placementModes.test.js`, `tests/scheduler/bug-odin-fixed-anchor-scheduledAt.test.js`
- **Source:** SCHEDULER.md §4a; SCHEDULER-RULES.md §3.1 (Phase 0)
- **Notes:** `placement_mode='fixed'` is the **sole** immovability signal — `date_pinned` was removed (contradiction C6: SCHEDULER.md still mentions `date_pinned`; v2 code wins). `fixed` without date+time → backend 400 on create (SCHEDULER-RULES.md:87).

### [PLACE-MODE-ANYTIME] `anytime` — no time constraint, Infinity slack, floats
- **Code:** `buildItems:629` (`pm===ANYTIME` gating `preferLatestSlot`), `eligibleWindows` falls through to `getWhenWindows('anytime'|item.when)` (`:660-662`). No deadline ⇒ `computeSlack` returns `Infinity` (`:708`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/placementModes.test.js`, `tests/schedulerScenarios.test.js`
- **Source:** SCHEDULER.md §4a; TASK-CONFIGURATION-MATRIX.md:66
- **Notes:** Recurring `anytime` whose anchor minute has already passed *today* sets `preferLatestSlot=true` (`:627-628`) → uses `findLatestSlot` so it lands later in the day rather than failing.

### [PLACE-MODE-TIME_WINDOW] `time_window` — placed at/after `preferredTimeMins`, not window start
- **Code:** `buildItems:427` (`isWindowMode = pm===TIME_WINDOW`), `eligibleWindows:655-656` returns `[[windowLo, windowHi]]`. Slot search in `findEarliestSlot:1142-1162`: tries `prefStart = max(winStart, preferredTimeMins)` first (`:1146-1149`), then a **fallback** loop over the earlier range `[winStart, prefStart)` only if the preferred-and-later range is fully booked (`:1158-1162`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/preferred-time-placement.test.js`, `tests/scheduler/placementModesTimeWindowToReminder.test.js`
- **Source:** SCHEDULER.md §4a; SCHEDULER-RULES.md §10
- **Notes:** `windowLo = max(DAY_START, preferredTimeMins - timeFlex)`; DAY_START clamping can pull `winStart` to 06:00 even when `preferredTimeMins` is later — which is exactly why the search must start from `preferredTimeMins`. `time_window` with `preferred_time_mins` outside `GRID_START..GRID_END` → silent fallback to `when`-tag logic (SCHEDULER-RULES.md:89; flagged as needing validation).

### [PLACE-MODE-TIME_BLOCKS] `time_blocks` — constrained to user `when`-tag windows
- **Code:** `eligibleWindows:660-663` → `getWhenWindows(item.when, dayWindows[dateKey])` (from `shared/scheduler/timeBlockHelpers.js`). Uses `flexWhen` for retry (`tryPlaceQueued` ladder pass 3).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/placementModes.test.js`, `tests/unit/flex-when-edge-cases.test.js`
- **Source:** SCHEDULER.md §4a; TASK-CONFIGURATION-MATRIX.md:68
- **Notes:** `when` column holds only user-defined tag names (`morning`, `lunch`, `evening`, …) post Phase-9 migration. Orphaned when-tag (no matching block) → reassigned to anytime with a warning (UC-16.11).

### [PLACE-MODE-ALL_DAY] `all_day` — excluded from the minute grid
- **Code:** `buildItems:263` (`if (pm===ALL_DAY) return;` early return), `:583` (`isAllDay`), `eligibleWindows:649-650` returns `[[DAY_START, DAY_END]]` for the rare grid path.
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/placementModes.test.js`; cal-sync adapters `tests/cal-sync/0{1,2,3}-adapter-*.test.js`
- **Source:** SCHEDULER.md §4a; TASK-CONFIGURATION-MATRIX.md:54
- **Notes:** Does not consume minute-level capacity; rendered as a full-day banner. Calendar adapters (Apple/MSFT/GCal) set `ALL_DAY` for all-day events.

### [PLACE-MODE-REMINDER] `reminder` — placed at exact time, zero occupancy
- **Code:** `buildItems:251` (`isMarker = pm===REMINDER`), emitted as a marker (`:765`, `:769-770`). `dur=0`, multiple reminders at the same minute do not conflict. If anchored → `tryPlaceAtTime`; if unanchored → enters the slack queue with `dur=0` and lands at the earliest eligible window slot.
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/placementModes.test.js`, `tests/scheduler/placementModesTimeWindowToReminder.test.js`
- **Source:** SCHEDULER.md §4a; TASK-CONFIGURATION-MATRIX.md:53,76
- **Notes:** Was `MARKER` before the redesign.

---

### [PLACE-ALGO] Single-pass slack-sorted placement (replaces v1's phase model)
- **Code:** `unifiedScheduleV2.js` header (`:4-11`): "Single-pass placement driven by slack: `(slack asc, pri asc, dur desc, id)`. Replaces v1's six-phase model with one ordered queue." Main loop builds `queue`, calls `queue.sort(compareItems)` (`:1835`) then iterates calling `tryPlaceQueued` per item (`:1850+`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/slices/scheduler/domain/solvers.test.js` (compareItems / slack ordering), `tests/schedulerScenarios.test.js`, golden-master `tests/characterization/scheduler/goldenMaster.*`
- **Source:** SCHEDULER-RULES.md §3 ("v2 is a single-pass algorithm with logical sections, not v1's numbered phases"); SCHEDULER-VISUAL.md §5
- **Notes:** The grid (`dayOcc`) accumulates across the loop; **overlaps are prevented, not resolved** — occupied minutes are simply skipped, no eviction (design decision 2026-04-27, closes GP-3/CL-2).

### [PLACE-SORT] Queue comparator = slack asc, priority asc, duration desc, id asc
- **Code:** `compareItems` = `ConstraintSolver.compareItems` (`unifiedScheduleV2.js:1403`; impl `src/slices/scheduler/domain/logic/ConstraintSolver.js:168-189`). Order: slack ascending (null/Infinity sentinel to the end — `sa = a.slack==null?0:a.slack`, `:170-171`), then priority ascending, then duration descending, then `id`. Re-sorted each iteration to absorb incremental slack updates (`:1835`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/slices/scheduler/domain/solvers.test.js`
- **Source:** SCHEDULER.md §4c-2; SCHEDULER-RULES.md:156; ConstraintSolver.js:160-166
- **Notes:** "Deadlines drive, priority tie-breaks" — a P3 due Thursday beats a P1 with no deadline because the deadline gives finite slack vs Infinity. Comment claims the port is **byte-identical** to the legacy `unifiedScheduleV2.compareItems`.

### [PLACE-SLACK] Slack = available capacity in [earliest..deadline] − duration; Infinity if no deadline
- **Code:** `computeSlack` `unifiedScheduleV2.js:706-720`. `if (!item.deadlineDate) return Infinity` (`:708`); else `capacityInRange(item, dates, earliestIdx, deadlineIdx, ...) - item.dur` (`:718-719`). `capacityInRange` (`:668`) sums free minutes across eligible windows clamped by occupancy. `earliestStartDate` shifts `earliestIdx` forward (`:711-714`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/deadlines.test.js`, `tests/unit/capacity-offset.test.js`, `tests/unit/earliest-start-edge-cases.test.js`, `tests/slices/scheduler/domain/solvers.test.js`
- **Source:** SCHEDULER.md §4c-1; SCHEDULER-RULES.md §10
- **Notes:** Past-due tails get `slack=0` + P1 boost. Slack is incrementally maintained (`other.slack = other.capacity - other.dur`, `:1941`) rather than recomputed from scratch, using `overlapWithEligibleWindows` (`:726`) for cheap capacity subtraction. SCHEDULER.md §4c says slack is computed "once after Phase 1" — the v2 code instead re-derives the queue each iteration (PARTIAL doc match; behaviorally equivalent ordering).

### [PLACE-LADDER] 4-level placement fallback ladder (`tryPlaceQueued`)
- **Code:** `tryPlaceQueued` `unifiedScheduleV2.js:1308-1361`. Attempts, in order: (1) **normal** — respect deadline + declared `when` (`:1328`); (2) **`ignoreDeadline`** if `slack<0` → place overdue (`:1331-1335`); (3) **`relaxWhen`** if `flexWhen` → relax `when` to `anytime` (`:1337-1341`); (4) **both** if `slack<0 && flexWhen` (`:1343-1347`). `findSlot = item.preferLatestSlot ? findLatestSlot : findEarliestSlot` (`:1326`).
- **Status:** IMPLEMENTED — but **PARTIAL vs doc** (see Notes)
- **Tests:** **NONE dedicated** — R11.6 ("4-level fallback ladder normal→overdue→flexWhen→both") is listed in SCHEDULER-TRACEABILITY-REPORT.md §"Requirements with NO tests at all" (P1). Indirect coverage via `tests/unit/flex-when-edge-cases.test.js`, `tests/scheduler/recurring-fixed-fallback.test.js`, `tests/unit/scheduler/unplacedReasonScenarios.test.js`.
- **Source:** SCHEDULER-RULES.md §3.2; SCHEDULER-VISUAL.md §3; SCHEDULER-OVERDUE-LADDER.md:26-33
- **Notes/contradictions:**
  - The ladder is nominally "4-level" but the code has a **5th rescue attempt** at `:1352-1356`: if `preferLatestSlot`, a final `findLatestSlot` + `relaxWhen` pass runs so a past-window recurring flexible task stays visible. This 5th rung is **undocumented** in the §3.2 4-level table (GAP-3).
  - SCHEDULER-RULES.md §3.2 cites stale source lines `unifiedScheduleV2.js:1037-1079`; the actual `tryPlaceQueued` is at `1308-1361` (doc line drift; GAP-4).
  - Flags set: pass 2 → `_overdue`; pass 3 → `_whenRelaxed`/`relaxed`; pass 4 → both.
  - **Disambiguation (leg juggy4, 2026-07-02):** this ladder (`tryPlaceQueued`'s 4/5 passes, run *inside* the main queue loop) is **unaffected** by juggy4 and remains exactly as documented above. The behavior juggy4 changed lives in the **post-loop rescue passes** — Phase 4 `missedWindowItems` / Phase 5 `pastAnchoredRecurrings`, documented under [PLACE-PHASES] below — which is a separate mechanism that runs *after* an item has already exhausted this ladder (and, for Phase 5, items that were pre-routed to `pastAnchoredPreQueue` and never entered this ladder at all). Do not conflate the two "ladders."

### [PLACE-PHASES] 7-phase execution model (logical sections of the single pass)
- **Code:** `unifiedScheduleV2.js:1172-1778` (per SCHEDULER-RULES.md §3.1 source cite). The "phases" are logical sections of one pass over a shared `dayOcc`:
  - **Phase 0 — Immovables:** `fixed`, rigid-recurring-with-anchor, anchored markers → `tryPlaceAtTime` (`:803`). Exempt from reset. Pre-placed before the queue (`:1642+`).
  - **Phase 1 — Queue (main loop):** all other items, slack-sorted, `tryPlaceQueued` 4-level ladder (`:1835`+).
  - **Phase 2 — Retry:** items deferred for unmet deps (`_deferred`) get one retry pass (`:2131-2162`, `captureSnapshot('retry_done')` `:2162`).
  - **Phase 3 — Missed preferred-time:** recurring non-TIME_WINDOW whose flex window passed → marked `missed`, unplaced.
  - **Phase 4 — Missed window:** TIME_WINDOW whose flex window is entirely past → routed to `unplaced` only, **never** grid-placed (`unifiedScheduleV2.js:2362-2378`). **SUPERSEDED (leg juggy4, 2026-07-02):** previously (when-block-anchor branch of commit `9bb62bb`) dual-placed on grid with `_overdue=true` **and also** listed unplaced, with no `dayOcc`/`reserveWithTravel` occupancy check — two unrelated overdue tasks could land at the identical date+start (repro in `.planning/kermit/juggy4/INTAKE-BRIEF.json`). Product ruling (David, 2026-07-02) now matches the pre-existing Phase 3 `missedPreferredTimeItems` precedent: no grid entry, period. Persisted end-state depends on the DB row's prior `scheduled_at` (`runSchedule.js:1907-1987` §8) — see the amended note on [PLACE-RECUR-NOROLL] below.
  - **Phase 5 — Past-anchored recurring:** recurring with `anchorDate < today` → routed to `unplaced` only, pinned to its own past anchor date, **never** grid-placed (`unifiedScheduleV2.js:2387-2398`). **SUPERSEDED (leg juggy4, 2026-07-02):** previously force-placed at a synthesized start (`paStart` falling back to `0` when neither `preferredTimeMins` nor `anchorMin` was set) with no occupancy check — same collision class as Phase 4's old behavior.
  - **Phase 4/5 overdue split chunks:** every incomplete chunk of an overdue split-task master routes through Phase 4/5 into `unplaced` **individually** — no scheduler-level collapse to one representative (`unifiedScheduleV2.js:2400-2425`, `overdueRescueItems.forEach → stillUnplaced.push`). A backend-side collapse (grouping by `masterId`, one representative row, summed `dur`) was attempted and **reverted** in the same leg (ernie E1 BLOCK: it silently dropped sibling chunks — `splitOrdinal>=2` — from `result.unplaced`, landing them in `scheduled_at=NULL`/`unscheduled=NULL` limbo, a NEVER-MISSING violation). Per-chunk DB rows are never merged/deleted (ruling 999.841). The "one displayed task" UX is achieved entirely at the **display** layer by the pre-existing `DailyView.jsx:282-288` grouping (`splitGroup`/`sourceId`+date, `_unplacedChunkCount` badge; moved from :995-1007 by the 999.965 DailyView decomposition — badge rendered in `DailyViewUnschedEntry.jsx`) — no scheduler or backend change was needed for that part. See [PLACE-SPLIT] below.
  - **Phase 6 — Rigid forced:** still-unplaced fixed/rigid → force-placed at anchor with `_conflict=true, locked=true` (overlaps existing occupancy; last resort). **Unchanged by juggy4** — deliberately out of scope (Kermit determination log: David's ruling names recurring+split tasks only; Phase 6's deliberate-overlap design for rigid/fixed tasks is separate).
  - **Phase 7 — Deadline relaxed:** deadline ≤ today + unmet deps → placed ignoring deps + deadline (`relaxedEnv = {relaxDeps:true, ignoreDeadline:true}` `:2336-2339`) as the absolute last resort.
- **Status:** IMPLEMENTED (authoritative model is SCHEDULER-RULES.md §3.1 / SCHEDULER-VISUAL.md §2)
- **Tests:** **R11.5 "7-phase execution proof" has NO test** (SCHEDULER-TRACEABILITY-REPORT.md, P1). Per-phase behaviors covered piecemeal across `tests/scheduler/*`.
- **Source:** SCHEDULER-RULES.md §3.1; SCHEDULER-VISUAL.md §2
- **Notes/contradictions:** Two different "phase" enumerations exist — see GAP-1. SCHEDULER-VISUAL labels Phase 0–7 (8 labels) but calls it "7 phases." Phases 3–7 are **rescue/overflow passes** that run *after* the main loop, not the per-priority fills the old SCHEDULER.md "Phase 3/4/5" described.

### [PLACE-SLOT-EARLIEST] `findEarliestSlot` — forward scan, earliest fitting slot ≤ deadline
- **Code:** `findEarliestSlot` `unifiedScheduleV2.js:966-1185`. Caps `latestIdx` at deadline unless `ignoreDeadline` (`:973-975`). Per-day: `eligibleWindows` (`:1133`), then 15-minute step scan `for (s=prefStart; s+dur<=winEnd; s+=15)` (`:1149`), checking `isFreeWithTravel`, tool/location (`canTaskRunAtMin` cached), weather, and the dependency floor. Can `extendDatesTo` for infinite-slack non-recurring tasks past the initial horizon (`:1082`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/deadlines.test.js`, `tests/scheduler/dependencies.test.js`, `tests/scheduler/earliestStart.test.js`, `tests/scheduler/preferred-time-placement.test.js`
- **Source:** SCHEDULER.md §4c-3; SCHEDULER-RULES.md §10
- **Notes:** 15-minute slot granularity (`s += 15`). On total failure, calls `populateFailDiag` (`:1186`) to attribute `_unplacedReason` (tool_conflict / location_mismatch / no_slot).

### [PLACE-SLOT-LATEST] `findLatestSlot` — reverse scan for `preferLatestSlot` (past-anchor recurring)
- **Code:** `findLatestSlot` `unifiedScheduleV2.js:1216-1306`. Mirror of earliest but walks latest-first. Only reached when `item.preferLatestSlot` (set for ANYTIME recurring whose anchor passed today — `:1213-1214`). TIME_WINDOW never sets `preferLatestSlot`.
- **Status:** IMPLEMENTED
- **Tests:** indirect via `tests/scheduler/recurring-fixed-fallback.test.js`, `tests/scheduler/preferred-time-placement.test.js`
- **Source:** SCHEDULER-RULES.md §3.1 (Phase 5); code comment `:1213`
- **Notes:** Keeps a past-due flexible recurring visible later the same day instead of failing.

### [PLACE-DEPFLOOR] Dependency-ready floor (`computeDepReadyAbs` / `depReadyAbs`), scan-constant (A-001)
- **Code:** `computeDepReadyAbs` `unifiedScheduleV2.js:894`. Returns max absolute end-minute across live (pending, non-terminal) deps; `-Infinity` if none, `Infinity` if any live dep is itself unplaced (→ item deferred). Both `findEarliestSlot` and `findLatestSlot` hoist `depReadyAbs` **once per scan** (`:1023-1024`, `:1240-1241`); each slot does O(1) `absoluteMin(date,slot) < depReadyAbs → skip`. Exported under `module.exports._testOnly` (`:2387`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/dependencies.test.js`, `tests/scheduler/depsGatingCharacterization.test.js`, `tests/scheduler/bug815-cancelled-dep-gating.test.js`, `tests/unit/scheduler-core-gaps.test.js`
- **Source:** SCHEDULER.md §4c-3 "Dependency-ready floor"; supersedes the old per-day `depsMetByDate` boolean
- **Notes:** **Scan-constancy invariant A-001:** within a single scan `placedById`/`statuses` are read-only snapshots; placements are written by the caller after the scan returns. SCHEDULER.md cites historical line numbers (`:788`, `:923`, `:1066`) that have drifted from the current file (`computeDepReadyAbs` is at `:894`) — doc line drift (GAP-4).

### [PLACE-RETRY] Retry pass for dep-deferred items
- **Code:** `unifiedScheduleV2.js:2131-2162`. `retryQueue = unplaced.filter(u => u._deferred)` (`:2137`); re-runs `tryPlaceQueued`-equivalent placement now that deps may have settled; emits `'V2: Retry'` step records (`:2159`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/dependencies.test.js`, `tests/scheduler/depsGatingCharacterization.test.js`
- **Source:** SCHEDULER.md §4c-4; SCHEDULER-RULES.md §3.1 (Phase 2)
- **Notes:** Needed for diamond DAGs where slack-sort order doesn't match topo order. Chain rollback (SCHEDULER.md §4c-5, reverse-topological re-place) is documented but **not clearly present as a distinct routine in v2** — see GAP-5.

### [PLACE-WHEN] When-tags → when-windows resolution
- **Code:** `eligibleWindows` `unifiedScheduleV2.js:644-663` → `getWhenWindows(whenExpr, dayWindows[dateKey])` from `shared/scheduler/timeBlockHelpers.js` (re-exported via `src/scheduler/timeBlockHelpers.js`). Day windows built by `buildWindowsFromBlocks`; blocks resolved per-date by `getBlocksForDate`. `relaxWhen=true` substitutes `'anytime'` for the task's `when` (`:660`), and for TIME_WINDOW it also bypasses `isWindowMode` (`:655`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/placementModes.test.js`, `tests/unit/flex-when-edge-cases.test.js`
- **Source:** SCHEDULER.md §4a-4b; SCHEDULER-RULES.md §1, §10
- **Notes:** Default time blocks in `constants.js` (`DEFAULT_WEEKDAY_BLOCKS`/`DEFAULT_WEEKEND_BLOCKS`: morning/lunch/afternoon/evening/night with start/end minutes + location). `flexWhen` works alongside any mode (SCHEDULER-RULES.md §10).

### [PLACE-TIMEBLOCKS] Time blocks define capacity windows per day-of-week + location
- **Code:** `constants.js` `DEFAULT_TIME_BLOCKS` (Mon–Fri = weekday, Sat/Sun = weekend); each block `{id, tag, name, start, end, color, icon, loc}`. `getBlocksForDate(key, timeBlocks, cfg)` resolves per date (`unifiedScheduleV2.js:203`); `buildWindowsFromBlocks` → eligible `[start,end]` ranges; block also carries `loc` for location/tool gating.
- **Status:** IMPLEMENTED
- **Tests:** `tests/schedulerScenarios.test.js`, `tests/schedulerRules.test.js`; characterization `goldenMaster.a002-location.test.js`
- **Source:** SCHEDULER.md §4a; constants.js
- **Notes:** Location resolves per minute from the block's `loc`; missing minutes fall back to time-block loc (UC-19.8). Block tags are the `when` vocabulary for TIME_BLOCKS mode.

### [PLACE-SPLIT] Split chunks — one task becomes N independent rows competing individually
- **Code:** Pre-split ordinals are distinct DB rows treated as one-offs carrying the original's priority/deadline (`unifiedScheduleV2.js:24`, `:52` doc). Inline split for `t.split===true` without ordinals: `placeSplitInline` (`:1416`) greedily places chunks ≥ `splitMin` until duration is covered. Recurring splits capped to the cycle window `anchor + cycleDays − 1` (`:1412-1414`); non-recurring splits may span days up to the deadline. Travel buffers: only the first chunk carries `travelBefore` (`:414-416`). Split chunks are **NOT day-locked** (`:567-572`, `splitTot>1` excludes day-lock).
- **Status:** IMPLEMENTED
- **Tests:** `tests/scheduler/splitInteractions.test.js`, `tests/scheduler/split-containment-edges.test.js`
- **Source:** SCHEDULER.md §"Split chunks"; SCHEDULER-RULES.md §"Spacing"; closes 999.098/999.547
- **Notes:** Unplaced remainder → `_unplacedReason = PARTIAL_SPLIT` + human detail (`:1871`, R11.16/AC2.7). R19.4–R19.7 (rigid split day-lock, cross-day non-recurring, first/last-ordinal travel buffers, `partial_split` flag) and R35.3/R35.5/R35.6 are all listed as **having NO dedicated tests** (P1) in SCHEDULER-TRACEABILITY-REPORT.md (GAP-6).
- **Overdue split chunks (leg juggy4, 2026-07-02):** once a recurring split task's flex window/anchor has passed, EACH incomplete chunk (pre-split-ordinal DB row) is routed individually through the Phase 4/5 rescue passes into `unplaced` — `unifiedScheduleV2.js:2400-2425` (`overdueRescueItems.forEach(item => stillUnplaced.push(item))`). There is **no scheduler-level grouping/collapse** by `masterId`/`sourceId` for this path (unlike the non-overdue split-overflow reason-tagging pass at `:2125-2294`, which does group by `p.task.sourceId || p.task.master_id`). A collapse-to-one-representative design (summed `dur`, lowest-`splitOrdinal` representative) was implemented and then **reverted** after ernie's re-review (E1 BLOCK): it dropped sibling chunks (`splitOrdinal>=2`) out of `result.unplaced` entirely, so `runSchedule.js` §8 never wrote them a terminal `placed|overdue|unscheduled` state — a NEVER-MISSING violation. Completed chunks are excluded upstream (buildItems status guard) and never reach this path. Per-chunk DB rows are always separate rows, never merged/deleted — **ruling 999.841**. The single-displayed-task UX David asked for is produced entirely by the existing **display-layer** grouping in `DailyView.jsx:282-288` (groups by `splitGroup`/`sourceId`+date, shows a `_unplacedChunkCount` badge — rendered by `DailyViewUnschedEntry.jsx`; moved from :995-1007 by the 999.965 decomposition) — this pre-existed the leg and required no scheduler or persistence change.

### [PLACE-UNPLACED] Every real placement failure produces an `_unplacedReason` (R11.16)
- **Code:** `populateFailDiag` (`:1186`) sets `failReason`/`failDetail` on a first-pass-wins basis; `tryPlaceQueued` returns `{slot:null, failReason, failDetail}` (`:1361`); `applyPlacementFailReason` (`:1374`) attributes the reason with precedence (partial_split → weather → FR1 diagnostic → `no_slot` floor). Reason codes: `tool_conflict`, `location_mismatch`, `no_slot`, `partial_split`, `weather`, `missedRecurring`.
- **Status:** IMPLEMENTED
- **Tests:** `tests/unit/scheduler/unplacedReasonScenarios.test.js`, `tests/unit/scheduler/placementDiagnostics.test.js`
- **Source:** code FR1/FR2 comments; AC2.1/AC2.3/AC2.4/AC2.7; R11.16
- **Notes:** This fixed the "Submit Weekly UI Claim" silent-unplaced symptom (tool_conflict: `personal_pc` not available where/when the day resolves). R11.16 holds for ALL paths (`no_slot` defensive floor).

### [PLACE-WEATHER] Weather gating is fail-OPEN (code) vs fail-CLOSED (requirement)
- **Code:** `weatherOk(task, dateKey, startMin, weatherByDateHour)` (`:920`) called per candidate slot inside `findEarliestSlot`; `hasWeatherConstraint` (`:912`). Cache miss → fail-open for that slot.
- **Status:** **CONTRADICTED** — requirement says fail-closed; code is fail-open.
- **Tests:** PARTIAL (R11.10, R39.5 flagged "Weather fail-open vs fail-closed", P1, gap exists).
- **Source:** SCHEDULER.md §Weather "Fail-open rule"; SCHEDULER-TRACEABILITY-REPORT.md R11.10/R39.5; SCHEDULER-RULES.md C-row
- **Notes:** Documented divergence; the doc explicitly notes the requirement wanted fail-closed but the implementation fails open to avoid blocking all placement on a weather-cache miss.

### [PLACE-OVERLAP] Overlap prevention, not eviction
- **Code:** `dayOcc` occupancy grid blocks already-placed minutes; `isFreeWithTravel` skips occupied slots. No post-placement pile-up resolution. Phase 6 "Rigid forced" is the **only** path that deliberately overlaps (with `_conflict=true, locked=true`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/schedulerScenarios.test.js`, golden-master suite
- **Source:** SCHEDULER.md §5 (design decision 2026-04-27, GP-3/CL-2)
- **Notes:** Original spec described eviction; implementation chose prevention to avoid churn of user-confirmed placements.

### [PLACE-RECUR-NOROLL] Recurring past-due instances do NOT roll forward
- **Code:** Phase 3/4/5 mark missed recurrings unplaced (`missedRecurring`) on their assigned day only; no next-day attempt. tpc-flexible templates (count < allowed-days) slide within the cycle window by design (`isFlexibleTpc`, `:572`).
- **Status:** IMPLEMENTED
- **Tests:** `tests/unit/tpc-competition.test.js`, `tests/unit/tpc-spacing-guard.test.js`, `tests/scheduler/recurring-fixed-fallback.test.js`, `tests/scheduler/overdue-unscheduled-pinning.test.js` (new, leg juggy4), `tests/scheduler/roamable-recurring-forward-roll.test.js` (assertions revised, leg juggy4 — AC2a/AC2c/AC6a re-pinned from grid-pin `_overdue:true` to unscheduled-overdue)
- **Source:** SCHEDULER.md §8 Rule 2; SCHEDULER-RULES.md §4.3
- **Notes:** Rationale: rolling forward double-books and erodes habit cadence. Recurring expansion horizon = `today + RECUR_EXPAND_DAYS` (14 days, `constants.js`); beyond-horizon pending instances are grandfathered.
- **Still accurate after leg juggy4 (2026-07-02) — no-roll holds, but the destination lane changed for Phase 4/5:** this row's core claim ("no next-day attempt") was already true and remains true — juggy4 did not touch date-pinning. What changed is what "unplaced" *means* on persistence for the Phase 4/5 cases (`unifiedScheduleV2.js:2347-2425`), per `runSchedule.js:1907-1987` §8's existing 2-way split (unchanged by this leg): **(a)** if the instance's DB row already has a `scheduled_at` from a prior run, §8 preserves `scheduled_at`/`date` and writes `overdue=1` — pinned on the grid, NOT moved to the unscheduled lane (§8 case B, `:1940-1978`); **(b)** if the DB row's `scheduled_at` is still `NULL` (never yet placed), §8 writes `unscheduled=1` (with `overdue` following separately per the item's own past-due state) — the unscheduled lane, `date` still pinned to the instance's own anchor, never rolled forward (§8 case C-equivalent for recurring, `:1980-1984`). Pre-juggy4, the when-block-anchor branch of Phase 4 bypassed this §8 split entirely by writing straight into `dayPlacements` with a synthesized start and no occupancy check — that bypass is what's superseded, not the no-roll invariant itself. See also R50.1's amendment in `docs/REQUIREMENTS.md`.

---

## SUMMARY

**Total behaviors documented:** 23
- **IMPLEMENTED:** 21
- **PARTIAL (doc mismatch, behavior present):** 1 — [PLACE-LADDER] (undocumented 5th rung; stale line cite). ([PLACE-SLACK] also has a minor "computed once vs per-iteration" doc mismatch but is behaviorally correct → counted IMPLEMENTED.)
- **CONTRADICTED:** 1 — [PLACE-WEATHER] (fail-open code vs fail-closed requirement).
- **PLANNED:** 0.

**Placement modes (6, confirmed against `placementModes.js:15-22`):** `reminder`, `all_day`, `fixed`, `time_window`, `time_blocks`, `anytime`. The prompt's enum guess ("TIME_WINDOW, TIME_BLOCKS, etc.") is correct; the full set is the 6 above.

### Top 5 gaps / doc↔code contradictions

1. **GAP-1 (CONTRADICTION C2) — two incompatible "phase" models.** `SCHEDULER.md` (architecture) still teaches a v1 "Phase 0–5" model where Phases 3–5 are per-priority free-task fills. The **live v2** code is a single slack-sorted pass whose "phases" (SCHEDULER-RULES.md §3.1, the authoritative table) are **Phase 0 Immovables / 1 Queue / 2 Retry / 3 Missed-preferred-time / 4 Missed-window / 5 Past-anchored / 6 Rigid-forced / 7 Deadline-relaxed** — i.e. post-loop rescue passes, a completely different decomposition. Officially flagged as contradiction C2 ("SCHEDULER.md's phase table is a design reference, not current behavior"), but SCHEDULER.md itself is **not annotated** with that warning at the point of use, so a reader of SCHEDULER.md alone will get the wrong model. **Action: annotate SCHEDULER.md §4 or supersede it.**

2. **GAP-2 — R11.x has no requirement-spec home.** The R11 family (R11.5 7-phase proof, R11.6 4-level ladder, R11.10 weather, R11.16 unplaced-reason, R11.17 floor/ceiling) exists **only** in `SCHEDULER-TRACEABILITY-REPORT.md` and in code comments — there is no `REQUIREMENTS.md` defining them. The spec being authored here is effectively the first consolidated R11 placement spec.

3. **GAP-3 — the "4-level" ladder is really 5-level in code.** `tryPlaceQueued` (`unifiedScheduleV2.js:1352-1356`) has a 5th `preferLatestSlot + relaxWhen` rescue rung beyond the documented normal→overdue→flexWhen→both. Undocumented in SCHEDULER-RULES.md §3.2.

4. **GAP-4 — pervasive doc line-number drift.** SCHEDULER-RULES.md §3.2 cites `unifiedScheduleV2.js:1037-1079` for `tryPlaceQueued` (actual `:1308-1361`); §3.1 cites `:1172-1778`; SCHEDULER.md cites `computeDepReadyAbs` at `:788`/`:923`/`:1066` (actual `:894`). The file is now 2390 lines; most doc line cites are stale. **Action: re-anchor citations or switch to symbol-based references.**

5. **GAP-5 / GAP-6 — test coverage holes on P1 placement behaviors.** SCHEDULER-TRACEABILITY-REPORT.md lists **no dedicated test** for R11.5 (7-phase proof), R11.6 (4-level ladder), R19.4–R19.7 + R35.3/R35.5/R35.6 (split-chunk rules), R40.1–R40.3 (flexWhen flag/ladder/`_flexWhenRelaxed`), and R11.17 (floor/ceiling). The single-pass algorithm itself is well covered by golden-master + scenario suites, but the **ladder and split paths rely on indirect coverage**. Separately, SCHEDULER.md §4c-5 documents a **chain-rollback (reverse-topological re-place)** routine that is **not clearly present** as a distinct pass in v2 (only the dep-retry pass at `:2131` and deadline-relaxed pass at `:2336` are visible) — needs confirmation whether rollback was dropped in the v1→v2 rewrite.

### Code behaviors NOT documented (or under-documented)

- **5th ladder rung** ([PLACE-LADDER], above) — present in code, absent from the §3.2 table.
- **Incremental slack maintenance** (`other.slack = other.capacity - other.dur` `:1941`; `overlapWithEligibleWindows` `:726`) — the v2 code maintains slack incrementally and re-sorts each iteration, whereas SCHEDULER.md §4c says slack is "computed once after Phase 1." Behaviorally equivalent ordering, but the doc's "computed once" framing is inaccurate for v2.
- **`extendDatesTo`** (`:186`, `:1082`) — infinite-slack non-recurring tasks dynamically extend the date horizon past `RECUR_EXPAND_DAYS` during their own scan; not described in the placement docs.
- **`deadlineMisses` dead code** (`:1768`, per C3) — documented in SCHEDULER.md return shape but never populated (R36.3 = remove).

### Cross-cutting confirmations
- Live entry confirmed: `schedule.routes.js:39` → `runScheduleAndPersist` → `unifiedScheduleV2`. The `runSchedule.js`/`unifiedScheduleV2.js` split is real but both are on the live path (one persists, one is the pure placement core).
- The 6-mode enum, the slack comparator `(slack asc, pri asc, dur desc, id)`, the dependency floor, and the per-mode `eligibleWindows` branching were all verified against current source, not inferred from docs.

---

# Section B — Recurring Task Lifecycle (R32 / R33 / R34 / R50 family)

**Scope:** recurring template vs instance; expansion/materialization; terminal statuses
(done/skip/cancel/missed/pause/disabled) + dedup-blocking; rolling anchor; day-lock placement;
fillPolicy + timesPerCycle (TPC) / flexible-TPC roaming; cycle length; cross-cycle spacing history;
delete semantics.

**Method:** reconciled against the live code. All file paths are absolute-from-repo-root under
`juggler/`. Primary code: `juggler-backend/src/scheduler/{runSchedule.js,reconcileOccurrences.js,constants.js,unifiedScheduleV2.js}`,
`shared/scheduler/{expandRecurring.js,missedHelpers.js,dateMatchesRecurrence.js}`,
`juggler-backend/src/lib/rolling-anchor.js`,
`juggler-backend/src/slices/scheduler/domain/logic/ConstraintSolver.js`,
`juggler-backend/src/slices/task/{facade.js, application/commands/{UpdateTaskStatus.js,DeleteTask.js}}`.
Authoritative doc: `juggler-backend/docs/architecture/SCHEDULER-RULES.md` §5/§6 (code matches it);
supporting: `TASK-STATE-MATRIX.md`, `RECURRING-SPACING-DESIGN.md`, `SCHEDULER-OVERDUE-LADDER.md`,
`SCHEDULER-TRACEABILITY-REPORT.md` (R32.1–R32.6, R33.1–R33.5, R34.1–R34.5).

> **Prompt-vs-reality note on numbering.** The brief references **R32.7** ("day-lock placement, no
> cross-day roll for non-TPC"). There is **no R32.7** in the requirement set — R32 has exactly six
> sub-reqs (R32.1–R32.6). Day-lock is real and IMPLEMENTED, but it lives as the `isDayLocked` logic in
> `unifiedScheduleV2.js` and is documented under `SCHEDULER-RULES.md` §6.2 (Day-Containment) and §5,
> not as an R32.7 requirement. It is captured below as **[DAY-LOCK]**. The named docs `SCHEDULER.md`,
> `TASK-PROPERTIES.md`, `TASK-STATE-MATRIX.md`, `RECURRING-SPACING-DESIGN.md` live under
> `juggler-backend/docs/architecture/` (not the `docs/` root). Several only exist in
> `.claude/worktrees/*` copies — the canonical main-tree copies are the ones cited here.

---

## Template / Instance / Expansion

### [B-EXP.1] Recurring **templates** are sources, not placed tasks; **instances** are materialized per-occurrence with date-agnostic ordinal IDs `<sourceUUID>-<ordinal>`
- **Code:** `shared/scheduler/expandRecurring.js:expandRecurring` (`if (t.taskType === 'recurring_template') return;` skip-as-source; ordinal counter `nextOrdBySource`, id `src.id + '-' + nextOrdBySource[src.id]`); template rows excluded from `taskRows`, loaded separately into `srcMap` in `runSchedule.js` (`getRecurringTemplateRows` / `buildSourceMap`).
- **Status:** IMPLEMENTED
- **Tests:** `juggler-backend/tests/expandRecurring.test.js` (R11.14 full suite: daily/weekly/biweekly/monthly/interval/dedup)
- **Source:** SCHEDULER-RULES.md §5; TASK-STATE-MATRIX.md (habit flag = `recur !== null`); brain `task_masters`/`task_instances` split
- **Notes:** IDs are date-agnostic (no `YYYYMMDD` suffix in new IDs; legacy IDs still carry it and are parsed for backward compat in `runSchedule.js` occurrence-date derivation). `occurrence_ordinal` groups all split chunks of one occurrence.

### [B-EXP.2] Forward expansion horizon = `today + RECUR_EXPAND_DAYS` (14 days); pending instances beyond horizon are **grandfathered** (reconciler does not delete them)
- **Code:** `juggler-backend/src/scheduler/constants.js` `RECUR_EXPAND_DAYS = 14`; `runSchedule.js` `expandEnd = today + RECUR_EXPAND_DAYS`.
- **Status:** IMPLEMENTED
- **Tests:** `expandRecurring.test.js` (windowed generation)
- **Source:** constants.js inline doc
- **Notes:** Horizon shrink is non-destructive by design ("users don't lose manually-adjusted occurrences").

### [B-EXP.3] Date-based **reconciliation** preserves instance IDs + `occurrence_ordinal` across runs (exact-date match first, then nearest-first); cal-linked rows excluded and routed through the id-based diff path
- **Code:** `juggler-backend/src/scheduler/reconcileOccurrences.js` `buildExistingGroups` (excludes `task_type !== 'recurring_instance'`, any non-empty `status`, and `gcal_event_id`/`msft_event_id` rows) + `matchOccurrences` (exact-date pass, then nearest-by-`|days|` greedy assignment producing `occIdOverrides` + `occurrenceMoves`).
- **Status:** IMPLEMENTED
- **Tests:** `juggler-backend/tests/reconcileOccurrences.test.js`
- **Source:** reconcileOccurrences.js header
- **Notes:** Pure function — no DB. Replaces a prior two-pass expand-then-split-reconcile design that thrashed. An `occurrenceMove` can overwrite `t.date` to a new desired date — the auto-miss path (B-TERM.4) defends against this by treating the raw DB `date` column as authoritative for never-placed past instances (BUG-142, PATH B/C).

### [B-EXP.4] On-demand single-instance materialization (`rc_` ids) for status writes against not-yet-persisted occurrences
- **Code:** `juggler-backend/src/slices/task/facade.js` `materializeRcInstance` (parses `rc_<source>_<dateDigits>` id, computes `scheduled_at` from source time, `repo.insertTask({task_type:'recurring_instance', status:'', ...})`).
- **Status:** IMPLEMENTED
- **Tests:** covered indirectly via `commands-status-delete-misc.test.js`
- **Source:** facade.js inline (verbatim port of controller L1639-1668)
- **Notes:** This is the seam the in-flight **master/instance "fabricate-once-persist" redesign** targets (see SUMMARY → in-flight).

---

## Terminal statuses & dedup-blocking

### [B-TERM.1] Status set + valid transitions: `'' (open) → done | wip | skip | cancel | missed`; `missed` is **system-applied only** (user cannot set it directly → 403)
- **Code:** status enum `juggler-backend/src/slices/task/facade.js:121` `z.enum(['','done','wip','cancel','skip','pause','disabled','missed'])`; terminal set `juggler-backend/src/lib/task-status.js` `TERMINAL_STATUSES = ['done','cancel','skip','pause','missed']`, `isTerminalStatus`; missed-set guard returns 403 (UpdateTaskStatus / commands).
- **Status:** IMPLEMENTED
- **Tests:** `commands-status-delete-misc.test.js` (R32.4 "403 for direct user set"); `commands-status-delete-misc.test.js` terminal-transition guards
- **Source:** SCHEDULER-RULES.md §5.1; TASK-STATE-MATRIX.md L34-44
- **Notes:** `disabled` is in the facade enum + terminal-exclusion lists but is a billing/plan-limit state (set by entitlement downgrade cascade), not a user lifecycle action. `pause` is **template-only** (see B-TERM.6).

### [B-TERM.2] done/skip/cancel **snap `scheduled_at` to now** (terminal `scheduled_at` is NOT NULL — DB CHECK constraint); done can take a custom `completedAt`
- **Code:** `juggler-backend/src/slices/task/application/commands/UpdateTaskStatus.js`; TASK-STATE-MATRIX.md "snaps scheduled_at to now". `done` preserves `scheduled_at` or accepts custom completedAt; skip/cancel snap to now.
- **Status:** IMPLEMENTED
- **Tests:** `commands-status-delete-misc.test.js`
- **Source:** SCHEDULER-RULES.md §5.1/§5.2; TASK-STATE-MATRIX.md L34-37
- **Notes:** The NOT-NULL `scheduled_at` CHECK constraint is the reason the missed-freeze ladder (B-TERM.4) must always resolve a non-null instant.

### [B-TERM.3] Terminal rows (done/skip/cancel) **block re-expansion** on their date (terminal-dedup), but their ordinals still advance the new-ordinal counter
- **Code:** `runSchedule.js` loads `_p_terminalDedupRows` (`task_instances` where status IN terminal), injects synthetic entries `{ id:'_dedup_<source>_<date>', taskType:'recurring_instance', status:'done' }` into `allTasks` so `expandRecurring` dedups via `existingBySourceDate` / `instanceStatusBySourceDate`; terminal ordinals fed into `maxOrdByMaster`/`maxOrdBySource` so new ordinals don't collide. `expandRecurring` dedup keys: `existingBySourceDate[sourceId+'|'+date]` and `existingByDateText[date+'|'+text]`.
- **Status:** IMPLEMENTED
- **Tests:** `expandRecurring.test.js` (dedup), `tpc.test.js`
- **Source:** SCHEDULER-RULES.md §5.2 "Terminal Dedup: Blocks re-expansion on date"
- **Notes:** This is what prevents a completed/skipped occurrence from being regenerated on the next scheduler run.

### [B-TERM.4] **Auto-miss** (`status:'missed'`) for past recurring instances — applied by `runSchedule.js` Phase 9 ONLY when BOTH the timeFlex placement window AND the recurrence-PERIOD boundary have expired; freeze slot follows a priority ladder
- **Code:** `runSchedule.js` past-window block (~L1749-1845): skips if `flex >= daysPast*1440` (still in timeFlex window) OR `today < periodEnd` (still in recurrence cycle, via `recurringPeriodEndKey`). Freeze ladder for `scheduled_at`/`completed_at`: `lastRealSlot` (placed slot, parsed UTC with `+'Z'`) → `windowClose` (`computeWindowCloseUtc` = `scheduled_at + timeFlex`) → midnight of occurrence date → `clockNow()`. `recurringPeriodEndKey` (runSchedule.js:226) computes day-locked (cycle=1) vs flexible-TPC (cycle=`recurringCycleDays`) boundary.
- **Status:** IMPLEMENTED
- **Tests:** `commands-status-delete-misc.test.js` (R32.4 auto-apply); `unifiedSchedule.test.js` (R11.16 `_unplacedReason:'missed'`)
- **Source:** SCHEDULER-OVERDUE-LADDER.md L37-48 (explicitly "refines R32.4 — was windowClose regardless of placement"); LOCKED design 999.808 (LC-1/LC-2); SCHEDULER-RULES.md §5.3 "Missed Detection — Three Paths"
- **Notes/contradictions:** **CONTRADICTED helper.** `shared/scheduler/missedHelpers.js` exposes a *second*, simpler `isTaskMissed`/`shouldAutoMarkMissed` pair using fixed **2-hour** (missed) / **24-hour** (resolution) thresholds off `scheduled_at` — this does NOT honor the recurrence-period boundary and disagrees with the Phase-9 ladder + `computeRecurringDeadline` in the same file. `computeRecurringDeadline` (period-boundary, R50.0) is the canonical one; the 2h/24h functions are legacy/cron-era and a live inconsistency worth flagging. PATH B/C fixes (BUG-142) ensure never-placed past instances still auto-miss even when the reconciler moved `t.date` forward or `unplacedIds` would otherwise block them.

### [B-TERM.5] **Recurrence-period deadline** is end-of-cycle for flexible/TPC, end-of-day for day-locked — single source of truth shared by scheduler Phase 9 and the cal-history cron
- **Code:** `shared/scheduler/missedHelpers.js` `computeRecurringDeadline({occurrenceDate, recurStart, isDayLocked, cycleDays}, tz)` → 23:59 local of last in-cycle day; cycle anchored to `recurStart + k*cycleDays` (matches expandRecurring bucketing). `recurringCycleDays` (ConstraintSolver.js:62): weekly=7, biweekly=14, monthly=30, daily=1, interval=`every*{1|7|30|365}`, else 0.
- **Status:** IMPLEMENTED
- **Tests:** `tpc.test.js`, `expandRecurring.test.js` (cycle bucketing)
- **Source:** missedHelpers.js header ("juggler recurring-overdue-lifecycle, 2026-06-19 — W. David Raike"); R50.0
- **Notes:** Caller classifies `isDayLocked` + supplies `cycleDays`; function is pure date math, identically usable backend + cron.

### [B-TERM.6] `pause` is **template-only** and cascades to future open instances (kept, not deleted); `unpause` regenerates / reactivates
- **Code:** `juggler-backend/src/slices/task/facade.js` `handleTemplatePause` (999.590): on `pause`, sets `status='pause'` on all `status=''`, `scheduled_at > now` instances of the template (cascade, instances kept per user ruling); on `unpause`, restores `''`. `expandRecurring` `sources` filter drops templates with status `pause`/`disabled`/`cancelled` so no new instances generate while paused.
- **Status:** IMPLEMENTED
- **Tests:** `commands-status-delete-misc.test.js`
- **Source:** SCHEDULER-RULES.md §5.2 (delete-template row); TASK-STATE-MATRIX.md L38, L250-252
- **Notes:** TASK-STATE-MATRIX.md L38/L250 says pause "deletes future instances", but the **code keeps them** as `status='pause'` (per the cited 999.590 user ruling) — minor **doc-vs-code drift** in TASK-STATE-MATRIX (SCHEDULER-RULES.md §5.2 is correct). `disabled` cascade follows the same keep-not-delete pattern (billing downgrade).

---

## Rolling anchor (R33 + R32.1–R32.3)

### [R32.1 / R33.1] **done → re-anchor** rolling master to the completed instance's date (advances cadence)
- **Code:** `juggler-backend/src/lib/rolling-anchor.js` `computeRollingAnchor(status, instanceDate, currentAnchor)` → returns `instanceDate` for `done`. Applied by `facade.js` `applyRollingAnchor` (`isRollingMaster` → `task_masters.rolling_anchor = newAnchor, updated_at`).
- **Status:** IMPLEMENTED
- **Tests:** `juggler-backend/tests/rollingAnchor.test.js` (`done → anchor advance`, `done → returns instance date`); `facade-fnnow-pin.test.js` (writes updated_at)
- **Source:** SCHEDULER-TRACEABILITY-REPORT.md R32.1/R33.1 (VERIFIED); SCHEDULER-RULES.md §5.4
- **Notes:** Only fires for `recur.type === 'rolling'` masters. `getAnchor` (expandRecurring.js:33) prefers `rollingAnchor` → `recurStart` → `date` for rolling sources.

### [R32.2 / R33.2] **skip → full re-anchor** to the skipped instance's date (same as done for cadence)
- **Code:** `rolling-anchor.js` `computeRollingAnchor` → returns `instanceDate` for `skip` (shares the `done || skip` branch).
- **Status:** IMPLEMENTED
- **Tests:** `rollingAnchor.test.js` (`skip → full reanchor` / `skip → returns instance date`); `expandRecurring.test.js` (TPC keep/backfill interaction)
- **Source:** SCHEDULER-TRACEABILITY-REPORT.md R32.2/R33.2 (VERIFIED); SCHEDULER-RULES.md §5.2
- **Notes:** skip re-anchors cadence but does NOT update spacing history (`lastByMaster`) and is NOT counted as "fulfilled" for TPC `backfill` (see B-TPC.3).

### [R32.3 / R33.4(cancel)] **cancel → NO anchor change** (returns null)
- **Code:** `rolling-anchor.js` `computeRollingAnchor` → `if (status === 'cancel') return null;`.
- **Status:** IMPLEMENTED
- **Tests:** `rollingAnchor.test.js` (`cancel → null (no anchor change)`)
- **Source:** SCHEDULER-TRACEABILITY-REPORT.md R32.3 (VERIFIED); SCHEDULER-RULES.md §5.2
- **Notes:** cancel = "this occurrence didn't count and shouldn't advance my rhythm."

### [R33.3] **missed → soft nudge** `instanceDate + 1 day`
- **Code:** `rolling-anchor.js` `computeRollingAnchor` → `missed` branch: `new Date(instanceDate+'T00:00:00'); d.setDate(d.getDate()+1)` → next-day key.
- **Status:** IMPLEMENTED
- **Tests:** `rollingAnchor.test.js` (`missed → returns instance date + 1 day`)
- **Source:** SCHEDULER-TRACEABILITY-REPORT.md R33.3 (VERIFIED); SCHEDULER-RULES.md §5.2/§5.4
- **Notes:** A missed occurrence nudges the cadence forward by one day rather than fully re-anchoring or freezing.

### [R33.4] **Stale-event guard:** terminal whose `instanceDate < currentAnchor` returns null (no regression); `>=` allowed
- **Code:** `rolling-anchor.js` `computeRollingAnchor` → `if (currentAnchor && instanceDate < currentAnchor) return null;`. Also returns null for any non-`done|skip|missed|cancel` status, and when `instanceDate` is falsy.
- **Status:** IMPLEMENTED
- **Tests:** `rollingAnchor.test.js` (`guard: terminal date < current anchor returns null`, `>= is allowed`)
- **Source:** SCHEDULER-TRACEABILITY-REPORT.md R33.4 (VERIFIED)
- **Notes:** Prevents an out-of-order completion of an older instance from rewinding the anchor.

### [R33.5] **Null-anchor backfill** from spacing history (last `done` date) when `rolling_anchor` is null (pre-feature data, shipped 2026-05-20)
- **Code:** `runSchedule.js` backfill block (~L540-564): for rolling templates with null `rollingAnchor`, set in-memory `t.rollingAnchor = recurringHistoryByMaster[t.id]` (latest done) and persist via `_runScheduleCommand.backfillRollingAnchor` → `KnexScheduleRepository.js:210` (`.whereNull('rolling_anchor').update({rolling_anchor, updated_at})`).
- **Status:** IMPLEMENTED, but **test gap**
- **Tests:** **NONE** — SCHEDULER-TRACEABILITY-REPORT.md R33.5 marked ❌ MISSING (backlog 999.417, P1)
- **Source:** SCHEDULER-TRACEABILITY-REPORT.md R33.5; runSchedule.js inline
- **Notes:** Without the backfill, `getAnchor` falls back to `recurStart` and the arithmetic projection can violate the spacing guarantee.

---

## Day-lock placement ([DAY-LOCK] — the prompt's "R32.7")

### [DAY-LOCK.1] Non-TPC recurring (and rigid/FIXED recurring) instances are **day-locked**: `earliestIdx = latestIdx = anchorDate` — **no cross-day roll**
- **Code:** `unifiedScheduleV2.js` `isDayLocked = recurring && (pm === FIXED || !isFlexibleTpc) && !(splitTot > 1)`; in `findEarliestSlot`, `if (item.isDayLocked) latestIdx = ai` (clamp to anchor). Daily and non-TPC weekly lock to their picked day so a Mon instance can't roam onto Wed and collide with the Wed instance.
- **Status:** IMPLEMENTED
- **Tests:** `unifiedSchedule.test.js` (fixed/anchored placement); R19.4 day-lock-for-rigid-splits is ❌ MISSING (no test asserting all split chunks stay on occurrence date — backlog 999.413)
- **Source:** SCHEDULER-RULES.md §6.2 Day-Containment table; unifiedScheduleV2.js inline; TASK-CONFIGURATION-MATRIX.md (day-locking rows)
- **Notes:** This is the behavior the brief labels "R32.7"; it is real but not a numbered requirement. Overdue recurring goes to **unplaced, never to a later day** (`ignoreDeadline` intentionally ignored for recurrings).

### [DAY-LOCK.2] Flexible-TPC recurring may **roam within its cycle**: search `anchorDate … anchorDate + cycleDays − 1` (capped so it can't bleed into the next cycle and double-book that cycle's own pick)
- **Code:** `unifiedScheduleV2.js` `findEarliestSlot`: `if (item.isDayLocked) latestIdx = ai; else if (item.cycleDays > 0) capIdx = ai + cycleDays - 1` (cap); unknown cycle → fall back day-locked.
- **Status:** IMPLEMENTED
- **Tests:** `tpc.test.js`, `expandRecurring.test.js` (R34.2 flexible roaming within cycle)
- **Source:** SCHEDULER-RULES.md §6.2; unifiedScheduleV2.js inline (999.547)
- **Notes:** Split chunks (`splitTotal > 1`) are NOT day-locked (999.098) — they span days within the cycle window but the cycle cap prevents overflow.

### [DAY-LOCK.3] Past flexible-TPC ANYTIME instances whose period has **not** ended are NOT dropped — forward-rolled by the `pastAnchoredPreQueue` bypass (R50.0); day-locked past instances ARE dropped
- **Code:** `unifiedScheduleV2.js` (~L266-318): past-ANYTIME-recurring drop guard with R50.0 exception — inline flexible-TPC check + `recurringCycleDays` period-end test; within period → flow through; period ended OR day-locked → drop.
- **Status:** IMPLEMENTED
- **Source:** unifiedScheduleV2.js inline (R50.0); SCHEDULER-RULES.md §5.3
- **Notes:** This is the placement-phase mirror of the Phase-9 auto-miss period check (B-TERM.4).

---

## fillPolicy + timesPerCycle (R34)

### [R34.1] **TPC target-interval steering:** when `timesPerCycle < selectedDayCount`, pre-compute optimal pick dates spaced ~`cycleDays / tpc` apart from the anchor
- **Code:** `expandRecurring.js` (~L118-366): `getSelectedDayCount`, `tpc = r.timesPerCycle`, `targetInterval = cycleDays / tpc`, greedy "closest candidate to lastPlaced + targetInterval", results in `tpcPickedDates[src.id]`; `if (tpc >= selectedDayCount) return` (no filtering when TPC covers all selected days).
- **Status:** IMPLEMENTED
- **Tests:** `expandRecurring.test.js` (R34.1 `timesPerCycle:1` weekly, `timesPerCycle:4` MWF, target-interval steering), `tpc.test.js` (TELLY-05 TS-85..TS-100)
- **Source:** SCHEDULER-TRACEABILITY-REPORT.md R34.1 (VERIFIED)
- **Notes:** `selectedDays`: daily=7, weekly/biweekly=`days.length` (or object keys), monthly=`monthDays.length`, else=1. flexible-TPC ⇔ `timesPerCycle < selectedDays` (definition is byte-identical across `expandRecurring`, `unifiedScheduleV2.isFlexibleTpc`, and `runSchedule.recurringPeriodEndKey`).

### [R34.2] Pending instances **count as cycle occupants** (slot budget); flexible roaming within the cycle respects the budget
- **Code:** `expandRecurring.js` budget accounting (`pendingBookedByDate`, `existingInCycle`); `runSchedule.js` (~L651) "timesPerCycle slot accounting can treat pending instances as already [booked]"; `_tpcBudgetUnscheduled` marks budget-exceeded picks.
- **Status:** IMPLEMENTED
- **Tests:** `expandRecurring.test.js` (R34.2 `pendingBookedByDate counts pending as cycle occupants`)
- **Source:** SCHEDULER-TRACEABILITY-REPORT.md R34.2 (VERIFIED)

### [R34.3 / B-TPC fillPolicy] **`keep` vs `backfill`** fill policy
- **Code:** `expandRecurring.js` (~L243-260): `fillPolicy = (r.fillPolicy === 'backfill') ? 'backfill' : 'keep'`.
  - `keep` (default): `slotsNeeded = hasSkipInCycle ? 0 : max(0, tpc − existingInCycle)` — a skip in the cycle stops new picks (no reshape/refill).
  - `backfill`: `slotsNeeded = max(0, tpc − fulfilledInCycle)` where `fulfilled` counts non-`skip` booked (done/pending/cancel count; **skip opens a slot**).
- **Status:** IMPLEMENTED
- **Tests:** `expandRecurring.test.js` (R34.3 `skip does not reshape cycle (tpc-refill avoidance)` = keep; R34.4 backfill via `pendingBookedByDate dates emit as desired`), `tpc.test.js`
- **Source:** SCHEDULER-TRACEABILITY-REPORT.md R34.3/R34.4 (VERIFIED); SCHEDULER-RULES.md §5.2 TPC-Impact column
- **Notes:** Per §5.2: under `keep` a skip yields "no new picks in cycle"; under `backfill` "slot opens". cancel counts as fulfilled in backfill (does not open a slot).

### [R34.5 / B-SPACE] **Cross-cycle spacing guard (minGap)** for flexible-TPC: skip candidate days within `floor(cycleDays * 0.5)` of the master's most-recent placement; safety valve ignores the guard if it would block the entire window
- **Code:** seed: `runSchedule.js` loads `_p_recurHistory` (MAX(date) per master across all statuses) → `recurringHistoryByMaster` → `cfg.recurringHistoryByMaster`. Enforce: `unifiedScheduleV2.js` `findEarliestSlot` builds `spacingMinKey` from `env.lastByMaster[masterId]` + `minGap = max(1, floor(cycleDays*0.5))`; safety valve when `spacingMinKey` would exceed the search window. Update: `noteMasterPlacement(env, item, dateKey)` on every recurring placement commit.
- **Status:** IMPLEMENTED, but **test gap**
- **Tests:** **NONE explicit** — SCHEDULER-TRACEABILITY-REPORT.md R34.5 ❌ MISSING (minGap + safety valve, backlog 999.416). `tpc.test.js` (TELLY-05) references spacing-guard/safety-valve but the traceability report still flags no explicit minGap assertion.
- **Source:** RECURRING-SPACING-DESIGN.md (design principles: min-gap primitive, enforce-at-placement, seed-from-DB, skip-don't-fail); SCHEDULER-RULES.md §5.2 Spacing-History column
- **Notes:** Spacing history (`lastByMaster`) is updated by **done** (and within-run placements) but the design seeds from MAX(date) across ALL statuses. §5.2 lists Spacing-History update as **Yes for done only**; skip/cancel/missed = **No**.

---

## Delete semantics (R32.5 / R32.6)

### [R32.5] **Delete instance → soft-skip** (`status='skip'`), not a hard row delete (for the standard recurring-instance path); ledger cleaned
- **Code:** `DeleteTask.js` scope=`instance` branch (L149-150 "delete just that single row (no cascade)"). SCHEDULER-RULES.md §5.2 states the recurring-instance delete is a **soft-skip** (`status='skip'`) so it inherits skip's re-anchor + dedup-block behavior. Cascade/scope logic: L4-18 documents branches — ingest block (403), provider-origin block (403), `cascade=recurring`/`scope=series`, `scope=instance`, `scope=this_and_future`.
- **Status:** IMPLEMENTED — **PARTIAL/ambiguous** (see notes)
- **Tests:** `commands-status-delete-misc.test.js` (R32.5 "Soft-skip on delete" — VERIFIED)
- **Source:** SCHEDULER-RULES.md §5.2 "delete instance → Soft-skipped (status='skip')"; SCHEDULER-TRACEABILITY-REPORT.md R32.5 (VERIFIED); DeleteTask.js header
- **Notes/gap:** SCHEDULER-RULES.md §5.2 and the VERIFIED R32.5 test assert **soft-skip**, but the DeleteTask.js `scope=instance` comment says "delete just that single row (no cascade)" — i.e. the literal scope=instance path does a row delete, while the *default* recurring-instance delete is soft-skipped. The two are reconciled by delete-scope (999.680): `scope=instance` is the explicit hard-delete-one path; the default (no scope / soft) path skips. Worth a follow-up to confirm which path the UI default delete hits. `cal_sync_ledger` rows marked `deleted_local` for paused/deleted instances (`facade.js:444-450`).

### [R32.6] **Delete template → cascade:** pending instances hard-deleted, completed (done/cancel/skip) archived/orphaned; template + ledger cleaned
- **Code:** `DeleteTask.js` `cascade=recurring`/`scope=series` branch (L12-15): transaction deletes template + ALL instances, cleans ledger, returns `{deletedCount, keptCount, templateId, pendingIds, keptIds}`. Implemented via injected `cascadeRecurringDelete` raw-table block.
- **Status:** IMPLEMENTED
- **Tests:** `commands-status-delete-misc.test.js` (R32.6 "Cascade-delete template" — VERIFIED)
- **Source:** SCHEDULER-RULES.md §5.2 "delete template → Pending→hard deleted; done/cancel/skip→archived"; TASK-STATE-MATRIX.md L252 "cascade: delete open instances, orphan completed ones"; SCHEDULER-TRACEABILITY-REPORT.md R32.6 (VERIFIED)
- **Notes:** `keptIds`/`keptCount` in the return = the completed instances preserved (orphaned from the now-deleted template) for history.

---

## In-flight designs (CODE-vs-INTENT)

### [IF.1] **Master/instance "fabricate-once-persist" redesign** (PLANNED) — LOCKED 2026-06-21, ~40% pre-built
- **Code today:** instances are re-INSERTed/reconciled every run via `expandRecurring` + `reconcileOccurrences` (B-EXP.1/3); on-demand `rc_` materialization (B-EXP.4) is a stopgap. Cosmetic master/instance split, deterministic ordinal IDs, and overdue R50.6 already EXIST.
- **Status:** PLANNED (partial substrate IMPLEMENTED)
- **Source:** brain "juggler master/instance redesign 2026-06-21"; MEMORY index
- **Intended gaps vs code:** UPSERT-not-reINSERT (absent), drop-refabricate-on-edit (absent), spacing history persistence (partial — `lastByMaster` is run-scoped + DB-seeded but not a first-class persisted spacing log). L4 adaptive-interval split deferred to its own milestone.

### [IF.2] **Recurring-overdue lifecycle** (PARTIAL → IMPLEMENTED core) — LOCKED 2026-06-19
- **Code today:** the period-boundary deadline (B-TERM.5 `computeRecurringDeadline`), Phase-9 auto-miss ladder (B-TERM.4, 999.808), and missed soft-nudge anchor (R33.3) are all SHIPPED — this is largely landed, not pending.
- **Status:** IMPLEMENTED (the lifecycle/over-materialization design that was "Leg A only" per brain is the residual)
- **Source:** brain "juggler recurring overdue lifecycle design"; SCHEDULER-OVERDUE-LADDER.md; missedHelpers.js header
- **Residual gap:** over-materialization (timesPerCycle=1 emitting 2+ instances/cycle — the "Submit Weekly UI Claim ×N unplaced" symptom) is the Leg-B target; skip/cancel terminal lifecycle (skip/cancel/pause/disabled) is honored in code.

---

## SUMMARY

**Total behaviors catalogued:** 24
(B-EXP ×4, B-TERM ×6, rolling-anchor R32.1-3 + R33.1-5 ×6 [some merged], DAY-LOCK ×3, R34/fillPolicy/spacing ×5, delete ×2, in-flight ×2.)

**By status:**
- **IMPLEMENTED (fully, with tests):** 17 — B-EXP.1/2/3/4, B-TERM.1/2/3/5/6, R32.1, R32.2, R32.3, R33.3, R33.4, DAY-LOCK.1(core)/.2/.3, R34.1, R34.2, R34.3
- **IMPLEMENTED but TEST-GAP (❌ MISSING per traceability):** 2 — R33.5 (null-anchor backfill, 999.417), R34.5 (minGap spacing guard + safety valve, 999.416); plus R19.4 rigid-split day-lock has no assertion (999.413)
- **PARTIAL / ambiguous:** 2 — R32.5 (soft-skip vs scope=instance hard-delete reconciliation), B-TERM.4 (Phase-9 ladder correct, but a contradictory legacy helper coexists)
- **PLANNED:** 1 — IF.1 master/instance fabricate-once-persist (substrate partially built)
- **CONTRADICTED:** 1 helper — `missedHelpers.js` 2h/24h `isTaskMissed`/`shouldAutoMarkMissed` vs period-boundary canon
- **DOC-vs-CODE DRIFT:** 1 — TASK-STATE-MATRIX.md says pause "deletes future instances"; code keeps them as `status='pause'`

**Top 5 gaps / contradictions:**
1. **CONTRADICTION — two missed-detection definitions in one file.** `shared/scheduler/missedHelpers.js` ships both the canonical period-boundary `computeRecurringDeadline` AND legacy fixed-threshold `isTaskMissed` (2h) / `shouldAutoMarkMissed` (24h) that ignore the recurrence cycle. The latter contradict Phase-9 (`runSchedule.js:1749+`) and R50.0. Reconcile/remove the legacy pair.
2. **TEST GAP — R34.5 cross-cycle spacing guard (minGap + safety valve) has no explicit assertion** (`unifiedScheduleV2.js findEarliestSlot`; backlog 999.416, P2). This guards the real "Cut Grass placed Sat then Fri → 6-day-then-1-day drift" bug from RECURRING-SPACING-DESIGN.md.
3. **TEST GAP — R33.5 null `rolling_anchor` backfill from spacing history** (`runSchedule.js:540-564`; backlog 999.417, P1). Untested path that, if wrong, silently violates the spacing guarantee for pre-2026-05-20 data.
4. **AMBIGUITY — delete-instance: soft-skip vs hard row delete.** SCHEDULER-RULES.md §5.2 + the VERIFIED R32.5 test say soft-skip (`status='skip'`), but `DeleteTask.js scope=instance` comments "delete just that single row." Confirm which path the UI's default instance-delete invokes (delete-scope 999.680 split).
5. **DOC DRIFT + numbering — "R32.7" does not exist; pause-deletes-instances doc wrong.** The brief's R32.7 day-lock maps to `isDayLocked` (SCHEDULER-RULES.md §6.2), not a requirement; and TASK-STATE-MATRIX.md L38/L250 ("pause deletes future instances") contradicts the code's keep-as-`pause` cascade (999.590). Renumber/annotate when this spec is folded into the requirement set.

---

# SECTION C — Overdue / Missed / Past-Due / Forward-Roll Subsystem

**Scope:** The R50 family + the overdue ladder + the 2026-06-23 locked forward-roll design.
**Authored:** 2026-06-23 (research pass, read-only).

---

## ⚠️ Branch-line reconciliation (read this first)

The framing of "MAIN vs WIP-branch-60835fe" needs one correction confirmed by `git`:

| Line | Commit | What it is |
|------|--------|-----------|
| **MAIN** (= `origin/main`) | `505a09b` | "only DAILY recurring instances pin overdue on slot-day; weekly/flexible roam". This is the last *gated, pushed* state. |
| **WIP** | `60835fe` | The current **checked-out superrepo HEAD** on branch `leg/juggler-overdue-reschedule`. Adds forward-roll + window-close read predicate. **NOT on `origin/main`** (`git merge-base --is-ancestor 60835fe origin/main` → NOT-ON-ORIGIN-MAIN). Working-tree code = this. Ungated (ernie/cookie BLOCK+WARN open per its own commit message). |

So: the juggler submodule's *working tree* IS the WIP. "IMPLEMENTED(main)" below means present and gated at/before `505a09b`. "WIP(branch, ungated)" means added by `60835fe`, present in the working tree, but not gated/merged.
All `file:line` cites are against the **`60835fe` working tree** unless noted.

---

## The three states (locked vocabulary)

- **PLACED** — instance has a live `scheduled_at` slot within its effective deadline; `overdue=0/null`, `unscheduled=0`.
- **UNSCHEDULED** — brand-new chunk (`scheduled_at` null) that could not be placed this run → `unscheduled=1`, shown in the Unplaced lane (`unplaced_reason`/`unplaced_detail`).
- **OVERDUE** — past its effective deadline and incomplete; pinned (`overdue=1`, `unscheduled=0`, `scheduled_at`/`date` preserved). Terminal sibling: **missed** (status write, R32.4) once the period boundary itself passes.

**Effective deadline** = `min(recurrence-period boundary, window-close)` (locked, David 2026-06-23, `juggler-overdue-reschedule/SPEC.md`).

---

### [R50.0] Each recurring instance carries an IMPLIED deadline = the recurrence-period boundary (`recurringPeriodEndKey`); day-locked/no-TPC → occurrence+1; flexible-TPC (`timesPerCycle < selectedDays`) → occurrence+cycleLen. First day PAST the period (EXCLUSIVE): live through periodEnd−1, missed ON periodEnd.
- **Code:** `runSchedule.js:226` `recurringPeriodEndKey(recur, occurrenceDateKey)`; `cycleDays` default 1 (day-locked), `+cycleLen` for flexible-TPC; `formatDateKey(occ + cycleDays)`. `selectedDays` classification (`runSchedule.js:240-258`) is byte-identical to `unifiedScheduleV2.js` `isFlexibleTpc` (`:535`). Cycle length via `ConstraintSolver.recurringCycleDays` (`ConstraintSolver.js:62`). — MAIN.
- **Status:** IMPLEMENTED(main).
- **Tests:** `tests/recurringPeriodEnd.test.js` (9 cases); `tests/runScheduleIntegration.test.js` (AC5).
- **Source:** REQUIREMENTS R50.0 (:552); SPEC.md "Precise definitions" #1; brain ADR `OVERDUE-COMPUTED-STATUS-2026-06-21.md`.
- **Notes:** Unrecognised recur types (incl. `interval`) → `selectedDays=1` → never flexible → day-locked. Shape-defaults (`r.days||'MTWRF'`) are classification-only, NOT data fallbacks.

### [R50.1] A past-due incomplete instance (hard OR implied due) MUST NOT be rescheduled: it stays PINNED at its due date/time and is NEVER demoted to unscheduled/unplaced. Applies to fixed/ingested events, recurring instances, recurring split chunks, user-deadline one-offs. A no-due task is exempt.
- **Code:** `unifiedScheduleV2.js:~1669` `pastAnchoredPreQueue` push (anchored past items pinned); `runSchedule.js` Phase-8 case B (`:~1556`) sets `overdue=1`, preserves `scheduled_at`/`date`, does NOT move to unscheduled lane. — MAIN (pin); **modified by WIP** (forward-roll exception, see OVD-1).
- **Status:** IMPLEMENTED(main) — but the WIP punches a *forward-roll exception* into the pin for roamable flexible-TPC (OVD-1/OVD-3).
- **Tests:** `tests/schedulerFrozenInvariant.test.js`; Phase-8 cases in `tests/runScheduleIntegration.test.js`.
- **Source:** REQUIREMENTS R50.1 (:553).
- **Notes:** The pin is the default; "roamable within period" is the WIP-added carve-out. R52 (started) and R50.1 (fixed) remain hard-pinned even under WIP.

### [R50.6] The READ path (`rowToTask`, via `GET /api/tasks` → `tasks_v`) derives `overdue` by OR-ing the stored flag with a computed predicate (hard/materialized due vs shared tz-aware now), so a past-due item shows `overdue:true` between scheduler runs. Floating/no-deadline never overdue; terminal never overdue; FIXED uses `scheduled_at` as hard due.
- **Code:** `taskMappers.js` `rowToTask` overdue IIFE (~`:355-410`): `if (!!row.overdue) return true` (stored flag wins); `isTerminalStatus(st)` / `st==='disabled'` → false; `hasHardCommitment = deadline || implied_deadline || FIXED || isPlacedRecurringInstance`; `dueKey = deadline || implied_deadline || (FIXED/placed → scheduled_at-local)`; `if (dueKey < now.todayKey) return true`. — IMPLEMENTED(main) for the structure; **the same-day intra-day branch is REPLACED by WIP** (see OVD-2/R50.6-windowclose).
- **Status:** PARTIAL — base predicate IMPLEMENTED(main); the same-day window-close threshold is WIP(branch, ungated).
- **Tests:** `tests/unit/mappers/overdue-pastdue-recurring.test.js`; frontend `src/utils/__tests__/overdue.test.js`.
- **Source:** REQUIREMENTS R50.6 (:558); ADR Decision 1 (:61); SPEC.md "Read path (R50.6...)".
- **Notes:** MAIN (505a09b) same-day check was FIXED-only: `dueKey===todayKey && scheduledMins < nowMins` (505a09b `taskMappers.js:405`). WIP generalises to the window-close threshold below. **This read-path derivation is mapper-owned BY DESIGN** — it fills the gap between discrete scheduler runs; it is NOT a read-triggered scheduler run (Decision 6).

### [R50.6-windowclose] (WIP) The same-day overdue threshold is the window-close, not the slot: windowed daily recurring (`time_flex > 0`) is overdue at `scheduledMins + time_flex`; window-less (`time_flex` null/0) falls through to midnight (next-day `dueKey < todayKey`). FIXED stays slot-time (`scheduledMins < nowMins`).
- **Code:** `taskMappers.js` `rowToTask` "Past-due check" block (~`:404-420`, working tree): comment "Windowed daily recurring (isPlacedRecurringInstance + time_flex > 0): overdue when WINDOW CLOSES = scheduledMins + time_flex (not at the slot)." — **WIP(branch-60835fe), ungated.**
- **Status:** WIP(branch, ungated) — with a known WARN.
- **Tests:** `tests/unit/mappers/overdue-pastdue-recurring.test.js` (Round-2 additions, +353 lines per `60835fe` stat).
- **Source:** SPEC.md AC2/AC2b/AC2c/AC4; `60835fe` commit message.
- **Notes / KNOWN WARN (from `60835fe` message + SPEC §Touch points):** the WIP uses the **placed `scheduledMins`** as the window base, but the locked design says window-close must use **`preferred_time_mins + time_flex`** (independent of where the task was actually placed) — so a task placed EARLIER than preferred reads overdue too early (AC2b violation). Also `time_flex == 0` (zero-width) handling is conflated with `null` in the current branch ("falls through to false" comment) vs the locked AC2c which wants overdue *exactly at the slot minute* for `flex==0`. CONTRADICTION between WIP code and SPEC AC2b/AC2c — must be reconciled before gating.

### [R50.7] The implied deadline is MATERIALIZED to `task_instances.implied_deadline` (DATE column) during the expand/reconcile insert pass (scheduler W3), so the read predicate compares without re-running recurrence logic.
- **Code:** `runSchedule.js:~1064` `chunkInsertRows` map sets `implied_deadline: recurringPeriodEndKey(srcMap[row.sourceId].recur, occDate)`; migration `20260621000000_add_implied_deadline_to_task_instances.js` (col + `tasks_v` view recreation). — MAIN.
- **Status:** IMPLEMENTED(main).
- **Tests:** `tests/db/migrations/20260621000000_implied_deadline.test.js`.
- **Source:** REQUIREMENTS R50.7 (:559); ADR Decision 4 (:76).
- **Notes:** Per-OCCURRENCE (per-instance row), NOT inherited from master. Pre-existing rows get NULL (fail-safe — stored `overdue` flag covers them; backfill deferred). NULL is never a data-fallback bug here — it is the documented safe default.

### [R50.8] ONE shared `getNowInTimezone` contract (tz-aware `todayKey`+`nowMins`+`todayDate`, America/New_York default, injectable clock) consumed by BOTH the backend scheduler and the read predicate; frontend reconciled to the same contract. No ad-hoc `new Date()` past-due compare on the display path.
- **Code:** `shared/scheduler/getNowInTimezone.js` (canonical); `runSchedule.js:264` requires it (local dup removed); `taskMappers.js` uses it for default now (`_getNowInTimezone(timezone || _DEFAULT_TIMEZONE)`); `juggler-frontend/src/utils/timezone.js` reconciled. — MAIN.
- **Status:** IMPLEMENTED(main).
- **Tests:** `tests/getNowInTimezoneParity.test.js`.
- **Source:** REQUIREMENTS R50.8 (:560); ADR Decision 5 (:87).
- **Notes:** Guards the `dateStrings:true` UTC-misparse trap (MEMORY: never bare `new Date()` on tz-less DB datetimes). Frontend ESM copy kept in sync manually (CRA can't import the CommonJS `shared/` tree) — documented divergence risk.

### [R32.4 / 999.808] Scheduler Phase 9 auto-applies `status:"missed"` to past recurring instances whose timeFlex window AND recurrence-period boundary (R50.0) have BOTH expired. Users cannot set `missed` directly (403). Missed PLACED freezes at the **last real `scheduled_at`**; never-placed falls back to windowClose / midnight.
- **Code:** `runSchedule.js` Phase 9 (~`:1827-1857`): `lastRealSlot = rawRowPast.scheduled_at != null ? … : null` → `missedAt = lastRealSlot || computeWindowCloseUtc(...) || localToUtc(effectiveDate,'12:00 AM',TZ) || clockNow()`; reconcile spares past pending recurring instances so Phase 9 can freeze them (`:~915`). 403 guard in `UpdateTaskStatus.js`. — MAIN.
- **Status:** IMPLEMENTED(main). Preserved unchanged by WIP ("R32.4/999.808 missed-freeze … do not disturb").
- **Tests:** `tests/slices/task/application/commands-status-delete-misc.test.js`.
- **Source:** REQUIREMENTS R32.4 (:372); doc `architecture/SCHEDULER-OVERDUE-LADDER.md` §Phase-9 (LOCKED 999.808, David 2026-06-19); SPEC.md AC3.
- **Notes:** This refines R32.4's older "windowClose regardless of placement". Freeze-slot priority ladder: (1) last real `scheduled_at`, (2) `computeWindowCloseUtc`, (3) midnight-of-occurrence, (4) `clockNow()` fallback. Terminal-`scheduled_at` DB CHECK constraint satisfied in both branches.

### [R32.7] Day-locked non-TPC recurring instances are locked to their occurrence date (`isDayLocked=true` when `!isFlexibleTpc`): scheduler searches `earliest=latest=anchorDate`; cannot roll to another day. ANYTIME + past anchor-time today → placed at the LATEST available slot today (intra-day). Past-DATE occurrences that can't place are left unplaced — NEVER rolled forward.
- **Code:** `unifiedScheduleV2.js:572` `isDayLocked = recurring && (FIXED || !isFlexibleTpc) && !(splitTot>1)`; lines 415, 464-469, 834-851, 978-998. Forward-roll gate explicitly guards: `item.isRecurring && item.isFlexibleTpc && !item.isStarted && !item.isFixedWhen` (`:~1670`) — day-locked excluded. — MAIN (lock) + WIP (explicit roll-exclusion).
- **Status:** IMPLEMENTED(main); WIP re-affirms the guard (a day-locked daily NEVER forward-rolls to another day; only intra-day same-day).
- **Tests:** `tests/schedulerScenarios.test.js` (Tier 11, S51/S52); characterization scheduler suites.
- **Source:** REQUIREMENTS R32.7 (:375); SPEC.md AC1d/AC6.
- **Notes:** AC1d (intra-day roam to a later SAME-day slot while the window is open) is the only roam day-locked dailies get.

### [999.671 / 999.700] Floating tasks (no deadline, non-FIXED, recurring=0, `overdue=0`) are NEVER overdue/past-due — roll-forward policy. A stale past placement does NOT make a no-deadline task overdue.
- **Code:** `runSchedule.js:108-109` `hasHardCommitment = deadline || overdue || fixed`; floating excluded; Phase-8 case `:1593` "999.700: floating tasks are NEVER past-due"; `taskMappers.js` `hasHardCommitment` gate returns false for no-commitment rows; frontend `utils/overdue.js` distinguishes task-overdue from the scheduler's per-placement `_overdue` slack-relaxation artifact. — MAIN.
- **Status:** IMPLEMENTED(main). WIP Invariants list it as regression=BLOCK.
- **Tests:** floating-exclusion cases across scheduler + mapper suites; `src/utils/__tests__/overdue.test.js`.
- **Source:** REQUIREMENTS R50.6 (floating clause); ADR edge-case table (:182); SPEC.md Invariants/AC5.
- **Notes:** The scheduler's per-placement `_overdue` (set by ladder pass 2 slack-relaxation) is NOT the task's display overdue — `utils/overdue.js` is the SoT for the display decision.

### [R52] A past STARTED instance (`isStarted`, anchorMin set) stays PINNED at its original date as overdue — never re-placed forward (frozen invariant). Same hard-pin as a past fixed/ingested commitment.
- **Code:** `unifiedScheduleV2.js:~1669` pastAnchoredPreQueue gate: `isStarted`/`isFixedWhen` are EXCLUDED from the forward-roll carve-out (`!item.isStarted && !item.isFixedWhen` guard) → always pushed to pin. — MAIN + WIP (WIP explicitly excludes them from forward-roll).
- **Status:** IMPLEMENTED(main); preserved by WIP.
- **Tests:** `tests/schedulerFrozenInvariant.test.js`.
- **Source:** REQUIREMENTS R52 (:~620 region); SPEC.md Invariants; brain `juggler-frozen-invariant`.

### [OVD-LADDER] The placement ladder (`tryPlaceQueued`, `unifiedScheduleV2.js`) tries up to 4 passes per item, short-circuiting on first success: (1) normal; (2) `slack<0` → drop deadline ceiling (`ignoreDeadline`, emits `_overdue`); (3) `flexWhen` → relax `when` to anytime (`whenRelaxed`); (4) both. All 4 fail → `unplaced` → Phase 8.
- **Code:** `tryPlaceQueued` in `unifiedScheduleV2.js`; documented in `architecture/SCHEDULER-OVERDUE-LADDER.md` §"The ladder (as implemented)". — MAIN.
- **Status:** IMPLEMENTED(main).
- **Tests:** scheduler scenario + characterization suites.
- **Source:** doc `architecture/SCHEDULER-OVERDUE-LADDER.md` (2026-05-19); REQUIREMENTS US-6.
- **Notes:** v2 deliberately does NOT bump/displace lower-priority placements (v1's "recurring rescue" Phase 4) nor downgrade priority — rejected (cascading NP-hard, opaque to user, dishonest). Slack-first sort handles the common case; genuine no-fit → honest overdue lane.

---

## FORWARD-ROLL (the unimplemented half of R50.0 — being built this session)

### [OVD-1] (WIP) A roamable flexible-TPC ANYTIME recurring instance whose anchorDate is past but whose recurrence PERIOD has NOT ended is NOT dropped at `buildItems` — it survives to be forward-rolled.
- **Code:** `unifiedScheduleV2.js:266-271` (working tree): the blanket `if (t.recurring && pm===ANYTIME && date < todayIsoKey) return` now has a flexible-TPC carve-out — inline `isFlexibleTpc` recompute + `recurringCycleDays`; if `today < anchor+cycleLen` → do NOT drop (fall through); else drop as before. — **WIP(branch-60835fe).**
- **Status:** WIP(branch, ungated).
- **Tests:** `tests/scheduler/roamable-recurring-forward-roll.test.js` (NEW, +1277 lines); `tests/runScheduleIntegration.test.js` §8 (+84 lines).
- **Source:** SPEC.md "Forward-roll"; `60835fe` diff; REQUIREMENTS R50.0 (forward-roll = the unimplemented half).
- **Notes:** Inline `_isFlexTpcCheck` duplicates `isFlexibleTpc` (`:535`) — duplication WARN (drift risk; should reuse the single classifier).

### [OVD-2] (WIP) A roamable instance (flexible-TPC across cycle, OR windowed daily within its own day) whose slot is past but effective deadline NOT passed is CLEARED and re-presented to the placement queue, placed at the next valid slot. The dead slot is cleared first; the instance must never appear on two days at once.
- **Code:** `unifiedScheduleV2.js:~1664-1712` (working tree): in the pastAnchoredPreQueue gate, `if (isRecurring && isFlexibleTpc && !isStarted && !isFixedWhen)` and `today < anchor+cycleLen` → `item.anchorDate = null; item.anchorMin = null;` (clear dead anchor) → fall through to normal queue (NOT pushed to pastAnchoredPreQueue). — **WIP(branch-60835fe).**
- **Status:** WIP(branch, ungated).
- **Tests:** `tests/scheduler/roamable-recurring-forward-roll.test.js` (AC1, AC1d).
- **Source:** SPEC.md "Forward-roll"; SPEC.md AC1/AC1d.
- **Notes:** Reuses the `occurrenceMoves` clear-and-re-present mechanism (no parallel placement pass). Period-ended OR unparseable-anchor → fall back to pin (`pastAnchoredPreQueue.push`).

### [OVD-3] (WIP — **OPEN BLOCK**) The forward-roll search MUST be capped so the instance can NEVER be placed on or after its period-end day. Cap day = `anchor + cycleLen − 1` (last valid day, INCLUSIVE). The cap must be applied UNCONDITIONALLY even when the row's existing `deadlineDate` is stale/past/looser than the period end.
- **Code:** `unifiedScheduleV2.js:~1697` (working tree): `_periodEndKey = formatDateKey(anchor + cycleLen)`; `if (!item.deadlineDate || item.deadlineDate > _periodEndKey) item.deadlineDate = _periodEndKey;` — drives `latestIdx` in `findEarliestSlot` (`:973-975`); inclusive `latestIdx` loop (~`:1117`). — **WIP(branch-60835fe).**
- **Status:** WIP(branch, ungated) — **KNOWN BLOCK (ernie/cookie).**
- **Tests:** `tests/scheduler/roamable-recurring-forward-roll.test.js` AC3-cap.
- **Source:** SPEC.md "Period-end cap (must hold)"; SPEC.md AC3-cap; `60835fe` commit message ("period-end cap can bleed to next cycle").
- **Notes / BLOCK detail:** The cap is **CONDITIONAL** in the current code (`if (!item.deadlineDate || item.deadlineDate > _periodEndKey)`) — a **pre-set past/stale `anchorDate`→`deadlineDate` silently defeats the cap**, so the instance can bleed into the NEXT cycle. The locked SPEC requires the cap applied UNCONDITIONALLY (`cap = anchor + cycleLen − 1`, INCLUSIVE). Also a subtle off-by-one risk: code sets `deadlineDate = anchor + cycleLen` (= period-end EXCLUSIVE = first day past period) while the SPEC's cap day is `anchor + cycleLen − 1` (INCLUSIVE last valid day). These must be reconciled — this is the headline BLOCK.

### [OVD-4] (WIP) Overdue determination at scheduler time: a run that finds no valid slot before the effective deadline → `overdue=1` (R50 pin). At the period boundary with no slot → `missed`, `scheduled_at` frozen at the last real placed slot (R32.4/999.808 ladder, undisturbed).
- **Code:** Phase-8 unplaced marking (`runSchedule.js:~1556`, MAIN) + WIP forward-roll fallthrough to pin when period ended (`unifiedScheduleV2.js:~1705`). — MAIN (pin/missed) + WIP (the "tried to roll, period ended" path feeds the same pin).
- **Status:** PARTIAL — terminal pin/missed IMPLEMENTED(main); the forward-roll-exhausted → pin transition is WIP.
- **Tests:** `tests/scheduler/roamable-recurring-forward-roll.test.js` AC3 ("no-slot-weekly" must be in unplaced); `tests/runScheduleIntegration.test.js`.
- **Source:** SPEC.md "Overdue determination"; AC3.

---

## NON-GOALS / invariants (regression = BLOCK)

- **NO read-triggered scheduler run** (ADR Decision 6, `:96`). The read path computes display status only (one `getNowInTimezone` + date-string compare per row); placement remains scheduler-owned. *placement = scheduler-owned; display-status-between-runs = mapper-owned.*
- 999.671 floating-never-overdue; R32.7 day-lock; R32.4/999.808 missed-freeze; FIXED uses `scheduled_at` as hard due; terminal/disabled suppress overdue; `dateStrings:true` trap (never bare `new Date()` on tz-less DB datetimes).

---

## SUMMARY

**Total behaviors catalogued: 16** (R50.0, R50.1, R50.6, R50.6-windowclose, R50.7, R50.8, R32.4/999.808, R32.7, 999.671/700, R52, OVD-LADDER, OVD-1, OVD-2, OVD-3, OVD-4, + the NO-read-triggered-run invariant).

**By status:**
- **IMPLEMENTED(main) — 9:** R50.0, R50.1 (base pin), R50.7, R50.8, R32.4/999.808, R32.7, 999.671/700, R52, OVD-LADDER.
- **WIP(branch-60835fe, ungated) — 3:** R50.6-windowclose, OVD-1, OVD-2.
- **WIP + OPEN BLOCK — 1:** OVD-3 (period-end cap).
- **PARTIAL — 2:** R50.6 (base predicate main; same-day threshold WIP), OVD-4 (terminal pin main; roll-exhausted→pin WIP).
- **CONTRADICTED (WIP code vs SPEC) — 1:** R50.6-windowclose (code uses placed `scheduledMins`; SPEC AC2b/AC2c demand `preferred_time_mins + time_flex` and distinct `flex==0` handling).

**Open BLOCK / WARNs on the WIP (`60835fe`, per its own commit message + ernie/cookie):**
1. **BLOCK — period-end cap can bleed to next cycle (OVD-3):** cap is conditional (`if (!deadlineDate || deadlineDate > periodEnd)`); a stale/past pre-set `deadlineDate` defeats it. Must be unconditional. Plus an inclusive/exclusive boundary mismatch (`anchor+cycleLen` set vs SPEC's `anchor+cycleLen−1`).
2. **WARN — window-close uses placed slot, not preferred (R50.6-windowclose):** read predicate computes `scheduledMins + time_flex`; SPEC requires `preferred_time_mins + time_flex` (placement-independent) → AC2b false-positive for early-placed tasks.
3. **WARN — `time_flex == 0` zero-width window:** conflated with `null`/anytime in the WIP ("falls through to false"); SPEC AC2c wants overdue exactly at the slot minute, distinct from `null`→midnight.
4. **WARN (drift) — inline `isFlexibleTpc` duplication:** `buildItems:266` recomputes the classifier inline instead of reusing the single `isFlexibleTpc` (`:535`)/`recurringPeriodEndKey` classifier.

**Top gaps before gating:**
- Reconcile the period-end cap to unconditional + correct inclusive boundary (the headline BLOCK).
- Switch the read predicate window-close base from placed `scheduledMins` to `preferred_time_mins` and split out `time_flex==0`.
- De-duplicate the flexible-TPC classification (single source).
- `60835fe` is NOT on `origin/main` and is ungated; the juggler working tree is currently sitting on it — any spec-driven implementation should branch from here and close these four findings, or the leg should be re-based onto `origin/main` (505a09b) and re-applied clean.

**Doc/requirements anchor map:** REQUIREMENTS.md R50.0 (:552), R50.1 (:553), R50.6 (:558), R50.7 (:559), R50.8 (:560), R32.4 (:372), R32.7 (:375); ADR `docs/design/OVERDUE-COMPUTED-STATUS-2026-06-21.md` (Decisions 1/4/5/6, edge-case table :182); `docs/architecture/SCHEDULER-OVERDUE-LADDER.md` (ladder + Phase-9 freeze); `.planning/kermit/juggler-overdue-reschedule/SPEC.md` (v2 locked, 2026-06-23).

---

# Section D — Scheduler Persistence + Read Model (DB-single-source)

Authoritative behavior catalogue for the juggler scheduler's **persistence model** and **read
model** after the DB-single-source refactor (waves W1–W4) plus the R50.6/.7/.8 read-time-overdue
work. Reconciled against the *live code on the current working tree* (juggler submodule, branch
`leg/juggler-db-single-source` line) and the *live DB shape* (prod = views over
`task_masters` / `task_instances`, no flat `tasks` table; `tasks` dropped by migration
`20260415010900_drop_tasks_table.js`).

All file paths are relative to
`/Users/david/Documents/Software Dev/raike-and-sons/juggler/juggler-backend/` unless absolute.

Primary sources:
- ARCH spec (LOCKED): `.planning/kermit/juggler-readmodel-design/ARCH-DB-SINGLE-SOURCE.md`
- WBS: `.planning/kermit/WBS-juggler-db-single-source.md`
- Read-time-overdue ADR + R50.6–R50.8 (referenced via brain/ADR; decisions 1–6).

---

## Model overview (orientation, not a behavior row)

The DB is the single source of truth. The scheduler is a **pure decision engine**: it reads the
DB, decides placement in memory, and **writes the full per-instance result back onto each
`task_instances` row** (`scheduled_at`, `date`, `day`, `time`, `dur`, `unscheduled`, `overdue`,
`unplaced_reason`, `unplaced_detail`, `slack_mins`, `status`, `implied_deadline`). Every view
reads the unified `tasks_v` view (template + instance UNION) via `GET /api/tasks` → `rowToTask`.
Placements are **derived on read** from each row's `scheduled_at`, not from a `schedule_cache`
blob. `schedule_cache` survives as an internal cal-sync-only write (W4 not fully landed).

Each instance is structurally **exactly one** of placed / overdue / unplaceable — one row, one
state — so "placed AND unplaced" is impossible.

---

### [DBSS-1] Two physical tables — `task_masters` (templates) + `task_instances` (occurrences) — replace the dropped flat `tasks` table

- **Code:** migration `src/db/migrations/20260415010000_create_task_masters_and_instances.js` (create); `20260415010100_backfill_task_masters_and_instances.js` (backfill); `20260415010900_drop_tasks_table.js` (drop flat table)
- **Status:** IMPLEMENTED
- **Tests:** `src/db/migrations/__tests__/20260509000300_migration_integration.test.js`; migration-integration suites under `src/db/migrations/__tests__/`
- **Source:** ARCH-DB-SINGLE-SOURCE.md (Target: "Every view reads DB instances"); brain (juggler master/instance redesign 2026-06-21)
- **Notes:** Prod has no `tasks` table — only `task_masters`/`task_instances` plus views. A non-recurring task is a `task_masters` row (`recurring=0`) with exactly one `task_instances` row; a recurring task is a master (`recurring=1`) with N instances. The instance carries the per-occurrence schedule state; the master carries the template fields (text, dur, pri, project, recur, weather, etc.).

### [DBSS-2] `tasks_v` is the unified read model: a UNION of a template branch and an instance branch (template+instance read model)

- **Code:** migrations `20260415010300_create_tasks_view.js` (initial); `20260614010000_recreate_tasks_v_with_completed_at.js` (canonical current shape — full explicit `CREATE VIEW` of both branches); later patches `20260622020000` (unplaced cols), `20260623000000` (end_date)
- **Status:** IMPLEMENTED
- **Tests:** view-shape assertions in migration integration tests; no dedicated `tasks_v` snapshot test found (gap)
- **Source:** ARCH-DB-SINGLE-SOURCE.md; migration headers
- **Notes:** Branch 1 = `task_masters m WHERE m.recurring=1` projected as `task_type='recurring_template'` (most instance-only columns NULL — `scheduled_at`, `date`, `overdue`, `slack_mins`, `unplaced_reason`, etc.). Branch 2 = `task_instances i JOIN task_masters m ON m.id=i.master_id`, `task_type = CASE WHEN m.recurring THEN 'recurring_instance' ELSE 'task' END`, projecting the instance's materialized columns. `source_id = master_id` only for recurring. A second view `tasks_with_sync_v` (migration `20260415010500`) LEFT-JOINs cal-sync ledger. **Migration discipline (999.733):** any change to `tasks_v` shape MUST DROP+CREATE the view in the same migration; a prior regex-patch attempt (`20260603000000`) silently no-op'd because MySQL normalizes view DDL — fixed by the explicit recreate in `20260614010000`.

### [DBSS-3] `tasks_v` projects the materialized read-model columns: `scheduled_at`, `date`, `day`, `time`, `status`, `unscheduled`, `overdue`, `slack_mins`, `completed_at`, `occurrence_ordinal`, `split_ordinal`, `split_total`, `unplaced_reason`, `unplaced_detail`, `implied_deadline`, `end_date`

- **Code:** `20260614010000_recreate_tasks_v_with_completed_at.js` (base column list); `20260425000000_add_slack_mins.js`; `20260501000100_add_overdue_to_instances.js`; `20260603000000`/`20260614010000` (completed_at); `20260621000000_add_implied_deadline_to_task_instances.js`; `20260622020000_expose_unplaced_reason_in_tasks_v.js`; `20260623000000_restore_end_date_in_tasks_v.js`
- **Status:** IMPLEMENTED
- **Tests:** NONE dedicated to the full projected column set (gap)
- **Source:** migration headers; rowToTask consumption (`taskMappers.js`)
- **Notes:** Template branch returns NULL for the instance-only columns (`i.unplaced_reason`→NULL, etc.). The `20260622020000` migration injects `unplaced_reason`/`unplaced_detail` into BOTH UNION branches via FROM-anchored regex on the live `SHOW CREATE VIEW` and **throws** if either branch fails to match — a deliberate guard against the silent-no-op landmine.

### [DBSS-4] `scheduled_at` (UTC DATETIME) is the single source of truth for placement; date/time/day are derived from it on read

- **Code:** `src/scheduler/runSchedule.js` header (lines 2–6); `src/slices/task/domain/mappers/taskMappers.js:rowToTask` (~199), `scheduledAtToISO` (~141), date/time/day derive at ~235 via `utcToLocal`
- **Status:** IMPLEMENTED
- **Tests:** `tests/runScheduleIntegration.test.js`; mapper covered indirectly
- **Source:** runSchedule.js doc-comment "The DB stores scheduled_at (UTC DATETIME) as the single source of truth"; ARCH spec
- **Notes:** `rowToTask(row, timezone, sourceMap, …)` derives `task.date`/`time`/`day` from `utcToLocal(scheduled_at, tz)`. **Trap (brain — dateStrings misparse):** `tasks_v` returns tz-less UTC strings (`'2026-06-14 15:00:00'`); code appends `'Z'` before `new Date(...)` to avoid local-parse +offset. Terminal-status rows are clamped so `scheduled_at` never lands in the future (`rowToTask` ~218–225).

### [DBSS-5] Placements are DERIVED ON READ from `scheduled_at`, not read from a `schedule_cache` blob (`deriveSchedulePlacements.js`)

- **Code:** `src/scheduler/deriveSchedulePlacements.js` (server mirror of FE `juggler-frontend/src/utils/derivePlacements.js`)
- **Status:** IMPLEMENTED
- **Tests:** `tests/unit/derivePlacementMode.test.js` (placement-mode derive); no direct unit test for `deriveSchedulePlacements` itself (gap — find found none referencing it)
- **Source:** file header ("W3 (DB single source)…derives placements from the SAME task list GET /api/tasks returns"); ARCH spec
- **Notes:** Routing mirrors `derivePlacements.js` exactly: `t.unscheduled || (t._unplacedReason && !t.scheduledAt)` → unplaced[]; else `t.scheduledAt` parseable → `dayPlacements[date]`; unparseable time → skipped (data anomaly); plain backlog → absent from both. The in-process MCP `get_schedule` tool no longer reads `schedule_cache`; it reuses `taskFacade.getAllTasks` and derives. tz resolved from `options.timezone` → `users.timezone` → `America/New_York`.

### [DBSS-6] `/api/schedule/placements` read endpoint REMOVED — all read consumers derive from `GET /api/tasks` (W3)

- **Code:** `src/routes/schedule.routes.js:48-55` (explicit "REMOVED (W3 DB single source)" comment; route deleted); `getSchedulePlacements` / `hydratePlacements` / `injectTerminalPlacements` removed (runSchedule.js header note ~182-185)
- **Status:** IMPLEMENTED
- **Tests:** NONE asserting absence of the route (gap)
- **Source:** schedule.routes.js inline comment; WBS W3 acceptance ("no view calls /schedule/placements")
- **Notes:** `POST /api/schedule/run` still returns `dayPlacements`/`unplaced` *inline from the same run* (convenience), but no separate GET read path remains. FE `CalendarView`/`DayView`/`ConflictsView` and both MCP get_schedule paths now source from the DB instance read.

### [DBSS-7] W1 — scheduler persists FULL per-instance state including `unplaced_reason`/`unplaced_detail` onto the row

- **Code:** `runSchedule.js` unplaced persist (~1580, ~1678-1682 `unplacedDbUpdate`, ~1740 fixed-event path); delta flushed via `_runScheduleCommand.persistDelta(trx, userId, pendingUpdates, {instanceOnly:true})` (~1896) → `KnexScheduleRepository.writeChanged`; `rowToTask` surfaces them as `_unplacedReason`/`_unplacedDetail` (taskMappers.js ~440-446)
- **Status:** IMPLEMENTED
- **Tests:** `tests/runScheduleIntegration.test.js`; WBS W1 specifies a characterization test for placement persistence
- **Source:** WBS W1 row; rowToTask comment "DB-single-source (W1): the scheduler persists why an instance is unplaced onto the row"
- **Notes:** `pendingUpdates` write the two reason columns and OR-confirm `overdue`/`unscheduled`. Clock is `this.clock.now()` (NOT `db.fn.now()` — circular-JSON veto). The Unplaced view chips populate from the DB columns, not in-memory scheduler output.

### [DBSS-8] `unplaced_reason` / `unplaced_detail` materialized columns added to `task_instances` and exposed in `tasks_v`

- **Code:** migration `20260622010000_add_unplaced_reason_to_task_instances.js` (columns); `20260622020000_expose_unplaced_reason_in_tasks_v.js` (view, both branches, throws if anchor fails)
- **Status:** IMPLEMENTED
- **Tests:** NONE dedicated (gap)
- **Source:** migration headers; WBS W1/W3
- **Notes:** Step 1 of the ARCH plan (migration `20260622010000`) was committed first on the branch (juggler HEAD aeb0bce per WBS Intent).

### [DBSS-9] `slack_mins` materialized column — persisted by scheduler but DROPPED by the live batched write path

- **Code:** column migration `20260425000000_add_slack_mins.js`; scheduler sets `dbUpdate.slack_mins = result.slackByTaskId[t.id]` (runSchedule.js ~1582, ~1680); `rowToTask` reads `slackMins` (taskMappers.js ~427); BUT skip-comparison note at runSchedule.js ~481-488 states the legacy batched persist "silently drops slack_mins from the CASE update even when dbUpdate carries it"
- **Status:** PARTIAL / CONTRADICTED
- **Tests:** NONE covering slack_mins persistence (gap; the comment documents the divergence rather than a test)
- **Source:** runSchedule.js inline comment (lines ~481-488)
- **Notes:** **Contradiction to surface:** the scheduler *computes and attaches* `slack_mins`, and `rowToTask` *reads* it, but the write path does NOT actually persist it — so `placementMatchesDbRow` intentionally excludes `slack_mins` from its skip comparison to avoid perpetual redundant writes. Whether this moved into `KnexScheduleRepository.writeChanged` (the H6/W3 "sole delta-write impl") with the same drop needs confirmation against that file. Read consumers see stale/NULL `slack_mins`.

### [DBSS-10] `implied_deadline` DATE column materialized during the expand/reconcile INSERT pass (R50.7)

- **Code:** column migration `20260621000000_add_implied_deadline_to_task_instances.js`; written in Phase-1 chunk-insert at `runSchedule.js:1069-1089` (`recurringPeriodEndKey(masterRow.recur, occDate)` → `implied_deadline` field of the insert row); helper `recurringPeriodEndKey` at runSchedule.js:226; projected into `tasks_v` by the `20260621000000` migration's view recreate
- **Status:** IMPLEMENTED
- **Tests:** NONE referencing `implied_deadline` in tests (gap — find returned no test files)
- **Source:** runSchedule.js:1064 comment ("W3 (R50.7): materialize the recurring implied deadline onto the row"); ADR Decision 4 ("A new nullable task_instances.implied_deadline DATE column is written during the existing expand/reconcile insert pass")
- **Notes:** Materialized (not a generated column) because the recurrence-period end is NOT SQL-expressible — it needs JS recurrence classification. Null when not recurring or no occurrence date. Queryable in SQL for future analytics. Recomputed inline (`recurringPeriodEndKey(t.recur, effectiveDate)`) in the auto-miss path (~1816) as well.

### [DBSS-11] Computed-on-read `overdue` — `rowToTask` ORs the stored flag with a read-time predicate (R50.6 / W4)

- **Code:** `taskMappers.js:rowToTask` overdue IIFE (~334-380); compares now vs (hard `deadline` OR materialized `implied_deadline` OR FIXED `scheduled_at`)
- **Status:** IMPLEMENTED
- **Tests:** NONE dedicated to the read-time overdue predicate found (gap)
- **Source:** taskMappers.js comment "W4 (R50.6): computed-on-read overdue — OR-ed with the stored flag"; ADR Decisions 1 & 3 (compute STATUS on read for display; keep the stored flag)
- **Notes:** Stored flag short-circuits (`if (!!row.overdue) return true`). Gates: floating/no-deadline/no-implied/non-FIXED → stored flag only; FIXED → `scheduled_at` is the hard due; recurring with no materialized `implied_deadline` → no computed overdue; ANYTIME without hard commitment → no computed overdue (same gate as `computeIsPastDue`). Frozen recurring instances must not compute overdue. Decision 6: NO read-triggered reschedule — read computes display status only.

### [DBSS-12] `completed_at` materialized column projected in `tasks_v`; `rowToTask` surfaces it

- **Code:** migration `20260603000000` (failed regex no-op) → `20260614010000_recreate_tasks_v_with_completed_at.js` (fix); `rowToTask` `completedAt: row.completed_at ? scheduledAtToISO(...) : null` (taskMappers.js ~284); scheduler writes `completed_at` on `status:'missed'` auto-miss (runSchedule.js ~missed path)
- **Status:** IMPLEMENTED
- **Tests:** `src/scheduler/__tests__/20260509000300_add_missed_status_and_completed_at.test.js`
- **Source:** migration headers; ROADMAP 999.308a
- **Notes:** A missed PLACED instance is frozen at its last real slot and `completed_at = missedAt` (LOCKED design 999.808). DB CHECK constraint requires non-null `scheduled_at` for terminal statuses, so auto-miss falls back to window-close/occurrence-midnight when never placed.

### [DBSS-13] `unscheduled` flag column — set on unplaceable, cleared on (re)placement

- **Code:** migration `20260405300000_add_unscheduled.js`; scheduler sets `unscheduled:1` on unplaced (runSchedule.js ~1580/1678) and clears (`unscheduled:null`) when an item is (re)placed (~1705); reconcile delete sets `unscheduled:1` as a safety-net flag (~958); `rowToTask` `unscheduled: !!row.unscheduled` (taskMappers.js ~333)
- **Status:** IMPLEMENTED
- **Tests:** covered in `tests/runScheduleIntegration.test.js` indirectly
- **Source:** runSchedule.js persist passes; ARCH invariant ("placed / overdue / unplaceable")
- **Notes:** Phase 9 has a clear-stale pass: items not unplaced this run get `unscheduled:null, unplaced_reason:null, unplaced_detail:null` so a flag from a prior run does not persist indefinitely (~1700-1716). `_flagOf` treats null and 0 as the same "on the calendar" state.

### [DBSS-14] Persist-once / fabricate-once — recurring chunks pre-INSERTed once (Phase 1), then UPDATEd, not re-INSERTed every run

- **Code:** runSchedule.js Phase 1 pre-insert block (~1049-1130, `tasksWrite.insertTasksBatch`); placed chunks then "flow through pendingUpdates as UPDATEs like any other recurring instance" (~1880-1896)
- **Status:** IMPLEMENTED
- **Tests:** `tests/runScheduleIntegration.test.js`; `tests/reconcileSplits.test.js`
- **Source:** runSchedule.js comments; brain (juggler master/instance redesign — "UPSERT-not-reINSERT")
- **Notes:** Phase 1 pre-inserts all new chunk rows BEFORE scheduling (so the scheduler sees real rows); a defensive dedup checks `whereIn('id', …)` and filters collisions before insert (structurally impossible given the `existingPendingIds` filter, but guards future regressions). Subsequent runs find the rows and UPDATE them, preserving IDs.

### [DBSS-15] Deterministic instance IDs — chunk/occurrence IDs derived from `masterId` + date + split ordinal, stable across runs

- **Code:** `runSchedule.js` ~636-643 comment ("Chunk IDs are deterministic: split_ordinal=1 → `<masterId>-YYYYMMDD`; split_ordinal=N>=2 → `<masterId>-YYYYMMDD-N`"); chunk plan from `computeChunks` (`src/lib/reconcile-splits.js`)
- **Status:** IMPLEMENTED
- **Tests:** `tests/reconcileSplits.test.js`; `tests/reconcileOccurrences.test.js`
- **Source:** runSchedule.js inline comment; reconcile-splits.js header
- **Notes:** All chunks of one occurrence share the same `occurrence_ordinal`. Determinism is what lets the reconcile pass match existing rows and preserve `cal_sync_ledger` bindings, completion state, and ordinals across re-chunking instead of churning IDs.

### [DBSS-16] Reconcile pass — date-based matching preserves instance IDs/ordinals; unmatched existing → delete, unmatched targets → insert (`reconcileOccurrences.js`)

- **Code:** `src/scheduler/reconcileOccurrences.js` (`buildExistingGroups`, `matchOccurrences`); invoked from `runSchedule.js` (`var reconcile = require('./reconcileOccurrences')` ~176; unified expand+split reconcile ~636)
- **Status:** IMPLEMENTED
- **Tests:** `tests/reconcileOccurrences.test.js`; `tests/reconcileSplits.test.js`
- **Source:** reconcileOccurrences.js header ("preserve instance IDs + occurrence_ordinals across scheduler runs")
- **Notes:** Pure function (no DB access) — consumes rows, returns an assignment report the caller applies. Matches existing groups to targets by exact-date first then nearest-first. Cal-linked rows (`gcal_event_id`/`msft_event_id`) are EXCLUDED from group-building and routed through the id-based diff so outbound sync stays correct. Replaces an earlier two-pass (expand-then-split) design that thrashed.

### [DBSS-17] Reconcile DELETE/drift pass — stale recurring instances soft-flagged + deleted; drifted rows CASE-updated

- **Code:** runSchedule.js "DB reconcile: deletions and drift-fixes only" (~951-996): `toDeleteIds` → `db('task_instances').update({unscheduled:1})` (via raw `db`, not `trx`, so the safety flag survives a rollback) then `deleteTasksWhere(trx,…)`; `toUpdate` → batched CASE-WHEN drift-fix on `split_ordinal`/`split_total`/`dur`, chunked at 200 (`DRIFT_CHUNK`)
- **Status:** IMPLEMENTED
- **Tests:** `tests/reconcileOccurrences.test.js` (matching logic); delete/drift application covered by `tests/runScheduleIntegration.test.js`
- **Source:** runSchedule.js inline comments
- **Notes:** Inserts are DEFERRED (chunks built in memory for the scheduler; Phase-1 pre-insert handles new rows). The reconcile pass only deletes stale + fixes drift. The pre-delete `unscheduled:1` write uses the non-transactional `db` handle deliberately so the safety-net flag survives a lock-timeout rollback of the main transaction.

### [DBSS-18] `pendingUpdates` is the single in-memory write queue; flushed once via the sole delta-write impl (H6/W3)

- **Code:** runSchedule.js — every persist decision pushes `{id, dbUpdate}` to `pendingUpdates`; single flush `await _runScheduleCommand.persistDelta(trx, userId, pendingUpdates, {instanceOnly:true})` (~1896); `placementMatchesDbRow` (~404-489) skips unchanged rows before flush
- **Status:** IMPLEMENTED
- **Tests:** `tests/runScheduleIntegration.test.js`
- **Source:** runSchedule.js comment "H6 / W3 — flush the changed-rows delta through the SOLE delta-write impl … there is now ONE delta-write impl, not two"
- **Notes:** The inline knex flush (batched `scheduled_at`/`dur` CASE update chunked at 200 + per-row `otherUpdates` loop) was moved verbatim INTO `KnexScheduleRepository.writeChanged`, collapsing two write paths to one. `instanceOnly:true` preserves the "never overwrite user-set master.dur" routing. trx-bound → commits/rolls back with the caller. `placementMatchesDbRow` normalizes scheduled_at to epoch-ms, date to `YYYY-MM-DD`, time to `HH:MM:SS`, flags via `_flagOf`, and compares `unplaced_reason` — but NOT `slack_mins` (see DBSS-9).

### [DBSS-19] W4 — `schedule_cache` full removal NOT landed; the WRITE survives as an internal cal-sync-only detail

- **Code:** `schedule_cache` write still present: `runSchedule.js:1968` (insert in run path), `~2001-2003` (update/insert in `runScheduleAndPersist` trx), `~2574-2576` (alternate write); reads remain at `~2161`, `~2389`, `~2572`. Header note runSchedule.js:182-185: "The schedule_cache WRITE … (an internal detail only cal-sync reads) is unaffected"
- **Status:** PARTIAL / PLANNED (W4 read-path removal done; full removal BLOCKED)
- **Tests:** NONE asserting schedule_cache is gone (and it is not — so n/a)
- **Source:** WBS Wave 4 ("remove schedule_cache write") + ARCH Target ("No schedule_cache read model"); runSchedule.js header note; the live grep showing the write persists
- **Notes:** **Blocked per W4:** full removal was gated on persisting per-split-part (per-block) placements as first-class rows so cal-sync no longer needs the cache's per-block split-placement map. Until each split part's placement is durably on its own instance row, cal-sync still reads `schedule_cache` for per-block placements. The READ model for *display* no longer uses it (DBSS-5/-6 done); the cache is now write-only-for-cal-sync. This is the one open contradiction vs the ARCH Target's "schedule_cache gone with no remaining reader."

### [DBSS-20] W2 — overdue↔unplaceable partition + FIXED anchor (structural one-state invariant)

- **Code:** `src/scheduler/unifiedScheduleV2.js` (~348-378) deadline-based partition; FIXED-event anchor (R50.0 — a fixed/ingested-calendar event's `scheduled_at` IS its hard due, runSchedule.js ~105)
- **Status:** IMPLEMENTED (per WBS wave ordering; verify against unifiedScheduleV2 current line numbers — file is 119 KB and actively edited)
- **Tests:** `tests/runScheduleIntegration.test.js`; scheduler golden-master suites under `src/slices/scheduler/`
- **Source:** WBS W2 row; DESIGN-RULING-overdue-vs-unplaceable.md (referenced by WBS)
- **Notes:** OVERDUE = had a placement + deadline past + can't re-slot → keep prior `scheduled_at`/time, `overdue=1`, NOT unplaced. UNPLACEABLE = deadline not past + crowded out → `unscheduled=1`, no `scheduled_at`. Replaces the old "window past today → dual-place in unplaced+grid" that produced the "placed AND unplaced" anomaly. This is what makes the DBSS-1 one-row-one-state invariant hold.

### [DBSS-21] Past-due auto-miss writes terminal `status:'missed'` with frozen slot (juggler-cal-history Plan C / R50.0 / 999.808)

- **Code:** runSchedule.js auto-miss block (~1750-1845): recurring past + outside both timeFlex window and recurrence-period boundary → `status:'missed'`, `scheduled_at=missedAt`, `completed_at=missedAt`; non-recurring past unplaced → date moved to today (`todayMidnight`)
- **Status:** IMPLEMENTED
- **Tests:** `src/scheduler/__tests__/20260509000300_add_missed_status_and_completed_at.test.js`; migration `20260606000000`/`20260609000000` add the `missed` enum value
- **Source:** runSchedule.js comments (Plan C); brain (recurring overdue lifecycle design; overdue past-due R50)
- **Notes:** `effectiveDate` uses the raw DB `date` column when `scheduled_at` is null (never-placed instance) so a never-placed past occurrence still becomes missed (BUG-142 PATH B/C). Frozen at the last real slot when placed (parse bare DB string with appended `'Z'` as UTC). `missed` distinguishes a system-applied miss from a user `skip`.

---

## SUMMARY

**Total behaviors:** 21.

**By status:**
- IMPLEMENTED: 17 (DBSS-1, -2, -3, -4, -5, -6, -7, -8, -10, -11, -12, -13, -14, -15, -16, -17, -18, -21) — *count note: 18 fully-clean rows*
- PARTIAL / PLANNED: 2 (DBSS-9 slack_mins persistence drop; DBSS-19 W4 schedule_cache full removal — BLOCKED on per-split-part placement persistence)
- PARTIAL-verify: 1 (DBSS-20 W2 partition — implemented per wave order; line numbers in the 119 KB `unifiedScheduleV2.js` not re-confirmed this pass)
- CONTRADICTED: 1 surfaced inside DBSS-9 (scheduler computes + mapper reads `slack_mins`, but the write path drops it)

(Recount: 18 IMPLEMENTED, 2 PARTIAL/PLANNED, 1 PARTIAL-verify, with 1 contradiction embedded in DBSS-9.)

**Top gaps:**
1. **W4 not complete (DBSS-19):** `schedule_cache` write persists at `runSchedule.js:1968 / ~2001-2003 / ~2574-2576` with live reads at `~2161 / ~2389 / ~2572`. The ARCH Target "schedule_cache gone with no remaining reader" is unmet; blocked on persisting per-split-part (per-block) placements as instance rows so cal-sync stops reading the cache. The display read path IS off the cache (done).
2. **`slack_mins` write contradiction (DBSS-9):** the column is materialized in schema and scheduler+mapper handle it, but the batched persist silently drops it; `placementMatchesDbRow` excludes it from skip-comparison to avoid perpetual redundant writes. Read consumers see stale/NULL slack. Needs a decision: persist it or stop computing it.
3. **Thin test coverage on the read model itself:** no dedicated tests found for `deriveSchedulePlacements.js`, the `tasks_v` projected-column set, `implied_deadline`, `unplaced_reason`/`detail`, or the read-time-overdue predicate in `rowToTask`. Reconcile (`reconcileOccurrences.test.js`, `reconcileSplits.test.js`) and run integration (`runScheduleIntegration.test.js`) are covered; the persistence-to-read mapping layer is under-tested.

**Read-model / table contradictions:**
- Prod = views (`tasks_v`, `tasks_with_sync_v`) over `task_masters` + `task_instances`; the flat `tasks` table is dropped (`20260415010900`). Any code path assuming a `tasks` table is dead on prod.
- `tasks_v` template branch returns NULL for instance-only columns (overdue/unplaced/slack/scheduled_at) — consumers must treat a `recurring_template` row as a blueprint, never as a schedulable/placeable item (`rowToTask` orphan-guard + status gates enforce this).
- The single remaining read-model contradiction is DBSS-19 (cache still has a reader: cal-sync). Everything else converges on the DB-single-source invariant: one instance row, one state.

---

# Scheduler Spec — Section E: Calendar Sync ↔ Scheduler Coupling

**Scope:** How GCal / Microsoft / Apple (CalDAV) calendar sync couples to the
scheduler — the `cal_sync_ledger` edit-lock model, origin-aware locking, status
transitions (`active` / `deleted_local` / `deleted_remote` / `replaced`),
push/pull, split-task-part sync, simultaneous-sync DB contention, the `task.url`
"Link:" body, native vs synced rows, `miss_count` / `MISS_THRESHOLD`, and ingested
events feeding the scheduler as FIXED tasks. Reconciled against code on
`juggler/juggler-backend` (branch `main`, superrepo `main`) as of 2026-06-23.

Paths below are relative to `juggler/juggler-backend/`. Primary sync orchestrator
is `src/controllers/cal-sync.controller.js` (`sync()`, 2554 lines, single endpoint
syncing all connected providers in one pass).

---

### [CAL-1] An active `cal_sync_ledger` row binds a task to one provider event; `(user, provider, task_id)` is unique among active rows (`active_task_key`), so a task has at most one active ledger row per provider
- **Code:** `db/migrations/20260428000100_ledger_active_unique_constraint.js`; ledger insert dedup at `controllers/cal-sync.controller.js:2143-2162` (`onConflict().ignore()`); active-row load `cal-sync.controller.js:332-340`
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/10-sync-push.test.js`, `tests/cal-sync/19-sync-multi.test.js`
- **Source:** soak docs (per-provider `GROUP BY status`); brain (cal-sync.controller header)
- **Notes/gaps:** The unique constraint applies to active rows only; multiple `deleted_local`/`replaced` rows for the same key may coexist. Within-run insert dedup (last-wins) at L2143 guards against concurrent runs racing the same task into two active rows (the documented bug #5 hazard, CAL-15).

### [CAL-2] Ledger `origin` is `'juggler'` for tasks Juggler created/pushed, or the provider id (`gcal`/`msft`/`apple`) for events pulled in from a provider — origin governs who "wins" on conflict
- **Code:** `JUGGLER_ORIGIN = 'juggler'` at `cal-sync.controller.js:30`; pull-new origin assignment `cal-sync.controller.js:1723` (`existingTask.id.startsWith(pid+'_') ? pid : 'juggler'`), `:1759-1760`, `:1796-1797`
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/14-sync-promotion.test.js`, `tests/cal-sync/19-sync-multi.test.js`
- **Source:** code comment "Only push to events WE created (origin=juggler)…provider-origin are read-only" (`:796-799`)
- **Notes/gaps:** Origin is the linchpin of every conflict rule below. Juggler only pushes/deletes events where `ledger.origin === JUGGLER_ORIGIN`; provider-origin rows are read-only from Juggler's side except for pull-refresh.

### [CAL-3] Edit-lock model: a task with any active **provider-origin** ledger row is `cal_locked=1` (calendar-born) and surfaced to the scheduler/UI as locked
- **Code:** `slices/task/adapters/KnexTaskRepository.js:162-193` (single-task), `:223-271` (batch hydrate), `:322-365`; `cal_locked` defaults 0, set 1 when `lr.origin && lr.origin !== 'juggler'`; mapped `calLocked` at `slices/task/domain/mappers/taskMappers.js:314`
- **Status:** IMPLEMENTED
- **Tests:** `tests/slices/task/adapters/KnexTaskRepository.test.js`; `InMemoryTaskRepository.js:122` carries `cal_locked`
- **Source:** brain note "juggler cal-lock is ledger-only" (lock = active ledger row, origin-aware)
- **Notes/gaps:** The lock is **origin-aware**: a juggler-pushed event (origin=juggler) does NOT set `cal_locked`. Only provider-born rows lock. This is the fix recorded in brain (`dc5a2a6`): lock now only fires for `origin<>'juggler'` active rows, computed by direct ledger query (no view migration).

### [CAL-4] Edit-lock enforcement: mutating a provider-origin (calendar-born) task's scheduling fields is blocked with HTTP 403 (`calSyncGuard`); deleting one is blocked with 403 `PROVIDER_ORIGIN_DELETE_BLOCKED`
- **Code:** guard build/propagation `slices/task/facade.js:778` (`return { calSyncGuard }`), `:873` (`_batchErr.calSyncGuard`); 403 emit `slices/task/application/commands/BatchUpdateTasks.js:104-105,127-128`; delete block `slices/task/application/commands/DeleteTask.js:109-123` (message "This task came from <provider>. To remove it, delete it from <provider> directly.")
- **Status:** IMPLEMENTED
- **Tests:** `tests/slices/task/application/commands-status-delete-misc.test.js`, `commands.db.test.js`
- **Source:** code (DeleteTask provider-origin block); brain (lock model)
- **Notes/gaps:** Ingest-only mode has a separate delete block (`INGEST_DELETE_BLOCKED`, `DeleteTask.js:100-106`). `takeOwnership` is the escape hatch: it detaches the ledger (sets active→`deleted_local`) so the task becomes Juggler-editable (`facade.js:968 detachLedger`).

### [CAL-5] Ledger status lifecycle: `active` → `deleted_local` (Juggler removed the local task / will delete the remote event) / `deleted_remote` (provider deleted the event) / `replaced` (row superseded by a newer row for the same key)
- **Code:** `deleted_local` transitions throughout `cal-sync.controller.js` (e.g. `:731`, `:790`, `:1061`, `:1178`, `:1407`, `:1423`); `replaced` at `:680`, `:1081`; `deleted_remote` at `:1124`, `:1152`, `:1261`, `:1291`; orphan cleanup of `deleted_local` rows with null `provider_event_id` `:2174-2176`
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/10-sync-push.test.js`, `tests/unit/lib/cal-sync-helpers.test.js`
- **Source:** soak docs (skip → `deleted_local`; delete → `deleted_local` then orphan cleanup)
- **Notes/gaps:** `replaced` specifically avoids the `active_task_key` unique-constraint violation when a healed/re-created task would otherwise collide with an existing active row (`:673-680`). Status enum constraints were repaired in `db/migrations/20260624000000_fix_stale_status_enum_constraints.js`.

### [CAL-6] Safe-unlock pattern: setting an active ledger row to `deleted_local` (not deleting it) unlocks the task while preserving audit history
- **Code:** `detachLedger` `facade.js:968-972` (status→`deleted_local`, `synced_at=now()`); pause/unpause toggles active↔deleted_local `facade.js:446-449,519-521`; `resetRecurringInstances` clears active→deleted_local on cadence/split edits `lib/tasks-write.js:414-427`
- **Status:** IMPLEMENTED
- **Tests:** `tests/slices/task/facade.collaborators.db.test.js`
- **Source:** brain "juggler cal-lock is ledger-only" (safe unlock = status→'replaced'/'deleted_local', not deleted)
- **Notes/gaps:** Brain historically noted unlock via `'replaced'`; current code uses `deleted_local` for detach/reset. Both are non-destructive (row retained). A subsequent push that re-matches title+date can re-create an active row and re-lock.

### [CAL-7] Sync runs in two phases: a lock-free **fetch** phase (provider API reads, user/MCP edits flow normally) then a **write** phase under a per-user lock that holds the DB stable through one transaction
- **Code:** write-phase lock acquire `cal-sync.controller.js:1954-2008`; transaction `:2080-2196`; lock release `:2196-2198`; lock primitives `lib/sync-lock.js`
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/20-sync-lock.test.js`
- **Source:** code comment "Acquire per-user lock for the write phase only" (`:1963-1966`)
- **Notes/gaps:** The lock deliberately covers only the write phase to minimize contention against the scheduler and user edits during slow provider I/O.

### [CAL-8] Per-user DB-backed sync lock gates ALL scheduling-relevant writers (scheduler, cal-sync, user/MCP task mutations via task-write-queue) so only one mutates scheduling fields at a time
- **Code:** `lib/sync-lock.js` — `acquireLock` (atomic INSERT with dup-key rejection, `:28-58`), `LOCK_TTL_SECONDS=30` (`:21`), heartbeat `refreshLock`, `MAX_LOCK_AGE=5min` safety cap (`:24`), background sweep of expired locks via MySQL `NOW()` (`:176-188`), `isLocked()` fast check (`:78`)
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/20-sync-lock.test.js`
- **Source:** brain (sync-lock.js header: "Gates all scheduling-relevant writers…Only one of these can modify scheduling-relevant task fields at a time")
- **Notes/gaps:** All time comparisons use MySQL `NOW()` (not JS `Date`) to dodge the `dateStrings` timezone trap (cross-refs brain "dateStrings newDate misparse"). Pre-release flush (`flushQueueInLock`) drains queued task writes before releasing so the scheduler can't grab the lock between release and flush (`:162-172`).

### [CAL-9] Write phase re-reads the ledger AFTER acquiring the lock to detect rows another sync inserted between phase-1 read and lock acquisition (Bug #5 mitigation)
- **Code:** `cal-sync.controller.js:1971-1995` (post-lock ledger re-read + merge); up to `MAX_LOCK_ATTEMPTS=8` with exponential backoff+jitter (`:1966-2002`)
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/19-sync-multi.test.js`, `20-sync-lock.test.js`
- **Source:** code comment "Fix Bug #5: Re-read ledger after lock to detect concurrent sync changes" (`:1971-1973`)
- **Notes/gaps:** Partial mitigation of the simultaneous-sync hazard; the residual DB-contention issue (CAL-15) is still listed as open in CLAUDE.md.

### [CAL-10] Write-phase lock-loss safety: a heartbeat refreshes the lock; if a refresh returns 0 rows (expired/stolen) or 120s elapses, the write phase aborts before the transaction and returns 503 (retryAfter)
- **Code:** heartbeat `cal-sync.controller.js:2011-2031`; pre-transaction abort guard `:2073-2078` (503 "Sync lock lost. Please retry."); lock-conflict-after-8-attempts emits `sync:lock_conflict` SSE + 503 "Scheduler is busy" (`:2003-2007`)
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/20-sync-lock.test.js`
- **Source:** code
- **Notes/gaps:** Prevents a stale writer from committing over a concurrent scheduler run that stole the lock.

### [CAL-11] Ingested calendar events become FIXED (`placement_mode='fixed'`) tasks that the scheduler treats as hard, immovable commitments
- **Code:** ingest-only pull sets `placement_mode=FIXED` `cal-sync.controller.js:979-986`; pull-new event placement_mode derivation `:1899` (transparent→reminder, allDay→all_day, else fixed); promotion-on-move `:941-946`; scheduler treats FIXED as user-anchored — never moved: `scheduler/runSchedule.js:1417`, `:1567`, `:1728`, `:1800-1801`, `:2019-2021`
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/14-sync-promotion.test.js`, `tests/runScheduleIntegration.test.js`
- **Source:** code comment "Ingest-only providers pull events into tasks (as placement_mode='fixed')" (`:129`); SCHEDULER.md:254
- **Notes/gaps:** Scheduler couples to sync purely through `placement_mode`: a FIXED task's `scheduled_at` IS its hard due time (`runSchedule.js:105-110`), it is excluded from placement reflow, and per R50.1/R50.2 a past-due FIXED/ingested event is persisted `overdue=1` on its day rather than moved (`runSchedule.js:1719-1739`).

### [CAL-12] A provider event moved/edited on the calendar pulls back into the task; a genuine date/time move promotes the task to FIXED (calendar wins for provider-origin)
- **Code:** pull-edit branch `cal-sync.controller.js:991-1019` (provider-origin, non-terminal: refresh from provider); promotion detection `:941` (`pullFields.placement_mode === FIXED`); `_buildPullFields`/`applyEventToTaskFields` `:122`
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/14-sync-promotion.test.js`, `tests/cal-sync/characterization/bug-adapter-promotion-flex.test.js`
- **Source:** code comment "change-detection already sets FIXED when date/time genuinely changed…title/duration-only changes would spuriously promote" (`:1009-1010`)
- **Notes/gaps:** Title/duration-only edits do NOT promote to FIXED (avoids spurious pinning). Fixed-or-terminal Juggler tasks instead push OVER a calendar edit (Juggler wins) and log a conflict (`:869-882`).

### [CAL-13] `task.url` is pushed into the provider event body as a `"Link: <url>"` line, uniformly across GCal / MSFT / Apple
- **Code:** `slices/calendar/adapters/GoogleCalendarAdapter.js:248`, `slices/calendar/adapters/MicrosoftCalendarAdapter.js:322`, `lib/apple-cal-api.js:230` — all `if (task.url) descParts.push('Link: ' + task.url)`
- **Status:** IMPLEMENTED
- **Tests:** soak A7 across all three providers (GCal ✅, MSFT ✅, Apple ⚠️ CDN-lag)
- **Source:** CLAUDE.md "Fix applied 2026-04-26: buildMsftEventBody and buildAppleEventBody now include task.url as 'Link: …' (matched GCal behavior)"
- **Notes/gaps:** MSFT and Apple originally omitted the link; parity fix landed 2026-04-26. Pure body/display detail — no scheduler coupling.

### [CAL-14] Native (provider-origin) rows vs synced (juggler-origin) rows are handled asymmetrically: Juggler pushes/deletes only juggler-origin events; provider-origin events are pull-only and skip Juggler-initiated deletes
- **Code:** push guard `cal-sync.controller.js:799` (`ledger.origin === JUGGLER_ORIGIN && !isIngestOnly`); past-cleanup/unscheduled-delete guards `:713`, `:782`; round-trip prevention skip for juggler-originated pulled events `:1776`
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/19-sync-multi.test.js`
- **Source:** code comment "Events pulled from a provider (origin=pid) are read-only from Juggler's perspective" (`:796-799`)
- **Notes/gaps:** Round-trip prevention (`:1776`) stops a juggler-pushed event from being re-pulled as a new provider-origin task.

### [CAL-15] `miss_count` / `MISS_THRESHOLD=3`: an event missing from a provider's listing accrues `miss_count`; only after 3 consecutive misses is the task removed (CDN-lag tolerance) — multi-provider rows are kept if the event still exists on another provider
- **Code:** `MISS_THRESHOLD = 3` at `cal-sync.controller.js:34`; CDN grace `withinCdnGrace()` `:42`; miss accumulation/threshold `:1102-1163`; multi-provider keep-task branch `:1110-1130` (`hasOtherActive` → `deleted_remote`, task kept); juggler-origin miss-guard `:1070-1093` (miss_count>=1 → replaced; ==0 → bump to 1); migration `db/migrations/20260402100000_add_miss_count_to_ledger.js`; reset to 0 on re-find `:760`, `:1034`
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/19-sync-multi.test.js` (multi-provider interference)
- **Source:** code comment "a missing event is treated as CDN lag rather than a deletion…catastrophically deleted after MISS_THRESHOLD syncs" (`:37`, `:1050-1051`); CLAUDE.md (B5 MISS_THRESHOLD ✅ PASS)
- **Notes/gaps:** **KNOWN BUG #4** — multi-provider MISS_THRESHOLD interference (CLAUDE.md, "Apple soak status 2026-04-26"). The juggler-origin `miss_count >= 1` guard (`:1070`) is the documented fix for the Apple repush-loop (Bug #2, now FIXED).

### [CAL-16] Split-task-part sync: the scheduler chunks a long task into N parts, but only ONE provider event is created per task in production — per-part fan-out exists in the sync controller but `reconcileSplitsForUser` is NOT wired into the production scheduler path
- **Code:** per-part fan-out (theoretical) `cal-sync.controller.js:511-562` (`splitPlacements`), `:1468-1493` (one event per split placement, id `<taskId>_part<N>`), contiguous-split merge `:385-458`, non-split→split ledger replacement `:1387-1432`; reconcile logic `lib/reconcile-splits.js` (`reconcileSplitsForUser` restricted to `recurring:0`, `:197-222`)
- **Status:** KNOWN-BUG (PARTIAL implementation)
- **Tests:** `tests/cal-sync/17-sync-split.test.js`, `tests/unit/split-sync.test.js`
- **Source:** CLAUDE.md "Known remaining issues: …split task part sync"; soak A12 across all providers: "`reconcileSplitsForUser` not wired — only 1 event pushed (known gap)"
- **Notes/gaps:** **KNOWN OPEN BUG.** Soak A12 (GCal/MSFT/Apple) all confirm only 1 event pushed for a 3-chunk split. The controller has the machinery to push N part-events but it depends on placement-cache split data that production does not populate, because `reconcileSplitsForUser` (which would persist chunks as first-class `task_instances`) is not called in the live scheduler transaction. Cross-refs brain "recurring-instance timebox" split history.

### [CAL-17] Apple (CalDAV): `provider_event_id` stores the CalDAV URL, and events are indexed by BOTH UID and `_url` so ledger lookups and dedup work regardless of which key was stored; deletes use `_url` when present
- **Code:** dual-key index `cal-sync.controller.js:289-292`; URL/UID sibling-skip on pull-new `:1701-1713`; delete via `event._url || ledger.provider_event_id` (`:725`, `:784`, `:1173`, `:1821`); `event_url` column `db/migrations/20260517000100_add_event_url_to_cal_sync_ledger.js`
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/02-adapter-msft.test.js` (adapter parity); Apple soak (partial — CDN lag)
- **Source:** code comment "Apple events: provider_event_id stores the CalDAV URL, not the UID — index by _url too" (`:289-290`)
- **Notes/gaps:** This dual-key handling is the Apple-specific seam; getting it wrong is what produced the historical repush loop.

### [CAL-18] Concurrent-write integrity: the final write phase dedups ledger inserts (last-wins) and uses `onConflict().ignore()` on `active_task_key`, plus deadlock-retry backoff, so two sync runs pushing the same task don't create duplicate active rows
- **Code:** within-run dedup `cal-sync.controller.js:2143-2162`; ledger insert `onConflict().ignore()` `:2162`; deadlock-retry backoff `facade.js:993`
- **Status:** PARTIAL
- **Tests:** `tests/schedulerRerunIdempotency.test.js`, `tests/cal-sync/19-sync-multi.test.js`
- **Source:** code comment "unique constraint on active_task_key (concurrent sync runs pushing the same task)" (`:2144-2145`)
- **Notes/gaps:** **KNOWN BUG #5** — concurrent-sync duplicate active rows (CLAUDE.md). Mitigated by CAL-9 (post-lock re-read) + this dedup, but DB contention on simultaneous syncs remains listed as an open issue. Both #4 and #5 are the residual "DB contention on simultaneous syncs" item.

### [CAL-19] Sync emits SSE progress + a post-release scheduler re-run trigger so the scheduler re-places around newly pulled/promoted FIXED events AFTER the lock is freed
- **Code:** SSE progress `cal-sync.controller.js:198 emitProgress`; lock-conflict SSE `:2005`; post-lock-release scheduler pickup comment `:2202` ("runs AFTER lock release so scheduler can pick up")
- **Status:** IMPLEMENTED
- **Tests:** `tests/runScheduleIntegration.test.js`
- **Source:** code
- **Notes/gaps:** The handoff is one-directional through the lock: sync writes FIXED/promoted tasks, releases the lock, then the scheduler reflows floating tasks around them. See `docs/architecture/SYNC-EVENT-TO-TASK-HANDOFF.md`.

### [CAL-20] Declined/deleted invites are removed via the same generic MISS_THRESHOLD ladder (CAL-15): all three provider adapters filter out events the signed-in user has declined from `listEvents`, so a declined invite reads as "missing" and ages out after 3 consecutive misses like any other deleted event
- **Code:** Google `slices/calendar/adapters/GoogleCalendarAdapter.js:80-86` (`attendees[].self.responseStatus === 'declined'`, null-guarded per element); Microsoft `slices/calendar/adapters/MicrosoftCalendarAdapter.js:130-138` (`event.responseStatus.response === 'declined'` — Graph exposes the signed-in user's own RSVP directly, no attendees array needed); Apple `slices/calendar/adapters/AppleCalendarAdapter.js:93-112` + ATTENDEE/PARTSTAT parsing `lib/apple-cal-api.js:parseVEvents` (matches ATTENDEE email against `apple_cal_username`, filters `partstat === 'DECLINED'`)
- **Status:** IMPLEMENTED
- **Tests:** `tests/cal-sync/13-sync-declined-invite.test.js` (Google adapter filter + E2E MISS_THRESHOLD deletion — full coverage), `tests/cal-sync/22-sync-declined-invite-parity.test.js` (Microsoft adapter filter — full coverage, 999.1012; Apple — ICS ATTENDEE/PARTSTAT parsing only, NOT the AppleCalendarAdapter-level filter itself, see the file's own header note + backlog 999.1035; GCal null-attendee-element hardening, 999.1014)
- **Source:** BUG-999.999 (Google); 999.1010 (declined/deleted invite removal); 999.1012 (MSFT+Apple parity); 999.1014 (null-attendee hardening)
- **Notes/gaps:** No new deletion mechanism — this is CAL-15's existing `miss_count`/`MISS_THRESHOLD=3` ladder; the only change per provider is that `listEvents` no longer returns a declined event at all, so it counts as a miss. Apple's ATTENDEE parsing (`apple-cal-api.js`) previously extracted no attendee data — 999.1012 added it. **Coverage gap:** the Apple adapter-level filter (AppleCalendarAdapter.js:106-112, matching a parsed ATTENDEE against `apple_cal_username`) has no automated test — a DB-backed integration test was attempted but dropped due to a pre-existing test-bed DB flake (999.1035).

---

## SUMMARY

**Total behaviors:** 20 (CAL-1 … CAL-20)

**By status:**
- IMPLEMENTED: 15 (CAL-1,2,3,4,5,6,7,8,9,10,11,12,13,14,17,19,20 — count 17) → **17 IMPLEMENTED**
- PARTIAL: 1 (CAL-18)
- KNOWN-BUG: 1 (CAL-16 split-part sync)
- CAL-15 is IMPLEMENTED but carries a KNOWN open bug (#4 multi-provider interference)

Net: **17 IMPLEMENTED, 1 PARTIAL (CAL-18), 1 KNOWN-BUG (CAL-16), 1 IMPLEMENTED-with-open-defect (CAL-15).** 0 PLANNED, 0 CONTRADICTED.

**KNOWN open bugs (per CLAUDE.md "Known remaining issues: DB contention on simultaneous syncs, split task part sync"):**
1. **Split-task-part sync (CAL-16)** — only 1 provider event created per split task; `reconcileSplitsForUser` not wired into the production scheduler path. Confirmed by soak A12 on all three providers. `cal-sync.controller.js:1468-1493`, `lib/reconcile-splits.js:197-222`.
2. **DB contention on simultaneous syncs (CAL-18, CAL-15)** — concurrent sync runs can race the same task into duplicate active ledger rows (Bug #5) and multi-provider `MISS_THRESHOLD` interference (Bug #4). Mitigated but not closed by post-lock ledger re-read (`cal-sync.controller.js:1971-1995`) + insert dedup (`:2143-2162`).
3. **Apple CalDAV repush loop (Bug #2)** — FIXED via the juggler-origin `miss_count >= 1` guard (`cal-sync.controller.js:1070-1093`); Apple soak remains PARTIAL only because of Apple-infrastructure CDN propagation lag (>62s), not a sync defect (CLAUDE.md; `docs/testing/SYNC-SOAK-TEST-APPLE.md`).

**Top gaps / observations:**
- The scheduler couples to calendar sync through exactly two seams: (a) `placement_mode='fixed'` on ingested events (CAL-11), making them immovable hard commitments, and (b) the per-user `sync_locks` row that serializes scheduler/cal-sync/user writers (CAL-8). There is no direct scheduler→ledger read coupling beyond the `cal_locked` hydration (CAL-3).
- The edit-lock is **origin-aware** — only provider-origin active rows lock (CAL-3/CAL-4); this is correct in code but the brain note historically described unlock-via-`replaced` whereas current code detaches via `deleted_local` (CAL-6) — minor doc drift, not a contradiction.
- `docs/architecture/SCHEDULER.md` is thin on calendar sync (only line 254 mentions it); the authoritative behavior lives in `cal-sync.controller.js` + the three `docs/testing/SYNC-SOAK-TEST-*.md` files + CLAUDE.md § Calendar Sync. This spec section is the first consolidated scheduler-coupling reconciliation.
- Test coverage is solid for push/lock/multi/promotion (`tests/cal-sync/*`) and split has unit tests (`tests/unit/split-sync.test.js`, `tests/cal-sync/17-sync-split.test.js`) — but the split tests assert the controller's fan-out logic, NOT the end-to-end production path where `reconcileSplitsForUser` is unwired, which is why CAL-16's gap survives green tests.

---

# SECTION F — Scheduler In-Flight Work + Requirement/Test Gaps

_Read-only inventory · generated 2026-06-23 · juggler main tip = `505a09b` ("only DAILY recurring instances pin overdue on slot-day; weekly/flexible roam")_

Purpose: ensure no in-progress scheduler effort is orphaned. Three parts: (F1) unmerged branch inventory, (F2) requirement/test gaps from existing audit docs, (F3) planned designs not yet built.

---

## PART 1 — Unmerged Branch Inventory

10 local juggler branches are AHEAD of `main`. The 7 master-instance-redesign legs the prompt named (`persist-once-core`, `frozen-invariant`, `master-edit-refab`, `cancel-soft-delete`, `ui-split-coalesce`, `readmodel-consistency`, `rowtotask-nulltz`) are all **ahead=0 / reachable-from-main=YES** → already LANDED on main (their tips are ancestors of `505a09b`). Branches are stale labels, safe to delete.

### F1.1 Branches AHEAD of main (have unique commits)

| Branch | Tip SHA | Intent | Files touched | Status | Scheduler-relevant? |
|--------|---------|--------|---------------|--------|---------------------|
| `leg/juggler-overdue-reschedule` | `60835fe` | **WIP** recurring forward-roll + effective-deadline overdue | `unifiedScheduleV2.js` (+88), `taskMappers.js`, `runScheduleIntegration.test.js`, `roamable-recurring-forward-roll.test.js` (NEW, 1277 ln), `overdue-pastdue-recurring.test.js` (+353) | **WIP / UNMERGED** — commit is literally tagged `WIP(scheduler)`; 1801 insertions, big new test file. Most substantive orphaned scheduler work. | **YES — CORE** |
| `worktree-fix-anytime-overdue` | `e2d4a92` | ANYTIME tasks no longer marked overdue when calendar full today | `runSchedule.js` (+18) | **WIP / UNMERGED** — single tiny fix, no test. Superseded-risk: main already reworked overdue pinning (`505a09b`). Verify against main before salvage. | **YES — CORE** |
| `leg/juggler-hex-h7b-scheduler-thinning` | `e0b2c51` | Thin legacy scheduler entries onto H6 hex facade; migrate 5 inline writes through `ScheduleRepositoryPort` | `runSchedule.js` (−70 net), `InMemory/KnexScheduleRepository.js`, `RunScheduleCommand.js`, `ScheduleRepositoryPort.js`, contract+rollback tests (NEW, 574 ln) | **UNMERGED** — complete leg w/ tests (915 ins). Hexagonal refactor, not behavior. Either land or formally retire. | **YES — arch/refactor** |
| `leg/juggler-db-single-source` | `76ffb5f` | Derive calendar/unplaced views from `/tasks` DB read, not `/schedule/placements` (W3 frontend slice) | `schedule.routes.js`, `useTaskState.js`, `derivePlacements.js` (NEW) + test (338 ln) | **UNMERGED but leg-meta verdict=PASS.** This is W3 of the DB-single-source WBS (see F3). Frontend repoint only; W2/W4 not in this branch. | **YES — read-model** |
| `loop/backlog` | `b0de117` | Migration repair: stale `task_masters.status` insert + fresh `migrate:latest` broken by stale `tasks_v` view (999.311, 999.388) | migration `..0300_add_missed_status..`, migration tests | **UNMERGED** — migration/test infra, touches `tasks_v` (scheduler read view). | partial (DB/migration infra) |
| `leg/juggler-migrate-prod-guard` | `0794524` | Guard dev migrate path against production (999.302) | `migrate.js` (NEW), `assertNotProduction.js` (NEW), globalSetup, `migrateGuard.test.js` (NEW 433 ln) | **UNMERGED** — infra guard. | NO (infra) |
| `leg/juggler-h4-deadcode` | `8527f52` | Remove dead `getUserPlanId` from plan-features middleware (999.381) | `plan-features.middleware.js` (−31) | **UNMERGED** — dead-code cleanup. | NO |
| `leg/canary-bugfix-calsync-errmsg` | `69409ad` | Guard `e.message` in `deleteEvent` catch | `cal-sync-helpers.js`, test | **UNMERGED** — cal-sync bugfix (canary leg). | NO (cal-sync) |
| `leg/canary-refactor-calsync-helpers` | `1ef6a47` | Extract `emptySyncResult()` factory | `cal-sync-helpers.js` | **UNMERGED** — tiny refactor (canary leg). | NO (cal-sync) |
| `chore/gitignore-kermit-state` | `b766e1f` | Ignore transient `.planning/kermit` + tooling junk | `.gitignore` | **UNMERGED** — chore. | NO |

### F1.2 Branches the prompt named that are ALREADY LANDED (ahead=0, ancestor of main)

| Branch | Tip SHA | Delivered (per last commit) | Status |
|--------|---------|-----------------------------|--------|
| `leg/juggler-persist-once-core` | `5d22e9e` | L1 fabricate-once-persist + lock re-run idempotency guard (B2) | **LANDED** |
| `leg/juggler-frozen-invariant` | `a7978a8` | L2 pin started(wip) instances — frozen invariant (R52) | **LANDED** |
| `leg/juggler-master-edit-refab` | `7d8f2fa` | L3 master-edit refabrication — drop+reshape future not-started (R53) | **LANDED** |
| `leg/juggler-cancel-soft-delete` | `6ca3762` | L5 cancel-series soft-delete, no hard delete (R55) | **LANDED** |
| `leg/juggler-ui-split-coalesce` | `c07f5b6` | L6 coalesce adjacent split chunks into one block (R56) | **LANDED** |
| `leg/juggler-readmodel-consistency` | `7af77eb` | Unify overdue display to canonical `task.overdue` (DB-single-source W1) | **LANDED** |
| `leg/juggler-rowtotask-nulltz` | `e1cce0b` | `rowToTask` must not crash on null timezone (999.816) | **LANDED** |

---

## PART 2 — Requirement / Test Gap Reports

Sources (all under `juggler/`):
- `juggler-backend/docs/architecture/SCHEDULER-AUDIT-REQUIREMENTS.md` (208 ln)
- `juggler-backend/docs/SCHEDULER-TRACEABILITY-REPORT.md` (342 ln)
- `docs/MISSING-REQUIREMENTS-AND-TESTS-REPORT.md` (311 ln)
- `docs/TRACEABILITY-AUDIT-CONSOLIDATED.md` (317 ln)  _(TRACEABILITY-AUDIT-CURRENT.md, 807 ln, is the long-form of the same audit)_
- `docs/VERIFICATION-CHECKLIST-SUMMARY.md` (77 ln)

### F2.1 MISSING from code (spec describes, code doesn't implement)

| Requirement | Gap type | Source doc |
|-------------|----------|------------|
| **GP-3 / CL-2 — Pile-up eviction** (pinned→priority→duration eviction when day overfull) | MISSING (code prevents overlaps during placement; no post-hoc eviction). Backlog 999.506 HIGH. | SCHEDULER-AUDIT-REQUIREMENTS §Summary; MISSING-REQS M-SCH-1; CONSOLIDATED §3.3 |
| **M-SCH-2 — Frontend visual collapse of adjacent same-task chunks** | MISSING (now likely satisfied by landed L6 `ui-split-coalesce` `c07f5b6` — RECONCILE) | MISSING-REQS §3 |
| **R11.10 / R38.1 — Weather fail-closed** | BUG: code is **fail-open** (`weatherOk()` returns true when data missing); spec mandates fail-closed | VERIFICATION-CHECKLIST; CONSOLIDATED B1 (HIGH); SCHEDULER-TRACEABILITY R11.10/R39.5 |
| **R38.2 — Unplaced reason string** | BUG: wrong `_unplacedReason` string for weather | CONSOLIDATED B2 (HIGH) |
| **R36.2 — Capacity-aware offset for propagated deadlines** | NOT implemented (documented limitation) | VERIFICATION-CHECKLIST; MISSING-REQS |

### F2.2 STALE (doc ≠ code — doc needs update)

| Requirement | Gap type | Source doc |
|-------------|----------|------------|
| P0-1 — Fixed tasks: spec says `when:'fixed'`, code uses `datePinned` | STALE | SCHEDULER-AUDIT-REQUIREMENTS |
| P1-7 — Sort by priority tier: code sorts by slack across all tiers | STALE | SCHEDULER-AUDIT-REQUIREMENTS |
| SA-1 / M-SCH-3 — Deterministic IDs: spec `masterId-YYYYMMDD-N`, code ordinal `masterId-N` | STALE | SCHEDULER-AUDIT-REQUIREMENTS; MISSING-REQS §3 |

### F2.3 UNTESTED scheduler sub-requirements (~25; impl exists or claimed, zero dedicated test)

From SCHEDULER-TRACEABILITY-REPORT §2 + CONSOLIDATED domain table (verified/discrepancy/untested counts):

| Domain | Untested sub-reqs (gap) | Source |
|--------|--------------------------|--------|
| **Earliest Start (R37)** | R37.1/R37.2/R37.3 — **completely untested** (hard lower bound, earliestStart>deadline validation, field rename) | SCHEDULER-TRACEABILITY; CONSOLIDATED (3/3 untested) |
| **FlexWhen (R40)** | R40.1/R40.2/R40.3 — **completely untested** (boolean flag, fallback-ladder retry, `_flexWhenRelaxed`) | SCHEDULER-TRACEABILITY; VERIFICATION-CHECKLIST §5; CONSOLIDATED (3/3) |
| **Scheduler Algorithm (R11)** | R11.5 phase-progression, R11.6 4-level fallback ladder, R11.17 floor/ceiling — untested | SCHEDULER-TRACEABILITY; CONSOLIDATED (5 untested) |
| **Task Splitting (R19)** | R19.4 recurring day-lock, R19.5 cross-day, R19.6 travel buffers (first/last ordinal), R19.7 `partial_split` flag — untested | SCHEDULER-TRACEABILITY; CONSOLIDATED (4 untested) |
| **Split Containment (R35)** | R35.3 cross-day, R35.5 inline expansion, R35.6 `recurring_split_overflow` flag — untested | SCHEDULER-TRACEABILITY; CONSOLIDATED (4 untested) |
| **Reschedule Triggers (R41)** | R41.2 debounce (2s), R41.3 rate-limit (10/min), R41.4 no-recursion — untested; R41.5 skipScheduler PARTIAL | SCHEDULER-TRACEABILITY; CONSOLIDATED (3 untested) |
| **Fixed Mode (R26)** | R26.2 unfix (mode change → may move), R26.3 recurring+fixed blocked/fallback — untested | SCHEDULER-TRACEABILITY; CONSOLIDATED (2 untested) |
| **Dependencies (R10)** | R10.3 cyclic-dependency detection untested; R10.4/R10.5 recurring+dependsOn rejection — GAP | SCHEDULER-TRACEABILITY; CONSOLIDATED (cycle detection) |
| **TPC (R34)** | R34.5 spacing-guard minGap + safety valve — untested (test file `tests/recurring/tpc*.test.js` referenced but does NOT exist on disk; R32.2, R34.2–34.5). Backlog 999.575/999.416. | VERIFICATION-CHECKLIST §4; SCHEDULER-TRACEABILITY |
| **Rolling Anchor (R33)** | R33.5 null-anchor backfill from spacing history — untested | SCHEDULER-TRACEABILITY; CONSOLIDATED |
| **Deadline Backprop (R36)** | R36.1 no explicit backprop assertion (PARTIAL); R36.3 dead-code removal untested | SCHEDULER-TRACEABILITY |
| **Admin scheduler ops (R44.2–R44.7)** | 7 debug/stepper endpoints, no tests (blocked on DI for scheduleRoutes) | SCHEDULER-TRACEABILITY M8; CONSOLIDATED §5 |
| **Health (R42), task-query (R46), MCP (R17)** | labelled "implemented" but zero tests — status should be `partial` | MISSING-REQS §6; CONSOLIDATED §5 |

Backlog test items already filed: 999.506, 999.511, 999.517–999.519, 999.554–999.559, 999.575, 999.415, 999.416.

> Note: VERIFICATION-CHECKLIST.json's headline 8.7% coverage figure is flagged WRONG by TRACEABILITY-AUDIT-CONSOLIDATED §Executive Summary.

---

## PART 3 — Planned Designs Not Yet Built

### F3.1 Master/Instance Redesign — `WBS-juggler-master-instance-redesign.md` (LOCKED 2026-06-21)

Brain #88531 (model LOCKED), #88532 (adaptive split-out). WBS marked "PLAN-ONLY — awaiting David review"; status now updated by landed branches:

| Leg | Scope | Status | Evidence |
|-----|-------|--------|----------|
| L1 persist-once core (fabricate-once + UPSERT on deterministic key) | refactor | **DONE** | `leg/juggler-persist-once-core` `5d22e9e` landed |
| L2 frozen-invariant (touch only future+not-started+non-terminal; lock snapshot) | new | **DONE** | `leg/juggler-frozen-invariant` `a7978a8` landed (R52) |
| L3 master-edit refabrication (drop future not-started, reshape, recompute deadline) | new | **DONE** | `leg/juggler-master-edit-refab` `7d8f2fa` landed (R53) |
| L5 no-hard-delete + cancel-series/disable (soft) | new | **DONE** | `leg/juggler-cancel-soft-delete` `6ca3762` landed (R55) |
| L6 UI coalesce adjacent identical-master splits | new | **DONE** | `leg/juggler-ui-split-coalesce` `c07f5b6` landed (R56) |
| **L4 adaptive placement interval** (cluster-median-of-done → avg-gap → next placement clamped to deadline; FLEXIBLE recurrence only) | new | **NOT BUILT — DEFERRED to own milestone `juggler-adaptive-interval`** | WBS §Scope decision; brain #88532. R54 seed. Most novel/riskiest. |

→ **Master-instance redesign is ~5/6 legs landed; only L4 (adaptive interval) remains, deliberately split to a future milestone.**

### F3.2 DB-Single-Source Read-Model — `ARCH-DB-SINGLE-SOURCE.md` + `WBS-juggler-db-single-source.md` (CONFIRMED 2026-06-22)

DB is the single source of truth; kill `schedule_cache`/`/schedule/placements` as a second source. Ordered serial chain W1→W2→W3→W4:

| Wave | Scope | Status | Evidence |
|------|-------|--------|----------|
| Step 1 — migration: `unplaced_reason`/`unplaced_detail` on `task_instances` | **DONE (committed on `leg/juggler-db-single-source`, may not be pushed/run on prod)** | ARCH doc §Done |
| W1 — overdue display unified to canonical `task.overdue` across views | **DONE / shipped** | juggler `7af77eb` (readmodel-consistency leg landed) |
| W2 — scheduler-core: enforce overdue↔unplaceable partition by **deadline** + FIXED `scheduled_at` anchor; preserve prior placement for overdue | **NOT BUILT** (the real scheduler refactor; risk MED–HIGH) | WBS W2; ARCH §Remaining; DESIGN-RULING status |
| W3 — repoint Calendar/Day views to DB read; delete `/schedule/placements` read path | **WIP / UNMERGED** (frontend slice on `leg/juggler-db-single-source` `76ffb5f`, leg-meta verdict=PASS but not merged) | branch F1.1 |
| W4 — remove `schedule_cache` write (`runSchedule.js:1912` persistCache) | **NOT BUILT** | WBS W4 |

Canonical design rule `DESIGN-RULING-overdue-vs-unplaceable.md`: overdue = past-deadline + cannot-fit → pinned, untouched; unplaceable = pre-deadline + cannot-fit-now → `unplaced[]`; mutually exclusive (placed-XOR-unplaced invariant). Status line: "W1 shipped; W2/W3 (scheduler core: preserve-prior-placement + deadline-based split) **remain**."

→ **DB-single-source is W1 done, W3 WIP-unmerged, W2+W4 not built. W2 is the load-bearing scheduler-core change.**

### F3.3 Recurring-Overdue Lifecycle (DEFERRED, brain #88203 / #88529)

R50 Leg-1 SHIPPED (`8e029e7`): past FIXED/RIGID-RECURRING pin overdue at original date. **DEFERRED to a `recurring-overdue-lifecycle` leg (backlog 999.801):** R50.0 recurrence-PERIOD-boundary implied-due + recurring-split implied-due, reconciled with auto-missed R32.4. R50.6/R50.7/R50.8 (computed-on-read overdue, materialized `implied_deadline`, shared `getNowInTimezone`) landed on `5ec3f20a`/`bb2c9fc`.

→ **Recurring-overdue lifecycle: read-side (R50.6/7/8) DONE; the recurrence-period-boundary implied-due + R32.4 auto-missed reconciliation NOT BUILT (999.801).** Partly overlaps the WIP `leg/juggler-overdue-reschedule` branch (F1.1) which is doing recurring forward-roll + effective-deadline overdue.

### F3.4 Recurring Spacing / Adaptive Interval

No standalone `RECURRING-SPACING` design doc found; the spacing concern is folded into (a) R34.5 TPC spacing-guard minGap (UNTESTED — F2.3) and (b) L4 adaptive interval (NOT BUILT — F3.1, reuses R33 rolling-anchor + R34 spacing-history per brain #88532).

---

## SUMMARY

**In-flight scheduler efforts:** 6 distinct.

1. `leg/juggler-overdue-reschedule` (`60835fe`) — **WIP, ORPHANED.** Recurring forward-roll + effective-deadline overdue; 1801 insertions incl. 1277-ln new test, commit tagged `WIP`. Biggest unmerged scheduler payload. Overlaps recurring-overdue-lifecycle (F3.3).
2. `worktree-fix-anytime-overdue` (`e2d4a92`) — **WIP, ORPHANED.** 18-line ANYTIME-not-overdue fix, no test; main has since reworked overdue pinning → verify-or-discard.
3. `leg/juggler-hex-h7b-scheduler-thinning` (`e0b2c51`) — **UNMERGED, complete-with-tests.** Hex facade thinning; land or retire.
4. `leg/juggler-db-single-source` (`76ffb5f`) — **UNMERGED, leg-meta PASS.** = W3 frontend slice of the DB-single-source refactor.
5. DB-single-source WBS — **W2 (scheduler-core partition + FIXED anchor + preserve-prior-placement) and W4 (remove `schedule_cache` write) NOT BUILT.**
6. Master-instance redesign **L4 adaptive interval — NOT BUILT (deferred milestone).**

**Orphaned / unmerged branches (scheduler-relevant):** `leg/juggler-overdue-reschedule`, `worktree-fix-anytime-overdue`, `leg/juggler-hex-h7b-scheduler-thinning`, `leg/juggler-db-single-source`, `loop/backlog` (DB/migration). Plus non-scheduler unmerged: migrate-prod-guard, h4-deadcode, 2× canary cal-sync, gitignore chore. The 7 named master-instance legs are LANDED (stale labels — safe to delete).

**Consolidated "planned but not built" scheduler behaviors:**
1. **W2 deadline-based overdue↔unplaceable partition + FIXED `scheduled_at` anchor + preserve-prior-placement for overdue** (ARCH-DB-SINGLE-SOURCE; DESIGN-RULING). Load-bearing.
2. **W4 remove `schedule_cache` write** — collapse the second source of truth.
3. **L4 adaptive placement interval** (cluster-median-of-done, flexible recurrence only) — deferred milestone `juggler-adaptive-interval` (R54).
4. **Recurrence-period-boundary implied-due + recurring-split implied-due, reconciled with R32.4 auto-missed** (999.801).
5. **Pile-up eviction** (pinned→priority→duration; GP-3/CL-2/M-SCH-1, 999.506).
6. **Weather fail-CLOSED** (R11.10/R38.1 — currently fail-open bug) + correct `_unplacedReason` string (R38.2).
7. **Capacity-aware offset for propagated deadlines** (R36.2).
8. **~25 untested scheduler sub-reqs** — notably R37 earliest-start (3/3) and R40 FlexWhen (3/3) completely untested; R34.5 TPC spacing-guard; R19/R35 split-containment flags. Tests-not-behavior, but spec-required.

_Citations: branch SHAs inline (F1); gap docs `juggler/docs/*` + `juggler/juggler-backend/docs/architecture/SCHEDULER-AUDIT-REQUIREMENTS.md`, `.../SCHEDULER-TRACEABILITY-REPORT.md` (F2); design docs `.planning/kermit/WBS-juggler-master-instance-redesign.md`, `.planning/kermit/WBS-juggler-db-single-source.md`, `.planning/kermit/juggler-readmodel-design/{ARCH-DB-SINGLE-SOURCE,READMODEL-ANALYSIS,DESIGN-RULING-overdue-vs-unplaceable}.md`; brain #88531/#88532/#88203/#88529 (F3)._
