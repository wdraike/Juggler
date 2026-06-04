/**
 * Phase 9: Replace 7-value placement_mode ENUM with clean 6-value ENUM.
 *
 * The old ENUM conflated recurrence state with scheduling mode and included
 * 'allday'/'fixed' as embedded system keywords inside the user-facing `when`
 * field. After this migration, `placement_mode` carries the mode only, and
 * `when` contains only user-defined slot tag names.
 *
 * Old: marker | fixed | pinned_date | recurring_rigid | recurring_window | recurring_flexible | flexible
 * New: reminder | all_day | fixed | time_window | time_blocks | anytime
 *
 * Order of operations:
 *   1. Backfill (while old ENUM values still valid) — CASE maps 7→6
 *   2. MODIFY COLUMN to new 6-value ENUM
 *   3. Strip 'allday' and 'fixed' tokens from `when` column
 *   4. Rebuild tasks_v and tasks_with_sync_v views
 */
exports.up = async function(knex) {
  await knex.transaction(async (trx) => {

    // STEP 1a — Loosen the column to VARCHAR so we can write any value during backfill.
    // MySQL ENUMs reject values not in the current list, so we can't write new enum values
    // into an old-enum column. The fix: temporarily change to VARCHAR, backfill, then
    // MODIFY COLUMN to the new ENUM in one step.
    await trx.raw(`
      ALTER TABLE task_masters MODIFY COLUMN placement_mode
        VARCHAR(32) NOT NULL DEFAULT 'anytime'
    `);

    // STEP 1b — Backfill: map old values to new values using VARCHAR column.
    // CASE is evaluated top-to-bottom:
    //   marker         → reminder  (calendar marker / no time-grid occupancy)
    //   when '%allday%'→ all_day   (full-day tasks embedded their mode in when)
    //   when '%fixed%' → fixed     (exact-time immovable tasks used when='fixed')
    //   pinned_date    → anytime   (placeholder never used in UI; falls to ELSE)
    //   recurring_rigid→ time_window (had preferredTimeMins, so preferred_time_mins IS NOT NULL)
    //   recurring_window→ time_window (has preferredTimeMins)
    //   recurring_flexible → time_blocks (when IS NOT NULL) or anytime
    //   flexible       → anytime   (no constraint)
    await trx.raw(`
      UPDATE task_masters SET placement_mode = CASE
        WHEN placement_mode = 'marker'               THEN 'reminder'
        WHEN \`when\` LIKE '%allday%'                THEN 'all_day'
        WHEN \`when\` LIKE '%fixed%'                 THEN 'fixed'
        WHEN preferred_time_mins IS NOT NULL          THEN 'time_window'
        WHEN \`when\` IS NOT NULL AND \`when\` != '' THEN 'time_blocks'
        ELSE                                               'anytime'
      END
    `);

    // STEP 2 — Change column to the new 6-value ENUM (all values now valid).
    // Must specify NOT NULL and DEFAULT explicitly to preserve them.
    await trx.raw(`
      ALTER TABLE task_masters MODIFY COLUMN placement_mode
        ENUM('reminder','all_day','fixed','time_window','time_blocks','anytime')
        NOT NULL DEFAULT 'anytime'
    `);

    // STEP 3 — Strip 'allday' and 'fixed' tokens from the `when` column.
    // These were system keywords embedded in user data; they are now represented
    // by placement_mode values (all_day, fixed) and must be removed from `when`.
    try {
      // MySQL 8.0.4+ supports REGEXP_REPLACE
      await trx.raw(`
        UPDATE task_masters
          SET \`when\` = TRIM(BOTH ',' FROM REGEXP_REPLACE(
            REPLACE(REPLACE(\`when\`, 'allday', ''), 'fixed', ''), ',+', ','))
          WHERE \`when\` LIKE '%allday%' OR \`when\` LIKE '%fixed%'
      `);
    } catch {      // Fallback for MySQL < 8.0.4: strip tokens in JS
      const rows = await trx('task_masters')
        .where(function() {
          this.where('when', 'like', '%allday%').orWhere('when', 'like', '%fixed%');
        })
        .select('id', 'when');

      for (const row of rows) {
        const cleaned = (row.when || '')
          .split(',')
          .map(token => token.trim())
          .filter(token => token !== 'allday' && token !== 'fixed')
          .join(',');
        await trx('task_masters').where('id', row.id).update({ when: cleaned });
      }
    }

    // Set any empty-string `when` values to NULL (cleanup after strip)
    await trx.raw(`UPDATE task_masters SET \`when\` = NULL WHERE \`when\` = ''`);

    // STEP 4 — Rebuild views.
    // Drop in dependency order (tasks_with_sync_v depends on tasks_v).
    await trx.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
    await trx.raw('DROP VIEW IF EXISTS tasks_v');

    // Recreate tasks_v with updated CASE expressions:
    //   rigid:  CASE WHEN m.placement_mode = 'fixed'    THEN 1 ELSE 0 END  (was 'recurring_rigid')
    //   marker: CASE WHEN m.placement_mode = 'reminder' THEN 1 ELSE 0 END  (was 'marker')
    // Both CASE expressions appear twice — once per UNION branch.
    await trx.raw(`
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
        CASE WHEN m.placement_mode = 'fixed' THEN 1 ELSE 0 END AS rigid,
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
        CASE WHEN m.placement_mode = 'fixed' THEN 1 ELSE 0 END AS rigid,
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

    // Recreate tasks_with_sync_v — selects from tasks_v, no enum references inside.
    await trx.raw(`
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
  });
};

exports.down = async function(knex) {
  throw new Error(
    'Down migration for placement_mode_enum_redesign not implemented — reverting ' +
    'requires reconstructing all old enum values from context that no longer exists.'
  );
};
