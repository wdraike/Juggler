# Test Review — 2026-05-31

## Summary (ZOE-JUG-022 + ZOE-JUG-023 + ZOE-JUG-024)
27 tests passed in `mcp-task-config.test.js` (ZOE-JUG-022). 48 tests passed in `mcp-update-task.test.js` (ZOE-JUG-023). All new capturedInsertRow/capturedUpdateRow assertions are exercised and green.

---

## ZOE-JUG-022 — mcp-task-config.test.js (2026-05-31)

## Test Results

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| mcp-update-task.test.js | 48 | 48 | 0 | 0 | ~0.6s |

## Coverage of `update_task` Handler Branches

| Branch | Lines | Status |
|--------|-------|--------|
| validateTaskInput fails → isError | 236–239 | PASS |
| task not found → isError | 242–244 | PASS |
| gcal-synced + blocked fields → isError | 247–254 | PASS |
| msft-synced + blocked fields → isError | 247–254 | PASS |
| apple-synced + blocked fields → isError | 247–254 | PASS |
| cal-synced + status/notes only → allowed | 248–254 | PASS |
| placementMode:fixed + no scheduling → error | 257–264 | PASS |
| placementMode:fixed + date+time → succeeds | 257–264 | PASS |
| placementMode:fixed + scheduledAt → succeeds | 257–264 | PASS |
| taskToRow field mapping (text/dur/pri/notes/url/dependsOn/placementMode/travel*) | 266–268 | PASS |
| user_id and created_at stripped from row | 267–268 | PASS |
| ALL_DAY backstop: date-only fires | 273–276 | PASS |
| ALL_DAY backstop: time set, skipped | 273–276 | PASS |
| ALL_DAY backstop: scheduledAt set, skipped | 273–276 | PASS |
| ALL_DAY backstop: explicit placementMode wins | 273–276 | PASS |
| guardFixedCalendarWhen on non-instance path | 294–296 | PASS |
| guardFixedCalendarWhen on instance path (source lookup) | 291–293 | PASS |
| locked path: scheduling fields enqueued | 301–315 | PASS |
| locked path: non-scheduling written directly | 303–306 | PASS |
| locked path: queued:true in response | 314 | PASS |
| TEMPLATE_FIELDS: template field → source template | 318–330 | PASS |
| TEMPLATE_FIELDS: non-template field → instance | 332–334 | PASS |
| non-recurring: single direct write | 338–340 | PASS |
| enqueueScheduleRun called on success | 342 | PASS |
| enqueueScheduleRun NOT called on error | — | PASS |
| recurring_template/instance: depends_on strip | 279–281 | INFO — not directly asserted |
| isRecurringInstance + only template fields → instance gets only updated_at | 335–337 | INFO — not directly asserted |

## Failed Tests
None.

## Missing Tests
None for the scoped handler. Two Info-level branches (depends_on strip, instance-only-updated_at path) are exercised incidentally but not directly asserted. Not blocking for this item.

## Status: PASS

_Signed: Telly — 2026-06-01T03:06:26Z_

---

## ZOE-JUG-024 — mcp-create-tasks.test.js (2026-05-31)

## Test Results

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| mcp-create-tasks.test.js | 37 | 37 | 0 | 0 | ~1.8s |

## Coverage of `create_tasks` Handler Branches

| Branch | Lines | Status |
|--------|-------|--------|
| Pre-flight validation loop (all items before any write) | 174–178 | PASS |
| Validation error message includes task index | 177 | PASS |
| splitDefault=true → row.split=1 for unset items | 191–193 | PASS |
| splitDefault=false → row.split=0 for unset items | 191–193 | PASS |
| Explicit split:true overrides splitDefault | 191–193 | PASS |
| Explicit split:false overrides splitDefault | 191–193 | PASS |
| splitMin maps to row.split_min | 189 | PASS |
| splitMin > dur → validation error | 776 | PASS |
| splitMin <= 0 → validation error | 775 | PASS |
| placementMode:fixed + no date/time → validateTaskInput error | 847–854 | PASS |
| placementMode:fixed + empty strings → error | 847–854 | PASS |
| placementMode:fixed + date+time → scheduled_at set | 189 | PASS |
| placementMode:fixed + scheduledAt → succeeds | 189 | PASS |
| Invalid placementMode enum → validation error | 841–844 | PASS |
| _tTimeWasSet all_day backstop: date-only fires | 194–197 | PASS |
| _tTimeWasSet all_day backstop: time set, skipped | 194–197 | PASS |
| _tTimeWasSet all_day backstop: scheduledAt set, skipped | 194–197 | PASS |
| Explicit placementMode wins over backstop | 194–197 | PASS |
| Mixed-mode batch (anytime + time_window + fixed) | 186–199 | PASS |
| isLocked=false → db.transaction path, insertTask called per row | 215–219 | PASS |
| isLocked=true → enqueueWrite per item, insertTask not called | 206–212 | PASS |
| Locked path: user_id set on row before enqueue | 208 | PASS |
| Locked path: queued:true in response | 212 | PASS |
| enqueueScheduleRun called after successful transaction | 221 | PASS |
| enqueueScheduleRun called in locked path | 211 | PASS |
| enqueueScheduleRun NOT called on validation failure | — | PASS |
| Response: created count + ids array | 222 | PASS |
| Response: explicit id preserved | 187 | PASS |
| Empty tasks array → created:0, no writes | 186 | PASS |
| No cal-sync guard on create (guard is update-only) | — | PASS (documented behavior) |

## Failed Tests
None.

## Coverage Gap (INFO — not blocking)
- `ensureProject` path (lines 201–203): exercised whenever `t.project` is truthy, but no test explicitly asserts project name is forwarded. `ensureProject` has own coverage in `taskCrudIntegration.test.js`. Low risk.

## Status: PASS

_Signed: Telly — 2026-05-31T00:00:00Z_
