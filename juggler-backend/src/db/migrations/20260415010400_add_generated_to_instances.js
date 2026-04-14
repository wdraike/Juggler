/**
 * Add `generated` boolean to task_instances and backfill from `tasks`.
 *
 * The scheduler filters on `generated` (marks auto-expanded placeholders that
 * shouldn't participate in placement output). The new two-table model lost
 * this column; without it, flipping the scheduler reads to `tasks_v` would
 * misclassify 43 existing rows. Adding it here, backfilling from the old
 * table, and teaching the trigger + view to preserve it keeps semantics
 * identical while the migration continues.
 */
exports.up = async function(knex) {
  var hasCol = await knex.schema.hasColumn('task_instances', 'generated');
  if (!hasCol) {
    await knex.schema.alterTable('task_instances', function(table) {
      table.boolean('generated').notNullable().defaultTo(false).after('unscheduled');
    });
  }

  // Backfill: copy from tasks.generated where an instance row exists at the same id
  await knex.raw(`
    UPDATE task_instances i
    JOIN tasks t ON t.id = i.id
    SET i.generated = COALESCE(t.generated, 0)
  `);

  // Rebuild triggers to carry NEW.generated through to task_instances
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_insert');
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_update');

  await knex.raw(`
    CREATE TRIGGER tasks_after_insert AFTER INSERT ON tasks FOR EACH ROW
    BEGIN
      DECLARE v_ord INT;

      IF NEW.task_type = 'recurring_template'
         OR (NEW.recurring = 1 AND (NEW.task_type IS NULL OR NEW.task_type <> 'recurring_instance')) THEN
        INSERT INTO task_masters
          (id, user_id, text, project, section, notes, dur, pri,
           desired_at, desired_date, due_at, start_after_at, \`when\`, day_req,
           time_flex, flex_when, rigid, marker, preferred_time_mins, tz, prev_when,
           recurring, recur, recur_start, recur_end, split, split_min,
           depends_on, location, tools, travel_before, travel_after,
           disabled_at, disabled_reason, created_at, updated_at)
        VALUES
          (NEW.id, NEW.user_id, NEW.text, NEW.project, NEW.section, NEW.notes,
           COALESCE(NEW.dur, 30), COALESCE(NEW.pri, 'P3'),
           NEW.desired_at, NEW.desired_date, NEW.due_at, NEW.start_after_at, NEW.\`when\`, NEW.day_req,
           NEW.time_flex, COALESCE(NEW.flex_when, 0), COALESCE(NEW.rigid, 0), COALESCE(NEW.marker, 0),
           NEW.preferred_time_mins, NEW.tz, NEW.prev_when,
           COALESCE(NEW.recurring, 0), NEW.recur, NEW.recur_start, NEW.recur_end,
           NEW.split, NEW.split_min,
           NEW.depends_on, NEW.location, NEW.tools, NEW.travel_before, NEW.travel_after,
           NEW.disabled_at, NEW.disabled_reason, NEW.created_at, NEW.updated_at);

      ELSEIF NEW.task_type = 'recurring_instance' THEN
        SELECT COALESCE(MAX(occurrence_ordinal), 0) + 1 INTO v_ord
          FROM task_instances WHERE master_id = NEW.source_id;
        INSERT INTO task_instances
          (id, master_id, user_id, occurrence_ordinal, split_ordinal, split_total,
           scheduled_at, dur, date_pinned,
           status, time_remaining, unscheduled, \`generated\`, created_at, updated_at)
        VALUES
          (NEW.id, NEW.source_id, NEW.user_id, v_ord, 1, 1,
           NEW.scheduled_at, COALESCE(NEW.dur, 30),
           COALESCE(NEW.date_pinned, 0),
           COALESCE(NEW.status, ''), NEW.time_remaining, NEW.unscheduled,
           COALESCE(NEW.\`generated\`, 0), NEW.created_at, NEW.updated_at);

      ELSE
        INSERT INTO task_masters
          (id, user_id, text, project, section, notes, dur, pri,
           desired_at, desired_date, due_at, start_after_at, \`when\`, day_req,
           time_flex, flex_when, rigid, marker, preferred_time_mins, tz, prev_when,
           recurring, recur, recur_start, recur_end, split, split_min,
           depends_on, location, tools, travel_before, travel_after,
           disabled_at, disabled_reason, created_at, updated_at)
        VALUES
          (NEW.id, NEW.user_id, NEW.text, NEW.project, NEW.section, NEW.notes,
           COALESCE(NEW.dur, 30), COALESCE(NEW.pri, 'P3'),
           NEW.desired_at, NEW.desired_date, NEW.due_at, NEW.start_after_at, NEW.\`when\`, NEW.day_req,
           NEW.time_flex, COALESCE(NEW.flex_when, 0), COALESCE(NEW.rigid, 0), COALESCE(NEW.marker, 0),
           NEW.preferred_time_mins, NEW.tz, NEW.prev_when,
           COALESCE(NEW.recurring, 0), NEW.recur, NEW.recur_start, NEW.recur_end,
           NEW.split, NEW.split_min,
           NEW.depends_on, NEW.location, NEW.tools, NEW.travel_before, NEW.travel_after,
           NEW.disabled_at, NEW.disabled_reason, NEW.created_at, NEW.updated_at);

        INSERT INTO task_instances
          (id, master_id, user_id, occurrence_ordinal, split_ordinal, split_total,
           scheduled_at, dur, date_pinned,
           status, time_remaining, unscheduled, \`generated\`, created_at, updated_at)
        VALUES
          (NEW.id, NEW.id, NEW.user_id, 1, 1, 1,
           NEW.scheduled_at, COALESCE(NEW.dur, 30),
           COALESCE(NEW.date_pinned, 0),
           COALESCE(NEW.status, ''), NEW.time_remaining, NEW.unscheduled,
           COALESCE(NEW.\`generated\`, 0), NEW.created_at, NEW.updated_at);
      END IF;
    END
  `);

  await knex.raw(`
    CREATE TRIGGER tasks_after_update AFTER UPDATE ON tasks FOR EACH ROW
    BEGIN
      IF NEW.task_type = 'recurring_template'
         OR (NEW.recurring = 1 AND (NEW.task_type IS NULL OR NEW.task_type <> 'recurring_instance')) THEN
        UPDATE task_masters SET
          user_id = NEW.user_id, text = NEW.text, project = NEW.project, section = NEW.section,
          notes = NEW.notes, dur = COALESCE(NEW.dur, 30), pri = COALESCE(NEW.pri, 'P3'),
          desired_at = NEW.desired_at, desired_date = NEW.desired_date,
          due_at = NEW.due_at, start_after_at = NEW.start_after_at,
          \`when\` = NEW.\`when\`, day_req = NEW.day_req,
          time_flex = NEW.time_flex, flex_when = COALESCE(NEW.flex_when, 0),
          rigid = COALESCE(NEW.rigid, 0), marker = COALESCE(NEW.marker, 0),
          preferred_time_mins = NEW.preferred_time_mins, tz = NEW.tz, prev_when = NEW.prev_when,
          recurring = COALESCE(NEW.recurring, 0), recur = NEW.recur,
          recur_start = NEW.recur_start, recur_end = NEW.recur_end,
          split = NEW.split, split_min = NEW.split_min,
          depends_on = NEW.depends_on, location = NEW.location, tools = NEW.tools,
          travel_before = NEW.travel_before, travel_after = NEW.travel_after,
          disabled_at = NEW.disabled_at, disabled_reason = NEW.disabled_reason,
          updated_at = NEW.updated_at
        WHERE id = NEW.id;

      ELSEIF NEW.task_type = 'recurring_instance' THEN
        UPDATE task_instances SET
          user_id = NEW.user_id,
          scheduled_at = NEW.scheduled_at, dur = COALESCE(NEW.dur, 30),
          date_pinned = COALESCE(NEW.date_pinned, 0),
          status = COALESCE(NEW.status, ''), time_remaining = NEW.time_remaining,
          unscheduled = NEW.unscheduled,
          \`generated\` = COALESCE(NEW.\`generated\`, 0),
          updated_at = NEW.updated_at
        WHERE id = NEW.id;

      ELSE
        UPDATE task_masters SET
          user_id = NEW.user_id, text = NEW.text, project = NEW.project, section = NEW.section,
          notes = NEW.notes, dur = COALESCE(NEW.dur, 30), pri = COALESCE(NEW.pri, 'P3'),
          desired_at = NEW.desired_at, desired_date = NEW.desired_date,
          due_at = NEW.due_at, start_after_at = NEW.start_after_at,
          \`when\` = NEW.\`when\`, day_req = NEW.day_req,
          time_flex = NEW.time_flex, flex_when = COALESCE(NEW.flex_when, 0),
          rigid = COALESCE(NEW.rigid, 0), marker = COALESCE(NEW.marker, 0),
          preferred_time_mins = NEW.preferred_time_mins, tz = NEW.tz, prev_when = NEW.prev_when,
          recurring = COALESCE(NEW.recurring, 0), recur = NEW.recur,
          recur_start = NEW.recur_start, recur_end = NEW.recur_end,
          split = NEW.split, split_min = NEW.split_min,
          depends_on = NEW.depends_on, location = NEW.location, tools = NEW.tools,
          travel_before = NEW.travel_before, travel_after = NEW.travel_after,
          disabled_at = NEW.disabled_at, disabled_reason = NEW.disabled_reason,
          updated_at = NEW.updated_at
        WHERE id = NEW.id;

        UPDATE task_instances SET
          user_id = NEW.user_id,
          scheduled_at = NEW.scheduled_at, dur = COALESCE(NEW.dur, 30),
          date_pinned = COALESCE(NEW.date_pinned, 0),
          status = COALESCE(NEW.status, ''), time_remaining = NEW.time_remaining,
          unscheduled = NEW.unscheduled,
          \`generated\` = COALESCE(NEW.\`generated\`, 0),
          updated_at = NEW.updated_at
        WHERE id = NEW.id;
      END IF;
    END
  `);

  // Rebuild view so it sources `generated` from task_instances
  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.raw(`
    CREATE VIEW tasks_v AS
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
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_insert');
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_update');
  await knex.schema.alterTable('task_instances', function(table) {
    table.dropColumn('generated');
  });
};
