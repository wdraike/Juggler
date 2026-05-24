# Test Review — Focus: task.controller.js, MCP tasks.js, TaskEditForm, WhenSection

_Date: 2026-05-24_
_Mode: Focus — changed/related files listed in command line_

---

## Suite Results

| Suite | Tests | Passed | Failed | Skipped |
|-------|-------|--------|--------|---------|
| `juggler-backend/tests/mcp-task-config.test.js` | 16 | 16 | 0 | 0 |
| `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx` | ~160 | 160 | 0 | 0 |
| `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx` | ~98 | 98 | 0 | 0 |
| `juggler-frontend/src/components/tasks/__tests__/TaskEditForm.integration.test.jsx` | 3 | 3 | 0 | 0 |
| **Total** | **277** | **277** | **0** | **0** |

All focused tests pass. No failures, no skips.

---

## Coverage by Focus File

| File | Stmts % | Branch % | Funcs % | Lines % | Tested By |
|------|---------|----------|---------|---------|-----------|
| `juggler-backend/src/mcp/tools/tasks.js` | 22.94 | 11.53 | 23.40 | 23.07 | `mcp-task-config.test.js` |
| `juggler-backend/src/controllers/task.controller.js` | 11.27 | 14.20 | 7.75 | 12.61 | `mcp-task-config.test.js` (indirect) |
| `juggler-frontend/src/components/tasks/sections/WhenSection.jsx` | 34.38 | 44.18 | 28.88 | 37.89 | `WhenSection.*.test.jsx` |
| `juggler-frontend/src/components/tasks/TaskEditForm.jsx` | 27.95 | 29.95 | 36.17 | 34.89 | `TaskEditForm.integration.test.jsx` |

---

## Backend — `mcp-task-config.test.js` (16 tests)

### What is covered
- `create_task` placement_mode inference (6 paths):
  - Explicit `time_window` + date + time → `time_window`, auto-pinned
  - Explicit `datePinned:false` + date → `all_day`, unpinned
  - Date only (no placementMode) → `all_day`, pinned
  - Date + time (no placementMode) → `fixed`, pinned
  - `anytime` + date → `anytime`, pinned
  - `anytime` + date + `datePinned:false` → `anytime`, unpinned
  - `scheduledAt` only → `fixed`, pinned
  - No scheduling fields → `placement_mode` undefined, `date_pinned` undefined
  - Explicit `fixed` / `all_day` / `time_blocks` + date → respective mode, pinned
  - `datePinned:true` without date/time → pinned flows through
  - `fixed` without date/time/scheduledAt → validation error
  - Invalid placementMode → falls back to `anytime`
- `batch_update_tasks` calendar-sync guard (2 tests):
  - Synced task with blocked fields (`datePinned`) → error with `CAL_SYNCED_READONLY`
  - Synced task with only `status` + `notes` → allowed

### Gaps
- `update_task` MCP tool has **zero** tests.
- `list_tasks` MCP tool has **zero** tests.
- `create_tasks` (batch) has **zero** placement_mode / date_pinned tests.
- Rolling-anchor logic in MCP `update_task` (L576-621 in `tasks.js`) is uncovered.
- The controller coverage (11.27%) is driven solely by `taskToRow`, `rowToTask`, `validateTaskInput`, and `buildSourceMap` being pulled in as dependencies; the actual HTTP/controller paths in `task.controller.js` are not exercised by this suite.

---

## Frontend — WhenSection (2 suites, 258 tests)

### `WhenSection.modes.test.jsx` — mode matrix
- Exhaustive cartesian matrix over: `placementMode` (anytime, time_window, time_blocks, fixed, all_day) × `datePinned` (true/false) × `rigid` (true/false) × `recurring` (true/false)
- 4 assertions per combination:
  1. Renders without crashing
  2. Mode selector button visibility correct (recurring shows 3 buttons; non-recurring shows 4)
  3. `isFixed` derivation correct (opacity 0.4 when fixed/pinned)
  4. No disabled control lacks a visible indicator (accessibility guard)
  5. `all_day` hides time inputs

### `WhenSection.test.jsx` — behavior tests
- **Task 1 (placementMode prop tests, D-24 through D-26):**
  - Three-button / four-button selectors render correctly
  - Active button font-weight is `600`
  - Clicking modes fires `onModeChange` with correct value
  - `time_window` shows time input; `anytime` hides it
  - Recurring mode buttons call `onModeChange`
  - `all_day` button calls `onModeChange('all_day')`
  - Day picker label says "Eligible days" for weekly
  - Recurrence select wording ("Every 2 weeks", not "Biweekly")
- **Task 2 (sub-mode split toggle):**
  - "All N days" / "Flexible quota" toggle visible when `selectedCount > 1`
  - Active state derived correctly from `recurTpc === selectedCount`
  - Clicking toggles calls `onRecurTpcChange` with correct value
  - `tpc` select shown/hidden based on flex-mode
  - Clicking flex when already flex is no-op
- **Task 3 (rolling recurrence mode UI):**
  - "Rolling (repeats after completion)" option present
  - Interval input visible in rolling mode
  - Unit select has days/weeks/months, no years
  - Anchor card shows "not yet set" when `rolling_anchor` is null
  - Anchor card shows "Completed on" / "Next due" when anchor set
  - Rolling mode hides day picker and fill policy
- **Pin toggle:**
  - Clicking Pin calls `onDatePinnedChange(true)`
  - Clicking Pinned calls `onDatePinnedChange(false)`
- **Fixed mode specifics:**
  - Mode selector dimmed and `pointerEvents: none`
  - Pin toggle still visible even when `datePinned` is false
- **All day specifics:**
  - Time input hidden even when `time` prop provided
  - Date input still shown
- **Deep interactions — no silent lockouts:**
  - Clicking Anytime, Time window, Time blocks, All Day all fire correct `onModeChange`
  - Clicking Time blocks prefills `when` with all block tags
  - Clicking All Day clears constraints (pin=false, when='', split=false, travel=0)
- **Accessibility / lockout banners:**
  - `datePinned=true` shows "Date is pinned" banner
  - `fixed` mode shows "Calendar-managed" banner
  - No banner when `isFixed` is false
  - Day requirement removed from DOM when `isFixed`
  - `tabIndex` and `pointerEvents` correctly set on mode buttons

---

## Frontend — TaskEditForm integration (1 suite, 3 tests)

- **Coverage:** TaskEditForm.jsx at 27.95% statements, 29.95% branches.
- The integration test exercises the full mount + user interaction path:
  - Form renders with task data
  - State changes propagate through sections
  - Save/cancel flow interactions
- Gaps: Weather section, dependency chain picker, location/tools pickers, recurrence anchor editing, split-task UI, and mobile-responsive paths are not exercised.

---

## Summary

| Status | Count | Details |
|--------|-------|---------|
| PASS | 277 | All focused-suite tests green |
| FAIL | 0 | — |
| WARN | 2 | Low coverage on `task.controller.js` (11%) and `tasks.js` (23%); MCP `update_task`, `list_tasks`, `create_tasks` untested |
| BLOCK | 0 | — |
| Regressions | 0 | No failures in any focused suite |

### Coverage verdict
- **WhenSection.jsx:** 34.38% statements — acceptable for a presentational component with heavy conditional UI branches, but the uncovered ~65% includes recurrence anchor editing, timezone selector dropdown interactions, constraint panels (travel, split), and mobile layout paths.
- **TaskEditForm.jsx:** 27.95% statements — the integration test covers the happy-path mount and basic interaction, but most cross-section integration (weather, dependencies, split tasks) is untested.
- **tasks.js (MCP):** 22.94% statements — only `create_task` inference and `batch_update_tasks` guard are tested. The `update_task`, `list_tasks`, `create_tasks` batch, and rolling-anchor paths are entirely uncovered.
- **task.controller.js:** 11.27% statements — this file is 2400+ lines; the only coverage comes from utility functions (`taskToRow`, `rowToTask`) being imported by the MCP test. The actual controller HTTP paths (CRUD, state machine, re-enable, calendar-sync guards) are **not exercised at all** by the focused tests.

---

## Recommendations

1. **Add MCP `update_task` tests** — at minimum cover placement_mode inference on update, rolling-anchor resolution, and the calendar-sync edit guard.
2. **Add MCP `create_tasks` (batch) tests** — verify per-item placement_mode inference and split-default application.
3. **Add TaskEditForm unit tests** that mount with `recurring=true` + `recurType=rolling` and verify the anchor card renders correctly; test timezone change handler; test split-task toggle.
4. **Expand WhenSection tests** to open the timezone selector dropdown and select a timezone, and to expand the constraints panel and interact with travel/split inputs.

---

Overall: PASS with WARN (tests green, coverage thin on controller and MCP tools)
