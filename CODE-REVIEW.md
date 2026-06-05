# Code Review — juggler scheduler grace/overdue/collision fixes — 2026-06-05

## Summary
Three targeted bug fixes: grace period reduced to 1s, overdue tasks snapped to last time-block boundary, collision detection for stacked overdue placements. Logic is correct and symmetric across both synthesis loops. One Critical: existing grace-period test encodes the old 10s constant and will fail. Must be updated before commit. Two Warnings: minor drift between the two synthesis loops (DEFAULT_TIME_BLOCKS vs cfg.timeBlocks), and `_originalStartMin` field is written but not confirmed consumed.

## Critical Findings (must fix before merge)
| # | Status | Finding | File:Line | Remediation |
|---|--------|---------|-----------|-------------|
| C1 | FIXED | Test simulated 5s skew against old 10s grace; would fail with 1s grace. | `tests/schedulePlacementsIntegration.test.js:99–126` | Updated skew to 500ms, title/comments updated to "1s grace". |

## Warning Findings (fix this sprint)
| # | Status | Finding | File:Line | Remediation |
|---|--------|---------|-----------|-------------|
| W1 | OPEN (deferred) | `getSchedulePlacements` uses `DEFAULT_TIME_BLOCKS`; `runScheduleAndPersist` uses `cfg.timeBlocks`. Users with custom blocks see minor divergence on overdue placement snapping. Not a data loss risk. | `runSchedule.js:~2155` | Defer to backlog — acceptable for now. |
| W2 | FIXED | `_originalStartMin` written to entry but consumed nowhere — pollutes API payload. | `runSchedule.js:1798, 2173` | Removed from both loops. Unused variable also cleaned up. |

## Info / Suggestions
| # | Finding | File:Line | Suggestion |
|---|---------|-----------|------------|
| I1 | Collision `while` loop could theoretically iterate many times on a dense date. Task counts are small in practice; fine as-is. Cap at ~20 iterations as a safety valve if this shows up in production. | `runSchedule.js:1792, 2167` | No action needed now. |
| I2 | Both synthesis loops are now ~40 lines of near-identical logic. Extract to a shared `synthesizeOverduePlacements(allTasks, placements, usedSlots, timeInfo, timeBlocks, TIMEZONE)` helper to prevent future drift. | Both loops | Backlog item. |

## Checklist Status
- [x] Complexity — PASS (changes localized, well-commented)
- [x] Error handling — PASS (no new error paths)
- [⚠] Test coverage — CRITICAL (grace-period test breaks — see C1)
- [x] Observability — PASS (no logging changes)
- [x] Scalability — PASS (collision loop bounded by small task count)
- [x] API design — N/A (no HTTP changes)
- [x] Dead code — WARN (_originalStartMin may be unused — see W2)

## Status: PASS
_Signed: Ernie — 2026-06-05T00:00:00Z (post-fix re-review)_
