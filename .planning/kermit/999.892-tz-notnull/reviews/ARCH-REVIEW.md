# ARCH-REVIEW — 999.892-tz-notnull (juggler)

**Reviewer:** cookie (architecture / migration-schema safety)
**Mode:** bugfix · **Depth:** standard
**Target:** `juggler-backend/src/db/migrations/20260626000000_users_timezone_not_null.js`
**Date:** 2026-06-26

## Status
DONE

## Summary
Single-file new migration making `users.timezone` NOT NULL. All six requested schema/migration-safety checks pass. No BLOCK, no WARN. Two informational notes on prod application. The migration is correct, reversible, and idempotent across up→down→up.

## Findings

### BLOCK (0)
None.

### WARN (0)
None.

### INFO (2)

- **INFO-1 — Prod ALTER lock (acceptable).** In MySQL 8, `ALTER TABLE … MODIFY` changing nullability is an INPLACE/rebuild operation that briefly holds a metadata lock. The juggler `users` table is effectively single-/low-row (one primary operator + shared Cloud SQL instance DB_NAME=juggler), so the lock window is negligible. No online-DDL strategy needed. This leg exercises only test-bed 3407; when the migration is later applied to prod via the `migrate-guard.js` opt-in (`ALLOW_PROD_MIGRATE=1`), no maintenance window is required.
- **INFO-2 — Backfill/ALTER not co-transactional (harmless).** MySQL DDL (`ALTER`) forces an implicit commit, so the knex-default transaction wrapper cannot atomically bind the `UPDATE` backfill and the `ALTER`. This is benign here: the `UPDATE whereNull` runs and commits strictly before the `ALTER`, which is exactly the required ordering. A concurrent INSERT of a NULL timezone between the two statements is not possible — the column already carries `DEFAULT 'America/New_York'`, so no new NULL row can appear.

## Proof Checklist

- [x] **1. Ordering** — `20260626000000_…` sorts lexicographically AFTER the current latest `20260625000000_restore_unplaced_reason_in_tasks_v.js`; directory listing confirms it is the last `.js` migration in the chain. Applies cleanly last.
- [x] **2. Backfill-before-ALTER** — `up()` line 22 runs `knex('users').whereNull('timezone').update({ timezone: 'America/New_York' })` BEFORE the NOT NULL `ALTER` on lines 25–27. No existing NULL row can fail the constraint.
- [x] **3. Collation explicit** — `ALTER … MODIFY timezone VARCHAR(100) NOT NULL DEFAULT 'America/New_York' COLLATE utf8mb4_unicode_ci` (line 26). Matches the monorepo convention; raw SQL (not knex `.alter()`) is correctly used precisely to preserve collation, with the rationale documented in the file header.
- [x] **4. Reversibility** — `down()` (lines 32–34) issues `MODIFY … VARCHAR(100) NULL DEFAULT 'America/New_York' COLLATE utf8mb4_unicode_ci`. This restores the original column shape from `20260301000000_initial_schema.js` (`table.string('timezone', 100).defaultTo('America/New_York')` — nullable VARCHAR(100), same default). The only delta vs. pristine origin is an explicit collation, which is an improvement, not data loss. Column is NOT dropped; no data lost. up→down→up is clean and idempotent.
- [x] **5. tasks_v view shape** — Verified across all view-recreate migrations (`…add_completed_at_to_tasks_v_view`, `…expose_unplaced_reason_in_tasks_v`, `…restore_unplaced_reason_in_tasks_v`): no `tasks_v` definition joins `users` or selects `users.timezone`. `users.timezone` is not a column of `tasks_v`. Per juggler CLAUDE.md policy, a view DROP+RECREATE is therefore NOT required, and the migration correctly omits one.
- [x] **6. Prod-safety** — Shared Cloud SQL concern reviewed; ALTER lock is negligible for a tiny `users` table (INFO-1). Migration is safe to later apply to prod via the `ALLOW_PROD_MIGRATE=1` guarded path. No prod-blocking concern.

## Evidence
- Original column def: `20260301000000_initial_schema.js:13` — `table.string('timezone', 100).defaultTo('America/New_York')`.
- Chain tail (directory listing): `20260625000000_…` then `20260626000000_users_timezone_not_null.js` (last).
- `tasks_v` view migrations grep: zero `JOIN users` / `users.timezone` references.
