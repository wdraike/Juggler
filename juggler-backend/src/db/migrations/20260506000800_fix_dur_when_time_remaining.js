/**
 * Fix tasks_v to return m.dur (master/user-set value) instead of i.dur when
 * time_remaining is set on a non-split task. Without this, the scheduler
 * writing dur = effectiveDuration (= time_remaining) to task_instances.dur
 * would bleed back into the form's "Duration" field, making it look like
 * the remaining value had no effect.
 *
 * For split chunks (split_total > 1), we still use COALESCE(i.dur, m.dur)
 * so the individual chunk duration is preserved.
 */

exports.up = async function(knex) {
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');

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
      m.url                        AS url,
      m.location                   AS location,
      m.tools                      AS tools,
      m.\`when\`                   AS \`when\`,
      m.day_req                    AS day_req,
      m.recurring                  AS recurring,
      CASE WHEN m.placement_mode = 'recurring_rigid' THEN 1 ELSE 0 END AS rigid,
      m.time_flex                  AS time_flex,
      m.flex_when                  AS flex_when,
      m.split                      AS split,
      m.split_min                  AS split_min,
      m.recur                      AS recur,
      m.recur_start                AS recur_start,
      m.recur_end                  AS recur_end,
      CASE WHEN m.placement_mode = 'marker' THEN 1 ELSE 0 END AS marker,
      m.preferred_time_mins        AS preferred_time_mins,
      m.placement_mode             AS placement_mode,
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
      m.weather_precip             AS weather_precip,
      m.weather_cloud              AS weather_cloud,
      m.weather_temp_min           AS weather_temp_min,
      m.weather_temp_max           AS weather_temp_max,
      m.weather_temp_unit          AS weather_temp_unit,
      m.weather_humidity_min       AS weather_humidity_min,
      m.weather_humidity_max       AS weather_humidity_max,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS source_id,
      NULL                         AS scheduled_at,
      NULL                         AS date_pinned,
      CAST(NULL AS DATE)           AS \`date\`,
      CAST(NULL AS CHAR(3)) COLLATE utf8mb4_unicode_ci AS \`day\`,
      CAST(NULL AS TIME)           AS \`time\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS \`status\`,
      NULL                         AS time_remaining,
      NULL                         AS unscheduled,
      NULL                         AS overdue,
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

    -- Instance rows (one-off tasks + recurring instances)
    SELECT
      i.id                         AS id,
      i.user_id                    AS user_id,
      CASE WHEN m.recurring = 1 THEN 'recurring_instance' ELSE 'task' END AS task_type,
      m.text                       AS text,
      -- When time_remaining is set on a non-split task, show the master's
      -- (user-set) duration rather than the instance's placement duration.
      -- The scheduler uses time_remaining directly for effective duration, so
      -- i.dur having the "remaining" value written by an old scheduler run
      -- must not override the user's original Duration field in the UI.
      CASE WHEN i.time_remaining IS NOT NULL AND COALESCE(i.split_total, 1) = 1
        THEN m.dur
        ELSE COALESCE(i.dur, m.dur)
      END                          AS dur,
      m.pri                        AS pri,
      m.project                    AS project,
      m.section                    AS section,
      m.notes                      AS notes,
      m.url                        AS url,
      m.location                   AS location,
      m.tools                      AS tools,
      m.\`when\`                   AS \`when\`,
      m.day_req                    AS day_req,
      m.recurring                  AS recurring,
      CASE WHEN m.placement_mode = 'recurring_rigid' THEN 1 ELSE 0 END AS rigid,
      m.time_flex                  AS time_flex,
      m.flex_when                  AS flex_when,
      m.split                      AS split,
      m.split_min                  AS split_min,
      m.recur                      AS recur,
      m.recur_start                AS recur_start,
      m.recur_end                  AS recur_end,
      CASE WHEN m.placement_mode = 'marker' THEN 1 ELSE 0 END AS marker,
      m.preferred_time_mins        AS preferred_time_mins,
      m.placement_mode             AS placement_mode,
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
      m.weather_precip             AS weather_precip,
      m.weather_cloud              AS weather_cloud,
      m.weather_temp_min           AS weather_temp_min,
      m.weather_temp_max           AS weather_temp_max,
      m.weather_temp_unit          AS weather_temp_unit,
      m.weather_humidity_min       AS weather_humidity_min,
      m.weather_humidity_max       AS weather_humidity_max,
      CASE WHEN m.recurring = 1 THEN m.id ELSE NULL END AS source_id,
      i.scheduled_at               AS scheduled_at,
      i.date_pinned                AS date_pinned,
      i.\`date\`                   AS \`date\`,
      i.\`day\`                    AS \`day\`,
      i.\`time\`                   AS \`time\`,
      i.\`status\`                 AS \`status\`,
      i.time_remaining             AS time_remaining,
      i.unscheduled                AS unscheduled,
      i.overdue                    AS overdue,
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

  await knex.raw(`
    CREATE VIEW tasks_with_sync_v AS
    SELECT
      v.id, v.user_id, v.task_type, v.text, v.dur, v.pri, v.project, v.section,
      v.notes, v.url, v.location, v.tools, v.\`when\`, v.day_req, v.recurring, v.rigid,
      v.time_flex, v.flex_when, v.split, v.split_min, v.recur, v.recur_start,
      v.recur_end, v.marker, v.preferred_time_mins, v.placement_mode,
      v.travel_before, v.travel_after,
      v.depends_on, v.desired_at, v.disabled_at, v.disabled_reason,
      v.deadline, v.start_after_at, v.prev_when, v.tz,
      v.weather_precip, v.weather_cloud, v.weather_temp_min, v.weather_temp_max, v.weather_temp_unit,
      v.weather_humidity_min, v.weather_humidity_max,
      v.source_id, v.scheduled_at,
      v.date_pinned, v.\`date\`, v.\`day\`, v.\`time\`, v.\`status\`, v.time_remaining,
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
    ) acl ON acl.task_id = v.id
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');

  // Restore to pre-fix view shape (matches 20260506000600 up state)
  await knex.raw(`
    CREATE VIEW tasks_v AS
    SELECT
      m.id AS id, m.user_id AS user_id,
      CONVERT('recurring_template' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS task_type,
      m.text AS text, m.dur AS dur, m.pri AS pri, m.project AS project, m.section AS section,
      m.notes AS notes, m.url AS url, m.location AS location, m.tools AS tools,
      m.\`when\` AS \`when\`, m.day_req AS day_req, m.recurring AS recurring,
      CASE WHEN m.placement_mode = 'recurring_rigid' THEN 1 ELSE 0 END AS rigid,
      m.time_flex AS time_flex, m.flex_when AS flex_when, m.split AS split, m.split_min AS split_min,
      m.recur AS recur, m.recur_start AS recur_start, m.recur_end AS recur_end,
      CASE WHEN m.placement_mode = 'marker' THEN 1 ELSE 0 END AS marker,
      m.preferred_time_mins AS preferred_time_mins, m.placement_mode AS placement_mode,
      m.travel_before AS travel_before, m.travel_after AS travel_after, m.depends_on AS depends_on,
      m.desired_at AS desired_at, m.disabled_at AS disabled_at, m.disabled_reason AS disabled_reason,
      m.deadline AS deadline, m.start_after_at AS start_after_at, m.prev_when AS prev_when, m.tz AS tz,
      m.weather_precip AS weather_precip, m.weather_cloud AS weather_cloud,
      m.weather_temp_min AS weather_temp_min, m.weather_temp_max AS weather_temp_max,
      m.weather_temp_unit AS weather_temp_unit,
      m.weather_humidity_min AS weather_humidity_min, m.weather_humidity_max AS weather_humidity_max,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS source_id,
      NULL AS scheduled_at, NULL AS date_pinned,
      CAST(NULL AS DATE) AS \`date\`, CAST(NULL AS CHAR(3)) COLLATE utf8mb4_unicode_ci AS \`day\`,
      CAST(NULL AS TIME) AS \`time\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS \`status\`,
      NULL AS time_remaining, NULL AS unscheduled, NULL AS overdue, NULL AS slack_mins,
      NULL AS occurrence_ordinal, NULL AS split_ordinal, NULL AS split_total,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS split_group,
      CAST(0 AS UNSIGNED) AS \`generated\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS gcal_event_id,
      m.depends_on AS depends_on_json, m.created_at AS created_at, m.updated_at AS updated_at,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS msft_event_id,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
      m.id AS master_id
    FROM task_masters m WHERE m.recurring = 1
    UNION ALL
    SELECT
      i.id AS id, i.user_id AS user_id,
      CASE WHEN m.recurring = 1 THEN 'recurring_instance' ELSE 'task' END AS task_type,
      m.text AS text, COALESCE(i.dur, m.dur) AS dur, m.pri AS pri,
      m.project AS project, m.section AS section, m.notes AS notes, m.url AS url,
      m.location AS location, m.tools AS tools, m.\`when\` AS \`when\`, m.day_req AS day_req,
      m.recurring AS recurring,
      CASE WHEN m.placement_mode = 'recurring_rigid' THEN 1 ELSE 0 END AS rigid,
      m.time_flex AS time_flex, m.flex_when AS flex_when, m.split AS split, m.split_min AS split_min,
      m.recur AS recur, m.recur_start AS recur_start, m.recur_end AS recur_end,
      CASE WHEN m.placement_mode = 'marker' THEN 1 ELSE 0 END AS marker,
      m.preferred_time_mins AS preferred_time_mins, m.placement_mode AS placement_mode,
      m.travel_before AS travel_before, m.travel_after AS travel_after, m.depends_on AS depends_on,
      m.desired_at AS desired_at, m.disabled_at AS disabled_at, m.disabled_reason AS disabled_reason,
      m.deadline AS deadline, m.start_after_at AS start_after_at, m.prev_when AS prev_when, m.tz AS tz,
      m.weather_precip AS weather_precip, m.weather_cloud AS weather_cloud,
      m.weather_temp_min AS weather_temp_min, m.weather_temp_max AS weather_temp_max,
      m.weather_temp_unit AS weather_temp_unit,
      m.weather_humidity_min AS weather_humidity_min, m.weather_humidity_max AS weather_humidity_max,
      CASE WHEN m.recurring = 1 THEN m.id ELSE NULL END AS source_id,
      i.scheduled_at AS scheduled_at, i.date_pinned AS date_pinned,
      i.\`date\` AS \`date\`, i.\`day\` AS \`day\`, i.\`time\` AS \`time\`,
      i.\`status\` AS \`status\`, i.time_remaining AS time_remaining,
      i.unscheduled AS unscheduled, i.overdue AS overdue, i.slack_mins AS slack_mins,
      i.occurrence_ordinal AS occurrence_ordinal, i.split_ordinal AS split_ordinal,
      i.split_total AS split_total, i.split_group AS split_group,
      CAST(0 AS UNSIGNED) AS \`generated\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS gcal_event_id,
      m.depends_on AS depends_on_json, m.created_at AS created_at, i.updated_at AS updated_at,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS msft_event_id,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
      i.master_id AS master_id
    FROM task_instances i JOIN task_masters m ON m.id = i.master_id
  `);

  await knex.raw(`
    CREATE VIEW tasks_with_sync_v AS
    SELECT
      v.id, v.user_id, v.task_type, v.text, v.dur, v.pri, v.project, v.section,
      v.notes, v.url, v.location, v.tools, v.\`when\`, v.day_req, v.recurring, v.rigid,
      v.time_flex, v.flex_when, v.split, v.split_min, v.recur, v.recur_start,
      v.recur_end, v.marker, v.preferred_time_mins, v.placement_mode,
      v.travel_before, v.travel_after,
      v.depends_on, v.desired_at, v.disabled_at, v.disabled_reason,
      v.deadline, v.start_after_at, v.prev_when, v.tz,
      v.weather_precip, v.weather_cloud, v.weather_temp_min, v.weather_temp_max, v.weather_temp_unit,
      v.weather_humidity_min, v.weather_humidity_max,
      v.source_id, v.scheduled_at,
      v.date_pinned, v.\`date\`, v.\`day\`, v.\`time\`, v.\`status\`, v.time_remaining,
      v.unscheduled, v.overdue, v.slack_mins, v.occurrence_ordinal, v.split_ordinal, v.split_total,
      v.split_group, v.\`generated\`, v.depends_on AS depends_on_json,
      v.created_at, v.updated_at, v.master_id,
      gcl.provider_event_id AS gcal_event_id,
      mcl.provider_event_id AS msft_event_id,
      acl.provider_event_id AS apple_event_id
    FROM tasks_v v
    LEFT JOIN (
      SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
      FROM cal_sync_ledger WHERE status = 'active' AND provider = 'gcal' AND task_id IS NOT NULL
      GROUP BY task_id
    ) gcl ON gcl.task_id = v.id
    LEFT JOIN (
      SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
      FROM cal_sync_ledger WHERE status = 'active' AND provider = 'msft' AND task_id IS NOT NULL
      GROUP BY task_id
    ) mcl ON mcl.task_id = v.id
    LEFT JOIN (
      SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
      FROM cal_sync_ledger WHERE status = 'active' AND provider = 'apple' AND task_id IS NOT NULL
      GROUP BY task_id
    ) acl ON acl.task_id = v.id
  `);
};
