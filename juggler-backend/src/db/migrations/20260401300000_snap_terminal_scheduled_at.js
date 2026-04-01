/**
 * Snap scheduled_at to updated_at (or now) for terminal-status tasks
 * that still have a future scheduled_at. Also clear original_scheduled_at
 * so the scheduler reset step doesn't revert them.
 */
exports.up = async function(knex) {
  var result = await knex.raw(`
    UPDATE tasks
    SET scheduled_at = CASE
      WHEN updated_at <= NOW() THEN updated_at
      ELSE NOW()
    END,
    original_scheduled_at = NULL
    WHERE status IN ('done', 'cancel', 'skip')
      AND scheduled_at > NOW()
  `);
  var changed = result[0] ? result[0].changedRows : (result.changes || 0);
  if (changed > 0) {
    console.log('[MIGRATION] snapped scheduled_at on ' + changed + ' terminal-status tasks with future dates');
  }

  // Also clear any lingering original_scheduled_at on terminal tasks
  // even if scheduled_at is already in the past
  var cleared = await knex('tasks')
    .whereIn('status', ['done', 'cancel', 'skip'])
    .whereNotNull('original_scheduled_at')
    .update({ original_scheduled_at: null });
  if (cleared > 0) {
    console.log('[MIGRATION] cleared original_scheduled_at on ' + cleared + ' terminal-status tasks');
  }
};

exports.down = async function() {
  // No rollback — original future dates are not recoverable
};
