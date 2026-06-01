# Zoe Review — 2026-05-31 (ZOE-JUG-011 + ZOE-JUG-024)

## Scope: mcp-create-tasks.test.js — full adversarial re-audit

## Summary

0 BLOCK findings. 1 WARN finding (`config_value` object-branch untested — low risk, confirmed same code pattern exists in prior test files with same gap). 38/38 tests pass. Handler source read line-by-line against every test. Mock chain traced through DB → controller → handler. No false passes, no shallow assertions on primary paths, no flakiness risks found. Telly's PASS verdict is upheld with one WARN backlog item.

## Telly Audit

### BLOCK Findings
None.

### WARN Findings

| # | Finding | Evidence | File | Remediation |
|---|---------|----------|------|-------------|
| W1 | `config_value` object (non-string) branch untested | `tasks.js:183`: `typeof prefs.config_value === 'string' ? JSON.parse(...) : prefs.config_value`. Mock always returns a JSON string; the object-already-deserialized branch is never exercised. Both branches produce the same `.splitDefault` access, so behavioral impact is nil in practice. | tasks.js:183 | Backlog: add one test with `config_value` as plain object `{splitDefault: true}` and assert `row.split=1`. |

### Investigated-but-not-found Issues

| # | Hypothesis | Verdict |
|---|-----------|---------|
| task_type missing in batch path vs create_task single | create_task explicitly sets `row.task_type = 'task'`; create_tasks does not. NOT a bug — `tasks` table has `DEFAULT 'task'` on the `task_type` column (migration 20260310000000). DB fills it. Test omission of task_type assertion is correct. | CLEAR |
| user_id missing in non-locked rows | `taskToRow` always starts with `var row = { user_id: userId }` (controller:498). user_id is present in all rows without handler-level set. Non-locked path test doesn't assert it — not needed since taskToRow guarantees it. | CLEAR |
| `prefs row absent` test call-counter fragility | Counter assumes call 1=users, call 2=user_config. Handler query order is deterministic (`getUserTimezone()` first, `user_config` second). If handler reorders, test silently passes wrong branch. This is a structural brittleness but not a current failure risk since the query order is stable. | WARN-adjacent, not blocking — documented. |
| Zod schema bypassed by fakeServer | Confirmed: `fakeServer.tool(name, _d, _s, h)` discards schema (`_s`). Zod validation does not run in tests. Bogus-mode rejection works because `validateTaskInput` has its own enum check. This is correct architecture — Zod is integration-level; `validateTaskInput` is the unit-testable gate. | CLEAR |
| Mock DB `_table`/`_where` shared IIFE state — concurrent test risk | `maxWorkers:1` in jest.config.js ensures sequential execution. No race condition possible. | CLEAR |
| `scheduled_at` assertion shallow (`not.toBeNull`) | Weak-looking but correct: `localToUtc('6/15','2:00 PM','America/New_York')` returns a real Date object. The assertion confirms taskToRow's date+time → scheduled_at conversion ran without returning null. Exact value would require date arithmetic and adds no safety margin for a unit test. | CLEAR |
| `ensureProject` write path never exercised | Confirmed: no test provides `project` field. `ensureProject` mock chain would work (projects table returns `[]` → first() is null → insert called). Not tested here — covered by integration tests. INFO only. | CLEAR |
| `time_blocks` placement mode not tested for acceptance | Valid PLACEMENT_MODES value. Not tested as an acceptance case. It follows the same code path as `time_window` (no special handler logic). Low value to add. | INFO only |

### PASS Verifications

| # | Check | Status |
|---|-------|--------|
| 1 | All handler branches (pre-flight loop, prefs/splitDefault, row mapping, locked path, transaction, response) have at least one test | PASS |
| 2 | Every validation error type (isError:true) tested alongside success path | PASS |
| 3 | `mockInsertCalls.length === 0` asserted on every validation-failure test — no writes before validation complete | PASS |
| 4 | Split default assertions are exact integers (1 or 0), not truthy/falsy | PASS |
| 5 | `placement_mode === 'all_day'` uses exact `.toBe('all_day')` — no vague "not undefined" | PASS (line 207) |
| 6 | Backstop-suppression assertions use `toBeUndefined()` — stronger than `not.toBe('all_day')` | PASS — lines 198, 217, 227 |
| 7 | Locked path: queued:true, insertTask NOT called (length=0), enqueueWrite N times, op+src exact | PASS |
| 8 | `resetCaptures()` in global `beforeEach` clears all cross-test state | PASS |
| 9 | `mockIsLockedValue` isolated via describe-level `beforeEach`/`afterEach` | PASS |
| 10 | `enqueueScheduleRun` cleared with `mockClear()` before each call-count assertion | PASS |
| 11 | Explicit ID round-trip verified | PASS |
| 12 | Empty array edge case covered — no writes, created:0 | PASS |
| 13 | Mixed-mode batch verifies per-item placement_mode by array index | PASS |
| 14 | `prefs=null` path: `splitDefault=false → row.split=0` tested with monkey-patched `mockDb.first` and `finally` restore | PASS |
| 15 | Describe block naming accurately reflects pre-flight validation semantics (not rollback) | PASS |
| 16 | `tasks.js:183` config_value parse: string-branch always used (mock returns string) — split value extracted correctly | PASS (string branch only) |

## Bird Audit
Not applicable — no frontend files changed.

## Status: ISSUES

_Signed: Zoe — 2026-05-31T23:00:00Z_

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

---

# Zoe Review — 2026-05-31 (ZOE-JUG-011)

## Scope: taskCrudIntegration2.test.js — redis.invalidateTasks assertion audit

## Summary

0 BLOCK findings. 1 WARN finding (first toggle-off test inconsistency). 6 assertions added correctly. Mock wiring verified against controller import. No false passes, no shallow assertions. Telly's PASS verdict upheld.

## Telly Audit

### BLOCK Findings
None.

### WARN Findings

| # | Finding | Evidence | File | Remediation |
|---|---------|----------|------|-------------|
| W1 | First toggle-off test (`converts recurring to one-off`) uses `.toHaveBeenCalled()` without USER_ID arg check, while all 3 newly added sibling tests use `.toHaveBeenCalledWith(USER_ID)`. Pre-existing inconsistency — not introduced by this diff. | `taskCrudIntegration2.test.js:644` | `taskCrudIntegration2.test.js` | Strengthen to `.toHaveBeenCalledWith(USER_ID)` for consistency with siblings (backlog) |

### Adversarial Checks

| # | Hypothesis | Verdict |
|---|-----------|---------|
| Mock wiring: `redis` mock at test file top matches controller import `require('../lib/redis')` | Controller: `const cache = require('../lib/redis')` (line 18). Test file mocks `'../src/lib/redis'`. Both resolve to same module path. Mock intercepts correctly. | CLEAR |
| `jest.clearAllMocks()` in `beforeEach` resets `invalidateTasks` call count before each test | Confirmed line 68. No cross-test call count bleed. | CLEAR |
| `cache.invalidateTasks` at controller line 1334 is unconditional after transaction succeeds | Code reads: transaction closes, then `await cache.invalidateTasks(req.user.id)` with no conditional guard. Called for every successful `recurring=false` update. | CLEAR |
| Tests assert `statusCode 200` before asserting `invalidateTasks` — confirms error path not taken | `expect(res.statusCode).toBe(200)` fires before cache assertion. If controller threw and hit the catch block (line 1341), statusCode would be 500, and the test would fail there first. | CLEAR |
| xdescribe assertions — could they mask a defect by never running? | Yes by definition. `xdescribe` skips all tests. These assertions add future-proofing only (parity with existing `unpin-reg`/`unpin-tw`/`unpin-tb` siblings). The item explicitly targets this gap. Not a defect. | ACCEPTED by design |
| Pre-existing `row.prev_when` assertion in xdescribe — column dropped by migration 20260526 | `unpin-at` test at line 412: `expect(row.prev_when).toBeNull()`. If xdescribe were ever re-enabled, this would fail (column doesn't exist → `row.prev_when === undefined`). Pre-existing defect in the xdescribe block, not introduced by this diff. | INFO (pre-existing) |
| False-positive risk: controller calls `invalidateTasks` defensively even on partial failure | Examined catch block (line 1341): throws result in `res.status(500).json(...)`. The cache call at line 1334 is POST-transaction. A throw before line 1334 results in 500 status. Tests assert 200, so cache call must have happened. No false-positive path. | CLEAR |

### PASS Verifications

| # | Check | Status |
|---|-------|--------|
| 1 | All 3 JSON-restore unpin tests (`unpin-at`, `unpin-inv`, `unpin-no-mode`) now have `redis.invalidateTasks` assertion matching the 3 existing siblings | PASS |
| 2 | All 4 toggle-off cleanup tests now have cache invalidation assertions (3 use `.toHaveBeenCalledWith(USER_ID)`, 1 pre-existing uses `.toHaveBeenCalled()`) | PASS |
| 3 | Assertion form `.toHaveBeenCalledWith(USER_ID)` is stronger than `.toHaveBeenCalled()` — catches wrong-user regression | PASS |
| 4 | No production code modified | PASS |
| 5 | No test structure changed — only assertions appended to existing tests | PASS |

## Bird Audit
Not applicable — no frontend files changed.

## Status: ISSUES

_Signed: Zoe — 2026-05-31T23:30:00Z_
