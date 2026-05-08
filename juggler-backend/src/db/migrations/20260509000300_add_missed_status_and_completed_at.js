/**
 * juggler-cal-history Plan A — schema foundation.
 *
 * Adds:
 *   - 'missed' to task_instances.status + task_masters.status CHECK constraints
 *     (extends existing 20260506000200 + 20260508000200 constraint sets)
 *   - task_instances.completed_at DATETIME NULL — used by FixedPopup, purge cron
 *   - idx_task_instances_purge (user_id, status, completed_at) — sharded purge support
 *   - Backfill: legacy terminal rows get completed_at = updated_at (best available approximation)
 *   - tasks_v + tasks_with_sync_v recreated to expose completed_at
 *
 * Status value 'missed' (NEW): system auto-applied to past-pending recurring instances
 * once their resolution window closes. Distinct from 'skip' (user-initiated) and from
 * the transient _unplacedReason='missed' scheduler flag (in-memory only).
 *
 * Notes:
 *   - MySQL implicitly commits each DDL — no explicit transaction wrapper.
 *   - DROP CHECK uses IF EXISTS pattern via try/catch to keep migration idempotent
 *     across environments where the prior migrations may not have run.
 *   - View body is taken verbatim from 20260506000600_add_humidity_to_views.js with
 *     completed_at added on both arms (NULL on template arm, i.completed_at on instance arm).
 */

async function dropCheckIfExists(knex, table, name) {
  try {
    await knex.raw('ALTER TABLE ?? DROP CHECK ' + name, [table]);
  } catch (e) {
    // Constraint may not exist on this database (e.g. older MySQL, or prior migration skipped).
    // Idempotency: ignore. The ADD CONSTRAINT below will create it correctly.
  }
}

exports.up = async function(knex) {
  // ── 1. Replace status CHECK constraints to allow 'missed' ─────────────────
  await dropCheckIfExists(knex, 'task_instances', 'chk_task_instances_status');
  await dropCheckIfExists(knex, 'task_masters', 'chk_task_masters_status');

  await knex.raw(`
    ALTER TABLE task_instances
      ADD CONSTRAINT chk_task_instances_status
        CHECK (status IN ('','wip','done','cancel','skip','pause','disabled','missed'))
  `);
  await knex.raw(`
    ALTER TABLE task_masters
      ADD CONSTRAINT chk_task_masters_status
        CHECK (status IN ('','wip','done','cancel','skip','pause','disabled','missed') OR status IS NULL)
  `);

  // ── 2. Add completed_at column + supporting index ─────────────────────────
  // Guard: skip if column already exists (re-run safety).
  var col = await knex.raw(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS " +
    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_instances' AND COLUMN_NAME = 'completed_at'"
  );
  if (!col[0] || col[0].length === 0) {
    await knex.raw(`
      ALTER TABLE task_instances
        ADD COLUMN completed_at DATETIME NULL COMMENT 'When status flipped to a terminal value (done/skip/cancel/missed). Used by FixedPopup + sharded purge cron.'
    `);
  }

  // Index for sharded purge query: WHERE user_id % K = ? AND status IN (...) AND completed_at < ?
  var idx = await knex.raw(
    "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS " +
    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_instances' AND INDEX_NAME = 'idx_task_instances_purge'"
  );
  if (!idx[0] || idx[0].length === 0) {
    await knex.raw(
      'ALTER TABLE task_instances ADD INDEX idx_task_instances_purge (user_id, status, completed_at) COMMENT "juggler-cal-history sharded purge"'
    );
  }

  // ── 3. Backfill completed_at for legacy terminal rows ─────────────────────
  // Best available approximation: updated_at (which reflects the last write to the row).
  // For rows that have been touched after their terminal transition this is imprecise,
  // but no audit log exists for legacy rows. Documented in RESEARCH §5 risks.
  await knex.raw(`
    UPDATE task_instances
       SET completed_at = updated_at
     WHERE status IN ('done','skip','cancel')
       AND completed_at IS NULL
  `);

  // ── 4. Recreate tasks_v + tasks_with_sync_v to expose completed_at ────────
  // Body is the canonical shape from 20260506000600_add_humidity_to_views.js
  // with completed_at added on both arms.
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
      CAST(NULL AS DATETIME)       AS completed_at,
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
      i.completed_at               AS completed_at,
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
      v.created_at, v.updated_at, v.completed_at, v.master_id,
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
  // Reverse view shape — drop completed_at columns from both views.
  await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
  await knex.raw('DROP VIEW IF EXISTS tasks_v');

  // Restore canonical shape from 20260506000600_add_humidity_to_views.js up().
  // Identical to that migration's up — re-create both views without completed_at.
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

  // Drop index, drop column, restore CHECK constraints.
  await knex.raw('ALTER TABLE task_instances DROP INDEX idx_task_instances_purge').catch(function() {});
  await knex.raw('ALTER TABLE task_instances DROP COLUMN completed_at').catch(function() {});

  await knex.raw('ALTER TABLE task_instances DROP CHECK chk_task_instances_status').catch(function() {});
  await knex.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_status').catch(function() {});

  await knex.raw(`
    ALTER TABLE task_instances
      ADD CONSTRAINT chk_task_instances_status
        CHECK (status IN ('','wip','done','cancel','skip','pause','disabled'))
  `);
  await knex.raw(`
    ALTER TABLE task_masters
      ADD CONSTRAINT chk_task_masters_status
        CHECK (status IN ('','wip','done','cancel','skip','pause','disabled') OR status IS NULL)
  `);
};
