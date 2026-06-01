# Zoe Review — 2026-06-01

## Summary
0 BLOCK findings. 1 WARN (soft `if (labelEl)` guard in calendar matrix could silently skip opacity assertion if component changes). 197/197 pass.

## Telly Audit

### BLOCK Findings
_None._

### WARN Findings
| # | Finding | Evidence | File | Remediation |
|---|---------|----------|------|-------------|
| 1 | Calendar matrix `isFixed derivation` uses `if (labelEl)` soft guard — for `placementMode=fixed+cal`, the label IS always rendered (non-recurring path, component line 303-310), so the guard never fires today, but if the component stopped rendering the label the opacity assertion would silently skip. The `tabIndex=-1` assertion below it provides a real backstop, making this WARN not BLOCK. | WhenSection.jsx:303-310 | WhenSection.modes.test.jsx:364-380 | Harden to `expect(labelEl).toBeInTheDocument()` before the opacity check for non-recurring modes |

### PASS Verifications
| # | Check | Status |
|---|-------|--------|
| 1 | 40 zero-assertion `renders without crashing` tests removed from main matrix — each combination now runs 4 real assertions (button visibility, isFixed derivation, keyboard lock, all_day hiding) | PASS |
| 2 | 5 zero-assertion calendar matrix smoke tests replaced with `mode selector buttons are present` (4 assertions each) | PASS |
| 3 | `isFixed derivation` assertion for `all_day + recurring=false` corrected — component shows "Scheduling mode" label for all non-recurring modes; prior assertion was wrong | PASS |
| 4 | `hasButtonSilentlyKeyboardLocked` helper checks real DOM attribute (tabIndex="-1") against real component behavior (WhenSection.jsx:315/320/325/333/338) | PASS |
| 5 | Calendar matrix `isFixed` path (fixed+gcalEventId): tabIndex=-1 assertion is unconditional and will catch regressions even if label guard fires | PASS |
| 6 | Calendar matrix non-fixed path: pointerEvents assertion is unconditional | PASS |
| 7 | 197 tests run, 197 pass, 0 fail, 0 skipped — verified by direct test run | PASS |

## Status: PASS

_Signed: Zoe — 2026-06-01T00:00:00Z_
