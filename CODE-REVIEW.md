# Code Review — expandRecurring.js + migration 20260519000100

## Summary
0 Critical, 2 Warning, 3 Info

---

## Findings

### [WARN] expandRecurring.js:243 — 'keep' policy now silently allows over-budget cycles

**Change:** `existingInCycle === 0 ? tpc : 0` → `Math.max(0, tpc - existingInCycle)`

**What the old code did:** If ANY existing instance was present in the cycle, zero new slots were opened. This was the "once touched, no refills" rule. The only way to get a full fresh tpc budget was on a cycle with zero existing instances.

**What the new code does:** It subtracts existingInCycle from tpc to determine remaining open slots. This is correct for the documented goal ("still fills remaining open slots up to the tpc target"), but it changes semantics in one meaningful edge case that existing tests do not cover:

**The gap:** A cycle where `existingInCycle > tpc` (i.e., the user somehow accumulated more booked dates than the tpc budget) will correctly produce `slotsNeeded = 0` via `Math.max(0, ...)`. However, `existingInCycle` counts both terminal (done/skip/cancel) and pending dates, and the `available` pick pool only excludes `bookedKeys`. So if existingInCycle = 5 and tpc = 4, the old code would produce 0 (a clean "cycle is user-owned" gate), while the new code also produces 0 via the clamp — behaviors match, no practical difference here.

**The actual behavioral change** is the partial-cycle case. Example: tpc=4, cycle has 1 skip and 0 pending. Old behavior: slotsNeeded = 0 (skip = owned = no refill). New behavior: slotsNeeded = 3 (4 - 1 = 3 open slots picked). This directly contradicts the existing test at line 449 ("cycle with 1 skip and 0 pending does not refill to tpc") which expects `toHaveLength(0)`.

**Run the tests immediately.** The test file at `juggler-backend/tests/expandRecurring.test.js` line 449 is asserted against the old behavior and will fail against the new implementation. The new comment in the source says "skip counts against the tpc budget just like done/pending" and "still fills remaining open slots up to the tpc target" — but these two statements contradict each other for the skip case. If skip counts fully against the budget, the needed-slots for a cycle with 1 skip and tpc=4 is 3, not 0.

**Decision required:** Either (a) the new behavior is intentional — skips count against the budget but empty slots are still filled — in which case the test at line 449 is wrong and must be updated to `toHaveLength(3)`, or (b) the intent is that skips fully consume the budget just as before, in which case the `keep` branch should remain `existingInCycle === 0 ? tpc : 0`. The comment in the diff ("prevents the skip→new pick→skip→loop") describes the old behavior, not the new one.

**Recommendation:** Before committing, run `npm test -- --testPathPattern=expandRecurring` and confirm whether line 449's test passes or fails. If it fails, resolve the contradiction intentionally — don't let the comment and the code disagree.

---

### [WARN] expandRecurring.js:229-243 — 'keep' vs 'backfill' semantic asymmetry introduced

The comment for `backfill` says "needed = tpc − fulfilled (non-skip booked)". The comment for `keep` now says "needed = tpc − all_booked (skip + done + pending + etc.)". These are now genuinely consistent formulas for their stated intents.

However, the pick pool at line 248 — `available = cycleCandidates.filter(cd => !bookedKeys[cd.key])` — excludes all booked keys from picking, in BOTH policies. Under `keep` with the new formula, if `slotsNeeded > 0` there are slots to fill, but `available` still correctly excludes already-booked dates. No double-booking is possible. This part is structurally sound.

The warning is that no test exercises the new `keep` partial-fill case (e.g., tpc=4, 2 done instances in cycle, expect 2 fresh picks). The existing tests only cover the old "any existing = zero refill" case. A missing test for the new partial-fill semantic means a regression in this exact path could go undetected.

**Recommendation:** Add a test: tpc=4, cycle with 2 done instances (non-skip, non-pending), expect 2 new picks to be generated.

---

### [INFO] migration 20260519000100 — All 7 weather columns verified in both UNION branches

Confirmed: `weather_precip`, `weather_cloud`, `weather_temp_min`, `weather_temp_max`, `weather_temp_unit`, `weather_humidity_min`, `weather_humidity_max` are present in both the recurring_template branch (lines 69-75) and the instance/task branch (lines 140-146). Column positions are identical across both branches, consistent with the UNION ALL contract.

---

### [INFO] migration 20260519000100 — COLLATE not applied to weather string columns; acceptable given column types

`weather_precip` and `weather_cloud` are ENUM columns on `task_masters`. `weather_temp_unit` is `CHAR(1)`. `weather_temp_min`, `weather_temp_max`, `weather_humidity_min`, `weather_humidity_max` are numeric. In a VIEW that selects from a base table, MySQL inherits the column collation from the underlying column definition. Explicit `COLLATE utf8mb4_unicode_ci` is only needed for computed literals (CONVERT/CAST expressions). The direct `m.weather_*` references are correct without explicit COLLATE. No issue here.

---

### [INFO] migration 20260519000100 — tasks_with_sync_v depends_on_json double-alias matches prior migrations

Line 192 uses `v.depends_on AS depends_on_json`. `tasks_v` already exposes `v.depends_on` as a named column, so this creates an alias of an alias. This pattern is present identically in `20260518000200` (line 171) and is intentional design — both `depends_on` and `depends_on_json` exist in `tasks_with_sync_v` for backward compatibility. Not a regression introduced here.

---

## Migration Structural Assessment

The migration correctly:
- Drops views in dependency order (tasks_with_sync_v before tasks_v)
- Uses a transaction wrapping all three steps (DROP + CREATE tasks_v + CREATE tasks_with_sync_v)
- Has a `down` that explicitly refuses rollback with a clear error (appropriate — re-dropping weather columns would re-introduce the scheduler bug)
- tasks_with_sync_v column order matches the prior migration shape, with weather columns inserted at the correct position after `v.tz`

No SQL syntax issues found. The UNION ALL structure is correct.

---

## Verdict: WARN

The migration (20260519000100) is clean — PASS.

The expandRecurring.js change is a WARN: the behavioral change to the `keep` policy has not been validated against the existing test suite. The test at line 449 of `expandRecurring.test.js` was written to assert the old behavior and appears to directly contradict the new implementation. This must be resolved (either update the test to match intentional new behavior, or revert the code change) before committing.
