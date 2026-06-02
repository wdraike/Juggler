'use strict';

/**
 * Add 'missed' status to task_instances and task_masters CHECK constraints,
 * add completed_at column to task_instances, backfill legacy rows,
 * and recreate tasks_v view with completed_at column.
 */
exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    // Step 1: Drop existing CHECK constraints
    await trx.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status');
    await trx.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_status').catch(() => {}); // May not exist

    // Step 2: Add new CHECK constraints with 'missed' status
    await trx.raw(`
      ALTER TABLE task_instances
        ADD CONSTRAINT chk_task_instances_status
          CHECK (status IN ('','wip','done','cancel','skip','pause','disabled','missed'))
    `);

    await trx.raw(`
      ALTER TABLE task_masters
        ADD CONSTRAINT chk_task_masters_status
          CHECK (status IN ('','wip','done','cancel','skip','pause','disabled','missed') OR status IS NULL)
    `);

    // Step 3: Add completed_at column
    await trx.raw('ALTER TABLE task_instances ADD COLUMN completed_at DATETIME NULL');

    // Step 4: Add index for purge operations
    await trx.raw('ALTER TABLE task_instances ADD INDEX idx_task_instances_purge (user_id, status, completed_at) COMMENT "Sharded purge query support"');

    // Step 5: Backfill legacy rows
    await trx.raw(`
      UPDATE task_instances 
      SET completed_at = updated_at 
      WHERE status IN ('done','skip','cancel') 
      AND completed_at IS NULL
    `);

    // Step 6: Drop and recreate tasks_v view with completed_at column
    await trx.raw('DROP VIEW IF EXISTS tasks_v');
    await trx.raw(`
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
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
        CAST(NULL AS DATETIME)       AS completed_at
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
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
        i.completed_at               AS completed_at
      FROM task_instances i
      JOIN task_masters m ON i.master_id = m.id
    `);
  });
};

exports.down = async function(knex) {
  await knex.transaction(async (trx) => {
    // Remove completed_at column
    await trx.raw('ALTER TABLE task_instances DROP COLUMN completed_at');

    // Drop the new constraints
    await trx.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status');
    await trx.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_status').catch(() => {});

    // Re-add original constraints
    await trx.raw(`
      ALTER TABLE task_instances
        ADD CONSTRAINT chk_task_instances_status
          CHECK (status IN ('','wip','done','cancel','skip','pause','disabled'))
    `);

    await trx.raw(`
      ALTER TABLE task_masters
        ADD CONSTRAINT chk_task_masters_status
          CHECK (status IN ('','wip','done','cancel','skip','pause','disabled') OR status IS NULL)
    `);

    // Drop and recreate original tasks_v view
    await trx.raw('DROP VIEW IF EXISTS tasks_v');
    await trx.raw(`
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
  });
};