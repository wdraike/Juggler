# Oscar Review — 999.892-tz-notnull — bugfix/hardening — 2026-06-26

## Verdict: PASS

## Summary
Single-source UTC contract adopted: `users.timezone` is now NOT NULL DEFAULT 'America/New_York'
(migration backfills NULLs first), redundant column-null fallbacks removed at 4 reader sites with
row-absence/DB-error guards preserved, and TIMEZONE-RULES.md updated (TZ-SCHEMA-1). Migration test
7/7 GREEN (genuine RED pre-migration, proven by zoe mutation testing). No regression from the
call-site edits. Two noted follow-ups (out of scope) handed to Kermit.

## Pipeline
Mode: bugfix (full lane, standard depth) — dispatched in order:
telly (step-0 RED test) → bert (migration + 4 call-site fixes) → reader wave [ernie + cookie + zoe] →
fix loop iter1: telly (zoe WARN) → docs: abby → prairie → fix loop iter2: abby (prairie BLOCK) → prairie.

## Agent Findings
### telly (step 0 + GREEN + selectivity fix) — DONE
RED confirmed pre-migration (tests 1,5,6,7 fail on nullable schema). GREEN 7/7 after migration.
Fix-loop iter1: strengthened test 6 to pin backfill selectivity (Europe/London preserved + NULL
backfilled); proved Mutation C (remove `.whereNull`) now fails. 7/7 GREEN.

### bert — DONE
5 files: new migration (backfill→raw NOT NULL ALTER w/ COLLATE utf8mb4_unicode_ci; down reverts to
nullable, no column drop); CS1 `if(row)`, CS2-4 `user ? user.timezone : 'America/New_York'`. No new
fallbacks. KnexConfigRepository untouched.

### ernie — DONE (0 BLOCK / 0 WARN / 6 INFO)
Migration correct (backfill before ALTER, raw SQL preserves collation, reversible). Call sites:
row-absence/DB-error guards preserved, no new fallback. CS5 confirmed NOT in diff. `## Scooter Consult`
block recorded in CODE-REVIEW.md (no veto; Brain fact #77683 supports NOT NULL DEFAULT America/New_York).

### cookie — DONE (0 BLOCK / 0 WARN / 2 INFO)
Migration schema-safe: ordering last in chain, backfill-before-ALTER, explicit collation, reversible,
no tasks_v view recreate needed (view doesn't select users.timezone). Prod ALTER lock negligible on
low-row users table.

### zoe — WARN resolved
Mutation-tested: RED→GREEN genuine (Mut A→tests 1,5,7 RED; Mut B→test 6 RED). No tautology/false-pass.
WARN: backfill selectivity unpinned (Mut C green) → FIXED by telly (test 6 now seeds non-null row).
Tree left clean.

### abby → prairie — DONE / PASS
abby added TZ-SCHEMA-1 + tightened TZ-DISPLAY-3/TZ-ERR-2 + INBOX notice. prairie BLOCK (abby's edits
asserted unimplemented invalid-IANA fallback) → FIXED iter2 (abby scoped fallbacks to implemented cases
only; pre-existing TZ-ERR-1 gap deferred). prairie re-review: PASS.

## Fix Loop
- Iteration 1: zoe WARN (selectivity) → telly fixed → WARN 1→0. Converged.
- Iteration 2: prairie docs BLOCK (invalid-IANA over-claim) → abby fixed → BLOCK 1→0. Converged.
No oscillation; strictly decreasing each iteration.

## Completeness
_This table is the leg DoD. WBS acceptance-criterion → DoD-check mapping below._
| Check | Result |
|-------|--------|
| All WBS items reviewed (W1 migration, W2 call sites) | PASS |
| DoD reconciled — every WBS acceptance criterion maps to a check | PASS |
| Tests exist / passing (migration test 7/7 GREEN on test-bed 3407) | PASS |
| Traceability complete (forward) | PASS |
| Backward traceability (7 files → BUG-892; no orphans) | PASS |
| Gated set == commit set (7 WBS files exactly) | PASS |
| Security reviewed (no security surface — data-migration; elmo n/a) | PASS (n/a) |
| Docs (docs-critical → abby/prairie ran, PASS) | PASS |
| All proof checklists checked | PASS |
| Scooter consult (CODE-REVIEW.md) + INBOX notice (TZ-SCHEMA-1) | PASS |

DoD↔acceptance mapping: W1 criteria {IS_NULLABLE='NO', default, collation, default-on-insert,
NULL-rejected, backfill, reversible} → migration test assertions 1-7 (all GREEN). W2 criteria {4 sites
no column-null test, row-absence guards kept, no new fallback, CS5 unchanged} → ernie CODE-REVIEW PASS.

## Traceability Check
BUG-892 → Code (migration + 4 readers + doc) + Test (migration test, RED-pre 1/5/6/7, GREEN-post 7/7) +
Status=verified. Complete.

## Regression note (NOT a leg defect)
`tests/schedulePlacementsIntegration.test.js` › "placement entry has start and end derived from task
time+dur" fails in FULL-suite mode and passes in isolation — IDENTICALLY with CS1 reverted to HEAD
(controlled A/B). This is the documented pre-existing shared-DB intra-suite schema-pollution flake
(memory: "juggler all-green campaign 2026-06-25 CEILING"), NOT introduced by 999.892. The CS1 edit
(line 48) is unreached by this test (it passes `options.timezone`), confirming zero behavior change.

## Follow-ups for Kermit (out of scope — do NOT block this leg)
1. **TZ-DISPLAY-1 / A1 reshape:** post-backfill `getUserTimezone` returns 'America/New_York' (not null)
   for never-configured users, retiring the null="unconfigured" signal. Re-introducing a distinct
   unconfigured signal is a design decision needing a David ruling. File as follow-up.
2. **TZ-ERR-1 invalid-IANA validation gap (pre-existing):** doc claims invalid-IANA names fall back to
   America/New_York, but code does not validate IANA names (Intl.DateTimeFormat throws RangeError).
   Pre-existing doc↔code discrepancy → file as follow-up (implementing validation = new behavior).

## Proof Checklist
- [x] Required inputs present — --mode bugfix + scope juggler resolved
- [x] WBS + TRACEABILITY loaded
- [x] Pipeline selected from --mode (bugfix), not file-guessed
- [x] Mode entry-gate checked — repro + root cause from Intake Brief; telly step-0 RED confirmed (tests 1,5,6,7)
- [x] Every required muppet dispatched — telly, bert, ernie, cookie(migration add-on), zoe, abby+prairie(docs-critical); elmo n/a (no security surface)
- [x] Each muppet Status + proof_checklist read; no unchecked box propagated
- [x] Spot-verified evidence — re-ran migration test (7/7), A/B-tested CS1 vs HEAD, confirmed gated set
- [x] Fix loop ran (2 iterations) and re-aggregated
- [x] Fix loop converged — WARN 1→0 (iter1), BLOCK 1→0 (iter2); no oscillation
- [x] Fix-induced security surface — none introduced
- [x] Partial-wave failure — n/a (no wave BLOCK; reader wave all passed first round except zoe WARN)
- [x] Completeness gate ran — tests RAN green on test-bed 3407 (migration test); pre-existing flake isolated as non-regression
- [x] Scooter consult evidence present (CODE-REVIEW.md) + INBOX notice for TZ-SCHEMA-1 standard change
- [x] UAT — n/a (no user-facing UI surface; internal schema + MCP/scheduler tz resolution; migration test covers behavior)
- [x] DoD named + reconciled — every WBS acceptance criterion maps to a DoD check
- [x] Traceability verified (forward) — BUG-892 has Code + Test + verified
- [x] Backward traceability — 7 changed files all map to BUG-892; no orphan/gold-plated work
- [x] Gated set == commit set — exactly the 7 WBS files
- [x] Verdict written with Kermit Report block

## Kermit Report
Verdict: PASS | Mode: bugfix | Completeness gaps: none | WARNs: 0 (zoe WARN fixed in loop) |
Backlog follow-ups: 2 (TZ-DISPLAY-1/A1 ruling; TZ-ERR-1 invalid-IANA validation — both out of scope) |
Ready to commit: YES. Gated set = 7 WBS files.
Metrics: verdict=PASS, fix_loop_iters=2, muppets=[telly,bert,ernie,cookie,zoe,abby,prairie].

## Status: PASS
_Signed: Oscar — 2026-06-26T22:45:00Z_
