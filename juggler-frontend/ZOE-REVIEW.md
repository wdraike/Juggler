# Zoe Review — 2026-06-01

## Summary
0 BLOCK findings. 1 WARN (pre-existing: soft `if (labelEl)` guard in calendar matrix). ZOE-JUG-040: 4 new tests pass, both onChange branches covered. 1 WARN for recurring-path ± Window not covered (identical logic, different render branch).

## Telly Audit — ZOE-JUG-040 (WhenSection.test.jsx lines 431–475)

### BLOCK Findings
_None._

### WARN Findings
| # | Finding | Evidence | File | Remediation |
|---|---------|----------|------|-------------|
| 1 | Recurring `± Window` select (rendered when `hasPreferredTime=true`, WhenSection.jsx:515-525) shares identical onChange logic but is not covered by the new ZOE-JUG-040 tests. The non-recurring path is fully covered. Since the handler body is character-for-character identical (`if (v === 0) { onRigidChange(true); onTimeFlexChange(0); } else { onRigidChange(false); onTimeFlexChange(v); }`), this is a WARN not BLOCK. | WhenSection.jsx:515-517 | WhenSection.recurrence.test.jsx | Add parallel `± Window` atomicity test for recurring+hasPreferredTime path |
| 2 | (Pre-existing) Calendar matrix `isFixed derivation` uses `if (labelEl)` soft guard that could silently skip opacity assertion if component changes. `tabIndex=-1` assertion provides backstop. | WhenSection.jsx:303-310 | WhenSection.modes.test.jsx:364-380 | Harden to `expect(labelEl).toBeInTheDocument()` before opacity check for non-recurring modes |

### PASS Verifications
| # | Check | Status |
|---|-------|--------|
| 1 | Both onChange branches covered: v===0 → rigid=true + timeFlex=0 (test 1); v!==0 → rigid=false + timeFlex=v (test 2) | PASS |
| 2 | Both callbacks (`onRigidChange` AND `onTimeFlexChange`) asserted in every handler test — atomicity verified | PASS |
| 3 | Controlled select value derivation (`rigid ? 0 : (timeFlex || 60)`) tested: rigid=true renders value=0/"exact" | PASS |
| 4 | `getByDisplayValue(/exact|±/)` query in test 1 matches when rigid=false (select shows timeFlex=60 → "±1hr") | PASS |
| 5 | `getByDisplayValue('exact')` query in tests 2–4 matches when rigid=true (select controlled to value 0) | PASS |
| 6 | 66 tests run in WhenSection.test.jsx, 66 pass, 0 fail, 0 skipped — verified by direct test run | PASS |

## Status: PASS

_Signed: Zoe — 2026-06-01T14:40:00Z_
