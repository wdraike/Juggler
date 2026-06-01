# Test Review — 2026-06-01

## Summary
66 tests passed, 0 failed in WhenSection.test.jsx. 4 new ZOE-JUG-040 tests added and passing.

## Test Results

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| WhenSection.test.jsx | 66 | 66 | 0 | 0 | 3.0s |

## ZOE-JUG-040 New Tests (lines 431–475)

| Test | Coverage Target | Result |
|------|----------------|--------|
| selecting exact calls onRigidChange(true) AND onTimeFlexChange(0) atomically | ± Window onChange v===0 branch | PASS |
| selecting non-zero window calls onRigidChange(false) AND onTimeFlexChange(v) | ± Window onChange v!==0 branch | PASS |
| ± Window select shows "exact" option when rigid=true | select controlled value | PASS |
| ± Window select value reflects rigid=true as value=0 | select controlled value | PASS |

## Coverage Assessment

Both branches of the ± Window select's onChange handler are now covered:
- `v === 0` path: `onRigidChange(true); onTimeFlexChange(0)` — covered
- `v !== 0` path: `onRigidChange(false); onTimeFlexChange(v)` — covered
- Controlled select value derivation (`rigid ? 0 : (timeFlex || 60)`) — covered

## Pre-existing Failures (not in scope)
4 tests in `WhenSection.modes.test.jsx` (pre-existing, unrelated to this task):
- `placementMode=all_day datePinned=* rigid=* recurring=false › isFixed derivation is correct` (×4)

## Failed Tests
None in WhenSection.test.jsx.

## Status: PASS

_Signed: Telly — 2026-06-01T14:38:00Z_
