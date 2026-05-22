# Test Review — task-state-machine.test.js (SM-19, SM-20, SM-25 fixes)

_Date: 2026-05-21_
_Mode: Focus — changed file: `juggler-backend/tests/api/task-state-machine.test.js`_

---

## Suite Results

| Suite | Tests | Passed | Failed | Skipped |
|-------|-------|--------|--------|---------|
| tests/api/task-state-machine.test.js | 23 | 23 | 0 | 0 |
| Full suite (109 suites total) | 1450 | 1433 | 0 | 16 + 1 todo |
| Suites skipped | 3 | — | — | DB-dependent (ECONNREFUSED :3308, pre-existing) |

All 23 SM-18 through SM-25 tests pass. No regressions in any other suite. The 3 skipped suites (MCP integration, MSFT BF-2, one other DB-dependent suite) were pre-existing skips due to no test MySQL available — unrelated to this change.

---

## Fix Correctness Analysis

### SM-19: `master_id: null` on plain task (wip → done, 200 path)

Two code paths in `task.controller.js` conditionally call `db('task_masters').first()`:

**Path 1 (line 1652-1655):** Rolling-exempt check — fires when `_instanceMasterId` is truthy, status is terminal, and `scheduled_at` is null.

**Path 2 (line 1714-1717):** Rolling-anchor update — fires when `_anchorMasterId` is truthy and status is `done`, `skip`, or `missed`.

The default `makeTask` helper sets `master_id: 'task-sm'` (a truthy string). For SM-19's 200 path, the task has `scheduled_at` set, so Path 1 does not fire. But Path 2 fires unconditionally because `_anchorMasterId = existing.master_id || existing.source_id` is truthy and status is `done`. This consumes a `resolveQueue` slot before the post-update `fetchTaskWithEventIds` call, breaking the expected queue shape and causing `fetchTaskWithEventIds` to return null, producing a 500.

Setting `master_id: null` makes both `_instanceMasterId` and `_anchorMasterId` evaluate to null (since `source_id` is also null in the default shape), so neither DB call fires. Fix is correct.

---

### SM-20: `resolveQueue.splice(2, 0, null)` on recurring instance (skip)

`makeInstance` does not override `master_id`, so instances inherit `master_id: 'task-sm'` (truthy). For a skip on a scheduled instance:
- Path 1: `scheduled_at` is non-null, so this check does NOT fire.
- Path 2: `_anchorMasterId` is truthy and status is `skip` — fires, consuming one `first()` slot.

`seedExisting` places the instance at queue index 0 (first()), ledger at 1 (select()), and post-update task at 2 (first()). The rolling-anchor `first()` fires between the write and the post-update fetch, stealing index 2 before `fetchTaskWithEventIds` can use it.

`resolveQueue.splice(2, 0, null)` inserts `null` at index 2, pushing the post-update task to index 3. The rolling-anchor call at L1716-1718 receives `null`, the `_masterForAnchor && isRollingMaster(_masterForAnchor)` guard short-circuits cleanly (no anchor update fires), and the post-update fetch gets the task from index 3. Fix is correct.

---

### SM-25: `master_id: null` on terminal tasks (done→done, skip→skip)

Same mechanism as SM-19. `sm25-done` and `sm25-skip` both assert `res.status === 200`. With default `master_id: 'task-sm'`, the rolling-anchor `first()` at Path 2 fires for status `done` and `skip`, exhausts the queue, `fetchTaskWithEventIds` returns null, `rowToTask(null, …)` throws `TypeError: Cannot read properties of null (reading 'source_id')`, and the response becomes 500 — failing the `toBe(200)` assertion. Setting `master_id: null` prevents the extra `first()` call. Fix is correct.

---

## Gaps and WARNs Found

### WARN-1: `sm25-idem` (idempotent done→done) produces a hidden 500

**Test:** `idempotent done→done does not set completed_at again (already terminal)`

This test uses default `makeTask` with no `master_id: null` override. The rolling-anchor Path 2 fires (status is `done`, `_anchorMasterId` is truthy), exhausts the queue, `fetchTaskWithEventIds` returns null, and the response is 500. The test only checks `tasksWrite.updateTaskById.mock.calls[0][2]` (the fields argument) — not the HTTP status. The assertion passes against a broken response.

Evidence: `console.error('Update task status error:', TypeError: Cannot read properties of null (reading 'source_id'))` printed during the run, and `PUT /api/tasks/sm25-idem/status 500` logged.

**Fix:** Add `master_id: null` to `makeTask` for `sm25-idem` (same as `sm25-done`), then add `expect(res.status).toBe(200)`.

---

### WARN-2: `sm22-reenable` (re-enable endpoint) produces a hidden 500

**Test:** `re-enable endpoint accepts disabled task` — asserts `res.status !== 404` and `res.status !== 403` only.

The re-enable controller path at L2179 calls `fetchTaskWithEventIds` (consumes `first()` + implicit `select()`), then at L2262-2265 calls `buildSourceMap(db('tasks_v').select())` and a second `fetchTaskWithEventIds`. The queue only has two `push(task)` entries with no ledger or srcMap slots. The post-update `fetchTaskWithEventIds` returns null, `rowToTask(null)` throws, and the response is 500. The test passes because 500 satisfies `!== 404` and `!== 403`.

Evidence: `console.error('Re-enable task error:', TypeError: Cannot read properties of null (reading 'source_id'))` printed during the run, and `PUT /api/tasks/sm22-reenable/re-enable 500` logged.

**Fix:** Properly seed the queue for the re-enable path: `[task, [], [], task, []]` (initial `fetchTaskWithEventIds` needs `first()+select()`, srcMap needs one `select()`, post-update `fetchTaskWithEventIds` needs `first()+select()`), then assert `res.status === 200`.

---

## Summary

| Status | Count | Details |
|--------|-------|---------|
| PASS | 23 | All SM-18 through SM-25 tests green |
| FAIL | 0 | — |
| WARN | 2 | `sm25-idem` and `sm22-reenable` assert on non-HTTP layers; both produce 500 responses that pass due to absent or weak status assertions |
| BLOCK | 0 | — |
| Regressions | 0 | Full suite: 1433 passed, 0 new failures |

---

## Fix Verdict

The three stated fixes are mechanically correct:
- `master_id: null` on SM-19 and SM-25 (`sm25-done`, `sm25-skip`) properly prevents rolling-anchor DB calls for plain tasks by making `_anchorMasterId` evaluate to falsy.
- `resolveQueue.splice(2, 0, null)` on SM-20 correctly fills the slot consumed by the rolling-anchor check before the post-update fetch, and the null sentinel cleanly bypasses the `isRollingMaster` guard.

No regressions introduced. The fixes do not break any other test in the suite.

The two WARNs are pre-existing weaknesses exposed by the review — not introduced by these fixes. They should be addressed before or alongside the commit.

---

Overall: WARN
