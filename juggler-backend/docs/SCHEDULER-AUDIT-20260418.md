# Scheduler Audit — 2026-04-18

Full audit of `unifiedSchedule.js` and `runSchedule.js` against `SCHEDULER.md`.

## Verdict: Core algorithm is correct. Data pipeline had gaps.

The placement logic (Phases 0-5) correctly implements the three guiding principles. The bugs were all in how the scheduler's output gets persisted to and read from the DB.

---

## Phase-by-Phase Review

| Phase | Spec | Code | Aligned? |
|-------|------|------|----------|
| Phase 0 — Immovable (pinned, markers) | Pinned + time → locked at slot | `datePinned && sm !== null` → fixedByDate | Yes |
| Phase 1 — Recurring | Sort by slack within priority tiers | Sorts by slack across ALL priority tiers (constrained-first) | Code is better than spec describes |
| Phase 2 — Deadline (slack-based forward) | Slack sort → single forward pass → retry → chain rollback → overflow | Implemented exactly | Yes |
| Phase 3 — Unconstrained | Priority-sorted forward fill | Implemented exactly | Yes |
| Phase 4 — FlexWhen relaxation | Retry unplaced with "anytime" windows | Implemented exactly | Yes |
| Phase 5 — Recurring rescue | Bump lower-priority tasks for unplaced recurring | Implemented exactly | Yes |
| Hill climbing | Post-greedy optimization | Implemented (750 iterations, 1.2s limit) | Yes |

## Bugs Found (all in the data pipeline, not the algorithm)

### 1. `pickInstance()` stripped `date/day/time` on INSERT
The function that builds instance rows for DB insertion had a fixed column whitelist that didn't include `date`, `day`, or `time`. In-memory chunks were placed correctly by the scheduler but written to the DB without dates. The dedup query (`SELECT date FROM task_instances`) returned NULL, so every scheduler run created new instances for the same dates.

**Fixed:** Added `date/day/time/split_group` to `pickInstance()` output.

### 2. Persist UPDATE path didn't write `date/day/time`
The batch CASE UPDATE only wrote `scheduled_at` and `dur`. The derived local fields (`date`, `day`, `time`) were stale in the DB. Any code reading these columns directly (dedup query, raw DB checks) saw wrong data.

**Fixed:** Added `date/day/time` CASE expressions to the batch update.

### 3. `INSTANCE_UPDATE_FIELDS` whitelist missing fields
The `tasks-write.js` field routing only allowed `scheduled_at, dur, date_pinned, status, time_remaining, unscheduled, generated` on instance updates. `date/day/time/split_group` were silently dropped.

**Fixed:** Added to the whitelist.

### 4. Backend merge-back was counterproductive
Phase 9b folded adjacent same-master chunks into one row (8x30m → 1x210m). This created huge blocks on the calendar and defeated the purpose of splitting.

**Fixed:** Removed merge-back entirely. Visual collapsing is handled in the frontend.

### 5. No recovery for orphaned one-off masters
The master/instance architecture requires every task to have an instance row. If instances get deleted, masters become invisible to `tasks_v`. No code recreated missing one-off instances.

**Fixed:** Added orphaned master detection + auto-recovery to `integrity_check` tool.

## Doc vs Code Discrepancies (stale references in SCHEDULER.md)

| Section | Stale Reference | Current Reality |
|---------|----------------|-----------------|
| §3 Classification | `when: 'fixed'` for fixed tasks | `datePinned` is the pinning mechanism |
| §4c Header | "reserve + forward-pull" | Slack-based forward placement |
| §4b Phase 1 | Implies priority-tier grouping | Sorts across ALL tiers by slack |
| §5b Pile-up cleanup | Describes post-hoc eviction | Code prevents overlaps during placement (no cleanup needed) |
| §10 Safety | "Deterministic IDs (masterId-YYYYMMDD-N)" | Now ordinal IDs (masterId-N) |

## What Was NOT Broken

- Slack computation (constraint-aware capacity walk)
- Dependency enforcement (`depsMetByDate`)
- Chain rollback for capacity-constrained chains
- Past-due handling (slack=0, P1 boost, overflow placement)
- Recurring spacing enforcement (Phase 1.5)
- Constrained-first sort (narrow windows before wide windows)
- Location/tools/travel buffer constraints
- Split task placement (`splittable` + `minChunk`)
- Circular/backwards dependency detection
