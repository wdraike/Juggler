/**
 * Add desired_at and desired_date columns to separate user intent from
 * scheduler placement. User saves write to desired_at/desired_date;
 * the scheduler reads them as hints but only writes to scheduled_at.
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('tasks', function(table) {
    table.datetime('desired_at').nullable().after('scheduled_at')
      .comment('User intended date/time (UTC). Scheduler reads but never writes.');
    table.date('desired_date').nullable().after('desired_at')
      .comment('User intended date only (no time). For date-without-time tasks.');
  });

  // Copy scheduled_at → desired_at for pinned/fixed tasks (these represent user intent)
  await knex('tasks')
    .whereNotNull('scheduled_at')
    .where(function() {
      this.where('date_pinned', 1)
        .orWhere('when', 'like', '%fixed%');
    })
    .update({ desired_at: knex.raw('scheduled_at') });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('desired_at');
    table.dropColumn('desired_date');
  });
};
