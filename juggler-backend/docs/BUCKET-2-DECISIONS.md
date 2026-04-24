# Bucket 2 — Remaining Design Decisions

Three items from the Bucket 2 plan need your call before I touch code. This doc lays out each one and a recommendation.

---

## Issue #25 — UUIDv7 for ordinals

### What you asked
> Since UUIDv7 is sortable by creation time, can we use these for ordinals?

### Current state
`task_instances` has three integer ordinal columns:
- `occurrence_ordinal` — 1..N per master (N=1 for one-shots, 1..∞ for recurring)
- `split_ordinal` — 1..K within an occurrence (K=1 for unsplit, K≥2 for split chunks)
- `split_total` — K (the total chunk count)

Compound unique index: `(master_id, occurrence_ordinal, split_ordinal)`.

The insert trigger (migration `20260415010400`) assigns `occurrence_ordinal = MAX(...) + 1` on each recurring-instance insert. No recycling.

Ordinals are touched in **97 places** across `src/scheduler/*`, `src/lib/tasks-write.js`, `src/lib/reconcile-splits.js`, `src/mcp/tools/*`. They power:
- Compound uniqueness
- Split chunk ordering (chunk IDs are `<masterId>-YYYYMMDD-N`, where N is `split_ordinal`)
- "Preserve instance IDs + occurrence_ordinals across scheduler runs" — reconciliation logic in `reconcileOccurrences.js`
- Dedup queries, MAX lookups for next ordinal assignment

### Can UUIDv7 replace these?

**Sort-order equivalence — yes, partially.** UUIDv7 encodes a millisecond timestamp in its high bits, so IDs sort lexicographically in creation order. That's enough to replace *ordering* semantics.

**Compound uniqueness — no longer needed as a key.** UUIDv7 is globally unique, so `(master_id, UUID)` is unique by virtue of the UUID. The current `(master_id, occurrence_ordinal, split_ordinal)` constraint becomes moot.

**But:** the ordinals are not just sort keys. They're *semantic identifiers* — "the 5th time this habit has occurred" is a meaningful concept that UUIDs obliterate. If a user says "skip the next three instances," the scheduler needs to know *which three*. That's what `occurrence_ordinal` is for.

`split_ordinal` + `split_total` form a pair — "chunk 2 of 4" — that UUIDs can't replace at all. You need the cardinality.

### Recommendation: **don't adopt UUIDv7 for ordinals.**

Reasons:
1. Ordinals encode cardinality (1st, 2nd, 3rd) which UUIDs cannot.
2. 97 touchpoints in scheduler code, memory explicitly warns scheduler changes are high-risk.
3. The underlying pain point is #16 (very large ordinals) — that has simpler fixes.

**Alternative that addresses the real concern** (if you care about ID sortability): use UUIDv7 for **`task_instances.id`**, the primary key — which is already opaque and isn't read semantically. Migration `20260405100000_migrate_ids_to_uuidv7` suggests this direction has already been explored. Keep numeric ordinals for their semantic role.

**If you still want to adopt UUIDv7 for ordinals anyway:** it's a multi-week refactor. I'd recommend a separate branch, shadow-mode diff testing against the current scheduler, and full scheduler test pass before merge. Not safe to do as part of a Bucket 2 sweep.

### Decision needed
- [ ] Keep current ordinal scheme (recommended)
- [ ] Adopt UUIDv7 for instance `id` only (not ordinals) — confirm already done or schedule as separate work
- [ ] Replace all ordinals with UUIDv7 (I'd advise against)

---

## Issue #16 — Large `occurrence_ordinal` values

### What you asked
> I see very large `occurrence_ordinal` values in the db. why?

### Explanation
The insert trigger for recurring instances does:

```sql
SELECT COALESCE(MAX(occurrence_ordinal), 0) + 1 INTO v_ord
  FROM task_instances WHERE master_id = NEW.source_id;
```

No recycling. A daily habit running for 3 years accumulates ~1,100 ordinals. A "brush teeth" habit run twice daily for 5 years hits ~3,650. These are **expected**, not a bug — the ordinal is a permanent identity tag for "the Nth instance of this master."

### Options

**Option A — Keep monotonic (recommended).** Document as expected; large values are harmless. The int column is 4 bytes regardless of value. Any consumer that formats ordinals for display (there don't seem to be any — it's internal) would need to handle large numbers gracefully.

**Option B — Reset when older instances are purged.** If we ever add a "prune instances older than N months" job, reset counters at the same time. Requires the trigger to SELECT from the remaining rows — already does. Nothing to change today; just a plan for when pruning lands.

**Option C — Make ordinal window-relative.** E.g., "ordinal within recurrence-window-N." Changes the semantics of `occurrence_ordinal` from "Nth ever" to "Nth this year." More churn, no obvious benefit.

### Recommendation: **Option A** — document and leave as-is.

The large values are doing exactly what the schema promises. The issue only *looks* alarming because you hadn't realized the counter was monotonic. If you see a specific downstream bug caused by large values, that's a different conversation.

### Decision needed
- [ ] Accept — document in SCHEMA.md (I'll add a note)
- [ ] Reset on future purge (Option B) — record as a task for when pruning lands
- [ ] Make window-relative (Option C)

---

## Issues #17, #18, #19 — Drop text `date`/`day`/`time` from `task_instances`

### What you asked
> Why are there text 'date'/'day'/'time' in the db?

### Current state
`task_instances` has three VARCHAR columns:
- `date VARCHAR(10)` — `M/D` format
- `day VARCHAR(3)` — `Mon`, `Tue`, …
- `time VARCHAR(20)` — `9:00 AM`

All three are **derived local-timezone caches** of `scheduled_at`. Nothing breaks if the source is right and the caches are wrong — the scheduler's `rowToTask()` in `src/controllers/task.controller.js:246` derives `date`/`day`/`time` from `scheduled_at + user.timezone` at load time for user-anchored tasks, and the views (`tasks_v`, `tasks_with_sync_v`) don't expose the raw columns at all.

### Direct DB reads of the raw columns (search results)

| Location | What it does | Remediation to drop |
|---|---|---|
| `src/scheduler/runSchedule.js:150-153` | Terminal-dedup SELECT includes `'date'` | Already has `scheduled_at` fallback — remove `'date'` from select and rely on fallback |
| `src/scheduler/runSchedule.js:900-921` | Writes `date`/`day`/`time` on insert | Remove the three fields from the insert object |
| `src/mcp/tools/data.js:171-179` | Duplicate-detection groupBy `master_id, date` | Rewrite to group by `DATE(CONVERT_TZ(scheduled_at, 'UTC', u.timezone))` with users join |
| `src/lib/tasks-write.js:66, 116-118` | INSTANCE_UPDATE_FIELDS includes them; pickInstance writes if passed | Remove from list; remove from pickInstance |

### Risk
Memory says **scheduler bugs cascade and corrupt all task data**. While the change itself is mechanical, a missed call site means the scheduler silently reads null and places tasks wrong.

### Options

**Option A — Drop the columns entirely** (recommended long-term). One migration drops them; four files change; test suite + manual scheduler run to confirm.

**Option B — Leave as-is** (short-term safe). Document as derived caches; move on to higher-value work. Bucket 3 (`desired_at`/`desired_date` consolidation) will touch this region of code anyway — bundle the cleanup then.

**Option C — Convert to proper types instead of dropping.** `date DATE`, `time TIME`. Preserves the speed benefit (index lookups) while fixing the type. But the columns are timezone-naive caches; storing them as `DATE`/`TIME` doesn't improve correctness and still requires derivation on read in a different tz. Worst of both worlds.

### Recommendation

**Option B for now**, convert to **Option A during Bucket 3**. Rationale:

- The columns are currently harmless (they're caches; the source of truth is `scheduled_at`).
- Bucket 3 will rewrite `desired_at`/`desired_date` handling and touch the same code paths. Dropping the text columns in the same PR is cheaper than two separate scheduler-adjacent PRs.
- Isolated Bucket-2 scheduler changes carry the same deploy risk as combined Bucket-3 changes — there's no safety dividend from splitting.

### Decision needed
- [ ] Defer to Bucket 3 (recommended)
- [ ] Execute now as Option A
- [ ] Execute now as Option C

---

## Summary of what I've already done in Bucket 2

1. ✅ Wrote migration `20260426000000_drop_legacy_per_provider_ledgers` — drops `gcal_sync_ledger`, `msft_cal_sync_ledger`, `gcal_deleted_events` (verified zero live references).
2. ✅ Wrote migration `20260426000100_add_updated_at_audit_columns` — adds `updated_at` with `ON UPDATE CURRENT_TIMESTAMP` to `cal_sync_ledger`, `locations`, `tools`. Append-only and ephemeral tables intentionally excluded.

Both migrations are uncommitted. Run via `knex migrate:latest` when ready.

No schema changes have been run against a database.
