# Test Catalog — 999.895 — bugfix

_Last updated: 2026-06-26 (R4b added per zoe fix-loop) — mode: bugfix_

## Integration Tests (DB-backed)

| Test | File:Line | Requirement | Pre-fix Result | Post-fix Expected |
|------|-----------|-------------|----------------|-------------------|
| R1a isError: set_task_status done on unscheduled | tests/mcp-terminal-schedule-guard.test.js:116 | BUG 999.895 — guard missing | FAIL (RED) | PASS |
| R1a DB: status unchanged after rejected done | tests/mcp-terminal-schedule-guard.test.js:124 | BUG 999.895 | PASS | PASS |
| R1b isError: set_task_status skip on unscheduled | tests/mcp-terminal-schedule-guard.test.js:131 | BUG 999.895 | FAIL (RED) | PASS |
| R1b DB: status unchanged after rejected skip | tests/mcp-terminal-schedule-guard.test.js:139 | BUG 999.895 | PASS | PASS |
| R1c isError: set_task_status cancel on unscheduled | tests/mcp-terminal-schedule-guard.test.js:145 | BUG 999.895 | FAIL (RED) | PASS |
| R1c DB: status unchanged after rejected cancel | tests/mcp-terminal-schedule-guard.test.js:153 | BUG 999.895 | PASS | PASS |
| R2: set_task_status done on scheduled → success | tests/mcp-terminal-schedule-guard.test.js:170 | No over-fire guard | PASS | PASS |
| R3a: set_task_status wip on unscheduled → success | tests/mcp-terminal-schedule-guard.test.js:184 | Non-terminal not blocked | PASS | PASS |
| R3b: set_task_status '' on unscheduled → success | tests/mcp-terminal-schedule-guard.test.js:194 | Non-terminal not blocked | PASS | PASS |
| R4: set_task_status done on SCHEDULED rolling instance → success | tests/mcp-terminal-schedule-guard.test.js:218 | No over-block: scheduled rolling must succeed; but this test exercises the `willBeScheduled=true` early-return in terminalScheduleBlock — it does NOT reach the masterId→isRollingMaster branch | PASS | PASS |
| **R4b: set_task_status done on UNSCHEDULED rolling instance → app guard must not fire** | tests/mcp-terminal-schedule-guard.test.js:~335 | **Rolling exemption — masterId→isRollingMaster branch (tasks.js:79-82). zoe mutation-proved R4 was a false-green for this branch. R4b is the real pin.** | PASS (exemption fires; DB constraint rejects with non-app-guard error) | PASS |
| R5a isError: update_task done, no date on unscheduled | tests/mcp-terminal-schedule-guard.test.js:~390 | BUG 999.895 — update_task guard missing | FAIL (RED) | PASS |
| R5a DB: status unchanged after rejected update_task | tests/mcp-terminal-schedule-guard.test.js:~399 | BUG 999.895 | PASS | PASS |
| R5b: update_task done + date in same call → success | tests/mcp-terminal-schedule-guard.test.js:~407 | Scheduling-in-call exemption | PASS | PASS |

**Total: 14 tests (R4b added). 4 RED (pre-fix). 10 GREEN (pre-fix).**

### R4 vs R4b — why both are needed

- **R4** seeds a SCHEDULED rolling instance (`scheduled_at = '2026-07-01 15:00:00'`). `terminalScheduleBlock` returns null at `if (willBeScheduled) return null;` — BEFORE reaching the `masterId → isRollingMaster` check. zoe deleted the entire exemption block and R4 still passed. R4 protects "scheduled rolling must succeed" but does NOT protect the exemption branch.
- **R4b** seeds an UNSCHEDULED rolling instance (`scheduled_at = null`). `willBeScheduled = false` → guard continues → reaches `masterId = ROLLING_MASTER_ID` → `isRollingMaster = true` → returns null (exempt). The DB CHECK constraint then fires (terminal + null scheduled_at). The test asserts the result/error does NOT contain "without a scheduled time" (the app-guard phrase). Under neutered exemption R4b turns RED (app guard fires → phrase appears). This is the real pin for the exemption branch.

## Run Command

```bash
cd /Users/david/Documents/Software Dev/raike-and-sons/.worktrees/juggler-sweep/juggler-backend
export DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_sweep_test NODE_ENV=test
npx jest tests/mcp-terminal-schedule-guard.test.js --runInBand --forceExit
```

## Pre-fix Run Output (confirmed RED)

```
Tests:       4 failed, 9 passed, 13 total
```

RED tests and failure mode on current code:
- **R1a, R1b, R1c** (set_task_status isError assertions): Handler throws raw MySQL error
  (`Check constraint 'chk_task_instances_terminal_scheduled' is violated`) rather than returning
  `{isError:true}`. The `expect(result.isError).toBe(true)` assertion never runs — the test
  fails with the propagated DB error.
- **R5a** (update_task isError assertion): Same — handler throws DB constraint error rather
  than returning isError:true.

GREEN tests on current code:
- **R1 DB checks** (3): DB constraint prevented the write; status is unchanged → assertions pass.
- **R2**: Scheduled task; no guard needed; succeeds → PASS.
- **R3a/R3b**: Non-terminal status; no guard fires; succeeds → PASS.
- **R4**: Scheduled rolling instance; no guard fires; succeeds → PASS.
- **R5a DB**: DB constraint prevented the write; status unchanged → PASS.
- **R5b**: date provided in same call; update includes scheduled_at; succeeds → PASS.

## Infrastructure Fix Applied

`tests/helpers/mcp.js:22` — Corrected broken require path:
- Before: `require('../src/mcp/tools/tasks')` — resolves to `tests/src/...` (non-existent)
- After: `require('../../src/mcp/tools/tasks')` — resolves correctly from `tests/helpers/`
- Evidence of pre-existing breakage: `tests/scheduler/fixedRecurringGap.test.js:22` comment
  explicitly documented this issue and used `../../src/...` directly to work around it.

## DB Constraint Discovery (for bert's fix)

The DB-level `chk_task_instances_terminal_scheduled` constraint independently enforces:
```sql
(status NOT IN ('done','skip','cancel','missed') OR scheduled_at IS NOT NULL)
```
This means:
1. The app-level guard (to be added by bert) must fire **BEFORE** the DB write, so the error
   is returned as a friendly `isError:true` message rather than a raw MySQL throw.
2. Rolling instances: the DB constraint also applies to them. `set_task_status` handler
   currently has rolling-anchor update logic but no guard. The fix must add the guard,
   exempt rolling instances from the APP-level guard (same as HTTP path), AND ensure rolling
   instances with `scheduled_at` set continue to succeed.

## Branch / Guard Enumeration (Step 6b completeness floor)

Changed-region conditionals to cover in the fix (for bert + telly --re-review):

| Guard/Branch | Required test | Status |
|---|---|---|
| `status IN terminal AND scheduled_at IS NULL AND !body.date AND !body.scheduledAt` (non-rolling) | R1a/R1b/R1c isError | Authored (RED now) |
| `status IN terminal AND scheduled_at IS NOT NULL` (`willBeScheduled=true` early-return) | R2 | Authored (GREEN) |
| `status NOT IN terminal` | R3a/R3b | Authored (GREEN) |
| Rolling exemption early-return (`willBeScheduled=true` — SCHEDULED rolling) | R4 | Authored (GREEN); NOTE: does NOT reach masterId→isRollingMaster branch (zoe false-green catch) |
| **Rolling exemption branch (`masterId → isRollingMaster`) — UNSCHEDULED rolling** | **R4b** | **Authored (GREEN); mutation-verified RED under neutered exemption** |
| `update_task + status terminal + no date/scheduledAt in call` | R5a | Authored (RED now) |
| `update_task + status terminal + date in same call` | R5b | Authored (GREEN) |

## Mutation: not-wired (Stryker); per-pin manual verification

Stryker not wired in this service. Per-pin self-mutation performed:
- R1 assertions are self-verifying by design: they FAIL on current code (handler throws),
  proving the assertions are live. After fix, if the guard is removed, they turn RED again.
- R2/R3/R4/R5b: guard-against-false-positive tests — removing the handler's success path
  would cause them to fail, proving the pins are live.
- **R4b: mutation-verified 2026-06-26** — removed the `if (masterId){...isRollingMaster...}`
  block from tasks.js:79-82; R4b turned RED (`expect(text).not.toMatch(/without a scheduled time/i)`
  failed because app guard fired). Restored tasks.js to bert's exact version; `git diff
  src/mcp/tools/tasks.js` shows only bert's guard, no telly/mutation residue. All 14 tests GREEN.
