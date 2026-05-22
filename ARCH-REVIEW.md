# Architecture Review — migration 20260519000100

**File:** `juggler-backend/src/db/migrations/20260519000100_restore_weather_columns_to_tasks_v.js`
**Reviewer:** cookie-monster-architect
**Date:** 2026-05-19

---

## Decision: PASS

---

## Findings

### [INFO] migration:25-26 — Drop order is correct

`tasks_with_sync_v` is dropped before `tasks_v`, which is the correct dependency order (tasks_with_sync_v JOINs tasks_v; dropping in reverse order would fail if MySQL ever enforces view dependencies). Matches the pattern established in every prior view-rebuild migration in this codebase.

### [INFO] migration:69-75 and 140-146 — All 7 weather columns present in both UNION branches

Verified by inspection:
- Branch 1 (recurring_template rows, lines 69–75): all 7 columns present after `m.tz`.
- Branch 2 (task_instances JOIN task_masters, lines 140–146): all 7 columns present after `m.tz`.

Column names match `rowToTask()` in `task.controller.js` (lines 409–415) exactly:
- `row.weather_precip` → `weather_precip`
- `row.weather_cloud` → `weather_cloud`
- `row.weather_temp_min` → `weather_temp_min`
- `row.weather_temp_max` → `weather_temp_max`
- `row.weather_temp_unit` → `weather_temp_unit`
- `row.weather_humidity_min` → `weather_humidity_min`
- `row.weather_humidity_max` → `weather_humidity_max`

`hasWeatherConstraint()` and `weatherOk()` in `unifiedScheduleV2.js` (lines 780–820) consume `task.weatherPrecip`, `task.weatherCloud`, `task.weatherTempMin`, `task.weatherTempMax`, `task.weatherHumidityMin`, `task.weatherHumidityMax` — all populated via `rowToTask()` which reads the snake_case aliases above. Field alignment is correct.

### [INFO] migration:187-188 — tasks_with_sync_v includes all 7 weather columns

`tasks_with_sync_v` SELECT (line 187–188) includes `v.weather_precip, v.weather_cloud, v.weather_temp_min, v.weather_temp_max, v.weather_temp_unit, v.weather_humidity_min, v.weather_humidity_max`. The view propagates weather data correctly to MCP tool consumers that query `tasks_with_sync_v`.

### [INFO] collation — COLLATE utf8mb4_unicode_ci applied to all character columns; numeric weather columns exempt by type

Character string literal and NULL-cast string columns correctly use `CONVERT(... USING utf8mb4) COLLATE utf8mb4_unicode_ci` or `CAST(NULL AS CHAR(3)) COLLATE utf8mb4_unicode_ci`.

The 7 weather columns draw directly from `task_masters` columns:
- `weather_precip` — ENUM (character), inherits table collation from task_masters; view alias carries the table's collation implicitly. No NULL literal involved, so no explicit COLLATE needed (and this matches the pattern in the original 20260505002000 and 20260506000600 migrations).
- `weather_cloud` — same, ENUM.
- `weather_temp_min`, `weather_temp_max` — SMALLINT. Numeric, no collation concern.
- `weather_temp_unit` — CHAR(1). Same as ENUM case; inherited from table definition.
- `weather_humidity_min`, `weather_humidity_max` — TINYINT UNSIGNED. Numeric, no collation concern.

No collation gap introduced by this migration.

### [INFO] migration:220-225 — down() throws intentionally

The error message explicitly names the danger: rolling back would re-introduce the scheduler weather-constraint bypass. This is architecturally appropriate. The pattern is consistent with `20260518000200` and `20260518000300` which also throw on down(). No irreversible data loss occurs (the view is reconstructable); the throw prevents accidental regression.

### [INFO] migration:22 — Transaction wrapping is appropriate but note DDL implicit-commit caveat

The migration wraps all statements in `knex.transaction()`. MySQL DDL (CREATE/DROP VIEW) issues an implicit COMMIT, so the transaction does not provide true rollback atomicity for the view operations. This is the same caveat noted in `20260518000300`'s JSDoc. For views-only migrations this is acceptable: a mid-migration failure leaves the DB without the views (both are dropped before recreating), and Knex's migration runner will report the failed migration as unapplied so it can be re-run. No data loss risk. The wrapping is still good practice for consistency and for any future non-DDL statements that might be added.

### [INFO] dependency check — 20260518000300 superseded by this migration

`20260518000300_drop_preferred_time_column.js` also rebuilds both views, and it copied its view SQL verbatim from `20260518000200` (without weather columns). Since 20260519000100 has a later timestamp it runs last and leaves the views in the correct state. No subsequent migration exists that would overwrite the weather columns again.

### [WARN] migration:192 — depends_on_json in tasks_with_sync_v uses v.depends_on (not v.depends_on_json)

In `tasks_with_sync_v` line 192:
```sql
v.split_group, v.`generated`, v.depends_on AS depends_on_json,
```
This aliases `v.depends_on` as `depends_on_json` rather than passing through `v.depends_on_json` from `tasks_v`. This means `tasks_with_sync_v.depends_on_json` and `tasks_with_sync_v.depends_on` are identical (both read from the same underlying column). This is not a regression — it is identical to the pattern in `20260518000200` (line 171) and `20260518000300` (line 183). The redundancy is pre-existing and harmless; app code that reads `depends_on_json` via `tasks_with_sync_v` will still get the correct data. Flagged for awareness only; no fix required in this migration.

---

## Summary

| Check | Result |
|-------|--------|
| Drop order (tasks_with_sync_v before tasks_v) | PASS |
| All 7 weather columns in UNION branch 1 | PASS |
| All 7 weather columns in UNION branch 2 | PASS |
| All 7 weather columns in tasks_with_sync_v | PASS |
| Column aliases match rowToTask() field names | PASS |
| Column aliases match hasWeatherConstraint() / weatherOk() field names | PASS |
| COLLATE utf8mb4_unicode_ci on all character columns | PASS |
| down() throws (architecturally appropriate) | PASS |
| No later migration overwrites the views | PASS |
| depends_on_json aliasing | WARN (pre-existing, not a regression) |
