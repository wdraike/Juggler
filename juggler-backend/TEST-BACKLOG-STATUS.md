# Test Baseline - Juggler Backend

**Generated:** 2026-05-30  
**Task:** t_ddf00018

## Summary

| Metric | Count |
|--------|-------|
| Test Suites | 119 total |
| Passed | 47 |
| Failed | 69 |
| Skipped | 3 (out of 116 processed) |
| Tests | 1155 total |
| Passing | 860 |
| Failing | 280 |
| Skipped | 15 |

## Test Results Log

```
Test Suites: 69 failed, 3 skipped, 47 passed, 116 of 119 total
Tests:       280 failed, 15 skipped, 860 passed, 1155 total
Snapshots:   0 total
Time:        146.825 s
```

## Build Notes

### Migration Fixes Applied (2026-05-30)

1. **20260526000000_drop_pinned_and_rigid_columns.js** - Made column drops idempotent
   - Added `hasColumn` checks before dropping `date_pinned`, `prev_when`, and `rigid` columns
   - Previously failed on fresh DBs because columns don't exist in fresh test schema
   
2. **20260530000000_create_cal_history_schema.js** - Fixed collation mismatch
   - Added `.collate('utf8mb4_unicode_ci')` to `task_id` column to match `task_instances.id`
   - Previously failed with "foreign key columns are incompatible" error

### Known Failures

The following test categories have failures due to missing dependencies:

| Category | Count | Issue |
|----------|-------|-------|
| `@resume-optimizer/lib-logger` | ~50+ | Cannot find module - affects many API/controller tests |
| `taskFactory.create` | ~5 | TypeError in task.adapter.test.js |
| Missing files | ~10 | `src/lib/task-status` not found, etc. |
| Migration-specific | ~2 | `rigid` column removed but tests still reference it |
| Logger undefined | ~2 | `logger is not defined` in cron scripts |
| Other | ~200+ | Various test-specific issues |

## Pass Rate

- **Test Suites:** ~41% passing (47/116)
- **Tests:** ~75% passing (860/1155)

## Next Steps

1. Install missing `@resume-optimizer/lib-logger` package or add mock
2. Fix `taskFactory.create` in adapter tests
3. Update tests referencing removed `rigid` column
4. Define `logger` in `cal-history-cron.js`
