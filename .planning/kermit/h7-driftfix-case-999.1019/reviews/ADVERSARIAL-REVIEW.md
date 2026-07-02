# Adversarial QA Review — 999.1019 split_ordinal/split_total CASE branches

**Reviewer:** zoe  
**Leg:** h7-driftfix-case-999.1019  
**Status:** ⚠️ WARN  
**Date:** 2026-07-02  

## Scope

Audited the integration test `juggler-backend/tests/w1-split-ordinal-case.integration.test.js` and the fix at `KnexScheduleRepository.js` lines 153–170 (split_ordinal/split_total CASE branches in the batched writeChanged path).

## Verdict

The fix is correct and **IT-SPLIT-a is a valid mutation proof** for it. However, the mutation-proof claim is **overstated for IT-SPLIT-b**, and there are **three meaningful coverage gaps** in the batched-path test surface. Status: WARN (not BLOCK — the fix itself is proven, but the test suite doesn't fully cover the batched path's real-world shapes).

## Findings

### Z1 — INFO: IT-SPLIT-a correctly exercises the batched-CASE path ✅

The delta carries `dur: 45`, which satisfies the routing guard at line 112:
```js
if ((pu.dbUpdate.scheduled_at || pu.dbUpdate.dur) && !pu.dbUpdate.status) {
  scheduledAtUpdates.push(pu);  // → batched CASE path
}
```
The new CASE branches at lines 160–171 fire inside that loop. The test asserts all three columns (dur, split_ordinal, split_total) are persisted. This is a legitimate integration test of the fix.

### Z2 — WARN: IT-SPLIT-b does NOT exercise the fix; mutation-proof claim is overstated ⚠️

IT-SPLIT-b's delta carries only `split_ordinal: 2, split_total: 1, updated_at` — **no `scheduled_at`, no `dur`**. The routing guard evaluates `(undefined || undefined) = falsy` → routes to **`otherUpdates`** (the per-row path via `updateTaskById`).

The fix (lines 160–171) lives **exclusively** inside the `scheduledAtUpdates` batched loop. It never touches the `otherUpdates` path. The per-row path has **always** handled split fields generically:
- `updateTaskById` → `splitUpdateFields(changes)` → routes by `INSTANCE_UPDATE_FIELDS` (line 77 includes `split_ordinal`, `split_total`) → `db('task_instances').where(...).update(split.instance)`

**Therefore, reverting the fix should NOT cause IT-SPLIT-b to fail.** The claim that "reverting the fix causes both tests to FAIL" is likely inaccurate for IT-SPLIT-b. IT-SPLIT-b is a regression test for the per-row path (which was never broken), not a mutation proof for the batched-path fix.

**Recommendation:** Re-run the mutation with only IT-SPLIT-b to confirm. If it passes with the fix reverted (as the code analysis indicates), correct the proof claim. IT-SPLIT-b is not worthless — it confirms the per-row path isn't broken — but it should not be counted as mutation proof for this fix.

### Z3 — WARN: Coverage gap — `scheduled_at + split_ordinal` without `dur` ⚠️

A delta carrying `scheduled_at` (truthy) routes to the batched path **even without `dur`**. The fix's CASE branches use `pu.dbUpdate[col] != null`, which is independent of the dur CASE filter (`!!pu.dbUpdate.dur` at line 144). So split_ordinal/split_total should still be written. But **no test proves this** — the only batched-path test (IT-SPLIT-a) includes dur.

This is a realistic drift-fix shape: reschedule a split chunk (change scheduled_at) and update its split metadata, without changing dur. A test for this combination would prove the CASE branches fire independently of the dur branch.

### Z4 — WARN: Coverage gap — multi-row delta (the actual batched use case) ⚠️

The batched CASE path exists to update **N rows in one UPDATE** via `CASE id WHEN ? THEN ?` expressions. Both tests send **single-row deltas**, which exercise the CASE mechanics trivially (one WHEN clause).

A multi-row delta (e.g., 2–3 instances with different split_ordinal values) would prove the CASE expressions correctly map multiple ids to their respective values — the real production shape and the scenario most likely to surface a binding/ordering bug. This is the path's entire reason for existence, and it's untested at the multi-row level.

### Z5 — INFO: Edge cases not covered

- **Mixed null/non-null split fields:** e.g., `split_ordinal` present but `split_total` absent from the delta. The fix's `!= null` filter correctly skips the absent field. Untested.
- **`split_ordinal: 0`:** A valid ordinal value. The fix uses `!= null` (correct — `0 != null` is `true`), unlike the dur path which uses `!!` (line 144, which would drop `dur: 0` — a pre-existing inconsistency, not introduced by this fix). A test with `split_ordinal: 0` would prove the fix's guard is correctly stricter than the dur guard.
- **`split_total` changed without `split_ordinal`:** Not tested specifically.

### Z6 — INFO: Test hygiene is good ✅

- `USER_ID = 'w1-split-case-user'` — namespaced, no collision risk.
- `beforeAll`: cleanup → insert user. `beforeEach`: resets task_instances/task_masters per test (no cross-test pollution). `afterAll`: cleanup + `db.destroy()`.
- `db.destroy()` could theoretically affect parallel test files sharing the `../src/db` singleton, but Jest worker isolation (separate process per file) makes this safe in practice.
- No test pollution observed.

### Z7 — INFO: Dead-code guard

The `if (!available) return` guard at the top of each test is effectively dead code. `assertDbAvailable()` throws TEST-FR-001 if the DB is down → `beforeAll` rejects → Jest fails all tests in the suite. The guard never executes. Not harmful, but redundant given the `assertDbAvailable` contract.

## Proof Checklist

| Check | Result |
|-------|--------|
| Test audited against fix code path | ✅ Yes — traced routing + CASE branches |
| Mutation proof verified | ⚠️ Partial — valid for IT-SPLIT-a; overstated for IT-SPLIT-b (likely doesn't fail with fix reverted) |
| Coverage gaps checked | ✅ Yes — found 3 (scheduled_at+split, multi-row, edge values) |
| Edge cases checked | ✅ Yes — split_ordinal:0, mixed null/non-null, split_total-only |

## Summary

The fix (split_ordinal/split_total CASE branches in the batched writeChanged path) is **correct and proven by IT-SPLIT-a**. The `!= null` guard is appropriately stricter than the legacy `!!` guard on dur. However:

1. **IT-SPLIT-b is mischaracterized as a mutation proof** — it routes to the per-row path, which the fix doesn't touch. Reverting the fix likely leaves IT-SPLIT-b green.
2. **The batched path's multi-row shape is untested** — both tests send single-row deltas, missing the CASE mechanic's real complexity.
3. **The `scheduled_at + split` (no dur) combination is untested** — a realistic drift-fix shape that routes to the batched path but doesn't include the dur trigger.

Recommend: add a multi-row batched test and a scheduled_at-triggered split test; re-verify the IT-SPLIT-b mutation claim and correct the proof documentation if needed.