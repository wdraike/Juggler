# Retro — juggler-h5-fixes — 2026-06-12

## Metrics
bugfix | WARN | 5 items/3 waves | blocks=3 (2 real-fixed + 1 FALSE) | warns=6 (deferred) | fix_loop_iters=3 | muppets=6 (telly/bert/ernie/cookie/elmo/zoe). 112/112 leg suite green.

## Process observations
1. **NEAR-MISS FALSE VERDICT (the headline — backlog 999.431).** telly reported a W3 BLOCK (race test finalCount=51, "fix doesn't work") while zoe + the production code said 50 (works). TWO compounding mechanisms:
   - `make test-juggler` syncs a worktree to the COMMITTED HEAD → a pre-commit run tests OLD code (without the uncommitted leg fix) → reports the pre-fix result.
   - DB-dependent tests SKIP-and-pass (vacuous green ✓) when DB creds are absent → a "passing" suite that ran nothing.
   Either could ship a false-BLOCK (holding a correct fix) OR a false-PASS (greenlighting broken code). Oscar caught it ONLY by re-running B11-race himself with full creds on the working tree (50 ×3). The muppet pipeline alone would have recorded telly's BLOCK.
2. **WHAT WORKED:** Oscar's "spot-verify ≥1 evidence claim per muppet" → empirical arbitration when telly/zoe disagreed. zoe's mutation discipline (51-vs-50 discriminator) was correct. Snuffy's UNDER_SCOPED split (W1→W1a/W1b, elmo→W2b, W3 gates) gave focused test surfaces that made the fix loop tractable.
3. **Fix-loop churn:** W2a B9 took 2 iterations (constructor→boot-fail-fast→flaky-test-harden) — the entry framing ("boot-fail-fast") was under-specified vs the lazy-facade reality; cookie later showed it was largely redundant. A pre-implementation cookie/ernie design note on B9 would have caught the lazy-vs-boot mismatch before bert built the wrong thing twice.

## Proposed AGENT EDITS (PRIMARY — NOT applied; need human approval + ~/.claude lint)
- **P1 — Oscar test-execution (oscar-tech-director/SKILL.md Step 7 "Tests pass" row).** Add: "(a) Pre-commit gates run the suite on the WORKING TREE — direct `DB_PORT=3407 … jest <paths>` with full test-bed creds — NOT `make test-juggler` (which syncs a worktree to committed HEAD and would test stale code, missing the uncommitted leg). (b) A test that SKIPS because its required DB/infra is unreachable counts as NOT RUN (infra-error hold), NEVER as green — a vacuous-pass suite is not a passing suite." This encodes the 999.431 lesson where exactly this shipped a false result. (Oscar already forbids telly `--worktree`; this extends it to the make-target + the skip-pass case.)
- **P2 — telly reporting contract (telly/SKILL.md).** Add: "Before reporting RED/GREEN, confirm each test ACTUALLY EXECUTED against the working tree + its required DB — a skipped/short-circuited test is reported as NOT-RUN, never as a pass; a result that disagrees with the production code's mechanism must be re-run with full creds before being reported as a BLOCK."
- **P3 (lighter) — Oscar bugfix entry-gate.** For a bugfix item whose fix touches lazy-init / boot-sequence / lifecycle (where "where does it run" is load-bearing), add a one-line cookie/ernie design check BEFORE bert implements, to catch a goal-vs-mechanism mismatch (B9 was built twice).

## Project FACT → memory/brain (secondary)
- The stale-worktree + skip-passes-green landmine is a recurring test-infra trap (already 999.431 + pending INBOX process-lesson). Worth a memory drawer once MCP/brain is back.

## Status: retro ran 2026-06-12; cadence reset. Agent edits P1-P3 surfaced for human approval (not applied).
