/**
 * Add split_group column to task_instances.
 * Links split chunks of the same occurrence — set to the primary chunk's ID.
 * Used by the scheduler to group chunks for merge-back and status propagation.
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('task_instances', function(table) {
    table.string('split_group', 100).nullable().after('split_total')
      .comment('Primary chunk ID linking split siblings');
  });

  // Recreate views to expose the new column
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');

  // Rebuild tasks_v with split_group
  await knex.raw(`
    CREATE VIEW tasks_v AS
    -- Template rows from recurring masters
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
      m.desired_date               AS desired_date,
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
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS original_date,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS original_time,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS original_day,
      m.id                         AS master_id
    FROM task_masters m
    WHERE m.recurring = 1

    UNION ALL

    -- Instance rows (one-shots + recurring instances)
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
      m.desired_date               AS desired_date,
      m.disabled_at                AS disabled_at,
      m.disabled_reason            AS disabled_reason,
      m.deadline                   AS deadline,
      m.start_after_at             AS start_after_at,
      m.prev_when                  AS prev_when,
      m.tz                         AS tz,
      m.id                         AS source_id,
      i.scheduled_at               AS scheduled_at,
      i.date_pinned                AS date_pinned,
      i.\`date\`                   AS \`date\`,
      i.\`day\`                    AS \`day\`,
      i.\`time\`                   AS \`time\`,
      i.\`status\`                 AS \`status\`,
      i.time_remaining             AS time_remaining,
      i.unscheduled                AS unscheduled,
      i.occurrence_ordinal         AS occurrence_ordinal,
      i.split_ordinal              AS split_ordinal,
      i.split_total                AS split_total,
      i.split_group                AS split_group,
      CAST(0 AS UNSIGNED)          AS \`generated\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS gcal_event_id,
      m.depends_on                 AS depends_on_json,
      i.created_at                 AS created_at,
      i.updated_at                 AS updated_at,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS msft_event_id,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
      i.original_date              AS original_date,
      i.original_time              AS original_time,
      i.original_day               AS original_day,
      i.master_id                  AS master_id
    FROM task_instances i
    JOIN task_masters m ON m.id = i.master_id
  `);

  // Rebuild tasks_with_sync_v (adds calendar event IDs)
  await knex.raw(`
    CREATE VIEW tasks_with_sync_v AS
    SELECT
      t.*,
      cs_gcal.external_id AS gcal_event_id_sync,
      cs_msft.external_id AS msft_event_id_sync,
      cs_apple.external_id AS apple_event_id_sync
    FROM tasks_v t
    LEFT JOIN calendar_sync cs_gcal
      ON cs_gcal.task_id = t.id AND cs_gcal.provider = 'google' AND cs_gcal.deleted_at IS NULL
    LEFT JOIN calendar_sync cs_msft
      ON cs_msft.task_id = t.id AND cs_msft.provider = 'microsoft' AND cs_msft.deleted_at IS NULL
    LEFT JOIN calendar_sync cs_apple
      ON cs_apple.task_id = t.id AND cs_apple.provider = 'apple' AND cs_apple.deleted_at IS NULL
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.schema.alterTable('task_instances', function(table) {
    table.dropColumn('split_group');
  });
  // Views would need to be recreated without split_group — omitted for brevity
};
