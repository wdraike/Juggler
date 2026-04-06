/**
 * Clear all original_scheduled_at values.
 * This field is no longer used — the scheduler now works from current
 * scheduled_at values directly, with no reset/undo step.
 */
exports.up = function(knex) {
  return knex('tasks')
    .whereNotNull('original_scheduled_at')
    .update({ original_scheduled_at: null });
};

exports.down = function(knex) {
  // Cannot restore values — this is a one-way data cleanup
  return Promise.resolve();
};
