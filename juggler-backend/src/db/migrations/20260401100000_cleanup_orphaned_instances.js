/**
 * Clean up orphaned habit instances:
 * - Pending instances whose template no longer exists
 * - Clear stale status on habit templates
 */
exports.up = async function(knex) {
  // 1. Delete pending habit instances whose template no longer exists
  var orphans = await knex.raw(`
    SELECT i.id FROM tasks i
    LEFT JOIN tasks t ON i.source_id = t.id
    WHERE i.task_type = 'habit_instance'
      AND i.status = ''
      AND i.source_id IS NOT NULL
      AND t.id IS NULL
  `);
  var orphanRows = orphans[0] || orphans;
  if (orphanRows.length > 0) {
    var ids = orphanRows.map(function(r) { return r.id; });
    var chunkSize = 100;
    for (var i = 0; i < ids.length; i += chunkSize) {
      await knex('tasks').whereIn('id', ids.slice(i, i + chunkSize)).del();
    }
    console.log('[MIGRATION] deleted ' + ids.length + ' orphaned pending habit instances');
  }

  // 2. Clear stale status on habit templates (templates should never have status)
  var staleCount = await knex('tasks')
    .where('task_type', 'habit_template')
    .whereNot('status', '')
    .update({ status: '' });
  if (staleCount > 0) {
    console.log('[MIGRATION] cleared stale status on ' + staleCount + ' habit templates');
  }
};

exports.down = async function() {
  // No rollback — cleanup is idempotent
};
