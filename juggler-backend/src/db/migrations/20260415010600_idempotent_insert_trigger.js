/**
 * Make the tasks_after_insert trigger idempotent so the write-path helper
 * (src/lib/tasks-write.js) can safely dual-write during transition:
 *   1. helper writes directly to task_masters / task_instances
 *   2. helper then writes to the legacy `tasks` table for backward compat
 *   3. this trigger fires on step 2; its inserts into master/instance
 *      now use ON DUPLICATE KEY UPDATE id=id (a no-op on the conflict)
 *      so step 1's rows aren't overwritten or duplicated.
 *
 * UPDATE and DELETE triggers were already idempotent (UPDATE/DELETE
 * WHERE id=X is naturally no-op on a missing row), so they're untouched.
 *
 * When all writers are flipped to the helper, the triggers will be
 * dropped entirely along with the `tasks` table.
 */
exports.up = async function(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_insert');
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
           NEW.disabled_at, NEW.disabled_reason, NEW.created_at, NEW.updated_at)
        ON DUPLICATE KEY UPDATE id = id;

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
           COALESCE(NEW.\`generated\`, 0), NEW.created_at, NEW.updated_at)
        ON DUPLICATE KEY UPDATE id = id;

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
           NEW.disabled_at, NEW.disabled_reason, NEW.created_at, NEW.updated_at)
        ON DUPLICATE KEY UPDATE id = id;

        INSERT INTO task_instances
          (id, master_id, user_id, occurrence_ordinal, split_ordinal, split_total,
           scheduled_at, dur, date_pinned,
           status, time_remaining, unscheduled, \`generated\`, created_at, updated_at)
        VALUES
          (NEW.id, NEW.id, NEW.user_id, 1, 1, 1,
           NEW.scheduled_at, COALESCE(NEW.dur, 30),
           COALESCE(NEW.date_pinned, 0),
           COALESCE(NEW.status, ''), NEW.time_remaining, NEW.unscheduled,
           COALESCE(NEW.\`generated\`, 0), NEW.created_at, NEW.updated_at)
        ON DUPLICATE KEY UPDATE id = id;
      END IF;
    END
  `);
};

exports.down = async function(knex) {
  // Restore the prior trigger (non-idempotent) — copied from 20260415010400
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_insert');
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
};
