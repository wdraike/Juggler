/**
 * Create a SQL VIEW `tasks_v` that presents task_masters + task_instances
 * in the same column shape the legacy `tasks` table exposes.
 *
 * Session 3 of the master/instance refactor: with triggers keeping the new
 * tables live (session 2), this view is the read-side bridge. Future sessions
 * migrate individual callers from `tasks` to `tasks_v` one at a time, verifying
 * each with tests. When every reader is off `tasks`, we drop the old table and
 * the triggers. This migration only CREATES the view — no caller is switched.
 *
 * Shape:
 *   - recurring master -> 1 template row (task_type='recurring_template',
 *     scheduled_at=NULL, source_id=NULL)
 *   - recurring instances -> N rows (task_type='recurring_instance',
 *     source_id=master.id), template fields inlined from the master
 *   - non-recurring -> 1 row (task_type='task'), master+instance joined on
 *     the shared id that the backfill and trigger establish
 *
 * Fields deliberately NULL:
 *   - gcal_event_id / msft_event_id / apple_event_id: these have moved
 *     authoritatively to cal_sync_ledger. Readers that still need them must
 *     join the ledger separately, or be migrated before cutting over.
 *   - preferred_time (boolean): obsoleted by preferred_time_mins.
 *   - generated: no longer meaningful (the new model doesn't distinguish
 *     scheduler-generated vs user-created instances at the row level).
 */
exports.up = async function(knex) {
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.raw(`
    CREATE VIEW tasks_v AS
    -- Template rows from recurring masters
    SELECT
      m.id                         AS id,
      CONVERT('recurring_template' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS task_type,
      m.user_id                    AS user_id,
      m.text                       AS text,
      CAST(NULL AS UNSIGNED)       AS date_pinned,
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
      m.due_at                     AS due_at,
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
      CAST(NULL AS UNSIGNED)       AS preferred_time,
      CAST(NULL AS UNSIGNED)       AS unscheduled,
      m.preferred_time_mins        AS preferred_time_mins,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id
    FROM task_masters m
    WHERE m.recurring = 1

    UNION ALL

    -- Instance rows (one-shots + recurring instances)
    SELECT
      i.id                         AS id,
      CASE WHEN m.recurring = 1 THEN 'recurring_instance' ELSE 'task' END AS task_type,
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
      m.due_at                     AS due_at,
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
      CAST(0 AS UNSIGNED)          AS \`generated\`,
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
      CAST(NULL AS UNSIGNED)       AS preferred_time,
      i.unscheduled                AS unscheduled,
      m.preferred_time_mins        AS preferred_time_mins,
      CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id
    FROM task_instances i
    JOIN task_masters m ON i.master_id = m.id
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
};
