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
 * FIX 999.825: tasks_with_sync_v is also recreated here because dropping tasks_v
 * invalidates the dependent tasks_with_sync_v view (ERROR 1356). The sync view
 * shape matches 20260623000000's SYNC_V_SQL.
 *
 * DDL (CREATE/DROP VIEW) causes MySQL implicit commits — non-transactional so knex
 * does not wrap in a misleading transaction.
 */

exports.config = { transaction: false };

// tasks_with_sync_v DDL — same shape as 20260623000000 SYNC_V_SQL
const SYNC_V_SQL = `CREATE VIEW \`tasks_with_sync_v\` AS
  SELECT
    v.id, v.user_id, v.task_type, v.text, v.dur, v.pri, v.project, v.section,
    v.notes, v.url, v.location, v.tools, v.\`when\`, v.day_req, v.recurring,
    v.time_flex, v.flex_when, v.split, v.split_min, v.recur, v.recur_start,
    v.recur_end, v.end_date, v.marker, v.preferred_time_mins, v.placement_mode,
    v.travel_before, v.travel_after,
    v.depends_on, v.desired_at, v.disabled_at, v.disabled_reason,
    v.deadline, v.start_after_at, v.tz,
    v.weather_precip, v.weather_cloud, v.weather_temp_min, v.weather_temp_max,
    v.weather_temp_unit, v.weather_humidity_min, v.weather_humidity_max,
    v.source_id, v.scheduled_at,
    v.\`date\`, v.\`day\`, v.\`time\`, v.\`status\`, v.time_remaining,
    v.unscheduled, v.overdue, v.slack_mins, v.occurrence_ordinal, v.split_ordinal, v.split_total,
    v.split_group, v.\`generated\`, v.depends_on AS depends_on_json,
    v.created_at, v.updated_at, v.master_id,
    gcl.provider_event_id AS gcal_event_id,
    mcl.provider_event_id AS msft_event_id,
    acl.provider_event_id AS apple_event_id
  FROM tasks_v v
  LEFT JOIN (
    SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
    FROM cal_sync_ledger
    WHERE status = 'active' AND provider = 'gcal' AND task_id IS NOT NULL
    GROUP BY task_id
  ) gcl ON gcl.task_id = v.id
  LEFT JOIN (
    SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
    FROM cal_sync_ledger
    WHERE status = 'active' AND provider = 'msft' AND task_id IS NOT NULL
    GROUP BY task_id
  ) mcl ON mcl.task_id = v.id
  LEFT JOIN (
    SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
    FROM cal_sync_ledger
    WHERE status = 'active' AND provider = 'apple' AND task_id IS NOT NULL
    GROUP BY task_id
  ) acl ON acl.task_id = v.id`;

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

  // Drop dependent view first, then the base view
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  // Recreate tasks_v with unplaced columns injected
  await knex.raw(sql);
  // Recreate tasks_with_sync_v (was invalidated by the DROP)
  await knex.raw(SYNC_V_SQL);
};

exports.down = async function down(knex) {
  const viewResult = await knex.raw('SHOW CREATE VIEW tasks_v');
  const currentViewSql = viewResult[0][0]['Create View'];

  const sql = currentViewSql
    .replace(/,\s*\n?\s*`?i`?\.`?unplaced_reason`?\s+AS\s+`?unplaced_reason`?/i, '')
    .replace(/,\s*\n?\s*`?i`?\.`?unplaced_detail`?\s+AS\s+`?unplaced_detail`?/i, '')
    .replace(/,\s*\n?\s*\(convert\(NULL\s+using\s+utf8mb4\)\s+collate\s+utf8mb4_unicode_ci\)\s+AS\s+`?unplaced_reason`?/i, '')
    .replace(/,\s*\n?\s*\(convert\(NULL\s+using\s+utf8mb4\)\s+collate\s+utf8mb4_unicode_ci\)\s+AS\s+`?unplaced_detail`?/i, '');

  // Drop dependent view first, then the base view
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.raw(sql);
  await knex.raw(SYNC_V_SQL);
};
