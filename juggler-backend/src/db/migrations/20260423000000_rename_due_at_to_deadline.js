/**
 * Rename `task_masters.due_at` → `task_masters.deadline`.
 *
 * The UI already describes this field as a "Hard deadline", and the scheduler
 * uses `deadline` as its internal variable name. Unify the external vocabulary
 * with the internal concept so the API, code, and UI all say the same thing.
 * "Deadline" also carries the correct semantic weight (non-negotiable) that
 * "due" didn't.
 *
 * Steps:
 *   1. Drop the dependent views (tasks_with_sync_v on top, tasks_v below).
 *   2. Rename the column on task_masters.
 *   3. Recreate both views selecting the new `deadline` column and exposing
 *      it to readers under the same name (no legacy `due_at` alias — we do
 *      the rename cleanly, not with a shim).
 */
exports.up = async function (knex) {
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');

  const has = await knex.schema.hasColumn('task_masters', 'due_at');
  if (has) {
    await knex.schema.alterTable('task_masters', (table) => {
      table.renameColumn('due_at', 'deadline');
    });
  }

  await knex.raw(`
    CREATE VIEW tasks_v AS
    SELECT
      m.id                         AS id,
      CONVERT('recurring_template' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS task_type,
      m.user_id                    AS user_id,
      m.text                       AS text,
      NULL                         AS date_pinned,
      CAST(NULL AS DATETIME)       AS scheduled_at,
      m.desired_at                 AS desired_at,
      m.desired_date               AS desired_date,
      m.dur                        AS dur,
      CAST(NULL AS SIGNED)         AS time_remaining,
      m.pri                        AS pri,
      m.project                    AS project,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS status,
      m.section                    AS section,
      m.notes                      AS notes,
      m.deadline                   AS deadline,
      m.start_after_at             AS start_after_at,
      m.location                   AS location,
      m.tools                      AS tools,
      m.\`when\`                   AS \`when\`,
      m.day_req                    AS day_req,
      m.recurring                  AS recurring,
      m.rigid                      AS rigid,
      m.time_flex                  AS time_flex,
      m.split                      AS split,
      m.split_min                  AS split_min,
      m.recur                      AS recur,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS source_id,
      CAST(0 AS UNSIGNED)          AS \`generated\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS gcal_event_id,
      m.depends_on                 AS depends_on,
      m.created_at                 AS created_at,
      m.updated_at                 AS updated_at,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS msft_event_id,
      m.marker                     AS marker,
      m.flex_when                  AS flex_when,
      m.travel_before              AS travel_before,
      m.travel_after               AS travel_after,
      m.tz                         AS tz,
      m.recur_start                AS recur_start,
      m.recur_end                  AS recur_end,
      m.disabled_at                AS disabled_at,
      m.disabled_reason            AS disabled_reason,
      m.prev_when                  AS prev_when,
      NULL                         AS preferred_time,
      NULL                         AS unscheduled,
      m.preferred_time_mins        AS preferred_time_mins,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
      CAST(NULL AS SIGNED)         AS occurrence_ordinal,
      CAST(NULL AS SIGNED)         AS split_ordinal,
      CAST(NULL AS SIGNED)         AS split_total
    FROM task_masters m
    WHERE m.recurring = 1

    UNION ALL

    SELECT
      i.id                         AS id,
      CASE
        WHEN m.id IS NULL THEN 'task'
        WHEN m.recurring = 1 THEN 'recurring_instance'
        ELSE 'task'
      END                          AS task_type,
      i.user_id                    AS user_id,
      m.text                       AS text,
      i.date_pinned                AS date_pinned,
      i.scheduled_at               AS scheduled_at,
      m.desired_at                 AS desired_at,
      m.desired_date               AS desired_date,
      COALESCE(i.dur, m.dur)       AS dur,
      i.time_remaining             AS time_remaining,
      m.pri                        AS pri,
      m.project                    AS project,
      i.status                     AS status,
      m.section                    AS section,
      m.notes                      AS notes,
      m.deadline                   AS deadline,
      m.start_after_at             AS start_after_at,
      m.location                   AS location,
      m.tools                      AS tools,
      m.\`when\`                   AS \`when\`,
      m.day_req                    AS day_req,
      m.recurring                  AS recurring,
      m.rigid                      AS rigid,
      m.time_flex                  AS time_flex,
      m.split                      AS split,
      m.split_min                  AS split_min,
      m.recur                      AS recur,
      CASE WHEN m.recurring = 1 THEN m.id ELSE NULL END AS source_id,
      i.generated                  AS \`generated\`,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS gcal_event_id,
      m.depends_on                 AS depends_on,
      i.created_at                 AS created_at,
      i.updated_at                 AS updated_at,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS msft_event_id,
      m.marker                     AS marker,
      m.flex_when                  AS flex_when,
      m.travel_before              AS travel_before,
      m.travel_after               AS travel_after,
      m.tz                         AS tz,
      m.recur_start                AS recur_start,
      m.recur_end                  AS recur_end,
      m.disabled_at                AS disabled_at,
      m.disabled_reason            AS disabled_reason,
      m.prev_when                  AS prev_when,
      NULL                         AS preferred_time,
      i.unscheduled                AS unscheduled,
      m.preferred_time_mins        AS preferred_time_mins,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
      i.occurrence_ordinal         AS occurrence_ordinal,
      i.split_ordinal              AS split_ordinal,
      i.split_total                AS split_total
    FROM task_instances i
    LEFT JOIN task_masters m ON i.master_id = m.id
  `);

  await knex.raw(`
    CREATE VIEW tasks_with_sync_v AS
    SELECT
      v.id, v.task_type, v.user_id, v.text, v.date_pinned, v.scheduled_at,
      v.desired_at, v.desired_date, v.dur, v.time_remaining, v.pri, v.project,
      v.status, v.section, v.notes, v.deadline, v.start_after_at, v.location,
      v.tools, v.\`when\`, v.day_req, v.recurring, v.rigid, v.time_flex,
      v.split, v.split_min, v.recur, v.source_id, v.\`generated\`,
      gcl.provider_event_id AS gcal_event_id,
      v.depends_on, v.created_at, v.updated_at,
      mcl.provider_event_id AS msft_event_id,
      v.marker, v.flex_when, v.travel_before, v.travel_after, v.tz,
      v.recur_start, v.recur_end, v.disabled_at, v.disabled_reason, v.prev_when,
      v.preferred_time, v.unscheduled, v.preferred_time_mins,
      acl.provider_event_id AS apple_event_id,
      v.occurrence_ordinal, v.split_ordinal, v.split_total
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

exports.down = async function () {
  throw new Error('Down not supported; restore by re-running 20260415011200_fix_view_boolean_types.js after renaming deadline back to due_at.');
};
