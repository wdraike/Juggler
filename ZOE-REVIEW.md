# Zoe's Adversarial Test Review — 2026-05-25 (When-mode simplification)

---

## Re-Verification — 2026-05-25 (bert's Z-4/Z-5/Z-6/Z-7 + B-1/B-3 residual fixes)

_Files read: cal-sync/02-adapter-msft.test.js (full grep + lines 220-300), schedulerRules.test.js (factory lines 21-40, lines 580-610, 660-676, 800-825, 1183-1195, 1258-1280, 1540-1560, 1679-1707), taskControllerUnit.test.js (lines 430-453), taskCrudIntegration2.test.js (full grep + lines 314-540, 600-640), unifiedScheduleV2.js (lines 286-340, 1688-1720 — scheduler behavior verification)_

### Overall Verdict: WARN

Z-4, Z-6, and Z-7 are resolved. Z-5 is resolved for the factory/shim concern but two semantic issues were introduced by the conversion. B-1 residual is NOT moot — the active updateTask paths have no `redis.invalidateTasks` assertion. B-3 residual is correctly moot.

---

### Z-4 — cal-sync/02-adapter-msft.test.js `date_pinned` in "time changes" and "allday-to-timed": RESOLVED (PASS)

**What bert did:** Added `expect(fields.date_pinned).toBeUndefined()` at lines 241 (time changes test), 262 (date changes test), and 283 (allday-to-timed test), each with an explanatory comment.

**Zoe's verification:** All three tests are present and correctly placed inside the `applyEventToTaskFields` describe block. The assertions would catch any re-introduction of `date_pinned` writes in the adapter. All three remain gated by `if (skipIfNoCreds()) return` — CI-skipped — which was always the case for this test file.

**Verdict: RESOLVED (PASS)**

---

### Z-5 — schedulerRules.test.js `makeTask` overrides converted to `placementMode: 'fixed'`: PARTIALLY RESOLVED (WARN)

**What bert did:** Converted all 11 former `datePinned: true` explicit overrides to `placementMode: 'fixed'`. The `makeTask` factory has zero `datePinned` references (confirmed: grep returns no results). Group 28C restructured to use `dayReq: 'weekday'` on a Sunday instead of `datePinned: true`.

**Zoe's finding — two semantic issues introduced:**

**Issue A — `flex_eve` (line 670):** `makeTask({ id: 'flex_eve', when: 'evening', dur: 60, date: TOMORROW, flexWhen: true, text: 'Flex evening', placementMode: 'fixed' })` has no `time` field. With `placementMode: 'fixed'` and no time, the scheduler computes `anchorMin = null` (scheduler line 331: `anchorMin` only set when `t.time` is present and mode is not ANYTIME). The force-placement pass then places it at evening block start with `_conflict: true` when evening is full. The test asserts `expect(isPlaced(result, 'flex_eve')).toBe(true)` — this passes via force-placement, NOT via the flexWhen relaxation the test name claims. Previously, with `datePinned: true` (ignored by scheduler), the task entered the greedy pool and `flexWhen: true` drove it outside the full block. The conversion changed the behavior the test is actually exercising, without updating the assertion or comment. The test passes for the wrong reason.

**Issue B — `load_` tasks (Group 55, line 1270):** 30 tasks with `placementMode: 'fixed'`, `date: TODAY` (from factory), and no `time`. All will attempt force-placement at `nowMins` stacked on the same date. The test assertion `if (result.unplaced && result.unplaced.length > 0) { ... }` is conditional — it passes vacuously if all 30 force-placed tasks appear in `result.dayPlacements` (which force-placement guarantees). The test was previously using `datePinned: true` (ignored by scheduler, tasks placed as normal greedy pool items) and genuinely tested which tasks were unplaceable. With `placementMode: 'fixed'`, force-placement ensures none are in `result.unplaced`, making the outer `if` branch dead. The test effectively becomes a no-op.

Neither issue is a BLOCK — the tests do not regress the scheduler and no false-PASS exists that would mask a real regression. But both tests are now testing behavior different from their documented intent, and Issue B has a dead branch that tests nothing.

**Verdict: WARN (Z-5 partially open)**

---

### Z-6 — validateTaskInput `placementMode: 'fixed'` with date-only: RESOLVED (PASS)

**What bert did:** Added test at `taskControllerUnit.test.js` lines 446-451: `validateTaskInput({ placementMode: 'fixed', date: '2026-05-20' })` asserts no error matching `/placementMode "fixed"/i`. Comment at lines 447-449 explains the OR semantics and why date-only must pass the shared validator (stricter date+time requirement lives in the handler, not the validator).

**Zoe's verification:** The test is real and correctly positioned alongside the other cross-field tests (fixed-no-info, fixed+date+time, fixed+scheduledAt, fixed+date-only). The assertion would catch any tightening of `validateTaskInput` that rejects date-only. The comment documents the deliberate validator/handler boundary.

**Verdict: RESOLVED (PASS)**

---

### Z-7 — No scheduler test for invalid `placement_mode` value: RESOLVED (PASS)

**What bert did:** Added Group 71 at `schedulerRules.test.js` lines 1680-1705. Test creates a task with `placementMode: 'unknown_value'`, asserts `result` is defined, `dayPlacements` exists, task is placed (`isPlaced(result, 'unknown_pm') === true`), and all placement parts have `locked: false`.

**Zoe's verification:** The assertions are real and sufficient. The scheduler at line 286 falls through to `pm = t.placementMode || PLACEMENT_MODES.ANYTIME` — an unrecognized value is neither FIXED, ALL_DAY, nor REMINDER, so it enters the greedy pool without the rigid/fixed path. `locked: false` is the correct expectation. This directly catches a regression where unknown values would crash or incorrectly lock tasks.

**Cosmetic note only:** There are now two `describe('Group 71: ...')` blocks in the file — the new placement test (line 1680) and a pre-existing 'Group 71: UTC conversion round-trip' block in the Timezone section (line 1721). The name collision is harmless to test execution but is confusing and should be renumbered.

**Verdict: RESOLVED (PASS)**

---

### B-1 residual — `redis.invalidateTasks` on JSON-format unpin paths: NOT MOOT (WARN)

**Bert's claim:** "The assertions are already present in xdescribe blocks (those paths test the removed unpinTask endpoint, now xdescribed)."

**Zoe's finding:** Bert's claim is factually correct about the assertions being in xdescribe — but the reasoning for accepting this as sufficient is wrong.

The three `expect(redis.invalidateTasks).toHaveBeenCalledWith(USER_ID)` assertions (lines 334, 371, 393) are all inside `xdescribe('unpinTask — endpoint removed', ...)` starting at line 319. They are never executed.

The replacement flow — drag-drop now sends `PATCH /tasks/:id` with `placementMode: 'fixed'` via the normal `updateTask` handler — is covered by active tests (describe('Recurring toggle-off cleanup') and the placemod tests in taskCrudIntegration.test.js). However, none of the active `updateTask` calls in `taskCrudIntegration2.test.js` assert `redis.invalidateTasks`. The redis mock (`jest.mock('../src/lib/redis', ...)` at line 16) IS active for the whole file including the live describe blocks — but the spy is never asserted in any live test.

Deleting `cache.invalidateTasks(req.user.id)` from the `updateTask` handler would leave all active tests green. The cache-invalidation contract for the primary task mutation path is unprotected.

**Verdict: WARN (open)**

---

### B-3 residual — unpin-after-redrag round-trip untested: MOOT (PASS)

**Bert's claim:** "Already in xdescribe blocks for removed features."

**Zoe's finding:** Correct. The `!existing.date_pinned` re-drag guard at `task.controller.js` line ~1123 was part of the `_dragPin` code path. That entire code path (the `_dragPin` body flag handling) was removed in the When-mode simplification. Drag-drop now sends a plain PATCH with `placementMode: 'fixed'`, which does not involve a `prev_when` snapshot or a re-drag guard. There is no longer a re-drag scenario to test — the `xdescribe('updateTask: drag-pin — _dragPin flag removed')` block correctly documents the removed behavior, not a live gap.

**Verdict: MOOT (PASS)**

---

### Accountability Table — This Session

| Finding | Prior Status | Fix Claimed | Zoe Verified | Verdict |
|---------|-------------|-------------|--------------|---------|
| Z-4: `date_pinned` absent in "time changes" + "allday-to-timed" | WARN (open) | `expect(fields.date_pinned).toBeUndefined()` added to both tests | Yes — lines 241, 262, 283 | RESOLVED |
| Z-5: 11 `datePinned` overrides converted to `placementMode: 'fixed'` | WARN (partial) | All 11 converted; Group 28C restructured | Yes — zero `datePinned` in file; two semantic issues in converted tests | PARTIAL WARN |
| Z-6: `validateTaskInput` fixed+date-only test | WARN (open) | Added date-only test case | Yes — lines 446-451 | RESOLVED |
| Z-7: Invalid placement_mode scheduler test | WARN (open) | Group 71 added | Yes — lines 1680-1705 | RESOLVED |
| B-1 residual: JSON-format unpin paths + `redis.invalidateTasks` | WARN (open) | "In xdescribe" | No — xdescribe blocks are skipped; active updateTask tests have zero cache assertions | WARN (open) |
| B-3 residual: unpin-after-redrag round-trip | WARN (open) | "In xdescribe for removed feature" | Yes — `_dragPin` code path removed; no re-drag guard exists; moot | MOOT (PASS) |

---

### Required Actions — Current State

- [ ] **WARN (Z-5 Issue A):** Fix `flex_eve` test in Group 25 (`schedulerRules.test.js` line 670). Either remove `placementMode: 'fixed'` so `flexWhen: true` drives placement as originally intended, or update the assertion and comment to reflect that this now tests force-placement on a `fixed` task with no time anchor. The current test passes for a reason inconsistent with its documented intent.
- [ ] **WARN (Z-5 Issue B):** Fix Group 55 `load_` tasks (`schedulerRules.test.js` line 1270). Remove `placementMode: 'fixed'` from the 30 load tasks — they should be greedy-pool tasks so some are genuinely unplaced when the day overflows, making the conditional assertion branch reachable. Alternatively, change the test intent explicitly.
- [ ] **WARN (B-1 residual):** Add `expect(redis.invalidateTasks).toHaveBeenCalledWith(USER_ID)` to at least one active (non-xdescribed) `updateTask` call in `taskCrudIntegration2.test.js` — e.g., the 'converts recurring to one-off' test at line 606 or a dedicated PATCH placement_mode test — to lock cache invalidation for the standard update path.
- [ ] **COSMETIC (Z-7):** Renumber the 'Group 71: UTC conversion round-trip' describe block in the Timezone section to avoid the duplicate Group 71 label.

---

_Reviewer: Zoe_
_Mode: --re-review (bert's Z-4/Z-5/Z-6/Z-7 + B-1/B-3 residual fixes)_
_Date: 2026-05-25_

---

_Auditing Telly's work on the When-mode simplification test repairs and gap fills._
_Scope: taskControllerUnit.test.js, taskMapping.test.js, taskPipeline.test.js, mcp-task-config.test.js, schedulerRules.test.js, cal-sync/02-adapter-msft.test.js, unifiedSchedule.test.js, disabledStatus.test.js_
_Application changes audited: placement_mode replaces datePinned, guardFixedCalendarWhen, drag-to-fixed PATCH, validateTaskInput cross-field check_

---

## Re-Verification — 2026-05-25 (bert's Z-1/Z-2/Z-3/Z-5 fixes)

_Files read: taskMapping.test.js (full), taskCrudIntegration.test.js (full), schedulerRules.test.js lines 1-43 + grep for datePinned/shim_

### Overall Verdict: WARN

All three BLOCK findings (Z-1, Z-2, Z-3) are resolved. Z-5 is partially resolved — the factory default and dead shim are gone, but `datePinned` is still passed explicitly as an override in eleven test cases where it should now be expressed via `placementMode: 'fixed'`. Three WARNs remain open (Z-4, Z-6, Z-7).

---

### Z-1 — rowToTask `datePinned` assertion: RESOLVED (PASS)

**What bert did:** Added `expect(task.datePinned).toBeUndefined()` at line 63 of `taskMapping.test.js`, inside the `rowToTask` test block. The surrounding context is correct: `sampleRow` still sets `date_pinned: 1` at line 44, meaning if `rowToTask` emitted `datePinned: true` the assertion would fail.

**Regression-catch quality:** Solid. If `rowToTask` re-added `datePinned` output for any reason, this assertion catches it. The full row input with `date_pinned: 1` is the right probe.

**Verdict:** PASS

---

### Z-2 — taskToRow `date_pinned` assertion + round-trip `datePinned` assertion: RESOLVED (PASS)

**What bert did:**
- Added `expect(row.date_pinned).toBeUndefined()` at line 100 of `taskMapping.test.js`, inside the `taskToRow` test block.
- Added `expect(result.datePinned).toBeUndefined()` at line 166, inside the round-trip test block. The round-trip input at line 157 still includes `datePinned: true` in the original task, so the assertion correctly verifies that value is dropped during `taskToRow` and does not re-emerge from `rowToTask`.

**Regression-catch quality:** Solid. Both the write path (taskToRow) and the read path after a round-trip (rowToTask) are now independently locked.

**Verdict:** PASS

---

### Z-3 — drag-pin test and unpinTask describe skipped: RESOLVED (PASS)

**What bert did:**
- `xtest('updateTask: drag-pin — _dragPin flag removed', ...)` at line 239 — the test is disabled with `xtest` and the name now documents the reason (flag removed).
- `xdescribe('unpinTask — endpoint removed', ...)` at line 657 — the entire describe block is disabled with `xdescribe` and the name documents the reason (endpoint removed).

**Regression-catch quality:** Adequate for the stated purpose. These blocks now correctly document dead behavior and will not silently pass when a test DB is present. If `_dragPin` or `unpinTask` were re-added, the tests could be un-skipped and would exercise the behavior. The pattern matches the `taskCrudIntegration2.test.js` precedent (lines 316-317 in that file).

One observation that does NOT change the verdict: the drag-pin `xtest` at line 239-253 still asserts `res2._json.task.datePinned === true` and `res2._json.task.when === 'morning'`. If it were ever re-enabled it would test the old removed API, not a new replacement. That is appropriate given it is documenting removed behavior; the comment at line 249 makes the intent clear.

**Verdict:** PASS

---

### Z-5 — schedulerRules.test.js `makeTask` factory cleanup: PARTIALLY RESOLVED (WARN)

**What bert did:** Removed `datePinned: false` from the `makeTask` factory default at lines 22-40. Removed the dead auto-pin shim (`indexOf('fixed')` conditional). The factory now contains no `datePinned` default and no shim.

**Zoe's finding:** `datePinned` still appears as an explicit `override` in eleven test cases across the file:

| Line | Context |
|------|---------|
| 581 | Group 21 — `early_pinned` backwards dep test |
| 582 | Group 21 — `late_pinned` backwards dep test |
| 604 | Group 22 — `p1_late_a` compaction test |
| 605 | Group 22 — `p1_late_b` compaction test |
| 670 | Group 25 — `flex_eve` flexWhen test |
| 815 | Group 28C — `p1_impossible` score sanity test |
| 816 | Group 28C — `p1_also_big` score sanity test |
| 1192 | Group 49 — `big_split` fragmented day test |
| 1271 | Group 55 — `load_` tasks output contract test |
| 1548 | Group 69 — `warn_a` warning collection test |
| 1549 | Group 69 — `warn_b` warning collection test |

These tests pass `datePinned: true` to the scheduler directly. After the simplification, `placementMode: 'fixed'` is the authoritative immovability signal. `datePinned` is no longer read by the scheduler as the primary anchor. If these eleven tasks are intended to be immovable (pinned to their date), they should use `placementMode: 'fixed'` — otherwise they are testing the scheduler with a field that has no effect, which may cause test expectations to be met for wrong reasons (or not met at all if the scheduler ignores `datePinned`).

This is not a BLOCK because:
- The factory default and dead shim are gone (the requested fix is done).
- The eleven cases are explicit intentional passes to the scheduler, not factory pollution.
- The behavior of each test needs to be evaluated against what the scheduler actually does with the `datePinned` field today.

It is a WARN because the tests may be exercising an inert field, making their assertions either coincidentally correct or testing nothing about immovability.

**Verdict:** WARN (open, carried forward)

---

### Z-4 — cal-sync/02-adapter-msft.test.js `date_pinned` gap: OPEN (WARN)

Not targeted in this fix round. Status unchanged from prior audit.

`expect(fields.date_pinned).toBeUndefined()` is asserted in the "date changes" test only. The "time changes" and "allday-to-timed" tests assert `fields.placement_mode === FIXED` but do not assert `date_pinned` is absent. Both of those test cases are gated by `if (skipIfNoCreds()) return` and are skipped in CI.

---

### Z-6 — validateTaskInput missing `placementMode: 'fixed'` with date-only: OPEN (WARN)

Not targeted in this fix round. Status unchanged from prior audit.

No test for `validateTaskInput({ placementMode: 'fixed', date: '2026-05-20' })` (date only, no time). The source accepts `date` alone as sufficient but no test locks that.

---

### Z-7 — No scheduler-level test for invalid `placement_mode` value: OPEN (WARN)

Not targeted in this fix round. Status unchanged from prior audit.

No test in `schedulerRules.test.js` verifies that a task with `placementMode: 'unknown_value'` reaches the scheduler without crashing and is not anchored at a fixed time.

---

## Accountability Table

| Finding | Prior Status | Fix Claimed | Verified Present | Verdict |
|---------|-------------|-------------|-----------------|---------|
| Z-1: rowToTask `datePinned` unasserted | BLOCK | `expect(task.datePinned).toBeUndefined()` added | Yes — line 63 | RESOLVED |
| Z-2: taskToRow `date_pinned` unasserted + round-trip gap | BLOCK | `expect(row.date_pinned).toBeUndefined()` + `expect(result.datePinned).toBeUndefined()` added | Yes — lines 100, 166 | RESOLVED |
| Z-3: drag-pin test + unpinTask live, silently skipped | BLOCK | `xtest` + `xdescribe` applied | Yes — lines 239, 657 | RESOLVED |
| Z-4: msft adapter `date_pinned` gap in 2 of 4 tests | WARN | Not targeted | — | OPEN |
| Z-5: `makeTask` factory default `datePinned: false` + dead shim | WARN | Factory default removed, shim removed | Yes | PARTIAL — 11 explicit `datePinned` overrides remain in tests; may be exercising an inert field |
| Z-6: `validateTaskInput` missing fixed+date-only test | WARN | Not targeted | — | OPEN |
| Z-7: No scheduler test for invalid `placement_mode` value | WARN | Not targeted | — | OPEN |

---

## Required Actions (current state)

- [ ] **WARN (Z-4):** Add `expect(fields.date_pinned).toBeUndefined()` to the "promote to fixed when time changes" and "promote allday-to-timed to fixed" test cases in `juggler-backend/tests/cal-sync/02-adapter-msft.test.js`.
- [ ] **WARN (Z-5 residual):** Audit the 11 explicit `datePinned: true` overrides in `schedulerRules.test.js` (lines 581, 582, 604, 605, 670, 815, 816, 1192, 1271, 1548, 1549). Determine whether each task is intended to be immovable. If yes, replace `datePinned: true` with `placementMode: 'fixed'`. If the scheduler ignores `datePinned` entirely, the tests are testing nothing about anchoring.
- [ ] **WARN (Z-6):** Add `validateTaskInput({ placementMode: 'fixed', date: '2026-05-20' })` → expect no error, in `juggler-backend/tests/taskControllerUnit.test.js` cross-field tests.
- [ ] **WARN (Z-7):** Add a test in `juggler-backend/tests/schedulerRules.test.js` for a task with `placementMode: 'unknown_value'` — assert it is placed without crashing and is NOT anchored at a fixed time.

---

_Reviewer: Zoe_
_Mode: --re-review (bert's Z-1/Z-2/Z-3/Z-5 fixes)_
_Date: 2026-05-25_

---

---

## Prior Session — 2026-05-25 (bert's fixes to the prior session)

---

## Overall Verdict: BLOCK

---

## Telly's Claims vs Reality

| Telly Said | Zoe Found | Verdict |
|---|---|---|
| 299 tests PASS, no gaps | 3 untested edge cases; 1 call permanently unverifiable as written | BLOCK |
| `cache.invalidateTasks` not unit-tested — "infrastructure, no regression risk" | No mock in this file; call could be deleted and all 29 tests would still pass | BLOCK |
| `invalid mode in JSON prev_when falls back to anytime` covers error paths | Tests invalid *value* not missing *key*; also never asserts `when` field | BLOCK |
| `datePinned=true + time_window` sub-panel lock verified | pointerEvents checked; opacity value never asserted | WARN |
| `unpin-reg` covers legacy bare-string restore | `when` field restoration never asserted — only `placement_mode` checked | WARN |
| Re-drag scenario covered "transitively via unpin tests" | Zero tests exercise second drag on an already-pinned task | BLOCK |
| `isFixed` matrix covers `fixed` mode | Matrix builds props without a `task` containing calendar IDs — `isFixed` is always `false` for `placementMode='fixed'` rows in all 80 matrix cases | WARN |

---

## BLOCK Findings

### B-1: `cache.invalidateTasks` is permanently unverifiable — could be deleted without a test failing

**Location:** `taskCrudIntegration2.test.js` — all five `unpinTask` tests

**Evidence:**

The test file mocks `../src/scheduler/scheduleQueue` at line 11 but does NOT mock `../src/lib/redis`. The controller calls `await cache.invalidateTasks(req.user.id)` at task.controller.js line 2461. The real `redis.invalidateTasks` implementation at redis.js line 107 calls `del(...)`, which at line 90 calls `isConnected()` first. In the test environment there is no Redis client — `isConnected()` returns `false` and the call silently returns `false` without throwing or recording anything.

Result: removing the `cache.invalidateTasks(req.user.id)` line from the controller entirely leaves all 29 tests green. The changed behaviour is completely invisible to the test suite.

Telly's dismissal ("Redis mocked throughout; no regression risk") is factually incorrect. `redis.js` is **not mocked** in `taskCrudIntegration2.test.js`. The pattern used correctly in `taskStateTransitions.test.js` line 28 and `task-state-machine.test.js` line 74 is:

```js
jest.mock('../src/lib/redis', () => ({
  invalidateTasks: jest.fn().mockResolvedValue(true),
  // ...
}));
```

followed by `expect(redis.invalidateTasks).toHaveBeenCalledWith(USER_ID)`. This file has none of that.

**Required fix:** Add `jest.mock('../src/lib/redis', ...)` to `taskCrudIntegration2.test.js` and add `expect(cache.invalidateTasks).toHaveBeenCalledWith(USER_ID)` in at least the three JSON-restore unpin tests.

---

### B-2: JSON `prev_when` with missing `mode` key is untested; `invalid mode` test never asserts `when` field

**Location:** `taskCrudIntegration2.test.js` — `unpinTask` describe block, lines 395–410

**Evidence:**

The existing test `invalid mode in JSON prev_when falls back to anytime` uses `{ mode: 'bogus_mode', when: 'somevalue' }`. This exercises an invalid mode **value** but not a missing `mode` **key**.

When `mode` is absent from the JSON object, the controller path (task.controller.js lines 2423–2429) is:

```js
var candidateMode = parsed.mode;           // undefined
restoredWhen = parsed.when || '';          // set to 'somevalue' BEFORE the guard
if (candidateMode && validModes.indexOf(candidateMode) >= 0) {  // false
  restoredMode = candidateMode;
}
// restoredMode = ANYTIME (correct)
// restoredWhen = 'somevalue' (NOT cleared — inconsistent state)
```

A task could end up with `placement_mode = 'anytime'` and `when = 'morning,lunch'` — an inconsistent state where anytime mode carries block-tag values. No test covers this scenario at all.

Additionally, the existing `invalid mode` test asserts only `placement_mode = 'anytime'` and never checks `row.when`. The controller sets `restoredWhen = 'somevalue'` for the `bogus_mode` case and writes it to the DB unchecked. Whether `when` should be cleared or preserved when falling back to anytime is undefined by test contract.

**Required fix:** (a) Add test: `prev_when = JSON.stringify({ when: 'morning,lunch' })` (no `mode` key), assert both `placement_mode` and `when` post-unpin. (b) Add `expect(row.when).toBe('')` or `expect(row.when).toBe('somevalue')` (with documented rationale) to the existing `invalid mode` test.

---

### B-3: Re-drag scenario is completely untested

**Location:** `taskCrudIntegration2.test.js` — no test; `task.controller.js` line 1117–1127

**Evidence:**

The drag-pin code guard at task.controller.js line 1123:

```js
if (!existing.date_pinned) {
  row.prev_when = JSON.stringify({ mode: preDragMode, when: preDragWhen });
}
```

This guard is supposed to prevent a second drag from overwriting the original `prev_when`. No integration test exercises the re-drag path: task at `time_window` → drag-pin (prev_when written) → drag again to new slot (prev_when should NOT be overwritten) → unpin → should restore `time_window`, not the intermediate `fixed` state.

Telly acknowledged "drag-pin is exercised via E2E/Playwright, consistent with prior test strategy" but did not cite a specific Playwright test verifying re-drag preserves original `prev_when`. The guard `!existing.date_pinned` is a single-character removal away from a silent data corruption (every re-drag would overwrite the restore point with the pinned state, making unpin always restore `fixed`). Nothing in the integration suite would catch that regression.

**Required fix:** Add an integration test: (1) insert a task with `date_pinned=1` and valid JSON `prev_when = '{"mode":"time_window","when":"09:00"}'`, (2) call `updateTask` with `{ _dragPin: true, ... }` body, (3) call `unpinTask`, assert `placement_mode = 'time_window'` and `when = '09:00'` were restored from the original snapshot, not from the intermediate pinned state.

---

## WARN Findings

### W-1: `unpin-reg` test only checks `placement_mode` — `when` restoration unverified

**Location:** `taskCrudIntegration2.test.js` line 308–319

**Evidence:**

Task inserted with `prev_when: 'afternoon'` (legacy bare string). Controller restores `when = 'afternoon'` and `placement_mode = 'time_blocks'`. Test asserts `row.date_pinned === 0` and `row.placement_mode === 'time_blocks'` but never checks `row.when`. A regression clearing `when` to `''` on unpin would not be detected. A task with `placement_mode = 'time_blocks'` and `when = ''` is a scheduler data-integrity failure.

**Required fix:** Add `expect(row.when).toBe('afternoon')` to the `unpins a regular task` test.

---

### W-2: Time-window sub-panel lock test checks `pointerEvents` but not `opacity`

**Location:** `WhenSection.modes.test.jsx` lines 265–273

**Evidence:**

The test:
```js
var subPanel = timeLabel.closest('div[style*="opacity"]');
expect(subPanel).not.toBeNull();
expect(subPanel).toHaveStyle({ pointerEvents: 'none' });
```

The component (WhenSection.jsx line 343) applies `opacity: isFixed ? 0.35 : 1`. The test verifies the wrapper exists and blocks pointer interaction but never asserts the opacity value. Changing the lock from `0.35` to `0.95` (barely dimmed — functionally misleading to the user) would pass. The visual locked indicator is not under test contract.

**Required fix:** Add `expect(subPanel).toHaveStyle({ opacity: '0.35' })` to the sub-panel lock test.

---

### W-3: `isFixed` mode matrix never exercises `placementMode='fixed'` + calendar-linked branch

**Location:** `WhenSection.modes.test.jsx` lines 75–141

**Evidence:**

`buildProps` (line 44) spreads from `BASE` which has no `task` property. The matrix iterates over all 5 modes including `'fixed'` but constructs every test case without a `task` prop with calendar IDs.

In the `isFixed derivation is correct` test (lines 107–122):
```js
var isCalManaged = !!(props.task && (props.task.gcalEventId || ...));
// props.task is undefined → isCalManaged = false
var expectedIsFixed = !!datePinned || (placementMode === 'fixed' && isCalManaged);
// For placementMode='fixed', datePinned=false: expectedIsFixed = false always
```

All 4 matrix cases with `placementMode='fixed'` and `datePinned=false` assert `opacity = '1'` (unlocked), which is correct for no calendar link, but means the `isFixed=true` from `fixed+isCalManaged` is never exercised in the 80-case matrix. The dedicated `WhenSection fixed mode specifics` describe block does cover it, so this is not a false pass elsewhere — but the matrix's coverage of `fixed` mode is incomplete for the primary changed behavior.

**Required fix (minor):** Either add a calendar-linked variant to the matrix or document that the matrix intentionally omits it (deferring to the `fixed mode specifics` describe block).

---

### W-4: `invalid mode` test does not assert `when` field post-unpin

**Location:** `taskCrudIntegration2.test.js` lines 395–410

Covered above under B-2. The `when` assertion gap in the existing test is a WARN on its own even without the missing-key scenario — it allows `when` to be written with an arbitrary value when mode is invalid without any contract on what that value should be.

---

## What Telly Got Right

| Item | Assessment |
|------|-----------|
| `restores time_window / time_blocks / anytime from JSON prev_when` — three tests with DB read-back asserting `placement_mode`, `when`, AND `prev_when` cleared | Solid — three fields each, complete assertion set |
| `rejects unpin on ingested cal-synced task` — asserts 403 + code + DB state unchanged | Complete |
| `empty-string gcalEventId means task is not calendar-managed` — no lock banner | Correctly targets the tightened isFixed condition |
| `datePinned=true + time_window` sub-panel lock test structure | Correct DOM traversal approach; partial credit on assertions |
| Mode-selector `pointerEvents/tabIndex` tests for both `datePinned` and `fixed+cal` paths | Behavior verified, not just rendering |
| `no banner when placementMode=fixed but no calendar link` tests in both files | Directly verifies the `isFixed` tightening |

---

## Required Actions

- [ ] **BLOCK (B-1):** Add `jest.mock('../src/lib/redis', ...)` to `taskCrudIntegration2.test.js` and assert `cache.invalidateTasks` is called with the correct `userId` in the `unpinTask` tests.
- [ ] **BLOCK (B-2a):** Add test for `prev_when = JSON.stringify({ when: 'morning,lunch' })` (no `mode` key), asserting both `placement_mode` and `when` post-unpin.
- [ ] **BLOCK (B-2b):** Add `when` field assertion to the existing `invalid mode in JSON prev_when falls back to anytime` test.
- [ ] **BLOCK (B-3):** Add integration test for re-drag scenario: task already pinned with JSON `prev_when` → second drag-pin via `updateTask` → `unpinTask` → assert original mode/when restored.
- [ ] **WARN (W-1):** Add `expect(row.when).toBe('afternoon')` to `unpins a regular task` test.
- [ ] **WARN (W-2):** Add `expect(subPanel).toHaveStyle({ opacity: '0.35' })` to the time-window sub-panel lock test.
- [ ] **WARN (W-3):** Document or expand the `isFixed` matrix to cover `placementMode='fixed'` with a calendar-linked task prop.

---

_Reviewer: Zoe_
_Mode: Adversarial — no trust in Telly's run counts or Bird's UX verdicts without independent verification_

---

---

## Re-Audit — 2026-05-25 (bert's fixes)

_Scope: taskCrudIntegration2.test.js (B-1, B-2, B-3, W-1) + WhenSection.modes.test.jsx (W-2, W-3)_
_Method: Read both test files in full; read controller source at lines 2419–2464 and 1117–1127; read WhenSection.jsx at opacity/isFixed lines._

### Overall Re-Audit Verdict: WARN

Two of the three prior BLOCKs are resolved. B-3 is resolved to a sufficient level for the re-drag guard specifically, with a residual gap. B-1 is partially resolved — the mock is real and one path is locked, but the JSON-format unpin paths remain unasserted. Both WARNs are cleanly resolved.

---

### B-1 — Redis mock: PARTIALLY RESOLVED (WARN)

**What bert did:** Added `jest.mock('../src/lib/redis', ...)` at lines 16–25 with `invalidateTasks: jest.fn().mockResolvedValue(true)`. Added `expect(redis.invalidateTasks).toHaveBeenCalledWith(USER_ID)` at line 335 in the `unpins a regular task` test.

**Zoe's finding:** The assertion exists for exactly one of six unpinTask tests. The five JSON-format unpin tests (`unpin-tw`, `unpin-tb`, `unpin-at`, `unpin-inv`, `unpin-no-mode`) do NOT assert `redis.invalidateTasks` was called. `jest.clearAllMocks()` resets the spy before each test, so those five tests would remain green if line 2463 (`await cache.invalidateTasks(req.user.id)`) were deleted from the controller.

**Evidence:** `grep -n "invalidateTasks\|toHaveBeenCalled" taskCrudIntegration2.test.js` returns one assertion on line 335 only.

**Verdict:** WARN — the mock infrastructure is correct and the bare-string path is locked; the JSON-restore paths are still unguarded against cache-call deletion.

---

### B-2 — Missing mode key + `when` assertion on invalid mode: RESOLVED (PASS)

**What bert did:**
- Added `expect(row.when).toBe('')` at line 428 in the `invalid mode in JSON prev_when falls back to anytime` test.
- Added new test `JSON prev_when with missing mode key falls back to anytime with empty when` (lines 432–449), asserting both `placement_mode === 'anytime'` and `when === ''`.

**Controller verification:** Lines 2422–2431 of task.controller.js correctly keep `restoredWhen = ''` when `candidateMode` is falsy or not in `validModes` — `restoredWhen` is only set on line 2428 inside the valid-mode guard. The controller bug described in the original finding is fixed.

**Verdict:** PASS — both sub-parts addressed, controller and test are consistent.

---

### B-3 — Re-drag scenario: PARTIALLY RESOLVED (WARN)

**What bert did:** Added `updateTask: drag-pin` describe block (lines 456–493). The test inserts an unpinned task, performs first drag (asserts `prev_when` is written and `date_pinned=1`), performs second drag (asserts `prev_when` is unchanged from after first drag).

**Zoe's finding:** The test verifies the critical invariant — the snapshot is not overwritten on re-drag. This is the primary regression guard for the `!existing.date_pinned` guard at controller line 1123. However, the test does NOT call `unpinTask` at the end, so it never verifies that a user who re-drags and then unpins gets back to their original pre-drag mode rather than the intermediate pinned state. The full round-trip (drag → re-drag → unpin → assert original mode) remains untested.

Removing the `!` from `!existing.date_pinned` (making it always overwrite) would cause `afterSecondDrag.prev_when` to differ from `firstPrevWhen` (first drag prev_when would be the initial anytime state; second drag would overwrite with the `fixed` pinned state). So the test WOULD catch that regression — `firstPrevWhen = '{"mode":"anytime","when":""}` and `afterSecondDrag.prev_when` would become `'{"mode":"fixed","when":""}` or similar, failing the `toBe(firstPrevWhen)` check.

**Verdict:** WARN — the guard regression is locked; the end-to-end unpin restoration after re-drag is not covered.

---

### W-1 — `row.when` assertion on `unpins a regular task`: RESOLVED (PASS)

`expect(row.when).toBe('afternoon')` is present at line 333. PASS.

---

### W-2 — Opacity assertion on time-window sub-panel lock: RESOLVED (PASS)

`expect(subPanel).toHaveStyle({ opacity: '0.35' })` is present at line 274. Component applies `opacity: isFixed ? 0.35 : 1` to the sub-panel div at WhenSection.jsx line 343. The assertion matches the rendered value. PASS.

---

### W-3 — `isFixed` matrix with calendar-linked task: RESOLVED (PASS)

New `WhenSection mode matrix — with calendar task` describe block (lines 330–353) runs all 5 modes with `task: { gcalEventId: 'gcal_x' }`. The `isFixed derivation is correct` sub-test (lines 338–351) asserts `opacity === '0.4'` for `placementMode === 'fixed'` (where `isFixed = true`) and `opacity === '1'` for all other modes. This directly exercises the `fixed + isCalManaged` branch that the original matrix missed. PASS.

---

### Residual Required Actions (post-re-audit)

- [ ] **WARN (B-1 residual):** Add `expect(redis.invalidateTasks).toHaveBeenCalledWith(USER_ID)` to at least two JSON-restore unpin tests (`unpin-tw` and `unpin-tb`) to lock the cache-invalidation call for the JSON-format path.
- [ ] **WARN (B-3 residual):** Add a second test inside `updateTask: drag-pin` that calls `unpinTask` after re-drag and asserts `placement_mode` and `when` are restored from the first drag's snapshot, not the pinned intermediate state.

---

---

## Prior Review — 2026-05-24 (Preserved Below)

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

### WARN-19: Time window +/- Window select behavior untested

The `+/- Window` select (L346-357) toggles `rigid` and `timeFlex` simultaneously. Selecting `exact` sets `rigid=true` and `timeFlex=0`. No test verifies this side effect.

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
