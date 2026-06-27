# BERT-LOG — 999.895 MCP terminal-schedule guard — bugfix — 2026-06-26

## Status: DONE

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | verified --mode bugfix and dispatch instructions present | present |
| Read context | read CLAUDE.md + UpdateTaskStatus.js:147-160 (canonical guard) + tasks.js (full) + test file | done |
| Parse findings | extracted 1 implicit BLOCK finding from dispatch: MCP set_task_status and update_task bypass the HTTP terminal-requires-schedule guard | done |
| Apply fixes | 3 edits to src/mcp/tools/tasks.js: module-level helper + guard in set_task_status + guard in update_task | see Findings table |
| Adjacent-regression | isRollingMaster and db unchanged (no signature change); no other callers of terminalScheduleBlock (new helper); existing suite run | 13/13 pass |
| Self-verify fix | node --check src/mcp/tools/tasks.js → PARSE OK; npx jest tests/mcp-terminal-schedule-guard.test.js --runInBand --forceExit → 13 passed | all pass |
| REFER lines | 0 emitted | n/a |
| Output written | Write BERT-LOG.md | Done |

## Proof Checklist
- [x] Required inputs present
- [x] Mode confirmed: bugfix
- [x] All BLOCK findings addressed (fixed, disputed, or referred with reason)
- [x] No unapproved fallbacks introduced
- [x] No tests authored by bert (refers emitted where needed)
- [x] No docs authored by bert (refers emitted where needed)
- [x] Disputed findings referred back to reviewer; design-level fixes referred up to cookie/Kermit
- [x] Blast-radius bound respected; adjacent-regression call-sites checked + suite run
- [x] Findings re-anchored after multi-fix edits
- [x] Fix self-verified: every mutated file parses/loads + targeted test runs (before DONE)
- [x] BERT-LOG.md written
- [x] Changed files listed

## Findings Actioned
| # | Severity | File:Line | Description | Fix Applied | Result |
|---|----------|-----------|-------------|-------------|--------|
| 1 | BLOCK | src/mcp/tools/tasks.js:70 (pre-edit) | MCP set_task_status has no terminal-requires-schedule guard — DB constraint fires instead of clean isError response | Added module-level TERMINAL_REQUIRES_SCHEDULE constant and async terminalScheduleBlock helper (mirrors UpdateTaskStatus.js:147-160) above registerTaskTools | Fixed |
| 2 | BLOCK | src/mcp/tools/tasks.js:416 (post-edit) | set_task_status writes to DB before guard check | Added `_termBlock` guard call immediately after the not-found check, before building the `update` object | Fixed |
| 3 | BLOCK | src/mcp/tools/tasks.js:353 (post-edit, update_task) | update_task writes to DB before guard check | Added `_willBeScheduled` + `_termBlock` guard call before the `isLocked` branch, covering both locked and unlocked write paths | Fixed |

## Refers Emitted
(none)

## Changed Files
- src/mcp/tools/tasks.js (lines 70-85: module-level helper added; ~line 416: set_task_status guard; ~line 353: update_task guard)

## Sign-off
Signed: Bert — 2026-06-26T21:25:00Z
