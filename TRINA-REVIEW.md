# TRINA-REVIEW — Rolling Anchor Backfill (Re-Audit)

**Date:** 2026-05-21
**Reviewer:** Trina (adversarial test quality auditor)
**Scope:** `juggler-backend/tests/taskControllerUnit.test.js` — rolling recurrence block
**Controller:** `juggler-backend/src/controllers/task.controller.js` lines 742–783

---

## Test Run

```
56 tests, 56 passed, 0 failed
Suite: juggler-backend/tests/taskControllerUnit.test.js
Time: 1.76s
```

---

## Overall Verdict: PASS

All six previous WARN findings are resolved. Every new test traces through the actual validation
logic in `task.controller.js` and exercises the specific code path it claims to cover. No dead
assertions, no false positives.

---

## Previous WARN Findings — Disposition

### WARN-1: "rolling is accepted" test didn't cover null/empty type bypass

**Resolution:** Two new tests added:

- `'empty recur type rejected'` — passes `{ type: '' }`, expects `/type is required/i`.
- `'null recur type rejected'` — passes `{ type: null }`, expects `/type is required/i`.

**Trace-through (type=''):** `('' || '').toLowerCase()` → `rType = ''`. `if (!rType)` is truthy
→ line 746 pushes `'Recurrence type is required when recur object is provided'`. Regex
`/type is required/i` matches. Positive assertion `.toBe(true)` satisfied.

**Trace-through (type=null):** `(null || '').toLowerCase()` → `rType = ''`. Same path as above.

Both tests genuinely exercise line 746. **RESOLVED.**

---

### WARN-2: "unknown recur type" test was insufficiently tight

**Resolution:** Test now uses a positive `.toBe(true)` assertion:

```js
test('unknown recur type rejected', () => {
  const errs = validateTaskInput({ recur: { type: 'quarterly' } });
  expect(errs.some(e => /invalid recurrence type/i.test(e))).toBe(true);
});
```

**Trace-through:** `rType = 'quarterly'`. `!rType` false (no required-error). `validRecurTypes.indexOf('quarterly') === -1` is true → line 747 pushes `'Invalid recurrence type: quarterly'`.
Regex `/invalid recurrence type/i` matches. Assertion is a true positive, not negation. **RESOLVED.**

---

### Missing: every=0 and every=-1

**Resolution:** Two explicit tests added:

- `'rolling with every=0 rejected'` — `every: 0`, expects `/positive integer/i`.
- `'rolling with every=-1 rejected'` — `every: -1`, expects `/positive integer/i`.

**Trace-through (every=0):** `rType='rolling'`, `r.every=0`, `0 !== undefined` → branch at
line 749 entered. `everyVal=0`. `Number.isFinite(0)` true, but `0 < 1` true → error pushed
at line 752. Regex matches. **RESOLVED.**

**Trace-through (every=-1):** Same path; `-1 < 1` triggers error. **RESOLVED.**

---

### Missing: every=Infinity

**Resolution:** `'rolling with every=Infinity rejected'` — `every: Infinity`, expects
`/positive integer/i`.

**Trace-through:** `everyVal = Number(Infinity) = Infinity`. `Number.isFinite(Infinity)` is
**false** → error pushed at line 752 immediately (first condition). Regex matches. **RESOLVED.**

---

### Missing: unit='years'

**Resolution:** `'rolling with unit=years rejected'` — `unit: 'years'`, expects `/unit must be/i`.

**Trace-through:** `rType='rolling'`, `r.unit='years'`, not undefined → branch at line 756
entered. `VALID_RECUR_UNITS.indexOf('years') === -1` → line 758 pushes `'Recurrence unit must
be days, weeks, or months'`. Regex `/unit must be/i` matches. **RESOLVED.**

---

### Missing: unit=undefined (should not error)

**Resolution:** `'rolling with undefined every and unit accepted (scheduler has defaults)'` —
`recur: { type: 'rolling' }` (no `every`, no `unit`), expects `errs.length === 0`.

**Trace-through:** `r.every === undefined` → line 749 branch not entered. `r.unit === undefined`
→ line 756 branch not entered. `isAnchorDependentRecur` returns true for rolling, but
`_requireRecurStartIfAnchor` is not set and `recurStart` is `undefined` (not null/empty string)
→ line 777 else-if not triggered. `errs.length === 0`. **RESOLVED.**

---

### Missing: type=null / type='' (also covers WARN-1 above)

Covered by the two new null/empty-type tests. **RESOLVED.**

---

### Missing: mixed-case 'Rolling'

**Resolution:** `'Rolling (mixed case) accepted via toLowerCase'` — `type: 'Rolling'`, expects
no invalid-type error.

**Trace-through:** `('Rolling' || '').toLowerCase()` → `rType='rolling'`.
`validRecurTypes.indexOf('rolling') !== -1` → no invalid-type error. Assertion
`.toBe(false)` satisfied. **RESOLVED.**

---

## Validation Code Coverage (lines 742–783)

| Validation line | Test(s) covering it |
|-----------------|---------------------|
| 745: `(type \|\| '').toLowerCase()` | mixed-case 'Rolling' test |
| 746: `if (!rType)` → required error | null type, empty type tests |
| 747: `indexOf === -1` → invalid type error | unknown recur type ('quarterly') test |
| 749–753: `isFinite / < 1 / isInteger` check | every=0, every=-1, every=Infinity tests |
| 756–759: `VALID_RECUR_UNITS.indexOf` | unit='years' test; valid units test |
| 771–776: `isAnchorDependentRecur` + requireFlag | create rejects/allows rolling with/without recurStart |
| 777–779: explicit-clear path (null / empty) | update rejects null/empty recurStart on rolling |

All branches in the rolling validation path have test coverage.
