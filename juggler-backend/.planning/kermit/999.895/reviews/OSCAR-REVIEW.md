# Oscar Review — 999.895 — bugfix — 2026-06-26

## Verdict: PASS

## Summary
MCP `set_task_status`/`update_task` now mirror the HTTP terminal-requires-schedule guard
(`UpdateTaskStatus.js:147-160`) via a shared `terminalScheduleBlock` helper — MCP clients (ClimbRS) can
no longer mark a task `done`/`skip`/`cancel` without a scheduled time; rolling-recurring instances stay
exempt (parity). Top concern (R4 false-green) was caught by zoe and closed with a mutation-verified
exemption-branch test.

## Pipeline
Mode: bugfix — dispatched in order: telly (RED step 0) → bert (fix) → [ernie + zoe] reader/audit wave →
fix loop (telly R4b; telly ×5 regression fixtures) → zoe re-review. elmo/bird/cookie NOT dispatched
(no security/frontend/arch surface — non-risky bugfix per classifier; skip logged).

## Agent Findings
### telly — DONE
- Step 0 RED confirmed: R1a/b/c + R5a failing on unguarded code; R2/R3/R4/R5b green.
- Also repaired a pre-existing broken require path in `tests/helpers/mcp.js` (`'../src/...'` → `'../../src/...'`) needed for the harness to load.
- Final: new suite 14/14 green (RED→GREEN proven); full MCP suite 332/332 green.

### bert — DONE
- Added module-level `terminalScheduleBlock(existing, status, willBeScheduled, userId)` + call sites in `set_task_status` and `update_task`. 25 insertions, no fallbacks. Lint clean.

### ernie — DONE (0 BLOCK / 0 WARN / 3 INFO)
- Guard is a faithful parity mirror; short-circuit logic, `fields.time` exclusion, placement (before isLocked, covers both paths), null-safety all correct.
- INFO (out-of-scope): unscheduled rolling instance → exemption allows, but DB CHECK `chk_task_instances_terminal_scheduled` then rejects — IDENTICAL on the HTTP path (UpdateTaskStatus.js sets no scheduled_at for rolling); intended design per Brain fact#79254. Separate cross-path reconciliation backlog, not this leg.
- INFO: `set_task_status` lacks HTTP's VALID_STATUSES/'missed'-system-only validation — pre-existing, separately backloggable.

### zoe — DONE (0 BLOCK / 0 WARN / 1 INFO after re-review)
- BLOCK-1 (R4 false-green): CONFIRMED by mutation (deleting the exemption branch left all 13 green). CLOSED by telly's R4b (unscheduled rolling instance; asserts app guard does NOT fire; independently mutation-verified RED-under-neutered-exemption / GREEN-restored).
- WARN-1 (catalog overclaim): RESOLVED (TEST-CATALOG corrected).
- Cleared (not silently trusted): R1 DB-unchanged reads real; R2/R3 prove no over-fire; R5b pins the date-in-call exemption; no tautologies/mocks/skips.

## Fix Loop
- Iteration 1: 1 BLOCK (R4 false-green) → 0. (telly R4b + zoe re-review)
- Iteration 2: 5 BLOCK (pre-existing mocked tests asserting unscheduled-terminal success — behavior legitimately changed by the fix) → 0. (telly fixture-only fixes: added `scheduled_at`; no assertion edits; tasks.js byte-identical.)
- Converged: open-finding count strictly decreased each iteration; no oscillation.

## Completeness
_This table is the leg's Definition of Done. WBS acceptance-criterion → DoD-check mapping below._
| Check | Result |
|-------|--------|
| All WBS items reviewed (W1 telly, W2 bert+ernie+zoe) | PASS |
| DoD reconciled — R1→R1a/b/c, R2→R2, R3→R3a/b, R4→R4+R4b(exemption), R5→R5a/b all map to tests | PASS |
| Tests exist / passing (new 14/14; full MCP suite 332/332 green, isolated DB 3407) | PASS |
| Lint clean (`eslint src/**/*.js` — prod file clean; repo never lints tests/) | PASS |
| Traceability complete (forward) — row has Code + Test + verified | PASS |
| Backward traceability — every changed file maps to the BUG row (fix + its tests); no orphan work | PASS |
| Gated set == commit set — 6 changed files == leg-meta.wbs_files | PASS |
| Security reviewed (no security surface; non-risky; elmo n/a, skip logged) | PASS (n/a) |
| Docs — code-only internal parity fix; `leg-meta.docs_deferred.deferred=true` recorded | PASS |
| All proof checklists checked (telly/bert/ernie/zoe) | PASS |

## Traceability Check
Complete — single BUG row: Code = `src/mcp/tools/tasks.js: terminalScheduleBlock, set_task_status, update_task`; Test = `tests/mcp-terminal-schedule-guard.test.js` (14/14, R4b mutation-verified); Status = verified.

## Regression note
`set_task_status`/`update_task` are MCP-only tools (HTTP uses the already-guarded `UpdateTaskStatus`), so the MCP suite is the complete affected surface. 5 pre-existing mocked tests asserted unscheduled-terminal success (the pre-fix bug); all updated to scheduled fixtures (fixture-only, no assertion weakening — Oscar diff-verified).

## Proof Checklist
- [x] Required inputs present — --mode bugfix + scope juggler-backend resolved
- [x] WBS + TRACEABILITY loaded
- [x] Pipeline selected from --mode (bugfix), not file-pattern guessed
- [x] Mode entry-gate checked — repro + root-cause (HTTP guard vs MCP gap) present; failing test confirmed RED at telly step 0
- [x] Every required muppet dispatched — telly/bert/ernie/zoe; elmo/bird/cookie n/a (non-risky, no security/frontend/arch surface), skips logged
- [x] Each muppet Status + proof_checklist read; no unchecked boxes propagated
- [x] Spot-verified ≥1 evidence claim per muppet — re-ran the suite (14/14 + 332/332), re-read the diff (prod 25-line guard only), confirmed fixture-only regression diffs, confirmed lint scope
- [x] Fix loop ran (2 iterations) and re-review re-aggregated (zoe re-review closed BLOCK-1)
- [x] Fix loop converged — strictly decreasing (1→0, 5→0); no oscillation
- [x] Fix-induced security surface — none (fix only ADDS a restriction; no new auth/crypto/SQL/external-call)
- [x] Partial-wave failure — n/a (serial bugfix chain)
- [x] Completeness gate ran — tests actually RAN green against test-bed 3407 (recorded above); docs code-only deferred (artifact recorded)
- [x] Scooter — bugfix (consult recommended, not mandatory); ernie cited Brain fact#79254; no governing-doc changes in the diff (no INBOX notice required)
- [x] UAT — n/a (no user-facing frontend surface; MCP tool-contract behavior covered by DB-backed integration tests)
- [x] DoD named + reconciled — every WBS acceptance criterion maps to a DoD check
- [x] Traceability verified (forward) — Code + Test + verified
- [x] Backward traceability — all changed files map to the BUG row; no orphan/gold-plated work
- [x] Gated set == commit set — 6 changed files == wbs_files
- [x] Verdict written with Kermit Report block

## Backlog Items (WARN)
None (0 WARN). INFO follow-ups (NOT gating, for Kermit/David to optionally backlog at reconcile):
- Cross-path: reconcile the rolling-instance terminal exemption (Brain fact#79254) with the DB CHECK `chk_task_instances_terminal_scheduled` (HTTP + MCP both allow at app layer then the DB rejects an unscheduled-terminal rolling write) — pre-existing, both paths.
- MCP `set_task_status` lacks HTTP's VALID_STATUSES / 'missed'-system-only validation — pre-existing parity gap.
- Docs follow-up (code-only deferral): note MCP-path terminal-schedule parity in `juggler-backend/docs/TASK-STATE-MATRIX.md`.

## Kermit Report
Verdict: PASS | Mode: bugfix | Completeness gaps: none | WARNs: 0 | Backlog: 0 gating (3 INFO follow-ups noted) | Ready to commit: yes
fix_loop_iters: 2 | muppets_dispatched: telly, bert, ernie, zoe

## Status: PASS
_Signed: Oscar — 2026-06-26T21:20:00Z_
