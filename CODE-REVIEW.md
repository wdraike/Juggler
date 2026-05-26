# CODE-REVIEW — Cal adapter placement_mode reorder + rigid MCP removal

**Reviewer:** Ernie
**Date:** 2026-05-26
**Scope:**
- `juggler-backend/src/lib/cal-adapters/{apple,gcal,msft}.adapter.js` — ANYTIME reset moved before FIXED promotion in `applyEventToTaskFields`
- `juggler-backend/src/mcp/tools/tasks.js` — `rigid` field removed from `taskInputFields` schema
- `juggler-backend/tests/taskPipeline.test.js` — null placement_mode passthrough expectation
- `juggler-backend/tests/unit/derivePlacementMode.test.js` — ANYTIME fallback tests replaced with passthrough tests

---

## Summary

**Criticals: 0 | Warnings: 0**

---

## Findings

### Adapter reorder — ANYTIME before FIXED (all 3 providers)

Logic is correct. The four-step cascade in `applyEventToTaskFields` now reads:

1. ALL_DAY wins unconditionally (isAllDay branch).
2. REMINDER set if event is transparent.
3. ANYTIME reset if event was REMINDER and is no longer transparent — runs before FIXED so the same-sync date/time change can still promote.
4. FIXED wins if date or time changed on a timed event.

The old order ran FIXED then ANYTIME, so a same-sync REMINDER→(no longer transparent, date changed) event landed on ANYTIME instead of FIXED. The new order correctly resolves to FIXED in that case.

One potential question: if a task was REMINDER and the event loses transparency but date/time are unchanged, step 3 fires (ANYTIME) and step 4 does not fire (no date/time change). Result: ANYTIME. That is the correct semantic — the task is no longer a reminder but has no new placement, so ANYTIME is appropriate.

All three adapters are byte-for-byte identical in this logic block. The REMINDER→FIXED combined scenario is covered by a dedicated test in each adapter test file (`01-adapter-gcal.test.js:301`, `02-adapter-msft.test.js:592`, `03-adapter-apple.test.js:244`). Those tests explicitly assert `fixed` and `not.toBe('anytime')`, covering both halves of the ordering.

### `rigid` removal from MCP schema

`rigid` is confirmed absent from `task.controller.js` and `src/mcp/tools/tasks.js`. The DB column was dropped by migration `20260526000000_drop_pinned_and_rigid_columns.js`. The view alias was removed by `20260518000200_drop_rigid_from_views.js`. The scheduler uses `t.placementMode === PLACEMENT_MODES.FIXED` (not a `rigid` field) at `unifiedScheduleV2.js:663`. No live code path reads a `rigid` property from task rows. Removing it from the MCP input schema is correct and complete.

The `rigid: 0` in `taskPipeline.test.js:makeRow` is a DB-row fixture reflecting the old schema shape — it has no behavioral effect since `rowToTask` ignores that key.

### Test changes

`taskPipeline.test.js`: Updated expectation from `toBe('anytime')` to `toBeNull()` for a null `placement_mode` DB row. This is consistent with the no-fallback policy in `CLAUDE.md` and the `NOT NULL` column invariant. The DB column is `NOT NULL`; null in a test fixture is a data-integrity signal, not a valid state, so no fallback is correct.

`derivePlacementMode.test.js`: ANYTIME-fallback describe block replaced with passthrough describe block. New tests correctly assert `toBeUndefined()` (missing key) and `toBe('')` (empty string passthrough) rather than a synthetic ANYTIME promotion. Consistent with the post-09-03 design.

No missing edge cases found. The REMINDER→ANYTIME path (transparent removed, no date/time change) is not explicitly tested in isolation, but it is the complement of the covered REMINDER→FIXED case and the existing "transparent event sets REMINDER" tests collectively pin the full state space.

---

*Tests: 1505 pass, 27 skip, 1 todo. Exit 0.*
