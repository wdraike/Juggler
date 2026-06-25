'use strict';

/**
 * Restore unplaced_reason / unplaced_detail in the tasks_v view (BUG: 999, 2026-06-25).
 *
 * Root cause: migration 20260622020000 added `unplaced_reason`/`unplaced_detail`
 * to tasks_v (both UNION branches). A LATER migration,
 * 20260623000000_restore_end_date_in_tasks_v, recreated tasks_v from a HARDCODED
 * SQL block (UP_VIEW_SQL) that OMITS those two columns — so they silently vanished
 * from the view (the documented "a schema change that alters tasks_v must recreate
 * it FULLY" hazard). The `task_instances` TABLE still has both columns; only the
 * view lost them, so taskMappers.rowToTask reads `undefined` and the Unplaced view
 * never sees the persisted reason.
 *
 * Per juggler CLAUDE.md, an already-applied migration is immutable — so this is a
 * NEW migration that DROPs and recreates tasks_v with the FULL current column set
 * (end_date + completed_at + implied_deadline + everything else) PLUS the two
 * unplaced columns re-injected.
 *
 * Drift-proof (mirrors 20260622020000 + 20260603000000): read the LIVE view SQL
 * (`SHOW CREATE VIEW`) and regex-inject the two columns into BOTH UNION branches —
 * never hand-copy the 170-line def (the prod-migration-lag trap). The instance
 * branch maps `i.unplaced_reason`/`i.unplaced_detail`; the recurring-template
 * (master) branch maps NULL with explicit utf8mb4_unicode_ci collation, matching
 * the pattern of every other NULL master-branch text column.
 *
 * tasks_with_sync_v is intentionally NOT patched: no app read path for the
 * Unplaced/calendar views uses it (the task slice queries tasks_v directly), same
 * scope as 20260622020000 and the completed_at migration.
 *
 * DDL (CREATE/DROP VIEW) causes MySQL implicit commits — non-transactional so knex
 * does not wrap in a misleading transaction.
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  const viewResult = await knex.raw('SHOW CREATE VIEW tasks_v');
  const currentViewSql = viewResult[0][0]['Create View'];

  // Idempotent: already exposed → nothing to do.
  if (/unplaced_reason/i.test(currentViewSql)) return;

  // Instance branch — insert before `from (task_instances`.
  let sql = currentViewSql.replace(
    /(\s+from\s+\(\s*`?task_instances`?)/i,
    ',`i`.`unplaced_reason` AS `unplaced_reason`,`i`.`unplaced_detail` AS `unplaced_detail`$1'
  );

  // Template (recurring_template / master) branch — insert before
  // `from task_masters m where`. NULL with explicit utf8mb4 collation matches the
  // other NULL master-branch text columns (e.g. source_id, status, split_group).
  sql = sql.replace(
    /(\s+from\s+`?task_masters`?\s+`?m`?\s+where)/i,
    ",(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS `unplaced_reason`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS `unplaced_detail`$1"
  );

  // Both branches MUST have injected (instance via `i.`, template via NULL).
  if (!/`i`\.`unplaced_reason`/i.test(sql) || !/NULL\s+using\s+utf8mb4\)\s+collate\s+utf8mb4_unicode_ci\)\s+AS\s+`unplaced_reason`/i.test(sql)) {
    throw new Error(
      '[20260625000000] failed to inject unplaced_reason into BOTH tasks_v UNION ' +
      'branches — a FROM anchor was not found in the live view SQL. Inspect ' +
      '`SHOW CREATE VIEW tasks_v` and update the regex; do NOT recreate the view unchanged.'
    );
  }

  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.raw(sql);
};

exports.down = async function down(knex) {
  const viewResult = await knex.raw('SHOW CREATE VIEW tasks_v');
  const currentViewSql = viewResult[0][0]['Create View'];

  const sql = currentViewSql
    .replace(/,\s*\n?\s*`?i`?\.`?unplaced_reason`?\s+AS\s+`?unplaced_reason`?/i, '')
    .replace(/,\s*\n?\s*`?i`?\.`?unplaced_detail`?\s+AS\s+`?unplaced_detail`?/i, '')
    .replace(/,\s*\n?\s*\(convert\(NULL\s+using\s+utf8mb4\)\s+collate\s+utf8mb4_unicode_ci\)\s+AS\s+`?unplaced_reason`?/i, '')
    .replace(/,\s*\n?\s*\(convert\(NULL\s+using\s+utf8mb4\)\s+collate\s+utf8mb4_unicode_ci\)\s+AS\s+`?unplaced_detail`?/i, '');

  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.raw(sql);
};
