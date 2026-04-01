/**
 * Add habit_start/habit_end date range columns and migrate instance notes to templates.
 */
exports.up = async function(knex) {
  // Add habit date range columns
  var hasHabitStart = await knex.schema.hasColumn('tasks', 'habit_start');
  if (!hasHabitStart) {
    await knex.schema.alterTable('tasks', function(table) {
      table.date('habit_start').nullable();
      table.date('habit_end').nullable();
    });
  }

  // Migrate instance notes to their templates.
  // For each template with empty notes, copy the most recent instance's notes.
  var templates = await knex('tasks')
    .where('task_type', 'habit_template')
    .where(function() {
      this.whereNull('notes').orWhere('notes', '');
    })
    .select('id');

  for (var i = 0; i < templates.length; i++) {
    var tmplId = templates[i].id;
    var instanceWithNotes = await knex('tasks')
      .where({ source_id: tmplId, task_type: 'habit_instance' })
      .whereNotNull('notes')
      .whereNot('notes', '')
      .orderBy('updated_at', 'desc')
      .first();

    if (instanceWithNotes) {
      await knex('tasks').where('id', tmplId).update({
        notes: instanceWithNotes.notes,
        updated_at: knex.fn.now()
      });
    }
  }

  // Clear notes on all habit instances (they'll inherit from template now)
  await knex('tasks')
    .where('task_type', 'habit_instance')
    .whereNotNull('notes')
    .whereNot('notes', '')
    .update({ notes: null });
};

exports.down = async function(knex) {
  var hasHabitStart = await knex.schema.hasColumn('tasks', 'habit_start');
  if (hasHabitStart) {
    await knex.schema.alterTable('tasks', function(table) {
      table.dropColumn('habit_start');
      table.dropColumn('habit_end');
    });
  }
};
