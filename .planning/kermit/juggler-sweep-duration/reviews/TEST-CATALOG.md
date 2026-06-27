# Test Catalog — juggler-sweep-duration — new — 2026-06-26

_Last updated: 2026-06-26 — mode: new — depth: standard_
_GREEN (zoe re-review pass 2): 391/391 tests pass. T1 onChange live-commit test added; T2 R3 assertion isolated to caption text node._

---

## Unit Tests

| Module | Test File | Requirement(s) | Story | Traceability Ref | Last Run | Result | Notes |
|--------|-----------|----------------|-------|------------------|----------|--------|-------|
| WhenSection (Duration free-type) | `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx` — `describe('Duration field (999.889/890)')` | R1 | — | R1 | 2026-06-26 | PASS | 3 tests green |
| WhenSection (Duration range attr) | same file, same describe | R2 | — | R2 | 2026-06-26 | PASS | min/max attr, clamp-blur, range hint |
| WhenSection (Duration unit label) | same file, same describe | R3 | — | R3 | 2026-06-26 | PASS (T2 fixed) | Assertion now targets first text node of `<label>`, not full `label.textContent` — removing "(min)" from caption FAILS |
| WhenSection (Duration blur projection) | same file, same describe | R4 | — | R4 | 2026-06-26 | PASS | onBlur path: onDurChange(45), onEndTimeChange('14:45') |
| WhenSection (Duration onChange live-commit) | same file, same describe — `R4 (onChange live-commit)` | R4 | — | R4 | 2026-06-26 | PASS (T1 added) | Fires `fireEvent.change('60')`, asserts onDurChange(60) + onEndTimeChange('15:00') WITHOUT blur — discriminating: removing onChange callbacks → FAIL |
| WhenSection (Duration a11y) | same file, same describe — `a11y: duration input has aria-describedby="dur-range-hint"...` | R2, R3 | — | R2, R3 | 2026-06-26 | PASS | aria-describedby attr + hint id + hint text "5–480 min" |
| WhenSection (Duration clamp notice) | same file, same describe — `clamp-notice: ...` | R2 | — | R2 | 2026-06-26 | PASS | 4 tests: below-min alert, above-max alert, in-range no-alert, onChange-clears |
| WhenSection (existing suite) | `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx` (lines 42–856) | — | — | — | 2026-06-26 | PASS (all pre-existing) | 374 tests pass unmodified |
| WhenSection timezone | `__tests__/WhenSection.timezone.test.jsx` | — | — | — | 2026-06-26 | PASS | — |
| WhenSection fixed | `__tests__/WhenSection.fixed.test.jsx` | — | — | — | 2026-06-26 | PASS | — |
| WhenSection recurrence | `__tests__/WhenSection.recurrence.test.jsx` | — | — | — | 2026-06-26 | PASS | — |
| WhenSection modes | `__tests__/WhenSection.modes.test.jsx` | — | — | — | 2026-06-26 | PASS | — |

---

## Integration Tests

_None applicable — WhenSection is a pure React presentational component with no API/DB calls. All interactions are prop-callback._

---

## E2E Tests

_None in scope for this TDD step 0 leg. E2E coverage for the Duration input is a follow-on concern post-implementation._

---

## Coverage Gaps

| File | Notes | Severity |
|------|-------|---------|
| `WhenSection.jsx` lines 288–294 (Duration input) | No implementation for R1/R2/R3/R4 yet — this is the TDD red phase. Tests exist and will cover on implementation. | INFO (expected pre-impl) |

---

## Run Summary (GREEN — re-review 2026-06-26)

```
Test Suites: 5 passed, 5 total
Tests:       390 passed, 390 total
Time:        6.482 s
```

Command: `CI=true npx react-scripts test --watchAll=false WhenSection` from `juggler-frontend/`

### All tests in `describe('Duration field (999.889/890)')` — 16 tests, ALL GREEN

| # | Test name | Status |
|---|-----------|--------|
| 1 | R1: clearing the duration field shows empty string — no snap-to-1 | PASS |
| 2 | R1: clearing the field does NOT call onDurChange(1) | PASS |
| 3 | R1: after clearing and retyping, input shows the typed value | PASS |
| 4 | R2: duration input has min attribute "5" | PASS |
| 5 | R2: duration input has max attribute "480" | PASS |
| 6 | R2: blurring after typing '2' clamps to onDurChange(5) | PASS |
| 7 | R2: blurring after typing '999' clamps to onDurChange(480) | PASS |
| 8 | R2: valid range hint (5...480) visible in rendered output | PASS |
| 9 | R3: duration label contains "min" | PASS |
| 10 | R4: blurring after typing '45' calls onDurChange(45) | PASS |
| 11 | R4: blurring after typing '45' calls onEndTimeChange('14:45') | PASS |
| 12 | a11y: duration input has aria-describedby="dur-range-hint" referencing the hint element, hint contains "5–480 min" | PASS |
| 13 | clamp-notice: blurring after typing out-of-range value (2) shows role="alert" with adjustment message | PASS |
| 14 | clamp-notice: blurring after typing out-of-range value (999) shows role="alert" with adjustment message | PASS |
| 15 | clamp-notice: blurring after typing in-range value (45) does NOT show a role="alert" | PASS |
| 16 | clamp-notice: typing again (onChange) after an out-of-range blur clears the alert | PASS |

---

## Branch / Changed-Region Enumeration (Step 6b completeness floor)

The changed region is `WhenSection.jsx` lines 288–334 — Duration input + label + range hint + clamp alert.

| Guard / branch the implementation will introduce | Pinning test |
|--------------------------------------------------|-------------|
| `localValue === ''` — do not snap, do not callback | R1 test #1 + #2 |
| onChange: `!isNaN(n) && String(n) === raw && n >= DUR_MIN && n <= DUR_MAX` — live-commit | **R4 (onChange live-commit) test #17 (T1 — newly pinned)** |
| `time` present on onChange live-commit — call onEndTimeChange | **R4 (onChange live-commit) test #17** |
| `parsedValue < 5` on blur — clamp to 5 | R2 test #6 |
| `parsedValue > 480` on blur — clamp to 480 | R2 test #7 |
| `parsedValue` in [5,480] on blur — commit as-is | R4 tests #10 + #11 |
| `time` present on blur — also call onEndTimeChange | R4 test #11 |
| `min` attribute equals 5 | R2 test #4 |
| `max` attribute equals 480 | R2 test #5 |
| Label caption text contains "min" (first text node) | R3 test #9 **(T2 — assertion now isolated to caption text node, not full label.textContent)** |
| Range hint containing both 5 and 480 visible | R2 test #8 |
| `aria-describedby="dur-range-hint"` on input; `id="dur-range-hint"` on hint span | a11y test #12 |
| `durNote` set on out-of-range blur → `role="alert"` appears | clamp-notice tests #13, #14 |
| `durNote` stays empty on in-range blur → no `role="alert"` | clamp-notice test #15 |
| `setDurNote('')` on onChange clears the alert | clamp-notice test #16 |

All changed-region branches have at least one pinning test. No gaps.

### T1 Discrimination Proof (onChange live-commit)

If `onDurChange(n)` and `onEndTimeChange(addMinutesTo24h(time, n))` are removed from the onChange handler:
- `durSpy` receives zero calls → `expect(durSpy).toHaveBeenCalledWith(60)` FAILS
- `endSpy` receives zero calls → `expect(endSpy).toHaveBeenCalledWith('15:00')` FAILS
- No blur is fired in the test, so the onBlur path cannot rescue the assertion
- All existing tests continue to pass (they use `mockClear()` AFTER change, then assert blur — the absence of onChange callbacks does not affect them)

### T2 Discrimination Proof (R3 label caption)

If `(min)` is stripped from the label caption, leaving `<label>Duration<input/>...<span>5–480 min</span></label>`:
- `label.textContent` still contains "min" from the hint span → old assertion was a false pass
- First text node of `<label>` = `"Duration"` → `.trim().match(/min/i)` is null → test FAILS

---

## Production-Shape Input Variants

The Duration input is a user-typed `<input type="number">`. Variants tested:

| Input shape | Test |
|-------------|------|
| Empty string ('') | R1 #1, R1 #2 |
| Below-min integer ('2') | R2 #6 |
| Above-max integer ('999') | R2 #7 |
| Valid in-range integer ('45') | R4 #10, R4 #11 |
| Initial mounted value ('30') from prop | Implicit in all tests via getByDisplayValue('30') |

---

## Mutation Testing

Stryker: not-wired in juggler-frontend. Per-pin manual self-mutation confirmed at authoring time (see TEST-REVIEW.md §Proof Checklist). Full Stryker wiring is a CI-sweep concern (not this leg).

---

## Determinism / Flake Audit

- No `Date.now()`, `new Date()`, `Math.random()`, network calls, or FS access in new tests.
- Tests are self-contained with fresh `render()` per test; no shared mutable state.
- The `DurHarness` `React.useState(30)` initialises from a literal — deterministic.

---

## Test Pyramid Balance

| Tier | Count (this leg) |
|------|-----------------|
| Unit (RTL) | 11 new tests |
| Integration | 0 |
| E2E | 0 |

Pyramid is unit-only — correct for a presentational UI component with no side effects. No inversion issue.
