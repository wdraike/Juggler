# Zoe Review — 2026-05-31 (ZOE-JUG-024 addendum)

## Scope: mcp-create-tasks.test.js audit

## Summary
0 BLOCK findings. 2 WARN findings (shallow negative assertions, describe-block naming inaccuracy). 37/37 tests pass. Mock structure verified against handler source. All pre-flight validation, split default, placement_mode inference, locked path, and response shape branches are adequately covered.

## Telly Audit

### BLOCK Findings
None.

### WARN Findings

| # | Finding | Evidence | File | Remediation |
|---|---------|----------|------|-------------|
| W1 | Three `not.toBe('all_day')` assertions are weaker than necessary — they don't assert the exact expected value | Tests: "no date no time", "date AND time", "scheduledAt" — all assert `placement_mode` is not `all_day` but don't assert `toBeUndefined()`. A regression where `placement_mode` is wrongly set to `anytime` would pass these. | mcp-create-tasks.test.js:198,217,226 | Strengthen to `expect(row.placement_mode).toBeUndefined()` for the no-placementMode-provided cases |
| W2 | Describe block "transaction rollback on partial failure" tests pre-flight validation, not mid-transaction rollback | The mock `db.transaction` always resolves without rollback. Tests correctly verify that validation rejects before writes — but the block title implies rollback testing, which is not what runs. If `insertTask` throws mid-batch, the mock won't roll back and these tests won't catch it. Integration test coverage of mid-transaction error is out of scope for unit tests but the naming is misleading. | mcp-create-tasks.test.js:444 | Rename describe block to "pre-flight validation prevents any writes on batch error" |
| W3 | `prefs = null` branch (missing user_config row) untested | Line 183: `var splitDefault = prefs ? ... : false`. If `user_config` row is absent, `prefs` is `null` and `splitDefault` defaults to `false`. No test covers this. Behavioral gap is low-risk (same result as `mockSplitDefault=false`) but the null-guard branch is unexercised. | tasks.js:183 | Add test: configure mock to return `null` for user_config, verify `row.split=0` |

### PASS Verifications

| # | Check | Status |
|---|-------|--------|
| 1 | All handler branches (validation loop, row mapping, locked path, transaction path, response) have at least one test | PASS |
| 2 | Error paths (isError:true) tested alongside success paths for every validation rule | PASS |
| 3 | `mockInsertCalls.length === 0` assertion present on all validation-failure tests — confirms no writes before complete validation | PASS |
| 4 | Split default tests assert exact values (1 or 0), not just truthiness | PASS |
| 5 | `placement_mode === 'all_day'` positive assertion is exact, not just truthiness | PASS (test at line 207) |
| 6 | Locked path asserts: queued=true in response, insertTask NOT called (length=0), enqueueWrite called N times, correct op+src | PASS — 4 separate assertions across 4 tests |
| 7 | `resetCaptures()` in global `beforeEach` prevents cross-test state pollution | PASS |
| 8 | `mockIsLockedValue` isolated via `beforeEach`/`afterEach` in locked describe block | PASS |
| 9 | `enqueueScheduleRun` mock cleared with `mockClear()` before each call-count assertion | PASS |
| 10 | Explicit ID preservation verified (item with pre-set id → that id in response ids) | PASS |
| 11 | Empty array edge case covered — `created:0`, `length===0` for ids, no writes | PASS |
| 12 | Mixed-mode batch asserts per-item placement_mode by index, not just the response count | PASS |

## Bird Audit
Not applicable — no frontend files changed.

## Status: ISSUES

_Signed: Zoe — 2026-05-31T00:00:00Z_

---

# Zoe Review — 2026-05-31 (ZOE-JUG-023 addendum)

## Scope: mcp-update-task.test.js audit

## Summary
0 BLOCK findings. 3 WARN findings (untested branches, not assertion-quality issues). 48/48 tests pass. Mock structure verified against source. Core happy paths, error paths, and guard paths are all adequately covered.

## Telly Audit

### BLOCK Findings
None.

### WARN Findings

| # | Finding | Evidence | File | Remediation |
|---|---------|----------|------|-------------|
| W1 | `recurring_template` direct edit — `depends_on` strip not tested | Handler line 279: `if (existing.task_type === 'recurring_template') delete row.depends_on`. Tests in §5 only cover `recurring_instance`; no test sends `dependsOn` to a `recurring_template` task and asserts it is stripped. | tasks.js:279 / mcp-update-task.test.js §5 | Add test: set `task_type:'recurring_template'`, send `dependsOn:['x']`, assert `row.depends_on` absent |
| W2 | Locked path — `updateTaskById` not-called assertion missing for pure-scheduling update | When `nonSchedulingFields` is empty (e.g. only `placement_mode` sent while locked), `updateTaskById` is skipped. Tests assert `enqueueWrite` is called but do not assert `updateTaskById` was NOT called. | tasks.js:303-308 / mcp-update-task.test.js §7 | Add `expect(mockWriteCalls.find(...)).toBeUndefined()` for pure-scheduling locked update |
| W3 | `_allowUnfix` opt-in path untested | `fields._allowUnfix` (line 290) bypasses `guardFixedCalendarWhen`. No test exercises this code path. | tasks.js:290 | Add test: set `gcal_event_id`, send `when:'morning'` + `_allowUnfix:true`, assert update proceeds without guard stripping |

### PASS Verifications

| # | Check | Status |
|---|-------|--------|
| 1 | All 9 handler code sections have at least one test | PASS |
| 2 | Error paths (isError:true) tested alongside success paths | PASS — 24 error/success assertions |
| 3 | `toBeDefined()` assertions all followed by value assertions | PASS — e.g. line 493 followed by 494 checking `.row.text` |
| 4 | Mock `splitFields` faithfully mirrors production `NON_SCHEDULING_FIELDS` set | PASS — inline copy matches production at task-write-queue.js:54-58 |
| 5 | `mockIsLockedValue` isolation via `beforeEach`/`afterEach` in locked suite | PASS — prevents state leak between locked and unlocked tests |
| 6 | `resetStore()` + `resetCaptures()` in global `beforeEach` prevents cross-test pollution | PASS |
| 7 | Recurring instance template routing: text→template, status→instance | PASS — both branches explicitly asserted |
| 8 | `enqueueScheduleRun` called/not-called assertions use `mockClear()` before each | PASS — correct isolation |
| 9 | Zod validation layer gap documented in test file with explanation | PASS — section 8 comment is accurate and complete |

## Prior ZOE-REVIEW.md entry (2026-05-31 earlier)

1 WARN finding (source-level code hygiene in `set_task_status`, not a test gap). No BLOCK findings. Test assertions are strong and correctly model production isolation behavior. Mock fidelity verified against source.

## Telly Audit

### BLOCK Findings
_None._

### WARN Findings

| # | Finding | Evidence | File | Remediation |
|---|---------|----------|------|-------------|
| W-1 | `set_task_status` post-update read-back (line 386) uses `where('id', id)` with no `user_id` filter. Safe in practice (ownership guard at line 360 already cleared), but inconsistent with all other handlers and violates defence-in-depth. This is a source code issue, not a test gap. | `src/mcp/tools/tasks.js:386` | `juggler-backend/src/mcp/tools/tasks.js` | Add `.where({ id, user_id: userId })` to the post-update fetch in `set_task_status` |

### PASS Verifications

| # | Check | Status |
|---|-------|--------|
| 1 | `get_task` — mock correctly uses `where('user_id', userId)` (all-user fetch then in-memory `.find()`) matching production behavior at line 463 | PASS |
| 2 | `update_task` — mock `.where({ id, user_id })` accurately models production ownership check at line 241 | PASS |
| 3 | `delete_task` — ownership guard fires before any write; "store unchanged" test validates early-return path | PASS |
| 4 | `set_task_status` — ownership guard at line 360 correctly modeled; block triggers before `updateTaskById` mock | PASS |
| 5 | `list_tasks` — scoped via `where('user_id', userId)` in both source and mock; USER_B returns empty set | PASS |
| 6 | `batch_update_tasks` — `where('user_id', userId).whereIn('id', ...)` pre-load correctly returns empty for USER_B | PASS |
| 7 | No shallow assertions — all cross-user tests assert both `isError: true` AND message content | PASS |
| 8 | Data-leak assertions present — error responses verified to not contain owner's task text or user ID | PASS |
| 9 | Side-channel test present — ghost task and foreign-owned task produce identical error messages | PASS |
| 10 | `delete_task` store-unchanged test correctly scoped — it validates the handler's early-return, not the mock's write behavior | PASS |
| 11 | `captureHandlers(userId)` correctly re-registers tools for each user — no cross-contamination between USER_A and USER_B handler closures | PASS |
| 12 | `beforeEach(resetStore)` — taskStore is fresh before every test; no state bleed between tests | PASS |

## Tool Scope Assessment

| Tool | Isolation Risk | Covered | Justification |
|------|---------------|---------|---------------|
| `get_task` | HIGH — direct ID lookup | YES | Primary attack vector; tested |
| `update_task` | HIGH — ID + field mutation | YES | Tested |
| `delete_task` | HIGH — destructive by ID | YES | Tested |
| `set_task_status` | HIGH — status mutation | YES | Tested |
| `list_tasks` | MEDIUM — user-scoped scan | YES | Tested |
| `batch_update_tasks` | HIGH — multiple ID mutations | YES | Tested |
| `create_task` | NONE — bound `userId`, no ID input | OUT OF SCOPE | No cross-user risk possible |
| `create_tasks` | NONE — bound `userId`, no ID input | OUT OF SCOPE | No cross-user risk possible |
| `search_tasks` | MEDIUM — same pattern as `list_tasks` | OUT OF SCOPE (by proxy) | Identical `where('user_id', userId)` scoping as `list_tasks`; covered by proxy |

## Bird Audit
Not applicable — no frontend files changed.

## Status: ISSUES

_Signed: Zoe — 2026-05-31T00:00:00Z_
