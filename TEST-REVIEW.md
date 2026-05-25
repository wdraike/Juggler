# Test Review — When-mode Simplification (datePinned removal)
# juggler / 2026-05-25

## Verdict: PASS

All tests green. 3 Zoe BLOCK findings resolved via 1 bert iteration. 7 Zoe WARNs + 4 Bird WARNs resolved via 2 additional bert iterations. UX-4 (viewport Playwright test) deferred with user approval.

---

## Test counts

| Suite | Before | After |
|-------|--------|-------|
| Backend tests passing | 1443 | 1481 |
| Frontend tests passing | 372 | 398 |
| Backend suites | 99/107 active | 107/107 active |

Before: 8 failing backend suites, 24 failing tests.
After: 0 failing suites, 0 failing tests (27 skipped = DB-gated integration tests without live DB + xdescribed removed-endpoint blocks).

---

## Failing tests found and repaired (telly)

| Suite | Root cause | Fix |
|-------|-----------|-----|
| `taskControllerUnit.test.js` | `datePinned` assertion on `rowToTask` output | Updated to check `placementMode` |
| `taskMapping.test.js` | `task.datePinned` / `row.date_pinned` assertions | Removed; new contract documented |
| `taskPipeline.test.js` | `prevWhen` field removed from `rowToTask` | Replaced drag-pin block with placement_mode fields block (4 tests) |
| `mcp-task-config.test.js` | Multiple `date_pinned: 1` auto-set assertions | Rewrote to assert `placement_mode` only |
| `schedulerRules.test.js` (Groups 10, 15, 28, 65, 66) | `datePinned: true` in `makeTask()` — scheduler ignores it | Replaced with `placementMode: 'fixed'` + time anchors |
| `cal-sync/02-adapter-msft.test.js` | `expect(fields.date_pinned).toBe(1)` | Updated to assert `placement_mode === FIXED`, confirm `date_pinned` absent |
| `unifiedSchedule.test.js` | `when: 'allday'` stripped as legacy | Changed to `placementMode: 'all_day'` |
| `disabledStatus.test.js` | Mock queue ordering: 3-arg `Promise.all` got wrong resolves | Added missing `user_calendars` resolve, reordered queue |

---

## Coverage gaps filled (telly)

| Gap | Tests added |
|-----|------------|
| `guardFixedCalendarWhen` new behavior | 7 unit tests: strips non-fixed mode on cal-linked tasks, preserves fixed, allowUnfix bypass, all 3 providers |
| New drag-to-fixed PATCH path | 4 unit tests: `placementMode: 'fixed'` writes `placement_mode`, no derivation when absent |
| `validateTaskInput` cross-field fixed-mode check | 3 tests: error without date/time, no error with date+time, no error with scheduledAt |
| Scheduler `placement_mode === 'fixed'` anchor | Covered by repaired schedulerRules groups + existing schedulerSupplyDemand suite |
| WhenSection Fixed button | Already covered in existing `WhenSection.modes.test.jsx` |

---

## Zoe BLOCK findings resolved (bert iteration 1)

| Finding | Fix |
|---------|-----|
| Z-1: `taskMapping.test.js` — no assertion `datePinned` absent from `rowToTask` output | Added `expect(task.datePinned).toBeUndefined()` |
| Z-2: `taskMapping.test.js` — no assertion `date_pinned` absent from `taskToRow` + round-trip gap | Added `expect(row.date_pinned).toBeUndefined()` + `expect(result.datePinned).toBeUndefined()` |
| Z-3: `taskCrudIntegration.test.js` — live drag-pin + unpinTask blocks silently skip on CI but fail with real DB | Changed to `xtest`/`xdescribe` documenting removed features |

---

## Zoe WARN findings resolved (bert iterations 2–3)

| Finding | Fix |
|---------|-----|
| Z-4: msft adapter `date_pinned` absent not asserted in "time changes" + "allday-to-timed" tests | Added `expect(fields.date_pinned).toBeUndefined()` to both tests |
| Z-5: 11 `datePinned: true` explicit overrides in `schedulerRules.test.js` — exercising inert field | Converted all to `placementMode: 'fixed'` + time anchors; Group 28C restructured |
| Z-5 semantic: `flex_eve` passed via force-placement not flexWhen; `load_` unplaced branch unreachable | `flex_eve` → `placementMode: 'time_window'`; `load_` → time anchors + unconditional assertions |
| Z-6: No test for `placementMode: 'fixed'` + date-only (no time) in validateTaskInput | Added test: date-only passes validator (handler enforces date+time, not validator) |
| Z-7: No scheduler test for invalid `placement_mode` value | Added Group 71: `placementMode: 'unknown_value'` — no crash, placed, `locked: false` |
| B-1 residual: No active test asserts `redis.invalidateTasks` for `updateTask` | Added assertion to "converts recurring to one-off" active test |
| B-3 residual: Re-drag snapshot guard not exercised | Moot — `_dragPin` and `!existing.date_pinned` guard removed in redesign |

---

## Bird UX WARN findings resolved (bert iterations 2–3)

| Finding | Fix |
|---------|-----|
| UX-1: Mode buttons missing `aria-pressed` / `role="group"` | Added `role="group" aria-label="Scheduling mode"` + `aria-pressed` to all 5 non-recurring + 4 recurring buttons |
| UX-2: Fixed button absent from recurring mode selector | Added guard: cal-managed → "Calendar-managed" banner; non-cal → "Fixed not available" message + 4 valid mode buttons |
| UX-3: Silent failure when Fixed task has no date/time | Client-side validation in `TaskEditForm.handleSave`; backend error string propagated via `useTaskState.updateTask`; `role="alert"` render |
| UX-4: 5-button viewport overflow at 320px unverified | **DEFERRED — user approved. No browser available.** Backlog item: TC-W001 Playwright across 7 viewports |
| UX-5: No unit tests for Fixed button behaviors | Created `WhenSection.fixed.test.jsx` with 26 tests (TC-W002 through TC-W007) |

---

## New test files

| File | Tests | Coverage |
|------|-------|----------|
| `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.fixed.test.jsx` | 26 | TC-W002–W007: Fixed button render, cal-managed lock, non-cal unlock, "Date is pinned" regression, save validation, recurring guard |

---

## Files modified

**Backend tests:**
- `tests/taskControllerUnit.test.js` — +20 tests (guardFixedCalendarWhen, drag-to-fixed PATCH, validateTaskInput, date-only fixed)
- `tests/taskMapping.test.js` — absence assertions added (datePinned, date_pinned, round-trip)
- `tests/taskPipeline.test.js` — drag-pin block → placement_mode fields block
- `tests/mcp-task-config.test.js` — rewritten for placement_mode contract
- `tests/schedulerRules.test.js` — Groups 10/15/25/28/55/65/66 repaired; Group 71 added (invalid placement_mode + unknown_value)
- `tests/taskCrudIntegration.test.js` — drag-pin + unpinTask → xtest/xdescribe
- `tests/taskCrudIntegration2.test.js` — taskMapping absence assertions; redis.invalidateTasks active assertion
- `tests/cal-sync/02-adapter-msft.test.js` — `date_pinned` absent asserted in all 3 adapter tests
- `tests/unifiedSchedule.test.js` — allday → placementMode: 'all_day'
- `tests/disabledStatus.test.js` — mock queue ordering fixed

**Frontend tests:**
- `src/components/tasks/sections/__tests__/WhenSection.fixed.test.jsx` — new file, 26 tests
- `src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx` — recurring+fixed guard matrix updated

**Source files (UX fixes):**
- `src/components/tasks/sections/WhenSection.jsx` — aria-pressed, role="group", recurring Fixed guard
- `src/components/tasks/TaskEditForm.jsx` — client-side Fixed validation, saveError render
- `src/hooks/useTaskState.js` — backend error string propagation

---

## Agent Iterations

| Iteration | Agent | Findings | Outcome |
|-----------|-------|----------|---------|
| 1 | telly | 8 broken suites repaired, 5 coverage gaps filled | 1481 BE / 372 FE |
| 1 | bird | 5 UX WARNs | WARN |
| 2 | zoe | 3 BLOCKs + 4 WARNs | BLOCK |
| 2 | bert | Fixed Z-1, Z-2, Z-3 BLOCKs | All tests pass |
| 3 | zoe (re-run) | BLOCKs resolved; Z-4/Z-5/Z-6/Z-7 WARNs remain | WARN |
| 3 | bert | Fixed Z-4, Z-5, Z-6, Z-7, B-1 residual, UX-1, UX-2, UX-3, UX-5 | 1481 BE / 398 FE |
| 4 | bert | Fixed Z-5 semantic (flex_eve, load_), B-1 residual (redis), UX-2 banner fork | 1481 BE / 398 FE |
| 4 | zoe (re-verify) | All resolved PASS | PASS |
| 4 | bird (re-verify) | All resolved PASS | PASS |

---

## Deferred Items

| Item | Reason | Approval |
|------|--------|----------|
| UX-4: TC-W001 Playwright viewport test for 5-button mode selector at 320px | Requires running browser — not available | User approved 2026-05-25 |

---

Signed: Oscar Test Phase — 2026-05-25
