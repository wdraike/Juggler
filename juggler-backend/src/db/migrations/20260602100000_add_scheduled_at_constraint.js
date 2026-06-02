/**
 * Add constraint to ensure scheduled_at is not null for terminal statuses.
 * This migration adds a CHECK constraint that prevents tasks with terminal statuses
 * (done, skip, cancel, missed) from having a null scheduled_at value.
 *
 * Reference: juggler-cal-history-A-PLAN.md requirement D-15
 */

exports.up = async function(knex) {
  // Check if the constraint already exists
  const constraintCheck = await knex.raw(
    "SELECT CONSTRAINT_NAME " +
    "FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS " +
    "WHERE TABLE_SCHEMA = DATABASE() " +
    "AND TABLE_NAME = 'tasks' " +
    "AND CONSTRAINT_NAME = 'chk_scheduled_at_not_null_for_terminal_statuses'"
  );

  const constraintExists = constraintCheck[0] && constraintCheck[0].length > 0;
  
  if (!constraintExists) {
    // Add CHECK constraint for scheduled_at requirement on terminal statuses
    await knex.raw(`
      ALTER TABLE tasks 
      ADD CONSTRAINT chk_scheduled_at_not_null_for_terminal_statuses 
      CHECK (
        (status NOT IN ('done', 'skip', 'cancel', 'missed') OR scheduled_at IS NOT NULL)
      )
    `);
    
    console.log('Added CHECK constraint for scheduled_at on terminal statuses');
  } else {
    console.log('CHECK constraint already exists');
  }

  // Also ensure the scheduled_at column itself is properly configured
  await knex.schema.alterTable('tasks', function(table) {
    // Make sure scheduled_at column has proper collation if it's a string type
    // (though it should be datetime, this ensures consistency)
    table.datetime('scheduled_at')
      .nullable()
      .alter();
  });
};

exports.down = async function(knex) {
  // Remove the constraint
  await knex.raw(`
    ALTER TABLE tasks 
    DROP CONSTRAINT IF EXISTS chk_scheduled_at_not_null_for_terminal_statuses
  `);
};