/**
 * Add disabled status support for subscription downgrade enforcement.
 *
 * - disabled_at: when the item was disabled (for ordering during re-enable)
 * - disabled_reason: why it was disabled ('downgrade', 'admin', etc.)
 * - Composite index for efficient disabled-item queries
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('tasks', function(table) {
    table.timestamp('disabled_at').nullable().defaultTo(null);
    table.string('disabled_reason', 50).nullable().defaultTo(null);
  });

  // Composite index for fetching disabled items per user
  await knex.schema.raw(
    'CREATE INDEX idx_tasks_user_disabled ON tasks (user_id, status, disabled_at) COMMENT "disabled item lookups"'
  );
};

exports.down = async function(knex) {
  await knex.schema.raw('DROP INDEX idx_tasks_user_disabled ON tasks');
  await knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('disabled_at');
    table.dropColumn('disabled_reason');
  });
};
