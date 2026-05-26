# Zoe's Adversarial Test Review — 2026-05-26 (placement_mode no-fallback assertions)

_Scope: juggler-backend — taskPipeline.test.js (1 assertion updated) + derivePlacementMode.test.js (2 tests updated)_
_Context: Tests updated from expecting ANYTIME fallback to expecting null/undefined/empty passthrough. placement_mode is NOT NULL in DB; null = data integrity problem._
_Telly run: 1505/1533 pass, 27 skipped, 1 todo. Exit code 0._
_No Bird output for this scope._

## Overall Verdict: WARN

Two WARN findings. No BLOCKs. The changed test assertions are correct and meaningful. One gap: the REMINDER-before-FIXED ordering regression tests cover GCal in `04-adapter-gcal-edge.test.js` and are present in `01-adapter-gcal.test.js` (confirmed), but `05-adapter-msft-edge.test.js` and `06-adapter-apple-edge.test.js` have no REMINDER→FIXED combined-scenario tests — that gap predates this change set and was carried as a BLOCK in a prior Zoe session (C3). Two new narrow gaps introduced by this change set are documented below as WARNs.

---

## Assertion Correctness Audit

### Changed assertion 1 — taskPipeline.test.js line 611-614

**Test:** "placementMode passes through null from DB row as-is (NOT NULL column; null = data integrity problem)"

**Input:** `makeRow({ placement_mode: null })` — row object with `placement_mode` property set to `null`.

**Assertion:** `expect(task.placementMode).toBeNull()`

**Source path:** `rowToTask` at `task.controller.js` line 452: `placementMode: row.placement_mode` — direct assignment, no conditional. When `row.placement_mode` is `null`, `task.placementMode` is `null`.

**Is the assertion correct?** Yes. `null` passes through as `null`. The assertion is true to the source.

**Does it guard against regression?** Yes, for the specific regression targeted: re-introducing `|| 'anytime'` or `?? 'anytime'` fallback after `row.placement_mode`. If that fallback were added, `task.placementMode` would be `'anytime'` and `toBeNull()` would fail.

**Does it guard against the inverse regression (fallback removed but null leaked upstream)?** No, and that is by design — the no-fallback contract means null propagation is the correct behavior; upstream must ensure placement_mode is never null in DB.

**Verdict: PASS** — assertion is correct, meaningful, and would catch re-introduction of the ANYTIME fallback.

---

### Changed assertion 2 — derivePlacementMode.test.js lines 125-127

**Test:** "passes through null placement_mode from DB row as-is"

**Input:** `rowToTask({ text: 'Test' }, null)` — row object with NO `placement_mode` property (the key is absent entirely).

**Assertion:** `expect(task.placementMode).toBeUndefined()`

**Source path:** `rowToTask` at line 452: `placementMode: row.placement_mode`. When `row.placement_mode` is `undefined` (property absent), the spread result is `placementMode: undefined`. `toBeUndefined()` matches.

**Is the assertion correct?** Yes for a row with no `placement_mode` key. However: the test is titled "passes through null placement_mode from DB row as-is" but the input does NOT have `placement_mode: null`. It has no key at all. The test name is misleading — a real DB row with `placement_mode: null` would produce `task.placementMode === null`, not `undefined`. The taskPipeline test at line 611 correctly covers the `null` case. This test is actually covering the absent-key case.

**Does it guard against regression?** Yes, in a narrow way: if `rowToTask` were changed to supply a default `placementMode: 'anytime'` when the key is absent, `toBeUndefined()` would fail. So the regression guard is real.

**Verdict: WARN-1** — the test is guarding a real path but its name ("null placement_mode") is incorrect; the input has no key rather than a null value. This could mislead future developers into thinking null is already covered here (it is, but in taskPipeline.test.js, not this file). The assertion itself is sound.

---

### Changed assertion 3 — derivePlacementMode.test.js lines 128-130

**Test:** "passes through empty string placement_mode from DB row as-is"

**Input:** `rowToTask({ placement_mode: '' }, null)`

**Assertion:** `expect(task.placementMode).toBe('')`

**Source path:** line 452 — `placementMode: row.placement_mode`. Empty string passes through as empty string. Correct.

**Is the assertion correct?** Yes.

**Does it guard against regression?** Yes — any falsy-coercion fallback (e.g., `row.placement_mode || 'anytime'`) would coerce `''` to `'anytime'` and fail this assertion. This is stronger than the null test because `||` does not coerce `null` to the right side (it does — `null || 'anytime'` = `'anytime'`), and it also coerces empty string. So this test covers the `||` operator case that `toBeNull()` in taskPipeline also covers, but from a different input angle. Both are legitimate regression guards.

**Verdict: PASS** — correct and meaningful.

---

## Cal-Adapter Reordering Coverage Audit

The brief asks: are there missing cases for the ANYTIME reset before FIXED promotion?

**Prior C3 BLOCK status (from Zoe precommit session 2026-05-25):** BLOCK was raised because the REMINDER→FIXED combined scenario (formerly-transparent + date/time change in same sync → must produce FIXED not ANYTIME) had no test in any adapter. The BLOCK required tests in all three adapters.

**Current state — verified by Zoe:**

- `01-adapter-gcal.test.js` lines 301-322: describe block "GCal adapter — applyEventToTaskFields REMINDER→FIXED ordering" — test present, `currentTask.placement_mode = 'reminder'`, `isTransparent: false`, date/time changed, asserts `fields.placement_mode === 'fixed'` AND `!== 'anytime'`. **PASS**

- `02-adapter-msft.test.js` lines 592-618: describe block "MSFT adapter — applyEventToTaskFields REMINDER→FIXED ordering" — test present, same pattern. **PASS**

- `03-adapter-apple.test.js` lines 244-265: describe block "Apple adapter — applyEventToTaskFields REMINDER→FIXED ordering" — test present, same pattern. **PASS**

- `05-adapter-msft-edge.test.js`: No REMINDER→FIXED test (only edge cases unrelated to ordering). This file does not cover the ordering scenario. However, `02-adapter-msft.test.js` already covers it — the edge file is supplementary. **Gap is moot for this scenario.**

- `06-adapter-apple-edge.test.js`: Same — no ordering test, covered by `03-adapter-apple.test.js`.

**C3 BLOCK is resolved.** All three adapters have the combined REMINDER→FIXED ordering test.

---

## WARN Findings

### WARN-1: Test name mismatch in derivePlacementMode.test.js line 125

**Finding:** The test at line 125 is titled "passes through null placement_mode from DB row as-is" but its input is `rowToTask({ text: 'Test' }, null)` — a row with no `placement_mode` key at all, not a row with `placement_mode: null`. The assertion `toBeUndefined()` is correct for an absent key but would not catch a fallback applied specifically when `placement_mode` is `null` (as distinct from absent). The actual null-value case is correctly handled in `taskPipeline.test.js` line 611-614 with `toBeNull()`.

**Risk:** Low — no behavioral gap, but a developer reading the derivePlacementMode test might believe the null DB row case is tested here and not look for it in taskPipeline.test.js. If the derivePlacementMode test were the only test for this file, the null case would be uncovered.

**Required fix:** Rename the test to "does not supply a default when placement_mode key is absent" or change the input to `rowToTask({ text: 'Test', placement_mode: null }, null)` and update the assertion to `toBeNull()` — which would make it equivalent to the taskPipeline test but scoped within this file's describe block.

**Verdict: WARN**

---

### WARN-2: No test for placement_mode passthrough through the template-inheritance path

**Finding:** The `rowToTask` template-inheritance path (Phase 09 TEMPLATE_FIELDS) reads fields from the source template row and applies them to the instance. `placement_mode` is in `TEMPLATE_FIELDS` (confirmed: line 181 of task.controller.js includes `'placement_mode'` in the TEMPLATE_FIELDS array).

**Verified:**

```
grep -n "TEMPLATE_FIELDS\|'placement_mode'" task.controller.js | grep -E "^181:|TEMPLATE_FIELDS"
181:  'preferred_time_mins', 'placement_mode',
```

This means when a recurring instance is processed by `rowToTask`, the `placement_mode` comes from the source template, not the instance row. None of the changed tests cover this path: a template with `placement_mode: 'time_window'` → instance inherits `placementMode: 'time_window'`. If the TEMPLATE_FIELDS inheritance were changed to exclude `placement_mode`, neither the changed tests nor the existing template-inheritance tests in taskPipeline.test.js (section 2, lines 173-246) would catch it — those tests do not assert `placementMode` on the resulting task.

**Evidence:** Zoe grepped all assertions in section 2 of taskPipeline.test.js. None assert `task.placementMode`. The inheritance tests assert `text`, `dur`, `pri`, `project`, `when`, `dayReq`, `timeFlex`, `split`, `flexWhen` — but not `placementMode`.

**Required fix:** Add one test to taskPipeline.test.js section 2: template with `placement_mode: 'time_window'` → `rowToTask(instance, TZ, srcMap)` → assert `task.placementMode === 'time_window'`. This locks the TEMPLATE_FIELDS inheritance for placement_mode specifically.

**Verdict: WARN**

---

## What the Changed Tests Got Right

| Item | Assessment |
|------|-----------|
| taskPipeline.test.js line 611: `placement_mode: null` → `toBeNull()` | Correct input, correct assertion, real regression guard against `|| 'anytime'` re-introduction |
| derivePlacementMode.test.js lines 128-130: `placement_mode: ''` → `toBe('')` | Catches `||` operator coercion, stronger than null alone |
| derivePlacementMode.test.js lines 135-137: `placement_mode: 'fixed'` → `toBe('fixed')` | Positive case confirming non-null values still pass through correctly |
| Test descriptions clearly document the no-fallback contract in comments | Architectural intent is explicit in the test file header and individual test descriptions |
| C3 BLOCK (REMINDER→FIXED ordering) is covered in all three adapter test files | Prior BLOCK is fully resolved |

---

## Required Actions

- [ ] **WARN-1:** Rename derivePlacementMode.test.js line 125 test from "passes through null placement_mode from DB row as-is" to "does not supply a default when placement_mode key is absent from DB row" — the input has no `placement_mode` key, not a null value. Alternatively, change the input to `{ text: 'Test', placement_mode: null }` and the assertion to `toBeNull()` to actually test the null case within this file.
- [ ] **WARN-2:** Add one test to taskPipeline.test.js section 2 (template field inheritance): template with `placement_mode: 'time_window'` → recurring instance → `rowToTask(instance, TZ, srcMap)` → assert `task.placementMode === 'time_window'`. This locks `placement_mode` in the TEMPLATE_FIELDS inheritance path.

---

_Reviewer: Zoe_
_Mode: Focused adversarial audit — placement_mode no-fallback assertion correctness_
_Date: 2026-05-26_

---

# Zoe's Adversarial Test Review — 2026-05-26 (TaskDetailHeader project select) [Iteration 2 — re-review]

_Scope: BLOCK-2 resolution verification (project={null} fix + new null test)_
_Prior verdict: BLOCK (iteration 1)_
_Re-review date: 2026-05-26_

## Overall Verdict: BLOCK

### Summary of iteration 2 findings

BLOCK-2 from iteration 1 was partially addressed: `project ?? ''` is now in the source and the `project={null}` test exists. However the new test is a false pass — it would not catch the regression if `?? ''` were removed. A genuine regression guard requires `jest.spyOn(console, 'error')` and asserting no null-value warning fires. Without that, the test provides no protection.

The four WARNs from iteration 1 (WARN-1 through WARN-5) are unaddressed and remain open.

---

## Re-Verification: BLOCK-2 — `project ?? ''` fix and null test

### Claim 1: `value={project ?? ''}` now used (null/undefined → '', empty string passes through)

**Zoe verified:** Source at `/Users/david/Offline Coding/Raike & Sons /DEV/juggler/juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 142:

```jsx
<select value={project ?? ''} onChange={e => onProjectChange && onProjectChange(e.target.value)}
```

Confirmed. `?? ''` is present. CLAUDE.md Approved Fallbacks table documents this as approved (Oscar review 2026-05-26).

**Source fix: PASS**

---

### Claim 2: New test added — "renders project select with no-project selected when project is null"

**Zoe verified:** Test exists at line 86-95 of `TaskDetailHeader.test.jsx`. Renders with `project={null}`, asserts `getByDisplayValue('No project')` is in document.

**Test count: 7/7 confirmed.** Zoe ran the suite independently:

```
PASS src/components/tasks/__tests__/TaskDetailHeader.test.jsx
  ✓ renders task title (77 ms)
  ✓ shows Save button only when dirty (30 ms)
  ✓ calls onClose when × clicked (26 ms)
  ✓ shows notes preview when notes is non-empty (26 ms)
  ✓ renders project select with current value and all options (99 ms)
  ✓ calls onProjectChange when project select changes (14 ms)
  ✓ renders project select with no-project selected when project is null (12 ms)

Tests: 7 passed, 7 total
```

**Test passes: confirmed.**

---

### Claim 3: New null test "would catch a regression if `?? ''` were removed"

**This is the adversarial question. Zoe probed it directly.**

The assertion is `getByDisplayValue('No project')`. This query asks: "is there a form element whose current displayed value is 'No project'?"

When `value={null}` is passed to a controlled `<select>`:
- jsdom coerces `null` to the empty string at the DOM `.value` property level.
- The `<option value="">No project</option>` has an empty string value.
- The select's displayed value settles to "No project".
- `getByDisplayValue('No project')` matches the select.
- The test PASSES even when `value={null}` is used — i.e., even if `?? ''` is absent.

**Zoe's probe** (temporary test, executed and deleted):

```jsx
// value={null} directly (simulating removal of ?? ''):
render(<select value={null} onChange={() => {}}><option value="">No project</option></select>);
expect(screen.getByDisplayValue('No project')).toBeInTheDocument(); // PASSES
```

Result: PASS. jsdom's coercion makes the DOM-level behavior identical whether the prop is `null` or `''`. The `getByDisplayValue` assertion cannot distinguish between them.

**The test is a false pass for the regression it claims to guard.**

The regression signal that `?? ''` is actually suppressing is the React console.error: `Warning: 'value' prop on 'select' should not be null`. Zoe verified this warning fires for `value={null}` and is suppressible by `?? ''`:

```
// Probe: jest.spyOn(console, 'error') with value={null} → warning fires
// Probe: jest.spyOn(console, 'error') with value={null ?? ''} → no warning
// Both probe tests PASSED (executed and deleted by Zoe)
```

A test that captures `console.error` and asserts zero null-value warnings IS a real regression guard. The current `getByDisplayValue` assertion is not.

**Verdict: BLOCK-2 partially resolved — source fix is correct, null test is a false pass.**

---

## BLOCK Finding — Iteration 2

### BLOCK-2 (re-opened): Null test does not protect the `?? ''` guard

**Evidence:**
- `getByDisplayValue('No project')` passes with both `value={null}` and `value=''` in jsdom
- Removing `?? ''` from line 142 leaves all 7 tests green
- The React console.error is the only observable difference between the two states, and it is not captured by any test assertion

**Required fix:** Replace the existing null-test assertion or augment it:

```jsx
it('renders project select with no-project selected when project is null — no React warning', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<TaskDetailHeader ... project={null} allProjectNames={['Work', 'Personal']} onProjectChange={() => {}} />);
  const nullValueWarnings = errorSpy.mock.calls.filter(
    call => call.some(arg => typeof arg === 'string' && /value.*prop.*null|null.*value.*prop/i.test(arg))
  );
  expect(screen.getByDisplayValue('No project')).toBeInTheDocument(); // still valid
  expect(nullValueWarnings).toHaveLength(0); // this is the guard — fails if ?? '' removed
  errorSpy.mockRestore();
});
```

Without this, the `?? ''` guard can be removed and CI will not notice.

---

## Open WARNs from Iteration 1 (unchanged — not addressed)

| Finding | Status |
|---------|--------|
| WARN-1: Test 5 asserts only 2 of 4 options — "all options" is a false claim | OPEN |
| WARN-2: `allProjectNames` omitted — no test | OPEN |
| WARN-3: `onProjectChange` absent — no test | OPEN |
| WARN-4: `allProjectNames=[]` — no test | OPEN |
| WARN-5: `isCreate={true}` with project select — no test | OPEN |

These were carried from iteration 1 and were not touched in this fix round.

---

## Required Actions

- [ ] **BLOCK (BLOCK-2):** Strengthen the null test to spy on `console.error` and assert zero null-value warnings. The current `getByDisplayValue` assertion alone is insufficient — it is satisfied by jsdom's null-to-empty-string coercion regardless of whether `?? ''` is present.
- [ ] **WARN (WARN-1):** Add assertion for 'Health' option and assert option count = 4 in Test 5.
- [ ] **WARN (WARN-2):** Add test: `allProjectNames` omitted → only "No project" option renders.
- [ ] **WARN (WARN-3):** Add test: `onProjectChange` not provided → `fireEvent.change` does not throw.
- [ ] **WARN (WARN-4):** Add test: `allProjectNames={[]}` → only "No project" option renders.
- [ ] **WARN (WARN-5):** Add test: `isCreate={true}` → project select renders with correct initial value.

---

_Reviewer: Zoe_
_Mode: --re-review (iteration 2 — BLOCK-2 null-test verification)_
_Date: 2026-05-26_

---

# Zoe's Adversarial Test Review — 2026-05-26 (TaskDetailHeader project select) [Iteration 1]

_Auditing Telly's work from: TEST-REVIEW.md dated 2026-05-26, mode --focus TaskDetailHeader_
_No Bird output present for this scope._

## Overall Verdict: BLOCK

---

## Telly's Claims vs Reality

| Telly Said | Zoe Found | Verdict |
|-----------|-------------|---------|
| Line 142: `<select value={project \|\| ''} ...>` — null is coerced to '' by guard | Actual source at line 142: `value={project}` — no `\|\|` guard. `null` passes directly to the select value prop. | BLOCK |
| "renders project select with current value and all options" is correct | Test passes but does NOT verify option count or that all three named options are present (only checks 2 of 3; 'Health' is never asserted) | WARN |
| All 6 tests pass, no gaps | 6 tests confirmed passing by Zoe's re-run (3.05 s). Pass count is accurate. | PASS |
| "notes preview" getByText risk flagged | Zoe probed: getByText DOES match controlled textarea content in this jsdom/CRA environment because React sets textContent. Empty value correctly fails. NOT a false pass. | PASS (Telly's flag was overcautious but the underlying test is sound) |
| `project={null}` risk — "API commonly returns null; guard is the only safety net" | Guard does not exist in the real source. `project={null}` passes `null` directly to the select, triggering a React `value should not be null` console.error warning. | BLOCK |

---

## BLOCK Findings

### BLOCK-1: Telly fabricated source code — the `|| ''` guard does not exist

**Evidence.**

Telly's TEST-REVIEW.md (line 47) quotes the source as:

```jsx
<select value={project || ''} ...>
```

The actual source at `/Users/david/Offline Coding/Raike & Sons /DEV/juggler/juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` line 142 is:

```jsx
<select value={project} onChange={e => onProjectChange && onProjectChange(e.target.value)}
```

There is no `|| ''` coercion. Telly's entire analysis of the `project={null}` risk was constructed around a guard that was either fabricated or copied from a different version of the file. The real code passes `project` directly to the select's `value` prop.

**Impact.** When `project` is `null` (a common API response value):

1. React fires a `value should not be null` console.error warning — confirmed by Zoe's probe against the real component.
2. jsdom coerces the DOM property silently, so the UI does not visibly break, but the React warning is a production-observable error.
3. No existing test exercises this path, so this warning is invisible to CI.

**Note on CLAUDE.md.** The `Approved Fallbacks` table in `CLAUDE.md` was updated (system notification indicates this during the session) to document the `allProjectNames || []` fallback as approved. The `project || ''` guard is NOT in that table — because it does not exist in the source. The two are separate: `allProjectNames` has an approved fallback; `project` does not, and the select currently receives a raw `null` when the prop is null.

**Verdict: BLOCK** — Telly's source citation is wrong. The null-guard gap is real and untested.

---

### BLOCK-2: No test covers `project={null}` — the most common API value after null guard is absent

**Evidence.** Zoe ran the component with `project={null}` against the real source. React fired `Warning: 'value' prop on 'select' should not be null.` — one warning, confirmed. The DOM select settled on `value=""` via jsdom coercion, which is why the component does not visually break. But no test catches the warning and no test asserts the "No project" option is selected.

**Required test:**

```jsx
it('renders "No project" selected when project is null', () => {
  render(<TaskDetailHeader ... project={null} allProjectNames={['Work']} onProjectChange={() => {}} />);
  // This would currently also catch the React console.error if warnings are treated as errors
  expect(screen.getByDisplayValue('No project')).toBeInTheDocument();
});
```

**Verdict: BLOCK** — not a gap Telly acknowledged as worth adding (Telly called it HIGH priority in the uncovered-edge-cases section but declined to add the test and signed off with "PASS with gaps"). Given the source guard does not exist, this is not a gap in testing an existing guard — it is a gap that masks a real production warning.

---

## WARN Findings

### WARN-1: Test 5 assertion depth — 2 of 3 options verified, no option count check

**Evidence.** Test 5 ("renders project select with current value and all options") asserts `getByRole('option', { name: 'No project' })` and `getByRole('option', { name: 'Personal' })` but never checks 'Health' or the total option count. Zoe's probe confirmed 4 options render (No project, Work, Personal, Health). The test name claims "all options" but verifies only 2 of 4.

A regression that dropped the last option from the rendered list would not be caught.

**Required fix:** Either assert all named options or assert `select.options.length === 4` (allProjectNames.length + 1 for "No project").

**Verdict: WARN**

---

### WARN-2: `allProjectNames` omitted — behavior confirmed safe but untested

**Evidence.** Zoe probed: `allProjectNames` omitted → select renders with 1 option ("No project") and no crash. The `|| []` guard on line 145 is real and works correctly. This is documented as an approved fallback in `CLAUDE.md`.

No test exercises this path. The guard could be removed and CI would not notice.

**Verdict: WARN**

---

### WARN-3: `onProjectChange` absent — guard path confirmed safe but untested

**Evidence.** Zoe probed: firing `change` on the project select without `onProjectChange` prop does not crash. The `&&` short-circuit on line 142 works. No test covers this path.

**Verdict: WARN**

---

### WARN-4: `allProjectNames=[]` — behavior confirmed but untested

**Evidence.** Zoe probed: empty array renders only "No project". Distinct caller pattern from omitted prop (the `|| []` does not fire; an empty array passes through). No test covers this.

**Verdict: WARN**

---

### WARN-5: `isCreate={true}` with project select — renders but untested

**Evidence.** Zoe probed: with `isCreate={true}`, the project select renders and holds its value correctly. No existing test verifies the select is present and functional in create mode.

**Verdict: WARN**

---

## What Telly Got Right

| Item | Assessment |
|------|-----------|
| Test 6 (onProjectChange callback) correctly asserts `toHaveBeenCalledWith('Personal')` — value string, not event | Solid assertion; verified by Zoe's probe that the callback receives a string |
| Test 6 uses `getByDisplayValue('Work')` which unambiguously targets only the project select (Zoe confirmed 1 match) | Correct — no selector ambiguity |
| Test 5 uses `getByDisplayValue('Work')` to establish context, then role-based option queries | Appropriate approach for option verification |
| Test run count (6) and pass results are accurate | Confirmed by Zoe's independent re-run: 6 PASS, 3.05 s |
| The notes-preview test is not a false pass — getByText works on textarea in this jsdom environment | Telly's flag was overcautious; Zoe's probe confirms the test is sound |
| Edge-case identification (null project, omitted allProjectNames, etc.) is correct | Correctly identified; incorrectly attributed to a non-existent guard |

---

## Required Actions

- [ ] **BLOCK (BLOCK-1/BLOCK-2):** Fix the source: add `|| ''` to line 142 of `TaskDetailHeader.jsx` so the select reads `value={project || ''}`, eliminating the `null` prop warning. Then add a test: `project={null}` renders with `getByDisplayValue('No project')` selected. (Alternatively: if `project` is intentionally nullable at the call site, add the fallback and test together; if `project` is guaranteed non-null by callers, add a PropTypes or runtime assertion instead.)
- [ ] **WARN (WARN-1):** Strengthen Test 5 to assert all 3 named options from `allProjectNames` and assert option count = `allProjectNames.length + 1`.
- [ ] **WARN (WARN-2):** Add test: `allProjectNames` omitted → only "No project" option renders.
- [ ] **WARN (WARN-3):** Add test: `onProjectChange` not provided → `fireEvent.change` does not throw.
- [ ] **WARN (WARN-4):** Add test: `allProjectNames={[]}` → only "No project" option renders.
- [ ] **WARN (WARN-5):** Add test: `isCreate={true}` → project select renders with correct initial value.

---

## Files

| File | Path |
|------|------|
| Source | `/Users/david/Offline Coding/Raike & Sons /DEV/juggler/juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` |
| Test file | `/Users/david/Offline Coding/Raike & Sons /DEV/juggler/juggler-frontend/src/components/tasks/__tests__/TaskDetailHeader.test.jsx` |
| Telly's review | `/Users/david/Offline Coding/Raike & Sons /DEV/juggler/TEST-REVIEW.md` |

---

_Reviewer: Zoe_
_Mode: Adversarial — TaskDetailHeader project select field_
_Date: 2026-05-26_

---

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

## Bert Fix Re-Verify — Precommit (2026-05-25)

_Scope: RC-C1 (transport.js planCheck), RC-C2 (app.js OAuth redirect allowlist), C1 (rowToTask fallback removed), C2 (taskToRow invalid placementMode → 400), C3 (adapter REMINDER-before-FIXED ordering), W3 (rigid removed from MCP Zod schema), W5 (safeParseJSON fallback removed)_

_Files read: juggler-backend/src/mcp/transport.js, juggler-backend/src/app.js (lines 135-183), juggler-backend/src/lib/cal-adapters/msft.adapter.js (lines 250-276), juggler-backend/src/lib/cal-adapters/gcal.adapter.js (grep), juggler-backend/src/lib/cal-adapters/apple.adapter.js (grep), juggler-backend/src/controllers/task.controller.js (lines 126-131, grep for validateTaskInput), juggler-backend/src/mcp/tools/tasks.js (Zod schema lines 21-60), juggler-backend/tests/mcp.test.js (full describe listing), juggler-backend/tests/taskControllerUnit.test.js (validateTaskInput tests, grep), juggler-backend/tests/mcp-task-config.test.js (lines 248-256), juggler-backend/tests/cal-sync/01-adapter-gcal.test.js (grep), juggler-backend/tests/cal-sync/02-adapter-msft.test.js (lines 286-303, grep), juggler-backend/tests/cal-sync/03-adapter-apple.test.js (grep), global grep for hasActivePlan/planCheck/redirect_uri allowlist/safeParseJSON/rigid across all tests/_

### Overall Verdict: BLOCK

Two BLOCKs found: RC-C1 and C3. Three PASSes: C1, W3, W5. One split verdict: C2.

---

### RC-C1 — planCheck restored in transport.js

**Source verified:**
- `planCheck` at transport.js line 23-27 reads `authResult.plans || {}`, then `plans[APP_ID]`. Returns `{ hasActivePlan: false }` when APP_ID is absent. Correct.
- Production guard at lines 59 and 71: `process.env.NODE_ENV !== 'production'` present on both dev-token bypass branches. Correct.

**Test coverage:** Global grep across all 100 test files for `hasActivePlan`, `plans[APP_ID]`, `planCheck`, `MCP_DEV_NO_AUTH`, `NODE_ENV.*production` returned zero hits in any test file. `mcp.test.js` contains 218 lines covering `validateTaskInput`, `taskToRow/rowToTask`, task CRUD, and calendar guards — no transport authentication tests whatsoever.

There is no test that:
- Calls the transport handler with a JWT whose `plans` claim lacks the APP_ID key and asserts `{ hasActivePlan: false }` is returned or that the MCP request is rejected/limited accordingly.
- Sets `NODE_ENV=production` and `MCP_DEV_NO_AUTH=true` and verifies the dev bypass is blocked.
- Sets `NODE_ENV=production` and sends `dev-token` and verifies 401.

Deleting the `process.env.NODE_ENV !== 'production'` guard from either branch leaves all tests green. The production security gate is completely unprotected by tests.

**Verdict: BLOCK**

---

### RC-C2 — OAuth redirect_uri allowlist

**Source verified:**
- `/oauth/authorize` at app.js line 138-156 is gated by `process.env.NODE_ENV === 'development'` (not `MCP_DEV_NO_AUTH`). Correct — the endpoint does not exist in production.
- Allowlist check at line 146-152: parses URL, rejects if `parsedUri.hostname` is not in `['localhost', '127.0.0.1']`. Correct.
- The `NODE_ENV === 'development'` guard (not `MCP_DEV_NO_AUTH`) is the mechanism — the endpoint is absent in production entirely.

**Test coverage for allowlist rejection:** `tests/unit/app.test.js` has only two CORS-related assertions (origin header checks) and nothing touching `/oauth/authorize`. Global grep for `redirect_uri.*evil`, `not.*permitted`, `allowedHosts`, `oauth.*authorize` across all test files returned zero hits. There is no test that:
- POSTs/GETs `/oauth/authorize` with a non-localhost `redirect_uri` (e.g., `https://evil.com/callback`) and asserts 400 with `redirect_uri host not permitted`.
- Verifies the endpoint returns 404 when `NODE_ENV !== 'development'`.

**Split verdict:**
- The allowlist logic itself (no test covering rejection): **BLOCK**
- The production-gate claim ("OAuth endpoints only active in development, not via MCP_DEV_NO_AUTH"): correct at the source level — the `NODE_ENV === 'development'` guard is distinct from `MCP_DEV_NO_AUTH`. The source is right. But there is no test verifying that `MCP_DEV_NO_AUTH=true` with `NODE_ENV=test` does NOT activate `/oauth/authorize`. **WARN**

**Verdict: BLOCK** (allowlist rejection untested; test deletion would leave it silently broken)

---

### C1 — rowToTask fallback removed

**Source verified:** `task.controller.js` line 452 (confirmed by grep): `placementMode: row.placement_mode` with no fallback. The `|| 'anytime'` fallback is absent.

**Test coverage:** `taskControllerUnit.test.js` rowToTask describe blocks (lines 84-202) test preferred_time_mins inheritance, template field inheritance, terminal status clamping, and return object completeness. Line 202 asserts `expect(task).toHaveProperty('placementMode')`. `taskMapping.test.js` line 59 asserts `expect(task.placementMode).toBe('anytime')` on a row with `placement_mode: 'anytime'`.

No test passes `placement_mode: null` to `rowToTask` and asserts the result — which would be the precise regression catch for a re-introduced fallback. However, the fix is the removal of the fallback, not the introduction of new behavior. Any test asserting a non-null `placementMode` value on a row that sets `placement_mode` to that value remains valid. No test is asserting the old fallback behavior (ANYTIME when null), which is correct — that behavior should not be tested because it should not exist.

The gap: no test proves that `rowToTask({ placement_mode: null })` produces `task.placementMode === null` (rather than `'anytime'`). If the fallback is re-introduced, existing tests would not catch it because they always pass non-null `placement_mode` values in fixtures.

This is a narrow gap — re-introducing the fallback would require actively editing the source, and the taskMapping test's `expect(task.placementMode).toBe('anytime')` on a row with `placement_mode: 'anytime'` does not distinguish fallback from direct passthrough. But the task description asks whether a test with `placement_mode: null` asserting behavior exists. It does not.

**Verdict: WARN** — no test covers the null input path directly; re-introducing the fallback would not be caught by the current suite.

---

### C2 — taskToRow silent mapping fixed (unknown placementMode → validation error)

**Source verified:** `task.controller.js` lines 829-835: `validateTaskInput` checks `Object.values(PLACEMENT_MODES).indexOf(body.placementMode) < 0` and pushes an error. `taskToRow` at line 478-479 (confirmed by test): assigns `row.placement_mode = body.placementMode` directly — no coercion to ANYTIME.

**Test coverage:**

Unit level (`validateTaskInput`): The test at `taskControllerUnit.test.js` line 475-480 is titled "invalid placementMode is passed through by taskToRow" and calls `taskToRow({ placementMode: 'bogus_mode' })` — it asserts `row.placement_mode === 'bogus_mode'`. This tests `taskToRow` directly, bypassing `validateTaskInput`. There is no unit test that calls `validateTaskInput({ placementMode: 'bogus_mode' })` and asserts the error array contains a validation error. The comment on line 476 says "validateTaskInput catches it before taskToRow is reached" — but no test actually invokes `validateTaskInput` with an unknown mode and asserts an error is returned.

MCP level (`mcp-task-config.test.js`): The test at line 248-256 sends `{ text: 'Invalid placement mode', placementMode: 'invalid_value' }` through the MCP handler and asserts `result.isError === true` and the text matches `/placementMode.*is not valid/i`. This IS a real assertion proving the validation pipeline rejects unknown modes before insert (`capturedInsertRow` is also asserted null).

HTTP endpoint level: Global grep across `tests/api/` for `placementMode.*invalid`, `invalid.*placementMode`, `400.*placement` returned zero hits. No test POSTs `{ placementMode: 'bogus_mode' }` to the HTTP task API (`POST /api/tasks` or `PATCH /api/tasks/:id`) and asserts a 400 response.

**Verdict: WARN** — MCP path is covered by a real test (mcp-task-config.test.js line 248-256). HTTP path has no test. The `validateTaskInput` unit test calling the function directly with an invalid mode is absent (the existing test bypasses it). The MCP test is sufficient to detect a regression in the validation logic itself, so this is not a BLOCK, but the HTTP surface is uncovered.

---

### C3 — Adapter ordering fix (REMINDER reset before FIXED promotion)

**Source verified:** All three adapters contain the correct ordering:
- `msft.adapter.js` lines 262-272: REMINDER reset (`fields.placement_mode = ANYTIME`) runs at line 262-264; FIXED promotion runs at lines 267-272. Comment explicitly states "must run before FIXED promotion so a same-sync date/time change still wins."
- `gcal.adapter.js` lines 177-179: same pattern confirmed.
- `apple.adapter.js` lines 239-241: same pattern confirmed.

The ordering is correct in source.

**Test coverage for the combined scenario:** The specific scenario Bert's fix targets is: a task currently at `placement_mode: 'reminder'` (formerly transparent) where the same sync event is now non-transparent AND has date/time changes — should end up as FIXED, not ANYTIME.

Examining all three adapters' test files:

- `02-adapter-msft.test.js` line 286-303: Tests "should clear marker when event is no longer transparent" with `currentTask.placement_mode = 'reminder'`, `isTransparent: false`, but the event's `startDateTime` is `'2026-04-15T10:00:00'` and `currentTask.date = '2026-04-15'` and `currentTask.time = '10:00 AM'` — the date and time are UNCHANGED. This tests the REMINDER→ANYTIME path only. It does NOT test REMINDER→FIXED when date/time also change in the same sync.

- `01-adapter-gcal.test.js`: Global grep for `placement_mode.*reminder` returned zero hits. No test involves a currentTask with `placement_mode: 'reminder'`.

- `03-adapter-apple.test.js`: Same — global grep for `placement_mode.*reminder` returned zero hits.

The combined scenario — formerly-transparent task + date/time change in same sync → must be FIXED not ANYTIME — is untested in all three adapters. If the ordering were swapped (FIXED promotion first, then REMINDER reset), the reset would overwrite the FIXED result to ANYTIME, producing a bug. The current source order is correct but no test would catch a reversal.

**Verdict: BLOCK** — the ordering-sensitive behavior Bert's fix specifically addresses has no test coverage. A swap of the two `if` blocks in any adapter would not be caught.

---

### W3 — rigid removed from MCP Zod schema

**Source verified:** `juggler-backend/src/mcp/tools/tasks.js` lines 21-60 (full Zod schema read). `rigid` does not appear anywhere in the schema. The field is absent. Confirmed.

**Test coverage:** Global grep for `rigid.*true|rigid.*false` in `mcp-task-config.test.js` and `mcp.test.js` returned zero hits. There is no test that sends `rigid: true` to the MCP `create_task` or `update_task` handler and verifies it is either rejected (if Zod strips unknown keys) or ignored (passthrough to taskToRow which no longer maps it).

The risk level is low — if `rigid` were accidentally re-added to the schema, no external behavior would break because the DB column still exists and `taskToRow` passes it through. The field removal is a simplification, not a security or correctness issue. A test would confirm the schema is clean, but the absence doesn't mask a production bug.

**Verdict: WARN** — no test verifies `rigid: true` is silently ignored or rejected; low risk but the cleanup is unverified.

---

### W5 — safeParseJSON fallback removed

**Source verified:** `task.controller.js` lines 126-131:
```js
function safeParseJSON(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val !== 'string') return val;
  if (val === '' || val === 'null') return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}
```
Line 128: `if (typeof val !== 'string') return val` — the `|| fallback` that was there before is gone. A non-string value (e.g., `0`, `false`, `[]`) is returned as-is, not replaced by fallback.

**Test coverage:** Global grep for `safeParseJSON` across all test files returned zero hits. The function is not tested directly in any unit test. The behavior change (non-string non-null values pass through instead of falling back) affects the `location`, `tools`, `recur`, and `dependsOn` fields in `rowToTask` — all of which call `safeParseJSON`. No test passes `location: 0`, `tools: false`, or `recur: []` as a DB row value and verifies the output.

The risk: DB rows in MySQL will always have JSON columns as either a string or NULL — non-string, non-null values would only arise from a bug elsewhere. The gap is real but the trigger condition is unlikely from a well-formed DB. Still, the behavioral change is undocumented by any test.

**Verdict: WARN** — `safeParseJSON` has no direct unit tests; the new `typeof val !== 'string'` passthrough behavior (replacing `|| fallback`) is unverified by any test case.

---

### Summary Table

| Item | Source Correct | Test Gap | Verdict |
|------|---------------|----------|---------|
| RC-C1: planCheck reads `plans[APP_ID]`, returns `{ hasActivePlan: false }` if absent | Yes | No test for `hasActivePlan: false` path; no production guard test | BLOCK |
| RC-C1: `MCP_DEV_NO_AUTH` bypass blocked in production | Yes | No test verifies production blocks the bypass | BLOCK (same finding) |
| RC-C2: `/oauth/authorize` rejects non-localhost redirect_uri | Yes | No test for allowlist rejection | BLOCK |
| RC-C2: OAuth endpoints inactive when only `MCP_DEV_NO_AUTH` set (not `NODE_ENV=development`) | Yes | No test confirms `MCP_DEV_NO_AUTH` alone doesn't activate OAuth endpoints | WARN |
| C1: `rowToTask` returns `row.placement_mode` with no fallback | Yes | No test passes `placement_mode: null` to verify null passthrough | WARN |
| C2: Unknown `placementMode` → validation error (MCP path) | Yes | MCP test at mcp-task-config.test.js:248 is real and passes | PASS (MCP path) |
| C2: Unknown `placementMode` → 400 (HTTP path) | Yes | No HTTP endpoint test for invalid placementMode | WARN |
| C2: `validateTaskInput` unit test for unknown mode | Yes (source) | No `validateTaskInput({ placementMode: 'bogus' })` unit test | WARN |
| C3: REMINDER reset runs before FIXED promotion (all 3 adapters) | Yes | No test for combined formerly-transparent + date/time change → FIXED | BLOCK |
| W3: `rigid` absent from MCP Zod schema | Yes | No test sends `rigid: true` to MCP to verify ignored/rejected | WARN |
| W5: `safeParseJSON` `|| fallback` removed; non-string returns `val` | Yes | No unit test for `safeParseJSON` with falsy non-string inputs | WARN |

### Required Actions

- [ ] **BLOCK (RC-C1):** Add tests to `mcp.test.js` or a new `mcp-transport.test.js`: (a) JWT with no plan for APP_ID → `planCheck` returns `{ hasActivePlan: false }`; (b) `NODE_ENV=production` + `MCP_DEV_NO_AUTH=true` + `dev-token` → 401; (c) `NODE_ENV=production` + no token → 401 (not dev bypass).
- [ ] **BLOCK (RC-C2 allowlist):** Add test in `tests/unit/app.test.js` or `tests/api/` that GETs `/oauth/authorize?redirect_uri=https://evil.com/callback` in `NODE_ENV=development` and asserts 400 with body `{ error_description: 'redirect_uri host not permitted' }`.
- [ ] **BLOCK (C3):** Add a test in each adapter's test file (or at minimum msft, which has the existing "clear marker" test as a template) for the combined scenario: `currentTask = { placement_mode: 'reminder', date: '2026-04-15', time: '10:00 AM' }`, event `isTransparent: false` AND `startDateTime` changed to a different date or time — assert `fields.placement_mode === 'fixed'`. This directly validates the ordering Bert's fix establishes.
- [ ] **WARN (C1):** Add `rowToTask({ ...sampleRow, placement_mode: null })` test asserting `task.placementMode === null` to lock out re-introduction of the ANYTIME fallback.
- [ ] **WARN (C2 HTTP):** Add an HTTP-level test that POSTs `{ text: 'test', placementMode: 'bogus_mode' }` to `POST /api/tasks` and asserts 400.
- [ ] **WARN (C2 unit):** Add `const errs = validateTaskInput({ placementMode: 'bogus_mode' }); expect(errs.some(e => /is not valid/i.test(e))).toBe(true)` to `taskControllerUnit.test.js` cross-field section.
- [ ] **WARN (W3):** Add a test sending `{ text: 'test', rigid: true }` to MCP `create_task` and asserting no error and that the task row does not contain an unexpected `rigid` column value (or that it is silently ignored).
- [ ] **WARN (W5):** Add unit tests for `safeParseJSON` exported or tested indirectly: `safeParseJSON(0, [])` → `0`; `safeParseJSON(false, null)` → `false`; `safeParseJSON([], null)` → `[]`.

---

_Reviewer: Zoe_
_Mode: Bert Fix Re-Verify — precommit_
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
