# Zoe Review — juggler-sweep-overdue (telly tests) — bugfix — 2026-06-26

## Status: DONE

**Verdict: NO false-pass, NO tautology found.** All four challenged behaviors were independently
proven RED-on-broken by surgical source mutation. The two oracle un-skips reproduce the real bug
pre-fix; the disjointness boundary, weather ceiling, and effective-deadline max() are each genuinely
pinned. Findings are limited to non-blocking stale-comment maintainability WARNs (a future maintainer
could invert a correct assertion to match a stale "min/earlier" comment).

BLOCK: 0 · WARN: 2 · INFO: 2

## Proof of Work
| Step | Action / command | Result |
|------|------------------|--------|
| Inputs | read SPEC.md, TEST-CATALOG.md, TEST-REVIEW.md, TRACEABILITY.md; mode=bugfix | present |
| Baseline run | jest (bypass-config, no globalSetup — pure-fn units) ×4 suites | 38/38 PASS |
| Shallow grep | `grep -nE "expect\(true\)|toBeTruthy|toBeDefined|\.skip|\.todo|toMatchSnapshot"` ×4 files | NONE |
| Assertion-free | per-file test/expect counts | 20/20, 3/6, 3/3, 10/12 — every block asserts |
| MUTATION 1 (taskMappers:431) | window-close `preferred ?? slot` → `slot` (revert AC-840-1) | CASE-1a-preferred → **RED** ✓ |
| MUTATION 2 (taskMappers:427) | guard `time_flex != null` → `> 0` (pre-fix) | CASE-10a → **RED**, CASE-10a-before stays GREEN ✓ |
| MUTATION 3 (runSchedule:264) | overlap `aEnd > next.start` → `>=` | DISJOINT(touching) → **RED**, OVERLAP+MULTI-DAY stay GREEN ✓ |
| MUTATION 4 (runSchedule:240) | `computeEffectiveDeadline` MAX → MIN | all 3 distinct-value both-set tests → **RED** ✓ |
| MUTATION 5 (unifiedScheduleV2:946) | tempMax ceiling no-op (wiring break) | temp(30) test → **RED**, under-ceiling+null stay GREEN ✓ |
| Restore | `cp` from /tmp backups (NOT git checkout — files hold uncommitted leg work) | tree clean, 0 `ZOE-MUT` residue, diffs identical to backups |
| Flake | oracle suite ×3 total runs | 22/22 deterministic each |
| Final | all 4 suites post-restore | 38/38 PASS |

## Proof Checklist
- [x] --mode present — bugfix, recorded in header
- [x] Required inputs present — SPEC.md + TEST-CATALOG.md + TEST-REVIEW.md + TRACEABILITY.md read
- [x] Shallow-assertion grep run — 0 hits across all 4 files
- [x] Assertion-free grep run — every test block has ≥1 expect (20/20, 3/6, 3/3, 10/12)
- [x] Suspect tests re-executed — all 4 suites run (bypass-config; globalSetup is DB-guard, these are pure-fn)
- [x] Suspect-selection recorded — the 4 prompt-directed behaviors, all data-mutation-adjacent scheduler logic, challenged first
- [x] SPOT-MUTATION executed on all 5 risk-ordered suspects — each flips the exact expected test RED; tree reverted clean via /tmp cp (git status / residue verified)
- [x] Mock-hides-bug — N/A: zero mocks; all tests call real pure functions (`rowToTask`, `checkPlacementDisjointness`, `computeEffectiveDeadline`, `weatherOk` via `_testOnly`)
- [x] Snapshot-triviality + tautology grep — 0 snapshots, 0 self-comparisons
- [x] Mode-specific (bugfix) challenge applied — pre-fix RED reproduction proven by mutation for both oracle un-skips
- [x] Error/negative-path audit — boundary/before-slot/null/terminal-status/past-day companions present per behavior
- [x] Requirement coverage — AC-840-1/-2/-3/-4, AC-881-1/-2 each trace to ≥1 executed test (TRACEABILITY cross-checked)
- [x] Zero-tolerance domain (scheduler) — every in-scope AC has ≥1 test file; 0 BLOCK
- [x] VERIFICATION-CHECKLIST.json — not regenerated (leg-scoped 4-file adversarial audit; full-service checklist out of dispatch scope)
- [x] Bird audit — OUT OF SCOPE this dispatch (prompt directs the 4 telly test files only; UX-REVIEW.md present but not in challenge set)
- [x] Flake re-run ×3 — deterministic (pure functions, injected nowInfo, no wall-clock/Date.now/Math.random/IO)
- [x] Severity-calibration — telly's BLOCK(pre-fix-expected) ratings confirmed correct; no BLOCK-as-WARN mis-rating
- [x] Each finding carries file:line + severity
- [x] Flag-and-refer emitted
- [x] Rubric Coverage Map emitted — all 9 dimensions
- [x] Proof of Work populated with real commands + results
- [x] Status set — DONE
- [x] ZOE-REVIEW.md written
- [ ] Scooter ask — N/A (no new project-knowledge question; behavior contract supplied in SPEC/CATALOG)
- [ ] Scooter INBOX — N/A (zoe changed no requirement/standard/approach)

## Findings

### Telly Audit
| # | Severity | File:Line | Description | Required Fix |
|---|----------|-----------|-------------|--------------|
| 1 | WARN | tests/unit/scheduler/effective-deadline.test.js:3,63 | Stale `min`/`earlier` documentation contradicts the asserted `max` behavior. Header says "the earlier of the two non-null values"; test #4 name says "min of equal = either". Assertions are CORRECT (proven: MUTATION 4 max→min flips tests 1-3 RED), but the stale prose is a real maintenance hazard — a future maintainer could "fix" the assertion to match the comment and re-introduce the R50.0 regression the SPEC AC-840-4 DETERMINATION explicitly corrected. | telly: update header line 3 + test name line 63 to say MAX/later; align with SPEC AC-840-4 determination |
| 2 | WARN | tests/unit/mappers/overdue-pastdue-recurring.test.js:177,591 | Stale comments "Skipped so main stays green; un-skip when the follow-up lands" sit directly above CASE-1a-preferred and CASE-10a, which are now un-skipped and running GREEN. Misleading — implies the tests are inert when they are the leg's primary regression oracles. | telly: remove the stale "Skipped …" comment lines above the now-active oracle tests |

### Flag-and-Refer
| # | Severity | Refer To | File:Line | Description |
|---|----------|----------|-----------|-------------|
| 1 | INFO | REFER→telly | tests/unit/scheduler/placement-disjointness.test.js | Disjointness suite covers only 2-entry days. `checkPlacementDisjointness` compares adjacent sorted pairs only (runSchedule.js:260-264 `sorted[i]` vs `sorted[i+1]`); a 3+-entry day where a long early task overlaps a non-adjacent later task (with a short disjoint middle) is unpinned. Not a false-pass in existing tests — an edge-completeness gap. Consider a 3-entry overlap case. |
| 2 | INFO | REFER→kermit | TRACEABILITY.md:6 | AC-840-4 row still reads `min(period-boundary, window-close)` and Test=`pending (bert authors)`. Stale vs SPEC AC-840-4 DETERMINATION (corrected to `max`) and vs the now-existing effective-deadline.test.js. Update the traceability row to `max(...)` + the real test path. |

## Discrimination proof (the core challenge — answered)
- **CASE-1a-preferred** genuinely discriminates slot(420)+flex=600 vs preferred(480)+flex=660 at now=630: MUTATION 1 (preferred→slot) flips it RED, so the GREEN pass exercises the real `preferred_time_mins ?? scheduledMins` branch (taskMappers.js:431) — not a coincidental fall-through to `return false`.
- **CASE-10a** genuinely requires `time_flex===0 → overdue=true`: MUTATION 2 (guard `!=null`→pre-fix `>0`) flips it RED while CASE-10a-before stays GREEN — proving the test depends on the guard accepting 0, not passing on unrelated grounds.
- **DISJOINT(touching)** proves the boundary is exclusive (`end==next.start` = 0 violations): MUTATION 3 (`>`→`>=`) flips ONLY DISJOINT RED. OVERLAP uses real grid-occupying entries (13:00-14:00 vs 13:20-13:50, 840>800), not a same-minute coincidence. The 3 tests jointly forbid both an always-`[]` helper (OVERLAP asserts len 1) and an always-violation helper (DISJOINT/MULTI-DAY assert len 0).
- **weather temp(30)>25→false** calls the real `weatherOk` (no mock): MUTATION 5 (ceiling no-op) flips it RED — it would catch a future wiring break. null-ceiling fail-open (line 921) and under-ceiling cases stay GREEN.
- **effective-deadline** 3 distinct-value both-set cases (two pb-later, one wc-later) each assert the LATER input; MUTATION 4 (max→min) flips all 3 RED. The equal-value case correctly does not distinguish (acknowledged).

## Coverage Map
| Dimension | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Assertion Depth | covered | Every test asserts a concrete boolean/Date identity on a discriminating input; 0 toBeDefined/toBeTruthy; mutation proves each assertion bites | |
| Edge Case Gaps | partial | time_flex 0/null boundary, before-slot, touching boundary, cross-dateKey, terminal-status, past-day all covered; disjointness 3+-entry-day unpinned (INFO-1) | |
| Test Gaps | covered | All in-scope ACs (840-1/-2/-3/-4, 881-1/-2) trace to ≥1 executed test | |
| UX Gaps | n/a | Bird/UX out of this dispatch's scope (4 telly test files directed) | |
| Security Gaps | n/a | No security surface in scheduler window-close/disjointness/weather/deadline pure logic | |
| Documentation Gaps | partial | Stale `min/earlier` (WARN-1) + stale `Skipped` (WARN-2) comments; stale TRACEABILITY AC-840-4 (INFO-2) | |
| Architecture Gaps | n/a | Not zoe's column; no boundary change | |
| Review Quality | covered | All 5 prompt-directed suspects challenged via executed mutation; high-blast-radius scheduler logic challenged first | |
| False Passes | covered | ZERO found. 5/5 mutations flip the expected test RED; tests pass for the RIGHT reason | The headline result |

## Sign-off
Signed: Zoe — 2026-06-26T00:00:00Z
