# OSCAR-REVIEW — h7-driftfix-case-999.1019

**Mode:** bugfix  
**Backlog:** 999.1019 — split_ordinal/split_total CASE branches missing from writeChanged batched path  
**Branch:** leg/h7-driftfix-case-999.1019  

## Verdict: PASS

## Pipeline

| Step | Reviewer | Status | Findings |
|------|----------|--------|----------|
| telly step 0 (RED) | — | ✅ Confirmed | Mutation proof: reverting fix → both IT-SPLIT-a and IT-SPLIT-b fail (split_ordinal stays at seeded value 1) |
| bert (fix) | — | ✅ Done (commit f7a392b) | split_ordinal/split_total CASE branches + INSTANCE_UPDATE_FIELDS |
| telly (GREEN) | — | ✅ 4/4 tests pass | IT-SPLIT-a/b/c/d all pass on test-bed MySQL 3407 |
| ernie (code) | PASS | ✅ | 7 INFO findings — code correct, pattern consistent, no injection, null handling correct |
| zoe (adversarial) | WARN | ✅ Resolved | Z2 (IT-SPLIT-b mutation proof) — verified valid (fails via INSTANCE_UPDATE_FIELDS). Z3/Z4 coverage gaps — fixed with IT-SPLIT-c/d |

## Review Summary

### ernie — PASS
- CASE expressions faithfully mirror the legacy dur pattern (runSchedule.js:1295-1303)
- Column name interpolated from hardcoded array `['split_ordinal', 'split_total']` — no injection surface
- `!= null` filter correctly includes falsy values (e.g. split_total: 0) and skips absent fields
- `ELSE `col`` clause preserves existing values for chunk rows without the column
- Empty-chunk early return prevents no-op CASEs
- INSTANCE_UPDATE_FIELDS updated in tandem so per-row path also persists split columns
- Test quality is strong with documented mutation proof

### zoe — WARN (resolved)
- Z2: Claimed IT-SPLIT-b doesn't exercise the fix. Verified: IT-SPLIT-b DOES fail without the fix (INSTANCE_UPDATE_FIELDS change is part of the fix). Mutation proof valid.
- Z3: Coverage gap — scheduled_at + split without dur (batched path via scheduled_at). **Fixed**: added IT-SPLIT-c.
- Z4: Coverage gap — multi-row delta (real batched use case). **Fixed**: added IT-SPLIT-d.
- Z5: Edge cases (split_ordinal:0, mixed null/non-null). Noted — the `!= null` guard handles these correctly by design.
- Z6/Z7: Test hygiene good, `if (!available) return` is redundant but harmless.

## Test Results

```
PASS tests/w1-split-ordinal-case.integration.test.js (8.551 s)
  ✓ IT-SPLIT-a: writeChanged with dur+split_ordinal+split_total persists all three columns
  ✓ IT-SPLIT-b: writeChanged with split-only delta routes to otherUpdates and persists
  ✓ IT-SPLIT-c: writeChanged with scheduled_at+split (no dur) routes to batched path and persists
  ✓ IT-SPLIT-d: writeChanged with multi-row delta persists per-instance split_ordinal via CASE
```

Lint: clean (eslint passes on both changed source files)  
Pre-existing failures: 2 tests in schedulerPersistIntegration.test.js fail with and without the fix (timezone rowToTask issue, not caused by this change)

## Completeness

| WBS Item | Code | Test | Status |
|----------|------|------|--------|
| W1: INSTANCE_UPDATE_FIELDS | tasks-write.js:77 | IT-SPLIT-b (per-row path) | ✅ verified |
| W2: CASE branches in writeChanged | KnexScheduleRepository.js:156-171 | IT-SPLIT-a/c/d (batched path) | ✅ verified |
| W3: Integration test | N/A | 4 tests all pass | ✅ verified |

## Docs Classification

Code-only internal bugfix — no public API, no route change, no user-visible behavior change. Docs deferred (internal scheduler persistence fix).

## Metrics

- Files changed: 3 (2 source + 1 test)
- Lines added: 258
- Lines deleted: 1
- Test count: 4 (2 original + 2 added for zoe coverage gaps)
- Reviewers dispatched: 2 (ernie, zoe)
- Fix loop iterations: 0 (zoe WARN resolved by adding tests, no code fix needed)