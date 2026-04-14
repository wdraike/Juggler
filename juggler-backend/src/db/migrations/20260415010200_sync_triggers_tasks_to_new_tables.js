/**
 * Keep task_masters + task_instances in sync with writes to `tasks`.
 *
 * Rationale: the app still reads/writes the monolithic `tasks` table. Rewriting
 * every caller is a multi-session refactor. Until the app flips, these AFTER
 * INSERT/UPDATE/DELETE triggers mirror every change into the new two-table
 * model so downstream work (readers flipping to task_masters/task_instances)
 * can proceed incrementally without breaking anything.
 *
 * Classification of a `tasks` row:
 *   - recurring_template (or legacy recurring=1 non-instance): lives in task_masters only
 *   - recurring_instance: lives in task_instances only (master_id = source_id)
 *   - everything else ('task', '', NULL, 'generated'): lives in both, with
 *     task_masters.id = task_instances.id = tasks.id (the backfill already
 *     established this 1:1 id sharing for non-recurring rows)
 *
 * Limitations:
 *   - occurrence_ordinal for new recurring_instance rows is MAX+1 per master
 *     (OK for the single-writer scheduler; a strict implementation would use
 *     a lock, but there is none today)
 *   - split_ordinal/split_total stay at 1 — splits remain ephemeral in the
 *     scheduler cache; true split-as-row persistence is a later phase
 *   - UPDATE trigger writes every mirrored column unconditionally; redundant
 *     writes for untouched fields are harmless but do bump updated_at
 */
exports.up = async function(knex) {
  // Clean up any leftover triggers from a prior failed attempt
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_insert');
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_update');
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_delete');

  // ── INSERT ────────────────────────────────────────────────────────────────
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
           status, time_remaining, unscheduled, created_at, updated_at)
        VALUES
          (NEW.id, NEW.source_id, NEW.user_id, v_ord, 1, 1,
           NEW.scheduled_at, COALESCE(NEW.dur, 30),
           COALESCE(NEW.date_pinned, 0),
           COALESCE(NEW.status, ''), NEW.time_remaining, NEW.unscheduled,
           NEW.created_at, NEW.updated_at);

      ELSE
        -- Non-recurring task: master + instance (shared id)
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
           status, time_remaining, unscheduled, created_at, updated_at)
        VALUES
          (NEW.id, NEW.id, NEW.user_id, 1, 1, 1,
           NEW.scheduled_at, COALESCE(NEW.dur, 30),
           COALESCE(NEW.date_pinned, 0),
           COALESCE(NEW.status, ''), NEW.time_remaining, NEW.unscheduled,
           NEW.created_at, NEW.updated_at);
      END IF;
    END
  `);

  // ── UPDATE ────────────────────────────────────────────────────────────────
  // We mirror every column unconditionally. Redundant for untouched fields,
  // but avoids having to detect per-column changes from inside the trigger.
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
          updated_at = NEW.updated_at
        WHERE id = NEW.id;

      ELSE
        -- Non-recurring: update both master and instance
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
          updated_at = NEW.updated_at
        WHERE id = NEW.id;
      END IF;
    END
  `);

  // ── DELETE ────────────────────────────────────────────────────────────────
  // For non-recurring and recurring_template rows, deleting the master cascades
  // to any instance rows via the FK. For recurring_instance rows, delete just
  // the instance.
  await knex.raw(`
    CREATE TRIGGER tasks_after_delete AFTER DELETE ON tasks FOR EACH ROW
    BEGIN
      IF OLD.task_type = 'recurring_instance' THEN
        DELETE FROM task_instances WHERE id = OLD.id;
      ELSE
        DELETE FROM task_masters WHERE id = OLD.id;
      END IF;
    END
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_insert');
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_update');
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_delete');
};
