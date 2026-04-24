/**
 * Drop `task_masters.desired_date`; keep only `desired_at` (DATETIME).
 *
 * Both columns existed to track user intent ("where did I originally want
 * this?") so the UI could show "Moved: X -> Y" when the scheduler reshuffled
 * placements. `desired_at` held the time-specific intent; `desired_date` held
 * the day-only intent (where DATETIME = midnight UTC would be ambiguous).
 *
 * Consolidating to a single field: for day-only intents we store the local
 * date at midnight in `desired_at`. The edge case — user genuinely intended
 * midnight and the scheduler moved it — will display as "Moved: 12:00 AM ->
 * 10:30 AM", which is correct but unusual. Not worth a second column.
 *
 * Scheduler impact: none. Neither field is read by `src/scheduler/*` (grep
 * confirmed 2026-04-26). UI (`TaskEditForm.jsx`) only reads `task.desiredAt`.
 * The MCP schema and task.controller.js are updated in the same commit.
 *
 * Views rebuilt without `desired_date`. One-shot migration — no staged
 * coexistence needed because no runtime code reads the column after the
 * accompanying code edits.
 */
exports.up = async function(knex) {
  // 1. Backfill: where desired_at is null but desired_date is set, promote
  //    the date to a datetime. Use noon local rather than midnight to avoid
  //    timezone slip near day boundaries. (The user's tz is unknown at
  //    migration time — noon UTC is "safe enough" for intent tracking;
  //    worst case the UI shows a slightly-off display-only value.)
  await knex.raw(`
    UPDATE task_masters
    SET desired_at = TIMESTAMP(desired_date, '12:00:00')
    WHERE desired_at IS NULL AND desired_date IS NOT NULL
  `);

  // 2. Rebuild views without desired_date. Views must be dropped first —
  //    MySQL refuses ALTER TABLE on columns referenced by a view.
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');

  // 3. Drop the column.
  await knex.schema.alterTable('task_masters', function(table) {
    table.dropColumn('desired_date');
  });

  // 4. Re-create tasks_v without desired_date.
  await knex.raw(`
    CREATE VIEW tasks_v AS
    SELECT
      m.id                         AS id,
      m.user_id                    AS user_id,
      CONVERT('recurring_template' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS task_type,
      m.text                       AS text,
      m.dur                        AS dur,
      m.pri                        AS pri,
      m.project                    AS project,
      m.section                    AS section,
      m.notes                      AS notes,
      m.location                   AS location,
      m.tools                      AS tools,
      m.\`when\`                   AS \`when\`,
      m.day_req                    AS day_req,
      m.recurring                  AS recurring,
      m.rigid                      AS rigid,
      m.time_flex                  AS time_flex,
      m.flex_when                  AS flex_when,
      m.split                      AS split,
      m.split_min                  AS split_min,
      m.recur                      AS recur,
      m.recur_start                AS recur_start,
      m.recur_end                  AS recur_end,
      m.marker                     AS marker,
      m.preferred_time_mins        AS preferred_time_mins,
      m.travel_before              AS travel_before,
      m.travel_after               AS travel_after,
      m.depends_on                 AS depends_on,
      m.desired_at                 AS desired_at,
      m.disabled_at                AS disabled_at,
      m.disabled_reason            AS disabled_reason,
      m.deadline                   AS deadline,
      m.start_after_at             AS start_after_at,
      m.prev_when                  AS prev_when,
      m.tz                         AS tz,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS source_id,
      NULL                         AS scheduled_at,
      NULL                         AS date_pinned,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS \`date\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS \`day\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS \`time\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS \`status\`,
      NULL                         AS time_remaining,
      NULL                         AS unscheduled,
      NULL                         AS slack_mins,
      NULL                         AS occurrence_ordinal,
      NULL                         AS split_ordinal,
      NULL                         AS split_total,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS split_group,
      CAST(0 AS UNSIGNED)          AS \`generated\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS gcal_event_id,
      m.depends_on                 AS depends_on_json,
      m.created_at                 AS created_at,
      m.updated_at                 AS updated_at,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS msft_event_id,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
      m.id                         AS master_id
    FROM task_masters m
    WHERE m.recurring = 1

    UNION ALL

    SELECT
      i.id                         AS id,
      i.user_id                    AS user_id,
      CASE WHEN m.recurring = 1 THEN 'recurring_instance' ELSE 'task' END AS task_type,
      m.text                       AS text,
      COALESCE(i.dur, m.dur)       AS dur,
      m.pri                        AS pri,
      m.project                    AS project,
      m.section                    AS section,
      m.notes                      AS notes,
      m.location                   AS location,
      m.tools                      AS tools,
      m.\`when\`                   AS \`when\`,
      m.day_req                    AS day_req,
      m.recurring                  AS recurring,
      m.rigid                      AS rigid,
      m.time_flex                  AS time_flex,
      m.flex_when                  AS flex_when,
      m.split                      AS split,
      m.split_min                  AS split_min,
      m.recur                      AS recur,
      m.recur_start                AS recur_start,
      m.recur_end                  AS recur_end,
      m.marker                     AS marker,
      m.preferred_time_mins        AS preferred_time_mins,
      m.travel_before              AS travel_before,
      m.travel_after               AS travel_after,
      m.depends_on                 AS depends_on,
      m.desired_at                 AS desired_at,
      m.disabled_at                AS disabled_at,
      m.disabled_reason            AS disabled_reason,
      m.deadline                   AS deadline,
      m.start_after_at             AS start_after_at,
      m.prev_when                  AS prev_when,
      m.tz                         AS tz,
      CASE WHEN m.recurring = 1 THEN m.id ELSE NULL END AS source_id,
      i.scheduled_at               AS scheduled_at,
      i.date_pinned                AS date_pinned,
      i.\`date\`                   AS \`date\`,
      i.\`day\`                    AS \`day\`,
      i.\`time\`                   AS \`time\`,
      i.\`status\`                 AS \`status\`,
      i.time_remaining             AS time_remaining,
      i.unscheduled                AS unscheduled,
      i.slack_mins                 AS slack_mins,
      i.occurrence_ordinal         AS occurrence_ordinal,
      i.split_ordinal              AS split_ordinal,
      i.split_total                AS split_total,
      i.split_group                AS split_group,
      CAST(0 AS UNSIGNED)          AS \`generated\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS gcal_event_id,
      m.depends_on                 AS depends_on_json,
      m.created_at                 AS created_at,
      i.updated_at                 AS updated_at,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS msft_event_id,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
      i.master_id                  AS master_id
    FROM task_instances i
    JOIN task_masters m ON m.id = i.master_id
  `);

  // 5. Re-create tasks_with_sync_v without desired_date.
  await knex.raw(`
    CREATE VIEW tasks_with_sync_v AS
    SELECT
      v.id, v.user_id, v.task_type, v.text, v.dur, v.pri, v.project, v.section,
      v.notes, v.location, v.tools, v.\`when\`, v.day_req, v.recurring, v.rigid,
      v.time_flex, v.flex_when, v.split, v.split_min, v.recur, v.recur_start,
      v.recur_end, v.marker, v.preferred_time_mins, v.travel_before, v.travel_after,
      v.depends_on, v.desired_at, v.disabled_at, v.disabled_reason,
      v.deadline, v.start_after_at, v.prev_when, v.tz, v.source_id, v.scheduled_at,
      v.date_pinned, v.\`date\`, v.\`day\`, v.\`time\`, v.\`status\`, v.time_remaining,
      v.unscheduled, v.slack_mins, v.occurrence_ordinal, v.split_ordinal, v.split_total,
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
    ) acl ON acl.task_id = v.id
  `);
};

exports.down = async function(knex) {
  // Best-effort: re-add nullable column. Original day-only intent values are
  // not recoverable — they were merged into desired_at during up().
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.schema.alterTable('task_masters', function(table) {
    table.date('desired_date').nullable();
  });
  // Rollback path: re-run 20260425000200 to restore the pre-drop view shape.
  console.log('[MIGRATION] down: re-run 20260425000200 to restore view definitions');
};
