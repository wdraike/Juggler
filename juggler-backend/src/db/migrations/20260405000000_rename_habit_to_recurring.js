/**
 * Rename "habit" terminology to "recurring" throughout the database.
 * - Column: habit → recurring
 * - Column: habit_start → recur_start
 * - Column: habit_end → recur_end
 * - task_type values: habit_template → recurring_template, habit_instance → recurring_instance
 */
exports.up = async function(knex) {
  // Rename columns
  await knex.schema.alterTable('tasks', function(table) {
    table.renameColumn('habit', 'recurring');
    table.renameColumn('habit_start', 'recur_start');
    table.renameColumn('habit_end', 'recur_end');
  });

  // Update task_type values
  await knex('tasks').where('task_type', 'habit_template').update({ task_type: 'recurring_template' });
  await knex('tasks').where('task_type', 'habit_instance').update({ task_type: 'recurring_instance' });

  // Update cascade references in any stored config
  // (plan limits key: habit_templates → recurring_templates)
};

exports.down = async function(knex) {
  // Revert task_type values
  await knex('tasks').where('task_type', 'recurring_template').update({ task_type: 'habit_template' });
  await knex('tasks').where('task_type', 'recurring_instance').update({ task_type: 'habit_instance' });

  // Revert column names
  await knex.schema.alterTable('tasks', function(table) {
    table.renameColumn('recurring', 'habit');
    table.renameColumn('recur_start', 'habit_start');
    table.renameColumn('recur_end', 'habit_end');
  });
};
