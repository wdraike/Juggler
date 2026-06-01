# Zoe Review — 2026-05-31

## Summary
0 BLOCK findings. 1 WARN (pre-existing, not introduced by this change). Test replacement is sound — the new helper tests a real DOM mechanism. 234/234 pass.

## Telly Audit

### BLOCK Findings
_None._

### WARN Findings
| # | Finding | Evidence | File | Remediation |
|---|---------|----------|------|-------------|
| 1 | `hasButtonSilentlyKeyboardLocked()` uses `el.closest('[style]')` — matches any styled ancestor with `pointerEvents:none`, not specifically the mode-selector `div[role="group"]`. If a future component adds an unrelated `pointerEvents:none` wrapper above a `tabIndex=-1` button, the exemption would incorrectly fire. | WhenSection.jsx:312 (only isFixed-controlled divs have pointerEvents:none today) | WhenSection.modes.test.jsx:73 | Pre-existing design; not introduced by this PR. Deferred: tighten selector to `el.closest('[role="group"][style]')` or add a `data-mode-group` attribute |

### PASS Verifications
| # | Check | Status |
|---|-------|--------|
| 1 | `hasDisabledWithoutIndicator` false-pass is gone — `el.disabled` is never set by React on these elements, confirmed by reading source | PASS |
| 2 | `hasButtonSilentlyKeyboardLocked` checks real DOM attribute (`tabIndex="-1"`) which WhenSection actually sets at lines 315/320/325/333/338 | PASS |
| 3 | Matrix path (task=undefined → isFixed=false) correctly produces tabIndex=0 on all mode buttons | PASS |
| 4 | Cal-managed path (gcalEventId set + placementMode=fixed → isFixed=true) correctly produces tabIndex=-1 on mode buttons WITH pointerEvents:none parent — legitimately exempted | PASS |
| 5 | No other buttons in WhenSection have explicit tabIndex — non-mode buttons (day req, time block tags, flex toggle) default to tabIndex=0 | PASS |
| 6 | 234 tests run, 234 pass, 0 fail, 0 skipped — verified by direct npm test run | PASS |
| 7 | Test description accurately states the assertion ("keyboard-locked" rather than "disabled") | PASS |

## Status: PASS

_Signed: Zoe — 2026-05-31T00:00:00Z_
