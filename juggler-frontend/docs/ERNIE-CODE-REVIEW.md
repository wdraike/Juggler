# ERNIE Code Review — Juggler Task Configuration Changes

**Date:** 2026-05-24  
**Scope:**
- `juggler-frontend/src/components/tasks/sections/WhenSection.jsx`
- `juggler-backend/src/mcp/tools/tasks.js`
- `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx`
- `juggler-backend/tests/mcp-task-config.test.js`

---

## Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Warning  | 6 |
| Info     | 5 |

---

## Critical

### C1 — `batch_update_tasks` MCP tool silently omits auto-pin logic

`create_task`, `create_tasks`, and `update_task` all auto-pin when the caller provides `date`/`time`/`scheduledAt` without an explicit `datePinned`. `batch_update_tasks` (both locked and transaction paths) lacks this guard entirely.

**Impact:** Batch-updating 200 tasks to add dates leaves them all unpinned. Updating the same tasks one-by-one would pin them. This is a silent behavioral divergence that breaks the scheduler's assumption that date-bearing tasks are pinned by default.

**Location:** `juggler-backend/src/mcp/tools/tasks.js` — lines 560-606 (locked + transaction paths).

**Fix:** Add the same auto-pin backstop used in `update_task`:
```js
var dateOrTimeSet = fields.date !== undefined || fields.time !== undefined || fields.scheduledAt !== undefined;
if (dateOrTimeSet && fields.datePinned === undefined && row.date_pinned === undefined) {
  row.date_pinned = 1;
}
```

---

### C2 — Backend test names directly contradict their assertions in 3 tests

Test names in `mcp-task-config.test.js` describe the exact opposite of what they assert. If a future developer reads the name (e.g., during a failure) and "fixes" the code to match the name, the tests will break and the fix will be wrong.

**Details:**
1. Line ~93 — name says `date_pinned NOT auto-set`, but asserts `expect(capturedInsertRow.date_pinned).toBe(1)`.
2. Line ~171 — name says `date_pinned = 0`, but asserts `expect(capturedInsertRow.date_pinned).toBeUndefined()`.
3. Line ~216 — name says `does NOT set date_pinned`, but asserts `expect(capturedInsertRow.date_pinned).toBe(1)`.

**Fix:** Rename the tests to match the assertions, or vice-versa. Prefer renaming the tests since the assertions reflect the intended auto-pin contract.

---

## Warning

### W1 — Frontend disabling-test gives false confidence (CSS `pointer-events` vs `disabled` attribute)

The test `no control is disabled without a visible indicator` scans for `el.disabled` on inputs, selects, and buttons. The component, however, disables the mode selector via inline CSS `pointerEvents: 'none'` — not the HTML `disabled` attribute.

**Impact:** The test passes even if the real disabling mechanism is broken or missing. It gives the illusion of accessibility coverage while testing the wrong attribute.

**Location:** `WhenSection.modes.test.jsx` lines 58-73 and 123-126.

**Fix:** Assert on the container's `pointerEvents` style (as the `fixed mode` test does) rather than the `disabled` property.

---

### W2 — `isFixed` test only asserts on label opacity, not on the interactive surface

`isFixed derivation is correct` checks the "Scheduling mode" label's `opacity` style. It does NOT verify that the mode-buttons container (which carries `pointerEvents: 'none'`) is actually non-interactive.

**Impact:** A regression that broke `isFixed` calculation for the buttons but left the label styled correctly would not be caught.

**Location:** `WhenSection.modes.test.jsx` lines 107-121.

**Fix:** Also query the button container (the `div` with `pointerEvents`) and assert its style when `expectedIsFixed` is true.

---

### W3 — Auto-pin guard is inconsistent between create (truthiness) and update (presence)

- **Create paths** (`create_task`, `create_tasks`) use truthiness: `(task.date || task.time || task.scheduledAt)`.
- **Update path** (`update_task`) uses presence: `fields.date !== undefined || fields.time !== undefined || fields.scheduledAt !== undefined`.

**Impact:** A caller sending `date: ''` (or `time: ''`) to clear a field will:
- **Not** trigger auto-pin on create (falsy → skipped).
- **Will** trigger auto-pin on update (`'' !== undefined` → true).

This means an MCP agent that explicitly sends `date: ''` to unschedule a task will accidentally pin it on update. The REST controller shares the same update behavior, but MCP callers (agents) are far more likely to send explicit empty strings than human users.

**Location:** `tasks.js` lines 137, 197, 273.

**Fix:** Align update to the same truthiness check as create, or add an explicit `v !== undefined && v !== '' && v !== null` guard.

---

### W4 — "All Day" mode handler preserves stale `time` / `endTime` / `dur` in parent state

Clicking "All Day" calls `onModeChange('all_day')` and `onDatePinnedChange(false)`, but it does **not** clear `time`, `endTime`, or `dur`. The inputs are hidden, so the user cannot see or edit them. If the parent form saves without sanitizing, the backend receives `placementMode: 'all_day'` alongside a non-empty `time` value.

**Impact:** The backend stores a contradictory state (all-day task with a specific time). The scheduler may behave unpredictably when `all_day` and `scheduled_at` with a time coexist.

**Location:** `WhenSection.jsx` line 323.

**Fix:** Clear `time`, `endTime`, and `dur` in the All Day handler, or ensure `TaskEditForm` strips time fields before sending when `placementMode === 'all_day'`.

---

### W5 — Keyboard users can still activate mode buttons when `isFixed` is true

The component disables mouse interaction via `pointerEvents: 'none'` on the mode-selector container. It does **not** add `disabled` attributes or intercept keyboard events in the `onClick` handlers.

**Impact:** A keyboard user (Tab + Enter) can switch a `fixed` or pinned task out of its mode even though the UI visually indicates it is locked. This is a state-consistency bug.

**Location:** `WhenSection.jsx` lines 309-325.

**Fix:** Add an early-return guard in each mode `onClick`:
```js
if (isFixed) return;
```

---

### W6 — `fixed mode` test uses `.closest('div')` which is DOM-structure brittle

The assertion `expect(anytimeBtn.closest('div')).toHaveStyle({ pointerEvents: 'none' })` assumes the immediate parent is a `div`. If a layout wrapper is added around the button, `.closest('div')` will match the wrapper instead and the test will break or pass spuriously.

**Location:** `WhenSection.modes.test.jsx` lines 163-166.

**Fix:** Add a `data-testid="mode-selector-container"` to the target `div` and query it explicitly.

---

## Info

### I1 — Backend test file only covers `create_task`; batch + update paths are untested

`mcp-task-config.test.js` has 12 tests, all targeting the single-task `create_task` handler. The following MCP paths have `placement_mode` / `date_pinned` logic but zero coverage:
- `create_tasks` (batch create) — lines 187-209
- `update_task` — lines 244-281
- `batch_update_tasks` — lines 560-606

**Recommendation:** Add at least one test per path for the ALL_DAY backstop and auto-pin behavior.

---

### I2 — `placementMode: 'reminder'` is a valid MCP enum but absent from frontend UI

The Zod schema accepts `'reminder'`, but the frontend `MODES` array and mode-selector buttons do not include it. For actual marker tasks (`marker === true`), the scheduling section is hidden entirely, so the gap is invisible. For non-marker tasks with `placementMode: 'reminder'`, the UI shows no selected mode button.

**Location:** `tasks.js` line 58; `WhenSection.modes.test.jsx` line 42.

---

### I3 — Cross-field validation gaps in Zod schema

The `taskInputFields` schema does not enforce semantic consistency between fields:
- `placementMode: 'fixed'` + `datePinned: false` is allowed.
- `placementMode: 'all_day'` + non-empty `time` is allowed.
- `placementMode: 'time_blocks'` + `when: ''` is allowed.

The scheduler may handle these at runtime, but the MCP contract is permissive.

---

### I4 — `update_task` extra guard `row.date_pinned === undefined` is redundant but harmless

`taskToRow` only writes `date_pinned` when the input object's `datePinned !== undefined`. Therefore, when `fields.datePinned === undefined`, `row.date_pinned` is guaranteed to be undefined. The extra check in `update_task` (line 274) is defensive but not load-bearing.

---

### I5 — `when` refine correctly blocks reserved tags `fixed` and `allday`

The Zod `.refine()` on `when` rejects strings containing `fixed` or `allday`, preventing callers from accidentally using reserved calendar-sync tags. This is a good defensive pattern and should be preserved.

**Location:** `tasks.js` lines 26-31.
