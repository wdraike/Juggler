# Build Review — When-Mode Simplification Redesign — 2026-05-25

## Summary

The placement_mode redesign is structurally correct and the frontend changes are clean. However, `runSchedule.js` still reads `t.datePinned` at five call sites — a field that `rowToTask` no longer emits — making those guards permanently dead (always-falsy), which silently breaks fixed-task immovability logic in the persist/unplaced pass. That is the one Critical blocking issue. Three Warnings also need attention this sprint.

---

## Critical Findings (must fix before merge)

| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| 1 | `runSchedule.js` reads `t.datePinned` at five call sites but `rowToTask` no longer emits this field — it was removed as part of the redesign. Every guard that short-circuits on `original.datePinned` or `t.datePinned` is now permanently falsy. Concrete impact: (a) line 1198 — the dur-sync exception for fixed tasks silently falls through, so split fixed tasks can get their dur overwritten by the scheduler; (b) lines 1324, 1476, 2113 — unplaced fixed tasks are no longer skipped from the "mark unscheduled" and "mark overdue" passes, meaning past fixed tasks get incorrectly flagged as overdue/moved instead of staying pinned. `datePinned` must be replaced with `original.placementMode === PLACEMENT_MODES.FIXED` (the new canonical signal). | `juggler-backend/src/scheduler/runSchedule.js`:1198, 1324, 1476, 1478, 2113 | Replace each `t.datePinned` / `original.datePinned` guard with `(original\|t).placementMode === PLACEMENT_MODES.FIXED`. Remove the exact duplicate guard on line 1478 (identical to 1476). |

---

## Warning Findings (fix this sprint)

| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| 1 | `unifiedScheduleV2.js` line 316 — `var pinned = t.placementMode === 'fixed'` is redundant with `var fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring` computed two lines above. `isPinned` is then used at lines 471, 692, 857, and 1381 — but in every case `isFixedWhen` or `isRigid` captures the same condition (fixed non-recurring or fixed recurring). `isPinned` is a renamed alias for `fixed` with no behavioral distinction; the two variables now express the same predicate twice. This creates a maintenance trap where future changes to the "fixed" definition must be made in two places. | `juggler-backend/src/scheduler/unifiedScheduleV2.js`:315-316, 471, 692, 857, 1381 | Remove `pinned` / `isPinned`. Replace `item.isPinned` at the four downstream call sites with `item.isFixedWhen` (non-recurring fixed) and/or `item.isRigid` (recurring fixed) as already used in the same proximity. Verify the immovability path at line 1381 is not changed in meaning. |
| 2 | MCP tool schema (`tasks.js` line 57) still exposes `datePinned: z.boolean()` as an accepted input field. The field description even claims "When omitted and date/time are provided, defaults to true." This description is now false — the server does not auto-set placement_mode based on datePinned, and `taskToRow` ignores it silently. An MCP client passing `datePinned: true` today gets no error and no effect — a silent no-op that will confuse ClimbRS integrations. | `juggler-backend/src/mcp/tools/tasks.js`:57 | Remove `datePinned` from the Zod schema. If backward compatibility with old ClimbRS prompts is needed, add a deprecated passthrough that returns a 400 with a migration message. |
| 3 | `guardFixedCalendarWhen` function header (lines 600-603) contains a stale comment explaining the guard in terms of `date_pinned`: "Pinning is the mechanism that keeps synced events immovable — removing it would let the scheduler move calendar events. The broader ingested-task guard (#8) blocks most field changes; this catches the specific case of date_pinned being cleared." The function body now guards `placement_mode`, not `date_pinned`. The comment is a documentation lie that will mislead the next reader of this function. | `juggler-backend/src/controllers/task.controller.js`:600-603 | Rewrite the comment to describe what the function actually does: guards `placement_mode` from being stripped off calendar-linked tasks. Remove the `date_pinned` reference entirely. |

---

## Info / Suggestions

| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| 1 | `reconcile-splits.js` line 143 inserts new split chunks with `date_pinned: template ? template.date_pinned : 0`. Once the drop-columns migration (`20260526000000_drop_pinned_and_rigid_columns.js`) runs, `template.date_pinned` will be `undefined` (column gone), and the insert will write `date_pinned: undefined` — which Knex silently drops, making the field absent from the INSERT. Harmless post-migration since the column won't exist, but the line is misleading and should be cleaned up before the migration lands. | `juggler-backend/src/lib/reconcile-splits.js`:143 | Remove the `date_pinned` line from the insert object as part of the column-drop migration prep. |
| 2 | `isFixed = placementMode === 'fixed' && isCalManaged` in WhenSection (line 233) restricts the "calendar-managed" read-only overlay to tasks that are BOTH in fixed mode AND have a cal event ID. A juggler-originated task that a user manually sets to fixed mode will NOT get `isFixed = true`, so the mode selector remains interactive. This appears intentional (user-created fixed tasks should be editable) but is architecturally fragile — if a cal-synced task ever loses its event ID without losing fixed mode, the guard silently unlocks it. Consider adding a comment explaining why `isCalManaged` is part of the condition. | `juggler-frontend/src/components/tasks/sections/WhenSection.jsx`:233 | Add an inline comment: `// isCalManaged scoped: user-created fixed tasks must remain editable; only cal-provider-owned events are locked`. |
| 3 | TaskEditForm line 155 retains `rigid` state and still passes it to WhenSection. The time_window plus-minus selector in WhenSection uses `rigid` to toggle between exact and flex display (line 345: `value={rigid ? 0 : (timeFlex || 60)}`). If `rigid` is being kept only for this sub-purpose, its name is misleading — it no longer means "rigid scheduling mode" in the redesign. Consider renaming to `exactTime` or documenting the reduced scope at the useState call. | `juggler-frontend/src/components/tasks/TaskEditForm.jsx`:155 | Rename `rigid`/`setRigid` to `exactTime`/`setExactTime` and update the comment to clarify its sole remaining purpose. |

---

## Checklist Status

- [x] Complexity — PASS
- [ ] Error handling — WARN (see Warning #2: silent no-op on deprecated MCP field)
- [x] Test coverage — not assessed in this pass (light pre-pass scope)
- [x] Observability — PASS (no regressions introduced)
- [x] Scalability — PASS
- [ ] API design — WARN (MCP schema documents false behavior for datePinned)
- [ ] Dead code — WARN (duplicate guard lines 1476/1478 in runSchedule.js)

---

**Critical: 1 | Warnings: 3**

---

## Re-Review — 2026-05-25

Verified each of the four flagged items against the current code in `juggler-backend/`.

### Critical #1 — runSchedule.js datePinned guards

All five call sites confirmed fixed:

- Line ~1197: guard is now `if (original.placementMode === PLACEMENT_MODES.FIXED)`. FIXED.
- Line ~1323: guard is now `if (original.placementMode === PLACEMENT_MODES.FIXED) return;`. FIXED.
- Line ~1475: guard is now `if (t.placementMode === PLACEMENT_MODES.FIXED) return;`. FIXED.
- Line ~1477 (former duplicate): the duplicate `datePinned` guard is gone; line 1477 is now `if (t.marker) return;` — no duplicate. FIXED.
- Line ~2110: guard is now `if (isPast && t.placementMode === PLACEMENT_MODES.FIXED) return;`. FIXED.

No remaining `datePinned` or `t.datePinned` references exist in `runSchedule.js`. Critical resolved.

### Warning #1 — unifiedScheduleV2.js var pinned / isPinned

No `var pinned`, `isPinned`, or `.isPinned` found anywhere in `unifiedScheduleV2.js`. Lines 310-316 show only `var fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring` — the redundant alias is gone. Lines 471, 691, 855, and 1376-1381 all use `isFixedWhen`, `isRigid`, and `isRigidWithAnchor` exclusively. Warning resolved.

### Warning #2 — tasks.js datePinned in Zod schema

No `datePinned` found in `juggler-backend/src/mcp/tools/tasks.js`. Warning resolved.

### Warning #3 — task.controller.js guardFixedCalendarWhen stale comment

Lines 600-604 now read:

```
// Guard: prevent stripping placement_mode off calendar-linked tasks.
// Calendar adapters set placement_mode='fixed' to keep synced events immovable.
// The broader ingested-task guard (#8) blocks most field changes; this catches
// the specific case of a PATCH attempting to change or remove placement_mode
// on a task that is still linked to a gcal/msft/apple calendar event.
```

No `date_pinned` reference in the comment. The one remaining `date_pinned: 0` in the controller (line 1219) is an unrelated insert of a reset row value, not part of the guard comment. Warning resolved.

### Re-Review Verdict

**Critical: 0 | Warnings: 0**

All four original findings are confirmed fixed. PASS — cleared for merge.
