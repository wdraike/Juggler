# ZOE Adversarial Test Quality Audit — Juggler Task Configuration Tests

**Date:** 2026-05-24
**Scope:**
1. `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx`
2. `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx`
3. `juggler-backend/tests/mcp-task-config.test.js`
**Reference docs:** `TASK-EDIT-UX-AUDIT.md`, `TASK-CONFIGURATION-MATRIX.md`

---

## Overall Verdict: BLOCK

Telly's frontend mode-matrix is parameterized fluff: 160 of its 166 tests are shallow "renders without crashing" + DOM presence checks that do not exercise interactivity, silent lockout conditions, or invalid combinations. The backend suite covers happy-path inference but ignores contradictory parameters and negative paths entirely. Bird's 5 silent lockout scenarios are untested.

---

## File 1 — `WhenSection.modes.test.jsx`

### Verdict: BLOCK

**Test count claim check:** The matrix runs 5 modes x 2 datePinned x 2 rigid x 2 recurring = 40 parameter blocks x 4 tests each = 160 tests, plus 6 ad-hoc tests = 166 total. If the claim is 206, the remaining 40 are missing from the file I read (possibly split into another file or the claim was inflated).

### Findings

#### F1 — Parameterized fluff (160 shallow tests)
Each block contains four near-meaningless tests:

| Test name | Depth of assertion | Why it is fluff |
|-----------|-------------------|-----------------|
| `renders without crashing` | `render()` with no expect | Passes if the component throws no error on mount. Does not verify state, derived values, or DOM correctness. |
| `mode selector buttons visibility is correct` | `toBeInTheDocument()` on 3-4 buttons | Only checks DOM presence, never clicks them, never checks disabled/interactive state. Non-recurring path asserts all 4 buttons exist "regardless of placementMode" — but `fixed` mode disables them via CSS, which this test does NOT catch. |
| `isFixed derivation is correct` | `labelEl.style.opacity` | Only checks the Scheduling mode label opacity. Does NOT verify the actual controls that matter (mode buttons, day picker, time-block tags) are disabled. Skips entirely when label is absent (all_day). |
| `no control is disabled without a visible indicator` | Custom `hasDisabledWithoutIndicator` | **False-pass candidate.** The helper only checks the `.disabled` HTML property. WhenSection.jsx disables interactively via `pointerEvents: 'none'` and `opacity: 0.35` (CSS), NOT the `disabled` attribute. The test passes but the silent lockout (greyed buttons with no tooltip/banner) is unverified. |
| `All Day mode hides time inputs` | `queryByText('Time')` | Only asserts the negative case (all_day hides). Does not assert that time IS shown for the other 4 modes. |

**Fix:** Remove `renders without crashing`. Replace the other three with targeted interaction tests that simulate clicks on allegedly-disabled controls and assert `onModeChange` is NOT called.

#### F2 — Silent lockout scenario: `fixed` + `datePinned=false` is untested
The UX audit (TASK-EDIT-UX-AUDIT.md line 21) flags this as a silent lockout: `placementMode === 'fixed'` makes `isFixed=true`, disabling the mode selector, but if `datePinned=false` the Pin button still reads "Pin" (unpinned). The user sees an unlocked pin yet cannot change mode, with no explanation.

The matrix includes `fixed` x `datePinned=false` as a parameter combination, but none of the four tests in that block verify the Pin button text OR the disabled state of the mode buttons.

**Fix needed:** Add a dedicated test:
```jsx
it('fixed mode with datePinned=false shows unlocked Pin button while disabling mode selector', () => {
  render(<WhenSection {...buildProps({ placementMode: 'fixed', datePinned: false })} />);
  expect(screen.getByText(/Pin/)).toBeInTheDocument(); // unlocked
  // Mode selector must be non-interactive
  fireEvent.click(screen.getByText(/Anytime/));
  expect(called).toBeNull(); // onModeChange must not fire
});
```

#### F3 — Silent lockout scenario: `isFixed=true` missing visible explanation is untested
The UX audit finds 5 silent lockout scenarios. The matrix's `hasDisabledWithoutIndicator` helper is supposed to catch these, but it is broken (see F1). The actual UI uses CSS opacity/pointerEvents, not HTML `disabled`, so there is **zero test coverage** that a visible explanation (banner, tooltip, aria-label) accompanies disabled controls.

The 5 scenarios from UX audit:
1. Calendar-synced task (`placementMode=fixed` + `datePinned=true`) — greyed mode selector, no calendar ownership text.
2. Drag-pinned task (`_dragPin` sets `datePinned=true`) — no test data simulates `_dragPin`.
3. MCP/API auto-pinned (`datePinned=1` + `placementMode=fixed` on create) — not simulated.
4. `all_day` hiding time inputs — tested shallowly, but not as a "lockout" with explanation.
5. Recurring `time_window` with `exact` + Float/Fixed toggle ineffectiveness — matrix does not include `timeFlex=0` or `rigid` state in parameters.

**Fix needed:** Replace `hasDisabledWithoutIndicator` with a test that specifically queries for an explanatory banner/aria-label when `isFixed` is derived, and add tests for all 5 scenarios.

#### F4 — Abby's invalid combinations are never exercised
The TASK-CONFIGURATION-MATRIX.md catalogs 10 invalid/locked combinations. The frontend tests never pass contradictory props to verify the component rejects or sanitizes them.

Missing frontend guard tests:
- `all_day` + `time` provided (should clear time or show warning)
- `fixed` + `datePinned=false` (covered in F2 but as UI state, not as prop validation)
- `marker=true` + any scheduling mode (should hide scheduling section entirely)
- `recurring=true` + `dependsOn` (dependency UI should be stripped)
- `split=true` + `marker=true` / `recurring=true` (split controls hidden)

**Fix needed:** Add an `invalid-combinations` describe block that mounts the component with each contradictory state and asserts the UI either sanitizes or blocks.

#### F5 — Mode transition paths are untested
The UX audit (lines 29-33) lists mode transitions that wipe state or risk lockout. The matrix tests static props only; it never simulates `onModeChange` callbacks that transition between modes and verifies state cleanup.

Missing:
- All Day -> non-all-day: does duration reset to default?
- Non-recurring -> Recurring: is All Day mode removed?
- `time`/`endTime`/`dur` cleared when entering All Day

**Fix needed:** Add integration tests in `TaskEditForm` test suite (outside scope of WhenSection alone) or mock the parent callback chain.

#### F6 — Recurring section All Day gap is untested
The UX audit (lines 39-44) notes that recurring tasks do not offer All Day mode. The matrix parameter block for `recurring=true` only asserts 3 buttons exist. It does NOT assert that All Day is absent, nor does it test what happens if a one-off all-day task is switched to recurring (mode should not silently revert).

**Fix needed:** Add test: `recurring=true` + `placementMode='all_day'` → assert component either shows a fallback mode or a warning.

#### F7 — `rigid` is in the parameter matrix but never meaningfully asserted
The matrix iterates `rigid` true/false, but the only test that references it is `isFixed derivation`, which does not depend on `rigid`. `rigid` affects scheduler behavior (`timeFlex=0` exact window) and UI Float/Fixed toggle state. None of the 160 parameterized tests exercise this.

**Fix needed:** Remove `rigid` from the parameter loop if it is unused, or add assertions for Float/Fixed toggle active state and `timeFlex` visibility.

---

## File 2 — `WhenSection.test.jsx` (Baseline)

### Verdict: WARN

This is the older baseline suite (345 lines, ~40 tests). It covers individual features (recurrence, rolling, split toggle, pin) with modest depth. It does NOT cover the mode matrix or lockout scenarios, but that is the job of `WhenSection.modes.test.jsx`. However, it also misses interaction depth on its own features.

### Findings

#### F8 — Shallow assertions on active button state
Tests like `non-recurring task Anytime button is active when placementMode === anytime` assert `btn.style.fontWeight === '600'`. This is a presentational check, not a behavioral one. It does not prove the button is interactive or that clicking it does anything.

**Fix needed:** Pair each "active state" test with a click test that asserts `onModeChange` fires.

#### F9 — No negative interaction tests
There are zero tests that click a control that SHOULD be disabled/inert and assert the handler is NOT called. Examples:
- Clicking a greyed mode button when `isFixed=true`
- Clicking Float/Fixed toggle when `recurring=true`
- Clicking Split toggle when `marker=true`

**Fix needed:** Add `it('does not call onModeChange when mode selector is disabled', ...)` for each lockout state.

#### F10 — Rolling recurrence tests do not cover edge cases
The rolling tests (lines 247-314) verify presence of options and anchor card text, but miss:
- `recurEvery=0` or negative interval (should be rejected or clamped)
- `recurUnit` switching from `days` to `months` — does the interval input retain its value or reset?
- Rolling anchor date in the past vs. future
- `recurType` changing from `weekly` to `rolling` — are `recurDays` cleared?

**Fix needed:** Add boundary and transition tests for rolling recurrence.

#### F11 — No coverage of `taskTz` / timezone change behavior
`taskTz` is in BASE props but never tested. The `onChangeTz` handler is provided but never fired in any test.

**Fix needed:** Add test: changing timezone updates displayed time values or calls `onChangeTz`.

---

## File 3 — `mcp-task-config.test.js` (Backend)

### Verdict: WARN

12 tests cover placement_mode and date_pinned inference. The happy-path coverage is adequate, but contradictory parameters, negative paths, and edge cases are missing.

### Findings

#### F12 — No negative tests for contradictory parameters
The TASK-CONFIGURATION-MATRIX.md lists several invalid combinations that the backend should reject or sanitize. The test suite sends none of these.

Missing backend guard tests:
- `placementMode: 'all_day'` + `time: '2:00 PM'` → should reject or strip time
- `placementMode: 'fixed'` without `date` or `time` → should reject (fixed requires anchor)
- `placementMode: 'time_window'` without `time` → should reject or fallback
- `datePinned: false` + `time: '2:00 PM'` → contradiction: time implies fixed, which implies pinned. Does the backend respect the explicit `datePinned: false` or override it?
- `marker: true` + `placementMode: 'time_window'` → should coerce to `reminder`
- Invalid `placementMode` string (e.g., `'invalid_mode'`) → should reject with 400

**Fix needed:** Add a `describe('invalid combinations', ...)` block with at least the 6 cases above.

#### F13 — `datePinned` override when time is present is not tested
The MCP auto-pins when `date` or `time` or `scheduledAt` is present and `datePinned` is omitted. The suite tests:
- Explicit `datePinned: false` + `date` only (no time) → `all_day`, unpinned (line 106)
- Explicit `datePinned: false` + `date` + `placementMode: 'anytime'` → `anytime`, unpinned (line 149)

But it does NOT test:
- Explicit `datePinned: false` + `date` + `time` → what happens? Time implies `fixed`, which implies `date_pinned=1`. Does explicit override win?

This is a critical edge case because it tests the precedence of explicit user intent vs. auto-inference.

**Fix needed:** Add test:
```js
test('explicit datePinned:false + date + time → date_pinned = 0, placement_mode = fixed', async () => {
  await handler({ text: 'Explicit unpinned with time', date: '2026-05-20', time: '3:00 PM', datePinned: false });
  expect(capturedInsertRow.date_pinned).toBe(0);
  expect(capturedInsertRow.placement_mode).toBe('fixed');
});
```

#### F14 — Recurring task inference is completely absent
The 12 tests are all non-recurring. The TASK-CONFIGURATION-MATRIX.md has 10 recurring rows. None are tested:
- `recurring=true` + `preferredTimeMins` + `timeFlex=0` → should infer `fixed` / `rigid=true`
- `recurring=true` + `date` only → should infer `all_day`?
- `recurring=true` + no date/time → `anytime`?

**Fix needed:** Add at least 3 recurring inference tests.

#### F15 — Misleading test name and false-pass risk
Line 216: `test('datePinned:true without date/time does NOT set date_pinned', ...)`

The test name claims it verifies that auto-pin does NOT fire when there is no scheduling info. But the assertion is `expect(capturedInsertRow.date_pinned).toBe(1)`. The code comment explains this is because `taskToRow` passes through the explicit `true`. The test is actually verifying that explicit `datePinned:true` overrides the "no scheduling info" case, not that auto-pin is suppressed.

A maintainer reading only the test name would think the behavior is the opposite of what is tested. This is a documentation/code-review risk, even if the assertion is technically correct.

**Fix needed:** Rename to `explicit datePinned:true without date/time is preserved by taskToRow`.

#### F16 — `scheduledAt` edge cases untested
Only one test uses `scheduledAt` (line 161). Missing:
- `scheduledAt` with explicit `datePinned: false`
- `scheduledAt` + explicit `placementMode: 'time_window'` (should this be rejected? `time_window` expects a preferred time, not an exact UTC timestamp)
- `scheduledAt` in non-UTC timezone offset
- `scheduledAt` malformed string

**Fix needed:** Add boundary tests for `scheduledAt` parsing and precedence.

#### F17 — Auto-pin override logic for `placementMode` is not thoroughly exercised
The test at line 93: `explicit placementMode: time_window + date + time` asserts `date_pinned` is auto-set to 1. It does not test the reverse: what if `datePinned` is omitted but `placementMode` is explicitly provided? Does auto-pin still fire? The rule says "datePinned omitted AND date/time present". The test confirms this, but does not test:
- `placementMode` omitted, `datePinned` explicitly provided, no date/time → should date_pinned respect explicit false?

**Fix needed:** Add test for explicit `datePinned` without scheduling fields.

---

## Specific Missing Tests to Add

### Frontend (`WhenSection.modes.test.jsx`)

1. `fixed + datePinned=false` → Pin shows "Pin", mode selector is non-interactive, clicking Anytime does NOT call `onModeChange`.
2. `datePinned=true` + any mode → Mode selector is non-interactive AND an explanatory banner/aria-label is present.
3. `recurring=true` + `placementMode='all_day'` → Assert component falls back or warns (All Day is missing from recurring UI).
4. `marker=true` → Scheduling mode section is hidden; clicking marker-off restores it.
5. `all_day` + `time` prop provided → `time` input is NOT rendered (already partially covered, but assert `queryByDisplayValue` is absent too).
6. `rigid=true` + `timeFlex=0` + recurring `time_window` → Float/Fixed toggle has no effect (silent lockout #5).
7. Click each mode button in every valid state and assert `onModeChange` fires with the correct value.
8. Click each allegedly-disabled control and assert handler does NOT fire.

### Frontend (`WhenSection.test.jsx`)

9. Negative click test: click disabled Pin/mode/split and assert handlers silent.
10. Rolling recurrence boundary: `recurEvery=0`, `recurEvery=-1` → clamped or rejected.
11. Timezone change: `onChangeTz` fires with new value.
12. Split toggle + `marker=true` → split controls hidden.

### Backend (`mcp-task-config.test.js`)

13. `placementMode: 'all_day'` + `time: '2:00 PM'` → reject or strip time.
14. `placementMode: 'fixed'` without `date`/`time` → reject with 400.
15. `datePinned: false` + `date` + `time` → assert precedence (explicit override vs. auto-pin).
16. Invalid `placementMode` value → 400 error.
17. `marker: true` + `placementMode: 'time_window'` → coerced to `reminder`.
18. `recurring: true` + `date` only → inferred `all_day`? Or `anytime`?
19. `recurring: true` + `preferredTimeMins` + `timeFlex=0` → inferred `fixed` + `rigid=true`.
20. `scheduledAt` + `datePinned: false` → explicit override respected or ignored?

---

## Action Required

- **BLOCK** findings F1-F7 must be resolved before the mode-matrix test file can be considered adequate. The parameterized block needs a rewrite: remove trivial mount-only tests, fix `hasDisabledWithoutIndicator` to detect CSS-driven lockout, and add dedicated tests for each UX-audit silent lockout scenario.
- **WARN** findings F8-F11 should be addressed in the baseline suite.
- **WARN** findings F12-F17 should be addressed in the backend suite.

Telly's tests give a false sense of coverage. 160 tests that check `toBeInTheDocument()` without simulating user interaction do not validate the behavior Bird found in production.
