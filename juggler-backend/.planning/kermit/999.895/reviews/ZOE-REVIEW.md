# Zoe Review — mcp-terminal-schedule-guard (999.895) — bugfix — 2026-06-26 (RE-REVIEW)

## Status: DONE

**RE-REVIEW VERDICT: PASS.** The R4b fix **CLOSES** the prior BLOCK. 0 BLOCK, 0 WARN, 1 INFO
(refer→ernie, design question, non-blocking). All proof-checklist boxes [x].

telly added R4b (test:362-385) seeding an **UNSCHEDULED** rolling instance (`ROLLING_UNSC_INST_ID`,
`scheduled_at:null`, rolling master). zoe **independently re-ran the mutation**: neutering the
`if (masterId){…isRollingMaster…}` exemption block (tasks.js:78-82) turns **R4b RED** (1 failed,
13 passed) — the other 13 tests are unaffected, proving R4b is the discriminating pin the old R4
was not. Restore from /tmp backup → **14/14 green**, `git diff --stat` = 25 insertions (bert's guard
only), `grep ZOE-MUTATION` = 0 residue. The catalog overclaim was corrected (R4 reattributed away
from the isRollingMaster branch; R4b owns it).

---

### Original review (2026-06-26, superseded — kept for audit trail)

> Status: ISSUES — 1 BLOCK, 2 WARN, 1 INFO. The SPEC-R4 rolling-recurring exemption was a
> **mutation-confirmed false-green**: deleting the entire exemption branch left all 13 tests green.

## Re-Review Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Baseline | jest …mcp-terminal-schedule-guard.test.js (DB 3407, juggler_sweep_test) | 14 passed (incl R4b) |
| Backup | cp src/mcp/tools/tasks.js /tmp/zoe-mut.tasks.js.bak | done |
| MUTATION (independent) | Edit tasks.js:78-82 → replace `if(masterId){…isRollingMaster…return null}` with comment + fall-through to block message | exemption neutered |
| Re-run mutated | jest … | **R4b RED** (1 failed, 13 passed); R4 + 12 others still green |
| Restore | cp /tmp/zoe-mut.tasks.js.bak → tasks.js | `grep -c ZOE-MUTATION`=0; `git diff --stat`=25 insertions; added-lines(non-+++)=22 (helper + 2 call sites) |
| Final run | jest … | **14 passed, 0 failed**; Test Suites 1 passed |
| Discrimination check | R4b asserts `not.toMatch(/without a scheduled time/i)` on caught err OR returned text; tolerates DB-constraint error; RED only when app guard fires | genuine discriminator, not tautology, not plain-success |
| Catalog correction | grep TEST-CATALOG.md / TEST-REVIEW.md | R4 marked "does NOT reach masterId→isRollingMaster branch" (L18/L92); R4b owns branch (L19/L93); TEST-REVIEW L35 documents fix |

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs check | ls TEST-REVIEW.md TEST-CATALOG.md TRACEABILITY.md SPEC.md | all present (no UX-REVIEW; --telly-only de facto) |
| Read fix | git diff src/mcp/tools/tasks.js | `terminalScheduleBlock(existing,status,willBeScheduled,userId)` helper + 2 call sites (set_task_status, update_task) |
| Helper short-circuit order | read tasks.js:75-84 | L76 status-not-terminal→null; **L77 `if(willBeScheduled)return null;`**; L78-82 masterId→isRollingMaster exemption |
| Baseline run | jest tests/mcp-terminal-schedule-guard.test.js --runInBand --forceExit | 13 passed (post-fix green) |
| SPOT-MUTATION (R4) | deleted L78-82 exemption block entirely, re-ran | **13 passed incl R4** — exemption is dead code w.r.t. suite (BLOCK-1) |
| Revert | cp /tmp/zoe-mut.tasks.js.bak → tasks.js | restored; `grep -c ZOE-MUTATION` = 0; git diff shows only legit guard |
| Flake re-run (3×) | baseline + mutated + restored runs | deterministic 13/13 each; no flake |
| Shallow-assertion grep | toBeTruthy/toBeFalsy/skip/todo/tautology/snapshot/mock | 13 it() / 24 expect(); no assertion-free, no mocks (real DB) |
| Mode challenge (bugfix) | R1/R5a RED-on-pre-fix verified by telly log (4 failed pre-fix); confirmed isError+text assertions discriminate | RED tests valid |
| Output written | Write ZOE-REVIEW.md + zoe-REVIEW.json | Done |

## Proof Checklist
- [x] --mode present — bugfix, recorded in header
- [x] Required inputs present — TEST-REVIEW.md + TEST-CATALOG.md present (no bird/UX artifact — noted)
- [x] Shallow-assertion grep run — 13 it()/24 expect(); no `expect(true)`/`toBeDefined`/tautology/snapshot
- [x] Assertion-free test grep run — none (every it() has ≥1 expect)
- [x] Suspect test re-executed — full suite run 3× (baseline, mutated, restored)
- [x] Suspect-selection risk-ordered — R4 (claims data-mutation exemption coverage) challenged first; R1/R5 discrimination verified
- [x] SPOT-MUTATION executed — exemption branch (tasks.js:78-82) deleted; **R4 still PASSED = confirmed false-pass = BLOCK**; tree reverted clean (git diff = legit fix only, 0 residue)
- [x] Mock-hides-bug grep run — zero mocks; real test-bed DB (3407) integration; no mock-asserting-itself risk
- [x] Snapshot-triviality + tautology grep — zero snapshots, zero self-comparisons
- [x] Mode-specific challenge (bugfix) applied — R1a/R1b/R1c/R5a confirmed RED-on-pre-fix (telly log + isError+text discriminators); regression valid
- [x] Error/negative-path audit — R1/R5a cover reject paths; R2/R3/R4/R5b cover allow paths
- [x] Requirement Coverage Audit — SPEC R1-R5 cross-referenced; **R4 has no test that exercises its code path**
- [x] Zero-tolerance domain (scheduler/task) — R4 (an implemented requirement) has NO real test → BLOCK
- [x] User story coverage — n/a (bugfix; no US-N artifact)
- [x] VERIFICATION-CHECKLIST.json — n/a for this micro bugfix leg; per-requirement status captured in TRACEABILITY + this review
- [x] Bird PASS challenged — n/a (no UX-REVIEW.md; backend-only MCP leg)
- [x] Bird a11y re-verify — n/a
- [x] Flake re-run ≥2× — 3 runs, deterministic
- [x] Severity-calibration audit — telly mis-rated R4 as covering the `master_id→isRollingMaster` branch (TEST-CATALOG L18/L86); re-rated as false coverage claim (folded into BLOCK-1 / WARN-1)
- [x] Each finding carries file:line + severity
- [x] Flag-and-refer emitted (REFER→ernie on exemption inertness)
- [x] Rubric Coverage Map emitted — all 9 dimensions
- [x] Proof of Work populated with real commands + results
- [x] Status set — ISSUES
- [x] ZOE-REVIEW.md written
- [x] Scooter not consulted — requirements fully specified in SPEC.md/TRACEABILITY.md; no knowledge gap or change

## Findings

### Telly Audit (re-review — both prior findings RESOLVED)
| # | Severity | Status | File:Line | Description | Resolution |
|---|----------|--------|-----------|-------------|------------|
| 1 | ~~BLOCK~~ | **RESOLVED** | tests/mcp-terminal-schedule-guard.test.js:362-385 (R4b) | Original false-green for SPEC R4 (rolling-recurring exemption): R4 seeded a *scheduled* rolling instance so the helper short-circuited at `if (willBeScheduled) return null;` (tasks.js:77) before the `if (masterId){…isRollingMaster…}` exemption; deleting tasks.js:78-82 left all 13 tests green. | telly added **R4b**: seeds an UNSCHEDULED rolling instance (`ROLLING_UNSC_INST_ID`, `scheduled_at:null`, master `ROLLING_MASTER_ID` recur.type=rolling); asserts `expect(text).not.toMatch(/without a scheduled time/i)` on caught error OR returned text. **zoe independently re-ran the mutation: neutering tasks.js:78-82 → R4b RED (1 failed, 13 passed); restore → 14/14 green, 0 residue, git diff = 25-line guard only.** R4b genuinely pins the exemption branch. |
| 2 | ~~WARN~~ | **RESOLVED** | TEST-CATALOG.md:18/19/92/93, TEST-REVIEW.md:35 | Original: catalog OVERCLAIMED R4 covers the `master_id → isRollingMaster` branch. | TEST-CATALOG.md:18 now states R4 "does NOT reach the masterId→isRollingMaster branch"; L92 marks it "(zoe false-green catch)"; L19/L93 reattribute the branch to R4b ("mutation-verified RED under neutered exemption"); the DB-constraint vs app-guard tension is surfaced explicitly at TEST-CATALOG.md:26-29 (not buried in a comment). TEST-REVIEW.md:35 documents the correction. |

### Telly Audit — cleared after challenge (recorded so they are not silently trusted)
| Test | Why cleared |
|------|-------------|
| R1a/R1b/R1c isError | Strong: assert `isError===true` AND `text` matches `/without a scheduled time/i`. Text match discriminates the guard from any other rejection; confirmed RED on pre-fix (telly log: 4 failed). |
| R1*/R5a DB-unchanged | Real re-read of `task_instances` row (not handler return) — genuine side-effect check. Note: passes pre-AND-post (DB constraint also blocks pre-fix), so it is a companion, not the discriminator; the isError sibling carries discrimination. Acceptable. |
| R2 | Scheduled non-rolling → success; asserts real DB `status='done'`. Pins no-over-fire on the happy terminal path. |
| R3a/R3b | Non-terminal (`wip`/`''`) → success; asserts real DB status. Pins guard does not over-fire on non-terminal. |
| R5a | update_task terminal + no date → isError + text + DB-unchanged. Strong; RED on pre-fix. |
| R5b | update_task terminal + `date:'12/1'` → success. Genuinely pins the date-in-call exemption: `status='done'` is terminal, so the pass depends on the `fields.date` branch of `_willBeScheduled`; AND the DB write of `status='done'` only lands if `scheduled_at` was actually set (DB constraint), so it is a real end-to-end pin, not "not-terminal". |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→ernie | src/mcp/tools/tasks.js:78-82 | The rolling exemption may be functionally inert: for an UNSCHEDULED rolling instance `terminalScheduleBlock` returns null (exempt), but the subsequent write of a terminal status with `scheduled_at=null` still violates `chk_task_instances_terminal_scheduled` → raw DB throw, never a successful terminal-marking. The app-level exemption never yields the SPEC-R4 "allowed" outcome on its own. Whether the exemption is meaningful/correct (e.g. should it also set `scheduled_at=NOW()`) is production logic — ernie's column. (telly Finding #4 raised the same design question to bert.) |

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | 25 expect across 14 it; isError checks paired with `text` match + real DB re-read; R4b discriminates on app-guard-message absence | toBeFalsy(isError) always companioned by DB-state read |
| Edge Case Gaps | covered | 3 terminal statuses (done/skip/cancel) + date-in-call exemption + **unscheduled-rolling (R4b)** now exercised; update_task `scheduledAt` (ISO) path still untested (minor, noted by telly) | rolling gap CLOSED |
| Test Gaps | covered | SPEC R4 exemption branch now pinned by R4b — mutation-confirmed discriminating | was BLOCK-1, now resolved |
| UX Gaps | n/a | Backend MCP leg; no UX-REVIEW artifact | — |
| Security Gaps | covered | No auth/payment seam touched; no elmo REFER for this leg | — |
| Documentation Gaps | covered | TEST-CATALOG.md:18/92 corrected; R4b owns isRollingMaster branch; tension surfaced at L26-29 | was WARN-1, now resolved |
| Architecture Gaps | n/a | Single-file guard mirror; no boundary change | — |
| Review Quality | covered | telly closed both findings cleanly; mutation-verified R4b matches zoe's independent re-run | — |
| False Passes | covered | The 1 confirmed false-pass (R4) is now superseded by R4b; independent mutation re-run confirms R4b is RED-on-broken | resolved |

## Sign-off
Signed: Zoe — 2026-06-26T21:48:00Z (re-review)
