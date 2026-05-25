# Design Review — 2026-05-25 — When Mode Simplification

## Decision: WARN — Design approved. Required implementation patterns documented below.

## Mode: --design
## Scope
juggler-frontend/src/components/tasks/sections/WhenSection.jsx
juggler-frontend/src/components/tasks/TaskEditForm.jsx
juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx
juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx
juggler-backend/src/controllers/task.controller.js
juggler-backend/src/scheduler/unifiedScheduleV2.js
juggler-backend/src/lib/placementModes.js
juggler-backend/src/mcp/tools/tasks.js
juggler-backend/docs/architecture/TASK-PROPERTIES.md
juggler-backend/docs/architecture/SCHEDULER-UI-STATE-MAP.md
DB: task_instances.date_pinned, task_masters.prev_when, task_masters.rigid

## Agents Dispatched
| Agent | Reason | Result | Findings |
|-------|--------|--------|----------|
| cookie | mandatory — arch + DB migration assessment | WARN | 3 BLOCK (implementation sequencing), 4 WARN |
| ernie | mandatory — code impact map | WARN | 2 RED FLAG (implementation sequencing), 5 WARN |
| elmo | not dispatched — no auth/payment/webhook patterns | N/A | — |

## Design Summary

**5 user-selectable scheduling modes (replacement system):**

| # | Mode | `placement_mode` | User intent |
|---|---|---|---|
| 1 | Anytime | `anytime` | Scheduler places freely |
| 2 | Fixed | `fixed` | Explicit date + time, immovable |
| 3 | Time window | `time_window` | Near preferred time ± flex |
| 4 | Time blocks | `time_blocks` | Named windows (morning/lunch/etc.) |
| 5 | All-day | `all_day` | No time placement |

`reminder` stays as system/marker mode (not user-selectable).

**What gets removed:**
- `datePinned` / `date_pinned` — no use case; fold into `fixed`
- `rigid` field — already removed from scheduler (phase 11); remove from UI + remaining server code
- Server auto-set of `fixed` when task created with time — user picks mode explicitly
- `prev_when` field — only used by unpinTask restore logic; no longer needed
- `unpinTask` endpoint — user changes mode via normal task edit
- Pin/Pinned toggle (WhenSection)
- Fixed/Float rigid toggle (WhenSection)

**Drag-and-drop:** Sets `placement_mode='fixed'` at dropped date+time (no separate datePinned).

---

## Required Implementation Patterns (from cookie + ernie)

### CRITICAL — Must do in this exact sequence or the app will silently corrupt task placement

**Step 1 — Scheduler first (unifiedScheduleV2.js:316)**
```js
// CURRENT (broken after removal):
var pinned = !!t.datePinned;

// REPLACE WITH:
var pinned = t.placementMode === 'fixed';
// Note: recurring fixed tasks (calendar events) are already placement_mode='fixed'
// Non-recurring fixed tasks will have placement_mode='fixed' after this redesign
```
All downstream `isPinned` usage (`unifiedScheduleV2.js:471, 692, 857, 1381`) flows from this. Fix this before any controller or DB changes land.

**Step 2 — Extend `guardFixedCalendarWhen` (task.controller.js:607-616)**
Current guard checks `row.date_pinned === 0` — this is the only thing preventing a PATCH from stripping `placement_mode` off a cal-synced task. Must be rewritten to guard `placement_mode` directly:
```js
function guardFixedCalendarWhen(row, guardTarget, opts) {
  if (!guardTarget) return;
  if (opts && opts.allowUnfix) return;
  var isCalLinked = !!(guardTarget.gcal_event_id || guardTarget.msft_event_id || guardTarget.apple_event_id);
  if (!isCalLinked) return;
  // Prevent clearing placement_mode off calendar-linked tasks
  if (row.placement_mode && row.placement_mode !== 'fixed') {
    delete row.placement_mode;
  }
}
```

**Step 3 — Remove cal adapter writes of `date_pinned` (atomically)**
All three adapters write `fields.date_pinned = 1` alongside `placement_mode = FIXED`. Remove these writes from:
- `gcal.adapter.js`
- `msft.adapter.js`
- `apple.adapter.js`
- `cal-sync.controller.js:1867`

Must happen before or atomically with schema column drop — otherwise calendar sync throws column-not-found on every ingest.

**Step 4 — Remove backend auto-set of `fixed` (task.controller.js)**
Lines to remove: `863-864, 869-870, 961-962, 1107-1108, 1117-1118`
Same in `mcp/tools/tasks.js:137-138, 197-198, 283-285`
Keep the `allDay` backstop (`:873-874`).

**Step 5 — Remove `_dragPin` block + `prev_when` write (task.controller.js)**
The drag path writes `date_pinned=1` + `prev_when`. Replace: drag sends `placementMode:'fixed'` + date + time via normal PATCH. No separate `_dragPin` flag needed after this.

**Step 6 — Remove frontend toggles (WhenSection.jsx)**
- Remove Pin/Pinned toggle from date row (lines 250-257)
- Remove Fixed/Float rigid toggle from time row (lines 301-306)
- Remove `onDatePinnedChange`, `onRigidChange` prop threading from TaskEditForm.jsx
- Add Fixed as a 5th mode button in the mode selector (alongside Anytime/Time window/Time blocks/All Day)

**Step 7 — Data audit migration (REQUIRED before column drop)**
Tasks with `date_pinned=1` but `placement_mode != 'fixed'` exist (drag-pinned tasks that stayed in anytime mode). Must correct these before column drop:
```sql
-- Audit:
SELECT COUNT(*) FROM task_masters
WHERE date_pinned = 1 AND placement_mode NOT IN ('fixed', 'reminder');

-- Correct:
UPDATE task_masters
SET placement_mode = 'fixed'
WHERE date_pinned = 1
  AND placement_mode NOT IN ('fixed', 'reminder')
  AND (time IS NOT NULL OR scheduled_at IS NOT NULL);
```

**Step 8 — DB migration (drop columns)**
After Steps 1-7 are shipped and verified:
- `ALTER TABLE task_instances DROP COLUMN date_pinned`
- `ALTER TABLE task_masters DROP COLUMN prev_when`
- `ALTER TABLE task_masters DROP COLUMN rigid` (still exists per ernie — drop it)
- Update `tasks_v` view and `recreate-views.js`

**Step 9 — Tests (6 test files)**
`taskPipeline.test.js`, `taskControllerUnit.test.js`, `schedulerScenarios.test.js` (S32/S33), `taskCrudIntegration.test.js`, `taskCrudIntegration2.test.js`, `tasks-e2e.js`

---

## Architectural Decisions (from cookie)

1. **`placement_mode` is the single source of truth for immovability.** `datePinned` was a redundant axis. After this change, `placement_mode === 'fixed'` is the only immovability signal the scheduler, controller, and UI need.

2. **Fixed becomes user-selectable.** No special guard needed — Fixed requires date + time fields (already validated by `validateTaskInput`). Error message: "Fixed mode requires a date and time."

3. **Calendar sync tasks**: already use `placement_mode='fixed'`. Removing `date_pinned` write from adapters is safe. The `guardFixedCalendarWhen` function guards `placement_mode` instead.

4. **`rigid` column on `task_masters`**: ernie confirmed it still exists in DB despite being "removed in phase 11." Drop it in the Step 8 migration.

5. **`unpinTask` endpoint**: Remove. Frontend uses normal PATCH to change `placementMode` from `fixed` to `anytime` (or other mode). No special endpoint needed.

6. **Recurrence stays orthogonal**: No changes to recurrence logic. `time_window` and `time_blocks` modes still work the same way for recurring tasks.

---

## Required Patterns (from ernie consult)

- **Scheduler change is Step 1, non-negotiable.** Every other change depends on the scheduler correctly reading `placement_mode` instead of `datePinned`.
- **No half-state.** Don't ship frontend toggle removal before backend auto-set removal — user could be left with no way to set Fixed mode.
- **Migration before column drop.** Audit SQL must run and show zero mismatched rows before `DROP COLUMN`.
- **Test update is last.** Update tests after behavior is stable, not during.
- **Keep `guardFixedCalendarWhen` — rewrite, don't remove.** Cal-synced tasks must stay immovable.

---

## Implementation Scope Estimate

| Component | Files | Risk |
|---|---|---|
| Scheduler | unifiedScheduleV2.js (1 line + downstream) | HIGH — fix first |
| guardFixedCalendarWhen | task.controller.js | HIGH — fix second |
| Cal adapters | gcal, msft, apple adapters + cal-sync.controller.js | MEDIUM |
| Backend auto-set removal | task.controller.js, mcp/tools/tasks.js | MEDIUM |
| Frontend toggle removal + Fixed button add | WhenSection.jsx, TaskEditForm.jsx | LOW |
| DB migration | New migration file | MEDIUM |
| Test updates | 9 test files | LOW |

---

## Next Step

`/oscar --build`

Signed: Oscar, Technology Director — 2026-05-25
