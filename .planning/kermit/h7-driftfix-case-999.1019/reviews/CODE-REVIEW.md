# Code Review — 999.1019 (ernie, code logic)

**Leg:** h7-driftfix-case-999.1019
**Mode:** bugfix
**Reviewer:** ernie
**Commits:** `09b2b4e..596a008b9` (single commit: `596a008 fix(scheduler): add split_ordinal/split_total CASE branches to writeChanged + INSTANCE_UPDATE_FIELDS`)
**Status:** **PASS**

## What the fix does

The drift-fix path in `runSchedule.js` (lines 1295–1303) emits batched `CASE id WHEN ? THEN ? ... ELSE \`col\` END` expressions for `split_ordinal`, `split_total`, and `dur` together. When that same drift-fix delta is routed through `KnexScheduleRepository.writeChanged`'s batched-CASE path (triggered by the presence of `dur` or `scheduled_at` at line 112), the batched path only emitted CASEs for `scheduled_at`, `dur`, `date`, `day`, `time` — silently dropping `split_ordinal` and `split_total`. This desynced split-chunk metadata for every instance touched by a drift-fix.

The fix adds a `['split_ordinal', 'split_total'].forEach(...)` block that mirrors the legacy CASE emission, and registers both columns in `INSTANCE_UPDATE_FIELDS` so the per-row `otherUpdates` path (via `updateTaskById`) also persists them.

## Files reviewed

| File | Change |
|------|--------|
| `juggler-backend/src/lib/tasks-write.js` | Added `'split_ordinal', 'split_total'` to `INSTANCE_UPDATE_FIELDS` (line 77) |
| `juggler-backend/src/slices/scheduler/adapters/KnexScheduleRepository.js` | Added CASE forEach for split_ordinal/split_total (lines 156–171) |
| `juggler-backend/tests/w1-split-ordinal-case.integration.test.js` | New integration test: IT-SPLIT-a (batched path) + IT-SPLIT-b (per-row path) |

## Findings

### E1 — Pattern faithfulness (INFO)
The new `forEach` at line 160 is a near-verbatim port of the legacy drift-fix CASE emission at `runSchedule.js:1295-1303`: same hardcoded array, same `!= null` filter, same `CASE id ... WHEN ? THEN ? ... ELSE \`col\` END` shape, same `trx.raw(expr, bindings)` call. The comment header (lines 156–159) correctly cites the legacy source lines.

### E2 — SQL injection (INFO, safe)
The column name is interpolated via `'ELSE \`' + col + '\` END'` (line 169), but `col` originates from the hardcoded literal `['split_ordinal', 'split_total']` on line 160 — never user input. No injection surface. Backtick-quoting matches both the legacy code (line 1301) and the existing `dateChunk` pattern (lines 183–185, where backticks are required because `date` is a MySQL reserved word).

### E3 — Null handling (INFO, correct)
- `pu.dbUpdate[col] != null` (line 161) filters to only rows that actually carry the split column. This correctly **includes** falsy-but-present values (e.g. `split_total: 0`) and **excludes** both `undefined` and `null`.
- Rows in the chunk that do NOT carry the column fall through to the `ELSE \`col\`` clause, preserving their existing DB value — no accidental nulling.
- `splitChunk.length === 0` early return (line 162) skips emitting a no-op CASE when no row in the chunk carries the column.

### E4 — Routing consistency (INFO)
A delta enters the batched path when `(pu.dbUpdate.scheduled_at || pu.dbUpdate.dur) && !pu.dbUpdate.status` (line 112). Drift-fix deltas carry `dur`, so they correctly route here. Deltas carrying split columns WITHOUT `dur`/`scheduled_at` route to the per-row `otherUpdates` path (lines 203–206), which handles all `dbUpdate` fields generically via `updateTaskById` — confirmed by IT-SPLIT-b. No path drops the split columns.

### E5 — INSTANCE_UPDATE_FIELDS (INFO)
Adding `split_ordinal`/`split_total` to `INSTANCE_UPDATE_FIELDS` (line 77) is necessary, not redundant: this is the allowlist that `updateTaskById`/`updateTasksWhere` consult when `instanceOnly: true`. Without these entries the per-row path would also silently strip the split columns. The fix correctly addresses both code paths.

### E6 — Test quality (INFO, strong)
- **IT-SPLIT-a** seeds `split_ordinal=1 / split_total=2 / dur=30`, applies a drift-fix-shaped delta (`dur=45, split_ordinal=2, split_total=3`) that routes to the batched path via `dur`, and asserts all three columns changed — directly proving the CASE branches fire.
- **IT-SPLIT-b** applies a split-only delta (no `dur`/`scheduled_at`) routing to `otherUpdates` and asserts the per-row path persists split columns too, with `dur` unchanged.
- **Mutation proof** documented in the test header: remove the split_ordinal/split_total CASE `forEach` → `afterInstance.split_ordinal` stays at seeded value `1`, not delta value `2` → RED.
- before/after state asserted; cleanup in `beforeAll`/`afterAll`/`beforeEach`; `assertDbAvailable` reachability guard per TEST-FR-001.

### E7 — Out-of-scope note (INFO)
The pre-existing `dur` CASE branch at line 144 uses `!!pu.dbUpdate.dur` (truthy filter), which would skip a legitimate `dur: 0`. The new split branches correctly use `!= null` instead, matching the legacy code. This is not a defect in this fix — noted only for a future cleanup of the `dur` branch.

## Proof checklist

| Check | Result |
|-------|--------|
| Code reviewed | ✅ |
| Logic correct (parameterization, null handling, ELSE clause, empty-chunk guard) | ✅ |
| Pattern consistent with legacy `runSchedule.js:1295-1303` and existing dur/date CASEs | ✅ |
| Test quality verified (mutation proof, both paths, state assertions) | ✅ |

## Verdict

**PASS.** The fix is logically correct, faithfully mirrors the legacy drift-fix CASE pattern, is free of SQL-injection risk (hardcoded column names), handles null/falsy edge cases correctly, and is backed by an integration test with a documented mutation proof that exercises both the batched and per-row write paths.