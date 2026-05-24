# Oscar Review — 2026-05-24 — Juggler auto-pin + placementMode + silent-lockout fix

## Decision: WARN

## Changed Files
| File | Category | Agent(s) Launched |
|------|----------|-------------------|
| juggler-backend/src/mcp/tools/tasks.js | API + Code | ernie, elmo, telly, zoe |
| juggler-backend/src/controllers/task.controller.js | API + Code | ernie, elmo, telly |
| juggler-frontend/src/components/tasks/sections/WhenSection.jsx | Frontend + Code | bird, ernie, telly, zoe |
| juggler-frontend/src/components/tasks/TaskEditForm.jsx | Frontend + Code | bird, ernie |
| juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx | Test | telly, zoe |
| juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx | Test | telly, zoe |
| juggler-backend/tests/mcp-task-config.test.js | Test | telly, zoe |
| juggler-backend/docs/TASK-CONFIGURATION-MATRIX.md | Docs | prairie |
| juggler-frontend/docs/TASK-EDIT-UX-AUDIT.md | Docs | prairie |
| juggler-frontend/docs/ZOE-TEST-AUDIT.md | Docs | prairie |
| juggler-frontend/docs/ERNIE-CODE-REVIEW.md | Docs | prairie |
| juggler-backend/docs/ELMO-SECURITY-AUDIT.md | Docs | prairie |

## Agent Launch Decisions
| Agent | Launched | Reason | Result | Finding Count |
|-------|----------|--------|--------|---------------|
| prairie | Yes | 5 docs changed | PASS | 0 BLOCK, 0 WARN |
| ernie | Yes | 4 code files | WARN | 6 Critical, 20 Warning |
| elmo | Yes | API (task.controller.js) | WARN | 3 CRITICAL, 11 HIGH |
| telly | Yes | code + tests | PASS | 274 pass, 0 fail |
| zoe | Yes | mandatory after telly | WARN | 1 false-pass noted |
| bird | Yes | 2 frontend files | WARN | 1 BLOCK (fixed), 3 WARN |
| cookie | No | no infra changes | N/A | — |

## Critical / BLOCK Findings — Fixed by Bert
| Finding | File | Fix |
|---------|------|-----|
| ELMO CRITICAL C-2: return inside Knex transaction | tasks.js | Throw Error + try/catch outside transaction |
| BIRD BLOCK 1: broken recurring day-picker titles | WhenSection.jsx | Map keys U/S match codes |
| ERNIE C1: undeclared tz in updateTaskStatus | task.controller.js | Added var tz = safeTimezone(...) |
| ERNIE C4: batch_update_tasks omits guardFixedCalendarWhen | tasks.js | Added guard with template-aware routing |

## Test Summary
| Suite | Tests | Passed |
|-------|-------|--------|
| mcp-task-config.test.js | 16 | 16 |
| WhenSection.modes.test.jsx | 221 | 221 |
| WhenSection.test.jsx | 37 | 37 |
| **Total** | **274** | **274** |

## Remaining Findings (Pre-existing, require follow-up)
- ELMO CRITICAL C-1: delete_task bypasses provider-origin guard
- ELMO CRITICAL C-3: set_task_status bypasses state machine
- ERNIE C2: set_task_status bare write
- ERNIE C3: delete_task hard-deletes recurring instances
- ERNIE C5: inconsistent validation limits
- ERNIE C6: non-transactional ledger flip
- Plus 11 HIGH and 20 WARN documented in SECURITY-REVIEW.md and CODE-REVIEW.md

## Verdict
All required agents launched. Introduced critical/blocking findings fixed. Tests pass. Pre-existing MCP parity gaps deferred. Commit approved with WARN.

Signed: Oscar — 2026-05-24
