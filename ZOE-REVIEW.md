# ZOE Adversarial Test Audit — Focus: task.controller.js, MCP tasks.js, TaskEditForm, WhenSection

_Date: 2026-05-24_
_Scope: Test files Telly ran for the focused review (TEST-REVIEW.md)_

---

## Verdict: WARN

The 277 reported passes contain a **critical false pass**, multiple shallow assertions that could mask write failures, and large swaths of untested logic across MCP `update_task`, `create_tasks`, `list_tasks`, and frontend integration paths. No regressions detected, but the suite overstates its coverage.

---

## Files Under Audit

| File | Tests (claimed) | Tests (actual) | Runtime tests |
|------|-----------------|----------------|---------------|
| `juggler-backend/tests/mcp-task-config.test.js` | 16 | 16 `test(` | 16 |
| `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx` | ~160 | 26 `it(` in source | **221** (Jest expands 5 matrix `it` × 40 combinations + 21 standalone) |
| `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx` | ~98 | **37** `it(` | 37 |
| `juggler-frontend/src/components/tasks/__tests__/TaskEditForm.integration.test.jsx` | 3 | 3 `it(` | 3 |

**Note:** Telly's counts for the two WhenSection suites are incorrect. `modes.test.jsx` expands to 221 runtime tests, not "~160". `test.jsx` is 37 tests, not "~98". The counts in TEST-REVIEW.md are unreliable.

---

## Backend — `mcp-task-config.test.js`

### WARN-1: False-pass risk on mutating tests (shallow assertions)

**All 16 backend tests mock `tasksWrite.insertTask` and `tasksWrite.updateTaskById` as no-ops.** The tests assert on `capturedInsertRow` or `result.content[0].text`, but they **never verify that the mocked DB layer was actually invoked** or that the produced row would survive real `taskToRow` / `rowToTask` round-trips.

Examples:
- `create_task` tests: `insertTask` is a no-op; `db.insert` is never asserted.
- `batch_update_tasks` "allowed" test: asserts `result.isError` is undefined and text matches `/updated/i`, but the transaction path inside the handler could skip `tasksWrite.updateTaskById` entirely and the test would still pass because the mock returns success unconditionally.

**Required fix:** Add assertions that `capturedInsertRow` / `capturedUpdateRow` contain the expected fields after every mutating test, or run integration tests against an actual test DB.

---

### WARN-2: MCP `update_task` has **zero** tests

The `update_task` MCP handler (tasks.js L236-363) contains complex, production-critical logic that is entirely uncovered:
- Calendar-sync guard (different from HTTP guard — see WARN-4)
- `placementMode: 'fixed'` validation against existing `scheduled_at`
- `taskToRow` with `existing` fallback
- Auto-pin and `ALL_DAY` backstop on update
- Recurring instance → template field routing (TEMPLATE_FIELDS split)
- `guardFixedCalendarWhen` on `when` changes
- Locked-path split-and-queue behavior (`splitFields`)
- Post-update `rowToTask` response assembly

**Required fix:** Add at minimum: placement_mode inference on update, rolling-anchor resolution, calendar-sync edit guard, and template/instance routing.

---

### WARN-3: MCP `create_tasks` (batch) has **zero** placement_mode / date_pinned tests

The batch handler (tasks.js L166-233) mirrors `create_task` inference per-item and adds transaction logic. None of the 16 existing tests exercise it.

**Required fix:** Add batch tests verifying per-item `placement_mode` inference, `split` default application, and transaction rollback on mid-batch failure.

---

### WARN-4: MCP/HTTP cal-sync guard inconsistency — untested behavioral divergence

`checkCalSyncEditGuard` in `task.controller.js` (L76) allows `['status', 'notes', 'datePinned', '_dragPin', '_allowUnfix']`.

Both MCP `update_task` (tasks.js L259) and `batch_update_tasks` (tasks.js L558) allow **only** `['status', 'notes']`.

This means an MCP client **cannot** change `datePinned` on a synced task, but a UI user **can**. No test documents or locks this divergence. If it is intentional, it needs a test proving it; if it is a bug, it needs a fix.

**Required fix:** Add an MCP test sending `datePinned: false` on a synced task and assert the behavior (currently expected: `isError: true` with blocked fields). Add a parallel HTTP controller test proving the same payload succeeds (or is blocked, if the divergence is a bug).

---

### WARN-5: Locked paths in all MCP tools are untested

The mock for `isLocked` hardcodes `false`. The queue-based write paths (`enqueueWrite`) inside `create_task`, `create_tasks`, `update_task`, and `batch_update_tasks` are **never exercised**.

**Required fix:** Temporarily mock `isLocked` to `true` and verify that writes are queued rather than committed directly, and that `enqueueScheduleRun` receives the correct IDs.

---

### WARN-6: `list_tasks` MCP tool has **zero** tests

Covers: default done-exclusion, `includeDone`, status override, project filter, date filter, limit, `buildSourceMap`, `rowToTask` mapping. All untested.

**Required fix:** Add tests for default exclusion, status override, and date string filtering.

---

### WARN-7: No negative / boundary / validation tests for `create_task`

The `validateTaskInput` function (task.controller.js L699+) enforces many rules. None are tested via MCP:
- Missing `text` (when `_requireText` is true)
- `text` > 500 chars
- Invalid `dayReq`
- `dur` <= 0
- `splitMin` > `dur`
- `deadline` < `startAfter`
- Invalid `recur` object (bad type, missing `recurStart` for anchor-dependent patterns)
- `timeFlex` outside 0-480

**Required fix:** Add at least one negative test per validation branch to prevent silent regressions.

---

### WARN-8: No auth / wrong-user negative tests

All mocks hardcode `userId = 'test-user-001'`. No test verifies cross-user isolation (e.g., user A's MCP handler cannot write to user B's task row).

**Required fix:** Add a test where `req.user.id` (or the MCP user context) mismatches the task owner; assert `404` or `403`.

---

## Frontend — `WhenSection.modes.test.jsx`

### WARN-9: Critical false pass — `hasDisabledWithoutIndicator` is completely vacuous

`WhenSection.jsx` **never sets the `disabled` attribute** on any control. Lockouts are implemented via CSS `pointerEvents: 'none'` and `tabIndex: -1` (WhenSection.jsx L314, L316-317, L332). The helper `hasDisabledWithoutIndicator` (L58-73) queries `el.disabled`, which is always `false`, so the test always passes regardless of whether controls lack visible accessibility indicators.

This is a **false pass** — the test claims to guard a11y compliance but does not exercise the actual lockout mechanism.

**Required fix:** Replace the helper with one that checks for `pointerEvents: 'none'` / `tabIndex: -1` and verifies a sibling or parent has explanatory text (e.g., the "Date is pinned" or "Calendar-managed" banner).

---

### WARN-10: 40 zero-assertion "renders without crashing" tests are pure noise

The matrix includes `it('renders without crashing', () => { render(...); });` — no assertion, no behavioral verification. 40 combinations × 1 no-op = 40 tests that inflate the pass count and consume CI time without adding coverage.

**Required fix:** Remove or replace with a meaningful assertion (e.g., snapshot of the rendered DOM, or verification that tier1/tier2/tier3 sections are present).

---

### WARN-11: `isFixed` derivation test silently skips most matrix cases

For `recurring=true` or `marker=true`, the "Scheduling mode" label is absent from the DOM, so the test skips the opacity assertion. This means **20 of the 40 combinations** (all `recurring=true` cases, plus any `marker=true` if it were in the matrix) receive no assertion in this test.

**Required fix:** Move the assertion to a property that exists for all combinations, or split into separate describe blocks so skipping is explicit.

---

### WARN-12: Misleading recurring button count in test comment

The test comment says "Recurring section shows 3 buttons" but `WhenSection.jsx` (L417-446) renders **4** buttons for recurring tasks: Anytime, Time window, Time blocks, and All Day. The test omits the `allDay` assertion for recurring, so it passes while the comment is wrong.

**Required fix:** Update comment or add the `allDay` assertion.

---

### WARN-13: Missing mobile-responsive path tests

`isMobile` changes `BTN_H`, font sizes, padding, and maxWidths throughout the component. Zero matrix combinations set `isMobile: true`.

**Required fix:** Add a mobile-specific describe block or parameterize `isMobile` into the matrix.

---

## Frontend — `WhenSection.test.jsx`

### WARN-14: Missing timezone selector interaction tests

`TimezoneSelector` (WhenSection.jsx L58-153) supports open, search, select, and click-outside. None of these are exercised.

**Required fix:** Open the dropdown, type a search string, select a timezone, and assert `onChangeTz` is called with the correct value.

---

### WARN-15: Missing endTime three-way binding and error tests

The component enforces `finish = start + dur` via state handlers (L260-291). `endTimeError` is rendered at L296. None of the 37 tests verify:
- Editing `endTime` recalculates `dur`
- Editing `dur` updates `endTime`
- `endTimeError` appears when finish <= start
- `endTimeError` is cleared when finish > start

**Required fix:** Add tests for the three-way bind and the error state.

---

### WARN-16: Missing monthly and interval recurrence tests

`recurType='monthly'` (month-day picker, times-per-month select) and `recurType='interval'` (every N + unit) are in the source but have **zero** tests.

**Required fix:** Add tests rendering both modes and interacting with their controls.

---

### WARN-17: Shallow rolling-anchor tests

The rolling anchor card (L660-676) computes and displays "Next due" by adding the interval to `task.rolling_anchor`. The tests only check text presence (`Completed on`, `Next due`), not the computed date accuracy. A bug in `addIntervalToDate` (L44-51) would not be caught.

**Required fix:** Assert the exact rendered date text for known inputs (e.g., anchor `2026-05-19` + 7 days = `May 26, 2026`).

---

### WARN-18: Missing constraint panel interactions

The Constraints collapsible section (L719-769) contains deadline, startAfter, travelBefore, travelAfter, split, and splitMin inputs. None are exercised in the 37 tests.

**Required fix:** Expand the constraints section and interact with at least travel and split controls.

---

### WARN-19: Time window ± Window select behavior untested

The `± Window` select (L346-357) toggles `rigid` and `timeFlex` simultaneously. Selecting `exact` sets `rigid=true` and `timeFlex=0`. No test verifies this side effect.

**Required fix:** Fire `change` on the select and assert both `onRigidChange` and `onTimeFlexChange` receive the expected values.

---

## Frontend — `TaskEditForm.integration.test.jsx`

### WARN-20: Three tests for a 600+ line component is grossly insufficient

The integration suite covers: renders title, When section expanded by default, toggle collapse. It does **not** cover:
- Save flow (dirty detection, `buildChangedFields`, API call)
- Cancel / close behavior
- Cross-section integration (weather, dependencies, location, tools)
- `apiClient` call verification (the mock is imported but never asserted)
- Create mode vs edit mode initialization
- Dark mode / mobile responsive rendering
- Split-task toggle in constraints
- Recurrence anchor autofill (`autofillGuardRef` + `useEffect`)

**Required fix:** Add at least: save button triggers `onUpdate` with correct changed fields, create mode initializes empty state, and a recurring task mounts with rolling anchor card visible.

---

## Summary

| Status | Count | Details |
|--------|-------|---------|
| PASS | 0 | — |
| WARN | 20 | Shallow assertions, false passes, missing boundaries, missing negative/auth tests, untested behavioral divergence |
| BLOCK | 0 | Core happy-path coverage is present; no regressions introduced |

---

## Action Items (priority order)

1. **Fix false pass WARN-9** — Replace `hasDisabledWithoutIndicator` with a real a11y lockout verifier.
2. **Harden mutating assertions WARN-1** — Assert on `capturedUpdateRow` fields after every backend write test.
3. **Add MCP `update_task` tests WARN-2** — Cover guard, inference, template routing.
4. **Add MCP `create_tasks` batch tests WARN-3** — Per-item inference + transaction.
5. **Document cal-sync guard divergence WARN-4** — Add tests that lock the current MCP-only `status/notes` restriction.
6. **Add locked-path tests WARN-5** — Mock `isLocked=true` and verify queue behavior.
7. **Add `list_tasks` tests WARN-6** — Done-exclusion, filters, limits.
8. **Add validation negative tests WARN-7** — One per `validateTaskInput` branch.
9. **Add wrong-user auth test WARN-8** — Close the authorization gap.
10. **Remove or replace zero-assertion tests WARN-10** — Stop inflating pass counts.
11. **Expand TaskEditForm integration tests WARN-20** — Save flow + cross-section coverage.
12. **Add timezone, endTime, constraint, monthly/interval tests WARN-14 through WARN-19**.

---

_Reviewer: Zoe_
_Mode: Adversarial / No trust in Telly's run counts or Bird's UX verdicts_
