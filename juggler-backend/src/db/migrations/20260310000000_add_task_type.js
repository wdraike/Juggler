/**
 * Add task_type column to replace ID-prefix-based type detection.
 * Values: 'task' (default), 'habit_template', 'habit_instance', 'generated'
 */
exports.up = async function(knex) {
  // Add column
  await knex.schema.alterTable('tasks', function(table) {
    table.string('task_type', 20).defaultTo('task').after('id');
  });

  // Populate from existing data:
  // 1. Habit templates: have recur config, habit=1, not an instance prefix
  await knex.raw(`
    UPDATE tasks SET task_type = 'habit_template'
    WHERE habit = 1
      AND recur IS NOT NULL AND recur != 'null' AND recur != ''
      AND id NOT LIKE 'dh%' AND id NOT LIKE 'rc\\_%'
  `);

  // 2. Habit instances: dh*/rc_* prefix OR have source_id
  await knex.raw(`
    UPDATE tasks SET task_type = 'habit_instance'
    WHERE task_type = 'task'
      AND (id LIKE 'dh%' OR id LIKE 'rc\\_%' OR source_id IS NOT NULL)
  `);

  // 3. Generated instances that were persisted (rc_* prefix)
  await knex.raw(`
    UPDATE tasks SET task_type = 'habit_instance'
    WHERE id LIKE 'rc\\_%' AND task_type != 'habit_template'
  `);

  // Add index
  await knex.schema.alterTable('tasks', function(table) {
    table.index(['user_id', 'task_type'], 'idx_tasks_user_type');
  });

  // Report
  var counts = await knex('tasks')
    .select('task_type')
    .count('* as cnt')
    .groupBy('task_type');
  counts.forEach(function(r) {
    console.log('[MIGRATION] task_type=' + r.task_type + ': ' + r.cnt);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('tasks', function(table) {
    table.dropIndex([], 'idx_tasks_user_type');
    table.dropColumn('task_type');
  });
};
