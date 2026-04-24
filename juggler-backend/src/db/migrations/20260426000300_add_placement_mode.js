/**
 * Add placement_mode ENUM to task_masters as a VIRTUAL generated column.
 *
 * Derived on-read from existing flags (marker, rigid, recurring,
 * preferred_time_mins, when) via a CASE expression. No backfill needed;
 * no write-path sync needed; always consistent with the source flags.
 *
 * Scheduler v1 still reads the flags; scheduler v2 will branch on
 * placement_mode. This migration is the Phase 1 step of the staged
 * #13 rollout (see SCHEDULER-V2-SPEC.md §5.1).
 *
 * Values:
 *   marker              — marker=1 wins regardless of other flags
 *   fixed               — when contains 'fixed' OR (rigid=1 AND !recurring)
 *   recurring_rigid     — recurring + rigid + preferred_time_mins set
 *   recurring_window    — recurring + preferred_time_mins set, not rigid
 *   recurring_flexible  — recurring, no preferred time
 *   flexible            — default (free-floating, scheduler decides)
 *
 * `pinned_date` (spec §5) is reserved for a future mode where the user
 * locks a date but leaves time flexible. No existing flag combination
 * maps to it, so it's not assigned by the backfill expression.
 *
 * Requires MySQL 5.7+ (VIRTUAL columns). Column is recomputed on every read.
 * Views that expose placement_mode pick up changes without a rebuild.
 */
exports.up = async function(knex) {
  // 1. Drop views that would block the ALTER (they'd resolve to the old shape).
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');

  // 2. Add the virtual column. Backticks around `when` because it's a
  //    MySQL reserved word. ENUM values must be string literals in the
  //    generated expression.
  await knex.raw(`
    ALTER TABLE task_masters
    ADD COLUMN placement_mode
      ENUM('marker','fixed','pinned_date','recurring_rigid','recurring_window','recurring_flexible','flexible')
      GENERATED ALWAYS AS (
        CASE
          WHEN marker = 1 THEN 'marker'
          WHEN \`when\` LIKE '%fixed%' THEN 'fixed'
          WHEN rigid = 1 AND recurring = 0 THEN 'fixed'
          WHEN recurring = 1 AND rigid = 1 AND preferred_time_mins IS NOT NULL THEN 'recurring_rigid'
          WHEN recurring = 1 AND preferred_time_mins IS NOT NULL THEN 'recurring_window'
          WHEN recurring = 1 THEN 'recurring_flexible'
          ELSE 'flexible'
        END
      ) VIRTUAL
  `);

  // 3. Rebuild views to expose the new column. tasks_v shape mirrors the
  //    previous definition in 20260426000200_drop_desired_date, plus
  //    m.placement_mode on both branches. Template branch exposes the
  //    master's mode; instance branch inherits it (effective mode at the
  //    instance level may still be 'fixed' via date_pinned — see the
  //    scheduler for that override logic).
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

  await knex.raw(`
    CREATE VIEW tasks_with_sync_v AS
    SELECT
      v.id, v.user_id, v.task_type, v.text, v.dur, v.pri, v.project, v.section,
      v.notes, v.location, v.tools, v.\`when\`, v.day_req, v.recurring, v.rigid,
      v.time_flex, v.flex_when, v.split, v.split_min, v.recur, v.recur_start,
      v.recur_end, v.marker, v.preferred_time_mins, v.placement_mode,
      v.travel_before, v.travel_after,
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
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.schema.alterTable('task_masters', function(table) {
    table.dropColumn('placement_mode');
  });
  // Rollback path: re-run 20260426000200_drop_desired_date to restore the prior view shape.
  console.log('[MIGRATION] down: re-run 20260426000200 to restore views');
};
