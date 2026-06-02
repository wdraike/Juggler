/**
 * Update task status column to use ENUM type with explicit utf8mb4_unicode_ci collation.
 * This migration extends the status field to include 'missed' status and ensures
 * proper collation per CLAUDE.md project conventions.
 *
 * Status values: '', 'wip', 'done', 'skip', 'cancel', 'missed'
 */

exports.up = async function(knex) {
  // First, check if the status column already exists and what type it is
  const columnInfo = await knex.raw(
    "SELECT DATA_TYPE, COLUMN_TYPE, COLLATION_NAME " +
    "FROM INFORMATION_SCHEMA.COLUMNS " +
    "WHERE TABLE_SCHEMA = DATABASE() " +
    "AND TABLE_NAME = 'tasks' " +
    "AND COLUMN_NAME = 'status'"
  );

  const currentColumn = columnInfo[0][0];
  
  if (!currentColumn) {
    console.log('Status column not found, nothing to update');
    return;
  }

  console.log('Current status column:', currentColumn);

  // If it's not already an ENUM with the correct values, update it
  if (currentColumn.DATA_TYPE !== 'enum' || 
      !currentColumn.COLUMN_TYPE.includes("','missed','")) {
    
    await knex.schema.alterTable('tasks', function(table) {
      // Change the status column to ENUM with all required values
      table.specificType('status', 'ENUM("", "wip", "done", "skip", "cancel", "missed")')
        .alter()
        .defaultTo('')
        .comment('empty, wip, done, skip, cancel, missed')
        .collate('utf8mb4_unicode_ci');
    });
    
    console.log('Updated status column to ENUM with utf8mb4_unicode_ci collation');
  } else {
    console.log('Status column already has correct ENUM type and values');
  }

  // Ensure the table uses utf8mb4_unicode_ci collation
  const tableInfo = await knex.raw(
    "SELECT TABLE_COLLATION " +
    "FROM INFORMATION_SCHEMA.TABLES " +
    "WHERE TABLE_SCHEMA = DATABASE() " +
    "AND TABLE_NAME = 'tasks'"
  );

  const currentTableCollation = tableInfo[0][0]?.TABLE_COLLATION;
  
  if (currentTableCollation !== 'utf8mb4_unicode_ci') {
    await knex.raw(
      "ALTER TABLE tasks CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
    console.log('Converted tasks table to utf8mb4_unicode_ci collation');
  }
};

exports.down = async function(knex) {
  // Revert to varchar(10) to maintain backward compatibility
  await knex.schema.alterTable('tasks', function(table) {
    table.string('status', 10)
      .alter()
      .defaultTo('')
      .comment('empty, done, wip, cancel, skip, other');
  });
};