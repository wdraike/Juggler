/**
 * Phase 12 Plan 02: Drop the `preferred_time` boolean column from task_masters.
 *
 * `preferred_time` was a legacy boolean that duplicated the intent of
 * `preferred_time_mins` (which stores the actual minute-of-day value).
 * All JavaScript consumers were cleaned up in phase 12 plan 01. The views
 * never exposed `preferred_time` directly (only `preferred_time_mins` appears),
 * so only the column drop is needed at the schema level.
 *
 * Both views are rebuilt here to be safe (they reference task_masters columns
 * and must be recreated around the ALTER TABLE). The view SQL is copied verbatim
 * from 20260518000200_drop_rigid_from_views.js, which is the current authoritative
 * view state after phase 11 removed the `rigid` alias.
 *
 * NOTE: MySQL DDL statements (ALTER TABLE, CREATE/DROP VIEW) issue an implicit
 * COMMIT and cannot be wrapped in a transaction (knex issue #805). Statements
 * execute sequentially without a transaction wrapper.
 *
 * After this migration:
 *   SHOW COLUMNS FROM task_masters LIKE 'preferred_time'  → 0 rows
 *   SHOW COLUMNS FROM task_masters LIKE 'preferred_time_mins'  → 1 row (intact)
 */
exports.up = async function(knex) {

  // STEP 1 — Drop both views in dependency order.
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');

  // STEP 2 — Drop the boolean column (idempotent via schema inspection).
  // preferred_time_mins is NOT dropped — it is the retained canonical field.
  // We check for the column first because dev DBs may already have it absent.
  const [cols] = await knex.raw("SHOW COLUMNS FROM task_masters LIKE 'preferred_time'");
  if (cols.length > 0) {
    await knex.raw('ALTER TABLE task_masters DROP COLUMN preferred_time');
  }

  // STEP 3 — Recreate tasks_v.
  // Copied verbatim from 20260518000200_drop_rigid_from_views.js.
  // preferred_time was never in these views; only preferred_time_mins appears.
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
      m.time_flex                  AS time_flex,
      m.flex_when                  AS flex_when,
      m.split                      AS split,
      m.split_min                  AS split_min,
      m.recur                      AS recur,
      m.recur_start                AS recur_start,
      m.recur_end                  AS recur_end,
      CASE WHEN m.placement_mode = 'reminder' THEN 1 ELSE 0 END AS marker,
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
      m.time_flex                  AS time_flex,
      m.flex_when                  AS flex_when,
      m.split                      AS split,
      m.split_min                  AS split_min,
      m.recur                      AS recur,
      m.recur_start                AS recur_start,
      m.recur_end                  AS recur_end,
      CASE WHEN m.placement_mode = 'reminder' THEN 1 ELSE 0 END AS marker,
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

  // STEP 4 — Recreate tasks_with_sync_v.
  // Copied verbatim from 20260518000200_drop_rigid_from_views.js.
  await knex.raw(`
    CREATE VIEW tasks_with_sync_v AS
    SELECT
      v.id, v.user_id, v.task_type, v.text, v.dur, v.pri, v.project, v.section,
      v.notes, v.url, v.location, v.tools, v.\`when\`, v.day_req, v.recurring,
      v.time_flex, v.flex_when, v.split, v.split_min, v.recur, v.recur_start,
      v.recur_end, v.marker, v.preferred_time_mins, v.placement_mode,
      v.travel_before, v.travel_after,
      v.depends_on, v.desired_at, v.disabled_at, v.disabled_reason,
      v.deadline, v.start_after_at, v.prev_when, v.tz, v.source_id, v.scheduled_at,
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

exports.down = async function(_knex) {
  throw new Error(
    'Down migration for drop_preferred_time_column not implemented — ' +
    'the column was redundant and its data is unrecoverable without the original boolean writes.'
  );
};
