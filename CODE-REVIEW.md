# Code Review — juggler overdue synthesis fix — 2026-06-05

## Summary
Two correctness bugs fixed correctly. Logic is sound. W1 (redundant parseTimeToMinutes call) was fixed by reusing `scheduledMins` as `startMin`. W2 (no test for isPastDue path) addressed with new integration test in `schedulePlacementsIntegration.test.js`. I1 (theme.error consistency) applied to CalendarView. No critical findings. Ship-ready.

## Critical Findings (must fix before merge)
_None._

## Warning Findings (fix this sprint)
| # | Status | Finding | File:Line | Remediation |
|---|--------|---------|-----------|-------------|
| W1 | FIXED | `scheduledMins` and `startMin` were both `parseTimeToMinutes(t.time)` — same call, same input. | `runSchedule.js:1759–1765` and `2108–2114` | Fixed: `var startMin = scheduledMins;` in both Location A and Location B. |
| W2 | FIXED | New `isPastDue` code path not covered by existing tests. | `schedulePlacementsIntegration.test.js` | Added: `isPastDue: past task with overdue=0 appears in dayPlacements with _overdue=true`. |

## Info / Suggestions
| # | Status | Finding | File:Line | Suggestion |
|---|--------|---------|-----------|------------|
| I1 | FIXED | `CalendarView.jsx` `TaskEntry` used hard-coded `'#EF4444'` instead of `theme.error`. | `CalendarView.jsx:191,235` | Fixed: use `theme.error` to match DailyView. |

## Checklist Status
- [x] Complexity — PASS (localized changes, no new nesting)
- [x] Error handling — PASS (no new async/promise paths introduced)
- [x] Observability — PASS (no new log gaps)
- [x] Scalability — PASS (O(n) forEach already in place, no new iteration)
- [x] Correctness — PASS (logic matches described bug; both locations fixed symmetrically; fast-path cache hydration also patched)
- [x] API design — N/A (no new routes)
- [x] Test coverage — PASS (W2 addressed with new integration test)
- [x] Dead code — PASS

## Status: PASS
_Signed: Ernie — 2026-06-05T00:00:00Z_
