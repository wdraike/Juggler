# Code Review — juggler scheduler cache-always-stale fix — 2026-06-05

## Summary
Fix is architecturally correct. Root cause (MySQL/Node.js clock skew → generatedAt always behind updated_at → fast path never fires) is properly addressed by sourcing generatedAt from MySQL's clock. Two warn items: a date-parsing fragility and missing targeted test for the grace period. No blocking issues.

## Critical Findings (must fix before merge)
None.

## Warning Findings (fix this sprint)
| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| W1 | `new Date(_dbNow)` parses MySQL datetime string `"2026-06-05 12:34:56.123"` (space separator) as implementation-defined (local time in V8). Works on Cloud Run (UTC) but fragile. All other datetime strings in this file use `.replace(' ', 'T') + 'Z'` for explicit UTC parse. | runSchedule.js:1683 | `new Date(String(_dbNow).replace(' ', 'T') + 'Z').toISOString()` |
| W2 | No targeted unit test for 10s grace period boundary. The fast-path integration test (`'fresh cache returns quickly without re-running'`) exercises the happy path but not the case where `updated_at` is within 10s of `generatedAt`. | schedulePlacementsIntegration.test.js | Add unit test: seed a task with `updated_at = generatedAt + 5s` and assert cache is still considered fresh. |

## Info / Suggestions
| # | Finding | File:Line | Suggestion |
|---|---------|-----------|-------------|
| I1 | `runSchedule.js` is 2263 lines — far exceeds the 300-line guideline. Pre-existing, not introduced by this change. | runSchedule.js | Decompose into sub-modules in a future refactor phase. |

## Checklist Status
- [x] Complexity — pre-existing oversize, change itself is small (12 lines)
- [x] Error handling — periodic nudge catch is correct; raw SQL access pattern is correct
- [x] Test coverage — existing integration test covers fast path; grace period boundary untested (W2)
- [x] Observability — `console.warn` for periodic nudge matches existing pattern in file (line 429)
- [x] Scalability — nudge endpoint has `schedulerLimiter`; visibility guard prevents background tab spam
- [x] Logic correctness — Change 1 (MySQL NOW(3) for generatedAt) fixes root cause; Changes 2–3 add safety margin; Change 4 adds fallback nudge with correct cleanup

## Status: ISSUES
_Signed: Ernie — 2026-06-05T00:00:00Z_

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
