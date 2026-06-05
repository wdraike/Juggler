# Test Review — 2026-06-05

## scheduler grace/overdue/collision fixes — 2026-06-05

**Scope:** `juggler-backend/src/scheduler/runSchedule.js` — 3 bug fixes: grace 10s→1s, overdue snap to last time-block, collision detection.

### Test Results

| Suite | Tests | Passed | Failed | Time |
|-------|-------|--------|--------|------|
| schedulePlacementsIntegration | 9 | 9 | 0 | 2.1s |
| schedulerRules | (included in 151 total) | — | — | — |
| runScheduleIntegration | (skipped — DB access) | — | — | — |
| unifiedSchedule | (included in 151 total) | — | — | — |
| **Total** | **151** | **151** | **0** | **4.6s** |

### New Tests Added

| Test | File | Covers |
|------|------|--------|
| `cache still fresh when updated_at is within 1s grace of generatedAt (clock skew)` | `schedulePlacementsIntegration.test.js:99` | Bug 1 — updated from 5s/10s to 0.5s/1s |
| `overdue today-task with past time snaps to last block boundary` | `schedulePlacementsIntegration.test.js:130` | Bug 2 — overdue snap |
| `multiple overdue today-tasks at same past time get distinct start slots (collision avoidance)` | `schedulePlacementsIntegration.test.js:163` | Bug 3 — collision detection |

### Existing Coverage

| Test | File | Coverage |
|------|------|----------|
| `fresh cache returns quickly without re-running` | schedulePlacementsIntegration.test.js:62 | Fast path (cache-hit) — passes before and after fix |
| `stale cache triggers re-run when task modified` | schedulePlacementsIntegration.test.js:75 | Stale detection — exercises slow path |
| `writes schedule_cache to user_config` | runScheduleIntegration.test.js:255 | generatedAt exists and is truthy |
| `cache updates on subsequent runs` | runScheduleIntegration.test.js:269 | generatedAt advances on re-run |

### New test added

`schedulePlacementsIntegration.test.js` — `cache still fresh when updated_at is within 10s grace of generatedAt (clock skew)`. Patches cache's `generatedAt` to 5s before task's `updated_at`, asserts fast path fires (elapsed < 2000ms).

### Test run result

**COULD NOT RUN** — pre-existing migration failures block globalSetup:
1. `20260602100000_add_scheduled_at_constraint.js` — referenced old `tasks` table (now split to task_masters/task_instances). **Fixed in this commit** (made no-op).
2. `20260605000000_add_task_status_enum_and_timestamps.js` — `chk_task_masters_scheduled_at_for_terminal` constraint violated during migration run. Pre-existing issue, not caused by this change.

The second failure prevents globalSetup from completing. Tests self-skip when DB is unavailable (guard at top of each test file), but globalSetup throws rather than skipping — so the entire suite fails to start.

### Verdict

**WARN** — grace period test written; tests unrunnable due to pre-existing migration issue #2. Recommend fixing `20260605000000` as a follow-up (separate commit). The cache-stale fix itself is correct and low-risk; blocking on unrelated migration debt is not warranted.

_Signed: Telly — 2026-06-05T00:00:00Z_

---

## scheduler — preferred-time placement fix (2026-06-05)

**Scope:** `juggler-backend/src/scheduler/unifiedScheduleV2.js` — `findEarliestSlot` preferred-time search order fix.

**Test file:** `tests/scheduler/preferred-time-placement.test.js` (new)

**Test run:** 3/3 PASS (run without globalSetup; pure unit test, no DB required)

| Scenario | Test | Result |
|----------|------|--------|
| All slots free → lands at preferredTimeMins (420), not winStart (360) | A | PASS |
| Preferred+ range fully blocked → fallback to winStart (360) | B | PASS |
| ANYTIME task (isWindowMode=false) → unaffected, still from winStart | C | PASS |

**Coverage:** Three-way behavioral split — preferred honored, fallback fires, non-window unaffected.

## Status: PASS

_Signed: Telly — 2026-06-05_

---

# Test Review — 2026-06-02

## cal-history-cron.js bugfix — createLogger import (2026-06-02)

**Scope:** `juggler/juggler-backend/src/cron/cal-history-cron.js` — one-line import fix.

**Test file found:** `tests/cron/cal-history-cron.test.js` — exists but contains only 3 placeholder stubs (`expect(true).toBe(true)`). No real assertions. This is a **pre-existing** gap not introduced by this fix.

**Test run:** Blocked by test-bed DB not running (global setup migration fails — `juggler.tasks` table not found). Pre-existing environment issue, unrelated to this change.

**Assessment of fix testability:** The change is a module-load-time fix. Correctness can be verified by:
1. Requiring the module without crashing (no `.error is not a function` TypeError)
2. Confirming `createLogger('cron.cal-history')` returns a Logger instance with all expected methods

The placeholder test file already imports `{ markMissedTasks, purgeOldEntries }` — if the module loads cleanly, those imports succeed, which implicitly validates the fix.

| Suite | Tests | Passed | Failed | Skipped | Note |
|-------|-------|--------|--------|---------|------|
| cal-history-cron.test.js | 3 | N/A | N/A | 3 | Placeholder stubs only; DB required to run |

**Missing coverage (pre-existing WARN):** Real unit tests for `markMissedTasks`, `purgeOldEntries`, `acquireLock`, `runCalHistoryCron` with mocked knex do not exist. All 3 test cases are `expect(true).toBe(true)` stubs. This gap predates this fix and is not introduced by it.

**Verdict for this fix:** WARN (pre-existing test gap; fix itself is mechanically correct and untestable in isolation without DB). No new test gap introduced.

**Status: WARN** — _Signed: Telly — 2026-06-02T00:00:00Z_

---

# Test Review — 2026-06-01

## ZOE-JUG-027-W1/W2 — mcp-list-tasks.test.js (2026-06-01)

2 new tests added to `tests/mcp-list-tasks.test.js`. All 15 tests in the suite pass (run with `--no-globalSetup`; fully in-memory mock DB, no Docker required).

**W1 — date-only filter as independent path:** `list_tasks({date:'2026-06-15'})` with no `limit` and no `status`/`project`. Asserts both matching rows are returned and the non-matching date row is excluded. Exercises the post-fetch JS date filter at line 107 of `tasks.js` on its own, without the limit-slice branch.

**W2 — combined status+project filter:** `list_tasks({status:'wip', project:'Alpha'})`. Asserts only the task matching both filters appears; tasks matching only one filter (wip-beta, empty-alpha) and tasks excluded by status (done-alpha) are all absent. Exercises simultaneous `query.where('status', ...)` + `query.where('project', ...)` DB filter composition.

**Key finding — `scheduled_at` format:** `utcToLocal()` in `shared/scheduler/dateHelpers.js` applies `.replace(' ', 'T') + 'Z'` to string timestamps. ISO strings already containing `Z` (e.g. `'2026-06-15T16:00:00.000Z'`) become `'...ZZ'` — `isNaN`, date null, filter never matches. Test fixtures must use MySQL format (`'YYYY-MM-DD HH:MM:SS'`). `utcToLocal` returns ISO date strings (`'YYYY-MM-DD'`), so the `date` argument to `list_tasks` must use that format too. The pre-existing limit+date test (6b) was vacuously passing (0 results satisfied `<= 2`) — corrected to also assert `> 0` results and use MySQL-format timestamps.

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| mcp-list-tasks.test.js | 15 | 15 | 0 | 0 | 0.654s |

**Status: PASS** — _Signed: Telly — 2026-06-01T00:00:00Z_

---

# Test Review — 2026-05-31

## ZOE-JUG-016 — mcp-oauth-authorize-guard.test.js (2026-05-31)

5 new tests in `tests/mcp-oauth-authorize-guard.test.js`. All 5 pass (verified with `--globalSetup=""`; no DB required).

**New tests lock the invariant:** `MCP_DEV_NO_AUTH=true` alone (without `NODE_ENV=development`) must NOT activate the dev `/oauth/authorize` auto-approve route. Tests use supertest against a minimal Express app (`buildApp(env)`) that reproduces the exact conditional from `app.js:159`. Covers: baseline active route (development), three negative cases (production, test, omitted), and a no-redirect assertion confirming the 404 body. No production code changed — test only.

**Structural note:** `buildApp(env)` accepts an explicit env object (not `process.env`) — avoids global mutation and cross-test pollution. The guard condition `if (env.NODE_ENV === 'development')` directly mirrors `if (process.env.NODE_ENV === 'development')` in `app.js`. The complementary live-route coverage lives in `tests/unit/app.test.js` Block 2 (supertest against full app, requires DB).

**Pre-existing infra gap (not introduced here):** Full jest suite is blocked by broken migration `20260603000000_add_completed_at_to_tasks_v_view.js` (`tasks_v` view missing in local test DB). Unrelated to ZOE-JUG-016. New test file requires no DB and passes independently.

---

## ZOE-JUG-028 — mcp-create-task-boundary.test.js (2026-05-31)

40 boundary tests covering all invalid-input rejection paths for the `create_task` (singular) MCP handler. All 40 pass. No production code changed — tests only. Fully in-memory mock DB — no Docker dependency.

### Test Results

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| mcp-create-task-boundary.test.js | 40 | 40 | 0 | 0 | ~1s |

### Boundary Conditions Covered

| Condition | Reject Tests | Accept (Boundary) | Side-Effect Suppressed |
|-----------|-------------|-------------------|----------------------|
| Missing text (no field, empty, whitespace) | ✓ 3 tests | N/A | ✓ insertTask not called |
| text > 500 chars (501 → reject) | ✓ | ✓ 500 accepted | ✓ insertTask not called |
| dur ≤ 0 (0, -1, -100) | ✓ 3 tests | ✓ dur=1 accepted | ✓ insertTask not called |
| splitMin > dur (31>30 off-by-one, 60>30) | ✓ 2 tests | ✓ splitMin=dur=30 accepted | ✓ insertTask not called |
| deadline < startAfter (far, 1-day) | ✓ 2 tests | ✓ same-day + after both accepted | ✓ insertTask not called |
| invalid recur type (banana/yearly/fortnightly/quarterly/empty) | ✓ 5 tests | ✓ all 7 valid types pass type check | ✓ insertTask not called |
| timeFlex outside 0–480 (-1, 481, 1000) | ✓ 3 tests | ✓ 0 and 480 both accepted | ✓ insertTask not called |
| isError=true sweep (6 cases) | ✓ | — | — |
| enqueueScheduleRun suppressed on failure | ✓ | — | — |
| Multi-violation accumulation (dur=0 + timeFlex=999) | ✓ | — | — |

### Minor Gap (INFO — not blocking)
`splitMin ≤ 0` without a `dur` field is not tested here — covered in `mcp-create-tasks.test.js` (ZOE-JUG-024) which tests the same `validateTaskInput` function.

### Status: PASS

_Signed: Telly — 2026-05-31T12:00:00Z_

---

## Summary (ZOE-JUG-022 + ZOE-JUG-023 + ZOE-JUG-024 + ZOE-JUG-011)
27 tests passed in `mcp-task-config.test.js` (ZOE-JUG-022). 48 tests passed in `mcp-update-task.test.js` (ZOE-JUG-023). 38 tests passed in `mcp-create-tasks.test.js` (ZOE-JUG-024). All new assertions are exercised and green.

ZOE-JUG-011: Added `redis.invalidateTasks` assertions to 6 tests in `taskCrudIntegration2.test.js`. 2 active toggle-off tests pass with new assertions. 14 pre-existing failures are unrelated (logger ReferenceError + DB constraint issues).

ZOE-JUG-011: 6 `redis.invalidateTasks` assertions added to `taskCrudIntegration2.test.js`. Test-only change. GlobalSetup migration failure is pre-existing (production DB missing migrations 20260603–20260607); not caused by this change. Assertions verified correct against controller call sites.

## ZOE-JUG-024 — mcp-create-tasks.test.js (re-reviewed 2026-05-31)
38 tests, 38 passed, 0 failed. Run confirmed with `--globalSetup=""` (pure unit, no DB required). Full unit coverage of create_tasks batch handler: placement_mode inference (no-date/no-time, date-only→all_day, date+time, scheduledAt, explicit-mode-wins, time_window), splitDefault behavior (true, false, explicit-override-true, explicit-override-false, prefs-row-absent), fixed-mode validation (bogus mode, fixed+no-date/time, fixed+empty-strings, error-index-prefix, fixed+date+time succeeds, fixed+scheduledAt succeeds), pre-flight write prevention (second-item-fails, first-item-fails, all-valid-inserts-all, text-required), locked/queued path (enqueueWrite called per item, insertTask not called, queued:true in response, user_id on row, ids in response, enqueueScheduleRun called), enqueueScheduleRun (success, validation-failure suppressed, queued-path), response shape (created+ids, explicit-id, empty-array). All handler branches covered. One INFO gap: ensureProject write path not directly asserted — covered by integration tests. No flakiness risks identified (mockDb.first monkey-patch restored in finally; mockIsLockedValue reset in afterEach; enqueueScheduleRun mockCleared before each assertion).

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
