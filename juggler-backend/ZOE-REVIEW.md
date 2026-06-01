# Zoe Review — 2026-05-31

## Summary
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
