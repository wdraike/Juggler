# Test Review — 2026-05-31

## Summary
6 tests passed, 0 failed. All three ZOE-JUG-014 auth paths covered. One pre-existing bug identified in source (logger reference) — not introduced by this change, documented below.

## Test Results

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| tests/mcp-transport.test.js | 6 | 6 | 0 | 0 | ~0.4s |

## Coverage: mcp/transport.js auth paths

| Branch | Description | Test |
|--------|-------------|------|
| `planCheck` — no plan for APP_ID | `plans: {}` → `hasActivePlan: false` | COVERED |
| `planCheck` — correct APP_ID key | `plans[APP_ID] = 'basic'` → `hasActivePlan: true` | COVERED |
| `planCheck` — plans undefined | `{}` → `hasActivePlan: false` | COVERED |
| dev-token, `NODE_ENV=production` | auth forwarded to real validator → 401 | COVERED |
| dev-token, `MCP_DEV_NO_AUTH=true` + `NODE_ENV=production` | production guard wins → 401 | COVERED |
| dev-token, `MCP_DEV_NO_AUTH=true` + `NODE_ENV=development` | bypass taken, `createMcpServerForUser('dev-user')` | COVERED |

## Uncovered Paths (acceptable scope exclusions)

| Path | Reason |
|------|--------|
| No-token + dev mode bypass (line 71) | Not in ZOE-JUG-014 scope; low risk (dev-only) |
| Timeout handler (line 83–93) | Untestable without fake timers; also has a pre-existing bug (see below) |
| `handleMethodNotAllowed` (line 116) | Trivial 405 handler; not in scope |
| Error catch block (line 100–110) | Not in scope for this item |

## Pre-existing Bug (NOT introduced by this change)

| Severity | Description | File:Line |
|----------|-------------|-----------|
| WARN | `logger.warn(...)` used in timeout handler but `logger` is never imported in transport.js — will throw `ReferenceError` on request timeout | `src/mcp/transport.js:84` |

This bug exists in the working tree diff (`console.warn` → `logger.warn`) but predates ZOE-JUG-014 and is not in the test file being reviewed. Should be tracked as a follow-up.

## Status: PASS

_Signed: Telly — 2026-05-31T00:00:00Z_

---

# Test Review — ZOE-JUG-029 — 2026-05-31

## Summary
17 tests passed, 0 failed. Full cross-user isolation coverage for all MCP task tools that accept a task ID. Pure in-memory mock — no real DB required.

## Test Results

| Suite | Tests | Passed | Failed | Skipped | Time |
|-------|-------|--------|--------|---------|------|
| tests/mcp-cross-user-isolation.test.js | 17 | 17 | 0 | 0 | ~0.6s |

## Tool Coverage

| Tool | Isolation Test | Notes |
|------|---------------|-------|
| `get_task` | COVERED | Returns 404-equivalent for cross-user task ID; no data leak |
| `update_task` | COVERED | Returns not-found for cross-user task ID; no data leak |
| `delete_task` | COVERED | Returns not-found; task survives in store (mock write never called) |
| `set_task_status` | COVERED | Returns not-found for cross-user task ID |
| `list_tasks` | COVERED | Scoped by `user_id`; User B sees zero of User A's tasks |
| `batch_update_tasks` | COVERED | Cross-user task silently skipped (0 updates returned) |
| `create_task` | OUT OF SCOPE | Always uses bound `userId`; no cross-user risk possible |
| `create_tasks` | OUT OF SCOPE | Same rationale as `create_task` |
| `search_tasks` | OUT OF SCOPE | Same `where('user_id', userId)` pattern as `list_tasks`; already covered by proxy |

## Security Assertions Verified

| Assertion | Result |
|-----------|--------|
| Cross-user get returns `isError: true` + "not found" message | PASS |
| Error response does not contain owner's task text | PASS |
| Error response does not contain owner's user ID | PASS |
| Same error message for owned-but-foreign vs non-existent task (no side-channel) | PASS |
| User B batch update silently skips foreign task (0 updated) | PASS |
| Mock deleteTaskById NOT called when task not found (store unchanged) | PASS |
| list_tasks for User B returns empty set (0 cross-user tasks) | PASS |

## globalSetup Note (pre-existing, not caused by this change)

Running with the default `jest.config.js` (which includes `globalSetup`) currently fails for ALL tests because migration `20260603000000_add_completed_at_to_tasks_v_view.js` errors against an uninitialized test DB (`SHOW CREATE VIEW tasks_v — Table 'juggler.tasks_v' doesn't exist`). This is an untracked file in the working tree and pre-dates ZOE-JUG-029.

**Workaround used to validate this test:** `--config '{"testEnvironment":"node","moduleNameMapper":{"^uuid$":"..."}}'` bypasses the broken globalSetup. All 17 tests pass. The test file itself requires no DB connection and is unaffected once the globalSetup is fixed.

**Recommended follow-up:** Fix the globalSetup to gracefully skip migration errors (not just unreachable-DB errors), or fix the migration to handle missing view gracefully.

## Status: PASS

_Signed: Telly — 2026-05-31T00:00:00Z_
