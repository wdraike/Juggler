/**
 * Issues #17 + #18: tighten task_instances column types.
 *
 *   date:  varchar(10)  →  DATE           (was storing ISO "YYYY-MM-DD" strings)
 *   day:   varchar(3)   →  ENUM('Sun',…)  (was storing 3-char weekday names)
 *
 * Why this is safe:
 *   - knex is configured with dateStrings: true (all environments, knexfile.js),
 *     so a DATE column is returned to Node as a "YYYY-MM-DD" string — same
 *     shape the app already reads. No app-code changes needed for #17.
 *   - ENUM values match exactly what the codebase writes today; the
 *     pre-migration audit confirmed 7 valid abbreviations in use and zero
 *     bad values. 37 NULL rows are preserved because the ENUM is nullable.
 *
 * Issue #19 (time: varchar(20) → TIME) is deliberately deferred: the app
 * stores human-readable "5:00 PM" strings, which MySQL TIME would refuse.
 * Converting would require rewriting every formatMinutesToTime + every
 * reader that displays the field, then back-filling 200+ rows. That's a
 * larger pass on its own; tracking as-is in the plan.
 *
 * Mechanics:
 *   - Both views (tasks_v, tasks_with_sync_v) reference the columns we are
 *     altering, so they must be dropped and recreated. MySQL views cache
 *     column types at creation; we rebuild them to match the new shape.
 *   - Template branch of tasks_v uses CAST(NULL AS DATE) / CAST(NULL AS
 *     CHAR) so the UNION ALL column types stay consistent across branches.
 *   - Collation continues to be set explicitly on all string columns to
 *     avoid the MySQL 8 utf8mb4_0900_ai_ci ↔ utf8mb4_unicode_ci drift that
 *     breaks cross-table joins (see feedback_collation_mismatch memory).
 */
exports.up = async function(knex) {
  // 1. Drop both views first — they pin column types of task_instances.
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');

  // 2. Tighten the column types.
  await knex.raw("ALTER TABLE task_instances MODIFY `date` DATE NULL");
  await knex.raw(
    "ALTER TABLE task_instances MODIFY `day` ENUM('Sun','Mon','Tue','Wed','Thu','Fri','Sat') " +
    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL"
  );

  // 3. Rebuild tasks_v — mirrors 20260426000300_add_placement_mode with the
  //    template-branch placeholders for date/day now cast to the new types
  //    so the UNION ALL column types stay consistent.
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
      m.url                        AS url,
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
      CAST(NULL AS DATE)           AS \`date\`,
      CAST(NULL AS CHAR(3)) COLLATE utf8mb4_unicode_ci AS \`day\`,
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
      m.url                        AS url,
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

  // 4. Rebuild tasks_with_sync_v on top of the fresh tasks_v.
  await knex.raw(`
    CREATE VIEW tasks_with_sync_v AS
    SELECT
      v.id, v.user_id, v.task_type, v.text, v.dur, v.pri, v.project, v.section,
      v.notes, v.url, v.location, v.tools, v.\`when\`, v.day_req, v.recurring, v.rigid,
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
  // Reverse the type changes. Both widenings are lossless (DATE → VARCHAR
  // formats as YYYY-MM-DD; ENUM → VARCHAR preserves label). Views are
  // dropped + rebuilt with the prior placeholder shape.
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.raw(
    "ALTER TABLE task_instances MODIFY `date` VARCHAR(10) " +
    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL"
  );
  await knex.raw(
    "ALTER TABLE task_instances MODIFY `day` VARCHAR(3) " +
    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL"
  );
  // Let the previous migration (20260426000400_add_url_to_task_masters or
  // 20260426000300_add_placement_mode, whichever last created views) be
  // re-run manually if a full downgrade is needed — no clean way to
  // duplicate a 100-line view definition here without drift.
  throw new Error('Down-migration leaves views dropped. Re-run the latest view-creating migration to restore tasks_v / tasks_with_sync_v.');
};
