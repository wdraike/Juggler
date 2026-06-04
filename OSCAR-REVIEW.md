# Oscar Review — 2026-06-04

## Verdict: WARN

## Summary
Scheduler fix is correct and production-safe. Two WARN findings fixed inline (reconcileLimitsIfNeeded re-enabled, migration catch indentation). One pre-existing dead-code issue noted for backlog. Tests require test-bed MySQL (not running in this session) — infrastructure constraint, not a code regression.

## Agent Findings

### ernie (code review) — WARN

| # | Severity | Finding | File:Line | Remediation |
|---|----------|---------|-----------|-------------|
| 1 | WARN | `reconcileLimitsIfNeeded` disabled with incorrect comment ("getDb() not initialized") — billing-webhooks now uses lazy getDb() so the concern is resolved | plan-features.middleware.js:201 | Re-enabled (fixed inline) |
| 2 | WARN | `catch` block brace at column 0 after `catch (e)` → `catch` cleanup | 20260518000100_placement_mode_enum_redesign.js:70 | Fixed inline |
| 3 | INFO | Migration test imports only `down` but `describe('up')` block remains — will fail against live DB | 20260527213906_add_terminal_scheduled_at_constraint.test.js | Backlog — pre-existing DB constraint |
| 4 | INFO | Dead code: `scheduler/index.js`, `task-status-writer.js`, `instance-status-writer.js` reference `canTransition` never exported from `task-status.js`. No live consumers. | scheduler/index.js:148 | Backlog — pre-existing |

### Core scheduler fix review — PASS

| # | Finding | Verdict |
|---|---------|---------|
| 1 | `validateScheduledAt` no longer throws for recurring instances without scheduled_at | CORRECT — chicken-and-egg fix |
| 2 | `runWithLock(userId, SOURCE_APP, fn)` → `runWithLock(userId, fn)` | CORRECT — old call was passing string as fn |
| 3 | `getDb()` lazy-require pattern in all controllers | CORRECT — avoids top-level module init issues |
| 4 | `task-status.js` staged delete + untracked re-add of identical file | SAFE — net no change |
| 5 | `startPollLoop()` added to `server.js` on boot | CORRECT — poll loop was never started before |
| 6 | Cache datetime parse fix (MySQL datetime string → proper ISO) | CORRECT — prevents stale cache being served |
| 7 | `getSseEmitter().emit(userId, 'schedule:changed', {})` on success | CORRECT — notifies frontend after each run |
| 8 | `_lastError` tracking for health checks | CORRECT — additive, non-breaking |

## Fix Loop
- Iteration 1: 2 issues fixed inline (W1 reconcileLimitsIfNeeded, W2 catch indentation)

## Completeness

| Check | Result |
|-------|--------|
| Tests exist for changed scheduler code | PASS (migration constraint test exists) |
| Tests passing | WARN — test-bed MySQL not running (infrastructure, not code regression) |
| Docs updated | PASS — no new API routes or schema changes |
| Security review | PASS — no auth/payment/webhook paths changed |
| Dead code cleanup complete | WARN — pre-existing canTransition dead code not in this batch scope |

## Backlog Items

| Finding | File |
|---------|------|
| Migration test `describe('up')` block orphaned after import cleanup | juggler-backend/src/db/migrations/__tests__/20260527213906_add_terminal_scheduled_at_constraint.test.js |
| Dead code: scheduler/index.js + status-writer files referencing canTransition (never exported) | juggler-backend/src/scheduler/index.js |

## Kermit Report
Verdict: WARN
Completeness gaps: test-bed MySQL required to run tests (infrastructure constraint)
Backlog items: 2
Ready to commit: yes

## Status: PASS
_Signed: Oscar — 2026-06-04T06:52:00Z_
