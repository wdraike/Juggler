'use strict';

/**
 * Restore end_date in tasks_v and fix ER_VIEW_INVALID on tasks_with_sync_v (RC1, 999.816).
 *
 * Root cause: migration 20260614010000 recreated tasks_v with a hardcoded UP_VIEW_SQL
 * that preserved completed_at but OMITTED end_date (which 20260527230000 had added).
 * tasks_with_sync_v reads v.end_date — MySQL marks it ER_VIEW_INVALID (1356) on every
 * read because the underlying view no longer exposes that column.
 *
 * Fix:
 *   1. DROP VIEW IF EXISTS tasks_with_sync_v (dependent view first)
 *   2. DROP VIEW IF EXISTS tasks_v
 *   3. CREATE VIEW tasks_v  — live DDL captured 2026-06-23, with m.end_date / i.end_date
 *      surgically inserted after recur_end in both UNION branches; completed_at and
 *      implied_deadline preserved verbatim from the live DDL.
 *   4. CREATE VIEW tasks_with_sync_v — 20260527230000 STEP-4 shape, which projects
 *      v.end_date and the gcal/msft/apple ledger LEFT JOINs.
 *
 * Column ordering in tasks_v (both branches): ... recur_end, end_date, marker, ...
 * This matches the column order established by 20260527230000.
 *
 * DDL (CREATE/DROP VIEW) causes MySQL implicit commits.
 * Declaring non-transactional so knex does not wrap in a misleading transaction.
 */
exports.config = { transaction: false };

// ---------------------------------------------------------------------------
// Shared tasks_with_sync_v DDL (same shape as 20260527230000 STEP-4)
// Must be recreated on both up() and down() since we DROP tasks_v either way.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// UP — tasks_v with end_date restored (+ completed_at + implied_deadline kept)
//
// Base: live DDL captured 2026-06-23 via SHOW CREATE VIEW tasks_v on juggler_fixy_test
// (that DDL has completed_at + implied_deadline from 20260614010000 + 20260621000000,
//  but lacks end_date because 20260614010000 hardcoded its DDL without it).
// Surgical change: insert `m.end_date AS end_date` / `i.end_date AS end_date`
// after recur_end in each UNION branch, before the `marker` CASE expression.
// ---------------------------------------------------------------------------
const UP_VIEW_SQL = `CREATE VIEW \`tasks_v\` AS select \`m\`.\`id\` AS \`id\`,\`m\`.\`user_id\` AS \`user_id\`,(convert('recurring_template' using utf8mb4) collate utf8mb4_unicode_ci) AS \`task_type\`,\`m\`.\`text\` AS \`text\`,\`m\`.\`dur\` AS \`dur\`,\`m\`.\`pri\` AS \`pri\`,\`m\`.\`project\` AS \`project\`,\`m\`.\`section\` AS \`section\`,\`m\`.\`notes\` AS \`notes\`,\`m\`.\`url\` AS \`url\`,\`m\`.\`location\` AS \`location\`,\`m\`.\`tools\` AS \`tools\`,\`m\`.\`when\` AS \`when\`,\`m\`.\`day_req\` AS \`day_req\`,\`m\`.\`recurring\` AS \`recurring\`,\`m\`.\`time_flex\` AS \`time_flex\`,\`m\`.\`flex_when\` AS \`flex_when\`,\`m\`.\`split\` AS \`split\`,\`m\`.\`split_min\` AS \`split_min\`,\`m\`.\`recur\` AS \`recur\`,\`m\`.\`recur_start\` AS \`recur_start\`,\`m\`.\`recur_end\` AS \`recur_end\`,\`m\`.\`end_date\` AS \`end_date\`,(case when (\`m\`.\`placement_mode\` = 'reminder') then 1 else 0 end) AS \`marker\`,\`m\`.\`preferred_time_mins\` AS \`preferred_time_mins\`,\`m\`.\`placement_mode\` AS \`placement_mode\`,\`m\`.\`travel_before\` AS \`travel_before\`,\`m\`.\`travel_after\` AS \`travel_after\`,\`m\`.\`depends_on\` AS \`depends_on\`,\`m\`.\`desired_at\` AS \`desired_at\`,\`m\`.\`disabled_at\` AS \`disabled_at\`,\`m\`.\`disabled_reason\` AS \`disabled_reason\`,\`m\`.\`deadline\` AS \`deadline\`,\`m\`.\`start_after_at\` AS \`start_after_at\`,\`m\`.\`tz\` AS \`tz\`,\`m\`.\`weather_precip\` AS \`weather_precip\`,\`m\`.\`weather_cloud\` AS \`weather_cloud\`,\`m\`.\`weather_temp_min\` AS \`weather_temp_min\`,\`m\`.\`weather_temp_max\` AS \`weather_temp_max\`,\`m\`.\`weather_temp_unit\` AS \`weather_temp_unit\`,\`m\`.\`weather_humidity_min\` AS \`weather_humidity_min\`,\`m\`.\`weather_humidity_max\` AS \`weather_humidity_max\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`source_id\`,NULL AS \`scheduled_at\`,cast(NULL as date) AS \`date\`,(cast(NULL as char(3) charset utf8mb4) collate utf8mb4_unicode_ci) AS \`day\`,cast(NULL as time) AS \`time\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`status\`,NULL AS \`time_remaining\`,NULL AS \`unscheduled\`,NULL AS \`overdue\`,NULL AS \`slack_mins\`,NULL AS \`occurrence_ordinal\`,NULL AS \`split_ordinal\`,NULL AS \`split_total\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`split_group\`,cast(0 as unsigned) AS \`generated\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`gcal_event_id\`,\`m\`.\`depends_on\` AS \`depends_on_json\`,\`m\`.\`created_at\` AS \`created_at\`,\`m\`.\`updated_at\` AS \`updated_at\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`msft_event_id\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`apple_event_id\`,\`m\`.\`id\` AS \`master_id\`,NULL AS \`completed_at\`,cast(NULL as date) AS \`implied_deadline\` from \`task_masters\` \`m\` where (\`m\`.\`recurring\` = 1) union all select \`i\`.\`id\` AS \`id\`,\`i\`.\`user_id\` AS \`user_id\`,(case when (\`m\`.\`recurring\` = 1) then 'recurring_instance' else 'task' end) AS \`task_type\`,\`m\`.\`text\` AS \`text\`,coalesce(\`i\`.\`dur\`,\`m\`.\`dur\`) AS \`dur\`,\`m\`.\`pri\` AS \`pri\`,\`m\`.\`project\` AS \`project\`,\`m\`.\`section\` AS \`section\`,\`m\`.\`notes\` AS \`notes\`,\`m\`.\`url\` AS \`url\`,\`m\`.\`location\` AS \`location\`,\`m\`.\`tools\` AS \`tools\`,\`m\`.\`when\` AS \`when\`,\`m\`.\`day_req\` AS \`day_req\`,\`m\`.\`recurring\` AS \`recurring\`,\`m\`.\`time_flex\` AS \`time_flex\`,\`m\`.\`flex_when\` AS \`flex_when\`,\`m\`.\`split\` AS \`split\`,\`m\`.\`split_min\` AS \`split_min\`,\`m\`.\`recur\` AS \`recur\`,\`m\`.\`recur_start\` AS \`recur_start\`,\`m\`.\`recur_end\` AS \`recur_end\`,\`i\`.\`end_date\` AS \`end_date\`,(case when (\`m\`.\`placement_mode\` = 'reminder') then 1 else 0 end) AS \`marker\`,\`m\`.\`preferred_time_mins\` AS \`preferred_time_mins\`,\`m\`.\`placement_mode\` AS \`placement_mode\`,\`m\`.\`travel_before\` AS \`travel_before\`,\`m\`.\`travel_after\` AS \`travel_after\`,\`m\`.\`depends_on\` AS \`depends_on\`,\`m\`.\`desired_at\` AS \`desired_at\`,\`m\`.\`disabled_at\` AS \`disabled_at\`,\`m\`.\`disabled_reason\` AS \`disabled_reason\`,\`m\`.\`deadline\` AS \`deadline\`,\`m\`.\`start_after_at\` AS \`start_after_at\`,\`m\`.\`tz\` AS \`tz\`,\`m\`.\`weather_precip\` AS \`weather_precip\`,\`m\`.\`weather_cloud\` AS \`weather_cloud\`,\`m\`.\`weather_temp_min\` AS \`weather_temp_min\`,\`m\`.\`weather_temp_max\` AS \`weather_temp_max\`,\`m\`.\`weather_temp_unit\` AS \`weather_temp_unit\`,\`m\`.\`weather_humidity_min\` AS \`weather_humidity_min\`,\`m\`.\`weather_humidity_max\` AS \`weather_humidity_max\`,(case when (\`m\`.\`recurring\` = 1) then \`m\`.\`id\` else NULL end) AS \`source_id\`,\`i\`.\`scheduled_at\` AS \`scheduled_at\`,\`i\`.\`date\` AS \`date\`,\`i\`.\`day\` AS \`day\`,\`i\`.\`time\` AS \`time\`,\`i\`.\`status\` AS \`status\`,\`i\`.\`time_remaining\` AS \`time_remaining\`,\`i\`.\`unscheduled\` AS \`unscheduled\`,\`i\`.\`overdue\` AS \`overdue\`,\`i\`.\`slack_mins\` AS \`slack_mins\`,\`i\`.\`occurrence_ordinal\` AS \`occurrence_ordinal\`,\`i\`.\`split_ordinal\` AS \`split_ordinal\`,\`i\`.\`split_total\` AS \`split_total\`,\`i\`.\`split_group\` AS \`split_group\`,cast(0 as unsigned) AS \`generated\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`gcal_event_id\`,\`m\`.\`depends_on\` AS \`depends_on_json\`,\`m\`.\`created_at\` AS \`created_at\`,\`i\`.\`updated_at\` AS \`updated_at\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`msft_event_id\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`apple_event_id\`,\`i\`.\`master_id\` AS \`master_id\`,\`i\`.\`completed_at\` AS \`completed_at\`,\`i\`.\`implied_deadline\` AS \`implied_deadline\` from (\`task_instances\` \`i\` join \`task_masters\` \`m\` on((\`m\`.\`id\` = \`i\`.\`master_id\`)))`;

// ---------------------------------------------------------------------------
// DOWN — restore the broken-but-prior state (tasks_v WITHOUT end_date, matching
// what 20260614010000 left behind: has completed_at + implied_deadline, no end_date).
// tasks_with_sync_v is recreated referencing tasks_v (still broken if v.end_date
// is referenced — but that is the prior state this migration came to fix).
// ---------------------------------------------------------------------------
const DOWN_TASKS_V_SQL = `CREATE VIEW \`tasks_v\` AS select \`m\`.\`id\` AS \`id\`,\`m\`.\`user_id\` AS \`user_id\`,(convert('recurring_template' using utf8mb4) collate utf8mb4_unicode_ci) AS \`task_type\`,\`m\`.\`text\` AS \`text\`,\`m\`.\`dur\` AS \`dur\`,\`m\`.\`pri\` AS \`pri\`,\`m\`.\`project\` AS \`project\`,\`m\`.\`section\` AS \`section\`,\`m\`.\`notes\` AS \`notes\`,\`m\`.\`url\` AS \`url\`,\`m\`.\`location\` AS \`location\`,\`m\`.\`tools\` AS \`tools\`,\`m\`.\`when\` AS \`when\`,\`m\`.\`day_req\` AS \`day_req\`,\`m\`.\`recurring\` AS \`recurring\`,\`m\`.\`time_flex\` AS \`time_flex\`,\`m\`.\`flex_when\` AS \`flex_when\`,\`m\`.\`split\` AS \`split\`,\`m\`.\`split_min\` AS \`split_min\`,\`m\`.\`recur\` AS \`recur\`,\`m\`.\`recur_start\` AS \`recur_start\`,\`m\`.\`recur_end\` AS \`recur_end\`,(case when (\`m\`.\`placement_mode\` = 'reminder') then 1 else 0 end) AS \`marker\`,\`m\`.\`preferred_time_mins\` AS \`preferred_time_mins\`,\`m\`.\`placement_mode\` AS \`placement_mode\`,\`m\`.\`travel_before\` AS \`travel_before\`,\`m\`.\`travel_after\` AS \`travel_after\`,\`m\`.\`depends_on\` AS \`depends_on\`,\`m\`.\`desired_at\` AS \`desired_at\`,\`m\`.\`disabled_at\` AS \`disabled_at\`,\`m\`.\`disabled_reason\` AS \`disabled_reason\`,\`m\`.\`deadline\` AS \`deadline\`,\`m\`.\`start_after_at\` AS \`start_after_at\`,\`m\`.\`tz\` AS \`tz\`,\`m\`.\`weather_precip\` AS \`weather_precip\`,\`m\`.\`weather_cloud\` AS \`weather_cloud\`,\`m\`.\`weather_temp_min\` AS \`weather_temp_min\`,\`m\`.\`weather_temp_max\` AS \`weather_temp_max\`,\`m\`.\`weather_temp_unit\` AS \`weather_temp_unit\`,\`m\`.\`weather_humidity_min\` AS \`weather_humidity_min\`,\`m\`.\`weather_humidity_max\` AS \`weather_humidity_max\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`source_id\`,NULL AS \`scheduled_at\`,cast(NULL as date) AS \`date\`,(cast(NULL as char(3) charset utf8mb4) collate utf8mb4_unicode_ci) AS \`day\`,cast(NULL as time) AS \`time\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`status\`,NULL AS \`time_remaining\`,NULL AS \`unscheduled\`,NULL AS \`overdue\`,NULL AS \`slack_mins\`,NULL AS \`occurrence_ordinal\`,NULL AS \`split_ordinal\`,NULL AS \`split_total\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`split_group\`,cast(0 as unsigned) AS \`generated\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`gcal_event_id\`,\`m\`.\`depends_on\` AS \`depends_on_json\`,\`m\`.\`created_at\` AS \`created_at\`,\`m\`.\`updated_at\` AS \`updated_at\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`msft_event_id\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`apple_event_id\`,\`m\`.\`id\` AS \`master_id\`,NULL AS \`completed_at\`,cast(NULL as date) AS \`implied_deadline\` from \`task_masters\` \`m\` where (\`m\`.\`recurring\` = 1) union all select \`i\`.\`id\` AS \`id\`,\`i\`.\`user_id\` AS \`user_id\`,(case when (\`m\`.\`recurring\` = 1) then 'recurring_instance' else 'task' end) AS \`task_type\`,\`m\`.\`text\` AS \`text\`,coalesce(\`i\`.\`dur\`,\`m\`.\`dur\`) AS \`dur\`,\`m\`.\`pri\` AS \`pri\`,\`m\`.\`project\` AS \`project\`,\`m\`.\`section\` AS \`section\`,\`m\`.\`notes\` AS \`notes\`,\`m\`.\`url\` AS \`url\`,\`m\`.\`location\` AS \`location\`,\`m\`.\`tools\` AS \`tools\`,\`m\`.\`when\` AS \`when\`,\`m\`.\`day_req\` AS \`day_req\`,\`m\`.\`recurring\` AS \`recurring\`,\`m\`.\`time_flex\` AS \`time_flex\`,\`m\`.\`flex_when\` AS \`flex_when\`,\`m\`.\`split\` AS \`split\`,\`m\`.\`split_min\` AS \`split_min\`,\`m\`.\`recur\` AS \`recur\`,\`m\`.\`recur_start\` AS \`recur_start\`,\`m\`.\`recur_end\` AS \`recur_end\`,(case when (\`m\`.\`placement_mode\` = 'reminder') then 1 else 0 end) AS \`marker\`,\`m\`.\`preferred_time_mins\` AS \`preferred_time_mins\`,\`m\`.\`placement_mode\` AS \`placement_mode\`,\`m\`.\`travel_before\` AS \`travel_before\`,\`m\`.\`travel_after\` AS \`travel_after\`,\`m\`.\`depends_on\` AS \`depends_on\`,\`m\`.\`desired_at\` AS \`desired_at\`,\`m\`.\`disabled_at\` AS \`disabled_at\`,\`m\`.\`disabled_reason\` AS \`disabled_reason\`,\`m\`.\`deadline\` AS \`deadline\`,\`m\`.\`start_after_at\` AS \`start_after_at\`,\`m\`.\`tz\` AS \`tz\`,\`m\`.\`weather_precip\` AS \`weather_precip\`,\`m\`.\`weather_cloud\` AS \`weather_cloud\`,\`m\`.\`weather_temp_min\` AS \`weather_temp_min\`,\`m\`.\`weather_temp_max\` AS \`weather_temp_max\`,\`m\`.\`weather_temp_unit\` AS \`weather_temp_unit\`,\`m\`.\`weather_humidity_min\` AS \`weather_humidity_min\`,\`m\`.\`weather_humidity_max\` AS \`weather_humidity_max\`,(case when (\`m\`.\`recurring\` = 1) then \`m\`.\`id\` else NULL end) AS \`source_id\`,\`i\`.\`scheduled_at\` AS \`scheduled_at\`,\`i\`.\`date\` AS \`date\`,\`i\`.\`day\` AS \`day\`,\`i\`.\`time\` AS \`time\`,\`i\`.\`status\` AS \`status\`,\`i\`.\`time_remaining\` AS \`time_remaining\`,\`i\`.\`unscheduled\` AS \`unscheduled\`,\`i\`.\`overdue\` AS \`overdue\`,\`i\`.\`slack_mins\` AS \`slack_mins\`,\`i\`.\`occurrence_ordinal\` AS \`occurrence_ordinal\`,\`i\`.\`split_ordinal\` AS \`split_ordinal\`,\`i\`.\`split_total\` AS \`split_total\`,\`i\`.\`split_group\` AS \`split_group\`,cast(0 as unsigned) AS \`generated\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`gcal_event_id\`,\`m\`.\`depends_on\` AS \`depends_on_json\`,\`m\`.\`created_at\` AS \`created_at\`,\`i\`.\`updated_at\` AS \`updated_at\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`msft_event_id\`,(convert(NULL using utf8mb4) collate utf8mb4_unicode_ci) AS \`apple_event_id\`,\`i\`.\`master_id\` AS \`master_id\`,\`i\`.\`completed_at\` AS \`completed_at\`,\`i\`.\`implied_deadline\` AS \`implied_deadline\` from (\`task_instances\` \`i\` join \`task_masters\` \`m\` on((\`m\`.\`id\` = \`i\`.\`master_id\`)))`;

// DOWN tasks_with_sync_v without end_date (mirrors the broken-but-prior state where
// tasks_with_sync_v still references v.end_date from a view that lacked it)
const DOWN_SYNC_V_SQL = `CREATE VIEW \`tasks_with_sync_v\` AS
  SELECT
    v.id, v.user_id, v.task_type, v.text, v.dur, v.pri, v.project, v.section,
    v.notes, v.url, v.location, v.tools, v.\`when\`, v.day_req, v.recurring,
    v.time_flex, v.flex_when, v.split, v.split_min, v.recur, v.recur_start,
    v.recur_end, v.marker, v.preferred_time_mins, v.placement_mode,
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

exports.up = async function(knex) {
  // Drop dependent view first, then the base view
  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  // Recreate tasks_v WITH end_date (+ completed_at + implied_deadline preserved)
  await knex.raw(UP_VIEW_SQL);
  // Recreate tasks_with_sync_v with v.end_date projected
  await knex.raw(SYNC_V_SQL);
};

exports.down = async function(knex) {
  // Drop both views
  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  // Restore prior broken state (tasks_v without end_date; tasks_with_sync_v without end_date)
  await knex.raw(DOWN_TASKS_V_SQL);
  await knex.raw(DOWN_SYNC_V_SQL);
};
